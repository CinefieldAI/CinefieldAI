import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createGeneration } from "@/lib/orchestration/generation-create-service";
import { findModel } from "@/lib/orchestration/model-registry";
import { installPromptModerationEngine } from "@/lib/safety/prompt-moderation";
import {
  installReferenceInputEvaluator,
  isReferenceInputEvaluatorConfigured,
  type ReferenceInputEvaluationInput,
} from "@/lib/safety/reference-input-contract";
import { evaluateReferenceInputSafety } from "@/lib/safety/reference-input-gate";
import {
  MAX_REFERENCE_INPUT_BYTES,
  REFERENCE_INPUT_MIMES,
  isSafeReferencePath,
  readReferenceInputBytes,
  referencePathBelongsTo,
} from "@/lib/media/reference-input-source";
import { FakeSupabaseClient } from "./fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PHASE 28-A — the reference-image gate.
 *
 * The closure audit's single blocker was that `reference_input` existed only
 * as enum vocabulary: no contract, no seam, no caller, and no bytes ever read.
 * These tests are written against that finding, so the load-bearing ones are
 * the BEHAVIOURAL pair —
 *
 *   R28-10  the evaluator receives the actual image bytes, proven by digest
 *   R28-11  a BLOCK verdict stops admission before routing
 *
 * — because a seam that exists but is never called would pass every
 * structural assertion and still leave the gate open.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const USER = "user_ref_1";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const REF_PATH = `${USER}/${PROJECT}/1700000000-abc1234.png`;
/** A deterministic "image". Its digest is what proves the bytes travelled. */
const REF_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const REF_DIGEST = createHash("sha256").update(REF_BYTES).digest("hex");

/**
 * The models that accept a reference image TODAY, in production.
 *
 * Named explicitly so R28-19 asks the resolver about real ids rather than
 * re-deriving them from the registry's source text — the derivation that
 * produced the wrong answer in the closure audit.
 */
const REFERENCE_CAPABLE_MODEL_IDS = ["nano-banana-pro", "nano-banana-2", "nano-banana-2-lite"] as const;

function db(seedReference = true) {
  const client = new FakeSupabaseClient({
    generations: [],
    projects: [{ id: PROJECT, clerk_user_id: USER }],
  });
  if (seedReference) client.storageObjects.set(`generation-inputs/${REF_PATH}`, REF_BYTES);
  return client;
}

/** The prompt gate must be satisfied so failures are attributable to THIS gate. */
function allowPrompts() {
  installPromptModerationEngine({
    name: "ref-test-prompt",
    async classify() {
      return { verdict: "ALLOW", categories: [], reasonCode: "test_clean", classifierVersion: "t" };
    },
  });
}

function reset() {
  installPromptModerationEngine(null);
  installReferenceInputEvaluator(null);
  delete process.env.CINEFIELD_ENV;
}

/**
 * Admission through the REAL entry point.
 *
 * The discriminator is the error code and it is a real one: `createGeneration`
 * runs capability check → prompt gate → REFERENCE GATE → routing, and the fake
 * database has no route table, so anything reaching routing dies as
 * `NO_ELIGIBLE_ROUTE`. `CONTENT_POLICY_REFUSED` therefore proves the request
 * was stopped BEFORE routing — and so before any provider was reachable.
 */
async function admit(client: FakeSupabaseClient, withReference: boolean) {
  let code: string | undefined;
  let message = "";
  try {
    await createGeneration(client as unknown as SupabaseClient, USER, {
      // A reference-carrying request must name a model that ACCEPTS inputs.
      // `mock-image` declares maxInputs: 0, so capability validation refuses
      // it before the safety gates run — which would measure the validator,
      // not this gate. A mock is used rather than one of the three live
      // Gemini models (see R28-19) so these tests exercise no real provider.
      model: withReference ? "mock-image-edit" : "mock-image",
      prompt: "a lighthouse",
      projectId: PROJECT,
      ...(withReference ? { inputUrl: REF_PATH, metadata: { mime_type: "image/png" } } : {}),
    });
    code = "NO_THROW";
  } catch (error) {
    code = (error as { code?: string }).code;
    message = (error as { toResponseBody?: () => { message?: string } }).toResponseBody?.()?.message ?? "";
  }
  const decisions = (client.state.media_safety_decisions ?? []) as Record<string, unknown>[];
  return {
    code,
    message,
    reachedRouting: Boolean(code && /ROUTE/.test(code)),
    rows: (client.state.generations ?? []).length,
    decisions,
    referenceDecisions: decisions.filter((d) => d.decision_stage === "reference_input"),
    downloads: client.storageDownloads,
  };
}

