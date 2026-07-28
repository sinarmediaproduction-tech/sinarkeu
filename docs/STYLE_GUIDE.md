# SinarKeu — Panduan Styling (Institutional Formal)

Dokumen ini menjelaskan sistem desain SinarKeu setelah rombak ke gaya
**modern, institusional, clean, formal**. Semua styling terpusat di
`css/style.css` lewat CSS custom properties (design token) — jangan
menaruh warna hex baru langsung di HTML/JS kalau tokennya sudah ada.

## 1. Prinsip Desain

- **Navy formal** sebagai warna utama (brand, sidebar, hero saldo).
- **Abu netral** untuk latar & permukaan, bukan warna hangat/krem.
- **Aksen emas tipis** hanya untuk highlight terbatas (nav item aktif,
  simbol emas/zakat) — jangan dipakai luas seperti warna sekunder biasa.
- **Radius kecil** (4–10px) — hindari bentuk terlalu bulat/playful.
- **Shadow tipis & dingin** — jangan pakai shadow tebal/warm-tinted.
- **Font sans formal** di seluruh UI — tidak ada serif.

## 2. Design Tokens (`css/style.css` → `:root`)

Semua warna, radius, shadow, dan font didefinisikan sebagai CSS variable
di `:root` (mode terang) dan di-override di `[data-theme="dark"]` (mode
gelap). **Selalu pakai `var(--nama-token)`**, jangan hardcode hex baru.

### Warna dasar
| Token | Terang | Gelap | Dipakai untuk |
|---|---|---|---|
| `--ink` | `#1C2430` | `#E6E9EE` | Teks utama |
| `--ink-muted` | `#5B6472` | `#A3ABB8` | Teks sekunder |
| `--ink-faint` | `#9AA2AC` | `#6C7684` | Teks tersier / placeholder |
| `--paper` | `#FFFFFF` | `#16213A` | Background kartu/permukaan |
| `--paper-warm` | `#F4F5F7` | `#0D1526` | Background halaman / box info netral |
| `--rule` | `#DCE0E6` | `#29354E` | Border, divider |
| `--row-alt` | `#F7F8FA` | `#111A2C` | Baris tabel selang-seling |

### Brand & aksen
| Token | Terang | Gelap | Dipakai untuk |
|---|---|---|---|
| `--brand` / `--accent` | `#1B2A4A` | `#4A6FA5` | Tombol utama, badge peran, item aktif |
| `--brand-dark` | `#101A2E` | `#2E4970` | Hover/active state tombol brand |
| `--accent-lt` | `#E8EBF1` | `#212D48` | Background tint untuk elemen ber-accent |

**Aksen emas** (`--topbar-item-active-bg: #A9832E`) dipakai **khusus**
untuk state aktif di sidebar/topbar dan elemen bertema emas (kartu harga
emas Antam, zakat). Jangan pakai gold sebagai warna tombol/badge umum.

### Warna semantik
| Token | Arti | Terang | Gelap |
|---|---|---|---|
| `--success` / `--success-lt` | Positif, income, kuat | `#2E6B4F` / `#E3F0E9` | `#4F9C79` / `#17332A` |
| `--danger` / `--danger-lt` | Negatif, hapus, expense | `#A13A3A` / `#F5E6E6` | `#D2726B` / `#3A2320` |
| `--warning` / `--warning-lt` | Peringatan, budget, gold-ish | `#9C7A2E` / `#F1EBDA` | `#C9A159` / `#332A16` |
| `--info` / `--info-lt` | Info netral, saldo positif | `#2E5C82` / `#E3ECF3` | `#6FA0C9` / `#1B2B36` |
| `--purple` / `--purple-lt` | Kategori sekunder | `#4A5578` / `#E9EBF2` | `#8B98C4` / `#232B45` |
| `--fase` / `--fase-lt` | Fase kehidupan | sama dgn purple | sama dgn purple |
| `--chat-user` | Bubble chat AI (user) | `#2E6B67` | `#4F9C93` |

**Pola pemakaian**: warna solid (`--success`) untuk teks/ikon di atas
background terang, warna `-lt` untuk background box/badge dengan teks
warna solid di atasnya. Untuk border box semantik, pakai
`color-mix(in srgb, var(--warning) 45%, var(--warning-lt))` (lihat
contoh di `index.html`) daripada hex baru — biar otomatis ikut berubah
kalau token warning diganti nanti.

### Sidebar / Topbar & Hero Saldo
Sidebar & hero saldo sengaja **konsisten navy di light maupun dark
mode** (tidak ikut toggle terang/gelap seperti komponen lain) supaya
identitas brand tetap terlihat:

```
--topbar-bg: linear-gradient(160deg, #16233F 0%, #0A1220 100%);
--hero-bg-from: #22335A;   --hero-bg-to: #0C1424;
--topbar-item-active-bg: #A9832E;   /* satu-satunya gold di sistem */
```

