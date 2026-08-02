-- ============================================================
-- HARDENING (OPSIONAL): RLS role admin/editor/viewer di tabel DATA
-- (transactions, settings, payment_reminders) -- bukan cuma di
-- sk_books/book_members. Jalankan SETELAH sql/shared_books_roles.sql
-- dan sql/bootstrap_shared_book.sql.
-- ============================================================
--
-- KENAPA FILE INI TERPISAH & OPSIONAL:
-- sql/shared_books_roles.sql mengunci tabel BARU (sk_books, book_members).
-- Tapi tabel transaksi/settings/payment_reminders yang SUDAH ADA di project
-- Supabase kamu dibuat manual sebelumnya (tidak ada di repo ini sebagai
-- migrasi) -- nama kolom persisnya bisa beda-beda tergantung setup awalmu.
-- Jalankan query ini dulu untuk KONFIRMASI nama tabel & kolom sebelum
-- lanjut:
--
--   SELECT table_name, column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name IN
--         ('transactions', 'settings', 'payment_reminders')
--   ORDER BY table_name, ordinal_position;
--
-- File ini ASUMSI setiap tabel di atas punya kolom `book_id` (TEXT, sama
-- persis dengan id yang ada di sk_books.id). Kalau nama kolomnya beda,
-- sesuaikan dulu sebelum menjalankan.
--
-- TANPA file ini: role admin/editor/viewer HANYA ditegakkan di sisi
-- APLIKASI (js/auth.js patch openModal/openActionMenu/confirmDelete) --
-- cukup untuk mencegah salah klik/UI menyesatkan, TAPI seseorang yang tahu
-- URL+anon key & JWT viewer-nya sendiri masih bisa memanggil REST API
-- Supabase langsung untuk insert/update/delete kalau RLS data belum ada.
-- DENGAN file ini: penolakan itu ditegakkan di database, bukan cuma UI.
--
-- PRINSIP:
--   - Buku yang TIDAK ada di sk_books (privat, belum pernah di-share) --
--     TIDAK terpengaruh sama sekali, tetap jalan seperti sebelumnya lewat
--     anon key (mempertahankan kompatibilitas mundur).
--   - Buku yang ADA di sk_books DAN is_shared = true:
--       * viewer -> SELECT saja.
--       * editor & admin -> SELECT + INSERT + UPDATE + DELETE.
--     Anon key TIDAK lagi bisa dipakai untuk book_id yang sudah shared --
--     wajib JWT user (auth.uid()) yang terdaftar di book_members buku itu.
-- ============================================================

