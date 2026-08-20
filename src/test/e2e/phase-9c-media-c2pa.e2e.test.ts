import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { transformToFinalMedia, profileForMime, MAX_TRANSFORM_INPUT_BYTES } from "@/lib/media/media-transform";
import {
  embedC2paProvenance,
  readEmbeddedProvenance,
  isEmbeddableMime,
  setC2paSignerMode,
  resetC2paSignerMode,
  currentC2paSignerMode,
} from "@/lib/provenance/c2pa-embedder";
import { processFinalMedia, signMediaForDelivery, type FinalMediaStore } from "@/lib/media/media-processing-pipeline";
import { validateMediaJob, runMediaJob, type MediaJob } from "../../../worker/media-worker";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 9-C — media processing prerequisite for Phase 27 C2PA.
 *
 * The load-bearing tests here produce REAL media with FFmpeg, embed a REAL
 * C2PA manifest, and verify it with the OFFICIAL ContentAuth library. They
 * are skipped only if FFmpeg is genuinely absent from the machine — and the
 * skip is loud, because silently passing without the tooling would be exactly
 * the fabricated proof this batch exists to avoid.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const FFMPEG = process.env.CINEFIELD_FFMPEG_PATH || "ffmpeg";

/** Synchronous on purpose: `skip` is evaluated when the test is defined. */
function ffmpegAvailable(): boolean {
  try {
    execFileSync(FFMPEG, ["-version"], { timeout: 20_000, windowsHide: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ffmpegRun(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { timeout: 60_000, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
  });
}

async function makeSample(kind: "png" | "jpg" | "mp4" | "wav"): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "cinefield-test-media-"));
  try {
    const out = join(dir, `s.${kind}`);
    const args: Record<string, string[]> = {
      png: ["-y", "-f", "lavfi", "-i", "color=c=blue:s=32x32:d=1", "-frames:v", "1", out],
      jpg: ["-y", "-f", "lavfi", "-i", "color=c=green:s=32x32:d=1", "-frames:v", "1", out],
      mp4: ["-y", "-f", "lavfi", "-i", "color=c=red:s=32x32:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", out],
      wav: ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", out],
    };
    await ffmpegRun(args[kind]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const HAVE_FFMPEG = ffmpegAvailable();

// ---------------------------------------------------------------------------
// Transform safety — no arbitrary FFmpeg, ever
// ---------------------------------------------------------------------------

test("C9C-1  the transform module accepts no caller-supplied FFmpeg argument, path, or URL", () => {
  const code = read("src/lib/media/media-transform.ts");
  // execFile with an array — never exec/spawn with a shell string.
  assert.match(code, /execFile\(/);
  assert.ok(!/\bexec\(|shell:\s*true|spawnSync|child_process".*\bexec\b/.test(code.replace(/execFile/g, "")), "no shell execution");
  // The public API takes bytes + mime only.
  assert.match(code, /transformToFinalMedia\(params: \{\s*readonly bytes: Uint8Array;\s*readonly verifiedMime: string;/);
});

test("C9C-2  the child process inherits NO environment — it holds no credential", () => {
  const code = read("src/lib/media/media-transform.ts");
  assert.match(code, /env:\s*\{\}/, "the FFmpeg child must inherit no environment");
});

test("C9C-3  FFmpeg is restricted to local file protocols (no network fetch from a crafted container)", () => {
  const code = read("src/lib/media/media-transform.ts");
  assert.match(code, /"-protocol_whitelist",\s*\n?\s*"file"/);
});

test("C9C-4  a timeout and a hard input ceiling are enforced", () => {
  const code = read("src/lib/media/media-transform.ts");
  assert.match(code, /timeout: TRANSFORM_TIMEOUT_MS/);
  assert.match(code, /killSignal: "SIGKILL"/);
  assert.ok(MAX_TRANSFORM_INPUT_BYTES > 0);
});

test("C9C-5  oversize input is refused before anything is written to disk", async () => {
  const huge = new Uint8Array(1);
  Object.defineProperty(huge, "byteLength", { value: MAX_TRANSFORM_INPUT_BYTES + 1 });
  const result = await transformToFinalMedia({ bytes: huge, verifiedMime: "image/png" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, "input_too_large");
});

test("C9C-6  an unsupported format is refused honestly, never passed through unmarked", async () => {
  assert.equal(profileForMime("image/gif"), null, "animated gif must not be single-frame normalised");
  assert.equal(profileForMime("application/pdf"), null);
  const result = await transformToFinalMedia({ bytes: new Uint8Array([1, 2, 3]), verifiedMime: "image/gif" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, "unsupported_format");
});

test("C9C-7  temporary files are always cleaned up (rm in a finally)", () => {
  const code = read("src/lib/media/media-transform.ts");
  assert.match(code, /finally \{\s*\n\s*if \(dir\) await rm\(dir, \{ recursive: true, force: true \}\)/);
});

// ---------------------------------------------------------------------------
// REAL transform + REAL embed + OFFICIAL verify
// ---------------------------------------------------------------------------

test("C9C-8  FFmpeg is available in this environment (the proof below depends on it)", () => {
  assert.equal(HAVE_FFMPEG, true, "FFmpeg not found — the official C2PA proof cannot run");
});

for (const [kind, inputMime, finalMime] of [
  ["png", "image/png", "image/png"],
  ["jpg", "image/jpeg", "image/jpeg"],
  ["mp4", "video/mp4", "video/mp4"],
  ["wav", "audio/wav", "audio/wav"],
] as const) {
  test(`C9C-9 [${finalMime}]  transform -> embed -> OFFICIAL verify reports VALID`, { skip: !HAVE_FFMPEG }, async () => {
    setC2paSignerMode("test");
    try {
      const source = await makeSample(kind);
      const transformed = await transformToFinalMedia({ bytes: source, verifiedMime: inputMime });
      assert.ok(transformed.ok, "transform must succeed");
      if (!transformed.ok) return;
      assert.equal(transformed.outputMime, finalMime);

      const embedded = await embedC2paProvenance({
        bytes: transformed.bytes,
        mime: transformed.outputMime,
        digitalSourceType: "trainedAlgorithmicMedia",
        softwareAgent: "Cinefield (model via provider)",
      });
      assert.ok(embedded.ok, `embed must succeed for ${finalMime}`);
      if (!embedded.ok) return;
      assert.equal(embedded.officiallyVerified, true);

      const verified = await readEmbeddedProvenance({ bytes: embedded.bytes, mime: finalMime });
      assert.equal(verified.present, true);
      if (!verified.present) return;
      assert.equal(verified.valid, true, `official verifier must report valid for ${finalMime}`);
      assert.match(verified.claimGenerator, /^cinefield\/1\.0/);
      assert.equal(
        verified.digitalSourceType,
        "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
      );
    } finally {
      resetC2paSignerMode();
    }
  });

  test(`C9C-10 [${finalMime}]  TAMPER: a one-byte change makes the official verifier reject it`, { skip: !HAVE_FFMPEG }, async () => {
    setC2paSignerMode("test");
    try {
      const source = await makeSample(kind);
      const transformed = await transformToFinalMedia({ bytes: source, verifiedMime: inputMime });
      assert.ok(transformed.ok);
      if (!transformed.ok) return;
      const embedded = await embedC2paProvenance({
        bytes: transformed.bytes,
        mime: transformed.outputMime,
        digitalSourceType: "trainedAlgorithmicMedia",
        softwareAgent: "Cinefield (model via provider)",
      });
      assert.ok(embedded.ok);
      if (!embedded.ok) return;

      const tampered = Uint8Array.from(embedded.bytes);
      tampered[tampered.length - 30] ^= 0xff;
      const result = await readEmbeddedProvenance({ bytes: tampered, mime: finalMime });
      const rejected = !result.present || (result.present && !result.valid);
      assert.ok(rejected, `tamper must be detected for ${finalMime}`);
    } finally {
      resetC2paSignerMode();
    }
  });
}

test("C9C-11  re-encoding a signed artifact strips the manifest (the roadmap's own durability warning, confirmed)", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  const dir = await mkdtemp(join(tmpdir(), "cinefield-reencode-"));
  try {
    const source = await makeSample("png");
    const transformed = await transformToFinalMedia({ bytes: source, verifiedMime: "image/png" });
    assert.ok(transformed.ok);
    if (!transformed.ok) return;
    const embedded = await embedC2paProvenance({
      bytes: transformed.bytes,
      mime: "image/png",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
    });
    assert.ok(embedded.ok);
    if (!embedded.ok) return;

    const signedPath = join(dir, "signed.png");
    const reencodedPath = join(dir, "re.png");
    await (await import("node:fs/promises")).writeFile(signedPath, embedded.bytes);
    await ffmpegRun(["-y", "-i", signedPath, "-frames:v", "1", reencodedPath]);
    const reBytes = new Uint8Array(await readFile(reencodedPath));

    const result = await readEmbeddedProvenance({ bytes: reBytes, mime: "image/png" });
    assert.equal(result.present, false, "a re-encode must strip the manifest — this is why signing is last");
  } finally {
    resetC2paSignerMode();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Fail-closed signing
// ---------------------------------------------------------------------------

test("C9C-12  the DEFAULT signer mode is 'none' — production never signs with a test certificate", () => {
  resetC2paSignerMode();
  assert.equal(currentC2paSignerMode(), "none");
});

test("C9C-13  with no signer configured, embedding refuses rather than producing untrusted bytes", async () => {
  resetC2paSignerMode();
  const result = await embedC2paProvenance({
    bytes: new Uint8Array([1, 2, 3]),
    mime: "image/png",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reasonCode, "signer_not_configured");
});

test("C9C-14  a non-embeddable format is refused", async () => {
  assert.equal(isEmbeddableMime("image/webp"), false);
  assert.equal(isEmbeddableMime("image/png"), true);
  setC2paSignerMode("test");
  try {
    const result = await embedC2paProvenance({
      bytes: new Uint8Array([1]),
      mime: "image/webp",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reasonCode, "unsupported_format");
  } finally {
    resetC2paSignerMode();
  }
});

// ---------------------------------------------------------------------------
// Pipeline: ordering, digests, real provenance caller
// ---------------------------------------------------------------------------

function memoryStore(): FinalMediaStore & { puts: { objectKey: string; bytes: Uint8Array }[] } {
  const puts: { objectKey: string; bytes: Uint8Array }[] = [];
  return {
    puts,
    async put(p) {
      puts.push({ objectKey: p.objectKey, bytes: p.bytes });
      return { ok: true };
    },
  };
}

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const DERIVED_ID = "22222222-2222-4222-8222-222222222222";

function dbWithSource() {
  return new FakeSupabaseClient({
    media_assets: [
      {
        id: SOURCE_ID,
        clerk_user_id: "user_1",
        generation_id: null,
        attempt_id: null,
        bucket: "cinefield-media",
        object_key: "quarantine/output/user_1/src/original.png",
        quarantine_status: "quarantined",
        checksum_sha256: "a".repeat(64),
        verified_mime: "image/png",
        status: "finalized",
      },
    ],
    media_provenance: [],
  });
}

test("C9C-15  END TO END: the pipeline produces a derived asset whose digest is over the FINAL signed bytes", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  try {
    const db = dbWithSource();
    const store = memoryStore();
    const bytes = await makeSample("png");

    const result = await processFinalMedia(db as never, {
      sourceAssetId: SOURCE_ID,
      target: { kind: "derived", derivedAssetId: DERIVED_ID },
      bytes,
      verifiedMime: "image/png",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
      store,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.equal(result.outcome, "COMPLETED");
    if (result.outcome !== "COMPLETED") return;

    // The digest must be over the bytes actually stored, not the source.
    const stored = store.puts[0];
    assert.equal(createHash("sha256").update(stored.bytes).digest("hex"), result.finalDigestSha256);
    assert.notEqual(result.finalDigestSha256, "a".repeat(64), "must NOT reuse the source digest");

    // And those stored bytes must carry a valid embedded manifest.
    const verified = await readEmbeddedProvenance({ bytes: stored.bytes, mime: "image/png" });
    assert.equal(verified.present, true);
    if (verified.present) assert.equal(verified.valid, true);
  } finally {
    resetC2paSignerMode();
  }
});

test("C9C-16  the provenance row is EMBEDDED_C2PA and binds to the derived asset's final digest", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  try {
    const db = dbWithSource();
    const result = await processFinalMedia(db as never, {
      sourceAssetId: SOURCE_ID,
      target: { kind: "derived", derivedAssetId: DERIVED_ID },
      bytes: await makeSample("png"),
      verifiedMime: "image/png",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
      store: memoryStore(),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    assert.equal(result.outcome, "COMPLETED");
    if (result.outcome !== "COMPLETED") return;

    assert.equal(result.evidence.markingState, "EMBEDDED_C2PA");
    assert.equal(result.evidence.mediaAssetId, DERIVED_ID);
    assert.equal(result.evidence.contentDigestSha256, result.finalDigestSha256);

    const row = db.state.media_provenance[0] as Record<string, unknown>;
    assert.equal(row.marking_state, "EMBEDDED_C2PA");
    assert.equal(row.content_digest_sha256, result.finalDigestSha256);
  } finally {
    resetC2paSignerMode();
  }
});

test("C9C-17  the derived asset preserves lineage (parent_asset_id) and INHERITS quarantine — never relaxes it", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  try {
    const db = dbWithSource();
    await processFinalMedia(db as never, {
      sourceAssetId: SOURCE_ID,
      target: { kind: "derived", derivedAssetId: DERIVED_ID },
      bytes: await makeSample("png"),
      verifiedMime: "image/png",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
      store: memoryStore(),
      now: new Date(),
    });
    const derived = (db.state.media_assets as Record<string, unknown>[]).find((a) => a.id === DERIVED_ID);
    assert.ok(derived);
    assert.equal(derived!.parent_asset_id, SOURCE_ID);
    assert.equal(derived!.role, "derived");
    assert.equal(derived!.quarantine_status, "quarantined", "quarantine must be inherited, never relaxed");
  } finally {
    resetC2paSignerMode();
  }
});

test("C9C-18  with no signer, the pipeline stops at SIGNER_NOT_CONFIGURED and writes NOTHING", { skip: !HAVE_FFMPEG }, async () => {
  resetC2paSignerMode();
  const db = dbWithSource();
  const store = memoryStore();
  const result = await processFinalMedia(db as never, {
    sourceAssetId: SOURCE_ID,
    target: { kind: "derived", derivedAssetId: DERIVED_ID },
    bytes: await makeSample("png"),
    verifiedMime: "image/png",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    store,
    now: new Date(),
  });
  assert.equal(result.outcome, "SIGNER_NOT_CONFIGURED");
  assert.equal(store.puts.length, 0, "nothing may be stored when provenance could not be applied");
  assert.equal(db.state.media_provenance.length, 0, "no EMBEDDED_C2PA row without a successful embed");
  assert.equal((db.state.media_assets as Record<string, unknown>[]).length, 1, "no derived asset row either");
});

test("C9C-19  an unknown source asset is refused", async () => {
  const db = new FakeSupabaseClient({ media_assets: [], media_provenance: [] });
  const result = await processFinalMedia(db as never, {
    sourceAssetId: SOURCE_ID,
    target: { kind: "derived", derivedAssetId: DERIVED_ID },
    bytes: new Uint8Array([1]),
    verifiedMime: "image/png",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    store: memoryStore(),
    now: new Date(),
  });
  assert.equal(result.outcome, "SOURCE_ASSET_NOT_FOUND");
});

test("C9C-20  storage happens only after a successful embed+verify (ordering is structural)", () => {
  const code = read("src/lib/media/media-processing-pipeline.ts");
  const embedIdx = code.indexOf("embedC2paProvenance(");
  const digestIdx = code.indexOf('createHash("sha256")');
  const storeIdx = code.indexOf("params.store.put(");
  const provIdx = code.indexOf("recordMediaProvenance(");
  assert.ok(embedIdx > 0 && digestIdx > embedIdx, "digest must be computed AFTER embedding");
  assert.ok(storeIdx > digestIdx, "storage must come after the final digest");
  assert.ok(provIdx > storeIdx, "provenance is recorded after the asset is stored");
});

// ---------------------------------------------------------------------------
// Worker job validation
// ---------------------------------------------------------------------------

function job(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    sourceAssetId: SOURCE_ID,
    derivedAssetId: DERIVED_ID,
    bytes: new Uint8Array([1, 2, 3]),
    verifiedMime: "image/png",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    ...overrides,
  };
}

test("C9C-21  the worker refuses a non-UUID asset id (no path or key can be smuggled through it)", () => {
  for (const bad of ["../../etc/passwd", "'; DROP TABLE media_assets; --", "http://evil/x", ""]) {
    assert.equal(validateMediaJob(job({ sourceAssetId: bad })).ok, false, `must refuse: ${bad}`);
    assert.equal(validateMediaJob(job({ derivedAssetId: bad })).ok, false, `must refuse: ${bad}`);
  }
});

test("C9C-22  the worker refuses empty bytes, a malformed mime, and an invalid source type", () => {
  assert.equal(validateMediaJob(job({ bytes: new Uint8Array(0) })).ok, false);
  assert.equal(validateMediaJob(job({ verifiedMime: "../../x" })).ok, false);
  assert.equal(
    validateMediaJob(job({ digitalSourceType: "humanCaptured" as never })).ok,
    false,
    "only the IPTC terms this system can prove are accepted"
  );
  assert.equal(validateMediaJob(job()).ok, true);
});

test("C9C-23  a refused job never reaches the pipeline", async () => {
  const db = dbWithSource();
  const store = memoryStore();
  const result = await runMediaJob({
    admin: db as never,
    store,
    job: job({ sourceAssetId: "not-a-uuid" }),
    now: new Date(),
  });
  assert.equal(result.outcome, "JOB_REFUSED");
  assert.equal(store.puts.length, 0);
});

test("C9C-24  the MediaJob shape carries no path, URL, command, or codec field", () => {
  const code = read("worker/media-worker.ts");
  const shape = /export interface MediaJob \{([\s\S]*?)\n\}/.exec(code);
  assert.ok(shape);
  assert.ok(!/path|url|command|codec|args|filter|output/i.test(shape![1]), "no controllable field may exist");
});

// ---------------------------------------------------------------------------
// Ownership preservation
// ---------------------------------------------------------------------------

test("C9C-25  the media worker starts no workflow and completes no generation — Temporal stays sole owner", () => {
  // Comments stripped: the file's own header QUOTES 6R.22's "SendMessage
  // hakkı olmaz" rule, and documenting a prohibition must not read as
  // performing it.
  const code = read("worker/media-worker.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/startWorkflow|signalWorkflow|complete_generation|completeGeneration|CommandBus|sendMessage/i.test(code));
});

test("C9C-26  the pipeline never calls the R2 client directly — Phase 9 keeps owning storage via an injected seam", () => {
  const code = read("src/lib/media/media-processing-pipeline.ts");
  assert.ok(!/r2-client|PutObjectCommand|S3Client/.test(code));
  assert.match(code, /interface FinalMediaStore/);
});

test("C9C-27  no new migration was created by this batch", () => {
  const files = readFileSync(join(ROOT, "package.json"), "utf8");
  assert.ok(files.length > 0);
  const migrations = readdirSync(join(ROOT, "supabase/migrations"));
  assert.ok(!migrations.some((m) => m > "20260914000000_media_provenance.sql"), "no migration after Phase 27's own");
});

test("C9C-28  no signing key or certificate material is committed", () => {
  for (const file of ["src/lib/provenance/c2pa-embedder.ts", "src/lib/media/media-transform.ts", "worker/media-worker.ts", "scripts/verify-c2pa-sample.ts"]) {
    const code = read(file);
    assert.ok(!new RegExp("-----BEGIN [A-Z ]*" + "PRIVATE KEY").test(code), `${file} contains key material`);
  }
});

test("C9C-29  the test signer is never the production default, and is named as a development certificate", () => {
  const code = read("src/lib/provenance/c2pa-embedder.ts");
  assert.match(code, /let signerMode: C2paSignerMode = "none"/);
  assert.match(code, /development certificate the C2PA ecosystem does NOT trust in production/);
});

test("C9C-30  no raw prompt or provider payload can enter the manifest — softwareAgent is bounded", () => {
  const code = read("src/lib/provenance/manifest-builder.ts");
  assert.match(code, /SOFTWARE_AGENT_PATTERN/);
  const embedder = read("src/lib/provenance/c2pa-embedder.ts");
  assert.ok(!/prompt|negativePrompt|providerPayload/i.test(embedder));
});

// ---------------------------------------------------------------------------
// THE DECISIVE DELIVERY PROOF (Phase 27 closure)
// ---------------------------------------------------------------------------

test("C9C-31  DELIVERY PROOF: the bytes handed to the delivery lane ARE the canonical stored bytes, and they verify VALID officially", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  try {
    const db = dbWithSource();
    const store = memoryStore();

    const result = await processFinalMedia(db as never, {
      sourceAssetId: SOURCE_ID,
      bytes: await makeSample("png"),
      verifiedMime: "image/png",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
      store,
      now: new Date("2026-01-01T00:00:00.000Z"),
      target: { kind: "in_place" },
    });

    assert.equal(result.outcome, "COMPLETED");
    if (result.outcome !== "COMPLETED") return;

    // 1. What the canonical store actually received.
    const storedBytes = store.puts[0].bytes;
    const storedDigest = createHash("sha256").update(storedBytes).digest("hex");

    // 2. What the orchestrator hands the delivery lane (`asset.signedBytes`).
    const deliveredBytes = result.finalBytes;
    const deliveredDigest = createHash("sha256").update(deliveredBytes).digest("hex");

    // 3. They must be the SAME bytes — not merely the same identifier.
    assert.equal(deliveredDigest, storedDigest, "delivered bytes must equal the canonical stored bytes");
    assert.equal(deliveredDigest, result.finalDigestSha256, "and match the recorded provenance digest");
    assert.equal(
      result.evidence.contentDigestSha256,
      deliveredDigest,
      "the provenance row must describe the delivered artifact"
    );

    // 4. The delivered artifact verifies VALID with the OFFICIAL library.
    const verified = await readEmbeddedProvenance({ bytes: deliveredBytes, mime: "image/png" });
    assert.equal(verified.present, true, "the delivered file must carry an embedded manifest");
    if (!verified.present) return;
    assert.equal(verified.valid, true, "the DELIVERED bytes must verify as valid C2PA");
    assert.equal(
      verified.digitalSourceType,
      "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
    );

    // 5. And they are NOT the raw provider bytes.
    assert.notEqual(deliveredDigest, "a".repeat(64));
  } finally {
    resetC2paSignerMode();
  }
});

test("C9C-32  DELIVERY PROOF: video and audio delivery bytes also verify VALID officially", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  try {
    for (const [kind, mime] of [
      ["mp4", "video/mp4"],
      ["wav", "audio/wav"],
    ] as const) {
      const db = new FakeSupabaseClient({
        media_assets: [
          {
            id: SOURCE_ID,
            clerk_user_id: "user_1",
            generation_id: null,
            attempt_id: null,
            bucket: "cinefield-media",
            object_key: `quarantine/output/user_1/src/original.${kind}`,
            quarantine_status: "quarantined",
            checksum_sha256: "a".repeat(64),
            verified_mime: mime,
            status: "finalized",
          },
        ],
        media_provenance: [],
      });
      const store = memoryStore();
      const result = await processFinalMedia(db as never, {
        sourceAssetId: SOURCE_ID,
        bytes: await makeSample(kind),
        verifiedMime: mime,
        digitalSourceType: "trainedAlgorithmicMedia",
        softwareAgent: "Cinefield (model via provider)",
        store,
        now: new Date(),
        target: { kind: "in_place" },
      });
      assert.equal(result.outcome, "COMPLETED", `${mime} must complete`);
      if (result.outcome !== "COMPLETED") continue;

      const delivered = createHash("sha256").update(result.finalBytes).digest("hex");
      const stored = createHash("sha256").update(store.puts[0].bytes).digest("hex");
      assert.equal(delivered, stored, `${mime}: delivered must equal stored`);

      const verified = await readEmbeddedProvenance({ bytes: result.finalBytes, mime });
      assert.equal(verified.present, true, `${mime}: manifest present`);
      if (verified.present) assert.equal(verified.valid, true, `${mime}: delivered bytes verify VALID`);
    }
  } finally {
    resetC2paSignerMode();
  }
});

test("C9C-33  signMediaForDelivery marks a SECONDARY output and its bytes verify VALID", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  try {
    const signed = await signMediaForDelivery({
      bytes: await makeSample("png"),
      verifiedMime: "image/png",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
    });
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    const verified = await readEmbeddedProvenance({ bytes: signed.bytes, mime: signed.mime });
    assert.equal(verified.present, true);
    if (verified.present) assert.equal(verified.valid, true, "a secondary output must also verify VALID");
  } finally {
    resetC2paSignerMode();
  }
});

test("C9C-34  signMediaForDelivery fails closed with no signer — no unmarked secondary fallback", async () => {
  resetC2paSignerMode();
  const signed = await signMediaForDelivery({
    bytes: new Uint8Array([1, 2, 3]),
    verifiedMime: "image/png",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
  });
  assert.equal(signed.ok, false);
});
