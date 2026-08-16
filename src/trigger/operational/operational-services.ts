import "server-only";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { getProviderHealth } from "@/lib/redis/provider-health-store";
import { getProviderLatency } from "@/lib/redis/provider-latency-store";
import { getProviderErrorRate } from "@/lib/redis/provider-error-rate-store";
import { getActivePricing } from "@/lib/pricing/pricing-repository";
import { listModels } from "@/lib/orchestration/model-registry";
import { COST_BUDGETS } from "@/lib/finops/cost-budget";
import {
  emptyPlatformModelResolution,
  readAttemptVolumes,
  resolvePlatformModelIds,
  type SpendWindow,
} from "@/lib/finops/estimated-spend-repository";
import { runSpendGuard, spendGuardMetrics } from "@/lib/finops/spend-guard-runner";
import type { PricingRecord } from "@/lib/pricing/pricing-types";
import { runRestoreValidation } from "@/lib/dr/restore-verification-engine";
import { alertOnRestoreEvidence } from "@/lib/dr/dr-alert-bridge";
import { DURABLE_TABLES } from "@/lib/dr/restore-evidence-contract";
import type {
  ChecksumItem,
  RestoreEvidence,
  RowCountItem,
} from "@/lib/dr/restore-evidence-contract";
import type { RestoreEvidenceSource } from "@/lib/dr/restore-target";
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
  /**
   * The restore target to validate, or `null` when none is wired up.
   *
   * Defaults to `() => null` — Phase 15-C/1 ships the engine and the
   * contract, not a live adapter. No Docker harness, no staging project and
   * no Supabase Dashboard client is reachable from here, so the honest
   * default is "not configured", exactly like `isDrConfigured()` for the
   * Phase 9-D backup path.
   */
  getRestoreEvidenceSource: () => RestoreEvidenceSource | null;
}

export const defaultOperationalDeps: OperationalDeps = {
  isAdminConfigured: isSupabaseAdminConfigured,
  getAdmin: getSupabaseAdminClient,
  getProviderHealth,
  getProviderLatency,
  getProviderErrorRate,
  getActivePricing,
  listModels,
  getRestoreEvidenceSource: () => null,
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
 * Real restore-verification logic (Phase 15-C/1).
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT PERFORM A RESTORE. IT VALIDATES ONE.
 * ---------------------------------------------------------------------------
 * "Restoring" — triggering PostgreSQL PITR, standing up an isolated instance,
 * copying an S3 object back to R2 — is external and/or a later slice's work.
 * This function's only job is: given a restore target that says it is ready,
 * does its data actually agree with the canonical database? BACKUP_EXISTS is
 * not RESTORE_SUCCEEDED, and RESTORE_STARTED is not RESTORE_VALIDATED — this
 * is the function that tells the two apart.
 *
 * `deps.getRestoreEvidenceSource()` is `null` by default, so on an unmodified
 * deployment this reports `NOT_CONFIGURED` honestly — the same shape the
 * previous stub reported, but now because nothing is wired up rather than
 * because nothing was written. Wiring a real adapter (a throwaway-Postgres
 * reader, a future staging-project reader) is future work; this function
 * already refuses correctly the moment one exists but is unsafe, unready, or
 * disagrees with the canonical database.
 *
 * "Expected" row counts and checksums are read from the CANONICAL database
 * (`deps.getAdmin()`), read-only, exactly like `countBackupDebt` already
 * does. Reading production is not the risk here — writing to, or dispatching
 * side effects from, the RESTORE TARGET is, and this function's only write
 * of any kind is the bounded 13-D alert on a proven failure.
 */
export async function runRestoreVerification(
  input?: OperationalTaskInput,
  deps: OperationalDeps = defaultOperationalDeps
): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();

  const source = deps.getRestoreEvidenceSource();
  if (!source) {
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "restore_target_not_configured" });
  }

  if (!deps.isAdminConfigured()) {
    // The canonical database is what "expected" is read from. Without it
    // there is nothing to validate the restore target AGAINST, which is a
    // different unavailability than "no restore target exists".
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "supabase_admin_not_configured" });
  }

  try {
    const admin = deps.getAdmin();
    const limit = resolveLimit(input);

    const expectedRowCounts = await readExpectedRowCounts(admin);
    if (!expectedRowCounts) {
      return buildResult(startedAt, "unavailable", {}, { reasonCode: "expected_row_count_read_failed" });
    }

    const expectedChecksums = await readExpectedChecksums(admin, limit);
    if (!expectedChecksums) {
      return buildResult(startedAt, "unavailable", {}, { reasonCode: "expected_checksum_read_failed" });
    }

    const evidence = await runRestoreValidation({
      source,
      expectedRowCounts,
      expectedChecksums,
      startedAt: new Date(startedAt),
    });

    alertOnRestoreEvidence(evidence);

    return buildResult(startedAt, statusFor(evidence.state), metricsFor(evidence), {
      reasonCode: evidence.reasonCode,
    });
  } catch (caught) {
    return buildResult(startedAt, "failed", {}, { reasonCode: toSafeReasonCode(caught) });
  }
}

