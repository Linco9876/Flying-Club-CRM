import assert from 'node:assert/strict';
import test from 'node:test';
import { canEditLogbookNotes } from './logbookNotePermissions.ts';

test('the signed-in logbook owner can edit their notes', () => {
  assert.equal(canEditLogbookNotes('owner-id', 'owner-id'), true);
});

test('another user cannot edit notes even when they can view the logbook', () => {
  assert.equal(canEditLogbookNotes('staff-id', 'owner-id'), false);
});

test('notes cannot be edited without both authenticated and owner identities', () => {
  assert.equal(canEditLogbookNotes(undefined, 'owner-id'), false);
  assert.equal(canEditLogbookNotes('owner-id', undefined), false);
});
