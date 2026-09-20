// =========================================================
// LOGBOOK Service Worker - offline app shell cache
// =========================================================

const CACHE_VERSION = 'v1.3.3';
const CACHE_NAME = `logbook-${CACHE_VERSION}`;

// Build stable, scope-aware URLs. Relative strings in Cache.match() can behave
// differently when the app is deployed below a subpath.
const scopeUrl = new URL('./', self.registration.scope);
const indexUrl = new URL('index.html', scopeUrl).href;
const CORE_SHELL = [
  'index.html',
  'assets/css/styles.css',
  'assets/js/app.js',
  'manifest.webmanifest'
].map(path => new URL(path, scopeUrl).href);
const OPTIONAL_SHELL = [
  'assets/icons/icon.svg',
  'assets/icons/icon-180.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-512-maskable.png'
].map(path => new URL(path, scopeUrl).href);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        // HTML, CSS, JS, and the manifest are required for a working offline app.
        await Promise.all(CORE_SHELL.map(async url => {
          const response = await fetch(url, { cache: 'reload' });
          if (!response.ok) throw new Error(`Precache failed: ${url} (${response.status})`);
          await cache.put(url, response);
        }));

        // A missing icon should not abort service-worker installation.
        await Promise.all(OPTIONAL_SHELL.map(async url => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) await cache.put(url, response);
          } catch (error) {
            console.warn('[Logbook] Could not precache optional asset:', url, error);
          }
        }));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async response => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(indexUrl, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(indexUrl);
          return cached || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then(cached => cached || fetch(request).then(response => {
        const url = new URL(request.url);
        if (url.origin === self.location.origin && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      }))
  );
});
