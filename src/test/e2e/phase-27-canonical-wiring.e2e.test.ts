import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OrchestrationError, isRetryable } from "@/lib/orchestration/errors";

/**
 * Phase 27 canonical-output wiring.
 *
 * The Phase 27 re-audit found the pipeline real but unreachable: the
 * orchestrator stored raw provider bytes via `storeAndFinalizeAsset` and
 * never called Phase 9-C, so every real output shipped unmarked while only
 * sample files carried provenance.
 *
 * These tests exist so that regression cannot happen silently. They are
 * deliberately STRUCTURAL — they read the orchestrator's own source and fail
 * if the bypass returns. A behavioural test of the full orchestrator needs a
 * live provider, R2 and Temporal; the wiring itself is a property of the
 * source, and pinning it there is what makes reintroducing the bypass loud.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ORCHESTRATOR = "src/lib/orchestration/orchestrator.ts";

/** Source with comments removed — prose about a rule must not satisfy it. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------
// The bypass is gone
// ---------------------------------------------------------------------------

test("W27-1  the orchestrator no longer imports storeAndFinalizeAsset — the direct unmarked R2 write is gone", () => {
  const source = code(ORCHESTRATOR);
  assert.ok(
    !/storeAndFinalizeAsset/.test(source),
    "storeAndFinalizeAsset writes RAW provider bytes to R2. Reintroducing it here recreates the unmarked canonical artifact Phase 27 forbids."
  );
});

test("W27-2  the canonical path calls the Phase 9-C pipeline", () => {
  const source = code(ORCHESTRATOR);
  assert.match(source, /processFinalMedia\(/, "the canonical path must route through Phase 9-C");
  assert.match(source, /from "@\/lib\/media\/media-processing-pipeline"/);
});

test("W27-3  the canonical path finalises IN PLACE — one asset, not an unmarked original plus a marked copy", () => {
  const source = code(ORCHESTRATOR);
  assert.match(source, /target: \{ kind: "in_place" \}/);
});

test("W27-4  exactly ONE storage call exists in the canonical path", () => {
  const source = code(ORCHESTRATOR);
  // The pipeline performs the write through the injected seam; the
  // orchestrator itself must not also write an object.
  const directPuts = source.match(/putAssetObject\(/g) ?? [];
  assert.equal(
    directPuts.length,
    1,
    "putAssetObject may appear exactly once — inside the canonicalMediaStore adapter, never as a second write"
  );
  assert.match(source, /const canonicalMediaStore: FinalMediaStore/);
});

// ---------------------------------------------------------------------------
// Ordering: safety gate before FFmpeg, provenance before completion
// ---------------------------------------------------------------------------

test("W27-5  the ingest safety gate runs BEFORE the transform, so hostile bytes never reach FFmpeg", () => {
  const source = code(ORCHESTRATOR);
  const ingestIdx = source.indexOf("ingestMediaAsset(");
  const processIdx = source.indexOf("processFinalMedia(");
  assert.ok(ingestIdx > 0 && processIdx > 0);
  assert.ok(ingestIdx < processIdx, "Phase 9-B must gate the raw bytes before Phase 9-C transforms them");
});

test("W27-6  reserve precedes ingest, and provenance is the last step before returning", () => {
  const source = code(ORCHESTRATOR);
  const reserveIdx = source.indexOf("reserveGenerationAsset(");
  const ingestIdx = source.indexOf("ingestMediaAsset(");
  const processIdx = source.indexOf("processFinalMedia(");
  const returnIdx = source.indexOf("return { assetId: processed.derivedAssetId");
  assert.ok(reserveIdx < ingestIdx, "a row must be reserved before the gate records against it");
  assert.ok(processIdx < returnIdx, "the canonical path returns only after Phase 9-C completed");
});

// ---------------------------------------------------------------------------
// FAIL CLOSED — production never completes with unmarked media
// ---------------------------------------------------------------------------

test("W27-7  any non-COMPLETED pipeline outcome throws, so markCompleted is unreachable", () => {
  const source = code(ORCHESTRATOR);
  assert.match(
    source,
    /if \(processed\.outcome !== "COMPLETED"\) \{[\s\S]{0,400}throw new OrchestrationError\("MEDIA_PROVENANCE_FAILED"/,
    "an unmarkable output must throw rather than complete as a normal success"
  );
});

test("W27-8  MEDIA_PROVENANCE_FAILED is a real registered error, non-retryable, distinct from ingest and provider failures", () => {
  // Constructed through the real error type — an unregistered code would not
  // resolve a message or a status here.
  const provenance = new OrchestrationError("MEDIA_PROVENANCE_FAILED");
  const ingest = new OrchestrationError("MEDIA_INGEST_REJECTED");

  assert.equal(provenance.code, "MEDIA_PROVENANCE_FAILED");
  assert.ok(provenance.userMessage.length > 0, "must be registered with a real message");
  assert.equal(
    isRetryable(provenance),
    false,
    "retrying an unconfigured signer or an unmarkable format burns attempts for an identical failure"
  );
  assert.notEqual(provenance.userMessage, ingest.userMessage, "must not be confused with a safety refusal");
  // It must not read as the provider's fault — a healthy provider must never
  // reach the circuit breaker because provenance could not be applied.
  assert.ok(!/provider/i.test(provenance.userMessage));
});

test("W27-9  every failure mode the pipeline can report is covered by the throw — none can slip through as success", () => {
  const pipeline = code("src/lib/media/media-processing-pipeline.ts");
  const outcomes = [...pipeline.matchAll(/outcome: "([A-Z0-9_]+)"/g)].map((m) => m[1]);
  const distinct = new Set(outcomes);
  // Every declared outcome other than COMPLETED is a failure, and the
  // orchestrator's guard is `!== "COMPLETED"`, so all of them throw.
  for (const failure of [
    "SOURCE_ASSET_NOT_FOUND",
    "UNSUPPORTED_FORMAT",
    "TRANSFORM_FAILED",
    "SIGNER_NOT_CONFIGURED",
    "C2PA_EMBED_FAILED",
    "C2PA_VERIFY_FAILED",
    "STORAGE_FAILED",
    "PROVENANCE_FAILED",
  ]) {
    assert.ok(distinct.has(failure), `${failure} must remain a declared pipeline outcome`);
  }
  const orchestrator = code(ORCHESTRATOR);
  assert.match(orchestrator, /processed\.outcome !== "COMPLETED"/, "the guard must be a whitelist of success, not a blacklist of failures");
});

// ---------------------------------------------------------------------------
// Output-type coverage
// ---------------------------------------------------------------------------

test("W27-10  image, video and audio outputs all route through the same canonical path", () => {
  const source = code(ORCHESTRATOR);
  // There is exactly one persistence function, and it is media-type agnostic:
  // no branch sends one media type down a different storage route.
  const persistCalls = source.match(/persistCanonicalOriginal\(/g) ?? [];
  assert.equal(persistCalls.length, 2, "one definition, one call site — no per-media-type storage branch");
  assert.ok(
    !/mediaType === "(image|video|audio)"[\s\S]{0,200}(storeAndFinalize|putAssetObject)/.test(source),
    "no media type may take a different storage path"
  );
});

test("W27-11  the transform profile map covers every mime the ingest gate can verify", () => {
  const transform = read("src/lib/media/media-transform.ts");
  for (const mime of [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/avif",
    "image/gif",
    "video/mp4",
    "video/webm",
    "audio/wav",
    "audio/mpeg",
  ]) {
    assert.ok(new RegExp(`"${mime}":`).test(transform), `${mime} must be explicitly classified, not silently unhandled`);
  }
});

// ---------------------------------------------------------------------------
// Ownership preservation
// ---------------------------------------------------------------------------

test("W27-12  Temporal/orchestrator remains the sole lifecycle owner — the pipeline completes no generation", () => {
  const pipeline = code("src/lib/media/media-processing-pipeline.ts");
  assert.ok(!/markCompleted|markFailed|complete_generation_tx|generations"\)/.test(pipeline));
});

test("W27-13  the pipeline touches no billing or attempt lifecycle", () => {
  const pipeline = code("src/lib/media/media-processing-pipeline.ts");
  assert.ok(!/credit|settle|refund|reserve_credits|generation_attempts"\)\s*\.\s*(insert|update)/i.test(pipeline));
});

test("W27-14  quarantine is never relaxed by the provenance path", () => {
  const pipeline = code("src/lib/media/media-processing-pipeline.ts");
  // in_place never writes quarantine_status at all; derived inherits it.
  assert.ok(!/quarantine_status:\s*"released"/.test(pipeline));
  assert.match(pipeline, /quarantine_status: source\.quarantine_status \?\? "quarantined"/);
});

test("W27-15  the in-place update writes the FINAL digest, never leaving the raw-byte digest behind", () => {
  const pipeline = code("src/lib/media/media-processing-pipeline.ts");
  assert.match(
    pipeline,
    /\.update\(\{[\s\S]{0,400}checksum_sha256: finalDigest/,
    "the canonical row's checksum must describe the bytes actually stored"
  );
});

test("W27-16  the raw provider bytes are never stored — only the signed artifact reaches the store", () => {
  const pipeline = code("src/lib/media/media-processing-pipeline.ts");
  assert.match(pipeline, /store\.put\(\{[\s\S]{0,120}bytes: finalBytes/, "the store receives the SIGNED bytes");
  assert.ok(!/store\.put\(\{[\s\S]{0,120}bytes: params\.bytes/.test(pipeline), "raw bytes must never be stored");
});
