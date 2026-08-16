/**
 * Central alert contract (Phase 13-D, code half).
 *
 * Roadmap 13-D: "Merkezi Alert Router + Telegram Operations/Security +
 * status.cinefield.ai routing kur." Done-criterion: "Aynı incident dedupe
 * edilip doğru kanala tek olay olarak gidiyor."
 *
 * TABLO 10 states the job precisely: normalize, deduplicate and correlate
 * signals, route them to Telegram/Admin/Status, and do it "aynı incident için
 * alarm fırtınasını azaltmak ve tek olay zaman çizgisi oluşturmak" — reduce
 * the alarm storm for one incident and produce a single event timeline.
 *
 * ---------------------------------------------------------------------------
 * THIS HALF ROUTES. IT DOES NOT DELIVER.
 * ---------------------------------------------------------------------------
 * There is no Telegram bot, no status page, no webhook, no token and no
 * network call anywhere in `src/lib/alerts/`. A routing decision here returns
 * symbolic channel names. Delivery is 13-D's external half and is not built.
 *
 * ---------------------------------------------------------------------------
 * THE ALERT IS A PROJECTION, NOT A COPY
 * ---------------------------------------------------------------------------
 * Every field below is bounded: an enum, a short code, or an id matching a
 * fixed pattern. There is no free-text field, no payload, no error object, no
 * evidence row. The durable evidence already exists in `security_events`, in
 * the outbox tables and in the audit trail; an alert says "this happened, this
 * often, here" and points at it. Copying evidence into an alert would create a
 * second copy of sensitive data on a path whose whole purpose is to leave the
 * building — exactly what 13-E ("Telemetry = İkinci Veri Kopyası") forbids.
 */

/**
 * Severity, server-derived only.
 *
 * Never parsed from text, never taken from a request body, never inferred from
 * an error message. Each alert type has ONE default severity in this file, and
 * the only thing allowed to move it is a bounded escalation rule below.
 */
export type AlertSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export const SEVERITY_ORDER: Readonly<Record<AlertSeverity, number>> = {
  INFO: 0,
  WARNING: 1,
  ERROR: 2,
  CRITICAL: 3,
};

/**
 * Symbolic destinations. Roadmap TABLO 10/11: "Telegram, Admin ve Status".
 *
 * `EMAIL` is deliberately absent. The roadmap names three 13-D outputs, and a
 * channel constant that no rule ever selects is a dead target waiting for
 * someone to wire it "since it's already there". When email becomes a real
 * channel it arrives with a rule and a sink, not before.
 */
export type AlertChannel = "TELEGRAM" | "DASHBOARD" | "STATUS_PAGE";

/** Which subsystem observed the signal. */
export type AlertSource =
  | "security"
  | "health"
  | "debt"
  | "dispatcher"
  | "provider"
  | "reliability"
  | "cost"
  | "dr"
  | "recovery";

/**
 * Alert lifecycle.
 *
 * `ACKNOWLEDGED` exists in the type because the state machine is meaningless
 * without it, but NOTHING in this repository can produce it: acknowledgement
 * needs a human and an operator surface, which is Phase 16. No actor is
 * fabricated, no auto-acknowledge exists, and `acknowledge()` is not
 * implemented — a router that acknowledged its own alerts would be a system
 * marking its own homework.
 */
export type AlertState = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "SUPPRESSED";

/**
 * The closed alert catalogue.
 *
 * Every entry here has a REAL PRODUCER in `alert-sources.ts` today, and a test
 * asserts the two sets match exactly in both directions. That is deliberate:
 * this repository has repeatedly found components that existed with no
 * production caller, and a catalogue entry nothing can produce is the same
 * defect one level up — it makes the alert surface look wider than it is.
 *
 * Signals that exist operationally but have no producer yet (workflow-start
 * outbox debt, DR backup debt, SQS/DLQ depth, replay-gap spikes) are NOT
 * listed. They are recorded in the documentation as deferred, because an alert
 * type for a subsystem that cannot report is a fake alert.
 */
