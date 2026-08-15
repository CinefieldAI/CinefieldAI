import type { AlertType } from "@/lib/alerts/alert-contract";

/**
 * AI remediation loop safety (Phase 14-F, code-only).
 *
 * Roadmap 14-F: "Global auto-remediation kill-switch + Seer/agent PR-storm
 * rate limit/suppression + AI-action provenance alanlarını tek AI-Ops
 * guardrail paketi olarak uygula." Done-criterion: "Tek flag ile remediation
 * duruyor; PR storm sınırlı; her AI action model/agent/policy sürümüyle
 * audit'te."
 *
 * ¶253 states plainly why this package exists: the self-healing layer is
 * already strong, and these three additions protect the system "AI ops'un
 * kendisi sapıttığında" — when the AI operations layer itself goes wrong.
 * That is the whole design brief, and it is why 14-F lands BEFORE the 13-D
 * router is allowed to invoke 14-A's seam automatically.
 *
 * ---------------------------------------------------------------------------
 * THE LIMITS ARE THE PRODUCT, NOT A WRAPPER AROUND IT
 * ---------------------------------------------------------------------------
 * Nothing in this module generates a proposal. It only ever answers "may a
 * proposal be attempted for this incident, right now?" — and the honest
 * answer is usually no. Every failure direction is toward NO PROPOSAL: an
 * unreadable switch, an exhausted budget, a corrupt counter, an unexpected
 * throw. Failing the other way would mean a bug in the brake produces
 * unbounded PRs, which is the exact incident 14-F is specified to prevent.
 *
 * ---------------------------------------------------------------------------
 * NO NEW DEDUPE VOCABULARY
 * ---------------------------------------------------------------------------
 * Incident identity is 13-D's `dedupeKey` (`source:type:resource`), carried
 * unchanged through 14-A's `IncidentDiagnosis`. Occurrence counting is 13-D's
 * `occurrenceCount`. Re-deriving either here would guarantee the two
 * eventually disagree, and then "the same incident" would mean two different
 * things in two files.
 */

/** Why remediation was refused. Bounded codes, never prose. */
export type RemediationRefusal =
  | "kill_switch_engaged"
  | "not_remediation_eligible"
  | "cooldown_active"
  | "max_attempts_exhausted"
  | "incident_budget_exhausted"
  | "global_budget_exhausted"
  | "guardrail_unavailable";

export type RemediationDecision = "ALLOW_ATTEMPT" | "REFUSE";

export interface RemediationVerdict {
  readonly decision: RemediationDecision;
  readonly refusal: RemediationRefusal | null;
  /** 1-based attempt this would be. Present only when allowed. */
  readonly attemptNumber: number | null;
  /** Always present: how many times 14-F has refused this incident. */
  readonly refusedCount: number;
}

/**
 * The ONLY alert types an automatic remediation attempt may ever be made for.
 *
 * Deliberately a separate list from 14-A's eligibility table rather than a
 * read of it. 14-A decides "is this diagnosable?"; this decides "may a
 * machine act on it unattended?" Keeping them apart means widening one cannot
 * silently widen the other — a test asserts this list is a SUBSET of 14-A's
 * remediation-eligible set, so it can never grant more than diagnosis allows.
 */
export const AUTO_REMEDIATION_ALLOWLIST: readonly AlertType[] = ["dispatcher_pass_failing"];

/**
 * Budgets. Small on purpose.
 *
 * ¶256 asks for a per-incident AND per-hour ceiling on automatically opened
 * PRs. These are the code-side equivalents; they are low because the cost of
 * being wrong is asymmetric — a missed automatic fix waits for a human, an
 * unbounded loop opens PRs until someone notices.
 */
export const REMEDIATION_LIMITS = {
  /** Attempts for ONE incident, ever, before it becomes a human's problem. */
  maxAttemptsPerIncident: 3,
  /** Quiet period after an attempt for the same incident. */
  cooldownSeconds: 3_600,
  /** Ceiling across ALL incidents inside the rolling window. */
  maxGlobalAttemptsPerWindow: 5,
  globalWindowSeconds: 3_600,
  /** Bound on tracked incidents, mirroring 13-D's MAX_TRACKED_KEYS rationale. */
  maxTrackedIncidents: 1_000,
} as const;

/**
 * ---------------------------------------------------------------------------
 * THE KILL SWITCH
 * ---------------------------------------------------------------------------
 * Engaged unless the environment explicitly says otherwise. The default is
 * OFF — remediation is opt-in, and a fresh deployment that has never heard of
 * this variable does not quietly start opening PRs.
 *
 * WHY IT IS AN ENVIRONMENT VARIABLE AND NOT A ROW OR A ROUTE.
 * A database row can be written by anything holding a service-role client,
 * which includes every worker an AI-authored patch could touch. An HTTP route
 * can be called. An env var read at request time can only be changed by
 * someone who can change the deployment's configuration — a human with
 * platform access — and changing it takes effect without this code
 * participating in the decision at all.
 *
 * There is deliberately NO setter, NO enable function, NO override parameter
 * and NO admin endpoint in this module. `admin-route-service.ts` says it
 * plainly about its own (different) control: "a kill switch reachable by an
 * agent is a kill switch" that is not one. The same reasoning applies here,
 * one level up.
 *
 * NOT THE SAME CONTROL AS THE PROVIDER ROUTING KILL SWITCH. That one disables
 * a provider or model; this one freezes AI self-healing. Sharing a flag would
 * mean disabling a flaky provider also silently disabled the safety brake on
 * the automation, or vice versa.
 */
