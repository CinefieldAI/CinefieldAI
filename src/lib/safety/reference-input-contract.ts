import "server-only";
import type { ClassifierVerdict, SafetyRiskCategory } from "./safety-contract";

/**
 * The reference-input evaluator seam (Phase 28-A, second half).
 *
 * ---------------------------------------------------------------------------
 * WHAT THE ROADMAP ASKS FOR, IN THREE PLACES
 * ---------------------------------------------------------------------------
 *   Component table:  "NCII/Real-Person Policy — Reference face/deepfake risk."
 *   Package 28-A:     "Prompt input moderation + reference-image
 *                      real-person/NCII policy gate'i BİRLİKTE kur."
 *   "Nasıl yapılacak" step 3: "Referans-görsel suistimali: kullanıcı gerçek
 *                      bir yüz yüklediğinde NCII/gerçek-kişi deepfake riskini
 *                      ÖZEL DEĞERLENDİR."
 *
 * "Özel değerlendir" — specially EVALUATE. Passing a boolean to a text
 * classifier is not that. This seam is the shape of an evaluator that actually
 * looks at the uploaded image.
 *
 * ---------------------------------------------------------------------------
 * A SHAPE, NOT AN ENGINE — AND EXPLICITLY NOT A KEYWORD TRICK
 * ---------------------------------------------------------------------------
 * The registry is empty, exactly as `prompt-moderation.ts` and
 * `moderation-contract.ts` are. Face detection needs a model; a repository
 * cannot conjure one, and REFERANS M.1 already rejects the cheap substitute
 * for the prompt lane ("Kelime listesi yetmez; moderasyon modeli kullan").
 *
 * The stronger rule for THIS lane: nothing here may infer a face from a
 * filename, an extension, a size, or the prompt text. The evaluator's input
 * carries BYTES, and an implementation that ignores them and guesses is the
 * one failure mode this file exists to prevent. `null` is the honest answer
 * until a real classifier is contracted.
 *
 * ---------------------------------------------------------------------------
 * THE CLIENT NEVER CHOOSES
 * ---------------------------------------------------------------------------
 * Resolved from server environment only. There is no request field anywhere
 * through which a caller can name an evaluator, disable one, or pass a
 * threshold.
 */

export interface ReferenceInputEvaluationInput {
  /** The actual uploaded image. Transient — never persisted by this package. */
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  /** The declared type, already narrowed to an evaluable image by the source. */
  readonly declaredMime: string;
  /**
   * What the PROMPT gate concluded about the accompanying request.
   *
   * Supplied because REFERANS M.1's rule is a COMBINATION, not a property of
   * the image alone: "gerçek kişi + müstehcen kombinasyonu reddedilir" — a
   * real person combined with explicit content is refused. An evaluator that
   * could only see the image would have to refuse every recognisable face, or
   * none of them.
   */
  readonly promptCategories: readonly SafetyRiskCategory[];
}

export interface ReferenceInputEvaluation {
  readonly verdict: ClassifierVerdict;
  /** Bounded categories. Empty on ALLOW. Never invented to fill the field. */
  readonly categories: readonly SafetyRiskCategory[];
  /** Short code, matching SAFETY_REASON_PATTERN. Never free text. */
  readonly reasonCode: string;
  readonly classifierVersion: string;
}

/**
 * What a real evaluator must implement.
 *
 * `null` means "this evaluator produced no verdict" — an outage, a timeout, a
 * refusal to answer. Deliberately distinct from a `BLOCK`, which is a
 * conclusion it DID reach. The gate maps `null` to `UNAVAILABLE`, and
 * `UNAVAILABLE` refuses.
 */
export interface ReferenceInputEvaluator {
  readonly name: string;
  evaluate(input: ReferenceInputEvaluationInput): Promise<ReferenceInputEvaluation | null>;
}

/**
 * The registry, empty on purpose.
 *
 * No face/NCII/deepfake classifier is contracted. Selecting one is a cost,
 * legal and data-processing decision — a classifier that examines uploaded
 * faces is a biometric-adjacent processor, which is Phase 23's and Phase 29's
 * territory as much as this phase's.
 *
 * The consequence is visible and correct: with no evaluator, a request that
 * carries a reference image is REFUSED rather than admitted unexamined.
 */
const EVALUATORS: ReadonlyMap<string, ReferenceInputEvaluator> = new Map();

let installed: ReferenceInputEvaluator | null = null;

/**
 * Installs an evaluator, or clears it with `null`.
 *
 * The seam a real integration would use, and the seam tests use to prove gate
 * behaviour without a vendor. Deliberately NOT called anywhere in production
 * wiring: installing one is what selecting a vendor means.
 */
export function installReferenceInputEvaluator(evaluator: ReferenceInputEvaluator | null): void {
  installed = evaluator;
}

/**
 * The active evaluator, or null. Null is the honest answer today.
 *
 * An unknown name in the environment resolves to `null` rather than to a
 * permissive fallback — a typo in configuration must not become "the reference
 * gate is off but looks on".
 */
export function getReferenceInputEvaluator(): ReferenceInputEvaluator | null {
  if (installed) return installed;
  const configured = process.env.CINEFIELD_REFERENCE_INPUT_EVALUATOR;
  if (!configured) return null;
  return EVALUATORS.get(configured) ?? null;
}

export function isReferenceInputEvaluatorConfigured(): boolean {
  return getReferenceInputEvaluator() !== null;
}
