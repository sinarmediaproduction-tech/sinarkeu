# SinarKeu — Standar Rekayasa (15 Aspek)

Dokumen ini memetakan SinarKeu ke 15 aspek standar rekayasa perangkat lunak:
apa yang **sudah ada**, di **file mana**, dan apa yang **belum** (jujur, dengan
alasan). Status: 🟢 memadai · 🟡 ada tapi terbatas · 🔴 belum ada / risiko.

Konteks penting yang membentuk semua keputusan di bawah: SinarKeu adalah
**PWA vanilla JS tanpa build step**, dipakai oleh sedikit user (pribadi/keluarga),
di-deploy sebagai static site. Banyak praktik "standar industri" sengaja
diadopsi dalam bentuk paling ringan yang tetap efektif — bukan karena tidak
tahu versi lengkapnya, tapi karena versi lengkapnya akan menambah build
pipeline yang bertentangan dengan arsitektur repo ini.

---

## 1. System design 🟢

**Bentuk sistem:** aplikasi *local-first*. Sumber kebenaran utama ada di
perangkat (localStorage), cloud (Supabase) adalah lapisan sinkronisasi
**opsional**. Konsekuensi desain yang disengaja:

- App tetap 100% berfungsi offline / tanpa akun Supabase.
- Konflik antar-device mungkin terjadi → ditangani eksplisit di
  `js/sync-conflict.js` (deteksi konflik row singleton via `updated_at`).
- Tidak ada server aplikasi milik sendiri. Yang ada hanya *proxy stateless*
  (`api/`, Cloudflare Worker) untuk menembus CORS ke sumber data publik.

**Batasan yang diterima:** tanpa server sendiri, tidak ada tempat aman untuk
menyimpan secret per-user selain perangkat user itu sendiri → kredensial
Supabase user dienkripsi client-side (`js/crypto.js`, AES-256-GCM + PBKDF2).

## 2. System architecture 🟢

```
┌──────────────── Browser (PWA) ────────────────┐
│ index.html  →  js/*.js (script klasik, window.*)│
│ state: window.txs / books / currentBookId      │
│ persist: localStorage (namespace per akun)     │
│ offline shell: sw.js (cache-first + versioned) │
└───────┬───────────────────────────┬────────────┘
        │ HTTPS (anon key / JWT)    │ HTTPS
        ▼                           ▼
   ┌─────────┐              ┌──────────────────┐
   │Supabase │              │ Proxy stateless  │
   │ Postgres│              │ api/*.js (Vercel)│
   │ + RLS   │              │ CF Worker (Pages)│
   │ + Auth  │              └────────┬─────────┘
   └─────────┘                       │
                       SISKAPERBAPO / BI PIHPS / emas
```

- **Tanpa bundler / module system.** Semua modul berbagi lewat `window.*`
  (daftar state global di `js/config.js`). Urutan `<script>` di `index.html`
  = urutan dependency; ini fragile tapi disengaja demi "file di repo = file
  yang disajikan".
- **Pembagian modul** ada di tabel `CLAUDE.md` bagian *Struktur modul*.
- **Dua jalur autentikasi berbeda** (lihat §6): buku pribadi (anon key +
  `account_tag`) vs buku bersama (Supabase Auth + role).

## 3. Frontend 🟡

| Aspek | Status |
|---|---|
| Rendering | Manual DOM (`js/render.js`), tanpa virtual DOM |
| Styling | `css/style.css` berbasis design token (CSS custom properties) |
| i18n | `js/i18n.js` (ID default, EN tersedia) |
| Aksesibilitas | Parsial — perlu audit kontras & focus trap modal |
| Offline | Penuh (service worker + localStorage) |
| Cache-busting | `?v=<APP_JS_VERSION>` disuntik saat runtime di `index.html` |

**Utang teknis yang diketahui:** ~149 penggunaan `innerHTML`. Sudah dimitigasi
lewat `escapeHtml`/`escapeJsAttr`, tapi setiap penambahan kode baru harus
disiplin — CI menguji fungsi escaping-nya (`tests/run.mjs`), bukan tiap
call-site-nya.

