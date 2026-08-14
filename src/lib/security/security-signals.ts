import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { setRateLimitObserver } from "./route-rate-limit";
import { recordSecurityEventDetached } from "./security-event-logger";
import type { SecurityEventInput } from "./security-event-contract";

/**
 * Where security signals are actually CONNECTED (Phase 12-C).
 *
 * ---------------------------------------------------------------------------
 * THIS FILE EXISTS BECAUSE OF A RECURRING DEFECT
 * ---------------------------------------------------------------------------
 * Three times now this project has shipped a component that was complete,
 * tested, and reached by nothing: `consumeRateLimit` sat unused from 6R.7
 * while `generate` could spend money (D-12-1), and the entire outbox had no
 * path to realtime for 22 hours of pending events (D-11-1). A Security Event
 * Logger with no producers would be the same defect a third time, and it
 * would be the worst instance of it — an empty evidence table reads as "no
 * incidents", which is a lie a dashboard will happily tell.
 *
 * So every producer lives here, in one file, where a reader can count them:
 *
 *   1. rate-limit denials        via the PRE-12 observer seam
 *   2. outbound fetch refusals   direct, from the SSRF gateway's caller
 *   3. realtime connection       direct, from the 11-D ceiling
 *   4. unroutable events         direct, from the 11-A dispatcher
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE CAN BLOCK, DELAY, OR REOPEN ANYTHING
 * ---------------------------------------------------------------------------
 * Every function returns `void` and every write is detached. The refusal each
 * one describes has already been decided and returned by the time it is
 * called. If Supabase is unreachable the signal is lost — which is the
 * correct trade, because the alternative is a security control whose failure
 * mode is admitting the request it just refused.
 */

/** Null rather than a throw: an unconfigured environment must not crash a refusal. */
function adminOrNull(): SupabaseClient | null {
  if (!isSupabaseAdminConfigured()) return null;
  try {
    return getSupabaseAdminClient();
  } catch {
    return null;
  }
}

/**
 * Test-only sink override.
 *
 * Every reporter below funnels through `emit`, so capturing here lets a suite
 * assert the EXACT payload each producer builds — that an SSRF report carries
 * no host, that a connection denial carries no count — instead of matching
 * strings in source. Null in production, and `emit` reads it on every call so
 * a leftover override cannot survive a test that forgot to clear it any
 * longer than the process it ran in.
 */
let testSink: ((input: SecurityEventInput) => void) | null = null;

export function setSecurityEmitterForTest(sink: ((input: SecurityEventInput) => void) | null): void {
  testSink = sink;
}

function emit(input: SecurityEventInput): void {
  if (testSink) {
    testSink(input);
    return;
  }
  const admin = adminOrNull();
  if (!admin) return;
  recordSecurityEventDetached(admin, input);
}

// ---------------------------------------------------------------------------
// 1. Rate-limit denials
// ---------------------------------------------------------------------------

/**
 * Installs the observer PRE-12 left empty. Idempotent, and called at module
 * load by `response-headers.ts` — the module every guarded route already
 * imports — so the wiring cannot be lost by someone forgetting to call it.
 *
 * An explicit call, not a bare side-effect import: a side-effect import is
 * the kind of line a tidy-up removes, and removing it would silently empty
 * the evidence table rather than break a build.
 */
let installed = false;

export function installSecuritySignals(): void {
  if (installed) return;
  installed = true;

  setRateLimitObserver({
    onDenied({ routeClass, subject, action, subjectRef }) {
      emit({
        kind: "rate_limit_denied",
        source: "route_rate_limit",
        // The route CLASS, not the path. A class is the policy that fired and
        // is the useful unit; a path would put endpoint inventory in a table
        // an operator screenshots.
        reasonCode: `route_class_${routeClass}`,
        ...(subject === "user"
          ? { actorClerkUserId: subjectRef, tenantId: subjectRef }
          : { subjectHash: subjectRef }),
        resourceType: "route",
        // The limiter's own action label — "paid-compute", "auth-read". Safe,
        // and it distinguishes independently-limited operations.
        resourceId: action,
      });
    },
  });
}

/** Test seam. Lets a suite prove the installer is idempotent and reversible. */
export function resetSecuritySignalsForTest(): void {
  installed = false;
  setRateLimitObserver(null);
}

// ---------------------------------------------------------------------------
// 2. Outbound fetch refusals (SSRF)
// ---------------------------------------------------------------------------

/**
 * A provider result URL pointed somewhere it may not.
 *
 * THE URL NEVER ARRIVES HERE, and the signature is the enforcement: this
 * takes a failure CLASS and an optional refusal detail, both drawn from
 * `OutboundFetchFailure`, and there is no parameter a URL could be passed in.
 * A signed provider URL is a credential; a query string can carry one; a host
 * name identifies the provider. None of that is evidence — the interesting
 * fact is that egress was refused and why in the abstract.
 *
 * Only the DESTINATION-POLICY refusals are security events. `timeout`,
 * `http_error`, `response_too_large` and `network_error` are the world being
 * unreliable, and the contract's `OPERATIONAL_NOT_SECURITY` list says so; a
 * security table that fills with provider timeouts stops being read.
 */
const SECURITY_RELEVANT_FETCH_FAILURES: ReadonlySet<string> = new Set([
  "scheme_blocked",
  "url_credentials",
  "ip_blocked",
  "redirect_blocked",
]);

