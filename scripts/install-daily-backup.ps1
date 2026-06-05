param(
  [string]$TaskName = "Bendigo Flying Club CRM Daily Backup",
  [string]$Time = "02:00"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ScriptPath = Join-Path $RepoRoot "scripts\backup-crm.mjs"
$EnvPath = Join-Path $RepoRoot "scripts\backup-crm.env"
$LogDir = Join-Path $RepoRoot "tmp\backup-logs"
$Node = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $EnvPath)) {
  throw "Missing $EnvPath. Copy scripts\backup-crm.env.example to scripts\backup-crm.env and add the Supabase service role key first."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Action = New-ScheduledTaskAction `
  -Execute $Node `
  -Argument "`"$ScriptPath`" --env=`"$EnvPath`" > `"$LogDir\daily-backup.log`" 2>&1" `
  -WorkingDirectory $RepoRoot

$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Daily Supabase CRM backup to OneDrive for Bendigo Flying Club Portal" `
  -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName' for $Time daily."
Write-Host "Run it now with: Start-ScheduledTask -TaskName '$TaskName'"
