import type { IncidentsAdminResult } from "./incidents-admin-contract";

export type IncidentsPanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: Extract<IncidentsAdminResult, { outcome: "FOUND" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretIncidentsResponse(status: number, body: unknown): IncidentsPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null || !("outcome" in body)) {
    return { kind: "unavailable", reasonCode: "malformed_response" };
  }
  const result = body as IncidentsAdminResult;
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  return { kind: "found", result };
}

export function networkErrorState(): IncidentsPanelState {
  return { kind: "unavailable", reasonCode: "network_error" };
}
