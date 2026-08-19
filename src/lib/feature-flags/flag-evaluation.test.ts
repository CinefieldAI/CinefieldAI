import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateBoolean, evaluateFlag } from "./flag-evaluation";
import type { FlagProvider, FlagRecord } from "./flag-contract";

function fakeProvider(record: FlagRecord | null | (() => never)): FlagProvider {
  return {
    async resolve() {
      if (typeof record === "function") return record();
      return record;
    },
  };
}

test("an unregistered flag key fails to false/ERROR without ever calling the provider", async () => {
  let called = false;
  const provider: FlagProvider = {
    async resolve() {
      called = true;
      return null;
    },
  };
  const details = await evaluateFlag("not.a.real.flag", provider);
  assert.equal(details.reason, "ERROR");
  assert.equal(called, false);
});

test("no durable record yet falls back to the definition's own default, reason DEFAULT", async () => {
  const details = await evaluateFlag("uploads.enabled", fakeProvider(null));
  assert.equal(details.value, true); // uploads.enabled's own registered default
  assert.equal(details.reason, "DEFAULT");
});

test("a real durable record is returned as-is, reason STATIC", async () => {
  const record: FlagRecord = {
    key: "maintenance_mode",
    value: true,
    rollbackValue: false,
    reasonCode: null,
    ticketRef: null,
    expiresAt: null,
    updatedBy: "user_admin_1",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const details = await evaluateFlag("maintenance_mode", fakeProvider(record));
  assert.equal(details.value, true);
  assert.equal(details.reason, "STATIC");
});

test("a durable value that no longer satisfies its own definition's shape falls back to the default, never thrown or passed through", async () => {
  const record: FlagRecord = {
    key: "release_stage",
    value: "not-a-real-stage" as unknown as FlagRecord["value"],
    rollbackValue: null,
    reasonCode: null,
    ticketRef: null,
    expiresAt: null,
    updatedBy: "user_admin_1",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const details = await evaluateFlag("release_stage", fakeProvider(record));
  assert.equal(details.value, "alpha"); // release_stage's own registered default
  assert.equal(details.reason, "ERROR");
});

test("a provider that throws falls back to the default, reason ERROR — never an uncaught rejection", async () => {
  const throwingProvider = fakeProvider(() => {
    throw new Error("boom");
  });
  const details = await evaluateFlag("feature.video.enabled", throwingProvider);
  assert.equal(details.value, true); // feature.video.enabled's own registered default
  assert.equal(details.reason, "ERROR");
});

test("evaluateBoolean coerces a non-boolean resolved value to false rather than returning it", async () => {
  const record: FlagRecord = {
    key: "release_stage",
    value: "beta",
    rollbackValue: null,
    reasonCode: null,
    ticketRef: null,
    expiresAt: null,
    updatedBy: "user_admin_1",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  assert.equal(await evaluateBoolean("release_stage", fakeProvider(record)), false);
  assert.equal(await evaluateBoolean("maintenance_mode", fakeProvider(null)), false); // default
});
