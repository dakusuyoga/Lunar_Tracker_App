/* Lunar Tracker service worker.
   Cache-first for the heavy, immutable calculation assets (ephemeris data
   files and the WebAssembly engine). After one successful visit they load
   from the device, so slow or flaky connections no longer matter.
   Bump the cache name if the .se1 files or the wasm are ever replaced. */
const CACHE = "lunar-tracker-engine-v1";

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const heavy =
    url.origin === self.location.origin &&
    (url.pathname.endsWith(".se1") || url.pathname.endsWith(".wasm"));
  if (!heavy || event.request.method !== "GET") return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })
  );
});
