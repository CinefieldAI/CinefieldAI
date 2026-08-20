import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { detectMediaType, declarationMatches, ALLOWED_VERIFIED_MIMES } from "@/lib/media/mime-detect";
import {
  inspectUntrustedMedia,
  __sandboxEnvironmentForTesting,
} from "@/lib/media/sandbox/media-inspector";
import { ingestMediaAsset, hasVerifiedOriginal, MODERATION_ENGINE } from "@/lib/media/ingest-gate";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 9-B. Two properties carry this batch: nothing decides what media IS
 * from a header, and nothing that reads media holds a credential.
 *
 * Every hostile fixture below is SYNTHETIC — a handful of bytes assembled
 * here. No malware sample is downloaded, stored, or executed.
 */

const ROOT = process.cwd();
const OWNER = "user_9b_owner";
const ASSET = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
const AVIF = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]);

const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);
const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
const SHEBANG = new Uint8Array([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const bytesOf = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const SVG = bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const SVG_PADDED = bytesOf('\n\n   <svg onload="alert(1)"/>');
const HTML = bytesOf("<!DOCTYPE html><html><body>x</body></html>");
const TRUNCATED_PNG = PNG.slice(0, 4);
const GARBAGE = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
const EMPTY = new Uint8Array(0);

// ---------------------------------------------------------------------------
// Verified MIME (M3)
// ---------------------------------------------------------------------------

test("real media is identified from bytes, not from a header", () => {
  const cases: [Uint8Array, string][] = [
    [PNG, "image/png"], [JPEG, "image/jpeg"], [GIF, "image/gif"], [WEBP, "image/webp"],
    [WAV, "audio/wav"], [MP4, "video/mp4"], [AVIF, "image/avif"], [WEBM, "video/webm"],
    [MP3, "audio/mpeg"],
  ];
  for (const [bytes, expected] of cases) {
    const result = detectMediaType(bytes);
    assert.equal(result.outcome, "verified", expected);
    assert.equal(result.outcome === "verified" && result.mime, expected);
  }
});

test("executables, scripts, archives and documents are refused BY NAME", () => {
  const cases: [Uint8Array, string][] = [
    [EXE, "executable"], [ELF, "executable"], [SHEBANG, "script"],
    [ZIP, "archive"], [PDF, "pdf"],
  ];
  for (const [bytes, kind] of cases) {
    const result = detectMediaType(bytes);
    assert.equal(result.outcome, "hostile", kind);
    assert.equal(result.outcome === "hostile" && result.kind, kind);
  }
});

test("SVG is refused as active content, including when padded to hide the tag", () => {
  // SVG carries <script>, event handlers and external references, so a
  // browser rendering "an image" executes it.
  for (const bytes of [SVG, SVG_PADDED]) {
    const result = detectMediaType(bytes);
    assert.equal(result.outcome, "hostile");
    assert.equal(result.outcome === "hostile" && result.kind, "svg");
  }
  assert.ok(!ALLOWED_VERIFIED_MIMES.has("image/svg+xml"), "and it is not on the allowlist");
});

test("HTML is refused — a stored XSS served as an image is the whole point", () => {
  const result = detectMediaType(HTML);
  assert.equal(result.outcome, "hostile");
  assert.equal(result.outcome === "hostile" && result.kind, "html");
});

test("a polyglot that opens with an executable header is refused, not accepted", () => {
  // Hostile detection runs first on purpose: appending PNG bytes after an MZ
  // header must not let it through.
  const polyglot = new Uint8Array([...EXE, ...PNG]);
  const result = detectMediaType(polyglot);
  assert.equal(result.outcome, "hostile");
  assert.equal(result.outcome === "hostile" && result.kind, "executable");
});

test("truncated, garbage and empty input are handled without a parser", () => {
  assert.equal(detectMediaType(TRUNCATED_PNG).outcome, "unknown");
  assert.equal(detectMediaType(GARBAGE).outcome, "unknown");
  assert.equal(detectMediaType(EMPTY).outcome, "empty");
});

test("the detector has no imports at all", () => {
  // Its safety argument is that it cannot do anything but compare bytes.
  const source = readFileSync(path.join(ROOT, "src/lib/media/mime-detect.mjs"), "utf8");
  assert.equal(source.match(/^import /gm), null, "an import here means the boundary moved");
});

test("declared vs verified: sloppy is tolerated, contradictory is not", () => {
  assert.ok(declarationMatches("image/png", "image/png"));
  assert.ok(declarationMatches("image/jpg", "image/jpeg"), "same class, sloppy subtype");
  assert.ok(declarationMatches("application/octet-stream", "image/png"), "no claim made");
  assert.ok(declarationMatches(null, "image/png"), "absent declaration");
  assert.ok(declarationMatches("image/png; charset=binary", "image/png"));

  assert.ok(!declarationMatches("image/png", "video/mp4"), "image declared, video stored");
  assert.ok(!declarationMatches("video/mp4", "image/png"));
  assert.ok(!declarationMatches("audio/mpeg", "image/jpeg"));
});

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

test("the sandbox environment is an ALLOWLIST and carries no credential", () => {
  const env = __sandboxEnvironmentForTesting();

  assert.deepEqual(Object.keys(env).sort(), ["NODE_ENV", "PATH"]);

  for (const forbidden of [
    "FAL_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "RUNWARE_API_KEY", "XAI_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN", "CLERK_SECRET_KEY",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY", "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "CLOUDFLARE_API_TOKEN", "TEMPORAL_API_KEY", "REDIS_URL", "TRIGGER_SECRET_KEY",
    "ELEVENLABS_API_KEY", "REPLICATE_API_TOKEN", "SEEDANCE_API_KEY", "KLING_API_KEY",
  ]) {
    assert.ok(!(forbidden in env), `${forbidden} must not reach the sandbox`);
  }

  // The allowlist is the mechanism, not this list: a secret added tomorrow is
  // excluded because it was never added, which a denylist could not promise.
  const source = readFileSync(path.join(ROOT, "src/lib/media/sandbox/media-inspector.ts"), "utf8");
  assert.ok(!/\.\.\.process\.env/.test(source), "the environment must never be spread in");
});

test("the sandbox child imports nothing that could reach a credential or the network", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/media/sandbox/inspector-child.mjs"), "utf8");
  const imports = source.match(/^import .*$/gm) ?? [];

  assert.equal(imports.length, 2, "exactly node:crypto and the pure detector");
  assert.ok(imports.some((i) => i.includes("node:crypto")));
  assert.ok(imports.some((i) => i.includes("mime-detect.mjs")));

  for (const forbidden of ["supabase", "aws-sdk", "fetch", "http", "https", "net", "dns", "fs"]) {
    assert.ok(!imports.some((i) => i.includes(forbidden)), `no ${forbidden} in the sandbox`);
  }
});

test("the sandbox really runs out of process and returns real facts", async () => {
  const result = await inspectUntrustedMedia(PNG);

  assert.equal(result.ok, true);
  assert.equal(result.byteLength, PNG.byteLength);
  assert.equal(result.sha256, createHash("sha256").update(PNG).digest("hex"));
  assert.equal(result.detection?.outcome, "verified");
});

test("a timeout kills the sandbox rather than waiting on it", async () => {
  // 1 ms against a real process spawn: the kill path is what is exercised.
  const result = await inspectUntrustedMedia(PNG, { timeoutMs: 1 });
  assert.equal(result.ok, false);
  assert.ok(["timeout", "crashed"].includes(result.failure ?? ""), result.failure);
});

test("oversize input is refused before a process is spawned", async () => {
  const result = await inspectUntrustedMedia(new Uint8Array(4096), { maxBytes: 1024 });
  assert.equal(result.ok, false);
  assert.equal(result.failure, "too_large");
});

test("the byte ceiling is enforced INSIDE the child as it reads, too", () => {
  // The parent's pre-check handles what it can measure; the child counts as
  // it receives, which is what bounds a stream that lies about its size.
  const child = readFileSync(path.join(ROOT, "src/lib/media/sandbox/inspector-child.mjs"), "utf8");
  assert.ok(/received \+= chunk\.byteLength/.test(child));
  assert.ok(/received > maxBytes/.test(child));
});

test("a sandbox failure never throws into the caller", async () => {
  // Malformed media is data, not an exception. A caller must be able to
  // branch on an outcome rather than catch a type that depends on how the
  // bytes happened to be broken.
  for (const bytes of [EMPTY, GARBAGE, TRUNCATED_PNG]) {
    const result = await inspectUntrustedMedia(bytes);
    assert.equal(typeof result.ok, "boolean");
  }
});

test("no native decoder entered the codebase", () => {
  const deps = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).dependencies as Record<string, string>;
  for (const forbidden of ["sharp", "fluent-ffmpeg", "ffmpeg-static", "file-type", "image-size", "probe-image-size"]) {
    assert.ok(!(forbidden in deps), `${forbidden} must not be added outside the 9-C lane`);
  }
});

