// ============================================================
// Cloudflare Worker — proxy harga pangan (SISKAPERBAPO + BI PIHPS)
// ============================================================
// Deploy sebagai Cloudflare Worker TUNGGAL (bukan Vercel function).
// App SinarKeu di GitHub Pages akan fetch ke URL Worker ini
// (bukan ke /api/harga-pangan yang cuma jalan di Vercel/CF Pages).
//
// Cara deploy:
//   1. Cloudflare Dashboard -> Workers & Pages -> Create -> Worker
//   2. Paste isi file ini, ganti nama (mis. "sinarkeu-harga-pangan")
//   3. Deploy -> dapat URL https://sinarkeu-harga-pangan.<sub>.workers.dev
//   4. Masukkan URL itu ke Setelan -> "URL Proxy Harga Komoditas" di app,
//      ATAU langsung hardcode di js/harga-pangan.js (WORKER_HARGA_PANGAN_URL).
//
// Catatan: Worker ini mengambil data dari sumber eksternal (SISKAPERBAPO
// Disperindag Jatim + BI PIHPS). SISKAPERBAPO adalah endpoint tidak resmi
// (reverse-engineered), bisa berubah tanpa pemberitahuan. Fallback ke BI
// otomatis jalan kalau SISKAPERBAPO gagal.
// ============================================================

// ---- Konstanta wilayah (sama seperti api/harga-pangan.js) ----
// Di-hardcode ke Kabupaten Magetan. Ganti ke 'madiunkab' / 'madiunkota' /
// '' (Provinsi Jatim) kalau perlu.
const WILAYAH_ACUAN = 'magetankab';
const WILAYAH_ACUAN_LABEL = 'Kabupaten Magetan';

const SISKAPERBAPO_URL = 'https://siskaperbapo.jatimprov.go.id/harga/tabel.nodesign/';
const SISKAPERBAPO_REFERER = 'https://siskaperbapo.jatimprov.go.id/harga/tabel/';
const SISKAPERBAPO_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

const SLUG_TO_SISKAPERBAPO_ID = {
  'beras-premium': '2', 'beras-medium': '4', 'gula-pasir': '7',
  'minyak-goreng-curah': '10', 'daging-sapi': '12', 'daging-ayam': '13',
  'telur-ayam': '16', 'cabai-merah-keriting': '37', 'bawang-merah': '39',
  'bawang-putih': '49', 'cabai-rawit-merah': '50', 'minyak-goreng-kemasan': '96',
  'kol-kubis': '44', 'kentang': '45', 'tomat': '46', 'wortel': '47', 'buncis': '48',
  'ikan-bandeng': '58', 'ikan-kembung': '59', 'ikan-tongkol': '60', 'ikan-tuna': '61',
  'ikan-cakalang': '62', 'ikan-asin-teri': '40', 'susu-kental-manis': '20',
  'susu-bubuk': '23', 'jagung-pipilan': '25', 'garam-beryodium': '28', 'tepung-terigu': '30',
  'kedelai': '33', 'mie-instan': '35', 'kacang-hijau': '41', 'kacang-tanah': '42',
  'ketela-pohon': '43', 'gas-melon': '82',
};

const PIHPS_BASE_URL = 'https://www.bi.go.id/hargapangan';
const SLUG_TO_BI_ID = {
  'beras-medium': 'com_3', 'beras-premium': 'com_5', 'daging-ayam': 'com_7',
  'daging-sapi': 'com_8', 'telur-ayam': 'com_10', 'bawang-merah': 'com_11',
  'bawang-putih': 'com_12', 'cabai-merah-keriting': 'com_14', 'cabai-rawit-merah': 'com_16',
  'minyak-goreng-curah': 'com_17', 'minyak-goreng-kemasan': 'com_18', 'gula-pasir': 'com_21',
};
const JATIM_PROVINCE_ID = '35';

function fmtDateID(d) { return d.toISOString().split('T')[0]; }

// ---- Session cookie SISKAPERBAPO (module-scoped cache) ----
let _cachedSessionCookie = null;
let _cachedSessionAt = 0;
const SESSION_TTL_MS = 10 * 60 * 1000;

