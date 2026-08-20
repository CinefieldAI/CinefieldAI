import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  GENERIC_REFUSAL_MESSAGE,
  PERMISSIVE_VERDICTS,
  SAFETY_VERDICTS,
  ZERO_TOLERANCE_CATEGORIES,
  permitsDelivery,
  permitsProceeding,
} from "@/lib/safety/safety-contract";
import { installPromptModerationEngine } from "@/lib/safety/prompt-moderation";
import { evaluatePromptSafety } from "@/lib/safety/prompt-gate";
import { installCsamHashProvider, checkKnownCsamHash } from "@/lib/safety/csam-hash";
import { installMandatoryReporter, reportMandatoryCase } from "@/lib/safety/mandatory-reporting";
import { installAgeAssuranceProvider, evaluateAgeGate, resolveAgeAssurance } from "@/lib/safety/age-gate";
import { evaluateOutputSafety } from "@/lib/safety/output-safety";
import { readProviderNativeSafety, providerSafetyMetadata } from "@/lib/safety/provider-native-safety";
import { resolveRepeatOffenderEnforcement } from "@/lib/safety/safety-decision-store";
import { deliverableOutputIndexes, isAssetDeliverable } from "@/lib/media/asset-delivery-gate";
import { releaseAfterModeration, requestMediaAppeal } from "@/lib/media/quarantine-release";
import { getModerationQueue } from "@/lib/admin/moderation-admin-service";
import { classificationFor } from "@/lib/privacy/data-classification";
import { FakeSupabaseClient } from "./fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * PHASE 28 — Trust & Safety.
 *
 * The roadmap's own framing is what these tests are written against:
 * "Moderasyon bir 'hook' değil, generation lifecycle'ının zorunlu kapısıdır."
 * So the assertions are about GATES — what cannot get through — rather than
 * about a classifier's accuracy, which is a vendor's problem and not
 * something a repository can prove.
 *
 * Every seam here defaults to "no provider". That is not a limitation of the
 * tests: it is the production state, and proving the NOT-CONFIGURED behaviour
 * is at least as important as proving the positive path. A system whose safety
 * gates only work once a vendor is paid is a system with no safety gates today.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Comments are prose, not behaviour. Stripped before any structural grep. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function resetSeams(): void {
  installPromptModerationEngine(null);
  installCsamHashProvider(null);
  installMandatoryReporter(null);
  installAgeAssuranceProvider(null);
  delete process.env.CINEFIELD_ENV;
  delete process.env.CINEFIELD_REPEAT_VIOLATION_THRESHOLD;
  delete process.env.CINEFIELD_REPEAT_VIOLATION_WINDOW_DAYS;
}

// ===========================================================================
// A. THE VOCABULARY — no permissive default anywhere
// ===========================================================================

test("P28-1  exactly ONE verdict permits proceeding, and every other member is a way of not knowing", () => {
  assert.equal(PERMISSIVE_VERDICTS.size, 1);
  assert.ok(PERMISSIVE_VERDICTS.has("ALLOW"));

  for (const verdict of SAFETY_VERDICTS) {
    if (verdict === "ALLOW") continue;
    assert.equal(permitsProceeding(verdict), false, `${verdict} must not permit proceeding`);
  }

  // The three that describe the CLASSIFIER rather than the content are the
  // ones a permissive default would swallow. Named explicitly so a future
  // member cannot be added to the allow set without this failing.
  for (const unknown of ["NOT_CONFIGURED", "UNAVAILABLE", "MALFORMED_RESULT"] as const) {
    assert.equal(permitsProceeding(unknown), false);
  }
});

test("P28-2  a zero-tolerance category is never deliverable, whatever the verdict says", () => {
  assert.ok(ZERO_TOLERANCE_CATEGORIES.has("csam"));

  // The pathological case: a classifier that says ALLOW while naming csam.
  // Delivery must still refuse — the category alone is disqualifying.
  assert.equal(
    permitsDelivery({
      stage: "output",
      verdict: "ALLOW",
      categories: ["csam"],
      reasonCode: "engine_said_fine",
      policyVersion: "cinefield-safety-1",
      classifierVersion: "x",
      signalSource: "cinefield_classifier",
    }),
    false
  );
});

