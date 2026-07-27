/* ============================================================
   SINARKEU — SERVICE WORKER
   Strategi:
   - App shell (HTML/CSS/JS/ikon) di-cache untuk load cepat & offline.
   - Semua request LINTAS ORIGIN (Supabase, API kurs/emas, dsb) DAN semua
     request ke folder /api/ SELALU cache:'no-store' — tidak pernah dijawab
     dari cache. Ini krusial: script.js sudah memaksa `cache:'no-store'`
     di level fetch client Supabase, tapi itu HANYA berlaku untuk request
     yang lewat SW (same-origin). Untuk request lintas origin, SW ini yang
     memastikan tidak ada data lama "nyangkut" di HP/WebView Android atau
     proxy jaringan operator seluler — supaya Supabase tetap satu-satunya
     sumber kebenaran data.
   - Navigasi (index.html) pakai network-first supaya update selalu
     kepakai duluan, dengan fallback ke cache saat offline.
   ============================================================ */

const CACHE_VERSION = 'v4';
const CACHE_NAME = `sinarkeu-shell-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './favicon.ico',
  './icon-192.png',
  './icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/logo-kop.png',
  './icons/lucide-icons.local.js',
  './vendor/supabase.js',
  './js/i18n.js',
  './js/config.js',
  './js/utils.js',
  './js/crypto.js',
  './js/db.js',
  './js/telegram.js',
  './js/account.js',
  './js/book.js',
  './js/transaction.js',
  './js/sync-conflict.js',
  './js/budget.js',
  './js/payment-reminder.js',
  './js/expense-chart.js',
  './js/render.js',
  './js/report.js',
  './js/forecast.js',
  './js/report-shortcuts.js',
  './js/backup.js',
  './js/safety-snapshot.js',
  './js/forex.js',
  './js/ai.js',
  './js/settings.js',
  './js/auth.js',
  './js/autolock.js',
  './js/app.js',
  './js/custom-select.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Hanya urus GET; biarkan POST/PUT/PATCH/DELETE (mis. Supabase mutation)
  // lewat begitu saja tanpa campur tangan SW.
  if (req.method !== 'GET') return;

  // Lintas origin (Supabase, API kurs/emas eksternal, CDN, dll) ATAU
  // endpoint /api/ lokal -> SELALU network, tidak pernah cache.
  const isCrossOrigin = url.origin !== self.location.origin;
  const isApiRoute = url.pathname.startsWith('/api/');
  if (isCrossOrigin || isApiRoute) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(
        () => new Response(null, { status: 503, statusText: 'Offline' })
      )
    );
    return;
  }

  // Navigasi (buka app / refresh) -> network-first, fallback ke cache offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Aset app shell same-origin lainnya -> cache-first, lalu update di
  // belakang layar (stale-while-revalidate) supaya perubahan js/css cepat
  // kepakai di load berikutnya tanpa mengorbankan kecepatan load saat ini.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
