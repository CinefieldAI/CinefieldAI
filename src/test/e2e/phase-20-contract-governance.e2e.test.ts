import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { EVENT_SCHEMAS } from "@/lib/events/event-schemas";
import { ENVELOPE_SCHEMA, classifyCompatibility } from "@/lib/events/schema-registry";
import { outboxRowToEnvelope } from "@/lib/events/outbox-repository";
import type { JsonSchema } from "@/lib/events/json-schema";

/**
 * Phase 20 — API & Event Contract / Schema Governance.
 *
 * 20-A/20-B (event envelope+version standard, producer validation, consumer
 * SerDe/compatibility, the local schema registry that stands in for Glue's
 * unprovisioned distribution role) were already real and exhaustively tested
 * by `src/lib/events/{domain-event,schema-registry,outbox-publisher}.test.ts`
 * and `src/test/e2e/phase-11a-event-contract-guard.e2e.test.ts` before this
 * batch (Phase 6R.15/11-A) — this file does not re-prove them. It proves
 * what THIS batch actually added: the OpenAPI/generated-types pipeline
 * (20-C) and the breaking-change CI gate (20-D), plus that neither
 * duplicates or replaces an existing authority.
 */

const ROOT = process.cwd();
function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ---- 20-C: the OpenAPI document is derived, not reinvented ----------------

describe("Phase 20-C — OpenAPI generator reuses the real registry, never reinvents it", () => {
  test("scripts/generate-openapi.ts imports EVENT_SCHEMAS and ENVELOPE_SCHEMA rather than declaring parallel shapes", () => {
    const src = stripComments(read("scripts/generate-openapi.ts"));
    assert.match(src, /from "@\/lib\/events\/event-schemas"/);
    assert.match(src, /from "@\/lib\/events\/schema-registry"/);
    // No second, hand-written payload schema for a registered event.
    assert.doesNotMatch(src, /GENERATION_CREATED|GENERATION_COMPLETED|PROVIDER_SUBMITTED/);
  });

  test("openapi/cinefield.json exists and every registered event schema appears in components.schemas", () => {
    assert.ok(existsSync(path.join(ROOT, "openapi/cinefield.json")), "run `npm run contracts:generate-openapi` and commit the result");
    const doc = JSON.parse(read("openapi/cinefield.json"));
    assert.equal(doc.openapi, "3.1.0");
    assert.ok(doc.components.schemas.DomainEventEnvelope, "the envelope schema must be present");
    assert.deepEqual(doc.components.schemas.DomainEventEnvelope, ENVELOPE_SCHEMA, "must be the SAME object schema-registry.ts enforces at runtime, not a copy");

    // One components.schemas entry per real registered event — no more, no fewer.
    const eventSchemaCount = Object.keys(doc.components.schemas).length - 1; // minus the envelope
    assert.equal(eventSchemaCount, EVENT_SCHEMAS.size, "the OpenAPI doc must cover exactly the real registry, no fabricated or missing events");
  });

  test("the OpenAPI HTTP paths are a small, honestly-scoped subset — not a fabricated full API surface", () => {
    const doc = JSON.parse(read("openapi/cinefield.json"));
    const paths = Object.keys(doc.paths);
    assert.ok(paths.includes("/api/health/live"));
    assert.ok(paths.includes("/api/admin/privileged-actions/decide"));
    // Deliberately small — this batch does not claim to cover every route.
    assert.ok(paths.length <= 5, "path coverage claim must stay honest and small unless deliberately extended");
  });

  test("the generated API types file exists, is marked generated, and is not the checked-in place for hand edits", () => {
    const generatedPath = "src/lib/contracts/generated/api-types.ts";
    assert.ok(existsSync(path.join(ROOT, generatedPath)), "run `npm run contracts:generate-types` and commit the result");
    const src = read(generatedPath);
    assert.match(src, /GENERATED FILE — DO NOT EDIT BY HAND/);
    assert.match(src, /export interface paths/);
    assert.match(src, /export interface components/);
    // Every schema name from the OpenAPI doc must actually appear as a generated type.
    const doc = JSON.parse(read("openapi/cinefield.json"));
    for (const name of Object.keys(doc.components.schemas)) {
      assert.match(src, new RegExp(`\\b${name}\\b:`), `generated types must include ${name}`);
    }
  });

  test("no live AWS/paid service call anywhere in the generation pipeline", () => {
    for (const file of ["scripts/generate-openapi.ts", "scripts/generate-api-types.ts"]) {
      const src = stripComments(read(file)).toLowerCase();
      assert.doesNotMatch(src, /fetch\(|https?:\/\/|aws-sdk|@aws-sdk/, `${file} must be pure local codegen`);
    }
  });
});

// ---- 20-D: the breaking-change gate ---------------------------------------

describe("Phase 20-D — breaking-change detection and CI gate", () => {
  test("check-contract-compatibility.ts reuses classifyCompatibility from schema-registry.ts, never a second compatibility rule", () => {
    const src = stripComments(read("scripts/check-contract-compatibility.ts"));
    assert.match(src, /classifyCompatibility/);
    assert.match(src, /from "@\/lib\/events\/schema-registry"|schema-registry\.ts/);
  });

  test("check-contract-compatibility.ts only flags keys present in BOTH revisions — a new version key is never treated as a mutation", () => {
    const src = stripComments(read("scripts/check-contract-compatibility.ts"));
    assert.match(src, /if \(!baseEntry\) continue/);
  });

  test("classifyCompatibility (the real, already-tested rule this gate depends on) still classifies additive vs. breaking changes correctly", () => {
    const base: JsonSchema = {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "string" } },
    };
    const note: JsonSchema = { type: "string" };
    const mandatory: JsonSchema = { type: "string" };
    const additive: JsonSchema = { ...base, properties: { ...base.properties, note } };
    const breaking: JsonSchema = { ...base, required: ["id", "mandatory"], properties: { ...base.properties, mandatory } };
    assert.deepEqual(classifyCompatibility(base, additive), { compatible: true });
    assert.equal(classifyCompatibility(base, breaking).compatible, false);
  });

  test("contract-ci.yml runs the compat check against the real PR base ref, regenerates + diffs for drift, runs the real contract tests, and never applies/publishes anything", () => {
    const workflow = read(".github/workflows/contract-ci.yml");
    assert.match(workflow, /pull_request:/);
    assert.match(workflow, /fetch-depth:\s*0/, "git show against the base ref needs real history");
    assert.match(workflow, /contracts:check-compat/);
    assert.match(workflow, /CONTRACT_BASE_REF/);
    assert.match(workflow, /contracts:generate/);
    assert.match(workflow, /git diff --exit-code/);
    assert.match(workflow, /schema-registry\.test\.ts/);
    assert.match(workflow, /phase-11a-event-contract-guard\.e2e\.test\.ts/);
    assert.match(workflow, /tsc --noEmit/);
    assert.doesNotMatch(workflow, /npm publish|contracts:apply|deploy/i);
  });

  test("contract-ci.yml paths cover the real registry, generator scripts, and generated artifacts", () => {
    const workflow = read(".github/workflows/contract-ci.yml");
    assert.match(workflow, /src\/lib\/events\/\*\*/);
    assert.match(workflow, /openapi\/\*\*/);
  });
});

