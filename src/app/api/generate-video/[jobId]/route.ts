import { getJob } from "@/lib/jobs";

import { guardRoute, privateJson } from "@/lib/security/response-headers";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  // Phase 12-A (application half): anonymous, so the bucket is a hashed
  // platform-trusted address. Never the first x-forwarded-for hop.
  const limited = await guardRoute({ routeClass: "public_dev_stub", headers: request.headers });
  if (limited) return limited;

  try {
    const { jobId } = await params;

    if (!jobId || typeof jobId !== "string") {
      return privateJson(
        { error: "Job ID is required" },
        { status: 400 }
      );
    }

    const job = getJob(jobId);

    if (!job) {
      return privateJson(
        { error: "Job not found" },
        { status: 404 }
      );
    }

    return privateJson({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      result: job.result,
    });
  } catch (error) {
    console.error("Get job status error:", error);
    return privateJson(
      { error: "Failed to retrieve job status" },
      { status: 500 }
    );
  }
}
