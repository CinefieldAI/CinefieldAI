import type { AdminHealthProjection } from "./admin-health-projection";

/**
 * Pure response -> UI-state mapping for the Phase 16 System Health panel
 * (Phase 16/1).
 *
 * Kept out of the `"use client"` component file so it is testable with
 * `node:test` the same way every other decision function in this codebase
 * is, without needing a DOM or a React renderer.
 *
 * A failed or malformed fetch NEVER becomes `"loaded"`. A 404 becomes
 * `"denied"`, never an empty health report.
 */
export type HealthPanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "loaded"; readonly projection: AdminHealthProjection };

/** Guards the parsed body has at least the shape this panel renders. */
function isAdminHealthProjectionShape(value: unknown): value is AdminHealthProjection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.overallStatus === "string" &&
    typeof candidate.checkedAt === "string" &&
    Array.isArray(candidate.runtimes)
  );
}

export function interpretHealthResponse(status: number, body: unknown): HealthPanelState {
  if (status === 404) {
    return { kind: "denied" };
  }
  if (status < 200 || status >= 300) {
    return { kind: "unavailable", reasonCode: `http_${status}` };
  }
  if (!isAdminHealthProjectionShape(body)) {
    return { kind: "unavailable", reasonCode: "malformed_response" };
  }
  return { kind: "loaded", projection: body };
}

export function networkErrorState(): HealthPanelState {
  return { kind: "unavailable", reasonCode: "network_error" };
}
