import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import {
  CLAIM_GENERATOR,
  DIGITAL_SOURCE_TYPE_BASE,
  FORMAT_PROVENANCE_SUPPORT,
  MANIFEST_VERSION,
  MARKED_STATES,
  PROVENANCE_MARKING_STATES,
  PROVENANCE_VERIFICATION_OUTCOMES,
  digitalSourceTypeUri,
  formatSupport,
  isProvenanceVerified,
  type ProvenanceEvidence,
} from "@/lib/provenance/provenance-contract";
import { buildC2paManifest, canonicalClaim } from "@/lib/provenance/manifest-builder";
import {
  Es256Signer,
  UnconfiguredSigner,
  resetProvenanceSigner,
  setProvenanceSigner,
  verifyEs256,
  type ProvenanceSigner,
} from "@/lib/provenance/content-signer";
import { verifyProvenance } from "@/lib/provenance/provenance-verifier";
import { recordMediaProvenance, provenanceFor } from "@/lib/provenance/provenance-service";
import { getProvenanceAdminView } from "@/lib/admin/provenance-admin-service";
import { ALLOWED_VERIFIED_MIMES } from "@/lib/media/mime-detect";
import { SECRET_REGISTRY } from "@/lib/config/secret-registry";
import { FakeSupabaseClient } from "./fake-supabase";

