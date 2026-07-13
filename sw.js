// sw.js — cache-first service worker for the app shell. Bump CACHE_VERSION on every release.

const CACHE_VERSION = 'family-budget-v2';

// Paths are resolved relative to this file's location, so the app works at
// https://<user>.github.io/<repo>/ as well as at the domain root.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/state.js',
  './js/calc.js',
  './js/monthEngine.js',
  './js/monthNav.js',
  './js/components.js',
  './js/ui.js',
  './js/exporter.js',
  './js/sync.js',
  './js/views/dashboard.js',
  './js/views/transactions.js',
  './js/views/templates.js',
  './js/views/categories.js',
  './js/views/settings.js',
  './fonts/NotoSansGeorgian-Regular-Georgian.woff2',
  './fonts/NotoSansGeorgian-Regular-Latin.woff2',
  './fonts/NotoSansGeorgian-Bold-Georgian.woff2',
  './fonts/NotoSansGeorgian-Bold-Latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png'
].map((p) => new URL(p, self.registration.scope).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for app shell requests; network-first fallback for anything else (still same-origin only).
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }));
    })
  );
});
