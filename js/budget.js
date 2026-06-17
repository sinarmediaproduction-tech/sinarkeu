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
window.ensureMonthlyBudgetExists = function(year, month, bookId) {
    const bId = bookId || window.currentBookId;
    const key = `${year}-${month}`;
    if (window.budgets[key] && Object.values(window.budgets[key]).some(v => v > 0)) {
        return;
    }
    const defaultBudget = window.getDefaultBudget(bId);
    if (Object.keys(defaultBudget).length > 0) {
        window.budgets[key] = { ...defaultBudget };
        localStorage.setItem('sk_budgets_' + bId, JSON.stringify(window.budgets));
        window.pushSettingBudgets();
        console.log(`[Budget] Auto-apply default budget untuk ${key} di buku ${bId}`);
    }
};
window.checkNewMonthAutoApply = function() {
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const key = `${y}-${m}`;
    const hasBudget = window.budgets[key] && Object.values(window.budgets[key]).some(v => v > 0);
    if (!hasBudget) {
        const defaultBudget = window.getDefaultBudget(window.currentBookId);
        if (Object.keys(defaultBudget).length > 0) {
            window.budgets[key] = { ...defaultBudget };
            localStorage.setItem('sk_budgets_' + window.currentBookId, JSON.stringify(window.budgets));
            window.pushSettingBudgets();
            console.log(`[Budget] Auto-apply default budget untuk ${key} (bulan baru)`);
            window.renderBudget();
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
            tag.innerText = '📌 Khusus bulan ini';
        } else if (source === 'default' && Object.keys(currentBudget).length > 0) {
            tag.className = 'budget-source-tag default';
            tag.innerText = '🏠 Anggaran Dasar';
        } else {
            tag.className = 'budget-source-tag none';
            tag.innerText = 'Tidak ada';
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
        infoDiv.innerHTML = '🏠 <b>Menggunakan Anggaran Dasar</b> — Anda dapat mengubahnya di sini untuk membuat versi khusus bulan ini.';
        infoDiv.style.background = '#e3fcef';
        infoDiv.style.color = '#006644';
    } else if (source === 'custom') {
        infoDiv.innerHTML = '📌 <b>Anggaran Khusus Bulan Ini</b> — Bulan berikutnya akan kembali ke Anggaran Dasar.';
        infoDiv.style.background = '#e8f0fe';
        infoDiv.style.color = '#1a56db';
    } else {
        infoDiv.innerHTML = '⚠️ <b>Belum ada anggaran</b> — Atur anggaran di bawah, atau buat Anggaran Dasar di menu terpisah.';
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
        el.innerText = 'Total Anggaran Bulanan: ' + window.rp(total);
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
window.saveBudget = function() {
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
    if (!hasAnyValue) {
        delete window.budgets[key];
        window.showToast('Anggaran bulan ini dihapus, akan menggunakan Anggaran Dasar.', 'info');
    } else {
        window.showToast('Anggaran bulanan berhasil diperbarui', 'success');
    }
    localStorage.setItem('sk_budgets_' + window.currentBookId, JSON.stringify(window.budgets));
    window.closeModal('budgetModal');
    window.renderBudget();
    window.pushSettingBudgets();
};

// Default Budget Modal
window.openDefaultBudgetModal = function() {
    if (!window.requireOnline('mengatur anggaran dasar')) return;
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
        el.innerText = 'Total Template Anggaran Dasar: ' + window.rp(total);
    }
};
window.saveDefaultBudget = function() {
    if (!window.requireOnline('menyimpan anggaran dasar')) return;
    const inputs = document.querySelectorAll('.default-budget-input');
    const newBudget = {};
    inputs.forEach(input => {
        const cat = input.getAttribute('data-cat');
        if (window.EXPENSE_CATEGORIES.includes(cat)) {
            newBudget[cat] = window.unRp(input.value);
        }
    });
    window.saveDefaultBudgetToLocal(window.currentBookId, newBudget);
    window.showToast('✅ Anggaran Dasar berhasil disimpan!', 'success');
    window.closeModal('defaultBudgetModal');
    window.renderBudget();
    window.pushSettingBudgets();
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
            setTimeout(() => window.showToast(`🚨 Anggaran "${category}" HABIS! (${Math.round(katPct)}% terpakai)`, 'error'), 500);
            window.sendTelegramNotif(`🚨 <b>ANGGARAN HABIS!</b>\n\n📒 Buku: <b>${bookName}</b>\n📂 Kategori: <b>${category}</b>\n📅 Periode: <b>${monthNames[m - 1]} ${y}</b>\n\n💸 Terpakai: <b>${window.rp(totalKat)}</b> (${Math.round(katPct)}%)\n🎯 Target: ${window.rp(katTarget)}`);
            return;
        } else if (katPct >= 80) {
            setTimeout(() => window.showToast(`⚠️ Anggaran "${category}" hampir habis (${Math.round(katPct)}%)`, 'warning'), 500);
            window.sendTelegramNotif(`⚠️ <b>Anggaran Hampir Habis</b>\n\n📒 Buku: <b>${bookName}</b>\n📂 Kategori: <b>${category}</b>\n📅 Periode: <b>${monthNames[m - 1]} ${y}</b>\n\n💸 Terpakai: ${window.rp(totalKat)} (${Math.round(katPct)}%)\n🎯 Target: ${window.rp(katTarget)}`);
            return;
        }
    }
    if (totalTarget > 0) {
        let totalPct = (totalBulan / totalTarget) * 100;
        if (totalPct >= 100) {
            setTimeout(() => window.showToast(`🚨 Total anggaran bulanan HABIS! (${Math.round(totalPct)}% terpakai)`, 'error'), 500);
            window.sendTelegramNotif(`🚨 <b>TOTAL ANGGARAN BULANAN HABIS!</b>\n\n📒 Buku: <b>${bookName}</b>\n📅 Periode: <b>${monthNames[m - 1]} ${y}</b>\n\n💸 Total Pengeluaran: <b>${window.rp(totalBulan)}</b> (${Math.round(totalPct)}%)\n🎯 Total Anggaran: ${window.rp(totalTarget)}`);
        } else if (totalPct >= 80) {
            setTimeout(() => window.showToast(`⚠️ Total anggaran bulanan hampir habis (${Math.round(totalPct)}%)`, 'warning'), 500);
            window.sendTelegramNotif(`⚠️ <b>Anggaran Bulanan Hampir Habis</b>\n\n📒 Buku: <b>${bookName}</b>\n📅 Periode: <b>${monthNames[m - 1]} ${y}</b>\n\n💸 Total Pengeluaran: ${window.rp(totalBulan)} (${Math.round(totalPct)}%)\n🎯 Total Anggaran: ${window.rp(totalTarget)}`);
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

window.pushAnnualBudget = function(bookId) {
    const items = window.getAnnualBudget(bookId || window.currentBookId);
    window.pushSetting('annual_budget', items, bookId || window.currentBookId);
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
        // Tambah 1 baris kosong default jika belum ada isi
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
        <button onclick="window.removeAnnualBudgetRow(${idx})" 
            style="background:none; border:1.5px solid #de350b; color:#de350b; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:.85rem; flex-shrink:0;">🗑</button>
    `;
    container.appendChild(div);
};

window.addAnnualBudgetRow = function() {
    if (!window._annualBudgetRows) window._annualBudgetRows = [];
    const idx = window._annualBudgetRows.length;
    window._annualBudgetRows.push({ name: '', amount: 0 });
    window._renderAnnualRow(idx);
    window.updateAnnualBudgetSummary();
};

window.removeAnnualBudgetRow = function(idx) {
    window._annualBudgetRows.splice(idx, 1);
    // Re-render semua baris
    const container = document.getElementById('annualBudgetItemsContainer');
    container.innerHTML = '';
    window._annualBudgetRows.forEach((_, i) => window._renderAnnualRow(i));
    window.updateAnnualBudgetSummary();
};

window.updateAnnualBudgetSummary = function() {
    const total = (window._annualBudgetRows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const el = document.getElementById('annualBudgetSummary');
    if (el) el.innerText = 'Total Anggaran Tahunan: ' + window.rp(total);
};

window.saveAnnualBudget = function() {
    if (!window.requireOnline('menyimpan anggaran tahunan')) return;
    const items = (window._annualBudgetRows || []).filter(r => r.name.trim() !== '' || r.amount > 0);
    window.saveAnnualBudgetToLocal(window.currentBookId, items);
    window.pushAnnualBudget(window.currentBookId);
    window.showToast('✅ Anggaran Tahunan berhasil disimpan!', 'success');
    window.closeModal('annualBudgetModal');
    window.updateFinancialCards();
};

// ==================== PATCH: simpan Anggaran Dasar juga ke Supabase ====================
// Override saveDefaultBudget untuk juga push ke Supabase via pushSetting
const _origSaveDefaultBudget = window.saveDefaultBudget;
window.saveDefaultBudget = function() {
    _origSaveDefaultBudget();
    // pushSetting sudah dipanggil di dalam _origSaveDefaultBudget via pushSettingBudgets
    // Tidak perlu duplikasi, cukup update financial cards
    window.updateFinancialCards && window.updateFinancialCards();
};

// Patch pullAllSettings agar juga load annual_budget dari Supabase
const _origPullAllSettings = window.pullAllSettings;
window.pullAllSettings = async function() {
    if (_origPullAllSettings) await _origPullAllSettings();
    // Setelah pull selesai, coba ambil annual_budget per buku
    if (window.books && window.books.length > 0) {
        for (const book of window.books) {
            try {
                const rows = await window.callSupabaseAPI('settings', 'GET', null,
                    `?book_id=eq.${book.id}&key=eq.annual_budget`);
                if (rows && rows.length > 0 && rows[0].value) {
                    const val = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
                    window.saveAnnualBudgetToLocal(book.id, val);
                }
            } catch(e) { /* silent fail */ }
        }
    }
    window.updateFinancialCards && window.updateFinancialCards();
};
