import type { UserInvestigationResult } from "./user-investigation-contract";

/**
 * Pure response -> UI-state mapping for the Phase 16-A/3 User Investigation
 * panel.
 *
 * Kept out of the `"use client"` component, the same split
 * `generation-investigation-client-state.ts` (Phase 16-A/2) already
 * established, so it is testable with `node:test` without a DOM.
 *
 * `denied` and `not_found` are DISTINCT states even though the API returns
 * 404 for both — told apart by body shape (`{error:"not_found"}` for a
 * denial vs. the full `{outcome:"USER_NOT_FOUND"}` result for a genuine
 * miss), and a non-admin caller can never reach the code path that would
 * produce the second shape, so this distinction leaks nothing.
 */
export type UserInvestigationPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: Extract<UserInvestigationResult, { outcome: "FOUND" }> }
  | { readonly kind: "no_generations"; readonly result: Extract<UserInvestigationResult, { outcome: "NO_GENERATIONS" }> }
  | { readonly kind: "partial_data"; readonly result: Extract<UserInvestigationResult, { outcome: "PARTIAL_DATA" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

function isResultShape(value: unknown): value is UserInvestigationResult {
  if (typeof value !== "object" || value === null) return false;
  const outcome = (value as Record<string, unknown>).outcome;
  return (
    outcome === "FOUND" ||
    outcome === "USER_NOT_FOUND" ||
    outcome === "EVIDENCE_UNAVAILABLE" ||
    outcome === "PARTIAL_DATA" ||
    outcome === "NO_GENERATIONS"
  );
}

export function interpretUserInvestigationResponse(status: number, body: unknown): UserInvestigationPanelState {
  if (status === 404) {
    if (isResultShape(body) && body.outcome === "USER_NOT_FOUND") {
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
  if (body.outcome === "USER_NOT_FOUND") {
    return { kind: "not_found" };
  }
  if (body.outcome === "PARTIAL_DATA") {
    return { kind: "partial_data", result: body };
  }
  if (body.outcome === "NO_GENERATIONS") {
    return { kind: "no_generations", result: body };
  }
  return { kind: "found", result: body };
}

export function networkErrorState(): UserInvestigationPanelState {
  return { kind: "unavailable", reasonCode: "network_error" };
}
