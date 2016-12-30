"use strict";

const cacheKey = "v2";
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

  if (needsToBeFresh(e.request)) {
    // Since this is a Living Standard, it is imperative that you see the freshest content, so we use a
    // network-then-cache strategy for the main content.
    e.respondWith(
      fetch(e.request).then(res => {
        refreshCacheFromNetworkResponse(e.request, res);
        return res;
      })
      .catch(() => {
        return caches.match(e.request);
      })
    );
  } else {
    // For auxiliary resources, we can use a cache-then-network strategy; it is OK to not get the freshest.
    e.respondWith(
      caches.match(e.request).then(cachedResponse => {
        const networkFetchPromise = fetch(e.request);

        // Ignore network fetch or caching errors; they just mean we won't be able to refresh the cache.
        networkFetchPromise
          .then(res => refreshCacheFromNetworkResponse(e.request, res))
          .catch(() => {});

        return cachedResponse || networkFetchPromise;
      })
    );
  }
};

self.onactivate = e => {
  e.waitUntil(caches.keys().then(keys => {
    return Promise.all(keys.filter(key => key !== cacheKey).map(key => caches.delete(key)));
  }));
};

function refreshCacheFromNetworkResponse(req, res) {
  if (!res.ok) {
    throw new Error(`${res.url} is responding with ${res.status}`);
  }

  const resForCache = res.clone();

  // Do not return this promise; it's OK if caching fails, and we don't want to block on it.
  caches.open(cacheKey).then(cache => cache.put(req, resForCache));
}

function needsToBeFresh(req) {
  const requestURL = new URL(req.url);
  return requestURL.origin === location.origin && requestURL.pathname === "/";
}
