// ==================== ESTIMASI GIZI (DAFTAR MENU) ====================
// Menghitung perkiraan kalori/protein/karbohidrat/lemak dari bahan-bahan
// yang sudah diisi di Daftar Menu (js/menu-plan.js), dengan 2 sumber data:
//
// 1) BASIS DATA LOKAL (window.NUTRISI_REFERENSI) -- nilai gizi per 100 gram
//    untuk bahan MENTAH umum (beras, ayam, telur, sayur, dst), dicocokkan ke
//    nama bahan lewat keyword (pola sama persis dengan
//    window.matchHargaPanganCommodity di js/harga-pangan.js). Dipakai
//    duluan karena nama bahan di sini bahasa Indonesia dan sebagian besar
//    API gizi publik gratis berbasis produk kemasan berbahasa Inggris --
//    hasilnya jauh lebih akurat & instan (tanpa perlu koneksi internet).
//
// 2) API GRATIS OPEN FOOD FACTS (world.openfoodfacts.org, tanpa API key,
//    CORS diizinkan langsung dari browser) -- dipakai sebagai FALLBACK
//    untuk bahan yang tidak ketemu di basis data lokal, terutama produk
//    kemasan/bermerek (kecap manis, susu kental manis, mie instan merek
//    tertentu, dst) yang memang cocoknya dicari di database produk seperti
//    ini. Hasil query di-cache di localStorage (window._nutrisiOffCache)
//    supaya tidak berulang kali hit API yang sama.
//
// Estimasi ini SELALU perkiraan kasar (basis data umum per 100 gram +
// konversi satuan yang disederhanakan di window._nutrisiUnitToGram) --
// bukan pengganti label gizi asli/ahli gizi, sudah dijelaskan lewat catatan
// di UI (lihat window.renderMenuPlanGizi, dipanggil dari js/menu-plan.js).

