import { NextResponse } from "next/server";
import { requireAdminAccess } from "@/lib/admin/require-admin-access";
import { collectAdminHealth } from "@/lib/admin/admin-health-service";
import { guardRoute, privateJson } from "@/lib/security/response-headers";

/**
 * GET /api/admin/health — the Phase 16 admin-only health read (Phase 16/1).
 *
 * ---------------------------------------------------------------------------
 * NOT THE PUBLIC LIVENESS ROUTE
 * ---------------------------------------------------------------------------
 * `/api/health/live` stays exactly as it was — anonymous, minimal, no
 * dependency detail, unmodified by this batch. This route is the opposite on
 * every axis: admin-only, and it deliberately DOES return dependency-level
 * detail, because that disclosure risk is exactly what `requireAdminAccess`
 * exists to gate.
 *
 * ---------------------------------------------------------------------------
 * AN UNAUTHORIZED CALLER LEARNS NOTHING
 * ---------------------------------------------------------------------------
 * Both "no session" and "session but not an admin" return the SAME opaque
 * 404 body — the same choice `admin-route-service.ts`'s `assertRouteAdmin`
 * already made for Phase 7-B, and for the same reason: a 401-vs-404 split
 * would tell an unauthenticated prober that an admin surface exists here at
 * all.
 *
 * ---------------------------------------------------------------------------
 * READ ONLY
 * ---------------------------------------------------------------------------
 * The only calls this handler makes are an authorization check and
 * `collectAdminHealth()`, itself only `readiness()` calls. No provider
 * execution, no queue mutation, no database write, no route/kill-switch/
 * quarantine/deploy/rollback/billing action exists in this file or in
 * anything it imports.
 */

export async function GET(): Promise<NextResponse> {
  const access = await requireAdminAccess();
  if (!access.allowed) {
    return privateJson({ error: "not_found" }, { status: 404 });
  }

  // Phase 12-A (application half). This route has no side effect either way,
  // but every guarded route in this codebase calls guardRoute before its
  // body runs, and an admin surface is not the place to be the exception.
  const limited = await guardRoute({ routeClass: "authenticated_read", userId: access.clerkUserId ?? undefined });
  if (limited) return limited;

  const projection = await collectAdminHealth();
  return privateJson(projection);
}
