param(
  [string]$EnvPath = (Join-Path $PSScriptRoot "backup-crm.env")
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackupScript = Join-Path $RepoRoot "scripts\backup-crm.mjs"
$AlertScript = Join-Path $RepoRoot "scripts\send-alert.mjs"
$AdminNotificationScript = Join-Path $RepoRoot "scripts\create-admin-notification.mjs"

try {
  node $BackupScript --env="$EnvPath"
  $ExitCode = $LASTEXITCODE

  if ($ExitCode -eq 0) {
    exit 0
  }

  $env:ALERT_TITLE = "Bendigo Flying Club CRM backup failed"
  $env:ALERT_SUMMARY = "The local Windows daily backup failed. Check the scheduled task log on the club computer."
  $env:ALERT_STATUS = "failure"
  $env:ALERT_WORKFLOW = "Local Windows daily backup"
  node $AdminNotificationScript --env="$EnvPath"
  node $AlertScript --env="$EnvPath"
  exit $ExitCode
} catch {
  $env:ALERT_TITLE = "Bendigo Flying Club CRM backup failed"
  $env:ALERT_SUMMARY = "The local Windows daily backup failed before the backup command completed. Check the scheduled task log on the club computer."
  $env:ALERT_STATUS = "failure"
  $env:ALERT_WORKFLOW = "Local Windows daily backup"
  node $AdminNotificationScript --env="$EnvPath"
  node $AlertScript --env="$EnvPath"
  throw
}
