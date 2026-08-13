import "server-only";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import type { LookupAddress } from "node:dns";
import { refusalForAddress } from "./ip-guard";

/**
 * Outbound Fetch Security Gateway (Phase 9-E, minimum prerequisite).
 *
 * THE ONE place the server is allowed to download a provider result. Until
 * this existed, `output-normalizer.ts` called `fetch(providerUrl)` behind a
 * single `https:` check — which the roadmap names explicitly as insufficient:
 * "Yalnız https şeması kontrolü YETERSİZDİR". A provider that is compromised,
 * misconfigured, or simply returns an attacker-influenced URL could have
 * pointed this process at 169.254.169.254 and read cloud instance metadata,
 * from a process holding every provider key in the deployment.
 *
 * A PROVIDER RESULT URL IS UNTRUSTED INPUT. Not "mostly trusted because we
 * called the provider" — untrusted, in the same sense a form field is.
 *
 * WHY node:https AND NOT fetch()
 * This is the part that actually closes DNS rebinding rather than gesturing
 * at it. `fetch()` gives no control over resolution: you can look a hostname
 * up, approve it, and then the client resolves again on its own and connects
 * somewhere else entirely. `https.request` accepts a `lookup` function, and
 * the socket connects to the address THAT function returns. So validation and
 * connection are the same act, not two acts with a window between them.
 *
 * WHAT THIS DOES NOT DO — read this before assuming coverage.
 * It protects the network destination and the download bounds. It does NOT
 * inspect the bytes. Malicious media still reaches whatever eventually
 * decodes it, and the untrusted-media sandbox that contains THAT is Phase 9-B
 * (roadmap red note: "Outbound Fetch Gateway SSRF'yi sınırlar; ancak kötü
 * niyetli medya FFmpeg/decoder/parser yüzeyine ulaşır"). Nothing here parses,
 * sniffs, or decodes: no sharp, no ffprobe, no FFmpeg. Content-Type is
 * carried through as a provider CLAIM and named as one.
 */

/** Why a download was refused. Non-secret; safe to log and to return. */
export type OutboundFetchFailure =
  | "url_invalid"
  | "scheme_blocked"
  | "url_credentials"
  | "dns_failed"
  | "ip_blocked"
  | "redirect_blocked"
  | "too_many_redirects"
  | "http_error"
  | "response_too_large"
  | "timeout"
  | "network_error";

export class OutboundFetchError extends Error {
  readonly failure: OutboundFetchFailure;
  /** Extra non-secret context: a refusal class, a status code, a count. */
  readonly detail?: string;

  constructor(failure: OutboundFetchFailure, detail?: string) {
    // The message carries the CLASS only. Never the URL, never its query,
    // never a host — a signed provider URL is a credential and the most
    // likely place for it to leak is an error string that gets logged.
    super(`outbound_fetch_${failure}`);
    this.name = "OutboundFetchError";
    this.failure = failure;
    this.detail = detail;
  }
}

export interface OutboundFetchResult {
  bytes: Uint8Array;
  /**
   * The provider's Content-Type header, VERBATIM AND UNVERIFIED.
   *
   * Named `declaredContentType` rather than `mimeType` on purpose: nothing has
   * checked it against the bytes. Real verification is Phase 9-B, and it will
   * add a separate `verifiedMime` rather than blessing this field in place.
   */
  declaredContentType: string | null;
  byteLength: number;
  /** How many redirects were followed. Diagnostic; safe to log. */
  redirectCount: number;
}

export interface OutboundFetchOptions {
  /** Hard ceiling on bytes. Default sized for the image path (see below). */
  maxBytes?: number;
  /** Whole-request budget: connect, headers, and body. */
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  /** Test seam. Never used in production; see the tests for why it exists. */
  resolver?: (hostname: string) => Promise<string[]>;
  /** Test seam for the transport, so tests need no real network. */
  transport?: OutboundTransport;
}

/**
 * 64 MiB. Chosen against the path that actually exists today: the current
 * image models top out at a few megabytes, and the live fal validation stored
 * 308 KB. It is deliberately not "large enough that nothing ever fails" —
 * an unbounded ceiling is the same as no ceiling, and this process buffers
 * the body. Video work in 9-C will need its own, larger, streamed budget and
 * should raise this explicitly rather than inherit it by accident.
 */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_REDIRECTS = 3;

/** Minimal transport surface, so tests can drive redirects and lies about size. */
export interface OutboundTransportResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  /** Body chunks, in order. */
  body: AsyncIterable<Uint8Array>;
}

export type OutboundTransport = (
  url: URL,
  addresses: string[],
  options: { timeoutMs: number; signal?: AbortSignal }
) => Promise<OutboundTransportResponse>;

async function defaultResolver(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve((addresses as LookupAddress[]).map((a) => a.address));
    });
  });
}

/**
 * The real transport. The `lookup` override is the whole point: it hands the
 * socket the exact address already approved, so no second resolution can
 * happen between the check and the connection.
 */
