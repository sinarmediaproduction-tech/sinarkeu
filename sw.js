/**
 * sw.js — Service Worker Sinarkeu v8
 * Strategi:
 *   - App shell (HTML/CSS/JS lokal) → Cache First
 *   - CDN eksternal (chart.js, html2pdf, fonts) → Cache First + fallback
 *   - Supabase & Telegram API → Network Only (data real-time, jangan di-cache)
 */

const CACHE_NAME = 'sinarkeu-v9-cache-v6';
const STATIC_CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// ── Install: pre-cache resource CDN ──
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_CDN).catch(err => {
        // Gagal cache CDN tidak bloking install
        console.warn('[SW] Gagal pre-cache beberapa resource CDN:', err.message);
      });
    })
  );
});

// ── Activate: hapus cache lama ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Hapus cache lama:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategi ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Supabase & Telegram → Network Only (jangan pernah cache)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.com') ||
    url.hostname === 'api.telegram.org' ||
    url.pathname.includes('/functions/v1/')
  ) {
    return; // biarkan browser handle langsung
  }

  // 2. File app utama (index.html & aset lokal) → Network First, fallback cache
  // cache:'no-store' agar tidak terjebak HTTP cache browser saat online,
  // supaya perubahan kode (mis. JS file) langsung kepakai tanpa stale.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 3. Resource CDN eksternal → Cache First, fallback network
  if (
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('cdn.jsdelivr.net') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 4. Semua request lain → biarkan browser handle
});

// ── Push notification handler (opsional, untuk masa depan) ──
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'Sinarkeu', {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png'
  });
});
