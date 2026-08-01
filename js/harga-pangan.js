// api/harga-pangan.js — Vercel Serverless Function
// Proxy harga pangan acuan untuk fitur auto-update kolom harga di Daftar
// Belanja (js/shopping-list.js, lewat js/harga-pangan.js). Pola CORS &
// struktur sengaja disamakan dengan api/emas.js supaya konsisten.
//
// SUMBER (berjenjang, per-komoditas):
//   1) SISKAPERBAPO -- sistem resmi Disperindag Provinsi Jawa Timur
//      (siskaperbapo.jatimprov.go.id). Utama karena datanya murni Jatim
//      (bukan turunan nasional) dan mencakup semua 12 komoditas yang
//      ditrack app ini. Endpoint tidak resmi/tidak didokumentasikan --
//      hasil reverse-engineering lewat DevTools (lihat komentar di bawah
//      SISKAPERBAPO_URL). Situs ini ada di belakang Cloudflare tapi
//      (per pengecekan manual) belum pakai JS Challenge/Turnstile, jadi
//      proxy server-to-server masih bisa lolos asal header mirip browser
//      asli -- KALAU Cloudflare-nya diperketat suatu saat, fetch ini akan
//      mulai gagal/timeout dan otomatis jatuh ke fallback di bawah (tidak
//      bikin seluruh fitur mati).
//   2) PIHPS Bank Indonesia -- fallback, dipakai HANYA untuk komoditas yang
//      gagal/tidak ada di SISKAPERBAPO pada request tsb. Endpoint ini resmi
//      didokumentasikan dan sudah terbukti stabil sebelumnya.
//
// GET /api/harga-pangan?slugs=beras-medium,cabai-rawit-merah
// -> { prices: { "beras-medium": { price, date, region, source }, ... } }
// Slug yang tidak dikenali atau gagal diambil dari KEDUA sumber dilewati
// saja (tidak bikin seluruh request gagal) -- caller (js/harga-pangan.js)
// sudah didesain untuk toleran terhadap hasil parsial.

// ==================== SUMBER 1: SISKAPERBAPO (Disperindag Jatim) ====================

// [ENDPOINT TIDAK RESMI] Ditemukan lewat DevTools Network tab, bukan
// dokumentasi resmi -- bisa berubah tanpa pemberitahuan. Nama file
// "tabel.nodesign" (bukan cuma "tabel") sengaja: itu varian yang
// mengembalikan fragmen HTML polos tanpa layout situs, dipakai situsnya
// sendiri untuk AJAX partial-update tabel.
const SISKAPERBAPO_URL = 'https://siskaperbapo.jatimprov.go.id/harga/tabel.nodesign/';
const SISKAPERBAPO_REFERER = 'https://siskaperbapo.jatimprov.go.id/harga/tabel/';

// slug internal -> data-commodity-id SISKAPERBAPO. Diambil dari atribut
// data-commodity-id di <span class="price-tooltip-enabled"> pada respons
// HTML "Harga Rata-Rata Provinsi Jawa Timur" (level provinsi, kabkota
// dikosongkan -- lihat buildSiskaperbapoBody). Kalau situsnya menambah/
// mengubah id komoditas, baris terkait cukup tidak ketemu saat parsing dan
// otomatis jatuh ke fallback BI, bukan bikin request lain ikut gagal.
const SLUG_TO_SISKAPERBAPO_ID = {
  'beras-premium': '2',
  'beras-medium': '4',
  'gula-pasir': '7',
  'minyak-goreng-curah': '10',
  'daging-sapi': '12',
  'daging-ayam': '13',
  'telur-ayam': '16',
  'cabai-merah-keriting': '37',
  'bawang-merah': '39',
  'bawang-putih': '49', // Sinco/Honan -- merek acuan yang dipakai SISKAPERBAPO
  'cabai-rawit-merah': '50',
  'minyak-goreng-kemasan': '96', // MINYAKITA -- representatif krn harganya diatur (HET)

  // [BARU] Sayur mayur -- tidak ada padanan di PIHPS BI (comcat_id BI cuma
  // untuk 21 komoditas pokok nasional), jadi slug ini TIDAK ada di
  // SLUG_TO_BI_ID di bawah -> kalau SISKAPERBAPO gagal, slug ini otomatis
  // dilewati (bukan error), bukan fallback ke BI.
  'kol-kubis': '44',
  'kentang': '45',
  'tomat': '46',
  'wortel': '47',
  'buncis': '48',

  // [BARU] Ikan segar
  'ikan-bandeng': '58',
  'ikan-kembung': '59',
  'ikan-tongkol': '60',
  'ikan-tuna': '61',
  'ikan-cakalang': '62',
  'ikan-asin-teri': '40',

  // [BARU] Sembako tambahan
  'susu-kental-manis': '20', // Merk Bendera -- representatif
  'susu-bubuk': '23', // Merk Bendera (Instant) -- representatif
  'jagung-pipilan': '25',
  'garam-beryodium': '28', // varian Halus (kg) -- lebih relevan utk belanja harian drpd varian Bata
  'tepung-terigu': '30',
  'kedelai': '33', // Lokal -- representatif
  'mie-instan': '35', // Indomie Rasa Kari Ayam -- representatif
  'kacang-hijau': '41',
  'kacang-tanah': '42',
  'ketela-pohon': '43',

  // [OTOMATIS] Sebelumnya cuma manual di frontend -- SISKAPERBAPO ternyata
  // melacak ini juga.
  'gas-melon': '82',
};

