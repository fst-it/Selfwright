import { z } from "zod";

const BulletEvidenceSchema = z.object({
  evidence: z.array(z.string()),
  note: z.string().optional(),
});

const RoleEvidenceSchema = z.object({
  company: z.string().optional(),
  title: z.string().optional(),
  lead_evidence: z.array(z.string()).optional(),
  bullets: z.record(BulletEvidenceSchema).optional(),
});

export const EvidenceMapSchema = z.object({
  _comment: z.string().optional(),
  roles: z.record(RoleEvidenceSchema),
});

export type BulletEvidence = z.infer<typeof BulletEvidenceSchema>;
export type RoleEvidence = z.infer<typeof RoleEvidenceSchema>;
export type EvidenceMap = z.infer<typeof EvidenceMapSchema>;
