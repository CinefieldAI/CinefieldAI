import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assetIdentifierPatternFor,
  type AssetAdminResult,
  type AssetDetailView,
  type AssetLookupIdentifierType,
} from "./asset-admin-contract";

/**
 * The Phase 16-C admin Assets / Storage / Moderation read service.
 *
 * One narrow, explicit-column, bounded read of `media_assets` — no
 * `.insert(`, `.update(`, `.upsert(`, or `.delete(` exists anywhere in
 * this file. See `asset-admin-contract.ts` for exactly which columns are
 * selected and which are deliberately excluded (never `bucket`/
 * `object_key`/`backup_bucket`/`backup_key`).
 */

const MAX_ASSETS_PER_GENERATION = 20;

const ASSET_COLUMNS =
  "id, clerk_user_id, project_id, generation_id, generation_attempt_id, source, role, parent_asset_id, variant, " +
  "media_type, storage_backend, byte_size, verified_mime, checksum_sha256, status, created_at, stored_at, " +
  "finalized_at, tombstoned_at, ingest_status, ingest_failure_reason, ingested_at, duplicate_of_asset_id, " +
  "moderation_status, moderation_engine, moderated_at, quarantine_status, backup_status, backup_backend, " +
  "backup_completed_at, backup_failure_reason";

function projectAsset(row: Record<string, unknown>): AssetDetailView {
  return {
    assetId: row.id as string,
    clerkUserId: row.clerk_user_id as string,
    projectId: (row.project_id as string | null) ?? null,
    generationId: (row.generation_id as string | null) ?? null,
    generationAttemptId: (row.generation_attempt_id as string | null) ?? null,
    source: row.source as string,
    role: row.role as string,
    parentAssetId: (row.parent_asset_id as string | null) ?? null,
    variant: (row.variant as string | null) ?? null,
    mediaType: row.media_type as string,
    storageBackend: row.storage_backend as string,
    byteSize: (row.byte_size as number | null) ?? null,
    verifiedMime: (row.verified_mime as string | null) ?? null,
    checksumSha256: (row.checksum_sha256 as string | null) ?? null,
    status: row.status as string,
    createdAt: row.created_at as string,
    storedAt: (row.stored_at as string | null) ?? null,
    finalizedAt: (row.finalized_at as string | null) ?? null,
    tombstonedAt: (row.tombstoned_at as string | null) ?? null,
    ingestStatus: row.ingest_status as string,
    ingestFailureReason: (row.ingest_failure_reason as string | null) ?? null,
    ingestedAt: (row.ingested_at as string | null) ?? null,
    duplicateOfAssetId: (row.duplicate_of_asset_id as string | null) ?? null,
    moderationStatus: row.moderation_status as string,
    moderationEngine: (row.moderation_engine as string | null) ?? null,
    moderatedAt: (row.moderated_at as string | null) ?? null,
    quarantineStatus: row.quarantine_status as string,
    backupStatus: row.backup_status as string,
    backupBackend: (row.backup_backend as string | null) ?? null,
    backupCompletedAt: (row.backup_completed_at as string | null) ?? null,
    backupFailureReason: (row.backup_failure_reason as string | null) ?? null,
  };
}

export async function getAdminAssetInvestigation(
  admin: SupabaseClient,
  identifierType: AssetLookupIdentifierType,
  identifierValue: string
): Promise<AssetAdminResult> {
  if (!assetIdentifierPatternFor(identifierType).test(identifierValue)) {
    return { outcome: "INVALID_IDENTIFIER" };
  }

  try {
    const query =
      identifierType === "asset_id"
        ? admin.from("media_assets").select(ASSET_COLUMNS).eq("id", identifierValue).limit(1)
        : admin
            .from("media_assets")
            .select(ASSET_COLUMNS)
            .eq("generation_id", identifierValue)
            .order("created_at", { ascending: false })
            .limit(MAX_ASSETS_PER_GENERATION);

    const { data, error } = await query;
    if (error) return { outcome: "STORAGE_EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" };

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (rows.length === 0) return { outcome: "ASSET_NOT_FOUND" };

    return { outcome: "FOUND", assets: rows.map(projectAsset) };
  } catch {
    return { outcome: "STORAGE_EVIDENCE_UNAVAILABLE", reasonCode: "read_failed" };
  }
}
