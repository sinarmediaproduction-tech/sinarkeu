// ==================== BUDGET ====================
window.getDefaultBudget = function(bookId) {
    const raw = localStorage.getItem('sk_default_budget_' + (bookId || window.currentBookId));
    if (raw) {
        try { return JSON.parse(raw); } catch { return {}; }
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
    const monthlyBudget = window.budgets[key] || {};
    const defaultBudget = window.getDefaultBudget(bId);
    const hasCustom = Object.values(monthlyBudget).some(v => v > 0);
    if (hasCustom) {
        return { budget: monthlyBudget, source: 'custom', key: key };
    } else {
        return { budget: defaultBudget, source: 'default', key: 'default' };
    }
};
// Flag per-key untuk mencegah double write ke Supabase apabila
// ensureMonthlyBudgetExists() dan checkNewMonthAutoApply() keduanya
// terpanggil dalam satu sesi untuk bulan yang sama.
if (!window._budgetAutoAppliedKeys) window._budgetAutoAppliedKeys = new Set();

window.ensureMonthlyBudgetExists = function(year, month, bookId) {
    const bId = bookId || window.currentBookId;
    const key = `${year}-${month}`;
    if (window.budgets[key] && Object.values(window.budgets[key]).some(v => v > 0)) {
        return;
    }
    // Sudah ditangani oleh checkNewMonthAutoApply di sesi ini, skip.
    if (window._budgetAutoAppliedKeys.has(key + '_' + bId)) return;
    const defaultBudget = window.getDefaultBudget(bId);
    if (Object.keys(defaultBudget).length > 0) {
        window.budgets[key] = { ...defaultBudget };
        localStorage.setItem('sk_budgets_' + bId, JSON.stringify(window.budgets));
        window._budgetAutoAppliedKeys.add(key + '_' + bId);
        window.saveMonthlyBudgetToCloud(bId, window.budgets);
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
window.renderBudget = function() {
    window.checkNewMonthAutoApply();
    const m = document.getElementById('budgetMonth').value;
    const y = document.getElementById('budgetYear').value;
    const key = `${y}-${m}`;
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
    let totalActual = 0;
    window.txs.forEach(t => {
        if (t.type === 'expense') {
            let d = new Date(t.date);
            if ((d.getMonth() + 1) == m && d.getFullYear() == y) {
                totalActual += (Number(t.amount) || 0);
            }
        }
    });
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
        pctEl.style.color = '#de350b';
        if (pctEl2) pctEl2.style.color = '#de350b';
    } else if (pct >= 80) {
        fill.className = "budget-mini-progress-fill warning";
        if (fill2) fill2.className = "budget-mini-progress-fill warning";
        pctEl.style.color = '#cc7b00';
        if (pctEl2) pctEl2.style.color = '#cc7b00';
    } else {
        fill.className = "budget-mini-progress-fill";
        if (fill2) fill2.className = "budget-mini-progress-fill";
        pctEl.style.color = '#00875a';
        if (pctEl2) pctEl2.style.color = '#00875a';
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
    infoDiv.style.cssText = 'font-size:.72rem; color:#666; margin-bottom:12px; padding:8px 12px; border-radius:6px; background:#f5f5f5;';
    if (source === 'default') {
        infoDiv.innerHTML = '<b>Menggunakan Anggaran Bulanan</b> — Anda dapat mengubahnya di sini untuk membuat versi khusus bulan ini.';
        infoDiv.style.background = '#e3fcef';
        infoDiv.style.color = '#006644';
    } else if (source === 'custom') {
        infoDiv.innerHTML = '<b>Anggaran Khusus Bulan Ini</b> — Bulan berikutnya akan kembali ke Anggaran Bulanan.';
        infoDiv.style.background = '#e8f0fe';
        infoDiv.style.color = '#1a56db';
    } else {
        infoDiv.innerHTML = '<b>Belum ada anggaran</b> — Atur anggaran di bawah, atau klik kartu Anggaran Bulanan untuk mengaturnya.';
        infoDiv.style.background = '#fff3e0';
        infoDiv.style.color = '#cc7b00';
    }
    container.appendChild(infoDiv);
    window.EXPENSE_CATEGORIES.forEach(cat => {
        const val = currentBudget[cat] || 0;
        const div = document.createElement('div');
        div.className = 'budget-cat-row';
        div.innerHTML = `
            <span class="budget-cat-label">${window.escapeHtml(cat)}</span>
            <input type="text" class="form-control budget-input-field" data-cat="${window.escapeHtml(cat)}" value="${val ? Number(val).toLocaleString('id-ID') : '0'}" oninput="window.formatRupiah(this); window.updateBudgetSummary();" placeholder="Rp 0">
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
};

// Default Budget Modal
window.openDefaultBudgetModal = function() {
    if (!window.requireOnline('mengatur anggaran bulanan')) return;
    window.renderDefaultBudgetForm();
    window.openModal('defaultBudgetModal');
};
window.renderDefaultBudgetForm = function() {
    const container = document.getElementById('defaultBudgetCategoriesContainer');
    container.innerHTML = '';
    const defaultBudget = window.getDefaultBudget(window.currentBookId);
    window.EXPENSE_CATEGORIES.forEach(cat => {
        const val = defaultBudget[cat] || 0;
        const div = document.createElement('div');
        div.className = 'budget-cat-row';
        div.innerHTML = `
            <span class="budget-cat-label">${window.escapeHtml(cat)}</span>
            <input type="text" class="form-control default-budget-input" data-cat="${window.escapeHtml(cat)}" value="${val ? Number(val).toLocaleString('id-ID') : ''}" oninput="window.formatRupiah(this); window.updateDefaultBudgetSummary();" placeholder="Rp 0">
        `;
        container.appendChild(div);
    });
    window.updateDefaultBudgetSummary();
};
window.updateDefaultBudgetSummary = function() {
    const inputs = document.querySelectorAll('.default-budget-input');
    let total = 0;
    inputs.forEach(input => { total += window.unRp(input.value); });
    const el = document.getElementById('defaultBudgetSummary');
    if (el) {
        el.innerText = window.t('monthly_total') + window.rp(total);
    }
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
    window.saveDefaultBudgetToLocal(window.currentBookId, newBudget);
    window.closeModal('defaultBudgetModal');
    window.renderBudget();
    // Ditunggu (await) supaya status sukses/gagal sync ke cloud diketahui
    // pasti sebelum toast ditampilkan, bukan diasumsikan berhasil begitu saja.
    const ok = await window.saveDefaultBudgetToCloud(window.currentBookId, newBudget);
    window.showToast(
        ok ? 'Anggaran Bulanan berhasil disimpan & disinkron ke cloud!'
           : 'Tersimpan lokal, tapi GAGAL sync ke cloud. Coba simpan lagi saat online.',
        ok ? 'success' : 'warning'
    );
    window.updateFinancialCards && window.updateFinancialCards();
    if (document.getElementById('budgetModal').classList.contains('show')) {
        window.renderBudgetFormFields();
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
        let td = new Date(t.date);
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
    div.className = 'budget-cat-row';
    div.id = 'annual-row-' + idx;
    div.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px;';
    div.innerHTML = `
        <input type="text" class="form-control" style="flex:2;" placeholder="Nama kebutuhan (misal: THR, Pajak, Servis)" 
            value="${window.escapeHtml(row.name)}"
            oninput="window._annualBudgetRows[${idx}].name = this.value; window.updateAnnualBudgetSummary();">
        <input type="text" class="form-control" style="flex:1;" placeholder="Rp 0"
            value="${row.amount ? Number(row.amount).toLocaleString('id-ID') : ''}"
            oninput="window.formatRupiah(this); window._annualBudgetRows[${idx}].amount = window.unRp(this.value); window.updateAnnualBudgetSummary();">
        ${isOnlyRow ? '' : `<button onclick="window.removeAnnualBudgetRow(${idx})" 
            style="background:none; border:1.5px solid #de350b; color:#de350b; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:.85rem; flex-shrink:0;">Hapus</button>`}
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
                `?book_id=eq.${bookId}&key=eq.default_budget&limit=1${window.tagOrFilter(window.getAccountTag && window.getAccountTag())}`
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
                `?book_id=eq.${bookId}&key=eq.budgets&limit=1${window.tagOrFilter(window.getAccountTag && window.getAccountTag())}`
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
                `?book_id=eq.${bookId}&key=eq.annual_budget&limit=1${window.tagOrFilter(window.getAccountTag && window.getAccountTag())}`
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
            `?book_id=eq.${bookId}&key=eq.default_budget&limit=1${window.tagOrFilter(window.getAccountTag && window.getAccountTag())}`
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
