-- ============================================================
-- MIGRASI: Tambah kolom account_tag ke tabel settings
-- Jalankan sekali di Supabase SQL Editor
-- ============================================================

-- 1. Tambah kolom account_tag (nullable agar baris lama tidak error)
ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS account_tag TEXT DEFAULT NULL;

-- 2. Buat index untuk mempercepat query filter account_tag
CREATE INDEX IF NOT EXISTS idx_settings_account_tag
    ON settings (account_tag)
    WHERE account_tag IS NOT NULL;

-- 3. (Opsional) Buat index composite untuk query umum
CREATE INDEX IF NOT EXISTS idx_settings_tag_book_key
    ON settings (account_tag, book_id, key)
    WHERE account_tag IS NOT NULL;

-- ============================================================
-- Setelah migrasi ini, app akan otomatis:
--   - Menambahkan account_tag ke setiap push baru
--   - Memfilter pull hanya untuk tag akun yang aktif
--   - Memigrasikan baris lama (tanpa tag) ke tag yang benar
--     berdasarkan kemampuan dekripsi (hanya baris milik akun
--     sendiri yang bisa didekripsi dan akan diberi tag)
-- ============================================================
