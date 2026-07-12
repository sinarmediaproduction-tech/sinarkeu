// ==================== RENDER ====================
window.render = function() {
    let body = document.getElementById('transactionTableBody');
    body.innerHTML = '';
    let search = document.getElementById('searchInput').value.toLowerCase();
    let filtered = window.txs.filter(t => {
        if (window.currentFilter === 'income' && t.type !== 'income') return false;
        if (window.currentFilter === 'expense' && t.type !== 'expense') return false;
        if (window.filterStartDate && t.date < window.filterStartDate) return false;
        if (window.filterEndDate) {
            let endLimit = window.filterEndDate + 'T23:59:59';
            if (t.date > endLimit) return false;
        }
        if (search) {
            let d = (t.description || '').toLowerCase();
            let c = (t.category || '').toLowerCase();
            return d.includes(search) || c.includes(search);
        }
        return true;
    });
    document.getElementById('transactionCount').innerText = filtered.length + window.t('transaction_count');
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        let amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    let currentBalance = totalInc - totalExp + balanceOffset;
    window._lastBalance = currentBalance;
    document.getElementById('statBalance').innerText = window.rp(currentBalance);
    document.getElementById('statIncome').innerText = window.rp(totalInc);
    document.getElementById('statExpense').innerText = window.rp(totalExp);
    window.updateZakatCard();
    if (typeof window.renderForecastCard === 'function') window.renderForecastCard();
    if ((window.expenseChartVisible || !window._expenseChartInitialized) && typeof window.renderExpenseChart === 'function') {
        window.renderExpenseChart();
    }
    let allSorted = [...window.txs].sort((a, b) => window.parseTxDate(a.date) - window.parseTxDate(b.date) || String(a.id).localeCompare(String(b.id)));
    let balanceMap = {};
    let tempBal = balanceOffset;
    allSorted.forEach(t => {
        let amt = Number(t.amount) || 0;
        if (t.type === 'income') tempBal += amt;
        else tempBal -= amt;
        balanceMap[t.id] = tempBal;
    });
    if (filtered.length === 0) {
        body.innerHTML = '<tr><td colspan="9" class="text-center" style="color:var(--ink-faint); padding:30px;">'+window.t('no_transactions')+'</td></tr>';
        document.getElementById('paginationBar').style.display = 'none';
        window.renderBudget();
        return;
    }
    const pageSize = window.PAGE_SIZE || 21;
    const totalPages = Math.ceil(filtered.length / pageSize);
    if (window.currentPage > totalPages) window.currentPage = totalPages;
    if (window.currentPage < 1) window.currentPage = 1;
    const startIdx = (window.currentPage - 1) * pageSize;
    const paginated = filtered.slice(startIdx, startIdx + pageSize);
    const online = window.isOnline();
    paginated.forEach((t, index) => {
        let tr = document.createElement('tr');
        let amt = Number(t.amount) || 0;
        let incText = t.type === 'income' ? window.rp(amt) : '-';
        let expText = t.type === 'expense' ? window.rp(amt) : '-';
        let badge = t.type === 'income' ? '<span class="type-badge badge-inc">MASUK</span>' : '<span class="type-badge badge-exp">KELUAR</span>';
        let attCell = '<span class="no-attachment">&ndash;</span>';
        if (t.attachment) attCell = `<span class="attachment-link" onclick="window.viewAttachment('${t.id}')" title="Lihat Nota"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;pointer-events:none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>`;
        const globalIndex = startIdx + index + 1;
        const actionBtnDisabled = online ? '' : 'disabled';
        tr.innerHTML = `
            <td class="text-center col-no">${globalIndex}</td>
            <td>${window.formatDateTime(t.date)}</td>
            <td class="col-category">${badge}</td>
            <td>${window.escapeHtml(t.description)}</td>
            <td class="text-right" style="color:var(--success); font-weight:500;">${incText}</td>
            <td class="text-right" style="color:var(--danger); font-weight:500;">${expText}</td>
            <td class="text-right col-saldo" style="font-weight:600;">${window.rp(balanceMap[t.id] || 0)}</td>
            <td class="text-center col-nota">${attCell}</td>
            <td class="text-center"><button class="action-btn" onclick="window.openActionMenu('${t.id}')" ${actionBtnDisabled}>⋮</button></td>
        `;
        body.appendChild(tr);
    });
    window.renderPagination(filtered.length, totalPages);
    window.renderBudget();
    window.updateFinancialCards();
    window.updateUIForOnlineStatus();
};