// ---------------------------------------------------------------------------
// Ingest gate
// ---------------------------------------------------------------------------

interface RecordedCall { fn: string; args: Record<string, unknown> }

function gateAdmin(options: { duplicateId?: string | null } = {}) {
  const calls: RecordedCall[] = [];
  const table = {
    select: () => table,
    eq: () => table,
    neq: () => table,
    limit: () => table,
    maybeSingle: async () => ({
      data: options.duplicateId ? { id: options.duplicateId } : null,
      error: null,
    }),
  };
  const admin = {
    from: () => table,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: { recorded: true }, error: null };
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

test("a clean image is verified, hashed, and STILL quarantined", async () => {
  const { admin, calls } = gateAdmin();
  const outcome = await ingestMediaAsset(admin, {
    assetId: ASSET, ownerId: OWNER, bytes: PNG, declaredContentType: "image/png",
  });

  assert.equal(outcome.status, "verified");
  assert.equal(outcome.status === "verified" && outcome.verifiedMime, "image/png");
  assert.equal(
    outcome.status === "verified" && outcome.checksumSha256,
    createHash("sha256").update(PNG).digest("hex")
  );
  // No engine exists, so nothing can say "passed". The asset does not leave
  // quarantine, and the gate never claims otherwise.
  assert.equal(outcome.status === "verified" && outcome.moderationStatus, "not_evaluated");

  const recorded = calls.find((c) => c.fn === "record_media_ingest");
  assert.ok(recorded);
  assert.equal(recorded?.args.p_ingest_status, "verified");
  assert.equal(recorded?.args.p_moderation_status, "not_evaluated");
});

test("hostile media is rejected, and the checksum is still recorded as evidence", async () => {
  const { admin, calls } = gateAdmin();
  const outcome = await ingestMediaAsset(admin, {
    assetId: ASSET, ownerId: OWNER, bytes: EXE, declaredContentType: "image/png",
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.status === "rejected" && outcome.reason, "hostile_format");

  const recorded = calls.find((c) => c.fn === "record_media_ingest");
  assert.equal(recorded?.args.p_ingest_status, "rejected");
  assert.equal(recorded?.args.p_failure_reason, "hostile_executable");
  assert.ok(recorded?.args.p_checksum_sha256, "evidence is kept even for a refusal");
});

test("a declared/actual mismatch is refused rather than corrected", async () => {
  const { admin } = gateAdmin();
  const outcome = await ingestMediaAsset(admin, {
    assetId: ASSET, ownerId: OWNER, bytes: MP4, declaredContentType: "image/png",
  });

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.status === "rejected" && outcome.reason, "declared_mime_mismatch");
});

test("empty and unknown formats are rejected with distinct reasons", async () => {
  const { admin } = gateAdmin();

  const empty = await ingestMediaAsset(admin, { assetId: ASSET, ownerId: OWNER, bytes: EMPTY });
  assert.equal(empty.status === "rejected" && empty.reason, "empty_media");

  const unknown = await ingestMediaAsset(admin, { assetId: ASSET, ownerId: OWNER, bytes: GARBAGE });
  assert.equal(unknown.status === "rejected" && unknown.reason, "unsupported_format");
});

test("a sandbox failure leaves the asset recoverable, never verified", async () => {
  const { admin, calls } = gateAdmin();
  const outcome = await ingestMediaAsset(admin, {
    assetId: ASSET, ownerId: OWNER, bytes: PNG, timeoutMs: 1,
  });

  assert.notEqual(outcome.status, "verified", "we could not look, so we do not vouch");
  const recorded = calls.find((c) => c.fn === "record_media_ingest");
  assert.ok(["failed", "rejected"].includes(recorded?.args.p_ingest_status as string));
});

test("the recorded failure reason is a short code, never a message or a path", async () => {
  const { admin, calls } = gateAdmin();
  await ingestMediaAsset(admin, { assetId: ASSET, ownerId: OWNER, bytes: SVG });

  const reason = calls.find((c) => c.fn === "record_media_ingest")?.args.p_failure_reason as string;
  assert.match(reason, /^[a-z][a-z0-9_]{1,64}$/, "the SQL validator would reject anything else");
});

// ---------------------------------------------------------------------------
// Dedupe privacy
// ---------------------------------------------------------------------------

test("a duplicate within one owner is detected and recorded as evidence only", async () => {
  const { admin, calls } = gateAdmin({ duplicateId: "earlier-asset-id" });
  const outcome = await ingestMediaAsset(admin, {
    assetId: ASSET, ownerId: OWNER, bytes: PNG, declaredContentType: "image/png",
  });

  assert.equal(outcome.status === "verified" && outcome.duplicateOfAssetId, "earlier-asset-id");
  // Detected, not reused: nothing points the new asset at the old object.
  const recorded = calls.find((c) => c.fn === "record_media_ingest");
  assert.equal(recorded?.args.p_duplicate_of, "earlier-asset-id");
});

test("the duplicate lookup is scoped to the owner in the query itself", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/media/ingest-gate.ts"), "utf8");
  const fn = source.slice(source.indexOf("async function findOwnerDuplicate"));

  assert.ok(/\.eq\("clerk_user_id", ownerId\)/.test(fn), "owner-scoped, always");
  const ownerFilter = fn.indexOf('eq("clerk_user_id"');
  const checksumFilter = fn.indexOf('eq("checksum_sha256"');
  assert.ok(ownerFilter > 0 && checksumFilter > ownerFilter, "tenant leads the predicate");
});

