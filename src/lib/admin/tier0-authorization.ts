import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveAdminPrivilegeRole,
  roleAtLeast,
  type AdminPrivilegeRole,
} from "./admin-privilege";
import { tier0ActionEntry, type Tier0SecurityClassification } from "./tier0-action-catalogue";
import type { AssuranceEvidence, ElevationVerdict } from "./step-up-auth";
import {
  recordPrivilegedActionEvent,
  recordPrivilegedActionApproval,
  queryPrivilegedActionAudit,
  type PrivilegedActionEvent,
} from "./privileged-action-audit";

/**
 * Phase 16-E — the Tier-0 privileged-action authorization decision point.
 *
 * ---------------------------------------------------------------------------
 * SECURITY FIX BATCH (post-closure-audit): `allowed` IS THE AUTHORIZATION
 * TRUTH, ALWAYS. NOTHING ADJUSTS IT.
 * ---------------------------------------------------------------------------
 * The 16-E closure audit proved a real defect here: the previous version
 * let `CINEFIELD_TIER0_ENFORCEMENT_MODE` turn a real `deny` into
 * `allowed: true` whenever the env var was not the exact string `"enforce"`
 * — which is the DEFAULT, unset state. A normal admin session (no Tier-0
 * role, no step-up, no elevation) could therefore execute
 * `queue.dlq.redrive` / `route.disable` / `temporal.workflow.cancel`,
 * directly violating the binding invariant: "a normal admin session alone
 * must NOT be sufficient to execute a Tier-0 action."
 *
 * This function no longer has that lever. `role_not_permitted`,
 * `step_up_not_configured`, `step_up_not_elevated`, and
 * `awaiting_second_approval` ALWAYS return `allowed: false` — full stop.
 * `CINEFIELD_TIER0_ENFORCEMENT_MODE` still exists and is still read, but it
 * is now OBSERVABILITY ONLY: it is stamped on the returned decision as
 * `enforcementMode` (and available to a caller for logging/telemetry/
 * rollout dashboards), and it changes nothing about whether the caller may
 * proceed. There is no parsing of this env var, malformed or otherwise,
 * that can make a deny into an allow — every unrecognized value behaves
 * identically to `"shadow"`, and `"shadow"` no longer means anything but
 * "label this decision as evaluated during the shadow-observation rollout
 * window."
 *
 * PRACTICAL CONSEQUENCE, STATED PLAINLY: because live Clerk MFA/passkey
 * configuration is honestly `NOT_CONFIGURED` in every environment today
 * (`step-up-auth.ts`'s header), every `HIGH_RISK_TIER0` action that
 * `requiresStepUp` (DLQ redrive, route disable, Temporal cancel,
 * quarantine release) is now REFUSED for every caller until an operator
 * provisions that external Clerk configuration. That is correct fail-closed
 * behavior, not a regression to work around — see Section 5 of the fix
 * batch. `queue.bullmq.retry` (`OPERATOR_MUTATION`, `requiresStepUp: false`)
 * is unaffected and keeps working under an `operator`-tier actor, exactly
 * as before.
 */

export type Tier0EnforcementMode = "enforce" | "shadow";

/**
 * Parses `CINEFIELD_TIER0_ENFORCEMENT_MODE` into an explicit mode label.
 * Observability only — see this file's header. Any value other than the
 * exact string `"enforce"` (missing, empty, whitespace, wrong case, a
 * typo, or the literal `"shadow"`) resolves to `"shadow"`. That default is
 * safe now in a way it was not before this fix: `"shadow"` no longer
 * bypasses a real deny.
 */
export function tier0EnforcementMode(
  rawEnv: string | undefined = process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE
): Tier0EnforcementMode {
  return rawEnv === "enforce" ? "enforce" : "shadow";
}

const ACTION_NAME_PATTERN = /^[a-z][a-z0-9_.]{1,80}$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Tier0DecisionReasonCode =
  | "unknown_action"
  | "invalid_request_id"
  | "role_not_permitted"
  | "step_up_not_configured"
  | "step_up_not_elevated"
  | "awaiting_second_approval"
  | "two_person_rejected"
  | "two_person_expired"
  | "allowed";

