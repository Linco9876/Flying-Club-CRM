import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canUseAircraftForBooking,
  isCompletedHistoricalWindow,
  shiftBookingDateRange,
} from './historicalAircraftBooking.ts';

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

test('moving a same-day booking into the past moves its end date with it', () => {
  assert.deepEqual(
    shiftBookingDateRange('2026-09-03', '2026-09-03', '2026-08-07'),
    { startDate: '2026-08-07', endDate: '2026-08-07' },
  );
});

test('moving an overnight booking preserves its date span', () => {
  assert.deepEqual(
    shiftBookingDateRange('2026-09-03', '2026-09-04', '2026-08-07'),
    { startDate: '2026-08-07', endDate: '2026-08-08' },
  );
});

test('the booking form shifts the end date whenever the start date changes', () => {
  const bookingForm = readFileSync('src/components/Bookings/BookingForm.tsx', 'utf8');
  assert.match(
    bookingForm,
    /shiftBookingDateRange\(prev\.date, prev\.endDate, nextStartDate\)/,
  );
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
  assert.match(
    migration,
    /revoke all on function public\.enforce_aircraft_maintenance_serviceability\(\)\s+from public, anon, authenticated;/i,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.enforce_aircraft_maintenance_serviceability\(\)/i,
  );
});