export const REMEDIATION_ENABLED_VAR = "CINEFIELD_AUTO_REMEDIATION_ENABLED";

export function isRemediationKillSwitchEngaged(): boolean {
  try {
    // Exactly one string disengages it. Not "1", not "yes", not truthiness —
    // an accidental value must fail toward the safe side.
    return process.env[REMEDIATION_ENABLED_VAR] !== "true";
  } catch {
    return true;
  }
}

interface IncidentRecord {
  attempts: number;
  refusedCount: number;
  lastAttemptMs: number;
}

/** Per-incident state, keyed on 13-D's dedupeKey. */
const incidents = new Map<string, IncidentRecord>();
/** Timestamps of recent global attempts, for the rolling storm window. */
let globalAttempts: number[] = [];

function evictIfNeeded(): void {
  if (incidents.size <= REMEDIATION_LIMITS.maxTrackedIncidents) return;
  const oldest = [...incidents.entries()].sort((a, b) => a[1].lastAttemptMs - b[1].lastAttemptMs);
  for (let i = 0; i < incidents.size - REMEDIATION_LIMITS.maxTrackedIncidents; i += 1) {
    incidents.delete(oldest[i][0]);
  }
}

function refuse(reason: RemediationRefusal, record: IncidentRecord | undefined): RemediationVerdict {
  return {
    decision: "REFUSE",
    refusal: reason,
    attemptNumber: null,
    refusedCount: (record?.refusedCount ?? 0) + 1,
  };
}

/**
 * Decides whether an automatic remediation attempt may proceed.
 *
 * Order is part of the contract: the kill switch is checked FIRST, before
 * eligibility, budgets or anything else. When remediation is frozen, no other
 * question is even asked — a frozen system must not be doing bookkeeping that
 * could itself misbehave.
 *
 * `commit` defaults to false so a caller can ask without consuming budget.
 * Only a committed ALLOW increments counters, which is what makes the storm
 * ceiling meaningful.
 */
export function evaluateRemediationAttempt(params: {
  dedupeKey: string;
  alertType: AlertType;
  nowMs?: number;
  commit?: boolean;
}): RemediationVerdict {
  try {
    const nowMs = params.nowMs ?? Date.now();
    const record = incidents.get(params.dedupeKey);

    // 1. Kill switch, before everything.
    if (isRemediationKillSwitchEngaged()) return refuse("kill_switch_engaged", record);

    // 2. Only allow-listed incident classes may EVER be attempted unattended.
    if (!AUTO_REMEDIATION_ALLOWLIST.includes(params.alertType)) {
      return refuse("not_remediation_eligible", record);
    }

    // 3. Per-incident attempt ceiling. After this the incident is a human's.
    if (record && record.attempts >= REMEDIATION_LIMITS.maxAttemptsPerIncident) {
      return refuse("max_attempts_exhausted", record);
    }

    // 4. Cooldown. A repeating signal aggregates; it does not re-propose.
    if (record && nowMs - record.lastAttemptMs < REMEDIATION_LIMITS.cooldownSeconds * 1_000) {
      return refuse("cooldown_active", record);
    }

    // 5. Global storm ceiling across ALL incidents. This is what stops an
    //    alert storm across many distinct resources from fanning out into a
    //    PR per resource — the per-incident limits alone would not.
    const windowStart = nowMs - REMEDIATION_LIMITS.globalWindowSeconds * 1_000;
    const recent = globalAttempts.filter((t) => t >= windowStart);
    if (recent.length >= REMEDIATION_LIMITS.maxGlobalAttemptsPerWindow) {
      return refuse("global_budget_exhausted", record);
    }

    const attemptNumber = (record?.attempts ?? 0) + 1;

    if (params.commit) {
      incidents.set(params.dedupeKey, {
        attempts: attemptNumber,
        refusedCount: record?.refusedCount ?? 0,
        lastAttemptMs: nowMs,
      });
      globalAttempts = [...recent, nowMs];
      evictIfNeeded();
    }

    return { decision: "ALLOW_ATTEMPT", refusal: null, attemptNumber, refusedCount: record?.refusedCount ?? 0 };
  } catch {
    // A broken guardrail refuses. See the header: every failure direction is
    // toward no proposal.
    return { decision: "REFUSE", refusal: "guardrail_unavailable", attemptNumber: null, refusedCount: 0 };
  }
}

/** Test/diagnostic only. Never consulted by a decision. */
export function remediationStateFor(dedupeKey: string): { attempts: number; refusedCount: number } | null {
  const r = incidents.get(dedupeKey);
  return r ? { attempts: r.attempts, refusedCount: r.refusedCount } : null;
}

export function resetRemediationGuardrail(): void {
  incidents.clear();
  globalAttempts = [];
}
