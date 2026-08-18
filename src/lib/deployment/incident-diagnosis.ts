import type { AlertEnvelope, AlertSeverity, AlertSource, AlertType } from "@/lib/alerts/alert-contract";
import { CHANGE_PATH_PATTERN } from "./change-risk";

/**
 * Incident → diagnosis seam (Phase 14-A, code-only half).
 *
 * Roadmap 14-A: "Sentry Seer root-cause → AI fix branch → GitHub PR akışını
 * kur." Done-criterion: "Test hata için PR hazırlanıyor; production'a direkt
 * push yok." This file is the FIRST arrow of that chain — incident in,
 * bounded diagnosis out — and nothing further.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT SENTRY SEER, AND IT DOES NOT PRETEND TO BE
 * ---------------------------------------------------------------------------
 * `LocalDeterministicRootCauseProvider` is a lookup table over the Phase 13-D
 * alert catalogue. It performs no inference, calls no model, and reaches no
 * network. Roadmap ¶111/¶753 place Sentry Seer among the scale-triggered
 * layers ("ihtiyaç/ölçek sinyallerine göre aktive edilir"), so it is correctly
 * absent. The `RootCauseProvider` interface exists so a future
 * `SentrySeerRootCauseProvider` can replace this one without any consumer
 * changing — the same seam pattern `TelemetrySink` (13-A) and
 * `AlertDeliverySink` (13-D) already use in this repository.
 *
 * ---------------------------------------------------------------------------
 * DIAGNOSIS IS EVIDENCE, NEVER AUTHORITY
 * ---------------------------------------------------------------------------
 * An `IncidentDiagnosis` cannot set a risk class, choose a required check,
 * approve anything, or authorize a write. It has no field for any of those —
 * a structural guarantee, not a runtime rule. Phase 14-B's classifier derives
 * risk independently from the candidate paths, and Phase 12-E's gate remains
 * the only policy authority. The strongest thing a diagnosis can say is
 * "these files look relevant"; something else decides what that costs.
 */

/** What kind of failure this appears to be. Closed set, server-derived. */
export type DiagnosisCategory =
  | "dispatcher_transport"
  | "operational_backlog"
  | "dependency_unavailable"
  | "provider_degradation"
  | "security_incident"
  | "infrastructure_incident"
  | "unknown";

/**
 * How much the provider trusts its own answer.
 *
 * `none` is a real value and the default for anything uncatalogued — a
 * provider that always produces a confidence is a provider that is guessing.
 */
export type ConfidenceClass = "high" | "medium" | "low" | "none";

/**
 * The three ways analysis can end.
 *
 * `HUMAN_INVESTIGATION_REQUIRED` is not a failure — it is the correct,
 * expected answer for most incident classes, and the only answer for anything
 * security-, billing- or infrastructure-shaped (see ELIGIBILITY below).
 * `ANALYSIS_UNAVAILABLE` is the bounded failure result required by the
 * batch's failure semantics: it never throws into a caller.
 */
export type DiagnosisOutcome =
  | "REMEDIATION_CANDIDATE"
  | "HUMAN_INVESTIGATION_REQUIRED"
  | "ANALYSIS_UNAVAILABLE";

export interface IncidentDiagnosis {
  /** From the alert. Identifies THIS emission. */
  readonly alertId: string;
  /**
   * From the alert. Identifies the PROBLEM across emissions.
   *
   * Carried deliberately for Phase 14-F: dedupe, cooldown and attempt limits
   * all need a stable incident identity to key off, and 13-D already computes
   * exactly that (`source:type:resource`). Re-deriving a second identity here
   * would guarantee the two disagree.
   */
  readonly dedupeKey: string;
  readonly alertType: AlertType;
  readonly source: AlertSource;
  readonly severity: AlertSeverity;
  readonly category: DiagnosisCategory;
  readonly confidence: ConfidenceClass;
  /** Bounded short code, same discipline as 12-C/13-D reason codes. */
  readonly reasonCode: string;
  /** Repo-relative paths the provider believes are relevant. May be empty. */
  readonly candidateFilePaths: readonly string[];
  readonly outcome: DiagnosisOutcome;
  readonly requiresHumanInvestigation: boolean;
  /** How many times 13-D has seen this problem. Feeds future 14-F limits. */
  readonly occurrenceCount: number;
  readonly correlation: {
    readonly traceId?: string;
    readonly generationId?: string;
    readonly providerAttemptId?: string;
  };
}

