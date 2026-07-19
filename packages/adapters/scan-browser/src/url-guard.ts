import { lookup } from "node:dns/promises";

// SSRF backstop for fetchRendered (Phase 3 adversarial review, Finding 3).
// posting.url is untrusted: several scan-http providers copy it verbatim
// from third-party JSON (see the provider-level allowlist fix alongside this
// file), and fetchRendered is the first code path in this repo that
// navigates a real browser to that URL. This is defense in depth on top of
// the provider-level allowlist, not a replacement for it — it guards every
// caller of fetchRendered regardless of which provider produced the URL
// (including the generic provider, whose URL comes from local config rather
// than third-party JSON).
//
// Deliberately conservative: only https: is allowed, and any hostname that
// is itself an IP literal in a private/loopback/link-local/reserved range is
// rejected, along with "localhost". Rejecting IP literals closes the direct,
// zero-effort attack (a provider or attacker-controlled JSON field pointing
// straight at 169.254.169.254 or 127.0.0.1).
//
// assertDnsResolvesPublicly (below) adds a best-effort second layer for a
// *public hostname* that resolves to a private/reserved IP — the case the
// literal-hostname check above can't see. It is explicitly best-effort, not
// a fix for DNS-rebinding SSRF: it resolves the hostname once, at guard
// time, and Playwright gives no pre-connect resolved-address hook, so
// nothing pins the browser's own connection to the address this check saw.
// An attacker controlling DNS for the target hostname can serve a public
// address to this check and a private one to the browser's subsequent
// connect (classic TOCTOU/rebinding). Closing that fully would require
// intercepting the browser's own connection (e.g. a proxy that resolves and
// filters per-connection), which is out of scope here. This layer still
// raises the bar against the common case: a hostname that consistently
// resolves to an internal address (misconfigured DNS, a name that was never
// meant to be public, a compromised authoritative nameserver at rest).

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

// Expands a canonical WHATWG-URL IPv6 hostname (already lowercased,
// bracket-free, "::"-compressed by `new URL()`) into its 8 16-bit groups.
// Returns null if the hostname isn't a well-formed IPv6 literal.
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
  // ::ffff:a.b.c.d IPv4-mapped (RFC 4291) — extract the embedded IPv4 and check
  // against the same private ranges rather than duplicating them.
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
 * Throws if `url` is unsafe to navigate a browser to: not `https:`, or a
 * hostname that is "localhost" or an IP literal in a private, loopback,
 * link-local, or reserved range. Called before every `page.goto()` in
 * fetchRendered.
 */
export function assertPubliclyRoutableUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`fetchRendered: invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`fetchRendered: URL must use HTTPS: ${url}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost") {
    throw new Error(`fetchRendered: refusing to navigate to localhost: ${url}`);
  }
  // WHATWG URL always brackets an IPv6 literal hostname, so a bracket-free
  // hostname is never IPv6 here.
  const isPrivate = hostname.startsWith("[") ? isPrivateIPv6(hostname) : isPrivateIPv4(hostname);
  if (isPrivate) {
    throw new Error(`fetchRendered: refusing to navigate to a private/reserved address: ${url}`);
  }
}

/** One resolved address, as returned by `dns.lookup(hostname, { all: true })`. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Resolves a hostname to all of its addresses. Injectable for tests. */
export type ResolveFn = (hostname: string) => Promise<ResolvedAddress[]>;

// Real DNS lookup — deliberately excluded from unit-test coverage (tests
// inject a fake ResolveFn and must never make a real DNS call).
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
 * link-local, or reserved — catching a public hostname that points at an
 * internal address, which the literal-hostname check above cannot see.
 *
 * Fails closed: a resolution error (NXDOMAIN, timeout, etc.) is rejected
 * rather than allowed through. See the module-level comment above for the
 * documented TOCTOU/DNS-rebinding residual — this check happens once, before
 * navigation, and nothing pins the browser's later connect to the address
 * seen here.
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
    throw new Error(`fetchRendered: DNS resolution failed for ${bareHostname}`);
  }

  if (addresses.length === 0) {
    throw new Error(`fetchRendered: DNS resolution returned no addresses for ${bareHostname}`);
  }

  for (const { address, family } of addresses) {
    if (isPrivateResolvedAddress(address, family)) {
      throw new Error(
        `fetchRendered: hostname ${bareHostname} resolves to a private/reserved address (${address}): ${url}`,
      );
    }
  }
}
