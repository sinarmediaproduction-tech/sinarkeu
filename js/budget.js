// ==================== BUDGET ====================
window.getDefaultBudget = function(bookId) {
    const raw = localStorage.getItem('sk_default_budget_' + (bookId || window.currentBookId));
    if (raw) {
        try { return window.migrateBudgetCategoryKeys(JSON.parse(raw)); } catch { return {}; }
    }
    return {};
};
window.saveDefaultBudgetToLocal = function(bookId, budgetObj) {
    localStorage.setItem('sk_default_budget_' + (bookId || window.currentBookId), JSON.stringify(budgetObj));
};
window.getEffectiveBudget = function(year, month, bookId) {
    const bId = bookId || window.currentBookId;
    const key = `${year}-${month}`;
    const now = new Date();
    if (year === now.getFullYear() && month === now.getMonth() + 1) {
        window.ensureMonthlyBudgetExists(year, month, bId);
    }
    const monthlyBudget = window.migrateBudgetCategoryKeys(_budgetsForBook(bId)[key] || {});
    const defaultBudget = window.getDefaultBudget(bId);
    const hasCustom = Object.values(monthlyBudget).some(v => v > 0);
    if (hasCustom) {
        return { budget: monthlyBudget, source: 'custom', key: key };
    } else {
        return { budget: defaultBudget, source: 'default', key: 'default' };
    }
};
// [FIX BUG LATEN - getEffectiveBudget/ensureMonthlyBudgetExists ikut buku aktif]
// bookId di kedua fungsi ini SEHARUSNYA menentukan buku mana yang diproses,
// tapi sebelumnya keduanya selalu baca/tulis window.budgets langsung --
// variabel GLOBAL yang cuma pernah berisi data buku yang SEDANG aktif (lihat
// semua tempat yang nulis window.budgets di app.js/book.js/settings.js/
// transaction.js, semuanya pakai window.currentBookId, bukan parameter
// bookId yang dioper ke sini). Selama fungsi ini SELALU dipanggil dengan
// bookId == currentBookId (satu-satunya cara dipakai saat ini), tidak ada
// gejala -- tapi kalau nanti dipanggil dengan bookId buku LAIN,
// ensureMonthlyBudgetExists bisa: (1) baca window.budgets[key] milik buku
// yang SALAH untuk cek "sudah ada budget custom belum" -- bisa auto-apply
// default padahal buku target sudah punya budget custom, atau sebaliknya;
// (2) kalau menulis, ujung-ujungnya mengoper window.budgets (data buku
// aktif) ke window.saveMonthlyBudgetToCloud(bId, ...) -- menimpa SELURUH
// budget bulanan buku target dengan snapshot budget buku yang sedang aktif.
// Perbaikan: baca budgets khusus untuk bId (dari localStorage kalau beda
// dari buku aktif, dari window.budgets kalau sama -- window.budgets tetap
// jadi sumber untuk buku aktif seperti sebelumnya, tidak ada perubahan
// perilaku untuk pemanggilan yang sudah ada).
function _budgetsForBook(bId) {
    if (bId === window.currentBookId) return window.budgets || {};
    try { return JSON.parse(localStorage.getItem('sk_budgets_' + bId) || '{}'); } catch { return {}; }
}

// Flag per-key untuk mencegah double write ke Supabase apabila
// ensureMonthlyBudgetExists() dan checkNewMonthAutoApply() keduanya
// terpanggil dalam satu sesi untuk bulan yang sama.
if (!window._budgetAutoAppliedKeys) window._budgetAutoAppliedKeys = new Set();

window.ensureMonthlyBudgetExists = function(year, month, bookId) {
    const bId = bookId || window.currentBookId;
    const key = `${year}-${month}`;
    const budgetsForThisBook = _budgetsForBook(bId);
    if (budgetsForThisBook[key] && Object.values(budgetsForThisBook[key]).some(v => v > 0)) {
        return;
    }
    // Sudah ditangani oleh checkNewMonthAutoApply di sesi ini, skip.
    if (window._budgetAutoAppliedKeys.has(key + '_' + bId)) return;
    const defaultBudget = window.getDefaultBudget(bId);
    if (Object.keys(defaultBudget).length > 0) {
        budgetsForThisBook[key] = { ...defaultBudget };
        window._budgetAutoAppliedKeys.add(key + '_' + bId);
        window.saveMonthlyBudgetToCloud(bId, budgetsForThisBook);
        console.log(`[Budget] Auto-apply default budget untuk ${key} di buku ${bId}`);
    }
};
window.checkNewMonthAutoApply = function() {
    // Guard: window.budgets bisa null kalau data cloud corrupt atau belum siap
    if (!window.budgets || typeof window.budgets !== 'object') {
        window.budgets = {};
    }
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const key = `${y}-${m}`;
    const hasBudget = window.budgets[key] && Object.values(window.budgets[key]).some(v => v > 0);
    if (!hasBudget) {
        const defaultBudget = window.getDefaultBudget(window.currentBookId);
        if (Object.keys(defaultBudget).length > 0) {
            // Sudah ditangani oleh ensureMonthlyBudgetExists di sesi ini, skip.
            if (window._budgetAutoAppliedKeys.has(key + '_' + window.currentBookId)) return;
            window.budgets[key] = { ...defaultBudget };
            localStorage.setItem('sk_budgets_' + window.currentBookId, JSON.stringify(window.budgets));
            window._budgetAutoAppliedKeys.add(key + '_' + window.currentBookId);
            window.saveMonthlyBudgetToCloud(window.currentBookId, window.budgets);
            console.log(`[Budget] Auto-apply default budget untuk ${key} (bulan baru)`);
            // DO NOT call renderBudget() here — renderBudget() already calls
            // checkNewMonthAutoApply() at its start, so calling it here would
            // cause infinite mutual recursion.
        }
    }
};
// [BUG FIX - REALISASI ANGGARAN BULAN LAMA SALAH] Sebelumnya totalActual di bawah
// SELALU dihitung dari window.txs, yang (lihat trimAndSaveLocal di transaction.js)
// cuma menyimpan MAX_LOCAL_TXS (1000) transaksi TERBARU per buku. Dropdown
// #budgetYear mengizinkan user memilih tahun currentYear-2 s/d currentYear+2
// (lihat app.js), jadi user memang bisa mengecek anggaran bulan yang transaksinya
// sudah "tertrim" dari cache lokal untuk buku dengan >1000 transaksi. Akibatnya
// realisasi (totalActual) yang tampil bisa jauh lebih kecil dari kenyataan --
// progress bar terlihat aman padahal anggaran bulan itu sebenarnya sudah jebol.
// Ini persis kelas bug yang sudah diperbaiki di report.js (generateMonthlyReport)
// dan telegram.js/ai.js (lewat balanceOffset untuk saldo total) tapi kelewat di sini.
//
// Perbaikan: tetap render SEKETIKA dari window.txs dulu (cepat, tetap benar untuk
// bulan yang masih ada di cache/mode offline), lalu -- kalau online -- tarik ulang
// transaksi bulan itu LANGSUNG dari cloud (window.fetchMonthTransactionsFromCloud,
// sudah ada & dipakai report.js, tanpa batas limit seperti window.txs) dan perbaiki
// tampilan realisasi begitu datanya sampai. window._budgetRenderToken mencegah hasil
// fetch yang sudah basi (user keburu ganti bulan/tahun lagi) menimpa tampilan yang
// sedang aktif.
window._budgetRenderToken = 0;

