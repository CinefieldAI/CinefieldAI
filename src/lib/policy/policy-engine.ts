import registry from "../../../policies/data/actions.json";
import {
  POLICY_DECISIONS,
  POLICY_REASON_CODE,
  type PolicyDecision,
  type PolicyDecisionValue,
  type PolicyInput,
} from "./policy-contract";

/**
 * The policy decision point (Phase 12-E).
 *
 * ---------------------------------------------------------------------------
 * THE REGO IS THE SPECIFICATION; THIS IS AN IMPLEMENTATION OF IT
 * ---------------------------------------------------------------------------
 * `policies/cinefield/policy.rego` is the normative policy. The ladder below
 * implements exactly its rules, in exactly its order, over exactly its data
 * document — `policies/data/actions.json` is imported here and loaded by OPA
 * there, so the ACTION REGISTRY has one definition rather than two.
 *
 * The rules are bound to the Rego by `policies/conformance/cases.json`:
 * `policy_test.rego` iterates it under `opa test`, and
 * `policy-engine.test.ts` iterates the same file under `npm test`. A rule
 * that drifts fails one of the two runs. Adding a case extends both suites at
 * once.
 *
 * WHY NOT EVALUATE REGO AT RUNTIME TODAY. The roadmap places full OPA among
 * the scale-triggered layers (¶416, ¶3734, ¶3766) and gives Phase 19 the
 * explicit task of standing up the OPA service/sidecar (¶2272). Beyond
 * following that, a sidecar would make every critical action depend on a
 * second process being alive — and for a fail-closed gate that means an
 * outage in the policy process stops quarantine handling entirely. An
 * embedded evaluator has no such failure mode: it is available exactly when
 * the application is.
 *
 * The engine name travels in every decision, so when Phase 19 swaps this for
 * an OPA bundle the change is visible in the decision log rather than
 * something you infer from deploy timestamps.
 *
 * ---------------------------------------------------------------------------
 * IT DECIDES. IT DOES NOT ACT.
 * ---------------------------------------------------------------------------
 * This module imports the registry and its own contract, and nothing else. It
 * cannot release quarantine, move a credit, submit to a provider, cancel a
 * workflow, block a user or approve anything — and the import list is the
 * proof, the same argument the Risk Engine makes.
 */

interface ActionRule {
  critical: boolean;
  requiredRoles: string[];
  requiresTwoPerson: boolean;
  requiresHumanApproval: boolean;
  implemented: boolean;
  owner: string;
}

interface Registry {
  policyVersion: string;
  environments: string[];
  roles: string[];
  aiWriteAllowlist: string[];
  actions: Record<string, ActionRule>;
}

const POLICY: Registry = registry as Registry;

export const POLICY_VERSION = POLICY.policyVersion;

/** Every action the gate knows. Anything outside it is denied. */
export function registeredActions(): string[] {
  return Object.keys(POLICY.actions).sort();
}

export function actionRule(action: string): ActionRule | null {
  return Object.prototype.hasOwnProperty.call(POLICY.actions, action)
    ? POLICY.actions[action]
    : null;
}

/**
 * A registry entry that is not fully specified is worse than a missing one:
 * an absent `implemented` reads as "not false", skips the not-implemented
 * rule, and falls through to an ALLOW nobody intended. Validated once at
 * module load so a malformed registry fails the process, the test run and the
 * build — never a request.
 */
function validateRegistry(): void {
  if (typeof POLICY.policyVersion !== "string" || POLICY.policyVersion.length === 0) {
    throw new Error("policy-engine: registry has no policyVersion");
  }
  for (const [name, rule] of Object.entries(POLICY.actions)) {
    const shaped =
      typeof rule.critical === "boolean" &&
      typeof rule.implemented === "boolean" &&
      typeof rule.requiresTwoPerson === "boolean" &&
      typeof rule.requiresHumanApproval === "boolean" &&
      Array.isArray(rule.requiredRoles) &&
      rule.requiredRoles.length > 0 &&
      typeof rule.owner === "string";
    if (!shaped) throw new Error(`policy-engine: action "${name}" is not fully specified`);
    if (!rule.critical) throw new Error(`policy-engine: action "${name}" is not critical`);
    for (const role of rule.requiredRoles) {
      if (!POLICY.roles.includes(role)) {
        throw new Error(`policy-engine: action "${name}" requires unknown role "${role}"`);
      }
    }
  }
}

validateRegistry();

function decide(decision: PolicyDecisionValue, reason: string): PolicyDecision {
  return { decision, reason, policyVersion: POLICY_VERSION, engine: "embedded" };
}

const DENY_MALFORMED = "malformed_input";

/**
 * Evaluates one critical action.
 *
 * The ladder mirrors `policy.rego` line for line, and the ORDER is part of the
 * contract, not an implementation detail — several conformance cases exist
 * only to pin precedence. Two orderings in particular are load-bearing:
 *
 *   - `untrusted_origin` is checked BEFORE the AI rule, so a browser-driven
 *     agent is refused as a browser. The origin is the stronger fact.
 *   - the AI rule is checked BEFORE the role check, so an agent operating
 *     under a borrowed admin role cannot satisfy its way past the guardrail.
 */
