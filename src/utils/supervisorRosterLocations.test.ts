import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getSupervisorLocationValidationError,
  toggleSupervisorLocation,
} from './supervisorRosterLocations.ts';

const rosteredSupervisorMigration = readFileSync(
  new URL('../../supabase/migrations/20260804043000_allow_active_supervisors_for_historical_lessons.sql', import.meta.url),
  'utf8',
);

test('adds and removes a supervision location without disturbing the others', () => {
  assert.deepEqual(toggleSupervisorLocation(['bendigo'], 'echuca'), ['bendigo', 'echuca']);
  assert.deepEqual(toggleSupervisorLocation(['bendigo', 'echuca'], 'bendigo'), ['echuca']);
});

test('requires coverage on every working day for an authorised supervisor', () => {
  assert.equal(
    getSupervisorLocationValidationError({
      isAuthorisedSupervisor: true,
      isAvailable: true,
      supervisionLocationIds: [],
      dayLabel: 'Monday',
    }),
    'Monday: choose at least one supervision location',
  );
});

test('does not require supervisor coverage for non-working days or other instructors', () => {
  assert.equal(
    getSupervisorLocationValidationError({
      isAuthorisedSupervisor: true,
      isAvailable: false,
      supervisionLocationIds: [],
      dayLabel: 'Monday',
    }),
    null,
  );
  assert.equal(
    getSupervisorLocationValidationError({
      isAuthorisedSupervisor: false,
      isAvailable: true,
      supervisionLocationIds: [],
      dayLabel: 'Monday',
    }),
    null,
  );
});

test('a rostered supervisor remains available while conducting their own lesson', () => {
  const functionBody = rosteredSupervisorMigration.match(
    /create or replace function public\.supervisor_available_for_slot[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
  )?.[1];

  assert.ok(functionBody, 'supervisor availability function must be present');
  assert.match(functionBody, /trial_voucher_instructor_available_for_slot/i);
  assert.doesNotMatch(functionBody, /booking\.instructor_id\s*=\s*p_supervisor_id/i);
  assert.match(functionBody, /assess_instructor_duty_booking/i);
  assert.match(functionBody, /booking\.supervising_instructor_id\s*=\s*p_supervisor_id/i);
  assert.match(functionBody, /v_count\s*<\s*v_maximum/i);
});

test('reconciles lessons already waiting for rostered supervision', () => {
  assert.match(
    rosteredSupervisorMigration,
    /supervision_required[\s\S]*supervision_status\s*=\s*'pending'[\s\S]*status not in \('cancelled', 'no-show', 'completed'\)/i,
  );
});

test('active authorisation covers a historical rostered lesson without starting future authority early', () => {
  const historicalAuthorisationRule = /p_end\s*<\s*now\(\)[\s\S]*?or authorisation\.effective_from\s*<=/gi;

  assert.equal(
    (rosteredSupervisorMigration.match(historicalAuthorisationRule) || []).length,
    2,
    'both supervisor lookup layers must accept active authorisation for a historical lesson',
  );
  assert.match(rosteredSupervisorMigration, /authorisation\.is_active/i);
  assert.match(rosteredSupervisorMigration, /authorisation\.qualification_expires_on/i);
  assert.match(rosteredSupervisorMigration, /authorisation\.effective_to/i);
});
