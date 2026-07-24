import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const backupDir = path.resolve(process.argv[2] || '');
if (!process.argv[2]) {
  throw new Error('Usage: node scripts/verify-crm-backup.mjs <decrypted-backup-directory>');
}

const manifestPath = path.join(backupDir, 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const expectedFiles = manifest.integrity?.files;

if (!Array.isArray(expectedFiles) || expectedFiles.length === 0) {
  throw new Error('Backup has no integrity manifest.');
}
if (manifest.warnings?.length) {
  throw new Error(`Backup manifest reports ${manifest.warnings.length} warning(s).`);
}

for (const expected of expectedFiles) {
  const filePath = path.resolve(backupDir, expected.path);
  if (!filePath.startsWith(`${backupDir}${path.sep}`)) {
    throw new Error(`Unsafe path in manifest: ${expected.path}`);
  }
  const content = await fs.readFile(filePath);
  const actualHash = crypto.createHash('sha256').update(content).digest('hex');
  if (actualHash !== expected.sha256 || content.byteLength !== expected.bytes) {
    throw new Error(`Integrity check failed for ${expected.path}`);
  }
}

if ((manifest.summary?.tableCount || 0) < 1 || !manifest.auth) {
  throw new Error('Backup is missing database tables or Auth users.');
}

console.log(
  `Verified ${expectedFiles.length} files, ${manifest.summary.tableCount} tables, `
  + `${manifest.summary.totalRows} rows and ${manifest.summary.storageObjects} storage objects.`
);
