import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  identifierPatternFor,
  type MediaSafetySummaryView,
  type RiskEvidenceView,
  type RiskInvestigationResult,
  type RiskLookupIdentifierType,
} from "./risk-investigation-contract";

/**
 * The Phase 16-A admin Risk investigation read service.
 *
 * ---------------------------------------------------------------------------
 * NARROW, EXPLICIT-COLUMN, INDEPENDENT READS — NOTHING ELSE, NO SCORING
 * ---------------------------------------------------------------------------
 * `security_events` (bounded, by the selected identifier) and, for the
 * `clerk_user_id`/`generation_id` axes only, `media_assets`' safety columns
 * (bounded, by the same identifier) — see `risk-investigation-contract.ts`'s
 * header for exactly which column each axis matches and why `trace_id` never
 * queries `media_assets` (no such column exists there). No `.insert(`,
 * `.update(`, `.upsert(`, or `.delete(` exists anywhere in this file, and no
 * scoring function is called — `risk_score`/`recommended_action` are read
 * verbatim from the row the Risk Engine already wrote.
 *
 * The two sources are independent fallible reads, the same defensive
 * discipline `user-investigation-service.ts` and `workspace-investigation-
 * service.ts` already established: a `media_assets` failure with real
 * `security_events` evidence still present degrades to
 * `PARTIAL_RISK_EVIDENCE` rather than discarding real evidence. For the
 * `trace_id` axis only `security_events` is ever attempted, so a failure
 * there is total (`RISK_SOURCE_UNAVAILABLE`), not partial — there is no
 * second source for that axis to fall back on.
 */

const MAX_EVENTS = 50;
const MAX_MEDIA_SAFETY = 20;

interface RawReadResult<T> {
  readonly ok: boolean;
  readonly data: T | null;
}

function securityEventsQuery(admin: SupabaseClient, type: RiskLookupIdentifierType, value: string) {
  const base = admin
    .from("security_events")
    .select(
      "event_id, kind, severity, source, reason_code, risk_score, recommended_action, occurred_at, trace_id, resource_type, resource_id, actor_clerk_user_id, policy_version"
    );
  if (type === "clerk_user_id") return base.eq("actor_clerk_user_id", value);
  if (type === "trace_id") return base.eq("trace_id", value);
  return base.eq("resource_type", "generation").eq("resource_id", value);
}

async function readSecurityEvents(
  admin: SupabaseClient,
  type: RiskLookupIdentifierType,
  value: string
): Promise<RawReadResult<Record<string, unknown>[]>> {
  try {
    const { data, error } = await securityEventsQuery(admin, type, value)
      .order("occurred_at", { ascending: false })
      .limit(MAX_EVENTS);
    if (error) return { ok: false, data: null };
    return { ok: true, data: (data as Record<string, unknown>[] | null) ?? [] };
  } catch {
    return { ok: false, data: null };
  }
}

/** `null` return means "not applicable for this axis" — never attempted, not a failed read. */
async function readMediaSafety(
  admin: SupabaseClient,
  type: RiskLookupIdentifierType,
  value: string
): Promise<RawReadResult<Record<string, unknown>[]> | null> {
  if (type === "trace_id") return null;

  try {
    const base = admin
      .from("media_assets")
      .select("id, generation_id, quarantine_status, moderation_status, moderation_engine, moderated_at, ingest_status, created_at");
    const scoped = type === "clerk_user_id" ? base.eq("clerk_user_id", value) : base.eq("generation_id", value);
    const { data, error } = await scoped.order("created_at", { ascending: false }).limit(MAX_MEDIA_SAFETY);
    if (error) return { ok: false, data: null };
    return { ok: true, data: (data as Record<string, unknown>[] | null) ?? [] };
  } catch {
    return { ok: false, data: null };
  }
}