test("P28-3  there is ONE refusal message and it names no category, term or threshold", () => {
  const source = strip(read("src/lib/safety/safety-contract.ts"));
  // REFERANS M.1: "Reddederken NASIL atlatılacağını anlatma."
  assert.doesNotMatch(GENERIC_REFUSAL_MESSAGE, /csam|nsfw|deepfake|keyword|score|threshold|category/i);

  // And no gate builds a message of its own out of a reason code.
  for (const file of [
    "src/lib/safety/prompt-gate.ts",
    "src/lib/safety/age-gate.ts",
    "src/lib/safety/output-safety.ts",
  ]) {
    const code = strip(read(file));
    assert.doesNotMatch(
      code,
      /userMessage:\s*[`"'][^`"']*\$\{/,
      `${file} must not interpolate anything into a user-facing message`
    );
  }
  assert.match(source, /GENERIC_REFUSAL_MESSAGE/);
});

// ===========================================================================
// B. GATE B — the prompt never reaches a provider unchecked (28-A)
// ===========================================================================

test("P28-4  a BLOCKED prompt is refused, and the refusal tells the caller nothing useful", async () => {
  resetSeams();
  installPromptModerationEngine({
    name: "test-engine",
    async classify() {
      return {
        verdict: "BLOCK",
        categories: ["real_person"],
        reasonCode: "real_person_depiction",
        classifierVersion: "test-1",
      };
    },
  });

  const outcome = await evaluatePromptSafety({
    prompt: "irrelevant — the fake engine decides",
    negativePrompt: null,
    hasReferenceInput: false,
  });

  assert.equal(outcome.allowed, false);
  assert.equal(outcome.decision.verdict, "BLOCK");
  // The bounded evidence IS kept — server-side, for the queue and the appeal.
  assert.deepEqual([...outcome.decision.categories], ["real_person"]);
  assert.equal(outcome.decision.reasonCode, "real_person_depiction");
  // But the user gets the generic string, not the reason.
  assert.equal(outcome.allowed === false && outcome.userMessage, GENERIC_REFUSAL_MESSAGE);
  resetSeams();
});

test("P28-5  a cleared prompt proceeds", async () => {
  resetSeams();
  installPromptModerationEngine({
    name: "test-engine",
    async classify() {
      return { verdict: "ALLOW", categories: [], reasonCode: "clean", classifierVersion: "test-1" };
    },
  });

  const outcome = await evaluatePromptSafety({ prompt: "a lighthouse", negativePrompt: null, hasReferenceInput: false });
  assert.equal(outcome.allowed, true);
  assert.equal(outcome.decision.verdict, "ALLOW");
  resetSeams();
});

test("P28-6  REVIEW_REQUIRED never silently proceeds as ALLOW — in ANY environment", async () => {
  resetSeams();
  installPromptModerationEngine({
    name: "test-engine",
    async classify() {
      return { verdict: "REVIEW_REQUIRED", categories: ["ncii"], reasonCode: "needs_human", classifierVersion: "t" };
    },
  });

  for (const environment of ["development", "staging", "production"]) {
    process.env.CINEFIELD_ENV = environment;
    const outcome = await evaluatePromptSafety({ prompt: "x", negativePrompt: null, hasReferenceInput: true });
    assert.equal(outcome.allowed, false, `REVIEW_REQUIRED must refuse in ${environment}`);
  }
  resetSeams();
});

test("P28-7  moderation unavailable / malformed / not configured all FAIL CLOSED in production", async () => {
  resetSeams();
  process.env.CINEFIELD_ENV = "production";

  // 1. No engine at all — the production state today.
  let outcome = await evaluatePromptSafety({ prompt: "x", negativePrompt: null, hasReferenceInput: false });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.decision.verdict, "NOT_CONFIGURED");

  // 2. Engine returns null — an outage, not a verdict.
  installPromptModerationEngine({ name: "e", async classify() { return null; } });
  outcome = await evaluatePromptSafety({ prompt: "x", negativePrompt: null, hasReferenceInput: false });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.decision.verdict, "UNAVAILABLE");

  // 3. Engine throws.
  installPromptModerationEngine({ name: "e", async classify() { throw new Error("boom"); } });
  outcome = await evaluatePromptSafety({ prompt: "x", negativePrompt: null, hasReferenceInput: false });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.decision.verdict, "UNAVAILABLE");

  // 4. Engine answers outside its own contract. NOT coerced toward the
  //    nearest valid member — coercion is how "ALLOWED_MAYBE" becomes ALLOW.
  installPromptModerationEngine({
    name: "e",
    async classify() {
      return { verdict: "PROBABLY_FINE", categories: [], reasonCode: "ok", classifierVersion: "x" } as never;
    },
  });
  outcome = await evaluatePromptSafety({ prompt: "x", negativePrompt: null, hasReferenceInput: false });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.decision.verdict, "MALFORMED_RESULT");

  // 5. A category this build does not know. Refused rather than dropped —
  //    silently discarding an unknown category could discard the one that
  //    mattered.
  installPromptModerationEngine({
    name: "e",
    async classify() {
      return { verdict: "ALLOW", categories: ["bioweapon"], reasonCode: "ok", classifierVersion: "x" } as never;
    },
  });
  outcome = await evaluatePromptSafety({ prompt: "x", negativePrompt: null, hasReferenceInput: false });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.decision.verdict, "MALFORMED_RESULT");

  resetSeams();
});

test("P28-8  outside production an unconfigured gate proceeds, but NEVER claims the prompt was cleared", async () => {
  resetSeams();
  process.env.CINEFIELD_ENV = "development";

  const outcome = await evaluatePromptSafety({ prompt: "x", negativePrompt: null, hasReferenceInput: false });
  assert.equal(outcome.allowed, true, "development must not be blocked by an unsigned vendor contract");
  // The critical half: the recorded decision is the truth, not a fabricated
  // approval. A NOT_CONFIGURED row can never be read later as evidence that a
  // classifier approved something no classifier saw.
  assert.equal(outcome.decision.verdict, "NOT_CONFIGURED");
  assert.notEqual(outcome.decision.verdict, "ALLOW");
  resetSeams();
});

