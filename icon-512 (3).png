-- ============================================================
-- FONDASI: Buku Bersama (Shared Book) + Role admin/editor/viewer
-- Jalankan SEKALI di Supabase SQL Editor, SETELAH
-- sql/profiles_and_invite.sql. Lanjutkan ke sql/bootstrap_shared_book.sql
-- sesudah ini supaya window.skMakeBookShared (js/auth.js) bisa dipakai.
-- ============================================================
--
-- KONTEKS:
-- Sebelum fitur ini, app memakai SATU anon key untuk semua request (lihat
-- catatan di sql/harden_transactions_encryption.sql) -- tidak ada isolasi
-- per-user di level database sama sekali. Buku Bersama butuh model akses
-- yang benar-benar berbeda: beberapa AKUN Supabase Auth terpisah, masing-
-- masing dengan ROLE berbeda (admin/editor/viewer) untuk buku yang SAMA.
--
-- Dua tabel baru:
--   sk_books      -- 1 baris per buku yang statusnya "dibagikan" (is_shared).
--                    id-nya SAMA dengan id buku di aplikasi (mis. "b_1706..."),
--                    BUKAN uuid baru -- lihat window.skMakeBookShared yang
--                    insert pakai `book.id` milik buku yang sudah ada di app.
--   book_members  -- baris (book_id, user_id, role) -- siapa punya akses apa
--                    ke buku yang mana. Inilah satu-satunya "sumber kebenaran"
--                    untuk role (lihat window._skSharedRoles di js/auth.js).
--
-- Tabel data yang SUDAH ADA (transactions/settings/payment_reminders/dst)
-- TIDAK diubah skemanya oleh file ini -- RLS tambahan untuk tabel-tabel itu
-- ada di sql/harden_shared_book_data_rls.sql (opsional, lihat catatan di
-- akhir file itu kenapa dipisah).
-- ============================================================

