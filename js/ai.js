// ==================== AI ENGINE SELECTION ====================
// SinarKeu mendukung 2 mesin AI yang bisa dipilih di Setelan -> Analisis AI:
//   - 'worker' : Cloudflare Worker + Groq (cara lama, butuh URL worker sendiri)
//   - 'gemini' : Supabase Edge Function `ai-gemini` (lihat
//                supabase/functions/ai-gemini/) yang meneruskan ke Gemini API
//                dengan fallback BEBERAPA API key sekaligus di sisi server,
//                jadi tidak gampang mati total kalau satu key kena limit.
// Satu setelan ini dipakai bersama oleh Analisis AI, Tanya AI (chat), dan
// Analisis Fase Kehidupan -- supaya user cukup pilih mesin sekali, bukan
// per-fitur. Fitur pemakaian lain menyusul; bagian ini baru menyediakan
// jalur pemanggilannya (mesinnya) supaya siap dipakai kapan saja.
window.getAIEngine = function() {
    return localStorage.getItem('sk_ai_engine') || 'worker';
};
window.setAIEngine = function(engine) {
    if (engine !== 'worker' && engine !== 'gemini') return;
    localStorage.setItem('sk_ai_engine', engine);
    // [SYNC MULTI-DEVICE] Konsisten dengan pola ai_worker_url -- ikut
    // disinkronkan ke tabel `settings` (book_id 'global') supaya pilihan
    // mesin AI ini sama di semua perangkat yang login ke backend yang sama.
    if (window.pushSetting) window.pushSetting('ai_engine', engine, 'global').catch(function() {});
    if (window.updateAiWorkerBadge) window.updateAiWorkerBadge();
};

// Menentukan {url, headers, label} tujuan panggilan AI berdasarkan mesin
// yang sedang aktif. Untuk mesin 'gemini', URL & anon key TIDAK perlu diisi
// manual -- diambil dari konfigurasi Supabase Cloud Sync yang sudah ada
// (window.globalSupabaseUrl/globalSupabaseKey), karena edge function selalu
// hidup di `${SUPABASE_URL}/functions/v1/ai-gemini` pada project yang sama.
window.resolveAIEndpoint = function() {
    const engine = window.getAIEngine();
    if (engine === 'gemini') {
        const supaUrl = (window.globalSupabaseUrl || '').replace(/\/+$/, '');
        const supaKey = window.globalSupabaseKey || '';
        if (!supaUrl || !supaKey) {
            return { ok: false, reason: 'Supabase Cloud Sync belum dikonfigurasi. Buka Setelan → Cloud Sync untuk menyambungkan project Supabase Anda dulu, baru mesin Gemini bisa dipakai.' };
        }
        return {
            ok: true,
            url: `${supaUrl}/functions/v1/ai-gemini`,
            headers: { 'Content-Type': 'application/json', 'apikey': supaKey, 'Authorization': `Bearer ${supaKey}` },
            label: 'Gemini (Supabase Edge Function)'
        };
    }
    const workerUrl = (localStorage.getItem('sk_ai_worker_url') || '').trim();
    if (!workerUrl) {
        return { ok: false, reason: 'Worker URL belum dikonfigurasi. Buka Setelan → Analisis AI untuk mengisi URL Cloudflare Worker Anda.' };
    }
    return { ok: true, url: workerUrl, headers: { 'Content-Type': 'application/json' }, label: 'Groq (Cloudflare Worker)' };
};