// ==================== VISIBILITAS CARD PERENCANAAN KEUANGAN (PER BUKU) ====================
// Memungkinkan setiap card di bagian "FINANCIAL PLANNING CARDS" dinonaktifkan
// (disembunyikan) secara independen untuk buku tertentu. Disimpan & disinkronkan
// dengan pola yang sama seperti window.getEmergencyFundMonths() di bawah.
window.FINANCIAL_CARD_IDS = ['cardAnggaranBulanan', 'cardAnggaranTahunan', 'cardDanaDarurat', 'cardKebutuhanSetahun', 'cardFaseKehidupan', 'cardDanaSalingJaga'];
window.FINANCIAL_CARD_LABELS = {
    cardAnggaranBulanan: 'monthly_budget',
    cardAnggaranTahunan: 'annual_budget',
    cardDanaDarurat: 'emergency_fund',
    cardKebutuhanSetahun: 'annual_needs',
    cardFaseKehidupan: 'life_phase',
    cardDanaSalingJaga: 'mutual_fund'
};
window.getHiddenCards = function(bookId) {
    const raw = localStorage.getItem('sk_hidden_cards_' + (bookId || window.currentBookId));
    try {
        const arr = JSON.parse(raw || '[]');
        return Array.isArray(arr) ? arr.filter(id => window.FINANCIAL_CARD_IDS.includes(id)) : [];
    } catch { return []; }
};
window.saveHiddenCardsToLocal = function(hiddenArr, bookId) {
    localStorage.setItem('sk_hidden_cards_' + (bookId || window.currentBookId), JSON.stringify(hiddenArr || []));
};
window.applyHiddenCardsVisibility = function() {
    const hidden = window.getHiddenCards();
    window.FINANCIAL_CARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = hidden.includes(id) ? 'none' : '';
    });
};

// Modal: atur card mana yang disembunyikan untuk buku tertentu (default: buku aktif).
window._cardVisibilityTargetBookId = null;
window.openCardVisibilityModal = function(bookId) {
    const targetId = bookId || window.currentBookId;
    window._cardVisibilityTargetBookId = targetId;
    const book = window.books.find(b => b.id === targetId);
    const titleEl = document.getElementById('cardVisibilityBookName');
    if (titleEl) titleEl.innerText = book ? book.name : '';
    const hidden = window.getHiddenCards(targetId);
    const list = document.getElementById('cardVisibilityList');
    if (list) {
        list.innerHTML = '';
        window.FINANCIAL_CARD_IDS.forEach(id => {
            const labelKey = window.FINANCIAL_CARD_LABELS[id];
            const label = (typeof window.t === 'function') ? window.t(labelKey) : labelKey;
            const row = document.createElement('label');
            row.style.cssText = 'display:flex; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid var(--rule); cursor:pointer; font-size:.85rem;';
            row.innerHTML = `<input type="checkbox" data-card-id="${id}" ${hidden.includes(id) ? '' : 'checked'} style="width:16px; height:16px;"> <span>${window.escapeHtml(label)}</span>`;
            list.appendChild(row);
        });
    }
    window.openModal('cardVisibilityModal');
};
window.saveCardVisibility = async function() {
    const targetId = window._cardVisibilityTargetBookId || window.currentBookId;
    const list = document.getElementById('cardVisibilityList');
    const hidden = [];
    if (list) {
        list.querySelectorAll('input[type=checkbox]').forEach(cb => {
            if (!cb.checked) hidden.push(cb.getAttribute('data-card-id'));
        });
    }
    window.saveHiddenCardsToLocal(hidden, targetId);
    if (window.isOnline()) {
        await window.pushSetting('hidden_cards', hidden, targetId);
    }
    if (targetId === window.currentBookId) {
        window.applyHiddenCardsVisibility();
    }
    window.closeModal('cardVisibilityModal');
    window.showToast('Pengaturan tampilan card disimpan', 'success');
};