export type AlertType =
  // ---- security (Phase 12-C evidence, safe projection only) ---------------
  | "security_high_severity"
  | "security_action_recommended"
  // ---- health (Phase 13 health foundation, transition-based) --------------
  | "dependency_degraded"
  | "dependency_unavailable"
  | "runtime_unready"
  // ---- operational debt ---------------------------------------------------
  | "realtime_outbox_backlog"
  | "realtime_outbox_stalled"
  | "realtime_outbox_retry_exhaustion"
  // ---- dispatcher transport ----------------------------------------------
  | "dispatcher_pass_failing"
  // ---- provider health ----------------------------------------------------
  | "provider_degraded"
  | "provider_unhealthy"
  // ---- reliability (Phase 15-A SLO breach, evidence only) ----------------
  | "slo_budget_low"
  | "slo_budget_exhausted"
  // ---- cost (Phase 15-B FinOps budget pressure, estimate-based) -----------
  | "cost_budget_at_risk"
  | "cost_budget_exhausted"
  // ---- dr (Phase 15-C restore verification, proven failure only) ---------
  | "dr_restore_validation_failed"
  // ---- recovery (Phase 15-D/2 RTO/RPO measurement, proven breach only) ---
  | "recovery_rto_breached"
  | "recovery_rpo_breached"
  | "recovery_evidence_unavailable";

export interface AlertTypeRule {
  readonly source: AlertSource;
  /** Server-derived, and the only place severity is decided. */
  readonly severity: AlertSeverity;
  /** Dedupe window. Repeats inside it coalesce into one alert with a count. */
  readonly dedupeWindowSeconds: number;
  /**
   * Whether this alert describes something a USER of the product would
   * experience — the only thing allowed onto the public status page.
   *
   * This flag is a disclosure control, not a formatting preference.
   * status.cinefield.ai is public (roadmap TABLO 11: "Kullanıcıya servis
   * durumunu açıklar"). Publishing a security alert there would confirm to
   * whoever triggered it that their probe landed, and publishing an internal
   * dependency name would hand out a component map. Operational alerts stay
   * on internal channels regardless of how severe they are.
   */
  readonly userVisible: boolean;
  /** Why this type exists at all — forces the reason to be written down. */
  readonly why: string;
}