/**
 * Phase 27 — Content Provenance & AI Act Marking (C2PA).
 *
 * The load-bearing tests here are the cryptographic ones (P27-20..25): they
 * generate an ephemeral ES256 keypair in memory, sign a real claim, and prove
 * that a one-byte change to the content digest, the claim, or the signature
 * makes verification fail. No key material is committed anywhere.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ---------------------------------------------------------------------------
// Contract shape (27-A)
// ---------------------------------------------------------------------------

test("P27-1  the IPTC DigitalSourceType URI matches the official vocabulary base exactly", () => {
  assert.equal(DIGITAL_SOURCE_TYPE_BASE, "http://cv.iptc.org/newscodes/digitalsourcetype/");
  assert.equal(
    digitalSourceTypeUri("trainedAlgorithmicMedia"),
    "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
  );
});

test("P27-2  claim_generator is the roadmap's literal value", () => {
  assert.equal(CLAIM_GENERATOR, "cinefield/1.0");
});

test("P27-3  the manifest matches the roadmap's own template structure field for field", () => {
  const built = buildC2paManifest({
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
  });
  assert.ok(built.ok);
  if (!built.ok) return;
  assert.equal(built.manifest.claim_generator, "cinefield/1.0");
  assert.equal(built.manifest.assertions.length, 1);
  const assertion = built.manifest.assertions[0];
  assert.equal(assertion.label, "c2pa.actions");
  assert.equal(assertion.data.actions.length, 1);
  assert.equal(assertion.data.actions[0].action, "c2pa.created");
  assert.match(assertion.data.actions[0].digitalSourceType, /digitalsourcetype\/trainedAlgorithmicMedia$/);
  assert.equal(assertion.data.actions[0].softwareAgent, "Cinefield (model via provider)");
});

test("P27-4  a softwareAgent carrying a prompt or payload is refused", () => {
  for (const bad of [
    "a cinematic shot of a woman walking through neon rain, 8k, highly detailed",
    "Cinefield\n{\"prompt\":\"secret\"}",
    "",
    "x".repeat(200),
  ]) {
    const built = buildC2paManifest({ digitalSourceType: "trainedAlgorithmicMedia", softwareAgent: bad });
    assert.equal(built.ok, false, `should refuse: ${bad.slice(0, 30)}`);
  }
});

test("P27-5  the canonical claim is byte-stable and includes the digest and manifest version", () => {
  const input = {
    manifestVersion: MANIFEST_VERSION,
    mediaAssetId: "asset-1",
    contentDigestSha256: "a".repeat(64),
    verifiedMime: "image/png",
    digitalSourceType: "trainedAlgorithmicMedia" as const,
    softwareAgent: "Cinefield (model via provider)",
    claimGenerator: CLAIM_GENERATOR,
  };
  const a = canonicalClaim(input);
  const b = canonicalClaim({ ...input });
  assert.equal(a, b, "same input must produce identical bytes");
  assert.match(a, /digest=a{64}/, "the content digest must be inside the signed bytes");
  assert.match(a, new RegExp(`v=${MANIFEST_VERSION}`), "the manifest version must be inside the signed bytes");
});

// ---------------------------------------------------------------------------
// Format matrix (27-A) — honest, per format
// ---------------------------------------------------------------------------

test("P27-6  every mime Phase 9-B can verify has an explicit provenance support classification", () => {
  for (const mime of ALLOWED_VERIFIED_MIMES) {
    assert.ok(formatSupport(mime) !== null, `${mime} has no provenance support classification`);
  }
});

test("P27-7  the embed-capable set matches c2patool's documented formats (mp4/jpg/png/wav), nothing invented", () => {
  const embedCapable = Object.entries(FORMAT_PROVENANCE_SUPPORT)
    .filter(([, v]) => v === "EMBED_CAPABLE")
    .map(([k]) => k)
    .sort();
  assert.deepEqual(embedCapable, ["audio/wav", "image/jpeg", "image/png", "video/mp4"]);
});

test("P27-8  an unknown mime has no support classification, rather than a defaulted one", () => {
  assert.equal(formatSupport("application/pdf"), null);
  assert.equal(formatSupport("image/svg+xml"), null);
});

// ---------------------------------------------------------------------------
// Marking states
// ---------------------------------------------------------------------------

test("P27-9  EMBEDDED_C2PA is a declared state that NO code path in src/ constructs", () => {
  assert.ok(PROVENANCE_MARKING_STATES.includes("EMBEDDED_C2PA"));
  const producers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full);
        continue;
      }
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      const rel = full.replace(/\\/g, "/");
      // The contract declares it; the migration/admin service may compare
      // against it. Only an ASSIGNMENT would make it reachable.
      if (rel.endsWith("provenance-contract.ts")) continue;
      if (rel.includes("/test/")) continue;
      const code = readFileSync(full, "utf8");
      if (/markingState\s*[:=]\s*"EMBEDDED_C2PA"/.test(code)) producers.push(rel);
    }
  };
  walk(join(ROOT, "src"));
  assert.deepEqual(producers, [], "no code may claim embedded C2PA until a real embed step exists");
});

test("P27-10  NOT_MARKED is not counted as marked in the coverage metric", () => {
  assert.ok(!MARKED_STATES.has("NOT_MARKED"));
  assert.ok(MARKED_STATES.has("EVIDENCE_RECORDED"));
  assert.ok(MARKED_STATES.has("SIGNED_DETACHED"));
});

// ---------------------------------------------------------------------------
// Verification outcomes — fail closed
// ---------------------------------------------------------------------------

test("P27-11  exactly one verification outcome counts as success", () => {
  const successes = PROVENANCE_VERIFICATION_OUTCOMES.filter(isProvenanceVerified);
  assert.deepEqual(successes, ["VERIFIED"]);
});

test("P27-12  missing evidence is MISSING_EVIDENCE, never VERIFIED", () => {
  const verdict = verifyProvenance({ evidence: null, observedDigestSha256: "a".repeat(64) });
  assert.equal(verdict.outcome, "MISSING_EVIDENCE");
});

function evidenceFixture(overrides: Partial<ProvenanceEvidence> = {}): ProvenanceEvidence {
  return {
    mediaAssetId: "asset-1",
    generationId: "gen-1",
    attemptId: null,
    markingState: "SIGNED_DETACHED",
    digitalSourceType: "trainedAlgorithmicMedia",
    claimGenerator: CLAIM_GENERATOR,
    softwareAgent: "Cinefield (model via provider)",
    contentDigestSha256: "a".repeat(64),
    verifiedMime: "image/png",
    formatSupport: "EMBED_CAPABLE",
    manifestVersion: MANIFEST_VERSION,
    signature: null,
    signerKeyId: null,
    disclosureRequirement: "NOT_ASSESSED",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("P27-13  a digest mismatch is reported before any signature work", () => {
  const verdict = verifyProvenance({
    evidence: evidenceFixture({ signature: "x", signerKeyId: "k1" }),
    observedDigestSha256: "b".repeat(64),
    trustedPublicKeys: {},
  });
  assert.equal(verdict.outcome, "DIGEST_MISMATCH");
});

test("P27-14  unsigned evidence that matches the digest is SIGNER_UNAVAILABLE, never VERIFIED", () => {
  const verdict = verifyProvenance({
    evidence: evidenceFixture({ markingState: "EVIDENCE_RECORDED" }),
    observedDigestSha256: "a".repeat(64),
  });
  assert.equal(verdict.outcome, "SIGNER_UNAVAILABLE");
});

test("P27-15  a signature from an untrusted key id is UNTRUSTED_SIGNER", () => {
  const verdict = verifyProvenance({
    evidence: evidenceFixture({ signature: "x", signerKeyId: "unknown-key" }),
    observedDigestSha256: "a".repeat(64),
    trustedPublicKeys: {},
  });
  assert.equal(verdict.outcome, "UNTRUSTED_SIGNER");
});

test("P27-16  an unrecognised format is UNSUPPORTED_FORMAT", () => {
  const verdict = verifyProvenance({
    evidence: evidenceFixture({ verifiedMime: "application/pdf" }),
    observedDigestSha256: "a".repeat(64),
  });
  assert.equal(verdict.outcome, "UNSUPPORTED_FORMAT");
});

// ---------------------------------------------------------------------------
// REAL CRYPTOGRAPHY — ephemeral keypair, never committed (LOCAL_CRYPTO_PROOF)
// ---------------------------------------------------------------------------

function ephemeralKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

test("P27-17  the DEFAULT signer signs nothing and says so", () => {
  // Through the interface, which is how every real caller reaches it.
  const signer: ProvenanceSigner = new UnconfiguredSigner();
  const outcome = signer.sign("anything");
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reasonCode, "signer_not_configured");
  assert.equal(signer.keyId, null);
});

test("P27-18  a real ES256 signature over the canonical claim verifies", () => {
  const { privateKeyPem, publicKeyPem } = ephemeralKeyPair();
  const claim = canonicalClaim({
    manifestVersion: MANIFEST_VERSION,
    mediaAssetId: "asset-1",
    contentDigestSha256: "a".repeat(64),
    verifiedMime: "image/png",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    claimGenerator: CLAIM_GENERATOR,
  });
  const signed = new Es256Signer({ privateKeyPem, keyId: "test-key-1" }).sign(claim);
  assert.ok(signed.ok);
  if (!signed.ok) return;
  assert.ok(verifyEs256({ claim, signatureBase64: signed.result.signature, publicKeyPem }));
});

test("P27-19  TAMPER: a one-character change to the signed claim invalidates the signature", () => {
  const { privateKeyPem, publicKeyPem } = ephemeralKeyPair();
  const claim = "v=1\nasset=a\ndigest=" + "a".repeat(64);
  const signed = new Es256Signer({ privateKeyPem, keyId: "k" }).sign(claim);
  assert.ok(signed.ok);
  if (!signed.ok) return;
  const tampered = "v=1\nasset=a\ndigest=" + "a".repeat(63) + "b";
  assert.equal(verifyEs256({ claim: tampered, signatureBase64: signed.result.signature, publicKeyPem }), false);
});

test("P27-20  TAMPER: a signature from a DIFFERENT key does not verify", () => {
  const a = ephemeralKeyPair();
  const b = ephemeralKeyPair();
  const claim = "v=1\nasset=a";
  const signed = new Es256Signer({ privateKeyPem: a.privateKeyPem, keyId: "k" }).sign(claim);
  assert.ok(signed.ok);
  if (!signed.ok) return;
  assert.equal(verifyEs256({ claim, signatureBase64: signed.result.signature, publicKeyPem: b.publicKeyPem }), false);
});

test("P27-21  TAMPER: a corrupted signature does not verify", () => {
  const { privateKeyPem, publicKeyPem } = ephemeralKeyPair();
  const claim = "v=1\nasset=a";
  const signed = new Es256Signer({ privateKeyPem, keyId: "k" }).sign(claim);
  assert.ok(signed.ok);
  if (!signed.ok) return;
  const buf = Buffer.from(signed.result.signature, "base64");
  buf[buf.length - 1] ^= 0xff;
  assert.equal(verifyEs256({ claim, signatureBase64: buf.toString("base64"), publicKeyPem }), false);
});

test("P27-22  END TO END: signed evidence VERIFIES, and the same evidence against changed bytes does not", () => {
  const { privateKeyPem, publicKeyPem } = ephemeralKeyPair();
  const digest = "c".repeat(64);
  const evidenceBase = evidenceFixture({ contentDigestSha256: digest });
  const claim = canonicalClaim({
    manifestVersion: evidenceBase.manifestVersion,
    mediaAssetId: evidenceBase.mediaAssetId,
    contentDigestSha256: digest,
    verifiedMime: evidenceBase.verifiedMime,
    digitalSourceType: evidenceBase.digitalSourceType,
    softwareAgent: evidenceBase.softwareAgent,
    claimGenerator: evidenceBase.claimGenerator,
  });
  const signed = new Es256Signer({ privateKeyPem, keyId: "trusted-1" }).sign(claim);
  assert.ok(signed.ok);
  if (!signed.ok) return;

  const evidence = evidenceFixture({
    contentDigestSha256: digest,
    signature: signed.result.signature,
    signerKeyId: "trusted-1",
  });

  assert.equal(
    verifyProvenance({
      evidence,
      observedDigestSha256: digest,
      trustedPublicKeys: { "trusted-1": publicKeyPem },
    }).outcome,
    "VERIFIED"
  );

  // Same signed evidence, different bytes.
  assert.equal(
    verifyProvenance({
      evidence,
      observedDigestSha256: "d".repeat(64),
      trustedPublicKeys: { "trusted-1": publicKeyPem },
    }).outcome,
    "DIGEST_MISMATCH"
  );
});

test("P27-23  a signature lifted onto DIFFERENT evidence fields does not verify", () => {
  const { privateKeyPem, publicKeyPem } = ephemeralKeyPair();
  const digest = "e".repeat(64);
  const base = evidenceFixture({ contentDigestSha256: digest });
  const claim = canonicalClaim({
    manifestVersion: base.manifestVersion,
    mediaAssetId: base.mediaAssetId,
    contentDigestSha256: digest,
    verifiedMime: base.verifiedMime,
    digitalSourceType: base.digitalSourceType,
    softwareAgent: base.softwareAgent,
    claimGenerator: base.claimGenerator,
  });
  const signed = new Es256Signer({ privateKeyPem, keyId: "trusted-1" }).sign(claim);
  assert.ok(signed.ok);
  if (!signed.ok) return;

  // Same digest, same signature — but the claim now says a different asset.
  const lifted = evidenceFixture({
    mediaAssetId: "a-different-asset",
    contentDigestSha256: digest,
    signature: signed.result.signature,
    signerKeyId: "trusted-1",
  });
  assert.equal(
    verifyProvenance({
      evidence: lifted,
      observedDigestSha256: digest,
      trustedPublicKeys: { "trusted-1": publicKeyPem },
    }).outcome,
    "INVALID_SIGNATURE"
  );
});

// ---------------------------------------------------------------------------
// Recording service — Phase 9 seam reuse, fail-closed
// ---------------------------------------------------------------------------

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    generation_id: "gen-1",
    attempt_id: null,
    checksum_sha256: "f".repeat(64),
    verified_mime: "image/png",
    status: "finalized",
    ...overrides,
  };
}

test("P27-24  an asset the ingest gate never verified cannot get provenance", async () => {
  const db = new FakeSupabaseClient({ media_assets: [assetRow({ checksum_sha256: null })], media_provenance: [] });
  const result = await recordMediaProvenance(db as never, {
    mediaAssetId: "asset-1",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(result.outcome, "DIGEST_UNAVAILABLE");
  assert.equal(db.state.media_provenance.length, 0);
});

test("P27-25  an unknown asset is refused", async () => {
  const db = new FakeSupabaseClient({ media_assets: [], media_provenance: [] });
  const result = await recordMediaProvenance(db as never, {
    mediaAssetId: "nope",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    now: new Date(),
  });
  assert.equal(result.outcome, "ASSET_NOT_FOUND");
});

test("P27-26  with NO signer configured, evidence records UNSIGNED — never a fabricated signature", async () => {
  resetProvenanceSigner();
  const db = new FakeSupabaseClient({ media_assets: [assetRow()], media_provenance: [] });
  const result = await recordMediaProvenance(db as never, {
    mediaAssetId: "asset-1",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(result.outcome, "RECORDED");
  if (result.outcome !== "RECORDED") return;
  assert.equal(result.evidence.markingState, "EVIDENCE_RECORDED");
  assert.equal(result.evidence.signature, null);
  assert.equal(result.evidence.signerKeyId, null);
});

test("P27-27  with a real signer installed, evidence records SIGNED_DETACHED and verifies end to end", async () => {
  const { privateKeyPem, publicKeyPem } = ephemeralKeyPair();
  setProvenanceSigner(new Es256Signer({ privateKeyPem, keyId: "test-signer" }));
  try {
    const db = new FakeSupabaseClient({ media_assets: [assetRow()], media_provenance: [] });
    const result = await recordMediaProvenance(db as never, {
      mediaAssetId: "asset-1",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    assert.equal(result.outcome, "RECORDED");
    if (result.outcome !== "RECORDED") return;
    assert.equal(result.evidence.markingState, "SIGNED_DETACHED");

    const stored = await provenanceFor(db as never, "asset-1");
    assert.ok(stored);
    assert.equal(
      verifyProvenance({
        evidence: stored,
        observedDigestSha256: "f".repeat(64),
        trustedPublicKeys: { "test-signer": publicKeyPem },
      }).outcome,
      "VERIFIED"
    );
  } finally {
    resetProvenanceSigner();
  }
});

test("P27-28  disclosure defaults to NOT_ASSESSED — never NONE_REQUIRED, since no deepfake classifier exists", async () => {
  resetProvenanceSigner();
  const db = new FakeSupabaseClient({ media_assets: [assetRow()], media_provenance: [] });
  const result = await recordMediaProvenance(db as never, {
    mediaAssetId: "asset-1",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    now: new Date(),
  });
  assert.equal(result.outcome, "RECORDED");
  if (result.outcome !== "RECORDED") return;
  assert.equal(result.evidence.disclosureRequirement, "NOT_ASSESSED");
});

test("P27-29  the recorded row contains no prompt, object key, bucket, or signed URL", async () => {
  resetProvenanceSigner();
  const db = new FakeSupabaseClient({ media_assets: [assetRow()], media_provenance: [] });
  await recordMediaProvenance(db as never, {
    mediaAssetId: "asset-1",
    digitalSourceType: "trainedAlgorithmicMedia",
    softwareAgent: "Cinefield (model via provider)",
    now: new Date(),
  });
  const row = db.state.media_provenance[0] as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    assert.ok(
      !/prompt|object_key|bucket|signed_url|url|token|secret|payload|clerk_user_id/i.test(key),
      `unexpected field on a provenance row: ${key}`
    );
  }
});

// ---------------------------------------------------------------------------
// Admin coverage (27-D)
// ---------------------------------------------------------------------------

test("P27-30  coverage reports null (not 1.0, not 0) when there are no finalized assets", async () => {
  const db = new FakeSupabaseClient({ media_assets: [], media_provenance: [] });
  const view = await getProvenanceAdminView(db as never);
  assert.equal(view.outcome, "FOUND");
  if (view.outcome !== "FOUND") return;
  assert.equal(view.view.coverage.markedRatio, null);
  assert.equal(view.view.embeddingPipelineAvailable, false);
});

test("P27-31  the admin view never exposes the signature value, only a presence flag", async () => {
  const { privateKeyPem } = ephemeralKeyPair();
  setProvenanceSigner(new Es256Signer({ privateKeyPem, keyId: "test-signer" }));
  try {
    const db = new FakeSupabaseClient({ media_assets: [assetRow()], media_provenance: [] });
    await recordMediaProvenance(db as never, {
      mediaAssetId: "asset-1",
      digitalSourceType: "trainedAlgorithmicMedia",
      softwareAgent: "Cinefield (model via provider)",
      now: new Date(),
    });
    const view = await getProvenanceAdminView(db as never);
    assert.equal(view.outcome, "FOUND");
    if (view.outcome !== "FOUND") return;
    const row = view.view.recent[0];
    assert.equal(row.signed, true);
    assert.ok(!("signature" in row), "the admin row must not carry the signature value");
  } finally {
    resetProvenanceSigner();
  }
});

test("P27-32  a read failure is SOURCE_UNAVAILABLE, never a fabricated FOUND", async () => {
  const broken = {
    from: () => ({
      select: () => ({
        eq: async () => ({ count: null, error: { message: "boom" } }),
        order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }),
      }),
    }),
  };
  const view = await getProvenanceAdminView(broken as never);
  assert.equal(view.outcome, "SOURCE_UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// Key boundary (27-B) and ownership
// ---------------------------------------------------------------------------

test("P27-33  NO private key material exists anywhere in the tracked tree", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|json|sql|md|pem|key|env|example|yml|yaml|tf)$/.test(entry)) continue;
      const code = readFileSync(full, "utf8");
      // The literal is split so this test file itself is not a match.
      if (new RegExp("-----BEGIN [A-Z ]*" + "PRIVATE KEY").test(code)) {
        hits.push(full.replace(/\\/g, "/"));
      }
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "supabase"));
  walk(join(ROOT, "infra"));
  walk(join(ROOT, "docs"));
  assert.deepEqual(hits, [], "a private key must never be committed");
});

test("P27-34  the signing key is registered with a rotation class and owner (27-B's 'rotation sahibi tanımlı')", () => {
  const key = SECRET_REGISTRY.find((e) => e.name === "CINEFIELD_PROVENANCE_SIGNING_KEY_PEM");
  assert.ok(key, "the provenance signing key must be in the Phase 12-D/25 registry");
  assert.equal(key!.class, "SERVER_SECRET");
  assert.equal(key!.rotation, "DUAL_KEY_OVERLAP");
  assert.match(read("docs/runbooks/secret-rotation.md"), /CINEFIELD_PROVENANCE_SIGNING_KEY_PEM/);
});

test("P27-35  Phase 27 does not become a key lifecycle owner — no rotation logic in the provenance package", () => {
  for (const file of ["provenance-contract.ts", "manifest-builder.ts", "content-signer.ts", "provenance-verifier.ts", "provenance-service.ts"]) {
    const code = read(`src/lib/provenance/${file}`);
    assert.ok(!/rotateSecret|executeSecretRotation|upsert_secret_rotation_state/.test(code), `${file} must not rotate keys`);
  }
});

test("P27-36  generated-media provenance is kept separate from Phase 24 software provenance", () => {
  for (const file of readdirSync(join(ROOT, "src/lib/provenance"))) {
    const code = read(`src/lib/provenance/${file}`);
    assert.ok(!/release-provenance|generate-sbom|attest-build-provenance/.test(code), `${file} must not reuse Phase 24's software attestation`);
  }
  // And the reverse: Phase 24's own module must not learn about media.
  const sw = read("src/lib/deployment/release-provenance.ts");
  assert.ok(!/media_provenance|c2pa/i.test(sw), "Phase 24 must not absorb media provenance");
});

test("P27-37  the provenance package never reads or writes storage — Phase 9 remains the storage owner", () => {
  for (const file of readdirSync(join(ROOT, "src/lib/provenance"))) {
    const code = read(`src/lib/provenance/${file}`);
    assert.ok(!/r2-client|PutObjectCommand|GetObjectCommand|createSignedUrl|storage\.from/.test(code), `${file} must not touch storage`);
  }
});

test("P27-38  the provenance package never mutates media_assets", () => {
  const code = read("src/lib/provenance/provenance-service.ts");
  assert.ok(!/from\("media_assets"\)[\s\S]{0,120}\.(update|insert|delete|upsert)\(/.test(code));
});

test("P27-39  no AI-callable path can sign or override provenance", () => {
  for (const file of readdirSync(join(ROOT, "src/lib/provenance"))) {
    const code = read(`src/lib/provenance/${file}`);
    assert.ok(!/requireAiWritePolicy/.test(code), `${file} must have no AI write path`);
  }
  const actions = JSON.parse(read("policies/data/actions.json"));
  assert.ok(!("provenance.sign" in actions.actions), "no AI-invocable provenance action may be registered");
});

// ---------------------------------------------------------------------------
// Migration hygiene (27-A) and quarantine boundary
// ---------------------------------------------------------------------------

test("P27-40  the migration grants nothing to anon/authenticated and stores no key material", () => {
  const sql = read("supabase/migrations/20260914000000_media_provenance.sql");
  assert.match(sql, /REVOKE ALL ON TABLE "public"\."media_provenance" FROM "anon", "authenticated"/);
  assert.match(sql, /GRANT SELECT, INSERT ON TABLE "public"\."media_provenance" TO "service_role"/);
  assert.ok(!/private_key|privateKey|certificate_pem/i.test(sql));
  assert.ok(!/GRANT[^;]*UPDATE[^;]*media_provenance/i.test(sql), "evidence is append-only");
});

test("P27-41  the digest column structurally refuses anything that is not a SHA-256 hex string", () => {
  const sql = read("supabase/migrations/20260914000000_media_provenance.sql");
  assert.match(sql, /content_digest_sha256" ~ '\^\[0-9a-f\]\{64\}\$'/);
});

test("P27-42  a signature cannot be stored without its key id, and SIGNED_DETACHED requires a signature", () => {
  const sql = read("supabase/migrations/20260914000000_media_provenance.sql");
  assert.match(sql, /media_provenance_signature_pairing/);
  assert.match(sql, /media_provenance_signed_state_requires_signature/);
});

test("P27-43  provenance does not bypass Phase 9-E quarantine — it never reads or writes quarantine_status", () => {
  for (const file of readdirSync(join(ROOT, "src/lib/provenance"))) {
    const code = read(`src/lib/provenance/${file}`);
    assert.ok(!/quarantine_status|quarantine/.test(code.replace(/^\s*\*.*$/gm, "")), `${file} must not touch quarantine state`);
  }
});

test("P27-44  the admin provenance route is read-only — no POST exists", () => {
  const code = read("src/app/api/admin/provenance/route.ts");
  assert.match(code, /export async function GET/);
  assert.ok(!/export async function POST|export async function PUT|export async function DELETE/.test(code));
  assert.match(code, /requireAdminAccess/);
  assert.match(code, /guardRoute\(\{\s*routeClass:\s*"authenticated_read"/);
});

test("P27-45  no second media or provenance table was created", () => {
  const sql = read("supabase/migrations/20260914000000_media_provenance.sql");
  const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "public"\."([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(created, ["media_provenance"]);
  assert.match(sql, /REFERENCES "public"\."media_assets"\("id"\) ON DELETE CASCADE/);
});
