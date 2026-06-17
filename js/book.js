// ==================== BOOK MANAGEMENT ====================
window.updateBookSelectDropdown = function() {
    let sel = document.getElementById('currentBookSelect');
    sel.innerHTML = '';
    window.books.forEach(b => {
        let opt = document.createElement('option');
        opt.value = b.id;
        opt.innerText = b.name;
        if (b.id === window.currentBookId) opt.selected = true;
        sel.appendChild(opt);
    });
};

window.updateHeaderTitle = function() {
    const el = document.getElementById('headerBrandTitle');
    if (!el) return;
    const book = window.books.find(b => b.id === window.currentBookId);
    el.textContent = book ? book.name : 'Sinarkeu';
};

window.switchBook = async function(id) {
    if (!window.books.find(b => b.id === id)) return;
    if (id === window.currentBookId) return;
    window.currentBookId = id;
    localStorage.setItem('sk_current_book_id', window.currentBookId);
    window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
    const cached = localStorage.getItem('sk_txs_' + window.currentBookId);
    window.txs = cached ? JSON.parse(cached) : [];
    window.render();
    window.updateBookSelectDropdown();
    window.updateHeaderTitle();
    if (document.getElementById('bookManagerModal').classList.contains('show')) window.renderBookList();
    window.showToast("Berhasil beralih ke: " + (window.books.find(b => b.id === id)?.name || id));
    if (window.isOnline()) await window.pullFromCloudSilently();
};

window.openBookManager = function() {
    if (!window.requireOnline('mengelola buku')) return;
    window.openModal('bookManagerModal');
    window.renderBookList();
    window.refreshStorageEstimate();
};

window.renderBookList = function() {
    let container = document.getElementById('bookListContainer');
    container.innerHTML = '';
    window.books.forEach(b => {
        let div = document.createElement('div');
        div.className = 'book-list-item';
        let isCurrent = b.id === window.currentBookId;
        let delBtn = window.books.length > 1 ? `<button class="btn-mini btn-mini-danger" onclick="window.deleteBook('${b.id}')">Hapus</button>` : '';
        if (isCurrent) delBtn = '<span style="font-size:.65rem; color:#00875a; font-weight:bold;">✨ SEDANG AKTIF</span>';
        div.innerHTML = `
            <span class="book-list-name">${window.escapeHtml(b.name)}</span>
            <div class="book-list-actions">
                ${!isCurrent ? `<button class="btn-mini" onclick="window.switchBook('${b.id}')">Buka</button>` : ''}
                ${delBtn}
            </div>
        `;
        container.appendChild(div);
    });
};

window.addNewBook = async function(e) {
    e.preventDefault();
    if (!window.requireOnline('membuat buku baru')) return;
    let input = document.getElementById('newBookName');
    let name = input.value.trim();
    if (!name) return;
    let id = 'b_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newBook = { id, name };
    window.books.push(newBook);
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    input.value = '';
    await window.pushSettingBooks();
    await new Promise(r => setTimeout(r, 500));
    await window.pullAllSettings();
    window.renderBookList();
    window.updateBookSelectDropdown();
    window.showToast(`📚 Buku "${name}" berhasil dibuat dan tersinkron ke cloud`, 'success');
    await window.addCloudLog('SISTEM', `Membuat buku kas baru: "${name}" dengan ID ${id}`);
    const cfg = window.getTgConfig();
    if (cfg.active) window.sendTelegramNotif(`📚 <b>Buku Baru Dibuat</b>\n\nNama: ${name}\nID: ${id}\nDevice: ${window.deviceId}`);
};

