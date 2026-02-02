const CACHE_NAME = 'fitness-coach-v2';
const urlsToCache = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('fetch', event => {
    if (event.request.url.includes('api.anthropic.com')) return;
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
