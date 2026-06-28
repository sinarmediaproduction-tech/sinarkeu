// ==================== BOOK MANAGEMENT ====================
window.updateBookSelectDropdown = function() {
    let sel = document.getElementById('currentBookSelect');
    sel.innerHTML = '';
    window.books.forEach(b => {
        let opt = document.createElement('option');
        opt.value = b.id;
        const isChild = !!b.parentId;
        opt.innerText = isChild ? '  ↳ ' + b.name : b.name;
        if (b.id === window.currentBookId) opt.selected = true;
        sel.appendChild(opt);
    });
};

window.switchBook = async function(id) {
    if (!window.books.find(b => b.id === id)) return;
    if (id === window.currentBookId) return;
    window.currentBookId = id;
    localStorage.setItem('sk_current_book_id', window.currentBookId);

    // Muat data lokal buku baru terlebih dahulu agar UI tidak kosong
    window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
    const cached = localStorage.getItem('sk_txs_' + window.currentBookId);
    window.txs = cached ? JSON.parse(cached) : [];
    window.render();
    window.updateBookSelectDropdown();
    if (document.getElementById('bookManagerModal').classList.contains('show')) window.renderBookList();
    window.showToast("Berhasil beralih ke: " + (window.books.find(b => b.id === id)?.name || id));

    if (!window.isOnline()) return;

    // Pastikan session crypto key sudah ada sebelum pull cloud.
    // Setelah reload, _sessionCryptoKey hilang (in-memory only) —
    // tanpa ini, _decryptSettingValue() gagal decrypt dan data cloud tidak terbaca.
    if (!window._sessionCryptoKey) {
        await window.restoreSessionCryptoKey();
    }

    // ── PULL SEMUA DATA CLOUD UNTUK BUKU BARU ──
    try {
        // 1. Transaksi + settings sekaligus (parallel)
        await Promise.all([
            window.pullFromCloudSilently(),
            window.pullAllSettings(),
        ]);

        // 2. Payment reminders (per-buku, tidak dicakup pullAllSettings)
        try {
            const reminders = await window.loadPaymentReminders(window.currentBookId);
            if (reminders && reminders.length > 0) {
                localStorage.setItem('sk_payment_reminders_' + window.currentBookId, JSON.stringify(reminders));
            }
            if (typeof window.renderPaymentReminders === 'function') await window.renderPaymentReminders();
            if (typeof window.updatePaymentReminderBanner === 'function') window.updatePaymentReminderBanner();
        } catch (e) {
            console.warn('[switchBook] Gagal pull payment reminders:', e);
        }

        // Render ulang semua card keuangan setelah semua data per-buku selesai dimuat
        if (typeof window.updateFinancialCards === 'function') window.updateFinancialCards();
        if (typeof window.updateFaseCard === 'function') window.updateFaseCard();
        if (typeof window.updateZakatCard === 'function') window.updateZakatCard();
        if (typeof window.renderForecastCard === 'function') window.renderForecastCard();

        window._lastSyncTime = new Date();
        if (typeof window.updateSyncTimeBadge === 'function') window.updateSyncTimeBadge();
    } catch (e) {
        console.error('[switchBook] Gagal pull data cloud:', e);
        window.showToast('Sebagian data cloud gagal dimuat', 'warning');
    }
};

window.openBookManager = function() {
    if (!window.requireOnline('mengelola buku')) return;
    window.openModal('bookManagerModal');
    window.renderBookList();
    window.renderBookParentOptions();
    window.refreshStorageEstimate();
};

window.renderBookParentOptions = function() {
    const sel = document.getElementById('newBookParent');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Buku mandiri (tidak ada induk) —</option>';
    window.books.forEach(b => {
        // Hanya tampilkan buku yang bukan anak buku (tidak boleh nested lebih dari 1 level)
        if (b.parentId) return;
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        sel.appendChild(opt);
    });
};

