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
    // Since this is a Living Standard, it is imperative that you see the freshest content, so we use a
    // network-then-cache strategy.
    fetch(e.request).then(res => {
      if (!res.ok) {
        throw new Error(`${res.url} is responding with ${res.status}; falling back to cache if possible`);
      }

      const responseForCache = res.clone();
      // Do not return this promise; it's OK if caching fails, and we don't want to block on it.
      caches.open(cacheKey).then(cache => cache.put(e.request, responseForCache));

      return res;
    })
    .catch(() => {
      return caches.match(e.request);
    })
  );
};

self.onactivate = e => {
  e.waitUntil(caches.keys().then(keys => {
    return Promise.all(keys.filter(key => key !== cacheKey).map(key => caches.delete(key)));
  }));
};
