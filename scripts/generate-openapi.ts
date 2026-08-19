import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { EVENT_SCHEMAS, type RegisteredSchema } from "@/lib/events/event-schemas";
import { ENVELOPE_SCHEMA } from "@/lib/events/schema-registry";
import type { JsonSchema } from "@/lib/events/json-schema";

/**
 * Cinefield OpenAPI contract generator (Phase 20-C).
 *
 * ---------------------------------------------------------------------------
 * SCHEMAS ARE REUSED, NEVER RE-DECLARED
 * ---------------------------------------------------------------------------
 * `components.schemas` for the domain event envelope and every registered
 * event payload are DERIVED from `src/lib/events/event-schemas.ts` and
 * `schema-registry.ts`'s `ENVELOPE_SCHEMA` — the same source
 * `validateDomainEvent`/`inspectInboundEvent` actually enforce at runtime.
 * This file never invents a second, parallel description of an event shape:
 * editing `event-schemas.ts` and re-running `npm run contracts:generate` is
 * the only way an event's OpenAPI representation changes.
 *
 * Cinefield's internal `JsonSchema` (json-schema.ts) is a strict SUBSET of
 * OpenAPI 3.1's schema object (which is itself JSON Schema 2020-12) — every
 * keyword it supports (type, const, enum, properties, required,
 * additionalProperties, items, minimum, maximum, minLength, maxLength,
 * pattern, format, description) is valid, unmodified, in OpenAPI 3.1,
 * including `type` as an array (e.g. `["string", "null"]`). So this
 * generator does not "convert" schemas — it copies them as-is into
 * `components.schemas` and only adds an OpenAPI wrapper around them.
 *
 * ---------------------------------------------------------------------------
 * HTTP PATHS — REAL ROUTES ONLY, HONESTLY PARTIAL
 * ---------------------------------------------------------------------------
 * `HTTP_PATHS` below is hand-maintained and covers two real, already-shipped
 * routes chosen for contract stability (`GET /api/health/live`,
 * `POST /api/admin/privileged-actions/decide`) — every field matches the
 * actual TypeScript response/request types those routes already return
 * (`LivenessReport`, `PrivilegedActionDecisionRequest`/
 * `PrivilegedActionDecisionResult`). This is NOT full API coverage: Cinefield
 * has ~40 HTTP routes and this batch does not fabricate specs for the ones
 * it did not verify field-by-field against real code. Extending coverage is
 * additive, incremental, future work — see docs/security-gates.md's Phase 20
 * section for the exact list of what is and is not covered.
 *
 * ---------------------------------------------------------------------------
 * OUTPUT IS DETERMINISTIC
 * ---------------------------------------------------------------------------
 * Object keys are inserted in a fixed order (registry iteration order is
 * already stable — a `Map`, insertion-ordered) and the file is written with
 * a trailing newline and 2-space indent, so `git diff` against a re-run is
 * the drift check `contract-ci.yml` relies on.
 */

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, "openapi", "cinefield.json");

function schemaComponentName(entry: RegisteredSchema): string {
  // "cinefield.generation.completed" @ 1 -> "GenerationCompletedPayloadV1"
  // "cinefield.audit.flag-changed" @ 1 -> "AuditFlagChangedPayloadV1" — a
  // hyphenated segment (EVENT_TYPE_PATTERN allows one) is split too, so the
  // result is always a bare, valid TypeScript identifier — never emitted as
  // a quoted property key.
  const parts = entry.eventType
    .split(".")
    .flatMap((seg) => seg.split("-"))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return `${parts.join("")}PayloadV${entry.eventVersion}`;
}

function buildEventSchemas(): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = { DomainEventEnvelope: ENVELOPE_SCHEMA };
  for (const entry of [...EVENT_SCHEMAS.values()].sort((a, b) => a.schemaName.localeCompare(b.schemaName))) {
    schemas[schemaComponentName(entry)] = entry.payload;
  }
  return schemas;
}

/**
 * Real, hand-verified HTTP paths. Each response/request schema is checked
 * field-by-field against the real TypeScript contract it describes — see
 * the file-level comment above for which routes and why only these two.
 */
const HTTP_PATHS = {
  "/api/health/live": {
    get: {
      operationId: "getHealthLive",
      summary: "Public liveness probe — process is answering, nothing more.",
      responses: {
        "200": {
          description: "The process is alive.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["status", "timestamp"],
                properties: {
                  status: { type: "string", const: "HEALTHY" },
                  timestamp: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
  },
  "/api/admin/privileged-actions/decide": {
    post: {
      operationId: "decidePrivilegedAction",
      summary: "A second, distinct admin approves or rejects a pending Phase 16-E two-person privileged action.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["requestId", "action", "targetType", "decision"],
              properties: {
                requestId: { type: "string", format: "uuid" },
                action: { type: "string", pattern: "^[a-z][a-z0-9_.]{1,80}$" },
                targetType: { type: "string", pattern: "^[a-z][a-z0-9_]{1,64}$" },
                targetId: { type: ["string", "null"] },
                decision: { type: "string", enum: ["approve", "reject"] },
                reasonCode: { type: ["string", "null"], pattern: "^[a-z][a-z0-9_]{1,64}$" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "The decision outcome — never the underlying action's execution result.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["outcome"],
                properties: {
                  outcome: {
                    type: "string",
                    enum: [
                      "INVALID_REQUEST",
                      "UNKNOWN_ACTION",
                      "ROLE_NOT_PERMITTED",
                      "STEP_UP_REQUIRED",
                      "SELF_APPROVAL_BLOCKED",
                      "NO_MATCHING_REQUEST",
                      "REQUEST_EXPIRED",
                      "REJECTED",
                      "APPROVAL_RECORDED",
                      "SOURCE_UNAVAILABLE",
                    ],
                  },
                  reasonCode: { type: "string" },
                  approvals: { type: "integer", minimum: 0 },
                  required: { type: "integer", minimum: 0 },
                  satisfied: { type: "boolean" },
                },
              },
            },
          },
        },
        "400": { description: "Malformed request body." },
        "404": { description: "Caller is not a console admin (opaque, matches every other Phase 16 admin route)." },
      },
    },
  },
} as const;

function buildDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Cinefield API & Event Contracts",
      version: "1.0.0",
      description:
        "Generated by scripts/generate-openapi.ts — DO NOT EDIT BY HAND. " +
        "Domain event schemas are derived from src/lib/events/event-schemas.ts " +
        "(the real runtime validation source of truth). HTTP paths are a " +
        "hand-verified, partial subset — see that script's header for scope.",
    },
    paths: HTTP_PATHS,
    components: {
      schemas: buildEventSchemas(),
    },
  };
}

function main(): void {
  const doc = buildDocument();
  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`generate-openapi: wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(`generate-openapi: ${Object.keys(doc.components.schemas).length} schemas, ${Object.keys(doc.paths).length} paths`);
}

main();
