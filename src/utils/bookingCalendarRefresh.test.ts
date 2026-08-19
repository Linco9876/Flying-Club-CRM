import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BOOKING_CALENDAR_REFRESH_EVENT } from './bookingCalendarRefresh.ts';

const useBookingsSource = readFileSync(
  new URL('../hooks/useBookings.ts', import.meta.url),
  'utf8',
);
const useFlightLogsSource = readFileSync(
  new URL('../hooks/useFlightLogs.ts', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../supabase/migrations/20260817045950_refresh_calendar_and_rostered_supervision.sql', import.meta.url),
  'utf8',
);

test('calendar data listens for the shared refresh event and related realtime changes', () => {
  assert.equal(BOOKING_CALENDAR_REFRESH_EVENT, 'bfc:booking-calendar-refresh');
  assert.match(useBookingsSource, /addEventListener\(BOOKING_CALENDAR_REFRESH_EVENT/);
  assert.match(useBookingsSource, /table:\s*'bookings'/);
  assert.match(useBookingsSource, /table:\s*'flight_logs'/);
  assert.match(useBookingsSource, /table:\s*'ground_session_logs'/);
  assert.match(useBookingsSource, /fetchBookings\(\{ silent: true \}\)/);
});

test('all flight-log mutations request a booking calendar refresh', () => {
  assert.match(useFlightLogsSource, /reason:\s*'flight-log-created'/);
  assert.match(useFlightLogsSource, /reason:\s*'flight-log-updated'/);
  assert.match(useFlightLogsSource, /reason:\s*'flight-log-deleted'/);
});

test('database keeps the booking marker and realtime row in sync with linked flight logs', () => {
  assert.match(migration, /after insert or update or delete\s+on public\.flight_logs/i);
  assert.match(migration, /set flight_logged = exists/i);
  assert.match(migration, /updated_at = clock_timestamp\(\)/i);
  assert.match(migration, /old\.booking_id/i);
  assert.match(migration, /new\.booking_id/i);
});

test('roster changes automatically reconsider unresolved supervised bookings', () => {
  assert.match(migration, /on public\.instructor_weekly_schedules/i);
  assert.match(migration, /on public\.instructor_schedule_changes/i);
  assert.match(migration, /on public\.instructor_absences/i);
  assert.match(migration, /on public\.senior_instructor_authorisations/i);
  assert.match(migration, /supervision_required/i);
  assert.match(migration, /status not in \('cancelled', 'no-show', 'completed'\)/i);
});