const defaultTransport: OutboundTransport = (url, addresses, options) =>
  new Promise<OutboundTransportResponse>((resolve, reject) => {
    const pinned = addresses[0];
    const family = pinned.includes(":") ? 6 : 4;

    const requestOptions: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      // SNI and Host still use the hostname, so certificate validation and
      // virtual hosting behave normally — only the destination is pinned.
      lookup: (_hostname, _opts, callback) => {
        (callback as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
          null,
          pinned,
          family
        );
      },
      headers: { accept: "*/*" },
      signal: options.signal,
    };

    const req = httpsRequest(requestOptions, (res) => {
      resolve({
        statusCode: res.statusCode ?? 0,
        headers: res.headers,
        body: res as unknown as AsyncIterable<Uint8Array>,
      });
    });

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new OutboundFetchError("timeout"));
    });
    req.on("error", (error) => reject(error));
    req.end();
  });

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundFetchError("url_invalid");
  }

  // No silent http→https upgrade: a provider that returned a plaintext URL is
  // a fact worth failing on, not one to paper over.
  if (url.protocol !== "https:") {
    throw new OutboundFetchError("scheme_blocked", url.protocol.replace(":", ""));
  }

  // userinfo in a result URL is a credential in a place nothing should be
  // reading credentials from, and it is a known way to confuse URL parsers
  // about which host is really being addressed.
  if (url.username.length > 0 || url.password.length > 0) {
    throw new OutboundFetchError("url_credentials");
  }

  return url;
}

async function resolveAndScreen(
  url: URL,
  resolver: (hostname: string) => Promise<string[]>
): Promise<string[]> {
  let addresses: string[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    throw new OutboundFetchError("dns_failed");
  }

  if (addresses.length === 0) throw new OutboundFetchError("dns_failed");

  // EVERY answer must pass. A resolver returning one public and one private
  // address is the round-robin rebinding trick; approving the set because a
  // single member looked fine would defeat the whole check.
  for (const address of addresses) {
    const refusal = refusalForAddress(address);
    if (refusal) throw new OutboundFetchError("ip_blocked", refusal);
  }

  return addresses;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | null {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

/**
 * Downloads an untrusted provider result under strict policy.
 *
 * Throws `OutboundFetchError` for every refusal. Callers get a class, never a
 * URL — see the error's own comment.
 */
export async function fetchUntrustedMedia(
  sourceUrl: string,
  options: OutboundFetchOptions = {}
): Promise<OutboundFetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolver = options.resolver ?? defaultResolver;
  const transport = options.transport ?? defaultTransport;

  let url = validateUrl(sourceUrl);
  let redirectCount = 0;

  for (;;) {
    const addresses = await resolveAndScreen(url, resolver);

    let response: OutboundTransportResponse;
    try {
      response = await transport(url, addresses, { timeoutMs, signal: options.signal });
    } catch (caught) {
      if (caught instanceof OutboundFetchError) throw caught;
      const name = caught instanceof Error ? caught.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        throw new OutboundFetchError("timeout");
      }
      throw new OutboundFetchError("network_error");
    }

    const status = response.statusCode;

    // ---- Redirects: re-validated from scratch, every hop ------------------
    // A public URL redirecting to 127.0.0.1 or the metadata address is the
    // textbook bypass. The loop re-enters at the top, so the next hop gets
    // the same scheme check, the same resolution, and the same IP screen.
    if (status >= 300 && status < 400) {
      const location = headerValue(response.headers, "location");
      if (!location) throw new OutboundFetchError("redirect_blocked", "missing_location");

      if (redirectCount >= maxRedirects) {
        throw new OutboundFetchError("too_many_redirects", String(redirectCount));
      }

      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new OutboundFetchError("redirect_blocked", "unparseable_location");
      }

      if (next.protocol !== "https:") {
        throw new OutboundFetchError("redirect_blocked", next.protocol.replace(":", ""));
      }
      if (next.username.length > 0 || next.password.length > 0) {
        throw new OutboundFetchError("redirect_blocked", "credentials");
      }

      redirectCount += 1;
      url = next;
      continue;
    }

    if (status < 200 || status >= 300) {
      // The status code only. A provider error body can contain anything,
      // including the signed URL that was requested.
      throw new OutboundFetchError("http_error", String(status));
    }

    // ---- Size: declared, then actual --------------------------------------
    // Content-Length is a hint from an untrusted party. Checking it saves a
    // pointless download when it is honest; the streaming counter below is
    // what makes a lie harmless.
    const declaredLength = headerValue(response.headers, "content-length");
    if (declaredLength !== null) {
      const declared = Number(declaredLength);
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new OutboundFetchError("response_too_large", "declared");
      }
    }

    const chunks: Uint8Array[] = [];
    let received = 0;

    for await (const chunk of response.body) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        throw new OutboundFetchError("response_too_large", "stream");
      }
      chunks.push(chunk);
    }

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      bytes,
      declaredContentType: headerValue(response.headers, "content-type"),
      byteLength: received,
      redirectCount,
    };
  }
}
