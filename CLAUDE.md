# CLAUDE.md

Panduan untuk Claude (atau AI assistant lain) saat bekerja di repo ini.

## Apa ini

**SinarKeu** — PWA asisten keuangan & rumah tangga pribadi, single-account
maupun multi-akun, dengan sinkronisasi cloud opsional ke Supabase. Vanilla
JS/HTML/CSS, tanpa build step, tanpa framework. Dideploy sebagai static site
(Vercel/Cloudflare Pages/GitHub Pages).

Cakupan sengaja diperluas dari "buku kas digital" murni ke arah household
management: selain pencatatan keuangan (transaksi, anggaran, laporan), ada
Daftar Belanja + Harga Komoditas, Daftar Menu (jadwal masak), dan pengingat
stok bahan pokok — semuanya masih terhubung ke keuangan lewat estimasi
budget & auto-catat pengeluaran. Fitur baru yang searah (household
assistant) boleh diteruskan; bukan penyimpangan dari arah produk.

Bahasa UI: Indonesia (default), dengan dukungan i18n (`js/i18n.js`).
Bahasa komunikasi dengan user: Indonesia, singkat, langsung ke implementasi.

## Menjalankan & testing

Tidak ada build step — buka `index.html` langsung di browser, atau serve
statis (mis. `npx serve .`). Tidak ada test runner otomatis di repo ini;
verifikasi manual lewat browser setelah perubahan.

## Alur kerja lewat chat Claude (upload/download zip)

User kerja di repo ini lewat upload/download `.zip`, bukan lewat git
langsung di chat. Pola yang dipakai:
1. User upload `sinarkeu-main*.zip` → extract ke folder kerja (mis.
   `/home/claude/sinarkeu*/`), baru mulai edit.
2. Setelah selesai, **zip ulang seluruh folder project** (bukan cuma
   file yang diubah) dengan nama folder root tetap `sinarkeu-main/` di
   dalam zip, supaya kalau di-extract user tinggal timpa folder lama.
3. Kirim lewat `present_files` ke `/mnt/user-data/outputs/`.
4. Sesi berikutnya user kemungkinan besar **upload ulang zip terbaru**
   (bukan lanjut dari state chat sebelumnya) — jangan asumsikan file di
   `/home/claude/` dari sesi lama masih relevan/terbaru, selalu extract
   & baca ulang yang baru di-upload sebelum mengedit.
5. Untuk perubahan besar (banyak file/scope luas), pertimbangkan dipecah
   jadi beberapa tahap eksplisit (seperti rombak styling kemarin: Tahap 1
   token dasar, Tahap 2 bersihkan sisa hardcode) — user cenderung suka
   pola ini untuk task besar, bukan sekali jalan tanpa checkpoint.
6. **Cek `toast-error-log.json` di root project SETIAP kali user upload
   zip**, walau tidak diminta eksplisit. File ini (kalau ada) adalah hasil
   ekspor dari panel Setelan → "Log Error" — berisi semua toast merah
   (error) yang tercatat otomatis dari `window.showToast(msg, 'error')`
   (lihat `window._recordToastError` di `js/utils.js`), lengkap dengan
   timestamp, pesan, dan best-effort stack trace. Kalau file ini ada dan
   berisi entri:
   - Telusuri baris kode yang memicu tiap pesan error (grep pesannya di
     `js/*.js`), diagnosis akar masalahnya, dan perbaiki sebisa mungkin
     TANPA user harus jelaskan ulang errornya satu-satu.
   - Sebutkan di respons: error apa saja yang ditemukan di file itu dan
     apa yang sudah/belum bisa diperbaiki (kalau ada yang perlu info
     tambahan dari user, mis. error jaringan yang tergantung environment
     mereka).
   - Jangan hapus/modifikasi `toast-error-log.json` itu sendiri kecuali
     diminta — itu murni artefak diagnosis dari sisi user, bukan bagian
     dari source code app.

## Deploy

Static site murni, tidak ada proses compile/bundle apa pun — file yang ada
di repo ini SAMA PERSIS dengan yang disajikan ke browser.

- **PENTING — service worker cache:** `sw.js` men-cache app shell (semua
  `js/*.js` + `css/style.css` + `index.html`, lihat `APP_SHELL`) dengan
  strategi cache-first untuk aset same-origin. Kalau ada file APAPUN yang
  diubah (JS, CSS, atau daftar `APP_SHELL` itu sendiri) dan itu TIDAK
  dibarengi naikkan `CACHE_VERSION` di `sw.js`, HP user (terutama yang
  sudah install PWA-nya) akan tetap kepakai file LAMA dari cache -- berjam-jam
  bahkan berhari-hari, sampai entah kapan cache-nya kebetulan invalidate
  sendiri. Ini bukan cuma soal "kelihatan belum update", tapi bisa bikin
  bug yang sudah diperbaiki di source code kelihatan seperti masih ada di
  HP user, dan sangat membingungkan untuk didiagnosis kalau lupa soal ini.
  **Aturan: setiap kali menyentuh file apa pun yang ke-load lewat
  `index.html` (semua isi `js/`, `css/style.css`, `manifest.json`, ikon,
  dst), SELALU naikkan `CACHE_VERSION` di `sw.js` (mis. `v6` -> `v7`) di
  commit/perubahan yang sama -- jangan ditunda atau dianggap opsional.**
