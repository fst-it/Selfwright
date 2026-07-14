import { lookup } from "node:dns/promises";

// SSRF backstop for the generic scan-http provider. The generic provider's
// URL comes from the owner's scan-targets.yml config, but since T5.11 that
// config can be written via the web UI (PUT /api/scan-targets), a compromised
// session could inject a private-IP URL and cause the next scheduled scan to
// reach internal services. This guard blocks that path.
//
// Mirrors packages/adapters/scan-browser/src/url-guard.ts (same algorithm,
// same rationale). Deliberately kept as a separate copy so scan-http has no
// dependency on scan-browser and can be built/tested independently.
//
// Only https: is allowed. Hostnames that are IP literals in a
// private/loopback/link-local/reserved range are rejected without DNS. An
// async DNS layer adds a best-effort check for *public hostnames* that resolve
// to private IPs — it resolves once, at guard time, and is not DNS-rebinding-
// proof (same residual documented in scan-browser/url-guard.ts).

function isPrivateIPv4(hostname: string): boolean {
  const octets = hostname.split(".");
  if (octets.length !== 4) return false;
  const nums = octets.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const a = nums[0] ?? -1;
  const b = nums[1] ?? -1;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  return false;
}

function expandIPv6(hostname: string): number[] | null {
  const parts = hostname.split("::");
  if (parts.length > 2) return null;
  let head: string[];
  let tail: string[];
  if (parts.length === 2) {
    head = parts[0] ? parts[0].split(":") : [];
    tail = parts[1] ? parts[1].split(":") : [];
  } else {
    head = (parts[0] ?? "").split(":");
    tail = [];
  }
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g, 16));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums;
}

function isPrivateIPv6(hostname: string): boolean {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const groups = expandIPv6(bare);
  if (!groups) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  if (groups.every((g) => g === 0)) return true; // :: unspecified
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1 loopback
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  // ::ffff:a.b.c.d IPv4-mapped (RFC 4291) — check the mapped address against the
  // same IPv4 ranges rather than duplicating them.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const mapped = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
    return isPrivateIPv4(mapped);
  }
  // IPv6 transition/translation mechanisms that embed an IPv4 address in a
  // well-known bit position. For each, extract the embedded IPv4 and reject if
  // it falls in a private/loopback/link-local/reserved range. Only private
  // embedded addresses are rejected — public embedded addresses are allowed.
  //
  // NAT64 well-known prefix 64:ff9b::/96 (RFC 6052): the last 32 bits (g6, g7)
  // encode the translated IPv4 target. Used by DNS64/NAT64 gateways to synthesise
  // IPv6 reachability for IPv4-only destinations; a host behind such a gateway
  // could route to a private IPv4 via this address.
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    if (isPrivateIPv4(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`)) return true;
  }
  // IPv4-translated ::ffff:0:a.b.c.d (RFC 8215): last 32 bits (g6, g7) embed
  // the IPv4. Distinguished from the IPv4-mapped form (::ffff:a.b.c.d, already
  // caught above) by the group positions: g4=0xffff,g5=0 here vs g4=0,g5=0xffff
  // in the mapped form.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    if (isPrivateIPv4(`${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`)) return true;
  }
  // 6to4 2002::/16 (RFC 3056): bits 16..47 (g1 high/low and g2 high/low) encode
  // the embedded IPv4 address of the originating host or relay.
  if (g0 === 0x2002) {
    if (isPrivateIPv4(`${g1 >> 8}.${g1 & 0xff}.${g2 >> 8}.${g2 & 0xff}`)) return true;
  }
  // Teredo 2001:0000::/32 (RFC 4380): the client's external IPv4 occupies the
  // last 32 bits (g6, g7) but is XOR-obfuscated with 0xffffffff. De-obfuscate
  // before applying the private-range check.
  if (g0 === 0x2001 && g1 === 0x0000) {
    const dg6 = g6 ^ 0xffff;
    const dg7 = g7 ^ 0xffff;
    if (isPrivateIPv4(`${dg6 >> 8}.${dg6 & 0xff}.${dg7 >> 8}.${dg7 & 0xff}`)) return true;
  }
  return false;
}

/**
 * Throws if `url` is unsafe to fetch: not `https:`, or a hostname that is
 * "localhost" or an IP literal in a private, loopback, link-local, or reserved
 * range. Called before every `fetchRaw` in the generic provider.
 */
export function assertPubliclyRoutableUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`generic provider: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`generic provider: URL must use HTTPS: ${url}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost") {
    throw new Error(`generic provider: refusing to fetch localhost: ${url}`);
  }
  const isPrivate = hostname.startsWith("[") ? isPrivateIPv6(hostname) : isPrivateIPv4(hostname);
  if (isPrivate) {
    throw new Error(`generic provider: refusing to fetch a private/reserved address: ${url}`);
  }
}

/** One resolved address, as returned by `dns.lookup(hostname, { all: true })`. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Resolves a hostname to all of its addresses. Injectable for tests. */
export type ResolveFn = (hostname: string) => Promise<ResolvedAddress[]>;

/* v8 ignore start */
export async function defaultDnsResolve(hostname: string): Promise<ResolvedAddress[]> {
  return lookup(hostname, { all: true });
}
/* v8 ignore stop */

function isPrivateResolvedAddress(address: string, family: number): boolean {
  return family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address);
}

/**
 * Best-effort DNS layer on top of `assertPubliclyRoutableUrl`: resolves the
 * URL's hostname and rejects if ANY resolved address is private, loopback,
 * link-local, or reserved. Fails closed on resolution errors.
 * See the module-level comment for the documented TOCTOU/DNS-rebinding residual.
 */
export async function assertDnsResolvesPublicly(
  url: string,
  resolveFn: ResolveFn = defaultDnsResolve,
): Promise<void> {
  const hostname = new URL(url).hostname.toLowerCase();
  const bareHostname = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveFn(bareHostname);
  } catch {
    throw new Error(`generic provider: DNS resolution failed for ${bareHostname}`);
  }

  if (addresses.length === 0) {
    throw new Error(`generic provider: DNS resolution returned no addresses for ${bareHostname}`);
  }

  for (const { address, family } of addresses) {
    if (isPrivateResolvedAddress(address, family)) {
      throw new Error(
        `generic provider: hostname ${bareHostname} resolves to a private/reserved address (${address}): ${url}`,
      );
    }
  }
}
