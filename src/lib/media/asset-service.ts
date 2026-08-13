import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "@/lib/orchestration/errors";
import { buildAssetObjectKey, safeExtension, type AssetSource } from "./asset-keys";
import { putAssetObject, headAssetObject } from "./r2-client";
import { getR2Config } from "./r2-config";

/**
 * Asset lifecycle for Phase 9-A.
 *
 * THE ORDER IS THE DESIGN, and it is the fix for M2. Provider success used to
 * flow straight into `markCompleted`; a generation could be COMPLETED while
 * its bytes existed only in a provider's CDN. The roadmap red note is
 * explicit: "Provider success tek başına generation COMPLETED demek
 * değildir." So:
 *
 *   1. reserve   — an asset row and its key exist, nothing is stored yet
 *   2. store     — bytes reach R2 under exactly that key
 *   3. finalize  — the row records size and time, guarded in SQL
 *   4. only then may a generation complete
 *
 * Each step can fail without lying about the one before it. A generation
 * whose asset is `pending` or `stored` is not finished, and nothing in this
 * module can make it look finished.
 *
 * TWO SYSTEMS, NO DISTRIBUTED TRANSACTION. R2 and PostgreSQL cannot commit
 * together and this code does not pretend otherwise. What it does instead is
 * make every intermediate state recoverable and every retry converge:
 *
 *   row reserved, object never written  → status stays pending; a retry
 *                                          re-uses the same row and key
 *   object written, finalize lost       → status stays stored; a retry
 *                                          re-writes the SAME key (identical
 *                                          bytes, same object) and finalizes
 *   both done                           → finalize is idempotent, second call
 *                                          reports already-final
 *
 * The convergence comes from identity, not from luck: the key is derived from
 * the asset id, and `media_assets_generation_original_uniq` allows exactly one
 * canonical original per generation. A retry cannot create a rival.
 */

export interface ReservedAsset {
  assetId: string;
  objectKey: string;
  bucket: string;
}

export type MediaType = "image" | "video" | "audio" | "other";

interface AssetRow {
  id: string;
  object_key: string;
  bucket: string;
  status: string;
}

/**
 * Reserves the one canonical original for a generation, or returns the
 * existing reservation.
 *
 * Idempotent by lookup-then-insert against a unique index: a concurrent
 * caller that loses the race reads the winner's row rather than failing.
 */
export async function reserveGenerationAsset(
  admin: SupabaseClient,
  params: {
    generationId: string;
    generationAttemptId?: string | null;
    clerkUserId: string;
    projectId?: string | null;
    mediaType: MediaType;
    fileExtension?: string;
    declaredContentType?: string | null;
  }
): Promise<ReservedAsset> {
  const config = getR2Config();

  const existing = await admin
    .from("media_assets")
    .select("id,object_key,bucket,status")
    .eq("generation_id", params.generationId)
    .eq("role", "original")
    .maybeSingle();

  if (existing.data) {
    const row = existing.data as AssetRow;
    return { assetId: row.id, objectKey: row.object_key, bucket: row.bucket };
  }

  // The id is generated here so the key can be derived from it before the
  // insert — the row and the object agree on identity from the first moment.
  const assetId = crypto.randomUUID();
  const objectKey = buildAssetObjectKey({
    ownerId: params.clerkUserId,
    assetId,
    source: "provider_output",
    role: "original",
    extension: safeExtension(params.fileExtension),
  });

  const inserted = await admin
    .from("media_assets")
    .insert({
      id: assetId,
      clerk_user_id: params.clerkUserId,
      project_id: params.projectId ?? null,
      generation_id: params.generationId,
      generation_attempt_id: params.generationAttemptId ?? null,
      source: "provider_output" satisfies AssetSource,
      role: "original",
      media_type: params.mediaType,
      storage_backend: "r2",
      bucket: config.bucket,
      object_key: objectKey,
      declared_content_type: params.declaredContentType ?? null,
      status: "pending",
    })
    .select("id,object_key,bucket,status")
    .single();

  if (inserted.error) {
    // Most likely the unique index fired because a concurrent worker reserved
    // first. Read the winner rather than failing the generation.
    const retry = await admin
      .from("media_assets")
      .select("id,object_key,bucket,status")
      .eq("generation_id", params.generationId)
      .eq("role", "original")
      .maybeSingle();

    if (retry.data) {
      const row = retry.data as AssetRow;
      return { assetId: row.id, objectKey: row.object_key, bucket: row.bucket };
    }

    throw new OrchestrationError("ASSET_RECORD_FAILED", {
      context: { operation: "reserve_asset" },
    });
  }

  const row = inserted.data as AssetRow;
  return { assetId: row.id, objectKey: row.object_key, bucket: row.bucket };
}

/**
 * Writes the bytes and finalizes the record. Returns only when BOTH have
 * happened — the caller may treat a successful return as permission to
 * complete the generation, and nothing less.
 */
export async function storeAndFinalizeAsset(
  admin: SupabaseClient,
  reserved: ReservedAsset,
  payload: { bytes: Uint8Array; declaredContentType?: string | null }
): Promise<{ assetId: string; objectKey: string; byteLength: number }> {
  // Throws ASSET_STORAGE_FAILED on failure. Deliberately not caught here:
  // a failed write must not be followed by a finalize.
  const stored = await putAssetObject({
    objectKey: reserved.objectKey,
    bytes: payload.bytes,
    declaredContentType: payload.declaredContentType ?? null,
  });

  const { data, error } = await admin.rpc("finalize_media_asset", {
    p_asset_id: reserved.assetId,
    p_byte_size: stored.byteLength,
    p_declared_content_type: payload.declaredContentType ?? null,
  });

  if (error) {
    throw new OrchestrationError("ASSET_RECORD_FAILED", {
      context: { operation: "finalize_media_asset" },
    });
  }

  const result = data as { finalized: boolean; status: string | null };

  // `finalized: false` with status 'finalized' is a replay: another worker got
  // there first, which is success. Anything else means the row is not in a
  // state a generation may complete on.
  if (!result.finalized && result.status !== "finalized") {
    throw new OrchestrationError("ASSET_RECORD_FAILED", {
      context: { operation: "finalize_media_asset", status: result.status ?? "unknown" },
    });
  }

  return {
    assetId: reserved.assetId,
    objectKey: reserved.objectKey,
    byteLength: stored.byteLength,
  };
}

/**
 * True only when this generation has a finalized canonical original.
 *
 * THE completion gate. `markCompleted` must not run unless this is true —
 * that is the entire content of the M2 fix, and it is a query rather than a
 * flag so it cannot drift from the row it describes.
 */
export async function hasFinalizedOriginal(
  admin: SupabaseClient,
  generationId: string
): Promise<boolean> {
  const { data } = await admin
    .from("media_assets")
    .select("status")
    .eq("generation_id", generationId)
    .eq("role", "original")
    .maybeSingle();

  return (data as { status?: string } | null)?.status === "finalized";
}

/** Verifies stored bytes really landed. Used by the live write proof. */
export async function verifyStoredObject(
  objectKey: string,
  expectedBytes: number
): Promise<boolean> {
  const head = await headAssetObject(objectKey);
  return head !== null && head.byteLength === expectedBytes;
}
