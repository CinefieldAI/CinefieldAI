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
 * WHAT THIS IS, PRECISELY (Section 18/27 of the 16-E spec)
 * ---------------------------------------------------------------------------
 * `authorizeTier0Action` implements the chain the spec's DONE CRITERION
 * describes: given an action attempt, it identifies the action's risk
 * (`tier0-action-catalogue.ts`), checks the actor's privilege tier
 * (`admin-privilege.ts`), checks step-up assurance where the catalogue
 * requires it (`step-up-auth.ts`'s evidence, resolved by the CALLER — this
 * function never talks to Clerk or Redis itself, so it stays testable
 * without either), checks dual control where required, and produces bounded
 * durable audit evidence for every branch — allowed and denied alike.
 *
 * It NEVER invokes the canonical action. Section 19 is absolute: DLQ
 * redrive, BullMQ retry, route enable/disable, quarantine release, Temporal
 * cancel keep their existing, unmodified owners. A caller that receives
 * `{ allowed: true }` from this function still has to call that owner
 * itself, and — on success — call `recordTier0Execution` so the 'executed'
 * event exists. A decision here that is never followed by an execution
 * event is honestly visible in the audit trail as exactly that: requested,
 * allowed, never executed.
 *
 * ---------------------------------------------------------------------------
 * ENFORCEMENT MODE — WHY THIS CAN RETURN `allowed: true` IN SHADOW MODE
 * EVEN WHEN THE UNDERLYING CHECK FAILED
 * ---------------------------------------------------------------------------
 * `CINEFIELD_TIER0_ENFORCEMENT_MODE` (env, default unset = "shadow") governs
 * whether a real DENY here actually blocks a caller. This exists because
 * step-up assurance is honestly `NOT_CONFIGURED` in every environment today
 * (Section 8 — no Clerk MFA/passkey configuration exists in this
 * repository) — hard-enforcing `requiresStepUp` today would make DLQ
 * redrive, BullMQ retry, route disable and Temporal cancel permanently
 * unusable for every admin until an operator explicitly configures Clerk
 * assurance externally. That is arguably the intended end-state of Tier-0
 * hardening, but flipping four already-shipped, already-audited (Phase
 * 16-B/16-D) admin actions to hard-fail in every environment — including
 * this one, mid-development, with no external config path available yet —
 * is a consequential operational decision this batch does not make
 * unilaterally. So: `authorizeTier0Action` ALWAYS evaluates the real
 * decision and ALWAYS writes the real durable evidence (a shadow-mode
 * caller can see in the audit trail exactly which of its calls WOULD have
 * been denied), and only actually returns `allowed: false` to a "shadow"
 * caller when the underlying denial reason is `unknown_action` (a
 * programming error, never something enforcement-mode should paper over).
 * Every wired call site (`dlq-admin-service.ts`,
 * `bullmq-admin-service.ts`, `router-admin-service.ts`,
 * `temporal-admin-service.ts`) reads `params.enforce` from this same env var
 * — setting `CINEFIELD_TIER0_ENFORCEMENT_MODE=enforce` makes every one of
 * them start hard-denying Tier-0 actions without step-up assurance, with NO
 * further code change, and `phase-16e-tier0-authorization.e2e.test.ts`
 * proves both modes against the same production function.
 */

export function tier0EnforcementModeEnabled(rawEnv: string | undefined = process.env.CINEFIELD_TIER0_ENFORCEMENT_MODE): boolean {
  return rawEnv === "enforce";
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
  | "allowed"
  | "allowed_shadow_mode";

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
  /** Defaults to `tier0EnforcementModeEnabled()`; overridable for tests. */
  enforce?: boolean;
}

export interface Tier0Decision {
  readonly allowed: boolean;
  readonly requestId: string;
  readonly action: string;
  readonly classification: Tier0SecurityClassification | null;
  readonly reasonCode: Tier0DecisionReasonCode;
  readonly role: AdminPrivilegeRole | null;
  readonly enforced: boolean;
}

function isValidTarget(target: { type: string; id?: string | null }): boolean {
  return typeof target?.type === "string" && /^[a-z][a-z0-9_]{1,64}$/.test(target.type);
}

/**
 * The decision point. See this file's header for the enforcement-mode
 * semantics and Section 19's "never invokes the owner" boundary.
 */
export async function authorizeTier0Action(
  admin: SupabaseClient,
  params: Tier0AuthorizationParams
): Promise<Tier0Decision> {
  const enforce = params.enforce ?? tier0EnforcementModeEnabled();

  if (!REQUEST_ID_PATTERN.test(params.requestId) || !ACTION_NAME_PATTERN.test(params.action) || !isValidTarget(params.target)) {
    return {
      allowed: false,
      requestId: params.requestId,
      action: params.action,
      classification: null,
      reasonCode: "invalid_request_id",
      role: null,
      enforced: true,
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
      enforced: true,
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
      // The REAL reason is always recorded, enforced or not — shadow mode
      // changes what a caller does with the decision, never what the audit
      // trail says happened. A reader of the durable evidence can always
      // tell exactly which denials WOULD have blocked something once
      // enforcement is switched on.
      outcomeDetail,
    });
    return {
      allowed: !enforce,
      requestId: params.requestId,
      action: params.action,
      classification: entry.classification,
      reasonCode: enforce ? reasonCode : "allowed_shadow_mode",
      role,
      enforced: enforce,
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
        allowed: !enforce,
        requestId: params.requestId,
        action: params.action,
        classification: entry.classification,
        reasonCode: enforce ? "awaiting_second_approval" : "allowed_shadow_mode",
        role,
        enforced: enforce,
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
    enforced: enforce,
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