window.updateFinancialCards = function() {
    // Anggaran Bulanan dari Anggaran Dasar
    const defaultBudget = window.getDefaultBudget(window.currentBookId);
    let anggaranBulanan = 0;
    if (window.EXPENSE_CATEGORIES) {
        window.EXPENSE_CATEGORIES.forEach(cat => {
            anggaranBulanan += (defaultBudget[cat] || 0);
        });
    }

    // Anggaran Tahunan dari annual_budget
    const annualBudget = window.getAnnualBudget(window.currentBookId);
    let anggaranTahunan = 0;
    annualBudget.forEach(item => { anggaranTahunan += (Number(item.amount) || 0); });

    // Saldo akhir seluruh histori
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    const saldoAkhir = totalInc - totalExp + balanceOffset;

    // Dana Darurat = N x anggaran bulanan (N adjustable, default 12)
    const efMonths = window.getEmergencyFundMonths();
    const danaDarurat = anggaranBulanan * efMonths;

    // Kebutuhan Setahun = Dana Darurat + Anggaran Tahunan
    const kebutuhanSetahun = danaDarurat + anggaranTahunan;

    // Dana Saling Jaga = 50% dari (saldo - kebutuhan setahun), min 0
    const sisaSetelahDarurat = saldoAkhir - kebutuhanSetahun;
    const danaSalingJaga = sisaSetelahDarurat > 0 ? sisaSetelahDarurat * 0.5 : 0;

    // Update DOM
    const set = (id, val) => window.animateValue(id, val, 500);
    set('fcAnggaranBulanan', anggaranBulanan);
    set('fcAnggaranTahunan', anggaranTahunan);
    set('fcDanaDarurat', danaDarurat);
    const efNote = document.getElementById('fcDanaDaruratNote');
    if (efNote) efNote.innerText = `${efMonths}× anggaran bulanan (target ideal)`;
    set('fcDanaSalingJaga', danaSalingJaga);

    // Warna peringatan card Dana Saling Jaga
    const cardDSJ = document.getElementById('cardDanaSalingJaga');
    const note = document.getElementById('fcDSJNote');
    if (cardDSJ && note) {
        if (sisaSetelahDarurat <= 0) {
            cardDSJ.style.borderTopColor = 'var(--danger)';
            cardDSJ.style.background = 'var(--danger-lt)';
            note.innerText = window.t('emergency_insufficient');
            note.style.color = 'var(--danger)';
        } else {
            cardDSJ.style.borderTopColor = 'var(--success)';
            cardDSJ.style.background = '';
            note.innerText = window.t('emergency_50pct');
            note.style.color = 'var(--ink-faint)';
        }
    }

    // Warna & gap info card Kebutuhan Setahun — update setelah animasi selesai
    const cardKS = document.getElementById('cardKebutuhanSetahun');
    const ksGapInfo = document.getElementById('fcKSGapInfo');
    const gap = saldoAkhir - kebutuhanSetahun;
    // Set border/bg dulu berdasarkan nilai final (tidak ikut animasi)
    if (cardKS) {
        cardKS.style.borderTopColor = gap < 0 ? 'var(--danger)' : 'var(--warning)';
        cardKS.style.background = gap < 0 ? 'var(--danger-lt)' : '';
    }
    // Sembunyikan gap info selama animasi berjalan, tampilkan setelah selesai
    if (ksGapInfo) ksGapInfo.style.display = 'none';
    window.animateValue('fcKebutuhanSetahun', kebutuhanSetahun, 500, function() {
        if (!ksGapInfo) return;
        ksGapInfo.style.display = 'block';
        if (gap < 0) {
            ksGapInfo.style.background = 'var(--danger-lt)';
            ksGapInfo.style.color = 'var(--danger)';
            ksGapInfo.innerHTML = `\u26A0 Kurang <b>${window.rp ? window.rp(Math.abs(gap)) : Math.abs(gap)}</b> untuk kategori <b>Aman</b>`;
        } else {
            ksGapInfo.style.background = 'var(--success-lt)';
            ksGapInfo.style.color = 'var(--success)';
            ksGapInfo.innerHTML = gap === 0
                ? `\u2713 Saldo pas menutupi kebutuhan`
                : `\u2713 Surplus <b>${window.rp ? window.rp(gap) : gap}</b> \u2014 Keuangan Aman`;
        }
    });

    // Update card fase kehidupan
    if (typeof window.updateFaseCard === 'function') window.updateFaseCard();

    // Terapkan visibilitas card sesuai pengaturan per-buku (lihat openCardVisibilityModal)
    window.applyHiddenCardsVisibility();
};

window.renderPagination = function(totalCount, totalPages) {
    const bar = document.getElementById('paginationBar');
    const info = document.getElementById('paginationInfo');
    const controls = document.getElementById('paginationControls');
    if (totalPages <= 1) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const pageSize = window.PAGE_SIZE || 21;
    const startItem = (window.currentPage - 1) * pageSize + 1;
    const endItem = Math.min(window.currentPage * pageSize, totalCount);
    info.textContent = `Menampilkan ${startItem}–${endItem} dari ${totalCount} transaksi`;
    controls.innerHTML = '';
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.textContent = '‹';
    prevBtn.disabled = window.currentPage === 1;
    prevBtn.onclick = () => window.goToPage(window.currentPage - 1);
    controls.appendChild(prevBtn);
    const pages = window.buildPageNumbers(window.currentPage, totalPages);
    pages.forEach(p => {
        if (p === '...') {
            const el = document.createElement('span');
            el.className = 'page-ellipsis';
            el.textContent = '…';
            controls.appendChild(el);
        } else {
            const btn = document.createElement('button');
            btn.className = 'page-btn' + (p === window.currentPage ? ' active' : '');
            btn.textContent = p;
            btn.onclick = () => window.goToPage(p);
            controls.appendChild(btn);
        }
    });
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.textContent = '›';
    nextBtn.disabled = window.currentPage === totalPages;
    nextBtn.onclick = () => window.goToPage(window.currentPage + 1);
    controls.appendChild(nextBtn);
};

