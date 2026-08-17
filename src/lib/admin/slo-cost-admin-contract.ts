import type { SloSnapshot } from "@/lib/slo/slo-snapshot";
import type { OperationalTaskResult } from "@/trigger/operational/operational-task-contract";

/**
 * Phase 16-D SLO/Cost Guard admin contract — read-only.
 *
 * ---------------------------------------------------------------------------
 * SLO: PHASE 15-A'S OWN ARITHMETIC, FED REAL OBSERVATIONS
 * ---------------------------------------------------------------------------
 * Every `SloSnapshot` below is produced by calling Phase 15-A's own
 * `evaluateSlo()` UNCHANGED (`src/lib/slo/slo-snapshot.ts`) — this package
 * computes no second opinion about a ratio, a budget, or a burn rate. What
 * 16-D adds is exactly what Phase 15-A's own header says is missing: "Phase
 * 15-A owns definitions and arithmetic. Nothing else" — no production
 * caller fed it real data before this. `slo-cost-admin-service.ts` reads
 * each SLI's named canonical source (`generation_attempts` for the three
 * generation SLIs, Phase 13 `readiness()` for `dependency_readiness` and
 * `app_availability`, the existing `realtime_outbox_debt()` RPC for
 * `realtime_debt_age`, Phase 7's provider health store for
 * `provider_reliability`) and hands the result to `evaluateSlo` — never
 * re-deriving what "healthy" or "ready" means.
 *
 * `app_availability` deliberately, honestly resolves to
 * `INSUFFICIENT_DATA`: this repository does not persist a rolling history
 * of readiness evaluations (doing so would be new persistence, which
 * section 20 of the 16-D spec says to avoid absent a real done-criterion
 * requiring it), so only a single current observation is fed in — below the
 * SLI's own `minimumSamples: 10`. `evaluateSlo` reaches that state on its
 * own; nothing here special-cases it.
 *
 * ---------------------------------------------------------------------------
 * COST GUARD: PHASE 15-B'S OWN PRODUCTION ENTRY POINT, CALLED VERBATIM
 * ---------------------------------------------------------------------------
 * `costGuard` below is `runEstimatedSpendGuard()`
 * (`src/trigger/operational/operational-services.ts`) — the SAME function
 * `estimatedSpendGuardTask` calls, called with its default deps and default
 * 24-hour lookback. Its `OperationalTaskResult` is already documented as
 * "safe to log and to surface in an ops dashboard" (bounded counts only,
 * never content), so it is forwarded as-is. This never merges with Phase
 * 10's billing ledger — see `cost-contract.ts`'s own boundary.
 */

export const SLO_WINDOW_HOURS = 1;

export type SloCostAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | {
      readonly outcome: "FOUND";
      readonly slo: readonly SloSnapshot[];
      readonly costGuard: OperationalTaskResult;
    };
