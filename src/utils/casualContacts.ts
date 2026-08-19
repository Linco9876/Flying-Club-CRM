import type { BookingPurpose } from '../types';

export interface CasualContactSearchResult {
  id: string;
  name: string;
  email: string;
  phone?: string;
  status: 'active' | 'promoted' | 'merged';
  promotedToUserId?: string;
  bookingCount: number;
  lastBookingAt?: string;
}

export const GUEST_BOOKING_PURPOSES: readonly BookingPurpose[] = [
  'trial_flight',
  'casual_flight',
];

export const FORMAL_BOOKING_PURPOSES: readonly BookingPurpose[] = [
  'external_flight_review',
  'external_flight_test',
];

export const normaliseGuestBookingPurpose = (
  purpose: BookingPurpose | undefined,
  hasVoucher = false,
): BookingPurpose => {
  if (hasVoucher) return 'trial_flight';
  return GUEST_BOOKING_PURPOSES.includes(purpose as BookingPurpose)
    ? purpose as BookingPurpose
    : 'casual_flight';
};

export const bookingPurposeNeedsFormalProfile = (purpose: BookingPurpose | undefined) =>
  FORMAL_BOOKING_PURPOSES.includes(purpose as BookingPurpose);

export const bookingPurposeNeedsTrainingRecord = (
  purpose: BookingPurpose | undefined,
  isGuestBooking: boolean,
) => {
  if (GUEST_BOOKING_PURPOSES.includes(purpose as BookingPurpose)) return false;
  return !isGuestBooking;
};

export const mapCasualContactSearchRow = (row: Record<string, unknown>): CasualContactSearchResult => ({
  id: String(row.id || ''),
  name: String(row.name || ''),
  email: String(row.email || ''),
  phone: row.phone ? String(row.phone) : undefined,
  status: String(row.status || 'active') as CasualContactSearchResult['status'],
  promotedToUserId: row.promoted_to_user_id ? String(row.promoted_to_user_id) : undefined,
  bookingCount: Number(row.booking_count || 0),
  lastBookingAt: row.last_booking_at ? String(row.last_booking_at) : undefined,
});
