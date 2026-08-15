import type { ChangeRiskClass } from "./change-risk";
import { REQUIRED_CHECK_REGISTRY, type RequiredCheckId } from "./required-checks";

/**
 * Preview candidate gate (Phase 14-C, code-only).
 *
 * Roadmap 14-C: "Vercel Preview + health/smoke/E2E + Deployment Checks'i tek
 * pre-prod validation paketi olarak kur." Done-criterion: "PR preview
 * otomatik testleri geçmeden prod aday olmuyor" — a PR does not become a
 * production candidate without passing preview's automatic tests.
 *
 * ---------------------------------------------------------------------------
 * A DECISION MODEL, NOT A DEPLOYMENT CLIENT
 * ---------------------------------------------------------------------------
 * This file calls no Vercel API, opens no deployment, and polls nothing. It
 * answers one question from facts it is GIVEN: "may this become a production
 * candidate?" Whoever observes the real preview supplies the observations;
 * this decides what they mean. That split is why the gate is testable today
 * without a Vercel project existing, and why connecting one later changes the
 * caller rather than the rule.
 *
 * ---------------------------------------------------------------------------
 * THREE ELIGIBILITIES, THREE DIFFERENT QUESTIONS
 * ---------------------------------------------------------------------------
 *   PR_ELIGIBLE      (14-B) may a pull request be opened for review?
 *   PREVIEW_ELIGIBLE (here) may a preview be built and tested for it?
 *   PROD_CANDIDATE   (here) has it earned the right to be CONSIDERED for
 *                           deployment?
 *
 * None implies the next, and PROD_CANDIDATE is still not permission to
 * deploy — 14-D decides that, and 14-E must have verified the artifact first.
 * Conflating any two of these is the failure this separation exists to
 * prevent, so they are distinct types rather than one boolean with comments.
 */

/** Observed state of a preview deployment. Closed set, no free text. */
export type PreviewState =
  | "NOT_CREATED"
  | "BUILDING"
  | "FAILED"
  | "READY"
  | "TESTING"
  | "PASSED"
  | "BLOCKED";

export type CheckOutcome = "pass" | "fail" | "pending" | "skipped";

/** Why a change is not a production candidate. Bounded codes. */
export type PreviewRefusal =
  | "preview_not_created"
  | "preview_building"
  | "preview_failed"
  | "preview_blocked"
  | "preview_tests_incomplete"
  | "required_check_missing"
  | "required_check_failed"
  | "readiness_unready"
  | "critical_security_alert"
  | "migration_proofs_missing"
  | "human_approval_required"
  | "forbidden_automation";

export type PreviewDecision = "PROD_CANDIDATE" | "BLOCKED" | "REVIEW_REQUIRED";

/**
 * Everything the gate is allowed to consider.
 *
 * Every field is an observation supplied by the server. There is no field for
 * a caller's opinion, no `force`, no `skipChecks`, no `overrideRisk` — an AI
 * cannot choose or omit an input because the shape has nowhere to put one.
 */
export interface PreviewGateInput {
  readonly riskClass: ChangeRiskClass;
  /** Server-resolved from `resolveRequiredChecks`. Not caller-chosen. */
  readonly requiredCheckIds: readonly RequiredCheckId[];
  /** Observed outcome per check id. A missing entry is NOT a pass. */
  readonly checkOutcomes: Readonly<Partial<Record<RequiredCheckId, CheckOutcome>>>;
  readonly previewState: PreviewState;
  /** Phase 13 readiness of the runtime under test, as observed. */
  readonly previewReadiness: "HEALTHY" | "DEGRADED" | "UNREADY" | "UNKNOWN";
  /** True when a 13-D CRITICAL security alert is currently open. */
  readonly criticalSecurityAlertOpen: boolean;
  /** Whether the change touches supabase/migrations/. */
  readonly touchesMigration: boolean;
  /** Evidence a human approved. Absent means not approved — never assumed. */
  readonly humanApproved: boolean;
}