window._computeBudgetActualLocal = function(m, y) {
    let totalActual = 0;
    window.txs.forEach(t => {
        if (t.type === 'expense') {
            let d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
            if ((d.getMonth() + 1) == m && d.getFullYear() == y) {
                totalActual += (Number(t.amount) || 0);
            }
        }
    });
    return totalActual;
};

window._applyBudgetActualUI = function(totalTarget, totalActual) {
    document.getElementById('budgetTargetDisplay').innerText = window.rp(totalTarget);
    document.getElementById('budgetActualDisplay').innerText = window.rp(totalActual);
    let remaining = totalTarget - totalActual;
    let remEl = document.getElementById('budgetRemainingDisplay');
    remEl.innerText = window.rp(remaining);
    if (remaining >= 0) { remEl.className = "budget-mini-value positive"; }
    else { remEl.className = "budget-mini-value negative"; }
    let pct = 0;
    if (totalTarget > 0) { pct = Math.min((totalActual / totalTarget) * 100, 100); }
    else if (totalActual > 0) { pct = 100; }
    let fill = document.getElementById('budgetProgressFill');
    fill.style.width = pct + '%';
    let fill2 = document.getElementById('budgetProgressFill2');
    if (fill2) fill2.style.width = pct + '%';
    let pctEl = document.getElementById('budgetProgressPct');
    pctEl.innerText = Math.round(pct) + '%';
    let pctEl2 = document.getElementById('budgetProgressPct2');
    if (pctEl2) pctEl2.innerText = Math.round(pct) + '%';
    if (pct >= 100 && totalTarget > 0) {
        fill.className = "budget-mini-progress-fill danger";
        if (fill2) fill2.className = "budget-mini-progress-fill danger";
        pctEl.style.color = '#A13A3A';
        if (pctEl2) pctEl2.style.color = '#A13A3A';
    } else if (pct >= 80) {
        fill.className = "budget-mini-progress-fill warning";
        if (fill2) fill2.className = "budget-mini-progress-fill warning";
        pctEl.style.color = '#9C7A2E';
        if (pctEl2) pctEl2.style.color = '#9C7A2E';
    } else {
        fill.className = "budget-mini-progress-fill";
        if (fill2) fill2.className = "budget-mini-progress-fill";
        pctEl.style.color = '#2E6B4F';
        if (pctEl2) pctEl2.style.color = '#2E6B4F';
    }
};

window.renderBudget = function() {
    window.checkNewMonthAutoApply();
    const m = document.getElementById('budgetMonth').value;
    const y = document.getElementById('budgetYear').value;
    const effective = window.getEffectiveBudget(parseInt(y), parseInt(m), window.currentBookId);
    const currentBudget = effective.budget;
    const source = effective.source;
    const tag = document.getElementById('budgetSourceTag');
    if (tag) {
        if (source === 'custom') {
            tag.className = 'budget-source-tag custom';
            tag.innerText = window.t('this_month_only');
        } else if (source === 'default' && Object.keys(currentBudget).length > 0) {
            tag.className = 'budget-source-tag default';
            tag.innerText = window.t('monthly_budget');
        } else {
            tag.className = 'budget-source-tag none';
            tag.innerText = window.t('no_budget');
        }
    }
    let totalTarget = 0;
    window.EXPENSE_CATEGORIES.forEach(cat => { totalTarget += (currentBudget[cat] || 0); });

    // Render seketika dari cache lokal — benar untuk bulan yang masih ada di
    // window.txs dan untuk mode offline (lihat catatan [BUG FIX] di atas).
    const totalActualLocal = window._computeBudgetActualLocal(m, y);
    window._applyBudgetActualUI(totalTarget, totalActualLocal);

    // Perbaiki dengan data cloud lengkap kalau online, supaya bulan yang sudah
    // di luar cache MAX_LOCAL_TXS tetap menampilkan realisasi yang benar.
    const myToken = ++window._budgetRenderToken;
    const bookIdAtCall = window.currentBookId;
    if (window.isOnline() && typeof window.fetchMonthTransactionsFromCloud === 'function') {
        window.fetchMonthTransactionsFromCloud(bookIdAtCall, parseInt(y), parseInt(m))
            .then(cloudTx => {
                // Batalkan hasil basi: user sudah ganti bulan/tahun/buku, atau
                // renderBudget() sudah dipanggil ulang sejak fetch ini dimulai.
                if (myToken !== window._budgetRenderToken) return;
                if (bookIdAtCall !== window.currentBookId) return;
                if (!cloudTx || !Array.isArray(cloudTx)) return; // gagal/offline di tengah jalan — pertahankan angka lokal
                const currentM = document.getElementById('budgetMonth').value;
                const currentY = document.getElementById('budgetYear').value;
                if (currentM != m || currentY != y) return; // dropdown sudah berubah lagi
                let totalActualCloud = 0;
                cloudTx.forEach(t => { if (t.type === 'expense') totalActualCloud += (Number(t.amount) || 0); });
                window._applyBudgetActualUI(totalTarget, totalActualCloud);
            })
            .catch(() => { /* biarkan angka lokal, sudah ditampilkan di atas */ });
    }
};