/**
 * The future-provider boundary.
 *
 * `external` is on the interface rather than inferred, so a test can assert
 * that no external provider is registered without knowing provider names.
 */
export interface RootCauseProvider {
  readonly name: string;
  /** True for anything that leaves the process. Must be false today. */
  readonly external: boolean;
  analyze(envelope: AlertEnvelope): IncidentDiagnosis;
}

/**
 * Per-alert-type eligibility.
 *
 * Derived from the batch's own eligibility rules and the roadmap's automation
 * boundary. Only ONE class is remediation-eligible today: a dispatcher loop
 * failing is "bounded dispatcher failure with code ownership" — the code that
 * owns it is in this repository, the failure is deterministic, and the blast
 * radius of a wrong guess is a PR a human still has to read.
 *
 * Everything else is HUMAN_INVESTIGATION_REQUIRED, and the conservative
 * direction is deliberate: an operational backlog can be load rather than a
 * bug, a degraded provider is someone else's code, and security/infrastructure
 * incidents are named FORBIDDEN_AUTOMATION by the change-risk taxonomy. A
 * diagnosis engine that proposed code changes for those would be proposing
 * exactly the changes the taxonomy refuses to automate.
 */
interface EligibilityRule {
  readonly category: DiagnosisCategory;
  readonly confidence: ConfidenceClass;
  readonly remediationEligible: boolean;
  readonly candidateFilePaths: readonly string[];
  readonly why: string;
}

