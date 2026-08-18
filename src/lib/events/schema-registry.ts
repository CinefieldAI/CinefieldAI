import { validateAgainstSchema, type JsonSchema } from "./json-schema";
import { EVENT_SCHEMAS, schemaKey, versionsOf, type RegisteredSchema } from "./event-schemas";
import type { DomainEventEnvelope } from "./domain-event";

/**
 * Cinefield event schema governance (Phase 6R.15).
 *
 * Pure resolution + validation over the local registry. No network, no AWS,
 * no I/O — deliberately, so the producer's pre-send check costs nothing and
 * cannot fail for an infrastructural reason. Distribution to consumers
 * outside this repository is Glue's job (glue-schema-registry.ts) and is a
 * separate, currently unprovisioned concern.
 *
 * COMPATIBILITY POLICY — WRITTEN DOWN AND TESTED, NOT ASSUMED
 * Consumers are at-least-once and may lag arbitrarily, so an old consumer
 * will meet a new producer. The rule Cinefield follows is BACKWARD
 * compatibility within a major `eventVersion`:
 *
 *   ALLOWED inside a version (a consumer written for the old shape still
 *   works):
 *     - adding an OPTIONAL property
 *     - widening an enum's permitted values
 *     - relaxing a bound (lower `minimum`, higher `maxLength`, ...)
 *
 *   REQUIRES A VERSION BUMP (an old consumer would break or misread):
 *     - adding a REQUIRED property
 *     - removing or renaming any property
 *     - changing a property's type
 *     - narrowing an enum or tightening a bound
 *     - making an optional property required
 *
 * `classifyCompatibility` implements exactly that, and the registry's own
 * schemas are checked against it in the contract tests. Nothing here
 * auto-migrates or coerces an event into a shape it does not have — a
 * mismatch is a refusal, because silently reinterpreting a fact is how two
 * consumers end up disagreeing about history.
 */

export type SchemaResolution =
  | { ok: true; schema: RegisteredSchema }
  | { ok: false; reason: "unknown_event_type" | "unknown_event_version"; knownVersions: number[] };

/** Resolves one registered schema. Never guesses a nearby version. */
export function resolveSchema(eventType: string, eventVersion: number): SchemaResolution {
  const found = EVENT_SCHEMAS.get(schemaKey(eventType, eventVersion));
  if (found) return { ok: true, schema: found };

  const knownVersions = versionsOf(eventType);
  return {
    ok: false,
    // An unknown TYPE and a known type at an unknown VERSION are different
    // operational problems: the first is an unregistered event, the second
    // is a deploy-order mismatch. Collapsing them would hide which.
    reason: knownVersions.length === 0 ? "unknown_event_type" : "unknown_event_version",
    knownVersions,
  };
}

export type EventValidation =
  | { ok: true; schemaName: string }
  | {
      ok: false;
      reason: "unknown_event_type" | "unknown_event_version" | "payload_schema_violation" | "malformed_envelope";
      /** Field LOCATIONS only — never values, so this is safe to log. */
      errors: string[];
    };

/**
 * Envelope fields every event must carry regardless of its payload schema.
 * Exported (Phase 20) so `scripts/generate-openapi.ts` can reuse this exact
 * shape as the OpenAPI `DomainEventEnvelope` schema rather than declaring a
 * second, driftable copy — the envelope has exactly one definition.
 */
export const ENVELOPE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["eventId", "eventType", "eventVersion", "aggregateType", "aggregateId", "occurredAt", "payload"],
  properties: {
    eventId: { type: "string", format: "uuid" },
    eventType: { type: "string", pattern: "^[a-z][a-z0-9-]*\\.[a-z][a-z0-9-]*$" },
    eventVersion: { type: "integer", minimum: 1 },
    aggregateType: { type: "string", minLength: 1, maxLength: 200 },
    aggregateId: { type: "string", minLength: 1, maxLength: 200 },
    occurredAt: { type: "string", format: "date-time" },
    traceId: { type: "string", minLength: 1, maxLength: 200 },
    // Validated separately against the resolved payload schema.
    payload: { type: "object", additionalProperties: false },
  },
};

