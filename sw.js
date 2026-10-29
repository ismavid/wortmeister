/* Offline shell. Bump CACHE when any asset changes.

   Two rules, both learned from a shipped mixed build:

   1. `cache.addAll` fetches through the HTTP cache, so install can precache a
      copy the CDN has already replaced. That is how wortmeister-v27 came to
      hold the NEW index.html beside the PREVIOUS app.js: the page referenced
      #homemark and the script that fills it was not there. Cache-first then
      served that pair forever, because it never missed. Every precache
      request now bypasses the HTTP cache with {cache:'reload'}.

   2. The shell — the page and its only script — must agree with each other.
      They are small, so they are stale-while-revalidate: served from the
      cache instantly, refreshed in the background, so a mismatch costs one
      launch instead of lasting until the next CACHE bump. Launch stays
      offline-first and instant. The data files are large and immutable, so
      they stay cache-first.

   Matching is always scoped to `CACHE`. A bare `caches.match()` searches
   every cache in creation order, which can hand back a copy from a version
   that activate has not deleted yet.
*/
const CACHE = 'wortmeister-v29';
const ASSETS = [
  './', './index.html', './app.js', './manifest.webmanifest',
  './data/vocab.v1.json', './data/sentences.v1.json', './data/glosses.es.v1.json', './icons/icon-192.png', './icons/icon-512.png'
];
/* the page itself and the script it cannot run without */
const SHELL = /(^|\/)(index\.html|app\.js)$|\/$/;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Put a same-origin success into the current cache. Never store a redirect
    or an error page as if it were the asset. */
function keep(request, res) {
  if (!res || !res.ok || res.type === 'opaque') return res;
  if (new URL(request.url).origin !== location.origin) return res;
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
  return res;
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const shell = url.origin === location.origin && SHELL.test(url.pathname);

  e.respondWith(
    caches.open(CACHE).then(c => c.match(e.request)).then(hit => {
      const net = fetch(e.request)
        .then(res => keep(e.request, res))
        .catch(() => null);
      if (!hit) {
        // first sight of this asset: the network is the only answer there is
        return net.then(res => res ||
          caches.open(CACHE).then(c => c.match('./index.html')));
      }
      // the shell is revalidated in the background so a mismatched pair costs
      // one launch; everything else is immutable and is never re-fetched
      if (shell) e.waitUntil(net);
      return hit;
    })
  );
});
