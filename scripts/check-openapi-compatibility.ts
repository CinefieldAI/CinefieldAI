import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classifyCompatibility } from "@/lib/events/schema-registry";
import type { JsonSchema } from "@/lib/events/json-schema";

/**
 * Cinefield HTTP/OpenAPI breaking-change detector (Phase 20-D corrective
 * batch — "HTTP contract source-of-truth" gap the closure audit found:
 * `check-contract-compatibility.ts` only ever covered Kafka event schemas).
 *
 * ---------------------------------------------------------------------------
 * A NARROW STRUCTURAL CHECKER, NOT A GENERIC OPENAPI DIFF ENGINE
 * ---------------------------------------------------------------------------
 * Cinefield's `openapi/cinefield.json` only ever uses the OpenAPI subset
 * `scripts/generate-openapi.ts` actually emits: `paths[path][method]` with
 * inline (never `$ref`'d) `requestBody.content["application/json"].schema`
 * and `responses[status].content["application/json"].schema`, plus
 * `components.schemas`. This checker understands exactly that subset — it
 * does not attempt to resolve `$ref`, `allOf`, or any construct Cinefield's
 * own `JsonSchema` type (json-schema.ts) does not support either.
 *
 * ---------------------------------------------------------------------------
 * REUSES classifyCompatibility — NO SECOND COMPATIBILITY RULE
 * ---------------------------------------------------------------------------
 * Every request/response schema comparison below calls the SAME
 * `classifyCompatibility()` `check-contract-compatibility.ts` already uses
 * for event payloads. Its rule is deliberately conservative (anything not
 * provably safe is reported breaking) — applied here in BOTH directions:
 *
 *   REQUEST body: `classifyCompatibility(baseRequest, currentRequest)`.
 *   A field becoming required, being removed, narrowing, etc. is breaking
 *   for a CALLER who built its request against the base shape — an old
 *   caller may now be rejected.
 *
 *   RESPONSE body: `classifyCompatibility(baseResponse, currentResponse)`.
 *   A field being removed, narrowing, or type-changing is breaking for a
 *   CONSUMER who built its parsing against the base shape — it may now read
 *   `undefined` or crash. This checker also flags an optional response
 *   field becoming required as breaking (classifyCompatibility's own rule),
 *   which is stricter than the narrow "required field removed" case the
 *   corrective brief names — a deliberate, disclosed choice to keep exactly
 *   ONE compatibility rule rather than a second, subtly different one for
 *   responses. A version bump costs a reviewer's attention; a silently
 *   accepted response-shape narrowing costs a production incident.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS COMPATIBLE (never flagged)
 * ---------------------------------------------------------------------------
 * A new path. A new method on an existing path. A new `components.schemas`
 * entry. An optional field added to a request or response (classifyCompatibility
 * itself already treats this as compatible). Enum widening. None of these
 * appear in a base-ref path/method/schema set that no longer exists in the
 * current one, which is the only shape this checker's removal/narrowing
 * logic can ever flag.
 */

const ROOT = process.cwd();
const OPENAPI_REL = "openapi/cinefield.json";

interface OpenApiOperation {
  requestBody?: { content?: { ["application/json"]?: { schema?: JsonSchema } } };
  responses?: Record<string, { content?: { ["application/json"]?: { schema?: JsonSchema } } }>;
}
type OpenApiPaths = Record<string, Record<string, OpenApiOperation>>;
interface OpenApiDocument {
  paths: OpenApiPaths;
  components: { schemas: Record<string, JsonSchema> };
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);

function baseRef(): string {
  return process.env.CONTRACT_BASE_REF ?? process.argv[2] ?? "origin/main";
}

