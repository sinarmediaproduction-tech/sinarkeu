# TESTING.md — Cara memverifikasi SinarKeu

## 1. Otomatis (wajib sebelum rilis / dijalankan CI)

```bash
node tests/run.mjs            # smoke test: escaping, format uang, CSP, rate limit
node tests/check-sw-version.mjs   # gate cache-bust service worker
for f in js/*.js; do node --check "$f" || echo "SYNTAX ERROR: $f"; done
```

Exit code 0 = lulus. Ketiganya dijalankan otomatis oleh `.github/workflows/ci.yml`.

> Catatan Windows/git-bash: `node --check js/x.js` kadang melempar
> `MODULE_NOT_FOUND` dengan path aneh (`C:\c\Users\...`). Itu artefak MSYS,
> bukan error kode. Yang menandakan masalah nyata adalah `SyntaxError`.

### Menambah test baru
Buka `tests/run.mjs`, tambahkan `test('nama', () => { ... })`. Tidak perlu
install apa pun. Fokuskan pada **fungsi murni** (utils, parsing, escaping);
fungsi yang butuh DOM/localStorage lebih murah diverifikasi manual.

## 2. Manual (alur yang tidak bisa diotomasi tanpa DOM + Supabase)

Jalankan `npx serve .` atau buka `index.html`. Checklist minimum sebelum
rilis yang menyentuh area terkait:

- [ ] **Transaksi** — tambah / edit / hapus, saldo ikut berubah, nilai
      negatif tampil dan terbaca benar (regresi `unRp`).
- [ ] **Multi-akun** — ganti akun, pastikan data TIDAK bocor antar-akun.
- [ ] **Buku bersama** — login, cek role viewer benar-benar read-only.
- [ ] **Offline** — matikan jaringan, reload; app harus tetap terbuka.
- [ ] **Harga Komoditas** — buka modal, tekan "Segarkan"; tanggal & label
      "Kabupaten Magetan" muncul.
- [ ] **Backup** — ekspor lalu impor di profil bersih, data utuh.
- [ ] **Log Error** — Setelan → Log Error, pastikan bisa diekspor.

### Verifikasi update benar-benar sampai (PWA)
Setelah deploy: DevTools → Application → Service Workers → cek nama cache
memuat versi terbaru (mis. `sinarkeu-shell-v33`). Kalau masih versi lama,
`CACHE_VERSION` lupa dinaikkan.

## 3. Uji rate limit (opsional, terhadap deployment nyata)

```bash
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code} " "$BASE/api/harga-pangan?slugs=beras-medium"
done; echo
```
Harus mulai muncul `429` setelah ~15 request dalam satu menit.

## 4. Uji header keamanan & cache

```bash
curl -sI "$BASE/"        | grep -iE 'strict-transport|x-frame|cache-control'
curl -sI "$BASE/sw.js"   | grep -i cache-control   # harus no-store/no-cache
curl -sI "$BASE/js/app.js" | grep -i cache-control # harus immutable
```

## 5. Healthcheck

```bash
curl -s "$BASE/api/health?deep=1" | head -c 400
```
`"status":"ok"` = sehat; `503` + `"degraded"` = ada upstream bermasalah.
