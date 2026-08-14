import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateDrEnv, isDrConfigured, DEFAULT_DR_REGION } from "@/lib/media/dr-config";
import {
  buildBackupKey,
  backupAsset,
  runDrBackupPass,
  countBackupDebt,
} from "@/lib/media/dr-backup-service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 9-D. The property that carries this batch is an ownership boundary:
 * R2 stays canonical and S3 never becomes anything a user is served from.
 * Everything else — retry, verification, failure isolation — exists so a DR
 * problem stays a durability problem.
 *
 * No AWS call is made here. The S3 client is injected.
 */

const ROOT = process.cwd();
const ASSET = "44444444-4444-4444-8444-444444444444";
const OWNER = "user_9d_owner";

process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ??= "ak";
process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??= "sk";
process.env.CLOUDFLARE_R2_ENDPOINT ??= "https://account.r2.cloudflarestorage.com";
process.env.CLOUDFLARE_R2_BUCKET ??= "cinefield-media";

// ---------------------------------------------------------------------------
// 1–2. Configuration, and its separation from R2
// ---------------------------------------------------------------------------

test("1. DR configuration validates bucket and region", () => {
  assert.equal(validateDrEnv({ bucket: "cinefield-media-dr-dev", region: "eu-central-1" }), null);
  assert.equal(validateDrEnv({ bucket: undefined }), "missing_bucket");
  assert.equal(validateDrEnv({ bucket: "Bad_Bucket" }), "bucket_invalid");
  assert.equal(validateDrEnv({ bucket: "cinefield-media-dr-dev/evil" }), "bucket_invalid");
  assert.equal(
    validateDrEnv({ bucket: "cinefield-media-dr-dev", region: "not-a-region" }),
    "region_invalid"
  );
});

test("1b. DR is optional — absence is a valid deployment, not an error", () => {
  const saved = process.env.CINEFIELD_DR_S3_BUCKET;
  delete process.env.CINEFIELD_DR_S3_BUCKET;
  try {
    assert.equal(isDrConfigured(), false, "no bucket configured is simply no DR");
  } finally {
    if (saved !== undefined) process.env.CINEFIELD_DR_S3_BUCKET = saved;
  }
});

