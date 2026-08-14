/**
 * The security event taxonomy (Phase 12-C).
 *
 * No "server-only": the shape is shared by the logger, the Risk Engine and
 * their tests, and a taxonomy defined twice is a taxonomy that will disagree
 * with itself.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DETAILED NAMES LIVE HERE AND NOT IN THE EVENT TYPE
 * ---------------------------------------------------------------------------
 * The domain event contract admits exactly two dotted segments
 * (`^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$`) and a known family. So
 * `security.rate_limit.denied` is not expressible as an outbox event type —
 * three segments, and an underscore the pattern rejects. Widening that
 * contract to fit a logging taxonomy would be the tail wagging the dog; PRE-11
 * repaired exactly that class of drift.
 *
 * The split is therefore deliberate:
 *
 *   security_events.kind   the detailed internal taxonomy, below. Operator
 *                          data. Bounded by a database CHECK.
 *   security.warning       the ONE user-facing outbox event type, already
 *                          named by Phase 11-B's browser state mapping.
 *
 * A user learns that something was refused. An operator learns what.
 */

/** What happened. Extending this is a migration, which is the point. */
export type SecurityEventKind =
  | "rate_limit_denied"
  | "outbound_fetch_blocked"
  | "realtime_connection_denied"
  | "media_release_approved"
  | "media_rejected"
  | "realtime_event_unroutable"
  | "auth_failure"
  // Phase 12-E. The policy decision log lives here rather than in a table of
  // its own: two append-only stores would mean two retention policies, two
  // sets of grants, and a second place nobody remembers to check.
  | "policy_decision_allowed"
  | "policy_decision_denied";

/** Which subsystem observed it. */
export type SecuritySource =
  | "route_rate_limit"
  | "outbound_fetch_gateway"
  | "realtime_gateway"
  | "media_safety"
  | "realtime_dispatcher"
  | "auth"
  | "policy_gate";

export type SecuritySeverity = "info" | "low" | "medium" | "high";

/** What the Risk Engine may ask for. Nothing here executes itself. */
export type RiskAction = "none" | "warning" | "challenge" | "temporary_block" | "admin_review";

/**
 * Short codes only, matching the SQL validator. Never a message, never a URL,
 * never a provider string — a reason that can hold prose will eventually hold
 * the user's own prompt echoed back by an error.
 */
export const REASON_CODE = /^[a-z][a-z0-9_]{1,64}$/;

/**
 * Severity is a property of the KIND, not of the caller's mood. Fixing it here
 * means two subsystems cannot report the same class of event at different
 * severities and quietly skew every downstream count.
 *
 *   rate_limit_denied           low     one denial is a client behaving badly
 *                                       or a user being impatient. Volume is
 *                                       what makes it interesting, and volume
 *                                       is recurrence, not severity.
 *   outbound_fetch_blocked      high    a provider result pointed at a private
 *                                       or metadata address. Either a provider
 *                                       is compromised or someone is probing
 *                                       our egress; neither is routine.
 *   realtime_connection_denied  low     usually tabs. Same reasoning as rate
 *                                       limiting.
 *   realtime_event_unroutable   medium  an event exists whose tenant cannot be
 *                                       proven. Not an attack, but a
 *                                       correctness hole that hides one.
 *   media_release_approved      medium  a two-person release of quarantined
 *                                       media. Not suspicious — but it is the
 *                                       highest-privilege action the product
 *                                       has, and it belongs in the trail.
 *   media_rejected              info    the safe direction.
 *   auth_failure                low     see the note on observability below.
 */
export const KIND_SEVERITY: Readonly<Record<SecurityEventKind, SecuritySeverity>> = {
  rate_limit_denied: "low",
  outbound_fetch_blocked: "high",
  realtime_connection_denied: "low",
  realtime_event_unroutable: "medium",
  media_release_approved: "medium",
  media_rejected: "info",
  auth_failure: "low",
  //   policy_decision_allowed   medium  a critical action was permitted. Not
  //                                     suspicious — but a quarantine release
  //                                     or a routing kill switch is exactly
  //                                     what an incident asks about later.
  //   policy_decision_denied    medium  someone reached a critical action and
  //                                     was refused. One is a misconfigured
  //                                     script; a pattern is worth a look.
  policy_decision_allowed: "medium",
  policy_decision_denied: "medium",
};

