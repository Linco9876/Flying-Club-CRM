import assert from 'node:assert/strict';
import test from 'node:test';
import type { Booking } from '../types';
import {
  buildCalendarViewSearchParams,
  filterCalendarListBookings,
  getDefaultCalendarListRange,
  isCalendarListDateRangeValid,
  type CalendarListFilters,
} from './calendarListView.ts';

const booking = (overrides: Partial<Booking> & Pick<Booking, 'id' | 'startTime'>): Booking => ({
  endTime: new Date(new Date(overrides.startTime).getTime() + 60 * 60 * 1000),
  paymentType: 'account',
  status: 'confirmed',
  bookingKind: 'flight',
  ...overrides,
});

const baseFilters: CalendarListFilters = {
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  pilotId: '',
  instructorId: '',
  resourceId: '',
  bookingType: 'all',
  status: 'all',
  query: '',
  sort: 'ascending',
};

test('manual calendar view changes clear one-off notification focus', () => {
  const current = new URLSearchParams('date=2026-08-07&bookingId=booking-1');
  const next = buildCalendarViewSearchParams(current, 'list');

  assert.equal(next.get('view'), 'list');
  assert.equal(next.get('date'), '2026-08-07');
  assert.equal(next.has('bookingId'), false);
});

test('the default List range includes thirty calendar days', () => {
  assert.deepEqual(getDefaultCalendarListRange(new Date(2026, 7, 18, 15)), {
    startDate: '2026-08-18',
    endDate: '2026-09-16',
  });
  assert.equal(isCalendarListDateRangeValid('2026-08-01', '2026-08-31'), true);
  assert.equal(isCalendarListDateRangeValid('2026-09-01', '2026-08-31'), false);
});

test('List view uses an inclusive date range and chronological sorting', () => {
  const bookings = [
    booking({ id: 'later', startTime: new Date(2026, 7, 31, 23, 30) }),
    booking({ id: 'outside', startTime: new Date(2026, 8, 1, 0, 0) }),
    booking({ id: 'earlier', startTime: new Date(2026, 7, 1, 0, 0) }),
  ];

  assert.deepEqual(
    filterCalendarListBookings(bookings, baseFilters).map((item) => item.id),
    ['earlier', 'later'],
  );
});

test('List filters combine people, resources, booking type, status and search', () => {
  const bookings = [
    booking({
      id: 'matching',
      startTime: new Date(2026, 7, 12, 9),
      studentId: 'pilot-1',
      instructorId: 'instructor-1',
      aircraftId: 'aircraft-1',
      isGuestBooking: true,
      flight_logged: true,
    }),
    booking({
      id: 'other',
      startTime: new Date(2026, 7, 12, 10),
      studentId: 'pilot-2',
      instructorId: 'instructor-1',
      aircraftId: 'aircraft-1',
      isGuestBooking: true,
      flight_logged: true,
    }),
  ];
  const filters: CalendarListFilters = {
    ...baseFilters,
    pilotId: 'pilot-1',
    instructorId: 'instructor-1',
    resourceId: 'aircraft-1',
    bookingType: 'guest',
    status: 'logged',
    query: 'robin',
  };

  assert.deepEqual(
    filterCalendarListBookings(
      bookings,
      filters,
      (item) => item.id === 'matching' ? 'Robin Fosbender VH-BIU' : 'Someone Else VH-BIU',
    ).map((item) => item.id),
    ['matching'],
  );
});

test('ground sessions and not-logged bookings can be selected explicitly', () => {
  const bookings = [
    booking({ id: 'ground', startTime: new Date(2026, 7, 5, 9), bookingKind: 'ground' }),
    booking({ id: 'flight', startTime: new Date(2026, 7, 5, 10), aircraftId: 'aircraft-1' }),
  ];

  assert.deepEqual(
    filterCalendarListBookings(bookings, {
      ...baseFilters,
      resourceId: 'ground',
      bookingType: 'ground',
      status: 'not_logged',
    }).map((item) => item.id),
    ['ground'],
  );
});
