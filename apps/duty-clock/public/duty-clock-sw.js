const CACHE_NAME = 'bfc-duty-clock-v1.2.4-notification-badge';
const APP_ROOT = '/duty-clock/app/';
const CORE_FILES = [
  APP_ROOT,
  `${APP_ROOT}index.html`,
  `${APP_ROOT}manifest.webmanifest`,
  `${APP_ROOT}duty-clock-bootstrap.js`,
  `${APP_ROOT}pwa-icon-192.png`,
  `${APP_ROOT}pwa-icon-512.png`,
  `${APP_ROOT}pwa-icon-maskable-512.png`,
  `${APP_ROOT}notification-badge.png`,
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_FILES);
    const response = await fetch(`${APP_ROOT}index.html`, { cache: 'no-store' });
    if (response.ok) {
      const html = await response.clone().text();
      const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map(match => match[1])
        .filter(path => path.startsWith(APP_ROOT));
      await Promise.all(assetPaths.map(path => cache.add(path).catch(() => undefined)));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('bfc-duty-clock-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(APP_ROOT)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(response => response.ok ? response : Promise.reject(new Error('Navigation failed')))
        .catch(async () => (await caches.match(`${APP_ROOT}index.html`)) || Response.error())
    );
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = { body: event.data ? event.data.text() : '' };
    }
    const badgeCount = Math.max(0, Number(payload.badgeCount || 0));
    let notificationIcon = `${APP_ROOT}pwa-icon-192.png`;
    try {
      const iconUrl = new URL(String(payload.icon || ''), self.location.origin);
      if (iconUrl.protocol === 'https:') notificationIcon = iconUrl.href;
    } catch {
      // Retain the installed-app icon when the supplied company logo is invalid.
    }
    await self.registration.showNotification(String(payload.title || 'BFC Portal'), {
      body: String(payload.body || 'You have a new CRM notification.'),
      icon: notificationIcon,
      badge: `${APP_ROOT}notification-badge.png`,
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

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin);
    const notificationId = String(event.notification.data?.notificationId || '');
    if (notificationId) target.searchParams.set('pushNotificationId', notificationId);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === target.origin);
    if (existing) {
      if ('navigate' in existing) await existing.navigate(target.href);
      return existing.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
