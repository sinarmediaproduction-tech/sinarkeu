# CLAUDE.md

Panduan untuk Claude (atau AI assistant lain) saat bekerja di repo ini.

## Apa ini

**SinarKeu** — PWA pencatatan keuangan pribadi (buku kas digital), single-account
maupun multi-akun, dengan sinkronisasi cloud opsional ke Supabase. Vanilla
JS/HTML/CSS, tanpa build step, tanpa framework. Dideploy sebagai static site
(Vercel/Cloudflare Pages/GitHub Pages).

Bahasa UI: Indonesia (default), dengan dukungan i18n (`js/i18n.js`).
Bahasa komunikasi dengan user: Indonesia, singkat, langsung ke implementasi.

## Menjalankan & testing

Tidak ada build step — buka `index.html` langsung di browser, atau serve
statis (mis. `npx serve .`). Tidak ada test runner otomatis di repo ini;
verifikasi manual lewat browser setelah perubahan.

## Deploy

Static site murni, tidak ada proses compile/bundle apa pun — file yang ada
di repo ini SAMA PERSIS dengan yang disajikan ke browser.

- **Vercel:** ada `vercel.json` di root yang secara EKSPLISIT mendeklarasikan
  `buildCommand`/`installCommand` sebagai perintah no-op (`echo ...`),
  `outputDirectory: "."`, dan `framework: null`. Ini BUKAN build sungguhan --
  tujuannya cuma supaya Vercel tidak mencoba auto-detect framework/build step
  sendiri (yang pernah bikin preview deployment nyangkut lama di status
  "In Progress" untuk repo tanpa `package.json` seperti ini). Kalau nanti ada
  yang mau menambah proses build SUNGGUHAN (bundler, minifier, dst), ganti isi
  `buildCommand` di `vercel.json` ini -- jangan cuma edit dashboard Vercel,
  supaya config-nya tetap tercermin di repo.
- **Cloudflare Pages:** tidak butuh file config build khusus untuk static
  site sepert ini -- cukup set "Build command" KOSONG dan "Build output
  directory" ke `/` di dashboard project-nya. `_headers` di root sudah
  otomatis dibaca Cloudflare Pages untuk custom response header (saat ini
  masih kosong/placeholder).
- **GitHub Pages:** tidak butuh build command sama sekali, langsung serve
  isi repo apa adanya.

## Arsitektur

- **Tanpa bundler.** Semua modul di `js/*.js` di-load sebagai `<script>` tag
  biasa lewat `index.html`, saling berbagi lewat `window.*` (lihat
  `js/config.js` untuk daftar state global: `window.txs`, `window.books`,
  `window.currentBookId`, dll). Tidak ada module system (no `import`/`export`).
- **Data lokal:** localStorage, dengan namespace per akun (multi-account
  isolation — lihat `js/account.js` dan `ACC_GLOBAL_KEYS` di `config.js`).
- **Data cloud (opsional):** Supabase, kredensial user disimpan terenkripsi
  client-side (AES-256-GCM + PBKDF2, lihat `js/crypto.js`). Kolom finansial
  sensitif (`amount`, `category`, `description`, `attachment`, `type`)
  dienkripsi jadi satu kolom `enc_payload` sebelum dikirim ke server — lihat
  `sql/harden_transactions_encryption.sql` untuk migrasi & alasannya.
- **Sinkronisasi antar device:** deteksi konflik untuk row singleton
  (`js/sync-conflict.js`), butuh trigger `updated_at` di server — lihat
  `sql/fix_server_side_updated_at.sql`.
- **PWA:** `manifest.json` + `sw.js` (service worker).

## Struktur modul (`js/`)

| File | Tanggung jawab |
|---|---|
| `app.js` | Bootstrap, koordinasi antar modul, drawer/sidebar |
| `config.js` | Konstanta & state global (`window.*`) |
| `db.js` | Layer database (localStorage + Supabase) |
| `utils.js` | Helper umum |
| `render.js` | Render UI transaksi/card |
| `i18n.js` | Multi-bahasa |
| `transaction.js` | CRUD transaksi |
| `book.js` | Buku Kas (Buku Induk/Anak, multi-buku) |
| `account.js` | Multi-akun, lock/unlock |
| `budget.js` | Anggaran bulanan & tahunan |
| `expense-chart.js` | Grafik pengeluaran |
| `forecast.js` | Proyeksi keuangan |
| `forex.js` | Kurs mata uang asing |
| `report.js` / `report-shortcuts.js` | Laporan bulanan/tahunan |
| `crypto.js` | Enkripsi AES-256-GCM + PBKDF2 |
| `autolock.js` | Auto-lock aplikasi |
| `sync-conflict.js` | Deteksi & resolusi konflik sync |
| `payment-reminder.js` | Pengingat jadwal pembayaran |
| `telegram.js` | Notifikasi Telegram |
| `ai.js` | Analisis keuangan & chat berbasis AI |
| `safety-snapshot.js` | Snapshot Keamanan (restore point otomatis) -- kini di halaman sidebar tersendiri "Cadangan Data" (`dataBackupModal`), bukan tab Setelan lagi |
| `backup.js` | Backup & migrasi data ke cloud -- kini di halaman sidebar tersendiri "Cadangan Data" (`dataBackupModal`), bukan tab Setelan lagi |
| `settings.js` | Panel Setelan (10 tab: akun, telegram, devices, AI, emas, supabase, password, sync, reset, arsip) + `window.openDataBackupView()` untuk halaman "Cadangan Data" (backup, snapshot keamanan & migrasi) yang terpisah dari Setelan |
| `custom-select.js` | Komponen dropdown custom |

