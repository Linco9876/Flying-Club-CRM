import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CRM_REVIEWER_ROLE_OPTIONS,
  normaliseReviewerRoles,
  userCanConductReview,
} from './reviewerRoleRules.ts';

test('template choices are real assignable CRM staff roles', () => {
  assert.deepEqual(
    CRM_REVIEWER_ROLE_OPTIONS.map(option => option.role),
    ['admin', 'cfi', 'senior_instructor', 'instructor'],
  );
  assert.equal(CRM_REVIEWER_ROLE_OPTIONS.some(option => option.role === ('flight_examiner' as never)), false);
});

test('legacy examiner labels migrate to the CRM CFI authority', () => {
  assert.deepEqual(
    normaliseReviewerRoles(['senior_instructor', 'pilot_examiner', 'flight_examiner', 'made_up']),
    ['senior_instructor', 'cfi'],
  );
});

test('review authority follows assigned CRM roles, including the senior flag', () => {
  assert.equal(userCanConductReview(
    { role: 'instructor', roles: ['instructor', 'cfi'] },
    ['cfi'],
  ), true);
  assert.equal(userCanConductReview(
    { role: 'instructor', roles: ['instructor'] },
    ['cfi'],
  ), false);
  assert.equal(userCanConductReview(
    { role: 'instructor', roles: ['instructor'], isSeniorInstructor: true },
    ['senior_instructor'],
  ), true);
  assert.equal(userCanConductReview(
    { role: 'pilot', roles: ['pilot'] },
    ['pilot_examiner'],
  ), false);
});
