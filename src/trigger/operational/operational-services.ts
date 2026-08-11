import "server-only";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { getProviderHealth } from "@/lib/redis/provider-health-store";
import { getProviderLatency } from "@/lib/redis/provider-latency-store";
import { getProviderErrorRate } from "@/lib/redis/provider-error-rate-store";
import { getActivePricing } from "@/lib/pricing/pricing-repository";
import { listModels } from "@/lib/orchestration/model-registry";
import {
  buildResult,
  resolveLimit,
  resolveMode,
  toSafeReasonCode,
  type OperationalTaskInput,
  type OperationalTaskResult,
} from "./operational-task-contract";

/**
 * Cinefield operational service implementations (Phase 6R.11).
 *
 * The actual logic behind each Trigger.dev operational task, kept separate
 * from the Trigger `task()` wrappers so it can be unit-tested with injected
 * fakes and zero SDK involvement — the same separation
 * `generation-task.ts` already uses by delegating to `executeGeneration`.
 *
 * ===========================================================================
 * WHAT THESE FUNCTIONS MAY NOT DO
 * ===========================================================================
 * None of them submits a provider generation, finalizes a generation,
 * bypasses Temporal, spends credits, calls a paid provider, deletes a
 * storage object, or performs a restore. Several deliberately report
 * `unavailable` instead of inventing an answer — that is a correct
 * outcome, not a gap being papered over.
 */

/** Injected collaborators, so every service is testable with no Supabase/Redis connection. */
export interface OperationalDeps {
  isAdminConfigured: () => boolean;
  getAdmin: () => ReturnType<typeof getSupabaseAdminClient>;
  getProviderHealth: typeof getProviderHealth;
  getProviderLatency: typeof getProviderLatency;
  getProviderErrorRate: typeof getProviderErrorRate;
  getActivePricing: typeof getActivePricing;
  listModels: typeof listModels;
}

export const defaultOperationalDeps: OperationalDeps = {
  isAdminConfigured: isSupabaseAdminConfigured,
  getAdmin: getSupabaseAdminClient,
  getProviderHealth,
  getProviderLatency,
  getProviderErrorRate,
  getActivePricing,
  listModels,
};

// ---------------------------------------------------------------------------
// PROVIDER HEALTH
// ---------------------------------------------------------------------------

/**
 * Reports the operational telemetry Cinefield ALREADY holds for each
 * registered provider (Redis A: health, latency, error-rate).
 *
 * DELIBERATELY PASSIVE. It does not probe a provider. Active probing would
 * mean a real network call to fal.ai/Cloudflare — potentially billable, and
 * outside this phase's zero-cost boundary — so this task reads recorded
 * observations only. A provider with no recorded telemetry is reported as
 * having no data; that is the honest answer, never a synthesized "healthy".
 */
export async function runProviderHealthAudit(
  input?: OperationalTaskInput,
  deps: OperationalDeps = defaultOperationalDeps
): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();

  try {
    const providers = [...new Set(deps.listModels().map((m) => m.providerId))];
    let withHealth = 0;
    let withLatency = 0;
    let withErrorRate = 0;
    let telemetryUnavailable = 0;
    const noTelemetry: string[] = [];

    for (const providerId of providers) {
      const health = await deps.getProviderHealth(providerId);
      const latency = await deps.getProviderLatency(providerId);
      const errorRate = await deps.getProviderErrorRate(providerId);

      if (health !== null) withHealth += 1;
      if (latency.outcome === "available") withLatency += 1;
      if (errorRate.outcome === "available") withErrorRate += 1;

      if (latency.outcome === "unavailable" || errorRate.outcome === "unavailable") {
        telemetryUnavailable += 1;
      } else if (health === null && latency.outcome === "no_data" && errorRate.outcome === "no_data") {
        noTelemetry.push(providerId);
      }
    }

    const metrics = {
      providers: providers.length,
      withHealth,
      withLatency,
      withErrorRate,
      withoutTelemetry: noTelemetry.length,
    };

    // Redis itself unreachable for every provider: report unavailable rather
    // than "all providers have no data", which would read as a real finding.
    if (telemetryUnavailable === providers.length && providers.length > 0) {
      return buildResult(startedAt, "unavailable", metrics, { reasonCode: "telemetry_store_unavailable" });
    }
    if (telemetryUnavailable > 0) {
      return buildResult(startedAt, "partial", metrics, { reasonCode: "telemetry_partially_unavailable" });
    }
    if (withHealth === 0 && withLatency === 0 && withErrorRate === 0) {
      return buildResult(startedAt, "no_work", metrics, { flagged: noTelemetry });
    }
    return buildResult(startedAt, "success", metrics, { flagged: noTelemetry });
  } catch (caught) {
    return buildResult(startedAt, "failed", {}, { reasonCode: toSafeReasonCode(caught) });
  }
}

