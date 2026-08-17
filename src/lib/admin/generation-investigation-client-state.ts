import type { GenerationInvestigationResult } from "./generation-investigation-contract";

/**
 * Pure response -> UI-state mapping for the Phase 16-A/2 Generation
 * Investigation panel.
 *
 * Kept out of the `"use client"` component, the same split
 * `admin-health-client-state.ts` (Phase 16/1) already established, so it is
 * testable with `node:test` without a DOM.
 *
 * `denied` and `not_found` are DISTINCT states even though the API returns
 * 404 for both — they are told apart by body shape (`{error:"not_found"}`
 * for a denial vs. the full `{outcome:"GENERATION_NOT_FOUND"}` result for a
 * genuine miss), and a non-admin caller can never reach the code path that
 * would produce the second shape, so this distinction leaks nothing.
 */
export type InvestigationPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: Extract<GenerationInvestigationResult, { outcome: "FOUND" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

function isResultShape(value: unknown): value is GenerationInvestigationResult {
  if (typeof value !== "object" || value === null) return false;
  const outcome = (value as Record<string, unknown>).outcome;
  return outcome === "FOUND" || outcome === "GENERATION_NOT_FOUND" || outcome === "EVIDENCE_UNAVAILABLE";
}

export function interpretInvestigationResponse(status: number, body: unknown): InvestigationPanelState {
  if (status === 404) {
    if (isResultShape(body) && body.outcome === "GENERATION_NOT_FOUND") {
      return { kind: "not_found" };
    }
    if (isDeniedBody(body)) {
      return { kind: "denied" };
    }
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

  if (body.outcome === "EVIDENCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: body.reasonCode };
  }
  if (body.outcome === "GENERATION_NOT_FOUND") {
    return { kind: "not_found" };
  }
  return { kind: "found", result: body };
}

export function networkErrorState(): InvestigationPanelState {
  return { kind: "unavailable", reasonCode: "network_error" };
}
