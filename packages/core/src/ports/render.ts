import type { CvContent } from "../scoring/types.js";

export interface RenderRequest {
  cv: CvContent;
  outputDir: string;
  /** @default 'cv-executive' */
  variant?: "cv-executive" | "cv-ats-plain";
  /** Base filename without extension. @default 'cv' */
  filename?: string;
}

export interface RenderResult {
  pdfPath: string | undefined; // undefined when Typst is not installed
  docxPath: string;
  mdPath: string;
}

export interface RenderPort {
  render(req: RenderRequest): Promise<RenderResult>;
}
