import { z } from "zod";

export const ContentResponseSchema = z.object({
  digests: z.array(z.string()),
  latestDigest: z
    .object({
      file: z.string(),
      content: z.string(),
    })
    .nullable(),
});
export type ContentResponse = z.infer<typeof ContentResponseSchema>;
