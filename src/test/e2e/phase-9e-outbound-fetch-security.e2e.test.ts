import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  fetchUntrustedMedia,
  OutboundFetchError,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  type OutboundTransport,
  type OutboundTransportResponse,
} from "@/lib/media/outbound-fetch-gateway";
import { refusalForAddress } from "@/lib/media/ip-guard";

/**
 * SSRF matrix for the Outbound Fetch Security Gateway (Phase 9-E minimum).
 *
 * NOTHING here touches the real network. The resolver and the transport are
 * both injected, so every hostile case — metadata addresses, rebinding,
 * redirect chains into RFC1918 — is exercised against doubles rather than by
 * probing real internal infrastructure, which would be both unreliable and
 * genuinely irresponsible.
 */

const ROOT = process.cwd();
const URL_OK = "https://cdn.example.com/result.png";

function resolverFor(...addresses: string[]) {
  return async () => addresses;
}

function transportReturning(
  overrides: Partial<OutboundTransportResponse> & { chunks?: Uint8Array[] } = {}
): OutboundTransport {
  return async () => ({
    statusCode: overrides.statusCode ?? 200,
    headers: overrides.headers ?? { "content-type": "image/png" },
    body: (async function* () {
      for (const chunk of overrides.chunks ?? [new Uint8Array([1, 2, 3, 4])]) yield chunk;
    })(),
  });
}

async function expectFailure(
  promise: Promise<unknown>,
  failure: string,
  detail?: string
): Promise<OutboundFetchError> {
  try {
    await promise;
    assert.fail(`expected ${failure}, but the download succeeded`);
  } catch (error) {
    assert.ok(error instanceof OutboundFetchError, `expected OutboundFetchError, got ${error}`);
    assert.equal(error.failure, failure);
    if (detail !== undefined) assert.equal(error.detail, detail);
    return error;
  }
}

// ---------------------------------------------------------------------------
// 1–3. Scheme policy
// ---------------------------------------------------------------------------

test("1. a valid public HTTPS host is accepted", async () => {
  const result = await fetchUntrustedMedia(URL_OK, {
    resolver: resolverFor("93.184.216.34"),
    transport: transportReturning(),
  });

  assert.equal(result.byteLength, 4);
  assert.equal(result.declaredContentType, "image/png");
  assert.equal(result.redirectCount, 0);
});

test("2. http:// is rejected and NOT silently upgraded", async () => {
  const error = await expectFailure(
    fetchUntrustedMedia("http://cdn.example.com/a.png", { resolver: resolverFor("93.184.216.34") }),
    "scheme_blocked"
  );
  assert.equal(error.detail, "http");
});

test("3. file:, data:, ftp:, javascript:, ws: are rejected", async () => {
  for (const url of [
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
    "ftp://example.com/a.png",
    "javascript:alert(1)",
    "ws://example.com/socket",
    "wss://example.com/socket",
    "blob:https://example.com/x",
  ]) {
    await expectFailure(fetchUntrustedMedia(url), "scheme_blocked");
  }
});

// ---------------------------------------------------------------------------
// 4–13. Address policy
// ---------------------------------------------------------------------------

test("4. 127.0.0.1 is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: resolverFor("127.0.0.1") }),
    "ip_blocked",
    "loopback"
  );
});

test("5. a public hostname resolving to loopback is blocked", async () => {
  // The hostname is irrelevant — this is why a string check is worthless.
  await expectFailure(
    fetchUntrustedMedia("https://totally-public.example.com/x.png", {
      resolver: resolverFor("127.0.0.53"),
    }),
    "ip_blocked",
    "loopback"
  );
});

test("6. 10.0.0.0/8 is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: resolverFor("10.1.2.3") }),
    "ip_blocked",
    "private"
  );
});

test("7. 172.16.0.0/12 is blocked, and its neighbours are not", () => {
  assert.equal(refusalForAddress("172.16.0.1"), "private");
  assert.equal(refusalForAddress("172.31.255.254"), "private");
  assert.equal(refusalForAddress("172.15.0.1"), null, "172.15 is public");
  assert.equal(refusalForAddress("172.32.0.1"), null, "172.32 is public");
});

test("8. 192.168.0.0/16 is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: resolverFor("192.168.1.10") }),
    "ip_blocked",
    "private"
  );
});

