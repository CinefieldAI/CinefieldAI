import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { extractRoutePairs } from "./check-new-route-eval-evidence";

const ROOT = process.cwd();

test("extractRoutePairs: no INSERT INTO model_routes at all is 'none', not a false positive", () => {
  const result = extractRoutePairs("CREATE TABLE foo (id uuid); COMMENT ON TABLE foo IS 'x';");
  assert.equal(result.outcome, "none");
});

test("extractRoutePairs: the real, recognized seed(...) convention is parsed correctly", () => {
  const sql = `
INSERT INTO "public"."model_routes" ("model_id", "model_version_id", "provider_model_id", "priority")
SELECT m."id", mv."id", pm."id", 100
FROM (VALUES
  ('new-model',      'fal',    'fal-ai/new-model/v1'),
  ('another-model',  'gemini', 'gemini-4-pro')
) AS seed(model_id, provider_id, provider_model_id)
JOIN "public"."models" m ON m."id" = seed.model_id
JOIN "public"."model_versions" mv ON mv."model_id" = m."id" AND mv."version" = 1
JOIN "public"."provider_models" pm
  ON pm."provider_id" = seed.provider_id AND pm."provider_model_id" = seed.provider_model_id
ON CONFLICT ("model_version_id", "provider_model_id") DO NOTHING;
`;
  const result = extractRoutePairs(sql);
  assert.equal(result.outcome, "found");
  if (result.outcome !== "found") return;
  assert.deepEqual(result.pairs, [
    { providerId: "fal", providerModelId: "fal-ai/new-model/v1" },
    { providerId: "gemini", providerModelId: "gemini-4-pro" },
  ]);
});

test("extractRoutePairs: the real committed 20260817000000_model_routing.sql migration parses cleanly end to end", () => {
  const sql = readFileSync(path.join(ROOT, "supabase/migrations/20260817000000_model_routing.sql"), "utf8");
  const result = extractRoutePairs(sql);
  assert.equal(result.outcome, "found");
  if (result.outcome !== "found") return;
  assert.ok(result.pairs.length >= 15, "the real seed migration lists at least 15 routes");
  assert.ok(
    result.pairs.some((p) => p.providerId === "fal" && p.providerModelId === "fal-ai/flux/schnell"),
    "a known real pair must be extracted correctly"
  );
});

test("extractRoutePairs: an INSERT INTO model_routes that does not use the seed(...) convention is unverifiable, never silently skipped", () => {
  const sql = `INSERT INTO "public"."model_routes" ("model_id", "model_version_id", "provider_model_id") VALUES ('x', 'uuid-1', 'uuid-2');`;
  const result = extractRoutePairs(sql);
  assert.equal(result.outcome, "unverifiable");
});

test("extractRoutePairs: an INSERT INTO model_routes with no terminating semicolon is unverifiable, not silently ignored", () => {
  const sql = `INSERT INTO "public"."model_routes" ("model_id") SELECT 1 FROM (VALUES ('a','b','c')) AS seed(model_id, provider_id, provider_model_id)`;
  const result = extractRoutePairs(sql);
  assert.equal(result.outcome, "unverifiable");
});

test("extractRoutePairs: multiple separate INSERT statements are all collected", () => {
  const block = (modelId: string, providerId: string, providerModelId: string) => `
INSERT INTO "public"."model_routes" ("model_id", "model_version_id", "provider_model_id")
SELECT m."id", mv."id", pm."id"
FROM (VALUES ('${modelId}', '${providerId}', '${providerModelId}')) AS seed(model_id, provider_id, provider_model_id)
JOIN "public"."models" m ON m."id" = seed.model_id;
`;
  const sql = block("m1", "fal", "fal-a") + block("m2", "gemini", "gemini-b");
  const result = extractRoutePairs(sql);
  assert.equal(result.outcome, "found");
  if (result.outcome !== "found") return;
  assert.equal(result.pairs.length, 2);
});


// ===========================================================================
// SECURITY_FINDINGS_9751bd11 — finding 1: no database credential in PR CI
// ===========================================================================
//
// These guards are the point of the change, so they are written to FAIL if
// the credential ever comes back — not merely to describe today's state.

test("S1-1  the gate script holds no Supabase client, no service-role read, no live query", () => {
  const src = readFileSync(path.join(ROOT, "scripts/check-new-route-eval-evidence.ts"), "utf8")
    // Comments explain WHY the credential was removed and legitimately name
    // it. Strip them so prose cannot satisfy — or trip — these assertions.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  for (const forbidden of [
    "getSupabaseAdminClient",
    "isSupabaseAdminConfigured",
    "createClient",
    "latestCompletedRun",
    "SUPABASE_SERVICE_ROLE_KEY",
    "@/lib/eval/eval-store",
    "@/lib/supabase",
  ]) {
    assert.ok(!src.includes(forbidden), `PR-CI gate must not reference ${forbidden}`);
  }

  // The only "supabase" left may be the migrations DIRECTORY in the git diff.
  const supabaseMentions = [...src.matchAll(/supabase/gi)].length;
  const migrationPathMentions = [...src.matchAll(/supabase\/migrations/g)].length;
  assert.equal(
    supabaseMentions,
    migrationPathMentions,
    "the only 'supabase' occurrence permitted is the migrations path in the git diff"
  );
});

