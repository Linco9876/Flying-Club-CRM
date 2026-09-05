const CACHE = 'bfc-portal-shell-v5-badge-reconciliation';
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/theme-init.js', '/favicon.svg', '/pwa-icon-192.png', '/pwa-icon-512.png', '/notification-badge.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('bfc-portal-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/duty-clock/app/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => response.ok ? response : Promise.reject(new Error('Navigation failed')))
        .catch(() => caches.match('/') .then((cached) => cached || caches.match('/offline.html'))),
    );
    return;
  }

  if (!['script', 'style', 'image', 'font'].includes(request.destination)) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const refreshed = fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
      return cached || refreshed;
    }),
  );
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = { body: event.data ? event.data.text() : '' };
    }
    const title = String(payload.title || 'BFC Portal');
    const body = String(payload.body || 'You have a new CRM notification.');
    const badgeCount = Math.max(0, Number(payload.badgeCount || 0));
    let notificationIcon = '/pwa-icon-192.png';
    try {
      const iconUrl = new URL(String(payload.icon || ''), self.location.origin);
      if (iconUrl.protocol === 'https:') notificationIcon = iconUrl.href;
    } catch {
      // Retain the installed-app icon when the supplied company logo is invalid.
    }
    await self.registration.showNotification(title, {
      body,
      icon: notificationIcon,
      badge: '/notification-badge.png',
      tag: String(payload.tag || 'bfc-crm-notification'),
      renotify: true,
      data: {
        url: String(payload.url || '/'),
        notificationId: String(payload.notificationId || ''),
      },
    });
    if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
      if (badgeCount > 0) await self.navigator.setAppBadge(badgeCount);
      else if (typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'SYNC_NOTIFICATION_BADGE') return;
  event.waitUntil((async () => {
    const unreadCount = Math.max(0, Math.floor(Number(event.data.unreadCount || 0)));
    if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
      if (unreadCount > 0) await self.navigator.setAppBadge(unreadCount);
      else {
        if (typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
        await self.navigator.setAppBadge(0);
      }
    }
    if (unreadCount === 0) {
      const deliveredNotifications = await self.registration.getNotifications();
      deliveredNotifications.forEach((notification) => notification.close());
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin);
    const notificationId = String(event.notification.data?.notificationId || '');
    if (notificationId) target.searchParams.set('pushNotificationId', notificationId);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === target.origin);
    if (existing) {
      if ('navigate' in existing) await existing.navigate(target.href);
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
