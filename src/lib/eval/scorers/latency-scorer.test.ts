import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scoreLatency } from "./latency-scorer";
import type { EvalCase } from "../eval-contract";

function evalCase(overrides: Partial<EvalCase["criteria"]> = {}): EvalCase {
  return {
    caseKey: "test-case",
    evalSetKey: "test-set",
    taskType: "image",
    prompt: "a test prompt",
    criteria: { maxLatencyMs: 10_000, ...overrides },
  };
}

test("a near-instant response scores near 1", () => {
  const result = scoreLatency(evalCase(), 1, 0.7);
  assert.ok(result.score !== null && result.score >= 0.99);
  assert.equal(result.verdict, "pass");
});

test("a zero-millisecond observation is inconclusive, not trusted as a real measurement", () => {
  const result = scoreLatency(evalCase(), 0, 0.7);
  assert.equal(result.verdict, "inconclusive");
});

test("at the bound scores 0 and fails", () => {
  const result = scoreLatency(evalCase(), 10_000, 0.7);
  assert.equal(result.score, 0);
  assert.equal(result.verdict, "fail");
});

test("past the bound clamps to 0, never negative", () => {
  const result = scoreLatency(evalCase(), 50_000, 0.7);
  assert.equal(result.score, 0);
});

test("no observed latency is inconclusive, never a fabricated score", () => {
  const result = scoreLatency(evalCase(), null, 0.7);
  assert.equal(result.score, null);
  assert.equal(result.verdict, "inconclusive");
});

test("no declared bound is an automatic pass — absence of a criterion is not a zero criterion", () => {
  const result = scoreLatency(evalCase({ maxLatencyMs: undefined }), 999_999, 0.7);
  assert.equal(result.score, 1);
  assert.equal(result.verdict, "pass");
});

test("a non-positive observed latency is inconclusive, not trusted", () => {
  const result = scoreLatency(evalCase(), -5, 0.7);
  assert.equal(result.verdict, "inconclusive");
});

test("a null pass threshold makes even a near-instant response inconclusive rather than fabricating a pass", () => {
  const result = scoreLatency(evalCase(), 1, null);
  assert.equal(result.verdict, "inconclusive");
});