// Titik panggil TUNGGAL ke mesin AI yang aktif, dipakai oleh Analisis AI,
// Tanya AI, dan Analisis Fase Kehidupan -- supaya logic pemilihan mesin
// hanya ada di satu tempat (resolveAIEndpoint di atas), bukan diduplikasi.
// Melempar Error kalau gagal; caller yang menangani tampilannya.
window.callAIEngine = async function(prompt) {
    const endpoint = window.resolveAIEndpoint();
    if (!endpoint.ok) throw new Error(endpoint.reason);
    const res = await fetch(endpoint.url, { method: 'POST', headers: endpoint.headers, body: JSON.stringify({ prompt }) });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`);
    return { text: json?.result || '(Tidak ada respons)', engineLabel: endpoint.label };
};

// ==================== SARAN KATEGORI OTOMATIS (AI) ====================
// Saat Deskripsi transaksi diisi, mesin AI aktif (lihat resolveAIEndpoint
// di atas) disuruh menyarankan SATU kategori yang paling cocok dari daftar
// resmi (EXPENSE_CATEGORIES/INCOME_CATEGORIES). Sengaja TIDAK PERNAH
// menimpa kategori otomatis -- cuma tampil sebagai chip "Saran AI: ...
// [Pakai]" yang diklik manual, supaya user tetap pegang kendali penuh dan
// tidak kaget kategorinya berubah sendiri. Kalau mesin AI belum
// dikonfigurasi (resolveAIEndpoint gagal), fitur ini diam total -- tidak
// ada chip, tidak ada request, tidak ada error -- supaya alur catat cepat
// tidak terganggu buat user yang belum/tidak pakai AI.
window._aiCatDebounce = {};
window._aiCatLastQuery = {};

// Dipanggil sekali per pasangan form (add/edit) saat app boot, lihat
// pemanggilan di bagian bawah file ini (DOMContentLoaded).
window.initAiCategorySuggest = function(descId, catExpenseId, catIncomeId, typeRadioName, chipId) {
    const descEl = document.getElementById(descId);
    if (!descEl || descEl._aiCatBound) return; // hindari double-bind
    descEl._aiCatBound = true;
    descEl.addEventListener('input', function() {
        window._scheduleAiCategorySuggest(descId, catExpenseId, catIncomeId, typeRadioName, chipId);
    });
    // Ganti jenis transaksi (Pemasukan/Pengeluaran) juga bisa mengubah
    // daftar kategori yang relevan -- sembunyikan chip lama supaya tidak
    // menyarankan kategori dari daftar yang salah jenis.
    document.querySelectorAll(`input[name="${typeRadioName}"]`).forEach(r => {
        r.addEventListener('change', function() {
            const chipEl = document.getElementById(chipId);
            if (chipEl) chipEl.style.display = 'none';
            window._scheduleAiCategorySuggest(descId, catExpenseId, catIncomeId, typeRadioName, chipId);
        });
    });
};

window._scheduleAiCategorySuggest = function(descId, catExpenseId, catIncomeId, typeRadioName, chipId) {
    clearTimeout(window._aiCatDebounce[descId]);
    // Debounce 800ms supaya tidak nembak AI di tiap ketikan huruf -- cukup
    // dipanggil sekali setelah user berhenti mengetik sejenak.
    window._aiCatDebounce[descId] = setTimeout(function() {
        window._runAiCategorySuggest(descId, catExpenseId, catIncomeId, typeRadioName, chipId);
    }, 800);
};

window._runAiCategorySuggest = async function(descId, catExpenseId, catIncomeId, typeRadioName, chipId) {
    const chipEl = document.getElementById(chipId);
    const descEl = document.getElementById(descId);
    const desc = (descEl?.value || '').trim();
    if (chipEl) chipEl.style.display = 'none';
    if (desc.length < 3) return;
    if (typeof window.resolveAIEndpoint !== 'function' || !window.resolveAIEndpoint().ok) return;

    const typeInput = document.querySelector(`input[name="${typeRadioName}"]:checked`);
    const type = typeInput ? typeInput.value : 'expense';
    const targetSelectId = type === 'income' ? catIncomeId : catExpenseId;
    const targetSelect = document.getElementById(targetSelectId);
    if (!targetSelect) return;

    // Jangan tembak ulang AI kalau deskripsi & jenis sama persis dengan
    // query terakhir untuk field ini (mis. user cuma pindah fokus lalu balik lagi).
    const cacheKey = type + '|' + desc.toLowerCase();
    if (window._aiCatLastQuery[descId] === cacheKey) {
        if (chipEl && chipEl.dataset.suggestedCategory && chipEl.dataset.targetSelect === targetSelectId) {
            chipEl.style.display = 'block'; // tampilkan lagi chip yang sudah pernah didapat
        }
        return;
    }
    window._aiCatLastQuery[descId] = cacheKey;

    const categories = type === 'income' ? window.INCOME_CATEGORIES : window.EXPENSE_CATEGORIES;
    const prompt = `Kamu adalah pengklasifikasi kategori transaksi keuangan rumah tangga Indonesia. Diberikan deskripsi transaksi ${type === 'income' ? 'PEMASUKAN' : 'PENGELUARAN'} di bawah, pilih SATU kategori yang PALING cocok dari daftar berikut (jawab PERSIS salah satu nama kategori ini, tanpa tanda kutip/penjelasan/kata tambahan apa pun):\n${categories.join(', ')}\n\nDeskripsi transaksi: "${desc}"\n\nJawab hanya nama kategorinya saja.`;

    try {
        const { text } = await window.callAIEngine(prompt);
        // Kalau selagi menunggu respons user sudah lanjut mengetik/ganti jenis
        // transaksi, hasil ini sudah tidak relevan lagi -- buang saja.
        const stillRelevant = (document.getElementById(descId)?.value || '').trim() === desc &&
            (document.querySelector(`input[name="${typeRadioName}"]:checked`)?.value || 'expense') === type;
        if (!stillRelevant || !chipEl) return;

        const clean = (text || '').trim();
        const matched = categories.find(c => c.toLowerCase() === clean.toLowerCase()) ||
            categories.find(c => clean.toLowerCase().includes(c.toLowerCase()));
        if (!matched) return;

        chipEl.innerHTML = `🤖 Saran AI: <b>${window.escapeHtml(matched)}</b> <button type="button" class="btn btn-secondary" style="font-size:.62rem; padding:2px 8px; margin-left:4px;" onclick="window._applyAiCategorySuggest(this)">Pakai</button>`;
        chipEl.dataset.suggestedCategory = matched;
        chipEl.dataset.targetSelect = targetSelectId;
        chipEl.style.display = 'block';
    } catch (e) {
        // Diam-diam gagal -- ini fitur bantu opsional, bukan alur wajib.
        // Tidak pakai showToast supaya tidak mengganggu user yang sedang
        // cepat-cepat mencatat transaksi (mis. jaringan lemot/AI lagi limit).
        if (window.skLog) window.skLog('[AI Kategori] gagal saran: ' + e.message);
    }
};

window._applyAiCategorySuggest = function(btnEl) {
    const chipEl = btnEl.closest('[data-target-select]') || btnEl.parentElement;
    if (!chipEl) return;
    const select = document.getElementById(chipEl.dataset.targetSelect);
    const cat = chipEl.dataset.suggestedCategory;
    if (select && cat) {
        select.value = cat;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    chipEl.style.display = 'none';
};

// Aktifkan untuk form Tambah Transaksi dan Ubah Transaksi begitu DOM siap.
document.addEventListener('DOMContentLoaded', function() {
    if (typeof window.initAiCategorySuggest === 'function') {
        window.initAiCategorySuggest('txDesc', 'txCategory', 'txIncomeCategory', 'type', 'txCategoryAiSuggest');
        window.initAiCategorySuggest('editTxDesc', 'editTxCategory', 'editTxIncomeCategory', 'editType', 'editTxCategoryAiSuggest');
    }
    if (typeof window.initAiDescSuggest === 'function') {
        window.initAiDescSuggest('txAmount', 'txDesc', 'txDate', 'type', 'txDescAiSuggest');
        window.initAiDescSuggest('editTxAmount', 'editTxDesc', 'editTxDate', 'editType', 'editTxDescAiSuggest');
    }
});

// ==================== SARAN DESKRIPSI OTOMATIS (POLA RIWAYAT) ====================
// Beda dengan saran kategori di atas (yang manggil AI Engine lewat prompt),
// fitur ini SENGAJA murni pola lokal -- TIDAK memanggil AI Engine sama
// sekali. Begitu user mengisi NOMINAL tapi Deskripsi masih kosong (mis. isi
// nominal duluan sebelum deskripsi, atau tempel angka dari nota), dicari
// transaksi historis (window.txs, buku aktif, sudah terdekripsi di device
// ini) dengan nominal & jam yang mirip. Kalau polanya cukup meyakinkan
// (nominal nyaris identik & berulang -- khas tagihan/token/iuran bulanan),
// tampilkan sebagai chip saran, persis seperti kategori: klik "Pakai" untuk
// isi, tidak pernah menimpa otomatis. Dibuat murni perhitungan lokal karena
// tugasnya cuma mencari transaksi historis paling mirip -- lebih cepat,
// tidak makan kuota AI Engine, dan hasilnya lebih bisa dipercaya
// dibanding AI menebak teks bebas dari sekadar deskripsi tetangga-tetangganya.
window._aiDescDebounce = {};

window.initAiDescSuggest = function(amountId, descId, dateId, typeRadioName, chipId) {
    const amtEl = document.getElementById(amountId);
    const descEl = document.getElementById(descId);
    if (!amtEl || amtEl._aiDescBound) return;
    amtEl._aiDescBound = true;
    amtEl.addEventListener('input', function() {
        clearTimeout(window._aiDescDebounce[amountId]);
        // Debounce 600ms -- formatRupiah() sudah jalan tiap ketikan, tunggu
        // user berhenti sejenak dulu sebelum mulai mencari pola.
        window._aiDescDebounce[amountId] = setTimeout(function() {
            window._runAiDescSuggest(amountId, descId, dateId, typeRadioName, chipId);
        }, 600);
    });
    document.querySelectorAll(`input[name="${typeRadioName}"]`).forEach(r => {
        r.addEventListener('change', function() {
            const chipEl = document.getElementById(chipId);
            if (chipEl) chipEl.style.display = 'none';
            window._runAiDescSuggest(amountId, descId, dateId, typeRadioName, chipId);
        });
    });
    // Kalau user sempat isi nominal duluan (Deskripsi masih kosong) lalu baru
    // pindah fokus ke field Deskripsi, tampilkan lagi saran yang relevan --
    // jaga-jaga kalau urutan pengisian dibalik dari urutan field di form.
    if (descEl && !descEl._aiDescFocusBound) {
        descEl._aiDescFocusBound = true;
        descEl.addEventListener('focus', function() {
            if ((descEl.value || '').trim() === '') {
                window._runAiDescSuggest(amountId, descId, dateId, typeRadioName, chipId);
            }
        });
    }
};

window._runAiDescSuggest = function(amountId, descId, dateId, typeRadioName, chipId) {
    const chipEl = document.getElementById(chipId);
    const descEl = document.getElementById(descId);
    const amtEl  = document.getElementById(amountId);
    if (chipEl) chipEl.style.display = 'none';
    // Jangan menyarankan/menimpa kalau Deskripsi sudah mulai diisi user sendiri.
    if (!descEl || (descEl.value || '').trim().length > 0 || !amtEl) return;

    const amt = Number((amtEl.value || '').replace(/[^0-9]/g, ''));
    if (!amt || amt < 500) return; // nominal kosong/terlalu kecil, sinyal belum cukup

    const typeInput = document.querySelector(`input[name="${typeRadioName}"]:checked`);
    const type = typeInput ? typeInput.value : 'expense';

    // Jam referensi: pakai field tanggal&waktu form kalau sudah terisi
    // (biasanya sudah default ke "sekarang"), fallback ke jam saat ini.
    const dateEl = document.getElementById(dateId);
    let refHour = null;
    if (dateEl && dateEl.value) {
        const d = new Date(dateEl.value);
        if (!isNaN(d.getTime())) refHour = d.getHours() + d.getMinutes() / 60;
    }
    if (refHour === null) {
        const now = new Date();
        refHour = now.getHours() + now.getMinutes() / 60;
    }

    const txs = (window.txs || []).filter(t => t.type === type && (t.description || '').trim().length > 0);
    if (txs.length === 0) return;

    // Skor tiap transaksi historis: nominal jadi faktor UTAMA (transaksi
    // berulang -- tagihan, token listrik, iuran -- biasanya nominalnya
    // identik/nyaris identik tiap kali), jam cuma penguat sinyal tambahan.
    // Beda nominal >10% dianggap terlalu jauh, tidak dianggap mirip sama sekali.
    const TOLERANCE = 0.1;
    const scored = [];
    txs.forEach(t => {
        const tAmt = Number(t.amount) || 0;
        if (tAmt <= 0) return;
        const relDiff = Math.abs(tAmt - amt) / Math.max(tAmt, amt);
        if (relDiff > TOLERANCE) return;
        let hourScore = 0.5;
        const d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
        if (d && !isNaN(d.getTime())) {
            const tHour = d.getHours() + d.getMinutes() / 60;
            let hourDiff = Math.abs(tHour - refHour);
            hourDiff = Math.min(hourDiff, 24 - hourDiff); // jarak siklus 24 jam
            hourScore = Math.max(0, 1 - hourDiff / 12);
        }
        const amountScore = 1 - relDiff / TOLERANCE; // 1 = nominal persis sama
        scored.push({ desc: t.description.trim(), score: amountScore * 0.75 + hourScore * 0.25 });
    });
    if (scored.length === 0) return;

    // Kelompokkan berdasarkan teks deskripsi (case-insensitive) supaya
    // deskripsi yang paling sering & paling mirip nominalnya yang menang.
    const groups = {};
    scored.forEach(s => {
        const key = s.desc.toLowerCase();
        if (!groups[key]) groups[key] = { desc: s.desc, total: 0, count: 0, best: 0 };
        groups[key].total += s.score;
        groups[key].count += 1;
        groups[key].best = Math.max(groups[key].best, s.score);
    });
    const top = Object.values(groups).sort((a, b) => b.total - a.total)[0];
    if (!top) return;

    // Ambang kepercayaan: minimal 2 transaksi historis yang mirip, ATAU 1
    // transaksi tapi nominalnya nyaris persis sama -- supaya tidak asal
    // menyarankan cuma dari satu kebetulan nominal mirip.
    const confident = top.count >= 2 || top.best >= 0.95;
    if (!confident || !chipEl) return;

    chipEl.innerHTML = `🤖 Saran deskripsi: <b>${window.escapeHtml(top.desc)}</b> <span style="opacity:.7;">(mirip ${top.count} transaksi lalu)</span> <button type="button" class="btn btn-secondary" style="font-size:.62rem; padding:2px 8px; margin-left:4px;" onclick="window._applyAiDescSuggest(this, '${descId}')">Pakai</button>`;
    chipEl.dataset.suggestedDesc = top.desc;
    chipEl.style.display = 'block';
};

window._applyAiDescSuggest = function(btnEl, descId) {
    const chipEl = btnEl.closest('[data-suggested-desc]') || btnEl.parentElement;
    const descEl = document.getElementById(descId);
    const desc = chipEl ? chipEl.dataset.suggestedDesc : null;
    if (descEl && desc) {
        descEl.value = desc;
        // Trigger 'input' supaya saran kategori (initAiCategorySuggest di atas,
        // yang listen ke event 'input' pada field Deskripsi) ikut jalan otomatis.
        descEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (chipEl) chipEl.style.display = 'none';
};

// ==================== AI ANALYSIS ====================
window.openAIAnalysis = function() {
    const endpoint = window.resolveAIEndpoint();
    const warningEl = document.getElementById('aiWorkerWarning');
    const runBtn    = document.getElementById('aiAnalysisRunBtn');
    if (!endpoint.ok) {
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
    document.getElementById('aiAnalysisResult').innerHTML = '<div style="text-align:center; color:#9AA2AC; padding:40px 0;">Pilih periode dan jenis analisis, lalu klik <strong>Analisis Sekarang</strong>.</div>';
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
    // [BUG FIX] Untuk periode 'all', filtered = window.txs yang di-cap MAX_LOCAL_TXS
    // (lihat trimAndSaveLocal) -- transaksi lama yang sudah di-trim harus dikompensasi
    // lewat balanceOffset, sama seperti render.js/telegram.js, supaya AI tidak dikasih
    // saldo yang keliru untuk buku dengan >1000 transaksi. Untuk periode per-bulan
    // (thismonth/lastmonth/last3months) offset TIDAK ditambahkan karena "saldo" di situ
    // memang berarti net arus kas periode itu saja, bukan saldo total historis.
    const balanceOffset = period === 'all' ? (Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0) : 0;
    const saldo = totalIncome - totalExpense + balanceOffset;
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
    const endpointCheck = window.resolveAIEndpoint();
    if (!endpointCheck.ok) {
        resultEl.innerHTML = `<div style="text-align:center; color:#A13A3A; padding:40px 0;">${window.escapeHtml(endpointCheck.reason)} Buka <a href="#" onclick="window.closeModal('aiAnalysisModal'); window.openSetelanModal('ai'); return false;" style="color:#A13A3A; font-weight:600; text-decoration:underline;">Setelan → Analisis AI</a>.</div>`;
        return;
    }
    const data = window.getAITransactionData();
    if (data.count === 0) { 
        resultEl.innerHTML = '<div style="text-align:center; color:#A13A3A; padding:40px 0;">Tidak ada transaksi pada periode yang dipilih.</div>'; 
        return; 
    }
    btn.disabled = true;
    btn.innerText = 'Menganalisis...';
    copyBtn.style.display = 'none';
    resultEl.innerHTML = `<div style="text-align:center; color:#5C4E72; padding:40px 0;">${window.escapeHtml(endpointCheck.label)} sedang membaca data keuangan Anda...</div>`;
    footerEl.innerText = '';
    const prompt = window.buildAIPrompt(data);
    try {
        const { text, engineLabel } = await window.callAIEngine(prompt);
        resultEl.innerText = text;
        footerEl.innerText = `Dianalisis oleh ${engineLabel} · ${new Date().toLocaleString('id-ID')} · ${data.count} transaksi`;
        copyBtn.style.display = 'inline-flex';
        document.getElementById('aiExportBtn').style.display = 'inline-flex';
    } catch (e) {
        resultEl.innerHTML = `<div style="color:#A13A3A; line-height:1.8;">Gagal: <b>${e.message}</b><br><small>Kemungkinan penyebab:<br>• Worker URL salah atau tidak aktif<br>• Worker belum di-deploy ulang setelah edit<br>• API key tidak valid</small></div>`;
        footerEl.innerText = '';
    } finally { btn.disabled = false; btn.innerText = 'Analisis Sekarang'; }
};
window.updateAiWorkerBadge = function() {
    const badge = document.getElementById('aiWorkerStatusBadge');
    if (!badge) return;
    const engine = window.getAIEngine();
    // Tampilkan status sesuai mesin yang SEDANG AKTIF, bukan sekadar isi
    // input worker URL -- supaya kalau user pilih mesin Gemini, badge tidak
    // salah bilang "Belum dikonfigurasi" hanya gara-gara kolom worker kosong.
    const endpoint = window.resolveAIEndpoint();
    if (endpoint.ok) {
        badge.style.background = '#E3F0E9'; badge.style.color = '#1F5138';
        badge.innerText = `Aktif: ${endpoint.label}`;
    } else {
        badge.style.background = '#E7E9ED'; badge.style.color = '#5B6472';
        badge.innerText = engine === 'gemini' ? 'Gemini: Cloud Sync belum tersambung' : 'Belum dikonfigurasi';
    }
    // Sinkronkan tampilan radio pilihan mesin & panel yang relevan.
    const radioWorker = document.getElementById('aiEngineRadioWorker');
    const radioGemini = document.getElementById('aiEngineRadioGemini');
    if (radioWorker) radioWorker.checked = (engine !== 'gemini');
    if (radioGemini) radioGemini.checked = (engine === 'gemini');
    const workerPanel = document.getElementById('aiEngineWorkerPanel');
    const geminiPanel = document.getElementById('aiEngineGeminiPanel');
    if (workerPanel) workerPanel.style.display = (engine === 'gemini') ? 'none' : 'block';
    if (geminiPanel) geminiPanel.style.display = (engine === 'gemini') ? 'block' : 'none';
};

// Tes cepat mesin Gemini (Supabase Edge Function) yang sedang aktif --
// mengirim prompt "ping" singkat, mirip testAiWorkerUrl tapi lewat
// resolveAIEndpoint sehingga otomatis pakai URL & anon key Supabase yang
// sudah tersambung (tidak perlu isi URL manual).
window.testAiGeminiEngine = async function() {
    const st = document.getElementById('aiGeminiTestStatus');
    const endpoint = window.resolveAIEndpoint();
    if (!st) return;
    if (window.getAIEngine() !== 'gemini' || !endpoint.ok) {
        st.style.color = '#A13A3A';
        st.innerText = endpoint.ok ? 'Pilih mesin Gemini dulu.' : endpoint.reason;
        return;
    }
    st.style.color = '#9C7A2E';
    st.innerText = 'Menghubungi Supabase Edge Function...';
    try {
        const { text } = await window.callAIEngine('Balas dengan kata "siap" saja.');
        st.style.color = '#2E6B4F';
        st.innerText = `Mesin Gemini merespons: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`;
    } catch (e) {
        st.style.color = '#A13A3A';
        st.innerText = `Gagal terhubung: ${e.message}`;
    }
};
window.saveAiWorkerUrl = function() {
    const url = (document.getElementById('aiWorkerUrlInput')?.value || '').trim();
    const st  = document.getElementById('aiWorkerTestStatus');
    if (!url) { st.style.color = '#A13A3A'; st.innerText = 'URL tidak boleh kosong!'; return; }
    if (!url.startsWith('http')) { st.style.color = '#A13A3A'; st.innerText = 'URL harus diawali https://'; return; }
    localStorage.setItem('sk_ai_worker_url', url);
    st.style.color = '#2E6B4F';
    st.innerText = 'Worker URL berhasil disimpan!';
    window.updateAiWorkerBadge();
    window.showToast('Worker URL AI disimpan!', 'success');
    // [SYNC MULTI-DEVICE] Simpan juga ke cloud (tabel `settings`, book_id
    // 'global') supaya URL worker AI ini otomatis muncul di perangkat lain
    // yang login ke backend Supabase yang sama -- konsisten dengan pola
    // google_sheets_url/telegram_config, lihat window.pullAllSettings di
    // js/db.js untuk sisi penerimaannya.
    if (window.pushSetting) window.pushSetting('ai_worker_url', url, 'global').catch(function() {});
};
window.clearAiWorkerUrl = function() {
    if (!confirm('Hapus Worker URL? Fitur Analisis AI akan dinonaktifkan.')) return;
    localStorage.removeItem('sk_ai_worker_url');
    const inp = document.getElementById('aiWorkerUrlInput');
    if (inp) inp.value = '';
    const st = document.getElementById('aiWorkerTestStatus');
    if (st) { st.style.color = '#5B6472'; st.innerText = 'Worker URL dihapus.'; }
    window.updateAiWorkerBadge();
    window.showToast('Worker URL dihapus.', 'info');
    // [SYNC MULTI-DEVICE] Push string kosong supaya penghapusan ini ikut
    // tersinkron ke perangkat lain (lihat catatan di saveAiWorkerUrl di atas).
    if (window.pushSetting) window.pushSetting('ai_worker_url', '', 'global').catch(function() {});
};
window.testAiWorkerUrl = async function() {
    const url = (document.getElementById('aiWorkerUrlInput')?.value || '').trim();
    const st  = document.getElementById('aiWorkerTestStatus');
    if (!url) { st.style.color='#A13A3A'; st.innerText='Isi URL dulu sebelum tes.'; return; }
    st.style.color = '#9C7A2E';
    st.innerText = 'Menghubungi worker...';
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'ping' }), signal: AbortSignal.timeout(8000) });
        if (res.ok || res.status === 400 || res.status === 422) {
            st.style.color = '#2E6B4F';
            st.innerText = 'Worker merespons! Koneksi berhasil.';
        } else {
            st.style.color = '#A13A3A';
            st.innerText = `Worker merespons tapi status: ${res.status}. Periksa konfigurasi worker.`;
        }
    } catch (e) {
        st.style.color = '#A13A3A';
        st.innerText = `Gagal terhubung: ${e.message}`;
    }
};
window.copyAIResult = function() {
    const text = document.getElementById('aiAnalysisResult').innerText;
    navigator.clipboard.writeText(text).then(() => window.showToast('Hasil analisis disalin!', 'success'));
};
// [NEW] Export hasil AI analisis ke file teks yang bisa di-download
window.exportAIResult = function() {
    const text = document.getElementById('aiAnalysisResult').innerText;
    if (!text || text.includes('Pilih periode')) {
        window.showToast('Tidak ada hasil untuk diekspor.', 'warning');
        return;
    }
    const period = document.getElementById('aiAnalysisPeriod')?.value || 'all';
    const type = document.getElementById('aiAnalysisType')?.value || 'general';
    const periodLabel = { all:'Semua Data', thismonth:'Bulan Ini', lastmonth:'Bulan Lalu', last3months:'3 Bulan Terakhir' }[period];
    const typeLabel = { general:'Ringkasan Umum', expense:'Analisis Pengeluaran', saving:'Tips Hemat', cashflow:'Arus Kas' }[type];
    const header = `=== Laporan Analisis AI Sinarkeu ===\nPeriode: ${periodLabel}\nJenis: ${typeLabel}\nTanggal: ${new Date().toLocaleString('id-ID')}\n\n`;
    const blob = new Blob([header + text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safePeriod = { all:'semua', thismonth:'bulan-ini', lastmonth:'bulan-lalu', last3months:'3-bulan' }[period];
    const safeType = { general:'ringkasan', expense:'pengeluaran', saving:'hemat', cashflow:'arus-kas' }[type];
    a.download = `sinarkeu-ai-${safePeriod}-${safeType}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    window.showToast('Hasil AI diekspor ke file teks!', 'success');
};

