// ==================== FINANCIAL FORECAST ====================

function _forecastGroupByMonth(txs) {
    const monthMap = {};
    txs.forEach(t => {
        const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
        if (!d || isNaN(d)) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap[key]) monthMap[key] = { inc: 0, exp: 0 };
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') monthMap[key].inc += amt;
        else monthMap[key].exp += amt;
    });
    return monthMap;
}

// [BUG FIX - ESTIMASI IKUT CACHE LOKAL TERPOTONG] Sebelumnya seluruh kartu ini
// (rata-rata 6 bulan, tren vs bulan lalu, proyeksi saldo habis, kategori
// terbesar bulan ini) dihitung murni dari window.txs -- cache lokal yang
// dibatasi MAX_LOCAL_TXS (1000 transaksi terbaru per buku, lihat
// trimAndSaveLocal di transaction.js). Untuk buku dengan riwayat transaksi
// padat, bulan-bulan yang masuk basis rata-rata/tren bisa sudah "kepotong"
// dari cache lokal, jadi angka yang tampil bisa lebih kecil dari kenyataan --
// ini persis kelas bug yang sudah diperbaiki di report.js/budget.js tapi
// kelewat di sini. (Saldo tidak termasuk masalah ini -- itu sudah benar
// lewat balance_offset, lihat trimAndSaveLocal.)
//
// Perbaikan: tetap render SEKETIKA dari window.txs dulu (cepat, benar untuk
// buku yang belum melewati MAX_LOCAL_TXS dan untuk mode offline), lalu --
// kalau online -- tarik ulang bulan-bulan yang dipakai basis dari cloud
// (window.fetchMonthTransactionsFromCloud, tanpa batas seperti window.txs)
// dan render ulang dengan angka yang sudah dikoreksi. Token + pengecekan
// currentBookId mencegah hasil fetch basi (user sudah ganti buku/pindah
// tab) menimpa tampilan yang sedang aktif.
window._forecastRenderToken = 0;
// [THROTTLE] renderForecastCard() dipanggil dari window.render() yang jalan di
// banyak tempat (tiap ketik search, ganti filter, tambah/ubah/hapus transaksi,
// dst -- lihat js/render.js). Tanpa throttle, koreksi cloud di bawah bisa
// nembak beberapa request paralel ke Supabase SETIAP KALI render() jalan --
// boros kuota & bikin network tab penuh request percuma (hasil lama toh
// langsung dibuang lewat token guard, tapi request-nya sudah kadung dikirim).
// Cukup 1x per buku per 20 detik -- render lokal (cepat, instan) tetap jalan
// setiap saat, cuma bagian cloud-nya yang dibatasi.
window._forecastLastCloudFetchAt = {};
const FORECAST_CLOUD_THROTTLE_MS = 20000;

window.renderForecastCard = function() {
    const card = document.getElementById('forecastCard');
    if (!card) return;

    const txs = window.txs || [];
    if (txs.length === 0) {
        card.innerHTML = _forecastEmpty();
        return;
    }

    const monthMap = _forecastGroupByMonth(txs);
    const months = Object.keys(monthMap).sort();
    if (months.length === 0) { card.innerHTML = _forecastEmpty(); return; }

    _renderForecastFromMonthMap(card, txs, monthMap, txs);

    // ── Koreksi dengan data cloud lengkap kalau online (dibatasi throttle) ──
    const myToken = ++window._forecastRenderToken;
    const bookIdAtCall = window.currentBookId;
    const lastFetchAt = window._forecastLastCloudFetchAt[bookIdAtCall] || 0;
    const shouldFetchCloud = (Date.now() - lastFetchAt) > FORECAST_CLOUD_THROTTLE_MS;
    if (shouldFetchCloud && window.isOnline() && typeof window.fetchMonthTransactionsFromCloud === 'function') {
        window._forecastLastCloudFetchAt[bookIdAtCall] = Date.now();
        const now0 = new Date();
        const thisKey0 = `${now0.getFullYear()}-${String(now0.getMonth() + 1).padStart(2, '0')}`;
        const completedMonths0 = months.filter(k => k !== thisKey0);
        const basisKeys = (completedMonths0.length > 0 ? completedMonths0.slice(-6) : months.slice(-6));
        const prevDate0 = new Date(now0.getFullYear(), now0.getMonth() - 1, 1);
        const prevKey0 = `${prevDate0.getFullYear()}-${String(prevDate0.getMonth() + 1).padStart(2, '0')}`;
        const keysToFetch = Array.from(new Set([...basisKeys, prevKey0, thisKey0]));

        Promise.all(keysToFetch.map(key => {
            const [y, m] = key.split('-').map(Number);
            return window.fetchMonthTransactionsFromCloud(bookIdAtCall, y, m).then(rows => ({ key, rows }));
        })).then(results => {
            if (myToken !== window._forecastRenderToken) return; // sudah ada render lebih baru
            if (bookIdAtCall !== window.currentBookId) return;   // buku sudah diganti
            const cardNow = document.getElementById('forecastCard');
            if (!cardNow) return; // card sudah tidak ada di DOM

            const correctedMonthMap = Object.assign({}, monthMap);
            let thisMonthCloudTxs = null;
            results.forEach(({ key, rows }) => {
                if (!rows || !Array.isArray(rows)) return; // gagal/offline di tengah jalan -- pertahankan angka lokal utk bulan ini
                let inc = 0, exp = 0;
                rows.forEach(t => {
                    const amt = Number(t.amount) || 0;
                    if (t.type === 'income') inc += amt; else exp += amt;
                });
                correctedMonthMap[key] = { inc, exp };
                if (key === thisKey0) thisMonthCloudTxs = rows;
            });

            _renderForecastFromMonthMap(cardNow, txs, correctedMonthMap, thisMonthCloudTxs || txs);
        }).catch(() => { /* biarkan angka lokal, sudah ditampilkan di atas */ });
    }
};

