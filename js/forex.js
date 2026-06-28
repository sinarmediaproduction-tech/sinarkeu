// ==================== FOREX & GOLD ====================
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
    if (val) { badge.style.background = '#fef3c7'; badge.style.color = '#92400e'; badge.innerText = window.t('forex_configured'); }
    else { badge.style.background = '#eee'; badge.style.color = '#666'; badge.innerText = window.t('forex_not_configured'); }
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
    if (!key) { st.style.color = '#de350b'; st.innerText = 'Isi API key dulu.'; return; }
    st.style.color = '#cc7b00'; st.innerText = 'Menghubungi server...';
    try {
        const res = await fetch('/api/emas', {
            headers: { 'X-API-Key': key },
            signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
            st.style.color = '#00875a';
            st.innerText = 'API key valid! Data Antam berhasil diakses.';
        } else {
            st.style.color = '#de350b';
            st.innerText = `Server menolak: status ${res.status}. Periksa API key Anda.`;
        }
    } catch (e) {
        st.style.color = '#de350b';
        st.innerText = `Gagal terhubung: ${e.message}`;
    }
};
window.saveEmasApiKey = function() {
    const key  = (document.getElementById('emasApiKeyInput')?.value || '').trim();
    const gram = parseFloat(document.getElementById('emasGramInput')?.value) || 0;
    const st   = document.getElementById('emasApiTestStatus');
    if (!key) { st.style.color = '#de350b'; st.innerText = 'API key tidak boleh kosong!'; return; }
    localStorage.setItem('sk_emas_api_key', key);
    if (gram > 0) localStorage.setItem('sk_emas_gram', gram);
    else localStorage.removeItem('sk_emas_gram');
    st.style.color = '#00875a';
    st.innerText = 'Tersimpan! API key & jumlah emas diperbarui.';
    window.updateEmasApiBadge();
    window.showToast('Setelan emas disimpan!', 'success');
    window.fetchGoldPrice();
};
window.clearEmasApiKey = function() {
    if (!confirm('Hapus API key emas? Widget harga Antam akan menggunakan estimasi spot.')) return;
    localStorage.removeItem('sk_emas_api_key');
    const inp = document.getElementById('emasApiKeyInput');
    if (inp) inp.value = '';
    const st = document.getElementById('emasApiTestStatus');
    if (st) { st.style.color = '#666'; st.innerText = 'API key dihapus. Beralih ke estimasi spot.'; }
    window.updateEmasApiBadge();
    window.showToast('API key emas dihapus.', 'info');
    window.fetchGoldPrice();
};
window.fetchGoldPrice = async function() {
    const priceEl = document.getElementById('goldPrice');
    const srcEl   = document.getElementById('goldSource');
    if (!priceEl) return;
    const emasApiKey = (localStorage.getItem('sk_emas_api_key') || '').trim();
    if (emasApiKey) {
        try {
            const res = await fetch('/api/emas', {
                headers: { 'X-API-Key': emasApiKey },
                signal: AbortSignal.timeout(8000)
            });
            if (res.ok) {
                const json = await res.json();
                const item = json?.data?.[0];
                if (item?.sell_price) {
                    const totalHarga = Number(item.sell_price);
                    const beratGram  = Number(item.weight) || 1;
                    // Normalisasi ke harga per 1 gram
                    const hargaPerGram = totalHarga / beratGram;
                    priceEl.textContent = 'Rp ' + Math.round(hargaPerGram).toLocaleString('id-ID');
                    window.updateGoldValueDisplay(hargaPerGram);
                    return;
                }
            } else {
                srcEl.textContent = `API error (${res.status}), beralih ke estimasi spot`;
                srcEl.style.color = '#cc7b00';
            }
        } catch (e) {
            srcEl.textContent = `Gagal hubungi API (${e.message}), beralih ke estimasi spot`;
            srcEl.style.color = '#cc7b00';
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
    srcEl.style.color = '#de350b';
};

// Zakat
const ZAKAT_PERSEN = 2.5;

function _getIncomeThisMonth() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-indexed
    let total = 0;
    (window.txs || []).forEach(t => {
        if (t.type !== 'income') return;
        const d = window.parseTxDate(t.date);
        if (d.getFullYear() === y && d.getMonth() === m) {
            total += Number(t.amount) || 0;
        }
    });
    return total;
}

window.updateZakatPreview = function() {
    const prev = document.getElementById('zakatPreview');
    if (!prev) return;
    const income = _getIncomeThisMonth();
    const zakat = Math.round(income * ZAKAT_PERSEN / 100);
    const bln = new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' });
    prev.innerText = income > 0
        ? `Estimasi sedekah bulan ini (${bln}): Rp ${zakat.toLocaleString('id-ID')}`
        : `Belum ada pemasukan bulan ini`;
};

window.saveZakatSetting = function() {
    window.showToast('Sedekah sudah otomatis 2,5% dari pemasukan bulan ini.', 'info');
};

window.clearZakatSetting = function() {
    window.showToast('Sedekah dihitung otomatis, tidak dapat dihapus.', 'info');
};

window.updateZakatCard = function() {
    const card  = document.getElementById('zakatCard');
    const valEl = document.getElementById('zakatValue');
    const srcEl = document.getElementById('zakatSource');
    if (!card) return;
    const income = _getIncomeThisMonth();
    const zakat = Math.round(income * ZAKAT_PERSEN / 100);
    const bln = new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' });
    valEl.innerText = valEl.innerText || window.rp(0); // pastikan ada nilai awal untuk animasi
    if (typeof window.animateValue === 'function') {
        window.animateValue('zakatValue', zakat, 500);
    } else {
        valEl.innerText = 'Rp ' + zakat.toLocaleString('id-ID');
    }
    srcEl.innerText = `2,5% × pemasukan ${bln}`;
    card.style.display = 'block';
};