test("P28-9  the gate is wired into the REAL admission path, before any provider work", () => {
  const code = strip(read("src/lib/orchestration/generation-create-service.ts"));
  const gate = code.indexOf("evaluatePromptSafety(");
  const routing = code.indexOf("resolveHealthyRoute(");
  const insert = code.indexOf("create_generation_tx");

  assert.ok(gate > 0, "createGeneration must call the prompt gate");
  assert.ok(routing > gate, "the gate must run before a route is chosen");
  assert.ok(insert > gate, "and before the generation row exists");

  // Both real callers reach the provider through this one function.
  for (const route of [
    "src/app/api/generate/route.ts",
    "src/app/api/product-intelligence/execute/route.ts",
  ]) {
    assert.match(read(route), /createGeneration\(/, `${route} must admit through createGeneration`);
  }

  // And the refusal is its own error code, not INVALID_INPUT — telling a user
  // their SETTINGS were rejected when their PROMPT was sends them to change
  // the one thing that is not the problem.
  assert.match(code, /CONTENT_POLICY_REFUSED/);
  const errors = strip(read("src/lib/orchestration/errors.ts"));
  assert.match(errors, /CONTENT_POLICY_REFUSED:\s*\{[\s\S]*?retryable:\s*false/);
  assert.match(errors, /"CONTENT_POLICY_REFUSED",/, "a refused prompt proves no provider job exists");
});

// ===========================================================================
// C. THE CSAM SEAM — not-configured is never no-match (28-B)
// ===========================================================================

test("P28-10  with no provider the answer is PROVIDER_NOT_CONFIGURED, never NO_MATCH", async () => {
  resetSeams();
  const outcome = await checkKnownCsamHash({ contentDigestSha256: DIGEST_A, verifiedMime: "image/png" });
  assert.equal(outcome.outcome, "PROVIDER_NOT_CONFIGURED");
  assert.notEqual(outcome.outcome, "NO_MATCH");
});

test("P28-11  NO_MATCH is reachable only after a real provider actually answered", async () => {
  resetSeams();
  installCsamHashProvider({
    name: "test-hash",
    async lookup() {
      return { matched: false };
    },
  });
  const outcome = await checkKnownCsamHash({ contentDigestSha256: DIGEST_A, verifiedMime: "image/png" });
  assert.equal(outcome.outcome, "NO_MATCH");

  // An outage is not a clean result either.
  installCsamHashProvider({ name: "test-hash", async lookup() { return null; } });
  assert.equal(
    (await checkKnownCsamHash({ contentDigestSha256: DIGEST_A, verifiedMime: "image/png" })).outcome,
    "PROVIDER_UNAVAILABLE"
  );

  installCsamHashProvider({ name: "test-hash", async lookup() { throw new Error("down"); } });
  assert.equal(
    (await checkKnownCsamHash({ contentDigestSha256: DIGEST_A, verifiedMime: "image/png" })).outcome,
    "PROVIDER_UNAVAILABLE"
  );
  resetSeams();
});

test("P28-12  a POSITIVE MATCH blocks delivery and is terminal — nothing downstream can soften it", async () => {
  resetSeams();
  installCsamHashProvider({
    name: "test-hash",
    async lookup(input) {
      return { matched: input.contentDigestSha256 === DIGEST_B, listId: "test_list" };
    },
  });

  const assessment = await evaluateOutputSafety({
    assetId: "asset_1",
    bytes: PNG,
    verifiedMime: "image/png",
    contentDigestSha256: DIGEST_B,
    // Even a provider insisting the output is clean cannot rescue it.
    outputMetadata: providerSafetyMetadata({
      provider: "fal",
      flagged: false,
      reasonCode: "fal_has_nsfw_concepts",
    }),
  });

  assert.equal(assessment.decision.verdict, "BLOCK");
  assert.deepEqual([...assessment.decision.categories], ["csam"]);
  assert.equal(assessment.decision.signalSource, "hash_match_provider");
  assert.equal(assessment.moderationStatus, "rejected");
  assert.equal(permitsDelivery(assessment.decision), false);
  // The reporting obligation is raised by the FINDING, and only by it.
  assert.equal(assessment.mandatoryReportRequired, true);
  resetSeams();
});

test("P28-13  a mandatory report can never be recorded as filed without a real reporter", async () => {
  resetSeams();
  // No reporter: the obligation stands, unmet, and is visible as such.
  assert.equal(
    (await reportMandatoryCase({ mediaAssetId: "a", category: "csam", listId: null })).outcome,
    "REPORTING_NOT_CONFIGURED"
  );

  // A reporter that claims success without a reference is not evidence.
  installMandatoryReporter({ name: "r", async submit() { return { submitted: true }; } });
  assert.equal(
    (await reportMandatoryCase({ mediaAssetId: "a", category: "csam", listId: null })).outcome,
    "REPORT_FAILED"
  );

  // REPORT_SUBMITTED requires a real confirmation with a usable reference.
  installMandatoryReporter({
    name: "r",
    async submit() {
      return { submitted: true, referenceId: "CT-1234" };
    },
  });
  const filed = await reportMandatoryCase({ mediaAssetId: "a", category: "csam", listId: null });
  assert.equal(filed.outcome, "REPORT_SUBMITTED");

  // NOTHING in src/ installs a reporter. LIVE connectivity stays deferred.
  const wired = strip(read("src/lib/media/ingest-gate.ts"));
  assert.doesNotMatch(wired, /installMandatoryReporter\(/);
  resetSeams();
});

// ===========================================================================
// D. GATE C — output safety, and the provider is evidence only (28-B, §7/§30)
// ===========================================================================

test("P28-14  provider-native FLAGGED is captured and downgrades to review — never discarded", async () => {
  resetSeams();
  const assessment = await evaluateOutputSafety({
    assetId: "asset_1",
    bytes: PNG,
    verifiedMime: "image/png",
    contentDigestSha256: DIGEST_A,
    outputMetadata: providerSafetyMetadata({
      provider: "fal",
      flagged: true,
      category: "sexual_content",
      reasonCode: "fal_has_nsfw_concepts",
    }),
  });

  assert.equal(assessment.decision.verdict, "REVIEW_REQUIRED");
  assert.ok(assessment.decision.categories.includes("sexual_content"));
  // Kept SEPARATE from Cinefield's verdict, so provider drift stays answerable.
  assert.equal(assessment.providerSignal?.flagged, true);
  assert.equal(assessment.providerSignal?.provider, "fal");
  assert.equal(permitsDelivery(assessment.decision), false);
  // The Phase 9-E column follows, or the DB release constraint would still
  // see `passed` and permit release.
  assert.notEqual(assessment.moderationStatus, "passed");
  resetSeams();
});

test("P28-15  provider-native CLEAN grants nothing — it cannot bypass Cinefield's own gate", async () => {
  resetSeams();
  const assessment = await evaluateOutputSafety({
    assetId: "asset_1",
    bytes: PNG,
    verifiedMime: "image/png",
    contentDigestSha256: DIGEST_A,
    outputMetadata: providerSafetyMetadata({
      provider: "fal",
      flagged: false,
      reasonCode: "fal_has_nsfw_concepts",
    }),
  });

  // No Cinefield engine is configured, so the honest answer is NOT_CONFIGURED
  // — the vendor's "clean" does not upgrade it to ALLOW.
  assert.equal(assessment.decision.verdict, "NOT_CONFIGURED");
  assert.equal(permitsDelivery(assessment.decision), false);
  // But the vendor's claim IS recorded: `false` is a statement, distinct from
  // the silence of no signal at all.
  assert.equal(assessment.providerSignal?.flagged, false);
  resetSeams();
});

test("P28-16  silence and a negative flag are different facts", () => {
  assert.equal(readProviderNativeSafety({ provider: "fal" }), null, "no signal is silence");
  assert.equal(readProviderNativeSafety(undefined), null);
  assert.equal(
    readProviderNativeSafety(providerSafetyMetadata({ provider: "fal", flagged: false, reasonCode: "fal_has_nsfw_concepts" }))
      ?.flagged,
    false,
    "a negative flag is a claim"
  );
  // A malformed shape is not trusted into existence.
  assert.equal(readProviderNativeSafety({ providerSafety: { provider: "fal", flagged: "no" } }), null);
  assert.deepEqual(providerSafetyMetadata({ provider: "BAD NAME", flagged: true, reasonCode: "x" }), {});
});

test("P28-17  the fal adapter reads has_nsfw_concepts index-aligned, and emits nothing when fal is silent", () => {
  const code = strip(read("src/lib/orchestration/providers/fal-provider.ts"));
  assert.match(code, /has_nsfw_concepts/, "the real, index-aligned fal flag must be read");
  assert.match(code, /extractNsfwFlags\(payload\)/, "read from the SAME payload as the images");
  // Emitted only for an index fal actually answered for. Recording an absent
  // flag as `flagged: false` would manufacture a verdict fal never gave.
  assert.match(code, /index < nsfwFlags\.length/);
});

test("P28-18  the output gate is the REAL caller Phase 9-E's contract never had", () => {
  const gate = strip(read("src/lib/media/ingest-gate.ts"));
  assert.match(gate, /evaluateOutputSafety\(/, "the ingest gate must call the Phase 28 evaluator");
  assert.match(gate, /recordSafetyDecision\(/, "and record durable evidence");

  // The verdict is written in the SAME record_media_ingest call as the
  // verification facts, so an asset cannot exist verified-but-unjudged.
  const evaluate = gate.indexOf("evaluateOutputSafety(");
  const record = gate.indexOf("await record(admin, params.assetId, {\n    ingestStatus: \"verified\"");
  assert.ok(evaluate > 0 && (record === -1 || record > evaluate), "safety must be decided before the row is written");

  // And output-safety really does consult Phase 9-E's engine registry.
  const output = strip(read("src/lib/safety/output-safety.ts"));
  assert.match(output, /getModerationEngine\(\)/);
});

test("P28-19  an unrecorded decision is not a clearance", () => {
  const gate = strip(read("src/lib/media/ingest-gate.ts"));
  assert.match(
    gate,
    /safetyCleared:\s*recorded && permitsDelivery\(assessment\.decision\)/,
    "28-B requires an incident record to EXIST; a failed write must not clear the asset"
  );
});

// ===========================================================================
// E. RELEASE — automated, and strictly narrower than the human lane
// ===========================================================================

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset_1",
    clerk_user_id: "user_1",
    generation_id: "gen_1",
    output_index: 0,
    role: "original",
    ingest_status: "verified",
    status: "finalized",
    verified_mime: "image/png",
    checksum_sha256: DIGEST_A,
    moderation_status: "passed",
    quarantine_status: "quarantined",
    tombstoned_at: null,
    ...overrides,
  };
}

test("P28-20  automated release requires `passed` — and refuses `approved`, which belongs to the human lane", async () => {
  const cases: [string, boolean][] = [
    ["passed", true],
    ["approved", false],
    ["not_evaluated", false],
    ["pending", false],
    ["manual_review", false],
    ["rejected", false],
    ["error", false],
  ];

  for (const [status, expected] of cases) {
    const db = new FakeSupabaseClient({ media_assets: [assetRow({ moderation_status: status })] });
    const result = await releaseAfterModeration(db as unknown as SupabaseClient, { assetId: "asset_1" });
    assert.equal(result.released, expected, `moderation_status=${status}`);
    assert.equal(
      db.state.media_assets[0].quarantine_status,
      expected ? "released" : "quarantined",
      `moderation_status=${status} must leave quarantine ${expected ? "released" : "intact"}`
    );
  }
});

test("P28-21  the automated release takes NO actor, so it cannot launder a human decision", () => {
  const migration = read("supabase/migrations/20260916000000_trust_and_safety.sql");
  const fn = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION "public"."release_media_after_moderation"'),
    migration.indexOf('ALTER FUNCTION "public"."release_media_after_moderation"')
  );

  assert.doesNotMatch(fn, /p_actor/, "there must be no argument through which a human identity travels");
  assert.match(fn, /moderation_status <> 'passed'/, "passed ONLY — never approved");
  assert.doesNotMatch(fn, /media_release_approvals/, "it must not touch the two-person approval table");
  // It repeats every other precondition the human lane checks.
  for (const guard of ["already_released", "asset_rejected", "asset_tombstoned", "ingest_not_verified", "asset_not_finalized", "missing_verified_mime", "missing_checksum"]) {
    assert.match(fn, new RegExp(guard), `the automated lane must also refuse on ${guard}`);
  }

  // The two-person human lane is untouched: still two approvals, still keyed
  // on (asset, approver) so one human approving twice is still one approval.
  const lane = read("supabase/migrations/20260823000000_quarantine_release_lane.sql");
  assert.match(lane, /media_release_required_approvals[\s\S]{0,120}SELECT 2/);
  assert.match(lane, /PRIMARY KEY \("asset_id", "approver_clerk_user_id"\)/);
  assert.match(lane, /'awaiting_second_approval'/);
});

test("P28-22  an automated release is distinguishable from a human one in the audit trail", async () => {
  const db = new FakeSupabaseClient({ media_assets: [assetRow()] });
  await releaseAfterModeration(db as unknown as SupabaseClient, { assetId: "asset_1" });

  const entries = db.state.media_safety_audit ?? [];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, "auto_released");
  assert.notEqual(entries[0].action, "release_approved");
  assert.equal(entries[0].actor_clerk_user_id, "system:phase28_moderation");
  // The outbox event is emitted in the same transaction, exactly as the human
  // lane does, and in the CANONICAL family — Phase 11-A retired the
  // three-segment `media.asset.released`, and its guard would refuse it.
  assert.equal(db.outboxEvents.at(-1)?.event_type, "asset.released");
  const migration = read("supabase/migrations/20260916000000_trust_and_safety.sql");
  assert.doesNotMatch(migration, /'media\.asset\./, "the retired media.* family must not reappear");
});

// ===========================================================================
// F. PER-OUTPUT — SAFE / BLOCK / SAFE (binding decision A)
// ===========================================================================

test("P28-23  SAFE / BLOCK / SAFE siblings are decided independently and the safe ones are delivered", async () => {
  const db = new FakeSupabaseClient({
    media_assets: [
      assetRow({ id: "a0", output_index: 0, moderation_status: "passed", quarantine_status: "released" }),
      assetRow({ id: "a1", output_index: 1, moderation_status: "rejected", quarantine_status: "quarantined" }),
      assetRow({ id: "a2", output_index: 2, moderation_status: "passed", quarantine_status: "released" }),
    ],
  });

  const map = await deliverableOutputIndexes(db as unknown as SupabaseClient, "gen_1");
  assert.equal(map.get(0), true, "a safe sibling must be deliverable");
  assert.equal(map.get(1), false, "the blocked sibling must not be");
  assert.equal(map.get(2), true, "and it must not withhold the other safe sibling");

  // The old generation-wide rule would have returned false for all three.
  assert.notEqual([...map.values()].every((v) => v === false), true);
});

test("P28-24  no sibling decision leaks: a cleared sibling never lets a blocked one through", async () => {
  const db = new FakeSupabaseClient({
    media_assets: [
      assetRow({ id: "a0", output_index: 0, quarantine_status: "released" }),
      assetRow({ id: "a1", output_index: 1, quarantine_status: "quarantined" }),
    ],
  });

  assert.equal(await isAssetDeliverable(db as unknown as SupabaseClient, "a0"), true);
  assert.equal(await isAssetDeliverable(db as unknown as SupabaseClient, "a1"), false);

  // An index nobody stored is absent from the map, and absent is not a
  // clearance.
  const map = await deliverableOutputIndexes(db as unknown as SupabaseClient, "gen_1");
  assert.equal(map.get(7), undefined);
  assert.ok(!map.get(7));
});

test("P28-25  the URL minter gates on the SPECIFIC asset, and the route addresses it by index", () => {
  const storage = strip(read("src/lib/orchestration/output-storage.ts"));
  const minter = storage.slice(storage.indexOf("export async function mintCanonicalAssetUrl"));
  const gate = minter.indexOf("isAssetDeliverable(admin, assetId)");
  const mint = minter.indexOf("createPresignedDownload");
  assert.ok(gate > 0 && mint > gate, "the per-asset gate must precede signing");

  const attach = storage.slice(storage.indexOf("export async function attachSignedUrls"));
  assert.match(attach, /if \(!deliverable\.get\(index\)\)/);
  // The generation-wide gate is gone, not merely unused.
  assert.doesNotMatch(storage, /async function isGenerationAssetDeliverable/);

  // ONE implementation of the delivery rule.
  const rule = strip(read("src/lib/media/asset-delivery-gate.ts"));
  assert.equal((rule.match(/quarantine_status === "released"/g) ?? []).length, 1);
});

test("P28-26  the orchestrator releases only what the gate cleared, and a refusal does not fail the batch", () => {
  const code = strip(read("src/lib/orchestration/orchestrator.ts"));
  assert.match(code, /if \(ingest\.safetyCleared\) \{\s*await releaseAfterModeration\(/);
  // No branch here sets a status: fail-closed by omission, not by branching.
  const region = code.slice(code.indexOf("if (ingest.safetyCleared)"), code.indexOf("return {\n    assetId: processed.derivedAssetId"));
  assert.doesNotMatch(region, /quarantine_status/);
  assert.doesNotMatch(region, /throw /, "a refused release must not take the safe siblings down with it");

  // The safety context reaches the gate, so a decision can be attributed.
  assert.match(code, /safetyContext:\s*\{[\s\S]*?outputIndex: params\.outputIndex/);
});

// ===========================================================================
// G. AGE GATE (28-C)
// ===========================================================================

test("P28-27  unconfigured age verification is reported honestly and never fabricates an adult", async () => {
  resetSeams();
  assert.equal(await resolveAgeAssurance("user_1"), "AGE_VERIFICATION_NOT_CONFIGURED");

  const outcome = await evaluateAgeGate({ clerkUserId: "user_1", categories: ["sexual_content"] });
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.state, "AGE_VERIFICATION_NOT_CONFIGURED");
  assert.notEqual(outcome.state, "VERIFIED_ADULT");
  assert.equal(outcome.allowed === false && outcome.userMessage, GENERIC_REFUSAL_MESSAGE);

  // A provider that throws or answers nonsense also cannot produce an adult.
  installAgeAssuranceProvider({ name: "p", async assess() { throw new Error("down"); } });
  assert.equal(await resolveAgeAssurance("user_1"), "AGE_VERIFICATION_NOT_CONFIGURED");
  installAgeAssuranceProvider({ name: "p", async assess() { return "TOTALLY_AN_ADULT" as never; } });
  assert.equal(await resolveAgeAssurance("user_1"), "AGE_VERIFICATION_NOT_CONFIGURED");

  // No code in src/ installs an age provider, and no method has been chosen.
  const wired = strip(read("src/lib/orchestration/generation-create-service.ts"));
  assert.doesNotMatch(wired, /installAgeAssuranceProvider\(/);
  resetSeams();
});

test("P28-28  the age gate does not fire — or collect an age signal — for an unrestricted request", async () => {
  resetSeams();
  let consulted = false;
  installAgeAssuranceProvider({
    name: "p",
    async assess() {
      consulted = true;
      return "VERIFIED_ADULT";
    },
  });

  const outcome = await evaluateAgeGate({ clerkUserId: "user_1", categories: ["violence"] });
  assert.equal(outcome.allowed, true);
  assert.equal(consulted, false, "an unrestricted request must not collect an age signal");
  resetSeams();
});

// ===========================================================================
// H. REPEAT OFFENDER + ACCOUNT SUSPENSION (28-C, §22/§23)
// ===========================================================================

test("P28-29  with no threshold decided, enforcement is BUSINESS_DECISION_REQUIRED — never a guessed number", async () => {
  resetSeams();
  const db = new FakeSupabaseClient({});
  const outcome = await resolveRepeatOffenderEnforcement(db as unknown as SupabaseClient, "user_1");
  assert.equal(outcome.outcome, "BUSINESS_DECISION_REQUIRED");

  // No hardcoded threshold anywhere in the package.
  const store = strip(read("src/lib/safety/safety-decision-store.ts"));
  assert.doesNotMatch(store, /threshold\s*=\s*\d/, "a hardcoded threshold would be a product policy written by a code batch");
  resetSeams();
});

test("P28-30  account.suspend stays implemented:false — the action exists, the path does not", () => {
  const actions = JSON.parse(read("policies/data/actions.json")) as {
    aiWriteAllowlist: string[];
    actions: Record<string, { implemented: boolean; requiresTwoPerson: boolean; requiresHumanApproval: boolean }>;
  };

  const suspend = actions.actions["account.suspend"];
  assert.ok(suspend);
  assert.equal(suspend.implemented, false, "no suspension owner, route, durable state or reinstatement path exists");
  assert.equal(suspend.requiresTwoPerson, true);

  // Nothing in src/ suspends an account either — the flag and the code agree.
  const store = strip(read("src/lib/safety/safety-decision-store.ts"));
  assert.doesNotMatch(store, /suspend/i);
  assert.match(store, /ENFORCEMENT_RECOMMENDED/, "the strongest automated outcome is a recommendation");
});

// ===========================================================================
// I. AI AUTHORITY (§25)
// ===========================================================================

test("P28-31  AI has no safety authority: no release, no override, no appeal approval, no report", () => {
  const actions = JSON.parse(read("policies/data/actions.json")) as {
    aiWriteAllowlist: string[];
    actions: Record<string, { requiredRoles: string[] }>;
  };

  // The allowlist stays minimal and contains nothing from this phase.
  assert.deepEqual(actions.aiWriteAllowlist, ["code.pr.create"]);

  for (const action of ["media.quarantine.release", "media.quarantine.reject", "account.suspend"]) {
    assert.ok(!actions.aiWriteAllowlist.includes(action), `${action} must not be AI-writable`);
    assert.ok(
      !actions.actions[action].requiredRoles.includes("ai_agent"),
      `${action} must not be reachable by an ai_agent role`
    );
  }

  // And the Phase 28 package contains no agent, tool-invocation or AI caller.
  for (const file of [
    "src/lib/safety/prompt-gate.ts",
    "src/lib/safety/output-safety.ts",
    "src/lib/safety/safety-decision-store.ts",
    "src/lib/media/asset-delivery-gate.ts",
  ]) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /ai_agent|aiWrite|requireAiWritePolicy/, `${file} must not grant AI authority`);
  }
});

// ===========================================================================
// J. APPEAL + REVIEW QUEUE (28-D)
// ===========================================================================

test("P28-32  an appeal reaches human review and releases NOTHING", async () => {
  const db = new FakeSupabaseClient({
    media_assets: [assetRow({ moderation_status: "manual_review", quarantine_status: "quarantined" })],
  });

  const first = await requestMediaAppeal(db as unknown as SupabaseClient, {
    assetId: "asset_1",
    ownerClerkUserId: "user_1",
    reasonCode: "owner_disputes_decision",
  });
  assert.equal(first.recorded, true);

  // Nothing moved.
  assert.equal(db.state.media_assets[0].quarantine_status, "quarantined");
  assert.equal(db.state.media_assets[0].moderation_status, "manual_review");
  assert.equal(await isAssetDeliverable(db as unknown as SupabaseClient, "asset_1"), false);

  // One open appeal at a time — a user cannot flood the reviewers' queue.
  const second = await requestMediaAppeal(db as unknown as SupabaseClient, {
    assetId: "asset_1",
    ownerClerkUserId: "user_1",
  });
  assert.equal(second.recorded, false);
  assert.equal(second.reason, "appeal_already_open");

  // A non-owner is answered `not_found`, never `forbidden`.
  const stranger = await requestMediaAppeal(db as unknown as SupabaseClient, {
    assetId: "asset_1",
    ownerClerkUserId: "user_2",
  });
  assert.equal(stranger.recorded, false);
  assert.equal(stranger.reason, "not_found");
});

test("P28-33  the appeal SQL has no path to released, and the route accepts no caller-supplied reason", () => {
  const migration = read("supabase/migrations/20260916000000_trust_and_safety.sql");
  const fn = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION "public"."request_media_appeal"'),
    migration.indexOf('ALTER FUNCTION "public"."request_media_appeal"')
  );
  assert.doesNotMatch(fn, /UPDATE media_assets/, "an appeal must change no asset state");
  assert.doesNotMatch(fn, /'released'::"text"/);
  assert.match(fn, /clerk_user_id IS DISTINCT FROM p_owner_clerk_user_id/, "ownership from the durable row");

  const route = strip(read("src/app/api/generations/[generationId]/appeal/route.ts"));
  assert.match(route, /reasonCode: "owner_disputes_decision"/, "the reason code is fixed, never accepted from the body");
  assert.doesNotMatch(route, /await request\.json\(\)/, "no body is parsed, so nothing can be smuggled into the audit trail");
  assert.match(route, /routeClass: "durable_write"/, "reuses an existing rate-limit class");
});

test("P28-34  the review queue shows what is waiting, is bounded, and cannot release", async () => {
  const db = new FakeSupabaseClient({
    media_assets: [assetRow({ quarantine_status: "quarantined", moderation_status: "manual_review" })],
    media_safety_decisions: [
      {
        id: "d1",
        media_asset_id: "asset_1",
        generation_id: "gen_1",
        output_index: 0,
        decision_stage: "output",
        verdict: "REVIEW_REQUIRED",
        risk_categories: ["sexual_content"],
        reason_code: "provider_native_flagged",
        created_at: new Date().toISOString(),
        provider_signal_source: "provider_native",
        provider_signal_flagged: true,
      },
      {
        id: "d2",
        media_asset_id: "asset_2",
        decision_stage: "output",
        verdict: "BLOCK",
        risk_categories: ["csam"],
        reason_code: "known_hash_match",
        created_at: new Date().toISOString(),
        provider_signal_source: "hash_match_provider",
        provider_signal_flagged: null,
      },
    ],
  });

  await requestMediaAppeal(db as unknown as SupabaseClient, { assetId: "asset_1", ownerClerkUserId: "user_1" });

  const queue = await getModerationQueue(db as unknown as SupabaseClient);
  assert.equal(queue.outcome, "FOUND");
  const items = queue.outcome === "FOUND" ? queue.items : [];

  // Only REVIEW_REQUIRED. A block is decided — re-presenting it would invite
  // the override the roadmap forbids.
  assert.equal(items.length, 1);
  assert.equal(items[0].verdict, "REVIEW_REQUIRED");
  assert.equal(items[0].appealOpen, true, "an appealed asset must be visible to a reviewer");
  // Provider signal stays distinct from Cinefield's verdict in the item too.
  assert.equal(items[0].providerSignalFlagged, true);
  assert.equal(items[0].providerSignalSource, "provider_native");

  // The item carries identifiers and codes — never media, never a URL.
  const serialized = JSON.stringify(items[0]);
  assert.doesNotMatch(serialized, /http|object_key|signedUrl|prompt/i);

  // Bounded, and acting on an item still goes through the unmodified 9-E lane.
  const service = strip(read("src/lib/admin/moderation-admin-service.ts"));
  assert.match(service, /Math\.min\(limit, MODERATION_QUEUE_MAX_ITEMS\)/);
  const queueFn = service.slice(service.indexOf("export async function getModerationQueue"), service.indexOf("async function readOpenAppeals"));
  assert.doesNotMatch(queueFn, /approveMediaRelease|releaseAfterModeration/, "a queue that could release would be a second authority");
});

// ===========================================================================
// K. PERSISTENCE BOUNDARY (§8, §28)
// ===========================================================================

test("P28-35  nothing in the safety package can persist a prompt, payload, URL, key or secret", () => {
  const migration = read("supabase/migrations/20260916000000_trust_and_safety.sql");
  const table = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS "public"."media_safety_decisions"'),
    migration.indexOf('ALTER TABLE "public"."media_safety_decisions" OWNER TO')
  );

  for (const forbidden of ["prompt", "object_key", "signed_url", "payload", "token", "secret", "bytes", "bucket"]) {
    assert.doesNotMatch(table, new RegExp(`"${forbidden}"`), `media_safety_decisions must have no ${forbidden} column`);
  }

  // Reason codes are short codes, enforced in SQL — this is what stops a
  // matched term or a stack trace from landing in a row.
  assert.match(table, /"reason_code" ~ '\^\[a-z\]\[a-z0-9_\]\{1,64\}\$'/);

  // RLS on, and the SUBJECT cannot read their own decisions: a reason code
  // describes how the classifier reasons.
  assert.match(migration, /ALTER TABLE "public"\."media_safety_decisions" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE "public"\."media_safety_decisions" FROM "anon", "authenticated"/);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE "public"\."media_safety_decisions" TO "service_role"/);
  assert.doesNotMatch(migration, /GRANT[^;]*media_safety_decisions[^;]*TO "authenticated"/);

  // Append-only by trigger, not by convention.
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "public"\."media_safety_decisions"/);

  // The TypeScript shape has nowhere to put them either.
  const contract = strip(read("src/lib/safety/safety-contract.ts"));
  const decision = contract.slice(contract.indexOf("export interface SafetyDecision"));
  for (const forbidden of ["prompt", "bytes", "url", "objectKey", "payload"]) {
    assert.doesNotMatch(decision.slice(0, 600), new RegExp(forbidden, "i"));
  }
});

