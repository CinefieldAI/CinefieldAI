import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseRegressionThreshold } from "./check-model-eval-regression";

test("parseRegressionThreshold: missing/malformed/out-of-range is null (NOT_CONFIGURED), never a fabricated default", () => {
  assert.equal(parseRegressionThreshold(undefined), null);
  assert.equal(parseRegressionThreshold("not-a-number"), null);
  assert.equal(parseRegressionThreshold("-0.1"), null);
  assert.equal(parseRegressionThreshold("1.1"), null);
  assert.equal(parseRegressionThreshold("NaN"), null);
  assert.equal(parseRegressionThreshold("Infinity"), null);
});

test("parseRegressionThreshold: an empty or whitespace-only string is null, NEVER Number()'s own coercion to 0 — the exact bug this batch fixes", () => {
  assert.equal(parseRegressionThreshold(""), null);
  assert.equal(parseRegressionThreshold(" "), null);
  assert.equal(parseRegressionThreshold("\t"), null);
  assert.equal(parseRegressionThreshold("\n"), null);
  assert.equal(parseRegressionThreshold("   "), null);
});

test("parseRegressionThreshold: a valid [0,1] number is accepted, including the boundaries — a genuinely configured 0 is not confused with an empty string", () => {
  assert.equal(parseRegressionThreshold("0"), 0);
  assert.equal(parseRegressionThreshold("0.25"), 0.25);
  assert.equal(parseRegressionThreshold("1"), 1);
});

test("parseRegressionThreshold: surrounding whitespace around a real number is tolerated", () => {
  assert.equal(parseRegressionThreshold("  0.5  "), 0.5);
});
