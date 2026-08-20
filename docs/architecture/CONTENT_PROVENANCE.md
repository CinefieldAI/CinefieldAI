# Content provenance & AI marking (Phase 27)

AI Act Article 50(2) says a provider of a generative AI system must mark its
output in a machine-readable, detectable way. Cinefield is established in
Vienna, so that obligation attaches to the system — not to where the user
happens to be. This document says exactly what is marked, how, and what is
still missing.

**Cinefield embeds a real C2PA manifest into delivered image, video and audio
bytes, and the official ContentAuth library verifies it as valid.** It also
keeps a detached evidence row. Both layers are described below, and the parts
that are still development-grade are named as such.

---

## What exists

| Capability | State |
| --- | --- |
| C2PA manifest template (image/video/audio) | **REAL** — the roadmap's literal template, IPTC `digitalSourceType` |
| **Media transform (FFmpeg)** | **REAL** — Phase 9-C, fixed operation profiles |
| **C2PA embedded in delivered bytes** | **REAL** — png / jpeg / mp4 / wav |
| **Official verification** | **REAL** — `c2pa-node` reads it back as valid |
| **Tamper detection** | **REAL** — proven on all four formats |
| Final-media digest | **REAL** — SHA-256 over the signed bytes actually stored |
| Detached ES256 evidence | **REAL** — kept alongside the embedded manifest |
| Verification engine | **REAL** — pure, fail-closed, no URL input |
| Durable evidence store | **REAL** — `media_provenance`, append-only |
| Admin marking-rate metric | **REAL** — `/admin/provenance` |
| Signing key registered for rotation | **REAL** — Phase 25 `secret.rotate`, `DUAL_KEY_OVERLAP` |
| **Production trust-list CA chain** | **EXTERNAL** — signing uses a DEVELOPMENT certificate |
| Automatic invocation from the ingest path | **NOT WIRED** — `runMediaJob` is the entry point |
| Deepfake detection | **NOT BUILT** — Phase 28 owns T&S classification |
| Visible deepfake label in product UI | **BLOCKED** — locked UI |
| Soft-binding watermark | **NOT IN SCOPE** — roadmap: optional, second phase |

---

## The pipeline, in the roadmap's own order

```
validated bytes
  → transform (FFmpeg, fixed profile)      src/lib/media/media-transform.ts
  → FINAL BYTES                            nothing re-encodes after this
  → embed C2PA                             src/lib/provenance/c2pa-embedder.ts
  → official verify (validation_status)    c2pa-node, ContentAuth
  → SHA-256 over the signed bytes          the FINAL MEDIA digest
  → store derived asset                    Phase 9's storage seam
  → record provenance                      media_provenance, EMBEDDED_C2PA
```

**Signing is last on purpose.** A re-encode strips the manifest — the roadmap
warns about it, and this repository's own test proves it: FFmpeg-reprocessing
a signed PNG leaves no manifest at all. So the manifest is applied to bytes
nothing will touch again.

Run the proof yourself:

```bash
npm run c2pa:verify-sample
```

It generates synthetic media with FFmpeg, embeds provenance, verifies with the
official library, then tampers with one byte and confirms rejection.

---

## Two digests, never conflated

| Name | What it covers | Owner |
| --- | --- | --- |
| **SOURCE digest** | the original downloaded bytes | Phase 9-B `ingest-gate.ts` |
| **FINAL MEDIA digest** | the signed bytes actually delivered | Phase 9-C pipeline |

The provenance row binds to the **derived** asset, so its
`content_digest_sha256` is always the final-media digest. Reusing the source
digest after a transform would produce evidence that verifies against bytes
nobody was ever served.

The derived asset uses Phase 9's own lineage design — `role = 'derived'` with
`parent_asset_id` pointing at the original. `media_assets.sql` says of that
column, verbatim, *"9-C fills this in"*. No new table, no new migration.

---

## Format support — measured, not assumed

Every row below was verified by running the official library.

