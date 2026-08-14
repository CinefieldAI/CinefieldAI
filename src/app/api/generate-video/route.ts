import { createJob, type GenerateVideoRequest } from "@/lib/jobs";

import { guardRoute, privateJson } from "@/lib/security/response-headers";
import { createLogger } from "@/lib/observability/logger";
import { errorFields } from "@/lib/observability/error-projection";

const log = createLogger("generate-video");
export async function POST(request: Request) {
  // Phase 12-A (application half): anonymous, so the bucket is a hashed
  // platform-trusted address. Never the first x-forwarded-for hop.
  const limited = await guardRoute({ routeClass: "public_dev_stub", headers: request.headers });
  if (limited) return limited;

  try {
    const body = (await request.json()) as Partial<GenerateVideoRequest>;

    // Explicit allow-list — only these fields are ever read from the body.
    const {
      model,
      prompt,
      advancedPrompt,
      batchSize,
      resolution,
      aspectRatio,
      duration,
      sound,
      genre,
      style,
      camera,
      quality,
    } = body;

    // Validate model
    if (!model || typeof model !== "string") {
      return privateJson(
        { error: "Model is required" },
        { status: 400 }
      );
    }

    // Validate effective prompt
    const effectivePrompt = prompt || advancedPrompt;
    if (!effectivePrompt || typeof effectivePrompt !== "string") {
      return privateJson(
        { error: "Prompt or Advanced Prompt is required" },
        { status: 400 }
      );
    }

    // Validate batchSize if provided
    if (batchSize !== undefined) {
      const batchNum = Number(batchSize);
      if (!Number.isInteger(batchNum) || batchNum < 1 || batchNum > 4) {
        return privateJson(
          { error: "Batch size must be a number between 1 and 4" },
          { status: 400 }
        );
      }
    }

    // Create job — explicit allow-list, no unrestricted spreading
    const job = createJob({
      model,
      prompt: prompt || undefined,
      advancedPrompt: advancedPrompt || undefined,
      batchSize: batchSize ? Number(batchSize) : undefined,
      resolution: resolution || undefined,
      aspectRatio: aspectRatio || undefined,
      duration: duration || undefined,
      sound: sound !== undefined ? sound : undefined,
      genre: genre || undefined,
      style: style || undefined,
      camera: camera || undefined,
      quality: quality || undefined,
    });

    return privateJson({
      jobId: job.jobId,
      status: job.status,
      estimatedTime: job.estimatedTime,
    });
  } catch (error) {
    // Phase 13-E. Was `console.error("Generate video error:", error)`, which
    // serializes the message, the stack and any custom property the thrower
    // attached. This is a dev stub over an in-memory Map so nothing secret is
    // in scope TODAY — but Sentry's console integration captures
    // console.error by default, so these two lines would have been the first
    // unredacted stacks shipped to a third party the moment 13-A lands.
    log.error("generate_video_failed", errorFields(error));
    return privateJson(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
