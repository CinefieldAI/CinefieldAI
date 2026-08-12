/**
 * Quality, normalized for ROUTING (Phase 7-D contract).
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * The router is made ready to consume a trusted quality signal. It does not
 * produce one. Producing, evaluating and governing quality scores is Phase 22
 * — golden datasets, evaluators, benchmark jobs, regression gates — and none
 * of that exists yet.
 *
 * So the production quality provider returns UNKNOWN. Every time. That is not
 * a stub waiting to be filled with a plausible number; it is the honest answer
 * until an evaluation system exists, and a test asserts it stays that way.
 *
 * WHY NOT JUST INVENT 0.9 FOR NOW
 * Because a fabricated score is indistinguishable from a measured one once it
 * is in the scorer, and it would silently start moving production traffic on
 * the basis of a number somebody typed. A router that prefers a provider for
 * a made-up reason is worse than a router that does not consider quality at
 * all — the second is merely incomplete, the first is wrong and confident.
 *
 * UNKNOWN QUALITY != LOW QUALITY. An unevaluated model has not scored badly;
 * it has not been scored. It therefore takes no penalty on the quality axis
 * and receives no advantage either.
 *
 * Pure.
 */

export type QualityState =
  /** A trusted evaluation exists, is fresh, and meets the sample bar. */
  | "known"
  /** An evaluation exists but is too thin or too old to act on. */
  | "low_confidence"
  /** No trusted evaluation. The state of every model today. */
  | "unknown";

export interface QualitySignal {
  providerId: string;
  providerModelId: string;
  /** [0,1]. Higher is better. */
  score: number;
  /** [0,1]. The evaluator's own confidence in the score. */
  confidence: number;
  /** How many evaluations back the score. */
  sampleCount: number;
  evaluatedAt: string;
  /**
   * PROVENANCE, and it is not decoration. A score is trusted because of where
   * it came from; a signal with no named evaluator is an anonymous number and
   * must not influence routing.
   */
  evaluator: string;
  evaluatorVersion: string;
}

export interface RouteQuality {
  providerId: string;
  providerModelId: string;
  state: QualityState;
  score?: number;
  confidence?: number;
  sampleCount?: number;
  evaluatedAt?: string;
  evaluator?: string;
}

export interface QualityPolicy {
  /** Below this confidence, a score does not move routing. */
  minConfidence: number;
  /** Below this sample count, a score does not move routing. */
  minSamples: number;
  /** Older than this and a score stops being actionable. */
  freshnessDays: number;
  /**
   * Evaluators whose signals may influence routing.
   *
   * EMPTY TODAY, on purpose. Nothing is trusted until Phase 22 produces a
   * governed evaluator, so an allowlist that starts empty is the mechanism
   * that keeps a fabricated or experimental score out of production routing
   * by construction rather than by discipline.
   */
  trustedEvaluators: readonly string[];
}

export const DEFAULT_QUALITY_POLICY: QualityPolicy = {
  minConfidence: 0.7,
  minSamples: 20,
  freshnessDays: 90,
  trustedEvaluators: [],
};

export function unknownQuality(providerId: string, providerModelId: string): RouteQuality {
  return { providerId, providerModelId, state: "unknown" };
}

/**
 * Normalizes a raw signal into what the router may act on.
 *
 * The provenance check comes FIRST. A score from an untrusted or unnamed
 * evaluator is not downgraded to low confidence — it is discarded as unknown,
 * because "we do not trust this source" is a different statement from "this
 * source is unsure".
 */
export function normalizeQuality(
  providerId: string,
  providerModelId: string,
  signal: QualitySignal | null,
  now: Date,
  policy: QualityPolicy = DEFAULT_QUALITY_POLICY
): RouteQuality {
  if (!signal) return unknownQuality(providerId, providerModelId);

  if (!signal.evaluator || !policy.trustedEvaluators.includes(signal.evaluator)) {
    return unknownQuality(providerId, providerModelId);
  }

  if (!Number.isFinite(signal.score) || signal.score < 0 || signal.score > 1) {
    return unknownQuality(providerId, providerModelId);
  }

  const evaluatedAt = Date.parse(signal.evaluatedAt);
  const stale =
    !Number.isFinite(evaluatedAt) ||
    (now.getTime() - evaluatedAt) / 86_400_000 > policy.freshnessDays;

  const thin =
    signal.confidence < policy.minConfidence || signal.sampleCount < policy.minSamples;

  return {
    providerId,
    providerModelId,
    state: stale || thin ? "low_confidence" : "known",
    score: signal.score,
    confidence: signal.confidence,
    sampleCount: signal.sampleCount,
    evaluatedAt: signal.evaluatedAt,
    evaluator: signal.evaluator,
  };
}

export interface QualityScore {
  state: QualityState;
  /** [0,1]. Neutral (1) when unknown or low-confidence — never a penalty. */
  component: number;
}

/**
 * Scores quality.
 *
 * `unknown` and `low_confidence` both score neutral, which is what makes
 * UNKNOWN != LOW: an unevaluated model competes on its other merits instead of
 * being pushed down a list for a measurement nobody took.
 */
export function scoreQuality(quality: RouteQuality): QualityScore {
  if (quality.state !== "known" || quality.score === undefined) {
    return { state: quality.state, component: 1 };
  }
  return { state: "known", component: Math.min(1, Math.max(0, quality.score)) };
}

/**
 * Where a trusted quality signal would come from.
 *
 * Phase 22 will implement this against its evaluation store. Until then the
 * production implementation below returns null for everything, and tests
 * supply fixtures directly — fixtures that are never written into a seed.
 */
export interface QualitySignalProvider {
  read(providerId: string, providerModelId: string): Promise<QualitySignal | null>;
}

/**
 * The production provider: no trusted signal exists, so there is none to
 * return.
 *
 * Deliberately not a TODO and not a placeholder value. This IS the correct
 * implementation for a platform with no evaluation system, and it is asserted
 * by a test so that a future change to it has to be a deliberate one.
 */
export const NO_TRUSTED_QUALITY_SOURCE: QualitySignalProvider = {
  async read(): Promise<QualitySignal | null> {
    return null;
  },
};
