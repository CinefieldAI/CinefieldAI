import type { ModelProviderAdminResult } from "./model-provider-admin-contract";

export type ModelProviderPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: Extract<ModelProviderAdminResult, { outcome: "FOUND" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretModelProviderResponse(status: number, body: unknown): ModelProviderPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if (outcome === "FOUND") return { kind: "found", result: body as Extract<ModelProviderAdminResult, { outcome: "FOUND" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function networkErrorState(): { kind: "unavailable"; reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
