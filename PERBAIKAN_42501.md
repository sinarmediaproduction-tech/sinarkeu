# Perbaikan sinkronisasi Supabase (42501)

Log menunjukkan pesan `new row violates row-level security policy` pada tabel
`settings` dan `backups`. Ini adalah penolakan RLS Supabase (kode PostgreSQL
`42501`), bukan API key yang salah.

## Terapkan perbaikan

1. Buka project Supabase yang URL dan anon key-nya dipakai aplikasi.
2. Buka **SQL Editor** lalu buat query baru.
3. Salin seluruh isi `sql/fix_rls_sync_42501.sql`, jalankan, dan pastikan
   query verifikasi terakhir menampilkan policy `settings_legacy_anon` dan
   `backups_legacy_anon`.
4. Muat ulang aplikasi, kemudian coba simpan pengaturan dan buat backup.

Untuk Buku Bersama, script juga memulihkan akses `authenticated`: anggota
viewer hanya membaca, sedangkan admin/editor dapat menulis. Jika fitur Buku
Bersama belum pernah disiapkan, jalankan terlebih dahulu migrasi yang disebut
di header file SQL tersebut.

Notifikasi aplikasi di `js/db.js` kini juga menyebut RLS dan nama migrasi
yang harus dijalankan, alih-alih mengarahkan pengguna memeriksa API key.
