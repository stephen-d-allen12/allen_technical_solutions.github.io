// Allen Fish Finder service worker: quick repeat loads, offline use on the water, and each new version
// of the app on the next open.
const SHELL = 'ff-shell-v2';
const TILES = 'ff-v1-tiles'; // the name the first version used, so saved map tiles survive updates
const TILE_HOSTS = ['basemap.nationalmap.gov', 'tile.openstreetmap.org'];
const MAX_TILES = 1500;
/** On a weak signal the saved copy of the page opens after this long instead of waiting on the network. */
const PAGE_WAIT_MS = 3000;

/** Saves the page and every file it needs (script, styles, fonts), so it opens with no signal at all. */
async function saveShell() {
  const c = await caches.open(SHELL);
  const page = await fetch('./', { cache: 'no-cache' });
  if (!page.ok) throw new Error(`page ${page.status}`);
  const files = pageFiles(await page.clone().text(), self.registration.scope);
  await c.addAll(['./manifest.webmanifest', './icon.svg', ...files]);
  for (const css of files.filter((f) => f.endsWith('.css'))) {
    const text = await (await c.match(css)).text();
    await c.addAll([...new Set([...text.matchAll(/url\((?:\.\/)?([^)"']+\.woff2)\)/g)].map((m) => new URL(m[1], css).href))]);
  }
  await c.put('./', page);
}

self.addEventListener('install', (e) => {
  e.waitUntil(saveShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ff-') && k !== SHELL && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

/** The files a page loads from assets/ (its script and styles), as full addresses. */
function pageFiles(html, base) {
  return [...html.matchAll(/(?:src|href)="(?:\.\/)?(assets\/[^"]+)"/g)].map((m) => new URL(m[1], base).href);
}

/** Keeps a newer page for next time: its files first, so the saved copy always works offline. */
async function keepPage(r) {
  const c = await caches.open(SHELL);
  const files = pageFiles(await r.clone().text(), r.url || self.registration.scope);
  await Promise.all(files.map(async (f) => (await c.match(f)) || c.add(f)));
  await c.put('./', r);
  // Drop the last version's script and styles (fonts rarely change and stay).
  for (const k of await c.keys()) if (k.url.includes('/assets/') && !/\.woff2?$/.test(k.url) && !files.includes(k.url)) await c.delete(k);
}

/**
 * The page itself: the newest from the network, so an update shows the next time the app opens. With
 * no signal, or one too weak to answer in a few seconds, the saved copy opens instead, and a late
 * answer still replaces the saved copy for next time.
 */
function openPage(e) {
  const net = fetch(e.request);
  e.waitUntil(net.then((r) => (r.ok && (r.headers.get('content-type') || '').includes('text/html') ? keepPage(r.clone()) : null)).catch(() => {}));
  const saved = caches.open(SHELL).then((c) => c.match('./'));
  const slow = new Promise((done) => setTimeout(done, PAGE_WAIT_MS)).then(() => saved);
  return Promise.race([net.catch(() => saved), slow]).then((first) => first || net);
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
  if (url.origin !== location.origin) return; // Data APIs are cached by the app itself with per-source lifetimes.
  if (req.mode === 'navigate') {
    e.respondWith(openPage(e));
    return;
  }
  // Angler reports change a few times a day: the app fetches and caches them itself, like the data APIs.
  if (url.pathname.includes('/reports/')) return;
  // The page's own files: their names change with every version, so a saved one is always right.
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(req);
    if (hit) return hit;
    const r = await fetch(req);
    if (r.ok) c.put(req, r.clone());
    return r;
  }));
});
