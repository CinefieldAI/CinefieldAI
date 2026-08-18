import type { TemporalAdminCancelResult, TemporalInspectionResult } from "./temporal-admin-contract";

/**
 * Pure response -> UI-state mapping for the Phase 16-D Temporal/Workflows
 * panel. Same split every 16-A/16-B/16-C panel already uses, so the mapping
 * is testable with `node:test` without a DOM.
 */
export type TemporalInspectionPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid" }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: Extract<TemporalInspectionResult, { outcome: "FOUND" }> };

export type TemporalCancelPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid" }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "not_allowed"; readonly status: string }
  | {
      readonly kind: "requested";
      readonly alreadyRequested: boolean;
      readonly workflowSignalled: boolean;
    }
  | { readonly kind: "tier0_authorization_required"; readonly reasonCode: string }
  /** PHASE 19 CLOSURE FIX. requirePolicy() denied `temporal.workflow.cancel` before Tier-0 was ever evaluated. */
  | { readonly kind: "policy_denied"; readonly reasonCode: string };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretInspectionResponse(status: number, body: unknown): TemporalInspectionPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null || !("outcome" in body)) {
    return { kind: "unavailable", reasonCode: "malformed_response" };
  }
  const result = body as TemporalInspectionResult;
  if (result.outcome === "INVALID_GENERATION_ID") return { kind: "invalid" };
  if (result.outcome === "GENERATION_NOT_FOUND") return { kind: "not_found" };
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  return { kind: "found", result };
}

export function interpretCancelResponse(status: number, body: unknown): TemporalCancelPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null || !("outcome" in body)) {
    return { kind: "unavailable", reasonCode: "malformed_response" };
  }
  const result = body as TemporalAdminCancelResult;
  if (result.outcome === "INVALID_INPUT") return { kind: "invalid" };
  if (result.outcome === "GENERATION_NOT_FOUND") return { kind: "not_found" };
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  if (result.outcome === "CANCEL_NOT_ALLOWED") return { kind: "not_allowed", status: result.status };
  if (result.outcome === "TIER0_AUTHORIZATION_REQUIRED") {
    return { kind: "tier0_authorization_required", reasonCode: result.reasonCode };
  }
  if (result.outcome === "POLICY_DENIED") {
    return { kind: "policy_denied", reasonCode: result.reasonCode };
  }
  return {
    kind: "requested",
    alreadyRequested: result.alreadyRequested,
    workflowSignalled: result.workflowSignalled,
  };
}

export function networkErrorState(): { readonly kind: "unavailable"; readonly reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
