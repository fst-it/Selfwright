import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { RenderPort, RenderRequest, RenderResult } from "@selfwright/core";
import { buildDocx, buildMd } from "./builders.js";

export class TypstRenderAdapter implements RenderPort {
  constructor(private readonly templatesDir: string) {}

  async render(req: RenderRequest): Promise<RenderResult> {
    const { cv, outputDir, variant = "cv-executive", filename = "cv" } = req;
    await mkdir(outputDir, { recursive: true });

    // Write cv JSON to temp file for Typst
    const tempId = randomBytes(4).toString("hex");
    const tempJsonPath = join(tmpdir(), `selfwright-cv-${tempId}.json`);
    await writeFile(tempJsonPath, JSON.stringify(cv), "utf-8");

    // Build DOCX and MD (always)
    const docxPath = join(outputDir, `${filename}.docx`);
    const mdPath = join(outputDir, `${filename}.md`);

    const [docxBuf, mdContent] = await Promise.all([
      buildDocx(cv),
      Promise.resolve(buildMd(cv)),
    ]);
    await Promise.all([
      writeFile(docxPath, docxBuf),
      writeFile(mdPath, mdContent, "utf-8"),
    ]);

    // Typst PDF (optional)
    const pdfPath = join(outputDir, `${filename}.pdf`);
    const typPath =
      variant === "cv-ats-plain"
        ? join(this.templatesDir, "variants", "cv-ats-plain.typ")
        : join(this.templatesDir, "cv-executive.typ");
    const typstOk = await runTypst(typPath, pdfPath, tempJsonPath);

    return {
      pdfPath: typstOk ? pdfPath : undefined,
      docxPath,
      mdPath,
    };
  }
}

async function runTypst(
  typPath: string,
  outPath: string,
  jsonPath: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(
      "typst",
      ["compile", typPath, outPath, "--input", `cv_json=${jsonPath}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    proc.on("error", () => { resolve(false); }); // typst not installed
    proc.on("close", (code) => { resolve(code === 0); });
  });
}
