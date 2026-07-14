import type { EvidenceEntry, Identity } from "./schemas/index.js";
import { traceClaims } from "./trace.js";

export interface R19Result {
  grounded: string[];
  ungrounded: string[];
  ok: boolean;
}

/**
 * Guard CV summary text against fabricated claims not anchored in the
 * evidence registry.
 *
 * Reuses traceClaims — the same clause-graft detection and quantity-phrase
 * corroboration hardening the generation-guard validators use (R8, Phase 3
 * truth-floor hardening round 3). r19-guard previously carried its own
 * parallel whole-sentence bag-of-words implementation (duplicate
 * STOP_WORDS/contentWords/entryTokens, no clause-splitting, no numeric
 * corroboration) — exactly the F2 weakness trace.ts had before that earlier
 * round's fix. A fabricated clause or number grafted onto a real one in a CV
 * summary line ("Leads enterprise architecture at Acme Corp and personally
 * built a proprietary network spanning 40 countries.") would ride through on
 * the first clause's real keyword overlap, since the old implementation
 * scored the whole sentence as one bag of words with no per-clause check and
 * no check that an asserted number/magnitude is actually in the matched
 * evidence's own text.
 *
 * identity.roles_timeline is folded in as a virtual evidence source (career
 * facts about the candidate's own companies/titles are always grounded) by
 * mapping each role to a synthetic EvidenceEntry before calling traceClaims —
 * this preserves guardSummary's original identity-grounding behavior
 * exactly, just routed through the shared, hardened tracer instead of a
 * second, drifting implementation.
 */
export function guardSummary(
  text: string,
  identity: Identity,
  registry: EvidenceEntry[],
): R19Result {
  const identityEntries: EvidenceEntry[] = identity.roles_timeline.map((r, i) => ({
    id: `EVD-IDENTITY-ROLE-${i}`,
    org: r.company,
    claim: `${r.title} at ${r.company}`,
    tag: "hard",
    keywords: [],
  }));

  const trace = traceClaims(text, [...registry, ...identityEntries]);

  return {
    grounded: trace.traceable.map((t) => t.sentence),
    ungrounded: trace.untraceable,
    ok: trace.ok,
  };
}
