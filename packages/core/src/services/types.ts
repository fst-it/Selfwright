import type { Archetype, EvidenceEntry, Ontology, Identity, DriftEntry } from "../truth/index.js";
import type { CvContent, ScoringVocabulary } from "../scoring/index.js";
import type { TailoredCvContent } from "../tailoring/index.js";
import type { CandidateGap, DrillSelection, Debrief } from "../coaching/index.js";
import type { QueueEntry } from "../scanning/index.js";
export type { QueueEntry };

// Score service
export interface ScoreInput {
  jdText: string;
  archetypes: Archetype[];
  ontology: Ontology;
  registry: EvidenceEntry[];
  vocabulary?: ScoringVocabulary;
}
export type { JdScoreResult } from "../scoring/index.js";

// ATS service
export interface AtsInput {
  jdText: string;
  cv: CvContent;
  evidenceRegistry: EvidenceEntry[];
  ontology: Ontology;
  opts?: { threshold?: number; weightA?: number; weightB?: number };
}
export type { AtsResult } from "../scoring/index.js";

// Tailor service — just re-exports from tailoring/
export type { CvOverlay, EvidenceMap, TailoredCvContent } from "../tailoring/index.js";
export type { TailorError } from "../tailoring/index.js";
export type { TailorOpts } from "./tailor.js";

// Cover service
export interface CoverContext {
  jdText: string;
  companyResearch?: string;
  tailoredCv: TailoredCvContent;
  archetypeId?: string;
  identity: Identity;
  styleGuide?: string;
  driftSummary?: string;
}
export interface CoverResult {
  markdown: string;
  wordCount: number;
}

// Research service
export interface ResearchContext {
  company: string;
  roleTitle: string;
  jdText: string;
  identity: Identity;
  gapsText?: string;
  archetypeId?: string;
}
export interface ResearchResult {
  markdown: string;
}

// Canonical ledger vocabulary for an application's lifecycle status.
// This is the single source of truth shared by all web surfaces (pipeline
// display, status-update write route) and future API consumers.
export const APPLICATION_STATUSES = [
  "discovered",
  "evaluating",
  "ready",
  "outreach",
  "applied",
  "screen",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "skipped",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

// Status subsets used by outcome metrics (north-star, channel-outcomes, the reporting page's
// "by status" breakdown). Defined once, here, as subsets of the canonical APPLICATION_STATUSES
// above -- previously each of those three call sites carried its own copy of the same literal
// set, which meant adding/renaming a status in APPLICATION_STATUSES could silently desync them.
// Typed as ReadonlySet<string>, not ReadonlySet<ApplicationStatus>: callers check
// membership against ApplicationRecord.status, which is `string` (parsed off disk,
// not statically validated -- ADR 0017 FF-INPUT), not the narrower literal union.
export const SUBMITTED_STATUSES: ReadonlySet<string> = new Set<ApplicationStatus>([
  "applied",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
]);
export const INTERVIEWED_STATUSES: ReadonlySet<string> = new Set<ApplicationStatus>(["interview", "offer"]);

// Inbox service
export interface ApplicationRecord {
  id: string;
  company: string;
  role: string;
  status: string;
  channel?: string;
  dates: {
    discovered?: string;
    promoted?: string;
    applied?: string;
    last_update?: string;
  };
  fit_score?: number | null;
  ats_score?: { overall?: number } | null;
  notes?: string;
}
export interface InboxItem {
  kind: "application" | "queue" | "drift" | "coaching" | "content";
  id: string;
  title: string;
  detail: string;
}
export interface InboxData {
  applications: ApplicationRecord[];
  queue: QueueEntry[];
  drifts: DriftEntry[];
  coaching?: {
    candidateGaps: CandidateGap[];
    nextDrill?: DrillSelection;
    /**
     * ISO timestamp of the most recent drill. When set and
     * opts.drillCadenceDays > 0, inbox suppresses the next-drill FYI item
     * if `daysSince(lastDrillAt, asOf) < drillCadenceDays`.
     */
    lastDrillAt?: string;
  };
  content?: { lastDigestAt?: string; candidateCount?: number };
  /**
   * Debrief records for interview applications.
   * Loaded best-effort by producers (CLI/MCP) from coaching/debriefs.yml.
   * Used to surface undebriefed interviews in Review-soon.
   */
  debriefs?: Debrief[];
}
export interface InboxReport {
  decideNow: InboxItem[];
  reviewSoon: InboxItem[];
  fyi: InboxItem[];
  asOf: string;
}