// ---------------------------------------------------------------------------
// GENERATION RECONCILIATION
// ---------------------------------------------------------------------------

/**
 * Finds generations whose durable state looks stuck, and flags them.
 *
 * NEVER RESUBMITS. This is the single most dangerous operational job to get
 * wrong, so it is detect-only by construction — there is no repair branch,
 * no provider call, and no Temporal signal here. It specifically respects
 * the existing ambiguity protection: an attempt carrying
 * `submission_evidence = 'ambiguous'` means a provider job MAY exist and
 * may already be billed, so it is counted separately and explicitly NOT
 * treated as retryable. Deciding what to do about a flagged generation
 * stays with a human or with Temporal's own machinery.
 *
 * Terminal generations are ignored outright — a finished generation is not
 * a reconciliation candidate no matter how old it is.
 */
export async function runGenerationReconcile(
  input?: OperationalTaskInput,
  deps: OperationalDeps = defaultOperationalDeps
): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();
  const limit = resolveLimit(input);

  if (!deps.isAdminConfigured()) {
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "supabase_admin_not_configured" });
  }

  try {
    const admin = deps.getAdmin();
    // Only non-terminal rows are candidates; terminal generations are done.
    const { data, error } = await admin
      .from("generations")
      .select("id, status, updated_at")
      .in("status", ["queued", "processing"])
      .limit(limit);

    if (error) {
      return buildResult(startedAt, "unavailable", {}, { reasonCode: "generation_query_failed" });
    }

    const rows = (data ?? []) as { id: string; status: string }[];
    if (rows.length === 0) {
      return buildResult(startedAt, "no_work", { scanned: 0, flagged: 0, ambiguous: 0 });
    }

    const flagged: string[] = [];
    let ambiguous = 0;

    for (const row of rows) {
      const { data: attempts } = await admin
        .from("generation_attempts")
        .select("id, status, submission_evidence")
        .eq("generation_id", row.id);

      const attemptRows = (attempts ?? []) as { submission_evidence: string; status: string }[];

      // Ambiguous evidence: a provider job may exist and may be billed.
      // Counted, never queued for retry — this is exactly the protection
      // recordAmbiguousSubmission exists to provide.
      if (attemptRows.some((a) => a.submission_evidence === "ambiguous")) {
        ambiguous += 1;
        continue;
      }

      // A non-terminal generation with no active attempt is genuinely stuck.
      const hasActiveAttempt = attemptRows.some((a) =>
        ["pending", "claimed", "submitting", "submitted", "processing"].includes(a.status)
      );
      if (!hasActiveAttempt) flagged.push(row.id);
    }

    const metrics = { scanned: rows.length, flagged: flagged.length, ambiguous };
    if (flagged.length === 0 && ambiguous === 0) {
      return buildResult(startedAt, "no_work", metrics);
    }
    return buildResult(startedAt, "success", metrics, { flagged });
  } catch (caught) {
    return buildResult(startedAt, "failed", {}, { reasonCode: toSafeReasonCode(caught) });
  }
}

// ---------------------------------------------------------------------------
// CREDIT AUDIT
// ---------------------------------------------------------------------------

