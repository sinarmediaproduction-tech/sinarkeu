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
// 2) API GRATIS OPEN FOOD FACTS, VIA PROXY /api/openfoodfacts.js -- dipakai
//    sebagai FALLBACK untuk bahan yang tidak ketemu di basis data lokal,
//    terutama produk kemasan/bermerek (kecap manis, susu kental manis, mie
//    instan merek tertentu, dst) yang memang cocoknya dicari di database
//    produk seperti ini. Hasil query di-cache di localStorage
//    (window._nutrisiOffCache) supaya tidak berulang kali hit API yang sama.
//    [BUG FIX - CORS] Sebelumnya fetch LANGSUNG dari browser ke Open Food
//    Facts (baik endpoint legacy cgi/search.pl -- sekarang konsisten balas
//    503 di server mereka, maupun API penggantinya search.openfoodfacts.org
//    -- ternyata juga tidak mengizinkan origin sinarkeu.vercel.app secara
//    langsung), keduanya muncul di console sebagai "blocked by CORS policy"
//    walau akar masalahnya beda-beda. Sekarang fallback ini lewat proxy
//    /api/openfoodfacts.js (server-to-server, lihat file itu untuk detail
//    & alasannya -- pola yang sama dengan api/harga-pangan.js & api/emas.js
//    untuk sumber data lain), supaya browser tidak pernah hit domain Open
//    Food Facts secara langsung.
//
// Estimasi ini SELALU perkiraan kasar (basis data umum per 100 gram +
// konversi satuan yang disederhanakan di window._nutrisiUnitToGram) --
// bukan pengganti label gizi asli/ahli gizi, sudah dijelaskan lewat catatan
// di UI (lihat window.renderMenuPlanGizi, dipanggil dari js/menu-plan.js).

