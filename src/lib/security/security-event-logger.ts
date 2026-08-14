import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  KIND_SEVERITY,
  KIND_SUBJECT_IS_ACTOR,
  KIND_WINDOW_SECONDS,
  dedupeKeyFor,
  validateSecurityEvent,
  type RiskAction,
  type SecurityEventInput,
} from "./security-event-contract";
import { assessRisk, enforceability, TEMPORARY_BLOCK_TTL_SECONDS } from "./risk-engine";
import { getRedisClient } from "@/lib/redis/redis-client";
import { evaluatePolicy } from "@/lib/policy/policy-engine";

/**
 * The Security Event Logger (Phase 12-C).
 *
 * One writer. Every security signal in the system arrives here, is validated
 * against the taxonomy, is scored, and is written as append-only evidence in
 * PostgreSQL. Redis holds enforcement state with a TTL; **PostgreSQL is the
 * durable record** and Redis is never the source of truth for what happened.
 *
 * ---------------------------------------------------------------------------
 * LOGGING FAILURE MUST NEVER REOPEN A CLOSED DOOR
 * ---------------------------------------------------------------------------
 * Every function here returns a result and throws nothing at its callers. A
 * rate-limit denial, an SSRF block, a connection refusal — each has ALREADY
 * happened by the time this is called. If the database is down, the correct
 * outcome is a lost log line, never an admitted request. So the observers that
 * feed this are fire-and-forget by construction, and a caller cannot
 * accidentally make a refusal depend on a write succeeding.
 *
 * ---------------------------------------------------------------------------
 * IT RECORDS AND RECOMMENDS. IT DOES NOT ACT.
 * ---------------------------------------------------------------------------
 * The only side effects are: one append-only row, optionally one outbox event
 * for a user-facing warning, and optionally one TTL key marking a temporary
 * block. It cannot create a generation, cancel one, move credits, release
 * quarantine, override moderation or submit to a provider, and it imports
 * nothing that could.
 */

export interface RecordResult {
  recorded: boolean;
  /** Absent when storm control coalesced the signal into an existing window. */
  eventId?: string;
  score?: number;
  action?: RiskAction;
  /** Set when the recommended action cannot be enforced yet — see risk-engine. */
  degradedTo?: RiskAction;
  reason?: "coalesced" | "invalid" | "unavailable";
}

/**
 * Records one signal, scores it, and applies the bounded consequences.
 *
 * Order matters: recurrence is read BEFORE the row is written, so this
 * occurrence's own row cannot inflate its own score.
 */
export async function recordSecurityEvent(
  admin: SupabaseClient,
  input: SecurityEventInput
): Promise<RecordResult> {
  const validation = validateSecurityEvent(input);
  if (!validation.ok) {
    // An invalid signal is a programming error in the caller, not an incident.
    // It is refused rather than coerced into the taxonomy, because a
    // mislabelled security event is worse than a missing one.
    return { recorded: false, reason: "invalid" };
  }

  const dedupeKey = dedupeKeyFor(input);
  const severity = KIND_SEVERITY[input.kind];
  const windowSeconds = KIND_WINDOW_SECONDS[input.kind];

  try {
    const { data: recurrenceData } = await admin.rpc("security_event_recurrence", {
      p_dedupe_key: dedupeKey,
      p_lookback_seconds: 900,
    });
    const priorWindows = typeof recurrenceData === "number" ? recurrenceData : 0;

    const decision = assessRisk({
      kind: input.kind,
      // This occurrence included: a first-ever signal is one window, not zero.
      recurrenceWindows: priorWindows + 1,
      authenticated: Boolean(input.actorClerkUserId),
    });

    const enforce = enforceability(decision.action);
    const effective = enforce.enforceable ? enforce.action : enforce.degradedTo;

    // WHO GETS TOLD.
    //
    // A warning reaches the user through the EXISTING Phase 11 path — outbox,
    // dispatcher, Redis Streams, SSE. Never a direct publish from here: the
    // dispatcher owns that arrow and a second one would be a second thing to
    // get wrong.
    //
    // Told when something was done TO them and they caused it: a warning, or
    // a temporary block they are entitled to know about rather than discover
    // as an unexplained failure.
    //
    // NOT told when the subject is merely the context. An `admin_review` on a
    // provider's bad URL is not this account's business, and a notification
    // saying otherwise would be both alarming and false.
    const userIsAffected = KIND_SUBJECT_IS_ACTOR[input.kind] && Boolean(input.tenantId);
    const emitWarning = userIsAffected && (effective === "warning" || effective === "temporary_block");

    const { data, error } = await admin.rpc("record_security_event", {
      p_kind: input.kind,
      p_severity: severity,
      p_source: input.source,
      p_reason_code: input.reasonCode,
      p_dedupe_key: dedupeKey,
      p_window_seconds: windowSeconds,
      p_actor: input.actorClerkUserId ?? null,
      p_tenant_id: input.tenantId ?? null,
      p_subject_hash: input.subjectHash ?? null,
      p_resource_type: input.resourceType ?? null,
      p_resource_id: input.resourceId ?? null,
      p_trace_id: input.traceId ?? null,
      p_risk_score: decision.score,
      p_recommended_action: decision.action,
      p_emit_warning: emitWarning,
      // Phase 12-E. Null for every kind except the two policy decisions.
      p_policy_version: input.policyVersion ?? null,
    });

    if (error) return { recorded: false, reason: "unavailable" };

    const result = data as { recorded: boolean; event_id?: string; reason?: string } | null;
    if (!result?.recorded) {
      return { recorded: false, reason: "coalesced", score: decision.score, action: decision.action };
    }

    // A block is enforcement state, not evidence: bounded, automatic expiry,
    // and the durable record of WHY is the row that was just written.
    //
    // `admin_review` deliberately does nothing here. It is a REQUEST, and the
    // request IS the row: `recommended_action = 'admin_review'` is queryable
    // the moment Phase 16 exists. Building a queue, a notification or an
    // operator action now would be implementing Phase 16 under another name,
    // and an operator surface nobody has reviewed is worse than none.
    if (effective === "temporary_block") {
      await applyTemporaryBlock(admin, input.actorClerkUserId ?? input.subjectHash ?? null, input.traceId ?? null);
    }

    return {
      recorded: true,
      eventId: result.event_id,
      score: decision.score,
      action: decision.action,
      ...(enforce.enforceable ? {} : { degradedTo: enforce.degradedTo }),
    };
  } catch {
    // Class only. Never the input, which carries identifiers.
    return { recorded: false, reason: "unavailable" };
  }
}

