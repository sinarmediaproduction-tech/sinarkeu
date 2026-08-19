-- ============================================================
-- FIX KEAMANAN: Hapus policy anon_full_access yang membatalkan
-- pembatasan RLS Buku Bersama di transactions & payment_reminders
-- ============================================================
-- Jalankan SEKALI di Supabase SQL Editor, SETELAH
-- sql/harden_shared_book_data_rls.sql sudah pernah dijalankan.
--
-- AKAR MASALAH:
-- sql/harden_transactions_encryption.sql (langkah awal) membuat policy
--   anon_full_access ON transactions FOR ALL TO anon USING (true) WITH CHECK (true)
-- yaitu izin TANPA SYARAT untuk role anon -- baca/tulis/hapus SEMUA baris,
-- buku manapun, shared atau tidak.
--
-- sql/harden_shared_book_data_rls.sql (langkah belakangan) menambahkan
-- policy yang lebih ketat: transactions_legacy_anon (anon HANYA boleh utk
-- buku yang TIDAK shared) + transactions_shared_select/write/update/delete
-- (buku shared wajib JWT authenticated + role admin/editor). Sama untuk
-- payment_reminders.
--
-- MASALAHNYA: anon_full_access TIDAK PERNAH di-DROP saat itu. RLS Postgres
-- bersifat permissive-OR -- kalau SATU policy saja mengizinkan, baris tetap
-- bisa diakses walau policy lain lebih ketat. Akibatnya anon_full_access
-- (USING true, tanpa syarat) membatalkan SELURUH pembatasan buku bersama:
-- siapa pun yang pegang anon key (bukan rahasia -- nempel di kode client
-- yang dikirim ke browser) tetap bisa INSERT/UPDATE/DELETE baris transaksi
-- ATAU payment_reminders milik buku SIAPA PUN, termasuk buku bersama yang
-- viewer-nya seharusnya read-only. Isi datanya sendiri tetap terlindungi
-- (enc_payload terenkripsi AES-GCM, kunci dari password, tidak pernah ke
-- server) -- tapi baris itu tetap bisa DIHAPUS (soft-delete is_deleted=true)
-- atau ditimpa jadi ciphertext acak oleh siapa pun, tanpa terdeteksi
-- sebagai pelanggaran RLS.
--
-- YANG TIDAK DISENTUH FILE INI (SENGAJA):
--   - backups.anon_full_access -- SENGAJA tetap ada, backup dilindungi
--     ciphertext bukan RLS scoping per book_id (lihat catatan di
--     sql/cleanup_legacy_open_policies.sql). Jangan drop.
--   - audit_logs.anon_full_access -- BELUM ada policy pengganti berbasis
--     book_id/shared di file manapun, dan tabel ini cuma granted
--     SELECT+INSERT (tidak ada UPDATE/DELETE di GRANT dasar, lihat
--     sql/00_base_schema.sql) -- drop di sini akan mematikan total fitur
--     Log Audit untuk buku pribadi tanpa manfaat integritas yang sepadan
--     (paling parah cuma "baca log aktivitas orang lain", bukan
--     hapus/timpa data keuangan). Di luar cakupan fix ini.
--
-- SETELAH FIX INI: buku pribadi (tidak ada di sk_books/is_shared) tetap
-- jalan normal lewat anon key -- dicover oleh transactions_legacy_anon /
-- payment_reminders_legacy_anon yang sudah ada, TIDAK ADA fungsi yang
-- hilang. Yang berubah cuma: buku BERSAMA tidak lagi bisa diakses/ditulis
-- lewat anon key mentah -- wajib JWT authenticated + role member buku itu,
-- persis seperti yang dimaksud harden_shared_book_data_rls.sql sejak awal.
-- ============================================================

DROP POLICY IF EXISTS anon_full_access ON public.transactions;
DROP POLICY IF EXISTS anon_full_access ON public.payment_reminders;

-- ============================================================
-- VERIFIKASI: pastikan HANYA policy bertarget (bukan anon_full_access
-- tanpa syarat) yang tersisa untuk kedua tabel ini.
-- ============================================================
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('transactions', 'payment_reminders')
ORDER BY tablename, policyname;

-- Diharapkan HANYA muncul (tidak ada baris anon_full_access lagi):
--   transactions: transactions_legacy_anon,
--                 transactions_shared_select/write/update/delete
--   payment_reminders: payment_reminders_legacy_anon,
--                       payment_reminders_shared_select/write/update/delete
--
-- KALAU nama policy shared di project Anda BEDA (mis. project lama masih
-- pakai shared_tx_select/write/update/delete alih-alih
-- transactions_shared_*, sesuai catatan lama di
-- sql/cleanup_legacy_open_policies.sql) -- JALANKAN DULU query berikut
-- untuk cek nama persisnya SEBELUM mengandalkan hasil verifikasi di atas:
--
--   SELECT policyname FROM pg_policies
--   WHERE schemaname='public' AND tablename='transactions';
--
-- Kalau ternyata TIDAK ADA policy shared sama sekali (harden_shared_book_
-- data_rls.sql belum pernah dijalankan di project ini) -- JANGAN jalankan
-- file ini dulu. Tanpa policy pengganti, buku bersama akan langsung
-- default-deny total (tidak bisa dibaca/ditulis sama sekali) begitu
-- anon_full_access dihapus.
