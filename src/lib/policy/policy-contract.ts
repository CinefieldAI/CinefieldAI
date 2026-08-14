/**
 * The policy decision contract (Phase 12-E).
 *
 * Roadmap ¶1648 asks for an OPA/Rego policy gate; ¶1649 sets the acceptance
 * test — "Kritik action policy sonucu olmadan çalışmıyor", a critical action
 * does not run without a policy result. This file is the boundary that makes
 * that statement checkable: one input shape, one output shape, both closed.
 *
 * ---------------------------------------------------------------------------
 * THE INPUT IS AN ALLOWLIST, NOT A CONTEXT BAG
 * ---------------------------------------------------------------------------
 * Every field below is named, bounded, and server-derived. There is no
 * `metadata`, no `payload`, no `request`, and no index signature — so a
 * caller cannot pass the raw body "just in case the policy needs it", and a
 * policy cannot start depending on a field nobody reviewed.
 *
 * That matters more here than in most places. A policy input travels into a
 * decision log, and a decision log is read by people during incidents; the
 * fastest way to put a prompt, a signed URL or a provider key somewhere it
 * will be screenshotted is to let an evaluator accept arbitrary objects.
 *
 * ---------------------------------------------------------------------------
 * THE OUTPUT IS A DECISION, NOT ADVICE
 * ---------------------------------------------------------------------------
 * Five values, a bounded reason code, and the policy version that produced
 * them. No free text is ever used as authority: a caller branches on
 * `decision` and nothing else, and `reason` exists to be logged and shown, not
 * parsed.
 */

/** Who is asking. `kind` is separate from `role` on purpose — see below. */
export type ActorKind = "human" | "service" | "ai_agent";

/**
 * The role vocabulary, mirroring `policies/data/actions.json`.
 *
 * `ai_agent` appears in BOTH `kind` and `role` because they answer different
 * questions: `role` is what an identity is permitted to be, `kind` is what is
 * actually driving the call. An agent operating under a borrowed admin role
 * is still an agent, and the policy checks `kind` before it checks `role`
 * precisely so that borrowing cannot help.
 */
export type ActorRole = "service" | "route_admin" | "member" | "anonymous" | "ai_agent";

export type Environment = "development" | "preview" | "production";

/**
 * Where the call came from, as classified by the SERVER that built the input.
 *
 * Not a header, not a body field, not anything a client can set. Only
 * `"server"` may drive a critical action; `"browser"` exists so that a future
 * route which forwards a user action has to declare what it is rather than
 * look like an internal call.
 */
export type OriginClass = "server" | "browser" | "worker" | "unknown";

/**
 * Risk state, read from Phase 12-C.
 *
 * The Risk Engine's CONCLUSIONS, never its inputs and never its score. The
 * two components stay separate: policy asks "is this subject currently
 * blocked / flagged?" and does no scoring of its own. Every field must be
 * resolved from Redis or PostgreSQL by the caller — a browser-supplied risk
 * state would let a caller declare itself unblocked.
 */
export interface PolicyRiskState {
  temporarilyBlocked: boolean;
  adminReviewRequired: boolean;
  challengeRequired: boolean;
}

/**
 * Evidence that a human has approved, assembled from durable state.
 *
 * Booleans only, and deliberately not "who". The policy gate needs to know
 * THAT an approval exists; storing who approved it in a second place is how
 * approver identities leak, and `media_release_approvals` already holds them
 * behind service_role.
 */
export interface PolicyApprovalEvidence {
  humanApproved: boolean;
}

export interface PolicyInput {
  /** A registered action name. Anything else is denied. */
  action: string;
  actor: {
    /** Server-verified. A Clerk user id, or a named service identity. */
    id: string;
    role: ActorRole;
    kind: ActorKind;
  };
  /** The tenant the action affects. Server-resolved. */
  tenantId: string | null;
  /** What is being acted on. An opaque id and a short type — never a URL. */
  resource: { type: string; id: string | null };
  risk: PolicyRiskState;
  approvalEvidence: PolicyApprovalEvidence;
  environment: Environment;
  originClass: OriginClass;
  /** For joining a decision to the request that caused it. */
  correlationId: string | null;
}

export type PolicyDecisionValue =
  | "ALLOW"
  | "DENY"
  | "REQUIRE_APPROVAL"
  | "REQUIRE_CHALLENGE"
  | "REQUIRE_ADMIN_REVIEW";

/** Short codes only, matching the same discipline as security reason codes. */
export const POLICY_REASON_CODE = /^[a-z][a-z0-9_]{1,64}$/;

export interface PolicyDecision {
  decision: PolicyDecisionValue;
  reason: string;
  /**
   * Which policy produced this. Roadmap ¶1852 wants policy version in the
   * audit trail, and ¶2284 wants decisions written to a decision log; without
   * a version a log entry cannot be reproduced six months later, and policy
   * drift becomes silent.
   */
  policyVersion: string;
  /**
   * Which engine decided. Phase 19 replaces the embedded evaluator with an
   * OPA bundle; recording the engine means the switch is visible in the log
   * rather than something you have to infer from deploy dates.
   */
  engine: "embedded" | "opa-wasm";
}

/** The closed decision set, for validating anything an evaluator returns. */
export const POLICY_DECISIONS: ReadonlySet<string> = new Set<PolicyDecisionValue>([
  "ALLOW",
  "DENY",
  "REQUIRE_APPROVAL",
  "REQUIRE_CHALLENGE",
  "REQUIRE_ADMIN_REVIEW",
]);

/** Only ALLOW permits a mutation. Everything else stops the caller. */
export function isAllowed(decision: PolicyDecision): boolean {
  return decision.decision === "ALLOW";
}

/**
 * The typed refusal a gated action throws.
 *
 * Carries the decision and a short reason and nothing else. A caller
 * rendering this must not be able to leak the rule that fired or the risk
 * state behind it — the same argument as the 12-C notification payload: a
 * refusal that explains the boundary teaches how to sit just inside it.
 */
export class PolicyDenied extends Error {
  readonly decision: PolicyDecisionValue;
  readonly reason: string;
  readonly policyVersion: string;

  constructor(decision: PolicyDecision) {
    super(`policy_${decision.decision.toLowerCase()}`);
    this.name = "PolicyDenied";
    this.decision = decision.decision;
    this.reason = decision.reason;
    this.policyVersion = decision.policyVersion;
  }
}
