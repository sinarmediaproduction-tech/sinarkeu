-- ============================================================
-- HARGA PANGAN REFERENSI — tambah kolom region
-- ============================================================
-- SETELAH perubahan wilayah acuan ke "Kabupaten Magetan" (WILAYAH_ACUAN
-- di api/harga-pangan.js), label wilayah (mis. "Kabupaten Magetan" /
-- "Provinsi Jawa Timur" / "Nasional") cuma dibawa oleh proxy dan ditampilkan
-- di cache lokal UI, TAPI tidak pernah ditulis ke tabel Supabase. Akibatnya
-- di tabel histori/tren (window.fetchHargaPanganHistory, yang baca langsung
-- dari Supabase) kolom region tidak ada -> baris histori lama tidak tahu
-- wilayahnya, dan label di UI jatuh ke fallback "Nasional".
--
-- Migrasi ini menambah kolom `region text` (nullable, boleh kosong untuk
-- baris historis pra-migrasi) supaya proxy bisa menyimpan wilayah tiap
-- harga harian. Idempoten: aman dijalankan berkali-kali.
--
-- Urutan eksekusi: jalankan SETELAH harga_pangan_referensi.sql (tabel sudah
-- ada). Tidak butuh ubah RLS/GRANT -- cuma menambah kolom ke tabel yang
-- sudah punya policy select/insert permisif.
--
-- Setelah migrasi ini, jalankan juga penyesuaian di api/harga-pangan.js &
-- js/harga-pangan.js (lihat komentar "WILAYAH" di sana) supaya kolom region
-- benar-benar terisi — migrasi ini sendiri HANYA menyiapkan skemanya.
-- ============================================================

alter table public.harga_pangan_referensi
  add column if not exists region text;

-- Index ringan supaya filter/group by region (kalau suatu hari dipakai)
-- tidak full-scan. Boleh diabaikan kalau tidak dipakai.
create index if not exists harga_pangan_referensi_region_idx
  on public.harga_pangan_referensi (region);