test("2. R2 and S3 credentials are entirely separate", () => {
  // Code only. Both headers NAME the R2 variables to explain that they are a
  // different credential set, so matching prose would fail on exactly the
  // documentation that exists to prevent this confusion.
  const strip = (file: string) =>
    readFileSync(path.join(ROOT, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const drConfig = strip("src/lib/media/dr-config.ts");
  const drClient = strip("src/lib/media/dr-backup-client.ts");

  // The DR side must not read a single Cloudflare variable...
  assert.ok(!/CLOUDFLARE_R2/.test(drConfig), "DR config must not read R2 credentials");
  assert.ok(!/CLOUDFLARE_R2/.test(drClient), "DR client must not read R2 credentials");

  // ...and must not read AWS access keys at all: the repository's rule is that
  // credentials come from the SDK chain, never from the environment.
  assert.ok(!/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(drConfig));
  assert.ok(!/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(drClient));

  const r2Config = strip("src/lib/media/r2-config.ts");
  assert.ok(!/CINEFIELD_DR|AWS_/.test(r2Config), "R2 config must not know about AWS");
});

test("2b. the DR region defaults to the locked production region", () => {
  assert.equal(DEFAULT_DR_REGION, "eu-central-1");
});

// ---------------------------------------------------------------------------
// 3–4. Backup key
// ---------------------------------------------------------------------------

test("3. the backup key is deterministic and derived from the canonical key", () => {
  const canonical = `quarantine/output/${OWNER}/${ASSET}/original.png`;
  const first = buildBackupKey(canonical);

  assert.equal(first, buildBackupKey(canonical), "same asset, same backup object");
  assert.ok(first.startsWith("dr/"), "DR objects are unmistakable inside the bucket");
  assert.ok(first.includes(OWNER), "tenant scoping is inherited from the canonical key");
  assert.ok(first.includes(ASSET));
});

test("4. nothing a client controls can reach the backup key", () => {
  // The canonical key is already server-generated and tenant-scoped (9-A), so
  // the derivation inherits that rather than reintroducing a choice.
  const source = readFileSync(path.join(ROOT, "src/lib/media/dr-backup-service.ts"), "utf8");
  const fn = source.slice(source.indexOf("export function buildBackupKey"), source.indexOf("async function readCanonicalObject"));

  assert.ok(!/filename|prompt|email|body\./i.test(fn));
  assert.ok(/canonicalKey/.test(fn), "the only input is the canonical key");
});

// ---------------------------------------------------------------------------
// 5. The source must be canonical R2
// ---------------------------------------------------------------------------

function drAdmin(recorded: { fn: string; args: Record<string, unknown> }[] = []) {
  const table = {
    select: () => table,
    eq: () => table,
    in: () => table,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return {
    from: () => table,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      recorded.push({ fn, args });
      if (fn === "record_media_backup") return { data: { recorded: true }, error: null };
      return { data: [], error: null };
    },
  } as unknown as SupabaseClient;
}

test("5. an asset that is not in the canonical bucket is refused", async () => {
  process.env.CINEFIELD_DR_S3_BUCKET = "cinefield-media-dr-dev";
  const calls: { fn: string; args: Record<string, unknown> }[] = [];

  const outcome = await backupAsset(drAdmin(calls), {
    assetId: ASSET,
    ownerId: OWNER,
    // Not the R2 bucket. A "backup" of something else is not a backup.
    bucket: "some-other-bucket",
    objectKey: "k/original.png",
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.status === "failed" && outcome.reason, "canonical_read_failed");
});

test("5b. with no DR configured the asset is SKIPPED, never failed", async () => {
  const saved = process.env.CINEFIELD_DR_S3_BUCKET;
  delete process.env.CINEFIELD_DR_S3_BUCKET;
  try {
    const outcome = await backupAsset(drAdmin(), {
      assetId: ASSET, ownerId: OWNER, bucket: "cinefield-media", objectKey: "k.png",
    });
    assert.equal(outcome.status, "skipped");
  } finally {
    if (saved !== undefined) process.env.CINEFIELD_DR_S3_BUCKET = saved;
  }
});

// ---------------------------------------------------------------------------
// 7–8. Verification
// ---------------------------------------------------------------------------

test("7/8. verification uses the byte count, and a mismatch fails", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/media/dr-backup-service.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function backupAsset"));

  assert.ok(/await headAssetBackup\(backupKey\)/.test(body), "PutObject returning is not proof");
  assert.ok(/head\.byteLength !== bytes\.byteLength/.test(body));
  assert.ok(/verification_failed/.test(body));

  // The ETag is recorded but must NOT be the criterion: for multipart or
  // SSE-KMS objects it is not an MD5 of the content.
  const verifyBlock = body.slice(body.indexOf("const head = await headAssetBackup"), body.indexOf("const recorded ="));
  assert.ok(!/etag/i.test(verifyBlock), "ETag must not decide verification");
});

test("8b. the schema documents the ETag as not-a-checksum", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260822000000_dr_backup_metadata.sql"), "utf8"
  );
  assert.ok(/NOT a content checksum/i.test(migration));
  assert.ok(/checksum_sha256/.test(migration), "and points at what content identity really is");
});

// ---------------------------------------------------------------------------
// 9–11. Retry, concurrency, recovery
// ---------------------------------------------------------------------------

test("9. a retry writes the SAME object rather than accumulating copies", () => {
  const canonical = `quarantine/output/${OWNER}/${ASSET}/original.png`;
  const keys = new Set([buildBackupKey(canonical), buildBackupKey(canonical), buildBackupKey(canonical)]);
  assert.equal(keys.size, 1);
});

test("10. concurrent workers cannot claim the same asset", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260822000000_dr_backup_metadata.sql"), "utf8"
  );
  const claim = migration.slice(migration.indexOf("claim_media_backups"));

  assert.ok(/FOR UPDATE SKIP LOCKED/.test(claim), "single-winner claim");
  assert.ok(/backup_attempts = m\.backup_attempts \+ 1/.test(claim), "attempts counted");
  assert.ok(/backing_up' AND a\.created_at < v_cutoff/.test(claim), "a dead worker's lease expires");
});

