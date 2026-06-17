// ==================== AI ANALYSIS ====================
window.openAIAnalysis = function() {
    const workerUrl = localStorage.getItem('sk_ai_worker_url') || '';
    const warningEl = document.getElementById('aiWorkerWarning');
    const runBtn    = document.getElementById('aiAnalysisRunBtn');
    if (!workerUrl) {
        warningEl.style.display = 'block';
        runBtn.disabled = false;
        runBtn.style.opacity = '1';
        runBtn.title = '';
    } else {
        warningEl.style.display = 'none';
        runBtn.disabled = false;
        runBtn.style.opacity = '1';
        runBtn.title = '';
    }
    document.getElementById('aiAnalysisResult').innerHTML = '<div style="text-align:center; color:#999; padding:40px 0;">Pilih periode dan jenis analisis, lalu klik <strong>Analisis Sekarang</strong>.</div>';
    document.getElementById('aiAnalysisFooter').innerText = '';
    document.getElementById('aiCopyBtn').style.display = 'none';
    window.openModal('aiAnalysisModal');
};
window.getAITransactionData = function() {
    const period = document.getElementById('aiAnalysisPeriod').value;
    const now = new Date();
    let filtered = [...window.txs];
    if (period === 'thismonth') {
        filtered = window.txs.filter(t => { const d = new Date(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
    } else if (period === 'lastmonth') {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        filtered = window.txs.filter(t => { const d = new Date(t.date); return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear(); });
    } else if (period === 'last3months') {
        const cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        filtered = window.txs.filter(t => new Date(t.date) >= cutoff);
    }
    const totalIncome  = filtered.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const saldo = totalIncome - totalExpense;
    const catMap = {};
    filtered.filter(t => t.type === 'expense').forEach(t => {
        const cat = t.category || 'Lain-lain';
        catMap[cat] = (catMap[cat] || 0) + Number(t.amount);
    });
    const topCategories = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cat, amt]) => `  - ${cat}: Rp ${Number(amt).toLocaleString('id-ID')}`).join('\n');
    const recentSample = filtered.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20).map(t => `  [${t.date}] ${t.type === 'income' ? 'Masuk' : 'Keluar'} | ${t.category || '-'} | ${t.description || '-'} | Rp ${Number(t.amount).toLocaleString('id-ID')}`).join('\n');
    const periodLabel = { all:'Semua Data', thismonth:'Bulan Ini', lastmonth:'Bulan Lalu', last3months:'3 Bulan Terakhir' }[period];
    return { summary: `Periode: ${periodLabel}\nTotal Transaksi: ${filtered.length}\nTotal Pemasukan: Rp ${totalIncome.toLocaleString('id-ID')}\nTotal Pengeluaran: Rp ${totalExpense.toLocaleString('id-ID')}\nSaldo: Rp ${saldo.toLocaleString('id-ID')}`, topCategories, recentSample, count: filtered.length };
};
window.buildAIPrompt = function(data) {
    const type = document.getElementById('aiAnalysisType').value;
    const typeLabel = { general: 'Ringkasan & Saran Umum', expense: 'Analisis Pengeluaran Mendalam', saving: 'Tips Hemat & Menabung', cashflow:'Analisis Arus Kas & Tren' }[type];
    const focus = { general: 'Berikan ringkasan kondisi keuangan secara keseluruhan, identifikasi pola penting, dan berikan 3-5 saran konkret yang bisa langsung diterapkan.', expense: 'Analisis pengeluaran secara mendalam per kategori, identifikasi kategori yang paling boros, bandingkan proporsinya, dan beri rekomendasi pengurangan pengeluaran.', saving: 'Identifikasi peluang penghematan berdasarkan data ini, hitung estimasi penghematan yang mungkin, dan berikan tips menabung yang spesifik dan terukur.', cashflow:'Analisis arus kas, rasio pemasukan vs pengeluaran, deteksi tren, dan prediksi apakah kondisi keuangan ini sehat atau perlu perhatian.' }[type];
    return `Kamu adalah asisten keuangan pribadi yang cerdas dan berempati. Analisis data keuangan berikut dengan gaya bahasa Indonesia yang ramah, jelas, dan to-the-point.

JENIS ANALISIS: ${typeLabel}

DATA RINGKASAN:
${data.summary}

PENGELUARAN PER KATEGORI:
${data.topCategories || '  (tidak ada data pengeluaran)'}

SAMPLE 20 TRANSAKSI TERBARU:
${data.recentSample || '  (tidak ada transaksi)'}

INSTRUKSI: ${focus}

Format jawaban dengan emoji, poin-poin jelas, dan akhiri dengan 1 kalimat motivasi. Gunakan satuan Rupiah (Rp). Jangan terlalu panjang — maksimal 400 kata.`;
};
window.runAIAnalysis = async function() {
    const btn = document.getElementById('aiAnalysisRunBtn');
    const resultEl = document.getElementById('aiAnalysisResult');
    const footerEl = document.getElementById('aiAnalysisFooter');
    const copyBtn  = document.getElementById('aiCopyBtn');
    const WORKER_URL = (localStorage.getItem('sk_ai_worker_url') || '').trim();
    if (!WORKER_URL) {
        resultEl.innerHTML = '<div style="text-align:center; color:#de350b; padding:40px 0;">⚠️ Worker URL belum dikonfigurasi. Buka <a href="#" onclick="window.closeModal(\'aiAnalysisModal\'); window.openSetelanModal(); return false;" style="color:#de350b; font-weight:600; text-decoration:underline;">⚙️ Setelan → Analisis AI</a> untuk mengisi URL Cloudflare Worker Anda.</div>';
        return;
    }
    const data = window.getAITransactionData();
    if (data.count === 0) { 
        resultEl.innerHTML = '<div style="text-align:center; color:#de350b; padding:40px 0;">⚠️ Tidak ada transaksi pada periode yang dipilih.</div>'; 
        return; 
    }
    btn.disabled = true;
    btn.innerText = '⏳ Menganalisis...';
    copyBtn.style.display = 'none';
    resultEl.innerHTML = '<div style="text-align:center; color:#6b46c1; padding:40px 0;">🤖 Groq AI sedang membaca data keuangan Anda...</div>';
    footerEl.innerText = '';
    const prompt = window.buildAIPrompt(data);
    try {
        const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        const json = await res.json();
        if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`);
        const text = json?.result || '(Tidak ada respons)';
        resultEl.innerText = text;
        footerEl.innerText = `✅ Dianalisis oleh Groq AI (LLaMA 3.3) · ${new Date().toLocaleString('id-ID')} · ${data.count} transaksi`;
        copyBtn.style.display = 'inline-flex';
    } catch (e) {
        resultEl.innerHTML = `<div style="color:#de350b; line-height:1.8;">❌ Gagal: <b>${e.message}</b><br><small>Kemungkinan penyebab:<br>• Worker URL salah atau tidak aktif<br>• Worker belum di-deploy ulang setelah edit<br>• API key tidak valid</small></div>`;
        footerEl.innerText = '';
    } finally { btn.disabled = false; btn.innerText = '✨ Analisis Sekarang'; }
};
window.updateAiWorkerBadge = function() {
    const badge = document.getElementById('aiWorkerStatusBadge');
    if (!badge) return;
    const val = (document.getElementById('aiWorkerUrlInput')?.value || '').trim();
    if (val) { badge.style.background = '#e3fcef'; badge.style.color = '#006644'; badge.innerText = 'Terkonfigurasi'; }
    else { badge.style.background = '#eee'; badge.style.color = '#666'; badge.innerText = 'Belum dikonfigurasi'; }
};
window.saveAiWorkerUrl = function() {
    const url = (document.getElementById('aiWorkerUrlInput')?.value || '').trim();
    const st  = document.getElementById('aiWorkerTestStatus');
    if (!url) { st.style.color = '#de350b'; st.innerText = '❌ URL tidak boleh kosong!'; return; }
    if (!url.startsWith('http')) { st.style.color = '#de350b'; st.innerText = '❌ URL harus diawali https://'; return; }
    localStorage.setItem('sk_ai_worker_url', url);
    st.style.color = '#00875a';
    st.innerText = '✅ Worker URL berhasil disimpan!';
    window.updateAiWorkerBadge();
    window.showToast('Worker URL AI disimpan!', 'success');
};
window.clearAiWorkerUrl = function() {
    if (!confirm('Hapus Worker URL? Fitur Analisis AI akan dinonaktifkan.')) return;
    localStorage.removeItem('sk_ai_worker_url');
    const inp = document.getElementById('aiWorkerUrlInput');
    if (inp) inp.value = '';
    const st = document.getElementById('aiWorkerTestStatus');
    if (st) { st.style.color = '#666'; st.innerText = 'Worker URL dihapus.'; }
    window.updateAiWorkerBadge();
    window.showToast('Worker URL dihapus.', 'info');
};
window.testAiWorkerUrl = async function() {
    const url = (document.getElementById('aiWorkerUrlInput')?.value || '').trim();
    const st  = document.getElementById('aiWorkerTestStatus');
    if (!url) { st.style.color='#de350b'; st.innerText='❌ Isi URL dulu sebelum tes.'; return; }
    st.style.color = '#cc7b00';
    st.innerText = '⏳ Menghubungi worker...';
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'ping' }), signal: AbortSignal.timeout(8000) });
        if (res.ok || res.status === 400 || res.status === 422) {
            st.style.color = '#00875a';
            st.innerText = '✅ Worker merespons! Koneksi berhasil.';
        } else {
            st.style.color = '#de350b';
            st.innerText = `⚠️ Worker merespons tapi status: ${res.status}. Periksa konfigurasi worker.`;
        }
    } catch (e) {
        st.style.color = '#de350b';
        st.innerText = `❌ Gagal terhubung: ${e.message}`;
    }
};
window.copyAIResult = function() {
    const text = document.getElementById('aiAnalysisResult').innerText;
    navigator.clipboard.writeText(text).then(() => window.showToast('Hasil analisis disalin!', 'success'));
};