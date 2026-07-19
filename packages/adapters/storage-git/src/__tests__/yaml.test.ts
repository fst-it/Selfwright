import { describe, it, expect } from "vitest";
import { parseYaml, parseFrontMatter } from "../yaml.js";

describe("parseYaml()", () => {
  it("parses a simple key-value YAML document", () => {
    const result = parseYaml("name: Alex\nyears: 17");
    expect(result).toEqual({ name: "Alex", years: 17 });
  });

  it("parses arrays", () => {
    const result = parseYaml("items:\n  - a\n  - b");
    expect(result).toEqual({ items: ["a", "b"] });
  });

  it("parses nested objects", () => {
    const result = parseYaml("a:\n  b:\n    c: 1");
    expect(result).toEqual({ a: { b: { c: 1 } } });
  });

  it("parses block scalars (>)", () => {
    const yaml = `desc: >\n  First line.\n  Second line.\n`;
    const result = parseYaml(yaml) as { desc: string };
    expect(result.desc.trim()).toContain("First line.");
  });

  it("preserves date-like strings as strings (YAML 1.2 mode)", () => {
    const result = parseYaml("date: 2026-06-14") as { date: unknown };
    expect(typeof result.date).toBe("string");
    expect(result.date).toBe("2026-06-14");
  });

  it("parses null values", () => {
    const result = parseYaml("key: null") as { key: unknown };
    expect(result.key).toBeNull();
  });

  it("parses inline maps (tag facets)", () => {
    const result = parseYaml("tag: { direct: hard, functional: soft }");
    expect(result).toEqual({ tag: { direct: "hard", functional: "soft" } });
  });

  it("throws on malformed YAML", () => {
    expect(() => parseYaml("{ unclosed")).toThrow();
  });

  // ADR 0017 FF-INPUT: the null-YAML-row class must reject with a typed error, never an
  // unhandled null-deref from deep inside the `yaml` dependency.
  it("rejects null with a typed TypeError, not a raw dependency null-deref", () => {
    expect(() => parseYaml(null)).toThrow(TypeError);
  });

  it("rejects undefined with a typed TypeError", () => {
    expect(() => parseYaml(undefined as unknown as string)).toThrow(TypeError);
  });

  it("rejects a non-string (number) with a typed TypeError", () => {
    expect(() => parseYaml(123)).toThrow(TypeError);
  });

  it("rejects a non-string (object) with a typed TypeError", () => {
    expect(() => parseYaml({})).toThrow(TypeError);
  });
});

describe("parseFrontMatter()", () => {
  it("extracts and parses the front-matter block", () => {
    const md = `---\nid: test\nlabel: Test\n---\n# Content`;
    const result = parseFrontMatter(md) as { id: string; label: string };
    expect(result.id).toBe("test");
    expect(result.label).toBe("Test");
  });

  it("works with arrays in front-matter", () => {
    const md = `---\ntags:\n  - a\n  - b\n---\nBody`;
    const result = parseFrontMatter(md) as { tags: string[] };
    expect(result.tags).toEqual(["a", "b"]);
  });

  it("throws SyntaxError when no front-matter block is present", () => {
    expect(() => parseFrontMatter("# Just content\nNo front-matter.")).toThrow(
      SyntaxError,
    );
  });

  it("throws SyntaxError on empty file", () => {
    expect(() => parseFrontMatter("")).toThrow(SyntaxError);
  });

  it("handles CRLF line endings in front-matter", () => {
    const md = "---\r\nid: crlf-test\r\n---\r\nContent";
    const result = parseFrontMatter(md) as { id: string };
    expect(result.id).toBe("crlf-test");
  });

  it("rejects null with a typed TypeError (FF-INPUT)", () => {
    expect(() => parseFrontMatter(null)).toThrow(TypeError);
  });

  it("rejects a non-string with a typed TypeError (FF-INPUT)", () => {
    expect(() => parseFrontMatter(42)).toThrow(TypeError);
  });
});
