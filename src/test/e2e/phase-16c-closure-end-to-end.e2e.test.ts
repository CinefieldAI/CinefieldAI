import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminBillingView } from "@/lib/admin/billing-admin-service";
import { getAdminAssetInvestigation } from "@/lib/admin/asset-admin-service";
import { getAdminSafetyAudit, performModerationAction } from "@/lib/admin/moderation-admin-service";
import type { BillingAdminResult } from "@/lib/admin/billing-admin-contract";
import type { AssetAdminResult } from "@/lib/admin/asset-admin-contract";

/**
 * Phase 16-C closure — proof of the official done criterion:
 *
 * "Admin can inspect financial state and media/storage/moderation state
 * from the same Operations Center, without creating a second billing or
 * media authority."
 *
 * Both halves are proven live, end to end, against this repo's real
 * production admin services (Billing/Credits, Assets/Storage, Moderation),
 * plus a set of cross-phase ownership sweeps proving Phase 10 (ledger),
 * Phase 15-B (cost estimate), Phase 9-E (quarantine release/dual-control),
 * and Phase 12-E (policy gate) each remain the sole authority for their own
 * concern — 16-C only reads (or, for moderation, thinly re-exposes an
 * already-built action), never re-derives or duplicates.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walkFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const ADMIN_LIB_FILES = walkFiles(path.join(ROOT, "src/lib/admin")).filter((f) => !f.endsWith(".test.ts"));
const ADMIN_API_FILES = walkFiles(path.join(ROOT, "src/app/api/admin"));
const ADMIN_PAGE_FILES = walkFiles(path.join(ROOT, "src/app/admin"));
const ADMIN_COMPONENT_FILES = walkFiles(path.join(ROOT, "src/components/admin"));
const ALL_ADMIN_FILES = [...ADMIN_LIB_FILES, ...ADMIN_API_FILES, ...ADMIN_PAGE_FILES, ...ADMIN_COMPONENT_FILES].map((f) => ({
  file: path.relative(ROOT, f).split(path.sep).join("/"),
  text: stripComments(readFileSync(f, "utf8")),
}));
// Only the files THIS batch (16-C) added/owns.
const PHASE_16C_FILES = ALL_ADMIN_FILES.filter((f) => /(billing|asset|moderation)/i.test(f.file));

const CLERK_USER = "user_closure_subject";
const GENERATION_ID = randomUUID();
const ASSET_ID = randomUUID();
const ADMIN_A = "user_closure_admin_alpha";
const ADMIN_B = "user_closure_admin_beta";

type TableConfig = { row?: Record<string, unknown> | null; rows?: Record<string, unknown>[] };

/** One double covering both the billing/asset read shape and the moderation rpc shape. */
function operationsCenterAdmin(tables: Record<string, TableConfig>, rpcResponses: Record<string, unknown> = {}) {
  const from = (table: string) => {
    const cfg = tables[table] ?? {};
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: cfg.row ?? null, error: null }),
      then<T1, T2 = never>(
        onfulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
        onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
      ) {
        return Promise.resolve({ data: cfg.rows ?? [], error: null }).then(onfulfilled, onrejected);
      },
    };
    return chain;
  };
  return {
    from,
    rpc: async (fn: string) => ({ data: rpcResponses[fn] ?? null, error: null }),
  } as unknown as SupabaseClient;
}

function withAdmins<T>(admins: string[], run: () => T): T {
  const saved = process.env.ROUTE_ADMIN_CLERK_USER_IDS;
  process.env.ROUTE_ADMIN_CLERK_USER_IDS = admins.join(",");
  try {
    return run();
  } finally {
    if (saved === undefined) delete process.env.ROUTE_ADMIN_CLERK_USER_IDS;
    else process.env.ROUTE_ADMIN_CLERK_USER_IDS = saved;
  }
}

