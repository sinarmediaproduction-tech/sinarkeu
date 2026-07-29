// ==================== HARGA PANGAN REFERENSI ====================
// Auto-isi kolom harga di Daftar Belanja (js/shopping-list.js) pakai harga
// pasar acuan nasional dari Bank Indonesia PIHPS, lewat proxy
// api/harga-pangan.js (menghindari CORS -- lihat file itu untuk alasannya,
// sama seperti pola api/emas.js untuk harga emas).
//
// Disimpan di Supabase project MILIK USER SENDIRI (tabel
// harga_pangan_referensi, lihat sql/harga_pangan_referensi.sql) supaya
// harga hari ini cuma perlu ditarik SEKALI dari BI per komoditas -- device
// lain yang buka Daftar Belanja di hari yang sama tinggal baca cache-nya,
// bukan hit BI lagi. Ini beda dari data transaksi: harga pasar ini publik,
// jadi sengaja TIDAK dienkripsi dan boleh dibaca lintas akun dalam 1
// project Supabase yang sama (lihat komentar RLS di file SQL-nya).
//
// Alur baca (dari yang paling murah): localStorage (6 jam) -> Supabase
// (cache hari ini) -> proxy api/harga-pangan.js (live dari BI, lalu ditulis
// balik ke Supabase). Gagal di titik manapun -> diam-diam kembalikan apa
// yang berhasil didapat; Daftar Belanja tetap bisa dipakai manual seperti
// biasa kalau semua sumber ini gagal (fitur bantu, bukan syarat).

// Komoditas yang ditrack + kata kunci pencocokan nama barang (case-
// insensitive, substring match). Urutan PENTING: taruh yang lebih spesifik
// duluan supaya tidak "ketiban" keyword generik di bawahnya -- contoh:
// "Beras Premium 5kg" harus kena baris beras-premium dulu, bukan nyasar
// ke baris beras-medium yang keyword-nya cuma "beras".
window.HARGA_PANGAN_COMMODITIES = [
    { slug: 'beras-premium', name: 'Beras Premium', unit: 'kg', keywords: ['beras premium', 'beras super'] },
    { slug: 'beras-medium', name: 'Beras Medium', unit: 'kg', keywords: ['beras'] },
    { slug: 'daging-ayam', name: 'Daging Ayam', unit: 'kg', keywords: ['ayam'] },
    { slug: 'daging-sapi', name: 'Daging Sapi', unit: 'kg', keywords: ['daging sapi', 'sapi'] },
    { slug: 'telur-ayam', name: 'Telur Ayam', unit: 'kg', keywords: ['telur'] },
    { slug: 'bawang-merah', name: 'Bawang Merah', unit: 'kg', keywords: ['bawang merah'] },
    { slug: 'bawang-putih', name: 'Bawang Putih', unit: 'kg', keywords: ['bawang putih'] },
    { slug: 'cabai-rawit-merah', name: 'Cabai Rawit Merah', unit: 'kg', keywords: ['cabe rawit', 'cabai rawit'] },
    { slug: 'cabai-merah-keriting', name: 'Cabai Merah Keriting', unit: 'kg', keywords: ['cabe merah', 'cabai merah', 'cabe keriting', 'cabai keriting'] },
    { slug: 'minyak-goreng-kemasan', name: 'Minyak Goreng Kemasan', unit: 'liter', keywords: ['minyak goreng kemasan', 'minyak kemasan'] },
    { slug: 'minyak-goreng-curah', name: 'Minyak Goreng Curah', unit: 'liter', keywords: ['minyak goreng', 'minyak curah'] },
    { slug: 'gula-pasir', name: 'Gula Pasir', unit: 'kg', keywords: ['gula'] },
];
// [PENYESUAIAN] Sesuaikan `keywords` di atas dengan penamaan barang yang
// biasa Anda pakai di Daftar Belanja kalau hasil pencocokan otomatisnya
// masih meleset (mis. Anda selalu tulis "cabe" bukan "cabai").

const HP_CACHE_KEY = 'sk_harga_pangan_cache';
const HP_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam -- BI update maks 2x/hari

// Map<slug, {slug, name, unit, price, date}> -- diisi setelah
// prefetchHargaPanganReferensi() selesai. null selama belum pernah dipanggil.
window._hargaPanganCache = null;

// Cocokkan nama barang ke salah satu komoditas yang ditrack.
// Return objek commodity ({slug, name, unit, keywords}) atau null.
window.matchHargaPanganCommodity = function(itemName) {
    if (!itemName) return null;
    const normalized = String(itemName).toLowerCase();
    return window.HARGA_PANGAN_COMMODITIES.find(function(c) {
        return c.keywords.some(function(kw) { return normalized.includes(kw); });
    }) || null;
};