/**
 * Whether the SUBJECT of the event is the one who CAUSED it.
 *
 * ---------------------------------------------------------------------------
 * THIS DISTINCTION PREVENTS PUNISHING THE WRONG PERSON
 * ---------------------------------------------------------------------------
 * Every row carries a subject, but a subject is not always an actor. When a
 * provider returns a result URL pointing at cloud metadata, the gateway
 * refuses it and the only identity in scope is the owner of the generation —
 * who did nothing except ask for a video. Scoring that `high` is right; it IS
 * alarming. Blocking that account for it would be a bug with a person on the
 * other end of it.
 *
 * So attribution is recorded explicitly, and the Risk Engine caps what may be
 * done to a subject who is merely the context:
 *
 *   true   the subject made the requests being counted
 *   false  the subject is who the event is ABOUT, not who caused it
 *
 * An operator action (a quarantine release) is `false` for a second reason:
 * it is a legitimate privileged action recorded for the trail, and enforcing
 * anything against an administrator for performing their job would be absurd.
 */
export const KIND_SUBJECT_IS_ACTOR: Readonly<Record<SecurityEventKind, boolean>> = {
  rate_limit_denied: true,
  // A provider chose the URL, not the account that owns the generation.
  outbound_fetch_blocked: false,
  realtime_connection_denied: true,
  // No subject exists at all: the tenant is precisely what could not be proven.
  realtime_event_unroutable: false,
  // Privileged operator actions. Evidence, never grounds for enforcement.
  media_release_approved: false,
  media_rejected: false,
  auth_failure: true,
  // A permitted critical action is a legitimate operator action. Enforcing
  // anything against an administrator for doing their job would be absurd.
  policy_decision_allowed: false,
  // A refusal IS attributable to whoever attempted it. At `medium` severity
  // the arithmetic tops out below the block threshold, so repeated policy
  // refusals warn and escalate to review — they never lock an operator out of
  // the system they are trying to operate.
  policy_decision_denied: true,
};

/**
 * The coalescing window per kind, in seconds.
 *
 * A signal is written at most once per subject per window. Short windows keep
 * a genuine escalation visible; long ones would smother it. `high` severity
 * gets the shortest window because a repeated SSRF probe is the one pattern
 * where the timing matters.
 */
export const KIND_WINDOW_SECONDS: Readonly<Record<SecurityEventKind, number>> = {
  rate_limit_denied: 60,
  outbound_fetch_blocked: 30,
  realtime_connection_denied: 120,
  realtime_event_unroutable: 300,
  media_release_approved: 1,
  media_rejected: 1,
  auth_failure: 60,
  // One second, for the same reason as the media decisions: these are rare,
  // deliberate actions and every one of them is its own audit record.
  policy_decision_allowed: 1,
  policy_decision_denied: 1,
};

/**
 * Signals that are OPERATIONAL, not security, and must never be recorded here.
 *
 * Recorded as a named list rather than left to judgement, because the failure
 * mode is gradual: every application error looks a little suspicious, and a
 * security table that fills with provider timeouts stops being read.
 *
 *   provider timeout / 5xx      the provider is having a bad day
 *   provider rate limit (429)   we are being throttled, not attacked
 *   generation failed           a model refused or errored
 *   generation cancelled        a user changed their mind
 *   redis unavailable           infrastructure
 *   oversize / timeout download a large file or a slow host
 *
 * The distinction the roadmap draws is intent-shaped: a timeout is the world
 * being unreliable; a request aimed at 169.254.169.254 is someone trying
 * something. Only the second is evidence.
 */
export const OPERATIONAL_NOT_SECURITY: readonly string[] = [
  "provider_timeout",
  "provider_5xx",
  "provider_rate_limited",
  "generation_failed",
  "generation_cancelled",
  "redis_unavailable",
  "download_oversize",
  "download_timeout",
];

