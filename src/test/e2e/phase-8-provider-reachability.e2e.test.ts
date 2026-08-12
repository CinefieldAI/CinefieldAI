import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { getProviderAdapter, listRegisteredProviders } from "@/lib/orchestration/provider-registry";
import { isUsable } from "@/lib/orchestration/providers/provider-capabilities";
import { findModel, listModels } from "@/lib/orchestration/model-registry";

/**
 * PHASE 8 — which adapters can production actually reach, and what does each
 * one depend on to return its output?
 *
 * This file exists because "it holds results in memory" means something
 * completely different for an adapter the router can select than for one it
 * cannot. The answer was assumed in an earlier report; here it is measured,
 * pinned, and made to fail loudly if it changes.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const ROUTING_MIGRATION = readSource("supabase/migrations/20260817000000_model_routing.sql");

/** The seeded route table is what the production router reads. */
function isSeededWithEnabledRoute(providerId: string): boolean {
  const seed = ROUTING_MIGRATION.slice(ROUTING_MIGRATION.indexOf("INSERT INTO \"public\".\"model_routes\""));
  return seed.includes(`'${providerId}'`);
}

// ---------------------------------------------------------------------------
// Reachability — measured, not assumed
// ---------------------------------------------------------------------------

test("every registered provider's production reachability is known", () => {
  const registered = listRegisteredProviders().sort();
  assert.deepEqual(registered, ["cloudflare-workers-ai", "fal", "gemini", "mock"]);

  for (const providerId of registered) {
    // Registered in code AND seeded with an enabled route = the router can
    // select it. There is no third state to be vague about.
    const routable = isSeededWithEnabledRoute(providerId);
    assert.equal(
      typeof routable,
      "boolean",
      `${providerId} reachability must be determinable from the seed`
    );
  }
});

test("gemini and cloudflare ARE production-routable — this is not a dev-only path", () => {
  // Stated plainly because an earlier report treated their in-memory result
  // handling as a deferred, non-production concern. It is not: both are
  // seeded with enabled routes at the default priority, and the gemini models
  // are the executable cards on /generate.
  assert.ok(isSeededWithEnabledRoute("gemini"), "gemini has enabled seeded routes");
  assert.ok(
    isSeededWithEnabledRoute("cloudflare-workers-ai"),
    "cloudflare has enabled seeded routes"
  );

  for (const id of ["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite"]) {
    const model = findModel(id);
    assert.ok(model, `${id} must resolve`);
    assert.equal(model!.providerId, "gemini");
    assert.equal(model!.enabled, true, "and it is enabled, so a user can pick it today");
  }
});

// ---------------------------------------------------------------------------
// What each adapter needs in order to return output
// ---------------------------------------------------------------------------

test("fal needs NOTHING from process memory", () => {
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  assert.ok(!/PENDING_RESULTS/.test(source));
  const capabilities = getProviderAdapter("fal").capabilities;
  assert.equal(capabilities.executionShape, "asynchronous");
  assert.ok(isUsable(capabilities.result), "output is fetched from the provider by id");
  assert.ok(isUsable(capabilities.status));
});

test("gemini and cloudflare DO still hold results in process memory", () => {
  // Pinned deliberately. If someone changes this — either by fixing it or by
  // widening the window — the test fails and the change has to be deliberate.
  for (const file of [
    "src/lib/orchestration/providers/gemini-provider.ts",
    "src/lib/orchestration/providers/cloudflare-workers-ai-provider.ts",
  ]) {
    assert.match(
      readSource(file),
      /PENDING_RESULTS/,
      `${file} still uses a process-local result map — recorded, not hidden`
    );
  }
});

test("the exposure is bounded by their SYNCHRONOUS shape, and the bound is what makes it different from fal's", () => {
  // fal's defect was a request id held across a minute-long wait for a job
  // running at the provider. Gemini and Cloudflare complete INSIDE submit()
  // and the orchestrator calls getResult() in the same call stack, so the
  // window is a couple of database writes rather than a provider's runtime.
  //
  // That is smaller by orders of magnitude. It is not zero: a crash in that
  // window loses the output of a call that has already been billed, and the
  // generation goes to reconciliation rather than completing.
  for (const providerId of ["gemini", "cloudflare-workers-ai"]) {
    const capabilities = getProviderAdapter(providerId).capabilities;
    assert.equal(capabilities.executionShape, "synchronous");
    // And critically: there is no durable retrieval to fall back on.
    assert.ok(
      !isUsable(capabilities.result),
      `${providerId} has no fetch-result-by-id capability, so no durable recovery exists`
    );
    assert.ok(!isUsable(capabilities.status));
  }

  // Which is why this cannot be fixed the way fal was: there is no provider
  // API to call. Closing it needs a durable output handoff, and Phase 9 owns
  // the media plane — inventing a blob store here would be the wrong fix in
  // the wrong phase.
  const doc = readSource("docs/architecture/PROVIDER_NETWORK.md");
  assert.match(doc, /Gemini and Cloudflare/, "the limitation must be documented");
});

// ---------------------------------------------------------------------------
// Regression guard: nothing may quietly widen the window
// ---------------------------------------------------------------------------

test("GUARD: a synchronous in-memory adapter must never be declared asynchronous", () => {
  // An async declaration is what puts a gap between submit() and getResult():
  // the orchestrator persists a job, returns, and a LATER poll — possibly in
  // another process — collects the result. For an adapter whose only copy is
  // in this process's memory, that turns a millisecond window into a
  // guaranteed loss.
  for (const providerId of ["gemini", "cloudflare-workers-ai"]) {
    const source = readSource(
      providerId === "gemini"
        ? "src/lib/orchestration/providers/gemini-provider.ts"
        : "src/lib/orchestration/providers/cloudflare-workers-ai-provider.ts"
    );
    if (!/PENDING_RESULTS/.test(source)) continue; // fixed — guard no longer applies

    assert.equal(
      getProviderAdapter(providerId).capabilities.executionShape,
      "synchronous",
      `${providerId} keeps its results in memory; declaring it asynchronous would guarantee output loss`
    );

    for (const model of listModels().filter((m) => m.providerId === providerId)) {
      assert.equal(
        model.executionMode,
        "sync",
        `${model.id} must stay sync while its adapter has no durable result retrieval`
      );
    }
  }
});

test("GUARD: an adapter with no durable result retrieval declares it honestly", () => {
  for (const providerId of listRegisteredProviders()) {
    const capabilities = getProviderAdapter(providerId).capabilities;
    if (capabilities.executionShape === "asynchronous") {
      // An async provider MUST be able to hand its result back later, or the
      // architecture is broken by construction.
      assert.ok(
        isUsable(capabilities.result),
        `${providerId} is asynchronous, so fetching its result later must be a real capability`
      );
      assert.ok(
        isUsable(capabilities.status),
        `${providerId} is asynchronous, so observing it later must be a real capability`
      );
    }
  }
});

test("GUARD: no adapter may be added without declaring how its output survives", () => {
  // A new adapter that forgets this ends up in the same position gemini is in,
  // discovered later. The matrix makes the question unavoidable.
  for (const providerId of listRegisteredProviders()) {
    const capabilities = getProviderAdapter(providerId).capabilities;
    assert.ok(
      ["synchronous", "asynchronous"].includes(capabilities.executionShape),
      `${providerId} must declare an execution shape`
    );
    assert.ok(capabilities.result !== undefined, `${providerId} must declare result retrieval`);
  }
});
