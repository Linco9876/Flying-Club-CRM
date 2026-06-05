# CRM Backups

This folder contains backup jobs for the Bendigo Flying Club CRM.

The local Windows job writes daily backups to OneDrive when the club computer is on. The GitHub Actions job can run in the cloud even when the computer is off, then upload the same backup into OneDrive.

## What it backs up

- Public CRM tables as JSON files.
- Supabase Auth user records, excluding passwords because Supabase does not expose passwords.
- Storage bucket files such as student documents, aircraft documents, safety documents, defect attachments, logos, avatars, and exam uploads.
- A `manifest.json` with row counts, file counts, warnings, and prune details.

## Local Windows Setup

1. Copy `scripts/backup-crm.env.example` to `scripts/backup-crm.env`.
2. Add the Supabase `service_role` key in `SUPABASE_SERVICE_ROLE_KEY`.
3. Confirm `BACKUP_ROOT` points to the club OneDrive folder.
4. Install the Windows scheduled task:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-daily-backup.ps1
```

5. Test it once:

```powershell
node .\scripts\backup-crm.mjs --env=.\scripts\backup-crm.env
```

## Restore Notes

These backups are designed for recovery and audit. Table files can be imported back into Supabase, and Storage files can be re-uploaded to their original buckets. For a full disaster recovery restore, restore tables in dependency order and then re-upload Storage contents.

Keep at least one tested restore process outside the live project.

## Cloud Setup

The cloud backup is defined in `.github/workflows/daily-crm-backup.yml`. It runs daily and can also be run manually from GitHub Actions.

Add these GitHub repository secrets:

- `SUPABASE_URL`: `https://joarmzswpufrduectjse.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service role or secret key.
- `RCLONE_CONFIG`: the full contents of a working `rclone.conf` that contains a OneDrive remote.
- `RCLONE_REMOTE`: the OneDrive remote name from `rclone.conf`, for example `onedrive`.
- `ONEDRIVE_BACKUP_PATH`: the destination folder, for example `CRM Backups/Bendigo Flying Club Portal`.
- `ALERT_WEBHOOK_URL`: optional webhook URL for failed backup/deploy alerts.
- `ALERT_WEBHOOK_TYPE`: optional webhook payload type: `generic`, `slack`, `discord`, or `teams`.

The `.github/workflows/actions-failure-monitor.yml` workflow watches the daily backup and GitHub Pages deploy workflows. If either workflow finishes with a failed, cancelled, or timed-out conclusion, it sends an alert to `ALERT_WEBHOOK_URL`.

To create the OneDrive `rclone.conf` locally:

```powershell
rclone config
```

Create a Microsoft OneDrive remote, test it with:

```powershell
rclone lsd onedrive:
```

Then open the config file:

```powershell
notepad "$env:APPDATA\rclone\rclone.conf"
```

Copy the full contents into the GitHub secret named `RCLONE_CONFIG`.

## Backup Failure Alerts

Cloud backup and deploy alerts are sent by GitHub Actions when `ALERT_WEBHOOK_URL` is configured as a repository secret.

GitHub Actions also creates an unread in-app `system` notification for every admin user when a watched workflow fails, is cancelled, or times out. The notification uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from GitHub repository secrets.

Local Windows backup alerts use the same setting in `scripts/backup-crm.env`:

```text
ALERT_WEBHOOK_URL=https://example.com/webhook
ALERT_WEBHOOK_TYPE=generic
```

The local backup wrapper also creates an unread in-app `system` notification for every admin user when the backup fails or completes with warnings.

If no webhook is configured, failed jobs still appear in GitHub Actions, the Windows scheduled task log, and the admin notification bell, but no external alert is sent.