// ==================== TANYA AI (CHAT Q&A) ====================
// Beda dengan "Analisis AI" (insight umum), fitur ini menjawab pertanyaan
// SPESIFIK pengguna seperti "listrik bulan Juni berapa?". Supaya AI tidak
// mengarang angka, kita kirim SELURUH transaksi yang ada di cache lokal
// (window.txs, maks MAX_LOCAL_TXS / 300 terbaru) sebagai tabel mentah, dan
// wajibkan AI menunjukkan rincian transaksi yang dipakai untuk menghitung
// jawabannya -- supaya pengguna bisa memverifikasi sendiri ketepatannya.
if (!window._aiChatHistory) window._aiChatHistory = [];
// [NEW] Load history dari localStorage saat pertama dipakai
window.loadAIChatHistory = function() {
    try {
        const saved = localStorage.getItem('sinarkeu_ai_chat_history');
        if (saved) {
            window._aiChatHistory = JSON.parse(saved);
        }
    } catch(e) {
        window._aiChatHistory = [];
    }
};
// [NEW] Simpan history ke localStorage otomatis
window.saveAIChatHistory = function() {
    try {
        localStorage.setItem('sinarkeu_ai_chat_history', JSON.stringify(window._aiChatHistory));
    } catch(e) {
        // ignore quota errors
    }
};

