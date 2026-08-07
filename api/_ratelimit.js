// api/_ratelimit.js — rate limiter sederhana untuk serverless function.
//
// [KENAPA ADA] Sebelumnya api/emas.js & api/harga-pangan.js sama sekali tidak
// punya proteksi abuse: siapa pun yang tahu URL-nya bisa nge-loop request dan
// (a) menghabiskan kuota Vercel, (b) bikin IP proxy kita di-ban SISKAPERBAPO/BI.
//
// [KETERBATASAN — jujur, jangan dianggap benteng] Serverless = stateless dan
// multi-instance, jadi counter in-memory ini hanya berlaku per instance yang
// kebetulan warm. Ini cukup untuk meredam loop tak sengaja / scraper naif,
// TIDAK cukup untuk penyerang serius. Kalau nanti butuh kuat, pindahkan
// counter ke Upstash Redis / Cloudflare KV (interface fungsi ini sengaja
// dibuat sinkron-sederhana supaya gampang diganti).

const BUCKETS = new Map(); // key -> { count, resetAt }
const MAX_KEYS = 5000;     // jaga-jaga memory leak di instance yang lama hidup

function clientKey(req) {
    const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return xff || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

/**
 * @returns {{ok:boolean, remaining:number, retryAfter:number, limit:number}}
 */
export function rateLimit(req, { limit = 30, windowMs = 60_000, scope = 'default' } = {}) {
    const now = Date.now();
    const key = scope + ':' + clientKey(req);

    if (BUCKETS.size > MAX_KEYS) BUCKETS.clear();

    let b = BUCKETS.get(key);
    if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + windowMs };
        BUCKETS.set(key, b);
    }
    b.count++;

    const remaining = Math.max(0, limit - b.count);
    return {
        ok: b.count <= limit,
        remaining,
        limit,
        retryAfter: Math.ceil((b.resetAt - now) / 1000),
    };
}

/** Pasang header standar + balas 429 kalau lewat kuota. True = request harus dihentikan. */
export function applyRateLimit(req, res, opts) {
    const r = rateLimit(req, opts);
    res.setHeader('X-RateLimit-Limit', String(r.limit));
    res.setHeader('X-RateLimit-Remaining', String(r.remaining));
    if (!r.ok) {
        res.setHeader('Retry-After', String(r.retryAfter));
        res.status(429).json({ error: 'Terlalu banyak request, coba lagi nanti.', retry_after: r.retryAfter });
        return true;
    }
    return false;
}
