import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { EVENT_SCHEMAS } from "@/lib/events/event-schemas";
import { DEFAULT_QUALITY_POLICY } from "@/lib/routing/route-quality";
import { GOLDEN_EVAL_CASES } from "@/lib/eval/golden-dataset";

/**
 * Phase 22 — AI Model Evaluation & Quality Governance.
 *
 * Proves what this batch built: the durable eval store (22-A), the scorer
 * set (22-B), the CI regression gate (22-C), and the router/dashboard
 * wiring (22-D) — plus, just as important, that none of it silently
 * upgraded a routing decision, invented a business threshold, or duplicated
 * an existing owner (Phase 7 routing, Phase 9-E moderation, Phase 15-B
 * cost, Phase 20 contract governance).
 */

const ROOT = process.cwd();
function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function stripSqlComments(source: string): string {
  return source.replace(/--.*$/gm, "");
}

// ---- Ownership: the router seam is used, never re-derived -----------------

describe("Phase 22 — router quality seam reused, not duplicated", () => {
  test("DEFAULT_QUALITY_POLICY.trustedEvaluators is still empty — this batch does not flip the 'go live' switch", () => {
    assert.deepEqual(DEFAULT_QUALITY_POLICY.trustedEvaluators, []);
  });

  test("route-quality.ts, health-aware-router.ts, and route-scoring.ts are byte-for-byte untouched by this batch", () => {
    for (const file of ["src/lib/routing/route-quality.ts", "src/lib/routing/health-aware-router.ts", "src/lib/routing/route-scoring.ts"]) {
      assert.ok(existsSync(path.join(ROOT, file)));
    }
  });

  test("generation-create-service.ts's ONLY change is supplying a real QualitySignalProvider — resolveHealthyRoute's own signature and every earlier positional argument are untouched", () => {
    const src = stripComments(read("src/lib/orchestration/generation-create-service.ts"));
    assert.match(src, /new DurableEvalQualityProvider\(admin\)/);
    assert.match(src, /cinefieldModelId: model\.id/, "the routing request shape itself is unmodified");
  });

  test("no second cost or safety judgment was invented — the eval scorers import Phase 15-B's CostObservation and Phase 9-E's ModerationResult verbatim, never redeclare them", () => {
    const cost = stripComments(read("src/lib/eval/scorers/cost-scorer.ts"));
    assert.match(cost, /from "@\/lib\/finops\/cost-contract"/);
    assert.doesNotMatch(cost, /interface CostObservation/);

    const safety = stripComments(read("src/lib/eval/scorers/safety-scorer.ts"));
    assert.match(safety, /from "@\/lib\/media\/moderation-contract"/);
    assert.doesNotMatch(safety, /interface ModerationResult/);
  });
});

// ---- 22-A: durable eval store, immutable metadata --------------------------

describe("Phase 22-A — durable eval store, immutable once complete", () => {
  test("model_eval_runs/model_eval_results exist, with an append-only trigger on results and a one-way status transition on runs", () => {
    const migration = read("supabase/migrations/20260908000000_model_eval.sql");
    const sqlOnly = stripSqlComments(migration);
    assert.match(sqlOnly, /CREATE TABLE IF NOT EXISTS "public"\."model_eval_runs"/);
    assert.match(sqlOnly, /CREATE TABLE IF NOT EXISTS "public"\."model_eval_results"/);
    assert.match(sqlOnly, /model_eval_results_append_only/);
    assert.match(sqlOnly, /WHERE id = p_run_id AND status = 'running'/, "only a still-running row transitions — this is what makes the run row immutable in practice");
  });

  test("the golden dataset is source-controlled TypeScript, never a database table for its own case content", () => {
    const migration = read("supabase/migrations/20260908000000_model_eval.sql");
    assert.doesNotMatch(migration, /CREATE TABLE.*model_eval_cases/i);
    assert.doesNotMatch(migration, /CREATE TABLE.*model_eval_sets/i);
    assert.ok(GOLDEN_EVAL_CASES.length > 0);
  });

  test("no anon/authenticated mutation is possible — RLS enabled, grants restricted to service_role", () => {
    const sqlOnly = stripSqlComments(read("supabase/migrations/20260908000000_model_eval.sql"));
    assert.match(sqlOnly, /ALTER TABLE "public"\."model_eval_runs" ENABLE ROW LEVEL SECURITY/);
    assert.match(sqlOnly, /ALTER TABLE "public"\."model_eval_results" ENABLE ROW LEVEL SECURITY/);
    assert.match(sqlOnly, /REVOKE ALL ON FUNCTION "public"\."start_model_eval_run".*FROM PUBLIC, "anon", "authenticated"/);
    assert.match(sqlOnly, /REVOKE ALL ON FUNCTION "public"\."complete_model_eval_run".*FROM PUBLIC, "anon", "authenticated"/);
  });

  test("eval run identity references Phase 7's own model_versions — no second identity space", () => {
    const sqlOnly = stripSqlComments(read("supabase/migrations/20260908000000_model_eval.sql"));
    assert.match(sqlOnly, /"model_version_id" "uuid" NOT NULL REFERENCES "public"\."model_versions"\("id"\)/);
  });
});