/**
 * "Expected" row counts, read from the canonical database. `count: "exact",
 * head: true` — the same shape `countBackupDebt` already uses — returns a
 * number without a single row crossing the network.
 */
async function readExpectedRowCounts(
  admin: ReturnType<typeof getSupabaseAdminClient>
): Promise<RowCountItem[] | null> {
  const items: RowCountItem[] = [];
  for (const entry of DURABLE_TABLES) {
    const { count, error } = await admin.from(entry.table).select("*", { count: "exact", head: true });
    if (error || typeof count !== "number") return null;
    items.push({ table: entry.table, rowCount: count });
  }
  return items;
}

/**
 * A bounded sample of `checksum_sha256` from the most recently backed-up
 * assets. Backup eligibility (Phase 9-D) already requires
 * `ingest_status = 'verified'`, which the 9-B ingest gate's own constraint
 * requires alongside a non-null `checksum_sha256` — so every row this reads
 * is guaranteed to carry one.
 */
async function readExpectedChecksums(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  limit: number
): Promise<ChecksumItem[] | null> {
  const { data, error } = await admin
    .from("media_assets")
    .select("id, checksum_sha256")
    .eq("backup_status", "backed_up")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return null;

  const rows = (data ?? []) as { id: string; checksum_sha256: string | null }[];
  return rows
    .filter((row): row is { id: string; checksum_sha256: string } => typeof row.checksum_sha256 === "string")
    .map((row) => ({ subjectId: row.id, expectedDigest: row.checksum_sha256 }));
}

function statusFor(state: RestoreEvidence["state"]): OperationalTaskResult["status"] {
  switch (state) {
    case "VALIDATION_PASSED":
      return "success";
    case "VALIDATION_FAILED":
      return "failed";
    case "NOT_CONFIGURED":
    case "UNAVAILABLE":
    case "RESTORE_NOT_READY":
    default:
      return "unavailable";
  }
}

