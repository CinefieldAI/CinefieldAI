import type { RiskInvestigationResult } from "./risk-investigation-contract";

/**
 * Pure response -> UI-state mapping for the Phase 16-A Risk Investigation
 * panel. Kept out of the `"use client"` component, the same split every
 * other 16-A investigation surface already established, so it is testable
 * with `node:test` without a DOM.
 *
 * `denied` and `invalid` are DISTINCT states even though the API returns 404
 * for a denial and 200/`INVALID_IDENTIFIER` for a malformed identifier —
 * told apart by status code and body shape, and a non-admin caller can never
 * reach the code path that would produce the `invalid` shape (auth is
 * checked before the identifier is even parsed), so this distinction leaks
 * nothing.
 */
export type RiskInvestigationPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "no_evidence" }
  | { readonly kind: "partial"; readonly result: Extract<RiskInvestigationResult, { outcome: "PARTIAL_RISK_EVIDENCE" }> }
  | { readonly kind: "found"; readonly result: Extract<RiskInvestigationResult, { outcome: "FOUND" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

function isResultShape(value: unknown): value is RiskInvestigationResult {
  if (typeof value !== "object" || value === null) return false;
  const outcome = (value as Record<string, unknown>).outcome;
  return (
    outcome === "FOUND" ||
    outcome === "INVALID_IDENTIFIER" ||
    outcome === "RISK_SOURCE_UNAVAILABLE" ||
    outcome === "NO_RISK_EVIDENCE" ||
    outcome === "PARTIAL_RISK_EVIDENCE"
  );
}

export function interpretRiskInvestigationResponse(status: number, body: unknown): RiskInvestigationPanelState {
  if (status === 404) {
    if (isDeniedBody(body)) return { kind: "denied" };
    // A 404 in a shape this client does not recognise fails closed as
    // "denied" — the more conservative of the two, never treated as found.
    return { kind: "denied" };
  }

  if (status < 200 || status >= 300) {
    return { kind: "unavailable", reasonCode: `http_${status}` };
  }

  if (!isResultShape(body)) {
    return { kind: "unavailable", reasonCode: "malformed_response" };
  }

  if (body.outcome === "INVALID_IDENTIFIER") return { kind: "invalid" };
  if (body.outcome === "RISK_SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: body.reasonCode };
  if (body.outcome === "NO_RISK_EVIDENCE") return { kind: "no_evidence" };
  if (body.outcome === "PARTIAL_RISK_EVIDENCE") return { kind: "partial", result: body };
  return { kind: "found", result: body };
}

export function networkErrorState(): RiskInvestigationPanelState {
  return { kind: "unavailable", reasonCode: "network_error" };
}