function gitShow(ref: string, relPath: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${relPath}`], { cwd: ROOT, encoding: "utf8" });
  } catch {
    return null;
  }
}

function requestSchema(op: OpenApiOperation): JsonSchema | undefined {
  return op.requestBody?.content?.["application/json"]?.schema;
}

function responseSchemas(op: OpenApiOperation): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const [status, response] of Object.entries(op.responses ?? {})) {
    const schema = response.content?.["application/json"]?.schema;
    if (schema) out[status] = schema;
  }
  return out;
}

function main(): void {
  const ref = baseRef();
  const baseRaw = gitShow(ref, OPENAPI_REL);
  if (baseRaw === null) {
    // NOT_CONFIGURED, never a silent pass — a caller (human or CI) must be
    // able to tell "nothing was compared" apart from "compared and clean".
    // In CI this branch should be unreachable (fetch-depth: 0 guarantees a
    // real base ref); reaching it there is itself worth failing loudly on.
    console.error(
      `contracts:check-openapi-compat: NOT_CONFIGURED — base ref "${ref}" or ${OPENAPI_REL} is unavailable there (first change, shallow checkout, or offline). No comparison was made.`
    );
    process.exit(2);
  }

  const base: OpenApiDocument = JSON.parse(baseRaw);
  const current: OpenApiDocument = JSON.parse(readFileSync(path.join(ROOT, OPENAPI_REL), "utf8"));

  const findings: string[] = [];

  for (const [routePath, baseMethods] of Object.entries(base.paths ?? {})) {
    const currentMethods = current.paths?.[routePath];
    if (!currentMethods) {
      findings.push(`PATH_REMOVED: ${routePath}`);
      continue;
    }
    for (const [method, baseOp] of Object.entries(baseMethods)) {
      if (!HTTP_METHODS.has(method)) continue;
      const currentOp = currentMethods[method];
      if (!currentOp) {
        findings.push(`METHOD_REMOVED: ${method.toUpperCase()} ${routePath}`);
        continue;
      }

      const baseRequest = requestSchema(baseOp);
      const currentRequest = requestSchema(currentOp);
      if (baseRequest) {
        if (!currentRequest) {
          findings.push(`REQUEST_BODY_REMOVED: ${method.toUpperCase()} ${routePath}`);
        } else if (JSON.stringify(baseRequest) !== JSON.stringify(currentRequest)) {
          const verdict = classifyCompatibility(baseRequest, currentRequest);
          if (!verdict.compatible) {
            findings.push(`REQUEST_NARROWED: ${method.toUpperCase()} ${routePath} — ${(verdict.breaks ?? []).join(", ")}`);
          }
        }
      }

      const baseResponses = responseSchemas(baseOp);
      const currentResponses = responseSchemas(currentOp);
      for (const [status, baseResponseSchema] of Object.entries(baseResponses)) {
        const currentResponseSchema = currentResponses[status];
        if (!currentResponseSchema) {
          findings.push(`RESPONSE_REMOVED: ${method.toUpperCase()} ${routePath} [${status}]`);
          continue;
        }
        if (JSON.stringify(baseResponseSchema) === JSON.stringify(currentResponseSchema)) continue;
        const verdict = classifyCompatibility(baseResponseSchema, currentResponseSchema);
        if (!verdict.compatible) {
          findings.push(`RESPONSE_NARROWED: ${method.toUpperCase()} ${routePath} [${status}] — ${(verdict.breaks ?? []).join(", ")}`);
        }
      }
    }
  }

  // A components.schemas entry disappearing outright — conservative and
  // unconditional (no $ref graph is resolved to check whether a governed
  // path still uses it; per this file's own header, that is deliberately
  // out of scope for a narrow checker).
  for (const name of Object.keys(base.components?.schemas ?? {})) {
    if (!(name in (current.components?.schemas ?? {}))) {
      findings.push(`SCHEMA_REMOVED: ${name}`);
    }
  }

  console.log(
    `contracts:check-openapi-compat: compared ${Object.keys(base.paths ?? {}).length} base path(s) against ${ref}.`
  );

  if (findings.length > 0) {
    console.error("contracts:check-openapi-compat: BREAKING HTTP CONTRACT CHANGE(S) DETECTED:");
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }

  console.log("contracts:check-openapi-compat: no breaking HTTP contract change found.");
}

main();