/**
 * The one function every producer and consumer calls. Validates the envelope
 * first (a malformed envelope has no resolvable schema), then the payload
 * against the resolved contract.
 */
export function validateDomainEvent(candidate: unknown): EventValidation {
  const envelopeErrors = validateAgainstSchema(candidate, {
    ...ENVELOPE_SCHEMA,
    // The payload's own shape is the resolved schema's business; here only
    // its presence and objectness matter.
    properties: { ...ENVELOPE_SCHEMA.properties, payload: { type: "object" } },
  });
  if (envelopeErrors.length > 0) {
    return { ok: false, reason: "malformed_envelope", errors: envelopeErrors };
  }

  const event = candidate as DomainEventEnvelope;
  const resolved = resolveSchema(event.eventType, event.eventVersion);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      errors: [`${event.eventType}@${event.eventVersion}: not registered`],
    };
  }

  const payloadErrors = validateAgainstSchema(event.payload, resolved.schema.payload, "/payload");
  if (payloadErrors.length > 0) {
    return { ok: false, reason: "payload_schema_violation", errors: payloadErrors };
  }

  return { ok: true, schemaName: resolved.schema.schemaName };
}

// ---------------------------------------------------------------------------
// Compatibility classification
// ---------------------------------------------------------------------------

export type CompatibilityVerdict = { compatible: true } | { compatible: false; breaks: string[] };

function typesOf(schema: JsonSchema): string[] {
  if (schema.type === undefined) return [];
  return (Array.isArray(schema.type) ? schema.type : [schema.type]).slice().sort();
}

/**
 * Decides whether `next` may replace `previous` WITHOUT a version bump,
 * under the backward-compatibility rule documented above.
 *
 * Deliberately conservative: anything this function cannot prove is safe is
 * reported as breaking. A false "breaking" costs a version bump; a false
 * "compatible" silently breaks every lagging consumer.
 */
export function classifyCompatibility(previous: JsonSchema, next: JsonSchema): CompatibilityVerdict {
  const breaks: string[] = [];

  const previousProps = previous.properties ?? {};
  const nextProps = next.properties ?? {};
  const previousRequired = new Set(previous.required ?? []);
  const nextRequired = new Set(next.required ?? []);

  for (const name of Object.keys(previousProps)) {
    if (!(name in nextProps)) {
      breaks.push(`${name}: removed`);
      continue;
    }
    const before = previousProps[name];
    const after = nextProps[name];

    const beforeTypes = typesOf(before);
    const afterTypes = typesOf(after);
    if (beforeTypes.join("|") !== afterTypes.join("|")) {
      breaks.push(`${name}: type changed`);
    }
    if (before.enum && after.enum && before.enum.some((v) => !after.enum!.includes(v))) {
      breaks.push(`${name}: enum narrowed`);
    }
    if (before.enum && !after.enum) {
      // Widening from an enum to a free value is fine for a consumer that
      // only reads it, but not for one that switches exhaustively on it.
      breaks.push(`${name}: enum constraint removed`);
    }
    if (!before.enum && after.enum) breaks.push(`${name}: enum constraint added`);
    if ((after.minimum ?? -Infinity) > (before.minimum ?? -Infinity)) breaks.push(`${name}: minimum raised`);
    if ((after.maximum ?? Infinity) < (before.maximum ?? Infinity)) breaks.push(`${name}: maximum lowered`);
    if ((after.minLength ?? 0) > (before.minLength ?? 0)) breaks.push(`${name}: minLength raised`);
    if ((after.maxLength ?? Infinity) < (before.maxLength ?? Infinity)) breaks.push(`${name}: maxLength lowered`);
    if (before.pattern !== after.pattern) breaks.push(`${name}: pattern changed`);
    if (!previousRequired.has(name) && nextRequired.has(name)) {
      breaks.push(`${name}: became required`);
    }
  }

  for (const name of nextRequired) {
    if (!previousRequired.has(name) && !(name in previousProps)) {
      breaks.push(`${name}: new required property`);
    }
  }

  return breaks.length === 0 ? { compatible: true } : { compatible: false, breaks };
}
