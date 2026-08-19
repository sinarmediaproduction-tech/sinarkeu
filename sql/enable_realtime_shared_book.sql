-- ============================================================
-- REALTIME: Aktifkan replikasi utk `transactions` & `settings`
-- ============================================================
-- Jalankan SEKALI di Supabase SQL Editor pada project yang dipakai
-- aplikasi. Prasyarat WAJIB untuk js/realtime-sync.js (channel realtime
-- Buku Bersama, menggantikan polling 30 detik utk settings/transaksi
-- KHUSUS buku yang statusnya Buku Bersama -- lihat catatan lengkap di
-- js/realtime-sync.js).
--
-- KENAPA FILE INI DIBUTUHKAN
-- Supabase Realtime (postgres_changes) hanya mengirim event utk tabel yang
-- eksplisit didaftarkan ke publication `supabase_realtime` -- ini terpisah
-- dari RLS/policy biasa (yang sudah diatur sql/harden_shared_book_data_rls.sql
-- dkk). TANPA ini, client.channel(...).on('postgres_changes', ...) akan
-- ter-subscribe (status 'SUBSCRIBED') tapi TIDAK PERNAH menerima event
-- apa pun -- app tetap jalan benar karena js/realtime-sync.js otomatis
-- fallback ke polling kalau channel error/putus, TAPI kalau publication
-- ini belum di-setup, channel akan diam-diam "SUBSCRIBED" namun tidak
-- pernah memicu sinkronisasi lebih cepat dari polling 30 detik biasa --
-- gejalanya bukan error, cuma "kok tidak lebih cepat dari sebelumnya".
--
-- CATATAN RLS: publication ini TIDAK melewati RLS -- Supabase Realtime
-- tetap menghormati policy SELECT yang sudah ada di tabel (lihat
-- sql/harden_shared_book_data_rls.sql), jadi user hanya menerima event
-- utk baris yang memang boleh mereka SELECT. Aman dijalankan berdampingan
-- dengan RLS yang sudah aktif.
--
-- Aman dijalankan ulang (ADD TABLE akan error kalau tabel sudah terdaftar
-- -- makanya dibungkus DO block dengan pengecekan pg_publication_tables
-- di bawah, bukan ALTER PUBLICATION polos).
-- ============================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'transactions'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'settings'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
    END IF;
END $$;

-- [OPSIONAL TAPI DISARANKAN] REPLICA IDENTITY FULL memastikan payload event
-- UPDATE/DELETE dari Supabase membawa isi baris LENGKAP (termasuk kolom yang
-- tidak berubah), bukan cuma primary key -- js/realtime-sync.js sendiri
-- TIDAK memakai isi payload sama sekali (event hanya dipakai sebagai sinyal
-- "ada perubahan", lalu memicu ulang pull+decrypt lewat REST API seperti
-- biasa), jadi baris ini SEBENARNYA tidak wajib untuk fitur ini bekerja --
-- tapi tetap disarankan kalau di kemudian hari ada kebutuhan lain yang
-- membaca payload event secara langsung.
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER TABLE public.settings REPLICA IDENTITY FULL;

-- Verifikasi: kedua tabel harus muncul di hasil query ini.
SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
