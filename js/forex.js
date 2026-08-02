// ==================== FOREX & GOLD ====================
// Free tier emas.maulanar.my.id = 20 hit/bulan.
// EMAS_CACHE_HOURS=44 -> maksimal 17 panggilan/bulan (floor(31*24/44)+1=17
// di bulan 31 hari, kasus terburuk -- bulan lebih pendek otomatis lebih
// sedikit lagi). Sengaja pas di 17, bukan cuma "sekitar", karena refresh
// manual sudah dihapus (lihat goldRefreshBtn di bawah) jadi ini sekarang
// SATU-SATUNYA sumber hit ke API, tidak ada lagi buffer kuota yang perlu
// disisakan untuk tombol refresh.
// Harga Antam sendiri biasanya cuma update 1x/hari, jadi cache ~44 jam masih relevan.
const EMAS_CACHE_HOURS = 44;
const EMAS_CACHE_KEY   = 'sk_emas_price_cache';
const EMAS_QUOTA_KEY   = 'sk_emas_quota';
const EMAS_QUOTA_LIMIT = 20;

function _emasCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function _emasQuotaGet() {
    try {
        const q = JSON.parse(localStorage.getItem(EMAS_QUOTA_KEY) || 'null');
        if (!q || q.month !== _emasCurrentMonthKey()) return 0;
        return q.count;
    } catch { return 0; }
}
function _emasQuotaTrack() {
    const monthKey = _emasCurrentMonthKey();
    let q;
    try { q = JSON.parse(localStorage.getItem(EMAS_QUOTA_KEY) || 'null'); } catch { q = null; }
    if (!q || q.month !== monthKey) q = { month: monthKey, count: 0 };
    q.count += 1;
    localStorage.setItem(EMAS_QUOTA_KEY, JSON.stringify(q));
    return q.count;
}
window.updateEmasQuotaDisplay = function() {
    const el = document.getElementById('emasQuotaInfo');
    if (!el) return;
    const used = _emasQuotaGet();
    const sisa = Math.max(0, EMAS_QUOTA_LIMIT - used);
    const cache = _emasCacheRead();
    let cacheInfo = '';
    if (cache) {
        const jamLalu = Math.floor((Date.now() - cache.timestamp) / 3600000);
        cacheInfo = ` · Harga terakhir dari server ${jamLalu < 1 ? 'baru saja' : jamLalu + ' jam lalu'}, cache berlaku ${EMAS_CACHE_HOURS} jam.`;
    }
    el.innerHTML = `Kuota API bulan ini: <strong>${used}/${EMAS_QUOTA_LIMIT}</strong> (sisa ${sisa})${cacheInfo}`;
};
function _emasCacheRead() {
    try {
        const c = JSON.parse(localStorage.getItem(EMAS_CACHE_KEY) || 'null');
        if (!c || typeof c.pricePerGram !== 'number') return null;
        return c;
    } catch { return null; }
}
function _emasCacheWrite(pricePerGram, apiKey) {
    localStorage.setItem(EMAS_CACHE_KEY, JSON.stringify({
        pricePerGram,
        apiKey,
        timestamp: Date.now()
    }));
}
window.clearEmasPriceCache = function() {
    localStorage.removeItem(EMAS_CACHE_KEY);
};

