import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scoreFailure } from "./failure-scorer";

test("a succeeded generation passes with score 1", () => {
  const result = scoreFailure(true);
  assert.equal(result.score, 1);
  assert.equal(result.verdict, "pass");
});

test("a failed generation fails outright with score 0", () => {
  const result = scoreFailure(false);
  assert.equal(result.score, 0);
  assert.equal(result.verdict, "fail");
});

test("a custom reason code is carried through", () => {
  const result = scoreFailure(false, "provider_timeout");
  assert.equal(result.reasonCode, "provider_timeout");
});
