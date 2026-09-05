import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const studentFormSource = readSource('../components/Students/StudentForm.tsx');
const pilotFileSource = readSource('../components/Students/StudentProfilePage.tsx');
const accountSettingsSource = readSource('../components/Settings/PersonalPreferencesSettings.tsx');
const signupSource = readSource('../components/Auth/SignUpForm.tsx');
const migrationSource = readSource('../../supabase/migrations/20260905150000_make_endorsement_issue_date_optional.sql');

test('endorsement issue date is optional in every profile entry path', () => {
  for (const source of [studentFormSource, pilotFileSource, accountSettingsSource, signupSource]) {
    assert.match(source, /Issue date \(optional\)/);
  }

  assert.doesNotMatch(studentFormSource, /Please select a date for the endorsement/);
  assert.doesNotMatch(pilotFileSource, /Select the endorsement obtained date/);
  assert.doesNotMatch(accountSettingsSource, /Endorsement date is required/);
  assert.doesNotMatch(signupSource, /Select the endorsement obtained date/);
});

test('missing endorsement issue dates are stored as null and supported by the schema', () => {
  assert.match(pilotFileSource, /date_obtained:\s*toDateInputValue\(endorsement\.dateObtained\) \|\| null/);
  assert.match(accountSettingsSource, /date_obtained:\s*endorsement\.dateObtained \|\| null/);
  assert.match(signupSource, /date_obtained:\s*endorsement\.dateObtained \|\| null/);
  assert.match(migrationSource, /ALTER COLUMN date_obtained DROP NOT NULL/i);
});
