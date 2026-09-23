// ============================================================
// Al-Huda Islamic Centre LMS - Zero Cache & Auto Unregister Worker
// ============================================================

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keyList) => Promise.all(keyList.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim())
      .then(() => {
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) => {
            if (client.url && 'navigate' in client) {
              client.navigate(client.url);
            }
          });
        });
      })
  );
});

self.addEventListener('fetch', (event) => {
  // Always fetch live directly from network, no caching
  event.respondWith(fetch(event.request));
});
