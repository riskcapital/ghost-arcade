// Minimal service worker for PWA installability.
// Shrink Wrap is a local-network app, so we use a network-first strategy
// (no aggressive caching — content comes from the desktop app server).

const CACHE_NAME = 'shrinkwrap-v1';
const SHELL_ASSETS = [
  '/',
  '/ShrinkWrapLogo.png',
  '/manifest.json',
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first, fall back to cache for shell assets
self.addEventListener('fetch', (event) => {
  // Skip non-GET and WebSocket requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/ws') || event.request.url.startsWith('ws:')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for shell assets
        if (response.ok && SHELL_ASSETS.some((a) => event.request.url.endsWith(a))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