export interface Tier0AuthorizationParams {
  /** Caller-generated UUID, correlates every event for this one action attempt. */
  requestId: string;
  /** A `tier0-action-catalogue.ts` key. */
  action: string;
  actorClerkUserId: string;
  target: { type: string; id?: string | null };
  reasonCode?: string | null;
  correlationId?: string | null;
  /** Resolved by the caller via `require-step-up.ts` — never fetched here. */
  assurance: AssuranceEvidence;
  elevation: ElevationVerdict;
  /**
   * Overrides the env-derived mode for tests. NEVER changes whether the
   * decision is `allowed` — see this file's header. Purely stamped onto
   * the returned decision and into audit telemetry.
   */
  mode?: Tier0EnforcementMode;
}

export interface Tier0Decision {
  /** The real authorization truth. Never adjusted by enforcement mode. */
  readonly allowed: boolean;
  readonly requestId: string;
  readonly action: string;
  readonly classification: Tier0SecurityClassification | null;
  /** The real reason, always — never a fabricated "allowed" label. */
  readonly reasonCode: Tier0DecisionReasonCode;
  readonly role: AdminPrivilegeRole | null;
  /** Observability only. See this file's header — never gates `allowed`. */
  readonly enforcementMode: Tier0EnforcementMode;
}

function isValidTarget(target: { type: string; id?: string | null }): boolean {
  return typeof target?.type === "string" && /^[a-z][a-z0-9_]{1,64}$/.test(target.type);
}

/**
 * The decision point. See this file's header for the fail-closed guarantee
 * and Section 19's "never invokes the owner" boundary (unchanged from the
 * original 16-E design — only the enforcement-mode lever was removed).
 */
export async function authorizeTier0Action(
  admin: SupabaseClient,
  params: Tier0AuthorizationParams
): Promise<Tier0Decision> {
  const mode = params.mode ?? tier0EnforcementMode();

  if (!REQUEST_ID_PATTERN.test(params.requestId) || !ACTION_NAME_PATTERN.test(params.action) || !isValidTarget(params.target)) {
    return {
      allowed: false,
      requestId: params.requestId,
      action: params.action,
      classification: null,
      reasonCode: "invalid_request_id",
      role: null,
      enforcementMode: mode,
    };
  }

  const entry = tier0ActionEntry(params.action);
  if (!entry) {
    // Nothing to correlate a durable event to — an unregistered action name
    // is a programming error at the call site, not a decision to record.
    return {
      allowed: false,
      requestId: params.requestId,
      action: params.action,
      classification: null,
      reasonCode: "unknown_action",
      role: null,
      enforcementMode: mode,
    };
  }

  const role = resolveAdminPrivilegeRole(params.actorClerkUserId);

  // PHASE 19 CLOSURE FIX: a caller retrying a pending two-person request
  // passes back the SAME `requestId` (see `decidePrivilegedAction`'s
  // header). Re-writing a fresh 'requested' event on every retry would
  // both clutter the audit trail with duplicates AND, worse, silently
  // renew the request's apparent age on every attempt — defeating the
  // whole point of the request-window expiry check below, since a stale
  // request would look freshly requested forever as long as SOMEONE kept
  // retrying it. Only the FIRST attempt for a given `requestId` logs
  // 'requested'.
  if (!(await originalRequestFor(admin, params.requestId))) {
    await recordPrivilegedActionEvent(admin, {
      requestId: params.requestId,
      event: "requested",
      actorClerkUserId: params.actorClerkUserId,
      actionType: params.action,
      targetType: params.target.type,
      targetId: params.target.id ?? null,
      reasonCode: params.reasonCode ?? null,
      correlationId: params.correlationId ?? null,
      securityClassification: entry.classification,
    });
  }

  const deny = async (reasonCode: Tier0DecisionReasonCode, outcomeDetail: string): Promise<Tier0Decision> => {
    await recordPrivilegedActionEvent(admin, {
      requestId: params.requestId,
      event: "denied",
      actorClerkUserId: params.actorClerkUserId,
      actionType: params.action,
      targetType: params.target.type,
      targetId: params.target.id ?? null,
      reasonCode: params.reasonCode ?? null,
      correlationId: params.correlationId ?? null,
      securityClassification: entry.classification,
      // The real reason, always. The audit trail never needs a second,
      // "what enforcement mode was active" column for THIS purpose — mode
      // is caller-side observability, not part of what happened.
      outcomeDetail,
    });
    return {
      allowed: false,
      requestId: params.requestId,
      action: params.action,
      classification: entry.classification,
      reasonCode,
      role,
      enforcementMode: mode,
    };
  };

  if (!role || !roleAtLeast(role, entry.minimumRole)) {
    return deny("role_not_permitted", "role_not_permitted");
  }

  if (entry.requiresStepUp) {
    if (params.assurance.state !== "VERIFIED") {
      return deny("step_up_not_configured", "step_up_not_configured");
    }
    if (!params.elevation.elevated) {
      return deny("step_up_not_elevated", "step_up_not_elevated");
    }
  }

  if (entry.requiresTwoPerson) {
    const status = await twoPersonStatus(admin, params.requestId);
    if (!status.satisfied) {
      // "awaiting_second_approval" is recorded for the ordinary pending
      // case; a rejection or expiry is not re-labelled as "still waiting" —
      // the audit trail should say which of the three actually happened.
      await recordPrivilegedActionEvent(admin, {
        requestId: params.requestId,
        event: status.reason === "rejected" ? "rejected" : "awaiting_second_approval",
        actorClerkUserId: params.actorClerkUserId,
        actionType: params.action,
        targetType: params.target.type,
        targetId: params.target.id ?? null,
        reasonCode: params.reasonCode ?? null,
        correlationId: params.correlationId ?? null,
        securityClassification: entry.classification,
        outcomeDetail: status.reason === "expired" ? "two_person_expired" : null,
      });
      return {
        allowed: false,
        requestId: params.requestId,
        action: params.action,
        classification: entry.classification,
        reasonCode:
          status.reason === "rejected"
            ? "two_person_rejected"
            : status.reason === "expired"
              ? "two_person_expired"
              : "awaiting_second_approval",
        role,
        enforcementMode: mode,
      };
    }
  }

  await recordPrivilegedActionEvent(admin, {
    requestId: params.requestId,
    event: "approved",
    actorClerkUserId: params.actorClerkUserId,
    actionType: params.action,
    targetType: params.target.type,
    targetId: params.target.id ?? null,
    reasonCode: params.reasonCode ?? null,
    correlationId: params.correlationId ?? null,
    securityClassification: entry.classification,
    outcomeDetail: "authorization_granted",
  });

  return {
    allowed: true,
    requestId: params.requestId,
    action: params.action,
    classification: entry.classification,
    reasonCode: "allowed",
    role,
    enforcementMode: mode,
  };
}