window.renderBudgetFormFields = function() {
    const container = document.getElementById('budgetCategoriesContainer');
    container.innerHTML = '';
    let m = document.getElementById('budgetModalMonth').value;
    let y = document.getElementById('budgetModalYear').value;
    let key = `${y}-${m}`;
    window.ensureMonthlyBudgetExists(parseInt(y), parseInt(m), window.currentBookId);
    const effective = window.getEffectiveBudget(parseInt(y), parseInt(m), window.currentBookId);
    const currentBudget = effective.budget;
    const source = effective.source;
    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'font-size:.72rem; color:#5B6472; margin-bottom:12px; padding:8px 12px; border-radius: var(--radius-sm); background:#F4F5F7;';
    if (source === 'default') {
        infoDiv.innerHTML = '<b>Menggunakan Anggaran Bulanan</b> — Anda dapat mengubahnya di sini untuk membuat versi khusus bulan ini.';
        infoDiv.style.background = '#E3F0E9';
        infoDiv.style.color = '#1F5138';
    } else if (source === 'custom') {
        infoDiv.innerHTML = '<b>Anggaran Khusus Bulan Ini</b> — Bulan berikutnya akan kembali ke Anggaran Bulanan.';
        infoDiv.style.background = '#E3ECF3';
        infoDiv.style.color = '#2E5C82';
    } else {
        infoDiv.innerHTML = '<b>Belum ada anggaran</b> — Atur anggaran di bawah, atau klik kartu Anggaran Bulanan untuk mengaturnya.';
        infoDiv.style.background = '#F1EBDA';
        infoDiv.style.color = '#9C7A2E';
    }
    container.appendChild(infoDiv);
    window.EXPENSE_CATEGORIES.forEach(cat => {
        const val = currentBudget[cat] || 0;
        const div = document.createElement('div');
        div.className = 'budget-cat-row';
        div.innerHTML = `
            <span class="budget-cat-label">${window.escapeHtml(cat)}</span>
            <input type="text" class="form-control budget-input-field" data-cat="${window.escapeHtml(cat)}" value="${val ? Number(val).toLocaleString('id-ID') : ''}" oninput="window.formatRupiah(this); window.updateBudgetSummary();" placeholder="Rp 0">
        `;
        container.appendChild(div);
    });
    window.updateBudgetSummary();
};
window.updateBudgetSummary = function() {
    const inputs = document.querySelectorAll('.budget-input-field');
    let total = 0;
    inputs.forEach(input => { total += window.unRp(input.value); });
    const el = document.getElementById('budgetSummary');
    if (el) {
        el.innerText = window.t('monthly_total') + window.rp(total);
    }
};
window.openBudgetModal = function() {
    if (!window.requireOnline('mengatur anggaran')) return;
    let m = document.getElementById('budgetMonth').value;
    let y = document.getElementById('budgetYear').value;
    let modalMonth = document.getElementById('budgetModalMonth');
    modalMonth.innerHTML = document.getElementById('budgetMonth').innerHTML;
    modalMonth.value = m;
    document.getElementById('budgetModalYear').value = y;
    window.renderBudgetFormFields();
    window.openModal('budgetModal');
};
window.saveBudget = async function() {
    if (!window.requireOnline('menyimpan anggaran')) return;
    let m = document.getElementById('budgetModalMonth').value;
    let y = document.getElementById('budgetModalYear').value;
    let key = `${y}-${m}`;
    if (!window.budgets[key]) window.budgets[key] = {};
    let inputs = document.querySelectorAll('.budget-input-field');
    let hasAnyValue = false;
    inputs.forEach(input => {
        let cat = input.getAttribute('data-cat');
        if (window.EXPENSE_CATEGORIES.includes(cat)) {
            const val = window.unRp(input.value);
            window.budgets[key][cat] = val;
            if (val > 0) hasAnyValue = true;
        }
    });
    if (!hasAnyValue) delete window.budgets[key];
    localStorage.setItem('sk_budgets_' + window.currentBookId, JSON.stringify(window.budgets));
    window.closeModal('budgetModal');
    window.renderBudget();
    // Ditunggu (await) supaya kita tahu pasti hasil push ke cloud sebelum
    // memberi tahu pengguna, bukan fire-and-forget seperti sebelumnya.
    const ok = await window.saveMonthlyBudgetToCloud(window.currentBookId, window.budgets);
    if (!hasAnyValue) {
        window.showToast(
            ok ? 'Anggaran bulan ini dihapus, akan menggunakan Anggaran Bulanan.'
               : 'Dihapus lokal, tapi gagal sync ke cloud. Coba simpan lagi.',
            ok ? 'info' : 'warning'
        );
    } else {
        window.showToast(
            ok ? 'Anggaran bulanan berhasil diperbarui & disinkron ke cloud'
               : 'Tersimpan lokal, tapi GAGAL sync ke cloud. Coba simpan lagi saat online.',
            ok ? 'success' : 'warning'
        );
    }
    // Anggaran berubah bisa mengubah status peringatan di daftar belanja
    // (window._renderShoppingListBudgetWarnings, js/shopping-list.js) --
    // refresh kalau modalnya sedang terbuka.
    const slModal = document.getElementById('shoppingListModal');
    if (slModal && slModal.classList.contains('show') && typeof window.renderShoppingList === 'function') {
        window.renderShoppingList();
    }
};