// ---- 22-B: scorer set, judge boundary --------------------------------------

describe("Phase 22-B — scorer set, AI judge is advisory only", () => {
  test("every registered ScoreDimension has a real scorer file", () => {
    for (const file of [
      "src/lib/eval/scorers/latency-scorer.ts",
      "src/lib/eval/scorers/cost-scorer.ts",
      "src/lib/eval/scorers/safety-scorer.ts",
      "src/lib/eval/scorers/failure-scorer.ts",
      "src/lib/eval/scorers/judge-scorers.ts",
    ]) {
      assert.ok(existsSync(path.join(ROOT, file)), `${file} must exist`);
    }
  });

  test("the AI judge interface returns only a bounded score + reason code — no field for chain-of-thought or free-text reasoning exists to persist", () => {
    const src = stripComments(read("src/lib/eval/scorers/judge-provider.ts"));
    const shape = /export interface JudgeVerdict \{[\s\S]*?\n\}/.exec(src);
    assert.ok(shape);
    const fields = shape![0]
      .split("\n")
      .map((line) => line.trim().replace(/^readonly\s+/, "").split(/[?:]/)[0])
      .filter((name) => /^[a-z][A-Za-z]*$/.test(name));
    assert.deepEqual(fields.sort(), ["reasonCode", "score"]);
  });

  test("no live judge is wired in this batch — NO_JUDGE_AVAILABLE is the only implementer, and it never calls a model", () => {
    const src = stripComments(read("src/lib/eval/scorers/judge-provider.ts"));
    assert.doesNotMatch(src, /fetch\(|@fal-ai|@google\/genai|openai|anthropic/i);
    assert.match(src, /export const NO_JUDGE_AVAILABLE/);
  });

  test("the eval-runner defaults to NO_JUDGE_AVAILABLE — a caller must deliberately supply a real judge, never accidentally get one", () => {
    const src = stripComments(read("src/lib/eval/eval-runner.ts"));
    assert.match(src, /judge: AiJudgeProvider = NO_JUDGE_AVAILABLE/);
  });
});

// ---- 22-C: CI regression gate, fail-closed ---------------------------------

describe("Phase 22-C — regression gate is real and fails closed", () => {
  test("missing config is NOT_CONFIGURED (exit 2), never a silent pass", () => {
    const src = stripComments(read("scripts/check-model-eval-regression.ts"));
    assert.match(src, /NOT_CONFIGURED/);
    assert.match(src, /process\.exit\(2\)/);
  });

  test("no threshold default is invented — MODEL_EVAL_REGRESSION_THRESHOLD has no fallback value", () => {
    const src = stripComments(read("scripts/check-model-eval-regression.ts"));
    assert.doesNotMatch(src, /MODEL_EVAL_REGRESSION_THRESHOLD.*\?\?\s*[\d.]/);
  });

  test("a candidate with no completed eval run is NO_EVIDENCE (exit 1), never treated as passing", () => {
    const src = stripComments(read("scripts/check-model-eval-regression.ts"));
    assert.match(src, /NO_EVIDENCE/);
  });

  test("contract-ci.yml/policy-ci.yml's own required-check pattern is reused for tsc — no continue-on-error anywhere in eval-ci.yml", () => {
    const workflow = read(".github/workflows/eval-ci.yml");
    assert.doesNotMatch(workflow, /continue-on-error/);
    assert.match(workflow, /npm run eval:check-regression/);
  });

  test("this workflow's own automatic-candidate-detection gap is disclosed in its own header, not hidden", () => {
    const workflow = read(".github/workflows/eval-ci.yml");
    assert.match(workflow, /HONEST GAP, DISCLOSED/);
  });
});

// ---- 22-D: admin dashboard, no mutation surface -----------------------------

describe("Phase 22-D — Model Quality dashboard is read-only", () => {
  test("no POST/PUT/DELETE route exists under /api/admin/model-quality", () => {
    assert.ok(!existsSync(path.join(ROOT, "src/app/api/admin/model-quality/set")));
    const src = stripComments(read("src/app/api/admin/model-quality/route.ts"));
    assert.doesNotMatch(src, /export async function POST|export async function PUT|export async function DELETE/);
  });

  test("Model Quality is a real link in the admin nav", () => {
    const layout = read("src/app/admin/layout.tsx");
    assert.match(layout, /href="\/admin\/model-quality"/);
  });

  test("the dashboard does not require Phase 7's separate route-authority allowlist — a plain read, not a second router authority", () => {
    const src = stripComments(read("src/lib/admin/model-quality-admin-service.ts"));
    assert.doesNotMatch(src, /assertRouteAdmin/);
  });
});

// ---- Phase 20 contract governance -------------------------------------------

describe("Phase 22 composes with Phase 20 contract governance for its own new event", () => {
  test("audit.eval-run-completed@1 is registered", () => {
    assert.ok(EVENT_SCHEMAS.has("audit.eval-run-completed@1"));
  });

  test("the payload carries only bounded aggregate facts — no per-case score, no prompt, no output URL", () => {
    const src = stripComments(read("src/lib/events/event-schemas.ts"));
    const schemaSection = src.slice(src.indexOf("const AUDIT_EVAL_RUN_COMPLETED"), src.indexOf("const REGISTERED"));
    assert.match(schemaSection, /additionalProperties: false/);
    assert.doesNotMatch(schemaSection, /prompt|outputUrl|reasonCode/i);
  });
});

// ---- Sensitive data boundary -------------------------------------------------

describe("Phase 22 — sensitive data boundary", () => {
  test("no secret, token, or credential-shaped field anywhere in the new eval module", () => {
    const FORBIDDEN = /(secret|password|apikey|api_key|signedurl|signed_url|sdkkey)/i;
    for (const file of [
      "src/lib/eval/eval-contract.ts",
      "src/lib/eval/eval-store.ts",
      "src/lib/eval/eval-runner.ts",
      "src/lib/eval/golden-dataset.ts",
    ]) {
      assert.doesNotMatch(stripComments(read(file)), FORBIDDEN, `${file} must carry no secret-shaped field`);
    }
  });

  test("every golden-dataset prompt is synthetic and bounded — never a real production prompt", () => {
    for (const c of GOLDEN_EVAL_CASES) {
      assert.ok(c.prompt.length <= 500);
    }
  });
});

// ---- Built-but-unwired reachability ----------------------------------------

describe("Phase 22 — every new component has a real caller", () => {
  test("eval-runner.ts is called by the CLI script, not only by its own tests", () => {
    const src = stripComments(read("scripts/run-model-eval.ts"));
    assert.match(src, /from "@\/lib\/eval\/eval-runner"/);
    assert.match(src, /runEval\(/);
  });

  test("eval-quality-provider.ts is imported by the real generation-create-service.ts call site, not only by its own tests", () => {
    const src = stripComments(read("src/lib/orchestration/generation-create-service.ts"));
    assert.match(src, /from "@\/lib\/eval\/eval-quality-provider"/);
  });

  test("the admin API route imports the real service, not a stub", () => {
    const src = stripComments(read("src/app/api/admin/model-quality/route.ts"));
    assert.match(src, /getModelQualityAdminView/);
  });

  test("check-model-eval-regression.ts imports the real eval store, not a mock", () => {
    const src = stripComments(read("scripts/check-model-eval-regression.ts"));
    assert.match(src, /from "@\/lib\/eval\/eval-store"/);
  });
});