const ELIGIBILITY: Readonly<Record<AlertType, EligibilityRule>> = {
  dispatcher_pass_failing: {
    category: "dispatcher_transport",
    confidence: "medium",
    remediationEligible: true,
    candidateFilePaths: ["worker/realtime-dispatcher-worker.ts", "src/lib/realtime/outbox-dispatcher.ts"],
    why: "Bounded dispatcher failure with code ownership — the loop and its transport both live in this repository.",
  },
  realtime_outbox_backlog: {
    category: "operational_backlog",
    confidence: "low",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "A backlog is as likely to be load as a bug; proposing a code change for throughput would be guessing.",
  },
  realtime_outbox_stalled: {
    category: "operational_backlog",
    confidence: "low",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Ageing rows point at a stuck consumer OR an upstream cause; not attributable to a code surface without investigation.",
  },
  realtime_outbox_retry_exhaustion: {
    category: "operational_backlog",
    confidence: "low",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Attempt exhaustion usually reflects a failing destination, not the dispatcher's own code.",
  },
  dependency_degraded: {
    category: "dependency_unavailable",
    confidence: "low",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "A degraded dependency is infrastructure state, not a defect in this repository.",
  },
  dependency_unavailable: {
    category: "infrastructure_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Infrastructure incident — FORBIDDEN_AUTOMATION territory.",
  },
  runtime_unready: {
    category: "infrastructure_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "A whole runtime being unready is an operational event; a code patch is not the first response.",
  },
  provider_degraded: {
    category: "provider_degradation",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "The failing code belongs to an external provider; nothing here can fix it.",
  },
  provider_unhealthy: {
    category: "provider_degradation",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Same as provider_degraded, and which provider is unwell is commercially sensitive.",
  },
  security_high_severity: {
    category: "security_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Security incidents escalate to a human, always. An automated patch here could close evidence or widen the hole.",
  },
  security_action_recommended: {
    category: "security_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "The Risk Engine asked for human review by name; automating past that would defeat the request.",
  },
  dr_restore_validation_failed: {
    category: "infrastructure_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 15-C. A restore validation failure means backed-up data or its restore path is unreliable — the fix is a DR/infrastructure investigation, never a source-code patch. An agent asked to remediate it would have nothing to change and no way to verify a fix.",
  },
  recovery_rto_breached: {
    category: "infrastructure_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 15-D/2. A recovery took longer than its configured target — the fix is faster infrastructure recovery (queue redrive, dependency restoration, region failover), never a source-code patch. Keeps the Phase 14-D boundary intact: bad-release rollback is a different question from infrastructure recovery duration.",
  },
  recovery_rpo_breached: {
    category: "infrastructure_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 15-D/2. A recovery lost more data than its configured window allows — a durability/backup-cadence question, never something a code patch remediates after the fact.",
  },
  recovery_evidence_unavailable: {
    category: "infrastructure_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 15-D/2. Required Phase 15-C restore-validation evidence could not be obtained for an active recovery — an investigation into the evidence source, never a source-code remediation.",
  },
  cost_budget_at_risk: {
    category: "operational_backlog",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 15-B. Cost pressure is not proof of a code defect — the usual cause is legitimate traffic or a price change at the provider, and neither has a patch. An agent asked to fix it would edit whatever it could reach, which is worse than doing nothing.",
  },
  cost_budget_exhausted: {
    category: "operational_backlog",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 15-B. A crossed budget is a business threshold being met, not a bug. The response is a routing or spending decision a human owns; automating a code change in reply would attack the wrong system entirely.",
  },
  slo_budget_low: {
    category: "operational_backlog",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 15-A. A burn rate says an objective is under pressure, not WHERE the fault is — there is no code surface to attribute it to, and guessing one would produce a patch aimed at a symptom.",
  },
  slo_budget_exhausted: {
    category: "operational_backlog",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 15-A. A breached objective is an aggregate over many requests; the underlying cause already alerts separately through its own health, debt or provider signal, which is the alert an agent could act on.",
  },
  infra_drift_detected: {
    category: "infrastructure_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 18-D. Live infrastructure diverged from its declared Terraform configuration outside the reviewed apply path — the fix is a human reconciling the console change or the Terraform declaration, never a source-code patch. See docs/operations/INFRA_EMERGENCY_RUNBOOK.md.",
  },
  infra_drift_check_unavailable: {
    category: "infrastructure_incident",
    confidence: "none",
    remediationEligible: false,
    candidateFilePaths: [],
    why: "Phase 18-D. The drift checker itself failed to reach a conclusion (credentials, backend, or tool failure) — an operational/CI investigation, never a source-code remediation, and never proof anything about the infrastructure is actually wrong.",
  },
};

/**
 * Path safety for provider-supplied candidates.
 *
 * NOTE ON `CHANGE_PATH_PATTERN`: 14-B's pattern is `[a-zA-Z0-9_./-]{1,256}`,
 * which permits `../` — every character in a traversal sequence is in its
 * allowed set. That was harmless while paths only ever came from a trusted
 * caller, but a diagnosis provider is exactly the kind of component that will
 * one day be an external model, so traversal is rejected explicitly here
 * rather than assumed impossible upstream.
 */
const FORBIDDEN_PATH_SEGMENTS: readonly RegExp[] = [
  /(^|\/)\.\.(\/|$)/, // traversal
  /^\//, // absolute (POSIX)
  /^[a-zA-Z]:[\\/]/, // absolute (Windows)
  /(^|\/)\.env/i,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)CinefieldAI(\/|$)/,
  /credential|secret|\.pem$|\.key$|id_rsa/i,
];

/**
 * Normalizes and filters candidate paths. Anything unsafe is DROPPED, not
 * repaired — a path that needed rewriting to be safe is a path nobody
 * reviewed, and silently "fixing" it would hide where it came from.
 */
