import type { ChangeRiskClass } from "./change-risk";

/**
 * The required CI check registry (Phase 14-B).
 *
 * Roadmap 14-B done-criterion: "Riskli PR merge olamıyor" — a risky PR
 * cannot merge. This file is the single, centralized definition of what
 * "cannot merge without" means, so the decision is never scattered across
 * scripts or reinvented per PR.
 *
 * ---------------------------------------------------------------------------
 * EVERY CHECK ID MAPS TO A COMMAND THAT ACTUALLY EXISTS
 * ---------------------------------------------------------------------------
 * No aspirational check is marked required. `dependency_review` is registered
 * because the roadmap names it, but its `status` is `"deferred"` — no
 * Dependabot/GitHub dependency-review tool is configured in this repository
 * yet (that is 14-B's OWN external/GitHub-config half, not this code-only
 * batch), and a check nothing runs must never be reported as passing.
 *
 * ---------------------------------------------------------------------------
 * RESOLUTION IS A PURE FUNCTION OF SERVER-COMPUTED FACTS
 * ---------------------------------------------------------------------------
 * `resolveRequiredChecks(riskClass, signals)` takes exactly two arguments,
 * both already server/policy-derived (risk from `classifyChangeRisk`, the
 * migration signal from the same changed-path list). There is no third
 * parameter for a caller's preference, because a parameter that could carry
 * "skip this check" is a parameter an AI-generated PR's own input could set —
 * see the regression test asserting this function's signature accepts no
 * such field.
 */

export type RequiredCheckId =
  | "typecheck"
  | "test_suite"
  | "build"
  | "changed_file_lint"
  | "secret_scan"
  | "telemetry_scan"
  | "policy_conformance"
  | "migration_safety"
  | "postgres_proofs"
  | "dependency_review";

export type CheckStatus = "available" | "deferred";

export interface RequiredCheckDefinition {
  readonly id: RequiredCheckId;
  /** The real command this maps to. Not executed here — 14-C owns running it. */
  readonly command: string;
  readonly blocking: boolean;
  readonly applicableRiskClasses: readonly ChangeRiskClass[];
  readonly status: CheckStatus;
  /** What happens when this check fails. Bounded, not free text. */
  readonly failureBehavior: "block_pr" | "warn_only";
  readonly why: string;
}

/**
 * The seven checks every risk class runs, always. They cost nothing to
 * always run and this repository's own practice, every batch this session,
 * has been "run the full battery" — never a partial one chosen per change.
 */
const BASELINE: readonly RequiredCheckId[] = [
  "typecheck",
  "test_suite",
  "build",
  "changed_file_lint",
  "secret_scan",
  "telemetry_scan",
  "policy_conformance",
];

const ALL_RISK_CLASSES: readonly ChangeRiskClass[] = [
  "LOW_RISK",
  "MEDIUM_RISK",
  "HIGH_RISK",
  "FORBIDDEN_AUTOMATION",
];

