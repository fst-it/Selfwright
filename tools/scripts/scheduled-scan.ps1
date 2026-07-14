<#
.SYNOPSIS
  Run a Selfwright scan pass and push an ntfy notification for new queue entries.

.DESCRIPTION
  Designed to be invoked by a Windows Scheduled Task (see install-scheduled-tasks.ps1).
  Sets SELFWRIGHT_DATA_DIR, runs `selfwright scan --targets <TargetsPath> [--verify] --notify`,
  and appends stdout+stderr to <DataDir>/telemetry/scheduled-scan.log.
  Rotates (truncates) the log when it exceeds 1 MB to bound disk usage.

.PARAMETER DataDir
  Absolute path to the Selfwright data directory (SELFWRIGHT_DATA_DIR). Required.

.PARAMETER TargetsPath
  Path to scan-targets.yml. Default: <repoRoot>/config/scan-targets.yml where
  <repoRoot> is two levels above this script (tools/scripts/ -> repo root).

.PARAMETER Verify
  Pass --verify to selfwright scan to re-check "uncertain" postings with a real
  Chromium browser (ADR 0012). Default: $true. Requires Chromium installed via
  `npx playwright install chromium` (or setup.mjs --with-playwright). Set to $false
  to disable (e.g. if Chromium is not installed on the task host).

.EXAMPLE
  ./scheduled-scan.ps1 -DataDir "C:\Users\<you>\Selfwright-data"
  ./scheduled-scan.ps1 -DataDir "C:\Users\<you>\Selfwright-data" -Verify:$false

.NOTES
  Requires: `node` on PATH; the CLI is resolved repo-relative (apps/cli/dist - run `pnpm build` once).
  NTFY_URL must be set as a user environment variable or passed in the calling
  environment for push notifications to work. The scan proceeds even without it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDir,

  [string]$TargetsPath = "",

  [bool]$Verify = $true
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DataDir)) {
  throw "DataDir does not exist: $DataDir"
}

# Default targets path: <repoRoot>/config/scan-targets.yml
if ($TargetsPath -eq "") {
  $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $TargetsPath = Join-Path $repoRoot "config\scan-targets.yml"
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
Add-Content -LiteralPath $logFile "[$timestamp] scheduled-scan starting (Verify=$Verify)"

$env:SELFWRIGHT_DATA_DIR = $DataDir

# Resolve the CLI from this script's own location (repo-relative, survives repo
# renames and works on any clone) — do NOT assume a global `selfwright` on PATH.
$cliPath = Join-Path $PSScriptRoot "..\..\apps\cli\dist\index.js" | Resolve-Path -ErrorAction SilentlyContinue
if (-not $cliPath) {
  Add-Content -LiteralPath $logFile "[$timestamp] scheduled-scan error: CLI not built - run 'pnpm build' in the framework repo (expected apps/cli/dist/index.js)"
  throw "CLI not built (apps/cli/dist/index.js missing)"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Add-Content -LiteralPath $logFile "[$timestamp] scheduled-scan error: node not found on PATH"
  throw "node not found on PATH"
}

# Build the argument list: --verify is on by default and can be disabled via -Verify:$false.
$scanArgs = @($cliPath.Path, "scan", "--targets", $TargetsPath, "--notify")
if ($Verify) { $scanArgs += "--verify" }

try {
  $output = & node @scanArgs 2>&1
  foreach ($line in $output) {
    Add-Content -LiteralPath $logFile "[$timestamp] $line"
  }
  Add-Content -LiteralPath $logFile "[$timestamp] scheduled-scan complete"
} catch {
  Add-Content -LiteralPath $logFile "[$timestamp] scheduled-scan error: $_"
  throw
}