/** Bounded counts only — never a row, a table name list, or a digest. */
function metricsFor(evidence: RestoreEvidence): Record<string, number> {
  const metrics: Record<string, number> = {};
  if (evidence.rowCount) {
    metrics.rowCountTablesChecked = evidence.rowCount.results.length;
    metrics.rowCountTablesMatched = evidence.rowCount.results.filter((r) => r.outcome === "MATCH").length;
  }
  if (evidence.checksum) {
    metrics.checksumsChecked = evidence.checksum.results.length;
    metrics.checksumsMatched = evidence.checksum.results.filter((r) => r.outcome === "MATCH").length;
  }
  if (evidence.referentialIntegrity) {
    metrics.invalidConstraints = evidence.referentialIntegrity.invalidConstraintCount ?? 0;
  }
  return metrics;
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

// ---------------------------------------------------------------------------
// ESTIMATED SPEND GUARD (PHASE 15-B/2)
// ---------------------------------------------------------------------------

/**
 * Prices one window of provider traffic against the configured cost budgets
 * and raises a Phase 13-D alert if the strictest applicable budget is under
 * pressure.
 *
 * THE PRODUCTION CALLER for the Phase 15-B cost model. Everything it consumes
 * already existed: `readAttemptVolumes` counts attempts, the model registry
 * maps a provider model id to ours, `getActivePricing` supplies the price, and
 * `runSpendGuard` does the arithmetic and the alerting. This function is the
 * wiring, and it is deliberately thin.
 *
 * ===========================================================================
 * WHAT IT DOES NOT DO
 * ===========================================================================
 * It submits nothing, spends nothing, and disables nothing. It does not write
 * `generation_attempts.cost_amount` — no actual provider cost evidence exists
 * to write, and a forecast in that column would be indistinguishable from a
 * bill forever after. It does not call `setRoutingControl`: the guard produces
 * a RECOMMENDATION naming a Phase 7 target, and whether an automated cost
 * signal may take a provider offline unattended is a question nobody has
 * answered yet.
 *
 * It also does not decide WHEN to run. The window comes from the payload, and
 * `estimatedSpendGuardTask` is a plain `task()` with no schedule, for the same
 * reason every other operational task here has none.
 *
 * ===========================================================================
 * UNCERTAINTY IS REPORTED, NOT SMOOTHED
 * ===========================================================================
 * `unavailable` is a correct outcome. An unreadable attempt window, an
 * unreadable price and a model whose billing unit cannot be mapped from
 * current data all resolve to a non-ALLOW verdict rather than to a cheerful
 * zero. Today most image models are `per_output` and no output-count evidence
 * exists, so a real window will usually report unpriceable lines — that is the
 * honest state of the data, and `unpriceableLines` is in the metrics so it is
 * visible rather than inferred.
 */
export async function runEstimatedSpendGuard(
  input?: SpendGuardTaskInput,
  deps: OperationalDeps = defaultOperationalDeps
): Promise<OperationalTaskResult> {
  const startedAt = new Date().toISOString();

  if (!deps.isAdminConfigured()) {
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "supabase_admin_not_configured" });
  }

  const window = resolveSpendWindow(input, startedAt);
  if (!window) {
    return buildResult(startedAt, "unavailable", {}, { reasonCode: "invalid_spend_window" });
  }

  try {
    const volumes = await readAttemptVolumes(deps.getAdmin(), window, resolveLimit(input));

    // ---- identity resolution: static catalogue first, canonical join second
    //
    // Nested maps rather than a joined string key: any separator character is
    // one a provider id or a model id could legitimately contain, and that is
    // a silent collision between two models' spend.
    const registry = new Map<string, Map<string, string>>();
    for (const model of deps.listModels()) {
      const models = registry.get(model.providerId) ?? new Map<string, string>();
      models.set(model.providerModelId, model.id);
      registry.set(model.providerId, models);
    }

    // Phase 15-B/3, F4. An attempt records `routing?.providerId ?? providerId`,
    // so a Phase 7 route override writes the ROUTE's identity — which need not
    // appear in the static catalogue. Those pairs are resolved through the
    // canonical tables the router itself used, and only those: the join is
    // attempted for pairs the catalogue missed, never as a replacement for it.
    const missing = volumes.volumes.filter((v) => !registry.get(v.provider)?.has(v.providerModelId));
    const routed =
      missing.length > 0
        ? await resolvePlatformModelIds(deps.getAdmin(), missing)
        : emptyPlatformModelResolution("no_unresolved_pairs");

    const platformModelIdFor = (v: { provider: string; providerModelId: string }): string | null =>
      registry.get(v.provider)?.get(v.providerModelId) ??
      routed.byProviderModel.get(v.provider)?.get(v.providerModelId) ??
      null;

    // Pricing is read here, up front, so `runSpendGuard` stays pure. A failed
    // read flips one flag for the whole pass rather than being mistaken for a
    // set of individually unpriced models.
    const pricing = new Map<string, PricingRecord | null>();
    let pricingSourceAvailable = true;
    for (const volume of volumes.volumes) {
      const platformModelId = platformModelIdFor(volume);
      if (!platformModelId || pricing.has(platformModelId)) continue;
      try {
        pricing.set(platformModelId, await deps.getActivePricing(platformModelId));
      } catch {
        pricingSourceAvailable = false;
        break;
      }
    }

    const outcome = runSpendGuard({
      volumes,
      platformModelIdFor,
      pricingFor: (platformModelId) => pricing.get(platformModelId) ?? null,
      pricingSourceAvailable,
      budgets: COST_BUDGETS,
      now: new Date(startedAt),
    });

    const metrics = spendGuardMetrics(outcome);

    if (!volumes.sourceAvailable || !pricingSourceAvailable) {
      return buildResult(startedAt, "unavailable", metrics, {
        reasonCode: pricingSourceAvailable ? volumes.reasonCode : "pricing_source_unavailable",
      });
    }
    if (outcome.lineCount === 0) {
      return buildResult(startedAt, "no_work", metrics, { reasonCode: "empty_window" });
    }
    // A window that could not be fully priced is PARTIAL, not success. The
    // distinction matters: success would read as "this window is within
    // budget" when part of it was never costed at all.
    if (outcome.unpriceableLineCount > 0) {
      return buildResult(startedAt, "partial", metrics, { reasonCode: outcome.guard.reasonCode });
    }
    return buildResult(startedAt, "success", metrics, { reasonCode: outcome.guard.reasonCode });
  } catch (caught) {
    return buildResult(startedAt, "failed", {}, { reasonCode: toSafeReasonCode(caught) });
  }
}

/** Bounded window input. Explicit bounds, or a lookback ending now. */
export interface SpendGuardTaskInput extends OperationalTaskInput {
  windowStart?: string;
  windowEnd?: string;
  /** Used only when explicit bounds are absent. Bounded by MAX_LOOKBACK_HOURS. */
  lookbackHours?: number;
}

/** Default and ceiling for the lookback. A window, never a cadence. */
export const DEFAULT_LOOKBACK_HOURS = 24;
export const MAX_LOOKBACK_HOURS = 24 * 31;

function resolveSpendWindow(input: SpendGuardTaskInput | undefined, nowIso: string): SpendWindow | null {
  if (input?.windowStart && input?.windowEnd) {
    const start = Date.parse(input.windowStart);
    const end = Date.parse(input.windowEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString() };
  }

  const hours = input?.lookbackHours ?? DEFAULT_LOOKBACK_HOURS;
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_LOOKBACK_HOURS) return null;

  const end = Date.parse(nowIso);
  if (!Number.isFinite(end)) return null;
  return {
    windowStart: new Date(end - hours * 3_600_000).toISOString(),
    windowEnd: new Date(end).toISOString(),
  };
}
