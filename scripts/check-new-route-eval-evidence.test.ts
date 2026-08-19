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
