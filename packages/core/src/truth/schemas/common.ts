import { z } from "zod";

/** The three verifiability levels from the registry legend. */
export const TagLevelSchema = z.enum(["hard", "soft", "claim"]);
export type TagLevel = z.infer<typeof TagLevelSchema>;
