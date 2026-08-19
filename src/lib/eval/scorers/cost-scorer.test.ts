import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scoreCost } from "./cost-scorer";
import type { EvalCase } from "../eval-contract";
import type { CostObservation } from "@/lib/finops/cost-contract";

function evalCase(maxCost?: number): EvalCase {
  return {
    caseKey: "test-case",
    evalSetKey: "test-set",
    taskType: "image",
    prompt: "a test prompt",
    criteria: { maxCost },
  };
}

function known(estimatedCost: number): CostObservation {
  return {
    provider: "mock",
    modelId: "mock-model",
    basis: "ESTIMATE_BASED",
    state: "known",
    estimatedCost,
    reasonCode: "test",
    observedAt: new Date().toISOString(),
  };
}

function unavailable(): CostObservation {
  return {
    provider: "mock",
    modelId: "mock-model",
    basis: "ESTIMATE_BASED",
    state: "unavailable",
    reasonCode: "pricing_source_unavailable",
    observedAt: new Date().toISOString(),
  };
}

test("a cheap generation scores near 1", () => {
  const result = scoreCost(evalCase(1), known(0.01));
  assert.ok(result.score !== null && result.score >= 0.98);
  assert.equal(result.verdict, "pass");
});

test("at the bound scores 0 and fails", () => {
  const result = scoreCost(evalCase(1), known(1));
  assert.equal(result.score, 0);
  assert.equal(result.verdict, "fail");
});

test("an unavailable cost observation is inconclusive, never treated as free", () => {
  const result = scoreCost(evalCase(1), unavailable());
  assert.equal(result.score, null);
  assert.equal(result.verdict, "inconclusive");
  assert.equal(result.reasonCode, "cost_unavailable");
});

test("no declared cost bound is an automatic pass", () => {
  const result = scoreCost(evalCase(undefined), known(999));
  assert.equal(result.score, 1);
});