/**
 * Reads the credit system's OWN reconciliation view
 * (`credit_reconciliation`, defined in 20260811120000_credit_system.sql)
 * and reports wallets whose ledger and balance disagree.
 *
 * The invariants are the migration's, not this task's — it computes
 * nothing, invents no expected amount, and never grants, spends, or
 * adjusts credits. Repair mode reuses exactly one existing, already
 * idempotent service (`expire_stale_reservations`), which returns held
 * credits for reservations whose generation never finished; it does not
 * touch balances directly.
 */
export async function runCreditAudit(
  input?: OperationalTaskInput,
  deps: OperationalDeps = defaultOperationalDeps
): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();
  const mode = resolveMode(input);
  const limit = resolveLimit(input);

  if (!deps.isAdminConfigured()) {
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "supabase_admin_not_configured" });
  }

  try {
    const admin = deps.getAdmin();
    const { data, error } = await admin
      .from("credit_reconciliation")
      .select("clerk_user_id, ok")
      .eq("ok", false)
      .limit(limit);

    if (error) {
      return buildResult(startedAt, "unavailable", {}, { reasonCode: "reconciliation_view_unavailable" });
    }

    const mismatched = (data ?? []) as { clerk_user_id: string }[];
    const metrics: Record<string, number> = { mismatched: mismatched.length };

    if (mode === "repair") {
      // The ONLY repair permitted: an existing idempotent SQL function that
      // returns stranded held credits. No balance is written by this task.
      const { data: expired, error: expireError } = await admin.rpc("expire_stale_reservations", {
        p_limit: limit,
      });
      if (expireError) {
        return buildResult(startedAt, "partial", metrics, { reasonCode: "expire_stale_failed" });
      }
      metrics.expiredReservations = Number(expired ?? 0);
    }

    if (mismatched.length === 0) {
      return buildResult(startedAt, mode === "repair" ? "success" : "no_work", metrics);
    }
    // Wallet ids identify an account, so they are counted but not listed —
    // an operational result should not become a user roster.
    return buildResult(startedAt, "success", metrics, { reasonCode: "ledger_wallet_mismatch" });
  } catch (caught) {
    return buildResult(startedAt, "failed", {}, { reasonCode: toSafeReasonCode(caught) });
  }
}

// ---------------------------------------------------------------------------
// PROVIDER COST / PRICING RECONCILIATION
// ---------------------------------------------------------------------------

/**
 * Reports which orchestratable models have no active pricing record.
 *
 * NEVER INVENTS A PRICE. Phase E3B established that `model_pricing`
 * currently holds only the four mock rows at a verified $0 and that no real
 * fal.ai/Cloudflare price exists yet. This task surfaces exactly that gap:
 * every unpriced real model is counted and flagged, and mock models are
 * counted separately so their legitimate $0 is never mistaken for a
 * production cost. It performs no cost comparison it lacks the data to
 * make.
 */
export async function runProviderCostReconcile(
  input?: OperationalTaskInput,
  deps: OperationalDeps = defaultOperationalDeps
): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();

  if (!deps.isAdminConfigured()) {
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "supabase_admin_not_configured" });
  }

  try {
    const models = deps.listModels();
    const unpriced: string[] = [];
    let priced = 0;
    let mockPriced = 0;

    for (const model of models) {
      const pricing = await deps.getActivePricing(model.id);
      if (pricing === null) {
        unpriced.push(model.id);
        continue;
      }
      if (model.isMock) mockPriced += 1;
      else priced += 1;
    }

    const metrics = {
      models: models.length,
      pricedRealModels: priced,
      pricedMockModels: mockPriced,
      unpriced: unpriced.length,
    };

    if (unpriced.length === 0) return buildResult(startedAt, "no_work", metrics);
    // Unpriced real models are a genuine, reportable production gap.
    return buildResult(startedAt, "success", metrics, {
      reasonCode: "models_without_active_pricing",
      flagged: unpriced,
    });
  } catch (caught) {
    return buildResult(startedAt, "failed", {}, { reasonCode: toSafeReasonCode(caught) });
  }
}

// ---------------------------------------------------------------------------
// STORAGE CLEANUP (PLANNING ONLY)
// ---------------------------------------------------------------------------