window.renderBookList = function() {
    let container = document.getElementById('bookListContainer');
    container.innerHTML = '';
    window.books.forEach(b => {
        let div = document.createElement('div');
        div.className = 'book-list-item';
        let isCurrent = b.id === window.currentBookId;
        let delBtn = window.books.length > 1 ? `<button class="btn-mini btn-mini-danger" onclick="window.deleteBook('${b.id}')">Hapus</button>` : '';
        if (isCurrent) delBtn = '<span style="font-size:.65rem; color:#00875a; font-weight:bold;">SEDANG AKTIF</span>';
        const parentBook = b.parentId ? window.books.find(x => x.id === b.parentId) : null;
        const parentLabel = parentBook ? `<div style="font-size:.6rem; color:#6b46c1; margin-top:2px;">↳ Anak dari: <b>${window.escapeHtml(parentBook.name)}</b></div>` : '';
        div.innerHTML = `
            <span class="book-list-name">
                ${window.escapeHtml(b.name)}
                ${parentLabel}
            </span>
            <div class="book-list-actions">
                ${!isCurrent ? `<button class="btn-mini" onclick="window.switchBook('${b.id}')">Buka</button>` : ''}
                <button class="btn-mini" style="background:#f0f4ff; color:#1a56db; border:1px solid #c5d8ff;" onclick="window.renameBook('${b.id}')">Nama</button>
                ${b.parentId && isCurrent ? `<button class="btn-mini" style="background:#6b46c1; color:#fff;" onclick="window.closeModal('bookManagerModal'); window.openTutupAnakBuku()">Tutup & Kirim</button>` : ''}
                ${delBtn}
            </div>
        `;
        container.appendChild(div);
    });
};

window.renameBook = async function(id) {
    if (!window.requireOnline('mengganti nama buku')) return;
    const book = window.books.find(b => b.id === id);
    if (!book) return;
    const newName = prompt(`Nama baru untuk buku "${book.name}":`, book.name);
    if (!newName || !newName.trim()) return;
    if (newName.trim() === book.name) return;
    book.name = newName.trim();
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    await window.pushSettingBooks();
    window.renderBookList();
    window.renderBookParentOptions();
    window.updateBookSelectDropdown();
    window.showToast(`Nama buku diubah ke "${book.name}"`, 'success');
    await window.addCloudLog('SISTEM', `Mengganti nama buku ID ${id} menjadi "${book.name}"`);
};

window.addNewBook = async function(e) {
    e.preventDefault();
    if (!window.requireOnline('membuat buku baru')) return;
    let input = document.getElementById('newBookName');
    let name = input.value.trim();
    if (!name) return;
    const parentSel = document.getElementById('newBookParent');
    const parentId = parentSel && parentSel.value ? parentSel.value : null;
    let id = 'b_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newBook = { id, name };
    if (parentId) newBook.parentId = parentId;
    window.books.push(newBook);
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    input.value = '';
    if (parentSel) parentSel.value = '';
    await window.pushSettingBooks();
    await new Promise(r => setTimeout(r, 500));
    await window.pullAllSettings();
    window.renderBookList();
    window.updateBookSelectDropdown();
    const parentName = parentId ? (window.books.find(b => b.id === parentId)?.name || '') : '';
    const label = parentId ? `"${name}" (anak dari "${parentName}")` : `"${name}"`;
    window.showToast(`${label} berhasil dibuat!`, 'success');
    await window.addCloudLog('SISTEM', `Membuat buku kas baru: "${name}" ${parentId ? '(anak dari ' + parentId + ')' : ''} dengan ID ${id}`);
    const cfg = window.getTgConfig();
    if (cfg.active) window.sendTelegramNotif(`<b>Buku Baru Dibuat</b>\n\nNama: ${name}${parentId ? '\nAnak dari: ' + parentName : ''}\nID: ${id}\nDevice: ${window.deviceId}`);
};

