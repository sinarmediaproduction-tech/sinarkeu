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
    // [MANUAL] Bukan data pangan -> tidak ada di PIHPS/BI, jadi TIDAK
    // ditarik dari proxy api/harga-pangan.js. Harganya diinput sendiri oleh
    // user lewat menu sidebar "Harga Komoditas" dan disimpan lokal (lihat
    // window.setManualHargaKomoditas di bawah), bukan lewat prefetch BI.
    { slug: 'gas-melon', name: 'Gas Melon (LPG 3kg)', unit: 'tabung', keywords: ['gas melon', 'gas 3kg', 'elpiji 3kg', 'lpg 3kg'], manual: true },
    { slug: 'token-listrik', name: 'Token Listrik', unit: 'kWh', keywords: ['token listrik', 'token pln', 'pulsa listrik'], manual: true },
];
// [CATATAN] Kategori "Kosmetik" sengaja TIDAK ditambahkan ke sini: harga
// kosmetik terlalu beragam per merek/jenis produk untuk punya satu "harga
// acuan" yang berarti (beda dengan beras/gas/token yang harga per unit
// wajarnya relatif seragam). Harga barang kosmetik tetap diisi manual
// langsung di kolom harga Daftar Belanja seperti biasa.
// [PENYESUAIAN] Sesuaikan `keywords` di atas dengan penamaan barang yang
// biasa Anda pakai di Daftar Belanja kalau hasil pencocokan otomatisnya
// masih meleset (mis. Anda selalu tulis "cabe" bukan "cabai").

const HP_CACHE_KEY = 'sk_harga_pangan_cache';
const HP_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam -- BI update maks 2x/hari

