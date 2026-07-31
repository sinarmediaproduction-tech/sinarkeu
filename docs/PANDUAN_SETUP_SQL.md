# Panduan Setup SQL — SinarKeu

Urutan lengkap semua skrip di folder `sql/` (+ `supabase_migration_account_tag.sql`
di root) supaya aplikasi berjalan penuh di sebuah project Supabase. Jalankan
tiap skrip lewat **Supabase Dashboard → SQL Editor**, satu per satu, sesuai
urutan nomor di bawah. Semua skrip aman dijalankan ulang (idempotent) kecuali
disebutkan lain.

## Prasyarat yang TIDAK ada di repo ini

Tabel dasar berikut **harus sudah ada** di project Supabase kamu sebelum
memulai (dibuat manual lewat dashboard/Table Editor saat setup awal, bukan
lewat migrasi bervensi di repo ini):

- `transactions`
- `settings`
- `backups`
- `payment_reminders`
- `audit_logs`

Kalau kamu bikin project Supabase **baru dari nol** dan belum punya
tabel-tabel ini, buat dulu strukturnya (kolom minimal: `id`, `book_id`, kolom
data masing-masing, `updated_at`/`created_at`) sebelum lanjut ke Grup 1 di
bawah — semua skrip di sini cuma menambah kolom/index/RLS/trigger ke tabel
yang sudah ada, bukan membuat tabelnya dari awal.

---

## Grup 1 — Fondasi umum (WAJIB, berlaku untuk semua mode: buku pribadi maupun bersama)

Jalankan berurutan:

1. **`supabase_migration_account_tag.sql`** (di root project, bukan folder `sql/`)
   Tambah kolom `account_tag` + index ke `settings`, `transactions`, `audit_logs` — dasar isolasi data multi-akun untuk buku pribadi.
2. **`sql/fix_settings_upsert.sql`**
   Bikin `settings` benar-benar ter-upsert (unique constraint), bukan terus insert baris baru.
3. **`sql/fix_server_side_updated_at.sql`**
   `updated_at` diisi jam SERVER, bukan jam device — penting untuk resolusi konflik multi-device.
4. **`sql/harden_transactions_encryption.sql`**
   Nyalakan RLS dasar + siapkan kolom `enc_payload` (transaksi) untuk enkripsi client-side.