async function getSiskaperbapoSessionCookie() {
  const now = Date.now();
  if (_cachedSessionCookie && now - _cachedSessionAt < SESSION_TTL_MS) return _cachedSessionCookie;
  const res = await fetch(SISKAPERBAPO_REFERER, {
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'User-Agent': SISKAPERBAPO_USER_AGENT },
  });
  if (!res.ok) throw new Error(`SISKAPERBAPO gagal ambil sesi: ${res.status}`);
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/PHPSESSID=([^;]+)/);
  if (!m) throw new Error('SISKAPERBAPO tidak mengembalikan PHPSESSID');
  _cachedSessionCookie = `PHPSESSID=${m[1]}`;
  _cachedSessionAt = now;
  return _cachedSessionCookie;
}

function buildSiskaperbapoBody(dateStr) {
  const p = new URLSearchParams();
  p.set('tanggal', dateStr);
  p.set('kabkota', WILAYAH_ACUAN);
  return p.toString();
}

async function fetchSiskaperbapoDay(dateStr, sessionCookie) {
  const res = await fetch(SISKAPERBAPO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: '*/*', Origin: 'https://siskaperbapo.jatimprov.go.id',
      Referer: SISKAPERBAPO_REFERER, 'X-Requested-With': 'XMLHttpRequest',
      Cookie: sessionCookie, 'User-Agent': SISKAPERBAPO_USER_AGENT,
    },
    body: buildSiskaperbapoBody(dateStr),
  });
  if (!res.ok) throw new Error(`SISKAPERBAPO request gagal: ${res.status}`);
  const html = await res.text();
  if (!html.includes('price-tooltip-enabled') || !html.includes('data-commodity-id')) {
    console.warn(`[worker] SISKAPERBAPO (${dateStr}) balas bukan tabel harga. len=${html.length}`);
    return null;
  }
  const rowMap = new Map();
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html))) {
    const rowHtml = rowMatch[1];
    const idMatch = rowHtml.match(/data-commodity-id=['"](\d+)['"]/);
    if (!idMatch) continue;
    const priceMatch = rowHtml.match(/class="right sekarang">([^<]*)</);
    if (!priceMatch) continue;
    const raw = priceMatch[1].trim();
    const num = Number(raw.replace(/\./g, '').replace(/,/g, ''));
    if (!Number.isFinite(num) || num <= 0) continue;
    rowMap.set(idMatch[1], { price: num, date: dateStr });
  }
  return rowMap.size ? rowMap : null;
}

async function fetchSiskaperbapoPrices(slugs) {
  const result = new Map();
  const today = new Date();
  let sessionCookie;
  try { sessionCookie = await getSiskaperbapoSessionCookie(); }
  catch (e) { console.warn('[worker] SISKAPERBAPO sesi gagal:', e.message); return result; }
  for (let daysBack = 0; daysBack <= 1; daysBack++) {
    const d = new Date(today);
    d.setDate(d.getDate() - daysBack);
    const dateStr = fmtDateID(d);
    let rowMap;
    try { rowMap = await fetchSiskaperbapoDay(dateStr, sessionCookie); }
    catch (e) { console.warn(`[worker] SISKAPERBAPO (${dateStr}):`, e.message); rowMap = null; }
    if (!rowMap) continue;
    slugs.forEach((slug) => {
      if (result.has(slug)) return;
      const id = SLUG_TO_SISKAPERBAPO_ID[slug];
      if (!id) return;
      const hit = rowMap.get(id);
      if (hit) result.set(slug, hit);
    });
    if (result.size === slugs.length) break;
  }
  return result;
}

// ---- BI PIHPS fallback ----
function parsePrice(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (!str || str === '-' || str === '0') return null;
  const num = Number(str.replace(/\./g, '').replace(/,/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}
function parseDateKey(key) {
  const m = key.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}
function fmtDate(d) { return d.toISOString().split('T')[0]; }
function _latestFromRow(row) {
  let latestDate = null, latestPrice = null;
  for (const [key, rawValue] of Object.entries(row)) {
    const isoDate = parseDateKey(key);
    if (!isoDate) continue;
    const price = parsePrice(rawValue);
    if (price === null) continue;
    if (!latestDate || isoDate > latestDate) { latestDate = isoDate; latestPrice = price; }
  }
  return latestDate ? { price: latestPrice, date: latestDate } : null;
}
async function fetchRows(biId, provinceId, regencyId) {
  const params = new URLSearchParams({
    price_type_id: '1', comcat_id: biId, showKota: 'true', showPasar: 'false',
    tipe_laporan: '1', start_date: fmtDate(new Date(Date.now() - 7 * 864e5)),
    end_date: fmtDate(new Date()), province_id: provinceId, regency_id: regencyId,
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
    }
  );
  if (!res.ok) throw new Error(`PIHPS request gagal: ${res.status}`);
  const payload = await res.json();
  return payload.data || [];
}
async function fetchLatestRegionalPrice(biId) {
  try {
    const rows = await fetchRows(biId, JATIM_PROVINCE_ID, '');
    const madiunRow = rows.find((r) => r.name && String(r.name).toLowerCase().includes('madiun'));
    if (madiunRow) { const h = _latestFromRow(madiunRow); if (h) return { ...h, region: String(madiunRow.name).trim() }; }
    const magetanRow = rows.find((r) => r.name && String(r.name).toLowerCase().includes('magetan'));
    if (magetanRow) { const h = _latestFromRow(magetanRow); if (h) return { ...h, region: String(magetanRow.name).trim() }; }
    const jatimRow = rows.find((r) => r.name && String(r.name).toLowerCase().includes('jawa timur'));
    if (jatimRow) { const h = _latestFromRow(jatimRow); if (h) return { ...h, region: 'Provinsi Jawa Timur' }; }
  } catch (e) { console.warn('[worker] BI Magetan/Madiun/Jatim gagal:', e.message); }
  try {
    const rows = await fetchRows(biId, '', '');
    const nationalRow = rows.find((r) => r.level === 0 || r.name === 'Semua Provinsi');
    if (nationalRow) { const h = _latestFromRow(nationalRow); if (h) return { ...h, region: 'Nasional' }; }
  } catch (e) { console.warn('[worker] BI Nasional gagal:', e.message); }
  return null;
}

// ---- Handler (Cloudflare Workers format) ----
const ALLOWED_ORIGINS = ['https://sinarkeu.vercel.app', 'http://localhost:3000', 'http://127.0.0.1:5500'];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const url = new URL(request.url);
    const slugsParam = url.searchParams.get('slugs') || '';
    const slugs = slugsParam.split(',').map((s) => s.trim()).filter((s) => SLUG_TO_SISKAPERBAPO_ID[s] || SLUG_TO_BI_ID[s]);
    if (!slugs.length) {
      return new Response(JSON.stringify({ error: 'Parameter slugs kosong/tidak dikenali' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const prices = {};
    // 1) SISKAPERBAPO (utama)
    const siskaperbapoSlugs = slugs.filter((s) => SLUG_TO_SISKAPERBAPO_ID[s]);
    if (siskaperbapoSlugs.length) {
      try {
        const hits = await fetchSiskaperbapoPrices(siskaperbapoSlugs);
        hits.forEach((hit, slug) => { prices[slug] = { ...hit, region: WILAYAH_ACUAN_LABEL, source: 'siskaperbapo' }; });
      } catch (e) { console.error('[worker] SISKAPERBAPO gagal total:', e.message); }
    }
    // 2) Fallback BI
    const missingSlugs = slugs.filter((s) => !prices[s] && SLUG_TO_BI_ID[s]);
    if (missingSlugs.length) {
      await Promise.all(missingSlugs.map(async (slug) => {
        try {
          const r = await fetchLatestRegionalPrice(SLUG_TO_BI_ID[slug]);
          if (r) prices[slug] = { ...r, source: 'pihps-bi' };
        } catch (e) { console.error(`[worker] BI gagal ${slug}:`, e.message); }
      }));
    }

    const headers = { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=3600, stale-while-revalidate=600' };
    return new Response(JSON.stringify({ prices }), { status: 200, headers });
  },
};