// Default Budget Modal
window.openDefaultBudgetModal = function() {
    if (!window.requireOnline('mengatur anggaran bulanan')) return;
    const search = document.getElementById('defaultBudgetSearch');
    if (search) search.value = '';
    window.openModal('defaultBudgetModal');
    window.runAfterNextPaint(function() {
        const modal = document.getElementById('defaultBudgetModal');
        if (modal && modal.classList.contains('show')) window.renderDefaultBudgetForm();
    });
};
window.renderDefaultBudgetForm = function() {
    const container = document.getElementById('defaultBudgetCategoriesContainer');
    container.innerHTML = '';
    const defaultBudget = window.getDefaultBudget(window.currentBookId);
    if (!window.EXPENSE_CATEGORIES.length) {
        container.innerHTML = '<div class="dbudget-empty-hint">Belum ada kategori pengeluaran.</div>';
        window.updateDefaultBudgetSummary();
        return;
    }
    const sortedCategories = [...window.EXPENSE_CATEGORIES].sort((a, b) => {
        const valA = defaultBudget[a] || 0;
        const valB = defaultBudget[b] || 0;
        return valB - valA;
    });
    sortedCategories.forEach((cat, idx) => {
        const val = defaultBudget[cat] || 0;
        const colorClass = 'c' + (idx % 5);
        const div = document.createElement('div');
        div.className = 'dbudget-item' + (val ? ' filled' : '');
        div.dataset.catName = cat.toLowerCase();
        div.innerHTML = `
            <span class="dbudget-badge ${colorClass}">${idx + 1}</span>
            <div class="dbudget-body">
                <span class="dbudget-name">${window.escapeHtml(cat)}</span>
                <div class="dbudget-input-row">
                    <input type="text" class="form-control default-budget-input" data-cat="${window.escapeHtml(cat)}" value="${val ? Number(val).toLocaleString('id-ID') : ''}" oninput="window.formatRupiah(this); window.updateDefaultBudgetSummary();" placeholder="Rp 0">
                    <button type="button" class="dbudget-clear-btn" title="Kosongkan" onclick="window.clearDefaultBudgetInput(this)">×</button>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
    window.updateDefaultBudgetSummary();
};
window.clearDefaultBudgetInput = function(btn) {
    const row = btn.closest('.dbudget-item');
    const input = row && row.querySelector('.default-budget-input');
    if (!input) return;
    input.value = '';
    window.updateDefaultBudgetSummary();
};
window.filterDefaultBudgetCategories = function(query) {
    const q = (query || '').trim().toLowerCase();
    const items = document.querySelectorAll('#defaultBudgetCategoriesContainer .dbudget-item');
    items.forEach(item => {
        const match = !q || (item.dataset.catName || '').includes(q);
        item.classList.toggle('dbudget-hidden', !match);
    });
};
window.updateDefaultBudgetSummary = function() {
    const inputs = document.querySelectorAll('.default-budget-input');
    let total = 0, filled = 0;
    inputs.forEach(input => {
        const v = window.unRp(input.value);
        total += v;
        const row = input.closest('.dbudget-item');
        if (row) row.classList.toggle('filled', v > 0);
        if (v > 0) filled++;
    });
    const el = document.getElementById('defaultBudgetSummary');
    if (el) el.innerText = window.rp(total);
    const metaEl = document.getElementById('defaultBudgetFilledCount');
    if (metaEl) metaEl.innerText = `${filled} dari ${inputs.length} kategori diisi`;
};
// Bandingkan dua objek budget kategori: true kalau semua kategori (union dari
// keduanya) punya nilai yang sama persis. Dipakai untuk mendeteksi apakah
// salinan bulan berjalan di window.budgets[key] masih "murni" hasil auto-copy
// dari Anggaran Dasar lama (belum pernah diubah manual khusus bulan itu).
window._isBudgetIdenticalToDefault = function(monthlyBudget, oldDefaultBudget) {
    const cats = new Set([...Object.keys(monthlyBudget || {}), ...Object.keys(oldDefaultBudget || {})]);
    for (const cat of cats) {
        const a = Number((monthlyBudget || {})[cat]) || 0;
        const b = Number((oldDefaultBudget || {})[cat]) || 0;
        if (a !== b) return false;
    }
    return true;
};
window.saveDefaultBudget = async function() {
    if (!window.requireOnline('menyimpan anggaran bulanan')) return;
    const inputs = document.querySelectorAll('.default-budget-input');
    const newBudget = {};
    inputs.forEach(input => {
        const cat = input.getAttribute('data-cat');
        if (window.EXPENSE_CATEGORIES.includes(cat)) {
            newBudget[cat] = window.unRp(input.value);
        }
    });
    // [FIX - ANGGARAN BULANAN TIDAK SINKRON] Ambil Anggaran Dasar LAMA sebelum
    // ditimpa. Untuk tiap bulan yang sudah punya salinan di window.budgets
    // (dibuat otomatis oleh ensureMonthlyBudgetExists/checkNewMonthAutoApply),
    // cek apakah salinan itu masih identik dengan Anggaran Dasar lama. Kalau
    // ya, itu cuma auto-copy yang belum pernah diubah manual khusus bulan
    // tersebut -- jadi ikut diperbarui ke nilai baru supaya peringatan di
    // daftar belanja (window._renderShoppingListBudgetWarnings) tidak lagi
    // memakai batas anggaran versi lama. Kalau nilainya berbeda dari Anggaran
    // Dasar lama, berarti user pernah set override khusus bulan itu -- tetap
    // dijaga, tidak ditimpa.
    const oldDefaultBudget = window.getDefaultBudget(window.currentBookId);
    let anyMonthlyUpdated = false;
    if (window.budgets && typeof window.budgets === 'object') {
        Object.keys(window.budgets).forEach(key => {
            // Migrasi nama kategori dulu sebelum dibandingkan -- kalau tidak,
            // salinan lama yang masih pakai nama kategori LAMA (mis. "Tagihan")
            // akan selalu kelihatan "beda" dari Anggaran Dasar yang sudah pakai
            // nama BARU ("Tagihan Bulanan"), padahal nilainya sama persis.
            const monthlyBudget = window.migrateBudgetCategoryKeys(window.budgets[key]);
            if (monthlyBudget && window._isBudgetIdenticalToDefault(monthlyBudget, oldDefaultBudget)) {
                window.budgets[key] = { ...newBudget };
                anyMonthlyUpdated = true;
            }
        });
        if (anyMonthlyUpdated) {
            localStorage.setItem('sk_budgets_' + window.currentBookId, JSON.stringify(window.budgets));
        }
    }
    window.saveDefaultBudgetToLocal(window.currentBookId, newBudget);
    window.closeModal('defaultBudgetModal');
    window.renderBudget();
    // Ditunggu (await) supaya status sukses/gagal sync ke cloud diketahui
    // pasti sebelum toast ditampilkan, bukan diasumsikan berhasil begitu saja.
    const ok = await window.saveDefaultBudgetToCloud(window.currentBookId, newBudget);
    if (anyMonthlyUpdated) {
        await window.saveMonthlyBudgetToCloud(window.currentBookId, window.budgets);
    }
    window.showToast(
        ok ? 'Anggaran Bulanan berhasil disimpan & disinkron ke cloud!'
           : 'Tersimpan lokal, tapi GAGAL sync ke cloud. Coba simpan lagi saat online.',
        ok ? 'success' : 'warning'
    );
    window.updateFinancialCards && window.updateFinancialCards();
    if (document.getElementById('budgetModal').classList.contains('show')) {
        window.renderBudgetFormFields();
    }
    // Anggaran Dasar berubah bisa mengubah status peringatan di daftar
    // belanja (window._renderShoppingListBudgetWarnings, js/shopping-list.js)
    // -- refresh kalau modalnya sedang terbuka.
    const slModal = document.getElementById('shoppingListModal');
    if (slModal && slModal.classList.contains('show') && typeof window.renderShoppingList === 'function') {
        window.renderShoppingList();
    }
};

// Budget warning
window.checkBudgetWarningAfterSave = function(date, category) {
    let d = new Date(date);
    let m = d.getMonth() + 1;
    let y = d.getFullYear();
    let key = `${y}-${m}`;
    const effective = window.getEffectiveBudget(y, m, window.currentBookId);
    const currentBudget = effective.budget;
    let totalBulan = 0, totalKat = 0;
    let totalTarget = 0;
    window.EXPENSE_CATEGORIES.forEach(c => totalTarget += (currentBudget[c] || 0));
    window.txs.forEach(t => {
        if (t.type !== 'expense') return;
        let td = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
        if ((td.getMonth() + 1) == m && td.getFullYear() == y) {
            totalBulan += (Number(t.amount) || 0);
            if (t.category === category) totalKat += (Number(t.amount) || 0);
        }
    });
    let monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    let bookName = window.getCurrentBookName();
    let katTarget = currentBudget[category] || 0;
    if (katTarget > 0) {
        let katPct = (totalKat / katTarget) * 100;
        if (katPct >= 100) {
            setTimeout(() => window.showToast(`Anggaran "${category}" HABIS! (${Math.round(katPct)}% terpakai)`, 'error'), 500);
            window.sendTelegramNotif(`<b>ANGGARAN HABIS!</b>\n\nBuku: <b>${bookName}</b>\nKategori: <b>${category}</b>\nPeriode: <b>${monthNames[m - 1]} ${y}</b>\n\nTerpakai: <b>${window.rp(totalKat)}</b> (${Math.round(katPct)}%)\nTarget: ${window.rp(katTarget)}`);
            return;
        } else if (katPct >= 80) {
            setTimeout(() => window.showToast(`Anggaran "${category}" hampir habis (${Math.round(katPct)}%)`, 'warning'), 500);
            window.sendTelegramNotif(`<b>Anggaran Hampir Habis</b>\n\nBuku: <b>${bookName}</b>\nKategori: <b>${category}</b>\nPeriode: <b>${monthNames[m - 1]} ${y}</b>\n\nTerpakai: ${window.rp(totalKat)} (${Math.round(katPct)}%)\nTarget: ${window.rp(katTarget)}`);
            return;
        }
    }
    if (totalTarget > 0) {
        let totalPct = (totalBulan / totalTarget) * 100;
        if (totalPct >= 100) {
            setTimeout(() => window.showToast(`Total anggaran bulanan HABIS! (${Math.round(totalPct)}% terpakai)`, 'error'), 500);
            window.sendTelegramNotif(`<b>TOTAL ANGGARAN BULANAN HABIS!</b>\n\nBuku: <b>${bookName}</b>\nPeriode: <b>${monthNames[m - 1]} ${y}</b>\n\nTotal Pengeluaran: <b>${window.rp(totalBulan)}</b> (${Math.round(totalPct)}%)\nTotal Anggaran: ${window.rp(totalTarget)}`);
        } else if (totalPct >= 80) {
            setTimeout(() => window.showToast(`Total anggaran bulanan hampir habis (${Math.round(totalPct)}%)`, 'warning'), 500);
            window.sendTelegramNotif(`<b>Anggaran Bulanan Hampir Habis</b>\n\nBuku: <b>${bookName}</b>\nPeriode: <b>${monthNames[m - 1]} ${y}</b>\n\nTotal Pengeluaran: ${window.rp(totalBulan)} (${Math.round(totalPct)}%)\nTotal Anggaran: ${window.rp(totalTarget)}`);
        }
    }
};

// ==================== ANGGARAN TAHUNAN ====================

window.getAnnualBudget = function(bookId) {
    const raw = localStorage.getItem('sk_annual_budget_' + (bookId || window.currentBookId));
    if (raw) { try { return JSON.parse(raw); } catch { return []; } }
    return [];
};

window.saveAnnualBudgetToLocal = function(bookId, items) {
    localStorage.setItem('sk_annual_budget_' + (bookId || window.currentBookId), JSON.stringify(items));
};

window.pushAnnualBudget = async function(bookId) {
    const items = window.getAnnualBudget(bookId || window.currentBookId);
    return await window.pushSetting('annual_budget', items, bookId || window.currentBookId);
};

window.openAnnualBudgetModal = function() {
    if (!window.requireOnline('mengatur anggaran tahunan')) return;
    window.renderAnnualBudgetForm();
    window.openModal('annualBudgetModal');
};

window.renderAnnualBudgetForm = function() {
    const container = document.getElementById('annualBudgetItemsContainer');
    container.innerHTML = '';
    const items = window.getAnnualBudget(window.currentBookId);
    if (items.length === 0) {
        window._annualBudgetRows = [{ name: '', amount: 0 }];
    } else {
        window._annualBudgetRows = items.map(i => ({ name: i.name, amount: i.amount }));
    }
    window._annualBudgetRows.forEach((_, idx) => window._renderAnnualRow(idx));
    window.updateAnnualBudgetSummary();
};

window._renderAnnualRow = function(idx) {
    const container = document.getElementById('annualBudgetItemsContainer');
    const row = window._annualBudgetRows[idx];
    const isOnlyRow = window._annualBudgetRows.length <= 1;
    const div = document.createElement('div');
    div.className = 'annual-budget-row';
    div.id = 'annual-row-' + idx;
    div.innerHTML = `
        <input type="text" class="form-control annual-budget-name" placeholder="Nama kebutuhan (misal: THR, Pajak, Servis)" 
            value="${window.escapeHtml(row.name)}"
            oninput="window._annualBudgetRows[${idx}].name = this.value; window.updateAnnualBudgetSummary();">
        <input type="text" class="form-control annual-budget-amount" placeholder="Rp 0"
            value="${row.amount ? Number(row.amount).toLocaleString('id-ID') : ''}"
            oninput="window.formatRupiah(this); window._annualBudgetRows[${idx}].amount = window.unRp(this.value); window.updateAnnualBudgetSummary();">
        ${isOnlyRow ? '' : `<button class="annual-budget-remove-btn" onclick="window.removeAnnualBudgetRow(${idx})">Hapus</button>`}
    `;
    container.appendChild(div);
};

window.addAnnualBudgetRow = function() {
    if (!window._annualBudgetRows) window._annualBudgetRows = [];
    window._annualBudgetRows.push({ name: '', amount: 0 });
    // Render ulang semua baris (bukan cuma baris baru) karena baris pertama
    // mungkin baru saja kehilangan/mendapat kembali tombol "Hapus"-nya.
    const container = document.getElementById('annualBudgetItemsContainer');
    container.innerHTML = '';
    window._annualBudgetRows.forEach((_, i) => window._renderAnnualRow(i));
    window.updateAnnualBudgetSummary();
};

window.removeAnnualBudgetRow = function(idx) {
    // Baris terakhir tidak boleh benar-benar hilang dari form - kalau dipaksa
    // (lewat panggilan lain), cukup dikosongkan supaya form tidak pernah
    // berada dalam keadaan 0 baris yang lalu bisa "disimpan" begitu saja.
    if (window._annualBudgetRows.length <= 1) {
        window._annualBudgetRows[0] = { name: '', amount: 0 };
    } else {
        window._annualBudgetRows.splice(idx, 1);
    }
    const container = document.getElementById('annualBudgetItemsContainer');
    container.innerHTML = '';
    window._annualBudgetRows.forEach((_, i) => window._renderAnnualRow(i));
    window.updateAnnualBudgetSummary();
};

window.updateAnnualBudgetSummary = function() {
    const total = (window._annualBudgetRows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const el = document.getElementById('annualBudgetSummary');
    if (el) el.innerText = window.t('annual_total') + window.rp(total);
};

window.saveAnnualBudget = async function() {
    if (!window.requireOnline('menyimpan anggaran tahunan')) return;
    const items = (window._annualBudgetRows || []).filter(r => r.name.trim() !== '' || r.amount > 0);
    window.saveAnnualBudgetToLocal(window.currentBookId, items);
    window.closeModal('annualBudgetModal');
    window.updateFinancialCards();
    // Ditunggu (await) supaya status sukses/gagal sync ke cloud diketahui
    // pasti sebelum toast ditampilkan.
    const ok = await window.pushAnnualBudget(window.currentBookId);
    window.showToast(
        ok ? 'Anggaran Tahunan berhasil disimpan & disinkron ke cloud!'
           : 'Tersimpan lokal, tapi GAGAL sync ke cloud. Coba simpan lagi saat online.',
        ok ? 'success' : 'warning'
    );
};

// ── DAFTAR ANGGARAN TAHUNAN ──────────────────────────────────────────────
// Item tahunan juga merupakan daftar pengeluaran berulang. Struktur lama
// {name, amount} tetap didukung; properti baru ditambahkan saat item dipakai.
window.getAnnualBudgetYearKey = function(date) { return String((date || new Date()).getFullYear()); };
window._annualBudgetItemSubtotal = function(item) { return (Number(item.amount) || 0) * ((Number(item.qty) || 0) > 0 ? Number(item.qty) : 1); };
window.ensureAnnualBudgetYearlyCycle = function(bookId) {
    const target = bookId || window.currentBookId;
    const items = window.getAnnualBudget(target);
    const year = window.getAnnualBudgetYearKey(); let changed = false;
    items.forEach(function(item, index) {
        // Data anggaran versi lama hanya berisi name/amount. Beri id saat
        // dimuat agar item lama juga bisa diedit, dihapus, dan dicentang.
        if (!item.id) { item.id = 'ab_legacy_' + Date.now() + '_' + index + '_' + Math.random().toString(36).slice(2, 7); changed = true; }
        if (!item.checklistYear) { item.checklistYear = year; changed = true; }
        else if (item.checklistYear !== year) { item.done = false; item.checklistYear = year; changed = true; }
    });
    if (changed) window.saveAnnualBudgetToLocal(target, items);
    return changed;
};
window.saveAnnualBudgetList = function(bookId, items) {
    const target = bookId || window.currentBookId;
    window.saveAnnualBudgetToLocal(target, items);
    if (window.isOnline && window.isOnline() && window.pushSetting) window.pushSetting('annual_budget', items, target).catch(function() {});
    if (typeof window.updateFinancialCards === 'function') window.updateFinancialCards();
};
window._populateAnnualBudgetCategory = function(selectId) {
    const sel = document.getElementById(selectId || 'annualNewCategory'); if (!sel) return;
    sel.innerHTML = '<option value="">Belanja Harian</option>' + (window.EXPENSE_CATEGORIES || []).map(c => `<option value="${window.escapeHtml(c)}">${window.escapeHtml(c)}</option>`).join('');
};
window.openAnnualBudgetModal = function() {
    window.ensureAnnualBudgetYearlyCycle(window.currentBookId);
    window._populateAnnualBudgetCategory();
    window.openModal('annualBudgetModal');
    window.runAfterNextPaint(function() {
        const modal = document.getElementById('annualBudgetModal');
        if (modal && modal.classList.contains('show')) window.renderAnnualBudgetForm();
    });

    // [AUTO HARGA PANGAN] Sama seperti window.openShoppingListModal
    // (js/shopping-list.js) -- tarik harga referensi BI tiap kali modal
    // dibuka, lalu isi otomatis kebutuhan yang belum ada nominalnya (atau
    // sebelumnya juga terisi otomatis lewat fitur ini) kalau namanya cocok
    // salah satu komoditas yang ditrack (window.HARGA_PANGAN_COMMODITIES,
    // js/harga-pangan.js). Nominal yang sudah diisi MANUAL oleh user tidak
    // pernah ditimpa.
    if (window.isOnline && window.isOnline() && typeof window.prefetchHargaPanganReferensi === 'function') {
        const bookAtOpen = window.currentBookId;
        window.prefetchHargaPanganReferensi().then(function() {
            const modal = document.getElementById('annualBudgetModal');
            if (!modal || !modal.classList.contains('show') || window.currentBookId !== bookAtOpen) return;
            window._applyHargaPanganReferensiToAnnualBudget();
        }).catch(function(e) {
            console.warn('[AnggaranTahunan] Gagal ambil harga referensi pangan:', e.message);
        });
    }
};

// Isi otomatis nominal kebutuhan tahunan yang BELUM punya nominal (atau
// sebelumnya juga terisi otomatis lewat fitur ini -- ditandai
// item.priceSource==='ref') dengan harga referensi PIHPS BI terbaru, kalau
// nama kebutuhannya cocok salah satu komoditas yang ditrack. Nominal yang
// sudah diisi MANUAL oleh user tidak pernah ditimpa -- persis pola
// window._applyHargaPanganReferensiToShoppingList di js/shopping-list.js.
window._applyHargaPanganReferensiToAnnualBudget = function() {
    const items = window.getAnnualBudget(window.currentBookId);
    let changed = false;
    items.forEach(function(item) {
        const isEmptyOrRef = !item.amount || item.priceSource === 'ref';
        if (!isEmptyOrRef) return;
        const ref = window.getHargaPanganUntukItem(item.name);
        if (!ref) return;
        if (item.amount === ref.price && item.priceSource === 'ref' && item.priceRefDate === ref.date) return;
        item.amount = ref.price;
        item.priceSource = 'ref';
        item.priceRefDate = ref.date;
        changed = true;
    });
    if (changed) window.saveAnnualBudgetList(window.currentBookId, items);
    window.renderAnnualBudgetForm();
};

window.renderAnnualBudgetForm = function() {
    window.ensureAnnualBudgetYearlyCycle(window.currentBookId);
    const box = document.getElementById('annualBudgetItemsContainer'); if (!box) return;
    const items = window.getAnnualBudget(window.currentBookId);
    const total = items.reduce((s, i) => s + window._annualBudgetItemSubtotal(i), 0);
    const summary = document.getElementById('annualBudgetSummary'); if (summary) summary.innerText = 'Total Anggaran Tahunan: ' + window.rp(total);
    const totalCard = document.getElementById('annualBudgetTotalCard'); if (totalCard) totalCard.innerText = window.rp(total);
    const progressCard = document.getElementById('annualBudgetProgressCard');
    if (progressCard) progressCard.innerText = `${items.filter(i => i.done).length} dari ${items.length} kebutuhan direalisasikan`;
    if (!items.length) { box.innerHTML = '<div class="slist-empty">Belum ada kebutuhan tahunan. Tambahkan THR, pajak, servis, atau kebutuhan lainnya.</div>'; return; }
    box.innerHTML = items.map(i => {
        // [AUTO HARGA PANGAN] i.priceSource==='ref' -> nominal ini diisi
        // otomatis dari referensi BI, bukan diketik manual -- ditandai "≈"
        // + title penjelasan, sama seperti badge di Daftar Belanja.
        const isRefPrice = i.priceSource === 'ref' && i.amount;
        const unitPriceText = i.amount ? (isRefPrice ? '≈ ' : '') + window.rp(i.amount) : '';
        const unitPriceClass = isRefPrice ? 'slist-unit-price is-ref-price' : 'slist-unit-price';
        const unitPriceTitle = isRefPrice
            ? ` title="Nominal referensi otomatis dari PIHPS Bank Indonesia (${window.escapeHtml(i.priceRefDate || '')}). Ubah manual lewat ✎ kalau harga sebenarnya beda."`
            : '';
        return `<div class="slist-item${i.done ? ' done' : ''}">
        <input type="checkbox" class="slist-checkbox" ${i.done ? 'checked' : ''} onchange="window.toggleAnnualBudgetItem('${window.escapeHtml(i.id)}')">
        <span class="slist-name">${window.escapeHtml(i.name || '')}</span><span class="slist-qty">${(Number(i.qty) || 1) > 1 ? 'x' + window.escapeHtml(String(i.qty)) : ''}</span>
        <span class="slist-cat-badge">${window.escapeHtml(i.category || 'Belanja Harian')}</span><span class="${unitPriceClass}"${unitPriceTitle}>${unitPriceText}</span>
        <span class="slist-price">${window.rp(window._annualBudgetItemSubtotal(i))}</span>
        <button type="button" class="slist-edit-btn" title="Ubah kebutuhan" aria-label="Ubah kebutuhan" onclick="window.openEditAnnualBudgetItemModal('${window.escapeHtml(i.id)}')">✎</button>
        <div class="slist-trail"><button type="button" class="slist-del-btn" title="Hapus" onclick="window.deleteAnnualBudgetItem('${window.escapeHtml(i.id)}')">×</button></div>
    </div>`;
    }).join('');
};
window.addAnnualBudgetRow = function() {
    const nameEl = document.getElementById('annualNewName'), qtyEl = document.getElementById('annualNewQty'), amountEl = document.getElementById('annualNewAmount'), catEl = document.getElementById('annualNewCategory');
    const name = nameEl && nameEl.value.trim();
    const rawAmount = amountEl ? window.unRp(amountEl.value) : 0;
    // [AUTO HARGA PANGAN] Sama seperti window.addShoppingListItem: kalau
    // field nominal sengaja dikosongkan, coba isi dari harga referensi BI
    // dulu (kalau nama kebutuhannya cocok salah satu komoditas yang
    // ditrack) sebelum minta user isi manual. Kalau user memang mengisi
    // nominal sendiri, itu yang dipakai apa adanya.
    const ref = (!rawAmount && typeof window.getHargaPanganUntukItem === 'function')
        ? window.getHargaPanganUntukItem(name) : null;
    const amount = rawAmount || (ref ? ref.price : 0);
    if (!name || amount <= 0) { window.showToast('Isi nama dan nominal kebutuhan tahunan.', 'warning'); return; }
    const items = window.getAnnualBudget(window.currentBookId);
    const qty = qtyEl && Number(qtyEl.value) > 0 ? Number(qtyEl.value) : 1;
    items.push({
        id: 'ab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name, qty, amount,
        priceSource: rawAmount ? 'manual' : (ref ? 'ref' : undefined),
        priceRefDate: ref ? ref.date : undefined,
        category: catEl ? catEl.value : '', done: false, checklistYear: window.getAnnualBudgetYearKey()
    });
    window.saveAnnualBudgetList(window.currentBookId, items); nameEl.value = ''; qtyEl.value = ''; amountEl.value = ''; window.renderAnnualBudgetForm();
};
window.openAddAnnualBudgetItemModal = function() {
    window._populateAnnualBudgetCategory('annualNewCategory');
    const form = document.getElementById('addAnnualBudgetItemForm');
    if (form) form.reset();
    const qty = document.getElementById('annualNewQty');
    if (qty) qty.value = 1;
    window.openModal('addAnnualBudgetItemModal');
};
window.handleAddAnnualBudgetItemSubmit = function(event) {
    event.preventDefault();
    const name = document.getElementById('annualNewName');
    const amount = document.getElementById('annualNewAmount');
    if (!name || !amount) return;
    const isValid = name.value.trim() !== '' && window.unRp(amount.value) > 0;
    window.addAnnualBudgetRow();
    if (isValid) window.closeModal('addAnnualBudgetItemModal');
};
window.toggleAnnualBudgetItem = async function(id) {
    window.ensureAnnualBudgetYearlyCycle(window.currentBookId); const items = window.getAnnualBudget(window.currentBookId), item = items.find(i => i.id === id); if (!item) return;
    const done = !item.done, year = window.getAnnualBudgetYearKey();
    if (done && item.lastExpenseYear !== year) {
        const now = new Date(), pad=n=>String(n).padStart(2,'0'), tx = { id:'tx_'+Date.now()+'_'+Math.random().toString(36).slice(2,6), type:'expense', date:`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`, category:item.category || 'Belanja Harian', description:`[Anggaran Tahunan] ${item.name}`, amount:window._annualBudgetItemSubtotal(item), attachment:null, annualBudgetItemId:item.id, annualBudgetYear:year, updated_at:now.toISOString() };
        window.txs.unshift(tx); window.markTxDirty(tx.id); window.saveTransactions(); item.lastExpenseYear=year; item.lastExpenseTransactionId=tx.id; window.showToast('Pengeluaran tahunan otomatis ditambahkan ke dashboard.', 'success');
    } else if (!done && item.lastExpenseYear === year && item.lastExpenseTransactionId) {
        const txId=item.lastExpenseTransactionId; if (window.clearTxDirty) window.clearTxDirty([txId]); window.txs=window.txs.filter(t=>t.id!==txId); window.saveTransactions();
        if (window.markTxPendingDelete) { window.markTxPendingDelete(txId, window.currentBookId); if (window.isOnline && window.isOnline() && window.pushDeleteToCloud) { const ok=await window.pushDeleteToCloud(txId,window.currentBookId); if(ok&&window.clearTxPendingDelete) window.clearTxPendingDelete(txId); } }
        item.lastExpenseYear=null; item.lastExpenseTransactionId=null; window.showToast('Centang dibatalkan dan pengeluaran tahunan dihapus.', 'success');
    }
    item.done=done; item.checklistYear=year; window.saveAnnualBudgetList(window.currentBookId, items); window.renderAnnualBudgetForm();
};
window.openEditAnnualBudgetItemModal = function(id) {
    const item = window.getAnnualBudget(window.currentBookId).find(i => i.id === id);
    if (!item) return;
    const catSelect = document.getElementById('annualEditCategory');
    catSelect.innerHTML = '<option value="">Belanja Harian</option>' +
        (window.EXPENSE_CATEGORIES || []).map(c => `<option value="${window.escapeHtml(c)}">${window.escapeHtml(c)}</option>`).join('');
    catSelect.value = item.category || '';
    document.getElementById('annualEditId').value = item.id;
    document.getElementById('annualEditName').value = item.name || '';
    document.getElementById('annualEditQty').value = Number(item.qty) > 0 ? item.qty : 1;
    document.getElementById('annualEditAmount').value = item.amount ? Number(item.amount).toLocaleString('id-ID') : '';
    window.openModal('editAnnualBudgetItemModal');
};

window.handleEditAnnualBudgetItemSubmit = function(event) {
    event.preventDefault();
    const id = document.getElementById('annualEditId').value;
    const name = document.getElementById('annualEditName').value.trim();
    const rawAmount = window.unRp(document.getElementById('annualEditAmount').value);
    const qtyParsed = Number(document.getElementById('annualEditQty').value);
    // [AUTO HARGA PANGAN] Sama seperti window.handleEditShoppingListItemSubmit:
    // kalau field nominal sengaja dikosongkan, coba isi dari referensi BI
    // dulu sebelum jatuh ke 0. Kalau user isi angka sendiri (termasuk
    // sengaja menimpa nominal referensi sebelumnya), itu jadi nominal
    // manual & tidak akan ditimpa lagi oleh auto-update berikutnya.
    const ref = (!rawAmount && typeof window.getHargaPanganUntukItem === 'function')
        ? window.getHargaPanganUntukItem(name) : null;
    const amount = rawAmount || (ref ? ref.price : 0);
    if (!name || amount <= 0) { window.showToast('Isi nama dan nominal kebutuhan tahunan.', 'warning'); return; }
    const item = window.getAnnualBudget(window.currentBookId).find(i => i.id === id);
    if (!item) return;
    item.name = name;
    item.qty = qtyParsed > 0 ? qtyParsed : 1;
    item.amount = amount;
    item.priceSource = rawAmount ? 'manual' : (ref ? 'ref' : undefined);
    item.priceRefDate = ref ? ref.date : undefined;
    item.category = document.getElementById('annualEditCategory').value;
    window.saveAnnualBudgetList(window.currentBookId, window.getAnnualBudget(window.currentBookId));
    window.closeModal('editAnnualBudgetItemModal');
    window.renderAnnualBudgetForm();
    window.showToast('Kebutuhan tahunan diperbarui.', 'success');
};

window.deleteAnnualBudgetItem = function(id) {
    const item = window.getAnnualBudget(window.currentBookId).find(i => i.id === id);
    if (!item || !window.confirm(`Hapus kebutuhan "${item.name || 'ini'}"?`)) return;
    const items = window.getAnnualBudget(window.currentBookId).filter(i => i.id !== id);
    window.saveAnnualBudgetList(window.currentBookId, items);
    window.renderAnnualBudgetForm();
    window.showToast('Kebutuhan tahunan dihapus.', 'success');
};
window.resetAnnualBudgetChecks = function() { const items=window.getAnnualBudget(window.currentBookId); items.forEach(i=>{i.done=false;}); window.saveAnnualBudgetList(window.currentBookId,items); window.renderAnnualBudgetForm(); };

// ============================================================
// BUDGET.JS - FUNGSI CLOUD UNTUK SINKRONISASI
// ============================================================

// ── LOAD DEFAULT BUDGET dari Supabase ──
window.loadDefaultBudgetFromCloud = async function(bookId) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return {};
    
    if (window.isOnline()) {
        try {
            const result = await window.callSupabaseAPI(
                'settings',
                'GET',
                null,
                `?book_id=eq.${bookId}&key=eq.default_budget&order=updated_at.desc&limit=1${window.tagOrFilter(window.getAccountTag && window.getAccountTag(), bookId)}`
            );
            
            if (result && Array.isArray(result) && result.length > 0) {
                const decrypted = await window._decryptSettingValue(result[0].value);
                if (decrypted === null) throw new Error('Nilai cloud default_budget tidak bisa didekripsi (kunci lama?)');
                const parsed = JSON.parse(decrypted);
                window.saveDefaultBudgetToLocal(bookId, parsed);
                return parsed;
            }
        } catch (e) {
            console.warn('[Budget] Gagal load default budget dari cloud:', e);
            try { window._healStaleCloudSetting('default_budget', bookId, window.getDefaultBudget(bookId)); } catch {}
        }
    }
    
    return window.getDefaultBudget(bookId);
};

// ── SAVE DEFAULT BUDGET ke Supabase ──
window.saveDefaultBudgetToCloud = async function(bookId, budgetData) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return false;
    
    window.saveDefaultBudgetToLocal(bookId, budgetData);
    
    if (window.isOnline()) {
        try {
            const result = await window.pushSetting('default_budget', budgetData, bookId);
            return !!result;
        } catch (e) {
            console.error('[Budget] Gagal save default budget ke cloud:', e);
            window.showToast('Data tersimpan lokal, gagal sync ke cloud', 'warning');
            return false;
        }
    }
    
    return true;
};

// ── LOAD MONTHLY BUDGET dari Supabase ──
window.loadMonthlyBudgetFromCloud = async function(bookId) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return {};
    
    if (window.isOnline()) {
        try {
            const result = await window.callSupabaseAPI(
                'settings',
                'GET',
                null,
                `?book_id=eq.${bookId}&key=eq.budgets&order=updated_at.desc&limit=1${window.tagOrFilter(window.getAccountTag && window.getAccountTag(), bookId)}`
            );
            
            if (result && Array.isArray(result) && result.length > 0) {
                const decrypted = await window._decryptSettingValue(result[0].value);
                if (decrypted === null) throw new Error('Nilai cloud budgets tidak bisa didekripsi (kunci lama?)');
                const parsed = JSON.parse(decrypted);
                localStorage.setItem('sk_budgets_' + bookId, JSON.stringify(parsed));
                if (bookId === window.currentBookId) {
                    window.budgets = parsed;
                }
                return parsed;
            }
        } catch (e) {
            console.warn('[Budget] Gagal load monthly budget dari cloud:', e);
            const localRaw = localStorage.getItem('sk_budgets_' + bookId);
            if (localRaw) {
                try { window._healStaleCloudSetting('budgets', bookId, JSON.parse(localRaw)); } catch {}
            }
        }
    }
    
    const raw = localStorage.getItem('sk_budgets_' + bookId);
    if (raw) {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    return {};
};

// ── SAVE MONTHLY BUDGET ke Supabase ──
window.saveMonthlyBudgetToCloud = async function(bookId, budgetData) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return false;
    
    localStorage.setItem('sk_budgets_' + bookId, JSON.stringify(budgetData));
    if (bookId === window.currentBookId) {
        window.budgets = budgetData;
    }
    
    if (window.isOnline()) {
        try {
            const result = await window.pushSetting('budgets', budgetData, bookId);
            return !!result;
        } catch (e) {
            console.error('[Budget] Gagal save monthly budget ke cloud:', e);
            window.showToast('Data tersimpan lokal, gagal sync ke cloud', 'warning');
            return false;
        }
    }
    
    return true;
};

// ── LOAD ANNUAL BUDGET dari Supabase ──
window.loadAnnualBudgetFromCloud = async function(bookId) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return [];
    
    if (window.isOnline()) {
        try {
            const result = await window.callSupabaseAPI(
                'settings',
                'GET',
                null,
                `?book_id=eq.${bookId}&key=eq.annual_budget&order=updated_at.desc&limit=1${window.tagOrFilter(window.getAccountTag && window.getAccountTag(), bookId)}`
            );
            
            if (result && Array.isArray(result) && result.length > 0) {
                const decrypted = await window._decryptSettingValue(result[0].value);
                if (decrypted === null) throw new Error('Nilai cloud annual_budget tidak bisa didekripsi (kunci lama?)');
                const parsed = JSON.parse(decrypted);
                window.saveAnnualBudgetToLocal(bookId, parsed);
                return parsed;
            }
        } catch (e) {
            console.warn('[Budget] Gagal load annual budget dari cloud:', e);
            try { window._healStaleCloudSetting('annual_budget', bookId, window.getAnnualBudget(bookId)); } catch {}
        }
    }
    
    return window.getAnnualBudget(bookId);
};

// ── SAVE ANNUAL BUDGET ke Supabase ──
window.saveAnnualBudgetToCloud = async function(bookId, budgetData) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return false;
    
    window.saveAnnualBudgetToLocal(bookId, budgetData);
    
    if (window.isOnline()) {
        try {
            const result = await window.pushSetting('annual_budget', budgetData, bookId);
            return !!result;
        } catch (e) {
            console.error('[Budget] Gagal save annual budget ke cloud:', e);
            window.showToast('Data tersimpan lokal, gagal sync ke cloud', 'warning');
            return false;
        }
    }
    
    return true;
};

// ── SYNC ALL BUDGETS ──
window.syncAllBudgetsToCloud = async function(bookId) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId || !window.isOnline()) return false;
    
    try {
        const defaultBudget = window.getDefaultBudget(bookId);
        const monthlyBudget = JSON.parse(localStorage.getItem('sk_budgets_' + bookId) || '{}');
        const annualBudget = window.getAnnualBudget(bookId);
        
        await Promise.all([
            window.saveDefaultBudgetToCloud(bookId, defaultBudget),
            window.saveMonthlyBudgetToCloud(bookId, monthlyBudget),
            window.saveAnnualBudgetToCloud(bookId, annualBudget)
        ]);
        
        console.log('[Budget] Semua budget berhasil disync ke cloud');
        return true;
    } catch (e) {
        console.error('[Budget] Gagal sync all budgets:', e);
        return false;
    }
};

// ── MIGRASI DATA BUDGET ──
window.migrateAllBudgets = async function(bookId) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId || !window.isOnline()) return;
    
    try {
        const existing = await window.callSupabaseAPI(
            'settings',
            'GET',
            null,
            `?book_id=eq.${bookId}&key=eq.default_budget&order=updated_at.desc&limit=1${window.tagOrFilter(window.getAccountTag && window.getAccountTag(), bookId)}`
        );
        
        if (existing && Array.isArray(existing) && existing.length > 0) {
            console.log('[Budget] Data sudah ada di cloud, skip migrasi');
            return;
        }
    } catch (e) {
        console.warn('[Budget] Gagal cek data existing:', e);
    }
    
    const defaultBudget = window.getDefaultBudget(bookId);
    const monthlyBudget = JSON.parse(localStorage.getItem('sk_budgets_' + bookId) || '{}');
    const annualBudget = window.getAnnualBudget(bookId);
    
    let migrated = 0;
    
    if (Object.keys(defaultBudget).length > 0) {
        await window.saveDefaultBudgetToCloud(bookId, defaultBudget);
        migrated++;
    }
    
    if (Object.keys(monthlyBudget).length > 0) {
        await window.saveMonthlyBudgetToCloud(bookId, monthlyBudget);
        migrated++;
    }
    
    if (annualBudget.length > 0) {
        await window.saveAnnualBudgetToCloud(bookId, annualBudget);
        migrated++;
    }
    
    if (migrated > 0) {
        window.showToast(`${migrated} data anggaran berhasil dimigrasi ke cloud`, 'success');
    }
};
