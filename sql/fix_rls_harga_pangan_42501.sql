-- ============================================================
-- FIX RLS: harga_pangan_referensi (error 42501 / HTTP 401)
-- ============================================================
-- GEJALA: "new row violates row-level security policy (USING expression)
-- for table harga_pangan_referensi" (kode PostgreSQL 42501) saat app
-- menulis cache harga harian. PostgREST membungkusnya jadi HTTP 401,
-- sehingga terlihat seperti API key salah padahal bukan.
--
-- AKAR MASALAH: tabel harga_pangan_referensi ada tapi policy INSERT untuk
-- role anon tidak ada / terhapus. RLS itu default-deny: tanpa policy,
-- insert langsung ditolak. Ini TIDAK ada hubungannya dengan perubahan
-- wilayah acuan (Magetan) — murni kekurangan setup tabel ini (skrip setup
-- di index.html tidak membuat tabel ini, jadi sering kelewat).
--
-- FIX: pastikan tabel, GRANT, dan policy anon select/insert ada.
-- Idempoten — aman dijalankan berulang kali. Jalankan SEKALI di Supabase
-- SQL Editor (project yang dipakai app).
-- ============================================================

create table if not exists public.harga_pangan_referensi (
  id bigint generated always as identity primary key,
  commodity_slug text not null,
  commodity_name text not null,
  unit text not null default 'kg',
  price numeric not null,
  price_date date not null,
  fetched_at timestamptz not null default now(),
  region text
);

create unique index if not exists harga_pangan_referensi_unique
  on public.harga_pangan_referensi (commodity_slug, price_date);

create index if not exists harga_pangan_referensi_date_idx
  on public.harga_pangan_referensi (price_date desc);

create index if not exists harga_pangan_referensi_region_idx
  on public.harga_pangan_referensi (region);

grant usage on schema public to anon, authenticated;
grant select, insert on public.harga_pangan_referensi to anon, authenticated;

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

-- Verifikasi: harus muncul 2 policy di bawah (select + insert, using/wth
-- check = true, tanpa pembatasan).
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'harga_pangan_referensi'
order by policyname;