window.buildPageNumbers = function(current, total) {
    const pages = [];
    const add = (n) => { if (!pages.includes(n) && n >= 1 && n <= total) pages.push(n); };
    add(1); add(current - 1); add(current); add(current + 1); add(total);
    pages.sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < pages.length; i++) {
        if (i > 0 && pages[i] - pages[i - 1] > 1) result.push('...');
        result.push(pages[i]);
    }
    return result;
};

window.goToPage = function(page) {
    window.currentPage = page;
    window.render();
    document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

// CRUD Operations
window.toggleCategoryField = function() {
    let type = document.querySelector('input[name="type"]:checked').value;
    let groupExpense = document.getElementById('categoryGroup');
    let groupIncome = document.getElementById('incomeCategoryGroup');
    if (type === 'income') {
        groupExpense.style.display = 'none';
        groupIncome.style.display = 'block';
    } else {
        groupExpense.style.display = 'block';
        groupIncome.style.display = 'none';
    }
};
window.toggleEditCategoryField = function() {
    let type = document.querySelector('input[name="editType"]:checked').value;
    let groupExpense = document.getElementById('editCategoryGroup');
    let groupIncome = document.getElementById('editIncomeCategoryGroup');
    if (type === 'income') {
        groupExpense.style.display = 'none';
        groupIncome.style.display = 'block';
    } else {
        groupExpense.style.display = 'block';
        groupIncome.style.display = 'none';
    }
};
window.previewAttachment = function(input) {
    let prev = document.getElementById('attachmentPreview');
    if (input.files && input.files[0]) {
        window.currentAttachmentFile = input.files[0];
        let r = new FileReader();
        r.onload = function (e) {
            prev.src = e.target.result;
            prev.style.display = 'block';
            window.currentAttachmentData = e.target.result;
        };
        r.readAsDataURL(input.files[0]);
    }
};
window.previewEditAttachment = function(input) {
    let prev = document.getElementById('editAttachmentPreview');
    if (input.files && input.files[0]) {
        window.currentAttachmentFile = input.files[0];
        let r = new FileReader();
        r.onload = function (e) {
            prev.src = e.target.result;
            prev.style.display = 'block';
            window.currentAttachmentData = e.target.result;
            document.getElementById('editAttachmentInfo').innerText = window.t('new_receipt');
        };
        r.readAsDataURL(input.files[0]);
    }
};
window.uploadAttachmentToStorage = async function(file, txId) {
    if (!file) return null;
    const baseUrl = window.getCloudUrl();
    const apiKey = window.getSupabaseKey();
    if (!baseUrl || !apiKey) return null;
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `nota/${window.currentBookId}/${txId}.${ext}`;
    const uploadUrl = `${baseUrl}/storage/v1/object/attachments/${path}`;
    try {
        const res = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}`, 'Content-Type': file.type || 'image/jpeg', 'x-upsert': 'true' },
            body: file
        });
        if (!res.ok) { console.warn('[Storage] Upload gagal, fallback ke base64:', await res.text()); return null; }
        const publicUrl = `${baseUrl}/storage/v1/object/public/attachments/${path}`;
        console.log('[Storage] Upload berhasil:', publicUrl);
        return publicUrl;
    } catch (e) {
        console.warn('[Storage] Upload error, fallback ke base64:', e.message);
        return null;
    }
};
window.resolveAttachment = async function(file, base64Fallback, txId) {
    if (!file) return base64Fallback || null;
    const url = await window.uploadAttachmentToStorage(file, txId);
    return url || base64Fallback;
};
window.handleSubmit = async function(e) {
    e.preventDefault();
    // [FIX UX] Sebelumnya baris ini blokir total tambah transaksi kalau
    // offline ("Anda harus ONLINE untuk menambah transaksi!"), padahal
    // window.markTxDirty() + window.saveTransactions() di bawah SUDAH aman
    // dipakai offline sejak awal: pushToCloud() sendiri langsung return kalau
    // !isOnline() (lihat komentar di sana), dan tandanya tetap tersimpan di
    // localStorage untuk di-push otomatis oleh flushPendingDirtyOnStart()
    // begitu online lagi (app start / event 'online' / siklus auto-sync).
    // Blokir ini jadi terasa aneh untuk app finansial harian yang dipakai di
    // HP dengan sinyal naik-turun -- user mau catat transaksi cepat malah
    // ditolak duluan. Transaksi baru sekarang tetap tersimpan lokal & muncul
    // di layar walau offline, tinggal nunggu koneksi untuk sinkron ke cloud.
    let type = document.querySelector('input[name="type"]:checked').value;
    const nowTx = new Date();
    const _pad = n => String(n).padStart(2, '0');
    const date = `${nowTx.getFullYear()}-${_pad(nowTx.getMonth()+1)}-${_pad(nowTx.getDate())}T${_pad(nowTx.getHours())}:${_pad(nowTx.getMinutes())}:${_pad(nowTx.getSeconds())}`;
    document.getElementById('txDate').value = date;
    let category = type === 'expense' ? document.getElementById('txCategory').value : document.getElementById('txIncomeCategory').value;
    let description = document.getElementById('txDesc').value.trim();
    let amount = window.unRp(document.getElementById('txAmount').value);
    if (!category) { alert('Harap pilih kategori!'); return; }
    if (amount <= 0) { alert('Jumlah nominal harus lebih dari 0!'); return; }
    const txId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const attachmentData = await window.resolveAttachment(window.currentAttachmentFile, window.currentAttachmentData, txId);
    let newTx = { id: txId, type, date, category, description, amount, attachment: attachmentData, updated_at: new Date().toISOString() };
    window.txs.unshift(newTx);
    window.markTxDirty(newTx.id); // [FIX RACE + MULTI-TAB] tandai baris ini saja yang perlu di-push (memori + localStorage)
    window.closeModal('addModal');
    window.currentAttachmentFile = null;
    window.saveTransactions();
    window.showToast(window.isOnline() ? "Transaksi berhasil disimpan" : "Tersimpan lokal — akan disinkron otomatis saat online", window.isOnline() ? "success" : "warning");
    if (type === 'expense') window.checkBudgetWarningAfterSave(date, category);
    await window.addCloudLog('TAMBAH', `Menambah item baru: "${description}" sebesar ${window.rp(amount)}`);
    window.sendTelegramNotif(window.buildTxNotifMessage('TAMBAH', newTx, window.getCurrentBookName()));
};
window.openActionMenu = function(id) {
    // [FIX UX] Sama seperti handleSubmit -- edit & hapus transaksi sudah
    // aman offline (lihat handleEditSubmit & confirmDelete), jadi menu aksi
    // ini tidak perlu diblokir duluan.
    window.actionId = id;
    window.openModal('actionMenuModal');
    document.getElementById('actionEditBtn').onclick = () => { window.closeModal('actionMenuModal'); window.loadEditData(id); };
    document.getElementById('actionDeleteBtn').onclick = () => { window.closeModal('actionMenuModal'); window.confirmDelete(id); };
};
window.loadEditData = function(id) {
    let t = window.txs.find(x => x.id === id);
    if (!t) return;
    document.getElementById('editId').value = t.id;
    if (t.type === 'income') document.getElementById('editTypeIncome').checked = true;
    else document.getElementById('editTypeExpense').checked = true;
    window.toggleEditCategoryField();
    document.getElementById('editTxDate').value = window.toDatetimeLocalValue(t.date);
    if (t.type === 'expense') document.getElementById('editTxCategory').value = t.category;
    else document.getElementById('editTxIncomeCategory').value = t.category;
    // Sync custom select display
    ['editTxCategory', 'editTxIncomeCategory'].forEach(function(sid) {
        var sel = document.getElementById(sid);
        if (sel) sel.dispatchEvent(new Event('change'));
    });
    document.getElementById('editTxDesc').value = t.description;
    document.getElementById('editTxAmount').value = Number(t.amount).toLocaleString('id-ID');
    let info = document.getElementById('editAttachmentInfo');
    let prev = document.getElementById('editAttachmentPreview');
    window.currentAttachmentData = t.attachment;
    if (t.attachment) {
        info.innerText = window.t('has_attachment');
        prev.src = t.attachment;
        prev.style.display = 'block';
    } else {
        info.innerText = window.t('no_attachment');
        prev.style.display = 'none';
    }
    window.openModal('editModal');
};
window.handleEditSubmit = async function(e) {
    e.preventDefault();
    // [FIX UX] Lihat catatan di handleSubmit -- edit juga aman offline lewat
    // jalur dirty-tracking yang sama.
    let id = document.getElementById('editId').value;
    let idx = window.txs.findIndex(x => x.id === id);
    if (idx === -1) return;
    let type = document.querySelector('input[name="editType"]:checked').value;
    // [FIX] Field #editTxDate tersembunyi (display:none) dan tidak pernah
    // diedit user — nilainya cuma presisi menit (batasan native
    // datetime-local). Kalau dipakai apa adanya di sini, setiap kali edit
    // transaksi detik aslinya akan ter-reset jadi :00, yang bisa memicu
    // tabrakan urutan dengan transaksi lain yang menitnya sama. Jadi
    // tanggal asli (lengkap dengan detik) tetap dipertahankan di sini.
    let date = window.txs[idx].date;
    let category = type === 'expense' ? document.getElementById('editTxCategory').value : document.getElementById('editTxIncomeCategory').value;
    let description = document.getElementById('editTxDesc').value.trim();
    let amount = window.unRp(document.getElementById('editTxAmount').value);
    if (!category) { alert('Harap pilih kategori!'); return; }
    if (amount <= 0) { alert('Nominal harus valid!'); return; }
    const editAttachment = await window.resolveAttachment(window.currentAttachmentFile, window.currentAttachmentData, id);
    window.txs[idx] = { id, type, date, category, description, amount, attachment: editAttachment, updated_at: new Date().toISOString() };
    window.markTxDirty(id); // [FIX RACE + MULTI-TAB] tandai baris ini saja yang perlu di-push (memori + localStorage)
    window.closeModal('editModal');
    window.currentAttachmentFile = null;
    window.saveTransactions();
    window.showToast(window.isOnline() ? "Perubahan data disimpan" : "Perubahan tersimpan lokal — akan disinkron otomatis saat online", window.isOnline() ? "success" : "warning");
    await window.addCloudLog('UBAH', `Mengubah transaksi "${description}" menjadi senilai ${window.rp(amount)}`);
    window.sendTelegramNotif(window.buildTxNotifMessage('UBAH', window.txs[idx], window.getCurrentBookName()));
};
window.confirmDelete = async function(id) {
    // [FIX UX] Lihat catatan di handleSubmit -- hapus juga aman offline
    // lewat window.markTxPendingDelete + window.flushPendingDeletesOnStart.
    let t = window.txs.find(x => x.id === id);
    if (!t) return;
    if (confirm(`Apakah Anda yakin ingin menghapus transaksi "${t.description}"?`)) {
        // SOFT DELETE: jangan DELETE baris cloud, cukup tandai is_deleted=true.
        // Alasan: pullFromCloudSilently() hanya menarik baris dengan
        // updated_at > lastSync (incremental). Baris yang benar-benar di-DELETE
        // tidak akan pernah muncul lagi di hasil query itu, sehingga perangkat
        // lain yang sudah punya transaksi ini di cache lokal TIDAK akan pernah
        // tahu bahwa transaksi sudah dihapus — transaksi itu "hidup lagi" di
        // perangkat tersebut sampai ada full sync manual. Dengan PATCH
        // is_deleted=true + updated_at baru, baris tombstone ini tetap kebawa
        // oleh query incremental, sehingga bisa dibuang dari cache perangkat lain.
        //
        // [FIX] Tandai dulu sebagai "pending delete" (persisted, lihat
        // window.markTxPendingDelete di transaction.js) SEBELUM mencoba PATCH,
        // dan betul-betul di-await + dicek hasilnya -- bukan fire-and-forget
        // seperti sebelumnya. Kalau PATCH gagal (koneksi putus di tengah jalan,
        // tab ditutup, dsb), catatan pending delete ini TETAP ADA dan akan
        // dicoba lagi otomatis oleh window.flushPendingDeletesOnStart() saat
        // app dibuka lagi atau koneksi online lagi -- baris itu tidak akan
        // "hidup lagi" secara diam-diam di pull berikutnya.
        const bookIdAtDelete = window.currentBookId;
        window.markTxPendingDelete(id, bookIdAtDelete);
        window.txs = window.txs.filter(x => x.id !== id);
        window.saveTransactions();
        window.showToast("Transaksi dihapus", "warning");
        if (window.isOnline()) {
            const ok = await window.pushDeleteToCloud(id, bookIdAtDelete);
            if (ok) {
                window.clearTxPendingDelete(id);
            } else {
                console.warn('[Delete] Gagal PATCH is_deleted ke cloud, akan dicoba lagi otomatis:', id);
            }
        }
        await window.addCloudLog('HAPUS', `Menghapus transaksi "${t.description}" ber-ID: ${id}`);
        window.sendTelegramNotif(window.buildTxNotifMessage('HAPUS', t, window.getCurrentBookName()));
    }
};
window.viewAttachment = function(id) {
    let t = window.txs.find(x => x.id === id);
    if (t && t.attachment) {
        window.actionId = id;
        document.getElementById('fullAttachmentImage').src = t.attachment;
        window.openModal('viewAttachmentModal');
    }
};
window.downloadAttachment = function() {
    let t = window.txs.find(x => x.id === window.actionId);
    if (t && t.attachment) {
        let a = document.createElement('a');
        a.href = t.attachment;
        a.download = 'nota-' + t.id + '.png';
        a.click();
    }
};


// ==================== FASE KEHIDUPAN ====================
window.FASE_DATA = [
    null, // index 0 kosong
    {
        nama: 'Bulan Madu',
        desc: 'Fokus membangun fondasi keuangan bersama: rekening gabungan, proteksi asuransi dasar, dan menabung untuk rumah pertama.',
        prioritas: ['Dana darurat 6 bulan', 'Asuransi jiwa & kesehatan', 'Tabungan rumah / KPR', 'Investasi reksa dana pemula']
    },
    {
        nama: 'Penyesuaian & Realita',
        desc: 'Pola pengeluaran mulai terlihat. Saatnya mengoptimalkan anggaran, melunasi hutang konsumtif, dan mulai investasi rutin.',
        prioritas: ['Lunasi hutang kartu kredit / konsumtif', 'Investasi rutin SBN / reksa dana', 'Dana darurat diperkuat 9 bulan', 'Perencanaan anak (jika ada)']
    },
    {
        nama: 'Pengasuhan Awal',
        desc: 'Biaya melonjak dengan hadirnya anak: persalinan, kebutuhan bayi, dan asuransi anak. Proteksi jiwa sangat kritis di fase ini.',
        prioritas: ['Asuransi jiwa uang pertanggungan besar', 'Dana pendidikan anak (mulai sejak dini!)', 'Dana darurat 12 bulan', 'Review pengeluaran rutin — potong yang tidak perlu']
    },
    {
        nama: 'Keluarga Aktif',
        desc: 'Pengeluaran tinggi: sekolah, les, kesehatan, dan karir menanjak. Imbangi dengan investasi jangka menengah untuk pendidikan.',
        prioritas: ['Dana pendidikan SMA / kuliah', 'KPR / cicilan properti', 'Investasi saham / reksa dana ekuitas', 'Tabungan liburan keluarga tahunan']
    },
    {
        nama: 'Remaja & Melepas',
        desc: 'Biaya kuliah & pernikahan anak di depan mata. Mulai fokus pada persiapan pensiun yang lebih serius.',
        prioritas: ['Dana kuliah anak', 'Persiapan pensiun (DPPK / BPJS TK / DPLK)', 'Investasi properti produktif', 'Proteksi kesehatan pasangan']
    },
    {
        nama: 'Sarang Kosong',
        desc: 'Anak mandiri, beban berkurang. Optimalkan aset, mulai menikmati hasil kerja keras, dan perkuat dana pensiun.',
        prioritas: ['Maksimalkan dana pensiun', 'Diversifikasi investasi (properti, obligasi, emas)', 'Asuransi kesehatan komprehensif', 'Dana warisan / waqaf / wakaf produktif']
    },
    {
        nama: 'Pensiun & Menua Bersama',
        desc: 'Fokus pada arus kas pasif, kesehatan, dan menikmati hidup. Kelola aset agar cukup seumur hidup.',
        prioritas: ['Arus kas dari pensiun / investasi pasif', 'Asuransi kesehatan lansia', 'Dana perawatan jangka panjang', 'Perencanaan warisan & wasiat']
    }
];

window.getFaseKehidupan = function() {
    const raw = localStorage.getItem('sk_fase_kehidupan_' + window.currentBookId);
    if (raw) { try { return JSON.parse(raw); } catch { return null; } }
    return null;
};

window.saveFaseKehidupanToLocal = function(data) {
    localStorage.setItem('sk_fase_kehidupan_' + window.currentBookId, JSON.stringify(data));
};

window.openFaseKehidupanModal = function() {
    const fase = window.getFaseKehidupan();
    const sel = document.getElementById('faseSelect');
    const tgt = document.getElementById('faseTarget');
    const tng = document.getElementById('faseTanggungan');
    if (fase) {
        if (sel) sel.value = fase.fase || '';
        if (tgt) tgt.value = fase.target || '';
        if (tng) tng.value = fase.tanggungan != null ? fase.tanggungan : '';
    } else {
        if (sel) sel.value = '';
        if (tgt) tgt.value = '';
        if (tng) tng.value = '';
    }
    window.updateFaseDesc();
    window.openModal('faseKehidupanModal');
};

window.updateFaseDesc = function() {
    const val = parseInt(document.getElementById('faseSelect').value);
    const box = document.getElementById('faseDescBox');
    if (!val || !window.FASE_DATA[val]) { box.style.display = 'none'; return; }
    const f = window.FASE_DATA[val];
    box.style.display = 'block';
    box.innerHTML = `<b>${f.nama}</b><br>${f.desc}<br><br><b>Prioritas keuangan:</b><ul style="margin:4px 0 0 16px; padding:0;">${f.prioritas.map(p => `<li>${p}</li>`).join('')}</ul>`;
};

window.saveFaseKehidupan = function() {
    const fase = parseInt(document.getElementById('faseSelect').value);
    const target = document.getElementById('faseTarget').value.trim();
    const tanggungan = parseInt(document.getElementById('faseTanggungan').value) || 0;
    if (!fase) { window.showToast('Pilih fase kehidupan terlebih dahulu!', 'warning'); return; }
    const data = { fase, target, tanggungan, updatedAt: new Date().toISOString() };
    window.saveFaseKehidupanToLocal(data);
    if (window.isOnline()) {
        // [FIX CLOCK SKEW] pushSetting() sekarang balikin baris hasil
        // representasi server (lihat db.js), yang updated_at-nya sudah
        // dijamin server lewat trigger -- bukan jam device manapun. Simpan
        // nilai itu sebagai _serverUpdatedAt di cache lokal supaya
        // perbandingan LWW berikutnya di pullAllSettings() (db.js) pakai jam
        // yang konsisten dengan device lain, bukan jam device INI sendiri.
        window.pushSetting('fase_kehidupan', data, window.currentBookId).then(result => {
            if (result && Array.isArray(result) && result[0] && result[0].updated_at) {
                window.saveFaseKehidupanToLocal({ ...data, _serverUpdatedAt: result[0].updated_at });
            }
        });
    }
    window.updateFaseCard();
    window.closeModal('faseKehidupanModal');
    window.showToast('Fase kehidupan berhasil disimpan!', 'success');
};

// ==================== TARGET DANA DARURAT (BULAN) ====================
// Sebelumnya hardcoded 12x anggaran bulanan. Sekarang adjustable per buku,
// supaya bisa disesuaikan dengan kondisi ekonomi (misal diturunkan ke 6
// bulan saat penghasilan belum stabil, atau dinaikkan ke 12+ saat aman).
window.getEmergencyFundMonths = function(bookId) {
    const raw = localStorage.getItem('sk_emergency_fund_months_' + (bookId || window.currentBookId));
    const n = parseInt(raw);
    return (!isNaN(n) && n > 0) ? n : 12; // default 12 bulan kalau belum pernah diatur
};
window.saveEmergencyFundMonthsToLocal = function(months, bookId) {
    localStorage.setItem('sk_emergency_fund_months_' + (bookId || window.currentBookId), String(months));
};
window.openEmergencyFundModal = function() {
    document.getElementById('efMonthsInput').value = window.getEmergencyFundMonths();
    window.openModal('emergencyFundModal');
};
window.setEfMonthsPreset = function(months) {
    document.getElementById('efMonthsInput').value = months;
};
window.saveEmergencyFundMonths = function() {
    const months = parseInt(document.getElementById('efMonthsInput').value);
    if (!months || months < 1 || months > 60) { window.showToast('Masukkan jumlah bulan yang valid (1-60)!', 'warning'); return; }
    window.saveEmergencyFundMonthsToLocal(months);
    if (window.isOnline()) {
        window.pushSetting('emergency_fund_months', months, window.currentBookId);
    }
    window.updateFinancialCards();
    window.closeModal('emergencyFundModal');
    window.showToast('Target dana darurat disimpan: ' + months + ' bulan', 'success');
};

window.updateFaseCard = function() {
    const fase = window.getFaseKehidupan();
    const namaEl = document.getElementById('fcFaseNama');
    const descEl = document.getElementById('fcFaseDesc');
    const aiBtn  = document.getElementById('faseAIBtn');
    if (!namaEl) return;
    if (!fase || !fase.fase) {
        namaEl.innerText = window.t('life_phase_not_set');
        descEl.innerText = window.t('life_phase_click');
        if (aiBtn) aiBtn.style.display = 'none';
        return;
    }
    const f = window.FASE_DATA[fase.fase];
    if (!f) return;
    namaEl.innerText = f.nama;
    let desc = f.desc.substring(0, 80) + '...';
    if (fase.tanggungan > 0) desc = `${fase.tanggungan} tanggungan · ` + desc;
    if (fase.target) desc = `${fase.target} · ` + desc.substring(0, 60) + '...';
    descEl.innerText = desc;
    if (aiBtn) aiBtn.style.display = 'inline-flex';
};

// Filter
window.setFilter = function(f) {
    window.currentPage = 1;
    window.currentFilter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.filter-btn').forEach(b => {
        const btnText = b.innerText.trim().toLowerCase();
        const match = (f === 'all' && btnText === 'semua') ||
            (f === 'income' && btnText === 'masuk') ||
            (f === 'expense' && btnText === 'keluar');
        if (match) b.classList.add('active');
    });
    window.render();
};
window.applyDateFilter = function() {
    window.currentPage = 1;
    window.filterStartDate = document.getElementById('dateFilterStart').value;
    window.filterEndDate = document.getElementById('dateFilterEnd').value;
    let btn = document.querySelector('.date-clear-btn');
    if (window.filterStartDate || window.filterEndDate) btn.style.display = 'inline-block';
    window.render();
};
window.resetDateFilter = function() {
    window.currentPage = 1;
    document.getElementById('dateFilterStart').value = '';
    document.getElementById('dateFilterEnd').value = '';
    window.filterStartDate = '';
    window.filterEndDate = '';
    document.querySelector('.date-clear-btn').style.display = 'none';
    window.render();
};
