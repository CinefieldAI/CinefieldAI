import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateR2Env } from "@/lib/media/r2-config";
import {
  buildAssetObjectKey,
  safeExtension,
  keyBelongsToOwner,
} from "@/lib/media/asset-keys";
import {
  reserveGenerationAsset,
  storeAndFinalizeAsset,
  hasFinalizedOriginal,
} from "@/lib/media/asset-service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 9-A. The properties that matter are ownership of the object key and
 * the ordering of the completion boundary — a key the client can influence
 * and a completion that outruns storage are the two ways this design fails.
 */

const ROOT = process.cwd();
const OWNER = "user_3HSYp4wS80CntTvS8iQqgx2QKWE";
const ASSET = "11111111-1111-4111-8111-111111111111";
const GEN = "22222222-2222-4222-8222-222222222222";

const VALID_ENV = {
  accessKeyId: "ak",
  secretAccessKey: "sk",
  endpoint: "https://account.r2.cloudflarestorage.com",
  bucket: "cinefield-media",
};

// A well-formed but entirely fake configuration. These tests never open a
// socket: the S3 client is constructed lazily and nothing here reaches `send`.
process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ??= VALID_ENV.accessKeyId;
process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??= VALID_ENV.secretAccessKey;
process.env.CLOUDFLARE_R2_ENDPOINT ??= VALID_ENV.endpoint;
process.env.CLOUDFLARE_R2_BUCKET ??= VALID_ENV.bucket;

// ---------------------------------------------------------------------------
// 1. R2 configuration
// ---------------------------------------------------------------------------

test("1. a complete, well-formed R2 configuration validates", () => {
  assert.equal(validateR2Env(VALID_ENV), null);
});

test("1b. each missing variable is named specifically", () => {
  assert.equal(validateR2Env({ ...VALID_ENV, accessKeyId: undefined }), "missing_access_key_id");
  assert.equal(validateR2Env({ ...VALID_ENV, secretAccessKey: undefined }), "missing_secret_access_key");
  assert.equal(validateR2Env({ ...VALID_ENV, endpoint: undefined }), "missing_endpoint");
  assert.equal(validateR2Env({ ...VALID_ENV, bucket: undefined }), "missing_bucket");
});

test("1c. an endpoint with the bucket appended is rejected", () => {
  // Cloudflare shows it this way in some views; accepting it would address
  // /bucket/bucket/key and fail confusingly much later.
  assert.equal(
    validateR2Env({ ...VALID_ENV, endpoint: "https://account.r2.cloudflarestorage.com/cinefield-media" }),
    "endpoint_has_path"
  );
  assert.equal(validateR2Env({ ...VALID_ENV, endpoint: "http://account.r2.cloudflarestorage.com" }), "endpoint_scheme");
  assert.equal(validateR2Env({ ...VALID_ENV, endpoint: "not a url" }), "endpoint_invalid");
});

test("1d. a bucket name that could smuggle a path is rejected", () => {
  for (const bucket of ["cinefield-media/evil", "../other", "UPPER", "a", "x".repeat(70)]) {
    assert.equal(validateR2Env({ ...VALID_ENV, bucket }), "bucket_invalid", bucket);
  }
});

// ---------------------------------------------------------------------------
// 2–4, 18. Object key ownership
// ---------------------------------------------------------------------------

test("2. the key is server-derived from owner and asset id", () => {
  const key = buildAssetObjectKey({
    ownerId: OWNER, assetId: ASSET, source: "provider_output", role: "original", extension: "png",
  });
  assert.equal(key, `quarantine/output/${OWNER}/${ASSET}/original.png`);
});

test("2b. the same asset always resolves to the same key", () => {
  const args = { ownerId: OWNER, assetId: ASSET, source: "provider_output", role: "original", extension: "png" } as const;
  assert.equal(buildAssetObjectKey(args), buildAssetObjectKey(args));
});