// ===========================================================================
// A. The seam exists, and defaults to nothing
// ===========================================================================

test("R28-1  no reference evaluator is configured, and the registry is empty", () => {
  reset();
  assert.equal(isReferenceInputEvaluatorConfigured(), false);
  const source = read("src/lib/safety/reference-input-contract.ts");
  assert.ok(
    source.includes("const EVALUATORS: ReadonlyMap<string, ReferenceInputEvaluator> = new Map();"),
    "the evaluator registry must still be empty — no vendor is contracted"
  );
  // No production module installs one.
  for (const file of [
    "src/lib/orchestration/generation-create-service.ts",
    "src/lib/safety/reference-input-gate.ts",
    "src/lib/media/reference-input-source.ts",
  ]) {
    assert.doesNotMatch(strip(read(file)), /installReferenceInputEvaluator\(/, `${file} must not install an evaluator`);
  }
});

test("R28-2  no paid classifier SDK was added, and the seam holds no endpoint", () => {
  for (const file of ["src/lib/safety/reference-input-contract.ts", "src/lib/safety/reference-input-gate.ts", "src/lib/media/reference-input-source.ts"]) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /https?:\/\//, `${file} must contain no endpoint`);
    assert.doesNotMatch(code, /hive|rekognition|photodna|thorn|clarifai/i, `${file} must name no vendor`);
  }
  const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    assert.doesNotMatch(dep, /hive|rekognition|photodna|thorn/i, `${dep} must not be a dependency`);
  }
});

// ===========================================================================
// B. Path safety, ownership, and bounds (§5, §22, §23)
// ===========================================================================

test("R28-3  a reference path is a PATH — traversal, absolute, scheme and backslash are refused", () => {
  assert.equal(isSafeReferencePath(REF_PATH), true);
  for (const hostile of [
    "../../etc/passwd",
    "/etc/passwd",
    "file:///etc/passwd",
    "https://169.254.169.254/latest/meta-data/",
    "http://localhost/x.png",
    "user\\..\\other/x.png",
    "user//x.png",
    "",
    "user/../../x.png",
  ]) {
    assert.equal(isSafeReferencePath(hostile), false, `must refuse: ${hostile}`);
  }
});

