import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const migrationsDir = resolve(root, 'supabase', 'migrations');
const jsonOutput = process.argv.includes('--json');

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, '');

let output;
try {
  const supabaseCommand = process.platform === 'win32' ? 'supabase.cmd' : 'supabase';
  output = execFileSync(supabaseCommand, ['migration', 'list', '--linked'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    shell: process.platform === 'win32',
  });
} catch (error) {
  const detail = stripAnsi(String(error.stderr || error.message || error)).trim();
  console.error(`Unable to read linked Supabase migration history.\n${detail}`);
  process.exit(2);
}

const rows = stripAnsi(output)
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*(\d{14})?\s*\|\s*(\d{14})?\s*\|/))
  .filter(Boolean)
  .map((match) => ({ local: match[1] || null, remote: match[2] || null }));

if (rows.length === 0) {
  console.error('Supabase returned no migration rows. Check that this workspace is linked to the intended project.');
  process.exit(2);
}

const localOnly = rows.filter((row) => row.local && !row.remote).map((row) => row.local);
const remoteOnly = rows.filter((row) => !row.local && row.remote).map((row) => row.remote);
const matched = rows.filter((row) => row.local && row.remote && row.local === row.remote).length;

const localVersions = readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .map((name) => name.slice(0, 14));
const duplicateLocalVersions = [...new Set(
  localVersions.filter((version, index) => localVersions.indexOf(version) !== index),
)].sort();

const result = {
  status: localOnly.length === 0 && remoteOnly.length === 0 && duplicateLocalVersions.length === 0
    ? 'aligned'
    : 'mismatch',
  matched,
  localOnly,
  remoteOnly,
  duplicateLocalVersions,
};

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Supabase migration history: ${result.status.toUpperCase()}`);
  console.log(`Matched migrations: ${matched}`);
  console.log(`Local only: ${localOnly.length}`);
  console.log(`Remote only: ${remoteOnly.length}`);
  console.log(`Duplicate local versions: ${duplicateLocalVersions.length}`);

  if (localOnly.length > 0) {
    console.log(`\nLocal-only versions:\n  ${localOnly.join('\n  ')}`);
  }
  if (remoteOnly.length > 0) {
    console.log(`\nRemote-only versions:\n  ${remoteOnly.join('\n  ')}`);
  }
  if (duplicateLocalVersions.length > 0) {
    console.log(`\nDuplicate local versions:\n  ${duplicateLocalVersions.join('\n  ')}`);
  }
}

if (result.status !== 'aligned') {
  console.error('\nMigration history is not safe to push. Review the report before using migration repair or db push.');
  process.exit(1);
}