export function reportOutboundFetchBlocked(params: {
  failure: string;
  /** A refusal class from the gateway — "loopback", "link_local". Never a host. */
  detail?: string;
  tenantId?: string | null;
  /** The generation the download belonged to. An opaque uuid its owner has. */
  generationId?: string | null;
  traceId?: string | null;
}): void {
  if (!SECURITY_RELEVANT_FETCH_FAILURES.has(params.failure)) return;

  emit({
    kind: "outbound_fetch_blocked",
    source: "outbound_fetch_gateway",
    // Both halves are bounded enum-like strings from the gateway's own
    // taxonomy. `detail` is normalized rather than trusted, so a future
    // gateway change cannot widen this into free text.
    reasonCode: normalizeCode(params.detail ? `${params.failure}_${params.detail}` : params.failure),
    tenantId: params.tenantId ?? null,
    actorClerkUserId: params.tenantId ?? null,
    resourceType: "generation",
    resourceId: params.generationId ?? null,
    traceId: params.traceId ?? null,
  });
}

/**
 * Forces an arbitrary string into the reason-code alphabet, or drops it.
 *
 * The gateway's failure strings already match, but this is the boundary
 * between a subsystem's vocabulary and an evidence column — normalizing here
 * means a later gateway change cannot smuggle punctuation, a host, or a path
 * fragment into a column the schema promises is a short code.
 */
function normalizeCode(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 65);
  return /^[a-z]/.test(cleaned) ? cleaned : `unknown_${cleaned}`.slice(0, 65);
}

// ---------------------------------------------------------------------------
// 3. Realtime connection ceiling (11-D)
// ---------------------------------------------------------------------------

/**
 * A realtime connection was refused by the 11-D ceiling.
 *
 * The SCOPE KIND travels — "user", "workspace", "ip" — because which ceiling
 * fired is what an operator needs. The COUNT does not, the limit does not,
 * and the lease key does not. The refusal the client received already
 * withheld all three for the same reason: a client learning it hit the IP
 * ceiling rather than its own has learned something about the other people
 * behind its NAT.
 */
export function reportRealtimeConnectionDenied(params: {
  scope: "user" | "workspace" | "ip";
  userId: string;
  tenantId: string;
  traceId?: string | null;
}): void {
  emit({
    kind: "realtime_connection_denied",
    source: "realtime_gateway",
    reasonCode: `connection_limit_${params.scope}`,
    actorClerkUserId: params.userId,
    tenantId: params.tenantId,
    resourceType: "realtime",
    traceId: params.traceId ?? null,
  });
}

// ---------------------------------------------------------------------------
// 4. Unroutable events (11-A / 11-D)
// ---------------------------------------------------------------------------

/**
 * An event exists whose tenant cannot be proven, so it was dropped.
 *
 * Not an attack, and scored `medium` rather than high for that reason — but
 * it is a correctness hole that hides one, and 11-D's whole guarantee is that
 * an event never reaches the wrong tenant. Silence here would mean the system
 * could quietly stop delivering to somebody and nothing would say so.
 *
 * No tenant by definition, so no warning can be emitted and none is asked
 * for: the row is operator evidence only.
 */
export function reportRealtimeEventUnroutable(params: {
  eventType: string;
  eventId?: string | null;
}): void {
  emit({
    kind: "realtime_event_unroutable",
    source: "realtime_dispatcher",
    reasonCode: normalizeCode(`unroutable_${params.eventType}`),
    resourceType: "outbox_event",
    resourceId: params.eventId ?? null,
  });
}

// ---------------------------------------------------------------------------
// 5. Media safety decisions (9-E)
// ---------------------------------------------------------------------------

/**
 * A quarantined asset was released, or an asset was rejected.
 *
 * The highest-privilege action the product has is two administrators agreeing
 * to release quarantined media. It belongs in the security trail — but as
 * EVIDENCE, never as grounds for enforcement, which is why both kinds are
 * `subject_is_actor = false` and the Risk Engine cannot escalate them.
 *
 * WHAT DOES NOT TRAVEL: the approvers. `media_safety_audit` already holds who
 * approved what, behind service_role, and copying an approver's identity into
 * a second table would double the number of places it can leak from. The
 * subject here is the asset's OWNER, because the trail is about which
 * account's media was affected.
 *
 * Deliberately not written from inside `approve_media_release` /
 * `reject_media_asset`: those are the locked 9-E security boundary and their
 * invariants were proven against those exact bodies. This is the TypeScript
 * caller instead — one layer out, no locked SQL redefined, and a failure to
 * log cannot roll back a moderation decision that has already committed.
 */
export function reportMediaSafetyDecision(params: {
  decision: "released" | "rejected";
  assetId: string;
  /** The owner of the asset, not the approver. */
  tenantId?: string | null;
  traceId?: string | null;
}): void {
  emit({
    kind: params.decision === "released" ? "media_release_approved" : "media_rejected",
    source: "media_safety",
    reasonCode: params.decision === "released" ? "quarantine_released" : "asset_rejected",
    tenantId: params.tenantId ?? null,
    resourceType: "media_asset",
    resourceId: params.assetId,
    traceId: params.traceId ?? null,
  });
}

// ---------------------------------------------------------------------------
// WHAT IS NOT WIRED, AND WHY
// ---------------------------------------------------------------------------
// `auth_failure` has NO PRODUCER. Clerk owns authentication and its failed
// sign-in attempts happen at Clerk, not in this process — there is no code
// path here that observes one, and inventing a producer that fires on a
// missing session would record "not signed in yet" as a security incident
// several thousand times a day.
//
// It stays in the taxonomy because it is the one signal a real
// security-event table must eventually carry, and the honest state is
// AUTH_SECURITY_SIGNAL: PARTIAL_UNTIL_CLERK_PRODUCTION — Clerk production
// configuration plus its webhook is what makes it observable. Recording the
// gap is better than deleting the category and rediscovering it later.
