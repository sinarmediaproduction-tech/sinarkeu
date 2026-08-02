-- ============================================================
-- FIX: RLS tabel `backups` tidak pernah dapat kebijakan untuk buku
-- BERSAMA -- hanya tabel transactions/settings/payment_reminders yang
-- diberi kebijakan shared_select/shared_write/dst di
-- sql/harden_shared_book_data_rls.sql. Tabel `backups` cuma punya
-- `anon_full_access` (role anon, lihat sql/harden_transactions_encryption.sql)
-- -- TIDAK ADA kebijakan apa pun untuk role `authenticated`.
--
-- AKIBATNYA: window.callSupabaseAPI di js/auth.js otomatis pakai JWT user
-- (role authenticated), bukan anon key, untuk request ke book_id yang
-- statusnya buku bersama (lihat komentar "Patch callSupabaseAPI" di
-- js/auth.js). Karena RLS aktif di tabel `backups` (ENABLE ROW LEVEL
-- SECURITY di harden_transactions_encryption.sql) tapi tidak ada kebijakan
-- utk role authenticated, PostgreSQL default-deny semua insert/select dari
-- role itu -> error 42501 "new row violates row-level security policy for
-- table backups" setiap kali auto-backup harian (atau backup manual)
-- berjalan untuk buku yang sudah dijadikan Buku Bersama.
--
-- Jalankan file ini SETELAH sql/harden_shared_book_data_rls.sql (butuh
-- helper function public.sk_role_for_book & public.sk_book_is_shared yang
-- didefinisikan di sana).
--
-- PRINSIP (sama seperti tabel data lain):
--   - Buku PRIBADI (tidak ada di sk_books / is_shared=false) -- tetap lewat
--     anon key seperti sebelumnya, tidak berubah.
--   - Buku BERSAMA -- viewer bisa SELECT (lihat riwayat backup), admin &
--     editor bisa INSERT (bikin backup baru). UPDATE/DELETE backup tidak
--     dipakai di aplikasi manapun untuk buku bersama, jadi tidak dibuka.
-- ============================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'backups') THEN
        EXECUTE 'ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY';

        -- Jalur LAMA: buku belum/tidak pernah di-share -> tetap terbuka
        -- lewat anon key (kebijakan anon_full_access lama TIDAK didrop di
        -- sini, tapi kebijakan baru ini membuatnya eksplisit per buku
        -- supaya konsisten dengan tabel data lain).
        EXECUTE 'DROP POLICY IF EXISTS backups_legacy_anon ON public.backups';
        EXECUTE $p$
            CREATE POLICY backups_legacy_anon ON public.backups
                FOR ALL
                TO anon
                USING (NOT public.sk_book_is_shared(book_id))
                WITH CHECK (NOT public.sk_book_is_shared(book_id))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS backups_shared_select ON public.backups';
        EXECUTE $p$
            CREATE POLICY backups_shared_select ON public.backups
                FOR SELECT
                TO authenticated
                USING (public.sk_role_for_book(book_id) IS NOT NULL)
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS backups_shared_write ON public.backups';
        EXECUTE $p$
            CREATE POLICY backups_shared_write ON public.backups
                FOR INSERT
                TO authenticated
                WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;
    END IF;
END $$;

-- ============================================================
-- Setelah SQL ini dijalankan: backup manual & auto-backup harian akan
-- berhasil lagi untuk buku bersama (admin/editor). Kebijakan lama
-- anon_full_access TETAP ada (tidak di-DROP file ini) -- tidak masalah,
-- karena backups_legacy_anon di atas sudah membatasi anon HANYA untuk
-- buku yang BUKAN bersama; kalau mau benar-benar bersih, drop manual:
--   DROP POLICY IF EXISTS anon_full_access ON public.backups;
-- ============================================================
