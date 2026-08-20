import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaProcessingOutcome, ProcessFinalMediaParams } from "./media-processing-pipeline";

/**
 * The Phase 9-C media processor seam.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS: THE NATIVE MODULE MUST NOT REACH THE SERVERLESS BUNDLE
 * ---------------------------------------------------------------------------
 * `media-processing-pipeline.ts` reaches `c2pa-node`, a native module carrying
 * a ~16MB Rust `.node` binary. `orchestrator.ts` is in the import graph of
 * `/api/generations/[generationId]/execute`, so ANY runtime import of the
 * pipeline from the orchestrator — static or dynamic — drags that binary into
 * Vercel's build graph. That forced `serverExternalPackages`, which in turn
 * stopped Vercel consolidating routes and pushed the deployment past the
 * Hobby plan's 12-Serverless-Function ceiling. Production builds failed from
 * c6e1ed4 onward for exactly that reason.
 *
 * The code never needed to be there. In production `resolveGenerationOwner()`
 * is `"temporal"`, so `executeGeneration` runs in the Temporal WORKER — a
 * long-lived container that has ffmpeg and can load a native module. A
 * Next.js route never executes it.
 *
 * So the orchestrator depends on this seam instead. Only `import type` crosses
 * to the pipeline here, and TypeScript erases those entirely — no runtime
 * edge, nothing for a bundler to trace, no `.node` binary in any lambda.
 *
 * ---------------------------------------------------------------------------
 * FAIL-CLOSED WHEN NOT INSTALLED
 * ---------------------------------------------------------------------------
 * The default is `null`, and the orchestrator turns that into
 * `MEDIA_PROVENANCE_FAILED`. A runtime that has not installed a processor
 * cannot mark media, and Phase 27 refuses to complete a generation whose
 * output could not be marked — so "no processor" and "signer unavailable"
 * reach the same refusal rather than one of them quietly succeeding.
 */
export type MediaProcessor = (
  admin: SupabaseClient,
  params: ProcessFinalMediaParams
) => Promise<MediaProcessingOutcome>;

let processor: MediaProcessor | null = null;

/**
 * Installed by the runtime that can actually run FFmpeg and load `c2pa-node`
 * — `worker/activities/generation-activities.ts`. Never by a Next.js route.
 */
export function setMediaProcessor(next: MediaProcessor | null): void {
  processor = next;
}

export function currentMediaProcessor(): MediaProcessor | null {
  return processor;
}