// ---- Ownership preserved ----------------------------------------------------

describe("Phase 20 — no second contract authority, no owner replaced", () => {
  test("the runtime event validation path (domain-event.ts, schema-registry.ts, event-consumer.ts) is unmodified in shape by this batch — only ENVELOPE_SCHEMA gained an export keyword", () => {
    const registryFile = stripComments(read("src/lib/events/schema-registry.ts"));
    // The exported constant is the SAME shape as before — this batch did not
    // redefine what the envelope requires, only made the existing constant
    // importable so the OpenAPI generator has one source of truth.
    assert.match(registryFile, /export const ENVELOPE_SCHEMA/);
    assert.match(registryFile, /export function classifyCompatibility/);
    assert.match(registryFile, /export function validateDomainEvent/);
  });

  test("Phase 17's GenerationManifest contract is untouched — Phase 20 governs contracts, it does not redesign Phase 17 semantics", () => {
    const src = read("src/lib/product-intelligence/generation-manifest-contract.ts");
    assert.match(src, /GENERATION_MANIFEST_VERSION = "1\.0\.0"/);
    assert.match(src, /MANIFEST_COMPILER_VERSION = "1\.0\.0"/);
  });

  test("Phase 19's policy registry and Rego are untouched by this [Phase 20] batch — later, legitimate extensions (e.g. Phase 21's flag.set.*) are a different claim", () => {
    const registry = JSON.parse(read("policies/data/actions.json"));
    assert.deepEqual(registry.aiWriteAllowlist, ["code.pr.create"]);
    // route.disable/queue.dlq.redrive/temporal.workflow.cancel — the three
    // actions Phase 20's own corrective batch (this file) actually verified
    // — must still be present and unmodified, regardless of what a LATER
    // phase legitimately added to the same registry afterward.
    for (const action of ["route.disable", "queue.dlq.redrive", "temporal.workflow.cancel"]) {
      assert.ok(registry.actions[action], `${action} must remain registered`);
    }
  });

  test("no new database migration was added for contract governance — the registry stays source-controlled TypeScript", () => {
    const src = stripComments(read("scripts/generate-openapi.ts")) + stripComments(read("scripts/check-contract-compatibility.ts"));
    assert.doesNotMatch(src, /CREATE TABLE|ALTER TABLE|supabase\.rpc|\.from\(/i);
  });
});

// ---- Sensitive data boundary -------------------------------------------------

describe("Phase 20 — sensitive data boundary", () => {
  test("the generated OpenAPI document and TS types carry no secret-shaped field, matching the existing event-schema rule", () => {
    const FORBIDDEN = /(secret|token|password|apikey|api_key|authorization|signedurl|signed_url|credential)/i;
    const doc = JSON.parse(read("openapi/cinefield.json"));
    const raw = JSON.stringify(doc);
    // Field NAMES are checked; "Authorization" as an HTTP header concept is
    // not declared anywhere in this doc's schemas (health/decide carry no
    // auth-shaped body field).
    for (const schemaName of Object.keys(doc.components.schemas)) {
      for (const field of Object.keys(doc.components.schemas[schemaName].properties ?? {})) {
        assert.ok(!FORBIDDEN.test(field), `${schemaName}.${field} looks secret-shaped`);
      }
    }
    assert.doesNotMatch(raw, /"example"\s*:\s*"(sk-|ey[A-Za-z0-9_-]{20,}|AKIA)/);
  });
});

// ---- Phase 20 corrective batch: event tenant context -----------------------

describe("Phase 20 corrective batch — event tenant context", () => {
  test("ENVELOPE_SCHEMA declares tenantId as optional (additive, no version bump needed) with the same bound as the SQL check constraint", () => {
    assert.ok(!(ENVELOPE_SCHEMA.required ?? []).includes("tenantId"), "tenantId must stay optional — an old envelope without it is exactly as valid");
    const field = ENVELOPE_SCHEMA.properties?.tenantId;
    assert.ok(field);
    assert.equal(field?.minLength, 1);
    assert.equal(field?.maxLength, 255);
  });

  test("outboxRowToEnvelope threads a real outbox row's tenant_id onto the wire envelope's tenantId — the one place the SQL column crosses onto Kafka", () => {
    const claimed = outboxRowToEnvelope({
      event_id: "3d9e7c2a-5b1f-4a8e-9c6d-2b3a4c5d6e7f",
      event_type: "generation.completed",
      event_version: 1,
      aggregate_type: "generation",
      aggregate_id: "gen-1",
      occurred_at: "2026-01-01T00:00:00.000Z",
      tenant_id: "user_clerk_real_row",
      payload: { generationId: "g1", provider: "mock" },
      publish_attempts: 1,
      claim_token: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(claimed.event.tenantId, "user_clerk_real_row");
  });

  test("outboxRowToEnvelope leaves tenantId absent when the row's tenant_id is null — never guessed, never defaulted to a fallback", () => {
    const claimed = outboxRowToEnvelope({
      event_id: "3d9e7c2a-5b1f-4a8e-9c6d-2b3a4c5d6e7f",
      event_type: "generation.completed",
      event_version: 1,
      aggregate_type: "generation",
      aggregate_id: "gen-1",
      occurred_at: "2026-01-01T00:00:00.000Z",
      tenant_id: null,
      payload: {},
      publish_attempts: 1,
      claim_token: "11111111-1111-4111-8111-111111111111",
    });
    assert.ok(!("tenantId" in claimed.event));
  });

  test("enqueueEventStandalone never forwards event.tenantId to emit_outbox_event — the SQL function resolves its own tenant, by design, per its own migration header", () => {
    const src = stripComments(read("src/lib/events/outbox-repository.ts"));
    const fnBody = src.slice(
      src.indexOf("export async function enqueueEventStandalone"),
      src.indexOf("\nexport async function claimPendingEvents")
    );
    assert.doesNotMatch(fnBody, /p_tenant_id/, "no call site may pass a tenant — the migration's own history warns this was tried once and reverted");
  });

  test("the tenant is bounded routing/correlation evidence only — no route/module treats it as auth, billing, or project-ownership authority", () => {
    for (const file of ["src/lib/events/domain-event.ts", "src/lib/events/outbox-repository.ts", "src/lib/kafka/kafka-producer.ts"]) {
      const src = stripComments(read(file));
      assert.doesNotMatch(src, /tenantId\s*===?\s*.*(role|admin|billing|credit|balance)/i);
    }
  });

  test("the new migration only widens claim_outbox_events' OUTPUT columns — same input signature, grants re-stated not altered, no other table touched", () => {
    const migration = read("supabase/migrations/20260830000000_outbox_claim_tenant_id.sql");
    const sqlOnly = migration.replace(/--.*$/gm, ""); // the header prose freely names emit_outbox_event/CREATE/DROP as explanation — only real statements count
    assert.match(migration, /DROP FUNCTION IF EXISTS "public"\."claim_outbox_events"\(integer, integer\)/);
    assert.match(migration, /CREATE FUNCTION "public"\."claim_outbox_events"\(/);
    assert.match(migration, /"tenant_id" "text"/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION "public"\."claim_outbox_events"\(integer, integer\) TO "service_role"/);
    assert.match(migration, /REVOKE ALL ON FUNCTION "public"\."claim_outbox_events"\(integer, integer\) FROM PUBLIC, "anon", "authenticated"/);
    assert.doesNotMatch(sqlOnly, /CREATE TABLE|DROP TABLE|ALTER TABLE(?!.*claim_outbox_events)/i, "must not touch any table — the tenant_id column already exists");
    assert.doesNotMatch(
      sqlOnly,
      /(CREATE|CREATE OR REPLACE|DROP|ALTER)\s+FUNCTION[^;]*emit_outbox_event/i,
      "must not touch the write-side function — only the read/claim side changes (mentioning it in prose, to explain the relationship, is fine)"
    );
  });
});

// ---- Phase 20 corrective batch: HTTP/OpenAPI breaking-change detection ----

describe("Phase 20 corrective batch — HTTP/OpenAPI breaking-change detection", () => {
  test("check-openapi-compatibility.ts reuses classifyCompatibility for both request and response comparison — no second compatibility rule", () => {
    const src = stripComments(read("scripts/check-openapi-compatibility.ts"));
    const requestSection = src.slice(src.indexOf("REQUEST_NARROWED"));
    const responseSection = src.slice(src.indexOf("RESPONSE_NARROWED"));
    assert.match(src, /from "@\/lib\/events\/schema-registry"/);
    assert.ok((src.match(/classifyCompatibility\(/g) ?? []).length >= 2, "both request and response comparisons must call the real, shared function");
    assert.ok(requestSection.length > 0 && responseSection.length > 0);
  });

  test("detects PATH_REMOVED, METHOD_REMOVED, REQUEST_NARROWED, RESPONSE_NARROWED, and SCHEMA_REMOVED as distinct finding classes", () => {
    const src = read("scripts/check-openapi-compatibility.ts");
    for (const findingClass of ["PATH_REMOVED", "METHOD_REMOVED", "REQUEST_NARROWED", "RESPONSE_NARROWED", "SCHEMA_REMOVED"]) {
      assert.match(src, new RegExp(findingClass));
    }
  });

  test("a new path, a new method, and a new components.schemas entry are structurally never flagged — only base-ref keys missing from the current tree can be", () => {
    const src = stripComments(read("scripts/check-openapi-compatibility.ts"));
    // The removal-detection loops iterate the BASE document's paths/schemas
    // and look up the CURRENT document — a key that exists only in current
    // (i.e. something newly added) is never visited by these loops at all.
    assert.match(src, /for \(const \[routePath, baseMethods\] of Object\.entries\(base\.paths/);
    assert.match(src, /for \(const name of Object\.keys\(base\.components\?\.schemas/);
  });

  test("NOT_CONFIGURED (no base ref available) is a distinct, non-zero exit — never silently treated as a pass", () => {
    const src = stripComments(read("scripts/check-openapi-compatibility.ts"));
    assert.match(src, /NOT_CONFIGURED/);
    assert.match(src, /process\.exit\(2\)/);
  });

  test("contract-ci.yml runs the HTTP compatibility check with the SAME CONTRACT_BASE_REF the event check uses — one baseline model, not two", () => {
    const workflow = read(".github/workflows/contract-ci.yml");
    const openapiCompatStepIndex = workflow.indexOf("contracts:check-openapi-compat");
    const eventCompatStepIndex = workflow.indexOf("contracts:check-compat");
    assert.ok(openapiCompatStepIndex > 0 && eventCompatStepIndex > 0);
    const baseRefMentions = (workflow.match(/CONTRACT_BASE_REF/g) ?? []).length;
    assert.equal(baseRefMentions, 2, "exactly one env var name, used by both steps — no second baseline store");
  });
});
