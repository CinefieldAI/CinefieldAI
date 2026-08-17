import type { PrivilegedAuditResult } from "./privileged-audit-contract";

/**
 * Phase 16-E Privileged Action Audit — client-state interpretation, mirroring
 * every other Phase 16 `*-client-state.ts` file's `interpret*Response`/
 * `networkErrorState` shape exactly (see `security-center-client-state.ts`).
 */

export type PrivilegedAuditPanelState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "unavailable"; reasonCode: string }
  | { kind: "found"; result: Extract<PrivilegedAuditResult, { outcome: "FOUND" }> };

export function interpretPrivilegedAuditResponse(status: number, body: unknown): PrivilegedAuditPanelState {
  if (status === 404) return { kind: "denied" };
  if (!body || typeof body !== "object") return { kind: "unavailable", reasonCode: "malformed_response" };

  const result = body as PrivilegedAuditResult;
  if (result.outcome === "SOURCE_UNAVAILABLE") return { kind: "unavailable", reasonCode: result.reasonCode };
  if (result.outcome === "FOUND") return { kind: "found", result };
  return { kind: "unavailable", reasonCode: "unrecognized_outcome" };
}

export function networkErrorState(): PrivilegedAuditPanelState {
  return { kind: "unavailable", reasonCode: "network_error" };
}
