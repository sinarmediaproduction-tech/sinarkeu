-- ============================================================
-- FITUR: Pengingat Pembayaran "Universal" (ikut tim, lintas buku)
-- Jalankan SEKALI di Supabase SQL Editor, SETELAH
-- sql/harden_shared_book_data_rls.sql (butuh sk_role_for_book & tabel
-- payment_reminders sudah ada dengan RLS-nya).
-- ============================================================
--
-- KONTEKS:
-- Selama ini pengingat pembayaran 100% terikat ke SATU book_id -- dibuat di
-- Buku A, hanya muncul di Buku A. Fitur ini menambahkan opsi "universal":
-- pengingat yang dibuat di suatu Buku Bersama akan IKUT MUNCUL LAGI di buku
-- lain, ASALKAN buku lain itu anggotanya (book_members) SAMA PERSIS dengan
-- buku asalnya -- jadi tim yang sama tidak perlu catat pengingat yang sama
-- dua kali di dua buku yang mereka kelola berdua.
--
-- Buku pribadi (tidak shared, tidak punya baris book_members) TIDAK
-- terpengaruh sama sekali -- tanpa "anggota", tidak ada "tim" untuk
-- dicocokkan, jadi pengingat di buku itu tetap murni per-buku seperti
-- sebelumnya.
--
-- Pengingat yang SUDAH ADA sebelum migrasi ini (dibuat sebelum fitur
-- universal ada) sengaja DIBIARKAN per-buku seperti semula -- lihat
-- kolom is_universal di bawah, default-nya untuk baris LAMA adalah FALSE.
-- Hanya pengingat BARU (dibuat setelah migrasi ini) yang default-nya TRUE.
--
-- CATATAN DESAIN: yang "melebar" ke buku lain HANYA visibilitasnya
-- (SELECT/tampil). Edit & hapus TETAP hanya bisa dilakukan oleh admin/
-- editor di buku ASAL pengingat itu (book_id-nya sendiri) -- js/payment-
-- reminder.js menyembunyikan tombol Edit/Hapus untuk pengingat "titipan"
-- dari buku lain supaya tidak ada yang tidak sengaja memindahkan
-- kepemilikan pengingat itu ke buku yang sedang dibuka.
-- ============================================================

-- ── Kolom baru: is_universal ─────────────────────────────────
-- Trik urutan supaya baris LAMA tetap FALSE tapi baris BARU (yang tidak
-- eksplisit isi kolom ini) default-nya TRUE:
--   1. Tambah kolom dengan DEFAULT false dulu -- semua baris lama (dan
--      baris ini sendiri) otomatis terisi false.
--   2. BARU SETELAH itu ubah default kolomnya jadi true -- default ini
--      cuma berlaku untuk INSERT berikutnya, tidak menyentuh baris yang
--      sudah ada.
ALTER TABLE public.payment_reminders
    ADD COLUMN IF NOT EXISTS is_universal BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.payment_reminders
    ALTER COLUMN is_universal SET DEFAULT true;

-- ── Helper: "tanda tangan" set anggota suatu buku ────────────────────────
-- md5 dari daftar user_id (diurutkan) di book_members untuk book_id
-- tertentu -- dua buku dianggap "tim yang sama persis" kalau tanda tangan
-- ini identik. NULL kalau buku itu tidak punya anggota sama sekali (buku
-- pribadi/tidak shared) -- sengaja, supaya buku semacam itu tidak pernah
-- "match" dengan buku manapun (termasuk sesama buku pribadi tanpa anggota).
CREATE OR REPLACE FUNCTION public.sk_book_member_signature(p_book_id TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT md5(string_agg(user_id::text, ',' ORDER BY user_id))
    FROM public.book_members
    WHERE book_id = p_book_id
    HAVING COUNT(*) > 0;
$$;

-- ── RPC: daftar pengingat yang "kebaca" dari suatu buku ──────────────────
-- Menggantikan query REST langsung (?book_id=eq...) KHUSUS untuk Buku
-- Bersama -- lihat window.loadPaymentReminders di js/payment-reminder.js.
-- SECURITY DEFINER supaya bisa query lintas book_id (RLS biasa membatasi
-- per baris berdasarkan book_id-nya sendiri, tidak tahu soal "tim yang
-- sama"), TAPI tetap memeriksa keanggotaan p_book_id secara eksplisit di
-- awal -- jadi tidak bisa dipanggil untuk "mengintip" buku yang bukan
-- milik pemanggil.
CREATE OR REPLACE FUNCTION public.sk_list_payment_reminders(p_book_id TEXT)
RETURNS SETOF public.payment_reminders
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.sk_role_for_book(p_book_id) IS NULL THEN
        RETURN; -- bukan anggota buku ini -- kembalikan kosong, bukan error
    END IF;

    RETURN QUERY
    SELECT pr.* FROM public.payment_reminders pr
    WHERE pr.book_id = p_book_id
       OR (
            pr.is_universal
            AND public.sk_book_member_signature(pr.book_id) IS NOT NULL
            AND public.sk_book_member_signature(pr.book_id) = public.sk_book_member_signature(p_book_id)
          )
    ORDER BY pr.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sk_list_payment_reminders(TEXT) TO authenticated;

-- ── RLS payment_reminders_shared_select: ikut mengizinkan hasil RPC ──────
-- RPC di atas SECURITY DEFINER (jadi sebenarnya sudah bypass RLS ini) --
-- tapi policy SELECT tetap diperbarui juga sebagai lapis kedua, untuk jalur
-- lain yang mungkin masih query tabel ini langsung (bukan lewat RPC).
DROP POLICY IF EXISTS payment_reminders_shared_select ON public.payment_reminders;
CREATE POLICY payment_reminders_shared_select ON public.payment_reminders
    FOR SELECT
    TO authenticated
    USING (
        public.sk_role_for_book(book_id) IS NOT NULL
        OR (
            is_universal
            AND public.sk_book_member_signature(book_id) IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM public.book_members bm
                WHERE bm.user_id = auth.uid()
                  AND public.sk_book_member_signature(bm.book_id) = public.sk_book_member_signature(payment_reminders.book_id)
            )
        )
    );

-- Policy INSERT/UPDATE/DELETE SENGAJA TIDAK diubah -- tetap seperti semula
-- di sql/harden_shared_book_data_rls.sql (hanya admin/editor buku ASAL
-- pengingat itu yang boleh ubah/hapus). Lihat catatan "CATATAN DESAIN" di
-- atas untuk alasannya.

-- ============================================================
-- Setelah SQL ini dijalankan:
--   - Pengingat BARU yang dibuat di Buku Bersama otomatis is_universal=true
--     (kecuali js/payment-reminder.js eksplisit mengirim false).
--   - Pengingat LAMA tetap is_universal=false -- perilakunya SAMA seperti
--     sebelum migrasi ini (murni per-buku).
--   - Buku pribadi (tidak shared) tidak terpengaruh sama sekali.
-- ============================================================
