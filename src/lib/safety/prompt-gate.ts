import "server-only";
import { isProduction } from "@/lib/config/environment";
import {
  GENERIC_REFUSAL_MESSAGE,
  SAFETY_POLICY_VERSION,
  isClassifierVerdict,
  isSafetyRiskCategory,
  isValidSafetyReasonCode,
  permitsProceeding,
  type SafetyDecision,
  type SafetyRiskCategory,
  type SafetyVerdict,
} from "./safety-contract";
import { getPromptModerationEngine, type PromptModerationInput } from "./prompt-moderation";

/**
 * Gate B — prompt moderation, BEFORE the provider (Phase 28-A).
 *
 * ---------------------------------------------------------------------------
 * WHY HERE AND NOT LATER
 * ---------------------------------------------------------------------------
 * REFERANS M.1 places this gate before generation for a concrete reason: "En
 * ucuz yer: reddedilen istek için GPU parası ödemezsin." Phase 28's own
 * done-criterion for 28-A is narrower and stronger than cost, though —
 * "Riskli request provider'a gönderilmiyor." A risky request must not REACH
 * the provider, so this runs inside `createGeneration`, before the row exists,
 * before credit is reserved, before a workflow starts, and before any adapter
 * is contacted.
 *
 * ---------------------------------------------------------------------------
 * THE FAIL-CLOSED POSTURE, AND WHY IT IS ENVIRONMENT-DEPENDENT
 * ---------------------------------------------------------------------------
 * Phase 28's phase criterion says moderation is a "üretimde ZORUNLU KAPI" — a
 * mandatory gate IN PRODUCTION. That wording is load-bearing, and this file
 * follows the posture Phase 27 already established for signing:
 *
 *   PRODUCTION      no engine, no answer, or a malformed answer REFUSES.
 *                   There is no flag, header or environment variable that
 *                   turns any of them into a pass.
 *   NON-PRODUCTION  the request proceeds, and the decision is recorded as
 *                   NOT_CONFIGURED / UNAVAILABLE — never as ALLOW. A
 *                   development run must never claim the prompt was cleared,
 *                   because that claim would then appear in the decision store
 *                   as evidence that a classifier approved something no
 *                   classifier ever saw.
 *
 * The asymmetry is the point. Making development fail closed too would mean no
 * generation could run anywhere until a paid vendor is signed, which is how a
 * safety gate gets disabled wholesale by the first person it blocks.
 *
 * ---------------------------------------------------------------------------
 * A REFUSAL SAYS NOTHING USEFUL TO AN ATTACKER
 * ---------------------------------------------------------------------------
 * The outcome carries a bounded category and reason code for the decision
 * store and the admin queue. `GENERIC_REFUSAL_MESSAGE` is the only string that
 * goes back to the caller, and it is identical for every category — REFERANS
 * M.1: "sadece 'bu istek politikamıza aykırı' de."
 */

export type PromptGateOutcome =
  | {
      readonly allowed: true;
      readonly decision: SafetyDecision;
    }
  | {
      readonly allowed: false;
      readonly decision: SafetyDecision;
      /** The ONLY text a caller may surface. Never varies by category. */
      readonly userMessage: string;
    };

/**
 * Evaluates one prompt.
 *
 * Never throws for a safety reason: a refusal is data, and an engine that
 * throws is an outage rather than a verdict. Both are turned into a
 * non-permissive decision here so no caller has to remember a try/catch to
 * stay safe.
 */
export async function evaluatePromptSafety(input: PromptModerationInput): Promise<PromptGateOutcome> {
  const engine = getPromptModerationEngine();

  if (!engine) {
    return resolve("NOT_CONFIGURED", [], "prompt_moderation_not_configured", null);
  }

  let result: Awaited<ReturnType<typeof engine.classify>>;
  try {
    result = await engine.classify(input);
  } catch {
    // The underlying error is discarded rather than propagated: it may carry a
    // provider response, a URL or a fragment of the prompt, and nothing in this
    // package is allowed to persist or log any of those.
    return resolve("UNAVAILABLE", [], "prompt_moderation_threw", null);
  }

  // `null` is the contract's "I produced no verdict". Distinct from BLOCK.
  if (result === null) {
    return resolve("UNAVAILABLE", [], "prompt_moderation_no_verdict", null);
  }

  // ---- The engine answered. Is the answer inside its own contract? --------
  //
  // Validated rather than trusted. An engine is third-party code (or, later, a
  // vendor's JSON), and an out-of-contract value must become MALFORMED_RESULT
  // — which is non-permissive — rather than being coerced toward the nearest
  // valid member. Coercion is how "ALLOWED_MAYBE" becomes "ALLOW".
  if (!isClassifierVerdict(result.verdict) || !isValidSafetyReasonCode(result.reasonCode)) {
    return resolve("MALFORMED_RESULT", [], "prompt_moderation_malformed", null);
  }

  const categories = Array.isArray(result.categories) ? result.categories.filter(isSafetyRiskCategory) : null;
  if (categories === null || categories.length !== (result.categories?.length ?? 0)) {
    // An unrecognised category is not silently dropped. A classifier naming a
    // category this build does not know about is a classifier this build
    // cannot reason about, and quietly discarding the unknown one could
    // discard exactly the CSAM signal that mattered.
    return resolve("MALFORMED_RESULT", [], "prompt_moderation_unknown_category", null);
  }

  const version =
    typeof result.classifierVersion === "string" && result.classifierVersion.length > 0
      ? result.classifierVersion.slice(0, 64)
      : null;

  return resolve(result.verdict, categories, result.reasonCode, version);
}

/**
 * Turns a verdict into an outcome, applying the environment posture.
 *
 * One place, so the production/non-production asymmetry cannot drift between
 * branches. Note that `BLOCK` and `REVIEW_REQUIRED` refuse in EVERY
 * environment: the relaxation is only ever about not-knowing, never about
 * overriding something a classifier actually concluded.
 */
function resolve(
  verdict: SafetyVerdict,
  categories: readonly SafetyRiskCategory[],
  reasonCode: string,
  classifierVersion: string | null
): PromptGateOutcome {
  const decision: SafetyDecision = {
    stage: "prompt",
    verdict,
    categories,
    reasonCode,
    policyVersion: SAFETY_POLICY_VERSION,
    classifierVersion,
    signalSource: classifierVersion === null && verdict !== "ALLOW" ? "none" : "cinefield_classifier",
  };

  if (permitsProceeding(verdict)) {
    return { allowed: true, decision };
  }

  // A real conclusion refuses everywhere. Only not-knowing is environment
  // dependent, and only outside production.
  const engineReachedAConclusion = verdict === "BLOCK" || verdict === "REVIEW_REQUIRED";
  if (!engineReachedAConclusion && !isProduction()) {
    return { allowed: true, decision };
  }

  return { allowed: false, decision, userMessage: GENERIC_REFUSAL_MESSAGE };
}
