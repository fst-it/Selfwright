<#
.SYNOPSIS
  Registers (or removes) the two Selfwright scheduled push tasks:
  a weekly scan (Sunday 09:00) and a daily inbox digest (08:00).

.DESCRIPTION
  Mirrors the conventions of apps/web/scripts/install-windows-task.ps1 (ADR 0016).
  Both tasks run hidden in the current-user session, restart on failure, and set
  SELFWRIGHT_DATA_DIR via an encoded PowerShell command so no credential is stored.

  Tasks registered:
    SelfwrightScan         — weekly, Sunday 09:00; calls scheduled-scan.ps1
    SelfwrightInboxDigest  — daily, 08:00;          calls scheduled-inbox.ps1

  Push notifications are delivered via ntfy when NTFY_URL is set as a user
  environment variable (the task inherits the calling user's environment).

.PARAMETER DataDir
  Absolute path to the Selfwright data directory (SELFWRIGHT_DATA_DIR). Required
  unless -Uninstall is given.

.PARAMETER TargetsPath
  Path to scan-targets.yml fed to the scan task.
  Default: <repoRoot>/config/scan-targets.yml.

.PARAMETER ArchetypeId
  Optional archetype id forwarded to the inbox task (enables coaching signals).
  Omit to run the basic pipeline-only inbox digest.

.PARAMETER NoVerify
  Disable browser re-verification in the scan task (omits --verify from
  selfwright scan). By default, --verify is passed to re-check "uncertain"
  postings with a real Chromium browser (ADR 0012). Pass -NoVerify if Chromium
  is not installed on the task host, or to speed up the scan at the cost of
  leaving some postings unverified.

.PARAMETER ScanTaskName
  Scheduled task name for the weekly scan. Default: "SelfwrightScan".

.PARAMETER InboxTaskName
  Scheduled task name for the daily inbox digest. Default: "SelfwrightInboxDigest".

.PARAMETER Uninstall
  Remove both tasks instead of registering them. DataDir is not required.

.EXAMPLE
  # Install
  ./install-scheduled-tasks.ps1 -DataDir "C:\Users\<you>\Selfwright-data"

  # Install with coaching signals enabled
  ./install-scheduled-tasks.ps1 -DataDir "C:\Users\<you>\Selfwright-data" -ArchetypeId "data-engineering"
  # Install with browser re-verification disabled (faster, omits Playwright dependency):
  # ./install-scheduled-tasks.ps1 -DataDir "C:\Users\<you>\Selfwright-data" -NoVerify

  # Uninstall
  ./install-scheduled-tasks.ps1 -Uninstall

.NOTES
  Run once; re-run with the same arguments to update (-Force re-registers in place).
  Does NOT immediately start the tasks — they fire at their next scheduled time.
  To start a task now for testing: Start-ScheduledTask -TaskName SelfwrightScan
#>
[CmdletBinding()]
param(
  [string]$DataDir = "",

  [string]$TargetsPath = "",

  [string]$ArchetypeId = "",

  [switch]$NoVerify,

  [string]$ScanTaskName = "SelfwrightScan",

  [string]$InboxTaskName = "SelfwrightInboxDigest",

  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

# ── Uninstall path ────────────────────────────────────────────────────────────
if ($Uninstall) {
  foreach ($name in @($ScanTaskName, $InboxTaskName)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
      Write-Host "Removed scheduled task '$name'."
    } else {
      Write-Host "Task '$name' was not registered — nothing to remove."
    }
  }
  return
}

# ── Install path ──────────────────────────────────────────────────────────────
if ($DataDir -eq "") {
  throw "-DataDir is required when installing. Use -Uninstall to remove tasks."
}

if (-not (Test-Path -LiteralPath $DataDir)) {
  throw "DataDir does not exist: $DataDir"
}

# Resolve script paths relative to this installer (tools/scripts/).
$scriptsDir = $PSScriptRoot
$scanScript  = Join-Path $scriptsDir "scheduled-scan.ps1"
$inboxScript = Join-Path $scriptsDir "scheduled-inbox.ps1"

foreach ($script in @($scanScript, $inboxScript)) {
  if (-not (Test-Path -LiteralPath $script)) {
    throw "Required script not found: $script"
  }
}

# Default targets path: <repoRoot>/config/scan-targets.yml
if ($TargetsPath -eq "") {
  $repoRoot = Split-Path -Parent $scriptsDir  # tools/
  $repoRoot = Split-Path -Parent $repoRoot    # repo root
  $TargetsPath = Join-Path $repoRoot "config\scan-targets.yml"
}

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

# ── Read scan schedule + verify from settings.yml (T5.11) ─────────────────────
# Defaults match the LoadedSettings defaults in shared-config/src/settings-loader.ts.
$scheduleDay  = "Sunday"
$scheduleHour = 9
$settingsVerify = $false

$settingsYml = Join-Path $DataDir "settings.yml"
if (Test-Path -LiteralPath $settingsYml) {
  $raw = Get-Content -LiteralPath $settingsYml -Raw
  # NOTE: These regexes read the raw YAML text without a YAML parser. They
  # assume `day:` and `hour:` appear under a `scan: schedule:` block and that
  # no other block in the file contains keys with those same names. This is
  # intentional (avoids a PowerShell YAML parser dependency at install time)
  # but means a settings.yml with top-level `day:`/`hour:` keys — valid YAML
  # but not a valid SettingsSchema document — could produce the wrong trigger.
  # SettingsSchema uses .strict(), so such a document would already be rejected
  # at the settings API layer; this is belt-and-braces documentation only.
  if ($raw -match '(?m)^\s*day:\s*(\w+)') { $scheduleDay  = $Matches[1] }
  if ($raw -match '(?m)^\s*hour:\s*(\d+)') { $scheduleHour = [int]$Matches[1] }
  if ($raw -match '(?m)^\s*verify:\s*true') { $settingsVerify = $true }
}

# -NoVerify flag overrides settings.yml (explicit CLI opt-out always wins).
$effectiveVerify = if ($NoVerify) { $false } else { $settingsVerify }
$scheduleTime = "{0:D2}:{1:D2}" -f $scheduleHour, 0

# ── Scan task (weekly, per settings.yml schedule) ─────────────────────────────
$verifyArg = if ($effectiveVerify) { "" } else { " -Verify `$false" }
$scanInner = "`$env:SELFWRIGHT_DATA_DIR = '$DataDir'; " +
             "& '$scanScript' -DataDir '$DataDir' -TargetsPath '$TargetsPath'$verifyArg"
$scanEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($scanInner))

