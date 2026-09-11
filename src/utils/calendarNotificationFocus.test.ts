import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCalendarTodaySearchParams, resolveCalendarNotificationFocus } from './calendarNotificationFocus.ts';

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

test('Today releases a cancelled booking tomorrow without losing calendar preferences', () => {
  const current = new URLSearchParams(`bookingId=${bookingId}&date=2026-09-12&view=week&resource=aircraft`);
  const bookings = [{ id: bookingId, startTime: '2026-09-12T09:00:00+10:00', status: 'cancelled' }];
  assert.equal(resolveCalendarNotificationFocus(current.get('bookingId'), bookings)?.showCancelled, true);
  const next = buildCalendarTodaySearchParams(current, '2026-09-11');
  assert.equal(next.get('date'), '2026-09-11');
  assert.equal(resolveCalendarNotificationFocus(next.get('bookingId'), bookings), null);
  assert.equal(next.get('view'), 'week');
  assert.equal(next.get('resource'), 'aircraft');
  assert.equal(current.get('bookingId'), bookingId, 'Browser history retains the original explicit booking link');
});

test('Today works without a booking target and removes duplicate stale targets', () => {
  assert.equal(buildCalendarTodaySearchParams(new URLSearchParams(), '2026-09-11').toString(), 'date=2026-09-11');
  const params = new URLSearchParams(`bookingId=${bookingId}&bookingId=${bookingId}&view=list`);
  const next = buildCalendarTodaySearchParams(params, '2026-09-11');
  assert.equal(next.has('bookingId'), false);
  assert.equal(next.get('view'), 'list');
});
