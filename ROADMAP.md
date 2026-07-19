# ROADMAP.md — Selfwright Near-Term Direction

> Grounded in the project's architectural records (`docs/adr/`). No internal codenames. No
> personal specifics.

---

## Where the project stands

v0.6.0 is the open-core release. The career engine (goal 1) is complete:

- Deterministic scoring engine with 7-dimension JD fit and ATS pass A/B check
- Evidence-grounded CV tailoring with governed drift application (ADR 0005)
- Co-piloted cover-letter and research generation with truth-trace validation (ADR 0006)
- Deterministic scanner: 19 providers spanning ATS boards, aggregators, and a Playwright browser provider (ADR 0007)
- Local web cockpit: React SPA over a typed /api/* contract, behind Tailscale + session auth
  (ADRs 0016, 0023)
- Queue triage: promote queue entry to application, or dismiss, from the cockpit (ADR 0024)
- 33 fitness checks (28 in CI, 5 local-only) enforcing truth integrity, data-leak prevention, architecture boundaries,
  web security, and generation quality
- Apache-2.0 license, fresh-history extraction, data repo private (ADR 0021)

The coaching module (goal 2) is substantially complete: prep packs, drill selection with
freshness decay, debrief capture, gap analysis with debrief-derived hints.

---

## Near-term (next to ship)

These are grounded in the existing phase plan and open ADR items. Order reflects dependency, not
priority ranking.

### Community and onboarding

- Complete the `examples/data-template/` starter directory so a new user can run the full fitness
  suite and generate a first cover letter with synthetic data.
- Validate the "use this template" path with an external tester (ADR 0021 extraction test).
- Publish documentation at a stable URL.

### Scanner hardening

- Remaining Playwright-based liveness verification for bot-gated boards (ADR 0012, Phase 3
  deferral now resolved — the dependency is in place with the `scan-browser` adapter).
- The Adzuna provider query strategy: split `what_or` for roles with variant titles; pagination
  beyond the current cap.

### Coaching completeness

- Content / Top-Voice engine: ranked article topics per archetype, weekly digest with cited
  sources, per-application topic candidates (ADR 0014).
- Learning gap tracking integration: debrief hints auto-populate `gaps.yml` with timestamps and
  round references, not just gap names.

### Projection and memory

- The Postgres + pgvector sync-db ETL (`packages/adapters/storage-postgres`) is in place.
  Near-term: a scheduled sync task and an evidence-retrieval endpoint that lets the scoring
  engine find relevant EVD-* entries by vector similarity rather than keyword overlap.
- mem0 episodic memory (ADR 0010): document the activation path for new users and add a
  memory-quality eval to the eval harness.

---

## Medium-term

These are design-phase items without committed ADRs yet. Shipping them requires a new ADR first.

### Co-pilot quality improvements

The current validation suite checks truth-trace, honesty wall, and AI-tell hygiene. A natural
next layer is a rubric-based quality eval: given the JD, the archetype, and the generated text,
does an LLM judge score it ≥ 4.0 / 5.0 on fit and authenticity? The Phase 2 closeout confirmed
this is achievable (two real roles scored 4.6 and 4.7) but the eval is not yet an automated gate.

### Content engine

Goal 3 of the anchor: article topic proposals ranked by evidence strength and audience relevance,
with read-topic suggestions and supporting actions per archetype. The content module exists in the
core; the generation and validation layer needs the same prompt + `--check` treatment the career
engine has.

### Multi-provider portability

The `LlmPort` interface and `LiteLlmAdapter` provide the seam. A swap-test fitness function
(FF-SWAP-1, planned) would prove the suite passes identically against a second provider. This is
the OSS value proposition for users who prefer OpenAI, Gemini, or a local Ollama endpoint.

---

## Longer term (phase plan §10, ADR 0021)

These items are reserved for when the core platform has real adoption outside its author:

- **Neo4j graph projection.** Relationship and lineage queries at second-brain scale (ADR 0009,
  deferred). Enters when GraphRAG or a people/CRM use case makes the graph structure worth its
  operational weight.
- **Second-brain expansion.** The anchor's four goals beyond the career engine: coaching (in
  progress), content, expertise. A learning-roadmap tracker and a CRM for professional contacts
  are the natural next surfaces.
- **Hosted tier decision.** The framework/data boundary (ADR 0017) is the load-bearing line for
  any future SaaS path. The decision is deliberately deferred to when adoption data exists.

---

## What does not change

The truth floor, the data-leak boundary, the local-first posture, and human-submits are permanent.
See `CONSTITUTION.md`. No roadmap item can weaken these.
