// ==================== BACKUP & EXPORT ====================
window.openBackupManager = function() {
    window.openModal('backupModal');
    window.renderBackupList();
    window.loadCloudBackupList();
};
window.renderBackupList = function() {
    let info = document.getElementById('lastBackupInfo');
    let container = document.getElementById('backupListContainer');
    let lastLocal = localStorage.getItem('sk_last_auto_backup_' + window.currentBookId);
    let lastCloud = localStorage.getItem('sk_last_cloud_backup_' + window.currentBookId);
    let infoText = 'Lokal: ' + (lastLocal ? window.formatDateTime(lastLocal) : 'Belum ada');
    infoText += ' | Cloud: ' + (lastCloud ? window.formatDateTime(lastCloud) : 'Belum ada');
    info.innerText = infoText;
    let localBackups = JSON.parse(localStorage.getItem('sk_manual_backups_' + window.currentBookId) || '[]');
    container.innerHTML = '';
    if (localBackups.length === 0) { container.innerHTML = '<div style="color:#888; font-size:.7rem; text-align:center;">Tidak ada cadangan manual internal</div>'; return; }
    localBackups.forEach((b, i) => {
        let div = document.createElement('div');
        div.style = 'display:flex; justify-content:space-between; align-items:center; font-size:.7rem; padding:6px 0; border-bottom:1px solid #eee;';
        div.innerHTML = `
            <span>${window.escapeHtml(window.formatDateTime(b.timestamp))} (${window.escapeHtml(String(b.count))} Txs)</span>
            <div>
                <button class="btn-mini" onclick="window.restoreFromIndex(${i})">Restore</button>
                <button class="btn-mini btn-mini-danger" onclick="window.deleteBackupIndex(${i})">X</button>
            </div>
        `;
        container.appendChild(div);
    });
};
window.createBackup = function() {
    let localBackups = JSON.parse(localStorage.getItem('sk_manual_backups_' + window.currentBookId) || '[]');
    localBackups.unshift({ timestamp: new Date().toISOString(), count: window.txs.length, data: window.txs });
    if (localBackups.length > 5) localBackups.pop();
    localStorage.setItem('sk_manual_backups_' + window.currentBookId, JSON.stringify(localBackups));
    localStorage.setItem('sk_last_auto_backup_' + window.currentBookId, new Date().toISOString());
    window.renderBackupList();
    window.showToast("Snapshot cadangan berhasil dibuat");
};
window.restoreFromIndex = function(i) {
    if (!window.requireOnline('memulihkan data dari snapshot')) return;
    let localBackups = JSON.parse(localStorage.getItem('sk_manual_backups_' + window.currentBookId) || '[]');
    if (localBackups[i] && confirm("Pulihkan data dari snapshot cadangan ini? Data saat ini akan diganti.")) {
        window.txs = localBackups[i].data;
        window.saveTransactions();
        window.closeModal('backupModal');
        window.showToast("Data berhasil dipulihkan");
    }
};
window.deleteBackupIndex = function(i) {
    let localBackups = JSON.parse(localStorage.getItem('sk_manual_backups_' + window.currentBookId) || '[]');
    localBackups.splice(i, 1);
    localStorage.setItem('sk_manual_backups_' + window.currentBookId, JSON.stringify(localBackups));
    window.renderBackupList();
    window.showToast("Snapshot cadangan dihapus", "warning");
};
window.restoreFromBackup = function() {
    let backups = JSON.parse(localStorage.getItem('sk_manual_backups_' + window.currentBookId) || '[]');
    if (backups.length === 0) { alert('Tidak ditemukan snapshot cadangan. Buat backup manual terlebih dahulu.'); return; }
    window.openBackupManager();
    window.showToast('Pilih snapshot yang ingin di-restore dari daftar di bawah.');
};