function fmtDateID(d) {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD, sama seperti field "tanggal" di payload
}

const SISKAPERBAPO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

// [SESI PHP] Browser asli bawa Cookie PHPSESSID saat POST ke endpoint AJAX
// -- sesi itu didapat dari GET halaman /harga/tabel/ lebih dulu. Percobaan
// awal proxy ini langsung POST tanpa sesi sama sekali dan dapat 403 --
// dugaan: aplikasi PHP-nya menolak POST AJAX tanpa sesi valid (beda dari
// soal Cloudflare/IP reputation). Sesi di-cache di module scope (bertahan
// selama Vercel function instance masih "warm", biasanya beberapa menit
// sampai berjam-jam) supaya tidak GET ulang di setiap request kalau tidak
// perlu -- TTL pendek (10 menit) dipilih hati-hati: sesi PHP bisa
// kedaluwarsa di server, lebih baik agak sering refresh daripada dapat 403
// gara-gara sesi basi.
let _cachedSessionCookie = null;
let _cachedSessionAt = 0;
const SESSION_TTL_MS = 10 * 60 * 1000;

async function getSiskaperbapoSessionCookie() {
  const now = Date.now();
  if (_cachedSessionCookie && now - _cachedSessionAt < SESSION_TTL_MS) {
    return _cachedSessionCookie;
  }

  const res = await fetch(SISKAPERBAPO_REFERER, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': SISKAPERBAPO_USER_AGENT,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`SISKAPERBAPO gagal ambil sesi (GET /harga/tabel/): ${res.status}`);
  }

  // getSetCookie() -- API khusus undici/Node 18+ untuk baca SEMUA header
  // Set-Cookie sebagai array (Headers.get('set-cookie') biasa akan
  // menggabungkan semua jadi 1 string dengan koma, salah parse). Fallback
  // ke .get() untuk runtime yang belum dukung getSetCookie.
  const rawCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);

  const phpSessId = rawCookies
    .map((c) => c.match(/^PHPSESSID=([^;]+)/))
    .find(Boolean);

  if (!phpSessId) {
    console.warn('[harga-pangan] SISKAPERBAPO: GET /harga/tabel/ tidak balas Set-Cookie PHPSESSID. Header Set-Cookie mentah:', JSON.stringify(rawCookies));
    throw new Error('SISKAPERBAPO tidak mengembalikan PHPSESSID');
  }

  const cookie = `PHPSESSID=${phpSessId[1]}`;
  _cachedSessionCookie = cookie;
  _cachedSessionAt = now;
  return cookie;
}

// Body request persis meniru payload asli dari DevTools: cuma 2 field,
// "tanggal" dan "kabkota". kabkota dikosongkan supaya dapat baris
// RATA-RATA PROVINSI (bukan per kabupaten/kota) -- konsisten dengan
// perilaku proxy BI sebelumnya yang juga level provinsi.
function buildSiskaperbapoBody(dateStr) {
  return new URLSearchParams({ tanggal: dateStr, kabkota: '' }).toString();
}

