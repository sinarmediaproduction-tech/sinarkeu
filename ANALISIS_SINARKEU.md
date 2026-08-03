# Analisis SinarKeu — PWA Asisten Keuangan & Rumah Tangga

> Dianalisis dari `sinarkeu-main (100).zip` — ekstrak & baca: CLAUDE.md,
> SECURITY_AUDIT.md, PERBAIKAN_42501.md, crypto.js, ai.js, forex.js,
> sw.js, _headers, api/, sql/*, dan sebagian modul js/*.

## 1. Apa ini sebenarnya

**SinarKeu** adalah aplikasi asisten keuangan & rumah tangga pribadi berbasis
**PWA** (Progressive Web App), berbahasa Indonesia, berjalan murni di
browser tanpa build step. Awalnya murni "buku kas digital", tapi cakupannya
sengaja diperluas ke sisi rumah tangga yang lebih luas (Daftar Belanja +
Harga Komoditas, Daftar Menu/jadwal masak, pengingat stok bahan pokok) --
semua tetap terhubung ke keuangan lewat estimasi budget & auto-catat
pengeluaran. Ditulis dengan **vanilla JS/HTML/CSS** — tidak ada framework,
tidak ada bundler. Di-deploy sebagai static site (Vercel/Cloudflare
Pages/GitHub Pages). Skala: **~17.000 baris JS** (29 modul), **~4.900 baris
CSS**, **18 migrasi SQL**.

Fitur inti:
- Multi-akun + multi-buku kas (buku induk/anak, duplikasi buku)
- CRUD transaksi, anggaran bulanan/tahunan/dasar, laporan PDF
- Buku Bersama (shared book, multi-user via Supabase Auth + role
  admin/editor/viewer)
- Sinkronisasi cloud Supabase + mode offline + deteksi konflik
- AI analysis & Tanya-AI (via Cloudflare Worker milik user sendiri, Groq LLM)
- Notifikasi Telegram, pengingat pembayaran
- Daftar Belanja bulanan (checklist + auto-catat pengeluaran saat dicentang)
  dengan Harga Komoditas referensi otomatis (PIHPS Bank Indonesia)
- Daftar Menu (jadwal masak mingguan) dengan estimasi belanja yang bisa
  didorong langsung ke Daftar Belanja
- Pengingat stok bahan pokok pada Daftar Belanja — interval "beli lagi"
  dipelajari dari histori pembelian per barang, atau perkiraan umum per
  jenis barang kalau histori belum cukup
- Harga emas Antam + kurs USD/IDR, forecast/proyeksi
- Backup lokal/cloud, snapshot keamanan, migrasi data
- PWA installable, service worker, dark mode, i18n

## 2. Arsitektur

- **Tanpa module system.** Semua `js/*.js` di-load sebagai `<script>` biasa
  dan berbagi state lewat `window.*` (global mutables: `window.txs`,
  `window.books`, `window.currentBookId`, dll).
- **Data lokal:** localStorage (namespaced per akun). **Cloud opsional:**
  Supabase (REST API).
- **PWA:** `manifest.json` + `sw.js` (cache-first app shell, network-first
  untuk navigasi).
- **Deploy:** `vercel.json` no-op (anti auto-detect), `_headers` untuk
  security header di Cloudflare.

**Kekuatan arsitektur:** dokumentasi `CLAUDE.md` sangat rapi (glosarium
domain, konvensi kode, catatan incident, checklist selesai).

## 3. Analisis Keamanan (paling penting)

### ⚠️ Temuan Utama: Enkripsi transaksi DIMATIKAN
`js/crypto.js` & `SECURITY_AUDIT.md` mencatat **enkripsi kolom finansial
transaksi sudah dinonaktifkan**. Alasan: "Catatan Insiden: Transaksi Terkunci
akibat Rotasi Password" (Juli 2026) — saat password dirotasi, anggota buku
bersama lain kehilangan akses dekripsi → 48 transaksi terkunci permanen.
Fix: **transaksi BARU ditulis plaintext ke kolom asli**.

**Implikasi:** untuk buku non-shared, garis pertahanan data finansial
(enkripsi AES-256-GCM client-side) **sudah tidak berlaku untuk transaksi
baru**. Siapa pun yang punya URL + anon key Supabase bisa membaca seluruh
riwayat keuangan secara plaintext lewat REST API. Sisa enkripsi hanya
menyentuh `settings` & `backups` (sebagian sudah di-plaintext-kan untuk
Telegram config).

### ⚠️ Model RLS lemah (diakui sendiri)
App pakai **satu anon key untuk semua user**, tanpa Supabase Auth untuk buku
non-shared. `SECURITY_AUDIT.md`: *"Postgres tidak bisa membedakan siapa yang
meminta lewat anon key — RLS berbasis account_tag adalah kesepakatan
aplikasi, bukan pagar keamanan sungguhan."* Isolasi antar-user mengandalkan
filter sisi client (bisa dilewati via akses API langsung).

### 🟡 RLS legacy pernah bocor
Pernah ditemukan **17 policy legacy duplikat** dengan `qual = true` tanpa
syarat (beberapa `roles = {public}`). Sudah dibersihkan via
`cleanup_legacy_open_policies.sql`, tapi catatan mengingatkan: *"jangan
asumsikan migrasi di repo = state DB aktual."*

### 🟢 Yang sudah baik
- **Password hashing:** PBKDF2 300.000 iterasi + AES-256-GCM — standar kuat.
- **Anti brute-force lock screen:** exponential backoff sampai 5 menit.
- **CSP via meta + `_headers`** (frame-ancestors DENY, HSTS, X-Frame-Options,
  nosniff) — dipisah dengan benar.
- **AI prompt:** data dikirim ke Worker user sendiri; Tanya-AI diwajibkan
  menampilkan rincian transaksi (anti halusinasi angka).
- **Session password** di sessionStorage dengan XOR-obfuscation.
- **`recovery-enc-payload.html`** — alat pemulihan baris terkunci.

## 4. Kualitas Kode & "Karantina" Bug

| Issue | Status |
|---|---|
| RangeError stack overflow saat enkripsi backup besar | ✅ Diperbaiki (chunk 32KB) |
| 17 policy RLS legacy terbuka | ✅ Dibersihkan |
| Settings tumpuk historis (insert-only) | ✅ Diperbaiki (constraint + parallel decrypt) |
| Modal tertutup di belakang fullview (mobile) | ✅ Diperbaiki (z-index generik) |
| Toast RLS 42501 akibat data yatim `sk_books` | ✅ Data-fix + defense-in-depth |
| 48 transaksi terkunci (rotasi password) | ⚠️ Workaround: enkripsi dimatikan |
| Sync shared book salah filter `account_tag` | ✅ Diperbaiki |

Ada `js/db.js.bak` (file sisa, tidak di-load — aman diabaikan, sebaiknya
dihapus).

## 5. Kekuatan vs Kekurangan

**✅ Kekuatan**
- Fitur sangat lengkap & matang
- Dokumentasi (CLAUDE.md, SECURITY_AUDIT, panduan SQL) luar biasa
- Keamanan dasar solid: PBKDF2 kuat, CSP, HSTS, anti-bruteforce
- Offline-first, PWA, sinkronisasi lintas device
- AI terintegrasi dengan guard anti-halusinasi

**⚠️ Kekurangan / Risiko**
1. Transaksi plaintext di cloud (enkripsi dimatikan) — risiko privasi besar
2. RLS tidak mengisolasi user untuk buku non-shared
3. Tanpa automated test sama sekali
4. Global `window.*` — sulit di-maintain saat skala bertambah
5. Beban setup manual (18 migrasi SQL) — tinggi untuk user awam

## 6. Rekomendasi
1. Kembalikan enkripsi transaksi dengan skema aman dari rotasi password
   (mis. kunci per-book, atau Supabase Auth + RLS `auth.uid()` sungguhan).
2. Aktifkan RLS berbasis `auth.uid()` untuk isolasi nyata.
3. Tambahkan minimal smoke test (Playwright) untuk alur transaksi & sync.
4. Hapus `js/db.js.bak` & bersihkan redudansi (`reEncryptCredentials`).
5. Validasi `_headers` benar-benar ter-deploy (pernah ketahuan kosong).

## 7. Verdict
Proyek **sangat kompeten & dirawat dengan disiplin** untuk aplikasi keuangan
pribadi. Satu-satunya "lubang" strategis: **keputusan menonaktifkan enkripsi
transaksi** akibat insiden rotasi password, membuat data finansial di cloud
bergantung sepenuhnya pada kerahasiaan anon key Supabase. Untuk pemakaian
pribadi dengan anon key tidak tersebar, risiko masih bisa diterima; untuk
skala lebih luas, enkripsi & RLS perlu dikembalikan.
