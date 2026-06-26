// ==================== FINANCIAL FORECAST ====================

window.renderForecastCard = function() {
    const card = document.getElementById('forecastCard');
    if (!card) return;

    const txs = window.txs || [];
    if (txs.length === 0) {
        card.innerHTML = _forecastEmpty();
        return;
    }

    // ── Kelompokkan transaksi per bulan ──
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

    const months = Object.keys(monthMap).sort();
    if (months.length === 0) { card.innerHTML = _forecastEmpty(); return; }

    // ── Gunakan maks 6 bulan terakhir sebagai basis ──
    const basis = months.slice(-6);
    const totalInc = basis.reduce((s, k) => s + monthMap[k].inc, 0);
    const totalExp = basis.reduce((s, k) => s + monthMap[k].exp, 0);
    const avgInc   = totalInc / basis.length;
    const avgExp   = totalExp / basis.length;
    const avgSurplus = avgInc - avgExp;

    // ── Saldo saat ini ──
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    let saldo = balanceOffset;
    txs.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') saldo += amt;
        else saldo -= amt;
    });

    // ── Tren: bulan ini vs bulan lalu ──
    const now = new Date();
    const thisKey  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
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
        status = 'Sehat'; statusColor = '#0F6E56'; statusBg = '#E1F5EE'; statusIcon = '●';
    } else if (rasio <= 0.9) {
        status = 'Waspada'; statusColor = '#854F0B'; statusBg = '#FAEEDA'; statusIcon = '●';
    } else {
        status = 'Kritis'; statusColor = '#993C1D'; statusBg = '#FAECE7'; statusIcon = '●';
    }

    // ── Kategori pengeluaran terbesar bulan ini ──
    const catMap = {};
    txs.forEach(t => {
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
        ? `<span style="font-size:.65rem; font-weight:600; color:${tren > 0 ? '#993C1D' : '#0F6E56'};">
            ${tren > 0 ? '▲' : '▼'} ${Math.abs(tren).toFixed(0)}% vs bln lalu
           </span>`
        : '';

    const topCatHTML = topCat.length > 0
        ? topCat.map(([cat, amt]) =>
            `<span class="fc-tag">${cat} <b>${window.rp ? window.rp(amt) : amt}</b></span>`
          ).join('')
        : '<span class="fc-tag" style="color:#aaa;">—</span>';

    const proyeksiColor = proyeksiBulan >= 6 ? '#0F6E56' : proyeksiBulan >= 3 ? '#854F0B' : '#993C1D';

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
                    <div class="fc-metric-value" style="color:#0F6E56;">${window.rp ? window.rp(avgInc) : avgInc}</div>
                    <div class="fc-metric-sub">per bulan (${basis.length} bln terakhir)</div>
                </div>
                <div class="fc-metric">
                    <div class="fc-metric-label">Rata-rata Pengeluaran</div>
                    <div class="fc-metric-value" style="color:#993C1D;">${window.rp ? window.rp(avgExp) : avgExp} ${trenHTML}</div>
                    <div class="fc-metric-sub">per bulan (${basis.length} bln terakhir)</div>
                </div>
            </div>
            <div class="fc-row">
                <div class="fc-metric">
                    <div class="fc-metric-label">Surplus / Defisit</div>
                    <div class="fc-metric-value" style="color:${avgSurplus >= 0 ? '#0F6E56' : '#993C1D'};">
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