window.NUTRISI_REFERENSI = [
    // -- Karbohidrat pokok --
    { name: 'Beras', keywords: ['beras'], kalori: 360, protein: 6.8, karbo: 78.9, lemak: 0.7 },
    { name: 'Nasi', keywords: ['nasi'], kalori: 130, protein: 2.7, karbo: 28.2, lemak: 0.3 },
    { name: 'Mie Instan', keywords: ['indomie', 'mie instan', 'mi instan', 'mie telur', 'mie'], kalori: 440, protein: 9.5, karbo: 63, lemak: 17 },
    { name: 'Tepung Terigu', keywords: ['tepung terigu', 'terigu', 'tepung'], kalori: 364, protein: 9, karbo: 76.3, lemak: 1 },
    { name: 'Roti Tawar', keywords: ['roti'], kalori: 265, protein: 9, karbo: 49, lemak: 3.3 },
    { name: 'Kentang', keywords: ['kentang'], kalori: 77, protein: 2, karbo: 17.5, lemak: 0.1 },
    { name: 'Jagung Pipilan', keywords: ['jagung'], kalori: 361, protein: 9.8, karbo: 73, lemak: 4.5 },

    // -- Protein hewani --
    { name: 'Daging Ayam', keywords: ['ayam'], kalori: 215, protein: 18.2, karbo: 0, lemak: 15 },
    { name: 'Daging Sapi', keywords: ['sapi'], kalori: 207, protein: 18.8, karbo: 0, lemak: 14 },
    { name: 'Daging Kambing', keywords: ['kambing'], kalori: 154, protein: 16.6, karbo: 0, lemak: 9.2 },
    { name: 'Telur Ayam', keywords: ['telur'], kalori: 155, protein: 12.6, karbo: 1.1, lemak: 10.6 },
    { name: 'Ikan Bandeng', keywords: ['bandeng'], kalori: 129, protein: 20, karbo: 0, lemak: 4.8 },
    { name: 'Ikan Kembung', keywords: ['kembung'], kalori: 112, protein: 21.4, karbo: 0, lemak: 2.5 },
    { name: 'Ikan Tuna', keywords: ['tuna'], kalori: 116, protein: 25.5, karbo: 0, lemak: 1 },
    { name: 'Ikan Tongkol', keywords: ['tongkol'], kalori: 111, protein: 24, karbo: 0, lemak: 1 },
    { name: 'Ikan Cakalang', keywords: ['cakalang'], kalori: 108, protein: 24, karbo: 0, lemak: 1 },
    { name: 'Ikan Lele', keywords: ['lele'], kalori: 105, protein: 17, karbo: 0, lemak: 3.5 },
    { name: 'Ikan Nila', keywords: ['nila'], kalori: 96, protein: 20, karbo: 0, lemak: 1.7 },
    { name: 'Ikan Asin/Teri', keywords: ['ikan asin', 'teri'], kalori: 200, protein: 33, karbo: 0, lemak: 4 },
    { name: 'Udang', keywords: ['udang'], kalori: 106, protein: 20.3, karbo: 0.9, lemak: 1.7 },
    { name: 'Cumi-cumi', keywords: ['cumi'], kalori: 92, protein: 15.6, karbo: 3.1, lemak: 1.4 },
    { name: 'Bakso', keywords: ['bakso'], kalori: 180, protein: 9, karbo: 6, lemak: 14 },
    { name: 'Sosis', keywords: ['sosis'], kalori: 300, protein: 12, karbo: 3, lemak: 27 },

    // -- Protein nabati --
    { name: 'Tahu', keywords: ['tahu'], kalori: 76, protein: 8, karbo: 1.9, lemak: 4.8 },
    { name: 'Tempe', keywords: ['tempe'], kalori: 193, protein: 18.3, karbo: 12.7, lemak: 8.8 },
    { name: 'Kedelai', keywords: ['kedelai', 'kedelei'], kalori: 381, protein: 34.9, karbo: 30.1, lemak: 17.7 },
    { name: 'Kacang Hijau', keywords: ['kacang hijau'], kalori: 347, protein: 22.2, karbo: 62.9, lemak: 1.2 },
    { name: 'Kacang Tanah', keywords: ['kacang tanah'], kalori: 567, protein: 25.8, karbo: 16.1, lemak: 49.2 },
    { name: 'Kacang Merah', keywords: ['kacang merah'], kalori: 333, protein: 23.1, karbo: 59.6, lemak: 1.5 },

    // -- Sayuran --
    { name: 'Bayam', keywords: ['bayam'], kalori: 23, protein: 2.9, karbo: 3.6, lemak: 0.4 },
    { name: 'Kangkung', keywords: ['kangkung'], kalori: 19, protein: 3, karbo: 3.1, lemak: 0.2 },
    { name: 'Kol/Kubis', keywords: ['kol', 'kubis'], kalori: 25, protein: 1.3, karbo: 5.8, lemak: 0.1 },
    { name: 'Sawi', keywords: ['sawi', 'caisim', 'pokcoy', 'pakcoy'], kalori: 22, protein: 2.3, karbo: 3.9, lemak: 0.3 },
    { name: 'Tomat', keywords: ['tomat'], kalori: 18, protein: 0.9, karbo: 3.9, lemak: 0.2 },
    { name: 'Wortel', keywords: ['wortel'], kalori: 41, protein: 0.9, karbo: 9.6, lemak: 0.2 },
    { name: 'Buncis', keywords: ['buncis'], kalori: 31, protein: 1.8, karbo: 7, lemak: 0.1 },
    { name: 'Timun', keywords: ['timun', 'mentimun'], kalori: 15, protein: 0.7, karbo: 3.6, lemak: 0.1 },
    { name: 'Terong', keywords: ['terong'], kalori: 24, protein: 1, karbo: 5.7, lemak: 0.2 },
    { name: 'Labu Siam', keywords: ['labu siam'], kalori: 19, protein: 0.6, karbo: 4.5, lemak: 0.1 },
    { name: 'Toge/Kecambah', keywords: ['toge', 'tauge', 'kecambah'], kalori: 30, protein: 3.1, karbo: 5.9, lemak: 0.2 },
    { name: 'Daun Bawang/Seledri', keywords: ['daun bawang', 'seledri'], kalori: 22, protein: 1.5, karbo: 4.7, lemak: 0.2 },
    { name: 'Jamur', keywords: ['jamur'], kalori: 22, protein: 3.1, karbo: 3.3, lemak: 0.3 },

    // -- Bumbu & pelengkap --
    { name: 'Bawang Merah', keywords: ['bawang merah'], kalori: 39, protein: 1.5, karbo: 9.2, lemak: 0.1 },
    { name: 'Bawang Putih', keywords: ['bawang putih'], kalori: 149, protein: 6.4, karbo: 33, lemak: 0.5 },
    { name: 'Cabai Rawit', keywords: ['cabe rawit', 'cabai rawit'], kalori: 40, protein: 2, karbo: 7, lemak: 0.4 },
    { name: 'Cabai Merah', keywords: ['cabe merah', 'cabai merah', 'cabe keriting', 'cabai keriting'], kalori: 32, protein: 1.9, karbo: 7.3, lemak: 0.4 },
    { name: 'Jahe/Kunyit/Lengkuas', keywords: ['jahe', 'kunyit', 'lengkuas', 'kencur'], kalori: 80, protein: 1.8, karbo: 17.8, lemak: 0.8 },
    { name: 'Kemiri', keywords: ['kemiri'], kalori: 636, protein: 8.4, karbo: 8.4, lemak: 63.9 },
    { name: 'Santan', keywords: ['santan'], kalori: 230, protein: 2.3, karbo: 5.5, lemak: 23.8 },
    { name: 'Kecap Manis', keywords: ['kecap'], kalori: 130, protein: 3, karbo: 27, lemak: 0 },
    { name: 'Saus Sambal/Tomat', keywords: ['saus'], kalori: 100, protein: 1.5, karbo: 23, lemak: 0.3 },
    { name: 'Minyak Goreng', keywords: ['minyak goreng', 'minyak curah', 'minyak kemasan'], kalori: 884, protein: 0, karbo: 0, lemak: 100 },
    { name: 'Margarin/Mentega', keywords: ['margarin', 'mentega'], kalori: 720, protein: 0.5, karbo: 0.5, lemak: 80 },
    { name: 'Gula Pasir', keywords: ['gula'], kalori: 387, protein: 0, karbo: 100, lemak: 0 },
    { name: 'Garam', keywords: ['garam'], kalori: 0, protein: 0, karbo: 0, lemak: 0 },

    // -- Susu & buah --
    { name: 'Susu Kental Manis', keywords: ['kental manis', 'skm'], kalori: 321, protein: 7.9, karbo: 54.4, lemak: 8.7 },
    { name: 'Susu Bubuk', keywords: ['susu bubuk'], kalori: 502, protein: 24.6, karbo: 39.4, lemak: 26.7 },
    { name: 'Susu Cair', keywords: ['susu cair', 'susu segar', 'susu uht', 'susu'], kalori: 61, protein: 3.2, karbo: 4.8, lemak: 3.3 },
    { name: 'Pisang', keywords: ['pisang'], kalori: 89, protein: 1.1, karbo: 22.8, lemak: 0.3 },
    { name: 'Apel', keywords: ['apel'], kalori: 52, protein: 0.3, karbo: 13.8, lemak: 0.2 },
    { name: 'Jeruk', keywords: ['jeruk'], kalori: 47, protein: 0.9, karbo: 11.8, lemak: 0.1 },
    { name: 'Pepaya', keywords: ['pepaya'], kalori: 43, protein: 0.5, karbo: 10.8, lemak: 0.3 },
    { name: 'Semangka', keywords: ['semangka'], kalori: 30, protein: 0.6, karbo: 7.6, lemak: 0.2 },
];

