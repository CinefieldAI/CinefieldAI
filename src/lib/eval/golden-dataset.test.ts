import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GOLDEN_EVAL_CASES, GOLDEN_EVAL_SET_KEY, goldenCasesFor, goldenCase } from "./golden-dataset";

test("the golden dataset covers all three task types", () => {
  const taskTypes = new Set(GOLDEN_EVAL_CASES.map((c) => c.taskType));
  assert.deepEqual([...taskTypes].sort(), ["audio", "image", "video"]);
});

test("every case belongs to the one declared eval set", () => {
  for (const c of GOLDEN_EVAL_CASES) {
    assert.equal(c.evalSetKey, GOLDEN_EVAL_SET_KEY);
  }
});

test("goldenCasesFor filters by task type correctly", () => {
  const images = goldenCasesFor("image");
  assert.ok(images.length > 0);
  for (const c of images) assert.equal(c.taskType, "image");
});

test("goldenCase resolves a real case by key, null for an unknown one", () => {
  const first = GOLDEN_EVAL_CASES[0];
  assert.deepEqual(goldenCase(first.caseKey), first);
  assert.equal(goldenCase("not-a-real-case"), null);
});

test("no prompt is empty, and every prompt is bounded — synthetic fixtures, not accidental production data", () => {
  for (const c of GOLDEN_EVAL_CASES) {
    assert.ok(c.prompt.length > 0 && c.prompt.length <= 500, `${c.caseKey}'s prompt must be 1-500 chars`);
  }
});