// Ambil & parse 1 hari data SISKAPERBAPO -> Map(commodityId -> { price, date }).
// null kalau request gagal total (network/blocked/bukan HTML tabel yang
// dikenali) -- caller lalu retry tanggal lain atau menyerah ke fallback BI.
async function fetchSiskaperbapoDay(dateStr, sessionCookie) {
  const res = await fetch(SISKAPERBAPO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: '*/*',
      Origin: 'https://siskaperbapo.jatimprov.go.id',
      Referer: SISKAPERBAPO_REFERER,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: sessionCookie,
      // User-Agent browser asli -- header standar Node/undici sebelumnya
      // ("SinarKeu/1.0") kemungkinan yang bikin situs ini menolak fetch
      // langsung (beda dari BI PIHPS yang ternyata tidak sepicky itu).
      'User-Agent': SISKAPERBAPO_USER_AGENT,
    },
    body: buildSiskaperbapoBody(dateStr),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`SISKAPERBAPO request gagal: ${res.status}`);
  const html = await res.text();

  // Sanity check: kalau Cloudflare/situsnya mengembalikan halaman
  // challenge/error alih-alih fragmen tabel yang diharapkan, jangan coba
  // parse (bisa salah tangkap angka) -- anggap gagal, biar fallback jalan.
  // [DEBUG] Sengaja di-log (bukan diam-diam return null) -- tanpa ini,
  // kegagalan "200 OK tapi bukan tabel harga" (mis. halaman Cloudflare
  // challenge yang statusnya tetap 200) tidak akan pernah muncul di Vercel
  // Function Logs, bikin susah dibedakan dari "memang lagi tidak ada data".
  if (!html.includes('price-tooltip-enabled') || !html.includes('data-commodity-id')) {
    console.warn(
      `[harga-pangan] SISKAPERBAPO (${dateStr}) balas 200 tapi bukan tabel harga yang dikenali. ` +
      `Panjang body: ${html.length} char. Cuplikan awal: ${JSON.stringify(html.slice(0, 300))}`
    );
    return null;
  }

  const rowMap = new Map();
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    const idMatch = rowHtml.match(/data-commodity-id=['"](\d+)['"]/);
    if (!idMatch) continue; // baris header kategori (mis. "BERAS") tidak punya id, lewati

    const priceMatch = rowHtml.match(/class="right sekarang">([^<]*)</);
    if (!priceMatch) continue;

    // Format Indonesia: titik = pemisah ribuan, contoh "127.712" -> 127712.
    const raw = priceMatch[1].trim();
    const num = Number(raw.replace(/\./g, '').replace(/,/g, ''));
    if (!Number.isFinite(num) || num <= 0) continue;

    rowMap.set(idMatch[1], { price: num, date: dateStr });
  }

  return rowMap.size ? rowMap : null;
}

// Ambil harga hari ini dari SISKAPERBAPO untuk SEMUA slug yang diminta
// sekaligus (1 request HTTP untuk semua komoditas -- beda dari BI yang
// harus 1 request per komoditas -- karena SISKAPERBAPO memang balas
// seluruh tabel harga sekaligus). Kalau hari ini kosong/gagal, coba mundur
// H-1 sekali (situsnya kadang belum update di pagi hari) sebelum menyerah.
// Return Map(slug -> { price, date }) -- BISA parsial (cuma slug yang
// ketemu), TIDAK pernah melempar error ke caller.
async function fetchSiskaperbapoPrices(slugs) {
  const result = new Map();
  const today = new Date();

  let sessionCookie;
  try {
    sessionCookie = await getSiskaperbapoSessionCookie();
  } catch (e) {
    console.warn('[harga-pangan] SISKAPERBAPO gagal ambil sesi:', e.message);
    return result; // tanpa sesi, POST pasti gagal juga -- langsung menyerah ke fallback BI
  }

  for (let daysBack = 0; daysBack <= 1; daysBack++) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysBack);
    const dateStr = fmtDateID(d);

    let rowMap;
    try {
      rowMap = await fetchSiskaperbapoDay(dateStr, sessionCookie);
    } catch (e) {
      console.warn(`[harga-pangan] SISKAPERBAPO gagal (${dateStr}):`, e.message);
      rowMap = null;
    }
    if (!rowMap) continue;

    slugs.forEach((slug) => {
      if (result.has(slug)) return; // sudah ketemu dari iterasi tanggal sebelumnya, jangan ditimpa tanggal lebih lama
      const commodityId = SLUG_TO_SISKAPERBAPO_ID[slug];
      if (!commodityId) return;
      const hit = rowMap.get(commodityId);
      if (hit) result.set(slug, hit);
    });

    if (result.size === slugs.length) break; // semua sudah ketemu, tidak perlu cek tanggal lebih lama
  }

  return result;
}

