import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrchestrationError } from "./errors";
import type { ResolvedOutput } from "./output-normalizer";

/**
 * Cinefield output storage manager.
 *
 * Uploads normalized outputs into the private `generation-outputs` bucket
 * using the server-only privileged client. The bucket stays private: what is
 * persisted in the database is the object PATH, never a signed URL (signed
 * URLs expire, and their tokens must not be stored).
 */

const OUTPUT_BUCKET = "generation-outputs";
const SIGNED_URL_TTL_SECONDS = 3600;

export interface StoredOutput {
  storagePath: string;
  mimeType: string;
  type: ResolvedOutput["type"];
  signedUrl: string | null;
}

/**
 * Path format (matches the existing convention already used by the Gemini
 * route and enforced by the Storage RLS policies):
 *   <clerk_user_id>/<project_id>/<generation_id>/<unique-file-name>
 */
export function buildOrchestrationOutputPath(params: {
  clerkUserId: string;
  projectId: string;
  generationId: string;
  index: number;
  fileExtension: string;
}): string {
  const { clerkUserId, projectId, generationId, index, fileExtension } = params;
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  const sequence = String(index + 1).padStart(2, "0");
  return `${clerkUserId}/${projectId}/${generationId}/mock-output-${sequence}-${timestamp}-${random}.${fileExtension}`;
}

export async function uploadOutputs(
  admin: SupabaseClient,
  outputs: ResolvedOutput[],
  target: { clerkUserId: string; projectId: string; generationId: string }
): Promise<StoredOutput[]> {
  const stored: StoredOutput[] = [];

  for (const [index, output] of outputs.entries()) {
    const storagePath = buildOrchestrationOutputPath({
      clerkUserId: target.clerkUserId,
      projectId: target.projectId,
      generationId: target.generationId,
      index,
      fileExtension: output.fileExtension,
    });

    const { error: uploadError } = await admin.storage
      .from(OUTPUT_BUCKET)
      .upload(storagePath, output.bytes, {
        contentType: output.mimeType,
        upsert: false,
      });

    if (uploadError) {
      throw new OrchestrationError("STORAGE_UPLOAD_FAILED", {
        context: { generationId: target.generationId, index },
      });
    }

    stored.push({
      storagePath,
      mimeType: output.mimeType,
      type: output.type,
      signedUrl: null,
    });
  }

  return stored;
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
    const { data } = await admin.storage
      .from(OUTPUT_BUCKET)
      .createSignedUrl(output.storagePath, SIGNED_URL_TTL_SECONDS);

    withUrls.push({ ...output, signedUrl: data?.signedUrl ?? null });
  }

  return withUrls;
}

/**
 * Whether this generation's canonical original has left quarantine.
 *
 * Read here rather than imported from the safety module, to keep the storage
 * layer free of a dependency on the admin layer. The question is one row and
 * four columns; duplicating a `select` is cheaper than an import cycle.
 */
async function isGenerationAssetDeliverable(
  admin: SupabaseClient,
  generationId: string
): Promise<boolean> {
  const { data } = await admin
    .from("media_assets")
    .select("quarantine_status,ingest_status,status,tombstoned_at")
    .eq("generation_id", generationId)
    .eq("role", "original")
    .maybeSingle();

  const row = data as {
    quarantine_status?: string;
    ingest_status?: string;
    status?: string;
    tombstoned_at?: string | null;
  } | null;

  if (!row || row.tombstoned_at) return false;

  return (
    row.quarantine_status === "released" &&
    row.ingest_status === "verified" &&
    row.status === "finalized"
  );
}
