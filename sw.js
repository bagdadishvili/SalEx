// sw.js — service worker: NETWORK-FIRST for the app's own files, cache as offline fallback.
// Online, every open loads the newest version from GitHub Pages automatically; offline,
// the last cached copy is used. Your budget data is NOT here (it lives in localStorage /
// IndexedDB), so updating or clearing this cache never touches it.
// Still bump CACHE_VERSION on releases — it forces a clean re-download of the app shell.

const CACHE_VERSION = 'family-budget-v10';
const NETWORK_TIMEOUT_MS = 4000;

// Paths are resolved relative to this file's location, so the app works at
// https://<user>.github.io/<repo>/ as well as at the domain root.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/state.js',
  './js/backup.js',
  './js/records.js',
  './js/envelope.js',
  './js/starterPack.js',
  './js/prepare.js',
  './js/calc.js',
  './js/monthEngine.js',
  './js/monthNav.js',
  './js/components.js',
  './js/ui.js',
  './js/exporter.js',
  './js/sync.js',
  './js/rates.js',
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
    caches.open(CACHE_VERSION)
      // cache: 'reload' bypasses the browser HTTP cache so we store truly fresh files.
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fromNetwork(request) {
  return fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response && response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
    }
    return response;
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // Only our own files. GitHub API, exchange-rate APIs etc. go straight to the network.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const network = fromNetwork(request);
    network.catch(() => {}); // handled below; avoid 'unhandled rejection' noise
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
    try {
      const fast = await Promise.race([network, timeout]);
      if (fast) return fast;
    } catch { /* offline or failed — fall through to cache */ }

    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await network; // slow network but no cache — keep waiting
    } catch {
      if (request.mode === 'navigate') {
        const shell = await caches.match(new URL('./index.html', self.registration.scope).toString());
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
