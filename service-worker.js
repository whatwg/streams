"use strict";
// Largely based on https://css-tricks.com/serviceworker-for-offline/

const cacheKey = "v1";
const toCache = [
  "/",
  "https://resources.whatwg.org/standard.css",
  "https://resources.whatwg.org/bikeshed.css",
  "https://resources.whatwg.org/file-issue.js",
  "https://resources.whatwg.org/commit-snapshot-shortcut-key.js",
  "https://resources.whatwg.org/logo-streams.svg"
];

self.oninstall = e => {
  e.waitUntil(caches.open(cacheKey).then(cache => cache.addAll(toCache)));
};

self.onfetch = e => {
  if (e.request.method !== "GET") {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      // Respond with the cached response if it exists, but still do the network fetch in order to refresh the cache.
      // Ignore network fetch errors; they just mean we won't be able to cache.
      const networkFetchPromise = fetch(e.request).then(refreshCacheFromNetworkResponse).catch(() => {});

      return cachedResponse || networkFetchPromise;
    })
  );

  function refreshCacheFromNetworkResponse(response) {
    const responseForCache = response.clone();

    // Ignore any errors while caching.
    caches.open(cacheKey).then(cache => cache.put(e.request, responseForCache));

    return response;
  }
};

self.onactivate = e => {
  e.waitUntil(caches.keys().then(keys => {
    return Promise.all(keys.filter(key => key !== cacheKey).map(key => caches.delete(key)));
  }));
};
