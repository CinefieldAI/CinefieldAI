import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readReferenceInputBytes } from "@/lib/media/reference-input-source";
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
import { getReferenceInputEvaluator } from "./reference-input-contract";

/**
 * The reference-image gate (Phase 28-A, second half).
 *
 * ---------------------------------------------------------------------------
 * STRICTER THAN THE PROMPT GATE, ON PURPOSE
 * ---------------------------------------------------------------------------
 * `prompt-gate.ts` relaxes ONE thing outside production: not-knowing. With no
 * engine contracted, a development request proceeds and the decision is
 * recorded as `NOT_CONFIGURED` rather than as an approval. That relaxation
 * exists so an unsigned vendor contract does not brick every environment.
 *
 * This gate has NO such carve-out. Not-configured, unavailable, malformed, an
 * unreadable upload — every one of them refuses, in every environment.
 *
 * The reason is REFERANS M.1, which names this the strictest lane there is:
 * "referans görsel yükleme EN RİSKLİ özelliktir (kullanıcı gerçek bir insanın
 * fotoğrafını yükleyebilir) — orayı en sıkı tut."
 *
 * ---------------------------------------------------------------------------
 * AND IT IS NOT FREE — THIS LANE IS LIVE
 * ---------------------------------------------------------------------------
 * An earlier reading of the registry concluded that every enabled non-mock
 * model declared `maxInputs: 0`, which would have made this gate a precaution
 * for a feature nobody could reach. That reading was WRONG: it came from a
 * regex over the registry SOURCE, and `GEMINI_MODELS` is built by a `.map()`
 * over an id array rather than written as object literals, so the pattern
 * never saw it.
 *
 * `nano-banana-pro`, `nano-banana-2` and `nano-banana-2-lite` are enabled,
 * non-mock, `maxInputs: 1`, and support `image-to-image` with exactly the
 * three image MIME types this gate accepts. A user can upload a real person's
 * face to a live model today.
 *
 * So the honest statement is the opposite of "costs nothing": with no
 * evaluator configured, image-to-image on those three models is now REFUSED
 * at admission. That is a real, user-visible consequence of a gate the
 * roadmap requires, and the way to lift it is to configure an evaluator — not
 * to weaken the posture. `R28-19` pins this by asking the registry's own
 * resolver rather than its text, so the mistake cannot recur silently.
 *
 * ---------------------------------------------------------------------------
 * THE GATE FIRES ON THE PRESENCE OF A REFERENCE, NOT ON ITS PARSEABILITY
 * ---------------------------------------------------------------------------
 * A caller who attaches a face and omits `mime_type` must not thereby skip the
 * evaluation. `mapMetadataToInputs` returns NO inputs when the declared type
 * is missing, so a gate keyed on the parsed input list would have exactly that
 * hole. This gate is keyed on `inputUrl` being present at all, and an
 * unevaluable reference is refused as `unsupported_reference_mime`.
 *
 * ---------------------------------------------------------------------------
 * BYTES ARE READ, USED, AND DROPPED
 * ---------------------------------------------------------------------------
 * Nothing here persists, logs, hashes or copies the image. It is handed to the
 * evaluator and goes out of scope; the durable record is a verdict, a bounded
 * category list and a reason code.
 */

export type ReferenceGateOutcome =
  | { readonly allowed: true; readonly decision: SafetyDecision; readonly evaluated: boolean }
  | {
      readonly allowed: false;
      readonly decision: SafetyDecision;
      /** The ONLY text a caller may surface. Identical to every other refusal. */
      readonly userMessage: string;
    };

export interface ReferenceGateParams {
  readonly clerkUserId: string;
  /** The storage PATH of the upload. See reference-input-source.ts. */
  readonly storagePath: string;
  readonly declaredMime: string | null | undefined;
  /** What the prompt gate concluded, so the combination rule is evaluable. */
  readonly promptCategories: readonly SafetyRiskCategory[];
}

/**
 * Evaluates one reference upload.
 *
 * Never throws for a safety reason. An evaluator that throws is an outage
 * rather than a verdict, and both become a non-permissive decision here so no
 * caller has to remember a try/catch to stay safe.
 */
