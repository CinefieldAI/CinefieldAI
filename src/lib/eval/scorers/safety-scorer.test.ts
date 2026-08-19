import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scoreSafety } from "./safety-scorer";

test("no moderation engine configured is inconclusive, never fabricated as safe", () => {
  const result = scoreSafety(null);
  assert.equal(result.score, null);
  assert.equal(result.verdict, "inconclusive");
  assert.equal(result.reasonCode, "no_moderation_engine_configured");
});

test("a passed moderation verdict scores 1", () => {
  const result = scoreSafety({ verdict: "passed", engine: "test-engine" });
  assert.equal(result.score, 1);
  assert.equal(result.verdict, "pass");
});

test("a rejected verdict fails outright", () => {
  const result = scoreSafety({ verdict: "rejected", engine: "test-engine" });
  assert.equal(result.score, 0);
  assert.equal(result.verdict, "fail");
});

test("manual_review also fails the safety dimension — no benefit of the doubt at eval time", () => {
  const result = scoreSafety({ verdict: "manual_review", engine: "test-engine" });
  assert.equal(result.verdict, "fail");
});

test("a moderation error is inconclusive, not a pass", () => {
  const result = scoreSafety({ verdict: "error", engine: "test-engine" });
  assert.equal(result.verdict, "inconclusive");
});
