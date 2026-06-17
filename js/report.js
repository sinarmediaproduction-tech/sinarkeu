// ============================================================
// report.js — Sinarkeu: Laporan & Export PDF Profesional
// ============================================================

// ── Helper ──────────────────────────────────────────────────
function fmtRp(n) {
  if (n == null || isNaN(n)) return 'Rp 0';
  const abs = Math.abs(n);
  const str = 'Rp ' + abs.toLocaleString('id-ID');
  return n < 0 ? '-' + str : str;
}

function fmtDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function monthName(m) {
  const names = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return names[+m] || '';
}

function nowStr() {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ── Generate Laporan (tampilan dalam modal) ──────────────────
function generateMonthlyReport() {
  const month = parseInt(document.getElementById('reportMonth').value);
  const year  = parseInt(document.getElementById('reportYear').value);
  const key   = `${year}-${String(month).padStart(2, '0')}`;

  const allTx    = (window.txs || []).filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === year && (d.getMonth() + 1) === month;
  });

  const income   = allTx.filter(t => t.type === 'income').reduce((s, t) => s + (+t.amount || 0), 0);
  const expense  = allTx.filter(t => t.type === 'expense').reduce((s, t) => s + (+t.amount || 0), 0);
  const balance  = income - expense;

  // Pengeluaran per kategori
  const catMap = {};
  allTx.filter(t => t.type === 'expense').forEach(t => {
    const c = t.category || 'Lainnya';
    catMap[c] = (catMap[c] || 0) + (+t.amount || 0);
  });
  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  // Anggaran bulan ini
  const budgets = (window.budgets && window.budgets[key]) ? window.budgets[key] : {};
  const totalBudget = Object.values(budgets).reduce((s, v) => s + (+v || 0), 0);

  // Buat HTML untuk modal
  const _book   = (window.books || []).find(b => b.id === window.currentBookId);
  const bookName = _book ? _book.name : 'Buku Kas';
  const accName  = document.getElementById('activeAccountLabel')?.textContent || '';

  let catRows = cats.length
    ? cats.map(([c, v]) => {
        const budget = budgets[c] || 0;
        const pct    = budget > 0 ? Math.min(100, Math.round(v / budget * 100)) : null;
        const bar    = budget > 0
          ? `<div style="height:6px;border-radius:3px;background:#eee;margin-top:3px;">
               <div style="height:6px;border-radius:3px;background:${pct >= 100 ? '#de350b' : pct >= 80 ? '#ff991f' : '#00875a'};width:${pct}%;"></div>
             </div>` : '';
        return `<tr>
          <td style="padding:8px 10px;">${c}</td>
          <td style="padding:8px 10px; text-align:right;">${fmtRp(v)}</td>
          <td style="padding:8px 10px; text-align:right; color:#888;">${budget > 0 ? fmtRp(budget) : '—'}</td>
          <td style="padding:8px 10px; width:100px;">${budget > 0 ? `${pct}%${bar}` : '—'}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="4" style="padding:16px; text-align:center; color:#aaa;">Tidak ada pengeluaran</td></tr>`;

  document.getElementById('reportContent').innerHTML = `
    <div style="font-family:'Inter',sans-serif; color:#1a1a1a;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
        <div>
          <div style="font-size:.75rem; color:#888;">${accName} · ${bookName}</div>
          <div style="font-size:1.05rem; font-weight:700;">${monthName(month)} ${year}</div>
        </div>
        <div style="font-size:.7rem; color:#aaa;">Dibuat: ${nowStr()}</div>
      </div>

      <!-- Summary cards -->
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:20px;">
        <div style="background:#e3fcef; border:1.5px solid #57d9a3; border-radius:10px; padding:14px 16px;">
          <div style="font-size:.65rem; color:#006644; font-weight:600; text-transform:uppercase; letter-spacing:.5px;">Total Pemasukan</div>
          <div style="font-size:1rem; font-weight:700; color:#006644; margin-top:4px;">${fmtRp(income)}</div>
        </div>
        <div style="background:#fff0f0; border:1.5px solid #ff8f73; border-radius:10px; padding:14px 16px;">
          <div style="font-size:.65rem; color:#bf2600; font-weight:600; text-transform:uppercase; letter-spacing:.5px;">Total Pengeluaran</div>
          <div style="font-size:1rem; font-weight:700; color:#bf2600; margin-top:4px;">${fmtRp(expense)}</div>
        </div>
        <div style="background:${balance >= 0 ? '#e8f0fe' : '#fff0f0'}; border:1.5px solid ${balance >= 0 ? '#4a86e8' : '#ff8f73'}; border-radius:10px; padding:14px 16px;">
          <div style="font-size:.65rem; color:${balance >= 0 ? '#174ea6' : '#bf2600'}; font-weight:600; text-transform:uppercase; letter-spacing:.5px;">Saldo Bersih</div>
          <div style="font-size:1rem; font-weight:700; color:${balance >= 0 ? '#174ea6' : '#bf2600'}; margin-top:4px;">${fmtRp(balance)}</div>
        </div>
      </div>

      ${totalBudget > 0 ? `
      <div style="background:#fffbe6; border:1.5px solid #ffe58f; border-radius:10px; padding:12px 16px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:.65rem; color:#874d00; font-weight:600;">Total Anggaran Bulan Ini</div>
          <div style="font-size:.95rem; font-weight:700; color:#874d00;">${fmtRp(totalBudget)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:.65rem; color:#874d00; font-weight:600;">Sisa Anggaran</div>
          <div style="font-size:.95rem; font-weight:700; color:${totalBudget - expense >= 0 ? '#006644' : '#bf2600'};">${fmtRp(totalBudget - expense)}</div>
        </div>
      </div>` : ''}

      <!-- Kategori -->
      <div style="font-size:.78rem; font-weight:700; margin-bottom:8px; color:#555; text-transform:uppercase; letter-spacing:.5px;">Pengeluaran per Kategori</div>
      <div style="border:1.5px solid #e0e0e0; border-radius:10px; overflow:hidden; margin-bottom:20px;">
        <table style="width:100%; border-collapse:collapse; font-size:.78rem;">
          <thead>
            <tr style="background:#f5f5f5; text-align:left;">
              <th style="padding:8px 10px; font-weight:600;">Kategori</th>
              <th style="padding:8px 10px; font-weight:600; text-align:right;">Realisasi</th>
              <th style="padding:8px 10px; font-weight:600; text-align:right;">Anggaran</th>
              <th style="padding:8px 10px; font-weight:600;">Progress</th>
            </tr>
          </thead>
          <tbody>${catRows}</tbody>
        </table>
      </div>

      <!-- Daftar transaksi -->
      <div style="font-size:.78rem; font-weight:700; margin-bottom:8px; color:#555; text-transform:uppercase; letter-spacing:.5px;">Daftar Transaksi (${allTx.length} transaksi)</div>
      <div style="border:1.5px solid #e0e0e0; border-radius:10px; overflow:hidden;">
        <table style="width:100%; border-collapse:collapse; font-size:.75rem;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:8px 10px; text-align:left; font-weight:600;">Tanggal</th>
              <th style="padding:8px 10px; text-align:left; font-weight:600;">Kategori</th>
              <th style="padding:8px 10px; text-align:left; font-weight:600;">Deskripsi</th>
              <th style="padding:8px 10px; text-align:right; font-weight:600;">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            ${allTx.length
              ? allTx.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
                  .map((t, i) => `
                    <tr style="background:${i % 2 === 0 ? '#fff' : '#fafafa'}; border-top:1px solid #f0f0f0;">
                      <td style="padding:7px 10px; white-space:nowrap;">${fmtDate(t.date)}</td>
                      <td style="padding:7px 10px;">${t.category || (t.type === 'income' ? 'Pemasukan' : 'Lainnya')}</td>
                      <td style="padding:7px 10px; color:#444;">${t.description || '-'}</td>
                      <td style="padding:7px 10px; text-align:right; font-weight:600; color:${t.type === 'income' ? '#006644' : '#bf2600'};">
                        ${t.type === 'income' ? '+' : '-'}${fmtRp(t.amount)}
                      </td>
                    </tr>`)
                  .join('')
              : `<tr><td colspan="4" style="padding:16px; text-align:center; color:#aaa;">Tidak ada transaksi</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Export PDF Profesional ───────────────────────────────────
function exportReportAsPDF() {
  const month    = parseInt(document.getElementById('reportMonth').value);
  const year     = parseInt(document.getElementById('reportYear').value);
  const key      = `${year}-${String(month).padStart(2, '0')}`;
  const _book2   = (window.books || []).find(b => b.id === window.currentBookId);
  const bookName = _book2 ? _book2.name : 'Buku Kas';
  const accName  = document.getElementById('activeAccountLabel')?.textContent?.trim() || 'Sinarkeu';

  const allTx   = (window.txs || []).filter(t => {
    const d = new Date(t.date);
    return d.getFullYear() === year && (d.getMonth() + 1) === month;
  });

  const income  = allTx.filter(t => t.type === 'income').reduce((s, t) => s + (+t.amount || 0), 0);
  const expense = allTx.filter(t => t.type === 'expense').reduce((s, t) => s + (+t.amount || 0), 0);
  const balance = income - expense;

  const catMap = {};
  allTx.filter(t => t.type === 'expense').forEach(t => {
    const c = t.category || 'Lainnya';
    catMap[c] = (catMap[c] || 0) + (+t.amount || 0);
  });
  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const budgets = (window.budgets && window.budgets[key]) ? window.budgets[key] : {};
  const totalBudget = Object.values(budgets).reduce((s, v) => s + (+v || 0), 0);

  // ── Sorted transactions ──────────────────────────────────
  const sorted = allTx.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

  // ── Row helpers ──────────────────────────────────────────
  const txRows = sorted.map((t, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9f9f9'};">
      <td class="center">${i + 1}</td>
      <td>${fmtDate(t.date)}</td>
      <td>${t.category || (t.type === 'income' ? 'Pemasukan' : 'Lainnya')}</td>
      <td>${t.description || '-'}</td>
      <td class="money income">${t.type === 'income' ? fmtRp(t.amount) : ''}</td>
      <td class="money expense">${t.type === 'expense' ? fmtRp(t.amount) : ''}</td>
    </tr>`).join('');

  const catRows = cats.map(([ c, v ]) => {
    const bud = budgets[c] || 0;
    const pct = bud > 0 ? Math.min(100, Math.round(v / bud * 100)) : null;
    const barColor = pct === null ? '#ccc' : pct >= 100 ? '#de350b' : pct >= 80 ? '#ff991f' : '#00875a';
    return `
      <tr>
        <td>${c}</td>
        <td class="money expense">${fmtRp(v)}</td>
        <td class="money">${bud > 0 ? fmtRp(bud) : '—'}</td>
        <td class="center">${bud > 0 ? `${pct}%` : '—'}</td>
        <td style="padding:5.5px 6px;">
          ${bud > 0 ? `<div style="height:7px;border-radius:4px;background:#eee;">
            <div style="height:7px;border-radius:4px;background:${barColor};width:${pct}%;"></div>
          </div>` : ''}
        </td>
      </tr>`;
  }).join('') || `<tr><td colspan="5" class="center muted">Tidak ada pengeluaran bulan ini</td></tr>`;

  // ── HTML dokumen PDF ─────────────────────────────────────
  const html = `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 210mm;
    max-width: 210mm;
    overflow-x: hidden;
  }
  body {
    font-family: 'Inter', Arial, sans-serif;
    font-size: 9pt;
    color: #1a1a1a;
    background: #fff;
    padding: 0;
  }
  table { table-layout: fixed; }

  /* ── Cover Header ── */
  .doc-header {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
    color: #fff;
    padding: 28px 32px 22px;
    position: relative;
    overflow: hidden;
  }
  .doc-header::after {
    content: '';
    position: absolute;
    right: -40px; top: -40px;
    width: 200px; height: 200px;
    border-radius: 50%;
    background: rgba(255,255,255,0.04);
  }
  .doc-header .brand {
    font-size: 9pt;
    font-weight: 600;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: rgba(255,255,255,0.55);
    margin-bottom: 6px;
  }
  .doc-header h1 {
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: -0.5px;
    line-height: 1.1;
  }
  .doc-header .meta {
    margin-top: 10px;
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }
  .doc-header .meta span {
    font-size: 8pt;
    color: rgba(255,255,255,0.65);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .doc-header .meta span b { color: rgba(255,255,255,0.9); font-weight: 600; }

  /* ── Content ── */
  .content { padding: 22px 32px 16px; }

  /* ── Section title ── */
  .section-title {
    font-size: 7pt;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: #666;
    border-bottom: 1.5px solid #e0e0e0;
    padding-bottom: 5px;
    margin: 18px 0 10px;
  }
  .section-title:first-child { margin-top: 0; }

  /* ── KPI Cards ── */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-bottom: 4px;
  }
  .kpi {
    border-radius: 8px;
    padding: 12px 14px;
    border-left: 3px solid transparent;
  }
  .kpi-income { background: #e8f8f0; border-color: #00875a; }
  .kpi-expense { background: #fff1ee; border-color: #de350b; }
  .kpi-balance-pos { background: #e8f0fe; border-color: #1a73e8; }
  .kpi-balance-neg { background: #fff1ee; border-color: #de350b; }
  .kpi .label {
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: .8px;
    text-transform: uppercase;
    margin-bottom: 4px;
    color: #555;
  }
  .kpi .value {
    font-size: 12pt;
    font-weight: 700;
  }
  .kpi-income .value { color: #006644; }
  .kpi-expense .value { color: #bf2600; }
  .kpi-balance-pos .value { color: #1155cc; }
  .kpi-balance-neg .value { color: #bf2600; }

  /* ── Budget Alert ── */
  .budget-alert {
    background: #fffbe6;
    border: 1px solid #ffe58f;
    border-radius: 8px;
    padding: 10px 14px;
    margin: 10px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8.5pt;
  }
  .budget-alert .ba-label { color: #874d00; font-weight: 600; }
  .budget-alert .ba-value { font-size: 10pt; font-weight: 700; color: #874d00; }
  .budget-alert .ba-sisa { text-align: right; }

  /* ── Tables ── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 7.5pt;
  }
  th {
    background: #f0f2f5;
    padding: 6px 6px;
    font-weight: 700;
    font-size: 7pt;
    text-align: left;
    border-bottom: 2px solid #d0d5dd;
    word-break: break-word;
  }
  td {
    padding: 5.5px 6px;
    border-bottom: 1px solid #f0f0f0;
    vertical-align: middle;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  tr:last-child td { border-bottom: none; }
  .money { text-align: right; font-family: 'Courier New', monospace; }
  .income { color: #006644; font-weight: 600; }
  .expense { color: #bf2600; font-weight: 600; }
  .center { text-align: center; }
  .muted { color: #aaa; }

  /* ── Table wrapper ── */
  .tbl-wrap {
    border: 1.5px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;
  }

  /* ── Summary row ── */
  .tbl-foot td {
    background: #f0f2f5;
    font-weight: 700;
    border-top: 2px solid #d0d5dd;
    border-bottom: none;
    padding: 8px 9px;
  }

  /* ── Footer ── */
  .doc-footer {
    margin: 20px 32px 0;
    padding: 10px 0 14px;
    border-top: 1px solid #e0e0e0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7pt;
    color: #aaa;
  }
  .doc-footer .watermark {
    font-weight: 700;
    color: #ccc;
    letter-spacing: 1px;
    text-transform: uppercase;
    font-size: 7pt;
  }
</style>
</head>
<body>

<!-- ── HEADER ── -->
<div class="doc-header">
  <div class="brand">Sinarkeu · Laporan Keuangan</div>
  <h1>${monthName(month)} ${year}</h1>
  <div class="meta">
    <span>📁 Buku Kas: <b>${bookName}</b></span>
    <span>👤 Akun: <b>${accName}</b></span>
    <span>📅 Dicetak: <b>${nowStr()}</b></span>
    <span>📊 Total Transaksi: <b>${allTx.length}</b></span>
  </div>
</div>

<div class="content">

  <!-- ── KPI ── -->
  <div class="section-title">Ringkasan Keuangan</div>
  <div class="kpi-grid">
    <div class="kpi kpi-income">
      <div class="label">💰 Total Pemasukan</div>
      <div class="value">${fmtRp(income)}</div>
    </div>
    <div class="kpi kpi-expense">
      <div class="label">💸 Total Pengeluaran</div>
      <div class="value">${fmtRp(expense)}</div>
    </div>
    <div class="kpi ${balance >= 0 ? 'kpi-balance-pos' : 'kpi-balance-neg'}">
      <div class="label">📈 Saldo Bersih</div>
      <div class="value">${fmtRp(balance)}</div>
    </div>
  </div>

  ${totalBudget > 0 ? `
  <div class="budget-alert">
    <div>
      <div class="ba-label">🎯 Anggaran Bulan Ini</div>
      <div class="ba-value">${fmtRp(totalBudget)}</div>
    </div>
    <div class="ba-sisa">
      <div class="ba-label">Terpakai</div>
      <div class="ba-value">${Math.round(expense / totalBudget * 100)}%</div>
    </div>
    <div class="ba-sisa">
      <div class="ba-label">Sisa Anggaran</div>
      <div class="ba-value" style="color:${totalBudget - expense >= 0 ? '#006644' : '#bf2600'};">${fmtRp(totalBudget - expense)}</div>
    </div>
  </div>` : ''}

  <!-- ── KATEGORI ── -->
  <div class="section-title">Pengeluaran per Kategori</div>
  <div class="tbl-wrap">
    <table>
      <thead>
        <tr>
          <th style="width:32%;">Kategori</th>
          <th class="money" style="width:20%;">Realisasi</th>
          <th class="money" style="width:20%;">Anggaran</th>
          <th class="center" style="width:10%;">%</th>
          <th style="width:18%;">Progress</th>
        </tr>
      </thead>
      <tbody>${catRows}</tbody>
      <tfoot>
        <tr class="tbl-foot">
          <td><b>TOTAL PENGELUARAN</b></td>
          <td class="money expense"><b>${fmtRp(expense)}</b></td>
          <td class="money"><b>${totalBudget > 0 ? fmtRp(totalBudget) : '—'}</b></td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- ── TRANSAKSI ── -->
  <div class="section-title" style="margin-top:20px;">Daftar Transaksi</div>
  <div class="tbl-wrap">
    <table>
      <thead>
        <tr>
          <th class="center" style="width:6%;">No</th>
          <th style="width:14%;">Tanggal</th>
          <th style="width:18%;">Kategori</th>
          <th style="width:32%;">Deskripsi</th>
          <th class="money" style="width:15%;">Pemasukan</th>
          <th class="money" style="width:15%;">Pengeluaran</th>
        </tr>
      </thead>
      <tbody>${txRows || `<tr><td colspan="6" class="center muted" style="padding:14px;">Tidak ada transaksi bulan ini</td></tr>`}</tbody>
      <tfoot>
        <tr class="tbl-foot">
          <td colspan="4" style="text-align:right;"><b>TOTAL</b></td>
          <td class="money income"><b>${fmtRp(income)}</b></td>
          <td class="money expense"><b>${fmtRp(expense)}</b></td>
        </tr>
        <tr class="tbl-foot">
          <td colspan="4" style="text-align:right;"><b>SALDO BERSIH</b></td>
          <td colspan="2" class="money" style="color:${balance >= 0 ? '#006644' : '#bf2600'};"><b>${fmtRp(balance)}</b></td>
        </tr>
      </tfoot>
    </table>
  </div>

</div><!-- /content -->

<!-- ── FOOTER ── -->
<div class="doc-footer">
  <div>Laporan ini dibuat secara otomatis oleh sistem Sinarkeu.<br>Dokumen ini bersifat rahasia dan hanya untuk keperluan internal.</div>
  <div class="watermark">Sinarkeu</div>
</div>

</body>
</html>`;

  // ── Render ke iframe tersembunyi lalu export ─────────────
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:210mm;height:297mm;border:none;';
  document.body.appendChild(iframe);

  const iDoc = iframe.contentDocument || iframe.contentWindow.document;
  iDoc.open(); iDoc.write(html); iDoc.close();

  // Tunggu font/gambar load
  setTimeout(() => {
    const opt = {
      margin:      [0, 0, 0, 0],
      filename:    `Sinarkeu_${bookName.replace(/\s+/g, '_')}_${monthName(month)}_${year}.pdf`,
      image:       { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#fff' },
      jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak:   { mode: ['avoid-all', 'css', 'legacy'] }
    };

    if (typeof html2pdf !== 'undefined') {
      html2pdf()
        .set(opt)
        .from(iframe.contentDocument.body)
        .save()
        .then(() => document.body.removeChild(iframe));
    } else {
      // Fallback: print dialog
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 2000);
    }
  }, 600);
}
