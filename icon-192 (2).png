-- ============================================================
-- PENGAMANAN: Cegah admin terakhir suatu buku dihapus/diturunkan
-- Jalankan SEKALI di Supabase SQL Editor, SETELAH sql/shared_books_roles.sql.
-- ============================================================
--
-- KONTEKS:
-- Proteksi "admin tidak bisa hapus/ubah peran diri sendiri" sebelumnya HANYA
-- ada di js/auth.js (skUpdateMemberRole, skRemoveMember) -- disengaja, lihat
-- komentar di sql/shared_books_roles.sql (policy book_members_delete_by_admin)
-- supaya transfer admin via SQL editor tetap bisa dilakukan kalau perlu.
--
-- Tapi itu berarti siapa pun yang tahu URL+anon key+JWT-nya sendiri bisa
-- panggil REST API langsung (di luar UI app) dan menghapus/menurunkan
-- perannya sendiri -- kalau dia admin SATU-SATUNYA di buku itu, buku itu
-- jadi "yatim" (tidak ada admin lagi, tidak ada yang bisa kelola anggota
-- lagi selamanya lewat UI).
--
-- File ini menutup celah itu DI LEVEL DATABASE, dengan aturan:
--   "boleh hapus/turunkan admin, ASALKAN buku itu masih punya admin lain
--    sesudahnya" -- jadi transfer admin (tambah admin baru dulu, baru
--    hapus/turunkan admin lama) TETAP bisa, tapi "admin terakhir menghapus/
--    menurunkan diri sendiri tanpa pengganti" jadi mustahil, baik lewat UI
--    maupun lewat REST API langsung.
-- ============================================================

-- ── Jaga-jaga: pastikan sk_is_book_admin/sk_is_book_member ADA ─────────
-- File ini tadinya diasumsikan berjalan SETELAH sql/shared_books_roles.sql
-- (yang mendefinisikan dua fungsi ini). Kalau ternyata muncul error
-- "function public.sk_is_book_admin(text) does not exist" saat menjalankan
-- policy di bawah, itu tandanya file itu belum pernah sukses jalan penuh di
-- project ini -- jadi didefinisikan ulang di sini juga (CREATE OR REPLACE
-- aman, tidak merusak apa pun kalau sudah ada dan identik) supaya file ini
-- bisa berdiri sendiri.
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

-- ── Helper: berapa admin LAIN (selain p_user_id) di buku ini? ───────────
-- Sengaja MENGECUALIKAN p_user_id sendiri (bukan sekadar "hitung semua
-- admin saat ini") -- supaya aman dipakai baik di UPDATE (NEW.role belum
-- tentu 'admin' lagi) maupun DELETE (baris admin itu sendiri masih
-- terhitung kalau kita tidak mengecualikannya).
CREATE OR REPLACE FUNCTION public.sk_book_other_admin_count(p_book_id TEXT, p_user_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*)::INT FROM public.book_members
    WHERE book_id = p_book_id AND user_id <> p_user_id AND role = 'admin';
$$;

-- ── UPDATE: ganti role anggota -- admin buku itu saja ───────────────────
-- Tambahan dari versi di shared_books_roles.sql: kalau baris yang diubah
-- adalah admin YANG DITURUNKAN (role baru != 'admin'), tolak KECUALI masih
-- ada admin lain di buku itu.
DROP POLICY IF EXISTS book_members_update_by_admin ON public.book_members;
CREATE POLICY book_members_update_by_admin
    ON public.book_members FOR UPDATE
    TO authenticated
    USING (public.sk_is_book_admin(book_id))
    WITH CHECK (
        public.sk_is_book_admin(book_id)
        AND (
            role = 'admin'
            OR public.sk_book_other_admin_count(book_id, user_id) > 0
        )
    );

-- ── DELETE: hapus anggota -- admin buku itu saja ─────────────────────────
-- Tambahan dari versi di shared_books_roles.sql: kalau baris yang dihapus
-- adalah admin, tolak KECUALI masih ada admin lain di buku itu.
DROP POLICY IF EXISTS book_members_delete_by_admin ON public.book_members;
CREATE POLICY book_members_delete_by_admin
    ON public.book_members FOR DELETE
    TO authenticated
    USING (
        public.sk_is_book_admin(book_id)
        AND (
            role <> 'admin'
            OR public.sk_book_other_admin_count(book_id, user_id) > 0
        )
    );

-- ============================================================
-- Setelah SQL ini dijalankan:
--   - skUpdateMemberRole/skRemoveMember di js/auth.js TIDAK berubah perilaku
--     untuk pemakaian normal (mereka sudah tidak pernah menyasar diri
--     sendiri, dan kasus "menurunkan admin lain sampai 0 admin tersisa"
--     sangat jarang -- kalau kejadian, sekarang db yang akan menolaknya juga
--     dengan pesan error dari Supabase, bukan cuma error UI generik).
--   - Transfer admin TETAP bisa: undang/insert admin baru dulu (lewat
--     skInviteMember dengan role='admin'), BARU hapus/turunkan admin lama.
--     Urutan terbalik (hapus dulu, baru tambah) akan ditolak di langkah
--     pertama karena saat itu dia masih admin satu-satunya.
--   - "Admin terakhir menghapus/menurunkan dirinya sendiri tanpa pengganti"
--     sekarang mustahil baik lewat UI (sudah dicegah sejak awal) MAUPUN
--     lewat panggilan REST API langsung (baru dicegah oleh file ini).
--   - Fitur "Hapus Buku" (js/book.js) TIDAK terpengaruh -- itu hapus
--     sk_books via DELETE CASCADE ke book_members, bukan lewat policy
--     UPDATE/DELETE book_members ini.
-- ============================================================
