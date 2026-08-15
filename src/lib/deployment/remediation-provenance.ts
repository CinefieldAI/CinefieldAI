import "server-only";
import { createLogger } from "@/lib/observability/logger";
import type { ChangeRiskClass } from "./change-risk";
import type { RemediationRefusal } from "./remediation-guardrail";

/**
 * AI-action provenance (Phase 14-F).
 *
 * ¶257: "AI-action provenance: audit'te AI-tarafından-başlatılan aksiyonlar
 * ayrı bayrak + hangi model/agent + policy sürümü ile işaretlenir." ¶259's
 * done-criterion: "her AI action model/agent/policy sürümüyle audit'te."
 *
 * The point is that an operator reading the trail six months later can tell
 * an AI-initiated action apart from a human one AT A GLANCE, and can say
 * which agent and which policy version produced it — not infer it by joining
 * on an actor id and hoping the convention held.
 *
 * ---------------------------------------------------------------------------
 * IT RECORDS. IT DECIDES NOTHING.
 * ---------------------------------------------------------------------------
 * Nothing here can allow, refuse, retry or escalate. It imports the logger,
 * two types, and nothing that could act — the same argument the Risk Engine
 * and the health service make about their own import lists.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EXISTING LOGGER AND NOT A NEW TABLE
 * ---------------------------------------------------------------------------
 * No SQL is created for this. A second append-only store means a second
 * retention policy, a second set of grants and a second place nobody checks —
 * the reasoning 12-E already used when it put policy decisions into
 * `security_events` rather than a table of its own. The 13-E guarded logger
 * carries this today; when Phase 16's Operations Center needs a queryable
 * surface, it reads from the durable evidence that already exists rather than
 * from something invented here.
 *
 * Every field below is an enum label, a bounded code, an allow-listed
 * correlation id or a count. There is no field a prompt, a log line, a stack
 * or a secret could travel in, and the 13-E redactor drops anything unknown
 * regardless.
 */

const log = createLogger("remediation");

/** Who initiated. `ai_agent` is the flag ¶257 asks for, as its own field. */
export type RemediationActorClass = "ai_agent" | "human" | "service";

export interface RemediationProvenance {
  /** 13-D incident identity. The join key for a whole incident timeline. */
  readonly dedupeKey: string;
  readonly actorClass: RemediationActorClass;
  /** Which agent/provider produced the diagnosis, e.g. "local-deterministic". */
  readonly agent: string;
  /** 1-based; null when the attempt was refused before one was assigned. */
  readonly attemptNumber: number | null;
  readonly decision: "ALLOW_ATTEMPT" | "REFUSE" | "PROPOSED" | "REVIEW_REQUIRED";
  readonly reasonCode: RemediationRefusal | string;
  /** 12-E policy version, when a policy decision participated. */
  readonly policyVersion?: string;
  readonly riskClass?: ChangeRiskClass;
  readonly traceId?: string;
}

/**
 * Writes one provenance record.
 *
 * Field-by-field, never spread — the 13-E scanner rejects a spread inside a
 * log call because a spread defeats the one thing static call-site matching
 * can verify: that every key is a literal, allow-listed name. Optional values
 * are passed as possibly-`undefined`; the redactor drops those.
 *
 * Never throws. A provenance write that failed a caller would let the audit
 * trail take down the thing it is auditing.
 */
export function recordRemediationProvenance(p: RemediationProvenance): void {
  try {
    log.warn("remediation_action", {
      subsystem: "remediation",
      // The AI-vs-human flag ¶257 asks for, as its own queryable field.
      kind: p.actorClass,
      // Which agent produced it. "local-deterministic" today, a Seer
      // provider later — the value is what makes the record reproducible.
      resource: p.agent,
      result: p.decision.toLowerCase(),
      reasonCode: p.reasonCode,
      count: p.attemptNumber ?? 0,
      policyVersion: p.policyVersion,
      // `classification`, not `severity`: the severity rule caps at 16 chars
      // and "forbidden_automation" is 20, so the risk class would have been
      // silently dropped by the redactor. A field that quietly discards the
      // value is worse than the wrong field name.
      classification: p.riskClass ? p.riskClass.toLowerCase() : undefined,
      traceId: p.traceId,
      // `dedupeKey`, not `correlationId`: 13-D's identity is
      // `source:type:resource`, and correlationId is an `id` field whose
      // pattern permits no colons — it too would have been dropped. 13-E's
      // allow-list gained a `dedupeKey` entry (kind `name`, which permits
      // colons) rather than the value being mangled to fit.
      dedupeKey: p.dedupeKey,
    });
  } catch {
    /* Auditing must not break the path it audits. */
  }
}
