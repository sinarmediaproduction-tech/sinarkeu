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
    document.getElementById('transactionCount').innerText = filtered.length + ' transaksi';
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
    if ((window.expenseChartVisible || !window._expenseChartInitialized) && typeof window.renderExpenseChart === 'function') {
        window.renderExpenseChart();
    }
    let allSorted = [...window.txs].sort((a, b) => window.parseTxDate(a.date) - window.parseTxDate(b.date));
    let balanceMap = {};
    let tempBal = balanceOffset;
    allSorted.forEach(t => {
        let amt = Number(t.amount) || 0;
        if (t.type === 'income') tempBal += amt;
        else tempBal -= amt;
        balanceMap[t.id] = tempBal;
    });
    if (filtered.length === 0) {
        body.innerHTML = '<tr><td colspan="9" class="text-center" style="color:#888; padding:30px;">Tidak ada transaksi ditemukan</td></tr>';
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
        let attCell = '<span class="no-attachment">❌</span>';
        if (t.attachment) attCell = `<span class="attachment-link" onclick="window.viewAttachment('${t.id}')">🖼️</span>`;
        const globalIndex = startIdx + index + 1;
        const actionBtnDisabled = online ? '' : 'disabled';
        tr.innerHTML = `
            <td class="text-center col-no">${globalIndex}</td>
            <td>${window.formatDateTime(t.date)}</td>
            <td>${badge}</td>
            <td>${window.escapeHtml(t.description)}</td>
            <td class="text-right" style="color:#00875a; font-weight:500;">${incText}</td>
            <td class="text-right" style="color:#de350b; font-weight:500;">${expText}</td>
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

    // Dana Darurat = 12x anggaran bulanan
    const danaDarurat = anggaranBulanan * 12;

    // Kebutuhan Setahun = Dana Darurat + Anggaran Tahunan
    const kebutuhanSetahun = danaDarurat + anggaranTahunan;

    // Dana Saling Jaga = 40% dari (saldo - dana darurat), min 0
    const sisaSetelahDarurat = saldoAkhir - danaDarurat;
    const danaSalingJaga = sisaSetelahDarurat > 0 ? sisaSetelahDarurat * 0.4 : 0;

    // Update DOM
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = window.rp(val); };
    set('fcAnggaranBulanan', anggaranBulanan);
    set('fcAnggaranTahunan', anggaranTahunan);
    set('fcDanaDarurat', danaDarurat);
    set('fcKebutuhanSetahun', kebutuhanSetahun);
    set('fcDanaSalingJaga', danaSalingJaga);

    // Warna peringatan card Dana Saling Jaga
    const cardDSJ = document.getElementById('cardDanaSalingJaga');
    const note = document.getElementById('fcDSJNote');
    if (cardDSJ && note) {
        if (sisaSetelahDarurat <= 0) {
            cardDSJ.style.borderTopColor = '#de350b';
            cardDSJ.style.background = '#fff5f5';
            note.innerText = '⚠️ Saldo belum cukup untuk dana darurat';
            note.style.color = '#de350b';
        } else {
            cardDSJ.style.borderTopColor = '#00875a';
            cardDSJ.style.background = '';
            note.innerText = '40% dari saldo setelah dana darurat';
            note.style.color = '#888';
        }
    }

    // Warna peringatan card Kebutuhan Setahun
    const cardKS = document.getElementById('cardKebutuhanSetahun');
    if (cardKS) {
        if (saldoAkhir < kebutuhanSetahun) {
            cardKS.style.borderTopColor = '#de350b';
            cardKS.style.background = '#fff5f5';
        } else {
            cardKS.style.borderTopColor = '#d69e2e';
            cardKS.style.background = '';
        }
    }

    // Update card fase kehidupan
    if (typeof window.updateFaseCard === 'function') window.updateFaseCard();
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
    let group = document.getElementById('categoryGroup');
    if (type === 'income') group.style.display = 'none';
    else group.style.display = 'block';
};
window.toggleEditCategoryField = function() {
    let type = document.querySelector('input[name="editType"]:checked').value;
    let group = document.getElementById('editCategoryGroup');
    if (type === 'income') group.style.display = 'none';
    else group.style.display = 'block';
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
            document.getElementById('editAttachmentInfo').innerText = "Nota baru siap disimpan";
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
    if (!window.requireOnline('menambah transaksi')) return;
    let type = document.querySelector('input[name="type"]:checked').value;
    const nowTx = new Date();
    const _pad = n => String(n).padStart(2, '0');
    const date = `${nowTx.getFullYear()}-${_pad(nowTx.getMonth()+1)}-${_pad(nowTx.getDate())}T${_pad(nowTx.getHours())}:${_pad(nowTx.getMinutes())}`;
    document.getElementById('txDate').value = date;
    let category = type === 'expense' ? document.getElementById('txCategory').value : 'Pemasukan';
    let description = document.getElementById('txDesc').value.trim();
    let amount = window.unRp(document.getElementById('txAmount').value);
    if (type === 'expense' && !category) { alert('Harap pilih kategori!'); return; }
    if (amount <= 0) { alert('Jumlah nominal harus lebih dari 0!'); return; }
    const txId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const attachmentData = await window.resolveAttachment(window.currentAttachmentFile, window.currentAttachmentData, txId);
    let newTx = { id: txId, type, date, category, description, amount, attachment: attachmentData, updated_at: new Date().toISOString() };
    window.txs.unshift(newTx);
    window.closeModal('addModal');
    window.currentAttachmentFile = null;
    window.saveTransactions();
    window.showToast("Transaksi berhasil disimpan");
    if (type === 'expense') window.checkBudgetWarningAfterSave(date, category);
    await window.addCloudLog('TAMBAH', `Menambah item baru: "${description}" sebesar ${window.rp(amount)}`);
    window.sendTelegramNotif(window.buildTxNotifMessage('TAMBAH', newTx, window.getCurrentBookName()));
};
window.openActionMenu = function(id) {
    if (!window.isOnline()) { window.showToast('⚠️ Anda harus ONLINE untuk mengedit/menghapus data!', 'warning'); return; }
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
    document.getElementById('editTxDate').value = t.date;
    if (t.type === 'expense') document.getElementById('editTxCategory').value = t.category;
    document.getElementById('editTxDesc').value = t.description;
    document.getElementById('editTxAmount').value = Number(t.amount).toLocaleString('id-ID');
    let info = document.getElementById('editAttachmentInfo');
    let prev = document.getElementById('editAttachmentPreview');
    window.currentAttachmentData = t.attachment;
    if (t.attachment) {
        info.innerText = "Sudah memiliki lampiran nota.";
        prev.src = t.attachment;
        prev.style.display = 'block';
    } else {
        info.innerText = "Belum ada lampiran.";
        prev.style.display = 'none';
    }
    window.openModal('editModal');
};
window.handleEditSubmit = async function(e) {
    e.preventDefault();
    if (!window.requireOnline('mengubah transaksi')) return;
    let id = document.getElementById('editId').value;
    let idx = window.txs.findIndex(x => x.id === id);
    if (idx === -1) return;
    let type = document.querySelector('input[name="editType"]:checked').value;
    let date = document.getElementById('editTxDate').value;
    let category = type === 'expense' ? document.getElementById('editTxCategory').value : 'Pemasukan';
    let description = document.getElementById('editTxDesc').value.trim();
    let amount = window.unRp(document.getElementById('editTxAmount').value);
    if (type === 'expense' && !category) { alert('Harap pilih kategori!'); return; }
    if (amount <= 0) { alert('Nominal harus valid!'); return; }
    const editAttachment = await window.resolveAttachment(window.currentAttachmentFile, window.currentAttachmentData, id);
    window.txs[idx] = { id, type, date, category, description, amount, attachment: editAttachment, updated_at: new Date().toISOString() };
    window.closeModal('editModal');
    window.currentAttachmentFile = null;
    window.saveTransactions();
    window.showToast("Perubahan data disimpan");
    await window.addCloudLog('UBAH', `Mengubah transaksi "${description}" menjadi senilai ${window.rp(amount)}`);
    window.sendTelegramNotif(window.buildTxNotifMessage('UBAH', window.txs[idx], window.getCurrentBookName()));
};
window.confirmDelete = async function(id) {
    if (!window.requireOnline('menghapus transaksi')) return;
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
        if (window.isOnline()) {
            window.callSupabaseAPI('transactions', 'PATCH', { is_deleted: true, updated_at: new Date().toISOString() }, `?id=eq.${id}`);
        }
        window.txs = window.txs.filter(x => x.id !== id);
        window.saveTransactions();
        window.showToast("Transaksi dihapus", "warning");
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
        nama: '💑 Bulan Madu',
        desc: 'Fokus membangun fondasi keuangan bersama: rekening gabungan, proteksi asuransi dasar, dan menabung untuk rumah pertama.',
        prioritas: ['Dana darurat 6 bulan', 'Asuransi jiwa & kesehatan', 'Tabungan rumah / KPR', 'Investasi reksa dana pemula']
    },
    {
        nama: '🏠 Penyesuaian & Realita',
        desc: 'Pola pengeluaran mulai terlihat. Saatnya mengoptimalkan anggaran, melunasi hutang konsumtif, dan mulai investasi rutin.',
        prioritas: ['Lunasi hutang kartu kredit / konsumtif', 'Investasi rutin SBN / reksa dana', 'Dana darurat diperkuat 9 bulan', 'Perencanaan anak (jika ada)']
    },
    {
        nama: '👶 Pengasuhan Awal',
        desc: 'Biaya melonjak dengan hadirnya anak: persalinan, kebutuhan bayi, dan asuransi anak. Proteksi jiwa sangat kritis di fase ini.',
        prioritas: ['Asuransi jiwa uang pertanggungan besar', 'Dana pendidikan anak (mulai sejak dini!)', 'Dana darurat 12 bulan', 'Review pengeluaran rutin — potong yang tidak perlu']
    },
    {
        nama: '🎒 Keluarga Aktif',
        desc: 'Pengeluaran tinggi: sekolah, les, kesehatan, dan karir menanjak. Imbangi dengan investasi jangka menengah untuk pendidikan.',
        prioritas: ['Dana pendidikan SMA / kuliah', 'KPR / cicilan properti', 'Investasi saham / reksa dana ekuitas', 'Tabungan liburan keluarga tahunan']
    },
    {
        nama: '🧑‍🎓 Remaja & Melepas',
        desc: 'Biaya kuliah & pernikahan anak di depan mata. Mulai fokus pada persiapan pensiun yang lebih serius.',
        prioritas: ['Dana kuliah anak', 'Persiapan pensiun (DPPK / BPJS TK / DPLK)', 'Investasi properti produktif', 'Proteksi kesehatan pasangan']
    },
    {
        nama: '🪹 Sarang Kosong',
        desc: 'Anak mandiri, beban berkurang. Optimalkan aset, mulai menikmati hasil kerja keras, dan perkuat dana pensiun.',
        prioritas: ['Maksimalkan dana pensiun', 'Diversifikasi investasi (properti, obligasi, emas)', 'Asuransi kesehatan komprehensif', 'Dana warisan / waqaf / wakaf produktif']
    },
    {
        nama: '👴👵 Pensiun & Menua Bersama',
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
        window.pushSetting('fase_kehidupan', data, window.currentBookId);
    }
    window.updateFaseCard();
    window.closeModal('faseKehidupanModal');
    window.showToast('✅ Fase kehidupan berhasil disimpan!', 'success');
};

window.updateFaseCard = function() {
    const fase = window.getFaseKehidupan();
    const namaEl = document.getElementById('fcFaseNama');
    const descEl = document.getElementById('fcFaseDesc');
    const aiBtn  = document.getElementById('faseAIBtn');
    if (!namaEl) return;
    if (!fase || !fase.fase) {
        namaEl.innerText = 'Belum diatur';
        descEl.innerText = 'Klik untuk mengatur fase kehidupan pernikahan Anda';
        if (aiBtn) aiBtn.style.display = 'none';
        return;
    }
    const f = window.FASE_DATA[fase.fase];
    if (!f) return;
    namaEl.innerText = f.nama;
    let desc = f.desc.substring(0, 80) + '...';
    if (fase.tanggungan > 0) desc = `👨‍👩‍👧 ${fase.tanggungan} tanggungan · ` + desc;
    if (fase.target) desc = `🎯 ${fase.target} · ` + desc.substring(0, 60) + '...';
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
