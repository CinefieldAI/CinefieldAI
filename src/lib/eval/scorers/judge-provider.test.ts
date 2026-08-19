import { strict as assert } from "node:assert";
import { test } from "node:test";
import { NO_JUDGE_AVAILABLE } from "./judge-provider";
import { scoreAdherence, scoreQuality, scoreConsistency } from "./judge-scorers";
import type { EvalCase } from "../eval-contract";

const evalCase: EvalCase = {
  caseKey: "test-case",
  evalSetKey: "test-set",
  taskType: "image",
  prompt: "a test prompt",
  criteria: {},
};

test("NO_JUDGE_AVAILABLE always returns null score, never a fabricated one", async () => {
  const verdict = await NO_JUDGE_AVAILABLE.judge("quality", evalCase, "https://example.invalid/out.png");
  assert.equal(verdict.score, null);
  assert.equal(verdict.reasonCode, "no_judge_configured");
});

test("all three judge-backed scorers are inconclusive with no judge configured", async () => {
  const adherence = await scoreAdherence(NO_JUDGE_AVAILABLE, evalCase, null, 0.7);
  const quality = await scoreQuality(NO_JUDGE_AVAILABLE, evalCase, null, 0.7);
  const consistency = await scoreConsistency(NO_JUDGE_AVAILABLE, evalCase, null, 0.7);
  for (const result of [adherence, quality, consistency]) {
    assert.equal(result.score, null);
    assert.equal(result.verdict, "inconclusive");
  }
  assert.equal(adherence.dimension, "adherence");
  assert.equal(quality.dimension, "quality");
  assert.equal(consistency.dimension, "consistency");
});

test("a real judge implementation's score is respected verbatim, proving the seam is real", async () => {
  const fakeJudge = { async judge() { return { score: 0.42, reasonCode: "fake_judge_test" }; } };
  const result = await scoreQuality(fakeJudge, evalCase, "https://example.invalid/out.png", 0.7);
  assert.equal(result.score, 0.42);
  assert.equal(result.reasonCode, "fake_judge_test");
});

test("a null pass threshold makes even a high real-judge score inconclusive rather than fabricating a pass", async () => {
  const fakeJudge = { async judge() { return { score: 0.99, reasonCode: "fake_judge_test" }; } };
  const result = await scoreQuality(fakeJudge, evalCase, "https://example.invalid/out.png", null);
  assert.equal(result.verdict, "inconclusive");
});
