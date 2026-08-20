import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedOutput } from "./output-normalizer";
import { createPresignedDownload } from "@/lib/media/r2-client";

/**
 * Cinefield output delivery (Phase 27 — ONE canonical artifact).
 *
 * ---------------------------------------------------------------------------
 * THE SUPABASE STORAGE COPY IS GONE
 * ---------------------------------------------------------------------------
 * Generated media used to be written twice: the C2PA-signed canonical object
 * in R2 (Phase 9's storage owner) and a second copy in the private
 * `generation-outputs` bucket that this module uploaded and signed. Two
 * physical copies meant two storage truths, double the bytes, and — before
 * the signing fix — a marked archive alongside an unmarked download.
 *
 * There is now ONE artifact. `uploadOutputs` is deleted, not merely unused:
 * a function that writes a second canonical copy is exactly what must not
 * exist for Article 50(2) marking to be guaranteed. Delivery mints a
 * short-lived presigned URL against the R2 object instead, through Phase 9's
 * own `createPresignedDownload` — this module implements no signing of its
 * own.
 *
 * What is persisted on the row is still the object PATH, never a signed URL:
 * signed URLs expire and their tokens must not be stored.
 */

const SIGNED_URL_TTL_SECONDS = 3600;

export interface StoredOutput {
  storagePath: string;
  mimeType: string;
  type: ResolvedOutput["type"];
  signedUrl: string | null;
}

/**
 * Creates short-lived signed URLs purely for returning to the authenticated
 * browser. These are never persisted to the database.
 */
export async function attachSignedUrls(
  admin: SupabaseClient,
  outputs: StoredOutput[],
  gate?: { generationId: string }
): Promise<StoredOutput[]> {
  // ---- PHASE 9-E DELIVERY GATE -------------------------------------------
  //
  // A signed URL is usable media. Minting one for an asset that has not left
  // quarantine hands the user bytes no moderation has cleared, which is what
  // the roadmap forbids: "moderation tamamlanmadan hiçbir obje public CDN
  // yoluna çıkmıyor."
  //
  // The check lives HERE rather than at the call site so no future caller can
  // obtain a URL by forgetting it, and it is answered by the database
  // immediately before minting — a cached answer could serve media that was
  // rejected a second ago.
  //
  // A caller that passes no `gate` gets no URLs. Fail-closed: a request that
  // does not say which generation these outputs belong to cannot be checked,
  // and an uncheckable request is not a safe one.
  if (!gate) {
    return outputs.map((output) => ({ ...output, signedUrl: null }));
  }

  if (!(await isGenerationAssetDeliverable(admin, gate.generationId))) {
    return outputs.map((output) => ({ ...output, signedUrl: null }));
  }

  const withUrls: StoredOutput[] = [];

  for (const output of outputs) {
    // Phase 9's own presigned-download owner. This module mints nothing
    // itself — a second signing implementation would be a second set of
    // expiry and credential decisions to keep in step.
    try {
      const { downloadUrl } = await createPresignedDownload({
        objectKey: output.storagePath,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      });
      withUrls.push({ ...output, signedUrl: downloadUrl });
    } catch {
      // An unmintable URL is "not deliverable right now", never an error that
      // fails a completed generation. The caller already has the outputs.
      withUrls.push({ ...output, signedUrl: null });
    }
  }

  return withUrls;
}

/**
 * Mints a delivery URL for one generation's canonical asset.
 *
 * The browser cannot reach R2, so `GET /api/generations/[id]/asset-url` calls
 * this. It re-asks the quarantine question itself rather than trusting the
 * route to have checked — the same reason `attachSignedUrls` answers it
 * immediately before minting: a cached answer could serve media that was
 * rejected a second ago.
 */
export async function mintCanonicalAssetUrl(
  admin: SupabaseClient,
  generationId: string,
  outputIndex = 0
): Promise<{ signedUrl: string | null; reasonCode?: string }> {
  if (!(await isGenerationAssetDeliverable(admin, generationId))) {
    return { signedUrl: null, reasonCode: "not_deliverable" };
  }

  // Addressed by OUTPUT INDEX, never "whichever row came back first". A
  // multi-output generation has several canonical assets; picking by
  // arrival order would make delivery non-deterministic.
  const { data, error } = await admin
    .from("media_assets")
    .select("object_key")
    .eq("generation_id", generationId)
    .eq("output_index", outputIndex)
    .eq("role", "original")
    .maybeSingle();

  if (error) return { signedUrl: null, reasonCode: "asset_lookup_failed" };
  const objectKey = (data as { object_key?: string } | null)?.object_key;
  if (!objectKey) return { signedUrl: null, reasonCode: "asset_not_found" };

  try {
    const { downloadUrl } = await createPresignedDownload({
      objectKey,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
    return { signedUrl: downloadUrl };
  } catch {
    return { signedUrl: null, reasonCode: "sign_failed" };
  }
}

/**
 * Whether EVERY canonical output of this generation has left quarantine.
 *
 * Read here rather than imported from the safety module, to keep the storage
 * layer free of a dependency on the admin layer.
 *
 * A generation may resolve to several outputs, each with its own asset row.
 * This asks about all of them: releasing the batch because one output cleared
 * moderation would be exactly the bypass Phase 9-E exists to prevent. It also
 * can no longer use `maybeSingle()`, which throws once more than one row
 * exists.
 */
async function isGenerationAssetDeliverable(
  admin: SupabaseClient,
  generationId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("media_assets")
    .select("quarantine_status,ingest_status,status,tombstoned_at")
    .eq("generation_id", generationId)
    .eq("role", "original");

  if (error) return false;

  const rows = (data ?? []) as {
    quarantine_status?: string;
    ingest_status?: string;
    status?: string;
    tombstoned_at?: string | null;
  }[];

  // No rows is not "nothing to refuse" — it means nothing was stored.
  if (rows.length === 0) return false;

  return rows.every(
    (row) =>
      !row.tombstoned_at &&
      row.quarantine_status === "released" &&
      row.ingest_status === "verified" &&
      row.status === "finalized"
  );
}