test("P28-36  Phase 23 owns privacy, and the safety record is classified as evidence that survives deletion", () => {
  const entry = classificationFor("media_safety_decisions");
  assert.ok(entry, "a table with clerk_user_id must be in the classification matrix");
  assert.equal(entry?.dataClass, "security_audit");
  assert.equal(entry?.legalBasis, "legal_obligation");
  assert.equal(entry?.deletionPolicy, "retain_immutable");
  assert.equal(entry?.owner, "phase-28");

  // SET NULL, not CASCADE: deleting the evidence must not delete the finding.
  const migration = read("supabase/migrations/20260916000000_trust_and_safety.sql");
  const table = migration.slice(
    migration.indexOf('CREATE TABLE IF NOT EXISTS "public"."media_safety_decisions"'),
    migration.indexOf('ALTER TABLE "public"."media_safety_decisions" OWNER TO')
  );
  assert.match(table, /"generation_id" "uuid" REFERENCES [^\n]*ON DELETE SET NULL/);
  assert.match(table, /"media_asset_id" "uuid" REFERENCES [^\n]*ON DELETE SET NULL/);
  assert.doesNotMatch(table, /ON DELETE CASCADE/);
});

// ===========================================================================
// L. OWNERSHIP BOUNDARIES — no second anything (§13, §27, §12)
// ===========================================================================

