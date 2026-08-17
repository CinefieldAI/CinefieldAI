import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { listAdminBullmqFailedJobs } from "@/lib/admin/bullmq-admin-service";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/** GET /api/admin/queue-health/bullmq-failed — bounded failed-job list per auxiliary queue. */
export async function GET(): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  const result = await listAdminBullmqFailedJobs();
  return privateJson(result);
}