window.deleteBook = async function(id) {
    if (!window.requireOnline('menghapus buku')) return;
    if (id === window.currentBookId) {
        alert('Tidak bisa menghapus buku kas yang sedang dibuka! Silakan pindah ke buku lain terlebih dahulu.');
        return;
    }
    let b = window.books.find(x => x.id === id);
    if (!b) { window.showToast('Buku sudah tidak ada (mungkin sudah dihapus device lain)', 'warning'); return; }
    const confirm1 = confirm(`Hapus permanen buku "${b.name}"?\n\nData yang dihapus:\n- Semua transaksi dalam buku ini\n- Anggaran bulanan\n- Anggaran Dasar\n- Log aktivitas\n\nData TIDAK BISA dikembalikan!`);
    if (!confirm1) return;
    const confirm2 = prompt(`Ketik "HAPUS ${b.name}" untuk konfirmasi penghapusan buku ini:`);
    if (confirm2 !== `HAPUS ${b.name}`) { alert('Konfirmasi gagal. Penghapusan dibatalkan.'); return; }
    const cfg = window.getTgConfig();
    if (cfg.active) {
        window.sendTelegramNotif(`<b>Penghapusan Buku</b>\n\nBuku <b>${b.name}</b> akan dihapus oleh device ${window.deviceId}\n\nData akan dihapus dalam 3 detik...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    if (window.isOnline()) {
        const prevBookId = window.currentBookId;
        window.currentBookId = id;
        try {
            const tag_del = window.getAccountTag ? window.getAccountTag() : null;
            const tagFilter_del = tag_del ? `&account_tag=eq.${tag_del}` : '';
            await window.callSupabaseAPI('transactions', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            await window.callSupabaseAPI('audit_logs', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            await window.callSupabaseAPI('settings', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            console.log(`Data cloud buku "${b.name}" berhasil dihapus.`);
        } catch (e) {
            console.error('Gagal hapus data cloud:', e);
            window.showToast('Gagal menghapus data cloud, coba lagi', 'error');
            window.currentBookId = prevBookId;
            return;
        }
        window.currentBookId = prevBookId;
    }
    localStorage.removeItem('sk_txs_' + id);
    localStorage.removeItem('sk_budgets_' + id);
    localStorage.removeItem('sk_logs_' + id);
    localStorage.removeItem('sk_manual_backups_' + id);
    localStorage.removeItem('sk_last_auto_backup_' + id);
    localStorage.removeItem('sk_last_cloud_backup_' + id);
    localStorage.removeItem('sk_default_budget_' + id);
    window.books = window.books.filter(x => x.id !== id);
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    window.renderBookList();
    window.updateBookSelectDropdown();
    window.showToast(`Buku "${b.name}" & data cloud dihapus`, "warning");
    await window.pushSettingBooks();
    if (cfg.active) window.sendTelegramNotif(`<b>Buku Dihapus</b>\n\nBuku <b>${b.name}</b> telah dihapus permanen.\nDevice: ${window.deviceId}`);
};

// Storage Estimasi
window.estimateSupabaseStorage = async function() {
    if (!window.isOnline()) return null;
    const baseUrl = window.getCloudUrl();
    const apiKey  = window.getSupabaseKey();
    if (!baseUrl || !apiKey) return null;
    const headers = { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Prefer': 'count=exact' };

    // Tiap tabel punya primary key berbeda, gunakan HEAD request agar tidak perlu tahu nama kolom
    async function countTable(table) {
        try {
            const res = await fetch(`${baseUrl}/rest/v1/${table}?select=*`, {
                method: 'HEAD',
                headers
            });
            const cnt = res.headers.get('content-range');
            if (cnt) {
                const m = cnt.match(/\/(\d+)$/);
                if (m) return parseInt(m[1]);
            }
            return 0;
        } catch { return 0; }
    }
    const [txCount, logCount, settCount] = await Promise.all([
        countTable('transactions'),
        countTable('audit_logs'),
        countTable('settings'),
    ]);
    const TX_ROW_BYTES   = 380;
    const LOG_ROW_BYTES  = 250;
    const SET_ROW_BYTES  = 180;
    const estimatedBytes = (txCount * TX_ROW_BYTES) + (logCount * LOG_ROW_BYTES) + (settCount * SET_ROW_BYTES);
    return { txCount, logCount, settCount, estimatedBytes };
};

window.formatBytes = function(bytes) {
    if (bytes < 1024)          return bytes + ' B';
    if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024**3)       return (bytes / (1024*1024)).toFixed(2) + ' MB';
    return (bytes / (1024**3)).toFixed(2) + ' GB';
};

window.renderStorageBar = function(usedBytes, totalBytes, label) {
    const pct = Math.min((usedBytes / totalBytes) * 100, 100);
    const colorClass = pct >= 90 ? '#de350b' : pct >= 70 ? '#cc7b00' : '#1a56db';
    return `
        <div style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                <span style="font-size:.7rem; font-weight:600; color:#333;">${label}</span>
                <span style="font-size:.68rem; color:#555;">${window.formatBytes(usedBytes)} / ${window.formatBytes(totalBytes)} &nbsp;·&nbsp; <b style="color:${colorClass}">${pct.toFixed(1)}%</b></span>
            </div>
            <div style="height:8px; background:#dde8ff; border-radius:4px; overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:${colorClass}; border-radius:4px; transition:width .4s;"></div>
            </div>
            <div style="font-size:.63rem; color:#888; margin-top:3px; text-align:right;">Sisa: ${window.formatBytes(totalBytes - usedBytes)}</div>
        </div>`;
};

window.refreshStorageEstimate = async function() {
    const el  = document.getElementById('storageEstimContent');
    const btn = document.getElementById('storageRefreshBtn');
    if (!el) return;
    el.innerHTML = '<div style="font-size:.7rem; color:#888; text-align:center; padding:8px 0;">Menghitung...</div>';
    if (btn) btn.disabled = true;
    const data = await window.estimateSupabaseStorage();
    if (btn) btn.disabled = false;
    if (!data) {
        el.innerHTML = '<div style="font-size:.7rem; color:#de350b; text-align:center; padding:8px 0;">Tidak dapat memuat — pastikan koneksi Supabase aktif.</div>';
        return;
    }
    const { txCount, logCount, settCount, estimatedBytes } = data;
    const totalRows = txCount + logCount + settCount;
    const SUPABASE_FREE_DB_BYTES = 500 * 1024 * 1024;
    const dbBar   = window.renderStorageBar(estimatedBytes, SUPABASE_FREE_DB_BYTES, 'Database (estimasi)');
    const pctNum  = Math.min((estimatedBytes / SUPABASE_FREE_DB_BYTES) * 100, 100);
    const statusColor = pctNum >= 90 ? '#de350b' : pctNum >= 70 ? '#cc7b00' : '#006644';
    const statusText  = pctNum >= 90 ? 'Hampir penuh! Pertimbangkan arsipkan data lama.' :
                        pctNum >= 70 ? 'Mendekati batas — pantau secara berkala.' :
                                       'Kapasitas masih aman.';
    el.innerHTML = `
        ${dbBar}
        <div style="background:#f5f5f5; border-radius:8px; padding:10px 12px; font-size:.68rem; color:#444; line-height:1.8; margin-bottom:10px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 16px;">
                <span>Transaksi</span><b>${txCount.toLocaleString('id-ID')} baris</b>
                <span>Log Aktivitas</span><b>${logCount.toLocaleString('id-ID')} baris</b>
                <span>Setelan</span><b>${settCount.toLocaleString('id-ID')} baris</b>
                <span>Total Baris</span><b>${totalRows.toLocaleString('id-ID')} baris</b>
            </div>
        </div>
        <div style="font-size:.68rem; color:${statusColor}; font-weight:600; text-align:center; padding:4px 8px; background:${pctNum>=90?'#fff5f5':pctNum>=70?'#fffbeb':'#e3fcef'}; border-radius:6px;">
            ${statusText}
        </div>
        <div style="font-size:.6rem; color:#aaa; margin-top:8px; text-align:right;">
            * Estimasi berdasarkan jumlah baris × rata-rata ukuran baris. Free tier Supabase: DB 500 MB, File Storage 1 GB.
        </div>
    `;
};

window.openTelegramSettings = async function() {
    if (!window.requireOnline('mengatur Telegram')) return;
    document.getElementById('tgTestStatus').innerHTML = '';
    window.openModal('telegramSettingsModal');
    window.loadTgConfigToForm();
    if (window.isOnline()) {
        const _tgTag = window.getAccountTag ? window.getAccountTag() : null;
        const _tgTagFilter = _tgTag ? `&account_tag=eq.${_tgTag}` : '';
        const allRows = await window.callSupabaseAPI('settings', 'GET', null, `?key=eq.telegram_config&order=updated_at.desc&limit=1${_tgTagFilter}`);
        if (allRows && Array.isArray(allRows) && allRows.length > 0) {
            try {
                const parsed = JSON.parse(allRows[0].value);
                if (parsed.token) localStorage.setItem('sk_tg_token', parsed.token);
                if (parsed.chatId) localStorage.setItem('sk_tg_chatid', parsed.chatId);
                if (parsed.edgeUrl) localStorage.setItem('sk_tg_edge_url', parsed.edgeUrl);
            } catch (e) { }
        }
        window.loadTgConfigToForm();
    }
};

// ==================== TUTUP ANAK BUKU ====================

window.openTutupAnakBuku = function() {
    const book = window.books.find(b => b.id === window.currentBookId);
    if (!book || !book.parentId) {
        window.showToast('Buku ini bukan anak buku.', 'warning');
        return;
    }
    const parentBook = window.books.find(b => b.id === book.parentId);
    if (!parentBook) {
        window.showToast('Buku induk tidak ditemukan.', 'error');
        return;
    }

    // Hitung total
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    const netTotal = totalInc - totalExp + balanceOffset;
    const txCount = window.txs.length;

    // Isi modal konfirmasi
    const el = document.getElementById('tutupAnakBukuInfo');
    if (el) {
        el.innerHTML = `
            <div style="background:#f3e8ff; border:1px solid #d6bcfa; border-radius:8px; padding:12px 14px; font-size:.78rem; line-height:1.8;">
                <div><b>Anak Buku:</b> ${window.escapeHtml(book.name)}</div>
                <div><b>Kirim ke Induk:</b> ${window.escapeHtml(parentBook.name)}</div>
                <hr style="margin:8px 0; border-color:#e9d8fd;">
                <div>Jumlah transaksi: <b>${txCount}</b></div>
                <div>Total pemasukan: <b style="color:#00875a">${window.rp(totalInc)}</b></div>
                <div>Total pengeluaran: <b style="color:#de350b">${window.rp(totalExp)}</b></div>
                <div><b>Net yang dikirim: <span style="color:${netTotal >= 0 ? '#00875a' : '#de350b'}">${window.rp(Math.abs(netTotal))}</span></b>
                    ${netTotal < 0 ? ' (pengeluaran)' : ' (pemasukan)'}</div>
            </div>
            <div style="margin-top:10px; font-size:.72rem; color:#666;">
                Satu transaksi ringkasan akan ditambahkan ke buku <b>${window.escapeHtml(parentBook.name)}</b>.<br>
                Anak buku ini <b>tidak dihapus</b> — tetap bisa dibuka sebagai arsip.
            </div>
        `;
    }

    // Isi default deskripsi
    const descEl = document.getElementById('tutupAnakBukuDesc');
    if (descEl) descEl.value = `Ringkasan: ${book.name}`;

    window.openModal('tutupAnakBukuModal');
};

window.tutupAnakBuku = async function() {
    if (!window.requireOnline('menutup anak buku')) return;

    const book = window.books.find(b => b.id === window.currentBookId);
    if (!book || !book.parentId) return;
    const parentBook = window.books.find(b => b.id === book.parentId);
    if (!parentBook) return;

    const descEl = document.getElementById('tutupAnakBukuDesc');
    const deskripsi = (descEl ? descEl.value.trim() : '') || `Ringkasan: ${book.name}`;

    // Hitung net
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    const netTotal = totalInc - totalExp + balanceOffset;

    if (netTotal === 0) {
        window.showToast('Tidak ada net transaksi untuk dikirim.', 'warning');
        return;
    }

    const txType = netTotal >= 0 ? 'income' : 'expense';
    const txAmount = Math.abs(netTotal);
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') +
        'T' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':00';

    const _ntTag = window.getAccountTag ? window.getAccountTag() : null;
    const newTx = {
        id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        book_id: parentBook.id,
        device_id: window.deviceId,
        type: txType,
        amount: txAmount,
        category: txType === 'income' ? 'Pemasukan' : 'Lainnya',
        description: deskripsi,
        date: dateStr,
        attachment: null,
        updated_at: new Date().toISOString(),
        ...(_ntTag ? { account_tag: _ntTag } : {})
    };

    // Push ke Supabase langsung ke buku induk
    const result = await window.callSupabaseAPI('transactions', 'POST', [newTx]);
    if (!result) {
        window.showToast('Gagal mengirim ke buku induk!', 'error');
        return;
    }

    // Jika sedang di buku yang sama dengan induk nanti, update lokal
    const parentCached = JSON.parse(localStorage.getItem('sk_txs_' + parentBook.id) || '[]');
    parentCached.unshift(newTx);
    window.trimAndSaveLocal(parentBook.id, parentCached);

    await window.addCloudLog('SISTEM', `Tutup anak buku "${book.name}" → kirim ${window.rp(txAmount)} ke "${parentBook.name}"`);

    window.closeModal('tutupAnakBukuModal');
    window.showToast(`Ringkasan ${window.rp(txAmount)} berhasil dikirim ke "${parentBook.name}"!`, 'success');

    // Tawarkan pindah ke buku induk
    setTimeout(() => {
        if (confirm(`Berhasil! Mau langsung buka buku "${parentBook.name}" untuk melihat hasilnya?`)) {
            window.switchBook(parentBook.id);
        }
    }, 300);
};
