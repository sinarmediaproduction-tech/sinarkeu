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
                srcEl.textContent  = '1 USD · sumber: ' + api.name;
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
    if (val) { badge.style.background = '#fef3c7'; badge.style.color = '#92400e'; badge.innerText = 'Terkonfigurasi'; }
    else { badge.style.background = '#eee'; badge.style.color = '#666'; badge.innerText = 'Belum dikonfigurasi'; }
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
                    srcEl.textContent   = `Antam ${beratGram}gr (per gram) · emas.maulanar.my.id`;
                    srcEl.style.color = '#92400e';
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
            srcEl.textContent   = `estimasi spot · ${api.name}`;
            srcEl.style.color = '#92400e';
            window.updateGoldValueDisplay(Math.round(pricePerGram));
            return;
        } catch { /* coba berikutnya */ }
    }
    priceEl.textContent = '— Tidak tersedia';
    srcEl.textContent   = 'Semua sumber gagal';
    srcEl.style.color = '#de350b';
};

// Zakat
window.updateZakatPreview = function() {
    const persen = parseFloat(document.getElementById('zakatPersenInput')?.value) || 0;
    const prev   = document.getElementById('zakatPreview');
    if (!prev) return;
    if (persen <= 0) { prev.innerText = ''; return; }
    const saldo = window._lastBalance || 0;
    if (saldo > 0) {
        const zakat = Math.round(saldo * persen / 100);
        prev.innerText = `Zakat dari saldo saat ini: Rp ${zakat.toLocaleString('id-ID')}`;
    } else { prev.innerText = `${persen}% dari total saldo akhir`; }
};
window.saveZakatSetting = function() {
    const persen = parseFloat(document.getElementById('zakatPersenInput')?.value) || 0;
    if (persen <= 0 || persen > 100) { window.showToast('Persentase zakat tidak valid!', 'warning'); return; }
    localStorage.setItem('sk_zakat_persen', persen);
    window.showToast('Setelan zakat disimpan!', 'success');
    window.updateZakatPreview();
    window.updateZakatCard();
};
window.clearZakatSetting = function() {
    if (!confirm('Hapus setelan zakat? Card zakat akan disembunyikan dari dashboard.')) return;
    localStorage.removeItem('sk_zakat_persen');
    const inp = document.getElementById('zakatPersenInput');
    if (inp) inp.value = '';
    document.getElementById('zakatPreview').innerText = '';
    window.showToast('Setelan zakat dihapus.', 'info');
    window.updateZakatCard();
};
window.updateZakatCard = function() {
    const persen = parseFloat(localStorage.getItem('sk_zakat_persen')) || 0;
    const card   = document.getElementById('zakatCard');
    const valEl  = document.getElementById('zakatValue');
    const srcEl  = document.getElementById('zakatSource');
    if (!card) return;
    if (persen <= 0) { card.style.display = 'none'; return; }
    const saldo = window._lastBalance || 0;
    const zakat = Math.round(saldo * persen / 100);
    valEl.innerText = 'Rp ' + zakat.toLocaleString('id-ID');
    srcEl.innerText = `${persen}% × saldo akhir`;
    card.style.display = 'block';
};