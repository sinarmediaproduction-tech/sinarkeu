-- ============================================================
-- HARGA PANGAN REFERENSI -- auto-update harga di Daftar Belanja
-- (js/harga-pangan.js, js/shopping-list.js)
-- ============================================================
-- Sumber: Bank Indonesia PIHPS (lewat proxy api/harga-pangan.js).
--
-- CATATAN SOAL AKSES: berbeda dari tabel transactions/settings yang
-- datanya privat per akun (dijaga account_tag + enkripsi, lihat
-- sql/harden_transactions_encryption.sql), tabel ini isinya harga PASAR
-- PUBLIK -- bukan data keuangan pribadi siapa pun. Karena app ini pakai
-- anon key polos (bukan Supabase Auth) untuk buku pribadi biasa, RLS di
-- bawah sengaja dibuat terbuka (anon boleh SELECT & INSERT) supaya semua
-- device yang connect ke project Supabase yang sama bisa baca DAN ikut
-- menulis cache harga hari ini -- bukan cuma satu device yang "pertama
-- kali buka". Tidak ada UPDATE/DELETE policy: baris lama dibiarkan sebagai
-- histori, tidak pernah ditimpa (unique index di bawah mencegah duplikat
-- per komoditas per hari, bukan per menimpa baris lama).
--
-- Jalankan ini SEKALI di SQL Editor project Supabase Anda (sama seperti
-- skrip setup tabel transactions/settings/dll di awal Anda pasang app ini).
-- ============================================================

create table if not exists public.harga_pangan_referensi (
  id bigint generated always as identity primary key,
  commodity_slug text not null,
  commodity_name text not null,
  unit text not null default 'kg',
  price numeric not null,
  price_date date not null,
  fetched_at timestamptz not null default now()
);

-- Satu baris per komoditas per tanggal -- inilah yang bikin on_conflict di
-- window.callSupabaseAPI(..., '?on_conflict=commodity_slug,price_date') di
-- js/harga-pangan.js berfungsi sebagai "upsert" (kalau device lain sudah
-- nulis harga hari ini duluan, insert device ini otomatis di-merge, tidak
-- bikin baris dobel).
create unique index if not exists harga_pangan_referensi_unique
  on public.harga_pangan_referensi (commodity_slug, price_date);

create index if not exists harga_pangan_referensi_date_idx
  on public.harga_pangan_referensi (price_date desc);

alter table public.harga_pangan_referensi enable row level security;

drop policy if exists "anon read harga pangan" on public.harga_pangan_referensi;
create policy "anon read harga pangan"
  on public.harga_pangan_referensi
  for select
  using (true);

drop policy if exists "anon insert harga pangan" on public.harga_pangan_referensi;
create policy "anon insert harga pangan"
  on public.harga_pangan_referensi
  for insert
  with check (true);
