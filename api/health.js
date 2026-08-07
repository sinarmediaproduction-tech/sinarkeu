// api/health.js — endpoint healthcheck untuk monitoring & alerts.
//
// Dipakai oleh:
//   - .github/workflows/uptime-check.yml (cron, gagal -> notifikasi GitHub)
//   - uptime monitor eksternal (UptimeRobot/BetterStack) kalau dipasang
//
// GET /api/health           -> { status, time, uptime_s, checks:{...} }
// GET /api/health?deep=1    -> ikut ping upstream (SISKAPERBAPO) dengan timeout
//
// Selalu balas JSON. status: "ok" | "degraded". HTTP 200 untuk ok,
// 503 untuk degraded supaya uptime monitor bisa mendeteksinya tanpa parsing body.

const BOOT = Date.now();

async function ping(url, timeoutMs = 4000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const started = Date.now();
    try {
        const r = await fetch(url, { method: 'GET', signal: ac.signal, headers: { 'User-Agent': 'SinarKeu-Healthcheck' } });
        return { ok: r.ok, status: r.status, ms: Date.now() - started };
    } catch (e) {
        return { ok: false, error: String(e.message || e), ms: Date.now() - started };
    } finally {
        clearTimeout(t);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const checks = {
        function_runtime: { ok: true, node: process.version },
    };

    if (req.query && (req.query.deep === '1' || req.query.deep === 'true')) {
        checks.siskaperbapo = await ping('https://siskaperbapo.jatimprov.go.id/harga/tabel/');
    }

    const degraded = Object.values(checks).some((c) => c && c.ok === false);
    return res.status(degraded ? 503 : 200).json({
        status: degraded ? 'degraded' : 'ok',
        app: 'sinarkeu',
        time: new Date().toISOString(),
        uptime_s: Math.round((Date.now() - BOOT) / 1000),
        checks,
    });
}