window.fetchForexRate = async function() {
    const apis = [
        { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD', parse: d => d?.rates?.IDR },
        { name: 'cdn.jsdelivr.net', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', parse: d => d?.usd?.idr },
        { name: 'currency-api.pages.dev', url: 'https://latest.currency-api.pages.dev/v1/currencies/usd.json', parse: d => d?.usd?.idr },
        { name: 'hexarate.paikama.co', url: 'https://hexarate.paikama.co/api/rates/latest/USD?target=IDR', parse: d => d?.data?.mid }
    ];
    const rateEl = document.getElementById('forexRate');
    const srcEl  = document.getElementById('forexSource');
    if (!rateEl) return;
    for (const api of apis) {
        try {
            const res = await fetch(api.url, { signal: AbortSignal.timeout(7000) });
            if (!res.ok) continue;
            const data = await res.json();
            const rate = api.parse(data);
            if (rate && rate > 1000) {
                rateEl.textContent = 'Rp ' + Number(rate).toLocaleString('id-ID', { maximumFractionDigits: 0 });
                return;
            }
        } catch { /* coba berikutnya */ }
    }
    rateEl.textContent = '— Tidak tersedia';
    srcEl.textContent  = 'Semua sumber gagal';
};

window.updateEmasApiBadge = function() {
    const badge = document.getElementById('emasApiStatusBadge');
    if (!badge) return;
    const val = (document.getElementById('emasApiKeyInput')?.value || '').trim();
    if (val) { badge.style.background = '#F1EBDA'; badge.style.color = '#6B5320'; badge.innerText = window.t('forex_configured'); }
    else { badge.style.background = '#EFE7D8'; badge.style.color = '#5B6472'; badge.innerText = window.t('forex_not_configured'); }
};
window.updateEmasGramPreview = function() {
    const gram = parseFloat(document.getElementById('emasGramInput')?.value) || 0;
    const prev = document.getElementById('emasGramPreview');
    if (!prev) return;
    if (gram <= 0) { prev.innerText = ''; return; }
    const priceText = document.getElementById('goldPrice')?.textContent || '';
    const priceNum  = parseInt(priceText.replace(/[^0-9]/g, ''));
    if (priceNum > 0) {
        const total = gram * priceNum;
        prev.innerText = `Estimasi nilai: Rp ${Math.round(total).toLocaleString('id-ID')}`;
    } else { prev.innerText = `${gram} gram tersimpan — harga belum dimuat`; }
};
window.updateGoldValueDisplay = function(pricePerGram) {
    const gram = parseFloat(localStorage.getItem('sk_emas_gram')) || 0;
    const row   = document.getElementById('goldValueRow');
    const label = document.getElementById('goldValueLabel');
    const val   = document.getElementById('goldValue');
    if (!row) return;
    if (gram > 0 && pricePerGram > 0) {
        const total = gram * pricePerGram;
        label.innerText = `Estimasi nilai ${gram} gram`;
        val.innerText   = 'Rp ' + Math.round(total).toLocaleString('id-ID');
        row.style.display = 'block';
    } else row.style.display = 'none';
};
window.testEmasApiKey = async function() {
    const key = (document.getElementById('emasApiKeyInput')?.value || '').trim();
    const st  = document.getElementById('emasApiTestStatus');
    if (!key) { st.style.color = '#A13A3A'; st.innerText = 'Isi API key dulu.'; return; }
    st.style.color = '#9C7A2E'; st.innerText = 'Menghubungi server...';
    try {
        const res = await fetch('/api/emas', {
            headers: { 'X-API-Key': key },
            signal: AbortSignal.timeout(8000)
        });
        _emasQuotaTrack();
        window.updateEmasQuotaDisplay();
        if (res.ok) {
            st.style.color = '#2E6B4F';
            st.innerText = 'API key valid! Data Antam berhasil diakses.';
        } else {
            st.style.color = '#A13A3A';
            st.innerText = `Server menolak: status ${res.status}. Periksa API key Anda.`;
        }
    } catch (e) {
        st.style.color = '#A13A3A';
        st.innerText = `Gagal terhubung: ${e.message}`;
    }
};
window.saveEmasApiKey = function() {
    const key  = (document.getElementById('emasApiKeyInput')?.value || '').trim();
    const gram = parseFloat(document.getElementById('emasGramInput')?.value) || 0;
    const st   = document.getElementById('emasApiTestStatus');
    if (!key) { st.style.color = '#A13A3A'; st.innerText = 'API key tidak boleh kosong!'; return; }
    localStorage.setItem('sk_emas_api_key', key);
    if (gram > 0) localStorage.setItem('sk_emas_gram', gram);
    else localStorage.removeItem('sk_emas_gram');
    st.style.color = '#2E6B4F';
    st.innerText = 'Tersimpan! API key & jumlah emas diperbarui.';
    window.updateEmasApiBadge();
    window.updateEmasQuotaDisplay();
    window.showToast('Setelan emas disimpan!', 'success');
    // Kalau key berubah, cache lama (punya key lain) otomatis diabaikan oleh
    // fetchGoldPrice (lihat cek cache.apiKey di dalamnya) -- tidak perlu
    // parameter apa pun di sini untuk memaksa itu terjadi.
    window.fetchGoldPrice();
    // [SYNC MULTI-DEVICE] Simpan juga ke cloud (tabel `settings`, book_id
    // 'global') supaya API key & jumlah gram emas ini otomatis tersedia di
    // perangkat lain yang login ke backend Supabase yang sama -- konsisten
    // dengan pola google_sheets_url/telegram_config, lihat
    // window.pullAllSettings di js/db.js untuk sisi penerimaannya.
    if (window.pushSetting) {
        window.pushSetting('emas_api_key', key, 'global').catch(function() {});
        window.pushSetting('emas_gram', gram > 0 ? gram : '', 'global').catch(function() {});
    }
};
window.clearEmasApiKey = function() {
    if (!confirm('Hapus API key emas? Widget harga Antam akan menggunakan estimasi spot.')) return;
    localStorage.removeItem('sk_emas_api_key');
    window.clearEmasPriceCache();
    const inp = document.getElementById('emasApiKeyInput');
    if (inp) inp.value = '';
    const st = document.getElementById('emasApiTestStatus');
    if (st) { st.style.color = '#5B6472'; st.innerText = 'API key dihapus. Beralih ke estimasi spot.'; }
    window.updateEmasApiBadge();
    window.updateEmasQuotaDisplay();
    window.showToast('API key emas dihapus.', 'info');
    window.fetchGoldPrice();
    // [SYNC MULTI-DEVICE] Push string kosong supaya penghapusan ini ikut
    // tersinkron ke perangkat lain (lihat catatan di saveEmasApiKey di atas).
    if (window.pushSetting) window.pushSetting('emas_api_key', '', 'global').catch(function() {});
};
window.fetchGoldPrice = async function() {
    const priceEl = document.getElementById('goldPrice');
    const srcEl   = document.getElementById('goldSource');
    if (!priceEl) return;
    const emasApiKey = (localStorage.getItem('sk_emas_api_key') || '').trim();

    if (emasApiKey) {
        // Pakai cache dulu kalau masih berlaku & key sama, biar kuota bulanan cukup.
        // Tidak ada lagi jalur "refresh manual" (tombol ⟳ sudah dihapus) --
        // satu-satunya cara cache di-bypass adalah otomatis, lewat cek
        // cache.apiKey !== emasApiKey di bawah (key baru = cache lama diabaikan).
        const cache = _emasCacheRead();
        const cacheValid = cache && cache.apiKey === emasApiKey &&
            (Date.now() - cache.timestamp) < EMAS_CACHE_HOURS * 3600 * 1000;

        if (cacheValid) {
            priceEl.textContent = 'Rp ' + Math.round(cache.pricePerGram).toLocaleString('id-ID');
            const jamLalu = Math.floor((Date.now() - cache.timestamp) / 3600000);
            srcEl.textContent = `Cache · diperbarui ${jamLalu < 1 ? 'baru saja' : jamLalu + ' jam lalu'}`;
            srcEl.style.color = '#9AA2AC';
            window.updateGoldValueDisplay(cache.pricePerGram);
            window.updateEmasQuotaDisplay();
            return;
        }

        try {
            const res = await fetch('/api/emas', {
                headers: { 'X-API-Key': emasApiKey },
                signal: AbortSignal.timeout(8000)
            });
            if (res.ok) {
                // [FIX BUG KUOTA] _emasQuotaTrack() sebelumnya dipanggil untuk SEMUA
                // respons (termasuk 403/expired key yang gagal auth) -- akibatnya kuota
                // lokal (tampilan "Kuota API bulan ini" di Setelan) ikut berkurang
                // walau request-nya gagal dan kemungkinan tidak dihitung sama sekali
                // oleh provider upstream. Sekarang hanya di-track saat request benar2
                // diproses (berhasil, atau 429 yang memang berarti kuota upstream
                // sudah kepakai) -- BUKAN saat gagal auth (403) atau error jaringan.
                _emasQuotaTrack();
                window.updateEmasQuotaDisplay();
                const json = await res.json();
                const item = json?.data?.[0];
                if (item?.sell_price) {
                    const totalHarga = Number(item.sell_price);
                    const beratGram  = Number(item.weight) || 1;
                    // Normalisasi ke harga per 1 gram
                    const hargaPerGram = totalHarga / beratGram;
                    priceEl.textContent = 'Rp ' + Math.round(hargaPerGram).toLocaleString('id-ID');
                    srcEl.textContent = 'Live dari server · baru saja';
                    srcEl.style.color = '#9AA2AC';
                    window.updateGoldValueDisplay(hargaPerGram);
                    _emasCacheWrite(hargaPerGram, emasApiKey);
                    return;
                }
            } else if (res.status === 429) {
                _emasQuotaTrack();
                window.updateEmasQuotaDisplay();
                srcEl.textContent = 'Kuota API bulanan habis, beralih ke estimasi spot';
                srcEl.style.color = '#A13A3A';
                // Kalau masih ada cache lama (walau kadaluarsa), lebih baik pakai itu daripada estimasi spot kasar
                if (cache) {
                    priceEl.textContent = 'Rp ' + Math.round(cache.pricePerGram).toLocaleString('id-ID');
                    window.updateGoldValueDisplay(cache.pricePerGram);
                    return;
                }
            } else if (res.status === 403) {
                // Bukan kuota habis (itu 429) -- 403 berarti request DITOLAK sebelum
                // sempat diproses (API key salah/kadaluarsa/dicabut, atau permintaan
                // diblokir di level proxy/Vercel). Detail teknis dari body error
                // proxy (lihat api/emas.js) sengaja TIDAK ditampilkan ke pengguna --
                // itu cuma noise (JSON mentah upstream), pesan di card cukup
                // ringkas: kenapa gagal + fallback yang dipakai.
                srcEl.textContent = 'API key emas ditolak, beralih ke estimasi spot';
                srcEl.style.color = '#A13A3A';
                if (cache) {
                    priceEl.textContent = 'Rp ' + Math.round(cache.pricePerGram).toLocaleString('id-ID');
                    window.updateGoldValueDisplay(cache.pricePerGram);
                    return;
                }
            } else {
                srcEl.textContent = 'Gagal ambil harga emas, beralih ke estimasi spot';
                srcEl.style.color = '#9C7A2E';
            }
        } catch (e) {
            srcEl.textContent = 'Gagal hubungi API harga emas, beralih ke estimasi spot';
            srcEl.style.color = '#9C7A2E';
        }
    }
    const apis = [
        { name: 'jsdelivr', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/xau.json', parse: d => d?.xau?.usd },
        { name: 'currency-api', url: 'https://latest.currency-api.pages.dev/v1/currencies/xau.json', parse: d => d?.xau?.usd }
    ];
    for (const api of apis) {
        try {
            const res = await fetch(api.url, { signal: AbortSignal.timeout(7000) });
            if (!res.ok) continue;
            const data = await res.json();
            const xauUsd = api.parse(data);
            if (!xauUsd || xauUsd < 100) continue;
            const rateText = document.getElementById('forexRate')?.textContent || '';
            const idrRate  = parseInt(rateText.replace(/[^0-9]/g, '')) || 16200;
            const pricePerGram = (xauUsd / 31.1035) * idrRate;
            priceEl.textContent = '~Rp ' + Math.round(pricePerGram).toLocaleString('id-ID');
            window.updateGoldValueDisplay(Math.round(pricePerGram));
            return;
        } catch { /* coba berikutnya */ }
    }
    priceEl.textContent = '— Tidak tersedia';
    srcEl.textContent   = 'Semua sumber gagal';
    srcEl.style.color = '#A13A3A';
};
