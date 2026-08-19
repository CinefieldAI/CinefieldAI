import { strict as assert } from "node:assert";
import { test } from "node:test";
import { effectiveRecord } from "./flag-store";
import type { FlagRecord } from "./flag-contract";

function record(overrides: Partial<FlagRecord>): FlagRecord {
  return {
    key: "maintenance_mode",
    value: true,
    rollbackValue: false,
    reasonCode: "incident_123",
    ticketRef: null,
    expiresAt: null,
    updatedBy: "user_admin_1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("a flag with no expiresAt is never treated as expired", () => {
  const { record: out, expired } = effectiveRecord(record({ expiresAt: null }));
  assert.equal(expired, false);
  assert.equal(out.value, true);
});

test("a flag whose expiresAt is in the future is not yet expired", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const { record: out, expired } = effectiveRecord(record({ expiresAt: future }));
  assert.equal(expired, false);
  assert.equal(out.value, true);
});

test("a flag whose expiresAt has passed reads as its own rollbackValue — lazy, never a background write", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const { record: out, expired } = effectiveRecord(record({ expiresAt: past, value: true, rollbackValue: false }));
  assert.equal(expired, true);
  assert.equal(out.value, false, "the EFFECTIVE value reverts to rollbackValue");
});

test("an expired flag with no rollbackValue captured yet is not silently reverted to an invented value", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const { record: out, expired } = effectiveRecord(record({ expiresAt: past, value: true, rollbackValue: null }));
  assert.equal(expired, false, "nothing to revert TO, so the current value stands rather than reverting to null");
  assert.equal(out.value, true);
});
