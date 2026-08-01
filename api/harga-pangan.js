// api/harga-pangan.js — Vercel Serverless Function
// Proxy ke PIHPS Bank Indonesia (bi.go.id/hargapangan) supaya browser tidak
// kena CORS. Dipakai oleh js/harga-pangan.js untuk fitur auto-update harga
// di Daftar Belanja (js/shopping-list.js). Pola CORS & struktur sengaja
// disamakan dengan api/emas.js supaya konsisten.
//
// GET /api/harga-pangan?slugs=beras-medium,cabai-rawit-merah
// -> { prices: { "beras-medium": { price, date }, ... } }
// Slug yang tidak dikenali atau gagal diambil dilewati saja (tidak bikin
// seluruh request gagal) -- caller (js/harga-pangan.js) sudah didesain
// untuk toleran terhadap hasil parsial.

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
    console.warn('[harga-pangan] Gagal ambil level Jawa Timur:', e.message);
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
    console.warn('[harga-pangan] Gagal ambil level Nasional:', e.message);
  }

  return null;
}

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
  const slugs = slugsParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SLUG_TO_BI_ID[s]);

  if (!slugs.length) {
    return res.status(400).json({ error: 'Parameter slugs kosong atau tidak ada yang dikenali' });
  }

  const prices = {};
  await Promise.all(
    slugs.map(async (slug) => {
      try {
        const result = await fetchLatestRegionalPrice(SLUG_TO_BI_ID[slug]);
        if (result) prices[slug] = result;
      } catch (err) {
        console.error(`[harga-pangan] Gagal ambil harga ${slug}:`, err.message);
      }
    })
  );

  // Cache singkat di edge Vercel -- bukan andalan utama (itu ada di
  // localStorage + Supabase, lihat js/harga-pangan.js), cuma cadangan
  // tambahan supaya request beruntun dalam 1 jam tidak selalu hit BI.
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  return res.status(200).json({ prices });
}
