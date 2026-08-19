import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyRegulatoryReviewDate,
  getCourseAwardDate,
  getFlightReviewDueDate,
} from './pilotReviewCurrency.ts';

test('course awards use the latest submitted or locked record date', () => {
  const fallback = new Date('2026-08-03T12:00:00+10:00');
  const result = getCourseAwardDate([
    { courseId: 'rpc', status: 'submitted', date: new Date('2026-07-01T00:00:00+10:00') },
    { courseId: 'rpc', status: 'locked', date: new Date('2026-07-22T00:00:00+10:00') },
    { courseId: 'rpc', status: 'draft', date: new Date('2026-08-01T00:00:00+10:00') },
    { courseId: 'other', status: 'locked', date: new Date('2026-08-02T00:00:00+10:00') },
  ], 'rpc', fallback);

  assert.equal(result.toISOString(), new Date('2026-07-22T00:00:00+10:00').toISOString());
});

test('course awards fall back safely when the course has no completed record', () => {
  const fallback = new Date('2026-08-03T12:00:00+10:00');
  const result = getCourseAwardDate([], 'rpc', fallback);
  assert.equal(result.toISOString(), fallback.toISOString());
  assert.notEqual(result, fallback);
});

test('flight-review currency remains two calendar years from the recognised event', () => {
  const due = getFlightReviewDueDate(new Date('2026-07-22T00:00:00+10:00'));
  assert.equal(due?.getFullYear(), 2028);
  assert.equal(due?.getMonth(), 6);
  assert.equal(due?.getDate(), 22);
});

test('migration recognises licences, endorsements and course flight tests idempotently', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260803120000_sync_pilot_flight_review_currency.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /FROM public\.endorsements endorsement/i);
  assert.match(migration, /FROM public\.licences licence/i);
  assert.match(migration, /CREATE TRIGGER sync_flight_review_after_licence_change/i);
  assert.match(migration, /lesson\.is_flight_test/i);
  assert.match(migration, /INSERT INTO public\.flight_review_records/i);
  assert.match(migration, /ON CONFLICT \(source_training_record_id\) DO UPDATE/i);
  assert.match(migration, /'record_origin', 'course_flight_test'/i);
  assert.match(migration, /NEW\.date \+ interval '2 years'/i);
  assert.match(migration, /Select Pass or Further training required/i);
  assert.match(migration, /Backfill existing completed course flight tests/i);
});

test('course lesson imports hydrate a selected flight-test result before database validation', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260804050000_import_course_flight_test_outcomes.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /hydrate_imported_course_flight_test_outcome/i);
  assert.match(migration, /current_setting\('app\.course_record_import_rows'/i);
  assert.match(migration, /set_config\('app\.course_record_import_rows'/i);
  assert.match(migration, /new\.is_flight_review := true/i);
  assert.match(migration, /new\.flight_review_result/i);
  assert.match(migration, /Further training required/i);
  assert.match(migration, /assert_function_permission_manifest/i);
});

test('a RAAus BFR advances only RAAus currency', () => {
  assert.deepEqual(applyRegulatoryReviewDate({
    authority: 'raaus',
    completedOn: '2026-08-10',
    resetsFlightReview: true,
    lastRaausBfrDate: '2024-06-01',
    lastCasaAfrDate: '2025-03-20',
  }), {
    lastRaausBfrDate: '2026-08-10',
    lastCasaAfrDate: '2025-03-20',
  });
});

test('a CASA AFR advances both CASA AFR and RAAus BFR currency', () => {
  assert.deepEqual(applyRegulatoryReviewDate({
    authority: 'casa',
    completedOn: '2026-08-10',
    resetsFlightReview: true,
    lastRaausBfrDate: '2025-03-20',
    lastCasaAfrDate: '2024-06-01',
  }), {
    lastRaausBfrDate: '2026-08-10',
    lastCasaAfrDate: '2026-08-10',
  });
});

test('a review without a currency reset changes neither date', () => {
  assert.deepEqual(applyRegulatoryReviewDate({
    authority: 'casa',
    completedOn: '2026-08-10',
    resetsFlightReview: false,
    lastRaausBfrDate: '2025-03-20',
    lastCasaAfrDate: '2024-06-01',
  }), {
    lastRaausBfrDate: '2025-03-20',
    lastCasaAfrDate: '2024-06-01',
  });
});

test('split review currency migration keeps authority effects separate and self-service dates safe', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260810113000_split_raaus_bfr_and_casa_afr_currency.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /last_raaus_bfr_date date/i);
  assert.match(migration, /last_casa_afr_date date/i);
  assert.match(migration, /IF v_event\.authority = 'casa'/i);
  assert.match(migration, /ELSIF v_event\.authority = 'raaus'/i);
  assert.match(migration, /Flight review dates cannot be in the future/i);
  assert.match(migration, /Users can insert own safe student profile row/i);
});

test('passed course flight tests atomically complete the course and grant Pilot status', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260805113000_complete_course_after_passed_flight_test.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS completed_at timestamptz/i);
  assert.match(migration, /completion_source_training_record_id uuid/i);
  assert.match(migration, /INSERT INTO public\.student_course_enrolments/i);
  assert.match(migration, /ON CONFLICT \(student_id, course_id\) DO UPDATE/i);
  assert.match(migration, /SET status = 'completed'/i);
  assert.match(migration, /training_record\.status <> 'draft'/i);
  assert.match(migration, /training_record\.flight_review_result = 'pass'/i);
  assert.match(migration, /lesson\.is_flight_test/i);
  assert.match(migration, /VALUES \(target_user_id, 'pilot'\)/i);
  assert.match(migration, /NEW\.pilot_role_granted :=/i);
  assert.match(migration, /INSERT INTO public\.endorsements/i);
  assert.match(migration, /INSERT INTO public\.licences/i);
  assert.match(migration, /SELECT private\.assert_function_permission_manifest\(\)/i);
});
