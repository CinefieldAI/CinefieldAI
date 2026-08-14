/**
 * Cinefield orchestration — typed error system.
 *
 * Every failure path in the orchestration chain produces one of these
 * codes. Each carries a safe user-facing message, an HTTP status, and a
 * retryable flag. Internal context is kept separate from the user message
 * and must never contain secrets, tokens, headers, signed URLs, or raw
 * provider payloads.
 */

export type OrchestrationErrorCode =
  | "AUTH_REQUIRED"
  | "GENERATION_NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "UNKNOWN_MODEL"
  | "MODEL_DISABLED"
  | "UNSUPPORTED_WORKFLOW"
  | "REQUIRED_INPUT_MISSING"
  | "UNSUPPORTED_INPUT_TYPE"
  | "CAPABILITY_NOT_SUPPORTED"
  | "REDIS_CONFIGURATION_INVALID"
  | "R2_CONFIGURATION_INVALID"
  | "ASSET_STORAGE_FAILED"
  | "ASSET_RECORD_FAILED"
  | "MEDIA_INGEST_REJECTED"
  | "DR_CONFIGURATION_INVALID"
  | "DR_BACKUP_FAILED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_AUTH_ERROR"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_QUOTA_EXCEEDED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_FAILED"
  | "PROVIDER_SUBMISSION_UNKNOWN"
  | "OUTPUT_MISSING"
  | "OUTPUT_DOWNLOAD_FAILED"
  | "OUTPUT_VALIDATION_FAILED"
  | "STORAGE_UPLOAD_FAILED"
  | "DATABASE_UPDATE_FAILED"
  | "DUPLICATE_EXECUTION"
  | "MOCK_VIDEO_NOT_IMPLEMENTED"
  | "TRIGGER_DISPATCH_FAILED"
  | "GENERATION_OWNER_UNAVAILABLE"
  | "NO_ELIGIBLE_ROUTE"
  | "NO_HEALTHY_ROUTE"
  | "FAILOVER_EXHAUSTED"
  | "RECONCILIATION_REQUIRED"
  | "INTERNAL_ERROR";

interface ErrorDefinition {
  message: string;
  status: number;
  retryable: boolean;
}

