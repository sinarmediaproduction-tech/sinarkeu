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
        filtered = window.txs.filter(t => { const d = window.parseTxDate(t.date); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
    } else if (period === 'lastmonth') {
        const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        filtered = window.txs.filter(t => { const d = window.parseTxDate(t.date); return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear(); });
    } else if (period === 'last3months') {
        const cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        filtered = window.txs.filter(t => window.parseTxDate(t.date) >= cutoff);
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
    const recentSample = filtered.sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date)).slice(0, 20).map(t => `  [${t.date}] ${t.type === 'income' ? 'Masuk' : 'Keluar'} | ${t.category || '-'} | ${t.description || '-'} | Rp ${Number(t.amount).toLocaleString('id-ID')}`).join('\n');
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
        resultEl.innerHTML = '<div style="text-align:center; color:#de350b; padding:40px 0;">Worker URL belum dikonfigurasi. Buka <a href="#" onclick="window.closeModal(\'aiAnalysisModal\'); window.openSetelanModal(); return false;" style="color:#de350b; font-weight:600; text-decoration:underline;">Setelan → Analisis AI</a> untuk mengisi URL Cloudflare Worker Anda.</div>';
        return;
    }
    const data = window.getAITransactionData();
    if (data.count === 0) { 
        resultEl.innerHTML = '<div style="text-align:center; color:#de350b; padding:40px 0;">Tidak ada transaksi pada periode yang dipilih.</div>'; 
        return; 
    }
    btn.disabled = true;
    btn.innerText = 'Menganalisis...';
    copyBtn.style.display = 'none';
    resultEl.innerHTML = '<div style="text-align:center; color:#6b46c1; padding:40px 0;">Groq AI sedang membaca data keuangan Anda...</div>';
    footerEl.innerText = '';
    const prompt = window.buildAIPrompt(data);
    try {
        const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        const json = await res.json();
        if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`);
        const text = json?.result || '(Tidak ada respons)';
        resultEl.innerText = text;
        footerEl.innerText = `Dianalisis oleh Groq AI (LLaMA 3.3) · ${new Date().toLocaleString('id-ID')} · ${data.count} transaksi`;
        copyBtn.style.display = 'inline-flex';
    } catch (e) {
        resultEl.innerHTML = `<div style="color:#de350b; line-height:1.8;">Gagal: <b>${e.message}</b><br><small>Kemungkinan penyebab:<br>• Worker URL salah atau tidak aktif<br>• Worker belum di-deploy ulang setelah edit<br>• API key tidak valid</small></div>`;
        footerEl.innerText = '';
    } finally { btn.disabled = false; btn.innerText = 'Analisis Sekarang'; }
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
    if (!url) { st.style.color = '#de350b'; st.innerText = 'URL tidak boleh kosong!'; return; }
    if (!url.startsWith('http')) { st.style.color = '#de350b'; st.innerText = 'URL harus diawali https://'; return; }
    localStorage.setItem('sk_ai_worker_url', url);
    st.style.color = '#00875a';
    st.innerText = 'Worker URL berhasil disimpan!';
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
    if (!url) { st.style.color='#de350b'; st.innerText='Isi URL dulu sebelum tes.'; return; }
    st.style.color = '#cc7b00';
    st.innerText = 'Menghubungi worker...';
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'ping' }), signal: AbortSignal.timeout(8000) });
        if (res.ok || res.status === 400 || res.status === 422) {
            st.style.color = '#00875a';
            st.innerText = 'Worker merespons! Koneksi berhasil.';
        } else {
            st.style.color = '#de350b';
            st.innerText = `Worker merespons tapi status: ${res.status}. Periksa konfigurasi worker.`;
        }
    } catch (e) {
        st.style.color = '#de350b';
        st.innerText = `Gagal terhubung: ${e.message}`;
    }
};
window.copyAIResult = function() {
    const text = document.getElementById('aiAnalysisResult').innerText;
    navigator.clipboard.writeText(text).then(() => window.showToast('Hasil analisis disalin!', 'success'));
};

// ==================== TANYA AI (CHAT Q&A) ====================
// Beda dengan "Analisis AI" (insight umum), fitur ini menjawab pertanyaan
// SPESIFIK pengguna seperti "listrik bulan Juni berapa?". Supaya AI tidak
// mengarang angka, kita kirim SELURUH transaksi yang ada di cache lokal
// (window.txs, maks MAX_LOCAL_TXS / 300 terbaru) sebagai tabel mentah, dan
// wajibkan AI menunjukkan rincian transaksi yang dipakai untuk menghitung
// jawabannya -- supaya pengguna bisa memverifikasi sendiri ketepatannya.
if (!window._aiChatHistory) window._aiChatHistory = [];

window.openAIChatModal = function() {
    const workerUrl = (localStorage.getItem('sk_ai_worker_url') || '').trim();
    const warn = document.getElementById('aiChatWorkerWarning');
    if (warn) warn.style.display = workerUrl ? 'none' : 'block';
    window.renderAIChatBubbles();
    window.openModal('aiChatModal');
    setTimeout(() => { const inp = document.getElementById('aiChatInput'); if (inp) inp.focus(); }, 150);
};

window.useAIChatExample = function(text) {
    const inp = document.getElementById('aiChatInput');
    if (inp) { inp.value = text; inp.focus(); }
};

// Dump seluruh transaksi (buku aktif, dari cache lokal) jadi tabel teks
// ringkas. Sengaja TIDAK diringkas/diagregasi di sini -- biarkan AI yang
// memfilter sesuai pertanyaan, supaya satu fitur ini bisa menjawab segala
// jenis pertanyaan bebas (per kategori, per kata kunci deskripsi, per
// periode apa pun) tanpa perlu kita menebak dulu apa yang akan ditanya.
window.buildAIChatDataDump = function() {
    const txs = [...window.txs].sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date));
    return txs.map(t => {
        const d = window.parseTxDate(t.date);
        const tgl = isNaN(d.getTime()) ? t.date : d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const jenis = t.type === 'income' ? 'Masuk' : 'Keluar';
        return `${tgl} | ${jenis} | ${t.category || '-'} | ${t.description || '-'} | Rp ${Number(t.amount).toLocaleString('id-ID')}`;
    }).join('\n');
};

window.renderAIChatBubbles = function() {
    const box = document.getElementById('aiChatHistory');
    if (!box) return;
    if (window._aiChatHistory.length === 0) {
        box.innerHTML = '<div style="text-align:center; color:#999; font-size:.72rem; padding:20px 0;" id="aiChatEmptyState">Belum ada percakapan. Coba tanyakan sesuatu di bawah.</div>';
        return;
    }
    box.innerHTML = window._aiChatHistory.map(m => {
        if (m.role === 'user') {
            return `<div style="display:flex; justify-content:flex-end; margin-bottom:8px;"><div style="background:#0e7490; color:#fff; padding:8px 12px; border-radius:10px 10px 2px 10px; max-width:82%; font-size:.78rem; white-space:pre-wrap;">${window.escapeHtml(m.text)}</div></div>`;
        }
        if (m.role === 'loading') {
            return `<div style="display:flex; justify-content:flex-start; margin-bottom:8px;"><div style="background:#fff; border:1px solid #eee; color:#999; padding:8px 12px; border-radius:10px 10px 10px 2px; font-size:.78rem;">AI sedang menghitung dari data transaksi...</div></div>`;
        }
        if (m.role === 'error') {
            return `<div style="display:flex; justify-content:flex-start; margin-bottom:8px;"><div style="background:#fff5f5; border:1px solid #feb2b2; color:#c53030; padding:8px 12px; border-radius:10px 10px 10px 2px; max-width:88%; font-size:.78rem; white-space:pre-wrap;">${window.escapeHtml(m.text)}</div></div>`;
        }
        return `<div style="display:flex; justify-content:flex-start; margin-bottom:8px;"><div style="background:#fff; border:1px solid #eee; color:#222; padding:8px 12px; border-radius:10px 10px 10px 2px; max-width:88%; font-size:.78rem; white-space:pre-wrap; line-height:1.65;">${window.escapeHtml(m.text)}</div></div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
};

