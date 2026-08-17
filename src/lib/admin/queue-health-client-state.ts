import type { QueueHealthResult } from "./queue-health-contract";
import type { BullmqFailedJobsResult, BullmqRetryResult } from "./bullmq-admin-contract";

export type QueueHealthPanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "found"; readonly result: QueueHealthResult };

export type BullmqFailedPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not_configured" }
  | { readonly kind: "found"; readonly result: Extract<BullmqFailedJobsResult, { outcome: "FOUND" }> };

export type BullmqRetryPanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "invalid_target" }
  | { readonly kind: "not_configured" }
  | { readonly kind: "job_not_found" }
  | { readonly kind: "not_failed" }
  | { readonly kind: "unavailable"; readonly reasonCode: string }
  | { readonly kind: "retried"; readonly result: Extract<BullmqRetryResult, { outcome: "RETRIED" }> };

function isDeniedBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).error === "not_found";
}

export function interpretQueueHealthResponse(status: number, body: unknown): QueueHealthPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };
  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if ("sqs" in (body as Record<string, unknown>) && "bullmq" in (body as Record<string, unknown>)) {
    return { kind: "found", result: body as QueueHealthResult };
  }
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function interpretBullmqFailedResponse(status: number, body: unknown): BullmqFailedPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (status < 200 || status >= 300) return { kind: "idle" };
  if (typeof body !== "object" || body === null) return { kind: "idle" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "NOT_CONFIGURED") return { kind: "not_configured" };
  if (outcome === "FOUND") return { kind: "found", result: body as Extract<BullmqFailedJobsResult, { outcome: "FOUND" }> };
  return { kind: "idle" };
}

export function interpretBullmqRetryResponse(status: number, body: unknown): BullmqRetryPanelState {
  if (status === 404 && isDeniedBody(body)) return { kind: "denied" };
  if (typeof body === "object" && body !== null && (body as Record<string, unknown>).outcome === "INVALID_TARGET") {
    return { kind: "invalid_target" };
  }
  if (status < 200 || status >= 300) return { kind: "unavailable", reasonCode: `http_${status}` };
  if (typeof body !== "object" || body === null) return { kind: "unavailable", reasonCode: "malformed_response" };

  const outcome = (body as Record<string, unknown>).outcome;
  if (outcome === "NOT_CONFIGURED") return { kind: "not_configured" };
  if (outcome === "JOB_NOT_FOUND") return { kind: "job_not_found" };
  if (outcome === "NOT_FAILED") return { kind: "not_failed" };
  if (outcome === "SOURCE_UNAVAILABLE") {
    return { kind: "unavailable", reasonCode: (body as { reasonCode?: string }).reasonCode ?? "unavailable" };
  }
  if (outcome === "RETRIED") return { kind: "retried", result: body as Extract<BullmqRetryResult, { outcome: "RETRIED" }> };
  return { kind: "unavailable", reasonCode: "malformed_response" };
}

export function networkErrorState(): { kind: "unavailable"; reasonCode: string } {
  return { kind: "unavailable", reasonCode: "network_error" };
}
