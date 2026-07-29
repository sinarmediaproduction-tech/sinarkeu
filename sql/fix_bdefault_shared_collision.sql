-- ============================================================
-- FIX SEKALI-JALAN: pindahkan Buku Bersama yang terlanjur dibuat dengan
-- ID 'b_default' ke ID unik baru. Jalankan SEKALI di Supabase SQL Editor,
-- kapan saja (tidak bergantung urutan file lain di folder ini).
-- ============================================================
--
-- MASALAH:
-- 'b_default' adalah ID LITERAL yang dipakai SEMUA akun untuk buku pertama
-- mereka ("Buku Utama" -- lihat js/account.js, js/app.js, js/config.js),
-- beda dari buku lain yang ID-nya di-random pakai timestamp+random.
-- sk_books.id (fondasi Buku Bersama, sql/shared_books_roles.sql) adalah
-- TEXT PRIMARY KEY GLOBAL lintas akun -- satu backend Supabase dipakai
-- banyak akun sekaligus, isolasi data personal SELAMA INI cuma lewat
-- account_tag, bukan lewat sk_books.id yang terpisah per akun.
--
-- Sebelum window.skMakeBookShared (js/auth.js) dipatch untuk mencegah ini
-- (lihat window._skMigrateBookIdLocal), ada buku yang terlanjur dijadikan
-- Buku Bersama dengan ID 'b_default' apa adanya. Akibatnya
-- sk_book_is_shared('b_default') jadi TRUE untuk SEMUA akun lain yang buku
-- utamanya masih ID default sama (yaitu SEMUA akun) -- padahal buku mereka
-- tidak terkait sama sekali. Policy settings_legacy_anon/
-- transactions_legacy_anon (sql/harden_shared_book_data_rls.sql) yang
-- mengizinkan tulis anon-key HANYA kalau `NOT sk_book_is_shared(book_id)`
-- jadi menolak semua tulisan mereka ke buku pribadi (error 42501 "new row
-- violates row-level security policy").
--
-- PERBAIKAN:
-- Pindahkan baris sk_books + book_members + data (settings/transactions/
-- payment_reminders yang account_tag-nya NULL, yaitu data yang benar-benar
-- ditulis lewat sesi login Buku Bersama ini, BUKAN data akun pribadi lain)
-- dari book_id 'b_default' ke ID baru yang unik. Setelah ini, 'b_default'
-- tidak lagi ada di sk_books sama sekali -- kembali "bersih", aman dipakai
-- akun mana pun sebagai ID buku pribadi biasa.
--
-- CATATAN PENTING SEBELUM MENJALANKAN:
-- Ganti nilai :new_book_id di bawah kalau perlu (harus unik, belum pernah
-- dipakai buku lain). Skrip ini HANYA memindahkan baris settings/
-- transactions/payment_reminders yang account_tag IS NULL -- verifikasi
-- dulu isinya masuk akal (lihat query pengecekan yang sudah dipakai saat
-- diagnosis: group by key + rentang updated_at) sebelum menjalankan bagian
-- UPDATE di bawah, supaya tidak salah pindah data akun pribadi lain yang
-- kebetulan juga masih account_tag NULL (data lama dari sebelum kolom itu
-- ada).
-- ============================================================

BEGIN;

-- Ganti ID baru di sini kalau mau nilai lain -- pastikan formatnya unik
-- dan TIDAK bentrok dengan book_id manapun yang sudah ada.
DO $$
DECLARE
    old_id TEXT := 'b_default';
    new_id TEXT := 'b_1785321045193_h4q2z';
BEGIN
    -- 1. Salin baris sk_books ke ID baru (bukan INSERT baru dari nol --
    --    pertahankan name/created_by/created_at asli).
    INSERT INTO public.sk_books (id, name, is_shared, created_by, created_at)
    SELECT new_id, name, is_shared, created_by, created_at
    FROM public.sk_books
    WHERE id = old_id;

    -- 2. Salin keanggotaan (admin/editor/viewer) ke ID baru.
    INSERT INTO public.book_members (book_id, user_id, role, created_at)
    SELECT new_id, user_id, role, created_at
    FROM public.book_members
    WHERE book_id = old_id;

    -- 3. Pindahkan (bukan salin) data yang account_tag-nya NULL -- ini data
    --    yang ditulis lewat sesi login Buku Bersama (pushSetting()/
    --    encodeCloudTxPayload() sengaja kirim account_tag=null untuk buku
    --    shared, lihat js/db.js & js/crypto.js).
    UPDATE public.transactions
       SET book_id = new_id
     WHERE book_id = old_id AND account_tag IS NULL;

    UPDATE public.settings
       SET book_id = new_id
     WHERE book_id = old_id AND account_tag IS NULL;

    UPDATE public.payment_reminders
       SET book_id = new_id
     WHERE book_id = old_id AND account_tag IS NULL;

    -- 4. Hapus baris lama supaya 'b_default' tidak lagi terdaftar sebagai
    --    buku bersama di sk_books/book_members (data pribadi akun lain yang
    --    masih pakai book_id='b_default' TIDAK disentuh -- cuma baris
    --    sk_books/book_members yang dihapus, bukan transactions/settings
    --    milik akun lain).
    DELETE FROM public.book_members WHERE book_id = old_id;
    DELETE FROM public.sk_books WHERE id = old_id;
END $$;

COMMIT;

-- ── Verifikasi setelah jalan ──────────────────────────────────
-- 1. 'b_default' sudah tidak ada lagi di sk_books:
--      select * from sk_books where id = 'b_default';  -- harus 0 baris
-- 2. Buku bersama sekarang ada di ID baru dengan 3 anggota yang sama:
--      select * from book_members where book_id = 'b_1785321045193_h4q2z';
-- 3. Data ikut pindah:
--      select count(*) from settings where book_id = 'b_1785321045193_h4q2z';
-- Setelah ini, minta ketiga anggota (admin: sinarmedia.production@gmail.com,
-- epuser.ad@gmail.com; viewer: indahsarvn@gmail.com) login ULANG ke Buku
-- Bersama ini (Manajemen User / Kelola Buku) supaya window._skSharedRoles
-- di device mereka ke-refresh dan menampilkan buku ini di bawah ID barunya
-- -- buku lama ber-ID 'b_default' di daftar mereka akan otomatis hilang
-- (dicabut, lihat _skRevokeStaleSharedBooks di js/auth.js) begitu refresh
-- jalan, lalu buku baru (ID baru, data sama) akan muncul lagi di daftar.