| Final format | Transform profile | Embed | Official verify | Tamper code |
| --- | --- | --- | --- | --- |
| `image/png` | `image_normalize_png` | ✅ | VALID | `assertion.dataHash.mismatch` |
| `image/jpeg` | `image_normalize_jpeg` | ✅ | VALID | `assertion.dataHash.mismatch` |
| `video/mp4` | `video_normalize_mp4` | ✅ | VALID | `assertion.bmffHash.mismatch` |
| `audio/wav` | `audio_normalize_wav` | ✅ | VALID | `claimSignature.mismatch` |
| `image/gif` | — | ❌ | — | refused: animated, would be destroyed by a single-frame normalise |

`webp`/`avif` normalise to PNG, and `webm`/`mpeg` to mp4/wav, so their final
delivered form is markable even though the input container is not.

---

## Trust: what the signature does and does not mean

Signing currently uses `c2pa-node`'s own `createTestSigner()` — a
**development certificate that the C2PA ecosystem does not trust**. The
official verifier reports its issuer as `C2PA Test Signing Cert`, and
`/admin/provenance` shows it.

So today:

- the **mechanism** is proven end to end — real manifest, real embed, real
  official verification, real tamper detection
- the **trust** is not — a third party validating one of these files sees a
  test certificate, not a trust-list identity

`C2paSignerMode` defaults to `"none"`, and with no signer the pipeline stops
at `SIGNER_NOT_CONFIGURED` and writes nothing at all: no stored object, no
derived asset row, no provenance record. An unsigned artifact is never
delivered as if it were marked.

Obtaining a production certificate is the remaining external step.

---

## What the claim actually asserts

Only facts Cinefield can prove:

- these bytes (by SHA-256) were produced through Cinefield
- by a trained model (IPTC `trainedAlgorithmicMedia`)
- by this software agent, at this time, under this manifest version

It asserts **nothing** about copyright ownership, human authorship, the
truthfulness of the depicted content, or any provider certification. Adding
any of those would be a claim the system cannot back.

---

## The signature covers the digest, on purpose

`canonicalClaim()` is a fixed, ordered, newline-delimited field list rather
than `JSON.stringify(manifest)`. Two reasons, both load-bearing:

1. **The digest is inside the signed bytes.** Otherwise a valid signed
   manifest could be lifted onto different content and still verify — the one
   attack this whole package exists to prevent. A test proves the lift fails.
2. **Byte stability.** `JSON.stringify` preserves insertion order, so two
   structurally identical manifests could serialize differently and fail
   verification for no real reason.

The manifest version is also inside the signed bytes, so an old signature
cannot silently validate against a new claim shape.

---

## Verification outcomes

Fail-closed. `VERIFIED` is reachable only by falling through every check:

| Outcome | Means |
| --- | --- |
| `VERIFIED` | Signature valid, signer trusted, digest matches these bytes |
| `DIGEST_MISMATCH` | These are not the bytes that were signed |
| `INVALID_SIGNATURE` | Signature does not verify against the claim |
| `UNTRUSTED_SIGNER` | No trusted public key for this key id |
| `SIGNER_UNAVAILABLE` | Evidence exists and matches, but nothing signed it |
| `MISSING_EVIDENCE` | No provenance record for this asset |
| `UNSUPPORTED_FORMAT` | Format not recognised |
| `UNAVAILABLE` | Could not check |

The digest check runs **before** any signature work. If the bytes changed, the
answer is "these are not the bytes that were signed" regardless of whether the
signature is well-formed — reporting a crypto error for a content substitution
would point an investigation the wrong way.

`SIGNER_UNAVAILABLE` is worth reading twice: an unsigned record proves only
that Cinefield wrote a row, not that the row is authentic. It is never
`VERIFIED`.

---

## Format support

`c2patool` carries a manifest in mp4/jpg/png/wav. Everything else Cinefield
can store is `SIDECAR_ONLY` — stated per format rather than as one fabricated
uniform claim.