test("P28-37  Phase 27 keeps provenance, Phase 19 keeps policy, Phase 12 keeps incidents", () => {
  const migration = read("supabase/migrations/20260916000000_trust_and_safety.sql");
  // No second provenance table, no second incident store, no second delivery
  // authority, no second policy engine.
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*provenance/i);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*security_events/i);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]*incident/i);

  // media_safety_audit stays THE quarantine trail — extended, not replaced.
  assert.match(migration, /ALTER TABLE "public"\."media_safety_audit" DROP CONSTRAINT IF EXISTS "media_safety_audit_action_check"/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS "public"\."media_safety_audit"/);

  for (const file of ["src/lib/safety/output-safety.ts", "src/lib/safety/prompt-gate.ts"]) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /evaluatePolicy|policy-engine/, `${file} must not become a second policy engine`);
    assert.doesNotMatch(code, /recordMediaProvenance|c2pa/i, `${file} must not touch provenance`);
  }
});

test("P28-38  C2PA ordering is unchanged: the disclosure fact is not inside the signed manifest", () => {
  // The question §29 asks is whether classification must precede signing. It
  // must not, and the reason is structural rather than a judgement call: the
  // manifest Cinefield signs carries claim_generator plus ONE c2pa.actions
  // assertion, and disclosureRequirement is not in it. It lives on the
  // media_provenance ROW, which is written after storage.
  const contract = strip(read("src/lib/provenance/provenance-contract.ts"));
  const manifest = contract.slice(
    contract.indexOf("export interface C2paManifest"),
    contract.indexOf("export type ProvenanceVerificationOutcome")
  );
  assert.doesNotMatch(manifest, /disclosure/i, "no disclosure field is signed, so nothing must be classified first");

  // Bytes are never mutated after signing: the pipeline hashes the embedded
  // bytes and stores exactly those.
  const pipeline = strip(read("src/lib/media/media-processing-pipeline.ts"));
  const sign = pipeline.indexOf("embedC2paProvenance(");
  const digest = pipeline.indexOf('createHash("sha256").update(finalBytes)');
  const store = pipeline.indexOf("params.store.put(");
  assert.ok(sign > 0 && digest > sign && store > digest, "digest and store must both follow the embed");

  // And Phase 28 sits either side of it without touching it: the safety gate
  // runs inside ingest (before transform), the release runs after the pipeline.
  const orchestrator = strip(read("src/lib/orchestration/orchestrator.ts"));
  const ingest = orchestrator.indexOf("ingestMediaAsset(admin, {");
  const process = orchestrator.indexOf("processMedia(admin, {");
  const release = orchestrator.indexOf("releaseAfterModeration(admin,");
  assert.ok(ingest > 0 && process > ingest && release > process);
});

