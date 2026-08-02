// ==================== EXPENSE CHART (Pengeluaran per Kategori) ====================
window._EXPENSE_CHART_COLORS = [
    '#1B2A4A', '#9C7A2E', '#2E6B4F', '#A13A3A', '#4A5578',
    '#3E5C82', '#A9832E', '#5C8A6E', '#8B5E5A', '#5B6472',
    '#7691BE', '#6B5B8C', '#7D8A9A', '#C9A159', '#2E5C82'
];

window.toggleExpenseChart = function() {
    const body = document.getElementById('expenseChartBody');
    const arrow = document.getElementById('expenseChartArrow');
    const toggleBtns = document.getElementById('expenseChartToggleButtons');
    window.expenseChartVisible = body.style.display === 'none';
    if (window.expenseChartVisible) {
        body.style.display = 'flex';
        arrow.textContent = window.t('hide');
        toggleBtns.style.display = 'flex';
        window.renderExpenseChart();
    } else {
        body.style.display = 'none';
        arrow.textContent = window.t('show');
        toggleBtns.style.display = 'none';
    }
};

window.setExpenseChartMode = function(mode) {
    window.expenseChartMode = mode;
    document.getElementById('expChartBtnAll').classList.toggle('active', mode === 'all');
    document.getElementById('expChartBtnMonth').classList.toggle('active', mode === 'month');
    window.renderExpenseChart();
};

window.renderExpenseChart = function() {
    window._expenseChartInitialized = true;
    const body = document.getElementById('expenseChartBody');
    if (!body) return;

    // [PERF] Chart.js sekarang dimuat lazy (lihat js/config.js:
    // loadScriptOnce), bukan lewat <script defer> statis di setiap load
    // app. Kalau library belum siap, tampilkan status sebentar, muat
    // library-nya, lalu panggil ulang fungsi ini begitu selesai.
    if (typeof Chart === 'undefined') {
        body.innerHTML = '<div class="expense-chart-empty">Memuat grafik…</div>';
        window.loadScriptOnce(window.CHART_JS_URL).then(() => {
            window.renderExpenseChart();
        }).catch((err) => {
            console.error('[ExpenseChart] Gagal memuat chart.js:', err);
            body.innerHTML = '<div class="expense-chart-empty">Gagal memuat grafik. Periksa koneksi internet.</div>';
        });
        return;
    }

    const now = new Date();
    let source = window.txs.filter(t => t.type === 'expense');
    if (window.expenseChartMode === 'month') {
        source = source.filter(t => {
            const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
        });
    }

    const catMap = {};
    source.forEach(t => {
        const cat = t.category || 'Lainnya';
        catMap[cat] = (catMap[cat] || 0) + (Number(t.amount) || 0);
    });
    const entries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);

    if (entries.length === 0 || total <= 0) {
        body.innerHTML = '<div class="expense-chart-empty">'+window.t('no_expense_data')+'</div>';
        if (window.expenseChart) { window.expenseChart.destroy(); window.expenseChart = null; }
        return;
    }

    body.innerHTML = `
        <div class="expense-chart-canvas-wrap"><canvas id="expenseChartCanvas"></canvas></div>
        <div class="expense-chart-legend" id="expenseChartLegend"></div>
    `;

    const labels = entries.map(([c]) => c);
    const values = entries.map(([, v]) => v);
    const colors = labels.map((_, i) => window._EXPENSE_CHART_COLORS[i % window._EXPENSE_CHART_COLORS.length]);

    const legend = document.getElementById('expenseChartLegend');
    legend.innerHTML = entries.map(([cat, val], i) => {
        const pct = total > 0 ? Math.round((val / total) * 100) : 0;
        return `
            <div class="legend-item">
                <span class="legend-dot" style="background:${colors[i]};"></span>
                <span class="legend-label">${window.escapeHtml(cat)}</span>
                <span class="legend-amount">${window.rp(val)}</span>
                <span class="legend-pct">${pct}%</span>
            </div>`;
    }).join('');

    const ctx = document.getElementById('expenseChartCanvas').getContext('2d');
    if (window.expenseChart) window.expenseChart.destroy();
    window.expenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(item) {
                            const v = item.parsed;
                            const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                            return `${item.label}: ${window.rp(v)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
};