-- Helper: role auth.uid() di book_id tertentu, NULL kalau bukan anggota.
CREATE OR REPLACE FUNCTION public.sk_role_for_book(p_book_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.book_members
    WHERE book_id = p_book_id AND user_id = auth.uid()
    LIMIT 1;
$$;

-- Helper: apakah book_id ini buku bersama (ada & is_shared di sk_books)?
CREATE OR REPLACE FUNCTION public.sk_book_is_shared(p_book_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.sk_books
        WHERE id = p_book_id AND is_shared = true
    );
$$;

-- ── transactions ─────────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'transactions') THEN
        EXECUTE 'ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY';

        -- Jalur LAMA: buku belum/tidak pernah di-share -> tetap terbuka
        -- lewat anon key seperti sebelum fitur Buku Bersama ada.
        EXECUTE 'DROP POLICY IF EXISTS transactions_legacy_anon ON public.transactions';
        EXECUTE $p$
            CREATE POLICY transactions_legacy_anon ON public.transactions
                FOR ALL
                TO anon
                USING (NOT public.sk_book_is_shared(book_id))
                WITH CHECK (NOT public.sk_book_is_shared(book_id))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS transactions_shared_select ON public.transactions';
        EXECUTE $p$
            CREATE POLICY transactions_shared_select ON public.transactions
                FOR SELECT
                TO authenticated
                USING (public.sk_role_for_book(book_id) IS NOT NULL)
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS transactions_shared_write ON public.transactions';
        EXECUTE $p$
            CREATE POLICY transactions_shared_write ON public.transactions
                FOR INSERT
                TO authenticated
                WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS transactions_shared_update ON public.transactions';
        EXECUTE $p$
            CREATE POLICY transactions_shared_update ON public.transactions
                FOR UPDATE
                TO authenticated
                USING (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
                WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS transactions_shared_delete ON public.transactions';
        EXECUTE $p$
            CREATE POLICY transactions_shared_delete ON public.transactions
                FOR DELETE
                TO authenticated
                USING (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;
    END IF;
END $$;

-- ── settings ─────────────────────────────────────────────────
-- Catatan: book_id='global' dipakai untuk crypto_salt/crypto_check (lihat
-- js/db.js) -- ini TIDAK PERNAH ada di sk_books, jadi otomatis selalu lolos
-- lewat jalur transactions_legacy_anon-equivalent di bawah (sk_book_is_shared
-- akan FALSE untuk 'global'). Editor boleh tulis settings (dipakai untuk
-- anggaran, dsb -- lihat navBudgetBtn yang tetap terbuka untuk editor di
-- js/auth.js skApplyRoleUI).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'settings') THEN
        EXECUTE 'ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY';

        EXECUTE 'DROP POLICY IF EXISTS settings_legacy_anon ON public.settings';
        EXECUTE $p$
            CREATE POLICY settings_legacy_anon ON public.settings
                FOR ALL
                TO anon
                USING (NOT public.sk_book_is_shared(book_id))
                WITH CHECK (NOT public.sk_book_is_shared(book_id))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS settings_shared_select ON public.settings';
        EXECUTE $p$
            CREATE POLICY settings_shared_select ON public.settings
                FOR SELECT
                TO authenticated
                USING (public.sk_role_for_book(book_id) IS NOT NULL)
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS settings_shared_write ON public.settings';
        EXECUTE $p$
            CREATE POLICY settings_shared_write ON public.settings
                FOR INSERT
                TO authenticated
                WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS settings_shared_update ON public.settings';
        EXECUTE $p$
            CREATE POLICY settings_shared_update ON public.settings
                FOR UPDATE
                TO authenticated
                USING (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
                WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS settings_shared_delete ON public.settings';
        EXECUTE $p$
            CREATE POLICY settings_shared_delete ON public.settings
                FOR DELETE
                TO authenticated
                USING (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;
    END IF;
END $$;

-- ── payment_reminders ────────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_reminders') THEN
        EXECUTE 'ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY';

        EXECUTE 'DROP POLICY IF EXISTS payment_reminders_legacy_anon ON public.payment_reminders';
        EXECUTE $p$
            CREATE POLICY payment_reminders_legacy_anon ON public.payment_reminders
                FOR ALL
                TO anon
                USING (NOT public.sk_book_is_shared(book_id))
                WITH CHECK (NOT public.sk_book_is_shared(book_id))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS payment_reminders_shared_select ON public.payment_reminders';
        EXECUTE $p$
            CREATE POLICY payment_reminders_shared_select ON public.payment_reminders
                FOR SELECT
                TO authenticated
                USING (public.sk_role_for_book(book_id) IS NOT NULL)
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS payment_reminders_shared_write ON public.payment_reminders';
        EXECUTE $p$
            CREATE POLICY payment_reminders_shared_write ON public.payment_reminders
                FOR INSERT
                TO authenticated
                WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS payment_reminders_shared_update ON public.payment_reminders';
        EXECUTE $p$
            CREATE POLICY payment_reminders_shared_update ON public.payment_reminders
                FOR UPDATE
                TO authenticated
                USING (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
                WITH CHECK (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;

        EXECUTE 'DROP POLICY IF EXISTS payment_reminders_shared_delete ON public.payment_reminders';
        EXECUTE $p$
            CREATE POLICY payment_reminders_shared_delete ON public.payment_reminders
                FOR DELETE
                TO authenticated
                USING (public.sk_role_for_book(book_id) IN ('admin', 'editor'))
        $p$;
    END IF;
END $$;

-- ============================================================
-- Setelah SQL ini dijalankan:
--   - Buku PRIBADI (tidak ada di sk_books) -- tidak berubah, tetap lewat
--     anon key seperti sebelumnya.
--   - Buku BERSAMA -- viewer read-only ditegakkan DI DATABASE (bukan cuma
--     disembunyikan di UI), editor & admin bisa CRUD penuh.
--
-- PERINGATAN: aktifkan RLS = ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- bisa mem-block akses yang TIDAK dicover policy manapun (default deny).
-- Kalau ada kolom/jalur akses lain yang belum kepikiran di sini (mis. view
-- materialized, tabel turunan lain), UJI DULU di project Supabase staging/
-- duplikat sebelum menjalankan di project produksi.
-- ============================================================