// Cloud Backup
window.pushBackupToSupabaseForBook = async function(bookId, bookTxs, backupType) {
    const _pbTag = window.getAccountTag ? window.getAccountTag() : null;
    const payload = [{ book_id: bookId, device_id: window.deviceId, backup_type: backupType, tx_count: bookTxs.length, data: JSON.stringify(bookTxs), created_at: new Date().toISOString(), ...(_pbTag ? { account_tag: _pbTag } : {}) }];
    return await window.callSupabaseAPI('backups', 'POST', payload);
};
window.pushBackupToSupabase = async function(backupType) { return await window.pushBackupToSupabaseForBook(window.currentBookId, window.txs, backupType); };
window.createCloudBackup = async function() {
    if (!window.isOnline()) { window.showToast('Anda harus ONLINE untuk backup ke cloud!', 'warning'); return; }
    window.showToast('Menyimpan cadangan ke cloud...', 'info');
    let result = await window.pushBackupToSupabase('MANUAL');
    if (result) {
        let lastKey = 'sk_last_cloud_backup_' + window.currentBookId;
        localStorage.setItem(lastKey, new Date().toISOString());
        window.showToast('Cadangan cloud berhasil disimpan!', 'success');
        await window.addCloudLog('BACKUP', 'Backup manual cloud: ' + window.txs.length + ' transaksi');
        window.loadCloudBackupList();
    } else window.showToast('Gagal menyimpan cadangan ke cloud!', 'error');
};
window.checkAndRunDailyAutoBackup = async function() {
    if (!window.isOnline()) return;
    let now = new Date();
    let backedUpBooks = 0;
    for (const book of window.books) {
        let lastKey = 'sk_last_cloud_backup_' + book.id;
        let last = localStorage.getItem(lastKey);
        if (last) {
            let sameDay = new Date(last).toDateString() === now.toDateString();
            if (sameDay) continue;
        }
        const bookTxs = JSON.parse(localStorage.getItem('sk_txs_' + book.id) || '[]');
        let txsToBackup = bookTxs;
        if (bookTxs.length === 0 && window.isOnline()) {
            const cloudData = await window.callSupabaseAPI('transactions', 'GET', null, `?book_id=eq.${book.id}&is_deleted=eq.false&order=date.desc&limit=300`);
            if (cloudData && Array.isArray(cloudData)) {
                txsToBackup = cloudData.map(c => ({
                    id: c.id, type: c.type, amount: Number(c.amount),
                    category: c.category || '', description: c.description,
                    date: c.date, attachment: c.attachment, updated_at: c.updated_at || null
                }));
            }
        }
        const result = await window.pushBackupToSupabaseForBook(book.id, txsToBackup, 'AUTO');
        if (result) {
            localStorage.setItem(lastKey, now.toISOString());
            backedUpBooks++;
        }
    }
    if (backedUpBooks > 0) {
        await window.addCloudLog('BACKUP', 'Autobackup harian: ' + backedUpBooks + ' buku');
        window.renderBackupList();
    }
};
window.loadCloudBackupList = async function() {
    let container = document.getElementById('cloudBackupListContainer');
    if (!container) return;
    if (!window.isOnline()) { container.innerHTML = '<div style="color:#888; font-size:.7rem; text-align:center; padding:8px;">Online untuk melihat cadangan cloud</div>'; return; }
    try {
        const _blTag = window.getAccountTag ? window.getAccountTag() : null;
        const _blTagFilter = _blTag ? `&account_tag=eq.${_blTag}` : '';
        const backups = await window.callSupabaseAPI('backups', 'GET', null, `?book_id=eq.${window.currentBookId}&order=created_at.desc&limit=10${_blTagFilter}`);
        window.renderCloudBackupList(backups || []);
    } catch (e) { container.innerHTML = '<div style="color:#bf2600; font-size:.7rem; text-align:center; padding:8px;">Gagal memuat cadangan cloud</div>'; }
};
window.renderCloudBackupList = function(backups) {
    let container = document.getElementById('cloudBackupListContainer');
    if (!container) return;
    if (!backups || backups.length === 0) { container.innerHTML = '<div style="color:#888; font-size:.7rem; text-align:center; padding:8px;">Belum ada cadangan cloud</div>'; return; }
    container.innerHTML = '';
    backups.forEach((b) => {
        let typeBadge = b.backup_type === 'AUTO' ? '<span style="background:#e3fcef;color:#006644;padding:1px 6px;border-radius:8px;font-size:.6rem;font-weight:700;">AUTO</span>' : '<span style="background:#e8f0fe;color:#1a56db;padding:1px 6px;border-radius:8px;font-size:.6rem;font-weight:700;">MANUAL</span>';
        let div = document.createElement('div');
        div.style = 'display:flex; justify-content:space-between; align-items:center; font-size:.7rem; padding:7px 0; border-bottom:1px solid #eee;';
        div.innerHTML = `<span>${window.escapeHtml(window.formatDateTime(b.created_at))} ${typeBadge} (${window.escapeHtml(String(b.tx_count))} Txs)</span><button class="btn-mini" onclick="window.restoreFromCloudBackup('${b.id}')">Restore</button>`;
        container.appendChild(div);
    });
};
window.restoreFromCloudBackup = async function(backupId) {
    if (!window.isOnline()) { window.showToast('Anda harus ONLINE untuk restore dari cloud!', 'warning'); return; }
    if (!confirm('Pulihkan data dari cadangan cloud ini? Data saat ini akan diganti.')) return;
    try {
        const _brTag = window.getAccountTag ? window.getAccountTag() : null;
        const _brTagFilter = _brTag ? `&account_tag=eq.${_brTag}` : '';
        const rows = await window.callSupabaseAPI('backups', 'GET', null, `?id=eq.${backupId}&book_id=eq.${window.currentBookId}${_brTagFilter}`);
        if (!rows || rows.length === 0) { window.showToast('Data backup tidak ditemukan', 'error'); return; }
        window.txs = JSON.parse(rows[0].data);
        window.saveTransactions();
        window.closeModal('backupModal');
        window.showToast('Data berhasil dipulihkan dari cloud!', 'success');
        await window.addCloudLog('RESTORE', 'Restore dari cloud backup id: ' + backupId);
    } catch (e) { window.showToast('Gagal memulihkan data dari cloud', 'error'); }
};

