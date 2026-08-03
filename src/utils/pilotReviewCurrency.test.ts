import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getCourseAwardDate, getFlightReviewDueDate } from './pilotReviewCurrency.ts';

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
