export interface HistoricalAircraftBookingInput {
  status: 'serviceable' | 'unserviceable' | 'maintenance';
  isArchived?: boolean;
  isStaff: boolean;
  bookingEnd: Date;
}

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