// Export / Import
window.exportToCSV = function() {
    if (window.txs.length === 0) { alert('Tidak ada data untuk diekspor!'); return; }
    let csv = 'No,Tanggal,Kategori,Deskripsi,Pemasukan,Pengeluaran\n';
    window.txs.forEach((t, i) => {
        let inc = t.type === 'income' ? t.amount : 0;
        let exp = t.type === 'expense' ? t.amount : 0;
        let desc = (t.description || '').replace(/"/g, '""');
        csv += `${i + 1},"${t.date}","${t.category}","${desc}",${inc},${exp}\n`;
    });
    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    let a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Sinarkeu-Export-${window.currentBookId}.csv`;
    a.click();
};
window.exportToJSON = function() {
    if (window.txs.length === 0) { alert('Tidak ada data!'); return; }
    let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.txs, null, 2));
    let dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `Sinarkeu-Backup-${window.currentBookId}.json`);
    dlAnchorElem.click();
};
window.triggerJsonImport = function() { if (!window.requireOnline('mengimpor data')) return; document.getElementById('jsonFileInput').click(); };
window.handleJsonImport = function(e) {
    if (!window.requireOnline('mengimpor data')) return;
    let file = e.target.files[0];
    if (!file) return;
    let r = new FileReader();
    r.onload = function (evt) {
        try {
            let imported = JSON.parse(evt.target.result);
            if (Array.isArray(imported)) {
                const existingIds = new Set(window.txs.map(t => t.id));
                const newTxs = imported.filter(t => !existingIds.has(t.id));
                const duplicates = imported.length - newTxs.length;
                let message = `Impor ${imported.length} transaksi.`;
                if (duplicates > 0) message += `\n${duplicates} transaksi duplikat (ID sama) akan dilewati.`;
                message += `\n\n${newTxs.length} transaksi baru akan ditambahkan. Lanjutkan?`;
                if (confirm(message)) {
                    window.txs = [...window.txs, ...newTxs];
                    const uniqueTxs = [];
                    const seenIds = new Set();
                    for (const tx of window.txs) {
                        if (!seenIds.has(tx.id)) {
                            seenIds.add(tx.id);
                            uniqueTxs.push(tx);
                        }
                    }
                    window.txs = uniqueTxs;
                    window.saveTransactions();
                    window.showToast(`${newTxs.length} transaksi berhasil diimpor!`, 'success');
                    window.addCloudLog('IMPORT', `Import ${newTxs.length} transaksi dari JSON`);
                }
            } else alert('Format berkas JSON cadangan tidak valid!');
        } catch (err) { alert('Gagal membaca berkas JSON!'); }
    };
    r.readAsText(file);
};

// Archive & Clear
window.archiveAndClearData = async function() {
    if (!window.requireOnline('mengarsipkan data')) return;
    if (window.txs.length === 0) { alert('Tidak ada data transaksi untuk diarsipkan!'); return; }
    const st = document.getElementById('archiveStatus');
    const confirm1 = confirm(`PERINGATAN PENTING \n\nAnda akan mengarsipkan ${window.txs.length} transaksi ke file JSON, lalu menghapus SEMUA data buku ini dari Supabase dan lokal.\n\nTINDAKAN INI TIDAK DAPAT DIBATALKAN!\n\nKlik OK untuk melanjutkan ke konfirmasi kedua.`);
    if (!confirm1) return;
    const bookName = window.getCurrentBookName();
    const userInput = prompt(`Ketik nama buku "${bookName}" untuk konfirmasi penghapusan permanen:\n\n(pengetikan harus persis sama)`);
    if (userInput !== bookName) { alert('Nama buku tidak cocok. Penghapusan dibatalkan.'); return; }
    const confirm3 = confirm(`KONFIRMASI FINAL \n\nApakah Anda SANGAT YAKIN ingin menghapus SEMUA data buku "${bookName}" secara permanen?\n\nData yang dihapus TIDAK BISA dikembalikan!\n\nKlik OK untuk menghapus permanen.`);
    if (!confirm3) return;
    const cfg = window.getTgConfig();
    if (cfg.active) {
        window.sendTelegramNotif(`<b>PERINGATAN!</b>\n\nPengguna dari device <code>${window.deviceId}</code> akan menghapus SEMUA data buku <b>${bookName}</b>\n\nWaktu: ${new Date().toLocaleString('id-ID')}\n\nData akan dihapus dalam 5 detik...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    st.style.display = 'block';
    st.style.background = '#fff3e0';
    st.style.color = '#cc7b00';
    st.innerText = 'Mengekspor data ke JSON...';
    const fileName = `Sinarkeu-Arsip-${window.currentBookId}-${new Date().toISOString().slice(0, 10)}.json`;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.txs, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", fileName);
    a.click();
    await new Promise(r => setTimeout(r, 1000));
    st.innerText = 'Menghapus data dari Supabase...';
    if (window.isOnline()) {
        const tag_rb = window.getAccountTag ? window.getAccountTag() : null;
        const tagFilter_rb = tag_rb ? `&account_tag=eq.${tag_rb}` : '';
        await window.callSupabaseAPI('transactions', 'DELETE', null, `?book_id=eq.${window.currentBookId}${tagFilter_rb}`);
        await window.callSupabaseAPI('audit_logs', 'DELETE', null, `?book_id=eq.${window.currentBookId}${tagFilter_rb}`);
        // Hapus semua settings buku ini (termasuk budgets & default_budget)
        await window.callSupabaseAPI('settings', 'DELETE', null, `?book_id=eq.${window.currentBookId}${tagFilter_rb}`);
    }
    window.txs = [];
    localStorage.removeItem('sk_txs_' + window.currentBookId);
    localStorage.removeItem('sk_logs_' + window.currentBookId);
    localStorage.removeItem('sk_manual_backups_' + window.currentBookId);
    localStorage.removeItem('sk_last_auto_backup_' + window.currentBookId);
    localStorage.removeItem('sk_budgets_' + window.currentBookId);
    localStorage.removeItem('sk_default_budget_' + window.currentBookId);
    window.budgets = {};
    // Push anggaran kosong ke cloud agar tidak ter-restore saat sync berikutnya
    if (window.isOnline()) {
        await window.pushSetting('budgets', {}, window.currentBookId);
        await window.pushSetting('default_budget', {}, window.currentBookId);
    }
    window.render();
    st.style.background = '#e3fcef';
    st.style.color = '#006644';
    st.innerText = `Selesai! ${fileName} tersimpan & database telah dikosongkan. Backup final telah disimpan ke cloud.`;
    window.showToast('Database berhasil dikosongkan', 'success');
    if (cfg.active) window.sendTelegramNotif(`<b>EKSEKUSI SELESAI</b>\n\nData buku <b>${bookName}</b> telah dihapus permanen.\n\nArsip tersimpan di: ${fileName}\nDevice: ${window.deviceId}`);
    setTimeout(() => { st.style.display = 'none'; }, 5000);
};

// Google Sheets
window.saveGoogleSheetsUrl = function() {
    const url = document.getElementById('googleSheetsUrlInput').value.trim();
    const st  = document.getElementById('googleSheetsStatus');
    if (!url) {
        st.style.color = '#de350b';
        st.innerText = 'URL tidak boleh kosong!';
        return;
    }
    if (!url.startsWith('https://script.google.com/macros/')) {
        st.style.color = '#de350b';
        st.innerText = 'URL harus diawali https://script.google.com/macros/ ...';
        return;
    }
    localStorage.setItem('sk_google_sheets_url', url);
    st.style.color = '#00875a';
    st.innerText = 'URL Google Sheets Web App berhasil disimpan!';
    window.showToast('URL Google Sheets tersimpan', 'success');
    window.pushSetting('google_sheets_url', url, 'global');
};
window.loadGoogleSheetsUrl = async function() {
    const saved = localStorage.getItem('sk_google_sheets_url') || '';
    const input = document.getElementById('googleSheetsUrlInput');
    if (input) input.value = saved;
    const lastEl = document.getElementById('googleSheetsLastBackup');
    if (!lastEl) return;
    // Coba ambil timestamp dari Supabase agar sinkron antar device
    let lastTs = localStorage.getItem('sk_last_gsheets_backup_' + window.currentBookId);
    if (window.isOnline()) {
        try {
            const cloudTs = await window.pullSetting('last_gsheets_backup', window.currentBookId);
            if (cloudTs) {
                // Pakai mana yang lebih baru
                if (!lastTs || new Date(cloudTs) > new Date(lastTs)) {
                    lastTs = cloudTs;
                    localStorage.setItem('sk_last_gsheets_backup_' + window.currentBookId, lastTs);
                }
            }
        } catch (e) { /* fallback ke localStorage */ }
    }
    if (lastTs) {
        lastEl.innerText = 'Backup terakhir: ' + new Date(lastTs).toLocaleString('id-ID');
    } else {
        lastEl.innerText = 'Belum pernah backup ke Google Sheets.';
    }
};
window.backupToGoogleSheets = async function() {
    const url = (document.getElementById('googleSheetsUrlInput')?.value.trim()) ||
                localStorage.getItem('sk_google_sheets_url') || '';
    if (!url) {
        window.showToast('Belum ada URL Web App. Simpan dulu di Setelan!', 'warning');
        return;
    }
    if (!url.startsWith('https://script.google.com/macros/')) {
        window.showToast('URL tidak valid. Harus diawali https://script.google.com/macros/', 'error');
        return;
    }
    if (window.txs.length === 0) {
        window.showToast('Tidak ada transaksi untuk di-backup', 'warning');
        return;
    }
    const st = document.getElementById('googleSheetsStatus');
    const setStatus = (color, msg) => {
        if (st) { st.style.color = color; st.innerText = msg; }
    };
    setStatus('#cc7b00', 'Mengirim data ke Google Sheets...');
    const payload = {
        book: window.currentBookId,
        exported_at: new Date().toISOString(),
        rows: window.txs.map(t => ({
            id: t.id,
            date: t.date,
            type: t.type,
            category: t.category || '',
            description: t.description,
            amount: Number(t.amount) || 0,
            attachment: t.attachment ? 'Ada' : ''
        }))
    };
    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
        const nowIso = new Date().toISOString();
        const now = new Date().toLocaleString('id-ID');
        setStatus('#00875a', 'Data terkirim ke Google Sheets! (' + now + ')');
        localStorage.setItem('sk_last_gsheets_backup_' + window.currentBookId, nowIso);
        const lastEl = document.getElementById('googleSheetsLastBackup');
        if (lastEl) lastEl.innerText = 'Backup terakhir: ' + now;
        window.showToast('Backup ke Google Sheets sukses!', 'success');
        // Simpan timestamp ke Supabase agar sinkron di semua device
        if (window.isOnline()) {
            await window.pushSetting('last_gsheets_backup', nowIso, window.currentBookId);
        }
        await window.addCloudLog('BACKUP', 'Backup ke Google Sheets: ' + window.txs.length + ' transaksi');
    } catch (e) {
        setStatus('#de350b', 'Gagal: ' + e.message + ' — Periksa koneksi internet dan URL Web App.');
        window.showToast('Gagal backup ke Google Sheets', 'error');
        console.error('[BackupGSheets]', e);
    }
};

