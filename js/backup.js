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
            <span>📦 ${window.escapeHtml(window.formatDateTime(b.timestamp))} (${window.escapeHtml(String(b.count))} Txs)</span>
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
    const payload = [{ book_id: bookId, device_id: window.deviceId, backup_type: backupType, tx_count: bookTxs.length, data: JSON.stringify(bookTxs), created_at: new Date().toISOString() }];
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
        window.showToast('☁️ Cadangan cloud berhasil disimpan!', 'success');
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
            const cloudData = await window.callSupabaseAPI('transactions', 'GET', null, `?book_id=eq.${book.id}&order=date.desc&limit=300`);
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
        const backups = await window.callSupabaseAPI('backups', 'GET', null, `?book_id=eq.${window.currentBookId}&order=created_at.desc&limit=10`);
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
        div.innerHTML = `<span>☁️ ${window.escapeHtml(window.formatDateTime(b.created_at))} ${typeBadge} (${window.escapeHtml(String(b.tx_count))} Txs)</span><button class="btn-mini" onclick="window.restoreFromCloudBackup('${b.id}')">Restore</button>`;
        container.appendChild(div);
    });
};
window.restoreFromCloudBackup = async function(backupId) {
    if (!window.isOnline()) { window.showToast('Anda harus ONLINE untuk restore dari cloud!', 'warning'); return; }
    if (!confirm('Pulihkan data dari cadangan cloud ini? Data saat ini akan diganti.')) return;
    try {
        const rows = await window.callSupabaseAPI('backups', 'GET', null, `?id=eq.${backupId}&book_id=eq.${window.currentBookId}`);
        if (!rows || rows.length === 0) { window.showToast('Data backup tidak ditemukan', 'error'); return; }
        window.txs = JSON.parse(rows[0].data);
        window.saveTransactions();
        window.closeModal('backupModal');
        window.showToast('✅ Data berhasil dipulihkan dari cloud!', 'success');
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
                if (duplicates > 0) message += `\n⚠️ ${duplicates} transaksi duplikat (ID sama) akan dilewati.`;
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
                    window.showToast(`✅ ${newTxs.length} transaksi berhasil diimpor!`, 'success');
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
    const confirm1 = confirm(`⚠️ PERINGATAN PENTING ⚠️\n\nAnda akan mengarsipkan ${window.txs.length} transaksi ke file JSON, lalu menghapus SEMUA data buku ini dari Supabase dan lokal.\n\n⚠️ TINDAKAN INI TIDAK DAPAT DIBATALKAN!\n\nKlik OK untuk melanjutkan ke konfirmasi kedua.`);
    if (!confirm1) return;
    const bookName = window.getCurrentBookName();
    const userInput = prompt(`Ketik nama buku "${bookName}" untuk konfirmasi penghapusan permanen:\n\n(pengetikan harus persis sama)`);
    if (userInput !== bookName) { alert('Nama buku tidak cocok. Penghapusan dibatalkan.'); return; }
    const confirm3 = confirm(`💀 KONFIRMASI FINAL 💀\n\nApakah Anda SANGAT YAKIN ingin menghapus SEMUA data buku "${bookName}" secara permanen?\n\nData yang dihapus TIDAK BISA dikembalikan!\n\nKlik OK untuk menghapus permanen.`);
    if (!confirm3) return;
    const cfg = window.getTgConfig();
    if (cfg.active) {
        window.sendTelegramNotif(`⚠️ <b>PERINGATAN!</b>\n\nPengguna dari device <code>${window.deviceId}</code> akan menghapus SEMUA data buku <b>${bookName}</b>\n\nWaktu: ${new Date().toLocaleString('id-ID')}\n\nData akan dihapus dalam 5 detik...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    st.style.display = 'block';
    st.style.background = '#fff3e0';
    st.style.color = '#cc7b00';
    st.innerText = '⏳ Mengekspor data ke JSON...';
    const fileName = `Sinarkeu-Arsip-${window.currentBookId}-${new Date().toISOString().slice(0, 10)}.json`;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window.txs, null, 2));
    const a = document.createElement('a');
    a.setAttribute("href", dataStr);
    a.setAttribute("download", fileName);
    a.click();
    await new Promise(r => setTimeout(r, 1000));
    st.innerText = '⏳ Menghapus data dari Supabase...';
    if (window.isOnline()) {
        await window.callSupabaseAPI('transactions', 'DELETE', null, `?book_id=eq.${window.currentBookId}`);
        await window.callSupabaseAPI('audit_logs', 'DELETE', null, `?book_id=eq.${window.currentBookId}`);
        // Hapus semua settings buku ini (termasuk budgets & default_budget)
        await window.callSupabaseAPI('settings', 'DELETE', null, `?book_id=eq.${window.currentBookId}`);
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
    st.innerText = `✅ Selesai! ${fileName} tersimpan & database telah dikosongkan. Backup final telah disimpan ke cloud.`;
    window.showToast('Database berhasil dikosongkan', 'success');
    if (cfg.active) window.sendTelegramNotif(`✅ <b>EKSEKUSI SELESAI</b>\n\nData buku <b>${bookName}</b> telah dihapus permanen.\n\nArsip tersimpan di: ${fileName}\nDevice: ${window.deviceId}`);
    setTimeout(() => { st.style.display = 'none'; }, 5000);
};

// Google Sheets
window.saveGoogleSheetsUrl = function() {
    const url = document.getElementById('googleSheetsUrlInput').value.trim();
    const st  = document.getElementById('googleSheetsStatus');
    if (!url) {
        st.style.color = '#de350b';
        st.innerText = '❌ URL tidak boleh kosong!';
        return;
    }
    if (!url.startsWith('https://script.google.com/macros/')) {
        st.style.color = '#de350b';
        st.innerText = '❌ URL harus diawali https://script.google.com/macros/ ...';
        return;
    }
    localStorage.setItem('sk_google_sheets_url', url);
    st.style.color = '#00875a';
    st.innerText = '✅ URL Google Sheets Web App berhasil disimpan!';
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
        window.showToast('⚠️ Belum ada URL Web App. Simpan dulu di Setelan!', 'warning');
        return;
    }
    if (!url.startsWith('https://script.google.com/macros/')) {
        window.showToast('❌ URL tidak valid. Harus diawali https://script.google.com/macros/', 'error');
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
    setStatus('#cc7b00', '⏳ Mengirim data ke Google Sheets...');
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
        setStatus('#00875a', '✅ Data terkirim ke Google Sheets! (' + now + ')');
        localStorage.setItem('sk_last_gsheets_backup_' + window.currentBookId, nowIso);
        const lastEl = document.getElementById('googleSheetsLastBackup');
        if (lastEl) lastEl.innerText = 'Backup terakhir: ' + now;
        window.showToast('✅ Backup ke Google Sheets sukses!', 'success');
        // Simpan timestamp ke Supabase agar sinkron di semua device
        if (window.isOnline()) {
            await window.pushSetting('last_gsheets_backup', nowIso, window.currentBookId);
        }
        await window.addCloudLog('BACKUP', 'Backup ke Google Sheets: ' + window.txs.length + ' transaksi');
    } catch (e) {
        setStatus('#de350b', '❌ Gagal: ' + e.message + ' — Periksa koneksi internet dan URL Web App.');
        window.showToast('❌ Gagal backup ke Google Sheets', 'error');
        console.error('[BackupGSheets]', e);
    }
};
