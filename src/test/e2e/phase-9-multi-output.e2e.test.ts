import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processFinalMedia, type FinalMediaStore } from "@/lib/media/media-processing-pipeline";
import { readEmbeddedProvenance, setC2paSignerMode, resetC2paSignerMode } from "@/lib/provenance/c2pa-embedder";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 9 multi-output asset model.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS FILE EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 * Phase 27 wired C2PA marking into the canonical output path, then guarded
 * `resolvedOutputs.length > 1` with a refusal because Phase 9 allowed only one
 * `role='original'` asset per generation. That guard broke a real, shipping
 * product path: `/generate` batches THREE images by default and six enabled
 * fal models declare `maxOutputCount: 4`.
 *
 * These tests pin the product reality first (so the guard cannot come back
 * disguised as a capability change), then the per-output invariants.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FFMPEG = process.env.CINEFIELD_FFMPEG_PATH || "ffmpeg";

function ffmpegAvailable(): boolean {
  try {
    execFileSync(FFMPEG, ["-version"], { timeout: 20_000, windowsHide: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const HAVE_FFMPEG = ffmpegAvailable();

function ffmpegRun(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { timeout: 60_000, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
  });
}

async function makePng(colour: string): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "cinefield-multi-"));
  try {
    const out = join(dir, "s.png");
    await ffmpegRun(["-y", "-f", "lavfi", "-i", `color=c=${colour}:s=32x32:d=1`, "-frames:v", "1", out]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// PRODUCT REALITY — the facts that made the refusal a defect
// ---------------------------------------------------------------------------

test("M9-1  /generate still batches THREE outputs by default — the product contract this batch must not break", () => {
  const workspace = read("src/components/cinema-studio/CinemaStudioWorkspace.tsx");
  assert.match(
    workspace,
    /useState\("3\/4"\)/,
    "the locked /generate page defaults to a batch of 3; if this changes, it is a product decision, not a Phase 27 workaround"
  );
  assert.match(workspace, /image_count: batch/, "and it sends that batch to the backend");
});

test("M9-2  /image still sends image_count", () => {
  const workspace = read("src/components/landing/createImage/CreateImageWorkspace.tsx");
  assert.match(workspace, /image_count: String\(outputCount\)/);
});

test("M9-3  enabled models still declare maxOutputCount > 1 — nothing was clamped to 1", () => {
  const registry = read("src/lib/orchestration/model-registry.ts");
  const multi = [...registry.matchAll(/maxOutputCount: (\d+)/g)].map((m) => Number(m[1])).filter((n) => n > 1);
  assert.ok(multi.length >= 6, `expected several multi-output models, found ${multi.length}`);
  assert.ok(Math.max(...multi) >= 4, "at least one model must still allow 4+ outputs");
});

test("M9-4  the fal adapter still returns one output per image", () => {
  const fal = read("src/lib/orchestration/providers/fal-provider.ts");
  assert.match(fal, /return images\.map\(/, "fal maps every returned image to its own output");
});

test("M9-5  NO count-clamp workaround was introduced anywhere", () => {
  const orchestrator = read("src/lib/orchestration/orchestrator.ts");
  // The refusal must be gone...
  assert.ok(
    !/resolvedOutputs\.length > 1/.test(orchestrator),
    "the multi-output refusal must not return"
  );
  // ...and nothing may quietly take only the first output instead.
  assert.ok(
    !/resolvedOutputs\[0\](?![\s\S]{0,40}entries\(\))/.test(orchestrator.replace(/^\s*(\/\/|\*).*$/gm, "")),
    "no code may silently process only resolvedOutputs[0]"
  );
  assert.ok(!/\.slice\(0,\s*1\)/.test(orchestrator), "no truncation to a single output");
  assert.match(orchestrator, /resolvedOutputs\.entries\(\)/, "every output must be iterated");
});

// ---------------------------------------------------------------------------
// SCHEMA — identity widened, idempotency preserved
// ---------------------------------------------------------------------------

test("M9-6  the unique index is widened to (generation_id, output_index), not removed", () => {
  const sql = read("supabase/migrations/20260915000000_media_assets_output_index.sql");
  assert.match(sql, /DROP INDEX IF EXISTS "public"\."media_assets_generation_original_uniq"/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_generation_output_uniq"[\s\S]{0,200}\("generation_id", "output_index"\)/,
    "identity must be widened, not dropped — the index is what makes retry converge"
  );
  assert.match(sql, /role" = 'original'/, "and it must still scope to originals");
});

test("M9-7  output_index is additive, defaulted and bounded", () => {
  const sql = read("supabase/migrations/20260915000000_media_assets_output_index.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "output_index" integer NOT NULL DEFAULT 0/);
  assert.match(sql, /"output_index" >= 0 AND "output_index" <= 99/);
  // No new authority, no grant change.
  assert.ok(!/CREATE TABLE/.test(sql), "no second media table");
  assert.ok(!/GRANT|REVOKE/.test(sql), "no grant change — RLS posture unchanged");
});

test("M9-8  reserveGenerationAsset keys idempotency on (generation, output_index)", () => {
  const svc = read("src/lib/media/asset-service.ts");
  const occurrences = (svc.match(/\.eq\("output_index", outputIndex\)/g) ?? []).length;
  assert.ok(occurrences >= 2, "both the pre-check and the unique-violation recovery must use the index");
  assert.match(svc, /output_index: outputIndex/, "and the insert must carry it");
});

test("M9-9  the completion and delivery gates evaluate EVERY output, not one row", () => {
  // Comments stripped: both functions EXPLAIN why maybeSingle() is wrong, and
  // documenting a prohibition must not read as performing it.
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const gate = strip(read("src/lib/media/ingest-gate.ts"));
  const hasVerified = gate.slice(gate.indexOf("export async function hasVerifiedOriginal"));
  assert.ok(!/maybeSingle\(\)/.test(hasVerified.slice(0, 700)), "maybeSingle throws once a generation has several outputs");
  assert.match(hasVerified.slice(0, 900), /rows\.every\(/, "completion requires every output verified");

  // PHASE 28 CHANGED THE DELIVERY HALF, DELIBERATELY.
  //
  // This used to assert `rows.every(...)` — one generation-wide answer, so a
  // single unsafe output withheld the whole batch. Phase 28 decides safety per
  // output, and collapsing that to a batch answer at the last step is a real
  // product defect: a four-image generation with one flagged output delivered
  // nothing. The safety property is not weakened — an output with no clearance
  // still gets no URL — it is now answered independently per output.
  const deliveryGate = strip(read("src/lib/media/asset-delivery-gate.ts"));
  const perOutput = deliveryGate.slice(deliveryGate.indexOf("export async function deliverableOutputIndexes"));
  assert.ok(!/maybeSingle\(\)/.test(perOutput), "maybeSingle throws once a generation has several outputs");
  assert.match(perOutput, /result\.set\(index, rowIsDeliverable\(row\)\)/, "one answer per output index");

  const storage = strip(read("src/lib/orchestration/output-storage.ts"));
  const attach = storage.slice(storage.indexOf("export async function attachSignedUrls"));
  assert.match(attach, /if \(!deliverable\.get\(index\)\)/, "an uncleared output gets no URL");
});

test("M9-10  delivery addresses an output by index, never 'the first row'", () => {
  const storage = read("src/lib/orchestration/output-storage.ts");
  const minter = storage.slice(storage.indexOf("export async function mintCanonicalAssetUrl"));
  assert.match(minter.slice(0, 900), /\.eq\("output_index", outputIndex\)/);

  const route = read("src/app/api/generations/[generationId]/asset-url/route.ts");
  assert.match(route, /searchParams\.get\("index"\)/, "the route must accept an output index");
  assert.match(route, /invalid_output_index/, "and refuse a malformed one rather than defaulting to 0");
});

// ---------------------------------------------------------------------------
// BEHAVIOURAL — three real outputs, each independently marked
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

const GEN_ID = "33333333-3333-4333-8333-333333333333";

/** Three reserved assets, exactly as reserveGenerationAsset would leave them. */
function dbWithThreeReserved() {
  return new FakeSupabaseClient({
    media_assets: [0, 1, 2].map((i) => ({
      id: `4444444${i}-4444-4444-8444-44444444444${i}`,
      clerk_user_id: "user_1",
      generation_id: GEN_ID,
      attempt_id: null,
      output_index: i,
      role: "original",
      bucket: "cinefield-media",
      object_key: `quarantine/output/user_1/asset-${i}/original.png`,
      quarantine_status: "quarantined",
      checksum_sha256: `${i}`.repeat(64),
      verified_mime: "image/png",
      status: "finalized",
    })),
    media_provenance: [],
  });
}

test("M9-11  THREE outputs each get their own asset, R2 object and provenance row — all officially VALID", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  try {
    const db = dbWithThreeReserved();
    const store = memoryStore();
    const colours = ["blue", "green", "red"];
    const digests: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const result = await processFinalMedia(db as never, {
        sourceAssetId: `4444444${i}-4444-4444-8444-44444444444${i}`,
        bytes: await makePng(colours[i]),
        verifiedMime: "image/png",
        digitalSourceType: "trainedAlgorithmicMedia",
        softwareAgent: "Cinefield (model via provider)",
        store,
        now: new Date("2026-01-01T00:00:00.000Z"),
        target: { kind: "in_place" },
      });
      assert.equal(result.outcome, "COMPLETED", `output ${i} must complete`);
      if (result.outcome !== "COMPLETED") return;
      digests.push(result.finalDigestSha256);

      // Each delivered artifact verifies on its own.
      const verified = await readEmbeddedProvenance({ bytes: result.finalBytes, mime: "image/png" });
      assert.equal(verified.present, true, `output ${i} must carry a manifest`);
      if (verified.present) assert.equal(verified.valid, true, `output ${i} must verify VALID`);
    }

    // §24: 3 R2 writes, 3 asset rows, 3 provenance rows.
    assert.equal(store.puts.length, 3, "exactly three canonical objects");
    assert.equal(db.state.media_provenance.length, 3, "exactly three provenance rows");
    assert.equal((db.state.media_assets as Record<string, unknown>[]).length, 3, "no extra asset rows");

    // §8: unique object keys, no collision.
    assert.equal(new Set(store.puts.map((p) => p.objectKey)).size, 3, "object keys must be unique");

    // §14: no cross-output digest reuse.
    assert.equal(new Set(digests).size, 3, "each output binds to its OWN bytes");

    // Every provenance row is embedded-and-verified, and each names its own asset.
    const rows = db.state.media_provenance as Record<string, unknown>[];
    assert.equal(new Set(rows.map((r) => r.media_asset_id)).size, 3, "one provenance row per asset");
    for (const row of rows) {
      assert.equal(row.marking_state, "EMBEDDED_C2PA");
      assert.ok(digests.includes(row.content_digest_sha256 as string), "each row binds to a real delivered digest");
    }
  } finally {
    resetC2paSignerMode();
  }
});

test("M9-12  a SECONDARY output cannot slip through unmarked — output 2 is marked exactly like output 0", { skip: !HAVE_FFMPEG }, async () => {
  setC2paSignerMode("test");
  try {
    const db = dbWithThreeReserved();
    const store = memoryStore();

    // Deliberately process the LAST output only. If secondary outputs were
    // ever special-cased, this is where it would show.
    const result = await processFinalMedia(db as never, {
      sourceAssetId: "44444442-4444-4444-8444-444444444442",
      bytes: await makePng("red"),
      verifiedMime: "image/png",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
      store,
      now: new Date(),
      target: { kind: "in_place" },
    });
    assert.equal(result.outcome, "COMPLETED");
    if (result.outcome !== "COMPLETED") return;
    assert.equal(result.evidence.markingState, "EMBEDDED_C2PA");

    const verified = await readEmbeddedProvenance({ bytes: result.finalBytes, mime: "image/png" });
    assert.equal(verified.present, true);
    if (verified.present) assert.equal(verified.valid, true, "the third output must verify like the first");
  } finally {
    resetC2paSignerMode();
  }
});

test("M9-13  one output failing prevents the batch — no signer means nothing is stored for it", { skip: !HAVE_FFMPEG }, async () => {
  resetC2paSignerMode();
  const db = dbWithThreeReserved();
  const store = memoryStore();
  const result = await processFinalMedia(db as never, {
    sourceAssetId: "44444441-4444-4444-8444-444444444441",
    bytes: await makePng("green"),
    verifiedMime: "image/png",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    store,
    now: new Date(),
    target: { kind: "in_place" },
  });
  assert.equal(result.outcome, "SIGNER_NOT_CONFIGURED");
  assert.equal(store.puts.length, 0, "nothing stored for an unmarkable output");
  assert.equal(db.state.media_provenance.length, 0, "and no provenance row");
});

test("M9-14  the orchestrator fails the WHOLE generation if any output cannot be marked", () => {
  const orchestrator = read("src/lib/orchestration/orchestrator.ts");
  // The loop throws from inside persistCanonicalOriginal, so markCompleted is
  // unreachable for the batch — no partial success is representable.
  const loop = orchestrator.slice(
    orchestrator.indexOf("for (const [outputIndex, resolved] of resolvedOutputs.entries())"),
    orchestrator.indexOf("const uploaded: StoredOutput[]")
  );
  assert.ok(loop.length > 0, "the per-output loop must exist");
  assert.ok(!/try\s*\{|catch\s*\(/.test(loop), "no per-output catch may swallow a failure into partial success");
});

test("M9-15  retry converges: reserving the same output twice returns the same asset", () => {
  const svc = read("src/lib/media/asset-service.ts");
  const reserve = svc.slice(svc.indexOf("export async function reserveGenerationAsset"));
  // Pre-check returns the existing row rather than inserting a rival...
  assert.match(reserve.slice(0, 1400), /if \(existing\.data\)[\s\S]{0,200}return \{ assetId: row\.id/);
  // ...and a lost race re-reads the winner instead of failing.
  assert.match(reserve, /unique index fired because a concurrent worker reserved/);
});
