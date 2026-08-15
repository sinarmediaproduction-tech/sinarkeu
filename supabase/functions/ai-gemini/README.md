# Mesin AI (Gemini) — Supabase Edge Function

Alternatif dari Cloudflare Worker (Groq) yang sudah ada. Menerima
`{ prompt }`, meneruskan ke Gemini API, mencoba **beberapa API key
sekaligus** (fallback berlapis) supaya tidak gampang mati kalau satu key
kena limit/expired. Bentuk respons **sama persis** dengan worker lama
(`{ result }` / `{ error }`), jadi tinggal diarahkan sebagai mesin AI baru
di aplikasi tanpa ubah logic parsing di client.

## 1. Prasyarat

- Sudah install [Supabase CLI](https://supabase.com/docs/guides/cli).
- Sudah login: `supabase login`.
- Project Supabase yang dipakai SinarKeu sudah di-link:
  ```bash
  supabase link --project-ref <project-ref-anda>
  ```
  (`<project-ref>` = bagian subdomain di URL Supabase Anda, mis. kalau URL
  project `https://abcdefgh.supabase.co`, project-ref-nya `abcdefgh`.)

## 2. Ambil API key Gemini

Buat 1 atau lebih API key gratis di [Google AI Studio](https://aistudio.google.com/apikey).
Disarankan **minimal 2–3 key** (boleh dari akun Google berbeda) supaya
fallback benar-benar berguna kalau salah satu kuotanya habis.

## 3. Deploy function

Dari root repo (folder yang berisi folder `supabase/`):

```bash
supabase functions deploy ai-gemini --no-verify-jwt
```

`--no-verify-jwt` dipakai karena SinarKeu memanggil function ini pakai
**anon key** langsung dari browser (bukan token login user), sama seperti
pola akses tabel lain di app ini (lihat header `apikey` di `js/db.js`).

## 4. Set secrets (API key Gemini)

```bash
supabase secrets set GEMINI_API_KEYS="key-pertama,key-kedua,key-ketiga"
```

Pisahkan tiap key dengan koma, **tanpa spasi** di sekitar koma (atau spasi
juga aman, function ini men-trim tiap key).

Opsional — kalau ingin override urutan model fallback (default:
`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`):

```bash
supabase secrets set GEMINI_MODELS="gemini-2.5-flash,gemini-2.0-flash"
```

## 5. Cara kerja fallback

- Key pertama dicoba ke **semua model** dulu secara berurutan.
- Kalau semua model gagal untuk key itu (rate limit, overload, key
  invalid), baru pindah ke **key berikutnya**.
- Maksimal 12 percobaan total (key × model) sebelum menyerah dan
  mengembalikan `{ error }` berisi rincian semua percobaan yang gagal.
- Error yang jelas bukan soal kuota (mis. prompt diblok kebijakan konten)
  langsung dihentikan tanpa mencoba key lain, supaya tidak buang waktu.

## 6. Tes manual

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/ai-gemini" \
  -H "apikey: <anon-key-anda>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Halo, coba balas singkat."}'
```

Respons sukses: `{ "result": "...", "meta": { "model": "...", ... } }`
Respons gagal: `{ "error": "...", "meta": { "tried": [...] } }`

## 7. Pemakaian di aplikasi SinarKeu

Di **Setelan → Analisis AI**, pilih mesin **"Gemini (Supabase Edge
Function)"**. Karena app ini sudah menyimpan URL & anon key Supabase project
Anda (dipakai untuk cloud sync), URL function `.../functions/v1/ai-gemini`
dan header `apikey` otomatis dipakai — **tidak perlu isi URL manual**,
asal Supabase Cloud Sync sudah dikonfigurasi di Setelan → Cloud Sync.

Fitur-fitur yang MEMAKAI mesin ini (Analisis AI, Tanya AI, dsb.) menyusul
menyesuaikan — bagian ini baru menyediakan mesinnya.
