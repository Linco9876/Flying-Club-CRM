import type { BookingPurpose } from '../types';

export interface PastVisitor {
  id: string;
  name: string;
  email: string;
  phone?: string;
  status: 'active' | 'promoted' | 'merged';
  promotedToUserId?: string;
  bookingCount: number;
  guestBookingCount: number;
  firstBookingAt?: string;
  lastBookingAt?: string;
  portalProfileName?: string;
  portalProfileEmail?: string;
  portalProfileIsActive?: boolean;
  portalAccessScope?: 'full' | 'trial_voucher' | 'guest_placeholder';
}

export type PastVisitorFilter = 'all' | 'needs_profile' | 'portal_profile';

export const isValidGuestPromotionEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());

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

export const mapPastVisitorRow = (row: Record<string, unknown>): PastVisitor => ({
  id: String(row.id || ''),
  name: String(row.name || ''),
  email: String(row.email || ''),
  phone: row.phone ? String(row.phone) : undefined,
  status: String(row.status || 'active') as PastVisitor['status'],
  promotedToUserId: row.promoted_to_user_id ? String(row.promoted_to_user_id) : undefined,
  bookingCount: Number(row.booking_count || 0),
  guestBookingCount: Number(row.guest_booking_count || 0),
  firstBookingAt: row.first_booking_at ? String(row.first_booking_at) : undefined,
  lastBookingAt: row.last_booking_at ? String(row.last_booking_at) : undefined,
  portalProfileName: row.promoted_user_name ? String(row.promoted_user_name) : undefined,
  portalProfileEmail: row.promoted_user_email ? String(row.promoted_user_email) : undefined,
  portalProfileIsActive: row.promoted_user_is_active === null || row.promoted_user_is_active === undefined
    ? undefined
    : Boolean(row.promoted_user_is_active),
  portalAccessScope: row.promoted_user_access_scope
    ? String(row.promoted_user_access_scope) as PastVisitor['portalAccessScope']
    : undefined,
});

const normaliseVisitorSearch = (value: string) =>
  value.toLocaleLowerCase().replace(/[^a-z0-9@.+]+/g, ' ').trim();

export const filterPastVisitors = (
  visitors: readonly PastVisitor[],
  query: string,
  filter: PastVisitorFilter,
) => {
  const terms = normaliseVisitorSearch(query).split(/\s+/).filter(Boolean);
  return visitors.filter((visitor) => {
    const hasPortalProfile = Boolean(visitor.promotedToUserId);
    if (filter === 'needs_profile' && hasPortalProfile) return false;
    if (filter === 'portal_profile' && !hasPortalProfile) return false;
    if (terms.length === 0) return true;
    const haystack = normaliseVisitorSearch([
      visitor.name,
      visitor.email,
      visitor.phone || '',
      visitor.portalProfileName || '',
      visitor.portalProfileEmail || '',
    ].join(' '));
    return terms.every(term => haystack.includes(term));
  });
};

export const summarisePastVisitors = (visitors: readonly PastVisitor[]) => ({
  total: visitors.length,
  needsProfile: visitors.filter(visitor => !visitor.promotedToUserId).length,
  portalProfiles: visitors.filter(visitor => Boolean(visitor.promotedToUserId)).length,
  archivedProfiles: visitors.filter(visitor => visitor.promotedToUserId && visitor.portalProfileIsActive === false).length,
});
