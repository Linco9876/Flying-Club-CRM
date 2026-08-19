import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CRM_REVIEWER_ROLE_OPTIONS,
  normaliseReviewerRoles,
  userCanConductReview,
} from './reviewerRoleRules.ts';

const reviewerTriggerFixMigration = readFileSync(
  new URL('../../supabase/migrations/20260807014500_fix_review_draft_role_triggers.sql', import.meta.url),
  'utf8',
);

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

test('review validation triggers can call protected role helpers without exposing them to staff', () => {
  assert.match(
    reviewerTriggerFixMigration,
    /alter function private\.validate_review_template_crm_roles\(\)\s+security definer/i,
  );
  assert.match(
    reviewerTriggerFixMigration,
    /alter function private\.validate_flight_review_reviewer_role\(\)\s+security definer/i,
  );
  assert.match(
    reviewerTriggerFixMigration,
    /set search_path\s*=\s*pg_catalog, public, private, pg_temp/i,
  );
  assert.match(
    reviewerTriggerFixMigration,
    /revoke all on function private\.validate_flight_review_reviewer_role\(\)[\s\S]*?from public, anon, authenticated/i,
  );
});
