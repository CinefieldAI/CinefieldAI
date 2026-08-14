/**
 * Canonical error → telemetry projection (Phase 13-E).
 *
 * ---------------------------------------------------------------------------
 * AN ERROR OBJECT IS THE MOST DANGEROUS THING TO LOG
 * ---------------------------------------------------------------------------
 * `console.error("failed:", error)` looks like the most obvious line of code
 * in the world, and it serializes the message, the stack, the `cause` chain,
 * and any custom property the thrower attached. In this codebase that could
 * mean a provider error echoing the user's prompt back, a Supabase driver
 * message quoting row contents, or a fetch failure naming a presigned URL.
 *
 * So an Error never reaches a sink. It is projected into at most four bounded
 * facts, and the projection is a total function that cannot throw.
 *
 * WHAT IS DELIBERATELY NOT HERE: `error.message`. Not "sanitized message", not
 * "first 80 characters of the message" — a message is authored by whoever
 * threw, which for a provider means a third party, and no length limit makes
 * arbitrary third-party text safe. Every Cinefield error type already carries
 * a `code`, which is the field that was designed to be logged.
 */

export interface ProjectedError {
  /** The constructor name, e.g. "OrchestrationError". Never the message. */
  errorClass: string;
  /** A normalized code when the error carries one. */
  errorCode?: string;
  /** Whether the caller may retry, when the error says so. */
  retryable?: boolean;
}

/** Codes are short and lowercase, like every other reason code in the repo. */
const CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * Projects any thrown value.
 *
 * Accepts `unknown` because that is what a `catch` binding is, and a
 * projection that only accepted `Error` would push callers back to logging
 * the raw value in the one case that matters — the non-Error throw.
 */
export function projectError(error: unknown): ProjectedError {
  if (error === null || error === undefined) return { errorClass: "UnknownError" };

  if (typeof error !== "object") {
    // A thrown string or number. Its VALUE is not carried: a thrown string is
    // free text by definition, and free text is what this file exists to keep
    // out of telemetry.
    return { errorClass: `Thrown${capitalize(typeof error)}` };
  }

  const e = error as { name?: unknown; code?: unknown; retryable?: unknown; constructor?: { name?: string } };

  const named = typeof e.name === "string" && CODE_SHAPE.test(e.name) ? e.name : undefined;
  const constructed =
    typeof e.constructor?.name === "string" && CODE_SHAPE.test(e.constructor.name)
      ? e.constructor.name
      : undefined;

  const projected: ProjectedError = { errorClass: named ?? constructed ?? "UnknownError" };

  // `code` is read only when it is already a short code. A driver that puts a
  // sentence in `code` gets nothing rather than a truncated sentence.
  if (typeof e.code === "string" && CODE_SHAPE.test(e.code)) projected.errorCode = e.code;
  if (typeof e.retryable === "boolean") projected.retryable = e.retryable;

  return projected;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The projection as loggable fields.
 *
 * Both keys are allow-listed in the telemetry contract, so this composes with
 * the sanitizer rather than going around it — the sanitizer still validates
 * what comes out of here, which is the correct relationship between a helper
 * and a guard.
 */
export function errorFields(error: unknown): Record<string, string | boolean> {
  const p = projectError(error);
  return {
    errorClass: p.errorClass,
    ...(p.errorCode !== undefined ? { errorCode: p.errorCode } : {}),
    ...(p.retryable !== undefined ? { retryable: p.retryable } : {}),
  };
}
