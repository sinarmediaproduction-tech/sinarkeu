-- ============================================================
-- MIGRASI: Tambah kolom account_tag ke tabel settings,
--          transactions, dan audit_logs
-- Jalankan sekali di Supabase SQL Editor
-- ============================================================

-- ── TABEL: settings ─────────────────────────────────────────

-- 1. Tambah kolom account_tag (nullable agar baris lama tidak error)
ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS account_tag TEXT DEFAULT NULL;

-- 2. Index untuk filter account_tag
CREATE INDEX IF NOT EXISTS idx_settings_account_tag
    ON settings (account_tag)
    WHERE account_tag IS NOT NULL;

-- 3. Index composite untuk query umum (tag + book_id + key)
CREATE INDEX IF NOT EXISTS idx_settings_tag_book_key
    ON settings (account_tag, book_id, key)
    WHERE account_tag IS NOT NULL;

-- ── TABEL: transactions ──────────────────────────────────────

-- 4. Tambah kolom account_tag ke transactions
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS account_tag TEXT DEFAULT NULL;

-- 5. Index untuk filter account_tag di transactions
CREATE INDEX IF NOT EXISTS idx_transactions_account_tag
    ON transactions (account_tag)
    WHERE account_tag IS NOT NULL;

-- 6. Index composite: tag + book_id + date (pola query paling umum)
CREATE INDEX IF NOT EXISTS idx_transactions_tag_book_date
    ON transactions (account_tag, book_id, date DESC)
    WHERE account_tag IS NOT NULL;

-- ── TABEL: audit_logs ───────────────────────────────────────

-- 7. Tambah kolom account_tag ke audit_logs
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS account_tag TEXT DEFAULT NULL;

-- 8. Index untuk filter account_tag di audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_account_tag
    ON audit_logs (account_tag)
    WHERE account_tag IS NOT NULL;

-- 9. Index composite: tag + book_id + timestamp (pola query paling umum)
CREATE INDEX IF NOT EXISTS idx_audit_logs_tag_book_ts
    ON audit_logs (account_tag, book_id, timestamp DESC)
    WHERE account_tag IS NOT NULL;

-- ============================================================
-- Setelah menjalankan SQL ini, app akan otomatis:
--   - Menambahkan account_tag ke setiap push baru (settings,
--     transactions, audit_logs)
--   - Query GET menggunakan OR filter: tag cocok ATAU NULL,
--     sehingga data lama tetap terbaca sebelum migrasi selesai
--   - Migrasi satu kali (window.runOneTimeMigrations) akan
--     men-tag ulang semua baris NULL yang bisa diidentifikasi
--     sebagai milik akun ini, lalu menandai selesai di
--     localStorage agar tidak diulang
-- ============================================================
