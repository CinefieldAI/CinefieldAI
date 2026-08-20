/**
 * Cinefield media worker (Phase 9-C).
 *
 * The runtime that performs the roadmap's "FFmpeg → C2PA sign → R2" step. It
 * exists outside `src/` for exactly the reason the Temporal and provider
 * workers do: nothing under the Next.js graph may reach it, and nothing here
 * may be pulled into a browser bundle.
 *
 * ---------------------------------------------------------------------------
 * NOT A SECOND ORCHESTRATOR
 * ---------------------------------------------------------------------------
 * Temporal remains the sole owner of the generation lifecycle (REFERANS G:
 * "Generation lifecycle'ın TEK sahibi Temporal'dır"). This worker performs one
 * bounded media job and reports its outcome. It starts no workflow, completes
 * no generation, writes no generation state, and enqueues no command.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT HOLDS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 * The Phase 12-D injection matrix gives the media worker R2 and nothing else:
 * no Supabase service key, no provider credential. Red notes ¶327/¶1458 are
 * the reason — untrusted bytes reach FFmpeg here, and a parser exploit in a
 * process holding no database credential is a wasted container.
 *
 * That creates one real constraint this file states rather than papers over:
 * `processFinalMedia` needs a Supabase client to write the derived asset and
 * provenance rows. In a deployed split-runtime topology that write belongs
 * behind an internal, authenticated boundary rather than a service key living
 * next to FFmpeg. Until that boundary exists, `runMediaJob` takes the client
 * as a PARAMETER — so the decision of who holds the credential is made by the
 * caller and is visible in the type, not hidden in a module-level singleton.
 *
 * Run:  npm run media:worker
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { processFinalMedia, type FinalMediaStore, type MediaProcessingOutcome } from "@/lib/media/media-processing-pipeline";
import type { DigitalSourceType } from "@/lib/provenance/provenance-contract";

/**
 * A bounded media job. Every field is an identifier, an enum, or bytes — there
 * is no path, no URL, no command, no codec, and no FFmpeg argument anywhere in
 * this shape, so a malicious job cannot direct the transform.
 */
export interface MediaJob {
  readonly sourceAssetId: string;
  readonly derivedAssetId: string;
  readonly bytes: Uint8Array;
  readonly verifiedMime: string;
  readonly digitalSourceType: DigitalSourceType;
  readonly softwareAgent: string;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MediaJobRefusal =
  | "source_asset_id_malformed"
  | "derived_asset_id_malformed"
  | "empty_bytes"
  | "mime_malformed"
  | "digital_source_type_invalid";

const VALID_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "trainedAlgorithmicMedia",
  "compositeWithTrainedAlgorithmicMedia",
  "algorithmicMedia",
]);

/** Validates before any byte is written to disk or handed to FFmpeg. */
export function validateMediaJob(job: MediaJob): { ok: true } | { ok: false; reasonCode: MediaJobRefusal } {
  if (!UUID_SHAPE.test(job.sourceAssetId)) return { ok: false, reasonCode: "source_asset_id_malformed" };
  if (!UUID_SHAPE.test(job.derivedAssetId)) return { ok: false, reasonCode: "derived_asset_id_malformed" };
  if (!job.bytes || job.bytes.byteLength === 0) return { ok: false, reasonCode: "empty_bytes" };
  if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(job.verifiedMime)) return { ok: false, reasonCode: "mime_malformed" };
  if (!VALID_SOURCE_TYPES.has(job.digitalSourceType)) return { ok: false, reasonCode: "digital_source_type_invalid" };
  return { ok: true };
}

export type RunMediaJobOutcome = MediaProcessingOutcome | { readonly outcome: "JOB_REFUSED"; readonly reasonCode: MediaJobRefusal };

export async function runMediaJob(params: {
  admin: SupabaseClient;
  store: FinalMediaStore;
  job: MediaJob;
  now: Date;
}): Promise<RunMediaJobOutcome> {
  const valid = validateMediaJob(params.job);
  if (!valid.ok) return { outcome: "JOB_REFUSED", reasonCode: valid.reasonCode };

  return processFinalMedia(params.admin, {
    sourceAssetId: params.job.sourceAssetId,
    derivedAssetId: params.job.derivedAssetId,
    bytes: params.job.bytes,
    verifiedMime: params.job.verifiedMime,
    digitalSourceType: params.job.digitalSourceType,
    softwareAgent: params.job.softwareAgent,
    store: params.store,
    now: params.now,
  });
}

/**
 * No queue consumer is wired here.
 *
 * The media worker has no SQS statement in its IAM role by construction
 * (6R.22 / ¶1219: "media worker'ın generation command kuyruğuna SendMessage
 * hakkı olmaz"), and inventing a queue for it would create the second
 * dispatch path Phase 9's own design forbids. How a job reaches this worker —
 * a Temporal activity, an internal call — is a deliberate topology decision
 * that belongs with whoever deploys it. `runMediaJob` is the entry point that
 * decision will call.
 */
if (process.argv[1] && process.argv[1].endsWith("media-worker.ts")) {
  console.log(
    "[media-worker] Phase 9-C entry point. No queue consumer is wired — " +
      "runMediaJob() is the callable entry. See this file's header."
  );
}