window.sendAIChatMessage = async function() {
    const inp = document.getElementById('aiChatInput');
    const sendBtn = document.getElementById('aiChatSendBtn');
    const question = (inp?.value || '').trim();
    if (!question) return;
    const WORKER_URL = (localStorage.getItem('sk_ai_worker_url') || '').trim();
    if (!WORKER_URL) {
        window.showToast('Worker URL AI belum dikonfigurasi. Buka Setelan → Analisis AI.', 'warning');
        return;
    }
    if (!window.txs || window.txs.length === 0) {
        window.showToast('Belum ada transaksi untuk ditanyakan.', 'warning');
        return;
    }
    window._aiChatHistory.push({ role: 'user', text: question });
    window._aiChatHistory.push({ role: 'loading', text: '' });
    window.renderAIChatBubbles();
    inp.value = '';
    sendBtn.disabled = true;

    // Konteks 4 tanya-jawab terakhir (tanpa placeholder loading & error), supaya
    // pertanyaan susulan seperti "kalau bulan sebelumnya?" tetap nyambung.
    const histContext = window._aiChatHistory
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-9, -1)
        .map(m => `${m.role === 'user' ? 'Pengguna' : 'Asisten'}: ${m.text}`)
        .join('\n');
    const dataDump = window.buildAIChatDataDump();
    const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

    const prompt = `Kamu adalah asisten pencatat keuangan pribadi. Hari ini tanggal ${today}.

Di bawah ini adalah SELURUH data transaksi keuangan pengguna yang tersimpan di perangkat ini (terbaru di atas), satu transaksi per baris dengan format:
tanggal | jenis (Masuk/Keluar) | kategori | deskripsi | nominal

DATA TRANSAKSI:
${dataDump}
${histContext ? `\nRIWAYAT PERCAKAPAN SEBELUMNYA:\n${histContext}\n` : ''}
PERTANYAAN PENGGUNA: "${question}"

INSTRUKSI WAJIB:
1. Jawab HANYA berdasarkan data transaksi di atas. JANGAN mengarang, menebak, atau membulatkan angka.
2. Jika pertanyaan menyebut kata kunci (misal "listrik", "token", "galon", "PDAM"), cari kata itu di kolom kategori ATAU deskripsi (boleh cocok sebagian kata, tidak case-sensitive), lalu jumlahkan nominal seluruh baris yang cocok sesuai periode yang ditanya.
3. Jika pertanyaan menyebut bulan/periode, filter transaksi sesuai bulan & tahun tersebut. Kalau tahun tidak disebutkan, pakai tahun yang paling masuk akal relatif terhadap hari ini (umumnya tahun berjalan saat ini).
4. SELALU tampilkan rincian transaksi yang dipakai untuk menghitung jawaban (tanggal & nominal masing-masing), supaya pengguna bisa memverifikasi sendiri. Jika lebih dari 8 transaksi cocok, tampilkan totalnya lalu cukup 8 contoh transaksi saja.
5. Jika tidak ada satupun transaksi yang cocok dengan kriteria pertanyaan, katakan dengan jujur "Tidak ditemukan transaksi yang cocok..." -- JANGAN mengisi dengan angka asumsi.
6. Jawab singkat, padat, dan ramah dalam Bahasa Indonesia. Gunakan format "Rp" dengan titik sebagai pemisah ribuan.`;

    try {
        const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        const json = await res.json();
        if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`);
        const text = json?.result || '(Tidak ada respons)';
        window._aiChatHistory.pop(); // buang placeholder loading
        window._aiChatHistory.push({ role: 'assistant', text });
    } catch (e) {
        window._aiChatHistory.pop();
        window._aiChatHistory.push({ role: 'error', text: `Gagal mendapat jawaban: ${e.message}` });
    } finally {
        sendBtn.disabled = false;
        window.renderAIChatBubbles();
    }
};

window.clearAIChatHistory = function() {
    if (window._aiChatHistory.length === 0) return;
    if (!confirm('Hapus seluruh riwayat percakapan Tanya AI?')) return;
    window._aiChatHistory = [];
    window.renderAIChatBubbles();
};
// ==================== AI ANALISIS FASE KEHIDUPAN ====================
window.runFaseAIAnalysis = async function() {
    const WORKER_URL = (localStorage.getItem('sk_ai_worker_url') || '').trim();
    const fase = window.getFaseKehidupan ? window.getFaseKehidupan() : null;

    window.openModal('faseAIModal');

    const resultEl = document.getElementById('faseAIResult');
    const footerEl = document.getElementById('faseAIFooter');
    const runBtn   = document.getElementById('faseAIRunBtn');
    const copyBtn  = document.getElementById('faseAICopyBtn');

    if (!fase || !fase.fase) {
        resultEl.innerHTML = '<div style="text-align:center; color:#de350b; padding:40px 0;">Atur fase kehidupan terlebih dahulu.<br><a href="#" onclick="window.closeModal(\'faseAIModal\'); window.openFaseKehidupanModal(); return false;" style="color:#e53e8a; font-weight:600;">Atur Fase Kehidupan</a></div>';
        return;
    }
    if (!WORKER_URL) {
        resultEl.innerHTML = '<div style="text-align:center; color:#de350b; padding:40px 0;">Worker URL belum dikonfigurasi.<br><a href="#" onclick="window.closeModal(\'faseAIModal\'); window.openSetelanModal(); return false;" style="color:#de350b; font-weight:600;">Setelan → Analisis AI</a></div>';
        return;
    }

    const faseData = window.FASE_DATA[fase.fase];
    if (!faseData) return;

    // Hitung data keuangan
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    const saldo = totalInc - totalExp + balanceOffset;

    const defaultBudget = window.getDefaultBudget ? window.getDefaultBudget(window.currentBookId) : {};
    let anggaranBulanan = 0;
    if (window.EXPENSE_CATEGORIES) window.EXPENSE_CATEGORIES.forEach(c => { anggaranBulanan += (defaultBudget[c] || 0); });
    const danaDaruratBulan = window.getEmergencyFundMonths ? window.getEmergencyFundMonths(window.currentBookId) : 12;
    const danaDarurat = anggaranBulanan * danaDaruratBulan;

    const annualBudget = window.getAnnualBudget ? window.getAnnualBudget(window.currentBookId) : [];
    let anggaranTahunan = 0;
    annualBudget.forEach(i => { anggaranTahunan += (Number(i.amount) || 0); });

    // 3 bulan terakhir
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const recent = window.txs.filter(t => window.parseTxDate(t.date) >= cutoff);
    const recentExp = recent.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const recentInc = recent.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const catMap = {};
    recent.filter(t => t.type === 'expense').forEach(t => {
        const cat = t.category || 'Lain-lain';
        catMap[cat] = (catMap[cat] || 0) + Number(t.amount);
    });
    const topCat = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0,6).map(([c,a]) => `  - ${c}: Rp ${Number(a).toLocaleString('id-ID')}`).join('\n');

    const prompt = `Kamu adalah perencana keuangan keluarga yang ahli, berempati, dan berbasis data.

FASE KEHIDUPAN PENGGUNA: ${faseData.nama}
Deskripsi fase: ${faseData.desc}
Jumlah tanggungan: ${fase.tanggungan || 0} orang
Target keuangan: ${fase.target || 'Belum ditentukan'}

DATA KEUANGAN SAAT INI:
- Total Saldo: Rp ${saldo.toLocaleString('id-ID')}
- Anggaran Bulanan: Rp ${anggaranBulanan.toLocaleString('id-ID')}
- Dana Darurat Ideal (${danaDaruratBulan}× bulanan): Rp ${danaDarurat.toLocaleString('id-ID')}
- Status Dana Darurat: ${saldo >= danaDarurat ? 'Sudah tercapai' : `Kurang Rp ${(danaDarurat - saldo).toLocaleString('id-ID')}`}
- Anggaran Tahunan: Rp ${anggaranTahunan.toLocaleString('id-ID')}

3 BULAN TERAKHIR:
- Total Pemasukan: Rp ${recentInc.toLocaleString('id-ID')}
- Total Pengeluaran: Rp ${recentExp.toLocaleString('id-ID')}
- Pengeluaran per Kategori:
${topCat || '  (tidak ada data)'}

INSTRUKSI:
1. Evaluasi kondisi keuangan ini dari sudut pandang fase kehidupan "${faseData.nama}"
2. Sebutkan 2–3 hal yang sudah baik
3. Sebutkan 2–3 hal yang perlu diperbaiki / diperhatikan spesifik untuk fase ini
4. Berikan 3 langkah aksi konkret yang bisa dilakukan bulan ini
5. Beri estimasi angka / target jika memungkinkan (pakai Rp)

Gunakan bahasa Indonesia yang hangat, to-the-point, dan motivatif. Maksimal 450 kata. Format dengan emoji dan poin-poin.`;

    runBtn.disabled = true;
    runBtn.innerText = 'Menganalisis...';
    copyBtn.style.display = 'none';
    resultEl.innerHTML = '<div style="text-align:center; color:#e53e8a; padding:40px 0;">AI sedang menganalisis keuangan berdasarkan fase kehidupan Anda...</div>';
    footerEl.innerText = '';

    try {
        const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        const json = await res.json();
        if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`);
        const text = json?.result || '(Tidak ada respons)';
        resultEl.innerText = text;
        footerEl.innerText = `Dianalisis berdasarkan fase: ${faseData.nama} · ${new Date().toLocaleString('id-ID')}`;
        copyBtn.style.display = 'inline-flex';
    } catch(e) {
        resultEl.innerHTML = `<div style="color:#de350b; line-height:1.8;">Gagal: <b>${e.message}</b></div>`;
    } finally {
        runBtn.disabled = false;
        runBtn.innerText = 'Analisis Sekarang';
    }
};

window.copyFaseAIResult = function() {
    const text = document.getElementById('faseAIResult').innerText;
    navigator.clipboard.writeText(text).then(() => window.showToast('Hasil analisis disalin!', 'success'));
};

// ── Header AI Bar ─────────────────────────────────────────────────────────────
window.submitHeaderAI = function() {
    const bar   = document.getElementById('headerAIInput');
    const text  = (bar ? bar.value : '').trim();
    window.openAIChatModal();
    if (text) {
        // Isi input modal dengan teks dari header bar, lalu langsung kirim
        setTimeout(() => {
            const inp = document.getElementById('aiChatInput');
            if (inp) {
                inp.value = text;
                window.sendAIChatMessage();
                if (bar) bar.value = '';
            }
        }, 200);
    }
};
