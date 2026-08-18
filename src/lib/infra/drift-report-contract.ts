/**
 * Cinefield infrastructure drift-report contract (Phase 18-D).
 *
 * What an external drift check (GitHub Actions, since this repository has
 * no server-side Terraform execution) is allowed to report about ONE
 * environment. Bounded on purpose: no plan body, no resource diff, no
 * Terraform state, no credentials — a diff can itself contain resolved
 * secret-shaped values (an endpoint, an ARN with an account id), and this
 * contract is designed to never carry one.
 */

/** Same three states `terraform plan -detailed-exitcode` actually produces (0/2), plus the honest "couldn't tell" case. */
export type DriftStatus = "NO_DRIFT" | "DRIFT_DETECTED" | "UNAVAILABLE";

const DRIFT_STATUSES: readonly DriftStatus[] = ["NO_DRIFT", "DRIFT_DETECTED", "UNAVAILABLE"];

const ENVIRONMENT_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const URL_MAX_LENGTH = 512;
const REASON_CODE_MAX_LENGTH = 64;

export interface DriftReport {
  readonly environment: string;
  readonly status: DriftStatus;
  /** Short code, e.g. "plan_detailed_exitcode_2", "init_failed", "credentials_missing". Never a message or a diff. */
  readonly reasonCode: string;
  /** The GitHub Actions run this evidence came from — durable, reviewable, no new store needed. */
  readonly workflowRunUrl: string;
  readonly commitSha: string;
}

export type DriftReportValidation = { ok: true; report: DriftReport } | { ok: false; error: string };

function isHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > URL_MAX_LENGTH) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Fail-closed parser for the untrusted POST body. Never guesses a field; rejects anything unbounded or malformed. */
export function parseDriftReport(body: unknown): DriftReportValidation {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "invalid_body" };
  }
  const candidate = body as Record<string, unknown>;

  if (typeof candidate.environment !== "string" || !ENVIRONMENT_PATTERN.test(candidate.environment)) {
    return { ok: false, error: "invalid_environment" };
  }
  if (typeof candidate.status !== "string" || !DRIFT_STATUSES.includes(candidate.status as DriftStatus)) {
    return { ok: false, error: "invalid_status" };
  }
  if (
    typeof candidate.reasonCode !== "string" ||
    candidate.reasonCode.length > REASON_CODE_MAX_LENGTH ||
    !REASON_CODE_PATTERN.test(candidate.reasonCode)
  ) {
    return { ok: false, error: "invalid_reason_code" };
  }
  if (typeof candidate.workflowRunUrl !== "string" || !isHttpsUrl(candidate.workflowRunUrl)) {
    return { ok: false, error: "invalid_workflow_run_url" };
  }
  if (typeof candidate.commitSha !== "string" || !SHA_PATTERN.test(candidate.commitSha)) {
    return { ok: false, error: "invalid_commit_sha" };
  }

  return {
    ok: true,
    report: {
      environment: candidate.environment,
      status: candidate.status as DriftStatus,
      reasonCode: candidate.reasonCode,
      workflowRunUrl: candidate.workflowRunUrl,
      commitSha: candidate.commitSha,
    },
  };
}
