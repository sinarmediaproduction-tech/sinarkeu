# Security Audit — SinarKeu

Catatan status keamanan yang sudah diverifikasi & diperbaiki. Update file ini
setiap kali ada temuan/fix keamanan baru — jangan hanya catat di riwayat
percakapan, supaya tetap ada jejaknya di repo.

## Model ancaman dasar

Aplikasi ini pakai **satu anon key Supabase** untuk semua request tanpa
Supabase Auth (kecuali untuk shared book, lihat di bawah). Konsekuensinya:
Postgres tidak bisa membedakan "siapa" yang meminta lewat anon key — RLS
berbasis `account_tag`/`book_id` di level ini adalah **kesepakatan aplikasi**,
bukan pagar keamanan sungguhan. Siapa pun yang punya URL project + anon key
bisa membaca/menulis lewat REST API langsung, terlepas dari filter
`account_tag` di sisi client.

**Garis pertahanan sesungguhnya untuk data finansial adalah enkripsi
client-side** (AES-256-GCM + PBKDF2, `js/crypto.js`), bukan RLS, untuk buku
non-shared. Untuk shared book, isolasi sesungguhnya ADA di level database
karena memakai Supabase Auth + RLS berbasis `auth.uid()`/role
(`sk_role_for_book`, dll — lihat `sql/shared_books_roles.sql`).

## Status enkripsi data finansial

- Kolom sensitif (`amount`, `category`, `description`, `attachment`, `type`)
  di `transactions` dienkripsi jadi satu kolom `enc_payload` sebelum dikirim
  ke server. Baris lama (pra-migrasi) tetap punya fallback baca plaintext.
  Lihat `sql/harden_transactions_encryption.sql`.
- Kolom `data` di `backups` juga ciphertext (bukan JSON plaintext) untuk
  backup baru.
- **JANGAN** kembalikan ke plaintext di kolom lama `transactions`/`backups`
  — ini fix yang disengaja, bukan legacy yang boleh "dirapikan".

## RLS — status per tabel (terakhir diverifikasi 27 Juli 2026)

Ditemukan & dibersihkan: 17 policy legacy/duplikat di 4 tabel
(`transactions`, `settings`, `payment_reminders`, `backups`) dengan
`qual`/`with_check = true` tanpa syarat — beberapa bahkan `roles = {public}`,
lebih parah dari `{anon}` karena juga menembus pembatasan role
`authenticated` (admin/editor) pada shared book. Root cause: setup RLS awal
dilakukan berkali-kali langsung lewat Supabase dashboard UI dengan nama
berbeda-beda (`Allow all`, `allow_all`, `Izinkan anon ...`, `anon_all_*`,
`Enable all for authenticated users`), tidak pernah masuk migrasi terversi.
Fix ada di `sql/cleanup_legacy_open_policies.sql`.

Policy yang **sengaja** tetap terbuka (bukan bug):
- `anon_full_access` pada `backups` — `qual = true` tanpa syarat, karena
  dilindungi enkripsi ciphertext, bukan RLS scoping per `book_id`.

Kalau audit ulang, jalankan per tabel:
```sql
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = '<nama_tabel>'
order by policyname;
```
dan bandingkan jumlah/pola dengan yang didokumentasikan di
`sql/cleanup_legacy_open_policies.sql`. RLS Postgres bersifat
**permissive-OR** — satu policy longgar yang lolos cek membuat semua policy
ketat lain di tabel yang sama jadi percuma, jadi jangan asumsikan state DB
sama dengan yang tertulis di file migrasi; selalu cek `pg_policies` langsung.

## Header HTTP (Cloudflare Pages)

`_headers` di root dibaca otomatis oleh Cloudflare Pages untuk header yang
TIDAK bisa (atau tidak berfungsi) lewat `<meta>` tag di `index.html`:
- `frame-ancestors` — diabaikan CSP kalau dikirim lewat meta.
- `X-Frame-Options` / `Strict-Transport-Security` / `X-Content-Type-Options`
  — tidak didukung `meta http-equiv` sama sekali.

CSP lengkap (`script-src`, `connect-src`, dst) tetap di meta tag
`index.html` — itu bagian yang memang berfungsi lewat meta.

**Penting:** file `_headers` sempat ketahuan kosong (isinya tanpa sengaja
tertimpa/kepindah ke file ini) sehingga header di atas tidak aktif di
production untuk sementara waktu. Sudah diperbaiki — cek isi `_headers`
benar-benar ada isinya setiap kali menyentuh konfigurasi deploy Cloudflare
Pages.

## Item yang belum/tidak diverifikasi di audit ini

- `payment_reminders`, `settings`, `transactions`, `backups` sudah dicek
  `pg_policies` langsung (lihat di atas). Tabel lain di luar 4 yang disebut
  belum dicek — kalau menambah tabel baru dengan RLS, tambahkan ke daftar
  audit ini.
- Belum ada penetration test / audit eksternal formal — ini catatan hasil
  self-review, bukan sertifikasi keamanan.