// ==================== RESET APLIKASI TOTAL ====================
// Menghapus SEMUA buku, transaksi, settings di Supabase DAN localStorage
// Aplikasi kembali ke kondisi fresh install (kosong)
// ── Helper: kumpulkan semua data lokal semua buku jadi satu objek ekspor ──
window._collectAllDataForExport = function() {
    const books = JSON.parse(localStorage.getItem('sk_books') || '[]');
    const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: localStorage.getItem('sk_device_id') || 'unknown',
        appVersion: 'sinarkeu',
        books: [],
    };
    books.forEach(book => {
        const txs      = JSON.parse(localStorage.getItem('sk_txs_'             + book.id) || '[]');
        const budgets  = JSON.parse(localStorage.getItem('sk_budgets_'         + book.id) || '{}');
        const defBudget= JSON.parse(localStorage.getItem('sk_default_budget_'  + book.id) || '{}');
        const annBudget= JSON.parse(localStorage.getItem('sk_annual_budget_'   + book.id) || '{}');
        const reminders= JSON.parse(localStorage.getItem('sk_payment_reminders_' + book.id) || '[]');
        const logs     = JSON.parse(localStorage.getItem('sk_logs_'            + book.id) || '[]');
        exportData.books.push({
            id: book.id, name: book.name,
            transactions: txs,
            budgets, defaultBudget: defBudget, annualBudget: annBudget,
            paymentReminders: reminders,
            auditLogs: logs,
        });
    });
    return exportData;
};

