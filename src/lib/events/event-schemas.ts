import { compileSchema, type JsonSchema } from "./json-schema";

/**
 * Cinefield local event schema registry (Phase 6R.15).
 *
 * THE source of truth for what a domain event payload may contain. Phase
 * 6R.2's event-publisher contract said each family would get a schema here
 * rather than a TypeScript union that must be edited for every new event;
 * this is that registry.
 *
 * GROUNDED, NOT INVENTED
 * Every schema below describes a fact Cinefield's durable state ALREADY
 * records — the generations status machine and the generation_attempts
 * evidence ladder. Nothing here introduces a new business concept, a new
 * lifecycle, or a consumer behaviour. Events for concepts that do not exist
 * yet are deliberately absent; adding one is a reviewed change, and an
 * unregistered event type is rejected at publish time rather than allowed
 * through as an unknown shape.
 *
 * RELATIONSHIP TO AWS GLUE SCHEMA REGISTRY
 * Glue is governance and DISTRIBUTION — it lets consumers outside this
 * repository discover and pin a schema. It is NOT permission to skip local
 * validation: the producer validates against this registry before a byte
 * leaves the process, whether Glue exists or not. Glue is not provisioned;
 * see schema-registry-config.ts.
 *
 * WHAT MAY APPEAR IN A PAYLOAD
 * Identifiers, enums, timestamps, counts. Never a secret, a signed URL, a
 * provider payload, a prompt, or media. `additionalProperties: false` on
 * every object is the structural half of that rule — an undeclared field
 * cannot ride along even by accident.
 */

/** `<eventType>@<eventVersion>` — the registry's lookup key. */
export type SchemaKey = `${string}@${number}`;

export interface RegisteredSchema {
  /** Glue-compatible schema name: a registry entry's stable identity. */
  schemaName: string;
  eventType: string;
  eventVersion: number;
  /** The payload contract. The envelope itself is validated separately. */
  payload: JsonSchema;
}

const UUID: JsonSchema = { type: "string", format: "uuid" };
const SHORT_ID: JsonSchema = { type: "string", minLength: 1, maxLength: 200 };
const CODE: JsonSchema = { type: "string", pattern: "^[A-Z][A-Z0-9_]{1,64}$" };

/**
 * Generation lifecycle. Mirrors `generations.status`, whose permitted values
 * are already fixed by the database.
 */
const GENERATION_CREATED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generationId", "generationType", "provider", "model"],
  properties: {
    generationId: UUID,
    generationType: { type: "string", enum: ["image", "video", "audio", "text"] },
    provider: SHORT_ID,
    model: SHORT_ID,
  },
};

// attemptNo is OPTIONAL, and that is a correction wiring the producer
// revealed (Phase 6R-E Gate 0). The shared finalization tail is reached by
// transports that do not all carry an attempt — a direct in-process run has
// none — so requiring it would have made the event unemittable exactly when
// the transition happened. Relaxing it is safe here and only here: no
// generation.completed had ever been produced or consumed before this phase,
// so there is no lagging consumer to break. The same relaxation after a real
// consumer exists would be a version bump.
const GENERATION_COMPLETED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generationId", "provider"],
  properties: {
    generationId: UUID,
    provider: SHORT_ID,
    attemptNo: { type: "integer", minimum: 1 },
    // Duration only. NOT the output url: a storage path is an access-bearing
    // locator and events are retained and widely read.
    durationMs: { type: "integer", minimum: 0 },
  },
};

const GENERATION_FAILED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generationId", "provider", "errorCode"],
  properties: {
    generationId: UUID,
    provider: SHORT_ID,
    // A normalized OrchestrationErrorCode — never a provider message, which
    // can echo request content back at us.
    errorCode: CODE,
    attemptNo: { type: "integer", minimum: 1 },
  },
};

const GENERATION_CANCELLED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generationId"],
  properties: {
    generationId: UUID,
    provider: SHORT_ID,
  },
};

/**
 * Provider attempt facts. Mirrors `generation_attempts.status` and its
 * submission_evidence ladder — including "ambiguous", which is precisely the
 * fact downstream reconciliation needs to hear about.
 */
const PROVIDER_SUBMITTED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generationId", "attemptId", "provider", "submissionEvidence"],
  properties: {
    generationId: UUID,
    attemptId: UUID,
    provider: SHORT_ID,
    // The provider's own job id is an identifier, not a credential.
    providerJobId: { type: ["string", "null"], maxLength: 500 },
    submissionEvidence: { type: "string", enum: ["none", "ambiguous", "job"] },
  },
};

const PROVIDER_FAILED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generationId", "attemptId", "provider", "errorCode"],
  properties: {
    generationId: UUID,
    attemptId: UUID,
    provider: SHORT_ID,
    errorCode: CODE,
    submissionEvidence: { type: "string", enum: ["none", "ambiguous", "job"] },
  },
};

/**
 * Credit facts. Mirrors `credit_reservations` and `credit_ledger`, whose
 * columns and status values already exist. The BALANCE is deliberately
 * absent: a balance is a moving figure whose only authority is the database,
 * and an event carrying a stale one invites a consumer to display or reason
 * from it. Events report the DELTA and the reservation's identity; anyone
 * needing a balance reads it.
 */
const CREDIT_RESERVED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reservationId", "amount"],
  properties: {
    reservationId: UUID,
    generationId: { type: ["string", "null"], maxLength: 64 },
    amount: { type: "integer", minimum: 0 },
  },
};

const CREDIT_SETTLED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reservationId", "charged"],
  properties: {
    reservationId: UUID,
    generationId: { type: ["string", "null"], maxLength: 64 },
    charged: { type: "integer", minimum: 0 },
    returned: { type: "integer", minimum: 0 },
  },
};