// ===========================================================================
// M. THE FAIL-CLOSED MATRIX (§31)
// ===========================================================================

test("P28-39  every unknown resolves non-permissively at the output gate", async () => {
  resetSeams();
  process.env.CINEFIELD_ENV = "production";

  // No engine, no hash provider, no provider signal: the whole matrix of
  // "nothing is configured", which is the production state today.
  const bare = await evaluateOutputSafety({
    assetId: "a",
    bytes: PNG,
    verifiedMime: "image/png",
    contentDigestSha256: DIGEST_A,
  });
  assert.equal(permitsDelivery(bare.decision), false);
  assert.equal(bare.moderationStatus, null, "no verdict means the column is left alone, not defaulted");

  // A hash provider that is down must not read as clean.
  installCsamHashProvider({ name: "h", async lookup() { return null; } });
  const degraded = await evaluateOutputSafety({
    assetId: "a",
    bytes: PNG,
    verifiedMime: "image/png",
    contentDigestSha256: DIGEST_A,
  });
  assert.equal(degraded.hashOutcome.outcome, "PROVIDER_UNAVAILABLE");
  assert.equal(permitsDelivery(degraded.decision), false);

  // A malformed digest is refused rather than forwarded to a third party.
  installCsamHashProvider({ name: "h", async lookup() { return { matched: false }; } });
  assert.equal(
    (await checkKnownCsamHash({ contentDigestSha256: "not-a-digest", verifiedMime: "image/png" })).outcome,
    "MALFORMED_RESULT"
  );
  resetSeams();
});

