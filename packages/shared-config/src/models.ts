import { z } from "zod";

export const ModelRoleSchema = z.enum([
  "triage",
  "score",
  "tailor",
  "cover-final",
  "judge",
  "research",
  "coaching-drill",
  "coaching-prep-pack",
  "content-topics",
  "default",
]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelsConfigSchema = z.object({
  default: z.string(),
  roles: z.record(ModelRoleSchema, z.string()),
});
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