export function evaluatePolicy(input: unknown): PolicyDecision {
  // Anything that is not the declared shape is denied before a rule can read
  // a field off it. A policy engine that throws on bad input hands its caller
  // an exception to catch and possibly swallow; returning a DENY cannot be
  // mistaken for anything else.
  if (!isPolicyInputShape(input)) return decide("DENY", DENY_MALFORMED);
  const i = input;

  // 1. Structural refusals.
  const rule = actionRule(i.action);
  if (!rule) return decide("DENY", "unknown_action");
  if (!rule.implemented) return decide("DENY", "not_implemented");
  if (!validActor(i)) return decide("DENY", "unknown_subject");
  if (!POLICY.environments.includes(i.environment)) {
    return decide("DENY", "unsupported_environment");
  }
  if (i.originClass !== "server") return decide("DENY", "untrusted_origin");

  // 2. AI / MCP write authority — off, and off before anything can grant.
  //    Roadmap ¶1856: MCP connections start READ-ONLY; a write goes
  //    AI suggestion -> policy -> human approval -> protected workflow, and
  //    that order is never skipped for incident urgency. ¶1854: a tool-level
  //    allowlist is mandatory and no general authority is ever granted.
  if (i.actor.kind === "ai_agent") {
    if (!POLICY.aiWriteAllowlist.includes(i.action)) {
      return decide("DENY", "ai_write_authority_off");
    }
    if (!i.approvalEvidence.humanApproved) {
      return decide("REQUIRE_APPROVAL", "ai_write_needs_human_approval");
    }
  }

  // 3. Authorization.
  if (!rule.requiredRoles.includes(i.actor.role)) {
    return decide("DENY", "role_not_permitted");
  }

  // 4. Risk state from Phase 12-C. Conclusions only, resolved server-side by
  //    the caller — never a browser claim, and never re-scored here.
  if (i.risk.temporarilyBlocked) return decide("DENY", "subject_temporarily_blocked");
  if (i.risk.adminReviewRequired) {
    return decide("REQUIRE_ADMIN_REVIEW", "risk_admin_review_required");
  }
  if (i.risk.challengeRequired) return decide("REQUIRE_CHALLENGE", "risk_challenge_required");

  // 5. Human approval. Policy BLOCKS until evidence exists; it never performs
  //    the approval, and Phase 16 owns the workflow that produces the
  //    evidence.
  if (rule.requiresHumanApproval && !i.approvalEvidence.humanApproved) {
    return decide("REQUIRE_APPROVAL", "human_approval_required");
  }

  // 6. Allow. For a two-person action this means "policy raises no
  //    objection" and NOT "the action may proceed" — the threshold is
  //    enforced by a primary key inside the SQL transaction, which is the
  //    only place it can be enforced correctly. The distinct reason code
  //    exists so a reader of the decision log cannot mistake one for the
  //    other.
  return rule.requiresTwoPerson
    ? decide("ALLOW", "allowed_two_person_enforced_downstream")
    : decide("ALLOW", "allowed");
}

function validActor(i: PolicyInput): boolean {
  return (
    typeof i.actor.id === "string" &&
    i.actor.id.length > 0 &&
    POLICY.roles.includes(i.actor.role)
  );
}

/**
 * Shape validation, not sanitisation.
 *
 * A missing risk flag is NOT defaulted to `false`. Defaulting would mean a
 * caller who forgot to resolve the block state gets treated as unblocked,
 * which is the exact fail-open this gate exists to prevent — so an incomplete
 * input is refused and the caller has to say what it means.
 */
function isPolicyInputShape(value: unknown): value is PolicyInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (typeof v.action !== "string") return false;

  const actor = v.actor as Record<string, unknown> | undefined;
  if (!actor || typeof actor.id !== "string" || typeof actor.role !== "string") return false;
  if (actor.kind !== "human" && actor.kind !== "service" && actor.kind !== "ai_agent") return false;

  const risk = v.risk as Record<string, unknown> | undefined;
  if (
    !risk ||
    typeof risk.temporarilyBlocked !== "boolean" ||
    typeof risk.adminReviewRequired !== "boolean" ||
    typeof risk.challengeRequired !== "boolean"
  ) {
    return false;
  }

  const approval = v.approvalEvidence as Record<string, unknown> | undefined;
  if (!approval || typeof approval.humanApproved !== "boolean") return false;

  if (typeof v.environment !== "string" || typeof v.originClass !== "string") return false;

  const resource = v.resource as Record<string, unknown> | undefined;
  if (!resource || typeof resource.type !== "string") return false;

  return true;
}

/**
 * Guards a decision that arrived from somewhere else.
 *
 * Phase 19 will feed decisions from an OPA bundle. An engine returning an
 * unrecognised decision string, a reason that is not a short code, or no
 * version must not be able to produce anything a caller reads as ALLOW.
 */
export function isWellFormedDecision(value: unknown): value is PolicyDecision {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.decision === "string" &&
    POLICY_DECISIONS.has(d.decision) &&
    typeof d.reason === "string" &&
    POLICY_REASON_CODE.test(d.reason) &&
    typeof d.policyVersion === "string" &&
    d.policyVersion.length > 0
  );
}
