export const BOOKING_CALENDAR_REFRESH_EVENT = 'bfc:booking-calendar-refresh';

export type BookingCalendarRefreshReason =
  | 'booking-created'
  | 'booking-updated'
  | 'recurring-bookings-updated'
  | 'booking-deleted'
  | 'booking-restored'
  | 'booking-approved'
  | 'booking-rejected'
  | 'supervision-accepted'
  | 'supervision-assigned'
  | 'supervision-acknowledged'
  | 'flight-log-created'
  | 'flight-log-updated'
  | 'flight-log-deleted'
  | 'related-record-changed';

export interface BookingCalendarRefreshDetail {
  bookingId?: string;
  reason: BookingCalendarRefreshReason;
}

/**
 * Tells every mounted calendar data source to reload its complete booking row.
 * A complete reload is intentional: Supabase realtime payloads do not include
 * the related student, instructor, aircraft, flight-log, or ground-log joins.
 */
export const requestBookingCalendarRefresh = (
  detail: BookingCalendarRefreshDetail,
) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BookingCalendarRefreshDetail>(
    BOOKING_CALENDAR_REFRESH_EVENT,
    { detail },
  ));
};
