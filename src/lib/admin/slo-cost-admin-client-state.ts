import type { SloCostAdminResult } from "./slo-cost-admin-contract";

export type SloCostPanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: Extract<SloCostAdminResult, { outcome: "FOUND" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretSloCostResponse(status: number, body: unknown): SloCostPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null || !("outcome" in body)) {
    return { kind: "unavailable", reasonCode: "malformed_response" };
  }
  const result = body as SloCostAdminResult;
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  return { kind: "found", result };
}

export function networkErrorState(): SloCostPanelState {
  return { kind: "unavailable", reasonCode: "network_error" };
}
