import type { BudgetOutcome } from "@/lib/slo/error-budget";

/**
 * Phase 21-D — the canary/SLO guardrail decision.
 *
 * ---------------------------------------------------------------------------
 * A PURE DECISION LAYER, THE SAME SHAPE AS `cost-guard.ts`
 * ---------------------------------------------------------------------------
 * `src/lib/finops/cost-guard.ts` (Phase 15-B) is real, tested, and has no
 * automated caller yet — it RECOMMENDS, and `docs/security-gates.md` records
 * plainly that whether an automated signal may act unattended "has not been
 * decided by anyone." This module is built to the same honest shape:
 * `evaluateCanaryGuardrail()` is a pure function over Phase 15-A's own
 * `BudgetOutcome` (`src/lib/slo/error-budget.ts`, not a second SLO type
 * invented here), returning a decision — never itself flipping a flag,
 * calling `writeFlag`, or reaching Supabase.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TRIGGER IS NOT ALSO BUILT THIS BATCH
 * ---------------------------------------------------------------------------
 * The roadmap's 21-D done-criterion is "Regression rollout'u otomatik geri
 * alıyor" — a regression automatically rolls back. "Automatically" means an
 * unattended, periodic caller. `src/trigger/operational/operational-tasks.ts`
 * states outright that every Trigger.dev task in this repository is
 * `task()`, never `schedules.task()` — no live cron exists anywhere in this
 * codebase to invoke anything unattended. Wiring one here would be standing
 * up new scheduled infrastructure inside a batch whose own scope forbids
 * exactly that without explicit authorization. See
 * `docs/security-gates.md`'s Phase 21 section for this classified as
 * `LIVE_DEFERRED`.
 *
 * ---------------------------------------------------------------------------
 * NO PERCENTAGE-ROLLOUT FLAG EXISTS IN `flag-registry.ts` EITHER
 * ---------------------------------------------------------------------------
 * All four Phase-21-owned flags (`maintenance_mode`, `feature.video.enabled`,
 * `uploads.enabled`, `release_stage`) are binary/enum kill switches, not
 * gradual feature rollouts — Cinefield has no product surface today that
 * ships behind a percentage rollout. Inventing one to exercise this module
 * would be the fabricated future product surface this phase's own scope
 * forbids. This function is deliberately generic over ANY named target so a
 * real future rollout can call it without this file changing.
 */

export type CanaryGuardrailDecision = "CONTINUE" | "ROLLBACK" | "HOLD";

export interface CanaryGuardrailResult {
  readonly decision: CanaryGuardrailDecision;
  readonly reasonCode: string;
  readonly targetKey: string;
}

/**
 * `budget` is Phase 15-A's own `computeErrorBudget()` output — reused
 * verbatim, never re-derived. `exhausted === true` is the one signal this
 * function treats as a regression; every other outcome holds or continues.
 */
export function evaluateCanaryGuardrail(targetKey: string, budget: BudgetOutcome): CanaryGuardrailResult {
  if (!budget.ok) {
    // An unresolvable SLO signal is not silently treated as healthy — but it
    // is also not itself a proven regression, so this HOLDS rather than
    // rolling back on missing data.
    return { decision: "HOLD", reasonCode: `slo_unavailable_${budget.error}`, targetKey };
  }

  if (budget.value.exhausted) {
    return { decision: "ROLLBACK", reasonCode: "error_budget_exhausted", targetKey };
  }

  return { decision: "CONTINUE", reasonCode: "within_error_budget", targetKey };
}