window.openAIChatModal = function() {
    const endpoint = window.resolveAIEndpoint();
    const warn = document.getElementById('aiChatWorkerWarning');
    if (warn) warn.style.display = endpoint.ok ? 'none' : 'block';
    window.loadAIChatHistory();
    window.renderAIChatBubbles();
    window.updateAIChatPresets();
    window.openModal('aiChatModal');
    setTimeout(() => { const inp = document.getElementById('aiChatInput'); if (inp) inp.focus(); }, 150);
};
// [NEW] Update tombol preset pertanyaan berdasarkan transaksi
window.updateAIChatPresets = function() {
    const presetContainer = document.getElementById('aiChatPresets');
    if (!presetContainer || !window.txs || window.txs.length === 0) return;
    // Cari kategori pengeluaran teratas
    const catMap = {};
    window.txs.filter(t => t.type === 'expense').forEach(t => {
        const cat = t.category || 'Lain-lain';
        catMap[cat] = (catMap[cat] || 0) + Number(t.amount);
    });
    const sorted = Object.entries(catMap).sort((a,b) => b[1]-a[1]);
    const topCat = sorted[0]?.[0] || 'pengeluaran';
    const topCatLower = topCat.toLowerCase();
    presetContainer.innerHTML = `
        <div style="font-size:.68rem; color:var(--ink-faint); margin-bottom:8px;">Tanyakan apa saja, contoh:</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
            <button type="button" class="btn btn-secondary" style="font-size:.62rem; padding:3px 8px;" onclick="window.useAIChatExample('Pemasukan bulan ini berapa?')">Pemasukan bulan ini?</button>
            <button type="button" class="btn btn-secondary" style="font-size:.62rem; padding:3px 8px;" onclick="window.useAIChatExample('Pengeluaran ${topCatLower} bulan ini berapa?')">${topCat} bulan ini?</button>
            <button type="button" class="btn btn-secondary" style="font-size:.62rem; padding:3px 8px;" onclick="window.useAIChatExample('Kategori apa yang paling besar pengeluarannya?')">Kategori terbesar?</button>
        </div>
    `;
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
        box.innerHTML = '<div style="text-align:center; color:#9AA2AC; font-size:.72rem; padding:20px 0;" id="aiChatEmptyState">Belum ada percakapan. Coba tanyakan sesuatu di bawah.</div>';
        return;
    }
    box.innerHTML = window._aiChatHistory.map(m => {
        if (m.role === 'user') {
            return `<div style="display:flex; justify-content:flex-end; margin-bottom:8px;"><div style="background:#2E6B67; color:#fff; padding:8px 12px; border-radius:10px 10px 2px 10px; max-width:82%; font-size:.78rem; white-space:pre-wrap;">${window.escapeHtml(m.text)}</div></div>`;
        }
        if (m.role === 'loading') {
            return `<div style="display:flex; justify-content:flex-start; margin-bottom:8px;"><div style="background:#fff; border:1px solid #E7E9ED; color:#9AA2AC; padding:8px 12px; border-radius:10px 10px 10px 2px; font-size:.78rem;">AI sedang menghitung dari data transaksi...</div></div>`;
        }
        if (m.role === 'error') {
            return `<div style="display:flex; justify-content:flex-start; margin-bottom:8px;"><div style="background:#F5E6E6; border:1px solid #C77A73; color:#7E2E2E; padding:8px 12px; border-radius:10px 10px 10px 2px; max-width:88%; font-size:.78rem; white-space:pre-wrap;">${window.escapeHtml(m.text)}</div></div>`;
        }
        return `<div style="display:flex; justify-content:flex-start; margin-bottom:8px;"><div style="background:#fff; border:1px solid #E7E9ED; color:#1C2430; padding:8px 12px; border-radius:10px 10px 10px 2px; max-width:88%; font-size:.78rem; white-space:pre-wrap; line-height:1.65;">${window.escapeHtml(m.text)}</div></div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
};

window.sendAIChatMessage = async function() {
    const inp = document.getElementById('aiChatInput');
    const sendBtn = document.getElementById('aiChatSendBtn');
    const question = (inp?.value || '').trim();
    if (!question) return;
    const endpointCheck = window.resolveAIEndpoint();
    if (!endpointCheck.ok) {
        window.showToast(endpointCheck.reason, 'warning');
        return;
    }
    if (!window.txs || window.txs.length === 0) {
        window.showToast('Belum ada transaksi untuk ditanyakan.', 'warning');
        return;
    }
    window._aiChatHistory.push({ role: 'user', text: question });
    window._aiChatHistory.push({ role: 'loading', text: '' });
    window.saveAIChatHistory();
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
        const { text } = await window.callAIEngine(prompt);
        window._aiChatHistory.pop(); // buang placeholder loading
        window._aiChatHistory.push({ role: 'assistant', text });
        window.saveAIChatHistory();
    } catch (e) {
        window._aiChatHistory.pop();
        window._aiChatHistory.push({ role: 'error', text: `Gagal mendapat jawaban: ${e.message}` });
        window.saveAIChatHistory();
    } finally {
        sendBtn.disabled = false;
        window.renderAIChatBubbles();
    }
};

window.clearAIChatHistory = function() {
    if (window._aiChatHistory.length === 0) return;
    if (!confirm('Hapus seluruh riwayat percakapan Tanya AI?')) return;
    window._aiChatHistory = [];
    localStorage.removeItem('sinarkeu_ai_chat_history');
    window.renderAIChatBubbles();
};
// ==================== AI ANALISIS FASE KEHIDUPAN ====================
window.runFaseAIAnalysis = async function() {
    const endpointCheck = window.resolveAIEndpoint();
    const fase = window.getFaseKehidupan ? window.getFaseKehidupan() : null;

    window.openModal('faseAIModal');

    const resultEl = document.getElementById('faseAIResult');
    const footerEl = document.getElementById('faseAIFooter');
    const runBtn   = document.getElementById('faseAIRunBtn');
    const copyBtn  = document.getElementById('faseAICopyBtn');

    if (!fase || !fase.fase) {
        resultEl.innerHTML = '<div style="text-align:center; color:#A13A3A; padding:40px 0;">Atur fase kehidupan terlebih dahulu.<br><a href="#" onclick="window.closeModal(\'faseAIModal\'); window.openFaseKehidupanModal(); return false;" style="color:#8C6B78; font-weight:600;">Atur Fase Kehidupan</a></div>';
        return;
    }
    if (!endpointCheck.ok) {
        resultEl.innerHTML = `<div style="text-align:center; color:#A13A3A; padding:40px 0;">${window.escapeHtml(endpointCheck.reason)}<br><a href="#" onclick="window.closeModal('faseAIModal'); window.openSetelanModal('ai'); return false;" style="color:#A13A3A; font-weight:600;">Setelan → Analisis AI</a></div>`;
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
    resultEl.innerHTML = '<div style="text-align:center; color:#8C6B78; padding:40px 0;">AI sedang menganalisis keuangan berdasarkan fase kehidupan Anda...</div>';
    footerEl.innerText = '';

    try {
        const { text } = await window.callAIEngine(prompt);
        resultEl.innerText = text;
        footerEl.innerText = `Dianalisis berdasarkan fase: ${faseData.nama} · ${new Date().toLocaleString('id-ID')}`;
        copyBtn.style.display = 'inline-flex';
    } catch(e) {
        resultEl.innerHTML = `<div style="color:#A13A3A; line-height:1.8;">Gagal: <b>${e.message}</b></div>`;
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
