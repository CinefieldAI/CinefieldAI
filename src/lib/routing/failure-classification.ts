import type { OrchestrationErrorCode } from "@/lib/orchestration/errors";

/**
 * What a failure says about the PROVIDER (Phase 7-C).
 *
 * The circuit breaker exists to stop sending work to a provider that cannot
 * currently do it. That only works if the evidence feeding it is actually
 * about the provider. Treating every failure as a provider failure is how a
 * user who cancels three generations, or a client that sends three invalid
 * aspect ratios, takes a perfectly healthy provider offline for everyone.
 *
 * So each error code is classified once, here, and only the classes that say
 * something about the provider's ability to serve traffic count against it.
 *
 * Pure. No Redis, no database, no provider SDK.
 */

export type FailureClass =
  // --- Provider-attributable: these count against provider health ----------
  /** The provider asked us to slow down. Its fault in the routing sense. */
  | "provider_rate_limit"
  /** The provider returned a server error. */
  | "provider_server_error"
  /** The provider is unreachable or refusing connections. */
  | "provider_unavailable"
  /** The call timed out in transport. */
  | "transport_timeout"
  /** The provider accepted the request and then failed to produce output. */
  | "provider_execution_failure"
  // --- NOT provider-attributable -------------------------------------------
  /** The provider refused the request outright: bad credentials, no quota. */
  | "provider_rejection"
  /** Cinefield's own validation said no. The provider was never asked. */
  | "local_validation"
  /** A person pressed cancel. */
  | "user_cancellation"
  /** Cinefield's own storage, database or bookkeeping broke. */
  | "internal_failure"
  /** Nothing is known about the cause. */
  | "unknown";

/**
 * The classes the breaker and the health score may act on.
 *
 * `provider_rejection` is deliberately absent, and it is the least obvious
 * entry on this list. An auth error or an exhausted quota is a real problem,
 * but it is a problem with Cinefield's ACCOUNT, not with the provider's
 * ability to serve requests — and it will not recover on its own after a
 * cooldown, which is the only thing a breaker knows how to wait for. Opening
 * a breaker on it would produce a route that flaps open and closed forever
 * while the actual fix is an operator updating a credential.
 */
const PROVIDER_ATTRIBUTABLE: ReadonlySet<FailureClass> = new Set<FailureClass>([
  "provider_rate_limit",
  "provider_server_error",
  "provider_unavailable",
  "transport_timeout",
  "provider_execution_failure",
]);

const BY_ERROR_CODE: Readonly<Partial<Record<OrchestrationErrorCode, FailureClass>>> = {
  PROVIDER_RATE_LIMIT: "provider_rate_limit",
  PROVIDER_TIMEOUT: "transport_timeout",
  PROVIDER_FAILED: "provider_execution_failure",
  PROVIDER_NOT_CONFIGURED: "provider_unavailable",
  PROVIDER_AUTH_ERROR: "provider_rejection",
  PROVIDER_QUOTA_EXCEEDED: "provider_rejection",
  // An unconfirmed submission says nothing reliable about provider health and
  // must never be used as breaker evidence — see the ambiguity rules in
  // failover-policy.ts. Classified as unknown on purpose.
  PROVIDER_SUBMISSION_UNKNOWN: "unknown",

  // Local: the request never became the provider's problem.
  INVALID_INPUT: "local_validation",
  UNKNOWN_MODEL: "local_validation",
  MODEL_DISABLED: "local_validation",
  UNSUPPORTED_WORKFLOW: "local_validation",
  REQUIRED_INPUT_MISSING: "local_validation",
  UNSUPPORTED_INPUT_TYPE: "local_validation",
  CAPABILITY_NOT_SUPPORTED: "local_validation",
  AUTH_REQUIRED: "local_validation",
  FORBIDDEN: "local_validation",
  GENERATION_NOT_FOUND: "local_validation",
  NO_ELIGIBLE_ROUTE: "local_validation",

  // Cinefield's own machinery.
  OUTPUT_MISSING: "provider_execution_failure",
  OUTPUT_DOWNLOAD_FAILED: "internal_failure",
  OUTPUT_VALIDATION_FAILED: "provider_execution_failure",
  STORAGE_UPLOAD_FAILED: "internal_failure",
  DATABASE_UPDATE_FAILED: "internal_failure",
  DUPLICATE_EXECUTION: "internal_failure",
  TRIGGER_DISPATCH_FAILED: "internal_failure",
  GENERATION_OWNER_UNAVAILABLE: "internal_failure",
  MOCK_VIDEO_NOT_IMPLEMENTED: "internal_failure",
  INTERNAL_ERROR: "internal_failure",
};

/** Classifies an orchestration error code. Unknown codes stay "unknown". */
export function classifyFailure(errorCode: string | null | undefined): FailureClass {
  if (!errorCode) return "unknown";
  return BY_ERROR_CODE[errorCode as OrchestrationErrorCode] ?? "unknown";
}

/**
 * True when this failure is evidence about the provider.
 *
 * Note that "unknown" is NOT attributable. Fail-closed would be the instinct,
 * but here it points the other way: an unclassified failure is far more often
 * a Cinefield bug than a provider outage, and letting unknowns open breakers
 * means the first unhandled error type takes production routing down with it.
 */
export function countsAgainstProvider(failureClass: FailureClass): boolean {
  return PROVIDER_ATTRIBUTABLE.has(failureClass);
}

/** Convenience: classify and decide in one step. */
export function isProviderAttributableError(errorCode: string | null | undefined): boolean {
  return countsAgainstProvider(classifyFailure(errorCode));
}

/**
 * User cancellation never reaches an error code — it is a lifecycle outcome,
 * not a failure — but the classifier is asked about it by callers that handle
 * both, so it has an explicit answer rather than falling into "unknown".
 */
export function classifyCancellationAsFailure(): FailureClass {
  return "user_cancellation";
}