test("P28-40  a DB write failure never becomes a clearance, at either gate", async () => {
  resetSeams();
  // A client whose rpc always errors.
  const broken = {
    rpc: async () => ({ data: null, error: { message: "down" } }),
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ count: null, error: { message: "down" } }) }) }) }),
    }),
  } as unknown as SupabaseClient;

  const { recordSafetyDecision, countRecentViolations } = await import("@/lib/safety/safety-decision-store");

  assert.equal(
    await recordSafetyDecision(broken, {
      clerkUserId: "user_1",
      decision: {
        stage: "output",
        verdict: "ALLOW",
        categories: [],
        reasonCode: "clean",
        policyVersion: "cinefield-safety-1",
        classifierVersion: "x",
        signalSource: "cinefield_classifier",
      },
    }),
    false,
    "a failed write must report failure, not success"
  );

  // An unreadable count is null, never zero — zero would read as a clean user.
  assert.equal(await countRecentViolations(broken, "user_1", 30), null);

  // And a release that cannot be called leaves the asset quarantined.
  const result = await releaseAfterModeration(broken, { assetId: "asset_1" });
  assert.equal(result.released, false);
  resetSeams();
});

// ===========================================================================
// N. THE DEFERRED EXTERNAL DEPENDENCIES, STATED IN CODE
// ===========================================================================

