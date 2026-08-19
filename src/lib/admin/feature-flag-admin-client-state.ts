import type { FeatureFlagAdminListResult, FeatureFlagAdminSetResult } from "./feature-flag-admin-contract";

/** Mirrors `router-admin-client-state.ts`'s shape exactly. */

export type FeatureFlagListPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: Extract<FeatureFlagAdminListResult, { outcome: "FOUND" }> };

export type FeatureFlagActionPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid_target" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "write_failed"; readonly reasonCode: string }
  | { readonly kind: "applied"; readonly result: Extract<FeatureFlagAdminSetResult, { outcome: "APPLIED" }> }
  | { readonly kind: "policy_denied"; readonly reasonCode: string }
  | { readonly kind: "tier0_authorization_required"; readonly reasonCode: string; readonly requestId: string };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretFeatureFlagListResponse(status: number, body: unknown): FeatureFlagListPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if (outcome === "FOUND") return { kind: "found", result: body as Extract<FeatureFlagAdminListResult, { outcome: "FOUND" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function interpretFeatureFlagActionResponse(status: number, body: unknown): FeatureFlagActionPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (typeof body === "object" && body !== null && (body as Record<string, unknown>).outcome === "INVALID_TARGET") {
    return { kind: "invalid_target" };
  }
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if (outcome === "WRITE_FAILED") {
    return { kind: "write_failed", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "write_failed" };
  }
  if (outcome === "APPLIED") return { kind: "applied", result: body as Extract<FeatureFlagAdminSetResult, { outcome: "APPLIED" }> };
  if (outcome === "POLICY_DENIED") {
    return { kind: "policy_denied", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "policy_denied" };
  }
  if (outcome === "TIER0_AUTHORIZATION_REQUIRED") {
    return {
      kind: "tier0_authorization_required",
      reasonCode: (body as { reasonCode?: string }).reasonCode ?? "step_up_required",
      requestId: (body as { requestId?: string }).requestId ?? "",
    };
  }
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function networkErrorState(): { kind: "unavailable"; reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