### Radius
| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--radius-sm` | `4px` | Badge kecil, input, box info |
| `--radius` | `6px` | Kartu, tombol, modal |
| `--radius-lg` | `10px` | Modal besar, hero card |
| `--radius-pill` | `999px` | Badge/tag berbentuk pill (tetap bulat penuh, fungsional bukan dekoratif) |

### Shadow
```
--shadow-sm: 0 1px 2px rgba(16,22,34,0.07);
--shadow-md: 0 3px 10px rgba(16,22,34,0.09);
--shadow-lg: 0 12px 28px rgba(16,22,34,0.13);
```
Tipis & cool-tint (bukan warm-tinted). Jangan bikin shadow custom yang
lebih tebal dari `--shadow-lg` kecuali untuk modal/dropdown yang benar-benar
butuh elevasi ekstra.

### Font
```
--font-display: 'IBM Plex Sans', 'Inter', sans-serif;  /* heading, brand, angka saldo besar */
--font-body:    'Inter', sans-serif;                   /* body & UI umum */
--font-mono:    'JetBrains Mono', ui-monospace, monospace; /* angka/nominal */
```
Diimpor di `index.html` lewat Google Fonts. **Tidak ada font serif** di
sistem ini — kalau butuh elemen "signature", pakai `--font-display` dengan
weight lebih tebal (600–700), bukan ganti ke serif.

## 3. Palet Kategori (Chart & Tag Transaksi)

Warna kategori transaksi (`js/custom-select.js`) dan palet chart
pengeluaran (`js/expense-chart.js`) **boleh tetap beragam** — ini untuk
keterbacaan data, bukan identitas brand. Tetap usahakan nuansa
muted/institutional (hindari warna neon/pastel terlalu cerah), tapi
tidak perlu satu warna navy semua.

```js
// js/expense-chart.js — palet kategori formal
window._EXPENSE_CHART_COLORS = [
  '#1B2A4A', '#9C7A2E', '#2E6B4F', '#A13A3A', '#4A5578',
  '#3E5C82', '#A9832E', '#5C8A6E', '#8B5E5A', '#5B6472',
  '#7691BE', '#6B5B8C', '#7D8A9A', '#C9A159', '#2E5C82'
];
```

## 4. Aturan Praktis untuk Perubahan ke Depan

1. **Jangan hardcode hex baru** di `index.html` atau file JS untuk
   komponen UI umum (badge, box info, tombol, teks status). Selalu cari
   token yang paling cocok di tabel atas dulu.
2. Kalau butuh border yang "sedikit lebih gelap dari `-lt`", pakai
   `color-mix(in srgb, var(--X) N%, var(--X-lt))` — sudah dipakai
   konsisten di seluruh app, jangan nulis hex tebakan sendiri.
3. **File yang tidak bisa baca CSS variable** (mis. `js/report.js` untuk
   export PDF, karena dirender lewat `iframe.print()` terpisah / library
   PDF) harus pakai **hex literal** yang sama persis dengan nilai token —
   ada objek `C` (tema tampilan) dan `CPDF` (tema PDF) di `report.js`
   yang jadi satu-satunya tempat mapping token → hex literal untuk PDF.
   Kalau token di `:root` berubah, update juga dua objek ini.
4. Warna kategori transaksi (`custom-select.js`) & chart pengeluaran
   boleh dapat warna baru di luar token utama, tapi tetap pilih nuansa
   muted/desaturated, bukan warna cerah/playful.
5. Aksen emas (`#A9832E` / `--topbar-item-active-bg`) hanya untuk state
   aktif & elemen bertema emas — jangan jadi warna default tombol/badge.
6. Setelah ubah token di `:root`, cek juga blok `[data-theme="dark"]`
   supaya kedua mode tetap konsisten.
7. Sebelum commit perubahan visual, jalankan pengecekan cepat untuk
   memastikan tidak ada hex baru yang lolos dari sistem token:
   ```bash
   grep -rnoE "#[0-9A-Fa-f]{6}\b" index.html js/*.js \
     | grep -vE "#0088cc|#0d1117|#c9d1d9"   # kecualikan brand pihak-3
   ```

## 5. Riwayat Perubahan Palet

- **Sebelumnya**: "Warm Formal" — Espresso Ink, Warm Linen, Wine, Antique
  Gold, Deep Sage, Brick. Font Fraunces (serif) + Plus Jakarta Sans.
- **Sekarang**: "Institutional Formal" — Navy Formal, Abu Netral, Ink,
  Aksen Emas tipis, Deep Green, Brick. Font IBM Plex Sans + Inter, tanpa
  serif. Radius & shadow diperkecil untuk kesan lebih tegas/formal.