// Konversi kasar satuan bahan (window.MENU_PLAN_UNITS di js/menu-plan.js) ke
// gram, supaya bisa dikalikan dengan nilai gizi per-100-gram di atas. Ini
// PERKIRAAN KASAR (mis. "1 butir" diasumsikan ~telur ukuran sedang), bukan
// takaran presisi -- 'dus' & 'secukupnya' sengaja tidak dikonversi (return
// null) karena beratnya terlalu bervariasi untuk ditebak.
window._nutrisiUnitToGram = function(qty, unit) {
    const q = Number(qty) || 0;
    const u = (unit || '').trim().toLowerCase();
    const GRAM_PER_UNIT = {
        kg: 1000, gram: 1, liter: 1000, ml: 1,
        butir: 55, buah: 100, ikat: 100, siung: 5,
        bungkus: 80, kaleng: 385, sdm: 15, sdt: 5
    };
    if (!(u in GRAM_PER_UNIT)) return null;
    return q * GRAM_PER_UNIT[u];
};

// Cocokkan nama bahan ke basis data gizi lokal (pola sama seperti
// window.matchHargaPanganCommodity).
window._nutrisiMatchLocal = function(name) {
    if (!name) return null;
    const normalized = String(name).toLowerCase();
    return window.NUTRISI_REFERENSI.find(function(e) {
        return e.keywords.some(function(kw) { return normalized.includes(kw); });
    }) || null;
};

