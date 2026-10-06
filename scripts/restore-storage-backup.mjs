import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Read-only recovery drill: restores to a NEW local folder, never production.
const endpoint = process.env.STORAGE_BACKUP_URL || 'https://bfc-storage-backup.cot000055.workers.dev';
const token = process.env.STORAGE_BACKUP_OPERATOR_TOKEN;
if (!token) throw new Error('STORAGE_BACKUP_OPERATOR_TOKEN is required');
const output = process.argv[2];
if (!output) throw new Error('Supply a new local recovery directory');
const root = resolve(output);
await mkdir(root, { recursive: false });
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const statusResponse = await fetch(`${endpoint}/status`, { headers });
const status = await statusResponse.json();
if (!status.snapshotKey) throw new Error('No completed backup snapshot');
const snapshot = status.snapshotKey;
const response = await fetch(`${endpoint}/manifest?snapshot=${encodeURIComponent(snapshot)}`, { headers });
if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
const manifest = await response.json();
let bytes = 0;
for (const file of manifest.files) {
  // Hash-named local files avoid trusting source paths, Windows reserved names,
  // and symlink/path traversal. The manifest preserves original bucket/path.
  const target = resolve(root, file.sha256);
  if (!target.startsWith(root + sep) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid checksum');
  const result = await fetch(`${endpoint}/file`, { method: 'POST', headers, body: JSON.stringify({ snapshot, bucket: file.bucket, path: file.path }) });
  if (!result.ok) throw new Error(`Recovery download failed (${result.status})`);
  const buffer = Buffer.from(await result.arrayBuffer());
  if (buffer.length !== file.size || createHash('sha256').update(buffer).digest('hex') !== file.sha256) throw new Error('Restored file failed checksum verification');
  await writeFile(target, buffer);
  bytes += buffer.length;
}
await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ restoredFiles: manifest.files.length, verifiedBytes: bytes, missingSourceFiles: manifest.missing?.length || 0, snapshot }));