export async function evaluateReferenceInputSafety(
  admin: SupabaseClient,
  params: ReferenceGateParams
): Promise<ReferenceGateOutcome> {
  // ---- 1. Acquire the bytes ----------------------------------------------
  //
  // Ownership, path shape, type and size are all enforced by the source
  // module. Every failure it can report is fail-closed here: an upload this
  // system cannot read is an upload it cannot clear.
  const fetched = await readReferenceInputBytes(admin, {
    storagePath: params.storagePath,
    declaredMime: params.declaredMime,
    clerkUserId: params.clerkUserId,
  });

  if (!fetched.ok) {
    return refuse("UNAVAILABLE", [], fetched.reason, null);
  }

  // ---- 2. Evaluate --------------------------------------------------------
  const evaluator = getReferenceInputEvaluator();
  if (!evaluator) {
    return refuse("NOT_CONFIGURED", [], "reference_evaluator_not_configured", null);
  }

  let result: Awaited<ReturnType<typeof evaluator.evaluate>>;
  try {
    result = await evaluator.evaluate({
      bytes: fetched.bytes,
      byteLength: fetched.byteLength,
      declaredMime: params.declaredMime as string,
      promptCategories: params.promptCategories,
    });
  } catch {
    // Discarded rather than propagated: an evaluator's exception may carry a
    // provider body, a URL, or a fragment of the image.
    return refuse("UNAVAILABLE", [], "reference_evaluator_threw", null);
  }

  if (result === null) {
    return refuse("UNAVAILABLE", [], "reference_evaluator_no_verdict", null);
  }

  // ---- 3. Is the answer inside the evaluator's own contract? --------------
  //
  // Validated rather than trusted, exactly as the prompt gate does. An
  // out-of-contract value becomes MALFORMED_RESULT — which refuses — rather
  // than being coerced toward the nearest valid member.
  if (!isClassifierVerdict(result.verdict) || !isValidSafetyReasonCode(result.reasonCode)) {
    return refuse("MALFORMED_RESULT", [], "reference_evaluator_malformed", null);
  }

  const declared = result.categories ?? [];
  const categories = declared.filter(isSafetyRiskCategory);
  if (categories.length !== declared.length) {
    // An unrecognised category is refused, never silently dropped: discarding
    // the unknown one could discard exactly the NCII signal that mattered.
    return refuse("MALFORMED_RESULT", [], "reference_unknown_category", null);
  }

  const version =
    typeof result.classifierVersion === "string" && result.classifierVersion.length > 0
      ? result.classifierVersion.slice(0, 64)
      : null;

  const decision: SafetyDecision = {
    stage: "reference_input",
    verdict: result.verdict,
    categories,
    reasonCode: result.reasonCode,
    policyVersion: SAFETY_POLICY_VERSION,
    classifierVersion: version,
    signalSource: "cinefield_classifier",
  };

  if (permitsProceeding(result.verdict)) {
    return { allowed: true, decision, evaluated: true };
  }
  return { allowed: false, decision, userMessage: GENERIC_REFUSAL_MESSAGE };
}

/**
 * Every non-permissive outcome, in one place.
 *
 * There is no environment branch here — see the header. A reader looking for
 * the "but in development…" escape hatch should find its absence deliberate.
 */
function refuse(
  verdict: SafetyVerdict,
  categories: readonly SafetyRiskCategory[],
  reasonCode: string,
  classifierVersion: string | null
): ReferenceGateOutcome {
  return {
    allowed: false,
    decision: {
      stage: "reference_input",
      verdict,
      categories,
      reasonCode,
      policyVersion: SAFETY_POLICY_VERSION,
      classifierVersion,
      signalSource: classifierVersion === null ? "none" : "cinefield_classifier",
    },
    // One message, identical for every reason. REFERANS M.1: a refusal must
    // not teach the bypass, and "your reference image was rejected" would
    // already say more than "this request is not permitted".
    userMessage: GENERIC_REFUSAL_MESSAGE,
  };
}
