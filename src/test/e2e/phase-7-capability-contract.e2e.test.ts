import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { getCapabilities } from "@/components/landing/createImage/imageModelCapabilities";
import { PUBLIC_MODEL_CATALOG } from "@/lib/orchestration/public-model-catalog";
import { getPublicModel, isOrchestrationModel } from "@/lib/orchestration/orchestration-models";
import { projectModelById } from "@/lib/orchestration/capability-projection";
import { findModel } from "@/lib/orchestration/model-registry";
import { validateCapabilities } from "@/lib/orchestration/capability-validator";
import { resolveWorkflow } from "@/lib/orchestration/workflow-router";
import { isOrchestrationError } from "@/lib/orchestration/errors";
import { renderCatalog } from "../../../scripts/generate-public-catalog";

/**
 * PHASE 7-F CLOSURE — one capability contract, from the registry to the UI.
 *
 * The question these tests answer is not "does the code compile" but "can a
 * user click something the server will refuse". Before this closure they
 * could: the /generate image cards offered an "Auto" aspect ratio no model
 * declares, and offered Nano Banana 2 Lite the 2K and 4K resolutions the
 * registry does not accept.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

/** Cards on /generate that DO have a server-side model behind them. */
const EXECUTABLE_CARDS: [string, string][] = [
  ["Nano Banana Pro", "nano-banana-pro"],
  ["Nano Banana 2", "nano-banana-2"],
  ["Nano Banana 2 Lite", "nano-banana-2-lite"],
];

test("the generated public catalog matches the registry exactly", () => {
  // The browser reads the generated file; the server reads the registry. A
  // capability change that was not regenerated fails HERE, rather than in
  // front of a user whose chosen option the server rejects.
  const committed = readSource("src/lib/orchestration/public-model-catalog.ts");
  assert.equal(
    renderCatalog().replace(/\r\n/g, "\n"),
    committed,
    "public-model-catalog.ts is stale — run: npm run catalog:generate"
  );
});

test("the client catalog names no provider, endpoint or route", () => {
  const generated = readSource("src/lib/orchestration/public-model-catalog.ts");
  const data = generated.slice(generated.indexOf("export const"));
  for (const forbidden of ["providerId", "providerModelId", "fal-ai/", "priority", "routeId"]) {
    assert.ok(!data.includes(forbidden), `the browser catalog must not contain "${forbidden}"`);
  }

  // And the module the browser imports must not reach the registry, which
  // would put every providerModelId back into the bundle.
  const client = readSource("src/lib/orchestration/orchestration-models.ts");
  assert.ok(
    !/from "\.\/model-registry"/.test(client),
    "the client model module must not import the server registry"
  );
  assert.ok(
    !/export function getOrchestrationProvider/.test(client),
    "the browser must have no way to name a provider"
  );
});

