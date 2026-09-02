import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  FLIGHT_LOG_ALREADY_EXISTS_MESSAGE,
  getCalendarFlightLogBlockReason,
  isDuplicateBookingFlightLogError,
} from './flightLogBookingRules.ts';

test('recognises the database guard for a second flight log on one booking', () => {
  assert.equal(isDuplicateBookingFlightLogError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "flight_logs_one_per_booking_idx"',
  }), true);
  assert.match(FLIGHT_LOG_ALREADY_EXISTS_MESSAGE, /Edit Flight Log/);
});

test('does not mislabel unrelated unique constraint failures', () => {
  assert.equal(isDuplicateBookingFlightLogError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "idx_flight_logs_stripe_checkout_session_id"',
  }), false);
  assert.equal(isDuplicateBookingFlightLogError({ code: '42501', message: 'permission denied' }), false);
});

test('waitlisted and pending bookings cannot be logged as completed flights', () => {
  assert.match(getCalendarFlightLogBlockReason({ status: 'confirmed', hasConflict: true }) ?? '', /waiting list/);
  assert.match(getCalendarFlightLogBlockReason({ status: 'pending_approval' }) ?? '', /approved/);
  assert.match(getCalendarFlightLogBlockReason({ status: 'pending_supervision' }) ?? '', /supervision/);
  assert.match(getCalendarFlightLogBlockReason({ status: 'cancelled' }) ?? '', /cancelled/);
  assert.equal(getCalendarFlightLogBlockReason({ status: 'confirmed' }), null);
  assert.equal(getCalendarFlightLogBlockReason({ status: 'completed' }), null);
});

test('database migration enforces one flight log per booking and repairs calendar flags', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260807093000_prevent_duplicate_booking_flight_logs.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /create unique index[^;]+flight_logs_one_per_booking_idx/is);
  assert.match(migration, /where booking_id is not null/i);
  assert.match(migration, /set flight_logged = exists/i);
});

test('database rejects flight logs for bookings that are not operationally ready', () => {
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260819161500_block_invalid_booking_flight_logs.sql', import.meta.url),
    'utf8',
  );

  assert.match(migration, /status in \('cancelled', 'no-show'\)/i);
  assert.match(migration, /coalesce\(v_booking\.has_conflict, false\)/i);
  assert.match(migration, /status = 'pending_approval'/i);
  assert.match(migration, /status = 'pending_supervision'/i);
  assert.match(migration, /assert_function_permission_manifest/i);
});
