import "server-only";

/**
 * Cinefield execution mode — decides whether a generation runs synchronously
 * inside the API request (`direct`) or is handed to Trigger.dev as a
 * background job (`trigger`).
 *
 * `direct` is always safe: it is the exact synchronous path already proven
 * by the mock and fal.ai end-to-end tests, and requires no external service.
 *
 * `trigger` is opt-in twice over — GENERATION_EXECUTION_MODE must explicitly
 * request it AND TRIGGER_SECRET_KEY must actually be present — so an
 * unconfigured environment (e.g. local dev with no Trigger.dev project yet)
 * always falls back to `direct` rather than failing or silently misrouting.
 */

export type ExecutionMode = "direct" | "trigger";

/** True only when a Trigger.dev secret key is present. Never reads its value. */
export function isTriggerConfigured(): boolean {
  const key = process.env.TRIGGER_SECRET_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

export function resolveExecutionMode(): ExecutionMode {
  const requested = process.env.GENERATION_EXECUTION_MODE;
  return requested === "trigger" && isTriggerConfigured() ? "trigger" : "direct";
}