const ERROR_DEFINITIONS: Record<OrchestrationErrorCode, ErrorDefinition> = {
  AUTH_REQUIRED: { message: "Authentication required.", status: 401, retryable: false },
  GENERATION_NOT_FOUND: { message: "Generation not found.", status: 404, retryable: false },
  FORBIDDEN: { message: "Generation not found.", status: 404, retryable: false },
  INVALID_INPUT: { message: "The request contains invalid input.", status: 400, retryable: false },
  UNKNOWN_MODEL: { message: "This model is not available.", status: 400, retryable: false },
  MODEL_DISABLED: { message: "This model is currently disabled.", status: 400, retryable: false },
  UNSUPPORTED_WORKFLOW: {
    message: "This combination of model and inputs is not supported.",
    status: 400,
    retryable: false,
  },
  REQUIRED_INPUT_MISSING: {
    message: "A required input is missing for this workflow.",
    status: 400,
    retryable: false,
  },
  UNSUPPORTED_INPUT_TYPE: {
    message: "One of the attached files is not supported by this model.",
    status: 400,
    retryable: false,
  },
  CAPABILITY_NOT_SUPPORTED: {
    message: "A selected setting is not supported by this model.",
    status: 400,
    retryable: false,
  },
  // R2 is enabled-by-necessity from Phase 9-A: there is no "storage is off"
  // deployment shape once media lives there, so a bad value is an operator
  // mistake rather than a valid state.
  R2_CONFIGURATION_INVALID: {
    message: "A service is temporarily unavailable.",
    status: 503,
    retryable: false,
  },
  // The bytes could not be persisted to hot storage. Retryable: the provider
  // result is still addressable, so another attempt can re-fetch and re-store.
  ASSET_STORAGE_FAILED: {
    message: "The generated media could not be stored.",
    status: 502,
    retryable: true,
  },
  // The object exists but its durable record does not. The generation MUST
  // NOT complete on this — see the finalization boundary (M2).
  ASSET_RECORD_FAILED: {
    message: "The generated media could not be recorded.",
    status: 500,
    retryable: true,
  },
  // The provider may have succeeded perfectly and the bytes may be stored:
  // this says the INGEST GATE refused them. Kept distinct from PROVIDER_FAILED
  // so a media-safety refusal never sends a healthy provider to the circuit
  // breaker. Not retryable — the same bytes will be refused again.
  MEDIA_INGEST_REJECTED: {
    message: "The generated media did not pass safety validation.",
    status: 422,
    retryable: false,
  },
  // DR is optional: a deployment without it stores and serves media correctly.
  // This means an operator ASKED for DR and got the details wrong, which is
  // worth failing loudly rather than silently skipping every backup.
  DR_CONFIGURATION_INVALID: {
    message: "A service is temporarily unavailable.",
    status: 503,
    retryable: false,
  },
  // A DURABILITY problem, never a media problem. The canonical R2 object is
  // untouched, the generation is unaffected, and no provider is implicated —
  // this must never reach a circuit breaker or trigger a re-generation.
  DR_BACKUP_FAILED: {
    message: "A background task did not complete.",
    status: 502,
    retryable: true,
  },
  // Enabled with a URL the client cannot use. Distinct from "not enabled",
  // which is a valid deployment shape — this is an operator mistake, and
  // reporting it as "Redis is off" would silently drop rate limits, locks
  // and runtime routing controls.
  REDIS_CONFIGURATION_INVALID: {
    message: "A service is temporarily unavailable.",
    status: 503,
    retryable: false,
  },
  PROVIDER_NOT_CONFIGURED: {
    message: "This provider is not configured.",
    status: 503,
    retryable: false,
  },
  PROVIDER_AUTH_ERROR: {
    message: "The provider rejected the request credentials.",
    status: 502,
    retryable: false,
  },
  PROVIDER_RATE_LIMIT: {
    message: "The provider is rate limiting requests. Please try again shortly.",
    status: 429,
    retryable: true,
  },
  PROVIDER_QUOTA_EXCEEDED: {
    message: "The provider quota has been exceeded.",
    status: 402,
    retryable: false,
  },
  PROVIDER_TIMEOUT: {
    message: "The provider timed out. Please try again.",
    status: 504,
    retryable: true,
  },
  PROVIDER_FAILED: {
    message: "Generation failed at the provider. Please try again.",
    status: 502,
    retryable: true,
  },
  // Deliberately NOT retryable: an unconfirmed submit may already have
  // created a billable provider job, so an automatic resubmission could
  // double-charge. Reconciliation (Phase 7) is the only safe way forward.
  PROVIDER_SUBMISSION_UNKNOWN: {
    message:
      "The provider did not confirm whether this job started, so it will not be retried automatically.",
    status: 502,
    retryable: false,
  },
  OUTPUT_MISSING: { message: "The provider returned no output.", status: 502, retryable: true },
  OUTPUT_DOWNLOAD_FAILED: {
    message: "The generated output could not be retrieved.",
    status: 502,
    retryable: true,
  },
  OUTPUT_VALIDATION_FAILED: {
    message: "The generated output was invalid.",
    status: 502,
    retryable: false,
  },
  STORAGE_UPLOAD_FAILED: {
    message: "The generated output could not be stored.",
    status: 500,
    retryable: true,
  },
  DATABASE_UPDATE_FAILED: {
    message: "The generation could not be updated.",
    status: 500,
    retryable: true,
  },
  DUPLICATE_EXECUTION: {
    message: "This generation is already being processed or has finished.",
    status: 409,
    retryable: false,
  },
  MOCK_VIDEO_NOT_IMPLEMENTED: {
    message: "Mock video generation is not implemented.",
    status: 501,
    retryable: false,
  },
  TRIGGER_DISPATCH_FAILED: {
    message: "The background job could not be queued. Please try again.",
    status: 503,
    retryable: true,
  },
  // Phase 6R-B fail-closed outcome: no generation owner is available in this
  // deployment. Deliberately NOT retryable — retrying changes nothing until an
  // operator enables Temporal ownership, and marking it retryable would invite
  // a client loop that looks like an outage recovering when it is not.
  GENERATION_OWNER_UNAVAILABLE: {
    message: "Generation is temporarily unavailable. Please try again later.",
    status: 503,
    retryable: false,
  },
  // Phase 7-B. The model is real and the request is valid, but no enabled
  // route can serve it — every candidate provider is disabled, retired, or has
  // no adapter in the running deployment. Not retryable: retrying changes
  // nothing until an operator enables a route, and the router will never
  // invent a destination.
  NO_ELIGIBLE_ROUTE: {
    message: "This model is temporarily unavailable. Please try another model.",
    status: 503,
    retryable: false,
  },
  // Phase 7-C. Routes exist and are configured correctly, but every one is
  // currently excluded by an open circuit breaker. Distinct from
  // NO_ELIGIBLE_ROUTE because the operator response differs: nothing is
  // misconfigured, a provider is failing. Retryable — unlike a disabled route,
  // a breaker heals on its own after its cooldown.
  NO_HEALTHY_ROUTE: {
    message: "This model is temporarily unavailable. Please try again shortly.",
    status: 503,
    retryable: true,
  },
  // Phase 7-C. Every safe alternative has been tried and the bound is reached.
  // Not retryable: another attempt would exceed the attempt ceiling that
  // exists to keep one request from becoming many billable jobs.
  FAILOVER_EXHAUSTED: {
    message: "Generation failed after trying every available provider.",
    status: 502,
    retryable: false,
  },
  // Phase 7-C. A provider job may exist and Cinefield cannot prove otherwise.
  // Deliberately NOT retryable and deliberately NOT failed-over: this is the
  // AMBIGUOUS != SAFE TO RETRY rule surfacing as a typed outcome.
  RECONCILIATION_REQUIRED: {
    message:
      "This generation could not be confirmed and will not be retried automatically.",
    status: 502,
    retryable: false,
  },
  INTERNAL_ERROR: { message: "Something went wrong. Please try again.", status: 500, retryable: false },
};