// ==================== FALLBACK: API GRATIS OPEN FOOD FACTS ====================
// Tanpa API key, CORS diizinkan -- cocok untuk dipanggil langsung dari
// browser. Paling berguna untuk produk kemasan/bermerek yang tidak ada di
// basis data lokal di atas.
const NUTRISI_OFF_CACHE_KEY = 'sk_nutrisi_off_cache_v1';

window._nutrisiOffCache = null; // Map<namaLower, entry|'notfound'> -- null = belum dimuat dari localStorage

window._nutrisiReadOffCache = function() {
    try {
        const raw = localStorage.getItem(NUTRISI_OFF_CACHE_KEY);
        if (!raw) return new Map();
        return new Map(Object.entries(JSON.parse(raw)));
    } catch { return new Map(); }
};
window._nutrisiWriteOffCache = function(map) {
    try { localStorage.setItem(NUTRISI_OFF_CACHE_KEY, JSON.stringify(Object.fromEntries(map))); } catch { /* localStorage penuh/disabled -- abaikan */ }
};

// Ambil data gizi 1 nama bahan dari Open Food Facts. Selalu cek cache lokal
// dulu (termasuk cache "notfound" supaya tidak query ulang bahan yang
// memang tidak ketemu). Return null kalau tidak ketemu/gagal.
window._nutrisiFetchOFF = async function(name) {
    if (!window._nutrisiOffCache) window._nutrisiOffCache = window._nutrisiReadOffCache();
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;
    if (window._nutrisiOffCache.has(key)) {
        const cached = window._nutrisiOffCache.get(key);
        return cached === 'notfound' ? null : cached;
    }
    if (!window.isOnline || !window.isOnline()) return null;
    try {
        const url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(name) +
            '&search_simple=1&action=process&json=1&page_size=1&fields=product_name,nutriments';
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error('status ' + res.status);
        const json = await res.json();
        const product = (json.products || [])[0];
        let entry = null;
        if (product && product.nutriments) {
            const n = product.nutriments;
            const kalori = n['energy-kcal_100g'];
            if (kalori !== undefined && kalori !== null) {
                entry = {
                    kalori: Number(kalori) || 0,
                    protein: Number(n['proteins_100g']) || 0,
                    karbo: Number(n['carbohydrates_100g']) || 0,
                    lemak: Number(n['fat_100g']) || 0,
                    label: product.product_name || name,
                    source: 'off'
                };
            }
        }
        window._nutrisiOffCache.set(key, entry || 'notfound');
        window._nutrisiWriteOffCache(window._nutrisiOffCache);
        return entry;
    } catch (e) {
        window.skWarn && window.skWarn('[Nutrisi] Gagal ambil data dari Open Food Facts:', e.message);
        return null;
    }
};

