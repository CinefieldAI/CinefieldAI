import type { DlqAdminInvestigationResult, DlqAdminRedriveResult } from "./dlq-admin-contract";

/**
 * Pure response -> UI-state mapping for the Phase 16-B Failed Jobs / DLQ
 * panel. Two independent state machines on one page: investigation (a read,
 * safe to run anytime) and redrive (a mutation, gated behind explicit
 * confirmation and only ever attempted after an investigation showed
 * `SAFE_TO_REDRIVE`).
 */

export type DlqInvestigationPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "no_message" }
  | { readonly kind: "decided"; readonly result: Extract<DlqAdminInvestigationResult, { outcome: "DECIDED" }> };

export type DlqRedrivePanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid_reason" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "no_message" }
  | { readonly kind: "refused"; readonly result: Extract<DlqAdminRedriveResult, { outcome: "REFUSED" }> }
  | { readonly kind: "redriven"; readonly result: Extract<DlqAdminRedriveResult, { outcome: "REDRIVEN" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretDlqInvestigationResponse(status: number, body: unknown): DlqInvestigationPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "NOT_CONFIGURED" || outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "not_configured" };
  }
  if (outcome === "NO_MESSAGE") return { kind: "no_message" };
  if (outcome === "DECIDED") return { kind: "decided", result: body as Extract<DlqAdminInvestigationResult, { outcome: "DECIDED" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function interpretDlqRedriveResponse(status: number, body: unknown): DlqRedrivePanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status === 400 && typeof body === "object" && body !== null && (body as Record<string, unknown>).error === "invalid_reason") {
    return { kind: "invalid_reason" };
  }
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "NOT_CONFIGURED" || outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "not_configured" };
  }
  if (outcome === "NO_MESSAGE") return { kind: "no_message" };
  if (outcome === "REFUSED") return { kind: "refused", result: body as Extract<DlqAdminRedriveResult, { outcome: "REFUSED" }> };
  if (outcome === "REDRIVEN") return { kind: "redriven", result: body as Extract<DlqAdminRedriveResult, { outcome: "REDRIVEN" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function networkErrorState(): { kind: "unavailable"; reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
