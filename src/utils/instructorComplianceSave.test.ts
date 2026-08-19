import test from 'node:test';
import assert from 'node:assert/strict';
import { instructorComplianceSaveFailureMessage } from './instructorComplianceSave.ts';

test('renewal upload RLS errors are converted to a useful CFI instruction', () => {
  const message = instructorComplianceSaveFailureMessage(
    { code: '42501', message: 'new row violates row-level security policy' },
    'form-upload',
  );
  assert.match(message, /renewal form upload was not authorised/i);
  assert.match(message, /CFI\/DCFI authority/i);
  assert.doesNotMatch(message, /row-level security/i);
});

test('record and queue stages explain whether the protected record was saved', () => {
  assert.match(
    instructorComplianceSaveFailureMessage(
      new Error('new row violates row-level security policy'),
      'record-save',
    ),
    /review could not confirm/i,
  );
  assert.match(
    instructorComplianceSaveFailureMessage(
      new Error('new row violates row-level security policy'),
      'flight-finalise',
    ),
    /review was saved/i,
  );
});

test('specific non-policy validation messages are preserved', () => {
  assert.equal(
    instructorComplianceSaveFailureMessage(
      new Error('A satisfactory check needs at least 60 minutes in flight'),
      'record-save',
    ),
    'A satisfactory check needs at least 60 minutes in flight',
  );
});
