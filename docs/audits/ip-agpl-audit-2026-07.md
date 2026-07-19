# IP / AGPL audit — 2026-07

**Date:** 2026-07-11
**Scope:** Selfwright framework repository (C:/dev/Selfwright)
**Method:** read-only sweep — no re-research needed; results transcribed from the sweep
**Commands run:**

```
pnpm licenses list
pnpm audit
```

---

## Production dependency licenses

Approximately 190 production dependencies, verified via `pnpm licenses list`.

**License distribution (all permissive):**
- MIT — majority (~160 packages)
- Apache-2.0 — several packages (e.g. mem0-service, various node ecosystem packages)
- ISC — several packages (e.g. litellm, semver, rimraf, glob)
- Unlicense — a handful of packages
- BSD-2-Clause / BSD-3-Clause — a small number

**Zero AGPL, GPL, LGPL, SSPL, or BUSL packages** in the framework production dependency tree.
**Zero packages with missing or unknown licenses.**

**Precision note (2026-07-13):** `jszip@3.10.1` is dual-licensed `(MIT OR GPL-3.0-or-later)`.
This is not a GPL obligation: the consumer chooses the MIT option, which is fully compatible with
Apache-2.0 distribution. Selfwright uses jszip under the MIT option.

---

## pnpm audit

`pnpm audit` result: **0 advisories across 412 total dependencies (118 production).**
No known vulnerabilities in the scanned set.

---

## Infra services — arm's-length assessment

These services run as Docker containers and are accessed by the framework over HTTP/TCP only.
No service is linked into the framework's package dependency tree.

| Service | License | Access pattern | Notes |
|---------|---------|----------------|-------|
| PostgreSQL | PostgreSQL License (permissive, BSD-style) | TCP (postgres driver) | Own DB; no framework code links the postgres binaries |
| Ollama | MIT | HTTP (localhost) | Optional, eval-gated; no Ollama SDK imported in framework packages |
| LiteLLM | ISC | HTTP (localhost proxy) | Optional, retained as OSS seam; no direct import in default path (ADR 0006) |
| Metabase | AGPL v3 | localhost:3000 GUI only — zero SDK/API imports from any package under packages/ or apps/ | Own metabase app-db; removable if D18 picks Evidence; AGPL exposure is fully contained at the HTTP boundary |
| Evidence.dev | MIT | Containerized node:22; HTTP at localhost:3001 | Build-time SQL → static site; no runtime API link |
| mem0-service | Apache-2.0 | HTTP only (`SELFWRIGHT_MEMORY_URL`); `@selfwright/adapter-memory-mem0` wraps the HTTP REST API — no mem0 Python SDK in the TypeScript tree | Self-hosted; optional per ADR 0010 |

**Metabase AGPL risk assessment (anchor §8):** Metabase is licensed AGPL v3. Selfwright accesses it exclusively via a web browser against localhost:3000 — no Metabase library is imported, linked, or bundled into any package or app in this repository. The AGPL "user over network" clause is not triggered by this access pattern. The service runs with its own application database and is described in the plan as a candidate to be replaced by Evidence.dev (D18); it is fully removable without any framework change.

---

## Deliberate version pins (dependency cadence note)

Three packages are intentionally pinned below the latest available major, documented here
for the quarterly refresh cadence (item 2, next review 2026-10):

| Package | Pinned | Latest at audit | Reason for hold |
|---------|--------|----------------|-----------------|
| zod | 3.x | 4.x available | v4 introduces breaking API changes (`.parse` behavior, schema types); migration deferred — explicit decision |
| TypeScript | 5.x | 7.x exists | 7.x is early-access / Go-based rewrite; staying on the stable 5.x line |
| vitest | 3.x | 4.x exists | Minor ecosystem lag; no blocking features in 4.x needed at this time |

---

## Verdict

**Open-core ready. No IP or license blockers.**

- Both OSS publication and commercial (company) paths remain open.
- The AGPL exposure from Metabase is fully arm's-length (HTTP-only, own DB, removable).
- All production dependencies are permissive (MIT/Apache-2.0/ISC/Unlicense/BSD).
- Zero security advisories.
- Refresh cadence: quarterly pnpm audit + license re-sweep, owned by the internal quarterly
  architectural-fitness review.