test("9. 169.254.169.254 — the cloud metadata endpoint — is blocked", async () => {
  const error = await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: resolverFor("169.254.169.254") }),
    "ip_blocked"
  );
  assert.equal(error.detail, "cloud_metadata", "named specifically, because it is the payoff");
  // The rest of link-local is refused too, just under its own class.
  assert.equal(refusalForAddress("169.254.1.1"), "link_local");
});

test("10. IPv6 ::1 is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: resolverFor("::1") }),
    "ip_blocked",
    "loopback"
  );
});

test("11. IPv6 fe80::/10 link-local is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: resolverFor("fe80::1") }),
    "ip_blocked",
    "link_local"
  );
  assert.equal(refusalForAddress("febf:ffff::1"), "link_local", "top of the /10");
});

test("12. IPv6 fc00::/7 unique-local is blocked", async () => {
  for (const address of ["fc00::1", "fd12:3456:789a::1", "fdff::ffff"]) {
    assert.equal(refusalForAddress(address), "private", address);
  }
});

test("13. IPv4-mapped IPv6 pointing at a private address is rejected", async () => {
  // ::ffff:127.0.0.1 is the bypass a naive "is this IPv6?" check misses:
  // the socket reaches 127.0.0.1 regardless of how the address is spelled.
  await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: resolverFor("::ffff:127.0.0.1") }),
    "ip_blocked",
    "loopback"
  );
  assert.equal(refusalForAddress("::ffff:169.254.169.254"), "cloud_metadata");
  assert.equal(refusalForAddress("::ffff:10.0.0.1"), "private");
  assert.equal(refusalForAddress("::ffff:93.184.216.34"), null, "a mapped PUBLIC address is fine");
});

test("14. a mixed answer containing one private address rejects the whole set", async () => {
  // Round-robin rebinding: approving the set because one member looked public
  // would let the connection land on the other one.
  await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: resolverFor("93.184.216.34", "10.0.0.5") }),
    "ip_blocked",
    "private"
  );
});

test("multicast, unspecified and reserved ranges are refused", () => {
  assert.equal(refusalForAddress("224.0.0.1"), "multicast");
  assert.equal(refusalForAddress("ff02::1"), "multicast");
  assert.equal(refusalForAddress("0.0.0.0"), "unspecified");
  assert.equal(refusalForAddress("::"), "unspecified");
  assert.equal(refusalForAddress("240.0.0.1"), "reserved");
  assert.equal(refusalForAddress("100.64.0.1"), "private", "carrier-grade NAT");
});

test("an unparseable address is refused rather than allowed", () => {
  for (const value of ["not-an-ip", "999.1.1.1", "1.2.3", "::gg", ""]) {
    assert.ok(refusalForAddress(value) !== null, value);
  }
});

// ---------------------------------------------------------------------------
// 15–17. Redirects
// ---------------------------------------------------------------------------

function redirectingTransport(chain: string[]): OutboundTransport {
  let hop = 0;
  return async () => {
    if (hop < chain.length) {
      const location = chain[hop];
      hop += 1;
      return {
        statusCode: 302,
        headers: { location },
        body: (async function* () {})(),
      };
    }
    return {
      statusCode: 200,
      headers: { "content-type": "image/png" },
      body: (async function* () {
        yield new Uint8Array([1]);
      })(),
    };
  };
}

test("15. a public URL redirecting to a private IP is blocked", async () => {
  const seen: string[] = [];
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: async (hostname) => {
        seen.push(hostname);
        return hostname === "cdn.example.com" ? ["93.184.216.34"] : ["10.0.0.7"];
      },
      transport: redirectingTransport(["https://internal.example.com/secret"]),
    }),
    "ip_blocked",
    "private"
  );
  assert.deepEqual(seen, ["cdn.example.com", "internal.example.com"], "every hop is re-resolved");
});

test("16. a redirect to the metadata address is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: async (hostname) =>
        hostname === "cdn.example.com" ? ["93.184.216.34"] : ["169.254.169.254"],
      transport: redirectingTransport(["https://metadata.example.com/latest"]),
    }),
    "ip_blocked",
    "cloud_metadata"
  );
});