// Panggil sekali tiap Daftar Menu dibuka/pindah minggu (lihat js/menu-plan.js)
// -- cari data OFF untuk semua bahan minggu itu yang TIDAK ketemu di basis
// data lokal, satu per satu (bukan Promise.all) supaya tidak membanjiri API
// publik gratis ini dengan request paralel.
window.prefetchNutrisiOFFUntukMenuPlan = async function(weekData) {
    if (!weekData || !window.isOnline || !window.isOnline()) return;
    if (!window._nutrisiOffCache) window._nutrisiOffCache = window._nutrisiReadOffCache();
    const aggregated = window.aggregateMenuPlanBahan(weekData);
    for (const item of aggregated) {
        if (window._nutrisiMatchLocal(item.name)) continue; // sudah ada di basis data lokal, tidak perlu API
        const key = item.name.trim().toLowerCase();
        if (window._nutrisiOffCache.has(key)) continue; // sudah pernah dicoba (ketemu ataupun tidak)
        await window._nutrisiFetchOFF(item.name);
    }
};

// ==================== HITUNG & RENDER ====================

// Estimasi gizi 1 bahan (nama + qty + satuan) -- basis data lokal duluan,
// baru cache Open Food Facts (TIDAK memicu fetch baru di sini, cuma baca
// cache yang sudah ada -- fetch dilakukan terpisah lewat
// window.prefetchNutrisiOFFUntukMenuPlan supaya render tetap sinkron/cepat).
window._mplanEstimateNutrisiIngredient = function(name, qty, unit) {
    const grams = window._nutrisiUnitToGram(qty, unit);
    let ref = window._nutrisiMatchLocal(name);
    let source = ref ? 'local' : null;
    if (!ref) {
        const key = String(name || '').trim().toLowerCase();
        const cached = window._nutrisiOffCache && window._nutrisiOffCache.get(key);
        if (cached && cached !== 'notfound') { ref = cached; source = 'off'; }
    }
    if (!ref) return { matched: false, hasGrams: grams !== null };
    if (grams === null) return { matched: true, hasGrams: false, source: source };
    const factor = grams / 100;
    return {
        matched: true, hasGrams: true, source: source,
        kalori: ref.kalori * factor,
        protein: ref.protein * factor,
        karbo: ref.karbo * factor,
        lemak: ref.lemak * factor
    };
};

// Jumlahkan gizi seluruh bahan dalam satu minggu (dari
// window.aggregateMenuPlanBahan yang sudah menggabungkan qty bahan sama).
window.aggregateMenuPlanNutrisi = function(weekData) {
    const aggregated = window.aggregateMenuPlanBahan(weekData);
    let totalKalori = 0, totalProtein = 0, totalKarbo = 0, totalLemak = 0, unmatchedCount = 0;
    const rows = aggregated.map(function(item) {
        const est = window._mplanEstimateNutrisiIngredient(item.name, item.qty, item.unit);
        if (est.matched && est.hasGrams) {
            totalKalori += est.kalori;
            totalProtein += est.protein;
            totalKarbo += est.karbo;
            totalLemak += est.lemak;
        } else {
            unmatchedCount++;
        }
        return Object.assign({}, item, est);
    });
    return { rows: rows, totalKalori: totalKalori, totalProtein: totalProtein, totalKarbo: totalKarbo, totalLemak: totalLemak, unmatchedCount: unmatchedCount };
};

