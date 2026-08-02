-- ============================================================
-- CLEANUP: Hapus policy RLS legacy/duplikat yang qual = true
-- tanpa syarat (beberapa bahkan roles = {public})
-- Dijalankan SEKALI di Supabase SQL Editor, 27 Juli 2026.
-- ============================================================
--
-- LATAR BELAKANG:
-- Audit pg_policies pada transactions/settings/payment_reminders/backups
-- menemukan sisa-sisa setup RLS yang dilakukan berkali-kali (kemungkinan
-- lewat Supabase dashboard UI, bukan migrasi terversi), dengan nama
-- berbeda-beda tiap kali ("Allow all", "allow_all", "Izinkan anon ...",
-- "anon_all_*", "Enable all for authenticated users"). Semua policy ini
-- punya qual/with_check = true tanpa syarat sama sekali.
--
-- KENAPA INI BERBAHAYA:
-- RLS Postgres bersifat permissive-OR -- kalau SATU SAJA policy pada
-- suatu perintah (SELECT/INSERT/UPDATE/DELETE) mengizinkan, baris itu
-- tetap bisa diakses walau policy lain lebih ketat. Jadi policy-policy
-- legacy ini membuat pembatasan shared-book (sk_is_shared_book,
-- sk_role_for_book, dst di harden_shared_book_data_rls.sql) jadi
-- percuma untuk request lewat anon key -- dan untuk `settings`, bahkan
-- ada policy roles = {public} yang menembus pembatasan role
-- authenticated (admin/editor) juga. Nama "Enable all for authenticated
-- users" itu menyesatkan: rolenya tetap {public}, bukan {authenticated}.
--
-- YANG DIPERTAHANKAN (BUKAN BUG):
-- anon_full_access pada `backups` memang qual = true tanpa syarat --
-- SENGAJA, karena backup dilindungi oleh enkripsi ciphertext (lihat
-- harden_transactions_encryption.sql), bukan oleh RLS scoping per
-- book_id. Policy `anon_full_access` pada tabel lain justru DIBATASI
-- (NOT sk_is_shared_book(book_id)) dan itu benar, jangan disentuh.
-- ============================================================

-- ── transactions ──────────────────────────────────────────────
drop policy if exists "Izinkan anon delete transactions" on public.transactions;
drop policy if exists "Izinkan anon insert transactions" on public.transactions;
drop policy if exists "Izinkan anon update transactions" on public.transactions;
drop policy if exists "anon delete transactions" on public.transactions;
drop policy if exists "anon insert transactions" on public.transactions;
drop policy if exists "anon update transactions" on public.transactions;
drop policy if exists "anon_all_transactions" on public.transactions;

-- ── settings ──────────────────────────────────────────────────
drop policy if exists "Allow all" on public.settings;
drop policy if exists "Allow all access to settings" on public.settings;
drop policy if exists "Enable all for authenticated users" on public.settings;
drop policy if exists "allow_all" on public.settings;
drop policy if exists "anon_all_settings" on public.settings;

-- ── payment_reminders ─────────────────────────────────────────
drop policy if exists "Allow all access to payment_reminders" on public.payment_reminders;

-- ── backups (anon_full_access TIDAK didrop -- lihat catatan di atas) ──
drop policy if exists "Allow all" on public.backups;
drop policy if exists "Allow all for backups" on public.backups;
drop policy if exists "allow_all" on public.backups;
drop policy if exists "anon_all_backups" on public.backups;

-- ============================================================
-- VERIFIKASI: jalankan per tabel, bandingkan dengan daftar "yang benar"
-- ============================================================
-- transactions (10): anon_full_access, transactions_legacy_anon,
--   shared_tx_select/write/update/delete,
--   transactions_shared_select/write/update/delete
-- settings (10): anon_full_access, settings_legacy_anon,
--   settings_shared_select/write/update/delete,
--   shared_settings_select/admin_write/admin_update/admin_delete
-- payment_reminders (10): anon_full_access, payment_reminders_legacy_anon,
--   payment_reminders_shared_select/write/update/delete,
--   shared_pr_select/write/update/delete
-- backups (1): anon_full_access

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('transactions', 'settings', 'payment_reminders', 'backups')
order by tablename, policyname;
