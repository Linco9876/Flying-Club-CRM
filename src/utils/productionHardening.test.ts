import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);
const workflows = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, source: read(`../../.github/workflows/${name}`) }));

test('production workflows use the explicit Australian Supabase secrets', () => {
  const obsoleteSecretReferences = [
    'secrets.SUPABASE_URL',
    'secrets.SUPABASE_SERVICE_ROLE_KEY',
    'secrets.SUPABASE_DB_URL',
    'secrets.SUPABASE_PROJECT_REF',
    'secrets.SUPABASE_ANON_KEY',
  ];

  workflows.forEach(({ name, source }) => {
    obsoleteSecretReferences.forEach((reference) => {
      assert.equal(
        source.includes(reference),
        false,
        `${name} must not use the ambiguous ${reference}`,
      );
    });
  });

  const deployment = read('../../.github/workflows/deploy-production.yml');
  assert.match(deployment, /secrets\.SUPABASE_AU_PROJECT_REF/);
  assert.match(deployment, /secrets\.SUPABASE_AU_DB_URL/);
  assert.match(deployment, /secrets\.SUPABASE_AU_URL/);
  assert.match(deployment, /secrets\.SUPABASE_AU_ANON_KEY/);

  const backup = read('../../.github/workflows/daily-crm-backup.yml');
  assert.match(backup, /secrets\.SUPABASE_AU_URL/);
  assert.match(backup, /secrets\.SUPABASE_AU_SERVICE_ROLE_KEY/);
});

test('recovery automation is non-interactive and cannot select production as its target', () => {
  const recovery = read('../../.github/workflows/monthly-backup-restore-drill.yml');
  const recoveryScript = read('../../scripts/run-isolated-recovery-drill.ps1');
  assert.match(recovery, /gpg --batch --yes --dearmor/);
  assert.match(recovery, /SUPABASE_RECOVERY_PROJECT_REF: hohmmwvtisnuuoumipjq/);
  assert.match(recovery, /SUPABASE_PROJECT_REF: \$\{\{ secrets\.SUPABASE_AU_PROJECT_REF \}\}/);
  assert.match(recoveryScript, /\[IO\.Path\]::GetTempPath\(\)/);
  assert.doesNotMatch(recoveryScript, /Join-Path \$env:TEMP/);

  const acceptance = read('../../.github/workflows/quality-gates.yml');
  assert.match(acceptance, /SUPABASE_PROJECT_REF: hohmmwvtisnuuoumipjq/);
});

test('Xero errors retain diagnostic references without exposing upstream messages', () => {
  const xeroSync = read('../../supabase/functions/xero-sync/index.ts');
  const catchBlock = xeroSync.slice(xeroSync.lastIndexOf('} catch (error) {'));
  assert.match(catchBlock, /const errorReference = crypto\.randomUUID\(\)/);
  assert.match(catchBlock, /console\.error\("xero-sync error:", \{ errorReference, error \}\)/);
  assert.doesNotMatch(catchBlock, /getErrorMessage\(error/);
});

test('every Duty Clock top-level state exposes a main landmark on the web', () => {
  const app = read('../../apps/duty-clock/App.tsx');
  const login = read('../../apps/duty-clock/src/components/LoginScreen.tsx');
  const duty = read('../../apps/duty-clock/src/components/DutyScreen.tsx');

  assert.match(app, /<View role="main" style=\{styles\.loading\}>/);
  assert.match(login, /<SafeAreaView role="main" style=\{styles\.safe\}>/);
  assert.equal((duty.match(/<SafeAreaView role="main"/g) ?? []).length, 3);
});
