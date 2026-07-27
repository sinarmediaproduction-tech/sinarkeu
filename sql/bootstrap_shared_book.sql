-- ============================================================
-- BOOTSTRAP: Izinkan admin PERTAMA sebuah buku bersama insert dirinya
-- sendiri ke book_members. Jalankan SEKALI, SETELAH
-- sql/shared_books_roles.sql.
-- ============================================================
--
-- MASALAH:
-- Policy `book_members_insert_by_admin` di sql/shared_books_roles.sql
-- mensyaratkan "pemohon sudah admin buku ini" (sk_is_book_admin(book_id)).
-- Itu benar untuk UNDANG anggota baru (sudah ada minimal 1 admin). Tapi
-- untuk buku yang BARU SAJA dijadikan shared lewat window.skMakeBookShared,
-- book_members-nya masih KOSONG SAMA SEKALI -- tidak ada satu pun admin,
-- jadi sk_is_book_admin() selalu FALSE dan insert baris admin pertama itu
-- sendiri ikut ditolak. Ayam-telur: butuh sudah jadi admin untuk bisa
-- insert baris admin pertama.
--
-- PERBAIKAN:
-- Policy tambahan (RLS policies bersifat OR -- salah satu lolos, insert
-- diizinkan) yang mengizinkan INSERT baris book_members KHUSUS kalau SEMUA
-- syarat berikut benar:
--   1. Baris yang mau di-insert adalah role='admin'.
--   2. user_id di baris itu = auth.uid() sendiri (tidak bisa bootstrap-kan
--      orang lain jadi admin).
--   3. Pemohon adalah `created_by` di sk_books untuk book_id itu (hanya
--      pembuat buku yang bisa bootstrap dirinya jadi admin pertama).
--   4. BELUM ADA satu pun baris book_members untuk book_id itu (memastikan
--      ini betul-betul yang PERTAMA -- policy ini tidak bisa dipakai lagi
--      setelah admin pertama ada, jadi tidak jadi celah untuk nambah admin
--      baru diam-diam lewat jalur ini).
-- ============================================================

CREATE OR REPLACE FUNCTION public.sk_can_bootstrap_admin(p_book_id TEXT, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        EXISTS (
            SELECT 1 FROM public.sk_books
            WHERE id = p_book_id AND created_by = p_user_id
        )
        AND NOT EXISTS (
            SELECT 1 FROM public.book_members
            WHERE book_id = p_book_id
        );
$$;

DROP POLICY IF EXISTS book_members_insert_bootstrap_admin ON public.book_members;
CREATE POLICY book_members_insert_bootstrap_admin
    ON public.book_members FOR INSERT
    TO authenticated
    WITH CHECK (
        role = 'admin'
        AND user_id = auth.uid()
        AND public.sk_can_bootstrap_admin(book_id, auth.uid())
    );

-- ============================================================
-- Setelah SQL ini dijalankan:
--   - window.skMakeBookShared(bookId) (js/auth.js) berfungsi penuh: insert
--     sk_books lolos policy sk_books_insert_self (di shared_books_roles.sql),
--     lalu insert book_members role='admin' pertama lolos policy ini.
--   - Percobaan bootstrap KEDUA untuk book_id yang sama (mis. race condition
--     2 tab dibuka bersamaan) akan gagal di salah satunya karena begitu 1
--     baris admin berhasil masuk, sk_can_bootstrap_admin() langsung FALSE
--     untuk permintaan berikutnya -- aman dari duplikat admin bootstrap.
-- ============================================================