$scanAction = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand $scanEncoded"

$scanTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $scheduleDay -At $scheduleTime

Register-ScheduledTask -TaskName $ScanTaskName -Action $scanAction `
  -Trigger $scanTrigger -Settings $taskSettings -Principal $principal -Force | Out-Null

$verifyNote = if ($effectiveVerify) { " (with --verify)" } else { " (browser re-verification disabled)" }
Write-Host "Registered '$ScanTaskName' (weekly, $scheduleDay $scheduleTime)$verifyNote."

# ── Inbox task (daily, per settings.yml schedule hour) ───────────────────────
$archetypeArg = if ($ArchetypeId -ne "") { " -ArchetypeId '$ArchetypeId'" } else { "" }
$inboxInner = "`$env:SELFWRIGHT_DATA_DIR = '$DataDir'; " +
              "& '$inboxScript' -DataDir '$DataDir'$archetypeArg"
$inboxEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inboxInner))

$inboxAction = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand $inboxEncoded"

# Inbox fires one hour before the scan (or at 08:00 when scheduleHour < 1).
$inboxHour = [Math]::Max(0, $scheduleHour - 1)
$inboxTime = "{0:D2}:00" -f $inboxHour
$inboxTrigger = New-ScheduledTaskTrigger -Daily -At $inboxTime

Register-ScheduledTask -TaskName $InboxTaskName -Action $inboxAction `
  -Trigger $inboxTrigger -Settings $taskSettings -Principal $principal -Force | Out-Null

Write-Host "Registered '$InboxTaskName' (daily, $inboxTime)."
Write-Host ""
Write-Host "To run a task immediately for testing:"
Write-Host "  Start-ScheduledTask -TaskName $ScanTaskName"
Write-Host "  Start-ScheduledTask -TaskName $InboxTaskName"
Write-Host ""
Write-Host "To uninstall both tasks:"
Write-Host "  ./install-scheduled-tasks.ps1 -Uninstall"