## 4. APIs & backend logic 🟢

Tidak ada backend milik sendiri; hanya **proxy stateless**:

| Endpoint | Fungsi | Cache edge |
|---|---|---|
| `GET /api/harga-pangan?slugs=` | SISKAPERBAPO (utama) → BI PIHPS (fallback) | `s-maxage=3600` |
| `GET /api/emas` | proxy harga emas | `s-maxage=600` |
| `GET /api/health[?deep=1]` | healthcheck untuk monitoring (**baru**) | `no-store` |

Prinsip: **degradasi bertahap**. Slug yang gagal diambil dilewati, bukan
menggagalkan seluruh request; kalau SISKAPERBAPO tumbang, otomatis jatuh ke BI.

⚠️ Di **GitHub Pages** folder `api/` TIDAK jalan (static murni) → pakai
Cloudflare Worker (`cloudflare-worker-harga-pangan.js`), URL-nya diisi di
Setelan.

## 5. Databases & storage 🟢

- **Lokal:** localStorage, namespace per akun (`js/account.js`, `ACC_GLOBAL_KEYS`).
- **Cloud:** Supabase Postgres. Semua migrasi ada di `sql/` dan bersifat
  idempoten (aman dijalankan ulang di SQL Editor).
- **Cache harga:** tabel `harga_pangan_referensi` (kolom `region` ditambahkan
  belakangan — `sql/add_region_to_harga_pangan.sql`).
- **Enkripsi:** kolom finansial sensitif DULU disatukan ke `enc_payload`.
  **Kini dinonaktifkan untuk data baru** (insiden rotasi password mengunci
  transaksi user); `decodeCloudTxRow` dipertahankan hanya untuk membaca baris lama.
- **Backup:** ekspor/impor manual (`js/backup.js`).
- 🔴 **Belum ada:** backup otomatis terjadwal di sisi Supabase (paket gratis
  tidak menyediakan PITR). Mitigasi: ingatkan user ekspor berkala.

## 6. Auth & permissions 🟡

Dua jalur, sengaja berbeda:

1. **Buku pribadi** — tanpa login server. Anon key + `account_tag`, dikunci
   RLS berbasis tag. Lock lokal: PBKDF2 + auto-lock (`js/autolock.js`).
2. **Buku bersama** — Supabase Auth (email/password), role `admin`/`editor`/
   `viewer` di tabel `book_members`, RLS via `sk_role_for_book(book_id)` /
   `sk_is_admin(book_id)` (`sql/shared_books_roles.sql`,
   `sql/harden_shared_book_data_rls.sql`). Visibilitas menu per role:
   `window.SK_MENU_ITEMS` / `skGetMenuVisible` di `js/auth.js`.

⚠️ **Batas yang harus disadari:** jalur (1) bergantung pada kerahasiaan
`account_tag`. Siapa pun yang tahu tag + anon key bisa membaca data buku itu.
Ini dapat diterima untuk pemakaian pribadi, TIDAK dapat diterima kalau app ini
mau dipakai publik — saat itu tiba, wajib migrasi semua buku ke Supabase Auth.

## 7. Hosting & cloud 🟢

| Target | `api/` jalan? | Header dari |
|---|---|---|
| Vercel | ✅ | `vercel.json` (blok `headers`) |
| Cloudflare Pages | ✅ (Functions) | `_headers` |
| GitHub Pages | ❌ | tidak ada — butuh Worker + fitur harga terbatas |

`vercel.json` mendeklarasikan build sebagai no-op secara eksplisit agar Vercel
tidak mencoba auto-detect framework (pernah bikin deployment nyangkut).

## 8. CI/CD & version control 🟢 *(baru)*

`.github/workflows/ci.yml` — jalan tiap push & PR:

1. **Syntax check** semua `js/*.js` dan `api/*.js` (`node --check`).
2. **Smoke test** `node tests/run.mjs`.
3. **Gate cache-bust** `node tests/check-sw-version.mjs` — memblokir perubahan
   aset yang lupa menaikkan `CACHE_VERSION`. Ini pitfall paling mahal di repo
   ini: tanpa bump, user menjalankan kode LAMA berhari-hari dan bug yang sudah
   diperbaiki tampak masih ada.
4. Validasi `manifest.json` & `vercel.json`.

`.github/workflows/keep-supabase-alive.yml` — ping tiap 3 hari agar project
Supabase gratis tidak di-pause.

## 9. Security 🟡

Sudah ada:
- CSP di `index.html` + `frame-ancestors 'none'`, HSTS, `nosniff`,
  `Permissions-Policy`, `Referrer-Policy` (di `_headers` **dan** `vercel.json`).
- Enkripsi kredensial client-side (`js/crypto.js`).
- RLS aktif di semua tabel; skrip pembersih policy lama:
  `sql/cleanup_legacy_open_policies.sql`.
- Escaping XSS (`escapeHtml` + `escapeJsAttr`), diuji di CI.
- Tidak ada `eval()` (ditegakkan oleh test).

Sisa risiko (jujur):
- 🟡 `'unsafe-inline'` masih ada di `script-src` — dibutuhkan karena app pakai
  inline script & `onclick=` di markup. Menghapusnya butuh refactor besar
  (nonce/event delegation). Ini pelemahan CSP yang nyata, bukan kosmetik.
- 🟡 Anon key terekspos di client (memang desainnya) → keamanan **sepenuhnya**
  bergantung pada kebenaran RLS. Setiap tabel baru WAJIB punya policy eksplisit.
- 🟡 Tidak ada proteksi brute-force pada password lokal selain PBKDF2 + auto-lock.

## 10. Rate limiting 🟡 *(baru)*

`api/_ratelimit.js` — token bucket per-IP:
- `/api/emas` → 20 req/menit/IP
- `/api/harga-pangan` → 15 req/menit/IP
- Membalas `429` + `Retry-After` + header `X-RateLimit-*`.

⚠️ **Keterbatasan yang harus jujur disebut:** serverless itu stateless &
multi-instance, jadi counter in-memory ini hanya berlaku per instance warm.
Cukup untuk meredam loop tak sengaja dan scraper naif; **tidak cukup** untuk
penyerang serius. Untuk itu perlu Upstash Redis / Cloudflare KV — interface
`applyRateLimit()` sengaja dibuat sederhana agar backend-nya gampang diganti.

Rate limit sisi Supabase: bawaan platform (belum dikustomisasi).

## 11. Caching & CDN 🟢

Empat lapis, masing-masing punya tugas berbeda:

| Lapis | Umur | Diatur di |
|---|---|---|
| Service worker (app shell) | sampai `CACHE_VERSION` naik | `sw.js` |
| Browser HTTP cache | JS/CSS 1 tahun `immutable`; HTML `must-revalidate` | `_headers`, `vercel.json` |
| CDN edge (API) | `s-maxage` 10–60 menit | handler `api/*.js` |
| Data aplikasi | harga pangan 6 jam lokal + cache Supabase | `js/harga-pangan.js` |

Kunci kebenarannya: aset di-request dengan `?v=<APP_JS_VERSION>` yang selalu
sama dengan `CACHE_VERSION` (dijaga CI), sehingga aman di-cache `immutable`,
sementara `index.html` dan `sw.js` **tidak pernah** di-cache lama.

## 12. Error tracking & logs 🟢 *(diperkuat)*

- Semua toast error tercatat ke localStorage (`window._recordToastError`,
  `js/utils.js`) → diekspor lewat **Setelan → Log Error**.
- **Baru:** `window.addEventListener('error')` + `'unhandledrejection'`
  menangkap exception yang TIDAK lewat toast (dulu hilang tanpa jejak),
  lengkap dengan file:baris dan potongan stack. Ada `NOISY_MAX` = 25 agar
  badai error tidak memenuhi localStorage.
- Log menyertakan `book_id`, `device_id`, status buku bersama — dirancang
  untuk mendiagnosis RLS 42501 yang sulit direproduksi.