const CREDIT_REFUNDED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reservationId", "returned"],
  properties: {
    reservationId: UUID,
    generationId: { type: ["string", "null"], maxLength: 64 },
    returned: { type: "integer", minimum: 0 },
    // A short reason code, matching the SQL function's own p_reason.
    reason: { type: "string", pattern: "^[a-z][a-z0-9_]{1,64}$" },
  },
};

/**
 * The queued -> processing transition (Phase 11-A). Emitted by
 * `claim_generation_tx`, whose `AND status = 'queued'` predicate means exactly
 * one concurrent claimer can win — so exactly one of these can exist per
 * generation. Carries no stage string: a stage is an internal orchestration
 * label, and the browser state it drives is simply "processing".
 */
const GENERATION_PROCESSING: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["generationId"],
  properties: {
    generationId: UUID,
    provider: SHORT_ID,
  },
};

/**
 * Asset safety outcomes (Phase 9-E, renamed into the canonical family here).
 *
 * The ID AND NOTHING ELSE. A release or a rejection is a security decision,
 * and the interesting parts of it — which administrators approved, the reason
 * code, the moderation status it turned on — are exactly the parts that must
 * not travel. `media_safety_audit` holds them, behind service_role, for
 * operators. An event that carried them would put an approver's identity into
 * every consumer, every replay window and every log line downstream.
 */
const ASSET_RELEASED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assetId"],
  properties: {
    assetId: UUID,
  },
};

const ASSET_REJECTED: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assetId"],
  properties: {
    assetId: UUID,
  },
};

/**
 * A security warning the OWNER of the affected tenant is told about (12-C).
 *
 * TWO FIELDS, AND THEY ARE THE TWO A PERSON CAN ACT ON: what class of thing
 * was refused, and how seriously we took it. Everything an attacker would
 * want is absent by construction — no score, no threshold, no recurrence
 * count, no limit, no route, no address, no rule name. Learning "you are at
 * 68 and the block is at 75" is learning how to stay at 74.
 *
 * `reasonCode` is a short code, never a message, so it cannot echo a prompt
 * or a signed URL back through a notification channel.
 *
 * The detailed taxonomy stays in `security_events.kind` for operators. The
 * event type is `security.warning` and nothing narrower, because the envelope
 * contract admits exactly two dotted segments — widening that to fit a
 * logging vocabulary is the tail wagging the dog, and PRE-11 repaired exactly
 * that class of drift.
 */
const SECURITY_WARNING: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reasonCode", "severity"],
  properties: {
    reasonCode: { type: "string", pattern: "^[a-z][a-z0-9_]{1,64}$" },
    severity: { type: "string", enum: ["info", "low", "medium", "high"] },
  },
};

const REGISTERED: RegisteredSchema[] = [
  { schemaName: "cinefield.generation.created", eventType: "generation.created", eventVersion: 1, payload: GENERATION_CREATED },
  { schemaName: "cinefield.generation.processing", eventType: "generation.processing", eventVersion: 1, payload: GENERATION_PROCESSING },
  { schemaName: "cinefield.generation.completed", eventType: "generation.completed", eventVersion: 1, payload: GENERATION_COMPLETED },
  { schemaName: "cinefield.generation.failed", eventType: "generation.failed", eventVersion: 1, payload: GENERATION_FAILED },
  { schemaName: "cinefield.generation.cancelled", eventType: "generation.cancelled", eventVersion: 1, payload: GENERATION_CANCELLED },
  { schemaName: "cinefield.provider.submitted", eventType: "provider.submitted", eventVersion: 1, payload: PROVIDER_SUBMITTED },
  { schemaName: "cinefield.provider.failed", eventType: "provider.failed", eventVersion: 1, payload: PROVIDER_FAILED },
  { schemaName: "cinefield.credit.reserved", eventType: "credit.reserved", eventVersion: 1, payload: CREDIT_RESERVED },
  { schemaName: "cinefield.credit.settled", eventType: "credit.settled", eventVersion: 1, payload: CREDIT_SETTLED },
  { schemaName: "cinefield.credit.refunded", eventType: "credit.refunded", eventVersion: 1, payload: CREDIT_REFUNDED },
  { schemaName: "cinefield.asset.released", eventType: "asset.released", eventVersion: 1, payload: ASSET_RELEASED },
  { schemaName: "cinefield.asset.rejected", eventType: "asset.rejected", eventVersion: 1, payload: ASSET_REJECTED },
  { schemaName: "cinefield.security.warning", eventType: "security.warning", eventVersion: 1, payload: SECURITY_WARNING },
];

export function schemaKey(eventType: string, eventVersion: number): SchemaKey {
  return `${eventType}@${eventVersion}`;
}

/**
 * Built once, at module load, with every schema structurally compiled. A
 * malformed or under-enforcing schema therefore fails the process (and the
 * test run, and the build that imports it) instead of quietly admitting
 * unvalidated events at runtime.
 */
export const EVENT_SCHEMAS: ReadonlyMap<SchemaKey, RegisteredSchema> = (() => {
  const map = new Map<SchemaKey, RegisteredSchema>();
  for (const entry of REGISTERED) {
    compileSchema(entry.payload, `#/${entry.schemaName}`);
    const key = schemaKey(entry.eventType, entry.eventVersion);
    if (map.has(key)) {
      throw new Error(`event-schemas: duplicate registration for ${key}`);
    }
    map.set(key, entry);
  }
  return map;
})();

/** Every version registered for an event type, ascending. Empty when unknown. */
export function versionsOf(eventType: string): number[] {
  return [...EVENT_SCHEMAS.values()]
    .filter((s) => s.eventType === eventType)
    .map((s) => s.eventVersion)
    .sort((a, b) => a - b);
}