// ==================== SUMBER 2: PIHPS Bank Indonesia (fallback) ====================

const PIHPS_BASE_URL = 'https://www.bi.go.id/hargapangan';

// slug internal -> comcat_id PIHPS. Sengaja hanya komoditas yang relevan
// untuk belanja rumah tangga (bukan semua 21 yang ditrack BI). Kalau mau
// nambah, cek daftar comcat_id lengkap di pangan.id (src/lib/pihps.ts).
const SLUG_TO_BI_ID = {
  'beras-medium': 'com_3',
  'beras-premium': 'com_5',
  'daging-ayam': 'com_7',
  'daging-sapi': 'com_8',
  'telur-ayam': 'com_10',
  'bawang-merah': 'com_11',
  'bawang-putih': 'com_12',
  'cabai-merah-keriting': 'com_14',
  'cabai-rawit-merah': 'com_16',
  'minyak-goreng-curah': 'com_17',
  'minyak-goreng-kemasan': 'com_18',
  'gula-pasir': 'com_21',
};

// [WILAYAH] Kode wilayah Kemendagri/BPS -- konvensi standar yang dipakai
// hampir semua sistem data pemerintah RI (province_id 2 digit). BI PIHPS
// TIDAK menyediakan cara resmi untuk memverifikasi kode internalnya dari
// luar (endpoint dropdown provinsi butuh sesi browser penuh), jadi ini
// best-effort berdasarkan konvensi tsb -- kalau ternyata meleset, fallback
// ke Nasional di bawah tetap membuat fitur ini tidak pernah gagal total.
const JATIM_PROVINCE_ID = '35';

