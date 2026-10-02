/* SafeHer service worker. After changing any app file, rename V (e.g. safeher-v3) so phones fetch the update. */
const V = 'safeher-v10';
const SHELL = ['./', 'index.html', 'style.css','polish.css', 'script.js', 'ui.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  const own = u.origin === location.origin, font = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!own && !font) return; // never cache APIs (translation, SMS, maps)
  e.respondWith(caches.match(r).then(hit => {
    const net = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })
      .catch(() => hit || (r.mode === 'navigate' ? caches.match('index.html') : undefined));
    return hit || net; // cache first, refreshed in the background
  }));
});
