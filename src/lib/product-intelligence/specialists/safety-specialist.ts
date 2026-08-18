import "server-only";
import { moderateText } from "@/lib/orchestration/content-moderation";

/**
 * Safety Specialist (Phase 17).
 *
 * Wraps the EXISTING moderateText() (Cloudflare Workers AI Llama Guard,
 * already used standalone via /api/orchestration/moderate-text). Fail-
 * closed by construction: this specialist's own outcome type has no "safe"
 * value for the unavailable case — moderateText() never lets "unavailable"
 * collapse into "safe", and neither does this wrapper. The Manifest
 * Compiler treats "unavailable" as a hard PARTIAL/refusal signal, never as
 * an implicit pass — see manifest-compiler.ts and the Phase 17 policy/
 * safety boundary rule (reuse Phase 12/moderation foundations, no new OPA
 * runtime, unavailable must never mean safe).
 */

export type SafetySpecialistOutcome = "safe" | "flagged" | "unavailable";

export interface SafetySpecialistResult {
  outcome: SafetySpecialistOutcome;
  categories: string[];
}

export async function runSafetySpecialist(text: string): Promise<SafetySpecialistResult> {
  const result = await moderateText(text);
  if (!result.available || result.flagged === null) {
    return { outcome: "unavailable", categories: [] };
  }
  return { outcome: result.flagged ? "flagged" : "safe", categories: result.categories };
}
