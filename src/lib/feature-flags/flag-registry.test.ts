import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FLAG_REGISTRY, flagDefinition, isValidFlagValue, registeredFlagKeys } from "./flag-registry";

test("the registry holds exactly the four Phase 21-owned flags — no provider/model/route entry", () => {
  assert.deepEqual(registeredFlagKeys(), ["feature.video.enabled", "maintenance_mode", "release_stage", "uploads.enabled"]);
  for (const key of Object.keys(FLAG_REGISTRY)) {
    assert.doesNotMatch(key, /^(provider|model|route)\./, "Phase 7 already owns provider/model/route flags");
  }
});

test("an unregistered flag key resolves to null, never a fabricated definition", () => {
  assert.equal(flagDefinition("not.a.real.flag"), null);
  assert.equal(flagDefinition(""), null);
});

test("maintenance_mode and release_stage are HIGH_RISK_TIER0; feature.video.enabled and uploads.enabled are OPERATOR", () => {
  assert.equal(flagDefinition("maintenance_mode")?.riskTier, "HIGH_RISK_TIER0");
  assert.equal(flagDefinition("release_stage")?.riskTier, "HIGH_RISK_TIER0");
  assert.equal(flagDefinition("feature.video.enabled")?.riskTier, "OPERATOR");
  assert.equal(flagDefinition("uploads.enabled")?.riskTier, "OPERATOR");
});

test("release_stage only accepts alpha/beta/public — nothing else, structurally", () => {
  const def = flagDefinition("release_stage")!;
  assert.ok(isValidFlagValue(def, "alpha"));
  assert.ok(isValidFlagValue(def, "beta"));
  assert.ok(isValidFlagValue(def, "public"));
  assert.ok(!isValidFlagValue(def, "production"));
  assert.ok(!isValidFlagValue(def, ""));
  assert.ok(!isValidFlagValue(def, true));
});

test("a boolean flag rejects a non-boolean value", () => {
  const def = flagDefinition("maintenance_mode")!;
  assert.ok(isValidFlagValue(def, true));
  assert.ok(isValidFlagValue(def, false));
  assert.ok(!isValidFlagValue(def, "true"));
  assert.ok(!isValidFlagValue(def, 1));
});

test("every registered flag's own defaultValue satisfies its own valueType — proven by the module's own load-time check, re-asserted here", () => {
  for (const def of Object.values(FLAG_REGISTRY)) {
    assert.ok(isValidFlagValue(def, def.defaultValue), `${def.key}'s defaultValue must satisfy its own valueType`);
  }
});
