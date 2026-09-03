export interface HistoricalAircraftBookingInput {
  status: 'serviceable' | 'unserviceable' | 'maintenance';
  isArchived?: boolean;
  isStaff: boolean;
  bookingEnd: Date;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const parseDateOnlyUtc = (value: string) => {
  if (!DATE_ONLY_PATTERN.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
};

/**
 * Moving the start date in the booking form must move its end date as well.
 * Otherwise a same-day booking moved into the past silently continues to end
 * today and is treated as an operational booking rather than a historical one.
 */
export const shiftBookingDateRange = (
  currentStartDate: string,
  currentEndDate: string,
  nextStartDate: string,
) => {
  const nextStart = parseDateOnlyUtc(nextStartDate);
  if (!nextStart) {
    return { startDate: nextStartDate, endDate: currentEndDate };
  }

  const currentStart = parseDateOnlyUtc(currentStartDate);
  const currentEnd = parseDateOnlyUtc(currentEndDate);
  const existingDaySpan = currentStart && currentEnd
    ? Math.max(0, Math.round((currentEnd.getTime() - currentStart.getTime()) / DAY_MS))
    : 0;
  const nextEnd = new Date(nextStart.getTime() + existingDaySpan * DAY_MS);

  return {
    startDate: nextStartDate,
    endDate: nextEnd.toISOString().slice(0, 10),
  };
};

export const isCompletedHistoricalWindow = (bookingEnd: Date, now = new Date()) => (
  !Number.isNaN(bookingEnd.getTime()) && bookingEnd.getTime() < now.getTime()
);

/**
 * Current aircraft status controls operational bookings. Staff may still use a
 * currently grounded aircraft when reconstructing a booking that has already
 * ended; that record cannot authorise any present or future aircraft use.
 */
export const canUseAircraftForBooking = (
  input: HistoricalAircraftBookingInput,
  now = new Date(),
) => !input.isArchived && (
  input.status === 'serviceable'
  || (input.isStaff && isCompletedHistoricalWindow(input.bookingEnd, now))
);
