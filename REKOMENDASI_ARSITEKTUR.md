# Rekomendasi Arsitektur SinarKeu

> Analisis dari `sinarkeu-main.zip` yang di-upload: `CLAUDE.md`,
> `ANALISIS_SINARKEU.md`, `index.html`, `js/*.js`, `sw.js`. Fokus di sini
> murni **efisiensi arsitektur** (bukan keamanan — itu sudah dibahas
> lengkap di `ANALISIS_SINARKEU.md`).

## 1. Kondisi arsitektur saat ini (fakta, bukan opini)

- **~21.300 baris JS di 34 modul**, `index.html` 2.898 baris berisi
  **144 modal**, semua vanilla JS/HTML/CSS, tanpa bundler/build step.
- **Semua 34 modul JS dimuat di setiap page load** lewat `document.write`
  di `index.html` (`SK_JS_FILES`) — termasuk modul yang jarang dipakai
  (`report.js` generator PDF, `fraud-detection.js`, `nutrisi.js`,
  `electricity-plan.js`) walau user cuma buka Dashboard sebentar.
- **Modul "dewa"**: `auth.js` 2.513 baris, `db.js` 1.492 baris,
  `budget.js`/`shopping-list.js`/`transaction.js` masing-masing
  >1.000 baris — mencampur logic UI, data, dan network di satu file.
- **Koordinasi antar modul murni lewat efek samping global**
  (`window.txs`, `window._dirtyTxIds`, `window.books`, dll di
  `js/config.js`) — tidak ada lapisan pemisah data/UI yang jelas. Ini
  sudah beberapa kali jadi sumber bug race-condition di sync (salah
  filter `account_tag`, settings menumpuk historis akibat insert-only,
  dll — lihat catatan incident di `CLAUDE.md`).
- **Sync cloud**: polling 30 detik + dirty-tracking manual, bukan
  realtime subscription Supabase yang sebenarnya sudah tersedia.
- **Nol automated test.** Verifikasi manual lewat browser tiap perubahan.

Ini bukan kode berantakan — cukup rapi untuk ukuran "vanilla no-build",
dan didokumentasikan dengan disiplin tinggi di `CLAUDE.md`. Tapi soal
"efisien", ini murni masalah skala: 34 file × global state × eager-load
adalah arsitektur yang tidak scale dengan baik seiring fitur terus
bertambah.

## 2. Kalau dibangun ulang dari nol (fitur & fungsi sama)

Arsitektur target: **browser client (bundled, code-split)** dengan tiga
lapisan jelas, di atas Supabase (Auth + Realtime + RLS) yang sama:

```
┌─────────────────────────────────────────────┐
│  Browser client (bundled, code-split)        │
│                                               │
│  ┌─────────────────────────────────────┐    │
│  │ UI layer                             │    │
│  │ Komponen per fitur, lazy-load per    │    │
│  │ rute/modal (Transaksi, Budget,       │    │
│  │ Laporan, Buku Bersama, dst)          │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ Domain / service layer               │    │
│  │ Fungsi murni: kalkulasi budget,      │    │
│  │ fraud rules, forecast — tidak sentuh │    │
│  │ DOM, bisa di-unit-test tanpa browser │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ Data layer                           │    │
│  │ Store lokal (IndexedDB) + sync       │    │
│  │ engine (queue + realtime). Satu      │    │
│  │ titik akses data — UI tidak panggil  │    │
│  │ Supabase langsung                    │    │
│  └─────────────────────────────────────┘    │
└──────────────────┬────────────────────────────┘
                    │
        ┌───────────▼────────────┐
        │ Supabase                │
        │ (Auth + Realtime + RLS) │
        └──────────────────────────┘
```

### 4 perubahan besar yang paling menentukan

**1. Build step ringan (bukan berarti pindah framework)**
Titik terbesar. Vanilla JS tanpa bundler oke untuk app kecil, tapi di
skala 21.000+ baris dampaknya nyata: setiap halaman narik 34 file JS +
parse semuanya, walau yang dipakai user cuma 3-4 modul. Solusi: tambah
**esbuild/Vite** sebagai bundler tanpa mengubah gaya kode (masih
vanilla, masih `window.*` kalau perlu), tapi dengan **code-splitting
per fitur** (dynamic `import()`). Efeknya: `report.js` (PDF generator,
lib berat) baru dimuat saat user buka Laporan, bukan di setiap page
load. Ini juga otomatis menyelesaikan cache-busting manual
(`APP_JS_VERSION`) — bundler yang urus hash filename.

**2. Pisahkan lapisan data dari lapisan UI**
`db.js` saat ini mencampur network call, encryption, dan business logic
sync jadi satu, dan modul UI manapun bisa manggil `callSupabaseAPI`
langsung. Target: satu **data layer tunggal** yang jadi satu-satunya
pintu ke Supabase — UI tidak pernah `fetch` Supabase langsung, selalu
lewat fungsi data layer yang sudah pasti encrypt/decrypt & dirty-track
dengan benar. Ini langsung menghindarkan kelas bug yang sudah beberapa
kali kejadian (salah filter `account_tag`, race condition
dirty-tracking) karena logic sync tidak lagi tersebar di banyak modul.

**3. Realtime subscription, bukan polling 30 detik**
Sinkronisasi sekarang polling tiap 30 detik + dirty-tracking manual.
Supabase Realtime (WebSocket) sudah tersedia dan pas untuk kasus
multi-device/shared book — egress lebih hemat (tidak nge-pull data yang
tidak berubah), device lain update lebih cepat dari 30 detik. Peningkatan
besar ke efisiensi bandwidth yang sudah jadi concern (egress
optimization).

**4. Test otomatis minimal**
Nol test otomatis untuk app yang menangani data finansial dengan RLS,
sync, dan enkripsi yang kompleks itu risiko nyata (sudah kebukti —
banyak bug regresi tercatat sendiri di `CLAUDE.md`). Karena domain/
service layer jadi fungsi murni (tidak sentuh DOM), gampang di-unit-test
dengan Vitest tanpa perlu browser sama sekali.

## 3. Kalau tidak mau rewrite total (incremental, tanpa migrasi besar)

Masuk akal untuk tetap vanilla no-build — ini pilihan sadar yang sama
di semua project lain. Langkah paling murah-tapi-berdampak yang bisa
dikerjakan bertahap:

1. Ubah `document.write` loader jadi lazy `import()` untuk modul berat
   yang jarang dipakai (`report.js`, `nutrisi.js`,
   `electricity-plan.js`, `fraud-detection.js`) — bisa dikerjakan modul
   per modul, tidak perlu bundler.
2. Pecah `auth.js` (2.513 baris) dan `db.js` (1.492 baris) jadi
   sub-modul lebih kecil per tanggung jawab (mis. `auth-shared-book.js`,
   `auth-roles.js`) — masih vanilla `window.*`, cuma lebih gampang
   di-maintain.
3. Ganti polling settings/transaksi jadi Supabase Realtime channel
   untuk kasus yang paling sering dipakai (shared book) dulu, sisanya
   tetap polling.

## 4. Kandidat langkah berikutnya

- Audit `auth.js` untuk lihat bagian mana yang paling gampang dipecah
  duluan.
- Prototype lazy-loading untuk `report.js` biar keliatan dampaknya di
  angka nyata (ukuran payload awal vs sekarang) sebelum commit ke
  perubahan lebih besar.