-- ── Tabel: sk_books ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sk_books (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    is_shared  BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Tabel: book_members ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.book_members (
    book_id    TEXT NOT NULL REFERENCES public.sk_books(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (book_id, user_id)
);
-- Dipakai window.skInviteMember & window.skAdminCreateMemberAccount lewat
-- .upsert({...}, { onConflict: 'book_id,user_id' }) -- PK di atas SUDAH
-- otomatis jadi target onConflict itu, tidak perlu constraint tambahan.

CREATE INDEX IF NOT EXISTS idx_book_members_user ON public.book_members (user_id);

ALTER TABLE public.sk_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_members ENABLE ROW LEVEL SECURITY;

-- ── Helper: apakah auth.uid() admin di book_id tertentu? ────────────────
-- STABLE + SECURITY DEFINER: dievaluasi sebagai fungsi sistem supaya
-- pengecekannya sendiri tidak balik lagi kena RLS book_members (yang justru
-- memanggil fungsi ini) -- kalau tidak, bisa infinite recursion policy.
CREATE OR REPLACE FUNCTION public.sk_is_book_admin(p_book_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.book_members
        WHERE book_id = p_book_id AND user_id = auth.uid() AND role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.sk_is_book_member(p_book_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.book_members
        WHERE book_id = p_book_id AND user_id = auth.uid()
    );
$$;

-- ── RLS: sk_books ────────────────────────────────────────────
-- SELECT: hanya anggota buku itu yang boleh lihat baris sk_books-nya
-- (dipakai window.skRefreshSharedAccess -- .from('sk_books').select('id,name').in('id', bookIds)
-- yang bookIds-nya sendiri sudah difilter dari book_members milik user ini,
-- tapi RLS ini tetap jadi lapis pertahanan kedua).
DROP POLICY IF EXISTS sk_books_select_member ON public.sk_books;
CREATE POLICY sk_books_select_member
    ON public.sk_books FOR SELECT
    TO authenticated
    USING (public.sk_is_book_member(id));

-- INSERT: siapa pun yang login boleh membuat baris sk_books BARU, TAPI
-- created_by wajib dirinya sendiri -- dipakai window.skMakeBookShared saat
-- menjadikan buku pribadi jadi buku bersama untuk pertama kali.
DROP POLICY IF EXISTS sk_books_insert_self ON public.sk_books;
CREATE POLICY sk_books_insert_self
    ON public.sk_books FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- UPDATE/DELETE: admin buku itu saja (mis. rename buku suatu saat nanti --
-- belum ada di UI sekarang, disiapkan untuk masa depan).
DROP POLICY IF EXISTS sk_books_update_admin ON public.sk_books;
CREATE POLICY sk_books_update_admin
    ON public.sk_books FOR UPDATE
    TO authenticated
    USING (public.sk_is_book_admin(id))
    WITH CHECK (public.sk_is_book_admin(id));

DROP POLICY IF EXISTS sk_books_delete_admin ON public.sk_books;
CREATE POLICY sk_books_delete_admin
    ON public.sk_books FOR DELETE
    TO authenticated
    USING (public.sk_is_book_admin(id));

-- ── RLS: book_members ────────────────────────────────────────
-- SELECT: baris milik sendiri (dipakai skRefreshSharedAccess untuk tarik
-- SEMUA buku+role milik user ini), ATAU sesama anggota buku yang sama
-- (dipakai skListBookMembers -- panel "Kelola Anggota" perlu lihat daftar
-- rekan satu buku, bukan cuma baris sendiri).
DROP POLICY IF EXISTS book_members_select_self_or_peer ON public.book_members;
CREATE POLICY book_members_select_self_or_peer
    ON public.book_members FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR public.sk_is_book_member(book_id)
    );

-- INSERT: admin buku itu boleh menambah anggota baru dengan role apa pun
-- (viewer/editor/admin) -- dipakai window.skInviteMember &
-- window.skAdminCreateMemberAccount. Baris PALING PERTAMA (bootstrap admin
-- pertama saat skMakeBookShared) BELUM ter-cover policy ini -- lihat
-- sql/bootstrap_shared_book.sql untuk policy tambahannya (dijalankan
-- terpisah supaya jelas kenapa kasus itu butuh perlakuan khusus).
DROP POLICY IF EXISTS book_members_insert_by_admin ON public.book_members;
CREATE POLICY book_members_insert_by_admin
    ON public.book_members FOR INSERT
    TO authenticated
    WITH CHECK (public.sk_is_book_admin(book_id));

-- UPDATE: ganti role anggota -- admin buku itu saja.
DROP POLICY IF EXISTS book_members_update_by_admin ON public.book_members;
CREATE POLICY book_members_update_by_admin
    ON public.book_members FOR UPDATE
    TO authenticated
    USING (public.sk_is_book_admin(book_id))
    WITH CHECK (public.sk_is_book_admin(book_id));

-- DELETE: hapus anggota -- admin buku itu saja. Dipakai window.skRemoveMember
-- (yang sudah mencegah admin menghapus dirinya sendiri lewat cek di client
-- -- policy ini sengaja TIDAK menduplikasi cek itu di database, supaya kalau
-- suatu saat perlu "admin keluar & transfer ke admin lain" masih bisa
-- dilakukan lewat SQL editor langsung tanpa perlu longgarkan policy ini).
DROP POLICY IF EXISTS book_members_delete_by_admin ON public.book_members;
CREATE POLICY book_members_delete_by_admin
    ON public.book_members FOR DELETE
    TO authenticated
    USING (public.sk_is_book_admin(book_id));

-- ============================================================
-- Setelah SQL ini dijalankan:
--   - sk_books & book_members siap dipakai window.skRefreshSharedAccess,
--     skInviteMember, skAdminCreateMemberAccount, skListBookMembers,
--     skRemoveMember di js/auth.js.
--   - window.skMakeBookShared MASIH akan gagal di baris kedua (insert
--     book_members role='admin' pertama) sampai
--     sql/bootstrap_shared_book.sql juga dijalankan -- karena belum ada
--     baris admin sama sekali untuk buku itu, jadi sk_is_book_admin() di
--     atas selalu FALSE untuk buku yang baru saja dibuat.
-- ============================================================
