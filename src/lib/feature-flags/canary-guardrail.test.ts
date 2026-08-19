import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { evaluateCanaryGuardrail } from "./canary-guardrail";
import { computeErrorBudget } from "@/lib/slo/error-budget";

test("an exhausted error budget triggers ROLLBACK", () => {
  const budget = computeErrorBudget({ targetRatio: 0.99, goodCount: 50, totalCount: 100, minimumSamples: 10 });
  assert.ok(budget.ok && budget.value.exhausted);
  const result = evaluateCanaryGuardrail("some-rollout", budget);
  assert.equal(result.decision, "ROLLBACK");
  assert.equal(result.reasonCode, "error_budget_exhausted");
  assert.equal(result.targetKey, "some-rollout");
});

test("a healthy error budget CONTINUEs", () => {
  const budget = computeErrorBudget({ targetRatio: 0.9, goodCount: 99, totalCount: 100, minimumSamples: 10 });
  assert.ok(budget.ok && !budget.value.exhausted);
  const result = evaluateCanaryGuardrail("some-rollout", budget);
  assert.equal(result.decision, "CONTINUE");
});

test("an unresolvable SLO signal HOLDs rather than rolling back on missing data", () => {
  const budget = computeErrorBudget({ targetRatio: 0.9, goodCount: 1, totalCount: 1, minimumSamples: 50 });
  assert.ok(!budget.ok);
  const result = evaluateCanaryGuardrail("some-rollout", budget);
  assert.equal(result.decision, "HOLD");
  assert.match(result.reasonCode, /^slo_unavailable_/);
});

test("this module never reaches Supabase, Redis, or any flag store — it is a pure decision layer", () => {
  const src = readFileSync(path.join(process.cwd(), "src/lib/feature-flags/canary-guardrail.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /supabase|redis|\.rpc\(|writeFlag/i);
});
