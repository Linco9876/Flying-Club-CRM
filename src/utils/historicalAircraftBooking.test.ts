import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canUseAircraftForBooking, isCompletedHistoricalWindow } from './historicalAircraftBooking.ts';

const now = new Date('2026-09-03T02:00:00.000Z');

test('staff can record a completed historical booking with a currently unserviceable aircraft', () => {
  assert.equal(canUseAircraftForBooking({
    status: 'unserviceable',
    isStaff: true,
    bookingEnd: new Date('2026-08-07T07:00:00.000Z'),
  }, now), true);
});

test('current and future use of an unserviceable aircraft stays blocked', () => {
  assert.equal(canUseAircraftForBooking({
    status: 'unserviceable',
    isStaff: true,
    bookingEnd: now,
  }, now), false);
  assert.equal(canUseAircraftForBooking({
    status: 'maintenance',
    isStaff: true,
    bookingEnd: new Date('2026-09-04T02:00:00.000Z'),
  }, now), false);
});

test('non-staff and archived-aircraft overrides remain blocked', () => {
  assert.equal(canUseAircraftForBooking({
    status: 'unserviceable',
    isStaff: false,
    bookingEnd: new Date('2026-08-07T07:00:00.000Z'),
  }, now), false);
  assert.equal(canUseAircraftForBooking({
    status: 'unserviceable',
    isArchived: true,
    isStaff: true,
    bookingEnd: new Date('2026-08-07T07:00:00.000Z'),
  }, now), false);
});

test('invalid dates are never treated as historical', () => {
  assert.equal(isCompletedHistoricalWindow(new Date('invalid'), now), false);
});

test('the database trigger applies the same staff-only completed-history boundary', () => {
  const migration = readFileSync(
    'supabase/migrations/20260903100000_allow_staff_historical_aircraft_bookings.sql',
    'utf8',
  );
  assert.match(migration, /new\.end_time < statement_timestamp\(\)/i);
  assert.match(migration, /current_user_has_staff_role\(\)/i);
  assert.match(migration, /auth\.role\(\) = 'service_role'/i);
  assert.match(migration, /v_is_archived/i);
});
