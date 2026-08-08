-- ============================================================
-- SKEMA DASAR: transactions, settings, backups, payment_reminders,
-- audit_logs
-- Jalankan SEKALI, PALING PERTAMA -- sebelum semua file lain di folder
-- sql/ ini.
-- ============================================================
--
-- KENAPA FILE INI ADA:
-- PANDUAN_SETUP_SQL.md (dokumen utama) ORIGINALNYA memuat skrip
-- pembuatan 5 tabel dasar ini. Dokumen itu tertimpa tidak sengaja (isinya
-- sempat berubah jadi salinan mentah api/harga-pangan.js) sehingga skema
-- dasarnya hilang dari repo. File ini merekonstruksinya dengan membaca
-- ulang persis kolom apa yang benar-benar dikirim/dibaca aplikasi hari
-- ini (js/db.js, js/transaction.js, js/render.js, js/backup.js,
-- js/payment-reminder.js) -- BUKAN salinan dari setup lama yang sudah
-- tidak ada jejaknya.
--
-- KALAU PROJECT SUPABASE ANDA SUDAH PUNYA TABEL-TABEL INI (setup lama,
-- sebelum file ini ditulis): JANGAN jalankan CREATE TABLE di bawah.
-- Jalankan dulu query verifikasi di paling bawah file ini, cocokkan
-- kolomnya -- baru lanjut ke sql/harden_transactions_encryption.sql dst.
-- Semua CREATE TABLE/ADD COLUMN di sini pakai IF NOT EXISTS jadi aman
-- dijalankan ulang di project yang sudah ada isinya (tidak menimpa data).
-- ============================================================

create extension if not exists pgcrypto; -- untuk gen_random_uuid() di bawah

-- ── TABEL: transactions ─────────────────────────────────────
-- id = text (dibuat client, format 'tx_<timestamp>_<random>', lihat
-- js/render.js). date = text (format lokal 'YYYY-MM-DDTHH:MM:SS', BUKAN
-- kolom date/timestamptz murni -- app mengandalkan urutan leksikografis
-- ISO untuk order/gte/lt, jadi tipe text paling aman & sesuai apa adanya).
create table if not exists public.transactions (
    id           text primary key,
    book_id      text not null,
    device_id    text,
    date         text not null,
    type         text,
    amount       numeric,
    category     text,
    description  text,
    attachment   text,
    is_deleted   boolean not null default false,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
create index if not exists idx_transactions_book_id on public.transactions (book_id);

-- ── TABEL: settings ──────────────────────────────────────────
-- Tidak punya kolom id -- tiap push adalah baris (book_id, key, value)
-- baru, dedup dilakukan lewat ctid + constraint settings_unique_row (lihat
-- sql/fix_settings_upsert.sql, dijalankan SETELAH file ini). book_id bisa
-- bernilai literal 'global' (dipakai khusus utk crypto_salt/crypto_check).
create table if not exists public.settings (
    book_id      text not null,
    key          text not null,
    value        text,
    updated_at   timestamptz not null default now()
);
create index if not exists idx_settings_book_id on public.settings (book_id);

-- ── TABEL: backups ───────────────────────────────────────────
-- CATATAN: fitur cloud backup lewat tabel ini sudah DIHAPUS dari aplikasi
-- (Safety Snapshot lokal jadi satu-satunya mekanisme pemulihan sekarang,
-- lihat js/safety-snapshot.js) -- tabel ini dipertahankan hanya supaya
-- baris LAMA (dari sebelum fitur dihapus) masih bisa dibersihkan lewat
-- window.callSupabaseAPI('backups','DELETE',...) di js/backup.js (mis.
-- saat factory reset). Boleh dilewati kalau project Anda memang baru
-- (tidak pernah pakai cloud backup sama sekali) -- file-file berikutnya
-- tetap aman dijalankan walau tabel ini kosong/tidak dipakai.
create table if not exists public.backups (
    id           uuid primary key default gen_random_uuid(),
    book_id      text not null,
    data         text,
    created_at   timestamptz not null default now()
);
create index if not exists idx_backups_book_id on public.backups (book_id);

-- ── TABEL: payment_reminders ─────────────────────────────────
-- id = text (format 'pr_<timestamp>_<random>', lihat js/payment-reminder.js).
create table if not exists public.payment_reminders (
    id           text primary key,
    book_id      text not null,
    name         text,
    day          integer,
    recurrence   text,
    month        integer,
    note         text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
create index if not exists idx_payment_reminders_book_id on public.payment_reminders (book_id);

-- ── TABEL: audit_logs ────────────────────────────────────────
create table if not exists public.audit_logs (
    id           bigint generated always as identity primary key,
    book_id      text,
    device_id    text,
    action       text,
    details      text,
    "timestamp"  timestamptz not null default now()
);
create index if not exists idx_audit_logs_book_id on public.audit_logs (book_id);

-- ── GRANT dasar ───────────────────────────────────────────────
-- RLS diaktifkan & di-policy-kan di sql/harden_transactions_encryption.sql
-- (langkah berikutnya) -- GRANT di sini hanya memberi izin dasar di level
-- privilege Postgres, tanpa GRANT ini RLS tidak pernah sempat dicek sama
-- sekali (PostgREST langsung menolak duluan).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.transactions        to anon, authenticated;
grant select, insert, update, delete on public.settings            to anon, authenticated;
grant select, insert, update, delete on public.backups             to anon, authenticated;
grant select, insert, update, delete on public.payment_reminders   to anon, authenticated;
grant select, insert                 on public.audit_logs          to anon, authenticated;

-- ============================================================
-- VERIFIKASI (jalankan kalau tabel-tabel ini SUDAH ada sebelumnya, untuk
-- cek kolomnya cocok dengan yang diasumsikan file-file berikutnya):
--
--   SELECT table_name, column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name IN ('transactions','settings','backups',
--                         'payment_reminders','audit_logs')
--   ORDER BY table_name, ordinal_position;
--
-- Wajib ada minimal: transactions(id, book_id, date, is_deleted,
-- updated_at), settings(book_id, key, value, updated_at),
-- payment_reminders(id, book_id, name, day, recurrence, month, note),
-- audit_logs(book_id, device_id, action, details, timestamp).
--
-- Lanjutkan ke sql/harden_transactions_encryption.sql setelah ini.
-- ============================================================
