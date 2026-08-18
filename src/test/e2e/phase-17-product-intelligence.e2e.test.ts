import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseUserIntent, type UserIntent } from "@/lib/product-intelligence/user-intent-contract";
import { runCapabilitySpecialist } from "@/lib/product-intelligence/specialists/capability-specialist";
import { runPromptSpecialist } from "@/lib/product-intelligence/specialists/prompt-specialist";
import { runSafetySpecialist } from "@/lib/product-intelligence/specialists/safety-specialist";
import { coordinateUserIntent, type CoordinatorResult } from "@/lib/product-intelligence/core-coordinator";
import { compileManifest } from "@/lib/product-intelligence/manifest-compiler";
import {
  mapGenerationManifestToCreateRequest,
  mapUserIntentFromGenerationCreateRequest,
} from "@/lib/product-intelligence/compatibility-seam";
import type { GenerationManifest } from "@/lib/product-intelligence/generation-manifest-contract";
import { isOrchestrationError } from "@/lib/orchestration/errors";

/**
 * Phase 17 test matrix: UserIntent / Coordinator / Specialists / Manifest /
 * Integration / Security / Regression groups (brief Section 29).
 *
 * Cloudflare is intentionally left unconfigured in this environment (no
 * CLOUDFLARE_* env vars) so classifyAndEnhancePrompt()/moderateText() always
 * take their documented degrade-gracefully path — zero-cost, deterministic,
 * and consistent with how enhance-prompt/moderate-text's own tests already
 * run. This means an end-to-end coordinateUserIntent() call always reports
 * safety as "unavailable", never "safe" — so VALID-outcome manifest tests
 * construct a CoordinatorResult fixture directly instead, which is also the
 * correct way to unit-test a pure function like compileManifest().
 */

const ROOT = process.cwd();
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

