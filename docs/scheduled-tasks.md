# Scheduled tasks

Selfwright ships two Windows Scheduled Tasks that wire the push-first UX without requiring a daemon. They call the CLI directly, log to a shared file in your data repo, and push ntfy notifications when there is something actionable. Everything runs in the current user's session; no credentials are stored in the task definition.

## What gets pushed

**IDs only.** Both tasks use the `--notify` flag, which calls ntfy with a message containing only counts and item IDs — never claim text, company names, or role titles. This is the same rule used by the coaching commands (drill, gap-scan, topics).

| Task | Schedule | Push message (example) |
|---|---|---|
| `SelfwrightScan` | Sunday 09:00 | `3 new queue entries: SCAN-abc, SCAN-def, SCAN-ghi` |
| `SelfwrightInboxDigest` | Daily 08:00 | `inbox: 1 decide-now, 4 review-soon — DRIFT-001, 2026-01-acme-swe, SCAN-xyz` |

The scan notification fires only when the run adds new queue entries. The inbox notification fires only when there are decide-now or review-soon items. Both are advisory and silent if `NTFY_URL` is not set.

Application IDs (e.g. `2026-01-acme-swe`) can contain a company slug — that is intentional and consistent with the established IDs-only push convention (the slug is part of the identifier, not a separate claim).

## Install

Requires `selfwright` on your PATH and `NTFY_URL` set as a user environment variable.

```powershell
# Basic install (pipeline signals only)
.\tools\scripts\install-scheduled-tasks.ps1 -DataDir "C:\Users\<you>\Selfwright-data"

# With coaching signals in the inbox digest (recommended)
.\tools\scripts\install-scheduled-tasks.ps1 `
  -DataDir "C:\Users\<you>\Selfwright-data" `
  -ArchetypeId "data-engineering"
```

Re-running the installer with the same arguments updates both tasks in place (`-Force`).

## Uninstall

```powershell
.\tools\scripts\install-scheduled-tasks.ps1 -Uninstall
```

## Run a task immediately (testing)

```powershell
Start-ScheduledTask -TaskName SelfwrightScan
Start-ScheduledTask -TaskName SelfwrightInboxDigest
```

## Logs

Both tasks append to `<dataDir>/telemetry/scheduled-scan.log`. The log is truncated automatically when it exceeds 1 MB. To tail it:

```powershell
Get-Content "$env:SELFWRIGHT_DATA_DIR\telemetry\scheduled-scan.log" -Tail 40
```

## Configuration

The installer accepts optional overrides:

| Parameter | Default | Purpose |
|---|---|---|
| `-DataDir` | *(required)* | SELFWRIGHT_DATA_DIR for both tasks |
| `-TargetsPath` | `<repoRoot>/config/scan-targets.yml` | Scan targets file |
| `-ArchetypeId` | *(none)* | Enable coaching signals in inbox digest |
| `-NoVerify` | *(off)* | Disable browser re-verification in the scan task (omits `--verify`); by default `--verify` is passed so uncertain postings are re-checked with Chromium (ADR 0012). Pass `-NoVerify` if Chromium is not installed on the task host. |
| `-ScanTaskName` | `SelfwrightScan` | Task name (avoid collision if running multiple instances) |
| `-InboxTaskName` | `SelfwrightInboxDigest` | Task name |

## Privacy

ntfy pushes are IDs-only. No claim text, no job descriptions, no interviewer names, no salary figures leave the machine through this path. The ntfy topic URL itself (`NTFY_URL`) is never logged or committed.
