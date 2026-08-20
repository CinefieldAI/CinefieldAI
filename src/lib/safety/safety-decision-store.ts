import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CsamHashOutcome } from "./csam-hash";
import type { MandatoryReportOutcome } from "./mandatory-reporting";
import type { ProviderNativeSafetySignal } from "./provider-native-safety";
import { isValidSafetyReasonCode, type SafetyDecision } from "./safety-contract";

/**
 * The durable side of Phase 28.
 *
 * ---------------------------------------------------------------------------
 * WHAT CANNOT REACH THIS TABLE
 * ---------------------------------------------------------------------------
 * No prompt, no negative prompt, no media bytes, no provider payload, no
 * signed URL, no object key, no token, no free-form classifier text. That is
 * enforced twice: `SafetyDecision` has no field any of them fit in, and the
 * SQL CHECK on `reason_code` refuses anything that is not a short lower-case
 * code. A recorder that tried to smuggle a matched term through would be
 * rejected by the database, not merely discouraged by a comment.
 *
 * ---------------------------------------------------------------------------
 * THE PROVIDER SIGNAL GOES IN ITS OWN COLUMNS
 * ---------------------------------------------------------------------------
 * Cinefield's verdict and the vendor's opinion are written separately and
 * never merged. REFERANS M.1 treats provider moderation as untrusted evidence
 * ("GÜVENME"), and the only way to keep that honest over time is to be able to
 * ask, later, what the vendor actually said versus what Cinefield decided.
 *
 * ---------------------------------------------------------------------------
 * A FAILED WRITE IS NOT A PASS
 * ---------------------------------------------------------------------------
 * `recordSafetyDecision` returns whether it persisted. Callers treat a false
 * as a safety failure rather than as a logging inconvenience: an unrecorded
 * decision means the system cannot later prove it evaluated anything, and
 * 28-B's done-criterion is explicitly that an incident record EXISTS.
 */

export interface SafetyDecisionRecord {
  readonly clerkUserId: string;
  readonly decision: SafetyDecision;
  readonly generationId?: string | null;
  readonly mediaAssetId?: string | null;
  readonly outputIndex?: number | null;
  readonly providerSignal?: ProviderNativeSafetySignal | null;
  readonly hashOutcome?: CsamHashOutcome | null;
  readonly reportOutcome?: MandatoryReportOutcome | null;
}

/** Maps the hash union onto the column's bounded vocabulary. */
function hashColumnValue(outcome: CsamHashOutcome | null | undefined): string {
  switch (outcome?.outcome) {
    case "POSITIVE_MATCH":
      return "positive_match";
    case "NO_MATCH":
      return "no_match";
    case "PROVIDER_UNAVAILABLE":
      return "provider_unavailable";
    case "MALFORMED_RESULT":
      return "malformed_result";
    default:
      // Both "PROVIDER_NOT_CONFIGURED" and a missing outcome land here, and
      // they mean the same thing: nothing was checked. Critically NOT
      // `no_match`, which would read as a clean result.
      return "not_configured";
  }
}

function reportColumnValue(outcome: MandatoryReportOutcome | null | undefined): string {
  switch (outcome?.outcome) {
    case "REPORTING_NOT_CONFIGURED":
      return "reporting_not_configured";
    case "REPORT_REQUIRED":
      return "report_required";
    case "REPORT_SUBMITTED":
      return "report_submitted";
    case "REPORT_FAILED":
      return "report_failed";
    default:
      return "not_required";
  }
}

/**
 * Writes one decision. Returns false rather than throwing — a caller decides
 * what an unrecorded decision means for ITS lane, and for the output lane the
 * answer is "do not release".
 */
export async function recordSafetyDecision(
  admin: SupabaseClient,
  record: SafetyDecisionRecord
): Promise<boolean> {
  // Refused before the database has to refuse it, so a bad code is a caller
  // bug rather than a runtime surprise inside a transaction.
  if (!isValidSafetyReasonCode(record.decision.reasonCode)) return false;

  const { error } = await admin.rpc("record_safety_decision", {
    p_clerk_user_id: record.clerkUserId,
    p_decision_stage: record.decision.stage,
    p_verdict: record.decision.verdict,
    p_reason_code: record.decision.reasonCode,
    p_policy_version: record.decision.policyVersion,
    p_generation_id: record.generationId ?? null,
    p_media_asset_id: record.mediaAssetId ?? null,
    p_output_index: record.outputIndex ?? null,
    p_risk_categories: [...record.decision.categories],
    p_classifier_version: record.decision.classifierVersion,
    p_provider_signal_source: record.decision.signalSource,
    // `null` and `false` are different facts: null is "the provider said
    // nothing", false is "the provider said it is clean". Collapsing them
    // would erase the distinction the separate columns exist to keep.
    p_provider_signal_flagged: record.providerSignal ? record.providerSignal.flagged : null,
    p_provider_signal_reason: record.providerSignal?.reasonCode ?? null,
    p_hash_check_outcome: hashColumnValue(record.hashOutcome),
    p_mandatory_report_state: reportColumnValue(record.reportOutcome),
  });

  return !error;
}

