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
- **Known gap — log aktivitas offline tidak di-retry:** `window.addCloudLog
  (actionType, details)` di `js/transaction.js` selalu simpan ke
  `localStorage` (`sk_logs_<bookId>`, maks 50 entri) dulu, lalu coba
  `POST` ke tabel Supabase `audit_logs` HANYA kalau `window.isOnline()`
  true saat itu juga (`if (!window.isOnline()) return;`). Kalau aksi
  (tambah/ubah/**hapus** transaksi, backup, restore, dll — apa pun jenis
  `actionType`-nya, warna tag di UI cuma indikator visual jenis aksi,
  BUKAN penanda status sync) terjadi saat offline, log itu cuma nyangkut
  lokal dan TIDAK PERNAH otomatis ke-push ke Supabase begitu online lagi
  — beda dengan `txs` yang punya dirty-tracking + `debouncedPushToCloud()`
  untuk re-sync. Kalau diminta perbaiki: jangan `return` langsung saat
  offline, taruh ke antrean pending terpisah di localStorage (pola serupa
  dirty-tracking transaksi), lalu flush ke `audit_logs` begitu koneksi
  balik online (jangan hapus dari antrean kalau request-nya gagal, biar
  dicoba ulang). Jangan ubah struktur `logPayload` yang sudah ada
  (`book_id`, `device_id`, `action`, `details`, `timestamp`, `account_tag`
  opsional) — skema tabel `audit_logs` di Supabase mengikuti bentuk ini.

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

