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
    const satisfied = await isTwoPersonSatisfied(admin, params.requestId);
    if (!satisfied) {
      await recordPrivilegedActionEvent(admin, {
        requestId: params.requestId,
        event: "awaiting_second_approval",
        actorClerkUserId: params.actorClerkUserId,
        actionType: params.action,
        targetType: params.target.type,
        targetId: params.target.id ?? null,
        reasonCode: params.reasonCode ?? null,
        correlationId: params.correlationId ?? null,
        securityClassification: entry.classification,
      });
      return {
        allowed: false,
        requestId: params.requestId,
        action: params.action,
        classification: entry.classification,
        reasonCode: "awaiting_second_approval",
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

/** Distinct-approver count for `requestId`, satisfied at >= 2 (see the migration's dual-control mechanism). */
async function isTwoPersonSatisfied(admin: SupabaseClient, requestId: string): Promise<boolean> {
  const result = await queryPrivilegedActionAudit(admin, {});
  if (result.outcome !== "FOUND") return false;
  const approvers = new Set(
    result.rows
      .filter((row) => row.requestId === requestId && (row.event as PrivilegedActionEvent) === "approved")
      .map((row) => row.actorClerkUserId)
  );
  return approvers.size >= 2;
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
