import type { ModerationResult } from "@/lib/media/moderation-contract";
import type { ScoreResult } from "../eval-contract";

/**
 * Safety scorer (Phase 22-B) — reads Phase 9-E's real moderation verdict,
 * never a second moderation judgment. `getModerationEngine()` returns
 * `null` in production today (no engine configured — see
 * moderation-contract.ts's own header), so a caller with no real
 * `ModerationResult` correctly gets `inconclusive`, not an invented "safe."
 */
export function scoreSafety(moderation: ModerationResult | null): ScoreResult {
  if (!moderation) {
    return { dimension: "safety", score: null, verdict: "inconclusive", reasonCode: "no_moderation_engine_configured" };
  }
  if (moderation.verdict === "error") {
    return { dimension: "safety", score: null, verdict: "inconclusive", reasonCode: "moderation_error" };
  }
  if (moderation.verdict === "passed") {
    return { dimension: "safety", score: 1, verdict: "pass", reasonCode: "moderation_passed" };
  }
  // "rejected" and "manual_review" both fail the safety dimension outright —
  // an eval case is not the place a borderline call gets the benefit of the
  // doubt; the moderation lane itself (Phase 9-E) is.
  return { dimension: "safety", score: 0, verdict: "fail", reasonCode: `moderation_${moderation.verdict}` };
}