export interface PreviewGateResult {
  readonly decision: PreviewDecision;
  /** Every reason it failed, not just the first — an operator fixing this
   *  wants the whole list rather than one round trip per problem. */
  readonly refusals: readonly PreviewRefusal[];
  /** Convenience: PROD_CANDIDATE and nothing else. Never means "deploy". */
  readonly prodCandidate: boolean;
}

/** Preview states that are terminal-good. Everything else blocks. */
const PREVIEW_OK: ReadonlySet<PreviewState> = new Set<PreviewState>(["PASSED"]);

const PREVIEW_REFUSAL: Readonly<Partial<Record<PreviewState, PreviewRefusal>>> = {
  NOT_CREATED: "preview_not_created",
  BUILDING: "preview_building",
  FAILED: "preview_failed",
  BLOCKED: "preview_blocked",
  READY: "preview_tests_incomplete",
  TESTING: "preview_tests_incomplete",
};

/**
 * Evaluates preview eligibility.
 *
 * Deterministic and total: the same input always yields the same decision,
 * and every path returns. Nothing is inferred from absence except in the safe
 * direction — a check with no recorded outcome is missing, not passing.
 */
export function evaluatePreviewGate(input: PreviewGateInput): PreviewGateResult {
  const refusals: PreviewRefusal[] = [];

  // 1. FORBIDDEN_AUTOMATION can never become a candidate through this gate.
  //    It is not a matter of collecting enough green checks.
  if (input.riskClass === "FORBIDDEN_AUTOMATION") refusals.push("forbidden_automation");

  // 2. Required checks. A missing outcome is a refusal, not an omission —
  //    this is the "no skip because AI says so" rule made structural.
  for (const id of input.requiredCheckIds) {
    const outcome = input.checkOutcomes[id];
    const definition = REQUIRED_CHECK_REGISTRY[id];

    // A deferred check (no tool exists) is honestly represented: it is
    // neither counted as passing nor allowed to block, because reporting a
    // check nobody can run as "passed" is the defect 14-A already closed for
    // migration_safety.
    if (definition?.status === "deferred") continue;

    if (outcome === undefined) refusals.push("required_check_missing");
    else if (outcome === "fail") refusals.push("required_check_failed");
    else if (outcome !== "pass") refusals.push("required_check_missing");
  }

  // 3. Preview must have actually run its tests and passed them.
  if (!PREVIEW_OK.has(input.previewState)) {
    refusals.push(PREVIEW_REFUSAL[input.previewState] ?? "preview_blocked");
  }

  // 4. Phase 13 health of the runtime under test. DEGRADED is acceptable for
  //    the same reason `isReady()` accepts it — a fallback-covered dependency
  //    being unwell is not a reason to refuse traffic. UNREADY and UNKNOWN
  //    are not: UNKNOWN != HEALTHY is a standing rule in this codebase.
  if (input.previewReadiness === "UNREADY" || input.previewReadiness === "UNKNOWN") {
    refusals.push("readiness_unready");
  }

  // 5. An open critical security alert blocks regardless of how green the
  //    build is. Shipping during an active security incident is the case
  //    where "all tests passed" is least reassuring.
  if (input.criticalSecurityAlertOpen) refusals.push("critical_security_alert");

  // 6. Migrations need their own proofs, independent of the generic list.
  if (input.touchesMigration) {
    for (const id of ["migration_safety", "postgres_proofs"] as const) {
      if (input.checkOutcomes[id] !== "pass") refusals.push("migration_proofs_missing");
    }
  }

  if (refusals.length > 0) {
    return { decision: "BLOCKED", refusals, prodCandidate: false };
  }

  // 7. Everything mechanical is satisfied. A HIGH_RISK change still needs a
  //    human — green checks answer "does it work", not "should we".
  if (input.riskClass === "HIGH_RISK" && !input.humanApproved) {
    return { decision: "REVIEW_REQUIRED", refusals: ["human_approval_required"], prodCandidate: false };
  }

  return { decision: "PROD_CANDIDATE", refusals: [], prodCandidate: true };
}