test("16b. a redirect DOWNGRADING to http is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: resolverFor("93.184.216.34"),
      transport: redirectingTransport(["http://cdn.example.com/plain.png"]),
    }),
    "redirect_blocked",
    "http"
  );
});

test("17. excessive redirects are rejected", async () => {
  const chain = Array.from({ length: 10 }, (_, i) => `https://hop${i}.example.com/x`);
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: resolverFor("93.184.216.34"),
      transport: redirectingTransport(chain),
    }),
    "too_many_redirects",
    String(DEFAULT_MAX_REDIRECTS)
  );
});

test("a redirect within the limit succeeds and is counted", async () => {
  const result = await fetchUntrustedMedia(URL_OK, {
    resolver: resolverFor("93.184.216.34"),
    transport: redirectingTransport(["https://cdn2.example.com/x.png"]),
  });
  assert.equal(result.redirectCount, 1);
});

test("a redirect with no Location header is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: resolverFor("93.184.216.34"),
      transport: async () => ({ statusCode: 302, headers: {}, body: (async function* () {})() }),
    }),
    "redirect_blocked",
    "missing_location"
  );
});

// ---------------------------------------------------------------------------
// 18–20. Size and time
// ---------------------------------------------------------------------------

test("18. a Content-Length that LIES small still stops at the byte limit", async () => {
  // The header claims 4 bytes; the stream keeps going. Only the counter saves
  // us, which is exactly why Content-Length alone is not a control.
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      maxBytes: 1000,
      resolver: resolverFor("93.184.216.34"),
      transport: transportReturning({
        headers: { "content-length": "4", "content-type": "image/png" },
        chunks: Array.from({ length: 10 }, () => new Uint8Array(200)),
      }),
    }),
    "response_too_large",
    "stream"
  );
});

test("19. an oversized declared Content-Length is rejected before downloading", async () => {
  let bodyRead = false;
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      maxBytes: 1000,
      resolver: resolverFor("93.184.216.34"),
      transport: async () => ({
        statusCode: 200,
        headers: { "content-length": String(DEFAULT_MAX_BYTES * 2) },
        body: (async function* () {
          bodyRead = true;
          yield new Uint8Array(10);
        })(),
      }),
    }),
    "response_too_large",
    "declared"
  );
  assert.equal(bodyRead, false, "the body must not be pulled at all");
});

test("20. a timeout aborts and reports as a timeout", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: resolverFor("93.184.216.34"),
      transport: async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    }),
    "timeout"
  );
});

// ---------------------------------------------------------------------------
// 21–25. Response, credentials, leakage, malformed input
// ---------------------------------------------------------------------------

test("21. a non-2xx response is normalized to a status code only", async () => {
  const error = await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: resolverFor("93.184.216.34"),
      transport: transportReturning({ statusCode: 403 }),
    }),
    "http_error",
    "403"
  );
  assert.ok(!/example|cdn|result\.png/.test(error.message + (error.detail ?? "")));
});

test("22. a URL carrying userinfo credentials is rejected", async () => {
  for (const url of [
    "https://user:pass@cdn.example.com/a.png",
    "https://user@cdn.example.com/a.png",
  ]) {
    await expectFailure(fetchUntrustedMedia(url), "url_credentials");
  }
});

test("22b. a redirect INTO a userinfo URL is blocked", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: resolverFor("93.184.216.34"),
      transport: redirectingTransport(["https://u:p@evil.example.com/x"]),
    }),
    "redirect_blocked",
    "credentials"
  );
});

test("23. errors never leak the URL, its host, or its signed query", async () => {
  const signed =
    "https://cdn.example.com/result.png?X-Amz-Signature=DEADBEEFSECRET&token=hunter2";

  for (const options of [
    { resolver: resolverFor("169.254.169.254") },
    { resolver: resolverFor("93.184.216.34"), transport: transportReturning({ statusCode: 500 }) },
  ]) {
    try {
      await fetchUntrustedMedia(signed, options);
      assert.fail("should have thrown");
    } catch (error) {
      const serialized = JSON.stringify({
        message: (error as Error).message,
        detail: (error as OutboundFetchError).detail,
        stack: (error as Error).stack?.split("\n")[0],
      });

      assert.ok(!serialized.includes("DEADBEEFSECRET"), "no signature");
      assert.ok(!serialized.includes("hunter2"), "no token");
      assert.ok(!serialized.includes("cdn.example.com"), "no host");
      assert.ok(!serialized.includes("result.png"), "no path");
    }
  }
});

