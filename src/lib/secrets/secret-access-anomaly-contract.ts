/**
 * Cinefield secret-access-anomaly ingest contract (Phase 25-D).
 *
 * What an external CloudTrail forwarder is allowed to report about ONE
 * anomalous KMS decrypt / Secrets Manager read. Bounded on purpose, same
 * discipline `drift-report-contract.ts` (Phase 18-D) already established:
 * no raw CloudTrail event JSON, no request parameters, no response
 * payload — a CloudTrail record can itself contain the secret ID and
 * caller context in forms this contract deliberately narrows before
 * anything is stored.
 */

const ENVIRONMENT_VALUES = ["development", "staging", "production"] as const;
export type AnomalyEnvironment = (typeof ENVIRONMENT_VALUES)[number];

/** The two CloudTrail event names this bridge exists for — nothing else is "a secret read". */
const EVENT_NAMES = ["GetSecretValue", "Decrypt"] as const;
export type AnomalyEventName = (typeof EVENT_NAMES)[number];

const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;
/** An AWS ARN shape, bounded — the principal, never a secret value. */
const PRINCIPAL_PATTERN = /^arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{0,12}:[A-Za-z0-9/_.:+=,@-]{1,200}$/;

export interface SecretAccessAnomalyReport {
  readonly secretName: string;
  readonly environment: AnomalyEnvironment;
  readonly eventName: AnomalyEventName;
  /** The IAM principal ARN CloudTrail recorded — never the secret, never a request parameter. */
  readonly principalArn: string;
  /** Short code, e.g. "unusual_source_ip", "off_hours_access", "excessive_read_rate". Never free text. */
  readonly reasonCode: string;
  readonly occurredAt: string;
}

export type SecretAccessAnomalyValidation = { ok: true; report: SecretAccessAnomalyReport } | { ok: false; error: string };

function isIsoTimestamp(value: string): boolean {
  if (value.length === 0 || value.length > 40) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

/** Fail-closed parser for the untrusted POST body. Never guesses a field; rejects anything unbounded or malformed. */
export function parseSecretAccessAnomalyReport(body: unknown): SecretAccessAnomalyValidation {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "invalid_body" };
  }
  const candidate = body as Record<string, unknown>;

  if (typeof candidate.secretName !== "string" || !SECRET_NAME_PATTERN.test(candidate.secretName)) {
    return { ok: false, error: "invalid_secret_name" };
  }
  if (typeof candidate.environment !== "string" || !ENVIRONMENT_VALUES.includes(candidate.environment as AnomalyEnvironment)) {
    return { ok: false, error: "invalid_environment" };
  }
  if (typeof candidate.eventName !== "string" || !EVENT_NAMES.includes(candidate.eventName as AnomalyEventName)) {
    return { ok: false, error: "invalid_event_name" };
  }
  if (typeof candidate.principalArn !== "string" || !PRINCIPAL_PATTERN.test(candidate.principalArn)) {
    return { ok: false, error: "invalid_principal_arn" };
  }
  if (typeof candidate.reasonCode !== "string" || !REASON_CODE_PATTERN.test(candidate.reasonCode)) {
    return { ok: false, error: "invalid_reason_code" };
  }
  if (typeof candidate.occurredAt !== "string" || !isIsoTimestamp(candidate.occurredAt)) {
    return { ok: false, error: "invalid_occurred_at" };
  }

  return {
    ok: true,
    report: {
      secretName: candidate.secretName,
      environment: candidate.environment as AnomalyEnvironment,
      eventName: candidate.eventName as AnomalyEventName,
      principalArn: candidate.principalArn,
      reasonCode: candidate.reasonCode,
      occurredAt: candidate.occurredAt,
    },
  };
}
