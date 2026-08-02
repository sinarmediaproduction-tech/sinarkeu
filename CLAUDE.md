-- ============================================================
-- PERFORMA: Index yang cocok dengan pola query SEBENARNYA saat
-- buka/pindah buku (pullFromCloudSilently, pullAllBooksFromCloud
-- di js/transaction.js, pullAllSettings di js/db.js).
-- Jalankan sekali di Supabase SQL Editor. Aman dijalankan berkali-
-- kali (IF NOT EXISTS) dan tidak mengubah data sama sekali.
-- ============================================================
--
-- KENAPA INDEX YANG SUDAH ADA (supabase_migration_account_tag.sql)
-- BELUM CUKUP:
-- idx_transactions_tag_book_date dan idx_audit_logs_tag_book_ts
-- diawali kolom account_tag dan PARTIAL (WHERE account_tag IS NOT
-- NULL). Itu bagus untuk buku PRIBADI (query pakai OR: tag cocok
-- ATAU tag NULL -- lihat window.tagOrFilter di js/db.js), tapi:
--   1. Untuk BUKU BERSAMA, tagOrFilter() SENGAJA tidak mengirim
--      filter account_tag sama sekali (lihat komentar di
--      js/db.js) -- query-nya murni `book_id=eq...&is_deleted=
--      eq.false&order=date.desc`, yang tidak cocok index manapun
--      yang diawali account_tag. Makin banyak transaksi di buku
--      bersama itu, makin lambat (sequential scan).
--   2. Kolom `is_deleted` (dipakai di HAMPIR SEMUA query GET
--      transactions) belum ikut di index manapun -- Postgres masih
--      harus filter baris tombstone secara manual setelah index
--      scan by book_id.
-- Index baru di bawah menutup DUA celah itu sekaligus, untuk semua
-- buku (pribadi maupun bersama).
-- ============================================================

-- Pola paling umum: SELECT ... WHERE book_id = ? AND is_deleted = false
-- ORDER BY date DESC (dipakai window.pullFromCloudSilently &
-- window.pullAllBooksFromCloud, tanpa syarat account_tag).
CREATE INDEX IF NOT EXISTS idx_transactions_book_notdeleted_date
    ON public.transactions (book_id, date DESC)
    WHERE is_deleted = false;

-- Pola incremental sync: SELECT ... WHERE book_id = ? AND
-- updated_at > ? ORDER BY updated_at DESC (dipakai saat lastSync
-- sudah ada -- lihat window.pullFromCloudSilently). Query ini
-- SENGAJA tidak memfilter is_deleted (butuh baca tombstone juga),
-- jadi index terpisah, bukan partial.
CREATE INDEX IF NOT EXISTS idx_transactions_book_updated
    ON public.transactions (book_id, updated_at DESC);

-- Tabel `settings` insert-only (tiap push = baris baru, tidak pernah
-- di-update in-place -- lihat catatan di js/db.js) sehingga terus
-- membengkak. pullAllSettings() query SEMUA baris user ini diurutkan
-- updated_at DESC, dan (untuk buku bersama) juga per book_id +
-- updated_at DESC -- keduanya butuh index ini supaya tidak makin
-- lambat seiring bertambahnya riwayat snapshot.
CREATE INDEX IF NOT EXISTS idx_settings_book_updated
    ON public.settings (book_id, updated_at DESC);

-- ============================================================
-- Verifikasi setelah dijalankan:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname = 'public' AND tablename IN ('transactions', 'settings')
--   ORDER BY tablename, indexname;
-- ============================================================
