import "server-only";

/**
 * The Trust & Safety vocabulary (Phase 28).
 *
 * ---------------------------------------------------------------------------
 * ONE VOCABULARY FOR BOTH GATES
 * ---------------------------------------------------------------------------
 * REFERANS M.1 describes three doors: the provider's own moderation (gate A,
 * explicitly "GÜVENME" — do not trust it), Cinefield's prompt filter BEFORE
 * generation (gate B), and Cinefield's output scan AFTER generation (gate C).
 * B and C ask different questions of different material, but they must speak
 * ONE language: a verdict that means "blocked" at the prompt gate cannot mean
 * something subtly different at the output gate, or the two will disagree in
 * an incident and nobody will be able to say which one was right.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO PERMISSIVE DEFAULT, AND THAT IS THE DESIGN
 * ---------------------------------------------------------------------------
 * `SafetyVerdict` separates "a classifier looked and allowed this" (`ALLOW`)
 * from every way a system can fail to know: not configured, unavailable,
 * unparseable. Those are NOT verdicts about the content — they are statements
 * about the classifier — and `permitsProceeding` returns true for exactly one
 * member. A missing engine therefore cannot become an approval by omission,
 * which is how a platform ships with "moderation enabled" and everything
 * allowed.
 *
 * This mirrors Phase 9-E's `ModerationVerdict` deliberately (same discipline,
 * same reasoning) rather than replacing it: 9-E's type describes what an
 * ENGINE said, this one describes what CINEFIELD decided. Phase 28 keeps them
 * distinct because REFERANS M.1's whole point is that a provider's or a
 * vendor's opinion is an input, never the decision.
 *
 * ---------------------------------------------------------------------------
 * A REFUSAL MUST NOT TEACH THE BYPASS
 * ---------------------------------------------------------------------------
 * REFERANS M.1, verbatim: "Reddederken NASIL atlatılacağını anlatma. 'Şu
 * kelimeyi çıkarırsan geçer' tarzı ipucu verme; sadece 'bu istek politikamıza
 * aykırı' de. Aksi halde filtreni kendi ellerinle öğretmiş olursun."
 *
 * So there is exactly ONE user-facing refusal string in this package, it names
 * no category, no matched term, no score and no threshold, and
 * `GENERIC_REFUSAL_MESSAGE` is the only thing any gate may hand back to a
 * browser. The bounded category and reason code stay server-side, in the
 * decision store, for operators and appeals.
 */

/**
 * What Cinefield concluded. Ordered from "we know it is fine" outward through
 * every degree of not-knowing.
 */
export type SafetyVerdict =
  /** A classifier ran and raised no objection. The ONLY permissive member. */
  | "ALLOW"
  /** A classifier ran and refused. Terminal for the request or the output. */
  | "BLOCK"
  /** A classifier ran and could not decide alone; a human must look. */
  | "REVIEW_REQUIRED"
  /** No engine is installed. A statement about Cinefield, not about content. */
  | "NOT_CONFIGURED"
  /** An engine exists but did not answer: outage, timeout, unsupported input. */
  | "UNAVAILABLE"
  /** An engine answered with something outside its own contract. */
  | "MALFORMED_RESULT";

export const SAFETY_VERDICTS: readonly SafetyVerdict[] = [
  "ALLOW",
  "BLOCK",
  "REVIEW_REQUIRED",
  "NOT_CONFIGURED",
  "UNAVAILABLE",
  "MALFORMED_RESULT",
];

/**
 * Exactly one member. Nothing upgrades into this set by omission, and adding a
 * member here is a deliberate act a reviewer can see in a diff — the same
 * construction Phase 27 used for `PROVENANCE_SUCCESS_OUTCOMES`.
 */
export const PERMISSIVE_VERDICTS: ReadonlySet<SafetyVerdict> = new Set<SafetyVerdict>(["ALLOW"]);

export function permitsProceeding(verdict: SafetyVerdict): boolean {
  return PERMISSIVE_VERDICTS.has(verdict);
}

/**
 * What a classifier may say. Deliberately NARROWER than `SafetyVerdict`: an
 * engine can only reach the three content conclusions. It cannot report itself
 * as `NOT_CONFIGURED` (it exists) or `UNAVAILABLE` (it answered) — those are
 * derived by the gate from the absence or failure of an answer, which is why
 * an engine returning `null` is unambiguous.
 */
export type ClassifierVerdict = Extract<SafetyVerdict, "ALLOW" | "BLOCK" | "REVIEW_REQUIRED">;

export const CLASSIFIER_VERDICTS: readonly ClassifierVerdict[] = ["ALLOW", "BLOCK", "REVIEW_REQUIRED"];

export function isClassifierVerdict(value: unknown): value is ClassifierVerdict {
  return typeof value === "string" && (CLASSIFIER_VERDICTS as readonly string[]).includes(value);
}

/**
 * The risk taxonomy, bounded to what the roadmap actually names.
 *
 * Phase 28's own component table and REFERANS M.1's category table between
 * them name: CSAM, NCII, real-person deepfake, adult/NSFW, and "yasadışı
 * içerik". `unclassified` exists so an engine that flags something outside
 * this list is recorded honestly rather than silently mapped onto the nearest
 * category — a misfiled CSAM signal would be far worse than an unnamed one.
 */
