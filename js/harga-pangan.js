// ==================== HARGA PANGAN REFERENSI ====================
// Auto-isi kolom harga di Daftar Belanja (js/shopping-list.js) pakai harga
// pasar acuan dari Bank Indonesia PIHPS untuk rata-rata Provinsi Jawa
// Timur (fallback ke rata-rata Nasional kalau data level provinsi belum
// tersedia -- lihat fetchLatestRegionalPrice di api/harga-pangan.js),
// lewat proxy api/harga-pangan.js (menghindari CORS -- lihat file itu
// untuk alasannya, sama seperti pola api/emas.js untuk harga emas).
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

    // [BARU] Sayur mayur -- sumber SISKAPERBAPO saja, tidak ada padanan
    // komoditas ini di PIHPS BI (comcat_id-nya cuma untuk 21 komoditas
    // pokok nasional).
    { slug: 'kol-kubis', name: 'Kol/Kubis', unit: 'kg', keywords: ['kol', 'kubis'] },
    { slug: 'kentang', name: 'Kentang', unit: 'kg', keywords: ['kentang'] },
    { slug: 'tomat', name: 'Tomat', unit: 'kg', keywords: ['tomat'] },
    { slug: 'wortel', name: 'Wortel', unit: 'kg', keywords: ['wortel'] },
    { slug: 'buncis', name: 'Buncis', unit: 'kg', keywords: ['buncis'] },

    // [BARU] Ikan segar
    { slug: 'ikan-bandeng', name: 'Ikan Bandeng', unit: 'kg', keywords: ['bandeng'] },
    { slug: 'ikan-kembung', name: 'Ikan Kembung', unit: 'kg', keywords: ['kembung'] },
    { slug: 'ikan-tuna', name: 'Ikan Tuna', unit: 'kg', keywords: ['tuna'] },
    { slug: 'ikan-tongkol', name: 'Ikan Tongkol', unit: 'kg', keywords: ['tongkol'] },
    { slug: 'ikan-cakalang', name: 'Ikan Cakalang', unit: 'kg', keywords: ['cakalang'] },
    { slug: 'ikan-asin-teri', name: 'Ikan Asin Teri', unit: 'kg', keywords: ['ikan asin', 'teri'] },

    // [BARU] Sembako tambahan
    { slug: 'susu-kental-manis', name: 'Susu Kental Manis', unit: 'kaleng', keywords: ['kental manis', 'skm'] },
    { slug: 'susu-bubuk', name: 'Susu Bubuk', unit: 'dus', keywords: ['susu bubuk'] },
    { slug: 'jagung-pipilan', name: 'Jagung Pipilan Kering', unit: 'kg', keywords: ['jagung'] },
    { slug: 'garam-beryodium', name: 'Garam Beryodium', unit: 'kg', keywords: ['garam'] },
    { slug: 'tepung-terigu', name: 'Tepung Terigu', unit: 'kg', keywords: ['tepung terigu', 'terigu'] },
    { slug: 'kedelai', name: 'Kedelai', unit: 'kg', keywords: ['kedelai', 'kedelei'] },
    { slug: 'mie-instan', name: 'Mie Instan', unit: 'bungkus', keywords: ['indomie', 'mie instan', 'mi instan'] },
    { slug: 'kacang-hijau', name: 'Kacang Hijau', unit: 'kg', keywords: ['kacang hijau'] },
    { slug: 'kacang-tanah', name: 'Kacang Tanah', unit: 'kg', keywords: ['kacang tanah'] },
    { slug: 'ketela-pohon', name: 'Ketela Pohon', unit: 'kg', keywords: ['ketela', 'singkong'] },

    // [OTOMATIS] Sebelumnya manual -- ternyata SISKAPERBAPO juga melacak
    // Gas Elpiji 3kg (commodity-id 82), jadi dipindah ke grup auto (tidak
    // ada lagi flag `manual: true`). Harga manual yang sudah pernah
    // diinput user tetap tidak apa-apa (akan ditimpa oleh hasil live
    // begitu prefetch berikutnya berhasil).
    { slug: 'gas-melon', name: 'Gas Melon (LPG 3kg)', unit: 'tabung', keywords: ['gas melon', 'gas 3kg', 'elpiji 3kg', 'lpg 3kg'] },

    // [MANUAL] Bukan data pangan -> tidak ada di PIHPS/BI maupun
    // SISKAPERBAPO, jadi TIDAK ditarik dari proxy api/harga-pangan.js.
    // Harganya diinput sendiri oleh user lewat menu sidebar "Harga
    // Komoditas" dan disimpan lokal (lihat window.setManualHargaKomoditas
    // di bawah), bukan lewat prefetch otomatis.
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
// [CLOUD SYNC] Sebelumnya disimpan HANYA di localStorage (per-device, tidak
// ikut kalau ganti/tambah device). Sekarang juga di-push ke Supabase lewat
// window.pushSetting(key='harga_komoditas_manual', bookId='global') --
// pola yang sama seperti 'telegram_config'/'books' (lihat js/db.js): scoped
// per AKUN lewat account_tag, bukan per buku (harga komoditas memang tidak
// terkait ke buku manapun). Nilai dari cloud di-pull balik & di-merge oleh
// window._hkMergeManualFromCloud (dipanggil dari js/db.js pullAllSettings).
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
    // [CLOUD SYNC] Fire-and-forget -- jangan blokir UI/modal nunggu network.
    // Kalau gagal (offline dll), data tetap aman di localStorage lokal dan
    // akan ke-push lagi di kesempatan berikutnya user mengubah harga manual
    // apa pun (karena tiap push selalu kirim SELURUH map, bukan cuma slug
    // yang berubah).
    if (window.pushSettingHargaKomoditasManual) {
        window.pushSettingHargaKomoditasManual().catch(function(e) {
            console.warn('[HargaKomoditas] Gagal sync harga manual ke cloud:', e.message);
        });
    }
    return true;
};