/**
 * How many times this user has been BLOCKED within a window (28-C).
 *
 * Counts blocks only. `REVIEW_REQUIRED` is explicitly not a violation — it is
 * an unresolved question, and counting unresolved questions toward account
 * enforcement would punish users for the classifier's uncertainty. Nor does a
 * `NOT_CONFIGURED` decision count: no classifier objected to anything.
 *
 * Returns null when the count cannot be established. Null is NOT zero, and
 * `resolveRepeatOffenderEnforcement` treats it accordingly.
 */
export async function countRecentViolations(
  admin: SupabaseClient,
  clerkUserId: string,
  windowDays: number
): Promise<number | null> {
  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > 3650) return null;
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const { count, error } = await admin
    .from("media_safety_decisions")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", clerkUserId)
    .eq("verdict", "BLOCK")
    .gte("created_at", since);

  if (error) return null;
  return count ?? null;
}

export type RepeatOffenderOutcome =
  /** No threshold has been decided. Enforcement is unavailable, honestly. */
  | { readonly outcome: "BUSINESS_DECISION_REQUIRED"; readonly violations: number | null }
  /** Below the configured threshold. */
  | { readonly outcome: "WITHIN_THRESHOLD"; readonly violations: number; readonly threshold: number }
  /** At or above it. A HUMAN still has to act — see below. */
  | { readonly outcome: "ENFORCEMENT_RECOMMENDED"; readonly violations: number; readonly threshold: number }
  /** The count could not be read. Never treated as zero. */
  | { readonly outcome: "COUNT_UNAVAILABLE" };

/**
 * Evaluates repeat-offender status (28-C).
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO HARDCODED THRESHOLD, AND THAT IS DELIBERATE
 * ---------------------------------------------------------------------------
 * The roadmap says "tekrarlı ihlalde hesap kapatma" and names no number. A
 * number invented here would be a product policy written by an implementation
 * batch, and it would be the number that closes a paying customer's account.
 * With none configured this returns `BUSINESS_DECISION_REQUIRED` and account
 * enforcement stays unavailable.
 *
 * ---------------------------------------------------------------------------
 * AND IT RECOMMENDS — IT NEVER SUSPENDS
 * ---------------------------------------------------------------------------
 * `ENFORCEMENT_RECOMMENDED` is the strongest thing this function can produce.
 * `account.suspend` remains `implemented: false` in the policy registry
 * because no suspension owner, route, durable state or reinstatement path
 * exists — and the Phase 28 brief is explicit that the flag must not be
 * flipped merely because the action is registered. Deriving a suspension from
 * one noisy classifier would also be exactly what §22 forbids.
 */
export async function resolveRepeatOffenderEnforcement(
  admin: SupabaseClient,
  clerkUserId: string
): Promise<RepeatOffenderOutcome> {
  const rawThreshold = process.env.CINEFIELD_REPEAT_VIOLATION_THRESHOLD;
  const rawWindow = process.env.CINEFIELD_REPEAT_VIOLATION_WINDOW_DAYS;

  const threshold = rawThreshold ? Number(rawThreshold) : NaN;
  const windowDays = rawWindow ? Number(rawWindow) : NaN;

  if (!Number.isInteger(threshold) || threshold <= 0 || !Number.isInteger(windowDays) || windowDays <= 0) {
    // Not even counted. Reading a count for a decision nobody can act on would
    // be a query run for no reason, and the honest answer does not need it.
    return { outcome: "BUSINESS_DECISION_REQUIRED", violations: null };
  }

  const violations = await countRecentViolations(admin, clerkUserId, windowDays);
  if (violations === null) return { outcome: "COUNT_UNAVAILABLE" };

  return violations >= threshold
    ? { outcome: "ENFORCEMENT_RECOMMENDED", violations, threshold }
    : { outcome: "WITHIN_THRESHOLD", violations, threshold };
}
