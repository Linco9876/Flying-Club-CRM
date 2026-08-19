import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingPurposeNeedsFormalProfile,
  bookingPurposeNeedsTrainingRecord,
  filterPastVisitors,
  mapPastVisitorRow,
  normaliseGuestBookingPurpose,
  summarisePastVisitors,
} from './casualContacts.ts';

test('guest purpose is explicit and vouchers always remain trial flights', () => {
  assert.equal(normaliseGuestBookingPurpose(undefined), 'casual_flight');
  assert.equal(normaliseGuestBookingPurpose('external_flight_review'), 'casual_flight');
  assert.equal(normaliseGuestBookingPurpose('casual_flight', true), 'trial_flight');
});

test('formal reviews and tests require a real portal profile', () => {
  assert.equal(bookingPurposeNeedsFormalProfile('external_flight_review'), true);
  assert.equal(bookingPurposeNeedsFormalProfile('external_flight_test'), true);
  assert.equal(bookingPurposeNeedsFormalProfile('trial_flight'), false);
});

test('casual and trial flights do not create false outstanding lesson records', () => {
  assert.equal(bookingPurposeNeedsTrainingRecord('trial_flight', true), false);
  assert.equal(bookingPurposeNeedsTrainingRecord('casual_flight', true), false);
  assert.equal(bookingPurposeNeedsTrainingRecord('trial_flight', false), false);
  assert.equal(bookingPurposeNeedsTrainingRecord('standard', false), true);
});

test('maps the complete past visitor directory into stable UI values', () => {
  assert.deepEqual(mapPastVisitorRow({
    id: 'contact-1',
    name: 'Robin Example',
    email: 'robin@example.com',
    booking_count: '3',
    guest_booking_count: '2',
    first_booking_at: '2025-04-29T00:00:00Z',
    last_booking_at: '2026-08-01T00:00:00Z',
    promoted_to_user_id: null,
  }), {
    id: 'contact-1',
    name: 'Robin Example',
    email: 'robin@example.com',
    phone: undefined,
    status: 'active',
    promotedToUserId: undefined,
    bookingCount: 3,
    guestBookingCount: 2,
    firstBookingAt: '2025-04-29T00:00:00Z',
    lastBookingAt: '2026-08-01T00:00:00Z',
    portalProfileName: undefined,
    portalProfileEmail: undefined,
    portalProfileIsActive: undefined,
    portalAccessScope: undefined,
  });
});

test('past visitor search and status filters keep every visitor accessible', () => {
  const visitors = [
    mapPastVisitorRow({ id: 'one', name: 'Robin Example', email: 'robin@example.com', booking_count: 2 }),
    mapPastVisitorRow({
      id: 'two',
      name: 'Taylor Visitor',
      email: 'taylor@example.com',
      booking_count: 1,
      promoted_to_user_id: 'user-2',
      promoted_user_name: 'Taylor Member',
      promoted_user_is_active: false,
    }),
  ];

  assert.deepEqual(filterPastVisitors(visitors, 'rob exa', 'all').map(visitor => visitor.id), ['one']);
  assert.deepEqual(filterPastVisitors(visitors, '', 'needs_profile').map(visitor => visitor.id), ['one']);
  assert.deepEqual(filterPastVisitors(visitors, 'member', 'portal_profile').map(visitor => visitor.id), ['two']);
  assert.deepEqual(summarisePastVisitors(visitors), {
    total: 2,
    needsProfile: 1,
    portalProfiles: 1,
    archivedProfiles: 1,
  });
});