test("24. a malformed URL is rejected", async () => {
  for (const url of ["not a url", "://missing-scheme", "https://", ""]) {
    try {
      await fetchUntrustedMedia(url);
      assert.fail(`expected rejection for ${JSON.stringify(url)}`);
    } catch (error) {
      assert.ok(error instanceof OutboundFetchError);
      assert.ok(["url_invalid", "scheme_blocked"].includes(error.failure));
    }
  }
});

test("25. a DNS failure is handled as a typed error, never a crash", async () => {
  await expectFailure(
    fetchUntrustedMedia(URL_OK, {
      resolver: async () => {
        throw new Error("ENOTFOUND");
      },
    }),
    "dns_failed"
  );

  await expectFailure(
    fetchUntrustedMedia(URL_OK, { resolver: async () => [] }),
    "dns_failed",
    undefined
  );
});

// ---------------------------------------------------------------------------
// Integration and boundary discipline
// ---------------------------------------------------------------------------

test("the fal result path now flows through the gateway, not through fetch()", () => {
  const normalizer = readFileSync(
    path.join(ROOT, "src/lib/orchestration/output-normalizer.ts"),
    "utf8"
  );
  const code = normalizer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  assert.ok(/fetchUntrustedMedia\(/.test(code), "the gateway is what downloads");
  assert.ok(!/\bfetch\(/.test(code), "no direct fetch remains in the download path");
});

test("no production provider-result code fetches directly", () => {
  // A future bypass would have to add a fetch to one of these files, and this
  // is where it gets caught.
  const guarded = [
    "src/lib/orchestration/output-normalizer.ts",
    "src/lib/orchestration/output-storage.ts",
    "src/lib/orchestration/orchestrator.ts",
    "src/lib/orchestration/providers/fal-provider.ts",
  ];

  for (const file of guarded) {
    const source = readFileSync(path.join(ROOT, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/(^|[^.\w])fetch\(/.test(source),
      `${file} must not perform a direct network fetch`
    );
  }
});

test("the gateway does NOT decode, sniff, or parse media", () => {
  // Phase 9-B owns the untrusted-parser boundary. If a native decoder ever
  // appears here, the sandbox requirement becomes due immediately and this
  // test is the thing that says so.
  const source = readFileSync(
    path.join(ROOT, "src/lib/media/outbound-fetch-gateway.ts"),
    "utf8"
  );
  const imports = source.match(/^import .*$/gm)?.join("\n") ?? "";

  assert.ok(!/sharp|ffprobe|fluent-ffmpeg|file-type|image-size/i.test(imports));
  assert.ok(
    !/verifiedMime/.test(source.replace(/\/\*[\s\S]*?\*\//g, "")),
    "content type stays a provider CLAIM in this batch"
  );
});

test("the contract names the content type as declared, not verified", async () => {
  const result = await fetchUntrustedMedia(URL_OK, {
    resolver: resolverFor("93.184.216.34"),
    transport: transportReturning({ headers: { "content-type": "text/html" } }),
  });
  // A provider claiming text/html for an image is not the gateway's problem
  // to solve — it is 9-B's. What matters is that it is not called a mime type.
  assert.equal(result.declaredContentType, "text/html");
  assert.ok(!("mimeType" in result));
  assert.ok(!("verifiedMime" in result));
});

test("the default byte ceiling is bounded and deliberate", () => {
  assert.equal(DEFAULT_MAX_BYTES, 64 * 1024 * 1024);
  assert.ok(DEFAULT_MAX_BYTES < 512 * 1024 * 1024, "not an ceiling-shaped non-ceiling");
});

test("the real transport pins the socket to the screened address", () => {
  // This is what makes rebinding closed rather than merely checked: the
  // connection uses the address the guard approved, not a fresh resolution.
  const source = readFileSync(
    path.join(ROOT, "src/lib/media/outbound-fetch-gateway.ts"),
    "utf8"
  );
  assert.ok(/lookup: \(_hostname, _opts, callback\)/.test(source));
  assert.ok(/httpsRequest\(/.test(source));
  assert.ok(!/from "node:http"/.test(source), "https only, no plaintext client");
});