test("cross-tenant duplicate linking is refused by the DATABASE, not by convention", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260821000000_media_ingest_gate.sql"), "utf8"
  );
  assert.ok(/duplicate_cross_tenant/.test(migration));
  assert.ok(/media_assets_duplicate_same_owner_trg/.test(migration), "enforced by trigger");
  assert.ok(/duplicate_self_reference/.test(migration));
});

test("the checksum index leads with the tenant, so a hash cannot be probed globally", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260821000000_media_ingest_gate.sql"), "utf8"
  );
  assert.ok(
    /media_assets_owner_checksum_idx"?\s*\n?\s*ON "public"\."media_assets" \("clerk_user_id", "checksum_sha256"\)/.test(
      migration
    ),
    "a hash-only index would answer 'does anyone hold these bytes'"
  );
});

test("no endpoint exposes checksum lookup to a browser", () => {
  // A public hash-existence endpoint is the classic cross-tenant leak: it
  // answers "does anyone hold these bytes" for anyone who can call it.
  const routeFiles = ["src/app/api/media/upload-url/route.ts"];
  for (const file of routeFiles) {
    const code = readFileSync(path.join(ROOT, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/checksum/i.test(code), `${file} must not accept or return a checksum`);
  }
});

// ---------------------------------------------------------------------------
// Moderation — fail-closed
// ---------------------------------------------------------------------------

test("no moderation engine is configured, and the code says so rather than defaulting to pass", () => {
  assert.equal(MODERATION_ENGINE, null);
});

test("moderation cannot fail open: release is refused by a database constraint", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260821000000_media_ingest_gate.sql"), "utf8"
  );
  const constraint = migration.slice(
    migration.indexOf("media_assets_release_requires_checks"),
    migration.indexOf("media_assets_verified_consistency")
  );

  assert.ok(/'released'/.test(constraint));
  assert.ok(/ingest_status" = 'verified'/.test(constraint));
  assert.ok(/verified_mime" IS NOT NULL/.test(constraint));
  assert.ok(/checksum_sha256" IS NOT NULL/.test(constraint));
  assert.ok(/'passed'/.test(constraint), "moderation must have actually said yes");
});

test("nothing in the gate can set a passing moderation status", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/media/ingest-gate.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.ok(!/"passed"/.test(code), "no branch reaches a passing verdict");
  assert.ok(!/"released"/.test(code), "and none releases a quarantine");
  assert.ok(!/"approved"/.test(code));
});

test("no paid or external moderation call was introduced", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/media/ingest-gate.ts"), "utf8");
  const imports = source.match(/^import .*$/gm)?.join("\n") ?? "";
  assert.ok(!/openai|anthropic|hive|sightengine|aws-sdk|rekognition/i.test(imports));
});

