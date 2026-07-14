import { join } from "node:path";
import { readdir } from "node:fs/promises";
import type { Context } from "hono";
import { ContentResponseSchema } from "@selfwright/api-contract";
import { tryReadFile } from "../utils.js";
import { apiOk } from "./shared.js";

/** GET /api/content — the cockpit's Content page data: digest list + latest digest inline view. */
export async function getContentApiRoute(c: Context, dataDir: string): Promise<Response> {
  const digestDir = join(dataDir, "content", "digests");
  const digestFiles = await readdir(digestDir).catch(() => null);
  const mdFiles = digestFiles !== null ? digestFiles.filter((f) => f.endsWith(".md")).sort().reverse() : [];

  let latestDigest: { file: string; content: string } | null = null;
  const firstFile = mdFiles[0];
  if (firstFile !== undefined) {
    const content = await tryReadFile(join(digestDir, firstFile));
    if (content !== null) latestDigest = { file: firstFile, content };
  }

  const body = ContentResponseSchema.parse({ digests: mdFiles, latestDigest });
  return apiOk(c, body);
}