const BLOCK_KEY_PREFIX = "cinefield:v1:security:block";

/**
 * Marks a subject blocked for a bounded time.
 *
 * Redis A, with a TTL Redis enforces itself. There is no unblock call and no
 * permanent state: the block ends because time passed, not because something
 * remembered to remove it. Phase 16 owns any operator-driven action; nothing
 * here can extend a block beyond its TTL or make one permanent.
 *
 * Best effort. If Redis is unavailable the block is not applied — and the
 * evidence row still exists, so the pattern remains visible and the next
 * signal will try again. A security control that throws into its caller would
 * be worse than one that occasionally misses.
 */
async function applyTemporaryBlock(
  admin: SupabaseClient,
  subject: string | null,
  traceId: string | null
): Promise<void> {
  if (!subject) return;

  // ---- PHASE 12-E POLICY GATE ---------------------------------------------
  // A temporary block is an automatic enforcement action taken against a
  // person, so it does not run without a policy result (roadmap ¶1649).
  //
  // `evaluatePolicy` is imported rather than `requirePolicy`: the gate reads
  // block state through this module, so calling it here would be a cycle. The
  // engine is pure and imports only the registry, which makes the direct call
  // safe — and the risk fields are all false because the question "is this
  // subject blocked?" is the one being answered, not an input to it.
  //
  // FAIL-CLOSED HERE MEANS DO NOT ENFORCE. That is the opposite direction
  // from the quarantine gate, and correct for the same reason: refusing to
  // release media leaves media unreleased, while refusing to block leaves a
  // subject unblocked. For a discretionary automatic action against a user,
  // not acting is the conservative outcome — and the evidence row recording
  // the recommendation was already written, so nothing is lost.
  const decision = evaluatePolicy({
    action: "security.temporary_block.apply",
    actor: { id: "cinefield-security-logger", role: "service", kind: "service" },
    tenantId: null,
    resource: { type: "security_subject", id: null },
    risk: { temporarilyBlocked: false, adminReviewRequired: false, challengeRequired: false },
    approvalEvidence: { humanApproved: false },
    environment: policyEnvironment(),
    originClass: "server",
    correlationId: traceId,
  });

  // Written through the same RPC this module already holds, rather than
  // through `security-signals` — importing that would close the cycle the
  // direct engine call was avoiding.
  await recordPolicyDecisionRow(admin, decision.decision, decision.reason, decision.policyVersion, traceId);

  if (decision.decision !== "ALLOW") return;

  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(`${BLOCK_KEY_PREFIX}:${subject}`, "1", "EX", TEMPORARY_BLOCK_TTL_SECONDS);
  } catch {
    /* evidence is already durable */
  }
}

function policyEnvironment(): "development" | "preview" | "production" {
  const raw = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (raw === "production") return "production";
  if (raw === "preview") return "preview";
  return "development";
}

/** Best effort, like every other write here. A lost log line changes nothing. */
async function recordPolicyDecisionRow(
  admin: SupabaseClient,
  decision: string,
  reason: string,
  policyVersion: string,
  traceId: string | null
): Promise<void> {
  const allowed = decision === "ALLOW";
  try {
    await admin.rpc("record_security_event", {
      p_kind: allowed ? "policy_decision_allowed" : "policy_decision_denied",
      p_severity: "medium",
      p_source: "policy_gate",
      p_reason_code: `${decision}_${reason}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 65),
      p_dedupe_key: `policy:security.temporary_block.apply:${decision}:${reason}`,
      p_window_seconds: 1,
      p_actor: "cinefield-security-logger",
      p_resource_type: "security.temporary_block.apply",
      p_trace_id: traceId,
      p_policy_version: policyVersion,
    });
  } catch {
    /* the block decision stands either way */
  }
}

/** Whether a subject currently holds a temporary block. Fails OPEN. */
export async function isTemporarilyBlocked(subject: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;
  try {
    return (await redis.exists(`${BLOCK_KEY_PREFIX}:${subject}`)) === 1;
  } catch {
    // Unknown is not blocked. A Redis outage must not lock every user out of
    // the product; the rate limiter already fails CLOSED on the paid paths,
    // which is where the real protection lives.
    return false;
  }
}

/**
 * Fire-and-forget recording.
 *
 * THE ONLY WAY AN OBSERVER SHOULD CALL THIS. The signal describes something
 * that already happened; awaiting the write would put database latency in
 * front of a rejection response, and a rejected caller is exactly who should
 * not be able to make us wait.
 */
export function recordSecurityEventDetached(admin: SupabaseClient, input: SecurityEventInput): void {
  void recordSecurityEvent(admin, input).catch(() => {
    /* a lost log line never reopens a closed door */
  });
}