test("3. two owners cannot collide, and a key is scoped to its owner", () => {
  const a = buildAssetObjectKey({ ownerId: "user_aaa", assetId: ASSET, source: "browser_upload", role: "original", extension: "png" });
  const b = buildAssetObjectKey({ ownerId: "user_bbb", assetId: ASSET, source: "browser_upload", role: "original", extension: "png" });

  assert.notEqual(a, b);
  assert.ok(keyBelongsToOwner(a, "user_aaa"));
  assert.ok(!keyBelongsToOwner(a, "user_bbb"), "one tenant's key must not validate for another");
});

test("4. a hostile filename cannot control the key", () => {
  for (const filename of [
    "../../../etc/passwd",
    "..\\..\\windows\\system32",
    "a/b/c.png",
    "file.php%00.png",
    "x".repeat(500) + ".png",
    "no-extension",
    "",
  ]) {
    const key = buildAssetObjectKey({
      ownerId: OWNER, assetId: ASSET, source: "browser_upload", role: "original",
      extension: safeExtension(filename),
    });

    assert.ok(!key.includes(".."), filename);
    assert.ok(key.startsWith(`quarantine/input/${OWNER}/${ASSET}/`), filename);
    assert.ok(/\/original\.[a-z0-9]{1,8}$/.test(key), `${filename} -> ${key}`);
  }
});

test("18. no production key carries the mock-output prefix", () => {
  // The Phase 8-A live fal image was stored as mock-output-01-….png. Anyone
  // auditing by filename would have read it exactly backwards.
  for (const source of ["provider_output", "browser_upload", "internal"] as const) {
    const key = buildAssetObjectKey({ ownerId: OWNER, assetId: ASSET, source, role: "original", extension: "png" });
    assert.ok(!key.includes("mock"), key);
  }

  const keySource = readFileSync(path.join(ROOT, "src/lib/media/asset-keys.ts"), "utf8");
  const code = keySource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/mock-output/.test(code), "the new path must not reintroduce it");
});

test("18b. the key is provider-neutral", () => {
  const key = buildAssetObjectKey({ ownerId: OWNER, assetId: ASSET, source: "provider_output", role: "original", extension: "png" });
  for (const provider of ["fal", "gemini", "cloudflare", "runware"]) {
    assert.ok(!key.includes(provider), `${provider} must not appear in a key`);
  }
});

test("21. the lane prefixes keep the roadmap's quarantine vocabulary apart", () => {
  const output = buildAssetObjectKey({ ownerId: OWNER, assetId: ASSET, source: "provider_output", role: "original", extension: "png" });
  const input = buildAssetObjectKey({ ownerId: OWNER, assetId: ASSET, source: "browser_upload", role: "original", extension: "png" });

  assert.ok(output.startsWith("quarantine/output/"), "QUARANTINE / OUTPUT (INGEST)");
  assert.ok(input.startsWith("quarantine/input/"), "QUARANTINE / INPUT");
  assert.notEqual(output, input);
});

// ---------------------------------------------------------------------------
// 15–17. The completion boundary (M2)
// ---------------------------------------------------------------------------

function fakeAdmin(handlers: {
  select?: () => { data: unknown; error: unknown };
  insert?: () => { data: unknown; error: unknown };
  rpc?: () => { data: unknown; error: unknown };
}): SupabaseClient {
  const table = {
    select: () => table,
    insert: () => table,
    eq: () => table,
    maybeSingle: async () => handlers.select?.() ?? { data: null, error: null },
    single: async () => handlers.insert?.() ?? { data: null, error: null },
  };
  return {
    from: () => table,
    rpc: async () => handlers.rpc?.() ?? { data: null, error: null },
  } as unknown as SupabaseClient;
}