// [MANUAL] Penyimpanan harga komoditas non-pangan (Gas Melon, Token Listrik)
// yang diisi user sendiri lewat menu "Harga Komoditas". Sengaja TERPISAH
// dari HP_CACHE_KEY (yang isinya data resmi BI dan boleh kadaluarsa per 6
// jam) supaya harga manual ini persisten -- tidak ikut ter-invalidate tiap
// cache BI refresh, dan hanya berubah kalau user sendiri yang mengubahnya.
// Disimpan HANYA di localStorage (tidak di Supabase), karena beda dengan
// harga pangan dari BI, angka ini bukan data publik/acuan resmi -- murni
// input pribadi tiap device/akun.
const HK_MANUAL_KEY = 'sk_harga_komoditas_manual';
function _hkReadManual() {
    try {
        const raw = localStorage.getItem(HK_MANUAL_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}
function _hkWriteManual(map) {
    try { localStorage.setItem(HK_MANUAL_KEY, JSON.stringify(map)); } catch { /* tidak fatal */ }
}
// Simpan/ubah harga 1 komoditas manual. Langsung update
// window._hargaPanganCache juga (kalau sudah pernah di-prefetch) supaya
// tabel di modal "Harga Komoditas" bisa langsung re-render tanpa perlu
// prefetch ulang.
window.setManualHargaKomoditas = function(slug, price) {
    const meta = window.HARGA_PANGAN_COMMODITIES.find(function(c) { return c.slug === slug && c.manual; });
    if (!meta || !price) return false;
    const map = _hkReadManual();
    const today = _hpTodayDate();
    map[slug] = { price: Number(price), date: today };
    _hkWriteManual(map);
    if (window._hargaPanganCache) {
        window._hargaPanganCache.set(slug, { slug: slug, name: meta.name, unit: meta.unit, price: Number(price), date: today });
    }
    return true;
};

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
    const manualMap = _hkReadManual();
    const mergeManual = function(cache) {
        window.HARGA_PANGAN_COMMODITIES.filter(function(c) { return c.manual; }).forEach(function(c) {
            const saved = manualMap[c.slug];
            if (saved) cache.set(c.slug, { slug: c.slug, name: c.name, unit: c.unit, price: saved.price, date: saved.date });
        });
        return cache;
    };

    const local = _hpReadLocalCache();
    if (local) {
        window._hargaPanganCache = mergeManual(new Map(local.map(function(r) { return [r.slug, r]; })));
        return window._hargaPanganCache;
    }

    const cache = new Map();
    const today = _hpTodayDate();
    // [MANUAL] Komoditas manual dikecualikan di sini -- tidak ada di PIHPS,
    // jadi jangan ikut ditanyakan ke Supabase/BI (bakal selalu miss & buang
    // 1 slot query percuma).
    const allSlugs = window.HARGA_PANGAN_COMMODITIES.filter(function(c) { return !c.manual; }).map(function(c) { return c.slug; });
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
    window._hargaPanganCache = mergeManual(cache);
    return window._hargaPanganCache;
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

// ==================== MODAL "HARGA KOMODITAS" ====================
// Halaman sidebar baru yang menampilkan SEMUA komoditas yang ditrack:
// grup "otomatis" (dari BI, read-only) dan grup "manual" (Gas Melon,
// Token Listrik -- user isi sendiri via modal edit kecil).
window.openHargaKomoditasModal = async function() {
    await window.prefetchHargaPanganReferensi();
    window.renderHargaKomoditasModal();
    window.openModal('hargaKomoditasModal');
};

// Paksa tarik ulang harga BI walau cache lokal (6 jam) belum kadaluarsa --
// dipicu tombol "Segarkan dari BI". Harga manual TIDAK ikut ke-reset di
// sini (dibaca ulang dari HK_MANUAL_KEY, bukan HP_CACHE_KEY).
window.refreshHargaKomoditas = async function() {
    try { localStorage.removeItem(HP_CACHE_KEY); } catch { /* tidak fatal */ }
    window._hargaPanganCache = null;
    await window.prefetchHargaPanganReferensi();
    window.renderHargaKomoditasModal();
};

window.renderHargaKomoditasModal = function() {
    const autoBody = document.getElementById('hkAutoTableBody');
    const manualBody = document.getElementById('hkManualTableBody');
    if (!autoBody || !manualBody) return;
    const cache = window._hargaPanganCache || new Map();

    const renderRow = function(c, withAction) {
        const hit = cache.get(c.slug);
        const price = hit ? window.rp(hit.price) : '<span style="color:var(--text-secondary)">Belum ada data</span>';
        const date = hit ? window.escapeHtml(hit.date) : '-';
        let row = '<tr><td>' + window.escapeHtml(c.name) + '</td><td>' + window.escapeHtml(c.unit) + '</td><td>' + price + '</td><td>' + date + '</td>';
        if (withAction) {
            row += '<td class="col-action"><button type="button" class="btn btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="window.openEditHargaKomoditasManual(\'' + c.slug + '\')">Ubah</button></td>';
        }
        return row + '</tr>';
    };

    const autoRows = window.HARGA_PANGAN_COMMODITIES.filter(function(c) { return !c.manual; });
    autoBody.innerHTML = autoRows.map(function(c) { return renderRow(c, false); }).join('') || '<tr><td colspan="4">Tidak ada data.</td></tr>';

    const manualRows = window.HARGA_PANGAN_COMMODITIES.filter(function(c) { return c.manual; });
    manualBody.innerHTML = manualRows.map(function(c) { return renderRow(c, true); }).join('') || '<tr><td colspan="5">Tidak ada data.</td></tr>';
};

window.openEditHargaKomoditasManual = function(slug) {
    const meta = window.HARGA_PANGAN_COMMODITIES.find(function(c) { return c.slug === slug && c.manual; });
    if (!meta) return;
    document.getElementById('hkManualSlug').value = slug;
    document.getElementById('hkManualLabel').textContent = 'Harga ' + meta.name + ' (per ' + meta.unit + ')';
    const hit = window._hargaPanganCache && window._hargaPanganCache.get(slug);
    const priceInput = document.getElementById('hkManualPrice');
    priceInput.value = hit ? Number(hit.price).toLocaleString('id-ID') : '';
    window.openModal('editHargaKomoditasManualModal');
};

window.handleHargaKomoditasManualSubmit = function(e) {
    e.preventDefault();
    const slug = document.getElementById('hkManualSlug').value;
    const price = window.unRp(document.getElementById('hkManualPrice').value);
    if (!slug || !price) return;
    window.setManualHargaKomoditas(slug, price);
    window.closeModal('editHargaKomoditasManualModal');
    window.renderHargaKomoditasModal();
};
