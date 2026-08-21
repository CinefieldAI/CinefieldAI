import "server-only";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Config } from "./r2-config";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * R2 object storage boundary (Phase 9-A).
 *
 * Server-only, and structurally so: this module imports `server-only`, reads
 * credentials from `process.env`, and is never referenced from a client
 * component. The browser never receives an R2 credential — it receives a
 * presigned URL bound to one bucket, one key, one method and a short expiry.
 *
 * SIGNING IS THE SDK'S JOB. A hand-rolled SigV4 exists in the scratch probe
 * that verified connectivity, and it stays there: signing is exactly the kind
 * of code where a subtle mistake produces "works today, fails on a header we
 * add next month", and the maintained SDK already handles canonicalisation,
 * chunked payloads and clock skew.
 *
 * THE BUCKET IS PRIVATE AND STAYS PRIVATE. Nothing here constructs a public
 * `r2.dev` URL, and retrieval goes through a short-lived presigned GET issued
 * by the server after it has checked ownership.
 */

let cachedClient: S3Client | null = null;

function client(): S3Client {
  if (cachedClient) return cachedClient;

  const config = getR2Config();
  cachedClient = new S3Client({
    // R2 ignores region but the SDK requires one; "auto" is Cloudflare's
    // documented value.
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return cachedClient;
}

/** Test seam. Also lets a config change take effect without a reload. */
export function __resetR2ClientForTesting(injected?: S3Client): void {
  cachedClient = injected ?? null;
}

export interface PutObjectResult {
  bucket: string;
  objectKey: string;
  byteLength: number;
}

/**
 * Writes one object. Deterministic key in, same key out — a retry overwrites
 * rather than accumulating near-duplicates, which is what makes the
 * finalization path replay-safe.
 *
 * `contentType` is the provider's CLAIM, carried for correct delivery
 * headers. It is not a verified MIME type; 9-B owns that distinction.
 */
export async function putAssetObject(params: {
  objectKey: string;
  bytes: Uint8Array;
  declaredContentType?: string | null;
}): Promise<PutObjectResult> {
  const config = getR2Config();

  try {
    await client().send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: params.objectKey,
        Body: params.bytes,
        ContentType: params.declaredContentType ?? "application/octet-stream",
      })
    );
  } catch {
    // The SDK error can carry the endpoint and request id. Neither belongs in
    // an orchestration error that may be logged or surfaced.
    throw new OrchestrationError("ASSET_STORAGE_FAILED", {
      context: { operation: "put_object" },
    });
  }

  return { bucket: config.bucket, objectKey: params.objectKey, byteLength: params.bytes.byteLength };
}

/**
 * Deletes one R2 hot object (Phase 23-C).
 *
 * PHASE 9's own disaster-recovery backup client deliberately never imports
 * `DeleteObjectCommand` for the separate AWS backup identity it uses (that
 * IAM identity has no delete permission at all — a backup failure must
 * never become a data-loss path). This is a DIFFERENT credential: R2 is the
 * canonical, live store this
 * application already writes to via `putAssetObject`, and physical deletion
 * of a user's own hot object is exactly what AccountDeletionWorkflow needs
 * to actually perform (not just mark) an erasure. Never called except
 * through that workflow's own Tier-0 dual-control gate — this function
 * itself does no authorization of its own, the same "trusts its key
 * argument" contract `createPresignedDownload` already states.
 */
export async function deleteAssetObject(objectKey: string): Promise<{ deleted: boolean }> {
  const config = getR2Config();
  try {
    await client().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
    return { deleted: true };
  } catch {
    return { deleted: false };
  }
}

