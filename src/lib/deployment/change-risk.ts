/**
 * Change-risk taxonomy (Phase 14-B).
 *
 * Roadmap 14-B: "Code Scanning + Secret Scanning + Dependency Review/
 * Dependabot + branch protection/required checks'i tek GitHub gate paketi
 * olarak kur." Done-criterion: "Riskli PR merge olamıyor." This module is the
 * part of that gate that decides how risky a change is, before anything asks
 * whether it may merge.
 *
 * ---------------------------------------------------------------------------
 * RISK IS DERIVED, NEVER SUPPLIED
 * ---------------------------------------------------------------------------
 * `classifyChangeRisk` takes only file paths — never a caller-asserted risk
 * label, never an AI-supplied class, never a browser field. This is the same
 * argument 12-E's `PolicyRiskState` already makes for security risk: a risk
 * input a caller can set is a risk claim, not a risk fact. Section 20 of the
 * batch this module implements is explicit: "risk cannot be browser/AI
 * supplied."
 *
 * ---------------------------------------------------------------------------
 * PATH IS THE SEMANTIC SIGNAL, NOT A SUBSTITUTE FOR ONE
 * ---------------------------------------------------------------------------
 * A well-organized repository's directory structure already encodes domain
 * boundaries — `supabase/migrations/` IS a migration, `src/lib/policy/` IS
 * the policy engine. Classifying by path here is not "file path is the only
 * signal available" (which the instruction rules out); it is that path
 * ALREADY CARRIES the semantic action for this repository's layout. Rules are
 * ordered most-severe-first and the FIRST matching domain wins per path; the
 * overall risk is the maximum across every touched path, because a change
 * touching one FORBIDDEN_AUTOMATION file and nine documentation files is a
 * FORBIDDEN_AUTOMATION change.
 *
 * ---------------------------------------------------------------------------
 * THE POLICY ENGINE ITSELF IS FORBIDDEN_AUTOMATION
 * ---------------------------------------------------------------------------
 * `src/lib/policy/` and `policies/` (including `policies/data/actions.json`,
 * the very file this batch just extended) are classified FORBIDDEN_AUTOMATION.
 * An AI Fix Agent that could edit its own allowlist would not be gated by
 * this system — it would BE the gate. This is the single most important rule
 * in this file.
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN DEFAULTS TO MEDIUM, NEVER LOW
 * ---------------------------------------------------------------------------
 * A path matching nothing below is MEDIUM_RISK. Defaulting to LOW would mean
 * a new, unclassified directory silently inherited the weakest review
 * requirement the day it was created — the same "unknown != safe" posture
 * this repository has kept everywhere else (AMBIGUOUS != SAFE TO RETRY,
 * UNKNOWN != HEALTHY).
 */

export type ChangeRiskClass = "LOW_RISK" | "MEDIUM_RISK" | "HIGH_RISK" | "FORBIDDEN_AUTOMATION";

export const RISK_ORDER: Readonly<Record<ChangeRiskClass, number>> = {
  LOW_RISK: 0,
  MEDIUM_RISK: 1,
  HIGH_RISK: 2,
  FORBIDDEN_AUTOMATION: 3,
};

/** A human-readable domain name, purely for audit/reporting — never authority. */
export type ChangeDomain =
  | "policy_engine_or_registry"
  | "secrets_or_config"
  | "production_infra_or_ci"
  | "quarantine_override"
  | "database_migration"
  | "generation_lifecycle_or_queue_ownership"
  | "auth_or_security"
  | "billing_or_credits"
  | "admin_controls"
  | "upload_permissions"
  | "moderation"
  | "provider_adapter"
  | "documentation"
  | "test_fixture"
  | "unclassified";

interface DomainRule {
  readonly domain: ChangeDomain;
  readonly risk: ChangeRiskClass;
  readonly pattern: RegExp;
  readonly why: string;
}

/**
 * Ordered most-severe-first. The first matching rule decides a path's
 * domain; `classifyChangeRisk` takes the maximum risk across all paths.
 *
 * Every rule matches a REAL, verified path prefix in this repository as of
 * Phase 14-B — nothing here is speculative. Reserved prefixes for
 * directories that do not exist yet (`infra/`, `.github/workflows/`) are
 * included because the domain they'd occupy is already forbidden by
 * definition (production infrastructure, CI configuration) — the rule
 * should exist before the directory does, not after.
 */
