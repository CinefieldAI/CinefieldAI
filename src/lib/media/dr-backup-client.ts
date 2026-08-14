import "server-only";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";
import { getDrConfig } from "./dr-config";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * AWS S3 disaster-recovery client (Phase 9-D).
 *
 * Deliberately a SEPARATE module from `r2-client.ts`, with separate
 * configuration and a separate credential source. They are S3-compatible in
 * protocol and nothing else: R2 is Cloudflare, keyed by
 * `CLOUDFLARE_R2_*`, and holds the canonical media. This is AWS, authenticated
 * by an IAM identity, and holds a copy. Sharing a client between them is how a
 * credential rotation on one silently breaks the other, and how a bug in a
 * shared helper writes production media into the backup bucket or vice versa.
 *
 * WHAT THIS CLIENT CANNOT DO
 * There is no `deleteAssetBackup` and no `getObject` returning bytes. Deleting
 * a DR copy belongs to the Phase 23 retention engine, not to a backup worker —
 * a worker that can delete backups can, on a bad day, delete the thing the
 * backup existed for. Reading is `HeadObject` only, because verification needs
 * metadata and a restore is a separate controlled operation (see the restore
 * contract in the architecture doc).
 *
 * CREDENTIALS COME FROM THE SDK CHAIN. Locally that is a named profile whose
 * NAME lives in `.env.local`; in production it is the ECS task role. No AWS
 * access key is read from the environment, stored, or logged anywhere in this
 * repository.
 */

let cachedClient: S3Client | null = null;

function client(): S3Client {
  if (cachedClient) return cachedClient;

  const config = getDrConfig();
  cachedClient = new S3Client({
    region: config.region,
    // A profile is supplied only when one is named. Omitting `credentials`
    // entirely is what lets the default chain find the task role in
    // production, which is the whole point of not putting keys in env.
    ...(config.profile ? { credentials: fromIni({ profile: config.profile }) } : {}),
  });
  return cachedClient;
}

/** Test seam. Also lets a config change take effect without a reload. */
export function __resetDrClientForTesting(injected?: S3Client): void {
  cachedClient = injected ?? null;
}

export interface DrPutResult {
  bucket: string;
  backupKey: string;
  byteLength: number;
  /** S3's opaque object version, when versioning is on. Useful for audit. */
  versionId: string | null;
  /**
   * S3's ETag, VERBATIM. Deliberately not called a checksum: for a
   * single-part unencrypted upload it happens to be the MD5, but for
   * multipart or SSE-KMS objects it is not, and treating it as content
   * identity would be wrong in exactly the cases that matter. Content
   * identity is the Phase 9-B `checksum_sha256` over the canonical bytes.
   */
  etag: string | null;
}

/**
 * Writes one backup object.
 *
 * Idempotent by key: the same asset always maps to the same backup key, so a
 * retry overwrites rather than accumulating copies. With bucket versioning on
 * (recommended, and enabled on the dev bucket) the previous version is
 * retained, so a retry cannot destroy a good copy.
 */
export async function putAssetBackup(params: {
  backupKey: string;
  bytes: Uint8Array;
  declaredContentType?: string | null;
}): Promise<DrPutResult> {
  const config = getDrConfig();

  try {
    const result = await client().send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: params.backupKey,
        Body: params.bytes,
        ContentType: params.declaredContentType ?? "application/octet-stream",
      })
    );

    return {
      bucket: config.bucket,
      backupKey: params.backupKey,
      byteLength: params.bytes.byteLength,
      versionId: result.VersionId ?? null,
      etag: result.ETag ?? null,
    };
  } catch {
    // The SDK error carries the bucket, the region and a request id. None of
    // that belongs in an orchestration error that may be logged.
    throw new OrchestrationError("DR_BACKUP_FAILED", {
      context: { operation: "put_backup_object" },
    });
  }
}

/**
 * Verifies a backup exists and reports what S3 says about it.
 *
 * Returns null rather than throwing when the object is absent or unreadable:
 * "the backup is not there" is an answer the caller acts on, not an
 * exceptional condition.
 */
export async function headAssetBackup(
  backupKey: string
): Promise<{ byteLength: number; versionId: string | null; etag: string | null } | null> {
  const config = getDrConfig();
  try {
    const result = await client().send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: backupKey })
    );
    return {
      byteLength: result.ContentLength ?? 0,
      versionId: result.VersionId ?? null,
      etag: result.ETag ?? null,
    };
  } catch {
    return null;
  }
}