- **Vercel:** ada `vercel.json` di root yang secara EKSPLISIT mendeklarasikan
  `buildCommand`/`installCommand` sebagai perintah no-op (`echo ...`),
  `outputDirectory: "."`, dan `framework: null`. Ini BUKAN build sungguhan --
  tujuannya cuma supaya Vercel tidak mencoba auto-detect framework/build step
  sendiri (yang pernah bikin preview deployment nyangkut lama di status
  "In Progress" untuk repo tanpa `package.json` seperti ini). Kalau nanti ada
  yang mau menambah proses build SUNGGUHAN (bundler, minifier, dst), ganti isi
  `buildCommand` di `vercel.json` ini -- jangan cuma edit dashboard Vercel,
  supaya config-nya tetap tercermin di repo.
  **Catatan soal isi `headers[]` di `vercel.json`:** jangan tambahkan key
  komentar (mis. `"//"`) di dalam object header rule -- schema Vercel
  menolak additional property apa pun di situ dan bikin deploy gagal saat
  validasi. Taruh penjelasan di sini saja, bukan di file JSON-nya:
  - Rule untuk `/(.*)` = header keamanan global. Vercel TIDAK membaca file
    `_headers` (itu khusus Cloudflare Pages/Netlify), jadi aturannya harus
    diduplikasi di `vercel.json` ini agar posture-nya sama di semua target
    deploy.
  - Rule untuk `/` (Cache-Control `max-age=0, must-revalidate`) = HTML &
    service worker tidak boleh di-cache lama -- kalau tidak, perbaikan tidak
    pernah sampai ke user.
  - Rule untuk `/js/(.*)` (cache 1 tahun, `immutable`) = aman karena aset
    dipanggil dengan `?v=<APP_JS_VERSION>` sehingga URL berubah tiap rilis.
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
  sensitif (`amount`, `category`, `description`, `attachment`, `type`) DULU
  dienkripsi jadi satu kolom `enc_payload` sebelum dikirim ke server — lihat
  `sql/harden_transactions_encryption.sql` untuk migrasi & alasannya. **[ENKRIPSI
  DINONAKTIFKAN]** enkripsi transaksi baru sudah dimatikan (lihat "Catatan
  Insiden: Transaksi Terkunci akibat Rotasi Password" di bawah) — transaksi
  baru ditulis plaintext ke kolom asli. `enc_payload`/`decodeCloudTxRow` di
  `js/crypto.js` hanya dipertahankan untuk membaca baris LAMA yang sempat
  ditulis terenkripsi sebelum perubahan ini.
- **Sinkronisasi antar device:** deteksi konflik untuk row singleton
  (`js/sync-conflict.js`), butuh trigger `updated_at` di server — lihat
  `sql/fix_server_side_updated_at.sql`.
- **Shared book / multi-user (opsional, per-buku):** satu buku kas bisa
  "dibagikan" (`window.skMakeBookShared`, `js/auth.js`) ke user Supabase Auth
  lain dengan role `admin`/`editor`/`viewer` (`book_members` table, RLS
  berbasis `sk_role_for_book(book_id)`/`sk_is_admin(book_id)` — lihat
  `sql/shared_books_roles.sql`, `sql/bootstrap_shared_book.sql`,
  `sql/harden_shared_book_data_rls.sql`). Beda jalur otentikasi dari akun
  lokal biasa: buku shared PAKAI Supabase Auth (login email/password),
  sedangkan buku non-shared cuma pakai anon key + `account_tag` (lihat
  catatan RLS di bawah). Visibility menu per role diatur lewat
  `window.SK_MENU_ITEMS`/`skGetMenuVisible` di `js/auth.js`.
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
| `auth.js` | Supabase Auth (login shared book), role per book (admin/editor/viewer via `window._skSharedRoles`), invite/hapus member, visibility menu per role, halaman "Manajemen User" |
| `budget.js` | Anggaran bulanan & tahunan |
| `electricity-plan.js` | Rencana Listrik: pembagian beban perangkat antar meteran (mis. rumah dengan 2 meteran/tarif berbeda) + estimasi kWh/biaya bulanan per meteran, CRUD meteran & perangkat, viewer-guard sama seperti Daftar Belanja |
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

## Glosarium istilah domain (Indonesia)

Biar tidak salah interpretasi nama fungsi/variabel/fitur:

| Istilah | Artinya |
|---|---|
| Buku Kas / Buku | Satu unit pencatatan keuangan terpisah (mirip "workspace"), user bisa punya banyak buku |
| Buku Induk / Buku Anak | Relasi parent-child antar buku — buku anak bisa "ditutup" dan saldonya mengalir otomatis sebagai entri terkunci ke Kas Organisasi/buku induk |
| Buku Bersama (Shared Book) | Buku yang dibagikan ke user Supabase Auth lain dengan role admin/editor/viewer, beda jalur otentikasi dari akun lokal biasa |
| Akun (account) | Profil lokal terenkripsi password (bukan Supabase Auth) — beda konsep dari "Buku Bersama" di atas, jangan tertukar |
| Fase Kehidupan | Konteks finansial user (mis. lajang/menikah/anak) dipakai buat analisis AI & proyeksi |
| Anggaran (Budget) | Batas pengeluaran per kategori per bulan/tahun |
| Dana Darurat | Target tabungan darurat, biasanya kelipatan pengeluaran bulanan |
| Pengingat Pembayaran | Jadwal tagihan berulang, terpisah dari transaksi biasa |
| Cadangan Data | Menu backup/restore/migrasi (lokal & cloud), sekarang halaman sidebar sendiri, bukan tab Setelan |
| Snapshot Keamanan | Restore point otomatis (safety net), beda dari backup manual biasa |
| account_tag | Tag string yang mengikat baris data cloud ke akun lokal tertentu, dipakai buat filter multi-akun di query Supabase |

## State global penting (`js/config.js`)

Karena tidak ada module system, hampir semua state lintas-modul lewat
`window.*` yang didaftarkan awal di `config.js`. Yang paling sering
relevan saat debugging/nambah fitur:

- `window.txs` — array transaksi buku aktif (in-memory, sumber utama
  render & sync; diisi dari `loadTransactions()`, disimpan lewat
  `saveTransactions()`).
- `window.books` / `window.currentBookId` — daftar buku & buku yang
  sedang aktif.
- `window.budgets` — anggaran per kategori buku aktif.
- `window.globalSupabaseUrl` / `window.globalSupabaseKey` — kredensial
  Supabase (didekripsi saat unlock akun, lihat `crypto.js`/`account.js`).
- `window.deviceId` — ID perangkat ini, dipakai di log & payment log.
- `window._dirtyTxIds` — set id transaksi yang belum ke-push ke cloud
  (dirty-tracking, lihat catatan sync di bawah).
- `window._lastSyncTime` / `window._pushDebounceTimer` — status &
  timer debounce untuk `debouncedPushToCloud()`.
- Kalau nambah state global baru: daftarkan inisialnya di `config.js`
  juga (bukan langsung dipakai tanpa deklarasi), ikuti pola yang sudah
  ada supaya gampang ditemukan.

## Migrasi SQL (`sql/`) — urutan & tujuan

File-file ini dijalankan MANUAL satu-satu di Supabase SQL Editor oleh
user (bukan migration tool otomatis), umumnya harus urut karena saling
mengasumsikan tabel sebelumnya sudah ada:

1. `harden_transactions_encryption.sql` — enkripsi kolom sensitif
   transaksi & backup jadi `enc_payload` (dijalankan sebelum deploy
   kode `crypto.js`/`transaction.js`/`backup.js` versi terenkripsi).
2. `profiles_and_invite.sql` — fondasi tabel `profiles` untuk fitur
   undang anggota (harus sebelum #3).
3. `shared_books_roles.sql` — fondasi Buku Bersama + role admin/
   editor/viewer (setelah #2, lanjut ke #4).
4. `bootstrap_shared_book.sql` — izinkan admin pertama buku bersama
   insert dirinya sendiri ke `book_members` (sekali, setelah #3).
5. `harden_shared_book_data_rls.sql` — opsional, RLS role-based di
   tabel data (`transactions`/`settings`/`payment_reminders`), setelah #3.
6. `menu_visibility.sql` — fitur atur visibilitas menu per role di
   Buku Bersama.
7. `fix_server_side_updated_at.sql` — pastikan `updated_at` selalu
   dari jam server (bukan jam device) untuk deteksi konflik sync.
8. `cleanup_legacy_open_policies.sql` — housekeeping, hapus policy RLS
   legacy/duplikat yang longgar (`qual = true` tanpa syarat) yang
   sempat dibuat manual lewat dashboard.

Kalau menambah migrasi baru: ikuti gaya komentar header panjang (nama
FITUR/FIX/HARDENING + kapan/urutan dijalankan) yang sudah konsisten di
semua file di atas.

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
- **Styling:** semua di `css/style.css`, di-link dari `index.html`. Sejak
  rombak ke palet **"Institutional Formal"** (navy `#1B2A4A`, abu netral,
  aksen emas tipis `#A9832E`, font IBM Plex Sans + Inter tanpa serif),
  **baca `docs/STYLE_GUIDE.md` dulu** sebelum menyentuh styling apa pun —
  berisi tabel lengkap semua token warna/radius/shadow/font (light &
  dark), aturan kapan boleh hardcode warna (kategori transaksi & palet
  chart) vs harus pakai `var(--token)`, cara pakai `color-mix()` untuk
  border turunan, dan catatan khusus `js/report.js` (render PDF terpisah,
  tidak baca CSS variable, jadi punya objek `C`/`CPDF` sendiri yang harus
  disinkronkan manual ke token kalau token di `:root` berubah). Kalau
  nemu hex warna hangat lama (`#7A2E42`, `#B4863A`, `#F6F1E9`, `#2B241D`,
  dst.) di file manapun, itu sisa palet lama yang belum ke-migrate.
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

- Perubahan skema Supabase harus disertai file migrasi baru di `sql/`,
  mengikuti gaya komentar panjang yang menjelaskan masalah + fix (lihat
  file yang sudah ada sebagai contoh format).
- **RLS harus dicek lewat `pg_policies`, bukan cuma file migrasi di repo** —
  beberapa kali ditemukan policy legacy/duplikat (`Allow all`, `allow_all`,
  bahkan `roles = {public}`) yang dibuat langsung lewat Supabase dashboard
  UI, tidak pernah masuk migrasi terversi, dan baru ketahuan lewat query
  manual (lihat `sql/cleanup_legacy_open_policies.sql`). Karena RLS bersifat
  permissive-OR, satu policy longgar yang "nyangkut" bisa membuat semua
  policy ketat lain di tabel yang sama jadi percuma. Kalau menambah/ubah
  policy, verifikasi ulang isi `pg_policies` setelahnya, jangan asumsikan
  state DB sama dengan yang tertulis di `sql/*.sql`.
- `anon_full_access` pada tabel `backups` SENGAJA `qual = true` tanpa syarat
  (dilindungi enkripsi, bukan RLS scoping) — jangan dikira bug dan di-drop.
  Tabel lain (`transactions`, `settings`, `payment_reminders`) yang punya
  nama sama HARUS dibatasi `NOT sk_is_shared_book(book_id)`.
- `js/db.js.bak` adalah file sisa/backup manual yang nyangkut di repo —
  bukan bagian dari build, tidak di-load `index.html`. Aman diabaikan atau
  dihapus; jangan bingung dengan `js/db.js` yang aktif.
- `_headers` (dibaca otomatis oleh Cloudflare Pages) harus berisi header
  keamanan (X-Frame-Options, HSTS, dll) yang TIDAK bisa diset lewat meta
  tag CSP di `index.html` — lihat komentar di bagian atas file `_headers`
  itu sendiri untuk daftar lengkap & alasannya. **Cek isi file ini benar-benar
  ada isinya**, bukan cuma placeholder kosong — sempat ketahuan pernah
  kosong padahal isinya harusnya persis yang didokumentasikan.
- **[FIXED] Tabel `settings` sekarang benar-benar upsert, bukan insert-only
  selamanya:** `window.pushSetting`/`window.pushCryptoSaltCheck` (`js/db.js`)
  sudah lama mengirim `?on_conflict=book_id,key,account_tag`, tapi migrasi
  yang membuat unique constraint `settings_unique_row` untuk itu — sudah
  disebut di komentar kode sebagai `fix_settings_upsert.sql` — ternyata
  tidak pernah ada di `sql/`. Akibatnya push settings (untuk baris
  ber-`account_tag`, yaitu hampir semua device setelah setup) selalu jatuh
  ke INSERT biasa, tabel `settings` menumpuk snapshot historis selamanya,
  dan `pullAllSettings()` (dipanggil TIAP `switchBook()`) makin lama makin
  lambat karena menarik+memproses seluruh riwayat itu tiap kali. File
  migrasi itu sekarang sudah dibuat (`sql/fix_settings_upsert.sql`): dedup
  duplikat lama, buat constraint-nya, plus cron harian untuk baris
  `account_tag IS NULL` (buku Bersama/legacy — tidak tercakup unique
  constraint biasa karena Postgres tidak menganggap NULL=NULL). **PENTING:
  file ini baru dibuat, BELUM TENTU sudah dijalankan di Supabase SQL
  Editor** — cek dulu dengan `SELECT conname FROM pg_constraint WHERE
  conname = 'settings_unique_row';` sebelum asumsikan sudah aktif (lihat
  juga peringatan umum soal ini di bagian bawah file ini: jangan asumsikan
  migrasi di repo = state DB aktual). Tidak ada perubahan JS yang
  dibutuhkan setelah constraint ini ada — kode pemanggilnya sudah siap.

- **[FIXED] Dekripsi settings di `pullAllSettings()` sekarang paralel:**
  sebelumnya satu `for` loop dekripsi baris satu-satu (`await` berurutan),
  sekarang dedup dulu (sinkron), baru baris yang lolos didekripsi paralel
  lewat `Promise.all` sebelum diproses berurutan seperti semula. Ini
  quick-win terpisah dari fix constraint di atas — keduanya saling
  melengkapi (constraint mencegah tabel terus membengkak, paralelisasi
  mempercepat pemrosesan baris yang tersisa).

  (actionType, details)` di `js/transaction.js` tetap simpan ke
  `localStorage` (`sk_logs_<bookId>`, maks 50 entri) untuk tampilan lokal,
  tapi sekarang kalau `window.isOnline()` false ATAU `POST` ke
  `audit_logs` gagal di tengah jalan, `logPayload`-nya dimasukkan ke
  antrean pending terpisah `sk_al_pending_push_<bookId>` (localStorage,
  maks 200 entri) — pola persis sama dengan pending-push
  `payment-reminder.js`. `window.flushPendingAuditLogs(bookId?)` menyisir
  antrean itu (semua buku kalau tanpa argumen) dan di-panggil di titik yang
  sama dengan `flushPendingPaymentReminders()`: `continueAppInit()`,
  `startAutoSync()` interval, dan event listener `online` di `js/app.js`.
  Entri hanya dihapus dari antrean setelah `POST` benar-benar sukses.
  Jangan ubah struktur `logPayload` (`book_id`, `device_id`, `action`,
  `details`, `timestamp`, `account_tag` opsional) — skema tabel
  `audit_logs` di Supabase mengikuti bentuk ini.

- **Modal biasa yang dibuka DI ATAS halaman fullview (mis. `editShoppingListItemModal`
  di atas Belanja Bulanan) HARUS tetap terlihat di layar hp** — lihat
  "Catatan Fix Modal Tertutup di Belakang Halaman Fullview (Mobile)" di
  bawah untuk detail bug & fix-nya. Kalau menambah modal overlay baru yang
  bisa dibuka dari dalam salah satu `FULLVIEW_MODALS`, pastikan tidak
  butuh inline `style="z-index:..."` tambahan — sudah ditangani generik
  lewat rule `body.view-fullpage .modal.show:not(.fullview-modal)` di
  `css/style.css` (dekat blok `@media (max-width: 1023px)` fullview-modal).
  Jangan hapus/turunkan rule itu tanpa cek ulang semua modal yang dibuka
  dari dalam halaman fullview di layar hp.

## Checklist cepat sebelum anggap selesai

Tidak ada test runner, jadi verifikasi ini gantinya — jalankan yang
relevan sesuai jenis perubahan sebelum mengirim hasil ke user:

- **Ubah styling/warna** → grep hex hardcode baru yang lolos dari sistem
  token (lihat perintah di `docs/STYLE_GUIDE.md` bagian 4.7), cek juga
  `js/report.js` (objek `C`/`CPDF`) dan `manifest.json` kalau token
  brand/warna dasar ikut berubah.
- **Ubah apa pun yang menyentuh `txs`/sync** → pikirkan efek ke
  multi-device & multi-tab: apakah perubahan bikin data ke-overwrite
  device lain (cek pola dirty-tracking `window._dirtyTxIds` /
  `debouncedPushToCloud`), apakah aman dipanggil offline lalu online lagi.
- **Ubah/tambah tabel atau policy Supabase** → tambahkan file migrasi
  baru di `sql/` (jangan modifikasi file lama yang sudah "selesai
  dijalankan"), dan ingatkan user query `pg_policies` manual untuk
  verifikasi, jangan asumsikan migrasi di repo = state DB aktual.
- **Tambah teks UI baru** → pakai `data-i18n="key"` + daftarkan di
  `js/i18n.js`, jangan hardcode string kalau elemen sejenis di
  sekitarnya sudah pakai `data-i18n`.
- **Tambah menu/halaman baru** → ikuti pola `FULLVIEW_MODALS` (lihat
  bagian "View vs modal" di atas), bukan bikin mekanisme show/hide baru.
- **Sebelum kirim zip final** → pastikan struktur folder root di dalam
  zip tetap `sinarkeu-main/`, dan `js/db.js.bak` tidak perlu diutak-atik
  (aman diabaikan, bukan bagian aktif aplikasi).



## Catatan Fix Sinkronisasi Buku Bersama (Shopping List)

**Status:** Fix diterapkan pada Juli 2026.

Masalah yang ditemukan:
- Push data shared book sudah berhasil karena request membawa `book_id` dan melalui jalur Supabase Auth.
- Pull data shared book sebelumnya bisa gagal mengambil data yang benar karena jalur pull masih terpengaruh filter data akun lokal (`account_tag`), padahal shared book harus berbasis `book_id` + RLS Supabase.
- Shared book memakai identifier buku dari `window.books[].id` / `window.currentBookId`, bukan `book_id` property terpisah.

Implementasi yang harus dipertahankan:
- Untuk buku shared:
  - Pull settings menggunakan `book_id=eq.<book.id>`.
  - Jangan menambahkan `account_tag` filter pada query shared book.
  - Akses dan pembatasan data diserahkan ke RLS berbasis shared book role.
- Untuk buku non-shared:
  - Tetap gunakan isolasi `account_tag` seperti mekanisme lama.
- Saat melakukan dedup settings:
  - Gunakan kombinasi `(book_id + key)`.
  - Ambil row terbaru berdasarkan `updated_at.desc`.

Testing manual:
1. Device A login sebagai anggota shared book.
2. Tambah/ubah item Daftar Belanja.
3. Pastikan push ke Supabase berhasil.
4. Device B membuka ulang modal Daftar Belanja atau reload aplikasi.
5. Pastikan item terbaru muncul dari cloud.

Jangan mengembalikan filter `account_tag` ke jalur shared book karena dapat membuat data shared terlihat "berhasil tersimpan" tetapi tidak muncul di perangkat anggota lain.


## Catatan Fix Modal Tertutup di Belakang Halaman Fullview (Mobile)

**Status:** Fix diterapkan pada Juli 2026.

**Gejala:** Di menu sidebar Belanja Bulanan, tombol ✎ "Ubah Barang"
(`window.openEditShoppingListItemModal`) terlihat tidak merespons di layar
hp (<1024px) — modal tidak tampil sama sekali, meski di desktop normal.

**Akar masalah:**
`#editShoppingListItemModal` (dan modal biasa lain yang belum di-patch
manual, mis. `budgetModal`, `cardVisibilityModal`, `annualBudgetModal`,
`viewAttachmentModal`, `tutupAnakBukuModal`) hanya memakai z-index bawaan
`.modal` (**1000**). Sementara halaman fullview yang membukanya (mis.
`shoppingListModal`, class `fullview-modal`) di layar hp memakai
`position: fixed; inset: 0; z-index: 2000` (lihat `@media (max-width:
1023px)` di `css/style.css`, dekat komentar "Menu sidebar full-page").
Karena keduanya sama-sama `position: fixed` menutupi seluruh layar dan
latar halaman fullview solid (bukan transparan), modal dengan z-index
lebih rendah (1000) render **tak terlihat & tak bisa disentuh** di
belakangnya. Di desktop (`min-width: 1024px`) `.fullview-modal.show`
memakai `position: static; z-index: auto` (bukan overlay penuh layar),
jadi modal biasa yang `position: fixed` otomatis tampil normal di
atasnya — makanya bug ini HANYA muncul di mobile.

Beberapa modal lain sudah "kebetulan aman" karena sempat dipatch manual
lewat inline `style="z-index:2000"` s/d `"z-index:10000"` (mis.
`manualModal`, `conflictModal`, `customConfirmModal`, `accountUnlockModal`,
`emergencyFundModal`, `firstTimeSetupModal`, `faseKehidupanModal`,
`faseAIModal`) — tapi ini tidak konsisten diterapkan ke semua modal baru,
sehingga bug yang sama berpotensi muncul lagi tiap ada modal baru yang
lupa dikasih z-index tinggi.

**Fix yang diterapkan** (generik, bukan per-ID) di `css/style.css`, di
dalam blok `@media (max-width: 1023px)` fullview-modal:

```css
body.view-fullpage .modal.show:not(.fullview-modal) {
  z-index: 2100;
}
```

Ini menaikkan z-index SEMUA modal non-fullview yang terbuka selagi
`body.view-fullpage` aktif (yaitu selagi salah satu halaman fullview
sedang dibuka), tanpa perlu inline style satu-satu per modal baru.

**Kalau menambah modal overlay baru yang bisa dibuka dari dalam halaman
fullview:** tidak perlu tindakan tambahan, rule generik di atas otomatis
berlaku. Yang PERLU dicek ulang kalau rule ini diubah/dihapus: semua
modal yang dibuka dari `js/shopping-list.js`, `js/budget.js`, `js/book.js`,
dll. yang bisa dipanggil selagi halaman fullview terkait sedang aktif di
layar hp — pastikan masih tampil di atas, bukan di belakang.

## Fitur Duplikat Buku

**Status:** Ditambahkan Juli 2026, di `window.duplicateBook` (`js/book.js`),
tombol "Duplikat" di `renderBookList` (Buku Kas → daftar buku).

Alur: minta nama buku baru (default `"<nama asli> (Salinan)"`), lalu tanya
(via `customConfirm`) apakah transaksi juga ikut disalin. Buku baru dibuat
dulu (push `pushSettingBooks`, rollback state lokal kalau push gagal),
lalu:
- **Selalu otomatis disalin** (lokal + push ke tabel `settings`): item di
  `window.DUPLICATE_BOOK_SETTINGS_MAP` — Anggaran Bulanan, Anggaran Dasar,
  Anggaran Tahunan, visibilitas card, Daftar Belanja + pemasukan
  bulanannya, Fase Kehidupan, target bulan Dana Darurat.
- **Opsional** (tergantung pilihan user): seluruh transaksi, ditarik
  LANGSUNG dari cloud (paginated, bukan cuma `window.txs` yang terbatas
  `MAX_LOCAL_TXS`), didekripsi lalu di-enkripsi ulang dengan `book_id`
  baru dan **id transaksi baru** (bukan salin id lama — mencegah tabrakan
  primary key dengan baris asli), dipush per-batch (300 baris), baru
  disimpan ke cache lokal lewat `trimAndSaveLocal` (supaya
  balanceOffset/incomeOffset/expenseOffset ikut terhitung benar kalau
  jumlahnya besar).
- **SENGAJA TIDAK disalin:** buku bersama (di luar cakupan — beda jalur
  auth/tabel `book_members`/`sk_books`, tombol disembunyikan untuk buku
  ini), log aktivitas, pengingat pembayaran, metadata backup, dan
  `lastClosedAt` (status tutup anak buku milik riwayat buku lama).

Kalau menambah state per-buku baru yang perlu ikut ter-duplikat di masa
depan, tambahkan pasangan `[prefix_localStorage_, key_setting]`-nya ke
`window.DUPLICATE_BOOK_SETTINGS_MAP` (bukan bikin mekanisme salin baru).

## Fix: Setting Buku Bisa "Kosong" Setelah Dijadikan Bersama

**Status:** Ditemukan & diperbaiki Juli 2026.

**Gejala potensial (belum sempat terjadi di produksi, ditemukan lewat
review kode):** Anggaran Bulanan/Dasar/Tahunan, visibilitas Card, Daftar
Belanja + pemasukannya, Fase Kehidupan, dan target Dana Darurat milik
sebuah buku bisa ter-reset kosong untuk SEMUA anggota (termasuk pemilik
asli) begitu ada anggota baru yang login ke buku bersama tersebut.

**Akar masalah:** `window.skMakeBookShared` (`js/auth.js`) sudah
mengonversi `transactions`/`payment_reminders` lama (masih terenkripsi
kunci pemilik) ke plaintext saat buku dijadikan Bersama, TAPI tabel
`settings` (Anggaran, Card, dst -- lihat
`window.DUPLICATE_BOOK_SETTINGS_MAP` di `js/book.js`) terlewat. Alurnya:
anggota baru login → `pullAllSettings()` gagal dekripsi baris setting lama
buku ini (kunci beda) → ditandai `hasStaleRows` → otomatis memicu
`window.reEncryptAllCloudSettings()` (`js/db.js`) → fungsi itu TIDAK cek
status shared, push ulang cache LOKAL device pemicunya sendiri (kosong,
karena anggota baru memang belum pernah punya data aslinya) → karena
tabel `settings` insert-only TANPA kolom `id` (tidak bisa di-PATCH per
baris, lihat `sql/fix_settings_upsert.sql`) dan `pullAllSettings()` pilih
baris ber-`updated_at` TERBARU per (book_id, key), baris kosong itu jadi
"pemenang" di pull berikutnya untuk semua orang.

**Fix (dua lapis):**
1. `window._skConvertBookSettingsToPlaintext(bookId)` (`js/auth.js`) —
   dipanggil tepat setelah `window._skConvertBookDataToPlaintext` di
   `skMakeBookShared`, selagi cache lokal PEMILIK masih membawa nilai
   asli. Push ulang tiap key di `window.DUPLICATE_BOOK_SETTINGS_MAP` lewat
   `window.pushSetting` biasa (otomatis plaintext karena
   `skIsSharedBookId` sudah true di titik ini) — baris plaintext baru ini
   otomatis menang di dedup `updated_at.desc`, TANPA perlu PATCH/hapus
   baris lama (tidak mungkin secara skema, tidak ada kolom `id`).
2. `window.reEncryptAllCloudSettings()` (`js/db.js`) di-guard: `continue`
   untuk buku mana pun yang `skIsSharedBookId(b.id)` true — device siapa
   pun yang memicu fungsi ini (lewat `hasStaleRows`) tidak boleh lagi ikut
   push ulang setting buku bersama dari cache lokalnya sendiri.

Kalau menambah key setting per-buku baru di masa depan: cukup daftarkan di
`window.DUPLICATE_BOOK_SETTINGS_MAP` (dipakai bersama oleh fitur Duplikat
Buku) — fix ini otomatis ikut mencakupnya, tidak perlu sentuh
`js/auth.js`/`js/db.js` lagi.

## Catatan Insiden: Transaksi Terkunci akibat Rotasi Password (Juli 2026)

**Gejala:** 48 transaksi di sebuah buku bersama tampil jumlah 0 / kategori
kosong, dengan `console.warn('[Crypto] Gagal dekripsi transaksi ... OperationError')`
bertumpuk. Baris terkait di database tetap punya `enc_payload` terisi, tapi
kolom plaintext lama (`amount`/`category`/dst) sudah kosong (sudah migrasi ke
`enc_payload`), jadi fallback `decodeCloudTxRow` menampilkan nilai kosong,
bukan error yang jelas.

**Akar masalah:** kunci enkripsi (`window._sessionCryptoKey`) diturunkan dari
password LOKAL per device/akun. Untuk buku bersama, tiap anggota device-nya
sendiri punya kunci sendiri — data yang dienkripsi salah satu anggota TIDAK
BISA didekripsi anggota lain. 48 baris ini ditulis anggota lain dari
device/password mereka sendiri, sehingga permanen tidak terbaca dari device
yang dipakai untuk diagnosis.

**Fix yang sudah diterapkan (bertahap, di beberapa sesi):**
1. Enkripsi field transaksi (`enc_payload`) untuk transaksi BARU **dimatikan**
   (lihat `[ENKRIPSI DINONAKTIFKAN]` di `js/crypto.js`/`js/transaction.js`).
   Semua pemanggil sekarang menulis plaintext ke kolom asli. `enc_payload`
   hanya dipertahankan untuk membaca baris lama.
2. `js/account.js` (form Edit Akun): sebelum diam-diam menganggap field
   password sebagai rotasi kunci, sistem sekarang mengecek dulu apakah
   password yang diketik SAMA dengan yang aktif (lewat `sk_crypto_check`).
   Kalau beda, user WAJIB konfirmasi eksplisit (ketik `GANTI PASSWORD`)
   sebelum kunci benar-benar dirotasi — mencegah rotasi tidak sengaja akibat
   typo.
3. `js/crypto.js` — `window._lockedTxIds` + `window._maybeWarnLockedTx()`:
   setiap kegagalan dekripsi sekarang dicatat, dan sekali per sesi (dipanggil
   dari `pullFromCloudSilently`/`pullAllBooksFromCloud` di `js/transaction.js`
   setelah render) ditampilkan toast ke user kalau ada baris terkunci —
   supaya tidak lagi diam-diam tersembunyi berminggu-minggu seperti kasus ini.
4. `recovery-enc-payload.html` — alat pemulihan sekali-pakai: Tahap 1
   memindai & mencoba kandidat password lama, Tahap 2 menerapkan hasil yang
   berhasil didekripsi ke kolom plaintext. **Tahap 4 (baru):** untuk baris
   yang TETAP terkunci setelah semua kandidat dicoba, tersedia tombol hapus
   permanen (perlu ketik `HAPUS PERMANEN`) — dipakai ketika isi baris memang
   sudah diputuskan tidak perlu/tidak mungkin dipulihkan (mis. anggota yang
   menulisnya sudah tidak diketahui/tidak bisa dihubungi). Jalankan file ini
   langsung dari perangkat, lalu hapus dari server setelah selesai dipakai.

**Kalau kejadian serupa muncul lagi** (baris terkunci baru, bukan transaksi
lama pra-migrasi): karena enkripsi transaksi baru sudah dimatikan, kemungkinan
besar berarti ada device yang masih menjalankan build LAMA (cache service
worker belum ter-update — cek `CACHE_VERSION` di `sw.js` sudah dinaikkan
setelah setiap perubahan) atau ada jalur tulis baru yang belum diaudit untuk
memastikan tidak lagi memanggil fungsi enkripsi transaksi.

## Fix: Satu Pintu Kredensial Supabase di Halaman Setelan (Juli 2026)

**Masalah:** halaman Setelan punya DUA form berbeda untuk mengisi URL & Anon
Key Supabase yang sama: panel "Akun" (`newAccUrl`/`newAccKey`, lewat
`window.editAccount`, dengan alur aman konfirmasi rotasi password) DAN panel
"Koneksi Supabase" (`supabaseUrlInput`/`supabaseKeyInput` + `testCloudConnection`,
langsung menulis ke kunci global lewat `window.reEncryptCredentials`). Bug
turunannya: mengubah kredensial lewat panel "Koneksi Supabase" tidak
memperbarui salinan namespaced per-akun (`sk_a<id>_enc_supabase_url` dkk),
jadi begitu user pindah akun lalu kembali, perubahan itu diam-diam hilang
tertimpa snapshot lama.

**Fix:** panel "Koneksi Supabase" (`index.html`, tab `data-tab-panel="supabase"`)
tidak lagi punya input URL/Key sendiri — sekarang cuma menampilkan URL yang
sedang aktif (read-only, `#supabaseCurrentUrlDisplay`) + tombol "Tes Koneksi"
yang menguji kredensial yang SUDAH tersimpan (tanpa input baru), dan tombol
"Kelola di Panel Akun" yang lompat ke panel Akun & langsung membuka form edit
akun aktif (`window.editAccount`). `window.testCloudConnection()` (`js/settings.js`)
ditulis ulang untuk baca dari `window.globalSupabaseUrl/Key` yang sudah ada,
bukan dari input yang sudah dihapus. Satu-satunya tempat mengisi/mengubah URL
& Anon Key sekarang panel **Akun**. `window.reEncryptCredentials` (`js/crypto.js`)
dipertahankan (tidak dihapus, tidak dipakai lagi) untuk kompatibilitas kalau
dibutuhkan lagi nanti.

Kalau menambah form kredensial Supabase baru di masa depan: jangan buat input
baru di tempat lain — arahkan ke panel Akun (`window.editAccount`) supaya
tetap satu pintu.

## Catatan Insiden: Toast RLS Berulang di Buku yang Terasa Pribadi (Juli 2026)

**Gejala:** toast error RLS (kode 42501, lewat `settings_legacy_anon`) muncul
berulang HANYA saat membuka satu buku tertentu yang menurut user "buku
pribadi biasa" — tidak ada indikasi shared di UI (tidak ada badge/tombol
admin). Menghapus buku itu langsung menghentikan toast, tapi bukunya
"muncul lagi" begitu sync berikutnya jalan.

**Proses diagnosis (penting, karena awalnya menyesatkan):** teori awal
adalah race condition — `window.currentBookId` sempat menunjuk ke buku
bersama lain saat `reEncryptAllCloudSettings`/push jalan. Sudah 2x
percobaan fix berbasis teori ini GAGAL (toast tetap persis sama). Baru
setelah menambahkan diagnostik eksplisit (field `sk_shared_debug` di log
toast, `_recordToastError` di `js/utils.js`) dan user melaporkan pola
"hapus → toast berhenti → buku muncul lagi", ditemukan kontradiksi kunci:
kode `switchBook()` sudah benar urutannya (currentBookId di-set sebelum
pull), jadi race condition seharusnya TIDAK mungkin terjadi seperti yang
dikira. Ini sinyal untuk berhenti menebak dan verifikasi langsung ke server
lewat Supabase SQL Editor.

**Akar masalah sebenarnya — BUKAN race condition, tapi data yatim piatu:**
baris `sk_books` untuk buku ini punya `is_shared = true`, tapi tabel
`book_members` untuk `book_id` itu **kosong total** (tidak ada admin/editor/
viewer sama sekali). Kemungkinan sisa dari percobaan "Jadikan Bersama" yang
gagal separuh jalan (insert `sk_books` sukses, insert baris admin ke
`book_members` gagal/terhapus belakangan).

Akibat dari data yatim ini di dua sisi yang saling kontradiksi:
- **Di database:** `public.sk_book_is_shared(book_id)` (lihat
  `sql/harden_shared_book_data_rls.sql`) HANYA mengecek `sk_books.is_shared`,
  sama sekali tidak peduli `book_members`. Jadi RLS `settings_legacy_anon`
  menganggap buku ini shared → menolak tulisan lewat anon key → toast.
- **Di klien:** `window.skIsSharedBookId()` (`js/auth.js`) cuma cek
  `window._skSharedRoles`, yang diisi dari query `book_members` untuk user
  yang login. Karena `book_members` kosong, TIDAK ADA seorang pun yang
  pernah dapat entri `_skSharedRoles` untuk buku ini — jadi klien meyakini
  ini buku pribadi biasa, tanpa cara mendeteksi sebaliknya.
- **Kenapa "hapus → hilang → muncul lagi":** karena klien tidak tahu buku
  ini shared, `deleteBook()` jalan lewat jalur buku pribadi biasa (cuma
  hapus transaksi/log/settings, TIDAK menyentuh `sk_books`/`book_members` —
  lihat blok `if (b._isShared)` di `js/book.js`). Baris `sk_books` yatim
  itu tetap hidup, dan bukunya balik lagi lewat mekanisme sync blob
  `books` biasa (union-merge di `pullAllSettings`, `js/db.js`) — sama
  sekali tidak ada hubungannya dengan sistem Buku Bersama.

**Fix:** murni data-fix satu baris di server, BUKAN perubahan kode:

```sql
UPDATE public.sk_books SET is_shared = false WHERE id = '<book_id>';
```

Setelah `is_shared` balik `false`, `sk_book_is_shared()` ikut balik `false`,
RLS mengizinkan lagi tulisan anon key, dan toast berhenti permanen tanpa
perlu hapus buku.

**Kalau kejadian serupa muncul lagi** (toast RLS di buku yang "terasa"
pribadi, tidak ada indikasi shared di UI): langsung cek dulu ke Supabase —
bandingkan `sk_books.is_shared` untuk `book_id` itu dengan isi
`book_members` untuk `book_id` yang sama:

```sql
SELECT id, name, is_shared FROM public.sk_books WHERE id = '<book_id>';
SELECT * FROM public.book_members WHERE book_id = '<book_id>';
```

Kalau `is_shared = true` tapi `book_members` kosong (atau tidak mencakup
user yang mengeluh), itu tandanya data yatim piatu seperti kasus ini —
JANGAN buru-buru curiga race condition di `switchBook()`/push-pull seperti
sesi ini di awal, itu jalan buntu yang sudah terbukti 2x salah.

**Perbaikan defense-in-depth yang tetap ditambahkan** (bukan penyebab kasus
ini, tapi menutup celah terkait untuk ke depan):
- `deleteBook()` (`js/book.js`, `[FIX BUG #1]`): untuk buku yang memang
  `_isShared`, sekarang benar-benar menghapus baris `book_members` +
  `sk_books` di server, bukan cuma cache lokal.
- `pushSettingBooks()` (`js/db.js`, `_skDropDeadSharedBooksBeforePush`):
  sebelum push, verifikasi ke server (`sk_books`, query batch) bahwa buku
  yang device ini percaya masih shared (`_isShared`/`window._skSharedRoles`)
  benar-benar masih ada. Kalau tidak, buku itu dibuang dari device ini
  duluan — mencegah device yang lama offline menghidupkan lagi buku
  bersama yang sudah dihapus device/admin lain lewat push blob `books`
  penuh miliknya sendiri.
