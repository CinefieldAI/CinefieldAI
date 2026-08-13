import "server-only";

/**
 * IP address policy for outbound fetches of untrusted media (Phase 9-E).
 *
 * Pure classification: no DNS, no sockets, no I/O. It answers one question —
 * "may the server open a connection to this address?" — so it can be tested
 * exhaustively without a network, and so the gateway has exactly one place
 * where the answer lives.
 *
 * WHY ADDRESSES AND NOT HOSTNAMES
 * A hostname check is worthless here. `localhost`, `127.0.0.1.nip.io`, and an
 * attacker-controlled domain with an A record of `169.254.169.254` are all
 * public-looking strings that resolve somewhere private. The roadmap says so
 * outright: "Yalnız https şeması kontrolü YETERSİZDİR" — the check must
 * happen after resolution, on every address the resolver returns.
 *
 * The list below is deny-by-default in spirit: anything that is not an
 * ordinary routable unicast address is refused. When a range is ambiguous the
 * refusal wins, because a false rejection costs one failed download and a
 * false acceptance costs an internal service.
 */

/** Why an address was refused. Non-secret, safe to log and to attach to an error. */
export type IpRefusal =
  | "loopback"
  | "private"
  | "link_local"
  | "cloud_metadata"
  | "unspecified"
  | "multicast"
  | "reserved"
  | "unparseable";

function parseIPv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function classifyIPv4(octets: number[]): IpRefusal | null {
  const [a, b] = octets;

  // The single most valuable block on this list. 169.254.169.254 is the
  // instance metadata endpoint on AWS, GCP and Azure alike; reaching it from
  // a server that holds provider keys is the classic SSRF payoff.
  if (a === 169 && b === 254) {
    return octets[2] === 169 && octets[3] === 254 ? "cloud_metadata" : "link_local";
  }

  if (a === 127) return "loopback";
  if (a === 0) return "unspecified";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  // Carrier-grade NAT. Not private in the RFC1918 sense, but not a legitimate
  // destination for a provider result either, and it fronts internal networks
  // often enough to be worth refusing.
  if (a === 100 && b >= 64 && b <= 127) return "private";
  // 192.0.0.0/24 IETF protocol assignments, 192.0.2.0/24 TEST-NET-1.
  if (a === 192 && b === 0) return "reserved";
  // 198.18.0.0/15 benchmarking, 198.51.100.0/24 TEST-NET-2.
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return "reserved";
  // 203.0.113.0/24 TEST-NET-3.
  if (a === 203 && b === 0 && octets[2] === 113) return "reserved";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";

  return null;
}

function expandIPv6(value: string): number[] | null {
  let text = value.trim().toLowerCase();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  // A zone id (fe80::1%eth0) is not part of the address.
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (text.length === 0) return null;

  const doubleColon = text.indexOf("::");
  if (text.indexOf("::", doubleColon + 1) >= 0) return null;

  const headText = doubleColon >= 0 ? text.slice(0, doubleColon) : text;
  const tailText = doubleColon >= 0 ? text.slice(doubleColon + 2) : "";

  const parseGroups = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const groups: number[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        // Trailing dotted-quad, e.g. ::ffff:127.0.0.1.
        const v4 = parseIPv4(piece);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };

  const head = parseGroups(headText);
  const tail = parseGroups(tailText);
  if (!head || !tail) return null;

  if (doubleColon < 0) return head.length === 8 ? head : null;

  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

function classifyIPv6(groups: number[]): IpRefusal | null {
  const isZeroPrefix = groups.slice(0, 5).every((g) => g === 0);

  // ::1
  if (isZeroPrefix && groups[5] === 0 && groups[6] === 0 && groups[7] === 1) return "loopback";
  // ::
  if (groups.every((g) => g === 0)) return "unspecified";

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible. The embedded address is
  // what the socket actually reaches, so it has to be judged as IPv4 — this is
  // the bypass that a naive "is it IPv6?" check misses entirely.
  if (isZeroPrefix && (groups[5] === 0xffff || groups[5] === 0)) {
    const embedded = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
    if (embedded.some((o) => o !== 0)) return classifyIPv4(embedded);
  }

  const first = groups[0];
  // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfe80) return "link_local";
  // fc00::/7 unique local
  if ((first & 0xfe00) === 0xfc00) return "private";
  // ff00::/8 multicast
  if ((first & 0xff00) === 0xff00) return "multicast";
  // 2001:db8::/32 documentation
  if (first === 0x2001 && groups[1] === 0x0db8) return "reserved";

  return null;
}

/**
 * Classifies a resolved address. `null` means the address is an ordinary
 * routable destination and the connection may proceed.
 */
export function refusalForAddress(address: string): IpRefusal | null {
  const v4 = parseIPv4(address);
  if (v4) return classifyIPv4(v4);

  const v6 = expandIPv6(address);
  if (v6) return classifyIPv6(v6);

  // Unparseable is refused rather than allowed. An address this module cannot
  // read is one it cannot vouch for.
  return "unparseable";
}

/** Convenience for call sites that only need the verdict. */
export function isAddressAllowed(address: string): boolean {
  return refusalForAddress(address) === null;
}
