import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const memberListSource = readFileSync(
  new URL('../components/Students/StudentList.tsx', import.meta.url),
  'utf8',
);
const pilotFileSource = readFileSync(
  new URL('../components/Students/StudentProfilePage.tsx', import.meta.url),
  'utf8',
);

test('Members and Pilot File normal edit actions share the same StudentForm', () => {
  assert.match(memberListSource, /<StudentForm[\s\S]*student=\{editingStudent \|\| undefined\}/);
  assert.match(pilotFileSource, /showInfoEditor && !requestedLicenceId && student/);
  assert.match(pilotFileSource, /<StudentForm[\s\S]*student=\{student\}[\s\S]*isEdit/);
});

test('Pilot File keeps the specialised licence evidence review path separate', () => {
  assert.match(pilotFileSource, /showInfoEditor && requestedLicenceId/);
  assert.match(pilotFileSource, /approveInfoLicence/);
  assert.match(pilotFileSource, /rejectInfoLicence/);
});