test("15. an R2 write failure prevents finalization entirely", async () => {
  const { putAssetObject } = await import("@/lib/media/r2-client");
  assert.equal(typeof putAssetObject, "function");

  // storeAndFinalizeAsset awaits the put BEFORE the rpc, so a throwing put
  // means finalize is never reached. Asserted structurally because the real
  // client needs live credentials.
  const source = readFileSync(path.join(ROOT, "src/lib/media/asset-service.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function storeAndFinalizeAsset"));
  const put = body.indexOf("await putAssetObject");
  const finalize = body.indexOf('rpc("finalize_media_asset"');

  assert.ok(put > 0 && finalize > put, "store must precede finalize, unconditionally");
  assert.ok(
    !/try\s*\{[\s\S]{0,200}putAssetObject/.test(body),
    "a swallowed write failure would let a generation complete on nothing"
  );
});

/** An S3 client whose send() always succeeds, so finalize can be reached. */
async function withStoredObject<T>(run: () => Promise<T>): Promise<T> {
  const { __resetR2ClientForTesting } = await import("@/lib/media/r2-client");
  __resetR2ClientForTesting({ send: async () => ({}) } as never);
  try {
    return await run();
  } finally {
    __resetR2ClientForTesting();
  }
}

test("16. the object is written but a finalize failure still raises ASSET_RECORD_FAILED", async () => {
  // The important part: the bytes ARE in R2 and the generation still must not
  // complete. Storage succeeding is not the same as the asset being recorded.
  const admin = fakeAdmin({ rpc: () => ({ data: null, error: { message: "boom" } }) });

  await withStoredObject(() =>
    assert.rejects(
      () => storeAndFinalizeAsset(admin, { assetId: ASSET, objectKey: "k", bucket: "b" }, { bytes: new Uint8Array(1) }),
      (error: Error) => (error as { code?: string }).code === "ASSET_RECORD_FAILED"
    )
  );
});

test("16b. a non-finalized status after finalize is refused", async () => {
  const admin = fakeAdmin({ rpc: () => ({ data: { finalized: false, status: "failed" }, error: null }) });

  await withStoredObject(() =>
    assert.rejects(
      () => storeAndFinalizeAsset(admin, { assetId: ASSET, objectKey: "k", bucket: "b" }, { bytes: new Uint8Array(1) }),
      (error: Error) => (error as { code?: string }).code === "ASSET_RECORD_FAILED"
    )
  );
});

test("16c. a concurrent worker that finalized first is SUCCESS, not a failure", async () => {
  // finalized:false with status 'finalized' means somebody else got there.
  // Treating that as an error would fail a generation whose asset is fine.
  const admin = fakeAdmin({ rpc: () => ({ data: { finalized: false, status: "finalized" }, error: null }) });

  const result = await withStoredObject(() =>
    storeAndFinalizeAsset(admin, { assetId: ASSET, objectKey: "k", bucket: "b" }, { bytes: new Uint8Array(3) })
  );
  assert.equal(result.assetId, ASSET);
  assert.equal(result.byteLength, 3);
});

test("15b. an R2 write failure never reaches finalize", async () => {
  let rpcCalls = 0;
  const admin = fakeAdmin({ rpc: () => { rpcCalls += 1; return { data: null, error: null }; } });
  const { __resetR2ClientForTesting } = await import("@/lib/media/r2-client");

  __resetR2ClientForTesting({
    send: async () => { throw new Error("r2 unavailable"); },
  } as never);

  try {
    await assert.rejects(
      () => storeAndFinalizeAsset(admin, { assetId: ASSET, objectKey: "k", bucket: "b" }, { bytes: new Uint8Array(1) }),
      (error: Error) => (error as { code?: string }).code === "ASSET_STORAGE_FAILED"
    );
    assert.equal(rpcCalls, 0, "a lost write must not be recorded as an asset");
  } finally {
    __resetR2ClientForTesting();
  }
});

test("17. the completion gate asks the database, and only 'finalized' passes", async () => {
  for (const [status, expected] of [
    ["finalized", true],
    ["stored", false],
    ["pending", false],
    ["failed", false],
  ] as const) {
    const admin = fakeAdmin({ select: () => ({ data: { status }, error: null }) });
    assert.equal(await hasFinalizedOriginal(admin, GEN), expected, status);
  }

  const admin = fakeAdmin({ select: () => ({ data: null, error: null }) });
  assert.equal(await hasFinalizedOriginal(admin, GEN), false, "no asset at all is not finalized");
});

test("17b. the orchestrator gates markCompleted on the asset, in that order", () => {
  const source = readFileSync(path.join(ROOT, "src/lib/orchestration/orchestrator.ts"), "utf8");

  const persist = source.indexOf("await persistCanonicalOriginal(");
  // Phase 9-B widened this gate from hasFinalizedOriginal to
  // hasVerifiedOriginal: storage alone is no longer sufficient, the bytes must
  // also have been read and allowed. The ORDER is what this test protects, and
  // it is unchanged.
  const gate = source.indexOf("await hasVerifiedOriginal(");
  const complete = source.indexOf("await markCompleted(");

  assert.ok(gate > 0, "the completion gate must still exist");
  assert.ok(persist > 0 && gate > persist && complete > gate,
    "persist -> gate -> complete; any other order reintroduces M2");
});

// ---------------------------------------------------------------------------
// 14. Replay convergence
// ---------------------------------------------------------------------------

test("14. a replay reuses the existing reservation instead of creating a rival", async () => {
  let inserts = 0;
  const admin = fakeAdmin({
    select: () => ({ data: { id: ASSET, object_key: "existing/key.png", bucket: "cinefield-media", status: "pending" }, error: null }),
    insert: () => { inserts += 1; return { data: null, error: null }; },
  });

  const reserved = await reserveGenerationAsset(admin, {
    generationId: GEN, clerkUserId: OWNER, mediaType: "image", fileExtension: "png",
  });

  assert.equal(reserved.assetId, ASSET);
  assert.equal(reserved.objectKey, "existing/key.png");
  assert.equal(inserts, 0, "no second canonical original");
});

test("14b. one canonical original per generation is enforced by the database", () => {
  const migration = readFileSync(path.join(ROOT, "supabase/migrations/20260820000000_media_assets.sql"), "utf8");
  assert.ok(
    /CREATE UNIQUE INDEX[^;]*media_assets_generation_original_uniq[^;]*WHERE[^;]*'original'/.test(
      migration.replace(/\n/g, " ")
    ),
    "the partial unique index is what makes retry converge"
  );
  assert.ok(/media_assets_bucket_key_uniq/.test(migration), "and one row per stored object");
});

// ---------------------------------------------------------------------------
// 10–11. Provider result must use the gateway
// ---------------------------------------------------------------------------

test("10. the provider result reaches R2 through the outbound gateway", () => {
  const normalizer = readFileSync(path.join(ROOT, "src/lib/orchestration/output-normalizer.ts"), "utf8");
  assert.ok(/fetchUntrustedMedia\(/.test(normalizer));

  const orchestrator = readFileSync(path.join(ROOT, "src/lib/orchestration/orchestrator.ts"), "utf8");
  const code = orchestrator.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/(^|[^.\w])fetch\(/.test(code), "no direct fetch in the generation path");
});

test("11. the media layer performs no direct network fetch of its own", () => {
  for (const file of ["src/lib/media/asset-service.ts", "src/lib/media/r2-client.ts", "src/lib/media/asset-keys.ts"]) {
    const code = readFileSync(path.join(ROOT, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/(^|[^.\w])fetch\(/.test(code), file);
  }
});

// ---------------------------------------------------------------------------
// 12. Opaque bytes — no parser crossed into this batch
// ---------------------------------------------------------------------------

test("12. no native decoder, sniffer or transcoder entered Phase 9-A", () => {
  const files = [
    "src/lib/media/asset-service.ts",
    "src/lib/media/r2-client.ts",
    "src/lib/media/asset-keys.ts",
    "src/lib/media/outbound-fetch-gateway.ts",
    "src/app/api/media/upload-url/route.ts",
  ];
  for (const file of files) {
    const imports = readFileSync(path.join(ROOT, file), "utf8").match(/^import .*$/gm)?.join("\n") ?? "";
    assert.ok(!/sharp|ffprobe|ffmpeg|file-type|image-size|probe-image/i.test(imports), file);
  }

  const deps = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).dependencies as Record<string, string>;
  for (const forbidden of ["sharp", "fluent-ffmpeg", "file-type", "image-size"]) {
    assert.ok(!(forbidden in deps), `${forbidden} would move the 9-B sandbox boundary into this batch`);
  }
});

test("12b. content type stays a declaration, never a verified mime", () => {
  const migration = readFileSync(path.join(ROOT, "supabase/migrations/20260820000000_media_assets.sql"), "utf8");

  assert.ok(/"declared_content_type"/.test(migration));
  assert.ok(/"verified_mime" "text"/.test(migration), "the hook exists");
  assert.ok(
    !/"verified_mime"[^,]*DEFAULT/.test(migration),
    "it must default to NULL — a default value would be a claim nothing verified"
  );
});

// ---------------------------------------------------------------------------
// 5–9. Presigned upload contract
// ---------------------------------------------------------------------------

const uploadRoute = readFileSync(path.join(ROOT, "src/app/api/media/upload-url/route.ts"), "utf8");

test("5. the presigned upload expiry is bounded and short", async () => {
  const { UPLOAD_URL_TTL_SECONDS, DOWNLOAD_URL_TTL_SECONDS } = await import("@/lib/media/r2-client");
  assert.ok(UPLOAD_URL_TTL_SECONDS <= 900, "a bearer credential's blast radius is its lifetime");
  assert.ok(DOWNLOAD_URL_TTL_SECONDS <= 900);

  const client = readFileSync(path.join(ROOT, "src/lib/media/r2-client.ts"), "utf8");
  assert.ok(/Math\.min\(/.test(client), "a caller cannot ask for a longer one");
});

test("6/7. the request body has no bucket and no key field at all", () => {
  const iface = uploadRoute.slice(
    uploadRoute.indexOf("interface UploadUrlRequest"),
    uploadRoute.indexOf("*/", uploadRoute.indexOf("interface UploadUrlRequest"))
  );
  assert.ok(!/bucket/i.test(iface), "a client cannot name a bucket");
  assert.ok(!/objectKey|object_key|\bkey\b/i.test(iface), "a client cannot name a key");
  assert.ok(!/assetId/i.test(iface), "a client cannot name an asset id");

  const code = uploadRoute.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/buildAssetObjectKey\(/.test(code), "the key is derived server-side");
  assert.ok(/ownerId: userId/.test(code), "from the verified session, not the body");
  assert.ok(!/body\.(objectKey|bucket|assetId|ownerId|clerkUserId)/.test(code));
});

test("8. no R2 credential can reach the browser", () => {
  const code = uploadRoute.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const secret of ["CLOUDFLARE_R2_SECRET_ACCESS_KEY", "CLOUDFLARE_R2_ACCESS_KEY_ID", "secretAccessKey", "accessKeyId"]) {
    assert.ok(!code.includes(secret), `${secret} must never be serialized to a client`);
  }

  for (const file of ["src/lib/media/r2-client.ts", "src/lib/media/r2-config.ts", "src/lib/media/asset-service.ts"]) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(/^import "server-only";/m.test(source), `${file} must be server-only`);
  }

  // A NEXT_PUBLIC_ variant would ship the value into the client bundle.
  const configSource = readFileSync(path.join(ROOT, "src/lib/media/r2-config.ts"), "utf8");
  assert.ok(!/NEXT_PUBLIC/.test(configSource));
});

test("9. the presigned response is private and never shared-cacheable", () => {
  assert.ok(/"Cache-Control": "private, no-store/.test(uploadRoute));
  assert.ok(!/public/.test(uploadRoute.match(/"Cache-Control": "[^"]*"/)?.[0] ?? ""));
});

test("20. a browser upload is never created as verified or released", () => {
  const code = uploadRoute.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/status: "pending"/.test(code), "pending, not stored and not finalized");
  assert.ok(!/quarantine_status/.test(code), "it cannot set its own quarantine state");
  assert.ok(!/verified_mime|checksum/.test(code), "it cannot claim verification");
  assert.ok(!/moderation_status/.test(code));
});

// ---------------------------------------------------------------------------
// 19, 23–25. Provenance, authority, secrets
// ---------------------------------------------------------------------------

test("19. provenance lives in the record, not in the filename", () => {
  const migration = readFileSync(path.join(ROOT, "supabase/migrations/20260820000000_media_assets.sql"), "utf8");
  for (const column of ["generation_id", "generation_attempt_id", "source", "storage_backend", "bucket", "object_key"]) {
    assert.ok(new RegExp(`"${column}"`).test(migration), column);
  }
});

test("24. only the server may write an asset row; the owner may only read", () => {
  const migration = readFileSync(path.join(ROOT, "supabase/migrations/20260820000000_media_assets.sql"), "utf8");

  assert.ok(/ENABLE ROW LEVEL SECURITY/.test(migration));
  assert.ok(/GRANT SELECT ON TABLE "public"."media_assets" TO "authenticated"/.test(migration));
  assert.ok(/GRANT ALL ON TABLE "public"."media_assets" TO "service_role"/.test(migration));
  assert.ok(!/FOR (INSERT|UPDATE|ALL) TO "authenticated"/.test(migration), "no client write policy");
  assert.ok(/finalize_media_asset[\s\S]*?TO "service_role"/.test(migration), "finalization is server authority");
});

test("25. no secret is serialized anywhere in the media layer", () => {
  for (const file of [
    "src/lib/media/r2-client.ts",
    "src/lib/media/r2-config.ts",
    "src/lib/media/asset-service.ts",
    "src/app/api/media/upload-url/route.ts",
  ]) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(!/console\.(log|info|warn|error)\([^)]*(secret|accessKey|credential)/i.test(source), file);
  }
});

test("22. the Supabase legacy path is documented as compatibility, not a rival truth", () => {
  const contract = readFileSync(path.join(ROOT, "docs/architecture/CINEFIELD_ARCHITECTURE_CONTRACT.md"), "utf8");
  assert.ok(/R2 is the hot\/live production media store/i.test(contract) || /R2 = hot/i.test(contract));
  assert.ok(/Phase 9-A/.test(contract), "the doc must name the phase that owns R2");
  assert.ok(!/R2 is a future migration phase \(see Phase 12/.test(contract), "the stale Phase 12 claim must be gone");
});

// ===========================================================================
// SECURITY_FINDINGS_9751bd11 — finding 2: upload size is signed, not advised
// ===========================================================================
//
// These are behavioural: they sign real requests with the installed SDK and
// inspect the result. A source-presence check ("does the code pass
// ContentLength?") would pass even if the presigner silently dropped it.

async function signProbe(contentLength?: number): Promise<URL> {
  process.env.CLOUDFLARE_R2_ACCOUNT_ID ??= "probe";
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ??= "AKIAPROBE";
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??= "probe-secret";
  process.env.CLOUDFLARE_R2_BUCKET ??= "probe-bucket";
  process.env.CLOUDFLARE_R2_ENDPOINT ??= "https://probe.r2.cloudflarestorage.com";

  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
    credentials: { accessKeyId: "AKIAPROBE", secretAccessKey: "probe-secret" },
  });
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: "b",
      Key: "k",
      ContentType: "image/png",
      ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
    }),
    { expiresIn: 300 }
  );
  return new URL(url);
}

