// ============================================================
// Al-Huda Islamic Centre LMS - Progressive Web App Service Worker
// Version: 1.0.4 - Zero-Stale HTML Cache Policy
// ============================================================

const CACHE_NAME = 'alhuda-lms-pwa-v4';
const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.png',
  '/alhuda_logo.jpg'
];

// 1. Install Event: Cache only static media assets, never HTML
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[PWA] Cache prefetch warning:', err);
      });
    })
  );
  self.skipWaiting();
});

// 2. Activate Event: Clean up all legacy caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PWA] Purging outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 3. Fetch Event: HTML pages are ALWAYS Network-First with zero caching
self.addEventListener('fetch', (event) => {
  const reqUrl = new URL(event.request.url);

  // Always bypass Supabase DB queries and mutations
  if (
    reqUrl.hostname.includes('supabase.co') ||
    event.request.method !== 'GET' ||
    reqUrl.pathname.startsWith('/rest/v1')
  ) {
    return;
  }

  const isHtmlRequest = event.request.headers.get('accept')?.includes('text/html') ||
                        reqUrl.pathname === '/' ||
                        reqUrl.pathname.endsWith('.html') ||
                        reqUrl.pathname === '/teacher' ||
                        reqUrl.pathname === '/parent';

  if (isHtmlRequest) {
    // ALWAYS fetch live HTML from network, never stale cache
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Static Assets: Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
