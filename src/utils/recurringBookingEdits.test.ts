import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Booking } from '../types/index.ts';
import {
  buildRecurringBookingUpdatePlan,
  getExpectedFutureOccurrenceCount,
} from './recurringBookingEdits.ts';

const occurrence = (
  id: string,
  index: number,
  start: string,
  overrides: Partial<Booking> = {},
): Booking => ({
  id,
  studentId: '00000000-0000-0000-0000-000000000001',
  aircraftId: '00000000-0000-0000-0000-000000000002',
  startTime: new Date(start),
  endTime: new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000),
  paymentType: '',
  status: 'confirmed',
  bookingKind: 'flight',
  recurrenceSeriesId: '00000000-0000-0000-0000-000000000003',
  recurrenceOccurrenceIndex: index,
  recurrenceOccurrenceCount: 4,
  ...overrides,
});

test('future series editing preserves past occurrences and applies the same time shift', () => {
  const bookings = [
    occurrence('one', 1, '2026-09-01T09:00:00+10:00'),
    occurrence('two', 2, '2026-09-08T09:00:00+10:00'),
    occurrence('three', 3, '2026-09-15T09:00:00+10:00'),
    occurrence('four', 4, '2026-09-22T09:00:00+10:00'),
  ];

  const plan = buildRecurringBookingUpdatePlan(
    bookings,
    bookings[1],
    new Date('2026-09-08T10:00:00+10:00'),
    new Date('2026-09-08T12:30:00+10:00'),
  );

  assert.deepEqual(plan.map((item) => item.booking.id), ['four', 'three', 'two']);
  assert.equal(plan.find((item) => item.booking.id === 'three')?.startTime.toISOString(), '2026-09-15T00:00:00.000Z');
  assert.equal(plan.find((item) => item.booking.id === 'three')?.endTime.toISOString(), '2026-09-15T02:30:00.000Z');
});

test('cancelled and completed future occurrences are not changed', () => {
  const bookings = [
    occurrence('one', 1, '2026-09-01T09:00:00+10:00'),
    occurrence('two', 2, '2026-09-08T09:00:00+10:00'),
    occurrence('three', 3, '2026-09-15T09:00:00+10:00', { status: 'cancelled' }),
    occurrence('four', 4, '2026-09-22T09:00:00+10:00', { status: 'completed' }),
  ];

  const plan = buildRecurringBookingUpdatePlan(
    bookings,
    bookings[1],
    new Date('2026-09-08T08:30:00+10:00'),
    new Date('2026-09-08T10:30:00+10:00'),
  );

  assert.deepEqual(plan.map((item) => item.booking.id), ['two']);
});

test('the expected remaining occurrence count is derived from stable sequence metadata', () => {
  assert.equal(
    getExpectedFutureOccurrenceCount(occurrence('two', 2, '2026-09-08T09:00:00+10:00')),
    3,
  );
});

test('edit and cancellation forms both ask whether to change one or all future bookings', () => {
  const editForm = readFileSync(new URL('../components/Bookings/BookingForm.tsx', import.meta.url), 'utf8');
  const cancellationForm = readFileSync(new URL('../components/Bookings/BookingCancellationModal.tsx', import.meta.url), 'utf8');
  const interactionModal = readFileSync(new URL('../components/Bookings/RecurringBookingInteractionModal.tsx', import.meta.url), 'utf8');
  const calendar = readFileSync(new URL('../components/Calendar/Calendar.tsx', import.meta.url), 'utf8');

  assert.match(editForm, /Apply changes to/);
  assert.match(editForm, /This booking only/);
  assert.match(editForm, /This and all future/);
  assert.match(cancellationForm, /Apply cancellation to/);
  assert.match(cancellationForm, /This booking only/);
  assert.match(cancellationForm, /This and all future/);
  assert.match(cancellationForm, /recurringScope: isRecurringBooking \? recurringScope : 'single'/);
  assert.match(interactionModal, /This booking only/);
  assert.match(interactionModal, /This and all future bookings/);
  assert.match(calendar, /if \(booking\.recurrenceSeriesId\)/);
  assert.match(calendar, /onUpdateBooking\(booking\.id, updates, true, recurringScope\)/);
});

test('future-series cancellation uses one atomic database operation and one summary notification', () => {
  const hook = readFileSync(new URL('../hooks/useBookings.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const migration = readFileSync(
    new URL('../../supabase/migrations/20260908123000_cancel_future_recurring_bookings.sql', import.meta.url),
    'utf8',
  );

  assert.match(hook, /cancel_recurring_booking_series_from_occurrence/);
  assert.match(app, /cancellation\?\.recurringScope === 'future'/);
  assert.match(app, /deleteRecurringBookingSeries\(bookingId, cancellation\)/);
  assert.match(app, /recurringScope === 'future'/);
  assert.match(app, /updateRecurringBookingSeries\(bookingId, updates, silent\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /recurrence_occurrence_index >= v_source\.recurrence_occurrence_index/);
  assert.match(migration, /A selected occurrence already has a flight or ground-session log/);
  assert.match(migration, /Recurring booking series cancelled/);
  assert.match(migration, /perform public\.promote_available_resource_waitlist\(\)/);
});
