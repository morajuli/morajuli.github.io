/* Service worker — la app funciona sin conexión. build.py actualiza VERSION y ASSETS. */
/* BEGIN-GENERATED */
const VERSION = 'e1980ad6cb';
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./css/styles.css", "./js/app.js", "./js/core/schema.js", "./js/core/utils.js", "./js/finance/analytics.js", "./js/finance/ledger.js", "./js/finance/recurring.js", "./js/io/backup.js", "./js/io/demo.js", "./js/pwa.js", "./js/storage/adapters.js", "./js/storage/store.js", "./js/ui/charts.js", "./js/ui/dom.js", "./js/ui/forms.js", "./js/ui/tx-form.js", "./js/ui/views/analysis.js", "./js/ui/views/common.js", "./js/ui/views/dashboard.js", "./js/ui/views/money.js", "./js/ui/views/plan.js", "./js/ui/views/settings.js", "./js/ui/views/transactions.js", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"];
/* END-GENERATED */
const CACHE = 'finanzas-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('finanzas-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
