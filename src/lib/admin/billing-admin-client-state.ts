import type { BillingAdminResult } from "./billing-admin-contract";

export type BillingPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "no_account" }
  | { readonly kind: "partial"; readonly result: Extract<BillingAdminResult, { outcome: "PARTIAL_DATA" }> }
  | { readonly kind: "found"; readonly result: Extract<BillingAdminResult, { outcome: "FOUND" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretBillingResponse(status: number, body: unknown): BillingPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "INVALID_IDENTIFIER") return { kind: "invalid" };
  if (outcome === "LEDGER_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if (outcome === "NO_ACCOUNT") return { kind: "no_account" };
  if (outcome === "PARTIAL_DATA") return { kind: "partial", result: body as Extract<BillingAdminResult, { outcome: "PARTIAL_DATA" }> };
  if (outcome === "FOUND") return { kind: "found", result: body as Extract<BillingAdminResult, { outcome: "FOUND" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function networkErrorState(): { kind: "unavailable"; reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
