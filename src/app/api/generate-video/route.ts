import { NextResponse } from "next/server";
import { createJob } from "@/lib/jobs";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      model,
      prompt,
      advancedPrompt,
      batchSize,
      resolution,
      aspectRatio,
      duration,
      sound,
      ...rest
    } = body;

    // Validate model
    if (!model || typeof model !== "string") {
      return NextResponse.json(
        { error: "Model is required" },
        { status: 400 }
      );
    }

    // Validate effective prompt
    const effectivePrompt = prompt || advancedPrompt;
    if (!effectivePrompt || typeof effectivePrompt !== "string") {
      return NextResponse.json(
        { error: "Prompt or Advanced Prompt is required" },
        { status: 400 }
      );
    }

    // Validate batchSize if provided
    if (batchSize !== undefined) {
      const batchNum = Number(batchSize);
      if (!Number.isInteger(batchNum) || batchNum < 1 || batchNum > 4) {
        return NextResponse.json(
          { error: "Batch size must be a number between 1 and 4" },
          { status: 400 }
        );
      }
    }

    // Create job
    const job = createJob({
      model,
      prompt: prompt || undefined,
      advancedPrompt: advancedPrompt || undefined,
      batchSize: batchSize ? Number(batchSize) : undefined,
      resolution: resolution || undefined,
      aspectRatio: aspectRatio || undefined,
      duration: duration || undefined,
      sound: sound !== undefined ? sound : undefined,
      ...rest,
    });

    return NextResponse.json({
      jobId: job.jobId,
      status: job.status,
      estimatedTime: job.estimatedTime,
    });
  } catch (error) {
    console.error("Generate video error:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
