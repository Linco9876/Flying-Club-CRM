import assert from 'node:assert/strict';
import test from 'node:test';
import { requiresAutomaticInstructorSupervision } from './supervisionRoles.ts';

test('ordinary instructors automatically require supervision', () => {
  assert.equal(requiresAutomaticInstructorSupervision(['instructor']), true);
  assert.equal(requiresAutomaticInstructorSupervision(['pilot', 'instructor']), true);
});

test('senior instructors and CFIs do not automatically require supervision', () => {
  assert.equal(
    requiresAutomaticInstructorSupervision(['instructor', 'senior_instructor']),
    false,
  );
  assert.equal(
    requiresAutomaticInstructorSupervision(['instructor', 'cfi']),
    false,
  );
});

test('a non-instructor role does not create an automatic requirement', () => {
  assert.equal(requiresAutomaticInstructorSupervision(['senior_instructor']), false);
  assert.equal(requiresAutomaticInstructorSupervision(['admin', 'pilot']), false);
});