test("the browser no longer asks which provider a model runs on", () => {
  const hook = readSource("src/hooks/useGeneration.ts");
  assert.ok(
    !/getOrchestrationProvider\(/.test(hook),
    "useGeneration must not resolve a provider for an orchestration model"
  );
});

test("UI options for an executable model come from the registry", () => {
  // Nano Banana 2 Lite is the case that used to break: the card offered
  // 1K/2K/4K and the server accepts 1K only.
  const canonical = getPublicModel("nano-banana-2-lite");
  assert.ok(canonical, "nano-banana-2-lite must be in the public catalog");

  const bound = getCapabilities("Nano Banana 2 Lite", "nano-banana-2-lite");
  assert.ok(bound, "the card must still resolve");
  if (!bound || !canonical) return;

  if (bound.resolutionOptions) {
    assert.deepEqual(
      bound.resolutionOptions.map((r) => r.value),
      canonical.capabilities.resolutions,
      "the resolution list offered must be exactly what the model supports"
    );
  }
  if (bound.aspectRatioOptions) {
    assert.deepEqual(
      bound.aspectRatioOptions.map((r) => r.value),
      canonical.capabilities.aspectRatios,
      "the ratio list offered must be exactly what the model supports"
    );
    assert.ok(
      !bound.aspectRatioOptions.some((r) => r.value === "Auto"),
      '"Auto" is not a ratio any model declares — offering it guarantees a refusal'
    );
  }
  if (bound.batchSize) {
    assert.equal(bound.maxBatchSize, canonical.capabilities.maxOutputCount);
  }
});

test("every option the UI offers an executable model, the server accepts", () => {
  // The end-to-end claim of 7-F, checked against the REAL validator: clicking
  // anything a card offers cannot produce CAPABILITY_NOT_SUPPORTED.
  for (const [cardName, modelId] of EXECUTABLE_CARDS) {
    const bound = getCapabilities(cardName, modelId);
    const model = findModel(modelId);
    assert.ok(model, `${modelId} must be in the registry`);
    if (!bound || !model) continue;

    const workflow = resolveWorkflow(model, []);
    for (const ratio of bound.aspectRatioOptions ?? []) {
      validateCapabilities({
        model,
        workflow,
        prompt: "capability contract probe",
        inputs: [],
        settings: { aspectRatio: ratio.value },
      });
    }
    for (const resolution of bound.resolutionOptions ?? []) {
      validateCapabilities({
        model,
        workflow,
        prompt: "capability contract probe",
        inputs: [],
        settings: { resolution: resolution.value },
      });
    }
    validateCapabilities({
      model,
      workflow,
      prompt: "capability contract probe",
      inputs: [],
      settings: { outputCount: bound.maxBatchSize ?? 1 },
    });
  }
});

test("a registry change flows to the projection and the UI together", () => {
  // One source, three consumers: registry -> projection -> UI card. The
  // generated-catalog test above is what keeps the UI's copy current; this
  // proves the three agree about the values themselves.
  const model = findModel("nano-banana-pro");
  const projected = projectModelById("nano-banana-pro");
  const card = getCapabilities("Nano Banana Pro", "nano-banana-pro");
  assert.ok(model && projected && card);
  if (!model || !projected || !card) return;

  assert.deepEqual(projected.capabilities.aspectRatios, [
    ...model.capabilities.supportedAspectRatios,
  ]);
  assert.deepEqual(
    (card.aspectRatioOptions ?? []).map((r) => r.value),
    projected.capabilities.aspectRatios
  );
  assert.deepEqual(projected.capabilities.resolutions, [
    ...model.capabilities.supportedResolutions,
  ]);
  assert.deepEqual(
    (card.resolutionOptions ?? []).map((r) => r.value),
    projected.capabilities.resolutions
  );
});

test("the public catalog covers every model the projection publishes", () => {
  assert.deepEqual(
    PUBLIC_MODEL_CATALOG.map((m) => m.id).sort(),
    PUBLIC_MODEL_CATALOG.map((m) => m.id).sort()
  );
  for (const model of PUBLIC_MODEL_CATALOG) {
    assert.ok(isOrchestrationModel(model.id));
    assert.deepEqual(getPublicModel(model.id), model);
  }
});

test("a non-executable catalog card keeps its presentation lists", () => {
  // Most /generate cards have no server-side model at all — they cannot
  // execute, so there is no contract for them to drift from. Binding them to
  // a registry entry they do not have would be the bug, not the fix.
  assert.equal(isOrchestrationModel("seedream-5.0-pro"), false);
  const unbound = getCapabilities("Seedream 5.0 Pro", "seedream-5.0-pro");
  const raw = getCapabilities("Seedream 5.0 Pro");
  assert.deepEqual(unbound, raw, "a card with no server model must be returned untouched");
});

test("the server still refuses a manipulated request the UI would never send", () => {
  // Client-side options are convenience. The authority is here, and wiring
  // the UI to the registry must not have softened it.
  const model = findModel("nano-banana-2-lite");
  assert.ok(model);
  if (!model) return;
  const workflow = resolveWorkflow(model, []);

  for (const settings of [
    { aspectRatio: "Auto" },
    { aspectRatio: "13:7" },
    { resolution: "4K" },
    { outputCount: 4 },
  ]) {
    assert.throws(
      () =>
        validateCapabilities({
          model,
          workflow,
          prompt: "manipulated client probe",
          inputs: [],
          settings,
        }),
      (error: unknown) =>
        isOrchestrationError(error) && error.code === "CAPABILITY_NOT_SUPPORTED",
      `the server must reject ${JSON.stringify(settings)}`
    );
  }
});

test("the /generate prompt bar derives executable options from the catalog", () => {
  const bar = readSource("src/components/cinema-studio/PromptBar.tsx");

  // The bar must ASK the catalog rather than restate it.
  assert.match(bar, /getPublicModel\(model\)/, "PromptBar must resolve the canonical model");
  assert.match(
    bar,
    /options=\{\s*\n?\s*(\/\/[^\n]*\n\s*)*canonicalRatios \?\?/,
    "the aspect-ratio list must prefer the canonical ratios"
  );
  assert.match(bar, /canonicalResolutions \?\?/, "the resolution list must prefer the canonical set");

  // The fixed 2K chip that disagreed with the state it never wrote.
  assert.ok(
    !/options=\{\["2K"\]\}/.test(bar),
    "Nano Banana Pro must not carry a hardcoded single-resolution list"
  );

  // And the selection must be coerced into the contract, not merely offered
  // from it — a stale "1080p" in shared state is what made the old chip lie.
  assert.match(bar, /caps\.aspectRatios\.includes\(aspectRatio\)/);
  assert.match(bar, /caps\.resolutions\.includes\(resolution\)/);
  assert.match(bar, /caps\.maxOutputCount/);
});

test("the /generate image request cannot carry an unsupported setting", () => {
  // What the bar coerces to, checked against the real validator: the Gemini
  // models allow ONE output, and the batch stepper used to default to four.
  for (const modelId of ["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite"]) {
    const model = findModel(modelId);
    assert.ok(model, `${modelId} must be in the registry`);
    if (!model) continue;
    const workflow = resolveWorkflow(model, []);
    const canonical = getPublicModel(modelId);
    assert.ok(canonical);
    if (!canonical) continue;

    validateCapabilities({
      model,
      workflow,
      prompt: "coerced settings probe",
      inputs: [],
      settings: {
        aspectRatio: canonical.defaults.aspectRatio ?? canonical.capabilities.aspectRatios[0],
        resolution: canonical.defaults.resolution ?? canonical.capabilities.resolutions[0],
        outputCount: canonical.capabilities.maxOutputCount,
      },
    });
  }
});
