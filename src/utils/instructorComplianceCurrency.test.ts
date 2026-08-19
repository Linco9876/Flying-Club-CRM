import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getInstructorCurrencyAfterCheck,
  getInstructorOperationalStatus,
} from './instructorComplianceCurrency.ts';

const raausTemplateMigration = readFileSync(
  new URL('../../supabase/migrations/20260807133000_raaus_instructor_sp_and_renewal_templates.sql', import.meta.url),
  'utf8',
);

test('a satisfactory ordinary Instructor S&P check is due again in exactly 90 days', () => {
  assert.deepEqual(
    getInstructorCurrencyAfterCheck('2026-07-15', 'instructor', 'sp_check', 'satisfactory'),
    { nextSpCheckDue: '2026-10-13', nextRenewalDue: undefined, bfrResetDate: undefined },
  );
});

test('a satisfactory Senior Instructor S&P check is due again in 12 months', () => {
  assert.equal(
    getInstructorCurrencyAfterCheck('2026-07-15', 'senior_instructor', 'sp_check', 'satisfactory').nextSpCheckDue,
    '2027-07-15',
  );
});

test('a satisfactory renewal resets BFR and both S&P and two-year rating dates', () => {
  assert.deepEqual(
    getInstructorCurrencyAfterCheck('2026-08-07', 'instructor', 'renewal', 'satisfactory'),
    {
      nextSpCheckDue: '2026-11-05',
      nextRenewalDue: '2028-08-07',
      bfrResetDate: '2026-08-07',
    },
  );
});

test('calendar-year renewal dates clamp safely from leap day', () => {
  assert.equal(
    getInstructorCurrencyAfterCheck('2024-02-29', 'senior_instructor', 'renewal', 'satisfactory').nextRenewalDue,
    '2026-02-28',
  );
});

test('an unsatisfactory check creates no currency', () => {
  assert.deepEqual(
    getInstructorCurrencyAfterCheck('2026-08-07', 'instructor', 'renewal', 'unsatisfactory'),
    { nextSpCheckDue: '2026-08-07' },
  );
});

test('operational clearance requires both S&P and rating-renewal currency', () => {
  assert.equal(getInstructorOperationalStatus('current', 'current'), 'current');
  assert.equal(getInstructorOperationalStatus('due_soon', 'current'), 'due_soon');
  assert.equal(getInstructorOperationalStatus('current', 'overdue'), 'overdue');
  assert.equal(getInstructorOperationalStatus('current', 'no_record'), 'no_record');
  assert.equal(getInstructorOperationalStatus('remedial', 'current'), 'remedial');
});

test('the protected templates enforce the RAAus completion evidence and currency effects', () => {
  assert.match(raausTemplateMigration, /RAAP 7 v2\.0/);
  assert.match(raausTemplateMigration, /Instructor Renewal INS002 v3\.0/);
  assert.match(raausTemplateMigration, /INTERVAL '90 days'/);
  assert.match(raausTemplateMigration, /INTERVAL '12 months'/);
  assert.match(raausTemplateMigration, /INTERVAL '2 years'/);
  assert.match(raausTemplateMigration, /NEW\.flight_minutes < 60/);
  assert.match(raausTemplateMigration, /NEW\.logbook_entries_confirmed/);
  assert.match(raausTemplateMigration, /NEW\.authority_submission_confirmed/);
  assert.match(raausTemplateMigration, /compliance\.check_type = 'renewal'/);
  assert.match(raausTemplateMigration, /compliance\.outcome = 'satisfactory'/);
});