export type SafetyRiskCategory =
  | "csam"
  | "ncii"
  | "real_person"
  | "deepfake"
  | "sexual_content"
  | "illegal_content"
  | "violence"
  | "self_harm"
  | "unclassified";

export const SAFETY_RISK_CATEGORIES: readonly SafetyRiskCategory[] = [
  "csam",
  "ncii",
  "real_person",
  "deepfake",
  "sexual_content",
  "illegal_content",
  "violence",
  "self_harm",
  "unclassified",
];

export function isSafetyRiskCategory(value: unknown): value is SafetyRiskCategory {
  return typeof value === "string" && (SAFETY_RISK_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The categories where the roadmap leaves NO discretion.
 *
 * REFERANS M.1: "CSAM — KARAR YOK — sıfır tolerans + yasal zorunluluk." There
 * is no configuration, threshold, environment or admin action in this package
 * that turns a `csam` signal into a delivery. Kept as a set rather than a
 * comparison so the zero-tolerance list is one readable line.
 */
export const ZERO_TOLERANCE_CATEGORIES: ReadonlySet<SafetyRiskCategory> = new Set<SafetyRiskCategory>([
  "csam",
]);

export function isZeroTolerance(category: SafetyRiskCategory): boolean {
  return ZERO_TOLERANCE_CATEGORIES.has(category);
}

/**
 * Which gate produced a decision.
 *
 * `prompt` and `reference_input` are separated because REFERANS M.1 singles
 * the second one out: "referans görsel yükleme EN RİSKLİ özelliktir ... orayı
 * en sıkı tut." Collapsing them into one stage would make it impossible to
 * answer "how often did the reference-image gate fire" without re-deriving it.
 */
export type SafetyDecisionStage = "prompt" | "reference_input" | "output";

export const SAFETY_DECISION_STAGES: readonly SafetyDecisionStage[] = [
  "prompt",
  "reference_input",
  "output",
];

/**
 * Where a signal came from. Persisted ALONGSIDE Cinefield's verdict, never
 * instead of it.
 *
 * §30 of the Phase 28 brief and REFERANS M.1 agree on why: a provider saying
 * "safe" is gate A, and gate A is explicitly not trusted. Storing the two
 * separately is what lets an operator later ask "did the vendor drift?" — a
 * question that is unanswerable once the two have been merged into a single
 * column.
 */
export type SafetySignalSource =
  /** Cinefield's own configured classifier. */
  | "cinefield_classifier"
  /** The generation provider's native moderation (fal, Gemini, Cloudflare...). */
  | "provider_native"
  /** A known-hash matching service (PhotoDNA / Safer / IWF class). */
  | "hash_match_provider"
  /** A human reviewer. */
  | "human_review"
  /** Nothing produced a signal. */
  | "none";

export const SAFETY_SIGNAL_SOURCES: readonly SafetySignalSource[] = [
  "cinefield_classifier",
  "provider_native",
  "hash_match_provider",
  "human_review",
  "none",
];

/**
 * Short codes only. The same shape `media_safety_audit` and
 * `record_media_ingest` already enforce in SQL, restated here so a caller is
 * refused in TypeScript before the database has to refuse it.
 *
 * This regex is what stops a matched term, a filename, a stack trace or a
 * fragment of the prompt from ever reaching a persisted reason.
 */
export const SAFETY_REASON_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

export function isValidSafetyReasonCode(value: unknown): value is string {
  return typeof value === "string" && SAFETY_REASON_PATTERN.test(value);
}

/**
 * The ONE thing a user is ever told.
 *
 * Deliberately identical for every category and every stage. A message that
 * varied by reason would let a caller binary-search the policy by editing one
 * word at a time, which is precisely the failure REFERANS M.1 warns about.
 */
export const GENERIC_REFUSAL_MESSAGE = "This request is not permitted under Cinefield's content policy.";

/**
 * The policy version this package enforces.
 *
 * Recorded on every decision so a later reviewer can tell whether a decision
 * was made under the rules in force today. Bumped when the vocabulary or the
 * fail-closed posture changes — not when an engine is swapped, which is what
 * `classifierVersion` on the decision itself is for.
 */
export const SAFETY_POLICY_VERSION = "cinefield-safety-1";

/**
 * A bounded, persistable safety decision.
 *
 * NOTE WHAT CANNOT BE PUT HERE. There is no field for the prompt, the negative
 * prompt, the media bytes, a provider payload, a signed URL, an object key, a
 * token, or a free-form classifier dump. The shape is the enforcement: a
 * caller cannot smuggle any of them through, because no property accepts them.
 */
export interface SafetyDecision {
  readonly stage: SafetyDecisionStage;
  readonly verdict: SafetyVerdict;
  /** Empty when nothing was flagged. Never invented to fill the field. */
  readonly categories: readonly SafetyRiskCategory[];
  readonly reasonCode: string;
  readonly policyVersion: string;
  /** The engine's own version string, when a real engine answered. */
  readonly classifierVersion: string | null;
  readonly signalSource: SafetySignalSource;
}

/**
 * Whether a decision at the OUTPUT stage permits user delivery.
 *
 * Separate from `permitsProceeding` on purpose even though it currently agrees
 * with it: "may this request reach a provider" and "may these bytes reach a
 * user" are different questions with different owners, and a future change to
 * one must not silently move the other.
 */
export function permitsDelivery(decision: SafetyDecision): boolean {
  if (decision.categories.some(isZeroTolerance)) return false;
  return permitsProceeding(decision.verdict);
}