- 🔴 Belum ada agregator terpusat (Sentry). Alasan: butuh script pihak ketiga
  (pelebaran CSP) dan mengirim data keuangan pribadi ke vendor. Ekspor manual
  dianggap cukup untuk skala pemakaian saat ini.

## 13. Monitoring & alerts 🟡 *(baru)*

- `GET /api/health` → `{status, checks}`; `?deep=1` ikut mem-ping upstream.
  Membalas **503** saat degraded agar terdeteksi uptime monitor mana pun.
- `.github/workflows/uptime-check.yml` — cek tiap 6 jam (halaman utama +
  healthcheck). Gagal → run merah → email otomatis dari GitHub.
- 🔴 Belum ada alert real-time (paging). Untuk itu pasang UptimeRobot/
  BetterStack ke `/api/health` — sudah siap pakai, tinggal daftar.

## 14. Testing 🟡 *(baru)*

`node tests/run.mjs` — runner tanpa dependency npm (menambah Jest berarti
menambah `node_modules` + build step yang bertentangan dengan arsitektur repo).

Yang dites: eksekusi `js/utils.js`, escaping XSS (`<>`, `"`, `'`), roundtrip
`rp()`/`unRp()`, tidak ada `eval()`, CSP terpasang, endpoint punya rate limit,
konsistensi `CACHE_VERSION` ↔ `APP_JS_VERSION` ↔ `APP_SHELL`.

> Test ini langsung menemukan **bug nyata** saat pertama dijalankan:
> `unRp()` membuang tanda minus, sehingga `-Rp 5.000` terbaca `5000` (nilai
> negatif berbalik jadi positif saat teks terformat dibaca ulang, mis. di
> `animateValue`). Sudah diperbaiki di `js/utils.js`.

🔴 **Belum ada:** test alur UI end-to-end (butuh DOM + sesi Supabase).
Prosedur verifikasi manualnya ada di `TESTING.md`.

## 15. Scaling 🟢 *(untuk skala yang dituju)*

Beban baca hampir seluruhnya ditanggung perangkat user (local-first), jadi
penambahan user hampir tidak menambah beban server. Titik jenuh yang nyata,
berurutan:

1. **Supabase free tier** (500 MB DB / 5 GB bandwidth) — pemicu pertama.
2. **Scraping SISKAPERBAPO** — biayanya per-request ke pihak ketiga, bukan
   per-user. Sudah dijinakkan: cron Worker harian 23:00 WIB menulis ke cache
   Supabase, jadi jumlah user tidak menambah jumlah scraping.
3. **Cold start serverless** — tidak relevan di jalur kritis (fitur harga
   bersifat pelengkap).

Kalau harus naik kelas: (a) Supabase berbayar, (b) rate limiter pindah ke
Cloudflare KV, (c) pertimbangkan bundling/minify — saat itu ganti isi
`buildCommand` di `vercel.json`, jangan hanya di dashboard.

---

## Ringkasan perubahan pada iterasi ini

| Aspek | Perubahan |
|---|---|
| Rate limiting | `api/_ratelimit.js` baru; dipasang di `emas` & `harga-pangan` (429 + `Retry-After`) |
| Testing | `tests/run.mjs` + `tests/check-sw-version.mjs` (8 test, semua lulus) |
| CI/CD | `.github/workflows/ci.yml` (syntax, test, gate cache-bust, validasi JSON) |
| Monitoring | `api/health.js` + `.github/workflows/uptime-check.yml` |
| Error tracking | Handler global `error` + `unhandledrejection` di `js/utils.js` |
| Caching & CDN | `_headers` diperluas; `vercel.json` kini punya blok `headers` |
| Security | `Permissions-Policy`, COOP ditambahkan di kedua target deploy |
| Bug fix | `unRp()` tidak lagi membuang tanda minus (ditemukan oleh test) |
| Cache-bust | `CACHE_VERSION` & `APP_JS_VERSION` v32 → **v33** |
