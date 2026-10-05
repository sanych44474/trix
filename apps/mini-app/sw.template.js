// Mini App service worker (generated into public/app-v2/sw.js by the build; see vite.config.ts).
// Makes the app open in a gym with no signal: the shell and every chunk of this build are cached
// at install, navigations fall back to the cached shell when the network is down, and hashed
// assets are served from the cache. API calls are left alone -- the logger has its own offline
// handling (logic/offlineSaves.ts). Each build gets a new cache; old ones are dropped on activate.
const VERSION = "__VERSION__";
const CACHE = `trix-app-${VERSION}`;
const BASE = "/app-v2/";
const SHELL = BASE + "index.html";
const ASSETS = __ASSETS__.map((f) => BASE + f);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("trix-app-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate" && (url.pathname === "/app-v2" || url.pathname.startsWith(BASE))) {
    // Network first, so a new release shows up at once; the cached shell only when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit || Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith(BASE + "assets/")) {
    // Hashed file names never change content: cache first.
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })),
    );
  }
});