const DOMAIN_RULES: readonly DomainRule[] = [
  {
    domain: "policy_engine_or_registry",
    risk: "FORBIDDEN_AUTOMATION",
    pattern: /^(policies\/|src\/lib\/policy\/)/,
    why: "The gate must not be able to rewrite itself or its own allowlist.",
  },
  {
    domain: "secrets_or_config",
    risk: "FORBIDDEN_AUTOMATION",
    pattern: /^(src\/lib\/config\/|\.env)/,
    why: "Secret presence, KMS/Secrets Manager contracts and environment validation live here.",
  },
  {
    domain: "production_infra_or_ci",
    risk: "FORBIDDEN_AUTOMATION",
    pattern: /^(infra\/|terraform\/|\.github\/workflows\/|vercel\.json)/,
    why: "Production infrastructure and the CI definition that checks every other change.",
  },
  {
    domain: "quarantine_override",
    risk: "FORBIDDEN_AUTOMATION",
    pattern: /^src\/lib\/media\/quarantine-release\.ts$/,
    why: "The quarantine release mechanism itself — roadmap names quarantine override as FORBIDDEN_AUTOMATION explicitly.",
  },
  {
    domain: "database_migration",
    risk: "HIGH_RISK",
    pattern: /^supabase\/migrations\//,
    why: "Schema and RLS live in migrations in this repository; AI may never mark SQL as low risk.",
  },
  {
    domain: "generation_lifecycle_or_queue_ownership",
    risk: "HIGH_RISK",
    pattern: /^(worker\/|src\/lib\/orchestration\/(?!providers\/))/,
    why: "Generation state machine, Temporal workflows/activities and provider submission — the money path.",
  },
  {
    domain: "auth_or_security",
    risk: "HIGH_RISK",
    pattern: /^(src\/lib\/security\/|src\/proxy\.ts$)/,
    why: "Authentication, rate limiting, the Risk Engine and security-event taxonomy.",
  },
  {
    domain: "moderation",
    risk: "HIGH_RISK",
    pattern: /^(src\/lib\/media\/|src\/lib\/orchestration\/content-moderation\.ts$)/,
    why: "Trust & Safety input/output gates.",
  },
  {
    domain: "billing_or_credits",
    risk: "HIGH_RISK",
    pattern: /^(src\/lib\/credits\.ts$|src\/app\/api\/.*\/(billing|credit)s?\/)/i,
    why: "Credit and billing code — roadmap places billing under HIGH_RISK candidates.",
  },
  {
    domain: "admin_controls",
    risk: "HIGH_RISK",
    pattern: /\/admin\//i,
    why: "UI or routes that change admin controls are never automatically low risk.",
  },
  {
    domain: "upload_permissions",
    risk: "HIGH_RISK",
    pattern: /^src\/app\/api\/media\/upload-url\//,
    why: "Presigned upload scope — a direct example named in the roadmap's UI-risk rule.",
  },
  {
    domain: "generation_lifecycle_or_queue_ownership",
    risk: "HIGH_RISK",
    pattern: /^src\/app\/api\/(generate|generations|orchestration)\//,
    why: "The generation-facing route surface, same domain as the lifecycle code it calls.",
  },
  {
    domain: "provider_adapter",
    risk: "MEDIUM_RISK",
    pattern: /^src\/lib\/orchestration\/providers\//,
    why: "Roadmap names provider adapter logic MEDIUM_RISK, distinct from provider submission (HIGH_RISK).",
  },
  {
    domain: "documentation",
    risk: "LOW_RISK",
    pattern: /^(docs\/|[^/]+\.md$)/i,
    why: "Documentation only.",
  },
  {
    domain: "test_fixture",
    risk: "LOW_RISK",
    pattern: /^src\/test\/fixtures\//,
    why: "Synthetic fixture data, not production code.",
  },
];

/** Anything matching no rule above. Deliberately not LOW_RISK — see file header. */
const DEFAULT_RISK: ChangeRiskClass = "MEDIUM_RISK";

/** A safe, bounded relative path. No absolute paths, no `..`, no drive letters. */
export const CHANGE_PATH_PATTERN = /^[a-zA-Z0-9_./-]{1,256}$/;

export interface ChangeRiskResult {
  readonly riskClass: ChangeRiskClass;
  /** One entry per touched path, in the same order as the input. */
  readonly perPath: readonly { path: string; domain: ChangeDomain; risk: ChangeRiskClass }[];
  /** Which domain(s) drove the final (maximum) risk class. */
  readonly drivingDomains: readonly ChangeDomain[];
}

function classifyOne(filePath: string): { domain: ChangeDomain; risk: ChangeRiskClass } {
  for (const rule of DOMAIN_RULES) {
    if (rule.pattern.test(filePath)) return { domain: rule.domain, risk: rule.risk };
  }
  return { domain: "unclassified", risk: DEFAULT_RISK };
}

/**
 * Classifies a set of changed file paths into ONE overall risk class — the
 * maximum across every path, "most restrictive wins".
 *
 * Every path must match `CHANGE_PATH_PATTERN`; a path that does not is
 * refused as malformed rather than silently skipped or defaulted — the same
 * shape-first discipline `policy-contract.ts`'s `isPolicyInputShape` uses.
 */
export function classifyChangeRisk(changedFilePaths: readonly string[]): ChangeRiskResult {
  if (changedFilePaths.length === 0) {
    throw new Error("change-risk: at least one changed file path is required");
  }
  for (const p of changedFilePaths) {
    if (!CHANGE_PATH_PATTERN.test(p)) {
      throw new Error("change-risk: malformed path");
    }
  }

  const perPath = changedFilePaths.map((path) => {
    const { domain, risk } = classifyOne(path);
    return { path, domain, risk };
  });

  let riskClass: ChangeRiskClass = "LOW_RISK";
  for (const p of perPath) {
    if (RISK_ORDER[p.risk] > RISK_ORDER[riskClass]) riskClass = p.risk;
  }

  const drivingDomains = [
    ...new Set(perPath.filter((p) => p.risk === riskClass).map((p) => p.domain)),
  ];

  return { riskClass, perPath, drivingDomains };
}
