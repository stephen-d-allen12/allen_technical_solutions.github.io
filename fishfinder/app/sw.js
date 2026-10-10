// Allen Fish Finder service worker: instant repeat loads and offline use on the water.
const VERSION = 'ff-v1';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const TILE_HOSTS = ['basemap.nationalmap.gov', 'tile.openstreetmap.org'];
const MAX_TILES = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ff-v') && !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.includes(url.host)) {
    // Map tiles: cache first, refresh in the background.
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) { c.put(req, r.clone()); trimTiles(); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // Angler reports change a few times a day: the app fetches and caches them itself, like the data APIs.
  if (url.origin === location.origin && !url.pathname.includes('/reports/')) {
    // App shell: stale-while-revalidate.
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
  // Data APIs are cached by the app itself with per-source lifetimes.
});
