import { strict as assert } from "node:assert";
import { test } from "node:test";
import { selectProductionSamples, DEFAULT_SAMPLE_POLICY, type AttemptSampleCandidate } from "./production-sample";

function attempt(overrides: Partial<AttemptSampleCandidate>): AttemptSampleCandidate {
  return {
    attemptId: "attempt-1",
    generationId: "gen-1",
    modelVersionId: "mv-1",
    modelRouteId: "mr-1",
    status: "completed",
    latencyMs: 1000,
    outputUrl: "https://example.invalid/out.png",
    manifestVersion: null,
    compilerVersion: null,
    ...overrides,
  };
}

test("every failed attempt is sampled, regardless of the random roll", () => {
  const attempts = [attempt({ attemptId: "a1", status: "failed" })];
  const selections = selectProductionSamples(attempts, [0.999]); // a roll that would never pass the success rate
  assert.equal(selections.length, 1);
  assert.equal(selections[0].reasonCode, "failed_attempt");
});

test("failed_retryable is also sampled, same as a hard failure", () => {
  const attempts = [attempt({ attemptId: "a1", status: "failed_retryable" })];
  const selections = selectProductionSamples(attempts, [0.999]);
  assert.equal(selections.length, 1);
});

test("a completed attempt is sampled only when the roll is below the success rate", () => {
  const attempts = [attempt({ attemptId: "a1", status: "completed" })];
  const below = selectProductionSamples(attempts, [0.001], { successSampleRate: 0.01 });
  const above = selectProductionSamples(attempts, [0.5], { successSampleRate: 0.01 });
  assert.equal(below.length, 1);
  assert.equal(below[0].reasonCode, "random_success_sample");
  assert.equal(above.length, 0);
});

test("an attempt with no model_version_id or model_route_id is never sampled — unroutable evidence", () => {
  const attempts = [attempt({ attemptId: "a1", status: "failed", modelVersionId: null })];
  const selections = selectProductionSamples(attempts, [0.001]);
  assert.equal(selections.length, 0);
});

test("a still-processing or queued attempt is never sampled", () => {
  const attempts = [attempt({ attemptId: "a1", status: "processing" }), attempt({ attemptId: "a2", status: "queued" })];
  const selections = selectProductionSamples(attempts, [0.001, 0.001]);
  assert.equal(selections.length, 0);
});

test("the default policy is a real, named constant, not an inline magic number", () => {
  assert.equal(DEFAULT_SAMPLE_POLICY.successSampleRate, 0.01);
});