test("S2-1  the presigner really binds Content-Length — verified, not assumed", async () => {
  const without = await signProbe();
  const withLen = await signProbe(1234);

  const signedWithout = without.searchParams.get("X-Amz-SignedHeaders") ?? "";
  const signedWith = withLen.searchParams.get("X-Amz-SignedHeaders") ?? "";

  // Without it, only host is signed — which is exactly the pre-fix state.
  assert.ok(!/(^|;)content-length(;|$)/.test(signedWithout), "baseline: no length in the signed set");
  // With it, the SDK adds it to the signed set on its own.
  assert.ok(/(^|;)content-length(;|$)/.test(signedWith), "ContentLength must enter X-Amz-SignedHeaders");
});

test("S2-2  a different size produces a different signature — binding, not decoration", async () => {
  const a = await signProbe(1234);
  const b = await signProbe(9999);
  assert.notEqual(
    a.searchParams.get("X-Amz-Signature"),
    b.searchParams.get("X-Amz-Signature"),
    "if these matched, the length would be cosmetic and a client could upload any size"
  );
});

test("S2-3  createPresignedUpload refuses missing, non-integer, zero, negative and over-limit sizes", async () => {
  const { createPresignedUpload, MAX_UPLOAD_BYTES } = await import("@/lib/media/r2-client");

  const bad: unknown[] = [undefined, null, "1024", 0, -1, 1.5, NaN, MAX_UPLOAD_BYTES + 1, Infinity];
  for (const value of bad) {
    await assert.rejects(
      () =>
        createPresignedUpload({
          objectKey: "k",
          declaredContentType: "image/png",
          contentLength: value as number,
        }),
      `contentLength ${String(value)} must be refused`
    );
  }

  // The ceiling itself is accepted — the boundary is inclusive.
  const ok = await createPresignedUpload({
    objectKey: "k",
    declaredContentType: "image/png",
    contentLength: MAX_UPLOAD_BYTES,
  });
  assert.equal(ok.contentLength, MAX_UPLOAD_BYTES);
  assert.ok(
    /(^|;)content-length(;|$)/.test(new URL(ok.uploadUrl).searchParams.get("X-Amz-SignedHeaders") ?? ""),
    "the URL this function returns must carry a signed length"
  );
});

