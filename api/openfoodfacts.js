import { applyRateLimit } from './_ratelimit.js';

// api/openfoodfacts.js — Vercel Serverless Function
// Proxy untuk Open Food Facts (dipakai js/nutrisi.js sebagai fallback data
// gizi untuk bahan yang tidak ketemu di basis data lokal window.NUTRISI_REFERENSI).
//
// [KENAPA ADA] Sebelumnya js/nutrisi.js fetch LANGSUNG dari browser ke
// world.openfoodfacts.org/cgi/search.pl. Endpoint itu sudah dideprekasi oleh
// Open Food Facts sendiri dan sekarang konsisten balas 503 -- dan karena
// respons error itu tidak bawa header CORS, browser melaporkannya sebagai
// "blocked by CORS policy" alih-alih 503 biasa. Gantinya, search.openfoodfacts.org
// (Search-a-licious, API pengganti resmi) TERNYATA juga tidak mengizinkan
// origin sinarkeu.vercel.app secara langsung dari browser (lihat catatan di
// bawah) -- jadi solusi paling stabil adalah proxy lewat server kita sendiri,
// sama seperti pola api/emas.js & api/harga-pangan.js: request browser ->
// Vercel (server-to-server, tidak kena CORS) -> Open Food Facts -> balik ke
// browser dengan header CORS dari KITA sendiri.
//
// Coba Search-a-licious dulu (sumber utama, lebih baru & lebih relevan
// hasilnya), fallback ke endpoint legacy cgi/search.pl kalau yang pertama
// gagal -- keduanya dipanggil DARI SERVER jadi tidak masalah walau salah
// satu lagi 503, hasilnya tetap balasan HTTP biasa (bukan CORS error) yang
// bisa ditangani js/nutrisi.js seperti biasa.

export default async function handler(req, res) {
    const allowedOrigins = [
        'https://sinarkeu.vercel.app',
        'http://localhost:3000',
        'http://127.0.0.1:5500',
    ];
    const origin = req.headers.origin || '';
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://sinarkeu.vercel.app');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // [RATE LIMIT] 30 req/menit/IP -- proxy publik gratis pihak ketiga, jaga
    // supaya satu device yang lupa nutup tab tidak membanjiri upstream.
    if (applyRateLimit(req, res, { limit: 30, windowMs: 60000, scope: 'openfoodfacts' })) return;

    const q = String(req.query.q || '').trim();
    if (!q) {
        return res.status(400).json({ error: 'Parameter q wajib diisi' });
    }

    const UA = 'Sinarkeu/1.0 (+https://sinarkeu.vercel.app)';

    // 1) Search-a-licious (API pengganti resmi, full-text search)
    try {
        const url = 'https://search.openfoodfacts.org/search?q=' + encodeURIComponent(q) +
            '&langs=id,en&page_size=1&fields=product_name,nutriments';
        const upstream = await fetch(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': UA },
            signal: AbortSignal.timeout(8000),
        });
        if (upstream.ok) {
            const data = await upstream.json();
            const hits = data.hits || data.products || [];
            res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
            return res.status(200).json({ products: hits, source: 'search-a-licious' });
        }
    } catch { /* lanjut ke fallback di bawah */ }

    // 2) Fallback: endpoint legacy (kalau kebetulan sedang tidak 503) --
    // aman dipanggil dari server, tidak kena isu CORS seperti di browser.
    try {
        const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(q) +
            '&search_simple=1&action=process&json=1&page_size=1&fields=product_name,nutriments';
        const upstream = await fetch(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': UA },
            signal: AbortSignal.timeout(8000),
        });
        if (upstream.ok) {
            const data = await upstream.json();
            res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
            return res.status(200).json({ products: data.products || [], source: 'legacy' });
        }
        return res.status(upstream.status).json({ error: 'Upstream error', products: [] });
    } catch (err) {
        return res.status(502).json({ error: 'Gagal menghubungi Open Food Facts', message: err.message, products: [] });
    }
}