export class OrchestrationError extends Error {
  readonly code: OrchestrationErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly userMessage: string;
  /** Sanitized, non-secret detail for server logs only. Never returned raw. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: OrchestrationErrorCode,
    options?: { context?: Record<string, unknown>; userMessage?: string }
  ) {
    const definition = ERROR_DEFINITIONS[code];
    super(`${code}: ${definition.message}`);
    this.name = "OrchestrationError";
    this.code = code;
    this.status = definition.status;
    this.retryable = definition.retryable;
    this.userMessage = options?.userMessage ?? definition.message;
    this.context = options?.context;
  }

  /** Shape returned to the browser. Contains no internals or stack traces. */
  toResponseBody(): { error: string; code: OrchestrationErrorCode; retryable: boolean } {
    return { error: this.userMessage, code: this.code, retryable: this.retryable };
  }
}

export function isOrchestrationError(value: unknown): value is OrchestrationError {
  return value instanceof OrchestrationError;
}

/**
 * Converts any thrown value into an OrchestrationError. Unknown throwables
 * collapse to INTERNAL_ERROR so raw messages never reach the browser.
 */
export function toOrchestrationError(value: unknown): OrchestrationError {
  if (isOrchestrationError(value)) return value;
  return new OrchestrationError("INTERNAL_ERROR");
}

// ---- Retry foundation ------------------------------------------------------
// Classification only. No background worker and no in-request sleeping — a
// future durable queue will consume this policy.

export interface RetryPolicy {
  maxAttempts: number;
  /** Backoff delays in milliseconds, applied by a future queue worker. */
  backoffMs: number[];
  retryableCodes: OrchestrationErrorCode[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: [5_000, 20_000, 60_000],
  retryableCodes: [
    "PROVIDER_RATE_LIMIT",
    "PROVIDER_TIMEOUT",
    "PROVIDER_FAILED",
    "OUTPUT_MISSING",
    "OUTPUT_DOWNLOAD_FAILED",
    "STORAGE_UPLOAD_FAILED",
    "DATABASE_UPDATE_FAILED",
  ],
};

export function isRetryable(
  error: OrchestrationError,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): boolean {
  return policy.retryableCodes.includes(error.code);
}

// ---- Ambiguous submission classification -----------------------------------
// Applies to errors raised during the submit() window ONLY, and is
// deliberately FAIL-CLOSED: an error is ambiguous unless its code positively
// proves no external provider job was created.
//
// The inverse (an allowlist of "ambiguous" codes) is unsafe, because an
// adapter's submit() window is not limited to the create-job request. A real
// adapter may enqueue a job and then keep waiting on status/result inside the
// same call — the fal adapter's client.subscribe() does exactly that — so a
// generic-looking failure (a dropped socket, a 429 on a status poll, an
// unparseable result payload) can be raised long AFTER a billable job exists.
// Those all collapse into PROVIDER_FAILED / PROVIDER_RATE_LIMIT /
// OUTPUT_MISSING, which say nothing about whether a job was created. Treating
// them as "definitely not submitted" is precisely how a duplicate, double-
// billed job gets started on retry.
//
// Only codes raised strictly BEFORE the provider could accept work — local
// validation, missing configuration, and gate rejections that mean the
// provider refused the request outright rather than starting it — prove
// there is nothing to reconcile.
const PROVES_NO_PROVIDER_JOB: OrchestrationErrorCode[] = [
  // Never left Cinefield.
  "PROVIDER_NOT_CONFIGURED",
  "INVALID_INPUT",
  "UNKNOWN_MODEL",
  "MODEL_DISABLED",
  "UNSUPPORTED_WORKFLOW",
  "REQUIRED_INPUT_MISSING",
  "UNSUPPORTED_INPUT_TYPE",
  "CAPABILITY_NOT_SUPPORTED",
  // The provider refused the request instead of starting work: no job, no
  // charge. (A credentials rejection or an exhausted quota is a gate answer,
  // not a partially-executed job.)
  "PROVIDER_AUTH_ERROR",
  "PROVIDER_QUOTA_EXCEEDED",
  // Cinefield's own persistence/bookkeeping, raised around the provider call.
  "DATABASE_UPDATE_FAILED",
  "DUPLICATE_EXECUTION",
];

/**
 * True when this submit-window error proves no external provider job can
 * exist. Everything else must be treated as an ambiguous submission.
 *
 * NOTE for callers: a provider that cannot create external jobs at all (the
 * mock provider) is exempt from ambiguity regardless of error code — that
 * check belongs to the caller, which knows whether the model is a mock.
 */
export function provesNoProviderJob(error: OrchestrationError): boolean {
  return PROVES_NO_PROVIDER_JOB.includes(error.code);
}
