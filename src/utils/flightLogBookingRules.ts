export const FLIGHT_LOG_ALREADY_EXISTS_MESSAGE =
  'This booking already has a flight log. Refresh the calendar and use Edit Flight Log instead.';

export const isDuplicateBookingFlightLogError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  if (String(value.code || '') !== '23505') return false;

  const detail = `${String(value.message || '')} ${String(value.details || '')}`.toLowerCase();
  return detail.includes('flight_logs_one_per_booking_idx')
    || (detail.includes('flight_logs') && detail.includes('booking_id'));
};