// Push SELURUH map harga manual (bukan cuma yang barusan diubah) ke
// Supabase, konsisten dengan pola pushSettingBooks/pushSettingTelegram di
// js/db.js. Dipanggil otomatis dari setManualHargaKomoditas di atas.
window.pushSettingHargaKomoditasManual = async function() {
    if (!window.isOnline || !window.isOnline()) return false;
    const map = _hkReadManual();
    const result = await window.pushSetting('harga_komoditas_manual', map, 'global');
    return !!result;
};

// Dipanggil dari js/db.js (pullAllSettings) waktu ketemu baris settings
// dengan key 'harga_komoditas_manual' dari cloud. Merge PER-SLUG berdasarkan
// tanggal terbaru (bukan timpa total map lokal) -- supaya kalau device A
// baru saja mengubah 1 harga tapi belum sempat ke-pull-balik di device B,
// device B tidak kehilangan perubahan harga lain yang sudah lebih dulu ada
// di lokalnya (pola sama seperti union-merge 'books', lihat js/db.js).
window._hkMergeManualFromCloud = function(cloudMap) {
    if (!cloudMap || typeof cloudMap !== 'object') return false;
    const local = _hkReadManual();
    let changed = false;
    Object.keys(cloudMap).forEach(function(slug) {
        const meta = window.HARGA_PANGAN_COMMODITIES.find(function(c) { return c.slug === slug && c.manual; });
        if (!meta) return; // slug tidak dikenal (mis. sudah dihapus dari daftar), abaikan
        const cloudEntry = cloudMap[slug];
        if (!cloudEntry || typeof cloudEntry.price !== 'number') return;
        const localEntry = local[slug];
        if (!localEntry || !localEntry.date || (cloudEntry.date && cloudEntry.date > localEntry.date)) {
            local[slug] = cloudEntry;
            changed = true;
        }
    });
    if (changed) {
        _hkWriteManual(local);
        if (window._hargaPanganCache) {
            Object.keys(local).forEach(function(slug) {
                const meta = window.HARGA_PANGAN_COMMODITIES.find(function(c) { return c.slug === slug && c.manual; });
                if (meta) {
                    window._hargaPanganCache.set(slug, { slug: slug, name: meta.name, unit: meta.unit, price: local[slug].price, date: local[slug].date });
                }
            });
        }
    }
    return changed;
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
                    // [WILAYAH] hit.region diisi proxy (api/harga-pangan.js) sesuai level
                    // data yang berhasil didapat: 'Provinsi Jawa Timur' -> fallback
                    // 'Nasional'. Cuma disimpan di
                    // cache lokal untuk ditampilkan di UI, TIDAK ditulis ke kolom
                    // Supabase (tabel itu dipakai bersama, skemanya sengaja tidak
                    // diubah supaya tidak perlu migrasi SQL manual di semua akun).
                    cache.set(slug, { slug: slug, name: meta.name, unit: meta.unit, price: hit.price, date: hit.date, region: hit.region || null });
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

// ==================== HISTORI & TREN (komoditas auto/BI) ====================
// Tabel harga_pangan_referensi menyimpan SATU baris per (komoditas, tanggal)
// dan baris lama tidak pernah ditimpa (lihat sql/harga_pangan_referensi.sql)
// -- jadi histori tren sebenarnya sudah terkumpul otomatis sejak modul ini
// dipakai, tinggal ditarik. Dipakai untuk 2 hal: (1) indikator naik/turun
// %-vs-hari-sebelumnya di tabel utama, (2) grafik tren per komoditas.
//
// Map<slug, [{date, price}, ...]> terurut tanggal ASCENDING. null selama
// belum pernah ditarik di sesi ini (beda dari Map kosong -- dipakai buat
// bedakan "belum coba" vs "sudah coba, hasilnya kosong").
window._hargaPanganHistory = null;

// Tarik histori N hari terakhir untuk SEMUA komoditas auto sekaligus (1
// request, bukan per-komoditas) -- cukup untuk isi indikator %-perubahan
// DAN data grafik tren, jadi dipanggil sekali saja tiap modal dibuka.
// Komoditas manual (Gas Melon dll) dilewati: tidak ada histori BI untuk
// itu, dan harga manual memang cuma 1 titik (harga saat ini), bukan seri.
window.fetchHargaPanganHistory = async function(days) {
    const history = new Map();
    if (!window.isOnline || !window.isOnline() || typeof window.callSupabaseAPI !== 'function' || !window.getCloudUrl || !window.getCloudUrl()) {
        window._hargaPanganHistory = history;
        return history;
    }
    const autoSlugs = window.HARGA_PANGAN_COMMODITIES.filter(function(c) { return !c.manual; }).map(function(c) { return c.slug; });
    const since = new Date();
    since.setDate(since.getDate() - (days || 30));
    const sinceStr = since.getFullYear() + '-' + String(since.getMonth() + 1).padStart(2, '0') + '-' + String(since.getDate()).padStart(2, '0');
    try {
        const rows = await window.callSupabaseAPI(
            'harga_pangan_referensi', 'GET', null,
            '?select=commodity_slug,price,price_date&price_date=gte.' + sinceStr +
            '&commodity_slug=in.(' + autoSlugs.join(',') + ')&order=price_date.asc'
        );
        (rows || []).forEach(function(r) {
            if (!history.has(r.commodity_slug)) history.set(r.commodity_slug, []);
            history.get(r.commodity_slug).push({ date: r.price_date, price: Number(r.price) });
        });
    } catch (e) {
        console.warn('[HargaPangan] Gagal ambil histori:', e.message);
    }
    window._hargaPanganHistory = history;
    return history;
};

// Hitung persentase perubahan harga TERBARU vs titik sebelumnya di histori
// (bukan selalu "kemarin" persis -- kalau ada hari libur/gagal-tarik BI di
// tengah, titik sebelumnya bisa beberapa hari sebelumnya; itu tetap valid
// secara historis, cuma labelnya digeneralisasi jadi "vs sebelumnya").
// Return null kalau histori < 2 titik (belum bisa dibandingkan).
function _hkPctChange(slug) {
    const series = window._hargaPanganHistory && window._hargaPanganHistory.get(slug);
    if (!series || series.length < 2) return null;
    const latest = series[series.length - 1];
    const prev = series[series.length - 2];
    if (!prev.price) return null;
    return { pct: ((latest.price - prev.price) / prev.price) * 100, prevDate: prev.date };
}

// ==================== MODAL "HARGA KOMODITAS" ====================
// Halaman sidebar baru yang menampilkan SEMUA komoditas yang ditrack:
// grup "otomatis" (dari BI, read-only) dan grup "manual" (Gas Melon,
// Token Listrik -- user isi sendiri via modal edit kecil).
window.openHargaKomoditasModal = async function() {
    await Promise.all([
        window.prefetchHargaPanganReferensi(),
        window.fetchHargaPanganHistory(30)
    ]);
    window.renderHargaKomoditasModal();
    window.openModal('hargaKomoditasModal');
};

// Paksa tarik ulang harga BI walau cache lokal (6 jam) belum kadaluarsa --
// dipicu tombol "Segarkan dari BI". Harga manual TIDAK ikut ke-reset di
// sini (dibaca ulang dari HK_MANUAL_KEY, bukan HP_CACHE_KEY).
window.refreshHargaKomoditas = async function() {
    try { localStorage.removeItem(HP_CACHE_KEY); } catch { /* tidak fatal */ }
    window._hargaPanganCache = null;
    await Promise.all([
        window.prefetchHargaPanganReferensi(),
        window.fetchHargaPanganHistory(30)
    ]);
    window.renderHargaKomoditasModal();
};

window.renderHargaKomoditasModal = function() {
    const autoBody = document.getElementById('hkAutoTableBody');
    const manualBody = document.getElementById('hkManualTableBody');
    const autoUpdateInfo = document.getElementById('hkAutoUpdateInfo');
    if (!autoBody || !manualBody) return;
    const cache = window._hargaPanganCache || new Map();

    // [SEMBUNYIKAN KOSONG] Komoditas auto yang belum berhasil ditarik dari
    // SISKAPERBAPO maupun BI (mis. lagi 403/diblokir Cloudflare, atau
    // memang tidak ada padanan di BI -- lihat SLUG_TO_BI_ID) disembunyikan
    // dari tabel/kartu daripada tampil sebagai baris "Belum ada data" yang
    // membingungkan. Filter ini jalan tiap render, jadi begitu cache-nya
    // terisi (prefetch berikutnya berhasil), barisnya otomatis muncul lagi
    // tanpa perlu logic tambahan. Baris manual TIDAK ikut disembunyikan --
    // itu tempat user input harga pertama kali lewat tombol "Ubah", jadi
    // harus tetap terlihat walau belum ada data.
    const autoRows = window.HARGA_PANGAN_COMMODITIES.filter(function(c) { return !c.manual && cache.has(c.slug); });
    const manualRows = window.HARGA_PANGAN_COMMODITIES.filter(function(c) { return c.manual; });

    // Baris auto (BI) semuanya ditarik dalam 1 batch yang sama, jadi
    // tanggalnya praktis selalu sama antar komoditas -- tidak perlu kolom
    // "Update" per baris, cukup 1 ringkasan di atas tabel. Ambil tanggal
    // TERBARU yang ada di antara komoditas auto (kalau ada yang beda,
    // misal 1 komoditas gagal ditarik BI hari ini & masih pakai cache lama).
    let latestAutoDate = null;
    autoRows.forEach(function(c) {
        const hit = cache.get(c.slug);
        if (hit && hit.date && (!latestAutoDate || hit.date > latestAutoDate)) latestAutoDate = hit.date;
    });
    if (autoUpdateInfo) {
        autoUpdateInfo.textContent = latestAutoDate
            ? ('Update terakhir: ' + latestAutoDate)
            : 'Update terakhir: belum ada data';
    }

    const renderAutoRow = function(c) {
        const hit = cache.get(c.slug);
        const price = hit ? window.rp(hit.price) : '<span style="color:var(--text-secondary)">Belum ada data</span>';
        // [WILAYAH] Kalau harga sudah ada tapi region tidak tercatat (mis.
        // data ini datang dari cache Supabase yang memang tidak menyimpan
        // kolom region -- lihat catatan di prefetchHargaPanganReferensi),
        // anggap level Nasional: itu fallback terakhir & selalu berhasil
        // di api/harga-pangan.js kalau level Kabupaten/Provinsi gagal.
        const region = hit ? (hit.region ? window.escapeHtml(hit.region) : 'Nasional') : '-';

        // [TREN] Perubahan %-vs-titik-sebelumnya, dari histori 30 hari yang
        // ditarik bareng di window.openHargaKomoditasModal. '-' kalau
        // histori belum ada/kurang dari 2 titik (mis. baru pertama kali
        // fitur ini dipakai, atau offline saat modal dibuka).
        const change = _hkPctChange(c.slug);
        let changeHtml = '<span style="color:var(--text-secondary)">-</span>';
        if (change) {
            const up = change.pct > 0;
            const flat = Math.abs(change.pct) < 0.05;
            const color = flat ? 'var(--text-secondary)' : (up ? 'var(--danger)' : 'var(--success)');
            const arrow = flat ? '' : (up ? '\u25B2 ' : '\u25BC ');
            changeHtml = '<span style="color:' + color + '">' + arrow + Math.abs(change.pct).toFixed(1) + '%</span>';
        }
        const hasHistory = window._hargaPanganHistory && (window._hargaPanganHistory.get(c.slug) || []).length >= 2;
        const trendBtn = hasHistory
            ? '<button type="button" class="btn btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="window.openHargaKomoditasTrend(\'' + c.slug + '\')">Tren</button>'
            : '<span style="color:var(--text-secondary)">-</span>';

        return '<tr><td>' + window.escapeHtml(c.name) + '</td><td>' + window.escapeHtml(c.unit) + '</td><td>' + price + '</td><td>' + region + '</td><td>' + changeHtml + '</td><td class="col-action">' + trendBtn + '</td></tr>';
    };

    const renderManualRow = function(c) {
        const hit = cache.get(c.slug);
        const price = hit ? window.rp(hit.price) : '<span style="color:var(--text-secondary)">Belum ada data</span>';
        const date = hit ? window.escapeHtml(hit.date) : '-';
        return '<tr><td>' + window.escapeHtml(c.name) + '</td><td>' + window.escapeHtml(c.unit) + '</td><td>' + price + '</td><td>' + date + '</td>' +
            '<td class="col-action"><button type="button" class="btn btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="window.openEditHargaKomoditasManual(\'' + c.slug + '\')">Ubah</button></td></tr>';
    };

    // [KARTU MOBILE] Versi non-tabel untuk layar sempit (lihat .hk-card-list
    // di css/style.css) -- kolom "Wilayah" sengaja TIDAK ditampilkan di sini
    // (hampir selalu "Nasional", kurang penting) supaya kolom "Tren" yang
    // sebelumnya kepotong di luar layar (butuh scroll horizontal tabel)
    // sekarang langsung terlihat tanpa scroll.
    // Sparkline SVG ringan dari histori 30 hari (window._hargaPanganHistory)
    // -- dipilih dibanding Chart.js/canvas supaya tidak berat me-render
    // banyak grafik sekaligus (1 per kartu) di kartu-kartu hape. w/h dibuat
    // parameter supaya bisa dipakai versi kecil (sebaris dgn harga) di sini.
    const _hkSparklineSvg = function(series, color, w, h) {
        w = w || 280; h = h || 44;
        const prices = series.map(function(p) { return p.price; });
        const pad = 2;
        const min = Math.min.apply(null, prices);
        const max = Math.max.apply(null, prices);
        const range = (max - min) || 1;
        const stepX = prices.length > 1 ? (w - pad * 2) / (prices.length - 1) : 0;
        const pts = prices.map(function(price, i) {
            const x = pad + i * stepX;
            const y = pad + (1 - (price - min) / range) * (h - pad * 2);
            return x.toFixed(1) + ',' + y.toFixed(1);
        });
        const linePath = 'M' + pts.join(' L');
        const lastX = (pad + (prices.length - 1) * stepX).toFixed(1);
        const areaPath = linePath + ' L' + lastX + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';
        return '<svg class="hk-card-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
            '<path d="' + areaPath + '" fill="' + color + '" opacity="0.12" stroke="none"></path>' +
            '<path d="' + linePath + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
            '</svg>';
    };

    const renderAutoCard = function(c) {
        const hit = cache.get(c.slug);
        const priceHtml = hit
            ? ('<span class="hk-card-price">' + window.rp(hit.price) + '</span><span class="hk-card-unit">/ ' + window.escapeHtml(c.unit) + '</span>')
            : '<span style="color:var(--ink-faint);font-size:.75rem;">Belum ada data</span>';

        const change = _hkPctChange(c.slug);
        let changeColor = 'var(--ink-faint)';
        let changeHtml = '<span class="hk-card-change" style="color:var(--ink-faint);">-</span>';
        if (change) {
            const up = change.pct > 0;
            const flat = Math.abs(change.pct) < 0.05;
            changeColor = flat ? 'var(--ink-faint)' : (up ? 'var(--danger)' : 'var(--success)');
            const arrow = flat ? '' : (up ? '\u25B2 ' : '\u25BC ');
            changeHtml = '<span class="hk-card-change" style="color:' + changeColor + '">' + arrow + Math.abs(change.pct).toFixed(1) + '%</span>';
        }

        const series = window._hargaPanganHistory && window._hargaPanganHistory.get(c.slug);
        const hasHistory = series && series.length >= 2;
        const sparkHtml = hasHistory
            ? '<button type="button" class="hk-card-spark-btn" onclick="window.openHargaKomoditasTrend(\'' + c.slug + '\')" aria-label="Lihat detail tren ' + window.escapeHtml(c.name) + '">' + _hkSparklineSvg(series, changeColor, 60, 26) + '</button>'
            : '<span class="hk-card-spark-empty">-</span>';

        // Urutan: nama komoditas (baris sendiri) -> harga -> indikator
        // naik/turun -> sparkline mini nempel di ujung kanan baris yang sama.
        return '<div class="hk-card">' +
            '<span class="hk-card-name">' + window.escapeHtml(c.name) + '</span>' +
            '<div class="hk-card-bottom-row">' + priceHtml + changeHtml + sparkHtml + '</div>' +
            '</div>';
    };

    const renderManualCard = function(c) {
        const hit = cache.get(c.slug);
        const priceHtml = hit
            ? ('<span class="hk-card-price">' + window.rp(hit.price) + '</span><span class="hk-card-unit">/ ' + window.escapeHtml(c.unit) + '</span>')
            : '<span style="color:var(--ink-faint);font-size:.75rem;">Belum ada data</span>';
        const dateHtml = hit ? ('<span class="hk-card-meta">Update: ' + window.escapeHtml(hit.date) + '</span>') : '';

        return '<div class="hk-card">' +
            '<div class="hk-card-top"><span class="hk-card-name">' + window.escapeHtml(c.name) + '</span>' +
            '<button type="button" class="btn btn-secondary hk-card-trend-btn" onclick="window.openEditHargaKomoditasManual(\'' + c.slug + '\')">Ubah</button></div>' +
            '<div class="hk-card-price-row">' + priceHtml + '</div>' +
            dateHtml +
            '</div>';
    };

    const autoCardList = document.getElementById('hkAutoCardList');
    const manualCardList = document.getElementById('hkManualCardList');

    autoBody.innerHTML = autoRows.map(renderAutoRow).join('') || '<tr><td colspan="6">Tidak ada data.</td></tr>';
    manualBody.innerHTML = manualRows.map(renderManualRow).join('') || '<tr><td colspan="5">Tidak ada data.</td></tr>';
    if (autoCardList) autoCardList.innerHTML = autoRows.map(renderAutoCard).join('') || '<div style="font-size:.75rem;color:var(--ink-faint);">Tidak ada data.</div>';
    if (manualCardList) manualCardList.innerHTML = manualRows.map(renderManualCard).join('') || '<div style="font-size:.75rem;color:var(--ink-faint);">Tidak ada data.</div>';
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

// ==================== MODAL "TREN HARGA" (grafik per komoditas) ====================
// Dipicu tombol "Tren" di baris auto. Pakai data yang SUDAH ditarik di
// window._hargaPanganHistory (tidak request ulang) -- 1 fetch histori per
// buka modal Harga Komoditas sudah cukup untuk semua komoditas.
window._hkTrendChart = null;

window.openHargaKomoditasTrend = function(slug) {
    const meta = window.HARGA_PANGAN_COMMODITIES.find(function(c) { return c.slug === slug; });
    const series = window._hargaPanganHistory && window._hargaPanganHistory.get(slug);
    if (!meta || !series || series.length < 2) return;

    document.getElementById('hkTrendTitle').textContent = 'Tren ' + meta.name + ' (30 hari)';
    window.openModal('hkTrendModal');
    window.renderHargaKomoditasTrendChart(meta, series);
};

window.renderHargaKomoditasTrendChart = function(meta, series) {
    const body = document.getElementById('hkTrendChartBody');
    if (!body) return;

    // [PERF] Sama seperti js/expense-chart.js: Chart.js dimuat lazy sekali
    // saja lewat window.loadScriptOnce, bukan <script defer> statis.
    if (typeof Chart === 'undefined') {
        body.innerHTML = '<div class="expense-chart-empty">Memuat grafik…</div>';
        window.loadScriptOnce(window.CHART_JS_URL).then(function() {
            window.renderHargaKomoditasTrendChart(meta, series);
        }).catch(function(err) {
            console.error('[HargaKomoditas] Gagal memuat chart.js:', err);
            body.innerHTML = '<div class="expense-chart-empty">Gagal memuat grafik. Periksa koneksi internet.</div>';
        });
        return;
    }

    body.innerHTML = '<div class="hk-trend-canvas-wrap"><canvas id="hkTrendCanvas"></canvas></div>';
    const ctx = document.getElementById('hkTrendCanvas');
    if (window._hkTrendChart) { window._hkTrendChart.destroy(); window._hkTrendChart = null; }

    window._hkTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: series.map(function(p) { return p.date; }),
            datasets: [{
                label: meta.name + ' (Rp/' + meta.unit + ')',
                data: series.map(function(p) { return p.price; }),
                borderColor: '#2E5C82',
                backgroundColor: 'rgba(46, 92, 130, 0.12)',
                fill: true,
                tension: 0.15,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    ticks: { callback: function(value) { return window.rp(value); } }
                }
            }
        }
    });
};
