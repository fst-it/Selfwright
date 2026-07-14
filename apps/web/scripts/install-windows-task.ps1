<#
.SYNOPSIS
  Registers the Selfwright web dashboard as a Windows Scheduled Task that starts
  at user logon and restarts on failure. Reproducible, parameterized alternative
  to hand-clicking through Task Scheduler (ADR 0016).

.DESCRIPTION
  The dashboard binds 127.0.0.1:8787 only; remote access is via Tailscale Serve
  (see apps/web/README.md). This task keeps the loopback server running so the
  tunnel always has a backend. It runs in the current user's session (needed for
  loopback + the user's SELFWRIGHT_DATA_DIR), hidden, with no stored credentials.

.PARAMETER DataDir
  Absolute path to the Selfwright data directory (SELFWRIGHT_DATA_DIR). Required.

.PARAMETER Port
  Port to bind on 127.0.0.1. Default 8787.

.PARAMETER TaskName
  Scheduled task name. Default "SelfwrightDashboard".

.EXAMPLE
  ./install-windows-task.ps1 -DataDir "C:\Users\<you>\Selfwright-data"

.NOTES
  Requires: node on PATH, and `pnpm --filter @selfwright/web build` already run
  (the task launches the built dist/server.js). Uninstall:
    Unregister-ScheduledTask -TaskName SelfwrightDashboard -Confirm:$false
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDir,

  [int]$Port = 8787,

  [string]$TaskName = "SelfwrightDashboard"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DataDir)) {
  throw "DataDir does not exist: $DataDir"
}

# Resolve the built server relative to this script (apps/web/scripts/ -> apps/web).
$appDir = Split-Path -Parent $PSScriptRoot
$serverJs = Join-Path $appDir "dist\server.js"
if (-not (Test-Path -LiteralPath $serverJs)) {
  throw "Built server not found at $serverJs. Run: pnpm --filter @selfwright/web build"
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  throw "node not found on PATH. Install Node >= 22 and retry."
}

# The action sets the required env vars in-process, then launches the server
# hidden. Env is set here (not stored in the task) so no secret/PII is persisted.
$inner = "`$env:SELFWRIGHT_DATA_DIR = '$DataDir'; `$env:SELFWRIGHT_WEB_PORT = '$Port'; " +
         "Set-Location -LiteralPath '$appDir'; & '$node' 'dist\server.js'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $encoded"

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName' (starts at logon on 127.0.0.1:$Port)."
Write-Host "Start it now without logging out:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Remove it:  Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