`api/emas.js` — endpoint/helper harga emas Antam (dipakai fitur "Harga Emas"
di Setelan).

## Konvensi kode

- **Global-first, bukan modular ES:** fungsi publik didaftarkan sebagai
  `window.namaFungsi = function() {...}`. Ikuti pola ini saat menambah fungsi
  baru, jangan pakai `import`/`export`.
- **Buka modal:** pola `window.open<Nama>Modal()` / `window.open<Nama>()`
  yang lalu memanggil `window.openModal('idModal')`. Tutup dengan
  `window.closeModal('idModal')`.
- **Sidebar/nav:** `#appSidebar` dipakai untuk desktop (permanen, ≥1024px)
  *dan* mobile (drawer overlay via class `.open`, dibuka dari
  `window.openMobileDrawer()` / ditutup `window.closeMobileDrawer()`). Semua
  item nav sidebar sekarang membuka halaman penuh (lihat "View vs modal" di
  bawah) — drawer mobile ikut ditutup otomatis lewat hook di
  `window.openModal()`, tidak perlu dipanggil manual lagi di setiap
  `onclick`. Kalau menambah item nav yang **bukan** full-page (jarang, mis.
  aksi sekali-jalan tanpa halaman), panggil `window.closeMobileDrawer()`
  manual di `onclick`-nya.
- **View vs modal:** Dashboard, Setelan, dan 6 menu sidebar lain (Laporan,
  Anggaran, Pengingat Pembayaran, Buku Kas, Manajemen User, Cadangan Data)
  semuanya tampil sebagai **halaman penuh** di area utama, bukan modal
  mengambang. Cadangan Data (backup lokal/cloud, impor/ekspor, restore, dan
  Migrasi Data ke Cloud) sekarang menu sidebar tersendiri (`dataBackupModal`,
  dibuka lewat `window.openDataBackupView()`) -- BUKAN lagi tab di dalam
  Setelan.
  Mekanismenya digeneralisasi lewat `window.FULLVIEW_MODALS` (map id-modal
  → key-nav, didefinisikan di `js/utils.js`) + class `fullview-modal` di
  markup modal + `body.view-fullpage` (CSS di `css/style.css`, dekat blok
  Setelan). Hook-nya ada di `window.openModal`/`window.closeModal` generik
  (`js/utils.js`) — jadi pemanggil lama seperti `window.openBookManager()` →
  `window.openModal('bookManagerModal')` otomatis jadi full-page tanpa perlu
  diubah satu-satu. Setelan sendiri masih pakai jalur khusus
  (`view-settings` + `openSetelanModal`), tapi saling membersihkan state
  satu sama lain (lihat `showDashboardView`, `openSetelanModal` di
  `js/settings.js`) supaya pindah antar menu tidak tumpang tindih.
  Modal *lain* di luar 6 ini (mis. `addModal`, `editModal`,
  `accountUnlockModal`, `defaultBudgetModal`, `annualBudgetModal`,
  `tutupAnakBukuModal`) tetap modal overlay biasa — termasuk yang dibuka
  dari **dalam** halaman full-page itu sendiri (pola sama seperti Dashboard
  yang juga membuka modal transaksi di atasnya).
  Saat menambah menu sidebar baru yang perlu full-page: (1) tambahkan
  `fullview-modal` ke class modalnya, (2) daftarkan di
  `window.FULLVIEW_MODALS` dan `window.APP_NAV_BTN_MAP`, (3) pastikan
  fungsi pembukanya tetap lewat `window.openModal(id)` — tidak perlu CSS
  atau JS tambahan lain.
- **Styling:** semua di `css/style.css` (bukan `style.css` di root — file itu
  bukan stylesheet asli, abaikan). Palet warna didefinisikan sebagai CSS
  variable di `:root` (`--brand`, `--accent`, `--danger`, dll) — pakai
  variable ini, jangan hardcode hex baru kecuali memang warna baru yang
  disengaja.
- **Ikon:** inline SVG gaya stroke (viewBox 24, stroke-width 2,
  stroke-linecap/linejoin round), bukan file ikon eksternal, agar konsisten
  dengan `.app-nav-item svg` yang sudah ada. Set ikon offline juga tersedia
  di `icons/lucide-icons.local.js`.
- **Keamanan data finansial:** JANGAN kembalikan ke plaintext di kolom lama
  tabel `transactions`/`backups` — enkripsi lewat `crypto.js` adalah fix yang
  disengaja (lihat `SECURITY_AUDIT.md` & `sql/harden_transactions_encryption.sql`).
  Perubahan pada `transaction.js`/`backup.js` yang menyentuh payload data
  harus tetap lewat jalur enkripsi ini.
- **i18n:** teks UI baru yang butuh multi-bahasa pakai `data-i18n="key"` +
  daftarkan key-nya di `js/i18n.js`, jangan hardcode string kalau elemen
  sejenis di sekitarnya sudah pakai `data-i18n`.

## Hal yang perlu hati-hati

- `CATATAN-MERGER-GUDANG.md` di root membahas modul "Gudang Aset" —
  itu dokumentasi proyek lain (**merdeka-main**) yang ikut ke-bundle di sini
  secara tidak sengaja. Abaikan untuk konteks SinarKeu.
- Ada dua file `style.css`: root (`/style.css`, isinya bukan CSS — tampaknya
  file config lain) dan `css/style.css` (yang benar-benar dipakai, di-link
  dari `index.html`). Selalu edit `css/style.css`.
- Perubahan skema Supabase harus disertai file migrasi baru di `sql/`,
  mengikuti gaya komentar panjang yang menjelaskan masalah + fix (lihat
  file yang sudah ada sebagai contoh format).