/**
 * PHASE 19 CLOSURE FIX. A pending two-person request older than this is
 * stale, not silently still open — the same reasoning
 * `ELEVATED_SESSION_TTL_SECONDS` (`step-up-auth.ts`) already applies to an
 * elevated session, applied here to a pending approval. Enforced entirely
 * in application code against `occurred_at`, which already exists on every
 * row — no new column, no migration.
 */
export const PRIVILEGED_ACTION_REQUEST_TTL_SECONDS = 900;

type TwoPersonStatus =
  | { readonly satisfied: true; readonly approvals: number }
  | { readonly satisfied: false; readonly reason: "awaiting_second_approval" | "rejected" | "expired"; readonly approvals: number };

/**
 * The real two-person state for `requestId`: satisfied at >= 2 DISTINCT
 * approvers (see the migration's dual-control mechanism), but a rejection
 * or an expired request window are terminal/stale states, never silently
 * folded into "still waiting".
 */
async function twoPersonStatus(admin: SupabaseClient, requestId: string): Promise<TwoPersonStatus> {
  const result = await queryPrivilegedActionAudit(admin, {});
  if (result.outcome !== "FOUND") {
    return { satisfied: false, reason: "awaiting_second_approval", approvals: 0 };
  }
  const rows = result.rows.filter((row) => row.requestId === requestId);

  if (rows.some((row) => (row.event as PrivilegedActionEvent) === "rejected")) {
    return { satisfied: false, reason: "rejected", approvals: 0 };
  }

  // `String(x ?? "")` rather than a bare `.localeCompare` — matches the
  // defensive pattern the fake harness's own RPC mock already uses for the
  // same column; a durable audit row's timestamp should never be trusted
  // present by type alone.
  const requested = [...rows]
    .filter((row) => (row.event as PrivilegedActionEvent) === "requested")
    .sort((a, b) => String(a.occurredAt ?? "").localeCompare(String(b.occurredAt ?? "")))[0];
  if (requested?.occurredAt) {
    const ageSeconds = (Date.now() - Date.parse(requested.occurredAt)) / 1000;
    if (Number.isFinite(ageSeconds) && ageSeconds > PRIVILEGED_ACTION_REQUEST_TTL_SECONDS) {
      return { satisfied: false, reason: "expired", approvals: 0 };
    }
  }

  const approvers = new Set(
    rows.filter((row) => (row.event as PrivilegedActionEvent) === "approved").map((row) => row.actorClerkUserId)
  );
  if (approvers.size >= 2) return { satisfied: true, approvals: approvers.size };
  return { satisfied: false, reason: "awaiting_second_approval", approvals: approvers.size };
}