function projectEvents(rows: readonly Record<string, unknown>[]): RiskEvidenceView[] {
  return rows.map((row) => ({
    eventId: row.event_id as string,
    kind: row.kind as RiskEvidenceView["kind"],
    severity: row.severity as RiskEvidenceView["severity"],
    source: row.source as RiskEvidenceView["source"],
    reasonCode: row.reason_code as string,
    riskScore: (row.risk_score as number | null) ?? null,
    recommendedAction: (row.recommended_action as RiskEvidenceView["recommendedAction"]) ?? null,
    occurredAt: row.occurred_at as string,
    traceId: (row.trace_id as string | null) ?? null,
    resourceType: (row.resource_type as string | null) ?? null,
    resourceId: (row.resource_id as string | null) ?? null,
    actorClerkUserId: (row.actor_clerk_user_id as string | null) ?? null,
    policyVersion: (row.policy_version as string | null) ?? null,
  }));
}

function projectMediaSafety(rows: readonly Record<string, unknown>[]): MediaSafetySummaryView[] {
  return rows.map((row) => ({
    mediaId: row.id as string,
    generationId: (row.generation_id as string | null) ?? null,
    quarantineStatus: row.quarantine_status as string,
    moderationStatus: row.moderation_status as string,
    moderationEngine: (row.moderation_engine as string | null) ?? null,
    moderatedAt: (row.moderated_at as string | null) ?? null,
    ingestStatus: row.ingest_status as string,
    createdAt: row.created_at as string,
  }));
}

export async function getAdminRiskInvestigation(
  admin: SupabaseClient,
  identifierType: RiskLookupIdentifierType,
  identifierValue: string
): Promise<RiskInvestigationResult> {
  if (!identifierPatternFor(identifierType).test(identifierValue)) {
    // Malformed input never reaches the database — no wildcard/arbitrary
    // query is possible even in principle.
    return { outcome: "INVALID_IDENTIFIER" };
  }

  const [eventsResult, mediaResult] = await Promise.all([
    readSecurityEvents(admin, identifierType, identifierValue),
    readMediaSafety(admin, identifierType, identifierValue),
  ]);

  // trace_id axis: media_assets was never applicable (readMediaSafety
  // returned null), so only the security_events read decides the outcome.
  if (mediaResult === null) {
    if (!eventsResult.ok) return { outcome: "RISK_SOURCE_UNAVAILABLE", reasonCode: "security_events_read_failed" };
    const events = projectEvents(eventsResult.data ?? []);
    if (events.length === 0) return { outcome: "NO_RISK_EVIDENCE" };
    return { outcome: "FOUND", events, mediaSafety: [] };
  }

  if (!eventsResult.ok && !mediaResult.ok) {
    return { outcome: "RISK_SOURCE_UNAVAILABLE", reasonCode: "read_failed" };
  }

  // `security_events` is the PRIMARY/canonical source (see this file's and
  // the contract's header). Its own read failing is treated more
  // conservatively than the secondary `media_assets` read failing: real
  // media-safety evidence still present is never discarded (PARTIAL), but
  // an empty secondary result cannot stand in for a primary source that was
  // never actually read — that would silently upgrade "unknown" to "clean."
  if (!eventsResult.ok) {
    const mediaSafety = projectMediaSafety(mediaResult.data ?? []);
    if (mediaSafety.length === 0) {
      return { outcome: "RISK_SOURCE_UNAVAILABLE", reasonCode: "security_events_read_failed" };
    }
    return { outcome: "PARTIAL_RISK_EVIDENCE", events: [], mediaSafety, reasonCode: "security_events_read_failed" };
  }

  // The primary source WAS successfully read (whatever it found, including
  // genuinely zero rows) — that half of the picture is real and confirmed.
  // A failed secondary read still means the full picture is incomplete, so
  // this is PARTIAL even when `events` itself is empty, the same asymmetric
  // choice `workspace-investigation-service.ts` makes when its own primary
  // read succeeds but its secondary read fails.
  if (!mediaResult.ok) {
    const events = projectEvents(eventsResult.data ?? []);
    return { outcome: "PARTIAL_RISK_EVIDENCE", events, mediaSafety: [], reasonCode: "media_assets_read_failed" };
  }

  const events = projectEvents(eventsResult.data ?? []);
  const mediaSafety = projectMediaSafety(mediaResult.data ?? []);
  if (events.length === 0 && mediaSafety.length === 0) {
    return { outcome: "NO_RISK_EVIDENCE" };
  }
  return { outcome: "FOUND", events, mediaSafety };
}
