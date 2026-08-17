import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { getAdminDeployRestore } from "@/lib/admin/deploy-restore-admin-service";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/deploy-restore — Phase 16-D Deploy/Restore Health read.
 *
 * Read-only. Rollback signal reuses Phase 14-D's `evaluateRollback()`
 * unchanged with real Phase 13/13-D inputs; restore reuses Phase 15-C's
 * `runRestoreVerification()` verbatim; deploy eligibility and recovery
 * RTO/RPO are reported honestly as unavailable/unconfigured rather than
 * fabricated. See `deploy-restore-admin-contract.ts`.
 */
export async function GET(): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  const result = await getAdminDeployRestore();
  return privateJson(result);
}
