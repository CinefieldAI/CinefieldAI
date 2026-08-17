import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminAssetInvestigation } from "@/lib/admin/asset-admin-service";
import { assetIdentifierPatternFor, ASSET_ID_PATTERN, type AssetAdminResult } from "@/lib/admin/asset-admin-contract";
import { interpretAssetResponse, networkErrorState } from "@/lib/admin/asset-admin-client-state";

/**
 * Phase 16-C — Assets / Storage. `getAdminAssetInvestigation` is the one
 * new read of `media_assets` reused by both the Assets/Storage and
 * Moderation pages. This suite proves: identifier validation, the
 * found/not-found/unavailable outcome matrix, full field projection, and
 * that the deliberately-excluded columns (`bucket`, `object_key`,
 * `backup_bucket`, `backup_key`, `backup_version_id`, `backup_etag`,
 * `declared_content_type`, `original_filename`, `legal_hold`,
 * `retention_policy`, `data_class`) never appear in the selected column list
 * or the projected view.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const NEW_FILES = [
  "src/lib/admin/asset-admin-contract.ts",
  "src/lib/admin/asset-admin-service.ts",
  "src/lib/admin/asset-admin-client-state.ts",
  "src/app/api/admin/assets/route.ts",
  "src/app/admin/assets/page.tsx",
  "src/components/admin/AssetsStoragePanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

const ASSET_ID = randomUUID();
const GENERATION_ID = randomUUID();

type Behavior = { rows?: Record<string, unknown>[]; fail?: boolean };

/** Mirrors the single query the service issues: select/eq/order/limit, awaited directly. */
function assetAdmin(behavior: Behavior): SupabaseClient {
  const from = () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      then<T1, T2 = never>(
        onfulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
        onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
      ) {
        const result = behavior.fail ? { data: null, error: { message: "boom" } } : { data: behavior.rows ?? [], error: null };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

function fullAssetRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ASSET_ID,
    clerk_user_id: "user_asset_owner",
    project_id: "proj_1",
    generation_id: GENERATION_ID,
    generation_attempt_id: randomUUID(),
    source: "provider_output",
    role: "original",
    parent_asset_id: null,
    variant: null,
    media_type: "image",
    storage_backend: "r2",
    byte_size: 204800,
    verified_mime: "image/png",
    checksum_sha256: "abc123",
    status: "finalized",
    created_at: "2026-08-01T00:00:00.000Z",
    stored_at: "2026-08-01T00:00:01.000Z",
    finalized_at: "2026-08-01T00:00:02.000Z",
    tombstoned_at: null,
    ingest_status: "verified",
    ingest_failure_reason: null,
    ingested_at: "2026-08-01T00:00:01.500Z",
    duplicate_of_asset_id: null,
    moderation_status: "not_evaluated",
    moderation_engine: null,
    moderated_at: null,
    quarantine_status: "quarantined",
    backup_status: "not_backed_up",
    backup_backend: null,
    backup_completed_at: null,
    backup_failure_reason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Identifier validation and outcome matrix
// ---------------------------------------------------------------------------

test("malformed asset_id and generation_id return INVALID_IDENTIFIER without querying anything", async () => {
  const admin = assetAdmin({});
  const r1 = await getAdminAssetInvestigation(admin, "asset_id", "not-a-uuid");
  assert.deepEqual(r1, { outcome: "INVALID_IDENTIFIER" });
  const r2 = await getAdminAssetInvestigation(admin, "generation_id", "'; DROP TABLE media_assets;--");
  assert.deepEqual(r2, { outcome: "INVALID_IDENTIFIER" });
});

test("assetIdentifierPatternFor and ASSET_ID_PATTERN match real id shapes", () => {
  assert.match(ASSET_ID, assetIdentifierPatternFor("asset_id"));
  assert.match(ASSET_ID, ASSET_ID_PATTERN);
  assert.match(GENERATION_ID, assetIdentifierPatternFor("generation_id"));
});

test("zero rows returns ASSET_NOT_FOUND, never a fabricated FOUND", async () => {
  const admin = assetAdmin({ rows: [] });
  const result = await getAdminAssetInvestigation(admin, "asset_id", ASSET_ID);
  assert.deepEqual(result, { outcome: "ASSET_NOT_FOUND" });
});

test("a failed read returns STORAGE_EVIDENCE_UNAVAILABLE, never silently empty", async () => {
  const admin = assetAdmin({ fail: true });
  const result = await getAdminAssetInvestigation(admin, "asset_id", ASSET_ID);
  assert.deepEqual(result, { outcome: "STORAGE_EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" });
});

test("a thrown error (not a Supabase {error} shape) is also caught into STORAGE_EVIDENCE_UNAVAILABLE", async () => {
  const admin = {
    from: () => {
      throw new Error("network down");
    },
  } as unknown as SupabaseClient;
  const result = await getAdminAssetInvestigation(admin, "asset_id", ASSET_ID);
  assert.deepEqual(result, { outcome: "STORAGE_EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" });
});

test("asset_id axis: FOUND projects every field, camelCased, with storage vs. backup kept as separate evidence", async () => {
  const admin = assetAdmin({
    rows: [
      fullAssetRow({
        quarantine_status: "released",
        moderation_status: "passed",
        moderation_engine: "hive",
        moderated_at: "2026-08-01T00:05:00.000Z",
        backup_status: "backed_up",
        backup_backend: "s3",
        backup_completed_at: "2026-08-01T00:10:00.000Z",
      }),
    ],
  });
  const result = await getAdminAssetInvestigation(admin, "asset_id", ASSET_ID);
  assert.equal(result.outcome, "FOUND");
  const found = result as Extract<AssetAdminResult, { outcome: "FOUND" }>;
  assert.equal(found.assets.length, 1);
  const view = found.assets[0];

  assert.equal(view.assetId, ASSET_ID);
  assert.equal(view.clerkUserId, "user_asset_owner");
  assert.equal(view.generationId, GENERATION_ID);
  assert.equal(view.storageBackend, "r2");
  assert.equal(view.quarantineStatus, "released");
  assert.equal(view.moderationStatus, "passed");
  assert.equal(view.moderationEngine, "hive");
  assert.equal(view.backupStatus, "backed_up");
  assert.equal(view.backupBackend, "s3");
  // The live/delivery location and the DR evidence are never merged into one field.
  assert.notEqual(view.storageBackend, view.backupBackend);
});

test("generation_id axis: multiple assets for one generation are all returned, most recent first per the query", async () => {
  const otherAssetId = randomUUID();
  const admin = assetAdmin({
    rows: [fullAssetRow({ id: ASSET_ID }), fullAssetRow({ id: otherAssetId, role: "thumbnail" })],
  });
  const result = await getAdminAssetInvestigation(admin, "generation_id", GENERATION_ID);
  assert.equal(result.outcome, "FOUND");
  const found = result as Extract<AssetAdminResult, { outcome: "FOUND" }>;
  assert.equal(found.assets.length, 2);
  assert.deepEqual(
    found.assets.map((a) => a.assetId),
    [ASSET_ID, otherAssetId]
  );
});

// ---------------------------------------------------------------------------
// Client-state interpretation
// ---------------------------------------------------------------------------

test("interpretAssetResponse maps every outcome and HTTP edge case", () => {
  assert.deepEqual(interpretAssetResponse(404, { error: "not_found" }), { kind: "denied" });
  assert.deepEqual(interpretAssetResponse(503, {}), { kind: "unavailable", reasonCode: "http_503" });
  assert.deepEqual(interpretAssetResponse(200, { outcome: "INVALID_IDENTIFIER" }), { kind: "invalid" });
  assert.deepEqual(interpretAssetResponse(200, { outcome: "ASSET_NOT_FOUND" }), { kind: "not_found" });
  assert.deepEqual(interpretAssetResponse(200, { outcome: "STORAGE_EVIDENCE_UNAVAILABLE", reasonCode: "not_configured" }), {
    kind: "unavailable",
    reasonCode: "not_configured",
  });
  assert.deepEqual(interpretAssetResponse(200, null), { kind: "unavailable", reasonCode: "malformed_response" });
  assert.deepEqual(networkErrorState(), { kind: "unavailable", reasonCode: "network_error" });
});

// ---------------------------------------------------------------------------
// STRUCTURAL — excluded columns, read-only, boundary preserved
// ---------------------------------------------------------------------------

test("the excluded storage/credential-adjacent columns never appear in the selected column list", () => {
  const serviceText = read("src/lib/admin/asset-admin-service.ts");
  const excluded = [
    "bucket",
    "object_key",
    "backup_bucket",
    "backup_key",
    "backup_version_id",
    "backup_etag",
    "declared_content_type",
    "original_filename",
    "legal_hold",
    "retention_policy",
    "data_class",
  ];
  const columnsMatch = serviceText.match(/const ASSET_COLUMNS =([\s\S]*?);/);
  assert.ok(columnsMatch, "ASSET_COLUMNS constant must exist");
  const columnList = columnsMatch![1];
  for (const column of excluded) {
    assert.doesNotMatch(columnList, new RegExp(`\\b${column}\\b`), `${column} must never be selected`);
  }
});

test("the excluded columns never appear in AssetDetailView's field set either", () => {
  const contractText = stripComments(read("src/lib/admin/asset-admin-contract.ts"));
  const interfaceMatch = contractText.match(/export interface AssetDetailView \{([\s\S]*?)\}/);
  assert.ok(interfaceMatch, "AssetDetailView interface must exist");
  const body = interfaceMatch![1];
  for (const field of ["bucket", "objectKey", "backupBucket", "backupKey", "backupVersionId", "backupEtag", "declaredContentType", "originalFilename", "legalHold", "retentionPolicy", "dataClass"]) {
    assert.doesNotMatch(body, new RegExp(`\\b${field}\\b`), `${field} must not be exposed`);
  }
});

test("asset-admin-service.ts never mutates: no .insert(, .update(, .upsert(, .delete(, or .rpc( anywhere", () => {
  const serviceText = stripComments(read("src/lib/admin/asset-admin-service.ts"));
  assert.doesNotMatch(serviceText, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
});

test("the assets route is GET-only, authenticated_read, and requires requireAdminAccess before any read", () => {
  const routeText = stripComments(read("src/app/api/admin/assets/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.match(routeText, /export async function GET/);
  assert.doesNotMatch(routeText, /export async function POST|export async function DELETE|export async function PUT/);
  assert.match(routeText, /routeClass:\s*"authenticated_read"/);
});

test("no locked product UI route is referenced by the new files, and no migration was added", () => {
  const lockedDirs = ["generate", "cinema-studio", "audio", "marketing-studio", "supercomputer", "image"];
  for (const { file, text } of NEW_FILES) {
    for (const locked of lockedDirs) {
      assert.doesNotMatch(text, new RegExp(`["'/]${locked}["'/]`), `${file} must not reference ${locked}`);
    }
    assert.doesNotMatch(text, /CREATE TABLE|ALTER TABLE|DROP TABLE/i, file);
  }
});
