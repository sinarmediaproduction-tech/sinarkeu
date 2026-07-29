-- ============================================================
-- FITUR: Upsert sungguhan untuk tabel `settings` (root-cause fix)
-- Jalankan SEKALI di Supabase SQL Editor.
-- ============================================================
--
-- KONTEKS:
-- js/db.js (window.pushSetting, window.pushCryptoSaltCheck) SUDAH sejak
-- lama mengirim header `Prefer: resolution=merge-duplicates` + parameter
-- `?on_conflict=book_id,key,account_tag` -- dan komentar di kode itu
-- SENGAJA menyebut file migrasi ini (`fix_settings_upsert.sql`) sebagai
-- syaratnya. Tapi file ini sendiri ternyata tidak pernah ada di repo, jadi
-- kalau constraint `settings_unique_row` juga belum pernah dibuat manual
-- di database, on_conflict itu tidak pernah benar-benar match apa pun --
-- PostgREST/Postgres MEMBUTUHKAN unique constraint/index yang persis
-- cocok dengan kolom on_conflict, kalau tidak ada, setiap POST 'settings'
-- jatuh balik ke INSERT biasa (baris baru terus, tidak pernah menimpa).
--
-- AKIBATNYA: tabel `settings` insert-only, terus membengkak selamanya
-- setiap kali user simpan apa pun (books, budgets, fase_kehidupan, dst).
-- Ini yang membuat window.pullAllSettings() (dipanggil TIAP switchBook())
-- makin lama makin lambat, karena selalu menarik+memproses SELURUH
-- riwayat snapshot yang tidak pernah dibersihkan.
--
-- CATATAN NULL account_tag: Postgres tidak menganggap dua NULL sebagai
-- "sama" untuk keperluan UNIQUE constraint biasa -- jadi baris settings
-- dengan account_tag NULL (baris lama sebelum fitur tag ada, ATAU baris
-- buku Bersama yang MEMANG SENGAJA dikirim tanpa tag, lihat komentar di
-- window.pushSetting) TIDAK akan pernah ke-cover oleh constraint di
-- Langkah 2 di bawah -- baris begitu tetap bisa terus ter-INSERT baru.
-- Ini bukan bug, tapi keterbatasan bawaan Postgres. Langkah 3 (pg_cron)
-- menutup celah itu dengan pembersihan berkala.
-- ============================================================

-- ── LANGKAH 1: Bersihkan duplikat yang SUDAH menumpuk sebelum constraint
-- dibuat. WAJIB dijalankan dulu -- Postgres menolak membuat unique
-- constraint kalau datanya sendiri masih ada duplikat. Untuk tiap
-- kombinasi (book_id, key, account_tag) -- termasuk yang account_tag-nya
-- NULL, karena PARTITION BY (beda dari UNIQUE constraint) MEMANG
-- menganggap NULL sama dengan NULL untuk pengelompokan -- simpan cuma
-- baris dengan updated_at TERBARU, hapus sisanya.
-- Catatan: pakai `ctid` (identifier fisik baris bawaan Postgres, ada di
-- SEMUA tabel apa pun skemanya) sebagai pengganti kolom `id` -- tabel
-- `settings` di sini ternyata tidak punya kolom `id` biasa.
WITH ranked AS (
    SELECT ctid,
           ROW_NUMBER() OVER (
               PARTITION BY book_id, key, account_tag
               ORDER BY updated_at DESC NULLS LAST, ctid DESC
           ) AS rn
    FROM public.settings
)
DELETE FROM public.settings
WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1);

-- ── LANGKAH 2: Unique constraint supaya on_conflict di js/db.js benar-benar
-- jalan sebagai UPDATE, bukan INSERT baru, untuk baris ber-account_tag.
-- Aman dijalankan ulang (idempotent) -- dilewati kalau constraint dengan
-- nama ini sudah ada (mis. sempat dibuat manual sebelumnya).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'settings_unique_row'
    ) THEN
        ALTER TABLE public.settings
            ADD CONSTRAINT settings_unique_row UNIQUE (book_id, key, account_tag);
    END IF;
END $$;

-- ── LANGKAH 3: Cron harian untuk baris account_tag NULL (buku Bersama +
-- baris legacy) yang tidak tercakup constraint Langkah 2 (lihat catatan
-- NULL di atas). Polanya sama seperti sql/cleanup_old_audit_logs.sql --
-- job berjalan sebagai role yang menjadwalkannya (biasanya `postgres`,
-- otomatis lewati RLS), jadi membersihkan lintas semua akun/tag sekaligus.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sk_dedupe_null_tag_settings') THEN
        PERFORM cron.unschedule('sk_dedupe_null_tag_settings');
    END IF;
END $$;

SELECT cron.schedule(
    'sk_dedupe_null_tag_settings',
    '30 3 * * *', -- tiap hari jam 03:30 UTC (≈ 10:30 WIB), setelah cron cleanup audit_logs
    $$
    WITH ranked AS (
        SELECT ctid,
               ROW_NUMBER() OVER (
                   PARTITION BY book_id, key, account_tag
                   ORDER BY updated_at DESC NULLS LAST, ctid DESC
               ) AS rn
        FROM public.settings
        WHERE account_tag IS NULL
    )
    DELETE FROM public.settings
    WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1)
    $$
);

-- ============================================================
-- VERIFIKASI SETELAH MENJALANKAN:
--   1. Constraint sudah dibuat:
--        SELECT conname FROM pg_constraint WHERE conname = 'settings_unique_row';
--      -> harus muncul 1 baris.
--   2. Cron job sudah terjadwal:
--        SELECT * FROM cron.job WHERE jobname = 'sk_dedupe_null_tag_settings';
--      -> harus muncul 1 baris, schedule '30 3 * * *', active = true.
--   3. Cek jumlah baris settings sebelum vs sesudah (opsional, buat lihat
--      seberapa besar tabel ini sempat menumpuk):
--        SELECT count(*) FROM public.settings;
--
-- SETELAH INI: tidak ada perubahan JS yang dibutuhkan -- window.pushSetting
-- dan window.pushCryptoSaltCheck sudah mengirim on_conflict dengan benar,
-- cuma menunggu constraint ini ada. Push berikutnya untuk baris ber-tag
-- akan langsung UPDATE baris lama, bukan numpuk baris baru.
-- ============================================================
