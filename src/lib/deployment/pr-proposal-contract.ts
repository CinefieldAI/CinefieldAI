import { CHANGE_PATH_PATTERN, type ChangeDomain, type ChangeRiskClass } from "./change-risk";
import type { RequiredCheckId } from "./required-checks";
import type { PolicyDecisionValue } from "@/lib/policy/policy-contract";

/**
 * The PR proposal contract (Phase 14-B).
 *
 * A bounded description of a future AI-authored pull request — never the
 * pull request itself. No file in this module imports a GitHub SDK, calls a
 * network endpoint, or reads a token; nothing here can create a branch, a
 * commit, or a PR. Section 15/18 of the batch this implements: "policy/
 * contract only."
 *
 * ---------------------------------------------------------------------------
 * TWO SHAPES, ON PURPOSE
 * ---------------------------------------------------------------------------
 * `PrProposalInput` is what a caller supplies. It has no `riskClass` field —
 * risk is computed by `classifyChangeRisk`, never accepted as a claim, the
 * same argument `PolicyRiskState` already makes for security risk. It has no
 * `requiredCheckIds` field either, for the same reason: an AI-generated
 * proposal that could name its own required checks could shrink them.
 *
 * `PrProposalRecord` is what `evaluateAiPrProposal` (in `ai-pr-authority.ts`)
 * produces: the input, plus everything the server computed — risk class,
 * resolved checks, the policy decision, and a lifecycle state. Only the
 * record is ever logged or shown; the distinction between the two shapes IS
 * the "PR proposal contains no secrets" guarantee, because the record can
 * only ever contain what the input shape allows in.
 *
 * ---------------------------------------------------------------------------
 * WHAT CANNOT APPEAR HERE
 * ---------------------------------------------------------------------------
 * No field for a prompt, a raw log, a stack trace, a shell command, a diff
 * body, or file CONTENTS of any kind. `changedFilePaths` is paths only —
 * accepting file contents would open exactly the "arbitrary payload" door
 * 13-E's Sensitive Data Guard exists to keep shut, and it is unnecessary:
 * every risk and check decision this module makes is derivable from paths
 * alone in this repository's layout.
 */

/** Bounded free-text fields still get a length ceiling — never truly free. */
export const MAX_TITLE_LENGTH = 120;
export const MAX_SUMMARY_LENGTH = 500;
export const MAX_CHANGED_FILES = 100;

/** Matches the correlation id shapes already used by 13-A/13-D. */
export const PR_CORRELATION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * What happens to production if this proposal is never merged.
 *
 * A closed set, not free text — the same discipline as every other "reason"
 * field in this codebase. `guard_reverts_release` names Phase 14-D's own
 * Rollback Guard rather than claiming this proposal can revert anything
 * itself; nothing in this module can execute a rollback.
 */
export type RollbackExpectation = "guard_reverts_release" | "revert_pr" | "not_applicable";

export const ROLLBACK_EXPECTATIONS: readonly RollbackExpectation[] = [
  "guard_reverts_release",
  "revert_pr",
  "not_applicable",
];

/** What a (future, not-yet-built) AI Fix Agent would submit. */
export interface PrProposalInput {
  /** Bounded, ≤120 chars. */
  readonly title: string;
  /** Bounded, ≤500 chars — a rationale, never a log dump. */
  readonly summary: string;
  /** 1–100 relative paths, each matching CHANGE_PATH_PATTERN. */
  readonly changedFilePaths: readonly string[];
  /** 13-A/13-D correlation id. Observational only — see `ai-pr-authority.ts`. */
  readonly correlationId?: string;
  readonly rollbackExpectation: RollbackExpectation;
  /** The generation this fix responds to, if any. Also observational only. */
  readonly generationId?: string;
}

/**
 * The lifecycle a proposal moves through.
 *
 * ---------------------------------------------------------------------------
 * PR_ELIGIBLE IS NOT DEPLOY_ELIGIBLE
 * ---------------------------------------------------------------------------
 * There is no state in this set that means "may reach production". This
 * batch defines eligibility for the AI to have a PR OPENED for human review —
 * 14-C (pre-prod validation) and 14-D (Deploy Guard) are separate, unbuilt
 * packages that would gate the further, much larger step from an open PR to
 * a production deployment. Conflating the two states would be exactly the
 * "PR_ELIGIBLE read as DEPLOY_ELIGIBLE" failure this batch exists to prevent.
 */
export type PrProposalState =
  /** Received, not yet classified. */
  | "PATCH_PROPOSED"
  /** Risk is not FORBIDDEN_AUTOMATION and policy has ALLOWed PR creation. */
  | "PR_ELIGIBLE"
  /** Was PR_ELIGIBLE; a blocking required check has since failed. */
  | "CI_BLOCKED"
  /** Blocked on a human: either FORBIDDEN_AUTOMATION, or policy REQUIRE_APPROVAL/DENY. */
  | "REVIEW_REQUIRED";

export interface PrProposalRecord {
  readonly input: PrProposalInput;
  readonly riskClass: ChangeRiskClass;
  readonly drivingDomains: readonly ChangeDomain[];
  readonly requiredCheckIds: readonly RequiredCheckId[];
  readonly state: PrProposalState;
  /**
   * Present only when policy was actually consulted — absent for
   * FORBIDDEN_AUTOMATION, which never reaches the policy gate at all. See
   * `ai-pr-authority.ts` for why that omission is structural, not incidental.
   */
  readonly policyDecision: { decision: PolicyDecisionValue; reason: string; policyVersion: string } | null;
}

function isNonEmptyBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/**
 * Shape validation for a proposal input, mirroring `isPolicyInputShape`'s own
 * discipline: nothing is defaulted, an incomplete input is refused rather
 * than coerced.
 */
export function isPrProposalInputShape(value: unknown): value is PrProposalInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyBoundedString(v.title, MAX_TITLE_LENGTH)) return false;
  if (!isNonEmptyBoundedString(v.summary, MAX_SUMMARY_LENGTH)) return false;

  if (!Array.isArray(v.changedFilePaths)) return false;
  if (v.changedFilePaths.length === 0 || v.changedFilePaths.length > MAX_CHANGED_FILES) return false;
  if (!v.changedFilePaths.every((p) => typeof p === "string" && CHANGE_PATH_PATTERN.test(p))) return false;

  if (v.correlationId !== undefined) {
    if (typeof v.correlationId !== "string" || !PR_CORRELATION_PATTERN.test(v.correlationId)) return false;
  }
  if (v.generationId !== undefined) {
    if (typeof v.generationId !== "string" || !PR_CORRELATION_PATTERN.test(v.generationId)) return false;
  }

  if (!ROLLBACK_EXPECTATIONS.includes(v.rollbackExpectation as RollbackExpectation)) return false;

  return true;
}
