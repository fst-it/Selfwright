import { describe, expect, it, vi } from "vitest";
import { assertPubliclyRoutableUrl, assertDnsResolvesPublicly } from "../url-guard.js";
import type { ResolveFn } from "../url-guard.js";

describe("assertPubliclyRoutableUrl", () => {
  it("allows a normal https URL", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://boards.greenhouse.io/acme/jobs/1");
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

  it("throws on file:// URLs", () => {
    expect(() => {
      assertPubliclyRoutableUrl("file:///etc/passwd");
    }).toThrow(/must use HTTPS/);
  });

  it("throws on data: URLs", () => {
    expect(() => {
      assertPubliclyRoutableUrl("data:text/html,hi");
    }).toThrow(/must use HTTPS/);
  });

  it("throws on localhost", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://localhost/");
    }).toThrow(/localhost/);
  });

  it("throws on localhost regardless of case", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://LOCALHOST/");
    }).toThrow(/localhost/);
  });

  it.each([
    ["loopback", "https://127.0.0.1/"],
    ["cloud metadata / link-local", "https://169.254.169.254/latest/meta-data"],
    ["private class A", "https://10.1.2.3/"],
    ["private class B", "https://172.16.0.1/"],
    ["private class B upper bound", "https://172.31.255.255/"],
    ["private class C", "https://192.168.1.10/"],
    ["this-network", "https://0.0.0.0/"],
    ["octal-obfuscated loopback", "https://0177.0.0.1/"],
    ["hex-obfuscated loopback", "https://0x7f.0.0.1/"],
    ["decimal-obfuscated loopback", "https://2130706433/"],
  ])("throws on private/reserved IPv4 host: %s (%s)", (_label, url) => {
    expect(() => {
      assertPubliclyRoutableUrl(url);
    }).toThrow(/private\/reserved address/);
  });

  it("does not throw on a public IPv4 host just outside the 172.16/12 range", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://172.32.0.1/");
    }).not.toThrow();
    expect(() => {
      assertPubliclyRoutableUrl("https://172.15.255.255/");
    }).not.toThrow();
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

  it("does not throw on a public IPv6 host whose group textually resembles fe80 but isn't (fe8::1)", () => {
    expect(() => {
      assertPubliclyRoutableUrl("https://[fe8::1]/");
    }).not.toThrow();
  });

  it("does not throw on a full 8-group IPv6 host with no zero-run to compress", () => {
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

// R5: best-effort DNS-resolve SSRF check — assertDnsResolvesPublicly is a
// separate async function from the sync literal-hostname guard above, so it
// never makes a real DNS call in tests (a fake ResolveFn is always injected).
describe("assertDnsResolvesPublicly", () => {
  it("allows a hostname that resolves only to a public address", async () => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertDnsResolvesPublicly("https://public.example/", resolveFn)).resolves.toBeUndefined();
  });

  it("allows a hostname with multiple public addresses", async () => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    await expect(assertDnsResolvesPublicly("https://public.example/", resolveFn)).resolves.toBeUndefined();
  });

  it.each([
    ["loopback", "10.0.0.5"],
    ["private class A", "10.1.2.3"],
    ["private class B", "172.16.0.1"],
    ["private class C", "192.168.1.10"],
    ["link-local / cloud metadata", "169.254.169.254"],
    ["literal loopback", "127.0.0.1"],
  ])("rejects when the resolved IPv4 address is %s (%s)", async (_label, address) => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([{ address, family: 4 }]);
    await expect(assertDnsResolvesPublicly("https://internal.example/", resolveFn)).rejects.toThrow(
      /private\/reserved address/,
    );
  });

  it("rejects when any one of several resolved addresses is private", async () => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(assertDnsResolvesPublicly("https://multi.example/", resolveFn)).rejects.toThrow(
      /private\/reserved address/,
    );
  });

  it("rejects when the resolved IPv6 address is private (unique-local)", async () => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([{ address: "fd12:3456::1", family: 6 }]);
    await expect(assertDnsResolvesPublicly("https://internal6.example/", resolveFn)).rejects.toThrow(
      /private\/reserved address/,
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

  it("rejects on resolver error (NXDOMAIN etc.) — fail-closed", async () => {
    const resolveFn: ResolveFn = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
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

  it("resolves the bare hostname (brackets stripped from an IPv6 literal URL)", async () => {
    const resolveFn: ResolveFn = vi.fn().mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }]);
    await assertDnsResolvesPublicly("https://[2606:4700:4700::1111]/", resolveFn);
    expect(resolveFn).toHaveBeenCalledWith("2606:4700:4700::1111");
  });
});
