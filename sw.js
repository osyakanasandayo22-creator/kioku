/* Service Worker: app shell cache for offline start */
const CACHE_NAME = "wordorder-shell-v8";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./description-bulb.css",
  "./description-bulb.js",
  "./description-bulb.svg",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./images/icon-192.png",
  "./images/icon-512.png",
  "./images/ロゴ白.png",
  "./images/ロゴ黒.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const res = await fetch(req);
        // cache same-origin static assets opportunistically
        const url = new URL(req.url);
        if (url.origin === self.location.origin) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        // offline fallback: return app shell for navigations
        if (req.mode === "navigate") {
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
        }
        throw new Error("offline");
      }
    })()
  );
});