// ── Helper: trigger download file JSON ──
window._downloadJSON = function(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
};

window.resetAllApplication = async function() {
    // Konfirmasi 1 — tawarkan opsi export sebelum reset
    const wantExport = confirm(
        'EKSPOR DATA SEBELUM RESET?\n\n' +
        'Sebelum menghapus semua data, apakah Anda ingin\n' +
        'mengunduh backup JSON semua buku terlebih dahulu?\n\n' +
        'Klik OK  → ekspor dulu, lalu lanjut ke reset\n' +
        'Klik Batal → lanjut reset TANPA ekspor'
    );

    if (wantExport) {
        const st = document.getElementById('resetAppStatus');
        if (st) { st.style.display='block'; st.style.color='#cc7b00'; st.style.background='#fff3e0'; st.innerText='Menyiapkan file ekspor...'; }
        try {
            const exportData = window._collectAllDataForExport();
            const totalTx = exportData.books.reduce((s, b) => s + b.transactions.length, 0);
            const fileName = `Sinarkeu-Backup-Sebelum-Reset-${new Date().toISOString().slice(0,10)}.json`;
            window._downloadJSON(exportData, fileName);
            await new Promise(r => setTimeout(r, 1200)); // beri jeda agar browser mulai download
            if (st) { st.innerText = `File "${fileName}" sedang diunduh (${totalTx} transaksi dari ${exportData.books.length} buku). Lanjutkan reset di bawah...`; }
            await new Promise(r => setTimeout(r, 800));
        } catch (e) {
            if (st) { st.innerText = ''; st.style.display = 'none'; }
            alert('Gagal mengekspor data: ' + e.message + '\nReset dibatalkan untuk keamanan.');
            return;
        }
    }

    // Konfirmasi 2 — peringatan hapus
    const confirm1 = confirm(
        'RESET TOTAL APLIKASI \n\n' +
        'Tindakan ini akan menghapus SEMUA data secara permanen:\n' +
        '• Semua buku keuangan\n' +
        '• Semua transaksi\n' +
        '• Semua anggaran & setelan\n' +
        '• Data Supabase (cloud)\n' +
        '• Data lokal (localStorage)\n\n' +
        (wantExport ? 'Backup sudah diunduh.\n\n' : '') +
        'TIDAK DAPAT DIBATALKAN!\n\n' +
        'Klik OK untuk lanjut ke konfirmasi berikutnya.'
    );
    if (!confirm1) return;

    // Konfirmasi 3 — ketik kata kunci
    const userInput = prompt('Ketik kata "RESET" (huruf kapital semua) untuk mengonfirmasi penghapusan total:');
    if (userInput !== 'RESET') {
        alert('Konfirmasi tidak cocok. Reset dibatalkan.');
        return;
    }

    // Konfirmasi 4 — final
    const confirm3 = confirm(
        'KONFIRMASI FINAL \n\n' +
        'Anda BENAR-BENAR yakin ingin mereset aplikasi?\n\n' +
        'Seluruh data akan TERHAPUS PERMANEN.\n' +
        'Klik OK untuk eksekusi reset.'
    );
    if (!confirm3) return;

    // Tampilkan status
    const st = document.getElementById('resetAppStatus');
    const show = (color, bg, msg) => {
        if (!st) return;
        st.style.display = 'block';
        st.style.color = color;
        st.style.background = bg;
        st.innerText = msg;
    };
    show('#cc7b00', '#fff3e0', 'Memulai reset...');

    try {
        // ── Hapus Supabase (semua tabel, tanpa filter book_id) ──
        if (window.isOnline() && window.getCloudUrl() && window.getSupabaseKey()) {
            const tag_fr = window.getAccountTag ? window.getAccountTag() : null;
            const tagFilter_fr = tag_fr ? `&account_tag=eq.${tag_fr}` : '';

            show('#cc7b00', '#fff3e0', 'Menghapus transaksi dari Supabase...');
            await window.callSupabaseAPI('transactions', 'DELETE', null, `?id=neq.00000000-0000-0000-0000-000000000000${tagFilter_fr}`);

            show('#cc7b00', '#fff3e0', 'Menghapus log audit dari Supabase...');
            await window.callSupabaseAPI('audit_logs', 'DELETE', null, `?id=neq.00000000-0000-0000-0000-000000000000${tagFilter_fr}`);

            show('#cc7b00', '#fff3e0', 'Menghapus settings dari Supabase...');
            await window.callSupabaseAPI('settings', 'DELETE', null, `?key=neq.__placeholder__${tagFilter_fr}`);

            show('#cc7b00', '#fff3e0', 'Menghapus pengingat pembayaran dari Supabase...');
            await window.callSupabaseAPI('payment_reminders', 'DELETE', null, `?id=neq.00000000-0000-0000-0000-000000000000${tagFilter_fr}`);

            show('#cc7b00', '#fff3e0', 'Menghapus cadangan cloud dari Supabase...');
            await window.callSupabaseAPI('backups', 'DELETE', null, `?id=neq.00000000-0000-0000-0000-000000000000${tagFilter_fr}`);
        } else {
            show('#cc7b00', '#fff8e1', 'Offline — Supabase tidak dibersihkan, hanya localStorage yang direset.');
            await new Promise(r => setTimeout(r, 1500));
        }

        // ── Hapus SEMUA localStorage dengan prefix sk_ ──
        show('#cc7b00', '#fff3e0', 'Menghapus data lokal...');
        const keysToDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('sk_')) keysToDelete.push(k);
        }
        keysToDelete.forEach(k => localStorage.removeItem(k));

        // ── Reset state in-memory ──
        window.txs = [];
        window.books = [];
        window.currentBookId = null;
        window.budgets = {};

        show('#006644', '#e3fcef', 'Reset selesai! Aplikasi akan dimuat ulang...');
        window.showToast('Aplikasi berhasil direset', 'success');

        // Reload setelah jeda singkat agar pesan terbaca
        setTimeout(() => { location.reload(); }, 2000);

    } catch (e) {
        console.error('[ResetApp]', e);
        show('#de350b', '#fff5f5', 'Gagal: ' + e.message + '\n\nCoba hapus manual via Supabase dashboard.');
        window.showToast('Reset gagal: ' + e.message, 'error');
    }
};

