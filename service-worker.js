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
        e.waitUntil(refreshCacheFromNetworkResponse(e.request, res));
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
        e.waitUntil(
          networkFetchPromise
            .then(res => refreshCacheFromNetworkResponse(e.request, res))
            .catch(() => {})
        );

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

  return caches.open(cacheKey).then(cache => cache.put(req, resForCache));
}

function needsToBeFresh(req) {
  const requestURL = new URL(req.url);
  return requestURL.origin === location.origin && requestURL.pathname === "/";
}

// From https://github.com/jakearchibald/async-waituntil-polyfill
// Apache 2 License: https://github.com/jakearchibald/async-waituntil-polyfill/blob/master/LICENSE
{
  const waitUntil = ExtendableEvent.prototype.waitUntil;
  const respondWith = FetchEvent.prototype.respondWith;
  const promisesMap = new WeakMap();

  ExtendableEvent.prototype.waitUntil = function(promise) {
    const extendableEvent = this;
    let promises = promisesMap.get(extendableEvent);

    if (promises) {
      promises.push(Promise.resolve(promise));
      return;
    }

    promises = [Promise.resolve(promise)];
    promisesMap.set(extendableEvent, promises);

    // call original method
    return waitUntil.call(extendableEvent, Promise.resolve().then(function processPromises() {
      const len = promises.length;

      // wait for all to settle
      return Promise.all(promises.map(p => p.catch(()=>{}))).then(() => {
        // have new items been added? If so, wait again
        if (promises.length != len) return processPromises();
        // we're done!
        promisesMap.delete(extendableEvent);
        // reject if one of the promises rejected
        return Promise.all(promises);
      });
    }));
  };

  FetchEvent.prototype.respondWith = function(promise) {
    this.waitUntil(promise);
    return respondWith.call(this, promise);
  };
}
