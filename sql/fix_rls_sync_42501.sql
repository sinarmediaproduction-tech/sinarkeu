-- ============================================================
-- FIX: Pulihkan policy RLS untuk sinkronisasi settings & backup
-- ============================================================
-- Jalankan SEKALI di Supabase SQL Editor pada project yang dipakai aplikasi.
--
-- GEJALA YANG DIPERBAIKI
--   "new row violates row-level security policy" (kode PostgreSQL 42501)
--   saat aplikasi menyimpan `settings` atau membuat `backups`. PostgREST
--   sering mengirimnya ke browser sebagai HTTP 401, sehingga sebelumnya
--   terlihat seperti URL/API key salah padahal bukan.
--
-- AKAR MASALAH
-- RLS aktif pada tabel, sementara policy untuk role `anon` (buku pribadi)
-- dan/atau `authenticated` (Buku Bersama) tidak ada atau pernah terhapus.
-- RLS bersifat default-deny: GRANT tabel saja tidak cukup tanpa policy.
--
-- Script ini aman dijalankan ulang. Buku pribadi tetap hanya memakai anon,
-- sedangkan buku bersama wajib memakai JWT user dan role anggota buku.
-- Prasyarat untuk bagian Buku Bersama: jalankan terlebih dahulu
-- sql/shared_books_roles.sql dan sql/harden_shared_book_data_rls.sql.
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backups TO anon, authenticated;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

-- Buku pribadi: request memakai anon key dan tidak boleh mengakses buku
-- yang telah ditandai sebagai shared.
DROP POLICY IF EXISTS settings_legacy_anon ON public.settings;
CREATE POLICY settings_legacy_anon ON public.settings
    FOR ALL TO anon
    USING (NOT public.sk_book_is_shared(book_id))
    WITH CHECK (NOT public.sk_book_is_shared(book_id));

DROP POLICY IF EXISTS backups_legacy_anon ON public.backups;
CREATE POLICY backups_legacy_anon ON public.backups
    FOR ALL TO anon
    USING (NOT public.sk_book_is_shared(book_id))
    WITH CHECK (NOT public.sk_book_is_shared(book_id));

-- Buku bersama: anggota dapat membaca; hanya admin/editor yang dapat
-- menyimpan setting atau membuat backup baru.
DROP POLICY IF EXISTS settings_shared_select ON public.settings;
CREATE POLICY settings_shared_select ON public.settings
    FOR SELECT TO authenticated
    USING (public.sk_role_for_book(book_id) IS NOT NULL);

DROP POLICY IF EXISTS settings_shared_write ON public.settings;
CREATE POLICY settings_shared_write ON public.settings
    FOR INSERT TO authenticated
    WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'));

DROP POLICY IF EXISTS settings_shared_update ON public.settings;
CREATE POLICY settings_shared_update ON public.settings
    FOR UPDATE TO authenticated
    USING (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
    WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'));

DROP POLICY IF EXISTS settings_shared_delete ON public.settings;
CREATE POLICY settings_shared_delete ON public.settings
    FOR DELETE TO authenticated
    USING (public.sk_role_for_book(book_id) IN ('admin', 'editor'));

DROP POLICY IF EXISTS backups_shared_select ON public.backups;
CREATE POLICY backups_shared_select ON public.backups
    FOR SELECT TO authenticated
    USING (public.sk_role_for_book(book_id) IS NOT NULL);

DROP POLICY IF EXISTS backups_shared_write ON public.backups;
CREATE POLICY backups_shared_write ON public.backups
    FOR INSERT TO authenticated
    WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'));

-- Verifikasi: kedua tabel harus memperlihatkan policy *_legacy_anon dan
-- policy *_shared_* di bawah ini setelah script sukses.
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('settings', 'backups')
ORDER BY tablename, policyname;
