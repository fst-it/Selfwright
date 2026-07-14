import { describe, expect, it, vi } from "vitest";
import { assertPubliclyRoutableUrl, assertDnsResolvesPublicly } from "../url-guard.js";
import type { ResolveFn } from "../url-guard.js";

// Mirrors packages/adapters/scan-browser/src/__tests__/url-guard.test.ts.
// The implementation in scan-http/url-guard.ts is a deliberate copy kept
// independent so scan-http has no dependency on scan-browser.
// See the module-level comment in url-guard.ts for rationale.

describe("assertPubliclyRoutableUrl (scan-http)", () => {
  it("allows a normal https URL", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://api.adzuna.com/v1/api/jobs/gb/search/1");
    }).not.toThrow();
  });

  it("throws on an invalid URL", () => {
    expect(() => {
      assertPubliclyRoutableUrl("not a url");
    }).toThrow(/invalid URL/);
  });

  it("throws on a non-https scheme", () => {
    expect(() => {
      assertPubliclyRoutableUrl("http://example.com/");
    }).toThrow(/must use HTTPS/);
  });

  it("throws on localhost", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://localhost/");
    }).toThrow(/localhost/);
  });

  it.each([
    ["loopback", "https://127.0.0.1/"],
    ["cloud metadata / link-local", "https://169.254.169.254/latest/meta-data"],
    ["private class A", "https://10.1.2.3/"],
    ["private class B", "https://172.16.0.1/"],
    ["private class C", "https://192.168.1.10/"],
  ])("throws on private/reserved IPv4 host: %s (%s)", (_label, url) => {
    expect(() => {
      assertPubliclyRoutableUrl(url);
    }).toThrow(/private\/reserved address/);
  });

  it.each([
    ["loopback", "https://[::1]/"],
    ["unspecified", "https://[::]/"],
    ["link-local", "https://[fe80::1]/"],
    ["unique-local fc", "https://[fc00::1]/"],
    ["unique-local fd", "https://[fd12:3456::1]/"],
    ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/"],
    ["IPv4-mapped private", "https://[::ffff:192.168.1.1]/"],
    // IPv6 transition/translation prefixes that embed an IPv4 address:
    // NAT64 64:ff9b::/96 (RFC 6052) — reviewer exact example
    ["NAT64 embedded loopback 64:ff9b::7f00:1 (=127.0.0.1)", "https://[64:ff9b::7f00:1]/"],
    ["NAT64 embedded private-A 64:ff9b::a00:1 (=10.0.0.1)", "https://[64:ff9b::a00:1]/"],
    ["NAT64 embedded cloud-metadata 64:ff9b::a9fe:a9fe (=169.254.169.254)", "https://[64:ff9b::a9fe:a9fe]/"],
    // IPv4-translated ::ffff:0:0/96 (RFC 8215) — reviewer exact example
    ["IPv4-translated embedded loopback ::ffff:0:7f00:1 (=127.0.0.1)", "https://[::ffff:0:7f00:1]/"],
    ["IPv4-translated embedded private-A ::ffff:0:a00:1 (=10.0.0.1)", "https://[::ffff:0:a00:1]/"],
    // 6to4 2002::/16 (RFC 3056)
    ["6to4 embedded loopback 2002:7f00:1:: (=127.0.0.1)", "https://[2002:7f00:1::]/"],
    ["6to4 embedded private-A 2002:0a00:1:: (=10.0.0.1)", "https://[2002:0a00:1::]/"],
    // Teredo 2001:0000::/32 (RFC 4380) — client IPv4 XOR 0xffffffff in last 32 bits
    ["Teredo embedded loopback 2001:0000::80ff:fffe (decodes to 127.0.0.1)", "https://[2001:0000::80ff:fffe]/"],
    ["Teredo embedded private-A 2001:0000::f5ff:fffe (decodes to 10.0.0.1)", "https://[2001:0000::f5ff:fffe]/"],
  ])("throws on private/reserved IPv6 host: %s (%s)", (_label, url) => {
    expect(() => {
      assertPubliclyRoutableUrl(url);
    }).toThrow(/private\/reserved address/);
  });

  it("does not throw on a public IPv6 host", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://[2606:4700:4700::1111]/");
    }).not.toThrow();
  });

  it("does not throw on 6to4 with no zero-run and a full 8-group address for a non-private embedded v4", () => {
    // 2001:db8:... — g0=0x2001, g1=0x0db8. Teredo check requires g1===0x0000; no match.
    expect(() => {
      assertPubliclyRoutableUrl("https://[2001:db8:1:2:3:4:5:6]/");
    }).not.toThrow();
  });

  // IPv6 transition prefixes with PUBLIC embedded IPv4 must be allowed.
  it("does not throw on NAT64 prefix with a public embedded IPv4 (64:ff9b::5db8:d822 = 93.184.216.34)", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://[64:ff9b::5db8:d822]/");
    }).not.toThrow();
  });

  it("does not throw on IPv4-translated prefix with a public embedded IPv4 (::ffff:0:5db8:d822 = 93.184.216.34)", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://[::ffff:0:5db8:d822]/");
    }).not.toThrow();
  });

  it("does not throw on 6to4 prefix with a public embedded IPv4 (2002:5db8:d822:: = 93.184.216.34)", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://[2002:5db8:d822::]/");
    }).not.toThrow();
  });

  it("does not throw on Teredo prefix with a public embedded IPv4 (2001:0000::a247:27dd decodes to 93.184.216.34)", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://[2001:0000::a247:27dd]/");
    }).not.toThrow();
  });
});

// Best-effort DNS layer — same structure as scan-browser; fake ResolveFn
// injected so no real DNS calls are made.
describe("assertDnsResolvesPublicly (scan-http)", () => {
  it("allows a hostname that resolves to a public address", async () => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertDnsResolvesPublicly("https://public.example/", resolveFn)).resolves.toBeUndefined();
  });

  it("rejects when the resolved IPv4 address is private", async () => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(assertDnsResolvesPublicly("https://internal.example/", resolveFn)).rejects.toThrow(
      /private\/reserved address/,
    );
  });

  it("rejects on resolver error — fail-closed", async () => {
    const resolveFn: ResolveFn = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertDnsResolvesPublicly("https://nonexistent.example/", resolveFn)).rejects.toThrow(
      /DNS resolution failed/,
    );
  });

  it("rejects when the resolver returns no addresses — fail-closed", async () => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([]);
    await expect(assertDnsResolvesPublicly("https://empty.example/", resolveFn)).rejects.toThrow(
      /DNS resolution returned no addresses/,
    );
  });

  it.each([
    ["NAT64 embedded loopback", "64:ff9b::7f00:1"],
    ["IPv4-translated embedded loopback", "::ffff:0:7f00:1"],
    ["6to4 embedded loopback", "2002:7f00:1::"],
    ["Teredo embedded loopback", "2001:0000::80ff:fffe"],
  ])("rejects a DNS-resolved IPv6 address with an embedded private IPv4 via transition prefix: %s (%s)", async (_label, address) => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([{ address, family: 6 }]);
    await expect(assertDnsResolvesPublicly("https://nat64relay.example/", resolveFn)).rejects.toThrow(
      /private\/reserved address/,
    );
  });
});
