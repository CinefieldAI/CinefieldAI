import "server-only";
import type { DomainEventEnvelope } from "@/lib/events/domain-event";

/**
 * Event projection (Phase 11-A).
 *
 * Turns a committed domain event into the small, explicitly-listed object a
 * browser is allowed to see. The rule that shapes every line below:
 *
 *   NOTHING IS FORWARDED. EVERYTHING IS COPIED, FIELD BY NAME.
 *
 * There is no spread of the outbox payload anywhere in this file, and that is
 * the point. `outbox_events.payload` is unrestricted jsonb written by SQL
 * functions; a spread would mean every field any future emitter adds is
 * published to browsers the moment it is added, with no review. So each
 * projector names the two or three fields it wants and drops the rest — a new
 * field in an emitter's payload changes nothing here until someone
 * deliberately adds it.
 *
 * WHAT MAY NEVER APPEAR
 * Provider secrets, raw provider responses, R2/S3 object keys, signed URLs,
 * AWS or Cloudflare credentials, internal routing scores, raw safety-audit
 * rows, quarantine approver identities, stack traces, prompts, and arbitrary
 * metadata. Several of those are not even present in the source payloads —
 * the event schemas already exclude them — but the allowlist means a later
 * schema change cannot leak them by accident either.
 *
 * PRESENTATION IS NOT AUTHORITY
 * `uiState` is a label for a UI, derived from the event type. The authority
 * for what a generation IS remains the `generations` row; a client that has
 * missed events resyncs from it (roadmap 11.7) rather than trusting a
 * reconstruction from this stream.
 */

/** Exactly the six states 11-B must map, and no others. */
export type BrowserState =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "credit.updated"
  | "security.warning";

export interface NotificationProjection {
  /** UI state label. Presentation only — see the header. */
  uiState: BrowserState;
  /**
   * Which durable thing this is about. `security` was added in 12-C and is
   * NOT a generation: a warning is about the account, and the id identifies
   * the evidence row, so a browser that keys UI by generation id must ignore
   * it rather than attach it to whatever ran last.
   */
  subject: { kind: "generation" | "asset" | "security"; id: string };
  /** Allowlisted, per event type. Never a spread. */
  detail: Readonly<Record<string, string | number>>;
}

export type ProjectionResult =
  | { ok: true; projection: NotificationProjection }
  | { ok: false; reason: "not_user_facing" | "unknown_event_type" };

/** Narrow reads. A missing or wrongly-typed field is simply omitted. */
function str(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : undefined;
}

function int(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** Drops undefined entries so `detail` never carries an empty key. */
function detailOf(entries: Record<string, string | number | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function projectEvent(event: DomainEventEnvelope): ProjectionResult {
  const p = event.payload;

  switch (event.eventType) {
    // ---- generation lifecycle ---------------------------------------------
    case "generation.created":
      return ok("queued", "generation", event.aggregateId, detailOf({
        generationType: str(p, "generationType"),
        model: str(p, "model"),
      }));

    case "generation.processing":
      return ok("processing", "generation", event.aggregateId, detailOf({}));

    case "generation.completed":
      // durationMs is a number about our own system, not about the output.
      // The output path is deliberately absent from the schema itself.
      return ok("completed", "generation", event.aggregateId, detailOf({
        durationMs: int(p, "durationMs"),
      }));

    case "generation.failed":
      // A NORMALIZED error CODE, never a provider message. A provider message
      // can echo the user's own prompt back through a notification channel.
      return ok("failed", "generation", event.aggregateId, detailOf({
        errorCode: str(p, "errorCode"),
      }));

    case "generation.cancelled":
      return ok("cancelled", "generation", event.aggregateId, detailOf({}));

    // ---- asset safety ------------------------------------------------------
    // Deliberately NOT user-facing in this phase. An owner learns that their
    // generation completed or failed; the moderation decision behind it is
    // operator information, and `media_safety_audit` — approver identities,
    // reason codes, prior statuses — is service_role only for that reason.
    // Phase 12 owns the user-facing security taxonomy. Refusing here is not
    // an oversight to fix later; it is the boundary.
    case "asset.released":
    case "asset.rejected":
      return { ok: false, reason: "not_user_facing" };

    // ---- operator-only families -------------------------------------------
    case "provider.submitted":
    case "provider.failed":
      return { ok: false, reason: "not_user_facing" };

    // ---- credit: registered, no producer until Phase 10 -------------------
    // The projection exists so 11-B can map the state and so the channel is
    // real rather than invented later. NO PRODUCER EMITS THESE. Phase 10 owns
    // the ledger; nothing here fabricates a balance, a charge or a Stripe
    // fact, and the schemas deliberately carry a delta rather than a balance.
    case "credit.reserved":
    case "credit.settled":
    case "credit.refunded":
      return ok("credit.updated", "generation", event.aggregateId, detailOf({
        reservationId: str(p, "reservationId"),
      }));

    // ---- security (Phase 12-C) --------------------------------------------
    // The one security signal a USER sees. It tells them a class of request
    // was refused and how seriously it was taken — nothing else. Deliberately
    // absent: the risk score, the thresholds, the recurrence count, the rate
    // limit, the route, the address hash, the rule that fired. A user who
    // learns they are eight points below a block has learned how to sit at
    // seven; the operator half of that stays in `security_events`, behind
    // service_role.
    //
    // The subject is the EVIDENCE ROW, not a generation. A warning is about
    // the account, and attaching it to a generation id would put a security
    // banner on whichever unrelated render happened to be on screen.
    case "security.warning":
      return ok("security.warning", "security", event.aggregateId, detailOf({
        reasonCode: str(p, "reasonCode"),
        severity: str(p, "severity"),
      }));

    default:
      return { ok: false, reason: "unknown_event_type" };
  }
}

function ok(
  uiState: BrowserState,
  kind: "generation" | "asset" | "security",
  id: string,
  detail: Record<string, string | number>
): ProjectionResult {
  return { ok: true, projection: { uiState, subject: { kind, id }, detail } };
}