export const REQUIRED_CHECK_REGISTRY: Readonly<Record<RequiredCheckId, RequiredCheckDefinition>> = {
  typecheck: {
    id: "typecheck",
    command: "npx tsc --noEmit",
    blocking: true,
    applicableRiskClasses: ALL_RISK_CLASSES,
    status: "available",
    failureBehavior: "block_pr",
    why: "Every batch in this repository has required a clean typecheck before anything else.",
  },
  test_suite: {
    id: "test_suite",
    command: 'npx tsx --conditions=react-server --test "src/**/*.test.ts"',
    blocking: true,
    applicableRiskClasses: ALL_RISK_CLASSES,
    status: "available",
    failureBehavior: "block_pr",
    why: "The single combined suite already includes unit, integration, e2e and every security/Phase regression file — there is no separate 'unit only' command to run instead.",
  },
  build: {
    id: "build",
    command: "npx next build",
    blocking: true,
    applicableRiskClasses: ALL_RISK_CLASSES,
    status: "available",
    failureBehavior: "block_pr",
    why: "A change that does not build cannot be previewed or deployed.",
  },
  changed_file_lint: {
    id: "changed_file_lint",
    command: "npx eslint <changed files>",
    blocking: true,
    applicableRiskClasses: ALL_RISK_CLASSES,
    status: "available",
    failureBehavior: "block_pr",
    why: "Scoped to the files a PR actually touches, matching this repository's own lint convention.",
  },
  secret_scan: {
    id: "secret_scan",
    command: "npx tsx scripts/scan-secrets.ts",
    blocking: true,
    applicableRiskClasses: ALL_RISK_CLASSES,
    status: "available",
    failureBehavior: "block_pr",
    why: "Phase 12-D. Shape-matching only, but a green scan is required regardless of risk class.",
  },
  telemetry_scan: {
    id: "telemetry_scan",
    command: "npx tsx scripts/scan-telemetry.ts",
    blocking: true,
    applicableRiskClasses: ALL_RISK_CLASSES,
    status: "available",
    failureBehavior: "block_pr",
    why: "Phase 13-E's Sensitive Data Guard call-site scan.",
  },
  policy_conformance: {
    id: "policy_conformance",
    command: "npm run policy:test",
    blocking: true,
    applicableRiskClasses: ALL_RISK_CLASSES,
    status: "available",
    failureBehavior: "block_pr",
    why: "Phase 12-E's OPA/Rego conformance suite — a genuinely separate toolchain from `node:test`, so it is its own check rather than folded into test_suite.",
  },
  migration_safety: {
    id: "migration_safety",
    command: "(static review of touched supabase/migrations/ files)",
    blocking: true,
    applicableRiskClasses: ["HIGH_RISK", "FORBIDDEN_AUTOMATION"],
    status: "available",
    failureBehavior: "block_pr",
    why: "Required whenever a migration is touched, regardless of computed risk tier — see the migration signal rule below.",
  },
  postgres_proofs: {
    id: "postgres_proofs",
    command: "bash supabase/tests/run_pg_tests.sh",
    blocking: true,
    applicableRiskClasses: ["HIGH_RISK", "FORBIDDEN_AUTOMATION"],
    status: "available",
    failureBehavior: "block_pr",
    why: "Throwaway-Docker-only proofs against the real migrations, never live Supabase.",
  },
  dependency_review: {
    id: "dependency_review",
    command: "(GitHub Dependency Review / Dependabot — not configured)",
    blocking: false,
    applicableRiskClasses: ALL_RISK_CLASSES,
    status: "deferred",
    failureBehavior: "warn_only",
    why: "Named by 14-B's own roadmap text, but no tool is wired yet — deferred to 14-B's GitHub-config half, never reported as passing.",
  },
};

/**
 * Whether the changed paths include a migration touch.
 *
 * A SEPARATE signal from risk class, even though touching a migration also
 * happens to make risk class HIGH_RISK today — a future FORBIDDEN_AUTOMATION
 * classification for destructive SQL must not accidentally drop these checks
 * (both are applicable at HIGH_RISK and FORBIDDEN_AUTOMATION), and a reader
 * should not have to infer "was this a migration?" from the risk tier alone.
 */
export function touchesMigration(changedFilePaths: readonly string[]): boolean {
  return changedFilePaths.some((p) => p.startsWith("supabase/migrations/"));
}

/**
 * Resolves the required check ids for a change.
 *
 * Deterministic: the same (riskClass, changedFilePaths) always produces the
 * same result. No caller preference is accepted or consulted — see the file
 * header.
 */
export function resolveRequiredChecks(
  riskClass: ChangeRiskClass,
  changedFilePaths: readonly string[]
): RequiredCheckId[] {
  // The baseline is unconditional — applicable at every risk class by
  // definition, so it needs no filtering.
  const ids = new Set<RequiredCheckId>(BASELINE);

  // The migration signal is independent of the passed-in risk class. In the
  // composed flow (`ai-pr-authority.ts`) risk is always derived from these
  // same paths first, so a migration touch already implies HIGH_RISK or
  // above — but this function does not re-derive risk itself, and a
  // migration touch must add these checks regardless of what risk class it
  // is called with, rather than silently depending on the caller having
  // classified consistently.
  if (touchesMigration(changedFilePaths)) {
    ids.add("migration_safety");
    ids.add("postgres_proofs");
  }

  return [...ids].sort();
}