function parsePrice(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str || str === '-' || str === '0') return null;
  const num = Number(str.replace(/\./g, '').replace(/,/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseDateKey(key) {
  const match = key.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDate(d) {
  return d.toISOString().split('T')[0];
}

// Cari harga terbaru dari 1 baris hasil GetGridDataKomoditas (format sama
// untuk baris nasional/provinsi/kabupaten -- bedanya cuma isi tanggalnya).
function _latestFromRow(row) {
  let latestDate = null;
  let latestPrice = null;
  for (const [key, rawValue] of Object.entries(row)) {
    const isoDate = parseDateKey(key);
    if (!isoDate) continue;
    const price = parsePrice(rawValue);
    if (price === null) continue;
    if (!latestDate || isoDate > latestDate) {
      latestDate = isoDate;
      latestPrice = price;
    }
  }
  return latestDate ? { price: latestPrice, date: latestDate } : null;
}

// Ambil harga terbaru untuk 1 komoditas, dengan fallback berjenjang:
// rata-rata Provinsi Jawa Timur -> rata-rata Nasional.
// Fallback dicek berurutan (bukan sekali request semua level) supaya kalau
// level Jawa Timur sudah ketemu, tidak perlu apa-apa lagi -- hemat request
// ke BI.
async function fetchLatestRegionalPrice(biId) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 7);

  const baseParams = {
    price_type_id: '1', // pasar tradisional
    comcat_id: biId,
    showKota: 'true', // sertakan baris per-kabupaten/kota, bukan cuma rata-rata provinsi
    showPasar: 'false',
    tipe_laporan: '1',
    start_date: fmtDate(start),
    end_date: fmtDate(end),
  };

  async function fetchRows(provinceId, regencyId) {
    const params = new URLSearchParams({
      ...baseParams,
      province_id: provinceId,
      regency_id: regencyId,
    });
    const res = await fetch(
      `${PIHPS_BASE_URL}/WebSite/TabelHarga/GetGridDataKomoditas?${params.toString()}`,
      {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${PIHPS_BASE_URL}/TabelHarga/PasarTradisionalKomoditas`,
          'User-Agent': 'Mozilla/5.0 (compatible; SinarKeu/1.0)',
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) throw new Error(`PIHPS request gagal: ${res.status}`);
    const payload = await res.json();
    return payload.data || [];
  }

  // 1) Rata-rata Provinsi Jawa Timur (regency_id kosong).
  try {
    const rows = await fetchRows(JATIM_PROVINCE_ID, '');
    const jatimRow = rows.find((r) => r.name && String(r.name).toLowerCase().includes('jawa timur'));
    if (jatimRow) {
      const hit = _latestFromRow(jatimRow);
      if (hit) return { ...hit, region: 'Provinsi Jawa Timur' };
    }
  } catch (e) {
    console.warn('[harga-pangan] Gagal ambil level Jawa Timur (BI):', e.message);
  }

  // 2) Fallback terakhir: rata-rata Nasional (province_id & regency_id kosong).
  try {
    const rows = await fetchRows('', '');
    const nationalRow = rows.find((r) => r.level === 0 || r.name === 'Semua Provinsi');
    if (nationalRow) {
      const hit = _latestFromRow(nationalRow);
      if (hit) return { ...hit, region: 'Nasional' };
    }
  } catch (e) {
    console.warn('[harga-pangan] Gagal ambil level Nasional (BI):', e.message);
  }

  return null;
}

// ==================== HANDLER ====================

export default async function handler(req, res) {
  const allowedOrigins = [
    'https://sinarkeu.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ];
  const origin = req.headers.origin || '';
  res.setHeader(
    'Access-Control-Allow-Origin',
    allowedOrigins.includes(origin) ? origin : 'https://sinarkeu.vercel.app'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const slugsParam = String(req.query.slugs || '');
  // Kenal di SALAH SATU sumber (SISKAPERBAPO atau BI) sudah cukup untuk
  // masuk daftar yang diproses -- penentuan sumber mana yang benar-benar
  // dipakai terjadi per-slug di bawah.
  const slugs = slugsParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SLUG_TO_SISKAPERBAPO_ID[s] || SLUG_TO_BI_ID[s]);

  if (!slugs.length) {
    return res.status(400).json({ error: 'Parameter slugs kosong atau tidak ada yang dikenali' });
  }

  const prices = {};

  // 1) SUMBER UTAMA: SISKAPERBAPO, 1 request untuk semua slug sekaligus.
  const siskaperbapoSlugs = slugs.filter((s) => SLUG_TO_SISKAPERBAPO_ID[s]);
  if (siskaperbapoSlugs.length) {
    try {
      const hits = await fetchSiskaperbapoPrices(siskaperbapoSlugs);
      hits.forEach((hit, slug) => {
        prices[slug] = { ...hit, region: 'Provinsi Jawa Timur', source: 'siskaperbapo' };
      });
    } catch (e) {
      console.error('[harga-pangan] SISKAPERBAPO gagal total:', e.message);
    }
  }

  // 2) FALLBACK: PIHPS BI, HANYA untuk slug yang belum dapat harga di atas.
  const missingSlugs = slugs.filter((s) => !prices[s] && SLUG_TO_BI_ID[s]);
  if (missingSlugs.length) {
    await Promise.all(
      missingSlugs.map(async (slug) => {
        try {
          const result = await fetchLatestRegionalPrice(SLUG_TO_BI_ID[slug]);
          if (result) prices[slug] = { ...result, source: 'pihps-bi' };
        } catch (err) {
          console.error(`[harga-pangan] Fallback BI gagal untuk ${slug}:`, err.message);
        }
      })
    );
  }

  // Cache singkat di edge Vercel -- bukan andalan utama (itu ada di
  // localStorage + Supabase, lihat js/harga-pangan.js), cuma cadangan
  // tambahan supaya request beruntun dalam 1 jam tidak selalu hit
  // SISKAPERBAPO/BI.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  return res.status(200).json({ prices });
}
