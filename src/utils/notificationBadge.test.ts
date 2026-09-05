import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNotificationBadgeLabel,
  getUnreadNotificationCount,
  syncAppNotificationBadge,
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

test('clearing notifications resets both the page and service-worker badge', async () => {
  const calls: string[] = [];
  await syncAppNotificationBadge(0, {
    navigator: {
      clearAppBadge: async () => { calls.push('clear'); },
      setAppBadge: async (count) => { calls.push(`set:${count}`); },
    },
    serviceWorker: {
      controller: {
        postMessage: (message) => calls.push(`worker:${message.unreadCount}`),
      },
    },
  });

  assert.deepEqual(calls.sort(), ['clear', 'set:0', 'worker:0']);
});

test('unread notifications update both badge contexts with a whole positive count', async () => {
  const calls: string[] = [];
  await syncAppNotificationBadge(4.8, {
    navigator: {
      setAppBadge: async (count) => { calls.push(`set:${count}`); },
    },
    serviceWorker: {
      getRegistration: async () => ({
        active: {
          postMessage: (message) => calls.push(`worker:${message.unreadCount}`),
        },
      }),
    },
  });

  assert.deepEqual(calls.sort(), ['set:4', 'worker:4']);
});