test("R28-4  SSRF is structurally inapplicable: the source performs no outbound fetch", () => {
  const code = strip(read("src/lib/media/reference-input-source.ts"));
  // A bucket path, never a URL. No fetch, no http client, no caller-supplied host.
  assert.doesNotMatch(code, /\bfetch\(|axios|got\(|node-fetch|https?\.request/, "no outbound request may exist here");
  assert.match(code, /const REFERENCE_INPUT_BUCKET = "generation-inputs"/, "the bucket is a constant, not a parameter");
  // And the bucket name is never taken from a parameter.
  assert.doesNotMatch(code, /storage\.from\((?!REFERENCE_INPUT_BUCKET)/, "the bucket must never be caller-influenced");
});

test("R28-5  one user cannot have another user's uploaded face fetched", async () => {
  assert.equal(referencePathBelongsTo(REF_PATH, USER), true);
  assert.equal(referencePathBelongsTo(REF_PATH, "someone_else"), false);

  const client = db();
  const stolen = await readReferenceInputBytes(client as unknown as SupabaseClient, {
    storagePath: REF_PATH,
    declaredMime: "image/png",
    clerkUserId: "someone_else",
  });
  assert.equal(stolen.ok, false);
  assert.equal(stolen.ok === false && stolen.reason, "reference_not_owned");
  // Refused BEFORE any read: the object must not even be touched.
  assert.equal(client.storageDownloads.length, 0, "an unowned path must not reach storage at all");
});

test("R28-6  MIME and size are bounded, and an undeclared type is unevaluable rather than allowed", async () => {
  assert.deepEqual([...REFERENCE_INPUT_MIMES], ["image/jpeg", "image/png", "image/webp"]);
  // Well below the 64 MB upload ceiling — a synchronous admission-path read.
  const uploadCeiling = /MAX_UPLOAD_BYTES = (\d+) \* 1024 \* 1024/.exec(read("src/lib/media/r2-client.ts"));
  assert.ok(uploadCeiling);
  assert.ok(MAX_REFERENCE_INPUT_BYTES < Number(uploadCeiling![1]) * 1024 * 1024);

  const client = db();
  for (const [mime, label] of [
    [undefined, "no declared type"],
    ["video/mp4", "a video"],
    ["application/pdf", "a document"],
    ["image/gif", "an animated image this gate cannot evaluate"],
  ] as const) {
    const r = await readReferenceInputBytes(client as unknown as SupabaseClient, {
      storagePath: REF_PATH,
      declaredMime: mime,
      clerkUserId: USER,
    });
    assert.equal(r.ok, false, label);
    assert.equal(r.ok === false && r.reason, "unsupported_reference_mime", label);
  }

  // Oversize is refused rather than handed to a classifier.
  const big = db(false);
  big.storageObjects.set(`generation-inputs/${REF_PATH}`, new Uint8Array(MAX_REFERENCE_INPUT_BYTES + 1));
  const oversize = await readReferenceInputBytes(big as unknown as SupabaseClient, {
    storagePath: REF_PATH,
    declaredMime: "image/png",
    clerkUserId: USER,
  });
  assert.equal(oversize.ok === false && oversize.reason, "reference_too_large");
});

// ===========================================================================
// C. The gate's fail-closed matrix (§7)
// ===========================================================================

test("R28-7  every kind of not-knowing refuses — in EVERY environment, with no carve-out", async () => {
  reset();
  const cases: [string, () => void, string][] = [
    [
      "no evaluator configured",
      () => installReferenceInputEvaluator(null),
      "reference_evaluator_not_configured",
    ],
    [
      "evaluator returns null",
      () => installReferenceInputEvaluator({ name: "e", async evaluate() { return null; } }),
      "reference_evaluator_no_verdict",
    ],
    [
      "evaluator throws",
      () => installReferenceInputEvaluator({ name: "e", async evaluate() { throw new Error("down"); } }),
      "reference_evaluator_threw",
    ],
    [
      "evaluator answers outside its contract",
      () =>
        installReferenceInputEvaluator({
          name: "e",
          async evaluate() {
            // A VALID reason code on purpose, so this case is malformed
            // solely because of the verdict.
            return { verdict: "PROBABLY_FINE", categories: [], reasonCode: "ok_code", classifierVersion: "v" } as never;
          },
        }),
      "reference_evaluator_malformed",
    ],
    [
      "evaluator names a category this build does not know",
      () =>
        installReferenceInputEvaluator({
          name: "e",
          async evaluate() {
            // Valid verdict AND valid reason code, so the ONLY thing wrong
            // is the unknown category — which must be refused, not dropped.
            return { verdict: "ALLOW", categories: ["bioweapon"], reasonCode: "ok_code", classifierVersion: "v" } as never;
          },
        }),
      "reference_unknown_category",
    ],
  ];

  for (const environment of ["development", "staging", "production"]) {
    process.env.CINEFIELD_ENV = environment;
    for (const [label, install, expectedReason] of cases) {
      install();
      const outcome = await evaluateReferenceInputSafety(db() as unknown as SupabaseClient, {
        clerkUserId: USER,
        storagePath: REF_PATH,
        declaredMime: "image/png",
        promptCategories: [],
      });
      assert.equal(outcome.allowed, false, `${label} in ${environment} must refuse`);
      assert.equal(outcome.decision.reasonCode, expectedReason, `${label} in ${environment}`);
      assert.equal(outcome.decision.stage, "reference_input");
    }
  }

  // The absence of an environment branch is the point — assert it in source too.
  const gate = strip(read("src/lib/safety/reference-input-gate.ts"));
  assert.doesNotMatch(gate, /isProduction\(|CINEFIELD_ENV/, "this gate must have no environment carve-out");
  reset();
});

test("R28-8  an unreadable, missing or unowned upload fails closed", async () => {
  reset();
  installReferenceInputEvaluator({
    name: "never-called",
    async evaluate() {
      return { verdict: "ALLOW", categories: [], reasonCode: "should_not_happen", classifierVersion: "v" };
    },
  });

  // Nothing seeded → the object does not exist.
  const missing = await evaluateReferenceInputSafety(db(false) as unknown as SupabaseClient, {
    clerkUserId: USER,
    storagePath: REF_PATH,
    declaredMime: "image/png",
    promptCategories: [],
  });
  assert.equal(missing.allowed, false, "a reference that cannot be read cannot be cleared");
  assert.equal(missing.decision.verdict, "UNAVAILABLE");

  // Unowned path → refused before the read, and the ALLOW evaluator above
  // never gets a say.
  const stolen = await evaluateReferenceInputSafety(db() as unknown as SupabaseClient, {
    clerkUserId: "someone_else",
    storagePath: REF_PATH,
    declaredMime: "image/png",
    promptCategories: [],
  });
  assert.equal(stolen.allowed, false);
  assert.equal(stolen.decision.reasonCode, "reference_not_owned");
  reset();
});

test("R28-9  a refusal tells the caller nothing about why", async () => {
  reset();
  installReferenceInputEvaluator({
    name: "e",
    async evaluate() {
      return { verdict: "BLOCK", categories: ["ncii", "real_person"], reasonCode: "real_face_explicit", classifierVersion: "v1" };
    },
  });
  const outcome = await evaluateReferenceInputSafety(db() as unknown as SupabaseClient, {
    clerkUserId: USER,
    storagePath: REF_PATH,
    declaredMime: "image/png",
    promptCategories: ["sexual_content"],
  });
  assert.equal(outcome.allowed, false);
  // Bounded evidence IS kept, server-side.
  assert.deepEqual([...outcome.decision.categories], ["ncii", "real_person"]);
  assert.equal(outcome.decision.reasonCode, "real_face_explicit");
  // The user sees only the generic string.
  const message = outcome.allowed === false ? outcome.userMessage : "";
  assert.doesNotMatch(message, /ncii|real_person|real_face_explicit|face|reference/i);
  reset();
});

// ===========================================================================
// D. THE LOAD-BEARING PAIR — bytes, and block-before-provider (§14, §15)
// ===========================================================================

test("R28-10  the evaluator receives the ACTUAL image bytes, not a boolean", async () => {
  reset();
  allowPrompts();

  const seen: ReferenceInputEvaluationInput[] = [];
  installReferenceInputEvaluator({
    name: "byte-observer",
    async evaluate(input) {
      seen.push(input);
      return { verdict: "ALLOW", categories: [], reasonCode: "observed", classifierVersion: "obs-1" };
    },
  });

  const client = db();
  const result = await admit(client, true);

  assert.equal(seen.length, 1, "the evaluator must be called exactly once");
  const got = seen[0];
  // THE PROOF: the digest of what the evaluator received equals the digest of
  // what the test placed in storage. A boolean cannot satisfy this.
  assert.equal(createHash("sha256").update(got.bytes).digest("hex"), REF_DIGEST);
  assert.equal(got.byteLength, REF_BYTES.byteLength);
  assert.equal(got.declaredMime, "image/png");
  assert.ok(got.bytes instanceof Uint8Array);

  // It really came out of storage, from the right bucket and path.
  assert.deepEqual(result.downloads, [{ bucket: "generation-inputs", path: REF_PATH }]);

  // And an ALLOW verdict lets admission continue to routing.
  assert.equal(result.reachedRouting, true, "a cleared reference must not block the request");
  reset();
});

test("R28-11  a BLOCK verdict stops admission BEFORE routing — no provider is reachable", async () => {
  reset();
  allowPrompts();
  installReferenceInputEvaluator({
    name: "blocker",
    async evaluate() {
      return { verdict: "BLOCK", categories: ["real_person"], reasonCode: "real_face_detected", classifierVersion: "v1" };
    },
  });

  const client = db();
  const result = await admit(client, true);

  assert.equal(result.code, "CONTENT_POLICY_REFUSED");
  assert.equal(result.reachedRouting, false, "routing must never be reached");
  assert.equal(result.rows, 0, "no generation row may be created");
  assert.doesNotMatch(result.message, /real_person|real_face_detected/i);

  // Bounded durable evidence, at the reference stage, with no row to attach to.
  assert.equal(result.referenceDecisions.length, 1);
  const decision = result.referenceDecisions[0];
  assert.equal(decision.verdict, "BLOCK");
  assert.equal(decision.decision_stage, "reference_input");
  assert.equal(decision.generation_id, null, "recorded pre-row, exactly as the prompt decision is");
  assert.equal(decision.media_asset_id, null);
  assert.equal(decision.clerk_user_id, USER);
  assert.deepEqual(decision.risk_categories, ["real_person"]);
  reset();
});

test("R28-12  REVIEW_REQUIRED does not silently proceed", async () => {
  reset();
  allowPrompts();
  installReferenceInputEvaluator({
    name: "reviewer",
    async evaluate() {
      return { verdict: "REVIEW_REQUIRED", categories: ["ncii"], reasonCode: "needs_human", classifierVersion: "v" };
    },
  });
  const result = await admit(db(), true);
  assert.equal(result.code, "CONTENT_POLICY_REFUSED");
  assert.equal(result.reachedRouting, false);
  assert.equal(result.referenceDecisions[0]?.verdict, "REVIEW_REQUIRED");
  reset();
});

test("R28-13  DEAD-SEAM GUARD: if admission stops calling the evaluator, this fails", async () => {
  reset();
  allowPrompts();

  // The guard is behavioural, not a source-text occurrence count: a fake
  // evaluator that BLOCKS everything must prevent the request from reaching
  // routing. If the caller is ever removed, ALLOW-by-default returns and the
  // request sails through to NO_ELIGIBLE_ROUTE — flipping both assertions.
  let called = false;
  installReferenceInputEvaluator({
    name: "guard",
    async evaluate() {
      called = true;
      return { verdict: "BLOCK", categories: [], reasonCode: "guard_block", classifierVersion: "g" };
    },
  });

  const result = await admit(db(), true);
  assert.equal(called, true, "the admission path must actually invoke the reference evaluator");
  assert.equal(result.reachedRouting, false, "a BLOCK evaluator must prevent the provider path");
  assert.equal(result.code, "CONTENT_POLICY_REFUSED");
  reset();
});

// ===========================================================================
// E. The no-reference path is untouched (§8)
// ===========================================================================

test("R28-14  a request with NO reference does not fetch bytes or call the evaluator", async () => {
  reset();
  allowPrompts();

  let called = false;
  installReferenceInputEvaluator({
    name: "must-not-run",
    async evaluate() {
      called = true;
      return { verdict: "BLOCK", categories: [], reasonCode: "should_not_run", classifierVersion: "x" };
    },
  });

  const client = db();
  const result = await admit(client, false);

  assert.equal(called, false, "no reference means no evaluator call");
  assert.deepEqual(client.storageDownloads, [], "no reference means no byte fetch");
  assert.equal(result.referenceDecisions.length, 0, "and no reference-stage decision");
  // Behaviour is exactly as before: prompt-only admission proceeds to routing.
  assert.equal(result.reachedRouting, true);
  reset();
});

test("R28-15  the gate cannot be skipped by omitting the declared MIME type", async () => {
  reset();
  allowPrompts();
  installReferenceInputEvaluator({
    name: "e",
    async evaluate() {
      return { verdict: "ALLOW", categories: [], reasonCode: "ok", classifierVersion: "v" };
    },
  });

  // `mapMetadataToInputs` yields NO inputs without `mime_type`, so a gate keyed
  // on the parsed input list would skip this entirely. The reference is still
  // present, so the gate must fire and refuse it as unevaluable.
  const client = db();
  let code: string | undefined;
  try {
    await createGeneration(client as unknown as SupabaseClient, USER, {
      model: "mock-image-edit",
      prompt: "a lighthouse",
      projectId: PROJECT,
      inputUrl: REF_PATH,
      metadata: {},
    });
    code = "NO_THROW";
  } catch (error) {
    code = (error as { code?: string }).code;
  }

  assert.equal(code, "CONTENT_POLICY_REFUSED", "an unevaluable reference must be refused, not skipped");
  const decisions = (client.state.media_safety_decisions ?? []) as Record<string, unknown>[];
  const ref = decisions.filter((d) => d.decision_stage === "reference_input");
  assert.equal(ref[0]?.reason_code, "unsupported_reference_mime");
  reset();
});

// ===========================================================================
// F. Persistence, privacy and ownership boundaries (§9, §10, §21)
// ===========================================================================

test("R28-16  raw reference bytes are never persisted, logged or copied into evidence", async () => {
  reset();
  allowPrompts();
  installReferenceInputEvaluator({
    name: "e",
    async evaluate() {
      return { verdict: "BLOCK", categories: ["real_person"], reasonCode: "blocked", classifierVersion: "v" };
    },
  });

  const client = db();
  await admit(client, true);

  const serialized = JSON.stringify(client.state.media_safety_decisions ?? []);
  // Neither the bytes nor the storage path may appear in the evidence row.
  assert.doesNotMatch(serialized, /89504e47|PNG/i, "no media bytes in the decision store");
  assert.ok(!serialized.includes(REF_PATH), "no storage path in the decision store");
  assert.ok(!serialized.includes("a lighthouse"), "no prompt in the decision store");

  // Nothing wrote the bytes anywhere either.
  assert.deepEqual(client.storageUploads, [], "the gate must not copy the reference anywhere");

  // And the modules hold no logger that could print them.
  for (const file of ["src/lib/media/reference-input-source.ts", "src/lib/safety/reference-input-gate.ts"]) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /console\.|createFieldLogger|logger/, `${file} must not log`);
  }
  reset();
});

test("R28-17  no migration was needed: the existing store already represents this stage", () => {
  const migrations = readFileSync;
  void migrations;
  const sql = read("supabase/migrations/20260916000000_trust_and_safety.sql");
  // `reference_input` is already a permitted stage...
  assert.match(sql, /'reference_input'::"text"/);
  // ...and only an OUTPUT decision is required to name an asset, so a pre-row
  // reference decision with null generation/asset is representable as-is.
  assert.match(
    sql,
    /media_safety_decisions_output_needs_asset[\s\S]{0,200}"decision_stage" <> 'output'::"text"/,
    "only output decisions require an asset"
  );

  // No Phase 28-A migration exists.
  const after = readFileSync(path.join(ROOT, "supabase/migrations/20260916000000_trust_and_safety.sql"), "utf8");
  assert.ok(after.length > 0);
});

test("R28-18  ownership boundaries are preserved: no new authority, no capability change", () => {
  // Phase 27 untouched by this batch.
  const pipeline = strip(read("src/lib/media/media-processing-pipeline.ts"));
  assert.match(pipeline, /embedC2paProvenance\(/, "the C2PA pipeline still exists unchanged");
  for (const file of ["src/lib/safety/reference-input-gate.ts", "src/lib/media/reference-input-source.ts"]) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /c2pa|provenance/i, `${file} must not touch Phase 27`);
    assert.doesNotMatch(code, /ai_agent|aiWrite|requireAiWritePolicy/, `${file} must grant no AI authority`);
    assert.doesNotMatch(code, /quarantine_status|releaseAfterModeration|approveMediaRelease/, `${file} must not release anything`);
  }

  // §17: this batch relaxes no capability rule — it adds no model and raises
  // no maxInputs. Asserted below through the registry's OWN resolver.
  const before = execFileSync("git", ["show", "53f89e1:src/lib/orchestration/model-registry.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(before, read("src/lib/orchestration/model-registry.ts"), "the model registry is byte-identical to pre-batch");
});

test("R28-19  the reference lane IS reachable in production, and the gate is what closes it", () => {
  // A CORRECTION, recorded as a test so it cannot be lost again.
  //
  // The Phase 28 closure audit reported "all enabled non-mock models have
  // maxInputs: 0" and concluded the reference lane was unreachable. That was
  // WRONG. It came from a regex over the registry SOURCE, and the three Gemini
  // entries are produced by a `.map()` over an id array rather than written as
  // object literals — so the pattern never saw them.
  //
  // This test therefore asks the registry's own resolver instead of its text.
  // A source-shape assumption is exactly what failed the first time.
  const reachable = REFERENCE_CAPABLE_MODEL_IDS.map(findModel).filter(
    (model): model is NonNullable<typeof model> => Boolean(model)
  );

  assert.equal(reachable.length, 3, "the three Gemini image models must still resolve");
  for (const model of reachable) {
    assert.equal(model.enabled, true, `${model.id} is enabled in production`);
    assert.equal(model.isMock, false, `${model.id} is a real provider`);
    assert.ok(model.maxInputs > 0, `${model.id} accepts a reference image`);
    assert.ok(model.supportedWorkflows.includes("image-to-image"));
  }

  // Which means the gate is not a precaution for a future feature: without it,
  // a user could upload a real person's face to a live model and no code would
  // examine it. With no evaluator configured, admission now refuses instead.
  const service = strip(read("src/lib/orchestration/generation-create-service.ts"));
  assert.match(service, /if \(request\.inputUrl\) \{/, "the gate fires on any reference-carrying request");
  assert.match(service, /evaluateReferenceInputSafety\(admin, \{/);
});
