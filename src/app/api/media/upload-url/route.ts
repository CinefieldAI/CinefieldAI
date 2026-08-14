import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { buildAssetObjectKey, safeExtension } from "@/lib/media/asset-keys";
import { createPresignedUpload, MAX_UPLOAD_BYTES, UPLOAD_URL_TTL_SECONDS } from "@/lib/media/r2-client";
import { getR2Config } from "@/lib/media/r2-config";

import { guardRoute, privateJson } from "@/lib/security/response-headers";
/**
 * POST /api/media/upload-url — server-authorized browser upload (Phase 9-A).
 *
 * THE CLIENT SAYS WHAT, THE SERVER SAYS WHERE. Security gate 4 requires the
 * object key to be generated server-side and the client to be unable to
 * choose it. So the request body has no key field, no bucket field and no
 * asset-id field — the shapes simply do not exist, which is a stronger
 * guarantee than validating them away.
 *
 * Ownership comes from the verified Clerk session and nothing else. The
 * roadmap is explicit that `workspace_id` from a request body or query is not
 * trustworthy, and this route never reads one.
 *
 * WHAT A PRESIGNED URL IS NOT. It is permission to write bytes at one key for
 * a few minutes. It says nothing about what those bytes are. The asset row is
 * created `pending` in the QUARANTINE / INPUT lane and stays there: only the
 * 9-B ingest gate (MIME, checksum, duplicate, moderation) can move it, and
 * only 9-E can release a quarantine. A browser cannot create a production
 * asset by uploading to it.
 */

/** Only what a browser can legitimately ask for. No key. No bucket. */
interface UploadUrlRequest {
  /** Provider-neutral kind, used for the asset record. */
  mediaType?: "image" | "video" | "audio";
  /** The client's Content-Type claim. Bound into the signature. */
  contentType?: string;
  /** Cosmetic only — reduced to an extension, kept as sanitized metadata. */
  filename?: string;
  /** Client's expected size, checked against the ceiling before signing. */
  byteSize?: number;
  projectId?: string;
}

/**
 * A narrow allowlist for the DECLARED type. It bounds what may be signed; it
 * verifies nothing about the eventual bytes, which is 9-B's job.
 */
const ALLOWED_DECLARED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
]);

function mediaTypeFor(contentType: string): "image" | "video" | "audio" | "other" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "other";
}

export async function POST(request: Request): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    const error = new OrchestrationError("AUTH_REQUIRED");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  // Phase 12-A (application half). BEFORE any side effect: on a paid
  // path the handler has not begun, so a refusal cannot have created a
  // generation, reserved a credit, started a workflow or called a provider.
  const limited = await guardRoute({ routeClass: "durable_write", userId });
  if (limited) return limited;

  let body: UploadUrlRequest;
  try {
    body = (await request.json()) as UploadUrlRequest;
  } catch {
    const error = new OrchestrationError("INVALID_INPUT", { userMessage: "Invalid request body." });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  const contentType = typeof body.contentType === "string" ? body.contentType.toLowerCase() : "";
  if (!ALLOWED_DECLARED_TYPES.has(contentType)) {
    const error = new OrchestrationError("UNSUPPORTED_INPUT_TYPE");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  if (typeof body.byteSize === "number" && body.byteSize > MAX_UPLOAD_BYTES) {
    const error = new OrchestrationError("INVALID_INPUT", { userMessage: "File is too large." });
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  if (!isSupabaseAdminConfigured()) {
    const error = new OrchestrationError("INTERNAL_ERROR");
    return privateJson(error.toResponseBody(), { status: error.status });
  }

  try {
    const admin = getSupabaseAdminClient();
    const config = getR2Config();

    // Derived here, from the session. Nothing in the request influences it.
    const assetId = crypto.randomUUID();
    const objectKey = buildAssetObjectKey({
      ownerId: userId,
      assetId,
      source: "browser_upload",
      role: "original",
      extension: safeExtension(body.filename, contentType.split("/")[1] ?? "bin"),
    });

    // Recorded BEFORE the URL is issued, so an upload that happens can always
    // be traced to an authorization that was granted.
    const inserted = await admin.from("media_assets").insert({
      id: assetId,
      clerk_user_id: userId,
      project_id: typeof body.projectId === "string" ? body.projectId : null,
      source: "browser_upload",
      role: "original",
      media_type: mediaTypeFor(contentType),
      storage_backend: "r2",
      bucket: config.bucket,
      object_key: objectKey,
      declared_content_type: contentType,
      original_filename: typeof body.filename === "string" ? body.filename.slice(0, 255) : null,
      // pending + quarantined. A browser upload is never production media
      // until the 9-B gate says so.
      status: "pending",
    });

    if (inserted.error) {
      const error = new OrchestrationError("ASSET_RECORD_FAILED");
      return privateJson(error.toResponseBody(), { status: error.status });
    }

    const presigned = await createPresignedUpload({
      objectKey,
      declaredContentType: contentType,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return privateJson(
      {
        assetId,
        uploadUrl: presigned.uploadUrl,
        method: presigned.method,
        expiresInSeconds: presigned.expiresInSeconds,
        // Echoed so the client can set the header it was signed with. It is
        // NOT an instruction the client chose — it is the value the server
        // bound into the signature.
        requiredContentType: contentType,
        maxBytes: MAX_UPLOAD_BYTES,
      },
      {
        // A presigned URL is a bearer credential for one object. It must never
        // enter a shared cache — the roadmap red note names presigned URL
        // responses specifically as NO-SHARED-CACHE.
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (caught) {
    if (caught instanceof OrchestrationError) {
      return privateJson(caught.toResponseBody(), { status: caught.status });
    }
    const error = new OrchestrationError("INTERNAL_ERROR");
    return privateJson(error.toResponseBody(), { status: error.status });
  }
}