/** Verifies an object exists and reports its size. Used to prove a write. */
export async function headAssetObject(objectKey: string): Promise<{ byteLength: number } | null> {
  const config = getR2Config();
  try {
    const result = await client().send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey })
    );
    return { byteLength: result.ContentLength ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Bounds on a presigned upload. Short by design: a presigned URL is a bearer
 * credential for one object, and its blast radius is its lifetime.
 */
export const UPLOAD_URL_TTL_SECONDS = 300;
export const DOWNLOAD_URL_TTL_SECONDS = 300;
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Issues a presigned PUT for exactly one key, of exactly one size.
 *
 * Bound to bucket, key, method, content type AND CONTENT LENGTH — the client
 * cannot redirect it at another object, cannot upload as a different type than
 * it declared, and cannot upload a different number of bytes than it declared.
 * It does NOT validate the bytes themselves: a presign says "you may write
 * here", never "what you wrote is safe". Ingest verification is 9-B.
 *
 * ---------------------------------------------------------------------------
 * WHY contentLength IS REQUIRED (SECURITY_FINDINGS_9751bd11, finding 2)
 * ---------------------------------------------------------------------------
 * This function used to sign bucket, key and content type only. The route
 * above it checked a client-declared `byteSize` against MAX_UPLOAD_BYTES — but
 * that field was OPTIONAL, so omitting it skipped the check entirely, and the
 * signature bound nothing about size. An authenticated caller could take the
 * URL and PUT an object of any size.
 *
 * Making the parameter required is the fix, not a convenience: there is now no
 * way to obtain an upload URL without stating the size, and no way to state a
 * size the signature does not enforce.
 *
 * ---------------------------------------------------------------------------
 * THE SIGNATURE REALLY BINDS IT — VERIFIED, NOT ASSUMED
 * ---------------------------------------------------------------------------
 * Probed against the installed @aws-sdk/s3-request-presigner rather than taken
 * on trust. Without ContentLength the signed set is `host`; with it the set
 * becomes `content-length;host` automatically — no `signableHeaders` option
 * needed — and signing 1234 versus 9999 produces DIFFERENT signatures. So a
 * client that alters the length invalidates the request rather than smuggling
 * bytes past a decorative field. `phase-9a-media-storage.e2e.test.ts` re-runs
 * that check, so a future SDK upgrade that stopped signing it would fail.
 */
export async function createPresignedUpload(params: {
  objectKey: string;
  declaredContentType: string;
  /** Exact byte count. Signed, so the upload must match it. */
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<{ uploadUrl: string; expiresInSeconds: number; method: "PUT"; contentLength: number }> {
  const config = getR2Config();
  const expiresIn = Math.min(params.expiresInSeconds ?? UPLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS);

  // Refused here as well as at the route. A presign is a bearer credential for
  // one write; the ceiling belongs on the thing that mints it, so a future
  // caller cannot obtain an unbounded one by forgetting to check.
  if (
    !Number.isInteger(params.contentLength) ||
    params.contentLength <= 0 ||
    params.contentLength > MAX_UPLOAD_BYTES
  ) {
    throw new OrchestrationError("INVALID_INPUT", {
      userMessage: "File is too large.",
      context: { operation: "presign_upload", maxBytes: MAX_UPLOAD_BYTES },
    });
  }

  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.objectKey,
      ContentType: params.declaredContentType,
      ContentLength: params.contentLength,
    }),
    { expiresIn }
  );

  return { uploadUrl, expiresInSeconds: expiresIn, method: "PUT", contentLength: params.contentLength };
}

/**
 * Issues a short-lived presigned GET. The caller must already have checked
 * that the requester owns the asset — this function trusts its key argument
 * and does no authorization of its own.
 */
export async function createPresignedDownload(params: {
  objectKey: string;
  expiresInSeconds?: number;
}): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
  const config = getR2Config();
  const expiresIn = Math.min(
    params.expiresInSeconds ?? DOWNLOAD_URL_TTL_SECONDS,
    DOWNLOAD_URL_TTL_SECONDS
  );

  const downloadUrl = await getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: config.bucket, Key: params.objectKey }),
    { expiresIn }
  );

  return { downloadUrl, expiresInSeconds: expiresIn };
}
