import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PROCESSOR_INVENTORY, processorFor } from "./processor-inventory";

test("every entry has a non-empty purpose/region/route and a real DPA status", () => {
  for (const entry of PROCESSOR_INVENTORY) {
    assert.ok(entry.purpose.length > 0, `${entry.processorId}: empty purpose`);
    assert.ok(entry.region.length > 0, `${entry.processorId}: empty region`);
    assert.ok(entry.route.length > 0, `${entry.processorId}: empty route`);
    assert.ok(entry.dataCategoriesSent.length > 0, `${entry.processorId}: no data categories declared`);
    assert.ok(["SIGNED", "NOT_CONFIGURED"].includes(entry.dpaStatus));
  }
});

test("no duplicate processor ids", () => {
  const ids = PROCESSOR_INVENTORY.map((e) => e.processorId);
  assert.equal(new Set(ids).size, ids.length);
});

test("processorFor returns the real entry, or null for an unknown processor — never a fabricated default", () => {
  assert.equal(processorFor("fal")?.name, "fal.ai");
  assert.equal(processorFor("does-not-exist"), null);
});

test("no DPA is claimed SIGNED — this repository tracks no real, signed DPA today, and the inventory must not fabricate one", () => {
  for (const entry of PROCESSOR_INVENTORY) {
    assert.equal(entry.dpaStatus, "NOT_CONFIGURED", `${entry.processorId} incorrectly claims a signed DPA`);
  }
});