// txsForSaldo: dipakai untuk hitung saldo (bersama balance_offset, sudah benar
// dari cache lokal -- lihat catatan di atas). txsForTopCat: dipakai KHUSUS
// untuk kategori pengeluaran terbesar bulan ini -- diganti data cloud bulan
// berjalan kalau sudah tersedia, supaya tidak ikut kepotong cache lokal.
function _renderForecastFromMonthMap(card, txsForSaldo, monthMap, txsForTopCat) {
    const months = Object.keys(monthMap).sort();
    if (months.length === 0) { card.innerHTML = _forecastEmpty(); return; }

    // ── Bulan berjalan (dipakai untuk basis & tren) ──
    const now = new Date();
    const thisKey  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // [BUG FIX - RATA-RATA IKUT BULAN BERJALAN YANG BELUM SELESAI] Sebelumnya
    // basis = months.slice(-6) ikut memasukkan bulan INI walau belum selesai
    // (misal baru tanggal 3), sehingga avgInc/avgExp/avgSurplus dan status
    // "Sehat/Waspada/Kritis" jadi bias ke bawah di awal bulan -- data bulan
    // berjalan yang masih sedikit dihitung penuh seolah satu bulan utuh.
    //
    // Perbaikan: basis rata-rata HANYA memakai bulan-bulan yang sudah selesai
    // (bukan bulan berjalan). Kalau belum ada satu pun bulan selesai (user
    // baru mulai pakai app bulan ini), fallback tetap memakai bulan berjalan
    // supaya card tidak kosong, tapi ditandai lewat basisIncludesCurrent
    // supaya UI bisa memberi catatan bahwa datanya belum lengkap.
    const completedMonths = months.filter(k => k !== thisKey);
    let basis, basisIncludesCurrent;
    if (completedMonths.length > 0) {
        basis = completedMonths.slice(-6);
        basisIncludesCurrent = false;
    } else {
        basis = months.slice(-6);
        basisIncludesCurrent = true;
    }
    const totalInc = basis.reduce((s, k) => s + monthMap[k].inc, 0);
    const totalExp = basis.reduce((s, k) => s + monthMap[k].exp, 0);
    const avgInc   = totalInc / basis.length;
    const avgExp   = totalExp / basis.length;
    const avgSurplus = avgInc - avgExp;

    // ── Saldo saat ini ──
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    let saldo = balanceOffset;
    txsForSaldo.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') saldo += amt;
        else saldo -= amt;
    });

    // ── Tren: bulan ini vs bulan lalu ──
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey  = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const thisExp  = (monthMap[thisKey] || {}).exp || 0;
    const prevExp  = (monthMap[prevKey] || {}).exp || 0;
    let tren = null;
    if (prevExp > 0) tren = ((thisExp - prevExp) / prevExp) * 100;

    // ── Proyeksi saldo cukup sampai bulan ke-X ──
    let proyeksiLabel = '';
    let proyeksiBulan = 0;
    if (avgSurplus >= 0) {
        // surplus — saldo terus tumbuh, aman
        proyeksiBulan = 99;
        proyeksiLabel = 'Saldo terus bertumbuh';
    } else {
        // defisit — hitung kapan saldo habis
        if (saldo <= 0) {
            proyeksiBulan = 0;
            proyeksiLabel = 'Saldo sudah negatif';
        } else {
            proyeksiBulan = Math.floor(saldo / Math.abs(avgSurplus));
            if (proyeksiBulan === 0) {
                proyeksiLabel = 'Saldo cukup < 1 bulan';
            } else {
                const targetDate = new Date(now.getFullYear(), now.getMonth() + proyeksiBulan, 1);
                const namaBulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
                proyeksiLabel = `Cukup s/d ${namaBulan[targetDate.getMonth()]} ${targetDate.getFullYear()}`;
            }
        }
    }

    // ── Status kesehatan ──
    const rasio = avgInc > 0 ? avgExp / avgInc : 999;
    let status, statusColor, statusBg, statusIcon;
    if (rasio <= 0.7) {
        status = 'Sehat'; statusColor = '#1F4A38'; statusBg = '#E3F0E9'; statusIcon = '●';
    } else if (rasio <= 0.9) {
        status = 'Waspada'; statusColor = '#6B5320'; statusBg = '#F1EBDA'; statusIcon = '●';
    } else {
        status = 'Kritis'; statusColor = '#7E2E2E'; statusBg = '#F5E6E6'; statusIcon = '●';
    }

    // ── Kategori pengeluaran terbesar bulan ini ──
    const catMap = {};
    txsForTopCat.forEach(t => {
        if (t.type !== 'expense') return;
        const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
        if (!d || isNaN(d)) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key !== thisKey) return;
        const cat = t.category || 'Lainnya';
        catMap[cat] = (catMap[cat] || 0) + (Number(t.amount) || 0);
    });
    const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 2);

    // ── Render ──
    const trenHTML = tren !== null
        ? `<span style="font-size:.65rem; font-weight:600; color:${tren > 0 ? '#7E2E2E' : '#1F4A38'};">
            ${tren > 0 ? '▲' : '▼'} ${Math.abs(tren).toFixed(0)}% vs bln lalu
           </span>`
        : '';

    const topCatHTML = topCat.length > 0
        ? topCat.map(([cat, amt]) =>
            `<span class="fc-tag">${cat} <b>${window.rp ? window.rp(amt) : amt}</b></span>`
          ).join('')
        : '<span class="fc-tag" style="color:#9AA2AC;">—</span>';

    const proyeksiColor = proyeksiBulan >= 6 ? '#1F4A38' : proyeksiBulan >= 3 ? '#6B5320' : '#7E2E2E';
    const basisSubLabel = basisIncludesCurrent
        ? `per bulan (bulan berjalan, belum lengkap)`
        : `per bulan (${basis.length} bln terakhir)`;

    card.innerHTML = `
        <div class="fc-header">
            <div style="display:flex; align-items:center; gap:8px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.6;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                <span>Estimasi Keuangan</span>
            </div>
            <span class="fc-status-badge" style="background:${statusBg}; color:${statusColor};">
                ${statusIcon} ${status}
            </span>
        </div>
        <div class="fc-body">
            <div class="fc-row">
                <div class="fc-metric">
                    <div class="fc-metric-label">Rata-rata Pemasukan</div>
                    <div class="fc-metric-value" style="color:#1F4A38;">${window.rp ? window.rp(avgInc) : avgInc}</div>
                    <div class="fc-metric-sub">${basisSubLabel}</div>
                </div>
                <div class="fc-metric">
                    <div class="fc-metric-label">Rata-rata Pengeluaran</div>
                    <div class="fc-metric-value" style="color:#7E2E2E;">${window.rp ? window.rp(avgExp) : avgExp} ${trenHTML}</div>
                    <div class="fc-metric-sub">${basisSubLabel}</div>
                </div>
            </div>
            <div class="fc-row">
                <div class="fc-metric">
                    <div class="fc-metric-label">Surplus / Defisit</div>
                    <div class="fc-metric-value" style="color:${avgSurplus >= 0 ? '#1F4A38' : '#7E2E2E'};">
                        ${avgSurplus >= 0 ? '+' : ''}${window.rp ? window.rp(avgSurplus) : avgSurplus}
                    </div>
                    <div class="fc-metric-sub">estimasi per bulan</div>
                </div>
                <div class="fc-metric">
                    <div class="fc-metric-label">Proyeksi Saldo</div>
                    <div class="fc-metric-value" style="color:${proyeksiColor};">${proyeksiLabel}</div>
                    <div class="fc-metric-sub">dengan pola pengeluaran saat ini</div>
                </div>
            </div>
            <div class="fc-cats">
                <div class="fc-metric-label" style="margin-bottom:5px;">Pengeluaran terbesar bulan ini</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">${topCatHTML}</div>
            </div>
        </div>
    `;
};

function _forecastEmpty() {
    return `
        <div class="fc-header">
            <div style="display:flex; align-items:center; gap:8px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.6;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                <span>Estimasi Keuangan</span>
            </div>
        </div>
        <div style="padding:18px 0; text-align:center; color:var(--ink-faint); font-size:.72rem;">
            Belum cukup data untuk estimasi
        </div>
    `;
}
