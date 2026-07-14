<#
.SYNOPSIS
  Run a Selfwright inbox digest and push an ntfy notification with tier counts and item IDs.

.DESCRIPTION
  Designed to be invoked by a Windows Scheduled Task (see install-scheduled-tasks.ps1).
  Sets SELFWRIGHT_DATA_DIR, runs `selfwright inbox --notify [--archetype <id>]`,
  and appends stdout+stderr to <DataDir>/telemetry/scheduled-scan.log (same log
  as the scan task — one place to look for scheduled-task output).
  Rotates (truncates) the log when it exceeds 1 MB to bound disk usage.

.PARAMETER DataDir
  Absolute path to the Selfwright data directory (SELFWRIGHT_DATA_DIR). Required.

.PARAMETER ArchetypeId
  Optional archetype id. When supplied, coaching signals (gap coverage + next drill)
  are included in the digest. Omit to run the basic 3-tier pipeline-only digest.

.EXAMPLE
  ./scheduled-inbox.ps1 -DataDir "C:\Users\<you>\Selfwright-data"
  ./scheduled-inbox.ps1 -DataDir "C:\Users\<you>\Selfwright-data" -ArchetypeId "data-engineering"

.NOTES
  Requires: `node` on PATH; the CLI is resolved repo-relative (apps/cli/dist - run `pnpm build` once).
  NTFY_URL must be set as a user environment variable or passed in the calling
  environment for push notifications to work. The inbox command proceeds without it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDir,

  [string]$ArchetypeId = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DataDir)) {
  throw "DataDir does not exist: $DataDir"
}

$logDir = Join-Path $DataDir "telemetry"
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$logFile = Join-Path $logDir "scheduled-scan.log"

# Rotate (truncate) the log when it exceeds 1 MB.
if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 1MB) {
  Clear-Content -LiteralPath $logFile
  Add-Content -LiteralPath $logFile "[$(Get-Date -Format 'o')] Log truncated (exceeded 1 MB)"
}

$timestamp = Get-Date -Format "o"
Add-Content -LiteralPath $logFile "[$timestamp] scheduled-inbox starting"

$env:SELFWRIGHT_DATA_DIR = $DataDir

# Resolve the CLI from this script's own location (repo-relative, survives repo
# renames and works on any clone) — do NOT assume a global `selfwright` on PATH.
$cliPath = Join-Path $PSScriptRoot "..\..\apps\cli\dist\index.js" | Resolve-Path -ErrorAction SilentlyContinue
if (-not $cliPath) {
  Add-Content -LiteralPath $logFile "[$timestamp] scheduled-inbox error: CLI not built - run 'pnpm build' in the framework repo (expected apps/cli/dist/index.js)"
  throw "CLI not built (apps/cli/dist/index.js missing)"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Add-Content -LiteralPath $logFile "[$timestamp] scheduled-inbox error: node not found on PATH"
  throw "node not found on PATH"
}

try {
  if ($ArchetypeId -ne "") {
    $output = & node $cliPath.Path inbox --notify --archetype $ArchetypeId 2>&1
  } else {
    $output = & node $cliPath.Path inbox --notify 2>&1
  }
  foreach ($line in $output) {
    Add-Content -LiteralPath $logFile "[$timestamp] $line"
  }
  Add-Content -LiteralPath $logFile "[$timestamp] scheduled-inbox complete"
} catch {
  Add-Content -LiteralPath $logFile "[$timestamp] scheduled-inbox error: $_"
  throw
}