test("P28-41  no vendor is contracted, and no repository code pretends one is", () => {
  for (const [file, registry] of [
    ["src/lib/safety/prompt-moderation.ts", "const ENGINES: ReadonlyMap<string, PromptModerationEngine> = new Map();"],
    ["src/lib/media/moderation-contract.ts", "const ENGINES: ReadonlyMap<string, MediaModerationEngine> = new Map();"],
  ] as const) {
    assert.ok(read(file).includes(registry), `${file}: the engine registry must still be empty`);
  }

  // No production module installs a provider for any of the four seams.
  const productionFiles = [
    "src/lib/media/ingest-gate.ts",
    "src/lib/orchestration/generation-create-service.ts",
    "src/lib/orchestration/orchestrator.ts",
    "src/lib/admin/moderation-admin-service.ts",
  ];
  for (const file of productionFiles) {
    const code = strip(read(file));
    for (const installer of [
      "installCsamHashProvider",
      "installMandatoryReporter",
      "installAgeAssuranceProvider",
      "installPromptModerationEngine",
    ]) {
      assert.doesNotMatch(code, new RegExp(`${installer}\\(`), `${file} must not install ${installer}`);
    }
  }

  // No PhotoDNA / Safer / NCMEC / Hive / Rekognition endpoint or credential.
  for (const file of [
    "src/lib/safety/csam-hash.ts",
    "src/lib/safety/mandatory-reporting.ts",
    "src/lib/safety/prompt-moderation.ts",
  ]) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /https?:\/\//, `${file} must contain no endpoint`);
    assert.doesNotMatch(code, /process\.env\.[A-Z_]*(?:PHOTODNA|THORN|SAFER|NCMEC|HIVE|REKOGNITION)/);
  }
});
