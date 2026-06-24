// ==================== TRANSACTIONS ====================

// Parser tanggal "aman timezone": angka jam/menit di string SELALU dibaca
// sebagai angka jam/menit lokal apa adanya, berapa pun suffix timezone-nya
// (tanpa suffix, "Z", atau "+00:00" dari Supabase). Ini mencegah bug
// "tanggal mundur/maju" akibat double timezone conversion saat data
// ditarik ulang dari cloud. Pakai fungsi ini setiap kali butuh objek Date
// dari field date transaksi (sorting, perbandingan, format tampilan),
// JANGAN pakai new Date(t.date) langsung.
window.parseTxDate = function(str) {
    if (!str) return new Date(NaN);
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return new Date(str);
    const [, y, mo, d, h, mi, s] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0));
};

window.trimAndSaveLocal = function(bookId, data) {
    const sorted = [...data].sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date));
    const trimmed = sorted.slice(0, 300);
    localStorage.setItem('sk_txs_' + bookId, JSON.stringify(trimmed));
    const remainder = sorted.slice(300);
    let balanceOffset = 0;
    remainder.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') balanceOffset += amt;
        else balanceOffset -= amt;
    });
    localStorage.setItem('sk_balance_offset_' + bookId, String(balanceOffset));
    return trimmed;
};

window.pullFromCloudSilently = async function() {
    if (!window.isOnline()) return;
    const lastSync = window._lastFullSyncTime[window.currentBookId];
    let query = `?book_id=eq.${window.currentBookId}&order=date.desc&limit=300`;
    if (lastSync) {
        query = `?book_id=eq.${window.currentBookId}&order=updated_at.desc&updated_at=gt.${lastSync}&limit=300`;
    }
    let cloudData = await window.callSupabaseAPI('transactions', 'GET', null, query);
    if (cloudData && Array.isArray(cloudData)) {
        if (lastSync && cloudData.length > 0) {
            const localMap = {};
            window.txs.forEach(t => { localMap[t.id] = t; });
            cloudData.forEach(c => {
                const cloudUpdated = c.updated_at || '1970-01-01T00:00:00.000Z';
                const local = localMap[c.id];
                const localUpdated = local ? (local.updated_at || '1970-01-01T00:00:00.000Z') : '1970-01-01T00:00:00.000Z';
                if (!local || cloudUpdated >= localUpdated) {
                    localMap[c.id] = {
                        id: c.id, type: c.type, amount: Number(c.amount),
                        category: c.category || (c.type === 'income' ? 'Pemasukan' : ''),
                        description: c.description, date: c.date,
                        attachment: c.attachment, updated_at: c.updated_at || null
                    };
                }
            });
            window.txs = Object.values(localMap).sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date));
        } else if (!lastSync) {
            window.txs = cloudData.map(c => ({
                id: c.id, type: c.type, amount: Number(c.amount),
                category: c.category || (c.type === 'income' ? 'Pemasukan' : ''),
                description: c.description, date: c.date,
                attachment: c.attachment, updated_at: c.updated_at || null
            }));
        }
        window.trimAndSaveLocal(window.currentBookId, window.txs);
        window._lastFullSyncTime[window.currentBookId] = new Date().toISOString();
        window.render();
        window._lastSyncTime = new Date();
        window.updateSyncTimeBadge();
    }
};

window.pullAllBooksFromCloud = async function() {
    if (!window.isOnline()) return;
    const bookIds = window.books.map(b => b.id);
    if (bookIds.length === 0) return;
    for (const bookId of bookIds) {
        let cloudData = await window.callSupabaseAPI('transactions', 'GET', null,
            `?book_id=eq.${bookId}&order=date.desc&limit=300`);
        if (!cloudData || !Array.isArray(cloudData)) continue;
        const cloudMapped = cloudData.map(c => ({
            id: c.id, type: c.type, amount: Number(c.amount),
            category: c.category || (c.type === 'income' ? 'Pemasukan' : ''),
            description: c.description, date: c.date,
            attachment: c.attachment, updated_at: c.updated_at || null
        }));
        const trimmed = window.trimAndSaveLocal(bookId, cloudMapped);
        window._lastFullSyncTime[bookId] = new Date().toISOString();
        if (bookId === window.currentBookId) {
            window.txs = trimmed;
            window.render();
        }
    }
    window._lastSyncTime = new Date();
    window.updateSyncTimeBadge();
    console.log('[Sync] Selesai pull semua buku —', bookIds.length, 'buku diproses');
};

