import { z } from "zod";

const EducationEntrySchema = z.object({
  degree: z.string().min(1),
  school: z.string().min(1),
  show_year: z.boolean().optional(),
});

const ContactSchema = z.object({
  location: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().min(1),
  linkedin: z.string().min(1),
});

const RoleTimelineEntrySchema = z.object({
  company: z.string().min(1),
  title: z.string().min(1),
  period: z.string().min(1),
});

export const IdentitySchema = z.object({
  name: z.string().min(1),
  canonical_title: z.string().min(1),
  years_experience: z.number().int().positive(),
  headline: z.string().min(1),
  seniority_equivalence: z.string().min(1),
  headline_policy: z.string().min(1),
  also_known_as_titles: z.array(z.string()),
  cv_generation_rules: z.array(z.string()),
  education: z.array(EducationEntrySchema),
  contact: ContactSchema,
  citizenship: z.string().min(1),
  relocation: z.array(z.string()),
  languages: z.record(z.string()),
  certifications: z.array(z.string()),
  /** Each company has a different nested shape; typed as open record to stay stable. */
  team_sizes: z.record(z.unknown()),
  roles_timeline: z.array(RoleTimelineEntrySchema),
  honesty_boundaries: z.array(z.string()),
  calibration: z.string().min(1),
  banned_words_source: z.string().optional(),
});

export type Identity = z.infer<typeof IdentitySchema>;
