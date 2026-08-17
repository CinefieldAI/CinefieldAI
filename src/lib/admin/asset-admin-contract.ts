import { GENERATION_ID_PATTERN } from "@/lib/orchestration/generation-api-contract";

/**
 * Phase 16-C admin Assets / Storage / Moderation contract.
 *
 * ---------------------------------------------------------------------------
 * ONE CANONICAL TABLE, ONE SERVICE, TWO NAV ITEMS
 * ---------------------------------------------------------------------------
 * `public.media_assets` (Phase 9) is the one asset/storage/moderation truth
 * in this schema — `asset-admin-service.ts` is the ONLY new read of it, and
 * it is reused by BOTH the "Assets / Storage" and "Moderation" admin pages
 * (different field emphasis in the UI, same underlying bounded view, same
 * API route) rather than two competing reads. `generation-investigation-
 * service.ts` (16-A/2, `id, generation_attempt_id, role, media_type,
 * created_at`) and `risk-investigation-service.ts` (16-A closure,
 * `id, generation_id, quarantine_status, moderation_status,
 * moderation_engine, moderated_at, ingest_status, created_at`) already
 * read narrower slices of this same table for their own purposes — this
 * contract's view is a superset built for full asset-detail investigation,
 * not a competing definition of the same fields.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY EXCLUDED, AND WHY
 * ---------------------------------------------------------------------------
 * `bucket`/`object_key`/`backup_bucket`/`backup_key`/`backup_version_id`/
 * `backup_etag` — real storage locations/credentials-adjacent identifiers,
 * never exposed raw (the existing two admin reads already established this
 * boundary; `storage_backend`/`backup_backend`/`backup_status` answer
 * "where and in what state" without leaking the path). `declared_content_type`/
 * `original_filename` — provider/browser-declared, untrusted, and
 * `original_filename` in particular can carry arbitrary user-chosen text.
 * `legal_hold`/`retention_policy`/`data_class` — Phase 23 hooks with no
 * real values yet; excluded as not-yet-meaningful rather than displayed as
 * if they were.
 *
 * ---------------------------------------------------------------------------
 * R2 IS CANONICAL, S3 IS DR-ONLY — AND THIS VIEW SAYS SO, NEVER IMPLIES OTHERWISE
 * ---------------------------------------------------------------------------
 * `storageBackend` (the live/delivery location) and the `backup*` fields
 * (the DR/S3 evidence) are kept as clearly separate fields in this view —
 * never merged into one "storage state," so a reader can never mistake DR
 * backup completion for the asset being live/delivered from S3.
 */

export type AssetLookupIdentifierType = "asset_id" | "generation_id";

export interface AssetDetailView {
  readonly assetId: string;
  readonly clerkUserId: string;
  readonly projectId: string | null;
  readonly generationId: string | null;
  readonly generationAttemptId: string | null;
  readonly source: string;
  readonly role: string;
  readonly parentAssetId: string | null;
  readonly variant: string | null;
  readonly mediaType: string;
  readonly storageBackend: string;
  readonly byteSize: number | null;
  readonly verifiedMime: string | null;
  readonly checksumSha256: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly storedAt: string | null;
  readonly finalizedAt: string | null;
  readonly tombstonedAt: string | null;
  readonly ingestStatus: string;
  readonly ingestFailureReason: string | null;
  readonly ingestedAt: string | null;
  readonly duplicateOfAssetId: string | null;
  readonly moderationStatus: string;
  readonly moderationEngine: string | null;
  readonly moderatedAt: string | null;
  readonly quarantineStatus: string;
  readonly backupStatus: string;
  readonly backupBackend: string | null;
  readonly backupCompletedAt: string | null;
  readonly backupFailureReason: string | null;
}

export type AssetAdminResult =
  | { readonly outcome: "INVALID_IDENTIFIER" }
  | { readonly outcome: "STORAGE_EVIDENCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "ASSET_NOT_FOUND" }
  | { readonly outcome: "FOUND"; readonly assets: readonly AssetDetailView[] };

/** `media_assets.id` is a uuid. */
export const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assetIdentifierPatternFor(type: AssetLookupIdentifierType): RegExp {
  return type === "asset_id" ? ASSET_ID_PATTERN : GENERATION_ID_PATTERN;
}