test("11. a record failure after a successful PutObject is retried, not lost", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/media/dr-backup-service.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function backupAsset"));

  assert.ok(/record_failed/.test(body));
  // Safe precisely because the key is deterministic: the retry overwrites the
  // same object instead of creating a second copy.
  assert.ok(/if \(!recorded\)/.test(body));
});

test("only finalized AND verified assets are ever backed up", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260822000000_dr_backup_metadata.sql"), "utf8"
  );
  const claim = migration.slice(migration.indexOf("claim_media_backups"));

  assert.ok(/a\.status = 'finalized'/.test(claim));
  assert.ok(/a\.ingest_status = 'verified'/.test(claim),
    "spending durability on media the ingest gate refused would be backwards");
});

// ---------------------------------------------------------------------------
// 12–14. Failure isolation
// ---------------------------------------------------------------------------

test("12/13. a DR failure cannot touch the canonical asset or the provider", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/media/dr-backup-service.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.ok(!/PROVIDER_FAILED/.test(code), "an S3 outage is not a provider failure");
  assert.ok(!/circuit|breaker/i.test(code), "and must not reach the breaker");
  assert.ok(!/from\(["']generations["']\)/.test(code), "it cannot write generation state");
  assert.ok(!/markFailed|markCompleted/.test(code));
  assert.ok(!/deleteObject|DeleteObject/i.test(code), "and it cannot delete anything");
});

test("13b. the DR client has no delete capability at all", () => {
  const client = readFileSync(path.join(ROOT, "src/lib/media/dr-backup-client.ts"), "utf8");
  const imports = client.match(/^import .*$/gm)?.join("\n") ?? "";

  assert.ok(!/DeleteObjectCommand/.test(imports),
    "deleting a DR copy belongs to Phase 23 retention, not to a backup worker");
  assert.ok(/PutObjectCommand/.test(imports));
  assert.ok(/HeadObjectCommand/.test(imports));
  assert.ok(!/GetObjectCommand/.test(imports), "restore is a separate controlled operation");
});

test("14. the error taxonomy separates durability from media", async () => {
  const { OrchestrationError } = await import("@/lib/orchestration/errors");
  const drFailure = new OrchestrationError("DR_BACKUP_FAILED");
  const mediaFailure = new OrchestrationError("ASSET_STORAGE_FAILED");

  assert.notEqual(drFailure.code, mediaFailure.code);
  assert.equal(drFailure.retryable, true, "backup debt is retried");
  // The user-facing message must not suggest their generation failed.
  assert.ok(!/generated media/i.test(drFailure.message));
});

// ---------------------------------------------------------------------------
// 15–17. The ownership boundary
// ---------------------------------------------------------------------------

test("15. generation completion does not wait for a backup", () => {
  // Roadmap 9-D's criterion is a durability property of the asset, not a step
  // in the request path. Blocking completion on S3 would let an unrelated AWS
  // outage stop generation entirely.
  const orchestrator = readFileSync(path.join(ROOT, "src/lib/orchestration/orchestrator.ts"), "utf8");

  assert.ok(!/backupAsset|runDrBackupPass|dr-backup/.test(orchestrator),
    "the generation path must not know DR exists");
});

test("16. NO read path serves media from S3", () => {
  // The single most important property of this phase. S3 is disaster
  // recovery; a "helpful" fallback read is how a DR copy quietly becomes a
  // second production store nobody maintains.
  const files = [
    "src/lib/media/asset-service.ts",
    "src/lib/media/r2-client.ts",
    "src/lib/orchestration/orchestrator.ts",
    "src/lib/orchestration/output-storage.ts",
    "src/app/api/media/upload-url/route.ts",
  ];

  for (const file of files) {
    const code = readFileSync(path.join(ROOT, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/dr-backup|CINEFIELD_DR|backup_key/i.test(code), `${file} must not read the DR copy`);
  }
});

test("16b. there is no R2-unavailable fallback to S3", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/media/dr-backup-service.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The service reads FROM R2 and writes TO S3. It exposes nothing that reads
  // back from S3, so no caller can use it as a substitute store.
  assert.ok(!/export .*restore/i.test(code), "restore is a documented contract, not code yet");
  assert.ok(!/getObject|GetObject/.test(code));
});

test("17. R2 and DR clients are separate modules with separate state", () => {
  const drClient = readFileSync(path.join(ROOT, "src/lib/media/dr-backup-client.ts"), "utf8");
  const r2Client = readFileSync(path.join(ROOT, "src/lib/media/r2-client.ts"), "utf8");

  assert.ok(!/r2-client|r2-config/.test(drClient.match(/^import .*$/gm)?.join("\n") ?? ""));
  assert.ok(!/dr-config|dr-backup/.test(r2Client));
  assert.ok(/__resetDrClientForTesting/.test(drClient), "its own cached client");
  assert.ok(/__resetR2ClientForTesting/.test(r2Client));
});

// ---------------------------------------------------------------------------
// 18–20. Secrets, browser authority, dependencies
// ---------------------------------------------------------------------------

test("18. no AWS secret is read, stored, serialized or logged", () => {
  for (const file of [
    "src/lib/media/dr-config.ts",
    "src/lib/media/dr-backup-client.ts",
    "src/lib/media/dr-backup-service.ts",
  ]) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(/^import "server-only";/m.test(source), `${file} must be server-only`);
    assert.ok(!/NEXT_PUBLIC/.test(source));
    assert.ok(!/console\.(log|info|warn|error)/.test(source), "nothing here logs at all");
    assert.ok(!/secretAccessKey|aws_secret/i.test(source));
  }
});

test("15b/19. a browser cannot mutate backup state, and restore is protected", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260822000000_dr_backup_metadata.sql"), "utf8"
  );

  assert.ok(/REVOKE ALL ON FUNCTION "public"."record_media_backup"[\s\S]{0,220}"authenticated"/.test(migration));
  assert.ok(/REVOKE ALL ON FUNCTION "public"."claim_media_backups"[\s\S]{0,160}"authenticated"/.test(migration));
  assert.ok(/GRANT EXECUTE ON FUNCTION "public"."record_media_backup"[\s\S]{0,220}"service_role"/.test(migration));

  // No API route exposes DR at all.
  const routes = readFileSync(path.join(ROOT, "src/app/api/media/upload-url/route.ts"), "utf8");
  assert.ok(!/backup|restore|dr_/i.test(routes));
});