/**
 * Identifies storage-cleanup CANDIDATES. It never deletes anything.
 *
 * There is deliberately no delete call in this function at all — not
 * behind a flag, not behind `mode: "repair"`. Cinefield has no storage
 * lifecycle/retention policy yet, and a cleanup job that can delete before
 * the policy defining "safe to delete" exists is how real user output gets
 * destroyed. Candidates here are generations that reached a terminal
 * failure yet still reference an output object — a narrow, well-defined
 * anomaly, reported for a human to act on.
 */
export async function runStorageCleanupPlan(
  input?: OperationalTaskInput,
  deps: OperationalDeps = defaultOperationalDeps
): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();
  const limit = resolveLimit(input);

  if (!deps.isAdminConfigured()) {
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "supabase_admin_not_configured" });
  }

  try {
    const admin = deps.getAdmin();
    const { data, error } = await admin
      .from("generations")
      .select("id, status, output_url")
      .in("status", ["failed", "cancelled"])
      .not("output_url", "is", null)
      .limit(limit);

    if (error) {
      return buildResult(startedAt, "unavailable", {}, { reasonCode: "generation_query_failed" });
    }

    const candidates = (data ?? []) as { id: string }[];
    const metrics = { candidates: candidates.length, deleted: 0 };

    if (candidates.length === 0) return buildResult(startedAt, "no_work", metrics);
    return buildResult(startedAt, "success", metrics, {
      reasonCode: "cleanup_candidates_detected_dry_run_only",
      flagged: candidates.map((c) => c.id),
    });
  } catch (caught) {
    return buildResult(startedAt, "failed", {}, { reasonCode: toSafeReasonCode(caught) });
  }
}

// ---------------------------------------------------------------------------
// RESTORE VERIFICATION
// ---------------------------------------------------------------------------

/**
 * Restore verification is NOT implemented, and says so.
 *
 * Cinefield has no backup/restore contract yet (Phase 15 owns DR). Rather
 * than pretend a verification ran — which would be worse than no check at
 * all, because an ops dashboard would show green — this task always
 * reports `unavailable` with an explicit reason. It exists so the
 * operational surface is honest about the gap and so a future phase has a
 * defined place to implement it.
 */
export async function runRestoreVerification(): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();
  return buildResult(startedAt, "unavailable", {}, { reasonCode: "restore_contract_not_implemented" });
}

// ---------------------------------------------------------------------------
// SECURITY ANALYSIS
// ---------------------------------------------------------------------------

/**
 * Aggregates existing durable signals into a report. It takes no action.
 *
 * No blocking, no suspension, no risk scoring, no OPA decision — Phases
 * 12/19 own those, and inventing a scoring algorithm here would create an
 * unreviewed policy that could lock out real users. This reports one
 * concrete, already-durable signal: attempts stuck with ambiguous
 * submission evidence, which is both a billing risk and an integrity
 * signal worth a human's attention.
 */
export async function runSecurityAnalyze(
  input?: OperationalTaskInput,
  deps: OperationalDeps = defaultOperationalDeps
): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();
  const limit = resolveLimit(input);

  if (!deps.isAdminConfigured()) {
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "supabase_admin_not_configured" });
  }

  try {
    const admin = deps.getAdmin();
    const { data, error } = await admin
      .from("generation_attempts")
      .select("id, submission_evidence")
      .eq("submission_evidence", "ambiguous")
      .limit(limit);

    if (error) {
      return buildResult(startedAt, "unavailable", {}, { reasonCode: "attempt_query_failed" });
    }

    const ambiguous = (data ?? []) as { id: string }[];
    const metrics = { ambiguousAttempts: ambiguous.length, actionsTaken: 0 };

    if (ambiguous.length === 0) return buildResult(startedAt, "no_work", metrics);
    return buildResult(startedAt, "success", metrics, {
      reasonCode: "ambiguous_submissions_present",
      flagged: ambiguous.map((a) => a.id),
    });
  } catch (caught) {
    return buildResult(startedAt, "failed", {}, { reasonCode: toSafeReasonCode(caught) });
  }
}
