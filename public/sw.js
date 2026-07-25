const CACHE = 'bfc-portal-shell-v1';
const SHELL = ['/', '/offline.html', '/manifest.webmanifest', '/theme-init.js', '/favicon.svg', '/pwa-icon-192.png', '/pwa-icon-512.png'];

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
