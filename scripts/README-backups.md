# CRM backups

## Managed database backups

The production project `kcfjnpngnouyvcuvfleu` is on Supabase Pro. Supabase automatically takes daily database backups with seven days of retention.

View recovery points at https://supabase.com/dashboard/project/kcfjnpngnouyvcuvfleu/database/backups/scheduled . Individual recovery points must be checked there; plan verification alone is not a restore test.

Database backups do not include uploaded Storage files such as PDFs, exam evidence or images. A replacement automated file-backup destination has not been configured.

## Retired OneDrive automation

On 6 October 2026 the OneDrive daily backup and dependent monthly restore workflows were retired at the owner's request. The Windows daily backup task was removed and the GitHub RCLONE_CONFIG, RCLONE_REMOTE and ONEDRIVE_BACKUP_PATH secrets were deleted.

Existing backup archives and BACKUP_AGE_PRIVATE_KEY / BACKUP_AGE_PUBLIC_KEY are retained for recovery. Do not delete the decryption identity while encrypted archives are retained.

## Manual recovery tools

The generic backup-crm.mjs, verify-crm-backup.mjs and isolated recovery scripts remain available for deliberate manual recovery work. They are not a scheduled replacement for the retired file backup. A manual export downloads data from Supabase and consumes egress.

For an existing encrypted archive, verify its external checksum, decrypt with the retained age identity, then verify its manifest using verify-crm-backup.mjs. Test recovery in an isolated project before any production restore.
