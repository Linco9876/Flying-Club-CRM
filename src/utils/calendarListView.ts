import type { Booking } from '../types';

export type CalendarViewMode = 'day' | 'week' | 'month' | 'list';
export type CalendarListBookingType = 'all' | 'flight' | 'ground' | 'guest';
export type CalendarListStatus =
  | 'all'
  | 'confirmed'
  | 'pending_approval'
  | 'pending_supervision'
  | 'waitlist'
  | 'logged'
  | 'not_logged'
  | 'completed'
  | 'no-show'
  | 'cancelled';
export type CalendarListSort = 'ascending' | 'descending';

export interface CalendarListFilters {
  startDate: string;
  endDate: string;
  pilotId: string;
  instructorId: string;
  resourceId: string;
  bookingType: CalendarListBookingType;
  status: CalendarListStatus;
  query: string;
  sort: CalendarListSort;
}

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parseDateInput = (value: string) => {
  if (!DATE_INPUT_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
};

export const formatCalendarListDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getDefaultCalendarListRange = (referenceDate = new Date()) => {
  const endDate = new Date(referenceDate);
  endDate.setDate(endDate.getDate() + 29);
  return {
    startDate: formatCalendarListDate(referenceDate),
    endDate: formatCalendarListDate(endDate),
  };
};

export const isCalendarListDateRangeValid = (startDate: string, endDate: string) => {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  return Boolean(start && end && start.getTime() <= end.getTime());
};

export const buildCalendarViewSearchParams = (
  current: URLSearchParams,
  view: CalendarViewMode,
) => {
  const next = new URLSearchParams(current);
  next.set('view', view);
  // Notification links deliberately use bookingId to open Day view and animate
  // a booking. A manual view change must end that one-off navigation intent.
  next.delete('bookingId');
  return next;
};

const isBookingLogged = (booking: Booking) => Boolean(
  booking.flight_logged ||
  booking.flightLog ||
  booking.ground_session_logged ||
  booking.groundSessionLog
);

const isBookingCancelled = (booking: Booking) =>
  booking.status === 'cancelled' || Boolean(booking.deletedAt);

const matchesStatus = (booking: Booking, status: CalendarListStatus) => {
  if (status === 'all') return true;
  if (status === 'waitlist') return Boolean(booking.hasConflict);
  if (status === 'logged') return isBookingLogged(booking);
  if (status === 'not_logged') return !isBookingLogged(booking) && !isBookingCancelled(booking);
  if (status === 'cancelled') return isBookingCancelled(booking);
  return booking.status === status;
};

const matchesBookingType = (booking: Booking, bookingType: CalendarListBookingType) => {
  if (bookingType === 'all') return true;
  if (bookingType === 'guest') return Boolean(booking.isGuestBooking);
  if (bookingType === 'ground') return booking.bookingKind === 'ground';
  return booking.bookingKind !== 'ground';
};

export const filterCalendarListBookings = (
  bookings: Booking[],
  filters: CalendarListFilters,
  getSearchText: (booking: Booking) => string = () => '',
) => {
  const start = parseDateInput(filters.startDate);
  const end = parseDateInput(filters.endDate);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const normalisedQuery = filters.query.trim().toLocaleLowerCase();

  return bookings
    .filter((booking) => {
      const bookingStart = new Date(booking.startTime).getTime();
      if (bookingStart < start.getTime() || bookingStart >= endExclusive.getTime()) return false;
      if (filters.pilotId && (booking.studentId || booking.pilotId) !== filters.pilotId) return false;
      if (filters.instructorId && booking.instructorId !== filters.instructorId) return false;
      if (filters.resourceId === 'ground' && booking.bookingKind !== 'ground') return false;
      if (
        filters.resourceId &&
        filters.resourceId !== 'ground' &&
        booking.aircraftId !== filters.resourceId
      ) return false;
      if (!matchesBookingType(booking, filters.bookingType)) return false;
      if (!matchesStatus(booking, filters.status)) return false;
      if (
        normalisedQuery &&
        !`${booking.id} ${getSearchText(booking)}`.toLocaleLowerCase().includes(normalisedQuery)
      ) return false;
      return true;
    })
    .sort((left, right) => {
      const difference = new Date(left.startTime).getTime() - new Date(right.startTime).getTime();
      return filters.sort === 'ascending' ? difference : -difference;
    });
};