| Format | Support |
| --- | --- |
| image/jpeg, image/png, video/mp4, audio/wav | `EMBED_CAPABLE` |
| image/webp, image/gif, image/avif, video/webm, audio/mpeg | `SIDECAR_ONLY` |

`EMBED_CAPABLE` describes what the **container could carry** once a sign step
exists. It does not mean Cinefield embeds anything today. Nothing does.

---

## The honest durability warning — now measured

Straight from the roadmap: a C2PA manifest lives in file metadata and is
stripped by re-encoding — which is what Instagram and TikTok do to everything.

**This is confirmed here, not assumed.** Test `C9C-11` signs a PNG, runs it
back through FFmpeg, and finds *no manifest at all* in the result. The
roadmap's answer is that C2PA is the defensible "state of the art" primary
solution, paired with an invisible watermark for real durability, and that the
watermark is second-phase work.

The detached record has the same exposure from the other direction: it
survives re-encoding of the delivered copy (the row is in the database), but
it no longer matches those re-encoded bytes, so verification correctly reports
`DIGEST_MISMATCH`. That is the truthful answer, not a failure of the design.

---

## Keys

The signing key is never in this repository. A test greps `src/`, `supabase/`,
`infra/` and `docs/` for `BEGIN … PRIVATE KEY` and fails on any hit.

`CINEFIELD_PROVENANCE_SIGNING_KEY_PEM` is registered in the Phase 12-D/25
secret registry as `DUAL_KEY_OVERLAP`, which puts its rotation under Phase
25's `secret.rotate` — Tier-0, two-person. Phase 27 is not a key lifecycle
owner and contains no rotation logic.

**Rotation here is deliberately asymmetric.** Every `media_provenance` row
already signed by the outgoing key must keep verifying, so the old *public*
key stays trusted indefinitely; only the old *private* key is retired.
Retiring the public key would turn historical evidence into
`UNTRUSTED_SIGNER`. `docs/runbooks/secret-rotation.md` states this in the
key's own row.

---

## Privacy

`media_provenance` has **no `clerk_user_id` column**, deliberately. Ownership
is reachable by joining `media_assets`; storing a second copy of a personal
identifier would enlarge Phase 23's deletion blast radius for no gain.

Phase 23's account deletion *tombstones* `media_assets` rows rather than
deleting them, so provenance evidence survives an ordinary erasure — correct,
because it contains no personal data and is Article 50(2) compliance
evidence. The `ON DELETE CASCADE` handles the case where a row is genuinely
hard-deleted, so no orphan evidence is left behind.

---

## What provenance does *not* authorise

A `VERIFIED` result is evidence. It does not release an asset from
quarantine, publish anything, change routing, or move a release stage. The
provenance package never reads `quarantine_status` as permission and never
writes it — Phase 9-E remains the only authority there, and a test enforces
that the package does not touch it at all.

---

## Legal boundary

This phase implements **technical marking**. It makes no legal determination.

- Article 50(2), machine-readable mark → **provider** duty → implemented here
- Article 50(4), visible deepfake label → **deployer** duty → transferred by
  ToS/AUP, which is Phase 29's ownership; Cinefield provides the mechanism

`DisclosureRequirement` defaults to `NOT_ASSESSED` and never to
`NONE_REQUIRED`, because no deepfake classifier exists here and claiming "no
label needed" from no evidence would be exactly the legal-shaped assertion
this boundary forbids.

---

## Official sources

- C2PA — https://c2pa.org/
- Content Credentials (verify tool) — https://contentcredentials.org/
- c2patool — https://github.com/contentauth/c2patool
- IPTC DigitalSourceType — https://cv.iptc.org/newscodes/digitalsourcetype/
- EU AI Act Article 50 — https://artificialintelligenceact.eu/article/50/
- EC transparency guidelines — https://digital-strategy.ec.europa.eu/en/policies/guidelines-transparency-ai-generated-content
