// Offline support. App files: network first (so updates arrive at once),
// falling back to the cache after a short wait or when offline.
// Trip data: network first so updates arrive, cache when offline.
// Photos: cached once, kept forever.
// Map tiles: cached once seen, so the map also works offline where you looked before.

const CACHE = 'grandtour-v6';
const PHOTOS = 'grandtour-photos';
const TILES = 'grandtour-tiles';
const MAX_TILES = 3000;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'crypto.js',
  'routemap.js',
  'map-data.js',
  'map.js',
  'notes.js',
  'media.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'vendor/fonts/cormorant.woff2',
  'vendor/fonts/cormorant-italic.woff2',
  'vendor/fonts/inter.woff2',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/trip.enc.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('grandtour-') && k !== CACHE && k !== PHOTOS && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fresh(req) {
  const res = await fetch(req, { cache: 'no-cache' });
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function tile(e) {
  const c = await caches.open(TILES);
  const hit = await c.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok) {
    await c.put(e.request, res.clone());
    e.waitUntil(c.keys().then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map((k) => c.delete(k)))));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'GET' && url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(tile(e));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/version.json')) return; // always straight from the network

  if (url.pathname.endsWith('/data/trip.enc.json')) {
    e.respondWith(fresh(e.request).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }

  // Encrypted photos never change (their name is a content hash): cache forever.
  if (url.pathname.includes('/data/img/')) {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  const key = e.request.mode === 'navigate' ? new Request('./') : e.request;
  e.respondWith((async () => {
    const hit = await caches.match(key, { ignoreSearch: true });
    const net = fresh(key);
    if (!hit) return net;
    // Slow or no network: use the cached copy, the download still refreshes the cache.
    const timeout = new Promise((resolve) => setTimeout(() => resolve(hit), 2500));
    e.waitUntil(net.catch(() => {}));
    return Promise.race([net.catch(() => hit), timeout]);
  })());
});
