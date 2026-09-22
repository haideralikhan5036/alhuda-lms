// ============================================================
// Al-Huda Islamic Centre LMS - Progressive Web App Service Worker
// Version: 1.0.2
// ============================================================

const CACHE_NAME = 'alhuda-lms-pwa-v2';
const CORE_ASSETS = [
  '/',
  '/teacher',
  '/parent',
  '/curriculum_data.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.png',
  '/alhuda_logo.jpg'
];

// 1. Install Event: Cache Core App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch((err) => {
        console.warn('[PWA] Cache prefetch warning (non-fatal):', err);
      });
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Clean up legacy caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PWA] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event: Network-First Strategy with Cache Fallback
// CRITICAL: Bypass Supabase DB queries and dynamic APIs so live updates are never stale
self.addEventListener('fetch', (event) => {
  const reqUrl = new URL(event.request.url);

  // Always fetch live from network for Supabase API calls, mutations, or non-GET requests
  if (
    reqUrl.hostname.includes('supabase.co') ||
    event.request.method !== 'GET' ||
    reqUrl.pathname.startsWith('/rest/v1')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache successful GET responses for app shell
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          networkResponse.type === 'basic'
        ) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache when offline
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/');
          }
        });
      })
  );
});
