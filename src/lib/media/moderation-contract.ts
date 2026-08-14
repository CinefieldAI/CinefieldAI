import "server-only";

/**
 * Provider-neutral moderation contract (Phase 9-E).
 *
 * A SHAPE, NOT AN ENGINE. It names what a classifier must answer so a future
 * integration is a new file rather than a change to the release lane. It
 * selects no provider, holds no credential, and makes no network call.
 *
 * THERE IS NO DEFAULT VERDICT, and that is the design. `ModerationVerdict`
 * has no member meaning "probably fine": every value is something a
 * classifier actually said. An unimplemented engine cannot accidentally
 * return one, because the only thing it can return is `null` — and `null` is
 * not a verdict, so nothing downstream can mistake it for approval.
 *
 * The alternative — a `pass` default that a missing engine falls through to —
 * is how a system ships with moderation "enabled" and every asset approved.
 */

export type ModerationVerdict = "passed" | "rejected" | "manual_review" | "error";

export interface ModerationResult {
  verdict: ModerationVerdict;
  /**
   * Which engine said it. Recorded so a later verdict from a different engine
   * is distinguishable, and so a verdict can be re-examined if an engine is
   * found to be wrong.
   */
  engine: string;
  /**
   * Bounded, non-secret evidence: category codes and scores, nothing more.
   * Never the media, never a URL, never a raw provider response.
   */
  categories?: string[];
  score?: number;
}

/**
 * What a future engine must implement. Returning `null` means "this engine
 * did not produce a verdict" — an outage, a timeout, an unsupported media
 * type. Deliberately distinct from `"error"`, which is a verdict the engine
 * DID reach.
 */
export interface MediaModerationEngine {
  readonly name: string;
  classify(input: {
    bytes: Uint8Array;
    verifiedMime: string;
    assetId: string;
  }): Promise<ModerationResult | null>;
}

/**
 * The registry, empty on purpose.
 *
 * No engine is configured: the repository's only classifier is text-only,
 * behind a disabled flag, and never called by the generation pipeline. This
 * batch does not select one, sign up for one, or call one — choosing a
 * moderation provider is a product and cost decision, not something an
 * implementation batch should make on its own.
 *
 * The consequence is visible and correct: no asset can be released.
 */
const ENGINES: ReadonlyMap<string, MediaModerationEngine> = new Map();

/** The active engine, or null. Null is the honest answer today. */
export function getModerationEngine(): MediaModerationEngine | null {
  const configured = process.env.CINEFIELD_MEDIA_MODERATION_ENGINE;
  if (!configured) return null;
  // An unknown name resolves to null rather than to a permissive fallback: a
  // typo in configuration must not become "moderation is off but looks on".
  return ENGINES.get(configured) ?? null;
}

export function isModerationConfigured(): boolean {
  return getModerationEngine() !== null;
}

/**
 * Maps a verdict onto the `moderation_status` column.
 *
 * Total over `ModerationVerdict` and nothing else. There is no branch for
 * "no engine", because a caller with no engine has no verdict to map — it
 * must leave the status alone rather than pass a stand-in through here.
 */
export function moderationStatusFor(verdict: ModerationVerdict): string {
  switch (verdict) {
    case "passed":
      return "passed";
    case "rejected":
      return "rejected";
    case "manual_review":
      return "manual_review";
    case "error":
      return "error";
  }
}