/**
 * PHASE 19 CLOSURE FIX — the missing half of the dual-control mechanism.
 *
 * `authorizeTier0Action` records a "requested" event and, for a
 * `requiresTwoPerson` action, returns `awaiting_second_approval` with the
 * `requestId` it just recorded. Before this function existed there was no
 * real caller that let a SECOND, distinct admin ever satisfy that
 * request — `record_admin_privileged_action_approval` (the SQL RPC) was
 * real and tested, but nothing in the application called it. This is that
 * caller: a second admin submits a decision against an EXISTING
 * `requestId`, gated by the SAME role/step-up bar `authorizeTier0Action`
 * itself enforces (a `HIGH_RISK_TIER0` action's approver must clear the
 * same bar its requester did — approving is not a lesser act than
 * requesting). The requester-cannot-approve-their-own-request guarantee is
 * enforced structurally inside the RPC itself, not here.
 *
 * Rejection reuses the plain append-only event writer — no RPC needed,
 * since a rejection has no "distinct approver" invariant to protect.
 */
export type PrivilegedActionDecisionOutcome =
  | { readonly outcome: "INVALID_REQUEST" }
  | { readonly outcome: "UNKNOWN_ACTION" }
  | { readonly outcome: "ROLE_NOT_PERMITTED" }
  | { readonly outcome: "STEP_UP_REQUIRED"; readonly reasonCode: "step_up_not_configured" | "step_up_not_elevated" }
  | { readonly outcome: "SELF_APPROVAL_BLOCKED" }
  | { readonly outcome: "NO_MATCHING_REQUEST" }
  | { readonly outcome: "REQUEST_EXPIRED" }
  | { readonly outcome: "REJECTED" }
  | { readonly outcome: "APPROVAL_RECORDED"; readonly approvals: number; readonly required: number; readonly satisfied: boolean };

/** The original 'requested' event for `requestId`, or null if none exists. */
async function originalRequestFor(
  admin: SupabaseClient,
  requestId: string
): Promise<{ actionType: string; targetType: string; targetId: string | null; occurredAt: string | null } | null> {
  const result = await queryPrivilegedActionAudit(admin, {});
  if (result.outcome !== "FOUND") return null;
  const requested = result.rows
    .filter((row) => row.requestId === requestId && (row.event as PrivilegedActionEvent) === "requested")
    .sort((a, b) => String(a.occurredAt ?? "").localeCompare(String(b.occurredAt ?? "")))[0];
  if (!requested) return null;
  return {
    actionType: requested.actionType,
    targetType: requested.targetType,
    targetId: requested.targetId,
    occurredAt: requested.occurredAt ?? null,
  };
}