window.deleteBook = async function(id) {
    if (!window.requireOnline('menghapus buku')) return;
    if (id === window.currentBookId) {
        alert('Tidak bisa menghapus buku kas yang sedang dibuka! Silakan pindah ke buku lain terlebih dahulu.');
        return;
    }
    let b = window.books.find(x => x.id === id);
    if (!b) { window.showToast('Buku sudah tidak ada (mungkin sudah dihapus device lain)', 'warning'); return; }
    const confirm1 = confirm(`⚠️ Hapus permanen buku "${b.name}"?\n\nData yang dihapus:\n- Semua transaksi dalam buku ini\n- Anggaran bulanan\n- Anggaran Dasar\n- Log aktivitas\n\nData TIDAK BISA dikembalikan!`);
    if (!confirm1) return;
    const confirm2 = prompt(`Ketik "HAPUS ${b.name}" untuk konfirmasi penghapusan buku ini:`);
    if (confirm2 !== `HAPUS ${b.name}`) { alert('Konfirmasi gagal. Penghapusan dibatalkan.'); return; }
    const cfg = window.getTgConfig();
    if (cfg.active) {
        window.sendTelegramNotif(`⚠️ <b>Penghapusan Buku</b>\n\nBuku <b>${b.name}</b> akan dihapus oleh device ${window.deviceId}\n\nData akan dihapus dalam 3 detik...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    if (window.isOnline()) {
        const prevBookId = window.currentBookId;
        window.currentBookId = id;
        try {
            await window.callSupabaseAPI('transactions', 'DELETE', null, `?book_id=eq.${id}`);
            await window.callSupabaseAPI('audit_logs', 'DELETE', null, `?book_id=eq.${id}`);
            await window.callSupabaseAPI('settings', 'DELETE', null, `?book_id=eq.${id}`);
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
    if (cfg.active) window.sendTelegramNotif(`✅ <b>Buku Dihapus</b>\n\nBuku <b>${b.name}</b> telah dihapus permanen.\nDevice: ${window.deviceId}`);
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
    el.innerHTML = '<div style="font-size:.7rem; color:#888; text-align:center; padding:8px 0;">⏳ Menghitung...</div>';
    if (btn) btn.disabled = true;
    const data = await window.estimateSupabaseStorage();
    if (btn) btn.disabled = false;
    if (!data) {
        el.innerHTML = '<div style="font-size:.7rem; color:#de350b; text-align:center; padding:8px 0;">⚠️ Tidak dapat memuat — pastikan koneksi Supabase aktif.</div>';
        return;
    }
    const { txCount, logCount, settCount, estimatedBytes } = data;
    const totalRows = txCount + logCount + settCount;
    const SUPABASE_FREE_DB_BYTES = 500 * 1024 * 1024;
    const dbBar   = window.renderStorageBar(estimatedBytes, SUPABASE_FREE_DB_BYTES, '🗄️ Database (estimasi)');
    const pctNum  = Math.min((estimatedBytes / SUPABASE_FREE_DB_BYTES) * 100, 100);
    const statusColor = pctNum >= 90 ? '#de350b' : pctNum >= 70 ? '#cc7b00' : '#006644';
    const statusText  = pctNum >= 90 ? '🚨 Hampir penuh! Pertimbangkan arsipkan data lama.' :
                        pctNum >= 70 ? '⚠️ Mendekati batas — pantau secara berkala.' :
                                       '✅ Kapasitas masih aman.';
    el.innerHTML = `
        ${dbBar}
        <div style="background:#f5f5f5; border-radius:8px; padding:10px 12px; font-size:.68rem; color:#444; line-height:1.8; margin-bottom:10px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 16px;">
                <span>📋 Transaksi</span><b>${txCount.toLocaleString('id-ID')} baris</b>
                <span>📜 Log Aktivitas</span><b>${logCount.toLocaleString('id-ID')} baris</b>
                <span>⚙️ Setelan</span><b>${settCount.toLocaleString('id-ID')} baris</b>
                <span>📊 Total Baris</span><b>${totalRows.toLocaleString('id-ID')} baris</b>
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
        const allRows = await window.callSupabaseAPI('settings', 'GET', null, '?key=eq.telegram_config&order=updated_at.desc&limit=1');
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
