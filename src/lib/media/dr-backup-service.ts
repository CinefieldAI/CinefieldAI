import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getR2Config } from "./r2-config";
import { getDrConfig, isDrConfigured } from "./dr-config";
import { putAssetBackup, headAssetBackup } from "./dr-backup-client";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * R2 → S3 disaster-recovery backup (Phase 9-D).
 *
 * ASYNCHRONOUS, AND THAT IS THE DESIGN. A generation completes on R2 plus a
 * verified ingest; it does not wait for a second copy. The roadmap's 9-D
 * criterion is "Örnek asset'in S3 DR kopyası doğrulanıyor" — a durability
 * property of the asset, not a step in the request path. Blocking completion
 * on S3 would hand an unrelated AWS outage the power to stop generation
 * entirely, which is the opposite of what a backup is for.
 *
 * THE DIRECTION IS FIXED: R2 canonical → read → S3 copy → verify → record.
 * Never provider → S3, never browser → S3. S3 receives bytes that R2 already
 * holds and the ingest gate already approved, so a backup can never introduce
 * media that was refused.
 *
 * A DR FAILURE IS A DURABILITY PROBLEM, NEVER A MEDIA PROBLEM. It does not
 * fail the generation, does not touch the provider, does not trip a circuit
 * breaker, and cannot alter the canonical object. The worst it produces is
 * backup debt, which is visible in `backup_status` and retried.
 */

/** Non-secret failure codes. Persisted and read by operators. */
export type BackupFailure =
  | "dr_not_configured"
  | "canonical_read_failed"
  | "s3_write_failed"
  | "verification_failed"
  | "record_failed";

export interface BackupCandidate {
  assetId: string;
  ownerId: string;
  bucket: string;
  objectKey: string;
  declaredContentType?: string | null;
  byteSize?: number | null;
}

export type BackupOutcome =
  | { status: "backed_up"; assetId: string; backupKey: string; byteLength: number }
  | { status: "failed"; assetId: string; reason: BackupFailure }
  | { status: "skipped"; assetId: string; reason: "dr_not_configured" };

/**
 * Derives the DR key from the canonical one.
 *
 * Deterministic and total: the same asset always maps to the same backup
 * object, so a retry overwrites rather than accumulating copies, and an
 * operator holding a canonical key can find its backup without a lookup. The
 * prefix keeps DR objects unmistakable inside a bucket that should contain
 * nothing else.
 *
 * The canonical key is already server-generated and tenant-scoped (9-A), so
 * this inherits those properties rather than re-deriving them — there is no
 * point at which a client influences either.
 */
export function buildBackupKey(canonicalKey: string): string {
  return `dr/${canonicalKey}`;
}

/**
 * Reads the canonical bytes from R2 through a short-lived signed GET.
 *
 * Kept here rather than in the DR client on purpose: the DR client must not
 * know how to reach R2, and this function must not know how to write S3.
 * Neither can accidentally become a bridge that treats one store as the
 * other.
 */
