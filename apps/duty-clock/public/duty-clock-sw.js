const CACHE_NAME = 'bfc-duty-clock-v1.1.0';
const APP_ROOT = '/duty-clock/app/';
const CORE_FILES = [
  APP_ROOT,
  `${APP_ROOT}index.html`,
  `${APP_ROOT}manifest.webmanifest`,
  `${APP_ROOT}pwa-icon-192.png`,
  `${APP_ROOT}pwa-icon-512.png`,
  `${APP_ROOT}pwa-icon-maskable-512.png`,
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
    event.respondWith(fetch(request).catch(async () => (await caches.match(`${APP_ROOT}index.html`)) || Response.error()));
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