// ---------------------------------------------------------------------------
// Completion boundary
// ---------------------------------------------------------------------------

function completionAdmin(row: Record<string, unknown> | null) {
  const table = {
    select: () => table,
    eq: () => table,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { from: () => table } as unknown as SupabaseClient;
}

test("completion now requires BOTH finalized storage and a verified ingest", async () => {
  assert.equal(
    await hasVerifiedOriginal(completionAdmin({ status: "finalized", ingest_status: "verified" }), "g"),
    true
  );
  // Stored but unread — exactly the 9-A state that used to be sufficient.
  assert.equal(
    await hasVerifiedOriginal(completionAdmin({ status: "finalized", ingest_status: "pending" }), "g"),
    false
  );
  assert.equal(
    await hasVerifiedOriginal(completionAdmin({ status: "finalized", ingest_status: "rejected" }), "g"),
    false
  );
  assert.equal(
    await hasVerifiedOriginal(completionAdmin({ status: "stored", ingest_status: "verified" }), "g"),
    false
  );
  assert.equal(await hasVerifiedOriginal(completionAdmin(null), "g"), false);
});

test("the orchestrator runs reserve -> ingest -> process/store -> gate -> complete, in that order", () => {
  // ORDERING CHANGED BY PHASE 27 (canonical C2PA wiring), deliberately.
  //
  // This test previously pinned `store -> ingest`: the raw provider bytes
  // were written to R2 first so that a REJECTED asset still had its bytes in
  // storage for an operator to examine. Phase 27 requires that every
  // canonical artifact carry an embedded C2PA manifest, which makes storing
  // the raw bytes unacceptable — an unmarked object in the canonical key is
  // exactly the artifact the AI Act Article 50(2) marking obligation forbids
  // shipping, and leaving one there "for inspection" would mean the unmarked
  // copy is the one anything downstream could serve.
  //
  // So the gate now runs on the raw bytes BEFORE anything is written, and the
  // only object ever stored is the signed one. This is strictly safer in two
  // further ways: hostile input is refused before it reaches FFmpeg, and a
  // rejected generation writes no object at all.
  //
  // TRADE-OFF, STATED: rejected raw bytes are no longer retained in R2 for
  // post-hoc operator examination. The rejection reason, checksum and
  // detection outcome are still recorded on the media_assets row by the gate
  // itself, so the FINDING survives; the hostile bytes do not.
  const source = readFileSync(path.join(ROOT, "src/lib/orchestration/orchestrator.ts"), "utf8");

  const reserve = source.indexOf("await reserveGenerationAsset(");
  const ingest = source.indexOf("await ingestMediaAsset(");
  // Reached through the media-processor seam now — see media-processor-seam.ts.
  const process = source.indexOf("await processMedia(admin, {");
  const gate = source.indexOf("await hasVerifiedOriginal(");
  const complete = source.indexOf("await markCompleted(");

  assert.ok(reserve > 0 && ingest > reserve, "a row is reserved before the gate records against it");
  assert.ok(process > ingest, "the gate refuses hostile bytes BEFORE the transform touches them");
  assert.ok(gate > ingest && complete > gate, "and completion comes last");
  assert.ok(
    !/await storeAndFinalizeAsset\(/.test(source),
    "the raw-bytes store path must not return — it would recreate an unmarked canonical object"
  );
});

test("a media-safety refusal is not reported as a provider failure", () => {
  // A provider that did its job perfectly must not be sent to the circuit
  // breaker because its output was refused.
  const source = readFileSync(path.join(ROOT, "src/lib/orchestration/orchestrator.ts"), "utf8");
  const block = source.slice(source.indexOf("if (ingest.status !== \"verified\")"));

  assert.ok(/MEDIA_INGEST_REJECTED/.test(block.slice(0, 600)));
  assert.ok(!/PROVIDER_FAILED/.test(block.slice(0, 600)));
});

test("provider output cannot bypass the gate", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/orchestration/orchestrator.ts"), "utf8");
  const persist = source.slice(
    source.indexOf("async function persistCanonicalOriginal"),
    source.indexOf("The shared tail of every successful generation")
  );
  assert.ok(/ingestMediaAsset/.test(persist), "the only persist path runs the gate");
});

// ---------------------------------------------------------------------------
// Lanes and write authority
// ---------------------------------------------------------------------------

test("the two quarantine lanes stay distinct", async () => {
  const { buildAssetObjectKey } = await import("@/lib/media/asset-keys");
  const output = buildAssetObjectKey({
    ownerId: OWNER, assetId: ASSET, source: "provider_output", role: "original", extension: "png",
  });
  const input = buildAssetObjectKey({
    ownerId: OWNER, assetId: ASSET, source: "browser_upload", role: "original", extension: "png",
  });

  assert.ok(output.startsWith("quarantine/output/"), "QUARANTINE / OUTPUT (INGEST)");
  assert.ok(input.startsWith("quarantine/input/"), "QUARANTINE / INPUT");
  assert.ok(!input.startsWith("quarantine/output/"), "provider output is never labelled INPUT");
});

test("only the server may write verification facts", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260821000000_media_ingest_gate.sql"), "utf8"
  );

  assert.ok(/REVOKE UPDATE ON TABLE "public"."media_assets" FROM "authenticated"/.test(migration));
  assert.ok(/REVOKE INSERT ON TABLE "public"."media_assets" FROM "authenticated"/.test(migration));
  assert.ok(
    /GRANT EXECUTE ON FUNCTION "public"."record_media_ingest"[\s\S]{0,200}TO "service_role"/.test(migration)
  );
  assert.ok(
    /REVOKE ALL ON FUNCTION "public"."record_media_ingest"[\s\S]{0,200}"authenticated"/.test(migration)
  );
});

test("record_media_ingest refuses a verification without the facts", () => {
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20260821000000_media_ingest_gate.sql"), "utf8"
  );
  assert.ok(/verified_requires_mime_and_checksum/.test(migration));
  assert.ok(/checksum_conflict/.test(migration), "a changed checksum is a conflict, not an update");
  assert.ok(/already_ingested/.test(migration), "replay is inert");
});
