import {
  KIND_SEVERITY,
  KIND_SUBJECT_IS_ACTOR,
  type RiskAction,
  type SecurityEventKind,
  type SecuritySeverity,
} from "./security-event-contract";

/**
 * The Risk Engine (Phase 12-C).
 *
 * Pure and deterministic: an input and a recurrence count go in, a score and a
 * recommended action come out. No I/O, no clock, no randomness — the same
 * inputs always produce the same decision, which is the only way a security
 * decision can be explained to the person it was applied to.
 *
 * ---------------------------------------------------------------------------
 * TRANSPARENT RULES, NOT A MODEL
 * ---------------------------------------------------------------------------
 * The roadmap asks for warning / challenge / temporary block / admin review.
 * It does not ask for a classifier, and building one here would be wrong on
 * two counts: an opaque score cannot be justified to a blocked user, and a
 * model trained on user behaviour is profiling nobody agreed to. The score
 * below is a small sum a reader can compute by hand.
 *
 * It reads FOUR things and nothing else:
 *   - the kind's fixed severity
 *   - how many windows this subject has produced this signal in
 *   - whether the subject is authenticated
 *   - nothing about prompt content, and nothing about the person
 *
 * ---------------------------------------------------------------------------
 * IT RECOMMENDS. IT DOES NOT ACT.
 * ---------------------------------------------------------------------------
 * The output is an ACTION NAME. This module cannot create a generation, cancel
 * one, move credits, release quarantine, override moderation, submit to a
 * provider, alter billing or ban an account — it imports nothing at all, which
 * is the strongest available statement of that. `admin_review` means the
 * engine is ASKING for review; Phase 16 owns performing admin actions, and
 * Phase 19 owns policy-as-code. Nothing here pre-empts either.
 */

/** Severity contributes a base weight. */
const SEVERITY_WEIGHT: Readonly<Record<SecuritySeverity, number>> = {
  info: 0,
  low: 10,
  medium: 30,
  high: 55,
};

/**
 * Recurrence contributes on a flattening curve.
 *
 * The first repeat matters far more than the twentieth: one denial is noise,
 * three in fifteen minutes is a pattern, and thirty is the same pattern with
 * more patience. A linear term would let a long-running nuisance outscore a
 * single genuine SSRF probe, which is exactly backwards.
 *
 * Windows, not requests — storm control preserves the former (see the
 * migration header), and it is the honest unit here too.
 */
function recurrenceWeight(windows: number): number {
  if (windows <= 1) return 0;
  if (windows <= 2) return 8;
  if (windows <= 4) return 18;
  if (windows <= 8) return 28;
  if (windows <= 16) return 36;
  return 40;
}

/**
 * An authenticated subject scores slightly LOWER for the same behaviour.
 *
 * Not leniency — attributability. A signed-in account is nameable, rate
 * limited per user, and can be reviewed; an unattributable source cannot be,
 * so the same pattern from one deserves more caution. The adjustment is small
 * because an authenticated attacker is still an attacker.
 */
const AUTHENTICATED_ADJUSTMENT = -6;

export interface RiskInput {
  kind: SecurityEventKind;
  /** Distinct windows in the lookback period, including this one. */
  recurrenceWindows: number;
  /** True when the signal carries a server-verified identity. */
  authenticated: boolean;
}

export interface RiskDecision {
  score: number;
  action: RiskAction;
  /**
   * Why, in short codes a UI or a log can render without re-deriving the
   * rules. Explainability is a requirement, not a nicety: a blocked user is
   * owed a reason and an operator is owed a way to check it.
   */
  factors: string[];
}

/**
 * Thresholds.
 *
 * Deliberately conservative at the top end: `temporary_block` is the only
 * action with a user-visible cost, so it needs a high-severity signal AND
 * repetition, which the weights below cannot reach on severity alone.
 *
 *   >= 25  warning          tell the user something was refused
 *   >= 55  challenge        ask them to prove they are a person
 *   >= 75  temporary_block  stop them for a bounded time
 *   >= 70  admin_review     ALSO flag for a human — see below
 */
const WARNING_AT = 25;
const CHALLENGE_AT = 55;
const BLOCK_AT = 75;
const REVIEW_AT = 70;

export function assessRisk(input: RiskInput): RiskDecision {
  const severity = KIND_SEVERITY[input.kind];
  const base = SEVERITY_WEIGHT[severity];
  const repeat = recurrenceWeight(input.recurrenceWindows);
  const adjustment = input.authenticated ? AUTHENTICATED_ADJUSTMENT : 0;

  const score = Math.max(0, Math.min(100, base + repeat + adjustment));

  const factors = [`severity_${severity}`, `windows_${input.recurrenceWindows}`];
  if (input.authenticated) factors.push("authenticated_subject");

  // Ordered by cost to the user, most severe first. A single action is
  // returned rather than a set, because two actions would need a precedence
  // rule that this comment would then have to explain.
  let action: RiskAction = "none";
  if (score >= BLOCK_AT) {
    action = "temporary_block";
    factors.push("threshold_block");
  } else if (score >= CHALLENGE_AT) {
    action = "challenge";
    factors.push("threshold_challenge");
  } else if (score >= WARNING_AT) {
    action = "warning";
    factors.push("threshold_warning");
  }

  // `admin_review` is not on the same ladder: it is a REQUEST FOR A HUMAN, and
  // a sustained high-severity pattern deserves one whether or not the
  // automated action was a challenge or a block. When the score reaches review
  // territory but no stronger action was chosen, review is the action.
  if (score >= REVIEW_AT) {
    factors.push("needs_admin_review");
    if (action === "none" || action === "warning") action = "admin_review";
  }

  // THE ATTRIBUTION CAP.
  //
  // A subject who did not cause the event may not be challenged or blocked
  // for it. When a provider hands back a URL aimed at cloud metadata, the
  // only identity in scope is the account that asked for a video; the score
  // stays high because the signal IS alarming, but the strongest thing that
  // may happen to that account is that a human is asked to look. Without this
  // the arithmetic reaches `temporary_block` after five windows and locks out
  // someone whose only involvement was owning the generation.
  //
  // Applied after the ladder rather than by lowering the score, so the row
  // still records how alarming the signal was AND why the response was
  // limited — two facts a reviewer needs separately.
  if (!KIND_SUBJECT_IS_ACTOR[input.kind] && (action === "challenge" || action === "temporary_block")) {
    factors.push("capped_subject_not_actor");
    action = "admin_review";
  }

  return { score, action, factors };
}

/**
 * Whether an action can actually be ENFORCED today.
 *
 * `challenge` needs Cloudflare Turnstile, which is 12-A's edge half and is
 * blocked until a domain exists. The engine may still RECOMMEND it — that is
 * a policy decision and it is correct — but nothing may pretend a challenge
 * was served. A recommendation that cannot be enforced degrades to the
 * strongest thing that can be, and says so.
 */
export type Enforceability =
  | { enforceable: true; action: RiskAction }
  | { enforceable: false; action: RiskAction; degradedTo: RiskAction; reason: "challenge_infrastructure_unavailable" };

export function enforceability(action: RiskAction): Enforceability {
  if (action !== "challenge") return { enforceable: true, action };
  return {
    enforceable: false,
    action,
    // A warning is honest: the user is told, nothing is faked, and the
    // recommendation is still recorded as evidence for when Turnstile lands.
    degradedTo: "warning",
    reason: "challenge_infrastructure_unavailable",
  };
}

/** Bounded, and it expires on its own. No permanent ban exists in this phase. */
export const TEMPORARY_BLOCK_TTL_SECONDS = 900;
