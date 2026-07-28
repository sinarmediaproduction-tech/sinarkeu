-- ============================================================
-- FITUR: Retensi otomatis audit_logs (server-side, via pg_cron)
-- Jalankan SEKALI di Supabase SQL Editor.
-- ============================================================
--
-- KONTEKS:
-- audit_logs sebelumnya tidak punya batas waktu sama sekali -- baris
-- hanya terhapus kalau bukunya dihapus, buku direset, atau factory
-- reset (lihat js/book.js, js/backup.js). Selain itu log menumpuk
-- selamanya di database.
--
-- REKOMENDASI RETENSI: 180 hari (6 bulan).
-- Alasan tidak dipilih 30 hari: sengketa/pertanyaan soal siapa yang
-- ubah/hapus transaksi biasanya baru muncul saat tutup buku bulanan
-- atau rekonsiliasi kuartalan -- kalau log sudah hilang sebelum
-- sempat dicek, tidak ada cara lacak lagi. 180 hari menutupi kira-
-- kira 2 siklus tutup buku kuartalan. Kalau buku dipakai untuk
-- urusan bisnis/pajak, pertimbangkan naikkan ke 365 hari (ganti
-- angka INTERVAL '180 days' di bawah).
--
-- PENTING -- LANGKAH MANUAL DI DASHBOARD SEBELUM MENJALANKAN INI:
--   Buka Supabase Dashboard -> Database -> Extensions -> cari
--   "pg_cron" -> Enable. (Baris "create extension" di bawah sebagai
--   fallback kalau project kamu mengizinkan lewat SQL Editor, tapi
--   di sebagian project hosted Supabase langkah ini WAJIB lewat
--   toggle Extensions, tidak bisa lewat SQL Editor biasa.)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ── Hapus job lama dengan nama sama kalau sudah pernah dijadwalkan ──
-- Supaya script ini aman dijalankan ulang (idempotent) -- misalnya
-- kalau nanti kamu ganti angka retensi dan mau reschedule.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sk_cleanup_old_audit_logs') THEN
        PERFORM cron.unschedule('sk_cleanup_old_audit_logs');
    END IF;
END $$;

-- ── Jadwalkan: setiap hari jam 03:00 UTC (≈ 10:00 WIB), hapus baris
-- audit_logs yang timestamp-nya lebih tua dari 180 hari ──
-- Catatan: job pg_cron berjalan sebagai role yang menjadwalkannya
-- (biasanya `postgres`), yang otomatis melewati RLS -- jadi DELETE
-- ini akan menghapus baris SEMUA akun/tag, bukan cuma satu akun.
-- Itu memang perilaku yang diinginkan untuk maintenance job seperti
-- ini.
SELECT cron.schedule(
    'sk_cleanup_old_audit_logs',
    '0 3 * * *',
    $$DELETE FROM public.audit_logs WHERE timestamp::timestamptz < (now() - INTERVAL '180 days')$$
);

-- ============================================================
-- VERIFIKASI SETELAH MENJALANKAN:
--   SELECT * FROM cron.job WHERE jobname = 'sk_cleanup_old_audit_logs';
--   -> harus muncul 1 baris dengan schedule '0 3 * * *' dan active = true
--
-- Cek riwayat eksekusi (setelah job sempat jalan minimal sekali):
--   SELECT * FROM cron.job_run_details
--   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sk_cleanup_old_audit_logs')
--   ORDER BY start_time DESC LIMIT 5;
--
-- UNTUK GANTI ANGKA RETENSI NANTI:
--   Cukup jalankan ulang seluruh file ini dengan angka INTERVAL yang
--   baru (bagian unschedule di atas akan otomatis mengganti jadwal
--   lama).
--
-- UNTUK MATIKAN FITUR INI:
--   SELECT cron.unschedule('sk_cleanup_old_audit_logs');
-- ============================================================