export function safeCandidatePaths(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (normalized.length === 0) continue;
    if (!CHANGE_PATH_PATTERN.test(normalized)) continue;
    if (FORBIDDEN_PATH_SEGMENTS.some((p) => p.test(normalized))) continue;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * The only provider that exists today. Deterministic, local, no I/O.
 *
 * It summarises evidence 13-D already produced and looks the alert type up in
 * the table above. It cannot reach a conclusion the table does not contain,
 * which is why an unknown type resolves to `ANALYSIS_UNAVAILABLE` rather than
 * to a guess.
 */
export class LocalDeterministicRootCauseProvider implements RootCauseProvider {
  readonly name = "local-deterministic";
  readonly external = false;

  analyze(envelope: AlertEnvelope): IncidentDiagnosis {
    const rule = ELIGIBILITY[envelope.type];

    const base = {
      alertId: envelope.alertId,
      dedupeKey: envelope.dedupeKey,
      alertType: envelope.type,
      source: envelope.source,
      severity: envelope.severity,
      occurrenceCount: envelope.occurrenceCount,
      // Explicit projection, never a spread of envelope.correlation — the
      // 13-E discipline: name every field that crosses a boundary.
      correlation: {
        ...(envelope.correlation.traceId ? { traceId: envelope.correlation.traceId } : {}),
        ...(envelope.correlation.generationId ? { generationId: envelope.correlation.generationId } : {}),
        ...(envelope.correlation.providerAttemptId
          ? { providerAttemptId: envelope.correlation.providerAttemptId }
          : {}),
      },
    };

    if (!rule) {
      return {
        ...base,
        category: "unknown",
        confidence: "none",
        reasonCode: "uncatalogued_alert_type",
        candidateFilePaths: [],
        outcome: "ANALYSIS_UNAVAILABLE",
        requiresHumanInvestigation: true,
      };
    }

    const candidateFilePaths = safeCandidatePaths(rule.candidateFilePaths);

    // An eligible rule whose paths were all rejected is no longer eligible:
    // a remediation candidate with nothing to change is not a candidate.
    const eligible = rule.remediationEligible && candidateFilePaths.length > 0;

    return {
      ...base,
      category: rule.category,
      confidence: rule.confidence,
      reasonCode: envelope.reasonCode,
      candidateFilePaths,
      outcome: eligible ? "REMEDIATION_CANDIDATE" : "HUMAN_INVESTIGATION_REQUIRED",
      requiresHumanInvestigation: !eligible,
    };
  }
}

const defaultProvider: RootCauseProvider = new LocalDeterministicRootCauseProvider();

/**
 * Analyses one incident. Never throws.
 *
 * A provider that fails produces `ANALYSIS_UNAVAILABLE`, because observability
 * is not authoritative: a broken analyser must not be able to fail a
 * generation, retry a provider, move a credit or change a security decision.
 */
export function analyzeIncident(
  envelope: AlertEnvelope,
  provider: RootCauseProvider = defaultProvider
): IncidentDiagnosis {
  try {
    return provider.analyze(envelope);
  } catch {
    // Bounded failure. The alert's own identity fields are echoed back where
    // they are readable so the unusable result is still correlatable, but no
    // conclusion is invented: category `unknown`, confidence `none`.
    return {
      alertId: typeof envelope?.alertId === "string" ? envelope.alertId : "unknown",
      dedupeKey: typeof envelope?.dedupeKey === "string" ? envelope.dedupeKey : "unknown",
      alertType: envelope.type,
      source: envelope.source,
      severity: envelope.severity,
      category: "unknown",
      confidence: "none",
      reasonCode: "analysis_failed",
      candidateFilePaths: [],
      outcome: "ANALYSIS_UNAVAILABLE",
      requiresHumanInvestigation: true,
      occurrenceCount: Number.isFinite(envelope?.occurrenceCount) ? envelope.occurrenceCount : 1,
      correlation: {},
    };
  }
}

/** Test/diagnostic access to the eligibility table. Never a decision input. */
export function eligibilityRuleFor(type: AlertType): EligibilityRule | undefined {
  return ELIGIBILITY[type];
}
