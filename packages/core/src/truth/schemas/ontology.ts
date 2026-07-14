import { z } from "zod";

/**
 * Keyword synonym map: canonical JD term → list of equivalents (or a single string).
 * Null values are allowed for reserved/placeholder keys.
 */
export const OntologySchema = z.record(
  z.string().min(1),
  z.union([z.string(), z.array(z.string()), z.null()]),
);

export type Ontology = z.infer<typeof OntologySchema>;
