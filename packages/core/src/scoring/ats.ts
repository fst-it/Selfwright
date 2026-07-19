import type { EvidenceEntry, Ontology } from "../truth/index.js";
import { normalise, norm, stripMarkdown } from "./text.js";
import type {
  AtsResult,
  CvContent,
  MissingTruthfulTerm,
  MissingUnsupportedTerm,
  PassACheck,
  PassAResult,
  PassBResult,
} from "./types.js";

// ── Pass A — Parseability ─────────────────────────────────────────────────────

const DATE_PATTERN =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}(\s+[–\-]\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}|(\s+[–\-]\s+Present))?$/;

const SAFE_VARIANTS = new Set(["cv-executive", "cv-ats-plain"]);

export function runPassA(cv: CvContent): PassAResult {
  const checks: PassACheck[] = [];
  const overlay = cv.overlay;

  // Check 1: variant
  const variant = overlay?.variant ?? cv.variant;
  const variantOk = !variant || SAFE_VARIANTS.has(variant);
  checks.push({
    name: "Overlay variant is cv-executive or cv-ats-plain (or not set)",
    pass: variantOk,
    detail: variant
      ? variantOk
        ? `variant = "${variant}"`
        : `variant = "${variant}" — not a safe ATS variant`
      : "No overlay variant set — assumed safe",
  });

  // Check 2: no markdown table syntax in bullets
  const allBullets: string[] = [];
  for (const r of cv.roles ?? []) {
    if (r.bullets) allBullets.push(...r.bullets);
  }
  const tableBullets = allBullets.filter((b) => /\|---/.test(b));
  checks.push({
    name: "No bullet contains markdown table syntax (|---|)",
    pass: tableBullets.length === 0,
    detail:
      tableBullets.length === 0
        ? "No markdown tables found in bullets"
        : `${tableBullets.length} bullet(s) contain table syntax`,
  });

  // Check 3: date formats
  const periods = (cv.roles ?? []).map((r) => r.period).filter(Boolean);
  const badPeriods = periods.filter((p) => !DATE_PATTERN.test(p.trim()));
  const dateScore = periods.length === 0 ? 1 : (periods.length - badPeriods.length) / periods.length;
  checks.push({
    name: 'Role periods match "Mon YYYY – Mon YYYY" or "Mon YYYY – Present"',
    pass: badPeriods.length === 0,
    score: dateScore,
    detail:
      badPeriods.length === 0
        ? `All ${periods.length} role period(s) match the required format`
        : `Non-conforming periods: ${badPeriods.map((p) => `"${p}"`).join(", ")}`,
  });

  // Check 4: required sections
  const requiredSections = [
    "summary", "skills", "roles", "earlier_career", "education", "certifications", "languages",
  ] as const;
  const missingSections = requiredSections.filter((s) => {
    const v = cv[s as keyof CvContent];
    if (v === undefined) return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (typeof v === "string" && v.trim() === "") return true;
    return false;
  });
  const sectionScore = (requiredSections.length - missingSections.length) / requiredSections.length;
  checks.push({
    name: "All required sections present (summary, skills, roles, earlier_career, education, certifications, languages)",
    pass: missingSections.length === 0,
    score: sectionScore,
    detail:
      missingSections.length === 0
        ? "All 7 required sections present and non-empty"
        : `Missing sections: ${missingSections.join(", ")}`,
  });

  // Check 5: name and contact
  const contact = cv.contact ?? {};
  const contactFields = ["location", "phone", "email", "linkedin"] as const;
  const missingContact = contactFields.filter((f) => !contact[f] || contact[f].trim() === "");
  const nameOk = typeof cv.name === "string" && cv.name.trim() !== "";
  const contactOk = missingContact.length === 0 && nameOk;
  checks.push({
    name: "Name and all contact fields present (location, phone, email, linkedin)",
    pass: contactOk,
    detail: contactOk
      ? "Name and all contact fields are present"
      : [
          !nameOk ? "name field missing" : "",
          missingContact.length ? `missing contact: ${missingContact.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; "),
  });

  // Check 6: no bullet longer than 800 chars
  const longBullets = allBullets.filter((b) => b.length > 800);
  checks.push({
    name: "No bullet longer than 800 characters",
    pass: longBullets.length === 0,
    detail:
      longBullets.length === 0
        ? "All bullets are within the 800-character limit"
        : `${longBullets.length} bullet(s) exceed 800 characters; longest = ${Math.max(...longBullets.map((b) => b.length))} chars`,
  });

  // Check 7: skills is non-empty list
  const skillsOk = Array.isArray(cv.skills) && cv.skills.length > 0;
  checks.push({
    name: "Skills field is a list with at least one entry",
    pass: skillsOk,
    detail: skillsOk
      ? `${cv.skills?.length ?? 0} skill line(s) present`
      : "skills field is missing or empty",
  });

  let scoreSum = 0;
  for (const c of checks) {
    scoreSum += c.score !== undefined ? c.score : c.pass ? 1 : 0;
  }
  return { score: scoreSum / checks.length, checks };
}

// ── Pass B — Keyword coverage ─────────────────────────────────────────────────

interface SynonymIndex {
  reverseMap: Record<string, string>;
}

function buildSynonymIndex(ontology: Ontology): SynonymIndex {
  const reverseMap: Record<string, string> = {};
  for (const [canonical, rawValue] of Object.entries(ontology)) {
    if (canonical.startsWith("_")) continue;
    const cLow = canonical.toLowerCase();
    reverseMap[normalise(canonical)] = cLow;
    if (!rawValue) continue;
    const synonyms = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const syn of synonyms) {
      if (typeof syn === "string") reverseMap[normalise(syn)] = cLow;
    }
  }
  return { reverseMap };
}

function findJdTerms(jdNorm: string, reverseMap: Record<string, string>): Set<string> {
  const found = new Set<string>();
  for (const [syn, canonical] of Object.entries(reverseMap)) {
    if (jdNorm.includes(syn)) found.add(canonical);
  }
  return found;
}

function termInCv(canonical: string, ontology: Ontology, cvNorm: string): boolean {
  if (cvNorm.includes(normalise(canonical))) return true;
  const rawValue = ontology[canonical] ?? ontology[`"${canonical}"`];
  if (!rawValue) return false;
  const synonyms = Array.isArray(rawValue) ? rawValue : [rawValue];
  for (const syn of synonyms) {
    if (typeof syn === "string" && cvNorm.includes(normalise(syn))) return true;
  }
  return false;
}

function findRegistrySupport(
  canonical: string,
  ontology: Ontology,
  registry: EvidenceEntry[],
): string[] {
  const rawValue = ontology[canonical];
  const synonyms = Array.isArray(rawValue) ? rawValue : [];
  const allTerms = [canonical, ...synonyms].map((t) => norm(t));
  return registry
    .filter((entry) => {
      const keywords = entry.keywords;
      return keywords.some((kw) => allTerms.includes(norm(kw)));
    })
    .map((entry) => entry.id);
}

export function flattenCv(cv: CvContent): string {
  const parts: string[] = [];
  if (cv.name) parts.push(cv.name);
  if (cv.headline) parts.push(cv.headline);
  if (cv.summary) parts.push(cv.summary);
  if (cv.citizenship) parts.push(cv.citizenship);
  for (const s of cv.skills ?? []) parts.push(s);
  for (const r of cv.roles ?? []) {
    parts.push(r.company, r.title, r.period, r.location);
    if (r.lead) parts.push(r.lead);
    for (const b of r.bullets ?? []) parts.push(b);
  }
  for (const e of cv.earlier_career ?? []) {
    parts.push(e.org, e.rest);
  }
  for (const e of cv.education ?? []) parts.push(e);
  for (const c of cv.certifications ?? []) parts.push(c);
  if (typeof cv.languages === "string") parts.push(cv.languages);
  const o = cv.overlay;
  if (o) {
    if (o.summary) parts.push(o.summary);
    for (const s of o.skills ?? []) parts.push(s);
    for (const b of o.bullets ?? []) parts.push(b);
  }
  return parts.filter(Boolean).join(" ");
}

export function runPassB(
  jdText: string,
  cv: CvContent,
  ontology: Ontology,
  registry: EvidenceEntry[],
): PassBResult {
  const { reverseMap } = buildSynonymIndex(ontology);
  const jdClean = normalise(stripMarkdown(jdText));
  const cvNorm = normalise(flattenCv(cv));
  const jdTerms = findJdTerms(jdClean, reverseMap);

  if (jdTerms.size === 0) {
    // No ontology terms were found in the JD (empty ontology, or a JD that
    // simply doesn't mention any configured term) — there is no keyword
    // coverage signal to measure, positive or negative. Defaulting to 1.0
    // here would silently present "no data" as a perfect match at runtime;
    // score neutrally instead (same "unknown, don't inflate" convention as
    // compAxis's norm: 0.5 for no_floor_data in priority.ts) and surface the
    // reason via `note` so callers can distinguish this from a real
    // full-coverage result.
    return {
      score: 0.5,
      jdTermsCount: 0,
      covered: [],
      missingTruthful: [],
      missingUnsupported: [],
      note: "No ontology terms detected in the JD — Pass B score defaulted to 0.5 (neutral, no coverage signal)",
    };
  }

  const covered: string[] = [];
  const missingTruthful: MissingTruthfulTerm[] = [];
  const missingUnsupported: MissingUnsupportedTerm[] = [];

  for (const term of jdTerms) {
    const canonicalKey =
      Object.keys(ontology).find(
        (k) =>
          k.toLowerCase() === term ||
          k.replace(/"/g, "").toLowerCase() === term,
      ) ?? term;

    if (termInCv(canonicalKey, ontology, cvNorm)) {
      covered.push(term);
    } else {
      const evidenceIds = findRegistrySupport(canonicalKey, ontology, registry);
      if (evidenceIds.length > 0) {
        missingTruthful.push({ term, evidenceIds });
      } else {
        missingUnsupported.push({ term });
      }
    }
  }

  return {
    score: covered.length / jdTerms.size,
    jdTermsCount: jdTerms.size,
    covered,
    missingTruthful,
    missingUnsupported,
  };
}

// ── Combined ATS score ────────────────────────────────────────────────────────

export function computeAts(
  jdText: string,
  cv: CvContent,
  ontology: Ontology,
  registry: EvidenceEntry[],
  opts: { threshold?: number; weightA?: number; weightB?: number } = {},
): AtsResult {
  const threshold = opts.threshold ?? 0.8;
  const wA = opts.weightA ?? 0.5;
  const wB = opts.weightB ?? 0.5;
  const passA = runPassA(cv);
  const passB = runPassB(jdText, cv, ontology, registry);
  const overall = wA * passA.score + wB * passB.score;
  return { passA, passB, overall, threshold, passes: overall >= threshold };
}