export async function decidePrivilegedAction(
  admin: SupabaseClient,
  params: {
    requestId: string;
    action: string;
    actorClerkUserId: string;
    target: { type: string; id?: string | null };
    decision: "approve" | "reject";
    reasonCode?: string | null;
    correlationId?: string | null;
    assurance: AssuranceEvidence;
    elevation: ElevationVerdict;
  }
): Promise<PrivilegedActionDecisionOutcome> {
  if (
    !REQUEST_ID_PATTERN.test(params.requestId) ||
    !ACTION_NAME_PATTERN.test(params.action) ||
    !isValidTarget(params.target)
  ) {
    return { outcome: "INVALID_REQUEST" };
  }

  const entry = tier0ActionEntry(params.action);
  if (!entry) return { outcome: "UNKNOWN_ACTION" };

  const role = resolveAdminPrivilegeRole(params.actorClerkUserId);
  if (!role || !roleAtLeast(role, entry.minimumRole)) {
    return { outcome: "ROLE_NOT_PERMITTED" };
  }
  if (entry.requiresStepUp) {
    if (params.assurance.state !== "VERIFIED") {
      return { outcome: "STEP_UP_REQUIRED", reasonCode: "step_up_not_configured" };
    }
    if (!params.elevation.elevated) {
      return { outcome: "STEP_UP_REQUIRED", reasonCode: "step_up_not_elevated" };
    }
  }

  // "Approval bound to action + target": `record_admin_privileged_action_
  // approval` (the SQL RPC) validates the requester by request_id alone —
  // it does not itself check that the action/target an approver names
  // still matches what was originally requested. A caller could otherwise
  // approve `route.disable` against a `requestId` that was actually
  // requested for `queue.dlq.redrive`. Checked here, in the one place both
  // decision branches (approve AND reject) pass through.
  const original = await originalRequestFor(admin, params.requestId);
  if (!original) return { outcome: "NO_MATCHING_REQUEST" };
  if (original.actionType !== params.action || original.targetType !== params.target.type || (original.targetId ?? null) !== (params.target.id ?? null)) {
    return { outcome: "NO_MATCHING_REQUEST" };
  }
  if (original.occurredAt) {
    const ageSeconds = (Date.now() - Date.parse(original.occurredAt)) / 1000;
    if (Number.isFinite(ageSeconds) && ageSeconds > PRIVILEGED_ACTION_REQUEST_TTL_SECONDS) {
      return { outcome: "REQUEST_EXPIRED" };
    }
  }

  if (params.decision === "reject") {
    await recordPrivilegedActionEvent(admin, {
      requestId: params.requestId,
      event: "rejected",
      actorClerkUserId: params.actorClerkUserId,
      actionType: params.action,
      targetType: params.target.type,
      targetId: params.target.id ?? null,
      reasonCode: params.reasonCode ?? null,
      correlationId: params.correlationId ?? null,
      securityClassification: entry.classification,
      outcomeDetail: "rejected_by_approver",
    });
    return { outcome: "REJECTED" };
  }

  const result = await recordPrivilegedActionApproval(admin, {
    requestId: params.requestId,
    actorClerkUserId: params.actorClerkUserId,
    actionType: params.action,
    targetType: params.target.type,
    targetId: params.target.id ?? null,
    reasonCode: params.reasonCode ?? null,
    correlationId: params.correlationId ?? null,
    securityClassification: entry.classification,
    requiredApprovals: 2,
  });
  if (!result.recorded) {
    return result.reason === "self_approval_blocked"
      ? { outcome: "SELF_APPROVAL_BLOCKED" }
      : { outcome: "NO_MATCHING_REQUEST" };
  }
  return {
    outcome: "APPROVAL_RECORDED",
    approvals: result.approvals,
    required: result.required,
    satisfied: result.satisfied,
  };
}

/**
 * Records the RESULT of actually invoking the canonical action owner. A
 * caller that received `{ allowed: true }` from `authorizeTier0Action` and
 * then called the real owner reports the outcome here — this is the ONLY
 * function in the Tier-0 authorization layer a caller invokes AFTER the
 * owner ran, and it never re-evaluates authorization; it only records what
 * happened.
 */
export async function recordTier0Execution(
  admin: SupabaseClient,
  params: {
    requestId: string;
    action: string;
    actorClerkUserId: string;
    target: { type: string; id?: string | null };
    outcome: "executed" | "execution_failed";
    correlationId?: string | null;
    outcomeDetail?: string | null;
  }
): Promise<void> {
  const entry = tier0ActionEntry(params.action);
  await recordPrivilegedActionEvent(admin, {
    requestId: params.requestId,
    event: params.outcome,
    actorClerkUserId: params.actorClerkUserId,
    actionType: params.action,
    targetType: params.target.type,
    targetId: params.target.id ?? null,
    correlationId: params.correlationId ?? null,
    securityClassification: entry?.classification ?? "HIGH_RISK_TIER0",
    outcomeDetail: params.outcomeDetail ?? null,
  });
}
