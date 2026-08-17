import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { retryAdminBullmqJob } from "@/lib/admin/bullmq-admin-service";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * POST /api/admin/queue-health/bullmq-retry — Phase 16-B BullMQ auxiliary
 * job retry.
 *
 * Body: `{ queueName: string; jobId: string; reason: string }`. Job state
 * is rechecked server-side immediately before retrying — a client cannot
 * retry a job it merely believes is failed. `durable_write` route class.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "durable_write", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return privateJson({ error: "invalid_body" }, { status: 400 });
  }

  const { queueName, jobId, reason } = (body as { queueName?: unknown; jobId?: unknown; reason?: unknown }) ?? {};
  const result = await retryAdminBullmqJob(access.clerkUserId as string, queueName, jobId, reason);
  return privateJson(result);
}