export const ALERT_CATALOGUE: Readonly<Record<AlertType, AlertTypeRule>> = {
  security_high_severity: {
    source: "security",
    severity: "CRITICAL",
    dedupeWindowSeconds: 300,
    userVisible: false,
    why: "A high-severity security event (SSRF block, outbound fetch refusal) is the one class that must reach a human quickly.",
  },
  security_action_recommended: {
    source: "security",
    severity: "ERROR",
    dedupeWindowSeconds: 900,
    userVisible: false,
    why: "The Risk Engine asked for admin_review or a temporary block; the request is durable in the row, but nobody is watching the table yet.",
  },
  dependency_degraded: {
    source: "health",
    severity: "WARNING",
    dedupeWindowSeconds: 600,
    userVisible: false,
    why: "A dependency left HEALTHY. The runtime still serves, so this is a warning — but the transition is the early signal an outage gives you.",
  },
  dependency_unavailable: {
    source: "health",
    severity: "ERROR",
    dedupeWindowSeconds: 300,
    userVisible: false,
    why: "A CRITICAL dependency went UNKNOWN or unreachable, which under the health contract makes its runtime unready.",
  },
  runtime_unready: {
    source: "health",
    severity: "CRITICAL",
    dedupeWindowSeconds: 300,
    userVisible: true,
    why: "A whole runtime cannot safely take work. This is the health signal users eventually feel, so it is the one health type allowed on the status page.",
  },
  realtime_outbox_backlog: {
    source: "debt",
    severity: "WARNING",
    dedupeWindowSeconds: 600,
    userVisible: false,
    why: "Pending realtime events are accumulating faster than the dispatcher drains them; delivery is late but not lost.",
  },
  realtime_outbox_stalled: {
    source: "debt",
    severity: "ERROR",
    dedupeWindowSeconds: 600,
    userVisible: true,
    why: "The oldest pending event has aged past the threshold — users are not seeing generation state change, which is a visible product failure.",
  },
  realtime_outbox_retry_exhaustion: {
    source: "debt",
    severity: "ERROR",
    dedupeWindowSeconds: 900,
    userVisible: false,
    why: "Rows are approaching max attempts; without intervention those events are dropped rather than delayed.",
  },
  dispatcher_pass_failing: {
    source: "dispatcher",
    severity: "ERROR",
    dedupeWindowSeconds: 300,
    userVisible: false,
    why: "The dispatcher loop itself is erroring. Debt alerts assume something is draining the queue; this says nothing is.",
  },
  provider_degraded: {
    source: "provider",
    severity: "WARNING",
    dedupeWindowSeconds: 900,
    userVisible: false,
    why: "A provider is failing intermittently. Routing can still avoid it, so this informs rather than escalates.",
  },
  slo_budget_low: {
    source: "reliability",
    severity: "WARNING",
    dedupeWindowSeconds: 3_600,
    userVisible: false,
    why: "Phase 15-A. An error budget is being consumed faster than allocated. Worth knowing, not worth waking someone: the objective is still being met.",
  },
  slo_budget_exhausted: {
    source: "reliability",
    severity: "ERROR",
    dedupeWindowSeconds: 1_800,
    userVisible: false,
    why: "Phase 15-A. A service level objective is breached for this window. Not user-visible: an SLO is an internal commitment, and publishing which objective slipped tells an outsider where the system is weakest.",
  },
  dr_restore_validation_failed: {
    source: "dr",
    severity: "ERROR",
    dedupeWindowSeconds: 3_600,
    userVisible: false,
    why: "Phase 15-C. An isolated restore was validated against the canonical database and at least one check — row count, content checksum, or referential integrity — proved a mismatch. Never user-visible: disaster-recovery posture is internal operational information, and publishing it would tell an outsider exactly how fragile backups are.",
  },
  cost_budget_at_risk: {
    source: "cost",
    severity: "WARNING",
    dedupeWindowSeconds: 3_600,
    userVisible: false,
    why: "Phase 15-B. Estimated provider spend is approaching a configured operational budget. Worth knowing while there is still time to react, not worth waking someone: nothing has been exceeded and no request has been refused.",
  },
  cost_budget_exhausted: {
    source: "cost",
    severity: "ERROR",
    dedupeWindowSeconds: 1_800,
    userVisible: false,
    why: "Phase 15-B. Estimated provider spend has crossed a configured operational budget. Never user-visible: what Cinefield pays a provider is commercial information, and publishing which provider became expensive would expose supplier economics to anyone reading the status page.",
  },
  provider_unhealthy: {
    source: "provider",
    severity: "ERROR",
    dedupeWindowSeconds: 600,
    userVisible: false,
    why: "A provider is failing consistently. Which provider is in trouble is commercially sensitive, so it never reaches the public status page.",
  },
  recovery_rto_breached: {
    source: "recovery",
    severity: "ERROR",
    dedupeWindowSeconds: 1_800,
    userVisible: false,
    why: "Phase 15-D/2. A configured recovery-time target was measured and proven exceeded for a real incident. Never user-visible: which components have configured RTO commitments, and by how much one slipped, is internal operational posture.",
  },
  recovery_rpo_breached: {
    source: "recovery",
    severity: "ERROR",
    dedupeWindowSeconds: 1_800,
    userVisible: false,
    why: "Phase 15-D/2. A configured data-loss-window target was measured and proven exceeded for a real incident. Never user-visible for the same reason a restore-validation failure is not: publishing exposes exactly how fragile a component's durability posture is.",
  },
  recovery_evidence_unavailable: {
    source: "recovery",
    severity: "ERROR",
    dedupeWindowSeconds: 3_600,
    userVisible: false,
    why: "Phase 15-D/2. A recovery that required restore-validation evidence (database/media) could not obtain it at all. Distinct from RECOVERED_NO_TARGET, which is an ordinary, expected, non-alerting state — this is a recovery that was actively measured and whose required evidence could not be determined, which is itself worth a human looking at.",
  },
};

/**
 * Routing table — severity to symbolic channels.
 *
 * Telegram carries CRITICAL and ERROR only. Roadmap TABLO 11 scopes it to
 * "kritik incident ve security bildirim kanalı"; a channel that also receives
 * warnings becomes a channel nobody reads, which is the alarm storm the whole
 * package exists to prevent — just relocated.
 *
 * DASHBOARD receives everything. It is a pull surface (Phase 16), so volume
 * costs nothing there.
 *
 * STATUS_PAGE is added only when the alert is CRITICAL *and* user-visible.
 * Both conditions, always — see `AlertTypeRule.userVisible`.
 */
export function channelsFor(severity: AlertSeverity, userVisible: boolean): AlertChannel[] {
  const channels: AlertChannel[] = ["DASHBOARD"];
  if (SEVERITY_ORDER[severity] >= SEVERITY_ORDER.ERROR) channels.push("TELEGRAM");
  if (severity === "CRITICAL" && userVisible) channels.push("STATUS_PAGE");
  return channels;
}

