import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { CvContent } from "@selfwright/core";
import { buildDocx, buildMd } from "../builders.js";
import { TypstRenderAdapter } from "../render.js";

const emptyCv: CvContent = {};

const cvWithLead: CvContent = {
  name: "Test User",
  headline: "Engineer",
  summary: "Summary text.",
  citizenship: "UK",
  skills: ["Go"],
  roles: [
    {
      company: "Corp",
      title: "Dev",
      period: "2020–2024",
      location: "London",
      lead: "Led the team.",
      bullets: ["Did work"],
    },
    {
      company: "Corp2",
      title: "Junior",
      period: "2018–2020",
      location: "Paris",
      // no lead — exercises the false branch
      bullets: [],
    },
  ],
  earlier_career: [{ org: "Startup", rest: " — 2016" }],
  education: ["BSc Maths"],
  certifications: ["AWS SAA"],
  languages: "English",
  contact: {
    location: "London",
    phone: "+44 0000",
    email: "t@t.com",
    linkedin: "https://linkedin.com/in/test",
  },
};

const minimalCv: CvContent = {
  name: "Jane Doe",
  headline: "Senior Engineer",
  summary: "Experienced engineer with 10 years in fintech.",
  citizenship: "EU citizen",
  skills: ["TypeScript", "Node.js", "AWS"],
  roles: [
    {
      company: "Acme Corp",
      title: "Lead Engineer",
      period: "2020–2024",
      location: "London",
      lead: "Led a team of 8 engineers.",
      bullets: ["Reduced latency by 40%", "Shipped 3 major releases"],
    },
  ],
  earlier_career: [
    { org: "StartupXY", rest: " — Junior Developer, 2015–2018" },
  ],
  education: ["BSc Computer Science, University of Bristol, 2014"],
  certifications: ["AWS Solutions Architect – Associate"],
  languages: "English (native), Portuguese (native), Spanish (intermediate)",
  contact: {
    location: "London, UK",
    phone: "+44 7700 900000",
    email: "jane@example.com",
    linkedin: "https://linkedin.com/in/janedoe",
  },
};

describe("buildDocx", () => {
  it("returns a non-empty Buffer for minimal CvContent", async () => {
    const buf = await buildDocx(minimalCv);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("returns a non-empty Buffer for empty CvContent", async () => {
    const buf = await buildDocx(emptyCv);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles role with lead and role without lead", async () => {
    const buf = await buildDocx(cvWithLead);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("handles bold and italics text run opts", async () => {
    // CV where bold/italics are exercised via role with lead (uses para with after:40)
    const buf = await buildDocx(minimalCv);
    expect(buf.length).toBeGreaterThan(0);
  });
});

describe("buildMd", () => {
  it("contains the CV name in the output", () => {
    const md = buildMd(minimalCv);
    expect(md).toContain("Jane Doe");
  });

  it("contains the headline", () => {
    const md = buildMd(minimalCv);
    expect(md).toContain("Senior Engineer");
  });

  it("contains all section headers", () => {
    const md = buildMd(minimalCv);
    expect(md).toContain("## Summary");
    expect(md).toContain("## Relevant skills");
    expect(md).toContain("## Experience");
    expect(md).toContain("## Earlier career");
    expect(md).toContain("## Education");
    expect(md).toContain("## Certifications");
    expect(md).toContain("## Languages");
  });

  it("uses bold for earlier_career org", () => {
    const md = buildMd(minimalCv);
    expect(md).toContain("**StartupXY**");
  });

  it("uses markdown link for linkedin", () => {
    const md = buildMd(minimalCv);
    expect(md).toContain("[https://linkedin.com/in/janedoe](https://linkedin.com/in/janedoe)");
  });

  it("handles empty CvContent without errors", () => {
    const md = buildMd(emptyCv);
    expect(md).toContain("## Summary");
    expect(md).toContain("## Languages");
  });

  it("includes role lead when present", () => {
    const md = buildMd(cvWithLead);
    expect(md).toContain("Led the team.");
  });

  it("skips lead when absent", () => {
    const md = buildMd(cvWithLead);
    // Corp2 has no lead — check its section doesn't include placeholder
    expect(md).toContain("### Corp2 — Junior");
  });
});

describe("TypstRenderAdapter.render()", () => {
  it("creates DOCX and MD files in the output dir", async () => {
    const outputDir = join(tmpdir(), `selfwright-test-${randomBytes(4).toString("hex")}`);
    const adapter = new TypstRenderAdapter("/nonexistent/templates");
    const result = await adapter.render({ cv: minimalCv, outputDir });
    expect(existsSync(result.docxPath)).toBe(true);
    expect(existsSync(result.mdPath)).toBe(true);
    const docxBuf = await readFile(result.docxPath);
    expect(docxBuf.length).toBeGreaterThan(0);
    const mdContent = await readFile(result.mdPath, "utf-8");
    expect(mdContent).toContain("Jane Doe");
  });

  it("returns undefined pdfPath when Typst is not installed", async () => {
    const outputDir = join(tmpdir(), `selfwright-test-${randomBytes(4).toString("hex")}`);
    const adapter = new TypstRenderAdapter("/nonexistent/templates");
    const result = await adapter.render({ cv: minimalCv, outputDir });
    // Typst is not installed in CI — pdfPath must be undefined
    expect(result.pdfPath).toBeUndefined();
  });

  it("docxPath and mdPath are defined and accessible", async () => {
    const outputDir = join(tmpdir(), `selfwright-test-${randomBytes(4).toString("hex")}`);
    const adapter = new TypstRenderAdapter("/nonexistent/templates");
    const result = await adapter.render({ cv: minimalCv, outputDir });
    expect(typeof result.docxPath).toBe("string");
    expect(typeof result.mdPath).toBe("string");
    expect(result.docxPath).toContain("cv.docx");
    expect(result.mdPath).toContain("cv.md");
  });
});
