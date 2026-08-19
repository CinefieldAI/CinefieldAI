import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QualitySignal } from "@/lib/routing/route-quality";
import type { QualitySignalProvider } from "@/lib/routing/route-quality";
import { qualitySignalFor } from "./eval-store";

/**
 * The real `QualitySignalProvider` implementation (Phase 22-D).
 *
 * `route-quality.ts` already declares this exact interface and ships
 * `NO_TRUSTED_QUALITY_SOURCE` as the only implementer — this is the second
 * one, reading Phase 22's own durable `model_eval_runs`/`model_eval_results`
 * instead of returning null unconditionally.
 *
 * ---------------------------------------------------------------------------
 * WHY WIRING THIS IN IS SAFE TODAY, BEFORE ANY BUSINESS DECISION IS MADE
 * ---------------------------------------------------------------------------
 * `DEFAULT_QUALITY_POLICY.trustedEvaluators` is `[]` — asserted by an
 * existing Phase 7-D test ("the trusted-evaluator allowlist must start
 * empty") that this batch does NOT touch. `normalizeQuality()` discards any
 * signal from an evaluator not on that allowlist as `"unknown"` regardless
 * of its score, and `scoreQuality()` scores `"unknown"` as a neutral 1 —
 * exactly like `NO_TRUSTED_QUALITY_SOURCE`'s permanent null. So swapping
 * this provider in at the real call site changes NOTHING about production
 * routing today; it only makes a real signal available for the day
 * `trustedEvaluators` deliberately includes `"cinefield-eval"` — a separate,
 * disclosed business decision this batch does not make (see
 * docs/security-gates.md's Phase 22 section).
 */
export class DurableEvalQualityProvider implements QualitySignalProvider {
  constructor(private readonly admin: SupabaseClient) {}

  async read(providerId: string, providerModelId: string): Promise<QualitySignal | null> {
    return qualitySignalFor(this.admin, providerId, providerModelId);
  }
}