test("S2-4  the route requires byteSize — an omitted size can never be treated as small", () => {
  const route = readFileSync(path.join(ROOT, "src/app/api/media/upload-url/route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // The defective form was `typeof body.byteSize === "number" && ... >` —
  // a conjunction that skipped entirely when the field was absent.
  assert.ok(
    !/typeof body\.byteSize === "number" &&/.test(route),
    "the optional-and-only-if-numeric form must not come back"
  );
  assert.match(route, /typeof body\.byteSize !== "number"/);
  assert.match(route, /!Number\.isInteger\(body\.byteSize\)/);
  assert.match(route, /body\.byteSize <= 0/);
  assert.match(route, /body\.byteSize > MAX_UPLOAD_BYTES/);

  // And the size actually reaches the signer.
  assert.match(route, /contentLength: body\.byteSize/);
});

test("S2-5  no presign can be minted without a length — the parameter is required by type", () => {
  const client = readFileSync(path.join(ROOT, "src/lib/media/r2-client.ts"), "utf8");
  const fn = client.slice(client.indexOf("export async function createPresignedUpload"));
  const signature = fn.slice(0, fn.indexOf("): Promise<"));

  // Required, not `contentLength?:` — a caller cannot omit it.
  assert.match(signature, /contentLength: number;/);
  assert.ok(!/contentLength\?:/.test(signature), "the length must not be optional");
  assert.match(fn.slice(0, 2000), /ContentLength: params\.contentLength/);
});
