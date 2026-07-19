# Versioning

For the rationale, bump rules, and SCHEMA-VERSION coupling see
[ADR 0018](adr/0018-versioning-release-discipline.md). This file covers only the operational
mechanics: how and when to bump.

## How to bump

1. Determine bump type per ADR 0018 §2 (`feat:` → minor, `fix:` → patch, `feat!:` → major).

2. Update `"version"` in the root `package.json`.

3. Add an entry to `CHANGELOG.md` under `## [X.Y.Z] — Unreleased`. Group by `Added`, `Fixed`,
   `Changed`, etc. Reference the ADR number if one governs the change.

4. Commit those two file changes inside the same PR as the change itself.

5. After merge: apply the git tag `vX.Y.Z` to the merge commit on `main` and push it.
   **Do not create or push tags yourself.**

## Changelog entry format

```
## [X.Y.Z] — Unreleased

### Added
- Brief description of new capability (ADR NNNN if applicable; commit SHA if helpful).

### Fixed
- Brief description of bug fix (commit SHA).
```

On release, replace `Unreleased` with the date in `YYYY-MM-DD` format.

## SCHEMA-VERSION

See ADR 0018 §5 for the full coupling contract. Before running a new framework version, confirm
the expected schema version matches `SCHEMA-VERSION` in Selfwright-data. A mismatch must be
resolved by running the migration; there is no silent fallback.