test("S1-2  the pull_request job passes NO secrets at all", () => {
  const wf = readFileSync(path.join(ROOT, ".github/workflows/eval-ci.yml"), "utf8");

  const prJobStart = wf.indexOf("  new-route-evidence-gate:");
  const prJobEnd = wf.indexOf("  eval-regression-gate:");
  assert.ok(prJobStart > 0 && prJobEnd > prJobStart, "both jobs must still exist");

  const prJob = wf
    .slice(prJobStart, prJobEnd)
    .replace(/^\s*#.*$/gm, ""); // comments name the secret deliberately

  assert.ok(
    !/secrets\./.test(prJob),
    "the pull_request-triggered job must reference no repository secret"
  );
  assert.ok(!prJob.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(!prJob.includes("SUPABASE_URL"));

  // And it must still actually run the gate.
  assert.ok(prJob.includes("npm run eval:check-new-route-evidence"));
});

test("S1-3  the surviving credential is confined to the workflow_dispatch job", () => {
  const wf = readFileSync(path.join(ROOT, ".github/workflows/eval-ci.yml"), "utf8");
  const code = wf.replace(/^\s*#.*$/gm, "");

  // Exactly one live INJECTION remains, and it is inside the dispatch job.
  // Counted as `secrets.X` rather than the bare name: the env line mentions
  // the name twice (variable and secret), which is one injection, not two.
  const refs = [...code.matchAll(/secrets\.SUPABASE_SERVICE_ROLE_KEY/g)];
  assert.equal(refs.length, 1, "only the workflow_dispatch job may still inject the key");

  const dispatchStart = code.indexOf("  eval-regression-gate:");
  assert.ok(refs[0].index > dispatchStart, "the remaining reference must be in eval-regression-gate");

  // That job must stay guarded so a pull_request event can never run it.
  const dispatchJob = code.slice(dispatchStart);
  assert.ok(
    /if:\s*github\.event_name\s*===?\s*'workflow_dispatch'/.test(dispatchJob),
    "the credentialed job must remain workflow_dispatch-only"
  );
});

test("S1-4  a new route pair FAILS CLOSED \u2014 it can never be reported as PASS or SKIPPED", () => {
  const src = readFileSync(path.join(ROOT, "scripts/check-new-route-eval-evidence.ts"), "utf8");
  const main = src.slice(src.indexOf("async function main()"));
  const afterPairsFound = main.slice(main.indexOf("const uniquePairs"));

  assert.ok(
    afterPairsFound.includes("MANUAL_MODEL_EVAL_EVIDENCE_VERIFICATION_REQUIRED"),
    "a detected new pair must report the manual-verification outcome"
  );
  assert.ok(afterPairsFound.includes("process.exit(1)"), "and must exit non-zero");

  // No path from "new pair found" to a passing exit.
  assert.ok(!/return;/.test(afterPairsFound), "there is no early return that could skip the failure");
  assert.ok(!/process\.exit\(0\)/.test(afterPairsFound));
});

test("S1-5  no bypass flag exists \u2014 the gate cannot be forced green by configuration", () => {
  const src = readFileSync(path.join(ROOT, "scripts/check-new-route-eval-evidence.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // The gate reads exactly one environment variable: the git base ref.
  const envReads = [...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(envReads)], ["EVAL_GATE_BASE_REF"]);

  // Looked for as IDENTIFIERS, not as prose: the failure message itself says
  // "there is no bypass flag", and a bare word search would trip on that.
  // The env assertion above is the real proof — one variable, the git ref.
  const identifiers = [...src.matchAll(/[A-Z][A-Z0-9_]{3,}/g)].map((m) => m[0]);
  for (const id of identifiers) {
    assert.ok(
      !/(FORCE|SKIP|BYPASS|OVERRIDE|ALLOW_UNVERIFIED|IGNORE)/.test(id),
      `no escape-hatch identifier may exist, found: ${id}`
    );
  }
});

test("S1-6  no migration change means the gate still passes cleanly", () => {
  const src = readFileSync(path.join(ROOT, "scripts/check-new-route-eval-evidence.ts"), "utf8");
  const main = src.slice(src.indexOf("async function main()"));

  // Both no-op paths survive: no new migration files, and new files that
  // touch no model_routes seed block.
  assert.ok(main.includes("no new migration files in this change"));
  assert.ok(main.includes("none touch model_routes"));
});
