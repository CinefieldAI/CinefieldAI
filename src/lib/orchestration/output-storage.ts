import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedOutput } from "./output-normalizer";
import { createPresignedDownload } from "@/lib/media/r2-client";
import { deliverableOutputIndexes, isAssetDeliverable } from "@/lib/media/asset-delivery-gate";

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
  // ---- THE DELIVERY GATE — PER OUTPUT (Phase 9-E, Phase 28) ---------------
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
  // PHASE 28 MADE IT PER OUTPUT. This used to ask one generation-wide question
  // (`every` output released) and withhold the whole batch on a single
  // failure. That was conservative rather than dangerous, but it was still
  // wrong: a user whose four-image batch had one output flagged received none
  // of them, and no roadmap rule requires generation-wide blocking. Each
  // output now carries its own asset, its own safety decision and its own
  // answer here — SAFE / BLOCK / SAFE delivers the two safe siblings.
  //
  // A caller that passes no `gate` gets no URLs. Fail-closed: a request that
  // does not say which generation these outputs belong to cannot be checked,
  // and an uncheckable request is not a safe one.
  if (!gate) {
    return outputs.map((output) => ({ ...output, signedUrl: null }));
  }

  // One query for the batch, an independent answer per index. An index the
  // map does not contain is NOT deliverable — absent means unknown, and
  // unknown is never a clearance.
  const deliverable = await deliverableOutputIndexes(admin, gate.generationId);

  const withUrls: StoredOutput[] = [];

  for (const [index, output] of outputs.entries()) {
    if (!deliverable.get(index)) {
      withUrls.push({ ...output, signedUrl: null });
      continue;
    }

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
  // Addressed by OUTPUT INDEX, never "whichever row came back first". A
  // multi-output generation has several canonical assets; picking by
  // arrival order would make delivery non-deterministic.
  const { data, error } = await admin
    .from("media_assets")
    .select("id,object_key")
    .eq("generation_id", generationId)
    .eq("output_index", outputIndex)
    .eq("role", "original")
    .maybeSingle();

  if (error) return { signedUrl: null, reasonCode: "asset_lookup_failed" };
  const row = data as { id?: string; object_key?: string } | null;
  const objectKey = row?.object_key;
  const assetId = row?.id;
  if (!objectKey || !assetId) return { signedUrl: null, reasonCode: "asset_not_found" };

  // ---- THE GATE, ON THIS ASSET (Phase 28) --------------------------------
  //
  // Asked about the SPECIFIC asset being requested, not about the generation.
  // A blocked sibling must not withhold this output, and — far more
  // importantly — a cleared sibling must never let this one through. The
  // lookup happens first so the question is asked about a real row rather
  // than about an index that may not exist.
  if (!(await isAssetDeliverable(admin, assetId))) {
    return { signedUrl: null, reasonCode: "not_deliverable" };
  }

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
 * THE GENERATION-WIDE GATE IS GONE — DELIBERATELY, NOT BY OVERSIGHT.
 *
 * This module used to hold a private `isGenerationAssetDeliverable` that asked
 * whether EVERY output of a generation had left quarantine, and withheld the
 * whole batch otherwise. Phase 28 replaced it with the per-output gate in
 * `asset-delivery-gate.ts`, for two reasons:
 *
 *   Phase 28 decides safety PER OUTPUT. A generation-wide answer discards that
 *   granularity at the last step, so an unsafe sibling withheld safe ones —
 *   conservative, but not what the roadmap requires, and a real product defect
 *   for a user whose four-image batch had one output flagged.
 *
 *   There must be ONE delivery authority. Keeping a local copy alongside
 *   Phase 9-E's `isAssetDeliverable` meant two implementations of the same
 *   rule; they agreed, until they would not have.
 *
 * The property that mattered is unchanged and still enforced here: the
 * quarantine question is answered by the database immediately before any URL
 * is minted, and an unanswerable question yields no URL.
 */