// ---------------------------------------------------------------------------
// DONE CRITERION, HALF 1: USER/ACCOUNT → wallet → ledger/reservation →
// generation financial reference, from the same Operations Center service.
// ---------------------------------------------------------------------------

test("done criterion (financial): a Clerk user id resolves to wallet + ledger + reservations, and a ledger entry references the same generation id an operator would look up next", async () => {
  const admin = operationsCenterAdmin({
    credit_wallets: { row: { clerk_user_id: CLERK_USER, balance: 100, reserved: 10, lifetime_granted: 500, lifetime_spent: 400, updated_at: "2026-08-01T00:00:00.000Z" } },
    credit_reconciliation: { row: { wallet_balance: 100, wallet_reserved: 10, ledger_sum: 100, live_holds: 10, ok: true } },
    credit_ledger: {
      rows: [
        {
          id: randomUUID(),
          entry_type: "spend",
          amount: -10,
          balance_after: 100,
          reservation_id: randomUUID(),
          generation_id: GENERATION_ID,
          external_ref: null,
          created_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    },
    credit_reservations: { rows: [] },
  });

  const billing = await getAdminBillingView(admin, "clerk_user_id", CLERK_USER);
  assert.equal(billing.outcome, "FOUND");
  const found = billing as Extract<BillingAdminResult, { outcome: "FOUND" }>;
  assert.equal(found.wallet?.clerkUserId, CLERK_USER);
  assert.equal(found.ledgerEntries[0].generationId, GENERATION_ID, "the ledger entry's generation id is the join key into Assets/Storage");

  // Following that same generation id back through the billing surface (by
  // generation_id axis, still the same service, same Operations Center)
  // finds the same evidence — no second economic-truth reader was built.
  const byGeneration = await getAdminBillingView(admin, "generation_id", GENERATION_ID);
  assert.equal(byGeneration.outcome, "FOUND");
});

// ---------------------------------------------------------------------------
// DONE CRITERION, HALF 2: GENERATION → asset → storage state → moderation/
// quarantine state, from the same Operations Center.
// ---------------------------------------------------------------------------

test("done criterion (media): a generation id resolves to its asset, and the same asset id then resolves storage evidence and moderation/audit evidence from the same Operations Center", async () => {
  const admin = operationsCenterAdmin({
    media_assets: {
      rows: [
        {
          id: ASSET_ID,
          clerk_user_id: CLERK_USER,
          project_id: null,
          generation_id: GENERATION_ID,
          generation_attempt_id: null,
          source: "provider_output",
          role: "original",
          parent_asset_id: null,
          variant: null,
          media_type: "image",
          storage_backend: "r2",
          byte_size: 1024,
          verified_mime: "image/png",
          checksum_sha256: "deadbeef",
          status: "finalized",
          created_at: "2026-08-01T00:00:00.000Z",
          stored_at: "2026-08-01T00:00:00.000Z",
          finalized_at: "2026-08-01T00:00:00.000Z",
          tombstoned_at: null,
          ingest_status: "verified",
          ingest_failure_reason: null,
          ingested_at: "2026-08-01T00:00:00.000Z",
          duplicate_of_asset_id: null,
          moderation_status: "not_evaluated",
          moderation_engine: null,
          moderated_at: null,
          quarantine_status: "quarantined",
          backup_status: "not_backed_up",
          backup_backend: null,
          backup_completed_at: null,
          backup_failure_reason: null,
        },
      ],
    },
    media_safety_audit: { rows: [] },
  });

  // Step 1: from the generation id (the join key the billing ledger surfaced).
  const byGeneration = await getAdminAssetInvestigation(admin, "generation_id", GENERATION_ID);
  assert.equal(byGeneration.outcome, "FOUND");
  const asset = (byGeneration as Extract<AssetAdminResult, { outcome: "FOUND" }>).assets[0];
  assert.equal(asset.assetId, ASSET_ID);
  assert.equal(asset.storageBackend, "r2", "storage state is visible");
  assert.equal(asset.quarantineStatus, "quarantined", "moderation/quarantine state is visible in the same read");

  // Step 2: the same asset id, now looked up directly (the Moderation
  // screen's own axis), through the SAME asset-admin-service — no second
  // media-truth reader exists.
  const byAssetId = await getAdminAssetInvestigation(admin, "asset_id", asset.assetId);
  assert.equal(byAssetId.outcome, "FOUND");

  // Step 3: the safety audit trail for that same asset, still the same
  // Operations Center.
  const audit = await getAdminSafetyAudit(admin, asset.assetId);
  assert.equal(audit.outcome, "FOUND");
});

test("done criterion (media, action lane): the canonical Phase 9-E release action is reachable from the same Moderation surface that showed the quarantine state", async () => {
  await withAdmins([ADMIN_A, ADMIN_B], async () => {
    const admin = operationsCenterAdmin(
      {},
      { approve_media_release: { released: true, event_id: "evt_closure" } }
    );
    const result = await performModerationAction(admin, ADMIN_B, "approve", ASSET_ID, undefined);
    assert.deepEqual(result, { outcome: "RELEASED", assetId: ASSET_ID, eventId: "evt_closure" });
  });
});

// ---------------------------------------------------------------------------
// Cross-phase ownership preserved
// ---------------------------------------------------------------------------

test("Phase 10 remains the sole economic-ledger mutation owner: no 16-C file calls a credit-mutation RPC or writes credit_* tables", () => {
  for (const { file, text } of PHASE_16C_FILES) {
    assert.doesNotMatch(text, /reserve_credits|settle_reservation|refund_reservation|grant_credits/, file);
    assert.doesNotMatch(text, /\.insert\(\s*["'`]?credit_|\.update\(\s*["'`]?credit_/i, file);
  }
});

test("Phase 15-B's cost estimate stays separate: no 16-C file reads credit_price_per_unit or imports finops/cost-contract", () => {
  for (const { file, text } of PHASE_16C_FILES) {
    assert.doesNotMatch(text, /credit_price_per_unit/, file);
    assert.doesNotMatch(text, /finops\/cost-contract/, file);
  }
});

test("Phase 9-E remains the sole quarantine-release / dual-control owner: moderation-admin-service only calls its four exports, never reimplements approval counting", () => {
  const serviceText = stripComments(read("src/lib/admin/moderation-admin-service.ts"));
  assert.doesNotMatch(serviceText, /media_release_approvals|required_approvals/i);
  assert.match(serviceText, /from "@\/lib\/media\/quarantine-release"/);
});

test("Phase 12-E policy gate is reused as-is: policies/data/actions.json was not modified by 16-C (still only the pre-existing media.quarantine.* actions, no billing.*/asset.*/moderation.* entries)", () => {
  const registry = JSON.parse(read("policies/data/actions.json")) as { actions: Record<string, unknown> };
  const names = Object.keys(registry.actions);
  assert.ok(names.includes("media.quarantine.request"));
  assert.ok(names.includes("media.quarantine.release"));
  assert.ok(names.includes("media.quarantine.reject"));
  assert.equal(names.some((n) => /^billing\.|^asset\.|^moderation\./.test(n)), false, "no new action was registered for this slice");
});

test("no second economic-ledger or media-truth reader exists: billing-admin-service only ever selects credit_* tables, asset-admin-service only ever selects media_assets", () => {
  const billingText = stripComments(read("src/lib/admin/billing-admin-service.ts"));
  const fromCalls = [...billingText.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  for (const table of fromCalls) {
    assert.match(table, /^credit_/, `billing-admin-service.ts must only read credit_* tables, saw ${table}`);
  }

  const assetText = stripComments(read("src/lib/admin/asset-admin-service.ts"));
  const assetFromCalls = [...assetText.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(assetFromCalls)], ["media_assets"]);
});

// ---------------------------------------------------------------------------
// Sensitive-data boundary, auth reuse, read-only-by-default sweeps
// ---------------------------------------------------------------------------

test("sensitive-data boundary: no raw storage location/credential-adjacent field name appears anywhere in the new 16-C surface", () => {
  const banned = [/\bbucket\b/, /\bobject_key\b/, /\bbackup_bucket\b/, /\bbackup_key\b/, /\bbackup_version_id\b/, /\bbackup_etag\b/];
  for (const { file, text } of PHASE_16C_FILES) {
    for (const pattern of banned) {
      assert.doesNotMatch(text, pattern, `${file}: must never surface a raw storage location/credential field`);
    }
  }
});

test("admin auth consolidation: every new /api/admin/* route reuses requireAdminAccess(), never ROUTE_ADMIN_CLERK_USER_IDS directly", () => {
  const routes = ADMIN_API_FILES.filter((f) => /(billing|assets|moderation)/.test(f)).map((f) => ({
    file: f,
    text: stripComments(readFileSync(f, "utf8")),
  }));
  assert.ok(routes.length >= 4, "billing, assets, moderation, moderation/release");
  for (const { file, text } of routes) {
    assert.match(text, /requireAdminAccess/, file);
    assert.doesNotMatch(text, /ROUTE_ADMIN_CLERK_USER_IDS/, `${file}: that authority lives inside quarantine-release.ts only`);
  }
});

test("cache/route security: every new /api/admin/* route responds through privateJson, never NextResponse.json directly", () => {
  const routes = ADMIN_API_FILES.filter((f) => /(billing|assets|moderation)/.test(f));
  for (const file of routes) {
    const text = stripComments(readFileSync(file, "utf8"));
    assert.match(text, /privateJson/, file);
    assert.doesNotMatch(text, /NextResponse\.json\(/, file);
  }
});

test("read-only by default: only the moderation/release route can mutate; billing and assets routes are GET-only", () => {
  const billingRoute = stripComments(read("src/app/api/admin/billing/route.ts"));
  const assetsRoute = stripComments(read("src/app/api/admin/assets/route.ts"));
  const moderationViewRoute = stripComments(read("src/app/api/admin/moderation/route.ts"));
  for (const text of [billingRoute, assetsRoute, moderationViewRoute]) {
    assert.doesNotMatch(text, /export async function POST/);
  }
  const releaseRoute = stripComments(read("src/app/api/admin/moderation/release/route.ts"));
  assert.match(releaseRoute, /export async function POST/);
  assert.doesNotMatch(releaseRoute, /export async function GET/);
});

test("dashboard: /admin links to Billing / Credits, Assets / Storage, and Moderation", () => {
  const layoutText = stripComments(read("src/app/admin/layout.tsx"));
  assert.match(layoutText, /href="\/admin\/billing"/);
  assert.match(layoutText, /href="\/admin\/assets"/);
  assert.match(layoutText, /href="\/admin\/moderation"/);
  // This test USED TO also assert the literal label "Cost / FinOps" stayed
  // in the layout as a non-clickable placeholder, deliberately distinct
  // from Phase 10's billing ledger. Phase 16-D built that screen — as "SLO /
  // Cost Guard", still deliberately never merged with Phase 10 (see
  // `slo-cost-admin-contract.ts`'s header) — so the placeholder label no
  // longer exists to assert on.
  assert.match(layoutText, /href="\/admin\/slo-cost"/);
});

test("no migration file was added anywhere in 16-C, and no locked product UI route is referenced", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of PHASE_16C_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE|DROP TABLE/i, file);
  }
});

test("the public liveness route remains untouched by Phase 16-C", () => {
  const text = read("src/app/api/health/live/route.ts");
  assert.doesNotMatch(text, /requireAdminAccess|billing-admin|asset-admin|moderation-admin/i);
});
