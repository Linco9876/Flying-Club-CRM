export interface CalendarNotificationBooking {
  id: string;
  startTime: Date | string;
  aircraftId?: string;
  instructorId?: string;
  status?: string;
  hasConflict?: boolean;
}

export interface CalendarNotificationFocus {
  bookingId: string;
  date: Date;
  revealResourceIds: string[];
  showCancelled: boolean;
  showPending: boolean;
  showWaitlisted: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const resolveCalendarNotificationFocus = (
  bookingId: string | null | undefined,
  bookings: CalendarNotificationBooking[],
): CalendarNotificationFocus | null => {
  if (!bookingId || !UUID_PATTERN.test(bookingId)) return null;

  const booking = bookings.find((candidate) => candidate.id === bookingId);
  if (!booking) return null;

  const date = booking.startTime instanceof Date
    ? new Date(booking.startTime)
    : new Date(booking.startTime);
  if (Number.isNaN(date.getTime())) return null;

  return {
    bookingId,
    date,
    revealResourceIds: Array.from(new Set([
      booking.aircraftId,
      booking.instructorId,
    ].filter((id): id is string => Boolean(id)))),
    showCancelled: booking.status === 'cancelled',
    showPending: booking.status === 'pending_approval' || booking.status === 'pending_supervision',
    showWaitlisted: Boolean(booking.hasConflict),
  };
};
