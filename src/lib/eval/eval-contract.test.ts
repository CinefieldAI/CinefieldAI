import { strict as assert } from "node:assert";
import { test } from "node:test";
import { verdictForScore, caseVerdict, parseScorePassThreshold, type ScoreResult } from "./eval-contract";

test("verdictForScore: null is inconclusive, not a fabricated pass or fail", () => {
  assert.equal(verdictForScore(null, 0.7), "inconclusive");
});

test("verdictForScore: out-of-range or non-finite scores are inconclusive, never trusted", () => {
  assert.equal(verdictForScore(-0.1, 0.7), "inconclusive");
  assert.equal(verdictForScore(1.1, 0.7), "inconclusive");
  assert.equal(verdictForScore(NaN, 0.7), "inconclusive");
});

test("verdictForScore: at or above the pass threshold is pass, below is fail", () => {
  assert.equal(verdictForScore(0.7, 0.7), "pass");
  assert.equal(verdictForScore(1, 0.7), "pass");
  assert.equal(verdictForScore(0.69, 0.7), "fail");
  assert.equal(verdictForScore(0, 0.7), "fail");
});

test("verdictForScore: a missing threshold (null) is inconclusive even for a real, in-range score — a threshold is never invented", () => {
  assert.equal(verdictForScore(1, null), "inconclusive");
  assert.equal(verdictForScore(0, null), "inconclusive");
});

test("parseScorePassThreshold: missing/malformed/out-of-range is null, never a fabricated default", () => {
  assert.equal(parseScorePassThreshold(undefined), null);
  assert.equal(parseScorePassThreshold("not-a-number"), null);
  assert.equal(parseScorePassThreshold("-0.1"), null);
  assert.equal(parseScorePassThreshold("1.1"), null);
  assert.equal(parseScorePassThreshold("NaN"), null);
});

test("parseScorePassThreshold: a valid [0,1] number is accepted, including the boundaries", () => {
  assert.equal(parseScorePassThreshold("0"), 0);
  assert.equal(parseScorePassThreshold("1"), 1);
  assert.equal(parseScorePassThreshold("0.7"), 0.7);
});

function score(dimension: ScoreResult["dimension"], verdict: ScoreResult["verdict"]): ScoreResult {
  return { dimension, score: verdict === "pass" ? 1 : verdict === "fail" ? 0 : null, verdict, reasonCode: "test" };
}

test("caseVerdict: any failed dimension fails the whole case, even with passes elsewhere", () => {
  const result = caseVerdict([score("quality", "pass"), score("safety", "fail"), score("latency", "pass")]);
  assert.equal(result.verdict, "fail");
  assert.equal(result.reasonCode, "safety_failed");
});

test("caseVerdict: an inconclusive dimension makes the case inconclusive, never a pass, when nothing failed", () => {
  const result = caseVerdict([score("quality", "pass"), score("adherence", "inconclusive")]);
  assert.equal(result.verdict, "inconclusive");
  assert.equal(result.reasonCode, "adherence_unmeasured");
});

test("caseVerdict: fail takes precedence over inconclusive", () => {
  const result = caseVerdict([score("quality", "inconclusive"), score("safety", "fail")]);
  assert.equal(result.verdict, "fail");
});

test("caseVerdict: every dimension passing is the only way to reach pass", () => {
  const result = caseVerdict([score("quality", "pass"), score("safety", "pass"), score("latency", "pass")]);
  assert.equal(result.verdict, "pass");
  assert.equal(result.reasonCode, "all_dimensions_passed");
});

test("caseVerdict: zero dimensions is vacuously a pass with no evidence to fail on — a caller must supply at least one real scorer", () => {
  const result = caseVerdict([]);
  assert.equal(result.verdict, "pass");
});
