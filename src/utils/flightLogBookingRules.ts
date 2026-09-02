import type { Booking } from '../types';

export const FLIGHT_LOG_ALREADY_EXISTS_MESSAGE =
  'This booking already has a flight log. Refresh the calendar and use Edit Flight Log instead.';

export const getCalendarFlightLogBlockReason = (
  booking: Pick<Booking, 'status' | 'hasConflict' | 'deletedAt'>,
) => {
  if (booking.status === 'cancelled' || booking.status === 'no-show' || booking.deletedAt) {
    return 'Flight logging is unavailable for a cancelled or no-show booking.';
  }
  if (booking.hasConflict) {
    return 'Flight logging is unavailable while this booking is on the waiting list.';
  }
  if (booking.status === 'pending_approval') {
    return 'Flight logging is unavailable until this booking is approved.';
  }
  if (booking.status === 'pending_supervision') {
    return 'Flight logging is unavailable while supervision is pending.';
  }
  return null;
};

export const isDuplicateBookingFlightLogError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  if (String(value.code || '') !== '23505') return false;

  const detail = `${String(value.message || '')} ${String(value.details || '')}`.toLowerCase();
  return detail.includes('flight_logs_one_per_booking_idx')
    || (detail.includes('flight_logs') && detail.includes('booking_id'));
};