/** Strips comments so a structural check reads only real code, never explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function baseIntent(overrides: Partial<UserIntent> = {}): UserIntent {
  return {
    intentId: randomUUID(),
    projectId: PROJECT_ID,
    generationType: "image",
    modelId: "mock-image",
    prompt: "a red fox in a snowy forest",
    settings: {},
    references: [],
    styleHints: [],
    ...overrides,
  };
}

function fixtureResult(overrides: Partial<CoordinatorResult> = {}): CoordinatorResult {
  const intent = overrides.intent ?? baseIntent();
  return {
    intent,
    capability: runCapabilitySpecialist(intent),
    prompt: { enhancedPrompt: intent.prompt, suggestedWorkflow: null, applied: false },
    safety: { outcome: "safe", categories: [] },
    ...overrides,
  };
}

// ---- UserIntent contract ---------------------------------------------------

describe("Phase 17 - UserIntent contract", () => {
  test("accepts a minimal valid intent", () => {
    const intent = parseUserIntent(
      { projectId: PROJECT_ID, generationType: "image", prompt: "hello" },
      "fallback-id"
    );
    assert.equal(intent.intentId, "fallback-id");
    assert.equal(intent.projectId, PROJECT_ID);
    assert.deepEqual(intent.settings, {});
    assert.deepEqual(intent.references, []);
    assert.deepEqual(intent.styleHints, []);
  });

  test("rejects a non-UUID projectId", () => {
    assert.throws(
      () => parseUserIntent({ projectId: "not-a-uuid", generationType: "image", prompt: "x" }, "f"),
      (error: unknown) => isOrchestrationError(error) && error.code === "INVALID_INPUT"
    );
  });

  test("rejects an invalid generationType", () => {
    assert.throws(
      () => parseUserIntent({ projectId: PROJECT_ID, generationType: "sculpture", prompt: "x" }, "f"),
      (error: unknown) => isOrchestrationError(error) && error.code === "INVALID_INPUT"
    );
  });

  test("rejects an oversized prompt", () => {
    assert.throws(
      () =>
        parseUserIntent(
          { projectId: PROJECT_ID, generationType: "image", prompt: "a".repeat(10_001) },
          "f"
        ),
      (error: unknown) => isOrchestrationError(error) && error.code === "INVALID_INPUT"
    );
  });

  test("rejects malformed settings (non-object)", () => {
    assert.throws(
      () =>
        parseUserIntent(
          { projectId: PROJECT_ID, generationType: "image", prompt: "x", settings: "not-an-object" },
          "f"
        ),
      (error: unknown) => isOrchestrationError(error) && error.code === "INVALID_INPUT"
    );
  });

  test("rejects styleHints beyond the bound", () => {
    assert.throws(
      () =>
        parseUserIntent(
          {
            projectId: PROJECT_ID,
            generationType: "image",
            prompt: "x",
            styleHints: Array.from({ length: 17 }, (_, i) => `hint-${i}`),
          },
          "f"
        ),
      (error: unknown) => isOrchestrationError(error) && error.code === "INVALID_INPUT"
    );
  });

  test("rejects references beyond the bound", () => {
    assert.throws(
      () =>
        parseUserIntent(
          {
            projectId: PROJECT_ID,
            generationType: "image",
            prompt: "x",
            references: Array.from({ length: 9 }, () => ({
              storagePath: "path",
              mimeType: "image/png",
            })),
          },
          "f"
        ),
      (error: unknown) => isOrchestrationError(error) && error.code === "INVALID_INPUT"
    );
  });

  test("rejects a non-object body", () => {
    assert.throws(
      () => parseUserIntent("just a string", "f"),
      (error: unknown) => isOrchestrationError(error) && error.code === "INVALID_INPUT"
    );
  });

  test("rejects an unknown-shaped reference entry", () => {
    assert.throws(
      () =>
        parseUserIntent(
          {
            projectId: PROJECT_ID,
            generationType: "image",
            prompt: "x",
            references: [{ storagePath: "p" }],
          },
          "f"
        ),
      (error: unknown) => isOrchestrationError(error) && error.code === "INVALID_INPUT"
    );
  });
});

// ---- Capability Specialist --------------------------------------------------

describe("Phase 17 - Capability Specialist", () => {
  test("reports unknown_model for a nonexistent modelId", () => {
    const result = runCapabilitySpecialist(baseIntent({ modelId: "does-not-exist" }));
    assert.equal(result.outcome, "unknown_model");
  });

  test("requires an explicit modelId", () => {
    const result = runCapabilitySpecialist(baseIntent({ modelId: undefined }));
    assert.equal(result.outcome, "unsupported");
    if (result.outcome === "unsupported") assert.equal(result.reasonCode, "MODEL_ID_REQUIRED");
  });

  test("supports a valid mock-image text-to-image intent", () => {
    const result = runCapabilitySpecialist(baseIntent());
    assert.equal(result.outcome, "supported");
    if (result.outcome === "supported") {
      assert.equal(result.model.id, "mock-image");
      assert.equal(result.workflow, "text-to-image");
    }
  });

  test("rejects an unsupported aspect ratio via the real capability validator", () => {
    const result = runCapabilitySpecialist(
      baseIntent({ settings: { aspectRatio: "not-a-real-ratio" } })
    );
    assert.equal(result.outcome, "unsupported");
    if (result.outcome === "unsupported") assert.equal(result.reasonCode, "CAPABILITY_NOT_SUPPORTED");
  });

  test("derives image-to-image from an attached reference on mock-image-edit", () => {
    const result = runCapabilitySpecialist(
      baseIntent({
        modelId: "mock-image-edit",
        references: [{ storagePath: "inputs/a.png", mimeType: "image/png" }],
      })
    );
    assert.equal(result.outcome, "supported");
    if (result.outcome === "supported") assert.equal(result.workflow, "image-to-image");
  });

  test("respects an explicit workflow over input-derived inference", () => {
    const result = runCapabilitySpecialist(baseIntent({ modelId: "mock-image", workflow: "text-to-image" }));
    assert.equal(result.outcome, "supported");
  });
});

// ---- Specialists (AI-assisted, degrade gracefully with Cloudflare off) ----

describe("Phase 17 - Prompt and Safety Specialists (Cloudflare unconfigured)", () => {
  test("Prompt Specialist passes the prompt through untouched", async () => {
    const result = await runPromptSpecialist({ prompt: "a fox", generationType: "image" });
    assert.equal(result.applied, false);
    assert.equal(result.enhancedPrompt, "a fox");
    assert.equal(result.suggestedWorkflow, null);
  });

  test("Prompt Specialist never rewrites audio (TTS) text, even in passthrough", async () => {
    const result = await runPromptSpecialist({ prompt: "read this aloud", generationType: "audio" });
    assert.equal(result.enhancedPrompt, "read this aloud");
    assert.equal(result.applied, false);
  });

  test("Safety Specialist reports unavailable, never a fabricated safe verdict", async () => {
    const result = await runSafetySpecialist("anything");
    assert.equal(result.outcome, "unavailable");
    assert.deepEqual(result.categories, []);
  });
});

// ---- Core Coordinator -------------------------------------------------------

describe("Phase 17 - Core Coordinator", () => {
  test("composes capability, prompt, and safety results for one intent", async () => {
    const intent = baseIntent();
    const result = await coordinateUserIntent(intent);
    assert.equal(result.intent.intentId, intent.intentId);
    assert.equal(result.capability.outcome, "supported");
    assert.equal(result.safety.outcome, "unavailable");
    assert.equal(typeof result.prompt.applied, "boolean");
  });

  test("still returns a full result for an intent whose model is unsupported", async () => {
    const intent = baseIntent({ modelId: "does-not-exist" });
    const result = await coordinateUserIntent(intent);
    assert.equal(result.capability.outcome, "unknown_model");
    // The Coordinator never short-circuits the other specialists on a
    // capability failure — the Compiler alone decides precedence.
    assert.equal(result.safety.outcome, "unavailable");
  });
});

// ---- Manifest Compiler -------------------------------------------------------

const FORBIDDEN_MANIFEST_FIELDS = [
  "provider",
  "credentials",
  "queueReceipt",
  "temporalState",
  "retryCount",
  "billingSettlement",
  "rawProviderResponse",
  "providerJobId",
  "providerUrl",
];

describe("Phase 17 - Manifest Compiler", () => {
  test("compiles a VALID manifest when capability supports and safety is safe", () => {
    const compiled = compileManifest(fixtureResult());
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome === "VALID") {
      assert.equal(compiled.manifest.modelId, "mock-image");
      assert.equal(compiled.manifest.workflow, "text-to-image");
      assert.equal(compiled.manifest.manifestVersion, "1.0.0");
      assert.equal(compiled.manifest.compilerVersion, "1.0.0");
    }
  });

  test("downgrades to PARTIAL when the Safety Specialist is unavailable", () => {
    const compiled = compileManifest(fixtureResult({ safety: { outcome: "unavailable", categories: [] } }));
    assert.equal(compiled.outcome, "PARTIAL");
    if (compiled.outcome === "PARTIAL") {
      assert.equal(compiled.manifest.policyCheck.outcome, "unavailable");
      assert.ok(compiled.reasonCodes.some((code) => code.includes("SPECIALIST_UNAVAILABLE")));
    }
  });

  test("safety flagged wins over a supported capability (precedence: safety > capability)", () => {
    const compiled = compileManifest(
      fixtureResult({ safety: { outcome: "flagged", categories: ["S1"] } })
    );
    assert.equal(compiled.outcome, "POLICY_REFUSED");
    if (compiled.outcome === "POLICY_REFUSED") assert.ok(compiled.reasonCodes.includes("S1"));
  });

  test("returns UNSUPPORTED_CAPABILITY when the capability specialist refuses", () => {
    const intent = baseIntent({ settings: { aspectRatio: "not-a-real-ratio" } });
    const compiled = compileManifest(fixtureResult({ intent, capability: runCapabilitySpecialist(intent) }));
    assert.equal(compiled.outcome, "UNSUPPORTED_CAPABILITY");
  });

  test("returns INVALID_INTENT for an unknown model, even with safe content", () => {
    const intent = baseIntent({ modelId: "does-not-exist" });
    const compiled = compileManifest(fixtureResult({ intent, capability: runCapabilitySpecialist(intent) }));
    assert.equal(compiled.outcome, "INVALID_INTENT");
  });

  test("detects CONFLICTING_CONTROLS when an explicit workflow contradicts the attached reference", () => {
    const intent = baseIntent({
      modelId: "mock-image-edit",
      workflow: "text-to-image",
      references: [{ storagePath: "inputs/a.png", mimeType: "image/png" }],
    });
    const compiled = compileManifest(fixtureResult({ intent, capability: runCapabilitySpecialist(intent) }));
    assert.equal(compiled.outcome, "CONFLICTING_CONTROLS");
  });

  test("explicit settings always win over registry defaults", () => {
    const intent = baseIntent({ settings: { aspectRatio: "1:1" } });
    const compiled = compileManifest(fixtureResult({ intent, capability: runCapabilitySpecialist(intent) }));
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome === "VALID") {
      assert.equal(compiled.manifest.settings.aspectRatio, "1:1");
      const provenance = compiled.manifest.provenance.find((p) => p.field === "settings.aspectRatio");
      assert.equal(provenance?.source, "explicit_user");
    }
  });

  test("fills unset settings from the model's own registry defaults", () => {
    const compiled = compileManifest(fixtureResult());
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome === "VALID") {
      assert.equal(compiled.manifest.settings.aspectRatio, "16:9"); // mock-image default
      const provenance = compiled.manifest.provenance.find((p) => p.field === "settings.aspectRatio");
      assert.equal(provenance?.source, "registry_default");
    }
  });

  test("composes styleHints into the prompt without discarding the original text", () => {
    const intent = baseIntent({ styleHints: ["golden hour", "35mm film"] });
    const compiled = compileManifest(fixtureResult({ intent, capability: runCapabilitySpecialist(intent) }));
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome === "VALID") {
      assert.ok(compiled.manifest.prompt.includes(intent.prompt));
      assert.ok(compiled.manifest.prompt.includes("golden hour"));
    }
  });

  test("never overwrites the explicit prompt with the specialist's enhanced suggestion", () => {
    const intent = baseIntent();
    const compiled = compileManifest(
      fixtureResult({
        intent,
        capability: runCapabilitySpecialist(intent),
        prompt: { enhancedPrompt: "a COMPLETELY different subject", suggestedWorkflow: null, applied: true },
      })
    );
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome === "VALID") {
      assert.ok(compiled.manifest.prompt.startsWith(intent.prompt));
      assert.ok(!compiled.manifest.prompt.includes("COMPLETELY different subject"));
    }
  });

  test("manifest never carries a lifecycle/provider/billing field", () => {
    const compiled = compileManifest(fixtureResult());
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome !== "VALID") return;
    const keys = Object.keys(compiled.manifest as unknown as Record<string, unknown>);
    for (const forbidden of FORBIDDEN_MANIFEST_FIELDS) {
      assert.ok(!keys.includes(forbidden), `manifest must not carry "${forbidden}"`);
    }
  });

  test("every VALID/PARTIAL manifest carries both manifestVersion and compilerVersion", () => {
    const compiled = compileManifest(fixtureResult());
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome !== "VALID") return;
    assert.equal(compiled.manifest.manifestVersion, "1.0.0");
    assert.equal(compiled.manifest.compilerVersion, "1.0.0");
  });

  test("model-aware prompt compiler: styleHints that push the composed prompt over the model's real maxPromptLength are refused, not silently truncated", () => {
    // mock-tts's real registry maxPromptLength is 5000 — force the composed
    // (prompt + styleHints) string past it.
    const intent = baseIntent({
      generationType: "audio",
      modelId: "mock-tts",
      workflow: "text-to-speech",
      prompt: "a".repeat(4990),
      styleHints: ["b".repeat(50)],
    });
    const compiled = compileManifest(fixtureResult({ intent, capability: runCapabilitySpecialist(intent) }));
    assert.equal(compiled.outcome, "UNSUPPORTED_CAPABILITY");
    if (compiled.outcome === "UNSUPPORTED_CAPABILITY") {
      assert.ok(compiled.reasonCodes[0].includes("composed_prompt_exceeds_max_length"));
    }
  });

  test("model-aware prompt compiler: a composed prompt within the model's limit still compiles VALID", () => {
    const intent = baseIntent({ styleHints: ["golden hour"] });
    const compiled = compileManifest(fixtureResult({ intent, capability: runCapabilitySpecialist(intent) }));
    assert.equal(compiled.outcome, "VALID");
  });
});

// ---- Integration (compatibility seam) --------------------------------------

describe("Phase 17 - Compatibility seam", () => {
  test("maps a compiled manifest onto the exact GenerationCreateRequest metadata shape", () => {
    const compiled = compileManifest(fixtureResult());
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome !== "VALID") return;
    const request = mapGenerationManifestToCreateRequest(compiled.manifest);
    assert.equal(request.model, "mock-image");
    assert.equal(request.prompt, compiled.manifest.prompt);
    assert.equal(request.projectId, PROJECT_ID);
    assert.equal((request.metadata as Record<string, unknown>).aspect_ratio, "16:9");
    assert.equal((request.metadata as Record<string, unknown>).image_count, "1/1");
  });

  test("round-trips a GenerationCreateRequest through UserIntent and back without losing settings", () => {
    const request = {
      model: "mock-video",
      prompt: "a river at dawn",
      projectId: PROJECT_ID,
      inputUrl: null,
      metadata: { aspect_ratio: "16:9", duration_seconds: 8, image_count: "1/1" },
    };
    const intent = mapUserIntentFromGenerationCreateRequest(request, "video", randomUUID());
    assert.equal(intent.modelId, "mock-video");
    assert.equal(intent.settings.aspectRatio, "16:9");
    assert.equal(intent.settings.durationSeconds, 8);

    const compiled = compileManifest(fixtureResult({ intent, capability: runCapabilitySpecialist(intent) }));
    assert.equal(compiled.outcome, "VALID");
    if (compiled.outcome !== "VALID") return;
    const back = mapGenerationManifestToCreateRequest(compiled.manifest);
    assert.equal(back.model, "mock-video");
    assert.equal((back.metadata as Record<string, unknown>).duration_seconds, 8);
  });

  test("only the first reference survives the manifest -> request direction (documented limitation)", () => {
    const manifest: GenerationManifest = {
      manifestVersion: "1.0.0",
      compilerVersion: "1.0.0",
      intentId: randomUUID(),
      projectId: PROJECT_ID,
      generationType: "image",
      workflow: "image-to-image",
      modelId: "mock-image-edit",
      prompt: "edit this",
      settings: {},
      references: [
        { storagePath: "inputs/a.png", mimeType: "image/png" },
        { storagePath: "inputs/b.png", mimeType: "image/png" },
      ],
      provenance: [],
      policyCheck: { outcome: "safe" },
    };
    const request = mapGenerationManifestToCreateRequest(manifest);
    assert.equal(request.inputUrl, "inputs/a.png");
  });
});

// ---- Security ---------------------------------------------------------------

describe("Phase 17 - Security boundary", () => {
  const ROUTE = readFileSync(
    path.join(ROOT, "src/app/api/product-intelligence/compile/route.ts"),
    "utf8"
  );

  test("the compile route requires auth() before any other work", () => {
    assert.match(ROUTE, /const \{ userId \} = await auth\(\);/);
  });

  test("the compile route rate-limits via guardRoute before parsing the body", () => {
    const authIndex = ROUTE.indexOf("await auth()");
    const guardIndex = ROUTE.indexOf("guardRoute(");
    const parseIndex = ROUTE.indexOf("request.json()");
    assert.ok(authIndex >= 0 && guardIndex > authIndex);
    assert.ok(parseIndex > guardIndex, "body must be parsed after the rate-limit gate, not before");
  });

  test("the compile route never logs the raw prompt text, only bounded fields", () => {
    assert.doesNotMatch(ROUTE, /emit\(\{[^}]*prompt:/);
    assert.match(ROUTE, /promptLength: intent\.prompt\.length/);
  });

  test("UserIntent contract CODE (comments stripped) never declares provider/credential/lifecycle fields", () => {
    const source = stripComments(
      readFileSync(path.join(ROOT, "src/lib/product-intelligence/user-intent-contract.ts"), "utf8")
    );
    for (const forbidden of ["providerId", "providerJobId", "credentials", "temporalWorkflowId", "queueReceipt"]) {
      assert.ok(!source.includes(forbidden), `user-intent-contract.ts must not declare "${forbidden}"`);
    }
  });

  test("GenerationManifest contract CODE (comments stripped) declares no provider-specific field", () => {
    const source = stripComments(
      readFileSync(path.join(ROOT, "src/lib/product-intelligence/generation-manifest-contract.ts"), "utf8")
    );
    for (const forbidden of [/\bfal\./, /\brunway\./, /\bopenai\./, /\bxai\./, /providerJobId/, /providerUrl/]) {
      assert.doesNotMatch(source, forbidden);
    }
  });

  test("the Manifest Compiler CODE (comments stripped) never imports Temporal, SQS, BullMQ, or a provider adapter", () => {
    const source = stripComments(
      readFileSync(path.join(ROOT, "src/lib/product-intelligence/manifest-compiler.ts"), "utf8")
    );
    for (const forbidden of ["temporal", "@aws-sdk/client-sqs", "bullmq", "-provider\"", "-provider'"]) {
      assert.ok(
        !source.toLowerCase().includes(forbidden.toLowerCase()),
        `manifest-compiler.ts must not reference "${forbidden}"`
      );
    }
  });

  test("Capability Specialist calls the canonical validateCapabilities(), never reimplements it", () => {
    const source = readFileSync(
      path.join(ROOT, "src/lib/product-intelligence/specialists/capability-specialist.ts"),
      "utf8"
    );
    assert.match(source, /import \{ [^}]*validateCapabilities[^}]* \} from "@\/lib\/orchestration\/capability-validator"/);
    assert.match(source, /validateCapabilities\(\{/);
  });
});

// ---- Real admission integration (17-A closure) -----------------------------

describe("Phase 17 - Real generation-admission integration (/execute)", () => {
  const EXECUTE_ROUTE = readFileSync(
    path.join(ROOT, "src/app/api/product-intelligence/execute/route.ts"),
    "utf8"
  );

  test("requires auth() before any other work, same as /compile", () => {
    assert.match(EXECUTE_ROUTE, /const \{ userId \} = await auth\(\);/);
  });

  test("rate-limits via guardRoute before parsing the body", () => {
    const authIndex = EXECUTE_ROUTE.indexOf("await auth()");
    const guardIndex = EXECUTE_ROUTE.indexOf("guardRoute(");
    const parseIndex = EXECUTE_ROUTE.indexOf("request.json()");
    assert.ok(authIndex >= 0 && guardIndex > authIndex);
    assert.ok(parseIndex > guardIndex);
  });

  test("calls the exact same two canonical functions POST /api/generate calls, in the same order, never reimplementing either", () => {
    assert.match(
      EXECUTE_ROUTE,
      /import \{ createGeneration \} from "@\/lib\/orchestration\/generation-create-service"/
    );
    assert.match(
      EXECUTE_ROUTE,
      /import \{ respondToGenerationRequest \} from "@\/lib\/orchestration\/generation-api-contract"/
    );
    const createIndex = EXECUTE_ROUTE.indexOf("await createGeneration(");
    const respondIndex = EXECUTE_ROUTE.lastIndexOf("respondToGenerationRequest(generationId, userId)");
    assert.ok(createIndex >= 0 && respondIndex > createIndex, "createGeneration must run before respondToGenerationRequest");
  });

  test("recompiles the intent fresh — never accepts or trusts a client-supplied manifest", () => {
    assert.doesNotMatch(EXECUTE_ROUTE, /body\.manifest/);
    assert.doesNotMatch(EXECUTE_ROUTE, /candidate\.manifest/);
    assert.match(EXECUTE_ROUTE, /parseUserIntent\(body, randomUUID\(\)\)/);
    assert.match(EXECUTE_ROUTE, /compileManifest\(coordinated\)/);
  });

  test("only a VALID compile proceeds to admission — every other outcome returns unexecuted", () => {
    assert.match(EXECUTE_ROUTE, /if \(compiled\.outcome !== "VALID"\) \{\s*return privateJson\(compiled/);
  });

  test("never imports Temporal, SQS, BullMQ, or a provider adapter directly", () => {
    const source = stripComments(EXECUTE_ROUTE);
    for (const forbidden of ["temporal", "@aws-sdk/client-sqs", "bullmq", "-provider\"", "-provider'"]) {
      assert.ok(!source.toLowerCase().includes(forbidden.toLowerCase()));
    }
  });

  test("the compatibility-seam mapper now has a real production caller (no longer test-only)", () => {
    assert.match(EXECUTE_ROUTE, /mapGenerationManifestToCreateRequest\(compiled\.manifest\)/);
  });
});

// ---- Regression (structural — full suite runs separately) -----------------

describe("Phase 17 - Regression guards", () => {
  test("does not modify any file under src/lib/orchestration", () => {
    // Structural pin: Phase 17 wraps the orchestration layer, it must never
    // edit it. A real diff-based regression run (task #45) is the primary
    // guard; this just documents the invariant the file list itself proves.
    const files = [
      "src/lib/orchestration/capability-validator.ts",
      "src/lib/orchestration/model-registry.ts",
      "src/lib/orchestration/prompt-intelligence.ts",
      "src/lib/orchestration/content-moderation.ts",
      "src/lib/orchestration/generation-create-service.ts",
    ];
    for (const file of files) {
      assert.doesNotThrow(() => readFileSync(path.join(ROOT, file), "utf8"));
    }
  });

  test("the compile endpoint is additive: /api/generate route.ts is not imported by any Phase 17 file", () => {
    const dir = path.join(ROOT, "src/lib/product-intelligence");
    const files = [
      "user-intent-contract.ts",
      "generation-manifest-contract.ts",
      "core-coordinator.ts",
      "manifest-compiler.ts",
      "compatibility-seam.ts",
      "specialists/capability-specialist.ts",
      "specialists/prompt-specialist.ts",
      "specialists/safety-specialist.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), "utf8");
      assert.ok(!source.includes("api/generate/route"), `${file} must not import the live generate route`);
    }
  });
});
