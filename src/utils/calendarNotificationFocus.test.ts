import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCalendarNotificationFocus } from './calendarNotificationFocus.ts';

const bookingId = '018f47c2-8ac6-7bf9-9ad7-b3f708675a88';
const aircraftId = '018f47c2-3fb7-77e0-a3bb-2669f77c51de';
const instructorId = '018f47c2-9202-72f2-9591-1dfa60a427ce';

test('notification focus resolves the exact booking day and resources', () => {
  const focus = resolveCalendarNotificationFocus(bookingId, [{
    id: bookingId,
    startTime: '2026-08-08T00:00:00.000Z',
    aircraftId,
    instructorId,
    status: 'confirmed',
  }]);

  assert.ok(focus);
  assert.equal(focus.bookingId, bookingId);
  assert.equal(focus.date.toISOString(), '2026-08-08T00:00:00.000Z');
  assert.deepEqual(focus.revealResourceIds, [aircraftId, instructorId]);
  assert.equal(focus.showCancelled, false);
  assert.equal(focus.showPending, false);
  assert.equal(focus.showWaitlisted, false);
});

test('notification focus reveals filtered booking states when necessary', () => {
  const cancelled = resolveCalendarNotificationFocus(bookingId, [{
    id: bookingId,
    startTime: '2026-08-08T10:00:00+10:00',
    status: 'cancelled',
    hasConflict: true,
  }]);

  assert.ok(cancelled);
  assert.equal(cancelled.showCancelled, true);
  assert.equal(cancelled.showWaitlisted, true);
});

test('invalid, missing and malformed booking targets are ignored safely', () => {
  assert.equal(resolveCalendarNotificationFocus('../settings', []), null);
  assert.equal(resolveCalendarNotificationFocus(bookingId, []), null);
  assert.equal(resolveCalendarNotificationFocus(bookingId, [{
    id: bookingId,
    startTime: 'not-a-date',
  }]), null);
});
