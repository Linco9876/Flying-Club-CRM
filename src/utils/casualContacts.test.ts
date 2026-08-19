import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingPurposeNeedsFormalProfile,
  bookingPurposeNeedsTrainingRecord,
  mapCasualContactSearchRow,
  normaliseGuestBookingPurpose,
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

test('maps database contact history into stable UI values', () => {
  assert.deepEqual(mapCasualContactSearchRow({
    id: 'contact-1',
    name: 'Robin Example',
    email: 'robin@example.com',
    booking_count: '3',
    promoted_to_user_id: null,
  }), {
    id: 'contact-1',
    name: 'Robin Example',
    email: 'robin@example.com',
    phone: undefined,
    status: 'active',
    promotedToUserId: undefined,
    bookingCount: 3,
    lastBookingAt: undefined,
  });
});