/**
 * Whether the SPECIFIC RESOURCE belongs in the storm-control key.
 *
 * Storm control coalesces by subject and signal, which is right when the
 * point is to bound a write rate under attack. It is wrong when every
 * individual occurrence must survive.
 *
 * A quarantine release is the second case. It is rare, human-driven, and the
 * highest-privilege action the product has; two assets released in the same
 * second must produce two rows, not one, or the audit trail silently loses a
 * decision. Including the resource id makes them distinct keys.
 *
 * Everything else is `false` on purpose. An attacker controls how many
 * requests they send; if the resource id were in the key for, say, rate-limit
 * denials, they would control the key too, and storm control would be a
 * suggestion rather than a bound.
 */
export const KIND_DEDUPE_INCLUDES_RESOURCE: Readonly<Record<SecurityEventKind, boolean>> = {
  rate_limit_denied: false,
  // A caller can mint generations, so the generation id must not widen the key.
  outbound_fetch_blocked: false,
  realtime_connection_denied: false,
  realtime_event_unroutable: false,
  // Rare, privileged, and each one is an audit record in its own right.
  media_release_approved: true,
  media_rejected: true,
  auth_failure: false,
  // Every policy decision is its own log entry. Two releases decided in the
  // same second must be two rows, or the decision log has a hole in it exactly
  // where the interesting actions are.
  policy_decision_allowed: true,
  policy_decision_denied: true,
};

export interface SecurityEventInput {
  kind: SecurityEventKind;
  source: SecuritySource;
  reasonCode: string;
  /** Server-verified only. Never a browser claim. */
  actorClerkUserId?: string | null;
  tenantId?: string | null;
  /** A hashed bucket. Never an address. */
  subjectHash?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  traceId?: string | null;
  /**
   * Phase 12-E. Which policy version produced a decision. Only meaningful on
   * the two `policy_decision_*` kinds; without it a log entry records that
   * something was allowed but not what allowed it, and drift becomes silent.
   */
  policyVersion?: string | null;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "unknown_kind" | "unknown_source" | "bad_reason_code" | "operational_not_security" | "unbounded_field" };

/**
 * Validates before anything touches the database.
 *
 * The database CHECKs are the real boundary; this exists so a caller gets a
 * typed refusal instead of a constraint violation, and so the
 * operational-vs-security rule is enforced in one readable place rather than
 * by whoever is writing the next integration.
 */
export function validateSecurityEvent(input: SecurityEventInput): ValidationResult {
  if (!(input.kind in KIND_SEVERITY)) return { ok: false, reason: "unknown_kind" };
  if (!SOURCES.has(input.source)) return { ok: false, reason: "unknown_source" };
  if (!REASON_CODE.test(input.reasonCode)) return { ok: false, reason: "bad_reason_code" };
  if (OPERATIONAL_NOT_SECURITY.includes(input.reasonCode)) {
    return { ok: false, reason: "operational_not_security" };
  }

  for (const [value, max] of [
    [input.actorClerkUserId, 255],
    [input.tenantId, 255],
    [input.subjectHash, 64],
    [input.resourceType, 64],
    [input.resourceId, 200],
    [input.traceId, 200],
    [input.policyVersion, 64],
  ] as [string | null | undefined, number][]) {
    if (typeof value === "string" && value.length > max) return { ok: false, reason: "unbounded_field" };
  }

  return { ok: true };
}

const SOURCES: ReadonlySet<string> = new Set<SecuritySource>([
  "route_rate_limit",
  "outbound_fetch_gateway",
  "realtime_gateway",
  "media_safety",
  "realtime_dispatcher",
  "auth",
  "policy_gate",
]);

/**
 * The storm-control key.
 *
 * Derived entirely from server-side facts. Two different subjects can never
 * collide, and the same subject repeating the same signal inside a window
 * always does — which is exactly the coalescing the schema relies on.
 *
 * A signal with neither an actor nor a subject hash falls back to the kind
 * alone. That deliberately coalesces ALL anonymous instances of it into one
 * row per window: without a subject there is nothing to attribute, and a
 * million unattributable rows would be a denial of service against the table
 * rather than evidence.
 */
export function dedupeKeyFor(input: SecurityEventInput): string {
  const subject = input.actorClerkUserId ?? input.subjectHash ?? "anon";
  const scope = input.resourceType ? `:${input.resourceType}` : "";
  const resource =
    KIND_DEDUPE_INCLUDES_RESOURCE[input.kind] && input.resourceId ? `:${input.resourceId}` : "";
  return `${input.kind}:${subject}:${input.reasonCode}${scope}${resource}`;
}
