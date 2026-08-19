import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNotificationDestination,
  getSafeNotificationRoute,
} from './notificationDestination.ts';

const studentId = '018f47c2-4f8a-7d91-8f5a-11c19049bb50';
const licenceId = '018f47c2-720b-7bf0-a494-1bf5c70a83ad';
const bookingId = '018f47c2-8ac6-7bf9-9ad7-b3f708675a88';

test('licence verification opens the exact pending licence in the member editor', () => {
  assert.equal(
    getNotificationDestination({
      type: 'licence_verification',
      metadata: {
        student_id: studentId,
        licence_id: licenceId,
        route: `/students/${studentId}?tab=overview`,
      },
    }),
    `/students/${studentId}?tab=profile&action=review-licence&licenceId=${licenceId}`
  );
});

test('training records open the signed-in pilot own record', () => {
  assert.equal(
    getNotificationDestination(
      { type: 'training_record', metadata: { student_id: studentId } },
      { id: studentId, role: 'pilot' }
    ),
    '/profile?tab=training'
  );
});

test('booking notifications open the booking day with the booking identified', () => {
  assert.equal(
    getNotificationDestination({
      type: 'supervision_assigned',
      bookingId,
    }),
    `/calendar?view=day&bookingId=${bookingId}`
  );
});

test('booking approvals use the same focused day destination', () => {
  assert.equal(
    getNotificationDestination({
      type: 'booking_approval',
      metadata: { booking_id: bookingId },
    }),
    `/calendar?view=day&bookingId=${bookingId}`
  );
});

test('safe portal metadata routes remain available as a fallback', () => {
  assert.equal(getSafeNotificationRoute('/membership?section=renewal'), '/membership?section=renewal');
});

test('Duty Clock break reminders open the portal duty record', () => {
  assert.equal(
    getNotificationDestination({ type: 'duty_break_reminder', metadata: { route: '/duty' } }),
    '/duty'
  );
});

test('external, protocol-relative and unsupported metadata routes are rejected', () => {
  assert.equal(getSafeNotificationRoute('https://example.com/phishing'), null);
  assert.equal(getSafeNotificationRoute('//example.com/phishing'), null);
  assert.equal(getSafeNotificationRoute('/join'), null);
});

test('invalid record identifiers do not create a destination', () => {
  assert.equal(
    getNotificationDestination({
      type: 'licence_verification',
      metadata: { student_id: '../settings', licence_id: 'not-a-licence' },
    }),
    null
  );
});

test('outstanding record notifications target the exact pop-out record', () => {
  const flightLogId = '77777777-7777-4777-8777-777777777777';
  assert.equal(
    getNotificationDestination({
      type: 'outstanding_record',
      metadata: { outstanding_flight_log_id: flightLogId },
    }),
    `/training/outstanding-records?outstandingFlightLogId=${flightLogId}`,
  );
});