// Render kartu "Estimasi Gizi Mingguan" di halaman Daftar Menu (markup di
// index.html, SEKARANG DI ATAS -- sebelum tab minggu & jadwal 7 hari,
// bukan lagi di bawah kartu Estimasi Belanja). Dipanggil dari
// window.renderMenuPlan (js/menu-plan.js) tiap kali halaman/minggu aktif
// berubah, dan lagi setelah window.prefetchNutrisiOFFUntukMenuPlan selesai.
window.renderMenuPlanGizi = function(weekData, weekKey) {
    const listEl = document.getElementById('mplanGiziList');
    if (!listEl) return; // markup belum tersedia di versi index.html ini

    const activeWeek = weekKey || window._mplanActiveWeek || 'w1';
    weekData = weekData || window.getMenuPlan(window.currentBookId)[activeWeek];
    const result = window.aggregateMenuPlanNutrisi(weekData);

    const emptyEl = document.getElementById('mplanGiziEmpty');
    const kaloriEl = document.getElementById('mplanGiziKalori');
    const macrosEl = document.getElementById('mplanGiziMacros');
    const noteEl = document.getElementById('mplanGiziNote');
    const labelEl = document.getElementById('mplanGiziHeaderLabel');
    const detailsEl = document.getElementById('mplanGiziDetails');

    if (labelEl) {
        const weekMeta = window.MENU_PLAN_WEEKS.find(function(w) { return w.key === activeWeek; });
        labelEl.innerText = `Estimasi Gizi ${weekMeta ? weekMeta.label : 'Mingguan'}`;
    }

    if (!result.rows.length) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
        if (kaloriEl) kaloriEl.innerText = '0 kkal';
        if (macrosEl) macrosEl.innerHTML = '';
        if (noteEl) noteEl.innerText = '';
        // [RAPI] Sembunyikan toggle "Rincian gizi per bahan" total kalau
        // memang belum ada bahan sama sekali -- tidak ada gunanya buka
        // rincian kosong.
        if (detailsEl) detailsEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (detailsEl) detailsEl.style.display = '';
    if (kaloriEl) kaloriEl.innerText = Math.round(result.totalKalori).toLocaleString('id-ID') + ' kkal';
    if (macrosEl) {
        macrosEl.innerHTML = [
            { label: 'Protein', val: result.totalProtein },
            { label: 'Karbohidrat', val: result.totalKarbo },
            { label: 'Lemak', val: result.totalLemak }
        ].map(function(m) {
            return `<span class="mplan-gizi-chip"><b>${Math.round(m.val).toLocaleString('id-ID')} g</b> ${m.label}</span>`;
        }).join('');
    }
    listEl.innerHTML = result.rows.map(function(item) {
        let kaloriHtml = '<span class="mplan-estimate-price is-unknown">-</span>';
        if (item.matched && item.hasGrams) {
            kaloriHtml = `<span class="mplan-estimate-price is-ref-price">≈ ${Math.round(item.kalori).toLocaleString('id-ID')} kkal${item.source === 'off' ? '*' : ''}</span>`;
        } else if (item.matched && !item.hasGrams) {
            kaloriHtml = '<span class="mplan-estimate-price is-unknown" title="Satuan bahan ini belum bisa dikonversi ke gram secara otomatis.">satuan?</span>';
        }
        return `
            <div class="mplan-estimate-row">
                <span class="mplan-estimate-name">${window.escapeHtml(item.name)}</span>
                <span class="mplan-estimate-qty">${window._mplanFormatQty(item.qty)} ${window.escapeHtml(item.unit || '')}</span>
                ${kaloriHtml}
            </div>`;
    }).join('');
    if (noteEl) {
        noteEl.innerText = result.unmatchedCount
            ? `${result.unmatchedCount} bahan belum punya data gizi (belum dikenali atau satuannya belum bisa dikonversi ke gram) -- belum termasuk di angka di atas. Tanda * = data dari Open Food Facts, bukan basis data lokal. Semua angka gizi di sini perkiraan kasar per 100 gram, bukan pengganti label gizi resmi.`
            : 'Perkiraan kasar berdasarkan basis data gizi umum per 100 gram bahan -- bisa berbeda dari kondisi bahan sebenarnya.';
    }
};
