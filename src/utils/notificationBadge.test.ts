import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNotificationBadgeLabel,
  getUnreadNotificationCount,
} from './notificationBadge.ts';

test('the unread badge is derived from current notification state', () => {
  assert.equal(
    getUnreadNotificationCount([
      { isRead: false },
      { isRead: true },
      { isRead: false },
    ]),
    2,
  );
  assert.equal(getUnreadNotificationCount([{ isRead: true }]), 0);
  assert.equal(getUnreadNotificationCount([]), 0);
});

test('the red badge disappears at zero and caps large counts', () => {
  assert.equal(getNotificationBadgeLabel(0), null);
  assert.equal(getNotificationBadgeLabel(1), '1');
  assert.equal(getNotificationBadgeLabel(9), '9');
  assert.equal(getNotificationBadgeLabel(10), '9+');
});
