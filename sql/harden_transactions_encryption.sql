-- ============================================================
-- HARDENING: Enkripsi field sensitif transaksi & backup
-- Jalankan SEKALI di Supabase SQL Editor, SEBELUM men-deploy kode
-- js/ yang baru (crypto.js, transaction.js, backup.js versi audit ini).
-- ============================================================
--
-- MASALAH YANG DIPERBAIKI:
-- Selama ini kolom `amount`, `category`, `description`, `attachment`, `type`
-- di tabel `transactions`, dan kolom `data` di tabel `backups`, berisi data
-- keuangan ASLI dalam bentuk PLAINTEXT. Hanya kredensial Supabase & tabel
-- `settings` yang sudah dienkripsi client-side. Siapa pun yang bisa membaca
-- database ini secara langsung (service-role key bocor, RLS salah setup,
-- akses dashboard Supabase oleh pihak lain, dst) bisa melihat seluruh
-- riwayat keuangan pengguna secara terbuka.
--
-- PERBAIKAN:
-- Kode aplikasi sekarang mengenkripsi amount/category/description/attachment/
-- type jadi SATU kolom `enc_payload` (AES-GCM, kunci diturunkan dari password
-- pengguna, tidak pernah dikirim ke server) sebelum push. Kolom lama dibuat
-- NULLABLE (dan tidak lagi diisi data asli) supaya insert tidak gagal.
-- Baris LAMA (sebelum migrasi ini) tetap bisa dibaca -- kode punya fallback
-- baca plaintext lama jika enc_payload kosong (lihat window.decodeCloudTxRow).
--
-- CATATAN PENTING SOAL RLS:
-- Migrasi ini TIDAK membuat isolasi antar-user yang sesungguhnya di level
-- database -- app ini memakai SATU anon key untuk semua request (tidak ada
-- Supabase Auth), jadi Postgres tidak bisa tahu "siapa" yang sedang meminta.
-- `account_tag` hanyalah kesepakatan di sisi APLIKASI, bukan pagar keamanan;
-- siapa pun yang punya URL + anon key project ini bisa membaca/menulis semua
-- baris lewat REST API langsung, terlepas dari account_tag. Enkripsi di
-- migrasi inilah yang jadi garis pertahanan sesungguhnya untuk isi data.
-- Untuk isolasi per-user yang sebenarnya di level database, perlu migrasi ke
-- Supabase Auth + RLS berbasis auth.uid() -- lihat SECURITY_AUDIT.md bagian
-- "Roadmap Multiuser Sesungguhnya".
-- ============================================================

-- ── TABEL: transactions ──────────────────────────────────────
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS enc_payload TEXT DEFAULT NULL;
ALTER TABLE transactions ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE transactions ALTER COLUMN category DROP NOT NULL;
ALTER TABLE transactions ALTER COLUMN description DROP NOT NULL;
ALTER TABLE transactions ALTER COLUMN attachment DROP NOT NULL;
ALTER TABLE transactions ALTER COLUMN type DROP NOT NULL;

-- ── TABEL: backups ───────────────────────────────────────────
-- Kolom `data` sudah TEXT, tidak perlu diubah tipenya -- sekarang berisi
-- ciphertext base64 (AES-GCM) alih-alih JSON plaintext untuk backup baru.

-- ── ENABLE RLS (baseline, lihat catatan di atas) ─────────────
-- Mengaktifkan RLS tanpa Supabase Auth tidak menambah isolasi antar-user,
-- tapi tetap praktik baik: memastikan hanya kebijakan eksplisit di bawah
-- ini yang berlaku, bukan grant default yang lebih longgar. Jalankan bagian
-- ini HANYA jika belum pernah RLS aktif di tabel-tabel ini (aman dijalankan
-- berkali-kali karena pakai DROP POLICY IF EXISTS + CREATE POLICY).
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_reminders') THEN
        EXECUTE 'ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        EXECUTE 'ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY';
    END IF;
END $$;

DROP POLICY IF EXISTS anon_full_access ON transactions;
CREATE POLICY anon_full_access ON transactions FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_full_access ON settings;
CREATE POLICY anon_full_access ON settings FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_full_access ON backups;
CREATE POLICY anon_full_access ON backups FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- OPSIONAL, JALANKAN BELAKANGAN (setelah yakin semua device sudah update
-- ke kode baru dan enc_payload terisi untuk semua baris aktif): bersihkan
-- sisa data plaintext lama dari baris yang SUDAH punya enc_payload, supaya
-- tidak ada duplikat data sensitif di kolom lama.
--
-- UPDATE transactions
-- SET amount = NULL, category = NULL, description = NULL, attachment = NULL, type = NULL
-- WHERE enc_payload IS NOT NULL;
-- ============================================================
