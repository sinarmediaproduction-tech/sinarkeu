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
async function generateMonthlyReport() {
  const month = parseInt(document.getElementById('reportMonth').value);
  const year  = parseInt(document.getElementById('reportYear').value);
  const key   = `${year}-${String(month).padStart(2, '0')}`;

  // [FIX] window.txs cuma menyimpan MAX_LOCAL_TXS (1000) transaksi TERBARU
  // (lihat trimAndSaveLocal di transaction.js) -- kalau buku ini sudah punya
  // lebih dari itu, bulan-bulan lama akan tersaring habis dari window.txs dan
  // laporan bulan itu akan tampil KOSONG/kurang padahal transaksinya ada,
  // cuma saldo total yang tetap benar (lewat balance_offset). Untuk laporan
  // bulan spesifik, selalu tarik langsung dari cloud kalau online -- ini
  // query per-bulan jadi jauh lebih murah dan tidak kena batas 1000 itu.
  // Offline: tetap fallback ke window.txs (best effort, mungkin tidak
  // lengkap untuk bulan yang sudah di luar cache lokal).
  const reportContentEl = document.getElementById('reportContent');
  // [FALLBACK-INDICATOR] allTxIsFallback = true kalau data yang dipakai laporan
  // ini BUKAN dari query cloud per-bulan (cloudTx null karena offline, gagal,
  // atau timeout -- lihat auth.js/db.js) melainkan dari window.txs lokal yang
  // difilter. window.txs cuma menyimpan MAX_LOCAL_TXS (1000) transaksi
  // terbaru, jadi kalau buku ini sudah lebih dari itu, laporan bulan lama bisa
  // tampil kurang lengkap. User perlu tahu ini lewat banner, bukan diam-diam.
  let allTx, allTxIsFallback = false;
  if (window.isOnline() && typeof window.fetchMonthTransactionsFromCloud === 'function') {
    if (reportContentEl) reportContentEl.innerHTML = '<div style="padding:24px;text-align:center;color:#9AA2AC;">Memuat laporan...</div>';
    const cloudTx = await window.fetchMonthTransactionsFromCloud(window.currentBookId, year, month);
    if (cloudTx !== null) {
      allTx = cloudTx;
    } else {
      allTxIsFallback = true;
      allTx = (window.txs || []).filter(t => {
        const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
      });
    }
  } else {
    // Offline juga dihitung fallback -- window.txs sama-sama bisa saja
    // kepotong untuk bulan yang lebih lama dari cache lokal.
    allTxIsFallback = true;
    allTx = (window.txs || []).filter(t => {
      const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
      return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });
  }

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

  // Anggaran bulan ini — pakai getEffectiveBudget supaya konsisten dengan
  // kartu Anggaran di dashboard (budget.js/renderBudget): kalau bulan ini
  // tidak punya anggaran KHUSUS, fallback ke Anggaran Bulanan (default).
  // Sebelumnya baca window.budgets[key] langsung, jadi selalu 0/kosong untuk
  // bulan mana pun yang memakai anggaran default (kasus paling umum).
  const budgets = (typeof window.getEffectiveBudget === 'function')
    ? window.getEffectiveBudget(year, month, window.currentBookId).budget
    : ((window.budgets && window.budgets[key]) ? window.budgets[key] : {});
  const totalBudget = Object.values(budgets).reduce((s, v) => s + (+v || 0), 0);

  // Buat HTML untuk modal
  const _book   = (window.books || []).find(b => b.id === window.currentBookId);
  const bookName = _book ? _book.name : 'Buku Kas';
  const accName  = document.getElementById('activeAccountLabel')?.textContent || '';

  // ── Token warna sesuai tema ──
  const dk = document.documentElement.getAttribute('data-theme') === 'dark';
  const C = {
    bg:         dk ? '#2D333B' : '#FFFFFF',
    ink:        dk ? '#ADBAC7' : '#1C2430',
    inkMuted:   dk ? '#768390' : '#5B6472',
    inkFaint:   dk ? '#636E7B' : '#9AA2AC',
    rule:       dk ? '#444C56' : '#DCE0E6',
    rowAlt:     dk ? '#1C2128' : '#F7F8FA',
    thead:      dk ? '#22272E' : '#F4F5F7',
    barBg:      dk ? '#444C56' : '#E7E9ED',
    incBg:      dk ? '#1C2E1C' : '#E3F0E9',
    incBd:      dk ? '#57AB5A' : '#7DAF93',
    incTxt:     dk ? '#57AB5A' : '#1F5138',
    expBg:      dk ? '#2E201F' : '#F5E6E6',
    expBd:      dk ? '#C9726B' : '#C77A73',
    expTxt:     dk ? '#C9726B' : '#7E2E2E',
    balPosBg:   dk ? '#1B2E1C' : '#E3ECF3',
    balPosBd:   dk ? '#7BC97E' : '#7FA6C4',
    balPosTxt:  dk ? '#7BC97E' : '#2E5C82',
    budgetBg:   dk ? '#263019' : '#F1EBDA',
    budgetBd:   dk ? '#8FBF62' : '#B99A4E',
    budgetTxt:  dk ? '#8FBF62' : '#6B5320',
  };
  const FM = "'JetBrains Mono', monospace"; // font angka

  let catRows = cats.length
    ? cats.map(([c, v]) => {
        const budget = budgets[c] || 0;
        const pct    = budget > 0 ? Math.min(100, Math.round(v / budget * 100)) : null;
        const bar    = budget > 0
          ? `<div style="height:6px;border-radius: var(--radius-sm);background:${C.barBg};margin-top:3px;">
               <div style="height:6px;border-radius: var(--radius-sm);background:${pct >= 100 ? C.expTxt : pct >= 80 ? (dk ? '#8FBF62' : '#C4922D') : C.incTxt};width:${pct}%;"></div>
             </div>` : '';
        return `<tr>
          <td style="padding:8px 10px; color:${C.ink};">${c}</td>
          <td style="padding:8px 10px; text-align:right; font-family:${FM}; color:${C.ink};">${fmtRp(v)}</td>
          <td style="padding:8px 10px; text-align:right; font-family:${FM}; color:${C.inkFaint};">${budget > 0 ? fmtRp(budget) : '—'}</td>
          <td style="padding:8px 10px; width:100px; color:${C.ink};">${budget > 0 ? `${pct}%${bar}` : '—'}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="4" style="padding:16px; text-align:center; color:${C.inkFaint};">Tidak ada pengeluaran</td></tr>`;

  document.getElementById('reportContent').innerHTML = `
    <div style="font-family:'Plus Jakarta Sans',sans-serif; color:${C.ink}; background:${C.bg};">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
        <div>
          <div style="font-size:.75rem; color:${C.inkFaint};">${accName} · ${bookName}</div>
          <div style="font-size:1.05rem; font-weight:700; color:${C.ink};">${monthName(month)} ${year}</div>
        </div>
        <div style="font-size:.7rem; color:${C.inkFaint};">Dibuat: ${nowStr()}</div>
      </div>

      ${allTxIsFallback ? `
      <div style="background:${C.budgetBg}; border:1.5px solid ${C.budgetBd}; border-radius: var(--radius-sm); padding:10px 14px; margin-bottom:16px; font-size:.72rem; color:${C.budgetTxt}; display:flex; align-items:center; gap:8px;">
        <span style="font-size:1rem; line-height:1;">⚠️</span>
        <span>${window.isOnline() ? 'Gagal ambil data lengkap dari server (koneksi lambat/timeout). Laporan ini dari data tersimpan di perangkat dan mungkin tidak lengkap untuk bulan lama.' : 'Sedang offline. Laporan ini dari data tersimpan di perangkat dan mungkin tidak lengkap untuk bulan lama.'}</span>
      </div>` : ''}

      <!-- Summary cards -->
      <div class="laporan-summary-grid" style="margin-bottom:20px;">
        <div style="background:${C.incBg}; border:1.5px solid ${C.incBd}; border-radius: var(--radius-sm); padding:14px 16px;">
          <div style="font-size:.65rem; color:${C.incTxt}; font-weight:600; text-transform:uppercase; letter-spacing:.5px;">Total Pemasukan</div>
          <div style="font-size:1rem; font-weight:700; font-family:${FM}; color:${C.incTxt}; margin-top:4px;">${fmtRp(income)}</div>
        </div>
        <div style="background:${C.expBg}; border:1.5px solid ${C.expBd}; border-radius: var(--radius-sm); padding:14px 16px;">
          <div style="font-size:.65rem; color:${C.expTxt}; font-weight:600; text-transform:uppercase; letter-spacing:.5px;">Total Pengeluaran</div>
          <div style="font-size:1rem; font-weight:700; font-family:${FM}; color:${C.expTxt}; margin-top:4px;">${fmtRp(expense)}</div>
        </div>
        <div style="background:${balance >= 0 ? C.balPosBg : C.expBg}; border:1.5px solid ${balance >= 0 ? C.balPosBd : C.expBd}; border-radius: var(--radius-sm); padding:14px 16px;">
          <div style="font-size:.65rem; color:${balance >= 0 ? C.balPosTxt : C.expTxt}; font-weight:600; text-transform:uppercase; letter-spacing:.5px;">Saldo Bersih</div>
          <div style="font-size:1rem; font-weight:700; font-family:${FM}; color:${balance >= 0 ? C.balPosTxt : C.expTxt}; margin-top:4px;">${fmtRp(balance)}</div>
        </div>
      </div>

      ${totalBudget > 0 ? `
      <div style="background:${C.budgetBg}; border:1.5px solid ${C.budgetBd}; border-radius: var(--radius-sm); padding:12px 16px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:.65rem; color:${C.budgetTxt}; font-weight:600;">Total Anggaran Bulan Ini</div>
          <div style="font-size:.95rem; font-weight:700; font-family:${FM}; color:${C.budgetTxt};">${fmtRp(totalBudget)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:.65rem; color:${C.budgetTxt}; font-weight:600;">Sisa Anggaran</div>
          <div style="font-size:.95rem; font-weight:700; font-family:${FM}; color:${totalBudget - expense >= 0 ? C.incTxt : C.expTxt};">${fmtRp(totalBudget - expense)}</div>
        </div>
      </div>` : ''}

      <!-- Ringkasan AI -- diisi async oleh window._loadReportAISummary() di
           bawah, supaya tampilnya laporan (di atas) tidak ikut menunggu
           respons AI (bisa lambat / bisa gagal kalau AI belum dikonfigurasi). -->
      <div id="reportAISummaryBox" style="display:none;"></div>

      <!-- Kategori -->
      <div style="font-size:.78rem; font-weight:700; margin-bottom:8px; color:${C.inkMuted}; text-transform:uppercase; letter-spacing:.5px;">Pengeluaran per Kategori</div>
      <div class="laporan-table-wrap" style="border:1.5px solid ${C.rule}; border-radius: var(--radius-sm); margin-bottom:20px;">
        <table style="width:100%; min-width:380px; border-collapse:collapse; font-size:.78rem;">
          <thead>
            <tr style="background:${C.thead}; text-align:left;">
              <th style="padding:8px 10px; font-weight:600; color:${C.inkMuted};">Kategori</th>
              <th style="padding:8px 10px; font-weight:600; text-align:right; color:${C.inkMuted};">Realisasi</th>
              <th style="padding:8px 10px; font-weight:600; text-align:right; color:${C.inkMuted};">Anggaran</th>
              <th style="padding:8px 10px; font-weight:600; color:${C.inkMuted};">Progress</th>
            </tr>
          </thead>
          <tbody>${catRows}</tbody>
        </table>
      </div>

      <!-- Daftar transaksi -->
      <div style="font-size:.78rem; font-weight:700; margin-bottom:8px; color:${C.inkMuted}; text-transform:uppercase; letter-spacing:.5px;">Daftar Transaksi (${allTx.length} transaksi)</div>
      <div class="laporan-table-wrap" style="border:1.5px solid ${C.rule}; border-radius: var(--radius-sm);">
        <table style="width:100%; min-width:480px; border-collapse:collapse; font-size:.75rem;">
          <thead>
            <tr style="background:${C.thead};">
              <th style="padding:8px 10px; text-align:left; font-weight:600; color:${C.inkMuted};">Tanggal</th>
              <th style="padding:8px 10px; text-align:left; font-weight:600; color:${C.inkMuted};">Kategori</th>
              <th style="padding:8px 10px; text-align:left; font-weight:600; color:${C.inkMuted};">Deskripsi</th>
              <th style="padding:8px 10px; text-align:right; font-weight:600; color:${C.inkMuted};">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            ${allTx.length
              ? allTx.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
                  .map((t, i) => `
                    <tr style="background:${i % 2 === 0 ? C.bg : C.rowAlt}; border-top:1px solid ${C.rule};">
                      <td style="padding:7px 10px; white-space:nowrap; color:${C.ink};">${fmtDate(t.date)}</td>
                      <td style="padding:7px 10px; color:${C.ink};">${t.category || (t.type === 'income' ? 'Pemasukan' : 'Lainnya')}</td>
                      <td style="padding:7px 10px; color:${C.inkMuted};">${t.description || '-'}</td>
                      <td style="padding:7px 10px; text-align:right; font-weight:600; font-family:${FM}; color:${t.type === 'income' ? C.incTxt : C.expTxt};">
                        ${t.type === 'income' ? '+' : '-'}${fmtRp(t.amount)}
                      </td>
                    </tr>`)
                  .join('')
              : `<tr><td colspan="4" style="padding:16px; text-align:center; color:${C.inkFaint};">Tidak ada transaksi</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  // 🤖 Ringkasan AI -- dipicu di sini (non-blocking, tidak di-await) supaya
  // laporan di atas sudah tampil duluan; ringkasan AI menyusul begitu siap
  // (atau diam-diam tidak muncul kalau AI belum dikonfigurasi/gagal).
  window._loadReportAISummary(month, year, income, expense, cats);
}

// Ambil transaksi expense per kategori untuk SATU bulan tertentu (dipakai
// khusus untuk data pembanding "bulan lalu" di ringkasan AI -- terpisah dari
// alur render laporan utama supaya tidak ikut menunda tampilnya laporan).
async function _fetchMonthCategoryTotalsForAI(year, month) {
  let tx = [];
  if (window.isOnline() && typeof window.fetchMonthTransactionsFromCloud === 'function') {
    tx = await window.fetchMonthTransactionsFromCloud(window.currentBookId, year, month).catch(() => null) || [];
  }
  if (!tx.length) {
    tx = (window.txs || []).filter(t => {
      const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
      return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });
  }
  const income  = tx.filter(t => t.type === 'income').reduce((s, t) => s + (+t.amount || 0), 0);
  const expense = tx.filter(t => t.type === 'expense').reduce((s, t) => s + (+t.amount || 0), 0);
  const catMap = {};
  tx.filter(t => t.type === 'expense').forEach(t => {
    const c = t.category || 'Lainnya';
    catMap[c] = (catMap[c] || 0) + (+t.amount || 0);
  });
  return { income, expense, catMap };
}

// Susun & panggil AI untuk satu paragraf ringkasan laporan bulan ini
// dibanding bulan sebelumnya. Diam-diam sembunyi (tidak menampilkan error)
// kalau AI belum dikonfigurasi atau gagal -- ini fitur pelengkap opsional,
// bukan bagian wajib dari laporan yang sudah tampil lengkap tanpanya.
window._loadReportAISummary = async function(month, year, income, expense, cats) {
  const box = document.getElementById('reportAISummaryBox');
  if (!box) return;
  const endpointCheck = (typeof window.resolveAIEndpoint === 'function') ? window.resolveAIEndpoint() : { ok: false };
  if (!endpointCheck.ok) { box.style.display = 'none'; return; }
  if (income === 0 && expense === 0) { box.style.display = 'none'; return; }

  box.style.display = 'block';
  box.innerHTML = `<div style="background:var(--accent-lt); border:1.5px solid var(--rule); border-radius:var(--radius-sm); padding:12px 14px; margin-bottom:20px; font-size:.78rem; color:var(--ink-muted);">🤖 Sinarkeu sedang membuat ringkasan bulan ini...</div>`;

  try {
    let prevMonth = month - 1, prevYear = year;
    if (prevMonth < 1) { prevMonth = 12; prevYear -= 1; }
    const prevData = await _fetchMonthCategoryTotalsForAI(prevYear, prevMonth);

    // Bandingkan tiap kategori bulan ini vs bulan lalu, urutkan berdasarkan
    // perubahan absolut terbesar supaya AI fokus ke pergeseran paling
    // signifikan (bukan kategori kecil yang kebetulan naik %-nya tinggi).
    const changes = cats.map(([c, v]) => {
      const prev = prevData.catMap[c] || 0;
      const pct = prev > 0 ? Math.round((v - prev) / prev * 100) : null;
      return { cat: c, current: v, prev, pct, delta: Math.abs(v - prev) };
    }).sort((a, b) => b.delta - a.delta).slice(0, 6);

    const changeLines = changes.map(c => {
      const pctTxt = c.pct === null ? (c.current > 0 ? '(baru, tidak ada bulan lalu)' : '') : `${c.pct >= 0 ? '+' : ''}${c.pct}%`;
      return `  - ${c.cat}: Rp ${c.current.toLocaleString('id-ID')} (bulan lalu Rp ${c.prev.toLocaleString('id-ID')}) ${pctTxt}`;
    }).join('\n');

    const prompt = `Kamu adalah asisten keuangan pribadi. Buat SATU paragraf ringkasan singkat (maksimal 3-4 kalimat, Bahasa Indonesia, gaya santai tapi jelas, tanpa emoji) tentang laporan keuangan bulan ${monthName(month)} ${year} dibanding bulan sebelumnya.

DATA BULAN INI:
- Pemasukan: Rp ${income.toLocaleString('id-ID')}
- Pengeluaran: Rp ${expense.toLocaleString('id-ID')}

DATA BULAN LALU:
- Pemasukan: Rp ${prevData.income.toLocaleString('id-ID')}
- Pengeluaran: Rp ${prevData.expense.toLocaleString('id-ID')}

PERUBAHAN PER KATEGORI PALING SIGNIFIKAN (dibanding bulan lalu):
${changeLines || '  (tidak ada data pembanding bulan lalu)'}

INSTRUKSI:
1. Sebutkan kategori yang berubah paling signifikan (sebut persentasenya), dan sebutkan kemungkinan penyebab yang UMUM/PLAUSIBEL untuk jenis kategori itu (mis. kategori tagihan listrik naik biasanya karena pemakaian AC/musim panas, kategori pendidikan naik biasanya karena awal semester). WAJIB pakai kata "biasanya"/"kemungkinan" karena kamu tidak benar-benar tahu penyebab pastinya -- JANGAN memastikan penyebab seolah itu fakta.
2. Kalau tidak ada perubahan signifikan, cukup sampaikan kondisi bulan ini relatif stabil dibanding bulan lalu.
3. Tulis sebagai satu paragraf mengalir, JANGAN pakai format daftar/poin.
4. Jangan pakai salam pembuka atau penutup, langsung ke isi ringkasannya.`;

    const { text } = await window.callAIEngine(prompt);
    box.innerHTML = `<div style="background:var(--accent-lt); border:1.5px solid var(--rule); border-radius:var(--radius-sm); padding:12px 14px; margin-bottom:20px; font-size:.78rem; line-height:1.65; color:var(--ink);">
      <div style="font-weight:700; margin-bottom:6px;">🤖 Ringkasan Sinarkeu</div>
      <div>${window.escapeHtml(text)}</div>
    </div>`;
  } catch (e) {
    box.style.display = 'none';
    if (window.skLog) window.skLog('[Report AI Summary] gagal: ' + e.message);
  }
};

// ── Export PDF Profesional ───────────────────────────────────
async function exportReportAsPDF() {
  // [PERF] html2pdf.js dimuat lazy (bukan lagi <script defer> statis di
  // setiap load app) -- mulai download di sini, paralel dengan proses
  // ambil data & susun HTML laporan di bawah, supaya waktu tunggu terasa
  // sekecil mungkin (bukan ditambah di depan, tapi "numpang" di waktu
  // yang sudah dipakai fetch data).
  const _html2pdfReady = window.loadScriptOnce(window.HTML2PDF_JS_URL).catch((err) => {
    console.error('[ExportPDF] Gagal memuat html2pdf.js:', err);
    return null;
  });
  const month    = parseInt(document.getElementById('reportMonth').value);
  const year     = parseInt(document.getElementById('reportYear').value);
  const key      = `${year}-${String(month).padStart(2, '0')}`;
  const _book2   = (window.books || []).find(b => b.id === window.currentBookId);
  const bookName = _book2 ? _book2.name : 'Buku Kas';
  const accName  = document.getElementById('activeAccountLabel')?.textContent?.trim() || 'Sinarkeu';

  // [FIX] Sama seperti generateMonthlyReport(): jangan andalkan window.txs
  // yang cuma menyimpan 1000 transaksi terbaru -- tarik langsung dari cloud
  // per-bulan supaya export PDF untuk bulan lama tetap lengkap.
  // [FALLBACK-INDICATOR] Sama seperti generateMonthlyReport() -- lihat catatan
  // lengkap di sana. Untuk PDF, ini ditampilkan sebagai catatan kecil di
  // footer dokumen supaya kalau nanti dicetak/dikirim, pembaca tetap tahu
  // datanya kemungkinan tidak lengkap (bukan cuma indikator yang hilang
  // begitu modal ditutup).
  let allTx, allTxIsFallback = false;
  if (window.isOnline() && typeof window.fetchMonthTransactionsFromCloud === 'function') {
    const cloudTx = await window.fetchMonthTransactionsFromCloud(window.currentBookId, year, month);
    if (cloudTx !== null) {
      allTx = cloudTx;
    } else {
      allTxIsFallback = true;
      allTx = (window.txs || []).filter(t => {
        const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
        return d.getFullYear() === year && (d.getMonth() + 1) === month;
      });
    }
  } else {
    allTxIsFallback = true;
    allTx = (window.txs || []).filter(t => {
      const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
      return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });
  }

  const income  = allTx.filter(t => t.type === 'income').reduce((s, t) => s + (+t.amount || 0), 0);
  const expense = allTx.filter(t => t.type === 'expense').reduce((s, t) => s + (+t.amount || 0), 0);
  const balance = income - expense;

  const catMap = {};
  allTx.filter(t => t.type === 'expense').forEach(t => {
    const c = t.category || 'Lainnya';
    catMap[c] = (catMap[c] || 0) + (+t.amount || 0);
  });
  const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  // Sama seperti generateMonthlyReport(): pakai getEffectiveBudget supaya
  // PDF ikut fallback ke Anggaran Bulanan default, bukan cuma anggaran
  // khusus bulan ini yang sering kosong.
  const budgets = (typeof window.getEffectiveBudget === 'function')
    ? window.getEffectiveBudget(year, month, window.currentBookId).budget
    : ((window.budgets && window.budgets[key]) ? window.budgets[key] : {});
  const totalBudget = Object.values(budgets).reduce((s, v) => s + (+v || 0), 0);

  // ── Token warna sesuai tema (PDF export) ──
  const dk2 = document.documentElement.getAttribute('data-theme') === 'dark';
  const CPDF = {
    bg:     dk2 ? '#2D333B' : '#FFFFFF',
    rowAlt: dk2 ? '#1C2128' : '#F7F8FA',
    barBg:  dk2 ? '#444C56' : '#E7E9ED',
    incTxt: dk2 ? '#57AB5A' : '#1F5138',
    expTxt: dk2 ? '#C9726B' : '#A13A3A',
    warnTxt:dk2 ? '#8FBF62' : '#9C7A2E',
  };

  // ── Sorted transactions ──────────────────────────────────
  const sorted = allTx.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

  // ── Row helpers ──────────────────────────────────────────
  const txRows = sorted.map((t, i) => `
    <tr style="background:${i % 2 === 0 ? CPDF.bg : CPDF.rowAlt};">
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
    const barColor = pct === null ? CPDF.barBg : pct >= 100 ? CPDF.expTxt : pct >= 80 ? CPDF.warnTxt : CPDF.incTxt;
    return `
      <tr>
        <td>${c}</td>
        <td class="money expense">${fmtRp(v)}</td>
        <td class="money">${bud > 0 ? fmtRp(bud) : '—'}</td>
        <td class="center">${bud > 0 ? `${pct}%` : '—'}</td>
        <td style="padding:5.5px 6px;">
          ${bud > 0 ? `<div style="height:7px;border-radius: var(--radius-sm);background:${CPDF.barBg};">
            <div style="height:7px;border-radius: var(--radius-sm);background:${barColor};width:${pct}%;"></div>
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 210mm;
    max-width: 210mm;
    overflow-x: hidden;
  }
  body {
    font-family: 'Plus Jakarta Sans', Arial, sans-serif;
    font-size: 9pt;
    color: #1C2430;
    background: #fff;
    padding: 0;
  }
  table { table-layout: fixed; }

  /* ── Cover Header ── */
  .doc-header {
    background: linear-gradient(135deg, #16233F 0%, #101A2E 60%, #0A1220 100%);
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
    color: #5B6472;
    border-bottom: 1.5px solid #DCE0E6;
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
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    border-left: 3px solid transparent;
  }
  .kpi-income { background: #E3F0E9; border-color: #2E6B4F; }
  .kpi-expense { background: #F5E6E6; border-color: #A13A3A; }
  .kpi-balance-pos { background: #E3ECF3; border-color: #2E5C82; }
  .kpi-balance-neg { background: #F5E6E6; border-color: #A13A3A; }
  .kpi .label {
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: .8px;
    text-transform: uppercase;
    margin-bottom: 4px;
    color: #5B6472;
  }
  .kpi .value {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 12pt;
    font-weight: 700;
  }
  .kpi-income .value { color: #1F5138; }
  .kpi-expense .value { color: #7E2E2E; }
  .kpi-balance-pos .value { color: #2E5C82; }
  .kpi-balance-neg .value { color: #7E2E2E; }

  /* ── Budget Alert ── */
  .budget-alert {
    background: #F1EBDA;
    border: 1px solid #B99A4E;
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    margin: 10px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 8.5pt;
  }
  .budget-alert .ba-label { color: #6B5320; font-weight: 600; }
  .budget-alert .ba-value { font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 10pt; font-weight: 700; color: #6B5320; }
  .budget-alert .ba-sisa { text-align: right; }

  /* ── Tables ── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 7.5pt;
  }
  th {
    background: #F4F5F7;
    padding: 6px 6px;
    font-weight: 700;
    font-size: 7pt;
    text-align: left;
    border-bottom: 2px solid #DCE0E6;
    word-break: break-word;
  }
  td {
    padding: 5.5px 6px;
    border-bottom: 1px solid #F0E9DC;
    vertical-align: middle;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  tr:last-child td { border-bottom: none; }
  .money { text-align: right; font-family: 'JetBrains Mono', 'Courier New', monospace; }
  .income { color: #1F5138; font-weight: 600; }
  .expense { color: #7E2E2E; font-weight: 600; }
  .center { text-align: center; }
  .muted { color: #9AA2AC; }

  /* ── Table wrapper ── */
  .tbl-wrap {
    border: 1.5px solid #DCE0E6;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  /* ── Summary row ── */
  .tbl-foot td {
    background: #F4F5F7;
    font-weight: 700;
    border-top: 2px solid #DCE0E6;
    border-bottom: none;
    padding: 8px 9px;
  }

  /* ── Footer ── */
  .doc-footer {
    margin: 20px 32px 0;
    padding: 10px 0 14px;
    border-top: 1px solid #DCE0E6;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7pt;
    color: #9AA2AC;
  }
  .doc-footer .watermark {
    font-weight: 700;
    color: #D6DAE1;
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
    <span>Buku Kas: <b>${bookName}</b></span>
    <span>Akun: <b>${accName}</b></span>
    <span>Dicetak: <b>${nowStr()}</b></span>
    <span>Total Transaksi: <b>${allTx.length}</b></span>
  </div>
</div>

<div class="content">

  ${allTxIsFallback ? `
  <div style="background:#F1EBDA; border:1.5px solid #B99A4E; border-radius: var(--radius-sm); padding:8px 12px; margin-bottom:14px; font-size:7.5pt; color:#6B5320;">
    ⚠️ ${window.isOnline() ? 'Gagal ambil data lengkap dari server saat dokumen ini dibuat (koneksi lambat/timeout).' : 'Dokumen ini dibuat saat offline.'} Data diambil dari cache di perangkat dan mungkin tidak lengkap untuk bulan yang sudah lama.
  </div>` : ''}

  <!-- ── KPI ── -->
  <div class="section-title">Ringkasan Keuangan</div>
  <div class="kpi-grid">
    <div class="kpi kpi-income">
      <div class="label">Total Pemasukan</div>
      <div class="value">${fmtRp(income)}</div>
    </div>
    <div class="kpi kpi-expense">
      <div class="label">Total Pengeluaran</div>
      <div class="value">${fmtRp(expense)}</div>
    </div>
    <div class="kpi ${balance >= 0 ? 'kpi-balance-pos' : 'kpi-balance-neg'}">
      <div class="label">Saldo Bersih</div>
      <div class="value">${fmtRp(balance)}</div>
    </div>
  </div>

  ${totalBudget > 0 ? `
  <div class="budget-alert">
    <div>
      <div class="ba-label">Anggaran Bulan Ini</div>
      <div class="ba-value">${fmtRp(totalBudget)}</div>
    </div>
    <div class="ba-sisa">
      <div class="ba-label">Terpakai</div>
      <div class="ba-value">${Math.round(expense / totalBudget * 100)}%</div>
    </div>
    <div class="ba-sisa">
      <div class="ba-label">Sisa Anggaran</div>
      <div class="ba-value" style="color:${totalBudget - expense >= 0 ? '#1F5138' : '#7E2E2E'};">${fmtRp(totalBudget - expense)}</div>
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
          <td colspan="2" class="money" style="color:${balance >= 0 ? '#1F5138' : '#7E2E2E'};"><b>${fmtRp(balance)}</b></td>
        </tr>
      </tfoot>
    </table>
  </div>

</div><!-- /content -->

<!-- ── FOOTER ── -->
<div class="doc-footer">
  <div>Laporan ini dibuat secara otomatis oleh sistem Sinarkeu.<br>Dokumen ini bersifat rahasia dan hanya untuk keperluan internal.${allTxIsFallback ? '<br><b>Catatan: dokumen ini dibuat dari data cache lokal, bukan data server lengkap.</b>' : ''}</div>
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
  setTimeout(async () => {
    await _html2pdfReady;
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
