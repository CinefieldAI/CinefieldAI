import type { AssetAdminResult } from "./asset-admin-contract";
import type { ModerationActionResult, ModerationAuditResult } from "./moderation-admin-contract";

export interface ModerationViewBody {
  readonly asset: AssetAdminResult;
  readonly audit: ModerationAuditResult;
}

export type ModerationViewPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "loaded"; readonly body: ModerationViewBody };

export type ModerationActionPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid_target" }
  | { readonly kind: "route_authority_denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "result"; readonly result: ModerationActionResult };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretModerationViewResponse(status: number, body: unknown): ModerationViewPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null || !("asset" in body) || !("audit" in body)) {
    return { kind: "unavailable", reasonCode: "malformed_response" };
  }
  return { kind: "loaded", body: body as ModerationViewBody };
}

export function interpretModerationActionResponse(status: number, body: unknown): ModerationActionPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (typeof body === "object" && body !== null && (body as Record<string, unknown>).outcome === "INVALID_TARGET") {
    return { kind: "invalid_target" };
  }
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "ROUTE_AUTHORITY_DENIED") return { kind: "route_authority_denied" };
  if (outcome === "ACTION_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  return { kind: "result", result: body as ModerationActionResult };
}

export function networkErrorState(): { kind: "unavailable"; reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