function _hpTodayDate() {
    // Tanggal lokal device, bukan UTC -- cukup akurat untuk keperluan
    // "sudah pernah diambil hari ini", tidak perlu presisi WIB di sini
    // (beda dengan api/harga-pangan.js yang urusannya tanggal harga BI).
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function _hpReadLocalCache() {
    try {
        const raw = localStorage.getItem(HP_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || (Date.now() - parsed.fetchedAt) > HP_CACHE_TTL_MS) return null;
        return parsed.rows;
    } catch { return null; }
}
function _hpWriteLocalCache(rows) {
    try {
        localStorage.setItem(HP_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), rows: rows }));
    } catch { /* localStorage penuh/disabled -- tidak fatal, cuma kehilangan cache lokal */ }
}

// Ambil harga referensi terbaru untuk semua komoditas yang ditrack.
// Aman dipanggil berkali-kali (mis. tiap buka modal Daftar Belanja) --
// request ke Supabase/BI cuma benar-benar terjadi kalau cache lokal sudah
// kadaluarsa.
window.prefetchHargaPanganReferensi = async function() {
    const local = _hpReadLocalCache();
    if (local) {
        window._hargaPanganCache = new Map(local.map(function(r) { return [r.slug, r]; }));
        return window._hargaPanganCache;
    }

    const cache = new Map();
    const today = _hpTodayDate();
    const allSlugs = window.HARGA_PANGAN_COMMODITIES.map(function(c) { return c.slug; });
    const hasSupabase = typeof window.callSupabaseAPI === 'function' && window.getCloudUrl && window.getCloudUrl();

    // 1) Cek cache Supabase (mungkin sudah ditulis device lain hari ini)
    if (window.isOnline && window.isOnline() && hasSupabase) {
        try {
            const rows = await window.callSupabaseAPI(
                'harga_pangan_referensi',
                'GET',
                null,
                '?select=commodity_slug,commodity_name,unit,price,price_date&price_date=eq.' + today + '&commodity_slug=in.(' + allSlugs.join(',') + ')'
            );
            (rows || []).forEach(function(r) {
                cache.set(r.commodity_slug, {
                    slug: r.commodity_slug, name: r.commodity_name, unit: r.unit,
                    price: Number(r.price), date: r.price_date
                });
            });
        } catch (e) {
            console.warn('[HargaPangan] Gagal cek cache Supabase:', e.message);
        }
    }

    // 2) Ambil live dari BI (lewat proxy) untuk yang belum ada di cache
    const missingSlugs = allSlugs.filter(function(s) { return !cache.has(s); });
    if (missingSlugs.length && window.isOnline && window.isOnline()) {
        try {
            const res = await fetch('/api/harga-pangan?slugs=' + missingSlugs.join(','), { signal: AbortSignal.timeout(10000) });
            if (res.ok) {
                const json = await res.json();
                const prices = json.prices || {};
                const rowsToUpsert = [];

                missingSlugs.forEach(function(slug) {
                    const hit = prices[slug];
                    if (!hit) return;
                    const meta = window.HARGA_PANGAN_COMMODITIES.find(function(c) { return c.slug === slug; });
                    if (!meta) return;
                    cache.set(slug, { slug: slug, name: meta.name, unit: meta.unit, price: hit.price, date: hit.date });
                    rowsToUpsert.push({
                        commodity_slug: slug,
                        commodity_name: meta.name,
                        unit: meta.unit,
                        price: hit.price,
                        price_date: hit.date
                    });
                });

                // Tulis balik ke Supabase (fire-and-forget) supaya device lain &
                // buka lagi nanti hari ini tidak perlu hit BI ulang.
                if (rowsToUpsert.length && hasSupabase) {
                    window.callSupabaseAPI(
                        'harga_pangan_referensi', 'POST', rowsToUpsert,
                        '?on_conflict=commodity_slug,price_date'
                    ).catch(function(e) {
                        console.warn('[HargaPangan] Gagal simpan cache ke Supabase:', e.message);
                    });
                }
            }
        } catch (e) {
            console.warn('[HargaPangan] Gagal ambil harga live dari BI:', e.message);
        }
    }

    if (cache.size) _hpWriteLocalCache(Array.from(cache.values()));
    window._hargaPanganCache = cache;
    return cache;
};

// Cari harga referensi untuk 1 nama barang. Panggil SETELAH
// prefetchHargaPanganReferensi() selesai (kalau dipanggil sebelumnya,
// cache masih null -> selalu return null, bukan error).
window.getHargaPanganUntukItem = function(itemName) {
    if (!window._hargaPanganCache) return null;
    const commodity = window.matchHargaPanganCommodity(itemName);
    if (!commodity) return null;
    return window._hargaPanganCache.get(commodity.slug) || null;
};
