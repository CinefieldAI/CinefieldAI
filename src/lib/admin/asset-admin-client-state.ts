import type { AssetAdminResult } from "./asset-admin-contract";

export type AssetPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "found"; readonly result: Extract<AssetAdminResult, { outcome: "FOUND" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretAssetResponse(status: number, body: unknown): AssetPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "INVALID_IDENTIFIER") return { kind: "invalid" };
  if (outcome === "STORAGE_EVIDENCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if (outcome === "ASSET_NOT_FOUND") return { kind: "not_found" };
  if (outcome === "FOUND") return { kind: "found", result: body as Extract<AssetAdminResult, { outcome: "FOUND" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function networkErrorState(): { kind: "unavailable"; reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