5. **`sql/perf_query_indexes.sql`**
   Index performa untuk pola query buka/pindah buku (butuh kolom `account_tag` dari langkah #1).
6. **`sql/harga_pangan_referensi.sql`**
   Tabel cache harga pangan publik (fitur Daftar Belanja) — independen, boleh dilewati kalau fitur ini tidak dipakai.
7. **`sql/cleanup_old_audit_logs.sql`** *(opsional)*
   Retensi otomatis `audit_logs` 180 hari lewat `pg_cron`. Perlu extension `pg_cron` aktif di project.

---

## Grup 2 — Buku Bersama (OPSIONAL, hanya kalau memakai fitur multi-user/role admin-editor-viewer)

Lewati grup ini kalau aplikasi cuma dipakai sebagai buku pribadi tanpa berbagi akses. Kalau dipakai, jalankan **berurutan, tanpa loncat**:

8. **`sql/profiles_and_invite.sql`**
   Fondasi: tabel `public.profiles` (salinan id+email dari `auth.users`) + trigger auto-sync.
9. **`sql/shared_books_roles.sql`**
   Fondasi: tabel `sk_books` + `book_members`, role admin/editor/viewer.
10. **`sql/bootstrap_shared_book.sql`**
    Izinkan admin pertama sebuah buku insert dirinya sendiri ke `book_members` (celah ayam-telur saat buku baru pertama kali dijadikan Buku Bersama).
11. **`sql/harden_shared_book_data_rls.sql`**
    RLS role admin/editor/viewer di tabel data (`transactions`, `settings`, `payment_reminders`). **Sebelum menjalankan**, jalankan dulu query verifikasi nama tabel/kolom yang ada di komentar bagian atas file ini — nama kolom bisa beda tergantung setup awalmu.
12. **`sql/harden_shared_book_backups_rls.sql`**
    Lanjutan #11 khusus tabel `backups` (butuh RLS yang sudah dinyalakan `harden_transactions_encryption.sql` di Grup 1 langkah #4).
13. **`sql/fix_rls_sync_42501.sql`**
    Pemulihan policy kalau muncul error `42501` saat sinkron `settings`/`backups`. Aman dijalankan ulang; jalankan di sini untuk memastikan semua policy Buku Bersama dari #9–#12 konsisten.
14. **`sql/protect_last_book_admin.sql`**
    Cegah admin terakhir suatu buku menghapus/menurunkan dirinya sendiri lewat REST API langsung (di luar UI).
15. **`sql/menu_visibility.sql`**
    Kolom `menu_visibility` di `sk_books` untuk fitur "Atur Tampilan Menu per Peran".
16. **`sql/universal_payment_reminders.sql`**
    Pengingat pembayaran lintas buku untuk tim yang sama (butuh `sk_role_for_book` dari #11).
17. **`sql/last_login_tracking.sql`**
    Kolom `last_login_at` di `profiles` + RPC `sk_touch_last_login` — dasar fitur "Terakhir login" di panel Kelola Anggota (butuh `profiles` dari #8).

---

## Grup 3 — Perawatan / perbaikan kondisional (jalankan hanya kalau relevan)

- **`sql/cleanup_legacy_open_policies.sql`**
  Jalankan **setelah** semua RLS Grup 1 & 2 selesai, sebagai sapuan terakhir untuk membuang policy `qual = true` tanpa syarat sisa setup manual lewat dashboard (kalau project kamu pernah diutak-atik lewat UI Supabase sebelum pakai migrasi terversi ini). Untuk project yang benar-benar baru dan cuma pernah dipasang lewat skrip-skrip di atas, langkah ini kemungkinan besar tidak menemukan apa-apa — tetap aman dijalankan untuk audit.
- **`sql/fix_bdefault_shared_collision.sql`**
  Cuma perlu kalau kamu pernah mengalami bug spesifik: Buku Bersama yang ID-nya kebetulan sama (`b_default`) bentrok antar akun. Project baru tidak akan kena ini kalau sudah pakai `js/auth.js` versi terbaru (sudah ada pencegahan `_skMigrateBookIdLocal`).

---

## Ringkasan urutan cepat (checklist)

```
[ ] 1.  supabase_migration_account_tag.sql
[ ] 2.  sql/fix_settings_upsert.sql
[ ] 3.  sql/fix_server_side_updated_at.sql
[ ] 4.  sql/harden_transactions_encryption.sql
[ ] 5.  sql/perf_query_indexes.sql
[ ] 6.  sql/harga_pangan_referensi.sql
[ ] 7.  sql/cleanup_old_audit_logs.sql          (opsional)
--- hanya kalau pakai Buku Bersama ---
[ ] 8.  sql/profiles_and_invite.sql
[ ] 9.  sql/shared_books_roles.sql
[ ] 10. sql/bootstrap_shared_book.sql
[ ] 11. sql/harden_shared_book_data_rls.sql     (verifikasi kolom dulu)
[ ] 12. sql/harden_shared_book_backups_rls.sql
[ ] 13. sql/fix_rls_sync_42501.sql
[ ] 14. sql/protect_last_book_admin.sql
[ ] 15. sql/menu_visibility.sql
[ ] 16. sql/universal_payment_reminders.sql
[ ] 17. sql/last_login_tracking.sql
--- kondisional ---
[ ] 18. sql/cleanup_legacy_open_policies.sql    (audit akhir)
[ ] 19. sql/fix_bdefault_shared_collision.sql   (hanya kalau kena bug ini)
```

## Cara verifikasi tiap tahap

Setelah tiap skrip, jalankan query verifikasi generik ini untuk memastikan
policy/kolom sudah masuk (ganti `<nama_tabel>`):

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = '<nama_tabel>'
order by policyname;
```

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = '<nama_tabel>'
order by ordinal_position;
```

Lihat juga `SECURITY_AUDIT.md` untuk model ancaman & status keamanan yang
sudah diverifikasi, dan `PERBAIKAN_42501.md` untuk troubleshooting spesifik
error RLS 42501.