window.NUTRISI_REFERENSI = [
    // -- Karbohidrat pokok --
    { name: 'Beras', keywords: ['beras'], kalori: 360, protein: 6.8, karbo: 78.9, lemak: 0.7, group: 'karbo'},
    { name: 'Nasi', keywords: ['nasi'], kalori: 130, protein: 2.7, karbo: 28.2, lemak: 0.3, group: 'karbo'},
    { name: 'Mie Instan', keywords: ['indomie', 'mie instan', 'mi instan', 'mie telur', 'mie'], kalori: 440, protein: 9.5, karbo: 63, lemak: 17, group: 'karbo'},
    { name: 'Tepung Terigu', keywords: ['tepung terigu', 'terigu', 'tepung'], kalori: 364, protein: 9, karbo: 76.3, lemak: 1, group: 'karbo'},
    { name: 'Roti Tawar', keywords: ['roti'], kalori: 265, protein: 9, karbo: 49, lemak: 3.3, group: 'karbo'},
    { name: 'Kentang', keywords: ['kentang'], kalori: 77, protein: 2, karbo: 17.5, lemak: 0.1, group: 'karbo'},
    { name: 'Jagung Pipilan', keywords: ['jagung'], kalori: 361, protein: 9.8, karbo: 73, lemak: 4.5, group: 'karbo'},

    // -- Protein hewani --
    { name: 'Daging Ayam', keywords: ['ayam'], kalori: 215, protein: 18.2, karbo: 0, lemak: 15, group: 'protein-hewani'},
    { name: 'Daging Sapi', keywords: ['sapi'], kalori: 207, protein: 18.8, karbo: 0, lemak: 14, group: 'protein-hewani'},
    { name: 'Daging Kambing', keywords: ['kambing'], kalori: 154, protein: 16.6, karbo: 0, lemak: 9.2, group: 'protein-hewani'},
    { name: 'Telur Ayam', keywords: ['telur'], kalori: 155, protein: 12.6, karbo: 1.1, lemak: 10.6, group: 'protein-hewani'},
    { name: 'Ikan Bandeng', keywords: ['bandeng'], kalori: 129, protein: 20, karbo: 0, lemak: 4.8, group: 'protein-hewani'},
    { name: 'Ikan Kembung', keywords: ['kembung'], kalori: 112, protein: 21.4, karbo: 0, lemak: 2.5, group: 'protein-hewani'},
    { name: 'Ikan Tuna', keywords: ['tuna'], kalori: 116, protein: 25.5, karbo: 0, lemak: 1, group: 'protein-hewani'},
    { name: 'Ikan Tongkol', keywords: ['tongkol'], kalori: 111, protein: 24, karbo: 0, lemak: 1, group: 'protein-hewani'},
    { name: 'Ikan Cakalang', keywords: ['cakalang'], kalori: 108, protein: 24, karbo: 0, lemak: 1, group: 'protein-hewani'},
    { name: 'Ikan Lele', keywords: ['lele'], kalori: 105, protein: 17, karbo: 0, lemak: 3.5, group: 'protein-hewani'},
    { name: 'Ikan Nila', keywords: ['nila'], kalori: 96, protein: 20, karbo: 0, lemak: 1.7, group: 'protein-hewani'},
    { name: 'Ikan Asin/Teri', keywords: ['ikan asin', 'teri'], kalori: 200, protein: 33, karbo: 0, lemak: 4, group: 'protein-hewani'},
    { name: 'Udang', keywords: ['udang'], kalori: 106, protein: 20.3, karbo: 0.9, lemak: 1.7, group: 'protein-hewani'},
    { name: 'Cumi-cumi', keywords: ['cumi'], kalori: 92, protein: 15.6, karbo: 3.1, lemak: 1.4, group: 'protein-hewani'},
    { name: 'Bakso', keywords: ['bakso'], kalori: 180, protein: 9, karbo: 6, lemak: 14, group: 'protein-hewani'},
    { name: 'Sosis', keywords: ['sosis'], kalori: 300, protein: 12, karbo: 3, lemak: 27, group: 'protein-hewani'},

    // -- Protein nabati --
    { name: 'Tahu', keywords: ['tahu'], kalori: 76, protein: 8, karbo: 1.9, lemak: 4.8, group: 'protein-nabati'},
    { name: 'Tempe', keywords: ['tempe'], kalori: 193, protein: 18.3, karbo: 12.7, lemak: 8.8, group: 'protein-nabati'},
    { name: 'Kedelai', keywords: ['kedelai', 'kedelei'], kalori: 381, protein: 34.9, karbo: 30.1, lemak: 17.7, group: 'protein-nabati'},
    { name: 'Kacang Hijau', keywords: ['kacang hijau'], kalori: 347, protein: 22.2, karbo: 62.9, lemak: 1.2, group: 'protein-nabati'},
    { name: 'Kacang Tanah', keywords: ['kacang tanah'], kalori: 567, protein: 25.8, karbo: 16.1, lemak: 49.2, group: 'protein-nabati'},
    { name: 'Kacang Merah', keywords: ['kacang merah'], kalori: 333, protein: 23.1, karbo: 59.6, lemak: 1.5, group: 'protein-nabati'},

    // -- Sayuran --
    { name: 'Bayam', keywords: ['bayam'], kalori: 23, protein: 2.9, karbo: 3.6, lemak: 0.4, group: 'sayur'},
    { name: 'Kangkung', keywords: ['kangkung'], kalori: 19, protein: 3, karbo: 3.1, lemak: 0.2, group: 'sayur'},
    { name: 'Kol/Kubis', keywords: ['kol', 'kubis'], kalori: 25, protein: 1.3, karbo: 5.8, lemak: 0.1, group: 'sayur'},
    { name: 'Sawi', keywords: ['sawi', 'caisim', 'pokcoy', 'pakcoy'], kalori: 22, protein: 2.3, karbo: 3.9, lemak: 0.3, group: 'sayur'},
    { name: 'Tomat', keywords: ['tomat'], kalori: 18, protein: 0.9, karbo: 3.9, lemak: 0.2, group: 'sayur'},
    { name: 'Wortel', keywords: ['wortel'], kalori: 41, protein: 0.9, karbo: 9.6, lemak: 0.2, group: 'sayur'},
    { name: 'Buncis', keywords: ['buncis'], kalori: 31, protein: 1.8, karbo: 7, lemak: 0.1, group: 'sayur'},
    { name: 'Timun', keywords: ['timun', 'mentimun'], kalori: 15, protein: 0.7, karbo: 3.6, lemak: 0.1, group: 'sayur'},
    { name: 'Terong', keywords: ['terong'], kalori: 24, protein: 1, karbo: 5.7, lemak: 0.2, group: 'sayur'},
    { name: 'Labu Siam', keywords: ['labu siam'], kalori: 19, protein: 0.6, karbo: 4.5, lemak: 0.1, group: 'sayur'},
    { name: 'Toge/Kecambah', keywords: ['toge', 'tauge', 'kecambah'], kalori: 30, protein: 3.1, karbo: 5.9, lemak: 0.2, group: 'sayur'},
    { name: 'Daun Bawang/Seledri', keywords: ['daun bawang', 'seledri'], kalori: 22, protein: 1.5, karbo: 4.7, lemak: 0.2, group: 'sayur'},
    { name: 'Jamur', keywords: ['jamur'], kalori: 22, protein: 3.1, karbo: 3.3, lemak: 0.3, group: 'sayur'},

    // -- Bumbu & pelengkap --
    { name: 'Bawang Merah', keywords: ['bawang merah'], kalori: 39, protein: 1.5, karbo: 9.2, lemak: 0.1, group: 'bumbu'},
    { name: 'Bawang Putih', keywords: ['bawang putih'], kalori: 149, protein: 6.4, karbo: 33, lemak: 0.5, group: 'bumbu'},
    { name: 'Cabai Rawit', keywords: ['cabe rawit', 'cabai rawit'], kalori: 40, protein: 2, karbo: 7, lemak: 0.4, group: 'bumbu'},
    { name: 'Cabai Merah', keywords: ['cabe merah', 'cabai merah', 'cabe keriting', 'cabai keriting'], kalori: 32, protein: 1.9, karbo: 7.3, lemak: 0.4, group: 'bumbu'},
    { name: 'Jahe/Kunyit/Lengkuas', keywords: ['jahe', 'kunyit', 'lengkuas', 'kencur'], kalori: 80, protein: 1.8, karbo: 17.8, lemak: 0.8, group: 'bumbu'},
    { name: 'Kemiri', keywords: ['kemiri'], kalori: 636, protein: 8.4, karbo: 8.4, lemak: 63.9, group: 'bumbu'},
    { name: 'Santan', keywords: ['santan'], kalori: 230, protein: 2.3, karbo: 5.5, lemak: 23.8, group: 'bumbu'},
    { name: 'Kecap Manis', keywords: ['kecap'], kalori: 130, protein: 3, karbo: 27, lemak: 0, group: 'bumbu'},
    { name: 'Saus Sambal/Tomat', keywords: ['saus'], kalori: 100, protein: 1.5, karbo: 23, lemak: 0.3, group: 'bumbu'},
    { name: 'Minyak Goreng', keywords: ['minyak goreng', 'minyak curah', 'minyak kemasan'], kalori: 884, protein: 0, karbo: 0, lemak: 100, group: 'bumbu'},
    { name: 'Margarin/Mentega', keywords: ['margarin', 'mentega'], kalori: 720, protein: 0.5, karbo: 0.5, lemak: 80, group: 'bumbu'},
    { name: 'Gula Pasir', keywords: ['gula'], kalori: 387, protein: 0, karbo: 100, lemak: 0, group: 'bumbu'},
    { name: 'Garam', keywords: ['garam'], kalori: 0, protein: 0, karbo: 0, lemak: 0, group: 'bumbu'},

    // -- Susu & buah --
    { name: 'Susu Kental Manis', keywords: ['kental manis', 'skm'], kalori: 321, protein: 7.9, karbo: 54.4, lemak: 8.7, group: 'susu'},
    { name: 'Susu Bubuk', keywords: ['susu bubuk'], kalori: 502, protein: 24.6, karbo: 39.4, lemak: 26.7, group: 'susu'},
    { name: 'Susu Cair', keywords: ['susu cair', 'susu segar', 'susu uht', 'susu'], kalori: 61, protein: 3.2, karbo: 4.8, lemak: 3.3, group: 'susu'},
    { name: 'Pisang', keywords: ['pisang'], kalori: 89, protein: 1.1, karbo: 22.8, lemak: 0.3, group: 'buah'},
    { name: 'Apel', keywords: ['apel'], kalori: 52, protein: 0.3, karbo: 13.8, lemak: 0.2, group: 'buah'},
    { name: 'Jeruk', keywords: ['jeruk'], kalori: 47, protein: 0.9, karbo: 11.8, lemak: 0.1, group: 'buah'},
    { name: 'Pepaya', keywords: ['pepaya'], kalori: 43, protein: 0.5, karbo: 10.8, lemak: 0.3, group: 'buah'},
    { name: 'Semangka', keywords: ['semangka'], kalori: 30, protein: 0.6, karbo: 7.6, lemak: 0.2, group: 'buah'},
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

// ==================== FALLBACK: API GRATIS OPEN FOOD FACTS (Search-a-licious) ====================
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
        const url = '/api/openfoodfacts?q=' + encodeURIComponent(name);
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

// Sama seperti aggregateMenuPlanNutrisi, tapi digabung dari SELURUH 4
// minggu (bukan cuma minggu yang lagi aktif dilihat) -- dipakai KHUSUS
// untuk Evaluasi Menu Bulanan (lihat window.evaluateMenuPlanGizi di
// bawah), supaya penilaian "kurang protein"/"belum ada sayur" dst tidak
// berubah-ubah tiap kali user pindah tab minggu, dan tetap representatif
// sebagai gambaran pola makan sebulan (bukan cuma 1 dari 4 minggu yang
// kebetulan lagi kelihatan).
window.aggregateMenuPlanBahanBulanan = function(data) {
    const map = new Map();
    window.MENU_PLAN_WEEKS.forEach(function(w) {
        window.MENU_PLAN_DAYS.forEach(function(d) {
            (((data[w.key] || {})[d.key]) || []).forEach(function(meal) {
                (meal.bahan || []).forEach(function(b) {
                    const name = (b.name || '').trim();
                    if (!name) return;
                    const unit = (b.unit || '').trim();
                    const qty = Number(b.qty) || 0;
                    const key = name.toLowerCase() + '|' + unit.toLowerCase();
                    if (map.has(key)) {
                        map.get(key).qty += qty;
                    } else {
                        map.set(key, { name: name, unit: unit, qty: qty });
                    }
                });
            });
        });
    });
    return Array.from(map.values()).sort(function(a, b) { return a.name.localeCompare(b.name); });
};

window.aggregateMenuPlanNutrisiBulanan = function(data) {
    const aggregated = window.aggregateMenuPlanBahanBulanan(data);
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

// ==================== EVALUASI GIZI BULANAN ====================
// Menerjemahkan angka mentah (total kalori/protein/karbo/lemak) jadi
// insight yang gampang dipahami orang awam: "kurang protein", "kebanyakan
// karbo", dll -- supaya kartu gizi tidak cuma menampilkan angka tapi juga
// membantu keluarga menilai apakah pola makan sudah seimbang.
//
// SENGAJA dihitung dari SELURUH 4 minggu digabung (lihat
// window.aggregateMenuPlanNutrisiBulanan), BUKAN dari minggu yang lagi
// aktif dilihat -- supaya penilaiannya tidak berubah-ubah tiap user pindah
// tab minggu, dan lebih representatif sebagai gambaran pola makan sebulan
// (1 minggu kadang kebetulan sedikit sayur, tapi minggu lain banyak --
// baru kelihatan seimbang atau tidaknya kalau dilihat sebulan penuh).
// Kartu angka kalori/gram di atasnya TETAP per-minggu (ganti-ganti sesuai
// tab) -- cuma bagian evaluasi ini yang bulanan.
//
// Dua jenis evaluasi, keduanya TIDAK butuh tahu jumlah anggota keluarga
// atau ukuran porsi (data yang tidak kita punya di app ini), makanya
// dipilih yang robust terhadap itu:
//
// 1) PROPORSI KALORI PER MAKRO -- persentase kalori yang berasal dari
//    karbohidrat/protein/lemak dibanding TOTAL kalori dari makro itu
//    sendiri (bukan porsi per orang), dicocokkan ke rentang "seimbang"
//    umum ala Kemenkes RI/WHO (karbo 50-65%, protein 10-20%, lemak
//    20-35% dari total kalori). Proporsi ini sama nilainya baik menunya
//    untuk 2 orang atau 8 orang, jadi valid dipakai tanpa perlu tahu
//    jumlah anggota keluarga.
// 2) KELENGKAPAN KELOMPOK BAHAN -- cek apakah menu sebulan ini sama
//    sekali belum menyentuh sayuran atau sumber protein (hewani/nabati)
//    di basis data lokal manapun -- sinyal paling gampang dikenali orang
//    awam ("belum ada sayur sebulan ini") yang sering luput kalau cuma
//    lihat angka kalori/gram.
//
// Selalu tegaskan (di UI) ini evaluasi KASAR dari basis data umum,
// BUKAN pengganti nasihat ahli gizi -- terutama untuk kondisi khusus
// (anak-anak, ibu hamil/menyusui, penyakit tertentu).
window.NUTRISI_AKG_REFERENSI = {
    // Rentang proporsi kalori per makro yang dianggap seimbang untuk
    // pola makan umum dewasa sehat (acuan kasar Kemenkes RI/WHO, BUKAN
    // angka presisi per usia/gender/kondisi kesehatan tertentu).
    karboPctRange: [50, 65],
    proteinPctRange: [10, 20],
    lemakPctRange: [20, 35]
};

// Bikin 1 baris insight dari persentase vs rentang ideal -- dipakai untuk
// ketiga makro (karbo/protein/lemak) dengan pesan spesifik per arah
// (kurang vs kelebihan) supaya sarannya kontekstual, bukan generik.
window._nutrisiInsightFromRange = function(label, pct, range, msgOver, msgUnder) {
    const rangeText = `idealnya ${range[0]}-${range[1]}%`;
    if (pct < range[0]) {
        return { level: 'warning', label: label, text: `≈${Math.round(pct)}% dari total kalori (${rangeText}) — ${msgUnder}.` };
    }
    if (pct > range[1]) {
        return { level: 'warning', label: label, text: `≈${Math.round(pct)}% dari total kalori (${rangeText}) — ${msgOver}.` };
    }
    return { level: 'good', label: label, text: `≈${Math.round(pct)}% dari total kalori — sudah dalam rentang seimbang (${rangeText}).` };
};

window.evaluateMenuPlanGizi = function(result) {
    const insights = [];
    if (!result || !result.rows.length) return insights;

    // -- 1) Proporsi kalori per makro. Kalori dihitung ULANG dari gram
    //    protein/karbo/lemak (4/4/9 kkal per gram) supaya totalnya selalu
    //    pas 100% dijumlah -- bukan dari result.totalKalori (basis data
    //    kalori per bahan bisa sedikit tidak konsisten dengan gram
    //    makronya, terutama bahan campuran/olahan).
    const kaloriDariProtein = result.totalProtein * 4;
    const kaloriDariKarbo = result.totalKarbo * 4;
    const kaloriDariLemak = result.totalLemak * 9;
    const totalKaloriMakro = kaloriDariProtein + kaloriDariKarbo + kaloriDariLemak;

    if (totalKaloriMakro > 0) {
        const R = window.NUTRISI_AKG_REFERENSI;
        insights.push(window._nutrisiInsightFromRange('Karbohidrat', (kaloriDariKarbo / totalKaloriMakro) * 100, R.karboPctRange,
            'porsi nasi/mie/tepung tampak dominan dibanding lauk & sayur, coba kurangi sedikit porsi karbo dan tambah lauk/sayur',
            'sumber energi utama (nasi/kentang/jagung) tampak sedikit, pastikan tetap ada di tiap hari supaya energi keluarga cukup'));
        insights.push(window._nutrisiInsightFromRange('Protein', (kaloriDariProtein / totalKaloriMakro) * 100, R.proteinPctRange,
            'proporsi protein sudah tinggi, cukup dipertahankan',
            'sumber protein (ayam/ikan/telur/tempe/tahu) tampak kurang, coba tambahkan di beberapa menu supaya keluarga tidak kekurangan protein'));
        insights.push(window._nutrisiInsightFromRange('Lemak', (kaloriDariLemak / totalKaloriMakro) * 100, R.lemakPctRange,
            'gorengan/santan/minyak tampak berlebih, coba kurangi supaya lebih sehat',
            'proporsi lemak rendah, umumnya tidak masalah selama sumber lemak sehat (mis. ikan) tetap ada'));
    }

    // -- 2) Kelengkapan kelompok bahan yang terdeteksi (dari basis data
    //    lokal saja -- bahan hasil fallback Open Food Facts tidak
    //    punya kategori kelompok, jadi tidak ikut dihitung di sini).
    const groupsPresent = new Set();
    result.rows.forEach(function(item) {
        const ref = window._nutrisiMatchLocal(item.name);
        if (ref && ref.group) groupsPresent.add(ref.group);
    });
    if (!groupsPresent.has('sayur')) {
        insights.push({ level: 'warning', label: 'Sayuran', text: 'belum ada sayuran yang terdeteksi di jadwal bulan ini — coba selipkan sayur di beberapa menu.' });
    }
    if (!groupsPresent.has('protein-hewani') && !groupsPresent.has('protein-nabati')) {
        insights.push({ level: 'warning', label: 'Protein', text: 'belum ada sumber protein (daging/ikan/telur/tahu/tempe) yang terdeteksi di jadwal bulan ini.' });
    }
    if (!groupsPresent.has('buah') && !groupsPresent.has('susu')) {
        insights.push({ level: 'info', label: 'Buah & Susu', text: 'belum ada buah/susu yang terdeteksi — opsional, tapi bagus untuk tambahan vitamin & kalsium keluarga.' });
    }

    return insights;
};


// index.html, SEKARANG DI ATAS -- sebelum tab minggu & jadwal 7 hari,
// bukan lagi di bawah kartu Estimasi Belanja). Dipanggil dari
// window.renderMenuPlan (js/menu-plan.js) tiap kali halaman/minggu aktif
// berubah, dan lagi setelah window.prefetchNutrisiOFFUntukMenuPlan selesai.
window.renderMenuPlanGizi = function(weekData, weekKey) {
    const listEl = document.getElementById('mplanGiziList');
    if (!listEl) return; // markup belum tersedia di versi index.html ini

    const activeWeek = weekKey || window._mplanActiveWeek || 'w1';
    const fullData = window.getMenuPlan(window.currentBookId);
    weekData = weekData || fullData[activeWeek];
    const result = window.aggregateMenuPlanNutrisi(weekData);

    const emptyEl = document.getElementById('mplanGiziEmpty');
    const kaloriEl = document.getElementById('mplanGiziKalori');
    const macrosEl = document.getElementById('mplanGiziMacros');
    const noteEl = document.getElementById('mplanGiziNote');
    const labelEl = document.getElementById('mplanGiziHeaderLabel');
    const detailsEl = document.getElementById('mplanGiziDetails');
    const evaluasiWrapEl = document.getElementById('mplanGiziEvaluasiWrap');
    const evaluasiEl = document.getElementById('mplanGiziEvaluasi');

    if (labelEl) {
        const weekMeta = window.MENU_PLAN_WEEKS.find(function(w) { return w.key === activeWeek; });
        labelEl.innerText = `Estimasi Gizi ${weekMeta ? weekMeta.label : 'Mingguan'}`;
    }

    // Evaluasi (bagian "Evaluasi Menu Bulan Ini") dihitung dari GABUNGAN
    // seluruh 4 minggu -- lihat catatan panjang di
    // window.evaluateMenuPlanGizi kenapa ini sengaja bulanan, bukan ikut
    // minggu yang lagi dibuka. Makanya blok ini diletakkan TERPISAH dari
    // render angka kalori/gram per-minggu di bawah (yang masih boleh
    // kosong kalau minggu aktif memang belum diisi menu).
    if (evaluasiWrapEl && evaluasiEl) {
        const monthlyResult = window.aggregateMenuPlanNutrisiBulanan(fullData);
        const insights = window.evaluateMenuPlanGizi(monthlyResult);
        if (insights.length) {
            evaluasiWrapEl.style.display = '';
            evaluasiEl.innerHTML = insights.map(function(it) {
                return `<div class="mplan-gizi-insight is-${it.level}"><span class="mplan-gizi-insight-label">${window.escapeHtml(it.label)}</span><span class="mplan-gizi-insight-text">${window.escapeHtml(it.text)}</span></div>`;
            }).join('');
        } else {
            evaluasiWrapEl.style.display = 'none';
            evaluasiEl.innerHTML = '';
        }
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
            ? `${result.unmatchedCount} bahan belum punya data gizi (belum dikenali atau satuannya belum bisa dikonversi ke gram) -- belum termasuk di angka di atas. Tanda * = data dari Open Food Facts, bukan basis data lokal. Semua angka gizi & evaluasi di sini perkiraan kasar dari basis data umum, bukan pengganti label gizi asli atau nasihat ahli gizi.`
            : 'Perkiraan kasar berdasarkan basis data gizi umum per 100 gram bahan -- bisa berbeda dari kondisi bahan sebenarnya. Evaluasi di atas juga perkiraan kasar, bukan pengganti nasihat ahli gizi.';
    }
};