/**
 * Bounded identifier for the THING an alert is about.
 *
 * A dependency name, a runtime name, a provider id, a security event kind — a
 * closed vocabulary from elsewhere in the codebase. Never a URL, an IP, an
 * email, a prompt, a user id or anything an attacker supplies. This value goes
 * into the dedupe key, so a free-text resource would mean an attacker could
 * mint unlimited distinct alerts by varying it.
 */
export const RESOURCE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/** Correlation ids: 13-A trace ids, generation ids, attempt ids, event ids. */
export const CORRELATION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * What a producer hands the router. Every field is optional except the three
 * that identify the signal, and anything not listed here is dropped by
 * `normalizeCandidate` rather than passed through.
 */
export interface AlertCandidate {
  readonly type: AlertType;
  /** Bounded, matching RESOURCE_PATTERN. */
  readonly resource: string;
  /** Short code, e.g. "oldest_pending_exceeded". Never a message. */
  readonly reasonCode: string;
  /** How many underlying occurrences this single candidate represents. */
  readonly observed?: number;
  readonly traceId?: string;
  readonly generationId?: string;
  readonly providerAttemptId?: string;
  readonly workflowId?: string;
  readonly eventId?: string;
  readonly tenantId?: string;
}

/** The normalized, routed alert. Still a projection — still no payload. */
export interface AlertEnvelope {
  readonly alertId: string;
  readonly type: AlertType;
  readonly source: AlertSource;
  readonly severity: AlertSeverity;
  readonly resource: string;
  readonly reasonCode: string;
  readonly dedupeKey: string;
  readonly state: AlertState;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly occurrenceCount: number;
  readonly channels: readonly AlertChannel[];
  readonly correlation: AlertCorrelation;
}

export interface AlertCorrelation {
  readonly traceId?: string;
  readonly generationId?: string;
  readonly providerAttemptId?: string;
  readonly workflowId?: string;
  readonly eventId?: string;
  readonly tenantId?: string;
}

/** Reason codes, same discipline as 12-C: short codes, never prose. */
export const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;

/**
 * Escalation ladder for suppression.
 *
 * Inside a dedupe window repeats are coalesced, but a repeat count is itself
 * information: 3 identical Redis failures and 3,000 are different incidents.
 * When the count crosses one of these thresholds the alert is re-emitted once,
 * carrying the new count, so an escalating problem stays visible without
 * producing one notification per occurrence.
 */
export const ESCALATION_THRESHOLDS: readonly number[] = [10, 100, 1_000, 10_000];

/**
 * A CRITICAL alert is never held silent for longer than this, no matter how
 * long its dedupe window is.
 *
 * Suppression exists to stop storms, not to stop reporting. Without this cap a
 * sustained critical failure would produce one alert and then silence for as
 * long as the window lasts, which reads identically to "it recovered".
 */
export const CRITICAL_REEMIT_SECONDS = 300;

/** Bound on distinct tracked dedupe keys, so the router cannot grow unbounded. */
export const MAX_TRACKED_KEYS = 5_000;

/**
 * Operational thresholds, centralised here rather than in each producer.
 *
 * Every producer reads from this object so that "what counts as a backlog" is
 * one number in one place. Scattered thresholds drift, and drifted thresholds
 * are how an alert stops firing without anyone deciding it should.
 */
export const ALERT_THRESHOLDS = {
  /** Pending realtime rows before a backlog alert. */
  realtimePendingWarn: 500,
  /** Age of the oldest pending row before the queue counts as stalled. */
  realtimeOldestPendingSecondsWarn: 300,
  /** Attempts on a row before retry exhaustion is close enough to alert on. */
  realtimeAttemptsWarn: 5,
  /** Consecutive dispatcher pass failures before the loop counts as failing. */
  dispatcherConsecutiveFailures: 3,
  /** Consecutive provider health failures before "unhealthy" is alertable. */
  providerConsecutiveFailures: 5,
} as const;

/**
 * Deterministic dedupe key.
 *
 * `source:type:resource` — nothing else. Not the trace id, not the generation
 * id, not the tenant, not a timestamp. Those identify an OCCURRENCE; the key
 * identifies the PROBLEM, and putting an occurrence id in it would mean every
 * repeat looked distinct, which is the alarm storm restated.
 *
 * Nothing secret can reach it: `resource` is pattern-checked before the key is
 * built, so no URL, IP, email or prompt can appear in a value that later gets
 * logged.
 */
export function dedupeKeyFor(type: AlertType, resource: string): string {
  return `${ALERT_CATALOGUE[type].source}:${type}:${resource}`;
}
