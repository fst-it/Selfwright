import { describe, expect, it, vi } from "vitest";
import type { ScanFetchContext, ScanTarget } from "@selfwright/core";
import { weworkremotelyProvider } from "../weworkremotely.js";

function fakeTextCtx(text: string): ScanFetchContext {
  return {
    fetchJson: vi.fn(),
    fetchText: vi.fn().mockResolvedValue(text),
    fetchRaw: vi.fn(),
  };
}

function stderrLines(): string[] {
  return (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls.map(
    (c: unknown[]) => String(c[0]),
  );
}

// Minimal representative RSS 2.0 fragment as returned by WeWorkRemotely.
const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>We Work Remotely: Remote jobs in design, programming, marketing and more</title>
    <item>
      <title><![CDATA[Highlevel: Product Solutions Engineer - Creator Platform]]></title>
      <link>https://weworkremotely.com/remote-jobs/highlevel-product-solutions-engineer</link>
      <pubDate>Tue, 30 Jun 2026 20:31:08 +0000</pubDate>
      <region><![CDATA[Anywhere in the World]]></region>
      <description><![CDATA[<img src="logo.gif" /><p><strong>Headquarters:</strong> Dallas</p>]]></description>
      <guid>https://weworkremotely.com/remote-jobs/highlevel-product-solutions-engineer</guid>
    </item>
    <item>
      <title><![CDATA[Acme Corp: Senior Backend Engineer]]></title>
      <link>https://weworkremotely.com/remote-jobs/acme-corp-senior-backend-engineer</link>
      <pubDate>Mon, 29 Jun 2026 10:00:00 +0000</pubDate>
      <region><![CDATA[USA Only]]></region>
      <guid>https://weworkremotely.com/remote-jobs/acme-corp-senior-backend-engineer</guid>
    </item>
  </channel>
</rss>`;

const baseTarget: ScanTarget = {
  company: "WeWorkRemotely",
  provider: "weworkremotely",
};

describe("weworkremotelyProvider.detect", () => {
  it("returns the default feed URL when no api is set", () => {
    expect(weworkremotelyProvider.detect(baseTarget)).toEqual({
      url: "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    });
  });

  it("uses api URL from target when set", () => {
    const t: ScanTarget = {
      ...baseTarget,
      api: "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
    };
    expect(weworkremotelyProvider.detect(t)).toEqual({
      url: "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
    });
  });

  it("returns null for non-weworkremotely provider", () => {
    const t: ScanTarget = { company: "Acme", provider: "greenhouse" };
    expect(weworkremotelyProvider.detect(t)).toBeNull();
  });

  it("rejects an off-host api URL", () => {
    const t: ScanTarget = { ...baseTarget, api: "https://evil.example/jobs.rss" };
    expect(() => weworkremotelyProvider.detect(t)).toThrow(/untrusted hostname/);
  });

  it("rejects an HTTP api URL", () => {
    const t: ScanTarget = {
      ...baseTarget,
      api: "http://weworkremotely.com/categories/remote-programming-jobs.rss",
    };
    expect(() => weworkremotelyProvider.detect(t)).toThrow(/HTTPS/);
  });
});

describe("weworkremotelyProvider.fetch", () => {
  it("parses RSS items to RawPosting, extracting company from title", async () => {
    const ctx = fakeTextCtx(SAMPLE_RSS);
    const result = await weworkremotelyProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      title: "Product Solutions Engineer - Creator Platform",
      company: "Highlevel",
      url: "https://weworkremotely.com/remote-jobs/highlevel-product-solutions-engineer",
      location: "Anywhere in the World",
      source: "weworkremotely",
      sourceKind: "structured",
    });
    expect(result[1]).toMatchObject({
      title: "Senior Backend Engineer",
      company: "Acme Corp",
      location: "USA Only",
    });
  });

  it("falls back to target.company when title has no colon prefix", async () => {
    const rss = `<rss><channel>
      <item>
        <title><![CDATA[Staff Software Engineer]]></title>
        <link>https://weworkremotely.com/remote-jobs/staff-swe</link>
        <region><![CDATA[Worldwide]]></region>
      </item>
    </channel></rss>`;
    const ctx = fakeTextCtx(rss);
    const result = await weworkremotelyProvider.fetch(baseTarget, ctx);
    expect(result[0]?.company).toBe("WeWorkRemotely");
    expect(result[0]?.title).toBe("Staff Software Engineer");
  });

  it("uses 'Remote' as location fallback when region is absent", async () => {
    const rss = `<rss><channel>
      <item>
        <title><![CDATA[Acme: SRE]]></title>
        <link>https://weworkremotely.com/remote-jobs/acme-sre</link>
      </item>
    </channel></rss>`;
    const ctx = fakeTextCtx(rss);
    const result = await weworkremotelyProvider.fetch(baseTarget, ctx);
    expect(result[0]?.location).toBe("Remote");
  });

  it("drops items with off-host link URLs (SSRF guard)", async () => {
    const rss = `<rss><channel>
      <item>
        <title><![CDATA[Evil: Phish Job]]></title>
        <link>https://evil.example/jobs/phish</link>
        <region><![CDATA[Worldwide]]></region>
      </item>
      <item>
        <title><![CDATA[Good Co: Real Job]]></title>
        <link>https://weworkremotely.com/remote-jobs/real-job</link>
        <region><![CDATA[Worldwide]]></region>
      </item>
    </channel></rss>`;
    const ctx = fakeTextCtx(rss);
    const result = await weworkremotelyProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Real Job");
  });

  it("drops items with HTTP link URLs (SSRF guard)", async () => {
    const rss = `<rss><channel>
      <item>
        <title><![CDATA[Acme: Downgrade]]></title>
        <link>http://weworkremotely.com/remote-jobs/downgrade</link>
        <region><![CDATA[Worldwide]]></region>
      </item>
    </channel></rss>`;
    const ctx = fakeTextCtx(rss);
    const result = await weworkremotelyProvider.fetch(baseTarget, ctx);
    expect(result).toHaveLength(0);
  });

  it("warns to stderr on 0 results", async () => {
    const stderrMock = vi.spyOn(process.stderr, "write");
    const ctx = fakeTextCtx("<rss><channel></channel></rss>");
    await weworkremotelyProvider.fetch(baseTarget, ctx);
    const warns = stderrLines();
    expect(
      warns.some((l) => l.includes("warn: weworkremotely") && l.includes("0 postings")),
    ).toBe(true);
    stderrMock.mockRestore();
  });
});
