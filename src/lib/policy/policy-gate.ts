import "server-only";
import { evaluatePolicy, isWellFormedDecision } from "./policy-engine";
import {
  PolicyDenied,
  type PolicyDecision,
  type PolicyInput,
} from "./policy-contract";
import { reportPolicyDecision } from "@/lib/security/security-signals";
import { isTemporarilyBlocked } from "@/lib/security/security-event-logger";
import { currentTraceId } from "@/lib/observability/trace-scope";

/**
 * The enforcement point (Phase 12-E).
 *
 * Roadmap ¶1649 is the acceptance test: "Kritik action policy sonucu olmadan
 * çalışmıyor" — a critical action does not run without a policy result. Every
 * gated function's FIRST statement is `await requirePolicy(...)`, which either
 * returns an ALLOW or throws. There is no variant that returns a boolean,
 * because a boolean is something a caller can forget to check.
 *
 * ---------------------------------------------------------------------------
 * FAIL CLOSED, INCLUDING WHEN THE GATE ITSELF BREAKS
 * ---------------------------------------------------------------------------
 * A thrown evaluator, a malformed decision, an unreadable registry — all of
 * them produce a DENY, not an exception the caller might catch and continue
 * past. The only way out of this function without an exception is a
 * well-formed ALLOW.
 *
 * That is the opposite of the 12-C logger's contract, and deliberately so.
 * 12-C records something that ALREADY happened, so its failure must not
 * change the outcome. This decides whether something happens at all, so its
 * failure must.
 *
 * ---------------------------------------------------------------------------
 * WHAT AN ALLOW DOES NOT MEAN
 * ---------------------------------------------------------------------------
 * It means policy raises no objection. It does not satisfy the two-person
 * threshold, it does not satisfy moderation, and it does not create
 * authorization the caller did not already have — every gated function keeps
 * its own `assertRouteAdmin`, its own SQL predicates, and its own approval
 * primary key. The gate is an additional condition, never a replacement for
 * one.
 */

export interface GateContext {
  action: string;
  actor: PolicyInput["actor"];
  tenantId?: string | null;
  resource?: { type: string; id?: string | null };
  /**
   * Evidence a human approved, resolved from durable state by the caller.
   * Absent means not approved — never "assume yes".
   */
  approvalEvidence?: { humanApproved: boolean };
  correlationId?: string | null;
}

/** The environment, read once from the server's own configuration. */
function currentEnvironment(): PolicyInput["environment"] {
  const raw = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (raw === "production") return "production";
  if (raw === "preview") return "preview";
  return "development";
}

/**
 * Builds the policy input from SERVER state only.
 *
 * Nothing a client sends reaches this function. `originClass` is hard-coded
 * to `"server"` here because `requirePolicy` is only callable from server
 * modules; a future route that forwards a user action must pass through a
 * different builder that declares itself, rather than inheriting this one's
 * trust. The risk state is fetched, not accepted.
 */
async function buildInput(ctx: GateContext): Promise<PolicyInput> {
  const subject = ctx.actor.id;

  // Read from Redis/PostgreSQL. A caller cannot assert its own block state,
  // which is the difference between a risk input and a risk claim.
  const temporarilyBlocked = await isTemporarilyBlocked(subject);

  return {
    action: ctx.action,
    actor: ctx.actor,
    tenantId: ctx.tenantId ?? null,
    resource: { type: ctx.resource?.type ?? "unspecified", id: ctx.resource?.id ?? null },
    risk: {
      temporarilyBlocked,
      // Phase 12-C records `admin_review` and `challenge` as RECOMMENDATIONS
      // on evidence rows; no durable per-subject flag exists yet, and there
      // is no honest way to derive one from a recommendation. Reporting false
      // here would be a lie, so instead these stay false and the fact is
      // recorded: the gate reads what exists rather than inventing what does
      // not. Phase 16 owns the review state that makes them meaningful.
      adminReviewRequired: false,
      challengeRequired: false,
    },
    approvalEvidence: { humanApproved: ctx.approvalEvidence?.humanApproved === true },
    environment: currentEnvironment(),
    originClass: "server",
    // ---- PHASE 13-A: correlationId converges on traceId ------------------
    //
    // Two names existed for one concept — `traceId` on the command wire and
    // the outbox, `correlationId` here and in 12-E's decision log. They are
    // now the same value: the ambient trace, unless a caller supplied its own.
    //
    // The FIELD NAMES stay as they are. Renaming `correlationId` would touch
    // 12-E's contract and its recorded decisions, and historical evidence is
    // not rewritten to tidy a name. New readers can rely on the values
    // matching; `telemetry-contract.ts` documents the relationship.
    correlationId: ctx.correlationId ?? currentTraceId() ?? null,
  };
}

/**
 * Evaluates, records, and either returns an ALLOW or throws.
 *
 * The evidence is emitted for EVERY decision, allow included. A decision log
 * that only holds refusals cannot answer "who released that asset, and under
 * which policy version" — which is the question an incident actually asks.
 */
export async function requirePolicy(ctx: GateContext): Promise<PolicyDecision> {
  let decision: PolicyDecision;

  try {
    const input = await buildInput(ctx);
    const raw = evaluatePolicy(input);
    decision = isWellFormedDecision(raw)
      ? raw
      : // An evaluator that returns something unrecognisable is a broken
        // evaluator, and a broken evaluator must not be able to produce an
        // ALLOW by accident.
        { decision: "DENY", reason: "malformed_decision", policyVersion: "unknown", engine: "embedded" };
  } catch {
    // Includes a failure to resolve risk state. Unknown block status is not
    // "unblocked" when a critical action is at stake — note that this is a
    // deliberately different answer from `isTemporarilyBlocked`, which fails
    // open because it also guards ordinary product paths where locking every
    // user out during a Redis outage would be the worse harm.
    decision = {
      decision: "DENY",
      reason: "policy_evaluation_failed",
      policyVersion: "unknown",
      engine: "embedded",
    };
  }

  reportPolicyDecision({
    action: ctx.action,
    decision: decision.decision,
    reason: decision.reason,
    policyVersion: decision.policyVersion,
    actorId: ctx.actor.id,
    actorKind: ctx.actor.kind,
    tenantId: ctx.tenantId ?? null,
    resourceType: ctx.resource?.type ?? null,
    resourceId: ctx.resource?.id ?? null,
    // Same convergence as the policy input above — otherwise the decision the
    // engine saw and the decision the log records would carry different
    // correlation values, which is worse than carrying none.
    correlationId: ctx.correlationId ?? currentTraceId() ?? null,
  });

  if (decision.decision !== "ALLOW") throw new PolicyDenied(decision);
  return decision;
}

/**
 * The AI/MCP write boundary (roadmap ¶1856).
 *
 * A separate entry point rather than a flag on `requirePolicy`, so that
 * "an agent is asking" is a different call site a reviewer can grep for,
 * and so no human path can accidentally acquire agent semantics by passing
 * the wrong argument.
 *
 * There is no code in this repository that calls it yet — no MCP write
 * surface exists. That is the correct state: the guardrail lands before the
 * capability, not after. `aiWriteAllowlist` is empty, so every action denies,
 * and a Rego test fails if someone adds an entry without meaning to.
 */
export async function requireAiWritePolicy(
  ctx: Omit<GateContext, "actor"> & { agentId: string }
): Promise<PolicyDecision> {
  return requirePolicy({
    ...ctx,
    actor: { id: ctx.agentId, role: "ai_agent", kind: "ai_agent" },
  });
}
