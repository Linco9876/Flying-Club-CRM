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
  const projectStateScript = read('../../scripts/set-supabase-project-state.sh');
  assert.match(recovery, /gpg --batch --yes --dearmor/);
  assert.match(recovery, /SUPABASE_RECOVERY_PROJECT_REF: hohmmwvtisnuuoumipjq/);
  assert.match(recovery, /SUPABASE_PROJECT_REF: \$\{\{ secrets\.SUPABASE_AU_PROJECT_REF \}\}/);
  assert.match(recoveryScript, /\[IO\.Path\]::GetTempPath\(\)/);
  assert.doesNotMatch(recoveryScript, /Join-Path \$env:TEMP/);
  assert.doesNotMatch(
    recoveryScript,
    /did not contain the expected managed supabase_admin default ACL entries/,
  );
  assert.match(
    recoveryScript,
    /Excluded \$filteredDefaultAclCount managed supabase_admin default ACL entries/,
  );
  assert.match(projectStateScript, /status" == "PAUSING"|status: \$status/);
  assert.match(projectStateScript, /request_transition restore/);
  assert.match(projectStateScript, /request_transition pause/);
  assert.match(projectStateScript, /status_code" =~ \^2/);
  assert.match(projectStateScript, /project status was temporarily unavailable/);
  assert.match(projectStateScript, /transient transport failure/);

  const acceptance = read('../../.github/workflows/quality-gates.yml');
  const sharedRecoveryLock = /group: isolated-supabase-recovery-project/g;
  assert.equal(
    (recovery.match(sharedRecoveryLock) ?? []).length,
    1,
    'the restore job must hold the shared recovery-project lock',
  );
  assert.equal(
    (acceptance.match(sharedRecoveryLock) ?? []).length,
    1,
    'the physical-device job must hold the shared recovery-project lock',
  );
  assert.match(acceptance, /SUPABASE_PROJECT_REF: hohmmwvtisnuuoumipjq/);
  assert.match(
    acceptance,
    /SUPABASE_PROJECT_REF: \$\{\{ secrets\.SUPABASE_AU_PROJECT_REF \}\}/,
  );
  assert.match(acceptance, /Start the isolated recovery project when needed/);
  assert.match(acceptance, /Refresh isolated recovery data and validate source counts/);
  assert.match(acceptance, /run-isolated-recovery-drill\.ps1/);
  assert.match(
    acceptance,
    /functions deploy --project-ref hohmmwvtisnuuoumipjq/,
  );
  assert.match(
    acceptance,
    /always\(\) && env\.RECOVERY_STARTED_BY_ACCEPTANCE == 'true'/,
  );
  assert.match(
    acceptance,
    /set-supabase-project-state\.sh\s+\\\s+active "\$SUPABASE_RECOVERY_PROJECT_REF"/,
  );
  assert.match(
    acceptance,
    /set-supabase-project-state\.sh inactive "\$SUPABASE_RECOVERY_PROJECT_REF"/,
  );
  assert.match(
    recovery,
    /set-supabase-project-state\.sh\s+\\\s+active "\$SUPABASE_RECOVERY_PROJECT_REF"/,
  );
  assert.match(
    recovery,
    /set-supabase-project-state\.sh inactive "\$SUPABASE_RECOVERY_PROJECT_REF"/,
  );
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
