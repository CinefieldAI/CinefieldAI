import type { RouterAdminListResult, RouterAdminSetEnabledResult } from "./router-admin-contract";

export type RouterListPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "route_authority_denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: Extract<RouterAdminListResult, { outcome: "FOUND" }> };

export type RouterActionPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "route_authority_denied" }
  | { readonly kind: "invalid_target" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "route_not_found" }
  | { readonly kind: "applied"; readonly result: Extract<RouterAdminSetEnabledResult, { outcome: "APPLIED" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretRouterListResponse(status: number, body: unknown): RouterListPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "ROUTE_AUTHORITY_DENIED") return { kind: "route_authority_denied" };
  if (outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if (outcome === "FOUND") return { kind: "found", result: body as Extract<RouterAdminListResult, { outcome: "FOUND" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function interpretRouterActionResponse(status: number, body: unknown): RouterActionPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (typeof body === "object" && body !== null && (body as Record<string, unknown>).outcome === "INVALID_TARGET") {
    return { kind: "invalid_target" };
  }
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "ROUTE_AUTHORITY_DENIED") return { kind: "route_authority_denied" };
  if (outcome === "ROUTE_NOT_FOUND") return { kind: "route_not_found" };
  if (outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if (outcome === "APPLIED") return { kind: "applied", result: body as Extract<RouterAdminSetEnabledResult, { outcome: "APPLIED" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function networkErrorState(): { kind: "unavailable"; reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
