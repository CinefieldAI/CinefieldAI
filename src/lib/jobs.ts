// In-memory job storage (development only)
// Production: migrate to Redis or database

export interface JobData {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  estimatedTime: number;
  createdAt: number;
  request: {
    model: string;
    prompt?: string;
    advancedPrompt?: string;
    batchSize?: number;
    resolution?: string;
    aspectRatio?: string;
    duration?: number;
    sound?: boolean;
    [key: string]: unknown;
  };
  result?: {
    videoUrl: string | null;
    error?: string;
  } | null;
}

const jobs = new Map<string, JobData>();

export function createJob(request: JobData["request"]): JobData {
  const jobId = crypto.randomUUID();
  const job: JobData = {
    jobId,
    status: "queued",
    progress: 0,
    estimatedTime: 30,
    createdAt: Date.now(),
    request,
    result: null,
  };

  jobs.set(jobId, job);

  // Simulate progress
  simulateJobProgress(jobId);

  return job;
}

export function getJob(jobId: string): JobData | undefined {
  return jobs.get(jobId);
}

function simulateJobProgress(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  // queued → processing (after 2 seconds)
  setTimeout(() => {
    const current = jobs.get(jobId);
    if (current && current.status === "queued") {
      current.status = "processing";
      current.progress = 30;
    }
  }, 2000);

  // processing → completed (after 5 seconds total)
  setTimeout(() => {
    const current = jobs.get(jobId);
    if (current) {
      current.status = "completed";
      current.progress = 100;
      current.result = {
        videoUrl: null, // Mock: no video URL yet
      };
    }
  }, 5000);

  // Clean up old jobs (keep for 30 minutes)
  setTimeout(() => {
    jobs.delete(jobId);
  }, 30 * 60 * 1000);
}
