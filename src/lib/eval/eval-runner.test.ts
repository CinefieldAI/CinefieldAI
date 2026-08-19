import { strict as assert } from "node:assert";
import { test } from "node:test";
import { runEval, runEvalCase, type ProducedOutput } from "./eval-runner";
import { latestCompletedRun, qualitySignalFor } from "./eval-store";
import { DurableEvalQualityProvider } from "./eval-quality-provider";
import type { EvalCase, EvalRunIdentity } from "./eval-contract";
import { FakeSupabaseClient } from "../../test/e2e/fake-supabase";

function envelope(db: FakeSupabaseClient) {
  return db as never;
}

const cases: EvalCase[] = [
  { caseKey: "case-1", evalSetKey: "test-set", taskType: "image", prompt: "prompt one", criteria: { maxLatencyMs: 10_000 } },
  { caseKey: "case-2", evalSetKey: "test-set", taskType: "image", prompt: "prompt two", criteria: { maxLatencyMs: 10_000 } },
];

function identity(overrides: Partial<EvalRunIdentity> = {}): EvalRunIdentity {
  return {
    modelVersionId: "11111111-1111-4111-8111-111111111111",
    providerId: "mock",
    providerModelId: "mock-v1",
    evalSetKey: "test-set",
    evaluator: "cinefield-eval",
    evaluatorVersion: "1.0.0",
    ...overrides,
  };
}

function succeed(latencyMs = 1000): ProducedOutput {
  return {
    outputUrl: "https://example.invalid/out.png",
    succeeded: true,
    latencyMs,
    cost: { provider: "mock", modelId: "mock-v1", basis: "ESTIMATE_BASED", state: "known", estimatedCost: 0.01, reasonCode: "test", observedAt: new Date().toISOString() },
    moderation: { verdict: "passed", engine: "test" },
  };
}

test("runEvalCase: a fully-healthy case passes on every measurable dimension and is inconclusive on judge-backed ones with no judge configured", async () => {
  const result = await runEvalCase(cases[0], async () => succeed());
  assert.equal(result.failed, false);
  // failure/latency/cost/safety are all measured and pass; adherence/quality/consistency are inconclusive (no judge) -> case verdict is inconclusive, not pass.
  assert.equal(result.verdict, "inconclusive");
  const failureScore = result.scores.find((s) => s.dimension === "failure");
  assert.equal(failureScore?.verdict, "pass");
});

test("runEvalCase: a failed generation fails the case outright", async () => {
  const result = await runEvalCase(cases[0], async () => ({ ...succeed(), succeeded: false }));
  assert.equal(result.failed, true);
  assert.equal(result.verdict, "fail");
});

test("runEval: no cases returns no_cases without touching the store", async () => {
  const db = new FakeSupabaseClient();
  const outcome = await runEval(envelope(db), identity(), [], async () => succeed());
  assert.equal(outcome.outcome, "no_cases");
  assert.equal((db.state.model_eval_runs ?? []).length, 0);
});

test("runEval: a real run is started, every case is recorded durably, and the run completes — 22-A's own done-criterion", async () => {
  const db = new FakeSupabaseClient();
  const outcome = await runEval(envelope(db), identity(), cases, async () => succeed());
  assert.equal(outcome.outcome, "completed");
  if (outcome.outcome !== "completed") return;

  const runs = db.state.model_eval_runs ?? [];
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, "completed");
  assert.ok(runs[0].completed_at);

  const results = db.state.model_eval_results ?? [];
  assert.equal(results.length, cases.length);
});

test("runEval: a run with any failed case completes as 'failed', never silently as 'completed'", async () => {
  const db = new FakeSupabaseClient();
  let call = 0;
  const outcome = await runEval(envelope(db), identity(), cases, async () => {
    call += 1;
    return call === 1 ? succeed() : { ...succeed(), succeeded: false };
  });
  assert.equal(outcome.outcome, "completed");
  const runs = db.state.model_eval_runs ?? [];
  assert.equal(runs[0].status, "failed");
});

test("runEval -> latestCompletedRun: a completed run is readable back with real aggregate scores, an incomplete/failed run is not returned as 'the current measurement'", async () => {
  const db = new FakeSupabaseClient();
  await runEval(envelope(db), identity(), cases, async () => succeed());

  const summary = await latestCompletedRun(envelope(db), "mock", "mock-v1");
  assert.ok(summary);
  assert.equal(summary?.caseCount, cases.length);
  assert.equal(summary?.failedCaseCount, 0);

  // A run that failed must not be returned as the "latest completed" measurement.
  const db2 = new FakeSupabaseClient();
  await runEval(envelope(db2), identity(), cases, async () => ({ ...succeed(), succeeded: false }));
  const failedSummary = await latestCompletedRun(envelope(db2), "mock", "mock-v1");
  assert.equal(failedSummary, null);
});

test("DurableEvalQualityProvider reads a real signal after a real run, using the exact QualitySignalProvider interface the router already expects", async () => {
  const db = new FakeSupabaseClient();
  const fakeJudge = { async judge(dimension: string) { return dimension === "quality" ? { score: 0.85, reasonCode: "fake_judge" } : { score: null, reasonCode: "not_tested" }; } };
  await runEval(envelope(db), identity(), cases, async () => succeed(), fakeJudge);

  const provider = new DurableEvalQualityProvider(envelope(db));
  const signal = await provider.read("mock", "mock-v1");
  assert.ok(signal);
  assert.equal(signal?.score, 0.85);
  assert.equal(signal?.evaluator, "cinefield-eval");
  assert.equal(signal?.sampleCount, cases.length);
});

test("no signal exists for a provider/model pair with no completed run — never a fabricated default", async () => {
  const db = new FakeSupabaseClient();
  const provider = new DurableEvalQualityProvider(envelope(db));
  const signal = await provider.read("some-other-provider", "some-other-model");
  assert.equal(signal, null);
});

test("qualitySignalFor confidence reflects the real pass rate of the run, not an invented number", async () => {
  const db = new FakeSupabaseClient();
  const fakeJudge = { async judge(dimension: string) { return dimension === "quality" ? { score: 0.9, reasonCode: "fake_judge" } : { score: null, reasonCode: "not_tested" }; } };
  await runEval(envelope(db), identity(), cases, async () => succeed(), fakeJudge);
  const signal = await qualitySignalFor(envelope(db), "mock", "mock-v1");
  assert.ok(signal);
  assert.equal(signal?.confidence, 1); // 0 failed / 2 cases
});
