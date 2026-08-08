# Panduan Setup SQL — SinarKeu

> **Catatan tentang dokumen ini:** versi sebelumnya dari file ini sempat
> tertimpa tidak sengaja (isinya berubah jadi salinan mentah
> `api/harga-pangan.js`), sehingga skema dasar yang tadinya ada di sini
> hilang dari repo. Dokumen ini ditulis ulang dari nol dengan membaca
> ulang kode aplikasi yang berjalan **saat ini** (bukan menyalin isi lama
> yang sudah tidak ada jejaknya), dan sekarang berfungsi sebagai **indeks
> urutan eksekusi** untuk semua file di `sql/` — bukan tempat menyalin
> ulang isi SQL-nya (supaya tidak ada dua sumber kebenaran yang bisa
> saling berbeda). Untuk isi SQL yang sebenarnya, buka file yang
> direferensikan di setiap langkah.

## Cara pakai

1. Buka **Supabase Dashboard → SQL Editor** pada project yang dipakai
   aplikasi (URL + anon key yang sama dengan `js/config.js` / setup Anda).
2. Jalankan file-file di bawah **satu per satu, sesuai urutan FASE**.
   Semua file idempoten (aman dijalankan ulang — pakai `IF EXISTS`/
   `IF NOT EXISTS`, `CREATE OR REPLACE`), jadi tidak masalah kalau Anda
   perlu mengulang dari awal atau menjalankan ulang project yang sudah
   pernah setup sebagian.
3. Kalau project Anda **sudah berjalan lama** (bukan instalasi baru),
   jalankan dulu query verifikasi di akhir FASE 0 untuk cek skema yang
   sudah ada sebelum menjalankan `CREATE TABLE`.
4. FASE 3 (Buku Bersama) **opsional** — hanya perlu kalau Anda memakai
   fitur berbagi buku dengan anggota lain (role admin/editor/viewer). Buku
   pribadi biasa jalan sempurna hanya dengan FASE 0–2.

---

## FASE 0 — Skema dasar

**File:** [`sql/00_base_schema.sql`](sql/00_base_schema.sql)

Membuat 5 tabel inti: `transactions`, `settings`, `backups`,
`payment_reminders`, `audit_logs`, plus GRANT dasar ke role `anon` &
`authenticated`. **Jalankan ini paling pertama**, sebelum file lain
manapun di folder `sql/`.

Kalau project Anda sudah punya tabel-tabel ini dari setup lama, jalankan
query verifikasi di akhir file tersebut dulu untuk memastikan nama
kolomnya cocok dengan yang diasumsikan file-file di fase berikutnya.

---

## FASE 1 — Keamanan & hardening dasar

Urutan di bawah **penting** — beberapa file saling bergantung.

| # | File | Fungsi |
|---|------|--------|
| 1 | [`sql/supabase_migration_account_tag.sql`](sql/supabase_migration_account_tag.sql) | Tambah kolom `account_tag` ke `settings`/`transactions`/`audit_logs` + index — dasar isolasi data multi-akun dalam satu project Supabase. |
| 2 | [`sql/harden_transactions_encryption.sql`](sql/harden_transactions_encryption.sql) | Tambah kolom `enc_payload` (ciphertext AES-GCM) ke `transactions`/`payment_reminders`, longgarkan `NOT NULL` kolom lama, **aktifkan RLS** + policy `anon_full_access` dasar di `transactions`/`settings`/`backups`/`payment_reminders`/`audit_logs`. |
| 3 | [`sql/fix_settings_upsert.sql`](sql/fix_settings_upsert.sql) | Bersihkan duplikat lama di `settings`, buat unique constraint `settings_unique_row (book_id, key, account_tag)` supaya `on_conflict` di `js/db.js` benar-benar meng-upsert, plus cron harian pembersih baris `account_tag IS NULL`. Butuh extension `pg_cron` — enable dulu lewat **Dashboard → Database → Extensions** kalau `CREATE EXTENSION` di skrip ditolak. |
| 4 | [`sql/fix_server_side_updated_at.sql`](sql/fix_server_side_updated_at.sql) | Trigger supaya `updated_at` selalu dari jam server Postgres (bukan jam device) — mencegah salah menang saat sinkronisasi multi-device akibat jam device yang meleset. |
| 5 | [`sql/perf_query_indexes.sql`](sql/perf_query_indexes.sql) | Index tambahan yang cocok dengan pola query nyata (`book_id + is_deleted + date`, `book_id + updated_at`) — signifikan untuk buku dengan riwayat transaksi besar. |
| 6 | [`sql/cleanup_old_audit_logs.sql`](sql/cleanup_old_audit_logs.sql) | Jadwalkan `pg_cron` untuk hapus otomatis baris `audit_logs` yang lebih tua dari 180 hari, supaya log tidak menumpuk selamanya. |