async function readCanonicalObject(objectKey: string): Promise<Uint8Array | null> {
  const { createPresignedDownload } = await import("./r2-client");
  try {
    const { downloadUrl } = await createPresignedDownload({ objectKey, expiresInSeconds: 120 });
    const response = await fetch(downloadUrl);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Backs up one asset and verifies the copy.
 *
 * "Verified" means S3 answered a HeadObject with the byte count we wrote. The
 * ETag is recorded but NOT used as the criterion: for multipart or SSE-KMS
 * objects it is not an MD5 of the content, so treating it as content identity
 * would be wrong precisely where it matters. Content identity is the Phase
 * 9-B `checksum_sha256` over the canonical bytes, which both copies share by
 * construction — the same bytes were written.
 */
export async function backupAsset(
  admin: SupabaseClient,
  candidate: BackupCandidate
): Promise<BackupOutcome> {
  if (!isDrConfigured()) {
    // Not an error. A deployment without DR still stores, serves and
    // completes media correctly; it simply has no second copy.
    return { status: "skipped", assetId: candidate.assetId, reason: "dr_not_configured" };
  }

  // The source must be the canonical store. A backup of anything else would
  // not be a backup.
  const r2 = getR2Config();
  if (candidate.bucket !== r2.bucket) {
    await record(admin, candidate.assetId, "failed", { failureReason: "canonical_read_failed" });
    return { status: "failed", assetId: candidate.assetId, reason: "canonical_read_failed" };
  }

  const bytes = await readCanonicalObject(candidate.objectKey);
  if (!bytes) {
    await record(admin, candidate.assetId, "failed", { failureReason: "canonical_read_failed" });
    return { status: "failed", assetId: candidate.assetId, reason: "canonical_read_failed" };
  }

  const backupKey = buildBackupKey(candidate.objectKey);
  const dr = getDrConfig();

  let put: Awaited<ReturnType<typeof putAssetBackup>>;
  try {
    put = await putAssetBackup({
      backupKey,
      bytes,
      declaredContentType: candidate.declaredContentType ?? null,
    });
  } catch {
    // An S3 outage. The canonical object is untouched and the row returns to
    // `failed`, which the claim picks up again.
    await record(admin, candidate.assetId, "failed", { failureReason: "s3_write_failed" });
    return { status: "failed", assetId: candidate.assetId, reason: "s3_write_failed" };
  }

  // PutObject returning is not proof. Verify against what S3 actually holds.
  const head = await headAssetBackup(backupKey);
  if (!head || head.byteLength !== bytes.byteLength) {
    await record(admin, candidate.assetId, "failed", { failureReason: "verification_failed" });
    return { status: "failed", assetId: candidate.assetId, reason: "verification_failed" };
  }

  const recorded = await record(admin, candidate.assetId, "backed_up", {
    backend: "s3",
    bucket: dr.bucket,
    key: backupKey,
    versionId: head.versionId ?? put.versionId,
    etag: head.etag ?? put.etag,
  });

  if (!recorded) {
    // The copy exists but the row does not know. Reported as failed so the
    // claim retries; the retry rewrites the SAME key, which is why that is
    // safe rather than duplicative.
    return { status: "failed", assetId: candidate.assetId, reason: "record_failed" };
  }

  return {
    status: "backed_up",
    assetId: candidate.assetId,
    backupKey,
    byteLength: bytes.byteLength,
  };
}

async function record(
  admin: SupabaseClient,
  assetId: string,
  status: "backed_up" | "failed",
  fields: {
    backend?: string;
    bucket?: string;
    key?: string;
    versionId?: string | null;
    etag?: string | null;
    failureReason?: string;
  }
): Promise<boolean> {
  const { data, error } = await admin.rpc("record_media_backup", {
    p_asset_id: assetId,
    p_backup_status: status,
    p_backup_backend: fields.backend ?? null,
    p_backup_bucket: fields.bucket ?? null,
    p_backup_key: fields.key ?? null,
    p_backup_version_id: fields.versionId ?? null,
    p_backup_etag: fields.etag ?? null,
    p_failure_reason: fields.failureReason ?? null,
  });

  return !error && (data as { recorded?: boolean } | null)?.recorded === true;
}

export interface BackupRunResult {
  claimed: number;
  backedUp: number;
  failed: number;
  skipped: boolean;
}

/**
 * One backup pass. Intended for an operations dispatcher on a schedule.
 *
 * NOT a generation lifecycle owner and structurally incapable of becoming
 * one: it can read a canonical object and write a copy, and that is all. It
 * cannot start a workflow, submit to a provider, create a generation, or
 * touch credits.
 *
 * Deliberately NOT on BullMQ. Redis B is unavailable (9-C is deferred on
 * exactly that), and DR backup is not derived-media work anyway — losing a
 * thumbnail job is cosmetic, losing every backup silently is not. The claim
 * lives in PostgreSQL, where the intent is durable without a second broker.
 */
export async function runDrBackupPass(
  admin: SupabaseClient,
  options: { limit?: number; leaseSeconds?: number } = {}
): Promise<BackupRunResult> {
  if (!isDrConfigured()) return { claimed: 0, backedUp: 0, failed: 0, skipped: true };

  const { data, error } = await admin.rpc("claim_media_backups", {
    p_limit: options.limit ?? 20,
    p_lease_seconds: options.leaseSeconds ?? 300,
  });

  if (error || !Array.isArray(data)) return { claimed: 0, backedUp: 0, failed: 0, skipped: false };

  const rows = data as {
    asset_id: string;
    clerk_user_id: string;
    bucket: string;
    object_key: string;
    declared_content_type: string | null;
    byte_size: number | null;
  }[];

  let backedUp = 0;
  for (const row of rows) {
    const outcome = await backupAsset(admin, {
      assetId: row.asset_id,
      ownerId: row.clerk_user_id,
      bucket: row.bucket,
      objectKey: row.object_key,
      declaredContentType: row.declared_content_type,
      byteSize: row.byte_size,
    });
    if (outcome.status === "backed_up") backedUp += 1;
  }

  return { claimed: rows.length, backedUp, failed: rows.length - backedUp, skipped: false };
}

/** Surfaces backup debt for operations. Read-only. */
export async function countBackupDebt(admin: SupabaseClient): Promise<number> {
  const { count } = await admin
    .from("media_assets")
    .select("id", { count: "exact", head: true })
    .eq("status", "finalized")
    .eq("ingest_status", "verified")
    .in("backup_status", ["not_backed_up", "pending", "failed"]);

  return count ?? 0;
}

/** Thrown only by configuration mistakes; media failures are outcomes. */
export function assertDrConfigured(): void {
  if (!isDrConfigured()) {
    throw new OrchestrationError("DR_CONFIGURATION_INVALID", {
      context: { reason: "missing_bucket" },
    });
  }
}