window.forceFullSync = async function() {
    if (!window.requireOnline('sinkronisasi')) return;
    try {
        await window.pullAllSettings();
        await window.pullAllBooksFromCloud();
        window.updateBookSelectDropdown();
        window.updateTgStatusBadge();
        window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
        // Catatan: window.renderBudget() tidak dipanggil di sini karena pullAllSettings()
        // sudah memanggil renderBudget() sendiri jika ada perubahan budget dari cloud.
        await window.addCloudLog('SISTEM', 'Sinkronisasi penuh manual dari perangkat ' + window.deviceId);
    } catch (e) {
        console.error('[Sync] Gagal sinkronisasi:', e);
        window.showToast('❌ Gagal sinkronisasi, coba lagi nanti', 'error');
    }
};

window.pushToCloud = async function() {
    if (!window.isOnline()) return;
    const payload = window.txs.map(t => ({
        id: t.id,
        book_id: window.currentBookId,
        device_id: window.deviceId,
        type: t.type,
        amount: parseFloat(t.amount) || 0,
        category: t.category || '',
        description: t.description || '',
        date: t.date,
        attachment: t.attachment || null,
        updated_at: t.updated_at || new Date().toISOString()
    }));
    if (payload.length === 0) return;
    let res = await window.callSupabaseAPI('transactions', 'POST', payload);
    if (res && Array.isArray(res)) {
        console.log(`Sinkronisasi ${res.length} transaksi ke Supabase Cloud berhasil.`);
        window._lastSyncTime = new Date();
        window.updateSyncTimeBadge();
    }
};

window.debouncedPushToCloud = function() {
    if (window._pushDebounceTimer) clearTimeout(window._pushDebounceTimer);
    window._pushDebounceTimer = setTimeout(() => { window.pushToCloud(); }, 1500);
};

window.addCloudLog = async function(actionType, detailsText) {
    let localLogs = JSON.parse(localStorage.getItem('sk_logs_' + window.currentBookId) || '[]');
    let logObj = { timestamp: new Date().toISOString(), device_id: window.deviceId, action: actionType, details: detailsText };
    localLogs.unshift(logObj);
    if (localLogs.length > 50) localLogs.pop();
    localStorage.setItem('sk_logs_' + window.currentBookId, JSON.stringify(localLogs));
    window.renderLogs(localLogs);
    if (!window.isOnline()) return;
    const logPayload = [{
        book_id: window.currentBookId,
        device_id: window.deviceId,
        action: actionType,
        details: detailsText,
        timestamp: new Date().toISOString()
    }];
    await window.callSupabaseAPI('audit_logs', 'POST', logPayload);
};

window.refreshLogsFromCloud = async function() {
    let area = document.getElementById('logSummaryArea');
    if (!window.isOnline()) { window.refreshLogsLocal(); return; }
    area.innerText = "Memuat log dari cloud...";
    let cloudLogs = await window.callSupabaseAPI('audit_logs', 'GET', null, `?book_id=eq.${window.currentBookId}&order=timestamp.desc&limit=30`);
    if (cloudLogs && Array.isArray(cloudLogs)) {
        window.renderLogs(cloudLogs);
    } else {
        area.innerText = "Gagal memuat log dari cloud, menampilkan log lokal jika ada.";
        window.refreshLogsLocal();
    }
};
window.refreshLogsLocal = function() {
    let localLogs = JSON.parse(localStorage.getItem('sk_logs_' + window.currentBookId) || '[]');
    window.renderLogs(localLogs);
};
window.renderLogs = function(logArray) {
    let area = document.getElementById('logSummaryArea');
    if (!area) return;
    if (logArray.length === 0) { area.innerText = "Belum ada log aktivitas."; return; }
    area.innerHTML = '';
    logArray.forEach(l => {
        let div = document.createElement('div');
        div.className = 'log-line';
        let tagClass = 'tag-system';
        if (l.action === 'TAMBAH') tagClass = 'tag-add';
        else if (l.action === 'UBAH') tagClass = 'tag-edit';
        else if (l.action === 'HAPUS') tagClass = 'tag-delete';
        let t = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('id-ID') : '';
        div.innerHTML = `<span class="log-tag ${tagClass}">${window.escapeHtml(l.action)}</span> [${window.escapeHtml(t)}] Device:${window.escapeHtml(l.device_id || 'UNKNOWN')} - ${window.escapeHtml(l.details)}`;
        area.appendChild(div);
    });
};

window.loadTransactions = function() {
    let stored = localStorage.getItem('sk_txs_' + window.currentBookId);
    window.txs = stored ? JSON.parse(stored) : [];
    window.txs.sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date));
    window.render();
    if (window.isOnline()) window.pullFromCloudSilently();
};

window.saveTransactions = function() {
    window.trimAndSaveLocal(window.currentBookId, window.txs);
    window.render();
    window.debouncedPushToCloud();
};