test("20. DR does not depend on BullMQ or Redis B", () => {
  // 9-C is deferred on Redis B specifically. DR backup is also not derived
  // media: losing a thumbnail job is cosmetic, losing every backup silently
  // is not, so the claim lives in PostgreSQL.
  const source = readFileSync(path.join(ROOT, "src/lib/media/dr-backup-service.ts"), "utf8");
  const imports = source.match(/^import .*$/gm)?.join("\n") ?? "";

  assert.ok(!/bullmq|redis/i.test(imports));
  assert.ok(/claim_media_backups/.test(source), "the durable intent is a PostgreSQL claim");
});

test("a backed-up row must say where the copy is", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260822000000_dr_backup_metadata.sql"), "utf8"
  );
  const constraint = migration.slice(
    migration.indexOf("media_assets_backup_consistency"),
    migration.indexOf("media_assets_backup_backend_check")
  );

  assert.ok(/backup_backend" IS NOT NULL/.test(constraint));
  assert.ok(/backup_bucket" IS NOT NULL/.test(constraint));
  assert.ok(/backup_key" IS NOT NULL/.test(constraint));
  assert.ok(/backup_completed_at" IS NOT NULL/.test(constraint));
});

test("a backup pass with no DR configured does nothing at all", async () => {
  const saved = process.env.CINEFIELD_DR_S3_BUCKET;
  delete process.env.CINEFIELD_DR_S3_BUCKET;
  try {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const result = await runDrBackupPass(drAdmin(calls));
    assert.equal(result.skipped, true);
    assert.equal(calls.length, 0, "not even a claim");
  } finally {
    if (saved !== undefined) process.env.CINEFIELD_DR_S3_BUCKET = saved;
  }
});

test("backup debt is queryable for operations", async () => {
  const table = {
    select: () => table,
    eq: () => table,
    in: async () => ({ count: 7, error: null }),
  };
  const admin = { from: () => table } as unknown as SupabaseClient;

  assert.equal(await countBackupDebt(admin), 7);
});