---

## FASE 2 — Harga Pangan Referensi

**File:** [`sql/fix_rls_harga_pangan_42501.sql`](sql/fix_rls_harga_pangan_42501.sql)

Ini **versi terbaru & lengkap** untuk fitur auto-isi harga di Daftar
Belanja (`js/harga-pangan.js`, proxy `api/harga-pangan.js`) — sudah
menyertakan kolom `region` (dulu file terpisah `add_region_to_harga_
pangan.sql`), GRANT eksplisit (dulu hilang di `harga_pangan_referensi.sql`
versi awal), **dan policy UPDATE** (dulu hilang juga — lihat catatan di
bawah). Cukup jalankan **file ini saja**; `sql/harga_pangan_referensi.sql`
dan `sql/add_region_to_harga_pangan.sql` sudah tidak perlu dijalankan
terpisah untuk instalasi baru (isinya sudah tercakup di sini).

> **Sudah pernah jalankan versi lama file ini dan masih kena error 42501
> `(USING expression)` saat sinkron harga?** Itu tandanya project Anda
> baru punya policy SELECT + INSERT, belum UPDATE — `js/harga-pangan.js`
> mengirim upsert (`on_conflict=commodity_slug,price_date` +
> `Prefer: resolution=merge-duplicates`) yang berubah jadi UPDATE begitu
> device lain sudah menulis harga hari itu duluan. **Jalankan ulang file
> ini** (aman, idempoten) — policy UPDATE yang baru akan otomatis dibuat.

---

## FASE 3 — Buku Bersama & Role (opsional)

Hanya perlu kalau Anda memakai fitur berbagi buku (admin/editor/viewer).
**Urutan wajib** karena tiap file bergantung pada fungsi/tabel dari file
sebelumnya:

| # | File | Fungsi | Bergantung pada |
|---|------|--------|------------------|
| 1 | [`sql/profiles_and_invite.sql`](sql/profiles_and_invite.sql) | Tabel `public.profiles` (salinan id+email dari `auth.users`) + trigger otomatis saat user baru daftar — fondasi untuk cari & undang anggota lewat email. | FASE 0 |
| 2 | [`sql/shared_books_roles.sql`](sql/shared_books_roles.sql) | Tabel `sk_books` & `book_members`, fungsi helper `sk_is_book_admin`/`sk_is_book_member`, RLS role admin/editor/viewer untuk kedua tabel ini. | #1 |
| 3 | [`sql/bootstrap_shared_book.sql`](sql/bootstrap_shared_book.sql) | Policy tambahan supaya admin **pertama** sebuah buku bisa insert dirinya sendiri ke `book_members` (mengatasi ayam-telur: butuh sudah admin untuk bisa jadi admin pertama). | #2 |
| 4 | [`sql/harden_shared_book_data_rls.sql`](sql/harden_shared_book_data_rls.sql) | RLS role-aware di tabel **data** (`transactions`, `settings`, `payment_reminders`) — viewer read-only, editor/admin full akses, ditegakkan di database (bukan cuma UI). Membuat fungsi `sk_role_for_book` & `sk_book_is_shared` yang dipakai banyak file lain sesudah ini. | #2, #3 |
| 5 | [`sql/harden_shared_book_backups_rls.sql`](sql/harden_shared_book_backups_rls.sql) | RLS role-aware khusus tabel `backups` (menutup celah yang tidak tercakup file #4). | #4 |
| 6 | [`sql/protect_last_book_admin.sql`](sql/protect_last_book_admin.sql) | Cegah admin **terakhir** suatu buku menghapus/menurunkan perannya sendiri lewat REST API langsung (transfer admin tetap bisa: tambah admin baru dulu, baru hapus yang lama). | #2 |
| 7 | [`sql/last_login_tracking.sql`](sql/last_login_tracking.sql) | Kolom `last_login_at` di `profiles` + RPC `sk_touch_last_login()` untuk catat kapan anggota terakhir login (ditampilkan di panel Kelola Anggota). | #1 |
| 8 | [`sql/menu_visibility.sql`](sql/menu_visibility.sql) | Kolom `menu_visibility` (JSONB) di `sk_books` — admin bisa atur per-role menu apa yang tampil (Setelan/Backup/Device/Budget/Tambah Transaksi) lewat panel Manajemen User. | #2 |
| 9 | [`sql/universal_payment_reminders.sql`](sql/universal_payment_reminders.sql) | Kolom `is_universal` di `payment_reminders` + fungsi `sk_book_member_signature` + RPC `sk_list_payment_reminders` — pengingat pembayaran ikut tampil di semua buku yang anggotanya persis sama (tim yang sama tidak perlu catat 2x). | #4 |

---

## Lampiran — perbaikan situasional (bukan bagian instalasi baru)

File-file berikut dibuat untuk memperbaiki drift/insiden spesifik di
project yang **sudah berjalan**. Untuk instalasi baru, **lewati semua
ini** — kondisi yang mereka perbaiki tidak akan terjadi kalau FASE 0–3 di
atas diikuti berurutan sejak awal.

- **[`sql/cleanup_legacy_open_policies.sql`](sql/cleanup_legacy_open_policies.sql)** —
  hapus policy RLS lama/duplikat (`qual = true` tanpa syarat) yang sempat
  dibuat manual berkali-kali lewat Dashboard UI di beberapa project lama.
  Jalankan hanya kalau query verifikasi di akhir file itu menunjukkan ada
  policy dengan nama-nama legacy tersebut.
- **[`sql/fix_rls_sync_42501.sql`](sql/fix_rls_sync_42501.sql)** —
  pemulihan policy RLS `settings`/`backups` kalau sempat error 42501/401
  saat sync. Isinya sudah tercakup ulang oleh FASE 3 #4–#5 di atas; hanya
  perlu dijalankan sebagai perbaikan darurat, **setelah** FASE 3 #4
  (butuh fungsi `sk_book_is_shared`).
- **[`sql/fix_bdefault_shared_collision.sql`](sql/fix_bdefault_shared_collision.sql)** —
  migrasi data satu-kali untuk memindahkan buku bersama yang terlanjur
  dibuat dengan ID literal `'b_default'` (bentrok dengan ID buku pribadi
  akun lain) ke ID unik baru. **Sesuaikan `old_id`/`new_id` di dalam
  skrip** sebelum menjalankan — jangan copy-paste apa adanya, skrip ini
  berisi nilai spesifik untuk satu insiden tertentu.

---

## Checklist verifikasi akhir

Setelah menjalankan FASE 0–2 (dan FASE 3 kalau dipakai), cek:

```sql
-- 1. Semua tabel inti ada
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('transactions','settings','backups','payment_reminders',
                      'audit_logs','harga_pangan_referensi',
                      'profiles','sk_books','book_members')
ORDER BY table_name;

-- 2. RLS aktif di semua tabel data
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('transactions','settings','backups','payment_reminders',
                   'audit_logs','harga_pangan_referensi')
ORDER BY relname;

-- 3. Tidak ada policy "terbuka tanpa syarat" yang tersisa selain yang
--    memang disengaja (anon_full_access di backups/audit_logs/payment_reminders
--    dasar dari harden_transactions_encryption.sql, dan harga_pangan_referensi
--    yang memang publik)
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 4. (Kalau FASE 3 dipakai) pg_cron sudah terjadwal
SELECT jobname, schedule, active FROM cron.job
WHERE jobname IN ('sk_cleanup_old_audit_logs','sk_dedupe_null_tag_settings');
```

Kalau semua di atas sesuai ekspektasi (tabel ada, RLS `true`, tidak ada
policy longgar yang tidak disengaja, cron terjadwal), setup selesai —
lanjutkan ke pengaturan `js/config.js` (URL + anon key project ini) di
aplikasi.
