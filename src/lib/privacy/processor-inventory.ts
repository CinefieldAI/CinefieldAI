/**
 * Cinefield third-party processor / DPA / data-region inventory (Phase 23-A/D).
 *
 * Source-controlled TypeScript, same reasoning as `data-classification.ts`.
 * Every real processor this codebase actually sends prompt/media/user data
 * to today, per `src/lib/orchestration/provider-registry.ts`'s registered
 * adapters and the infra clients this repo really calls (R2/S3/SQS/
 * Temporal/Clerk) — not the full "named but deferred" provider list in
 * `secret-registry.ts` (OpenAI, ElevenLabs, Runway, Stripe, ...), since
 * this inventory's purpose is "where does data ACTUALLY go", and a
 * `requirement: "DEFERRED"` secret with no adapter file sends nothing.
 *
 * `dpaStatus` is honest, not aspirational: `NOT_CONFIGURED` for every
 * processor here means no signed Data Processing Agreement is tracked in
 * this repository — verifying/executing a real DPA with a vendor is a
 * `BUSINESS_DECISION_REQUIRED` action outside what code can prove, exactly
 * like every other "no live paid service" deferral this project already
 * discloses (Braintrust, LaunchDarkly, OPA sidecar). This module makes the
 * GAP visible on the admin privacy view (23-D's own done-criterion:
 * "Audit edilen processor/data-region görünürlüğü var") — it does not
 * pretend the gap is closed.
 */

export type DpaStatus = "SIGNED" | "NOT_CONFIGURED";

export interface ProcessorEntry {
  readonly processorId: string;
  readonly name: string;
  readonly purpose: string;
  readonly dataCategoriesSent: readonly string[];
  readonly region: string;
  readonly dpaStatus: DpaStatus;
  /** Which real code path sends data here — a file, not a guess. */
  readonly route: string;
}

export const PROCESSOR_INVENTORY: readonly ProcessorEntry[] = [
  {
    processorId: "fal",
    name: "fal.ai",
    purpose: "Image/video generation provider.",
    dataCategoriesSent: ["prompt", "reference_media"],
    region: "US (per fal.ai's own infrastructure, not configurable here)",
    dpaStatus: "NOT_CONFIGURED",
    route: "src/lib/orchestration/providers/fal-provider.ts",
  },
  {
    processorId: "gemini",
    name: "Google Gemini",
    purpose: "Image generation provider.",
    dataCategoriesSent: ["prompt", "reference_media"],
    region: "US (Google's default; not region-pinned by this codebase)",
    dpaStatus: "NOT_CONFIGURED",
    route: "src/lib/orchestration/providers/gemini-provider.ts",
  },
  {
    processorId: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    purpose: "Audio (TTS) generation provider.",
    dataCategoriesSent: ["prompt"],
    region: "Cloudflare global network (not region-pinned by this codebase)",
    dpaStatus: "NOT_CONFIGURED",
    route: "src/lib/orchestration/providers/cloudflare-workers-ai-provider.ts",
  },
  {
    processorId: "clerk",
    name: "Clerk",
    purpose: "User identity, authentication, session management.",
    dataCategoriesSent: ["email", "username", "auth_metadata"],
    region: "per Clerk's own configured instance region",
    dpaStatus: "NOT_CONFIGURED",
    route: "src/proxy.ts, @clerk/nextjs/server usage repo-wide",
  },
  {
    processorId: "supabase",
    name: "Supabase (Postgres)",
    purpose: "Primary durable data store for every table in this repository.",
    dataCategoriesSent: ["all_application_data"],
    region: "per the configured Supabase project region",
    dpaStatus: "NOT_CONFIGURED",
    route: "src/lib/supabase/supabaseAdmin.ts",
  },
  {
    processorId: "cloudflare-r2",
    name: "Cloudflare R2",
    purpose: "Hot object storage for generated/uploaded media.",
    dataCategoriesSent: ["generated_media", "uploaded_media"],
    region: "Cloudflare global network (not region-pinned by this codebase)",
    dpaStatus: "NOT_CONFIGURED",
    route: "src/lib/media/r2-client.ts",
  },
  {
    processorId: "aws-s3-dr",
    name: "AWS S3 (DR backup)",
    purpose: "Disaster-recovery copy of finalized media objects.",
    dataCategoriesSent: ["generated_media", "uploaded_media"],
    region: "per CINEFIELD_DR_AWS_REGION",
    dpaStatus: "NOT_CONFIGURED",
    route: "src/lib/media/dr-backup-service.ts",
  },
  {
    processorId: "aws-sqs",
    name: "AWS SQS",
    purpose: "Provider job queue transport (generation identifiers/routing metadata, not media bytes).",
    dataCategoriesSent: ["generation_id", "routing_metadata"],
    region: "per the configured AWS region",
    dpaStatus: "NOT_CONFIGURED",
    route: "src/lib/aws/sqs-client.ts",
  },
  {
    processorId: "temporal-cloud",
    name: "Temporal Cloud",
    purpose: "Generation workflow orchestration state.",
    dataCategoriesSent: ["generation_id", "workflow_state"],
    region: "per the configured Temporal Cloud namespace",
    dpaStatus: "NOT_CONFIGURED",
    route: "worker/workflows/generation-workflow.ts",
  },
] as const;

export function processorFor(processorId: string): ProcessorEntry | null {
  return PROCESSOR_INVENTORY.find((entry) => entry.processorId === processorId) ?? null;
}
