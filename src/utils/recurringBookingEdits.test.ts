import assert from 'node:assert/strict';
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
