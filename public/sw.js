const CACHE = "steadfast-v3";

const PRECACHE = [
  "/",
  "/icons/brand-mark.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Left to the browser, deliberately: calling respondWith() on a download
  // hands the body back to the page instead of to the download manager, so the
  // APK never lands in the tray and the member sees nothing happen.
  if (url.pathname.endsWith(".apk")) return;

  // Router prefetch payloads. They carry the serialized page for a route and go
  // stale the moment a new build ships, so they must never come from cache.
  if (url.searchParams.has("_rsc")) return;

  // Never cache API calls or auth/session traffic — always hit the network.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/_next/data/")
  ) {
    return;
  }

  // Immutable build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Pages and everything else: network-first, fall back to cache when offline.
  //
  // Each navigation is stored under its own URL. Storing them all under "/"
  // meant the last page visited overwrote the offline copy of the home page, so
  // a flaky load of any protected route could come back as somebody else's HTML
  // — a signed-in member handed the sign-in page. For the same reason there is
  // no "/" fallback: a route with no cached copy shows the browser's offline
  // error rather than silently rendering the wrong page.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.mode === "navigate") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request.url, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
