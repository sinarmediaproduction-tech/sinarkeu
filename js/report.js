// ==================== REPORT ====================
window.openMonthlyReport = function() {
    let m = document.getElementById('budgetMonth').value;
    let y = document.getElementById('budgetYear').value;
    document.getElementById('reportMonth').value = m;
    document.getElementById('reportYear').value = y;
    window.openModal('monthlyReportModal');
    window.generateMonthlyReport();
};
window.generateMonthlyReport = function() {
    let m = parseInt(document.getElementById('reportMonth').value);
    let y = parseInt(document.getElementById('reportYear').value);
    let monthsText = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    document.getElementById('reportModalTitle').innerText = `📊 Laporan Bulanan - ${monthsText[m - 1]} ${y}`;
    const effective = window.getEffectiveBudget(y, m, window.currentBookId);
    const budgetMap = effective.budget;
    const source = effective.source;
    let actualMap = {};
    window.EXPENSE_CATEGORIES.forEach(c => actualMap[c] = 0);
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        let d = new Date(t.date);
        if ((d.getMonth() + 1) === m && d.getFullYear() === y) {
            let amt = Number(t.amount) || 0;
            if (t.type === 'income') totalInc += amt;
            else {
                totalExp += amt;
                if (actualMap[t.category] !== undefined) actualMap[t.category] += amt;
                else actualMap['Lain-lain'] += amt;
            }
        }
    });
    let html = `
        <div class="report-stats">
            <div class="report-stat-card"><div class="report-stat-label">Pemasukan Bulanan</div><div class="report-stat-value" style="color:#00875a">${window.rp(totalInc)}</div></div>
            <div class="report-stat-card"><div class="report-stat-label">Pengeluaran Bulanan</div><div class="report-stat-value" style="color:#de350b">${window.rp(totalExp)}</div></div>
            <div class="report-stat-card"><div class="report-stat-label">Selisih Kas Bulanan</div><div class="report-stat-value">${window.rp(totalInc - totalExp)}</div></div>
        </div>
        <div style="font-size:.7rem; color:#666; margin-bottom:12px; padding:6px 12px; background:#f5f5f5; border-radius:6px;">
            Sumber Anggaran: ${source === 'custom' ? '📌 Khusus bulan ini' : (source === 'default' ? '🏠 Anggaran Dasar' : 'Tidak ada')}
        </div>
        <div class="chart-container"><canvas id="reportChartCanvas"></canvas></div>
        <div class="report-table-wrap">
        <table class="report-table">
            <thead><tr><th>Kategori Pengeluaran</th><th>Target Anggaran</th><th>Realisasi</th><th>Sisa / Lebih</th><th>Persentase</th></tr></thead>
            <tbody>
    `;
    let chartLabels = [];
    let chartTargetData = [];
    let chartActualData = [];
    window.EXPENSE_CATEGORIES.forEach(cat => {
        let tar = budgetMap[cat] || 0;
        let act = actualMap[cat] || 0;
        let diff = tar - act;
        let pct = tar > 0 ? ((act / tar) * 100).toFixed(0) + '%' : (act > 0 ? '100%' : '0%');
        let diffStyle = diff >= 0 ? 'color:#00875a' : 'color:#de350b';
        if (tar > 0 || act > 0) {
            const shortLabel = { 'Makanan & Minuman': 'Makanan', 'Transportasi': 'Transport', 'Belanja': 'Belanja', 'Tagihan': 'Tagihan', 'Hiburan': 'Hiburan', 'Kesehatan': 'Kesehatan', 'Pendidikan': 'Pendidikan', 'Investasi': 'Investasi' };
            chartLabels.push(shortLabel[cat] || cat);
            chartTargetData.push(tar);
            chartActualData.push(act);
        }
        html += `<tr><td>${window.escapeHtml(cat)}</td><td>${window.rp(tar)}</td><td>${window.rp(act)}</td><td style="${diffStyle}">${window.rp(diff)}</td><td>${pct}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    document.getElementById('reportContent').innerHTML = html;
    if (chartLabels.length === 0) { chartLabels = ['Belum ada Anggaran']; chartTargetData = [0]; chartActualData = [0]; }
    setTimeout(() => {
        let ctx = document.getElementById('reportChartCanvas').getContext('2d');
        if (window.reportChart) window.reportChart.destroy();
        window.reportChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: chartLabels, datasets: [{ label: 'Target Anggaran', data: chartTargetData, backgroundColor: '#4a5568' }, { label: 'Realisasi Aktual', data: chartActualData, backgroundColor: '#de350b' }] },
            options: { responsive: true, scales: { y: { beginAtZero: true } } }
        });
    }, 100);
};
window.exportReportAsPDF = function() {
    let element = document.getElementById('reportContent');
    let titleText = document.getElementById('reportModalTitle').innerText;
    let opt = { margin: 10, filename: titleText + '.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
    html2pdf().set(opt).from(element).save();
};
window.generatePDFReport = function() {
    let element = document.querySelector('.table-container');
    let opt = { margin: 10, filename: 'Sinarkeu-Daftar-Transaksi-' + window.currentBookId + '.pdf', image: { type: 'jpeg', quality: 0.95 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' } };
    html2pdf().set(opt).from(element).save();
};

// Expense Chart
window.renderExpenseChart = function() {
    const body = document.getElementById('expenseChartBody');
    if (!body) return;
    let source = window.txs.filter(t => t.type === 'expense');
    if (window.expenseChartMode === 'month') {
        const now = new Date();
        const yy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const prefix = `${yy}-${mm}`;
        source = source.filter(t => (t.date || '').startsWith(prefix));
    }
    const map = {};
    source.forEach(t => {
        const cat = t.category || 'Lainnya';
        map[cat] = (map[cat] || 0) + (Number(t.amount) || 0);
    });
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
        if (window.expenseChart) { window.expenseChart.destroy(); window.expenseChart = null; }
        body.innerHTML = '<div class="expense-chart-empty">Belum ada data pengeluaran' + (window.expenseChartMode === 'month' ? ' bulan ini' : '') + '</div>';
        return;
    }
    const total = entries.reduce((s, e) => s + e[1], 0);
    const COLORS = ['#de350b','#cc7b00','#0052cc','#00875a','#6554c0','#ff5630','#ff8b00','#36b37e','#00b8d9','#8777d9','#f6c90e','#4a5568','#e84393','#57d9a3','#ff7452'];
    body.innerHTML = '';
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'expense-chart-canvas-wrap';
    const canvas = document.createElement('canvas');
    canvas.id = 'expenseChartCanvas';
    canvasWrap.appendChild(canvas);
    body.appendChild(canvasWrap);
    const legend = document.createElement('div');
    legend.className = 'expense-chart-legend';
    entries.forEach(([cat, amt], i) => {
        const pct = total > 0 ? ((amt / total) * 100).toFixed(1) : 0;
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
            <div class="legend-dot" style="background:${COLORS[i % COLORS.length]}"></div>
            <span class="legend-label" title="${window.escapeHtml(cat)}">${window.escapeHtml(cat)}</span>
            <span class="legend-amount">${window.rp(amt)}</span>
            <span class="legend-pct">${pct}%</span>
        `;
        legend.appendChild(item);
    });
    body.appendChild(legend);
    if (window.expenseChart) { window.expenseChart.destroy(); window.expenseChart = null; }
    const ctx = canvas.getContext('2d');
    window.expenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]), backgroundColor: entries.map((_, i) => COLORS[i % COLORS.length]), borderWidth: 2, borderColor: '#fff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => { const val = ctx.parsed; const totalData = ctx.dataset.data.reduce((a, b) => a + b, 0); const pct = totalData > 0 ? ((val / totalData) * 100).toFixed(1) : 0; return ` ${window.rp(val)} (${pct}%)`; } } } } }
    });
    window._expenseChartInitialized = true;
};
window.toggleExpenseChart = function() {
    window.expenseChartVisible = !window.expenseChartVisible;
    const body = document.getElementById('expenseChartBody');
    const arrow = document.getElementById('expenseChartArrow');
    const toggleBtns = document.getElementById('expenseChartToggleButtons');
    body.style.display = window.expenseChartVisible ? 'flex' : 'none';
    toggleBtns.style.display = window.expenseChartVisible ? 'flex' : 'none';
    arrow.textContent = window.expenseChartVisible ? '▲ Sembunyikan' : '▼ Tampilkan';
    if (window.expenseChartVisible) window.renderExpenseChart();
};
window.setExpenseChartMode = function(mode) {
    window.expenseChartMode = mode;
    document.getElementById('expChartBtnAll').classList.toggle('active', mode === 'all');
    document.getElementById('expChartBtnMonth').classList.toggle('active', mode === 'month');
    if (window.expenseChartVisible) window.renderExpenseChart();
};