import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { readGenerationAttemptWindow } from "@/lib/admin/slo-cost-admin-service";
import { evaluateSlo } from "@/lib/slo/slo-snapshot";
import {
  observeGenerationLatency,
  observeGenerationSuccess,
  observeGenerationTimeouts,
} from "@/lib/slo/slo-adapters";

/**
 * Phase 16-D SLO/Cost Guard.
 *
 * NOTE ON WHAT IS AND IS NOT EXERCISED HERE. `getAdminSloCost` calls
 * `runEstimatedSpendGuard()` and Phase 13's `readiness()` with their
 * DEFAULT dependencies (deliberately — it calls Phase 15-A/15-B's real
 * production entry points verbatim, not a test seam), and this repository's
 * `.env.local` carries REAL Supabase credentials. Calling the full service
 * end-to-end from a test would therefore make a live network call — exactly
 * what this repository's own zero-cost E2E convention forbids (see
 * `fake-supabase.ts`'s header and every other Phase 16 admin test, which
 * stops at structural assertions for the same reason —
 * `phase-16-1-admin-health.e2e.test.ts` never calls `collectAdminHealth()`
 * directly either). This suite instead behaviourally tests the ONE piece of
 * new logic this package wrote — `readGenerationAttemptWindow` — against an
 * injected fake, and proves via structural assertion that the SLO/Cost
 * arithmetic itself is Phase 15-A/15-B's own, never reimplemented.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/slo-cost-admin-contract.ts",
  "src/lib/admin/slo-cost-admin-service.ts",
  "src/lib/admin/slo-cost-admin-client-state.ts",
  "src/app/api/admin/slo-cost/route.ts",
  "src/app/admin/slo-cost/page.tsx",
  "src/components/admin/SloCostPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

/**
 * A minimal fake query chain, same style
 * `phase-15b2-estimated-spend.e2e.test.ts` already uses for this exact
 * `.select().gte().lt().in().limit()` shape: the shared `FakeSupabaseClient`
 * (`fake-supabase.ts`) does not implement `gte`/`lt`, so a purpose-built
 * chain that hands back canned rows (as if the server had already filtered
 * them) is what proves THIS module's counting/percentile logic, without
 * reimplementing Postgres range filtering in a test double.
 */
function fakeAttemptsAdmin(result: { data?: unknown[]; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "gte", "lt", "in"]) {
    chain[method] = () => chain;
  }
  chain.limit = async () => ({ data: result.data ?? null, error: result.error ?? null });
  return { from: () => chain } as never;
}

// ===========================================================================
// readGenerationAttemptWindow — the one new repository read
// ===========================================================================

test("readGenerationAttemptWindow: counts succeeded/failed/timedOut correctly, and p95 over succeeded latencies", async () => {
  const admin = fakeAttemptsAdmin({
    data: [
      { status: "succeeded", error_code: null, latency_ms: 100 },
      { status: "succeeded", error_code: null, latency_ms: 200 },
      { status: "failed", error_code: "PROVIDER_TIMEOUT", latency_ms: null },
      { status: "failed", error_code: "PROVIDER_ERROR", latency_ms: null },
    ],
  });

  const counts = await readGenerationAttemptWindow(admin, "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  assert.equal(counts.succeeded, 2);
  assert.equal(counts.failed, 2);
  assert.equal(counts.timedOut, 1);
  assert.equal(counts.sourceAvailable, true);
  assert.equal(counts.p95LatencyMs, 200, "p95 over 2 succeeded latencies picks the higher one");
});

test("readGenerationAttemptWindow: an empty window is a real zero, not unavailable", async () => {
  const admin = fakeAttemptsAdmin({ data: [] });
  const counts = await readGenerationAttemptWindow(admin, "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  assert.deepEqual(counts, { succeeded: 0, failed: 0, timedOut: 0, p95LatencyMs: null, sourceAvailable: true });
});

test("readGenerationAttemptWindow: a read failure is sourceAvailable:false, never a silent zero", async () => {
  const admin = fakeAttemptsAdmin({ error: { message: "boom" } });
  const counts = await readGenerationAttemptWindow(admin, "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
  assert.equal(counts.sourceAvailable, false);
});

// ===========================================================================
// Wiring proof: my adapters feed evaluateSlo() correctly (Phase 15-A's own arithmetic)
// ===========================================================================

test("wiring: observeGenerationSuccess + evaluateSlo report INSUFFICIENT_DATA below minimumSamples(20), never a false HEALTHY", () => {
  const counts = { succeeded: 5, failed: 0, timedOut: 0, p95LatencyMs: null, sourceAvailable: true };
  const snapshot = evaluateSlo(observeGenerationSuccess(counts, "medium"), "2026-01-01T00:00:00.000Z");
  assert.equal(snapshot.state, "INSUFFICIENT_DATA");
});

test("wiring: a source-unavailable read produces UNAVAILABLE, never a fabricated ratio", () => {
  const counts = { succeeded: 0, failed: 0, timedOut: 0, p95LatencyMs: null, sourceAvailable: false };
  const snapshot = evaluateSlo(observeGenerationTimeouts(counts, "medium"), "2026-01-01T00:00:00.000Z");
  assert.equal(snapshot.state, "UNAVAILABLE");
});

test("wiring: latency p95 with no succeeded samples is UNAVAILABLE (observeGenerationLatency's own sourceAvailable rule), never a fabricated zero", () => {
  const counts = { succeeded: 0, failed: 0, timedOut: 0, p95LatencyMs: null, sourceAvailable: true };
  const snapshot = evaluateSlo(observeGenerationLatency(counts, "medium"), "2026-01-01T00:00:00.000Z");
  assert.equal(snapshot.state, "UNAVAILABLE");
  assert.equal(snapshot.observedValue, null);
});

// ===========================================================================
// structural: real reuse, no reimplementation, no fake unified truth
// ===========================================================================

test("evaluateSlo (Phase 15-A) and runEstimatedSpendGuard (Phase 15-B) are called, never reimplemented", () => {
  const serviceText = read("src/lib/admin/slo-cost-admin-service.ts");
  assert.match(serviceText, /evaluateSlo\(/);
  assert.match(serviceText, /runEstimatedSpendGuard\(/);
  assert.doesNotMatch(serviceText, /function evaluateSlo|function computeErrorBudget|function computeBurnRate/);
});

test("no second SLO calculator, no second cost guard: the SLI catalogue and cost budgets are imported, never redefined", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /SLI_CATALOGUE\s*=\s*\{|SLO_TARGETS\s*=\s*\{|COST_BUDGETS\s*=\s*\[/, file);
  }
});

test("cost guard never merges with Phase 10's billing ledger", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /credit_price_per_unit|credit_ledger|credit_wallets|Stripe/i, file);
  }
});

test("no mutation of any kind exists in the SLO/Cost Guard surface", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(|setRoutingControl|clearRoutingControl/, file);
  }
});

test("the route reuses the one canonical admin auth boundary and is GET-only", () => {
  const routeText = stripComments(read("src/app/api/admin/slo-cost/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.match(routeText, /export async function GET/);
  assert.doesNotMatch(routeText, /export async function POST/);
});

test("no locked product UI route is referenced by the new files", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
  }
});

test("no migration file was added for this surface", () => {
  for (const { file, text } of NEW_FILES) {
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE/i, file);
  }
});
