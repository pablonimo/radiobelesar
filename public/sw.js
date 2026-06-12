// Service worker de Radio Belesar.
// Obxectivo: que a mesa de son siga funcionando aínda que caia a rede
// a metade dun programa, e que arranque case instantánea.
//
// Estratexias:
//  - /api/audio/*  -> cache-first (os nomes levan UUID: o contido nunca cambia)
//  - /api/* (GET)  -> network-first con caché de reserva (lista de pads offline)
//  - estáticos     -> stale-while-revalidate (rápido + actualízase en segundo plano)

const APP_CACHE = "rb-app-v1";
const AUDIO_CACHE = "rb-audio-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpamos cachés de versións antigas.
      const keep = new Set([APP_CACHE, AUDIO_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/api/audio/")) {
    event.respondWith(cacheFirst(req, AUDIO_CACHE));
  } else if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(req, APP_CACHE));
  } else {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (hit) return hit;
  const res = await refresh;
  if (res) return res;
  // Navegación sen rede e sen caché exacta: devolvemos a portada cacheada.
  if (req.mode === "navigate") {
    const index = await cache.match("/");
    if (index) return index;
  }
  return Response.error();
}
