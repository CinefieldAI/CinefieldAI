import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    if (!jobId || typeof jobId !== "string") {
      return NextResponse.json(
        { error: "Job ID is required" },
        { status: 400 }
      );
    }

    const job = getJob(jobId);

    if (!job) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      result: job.result,
    });
  } catch (error) {
    console.error("Get job status error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve job status" },
      { status: 500 }
    );
  }
}
