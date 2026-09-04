/**
 * Phase 6 — minimal offline support for Fast mode.
 *
 * Fast mode never makes a network call (it is pure client-side compression),
 * so the only thing standing between "works offline" and "blank page" is
 * having the app shell itself in a cache. This is a small
 * stale-while-revalidate: same-origin GET requests are served from cache
 * immediately when available, while a network fetch runs in the background
 * to refresh that entry for next time.
 *
 * On purpose this does NOT intercept cross-origin requests (the AI-mode
 * provider calls to Anthropic/OpenAI/Gemini): those must always hit the
 * network for real, and caching a response containing part of a prompt would
 * work against the "no prompt storage" privacy claim in the FAQ.
 */

const CACHE_NAME = 'promptrim-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
