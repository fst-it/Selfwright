import { z } from "zod";

// ── Scoring vocabulary (open-core boundary, ADR 0017) ──────────────────────────
//
// classifyIndustry/computePriority (priority.ts) and companyTypeFit (score.ts)
// need real company names to classify industry tiers and detect commodity-
// trading sector signals. The owner's real targeting vocabulary is DATA, not
// framework code (see ADR 0017's derived named-entity gate) — it lives in the
// private data repo (positioning/ or truth/scoring-vocabulary.yml) and is
// loaded at the app layer, never hardcoded here. Core ships only a SYNTHETIC
// default so scoring degrades gracefully (never crashes) when no data-layer
// vocabulary is present.

export const IndustryTierSchema = z.object({
  bucket: z.string(),
  points: z.number(),
  keywords: z.array(z.string()),
});
export type IndustryTier = z.infer<typeof IndustryTierSchema>;

export const ScoringVocabularySchema = z.object({
  /** Tier-0 fast-lane company names (lowercased in comparisons). */
  anchors: z.array(z.string()),
  /** Ordered industry-tier rules; first keyword match wins. */
  industryTiers: z.array(IndustryTierSchema),
  /** Commodity-trading company names folded into the company_type_fit sector signal. */
  commodityKeywords: z.array(z.string()),
});
export type ScoringVocabulary = z.infer<typeof ScoringVocabularySchema>;

/**
 * Synthetic default vocabulary — dictionary-safe placeholder names, never the
 * owner's real targeting data. Used whenever no data-layer vocabulary file is
 * present (FF-INPUT posture: scoring must never crash for lack of the file).
 */
export const DEFAULT_SCORING_VOCABULARY: ScoringVocabulary = {
  anchors: ["acme trading", "example bank group", "sample consulting partners"],
  industryTiers: [
    {
      bucket: "trading",
      points: 5,
      keywords: ["acme trading", "example commodities co", "sample trading house"],
    },
    {
      bucket: "bank_or_asset_mgr",
      points: 4,
      keywords: ["example bank group", "sample asset management"],
    },
    {
      bucket: "strategy_consulting",
      points: 4,
      keywords: ["sample consulting partners", "example strategy group"],
    },
    {
      bucket: "tech_frontier",
      points: 3,
      keywords: ["example tech corp", "sample cloud platform"],
    },
    {
      bucket: "pharma_manufacturing",
      points: 2,
      keywords: ["example pharma inc", "sample biotech labs"],
    },
    {
      bucket: "it_services_or_other",
      points: 1,
      keywords: ["example it services", "sample outsourcing co"],
    },
  ],
  commodityKeywords: ["acme trading", "example commodities co", "sample trading house"],
};