// ── Export semua data tanpa reset (tombol biru di panel Reset) ──
window.exportAllDataOnly = async function() {
    const st = document.getElementById('resetAppStatus');
    const show = (color, bg, msg) => {
        if (!st) return;
        st.style.display = 'block';
        st.style.color = color;
        st.style.background = bg;
        st.innerText = msg;
    };
    try {
        show('#cc7b00', '#fff3e0', 'Menyiapkan ekspor...');
        const exportData = window._collectAllDataForExport();
        const totalTx = exportData.books.reduce((s, b) => s + b.transactions.length, 0);
        const fileName = `Sinarkeu-Export-${new Date().toISOString().slice(0, 10)}.json`;
        window._downloadJSON(exportData, fileName);
        show('#006644', '#e3fcef', `"${fileName}" sedang diunduh — ${totalTx} transaksi dari ${exportData.books.length} buku.`);
        window.showToast('Ekspor berhasil', 'success');
        setTimeout(() => { if (st) st.style.display = 'none'; }, 5000);
    } catch (e) {
        show('#de350b', '#fff5f5', 'Gagal ekspor: ' + e.message);
    }
};

// ==================== IMPORT DATA DARI FILE JSON ====================
window.importAllDataFromFile = async function(input) {
    const file = input.files[0];
    if (!file) return;
    // Reset input agar file yang sama bisa dipilih lagi nanti
    input.value = '';

    const st = document.getElementById('importStatus');
    const show = (color, bg, msg) => {
        if (!st) return;
        st.style.display = 'block';
        st.style.color = color;
        st.style.background = bg;
        st.innerText = msg;
    };

    // ── Baca & validasi file ──
    let importData;
    try {
        show('#cc7b00', '#fff3e0', 'Membaca file...');
        const text = await file.text();
        importData = JSON.parse(text);
    } catch (e) {
        show('#de350b', '#fff5f5', 'File tidak valid atau bukan JSON: ' + e.message);
        return;
    }

    // Validasi struktur minimal
    if (!importData.books || !Array.isArray(importData.books)) {
        show('#de350b', '#fff5f5', 'Format file tidak dikenali. Pastikan file berasal dari fitur Ekspor Sinarkeu.');
        return;
    }

    const totalBuku = importData.books.length;
    const totalTx   = importData.books.reduce((s, b) => s + (b.transactions?.length || 0), 0);

    // ── Konfirmasi user ──
    const ok = confirm(
        `IMPORT DATA\n\n` +
        `File: ${file.name}\n` +
        `Diekspor: ${importData.exportedAt ? new Date(importData.exportedAt).toLocaleString('id-ID') : 'tidak diketahui'}\n\n` +
        `Berisi:\n` +
        `• ${totalBuku} buku keuangan\n` +
        `• ${totalTx} transaksi\n\n` +
        `Data yang sudah ada di aplikasi TIDAK akan dihapus.\n` +
        `Buku baru akan ditambahkan, buku yang sama (ID sama) akan digabung.\n\n` +
        `Lanjutkan import?`
    );
    if (!ok) {
        if (st) st.style.display = 'none';
        return;
    }

    show('#cc7b00', '#fff3e0', 'Memulai import...');

    let importedBooks = 0, importedTx = 0, skippedTx = 0, errors = [];

    try {
        // ── Ambil daftar buku yang sudah ada ──
        let currentBooks = JSON.parse(localStorage.getItem('sk_books') || '[]');

        for (const bookData of importData.books) {
            if (!bookData.id || !bookData.name) { errors.push(`Buku tanpa ID/nama dilewati.`); continue; }

            show('#cc7b00', '#fff3e0', `Mengimpor buku "${bookData.name}"...`);

            // ── Tambahkan buku jika belum ada ──
            const bookExists = currentBooks.find(b => b.id === bookData.id);
            if (!bookExists) {
                currentBooks.push({ id: bookData.id, name: bookData.name });
            }

            // ── Transaksi: merge dengan yang sudah ada (skip duplikat by id) ──
            const existingTxsRaw = localStorage.getItem('sk_txs_' + bookData.id);
            const existingTxs    = existingTxsRaw ? JSON.parse(existingTxsRaw) : [];
            const existingIds    = new Set(existingTxs.map(t => t.id));

            const newTxs = (bookData.transactions || []).filter(t => {
                if (!t.id) { skippedTx++; return false; }
                if (existingIds.has(t.id)) { skippedTx++; return false; }
                return true;
            });

            const mergedTxs = [...existingTxs, ...newTxs]
                .sort((a, b) => new Date(b.date) - new Date(a.date));

            window.trimAndSaveLocal(bookData.id, mergedTxs);
            importedTx += newTxs.length;

            // ── Anggaran: hanya tulis jika lokal kosong (jangan timpa data ada) ──
            if (bookData.budgets && Object.keys(bookData.budgets).length > 0) {
                const localBudget = localStorage.getItem('sk_budgets_' + bookData.id);
                if (!localBudget || localBudget === '{}') {
                    localStorage.setItem('sk_budgets_' + bookData.id, JSON.stringify(bookData.budgets));
                }
            }
            if (bookData.defaultBudget && Object.keys(bookData.defaultBudget).length > 0) {
                const localDef = localStorage.getItem('sk_default_budget_' + bookData.id);
                if (!localDef || localDef === '{}') {
                    window.saveDefaultBudgetToLocal(bookData.id, bookData.defaultBudget);
                }
            }
            if (bookData.annualBudget && Object.keys(bookData.annualBudget).length > 0) {
                const localAnn = localStorage.getItem('sk_annual_budget_' + bookData.id);
                if (!localAnn || localAnn === '{}') {
                    window.saveAnnualBudgetToLocal(bookData.id, bookData.annualBudget);
                }
            }

            // ── Payment reminders: merge by id ──
            if (Array.isArray(bookData.paymentReminders) && bookData.paymentReminders.length > 0) {
                const existingRem    = JSON.parse(localStorage.getItem('sk_payment_reminders_' + bookData.id) || '[]');
                const existingRemIds = new Set(existingRem.map(r => r.id));
                const newRem         = bookData.paymentReminders.filter(r => r.id && !existingRemIds.has(r.id));
                if (newRem.length > 0) {
                    localStorage.setItem('sk_payment_reminders_' + bookData.id, JSON.stringify([...existingRem, ...newRem]));
                }
            }

            // ── Push transaksi baru ke Supabase ──
            if (newTxs.length > 0 && window.isOnline() && window.getCloudUrl() && window.getSupabaseKey()) {
                show('#cc7b00', '#fff3e0', `Upload ${newTxs.length} transaksi buku "${bookData.name}" ke Supabase...`);
                const payload = newTxs.map(t => ({
                    id: t.id,
                    book_id: bookData.id,
                    device_id: window.deviceId,
                    type: t.type,
                    amount: parseFloat(t.amount) || 0,
                    category: t.category || '',
                    description: t.description || '',
                    date: t.date,
                    attachment: t.attachment || null,
                    updated_at: t.updated_at || new Date().toISOString(),
                    is_deleted: false,
                }));
                // Upload per-batch 50 agar tidak melebihi limit payload
                for (let i = 0; i < payload.length; i += 50) {
                    await window.callSupabaseAPI('transactions', 'POST', payload.slice(i, i + 50));
                }
            }

            // ── Push anggaran ke Supabase ──
            if (window.isOnline() && window._sessionCryptoKey) {
                await window.pushSetting('budgets', bookData.budgets || {}, bookData.id);
                await window.pushSetting('default_budget', bookData.defaultBudget || {}, bookData.id);
                if (bookData.annualBudget) await window.pushSetting('annual_budget', bookData.annualBudget, bookData.id);
            }

            importedBooks++;
        }

        // ── Simpan daftar buku yang sudah digabung ──
        localStorage.setItem('sk_books', JSON.stringify(currentBooks));
        window.books = currentBooks;

        // ── Perbarui UI ──
        window.updateBookSelectDropdown();
        if (window.books.find(b => b.id === window.currentBookId)) {
            window.loadTransactions();
        }
        if (window.isOnline() && window._sessionCryptoKey) {
            await window.pushSettingBooks();
        }

        // ── Ringkasan ──
        const warningLine = errors.length > 0 ? `\n${errors.length} item dilewati: ${errors[0]}` : '';
        show('#006644', '#e3fcef',
            `Import selesai!\n` +
            `${importedBooks} buku, ${importedTx} transaksi baru ditambahkan` +
            (skippedTx > 0 ? `, ${skippedTx} duplikat dilewati` : '') +
            warningLine
        );
        window.showToast(`Import selesai — ${importedTx} transaksi ditambahkan`, 'success');

    } catch (e) {
        console.error('[Import]', e);
        show('#de350b', '#fff5f5', 'Import gagal: ' + e.message);
        window.showToast('Import gagal: ' + e.message, 'error');
    }
};
