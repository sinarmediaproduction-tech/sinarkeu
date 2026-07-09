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
    const sorted = [...data].sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date) || String(b.id).localeCompare(String(a.id)));
    const trimmed = sorted.slice(0, window.MAX_LOCAL_TXS);
    localStorage.setItem('sk_txs_' + bookId, JSON.stringify(trimmed));
    const remainder = sorted.slice(window.MAX_LOCAL_TXS);
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
    // [BUG FIX 3] Guard concurrent pull: jika pull sebelumnya masih berjalan
    // (koneksi lambat / buku banyak), skip — daripada dua proses merge localMap
    // berjalan bersamaan dan hasilnya tidak deterministik.
    if (window._isPullingTransactions) return;
    window._isPullingTransactions = true;
    try {
        const lastSync = window._lastFullSyncTime[window.currentBookId];
        // Catatan soft-delete: untuk load awal (tanpa lastSync) kita filter
        // is_deleted=eq.false langsung di query, karena di sini tidak ada proses
        // merge — baris terhapus memang tidak boleh pernah masuk ke window.txs.
        // Untuk query incremental (ada lastSync), JANGAN difilter, karena kita
        // justru butuh baris tombstone (is_deleted=true) itu untuk tahu transaksi
        // mana yang baru dihapus di perangkat lain, supaya bisa dibuang dari
        // cache lokal perangkat ini juga (lihat loop di bawah).
        const _txTag = window.getAccountTag ? window.getAccountTag() : null;
        // OR filter: ambil baris ber-tag milik akun ini ATAU baris lama tanpa tag (NULL).
        // Baris NULL adalah data sebelum fitur account_tag ditambahkan; harus tetap terbaca
        // sampai migrasi selesai men-tag ulang semua baris tersebut.
        const _txTagFilter = window.tagOrFilter(_txTag);
        let query = `?book_id=eq.${window.currentBookId}&is_deleted=eq.false&order=date.desc&limit=${window.MAX_LOCAL_TXS}${_txTagFilter}`;
        if (lastSync) {
            query = `?book_id=eq.${window.currentBookId}&order=updated_at.desc&updated_at=gt.${lastSync}&limit=${window.MAX_LOCAL_TXS}${_txTagFilter}`;
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
                        if (c.is_deleted) {
                            // Tombstone dari perangkat lain: buang dari cache lokal ini juga.
                            delete localMap[c.id];
                        } else {
                            localMap[c.id] = {
                                id: c.id, type: c.type, amount: Number(c.amount),
                                category: c.category || (c.type === 'income' ? 'Pemasukan' : ''),
                                description: c.description, date: c.date,
                                attachment: c.attachment, updated_at: c.updated_at || null
                            };
                        }
                    }
                });
                window.txs = Object.values(localMap).sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date) || String(b.id).localeCompare(String(a.id)));
            } else if (!lastSync) {
                window.txs = cloudData.map(c => ({
                    id: c.id, type: c.type, amount: Number(c.amount),
                    category: c.category || (c.type === 'income' ? 'Pemasukan' : ''),
                    description: c.description, date: c.date,
                    attachment: c.attachment, updated_at: c.updated_at || null
                })).sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date) || String(b.id).localeCompare(String(a.id)));
            }
            window.trimAndSaveLocal(window.currentBookId, window.txs);
            window._lastFullSyncTime[window.currentBookId] = new Date().toISOString();
            window.render();
            window._lastSyncTime = new Date();
            window.updateSyncTimeBadge();
        }
    } finally {
        // Pastikan lock selalu dilepas, bahkan jika ada exception tak terduga.
        window._isPullingTransactions = false;
    }
};

window.pullAllBooksFromCloud = async function() {
    if (!window.isOnline()) return;
    const bookIds = window.books.map(b => b.id);
    if (bookIds.length === 0) return;
    for (const bookId of bookIds) {
        const _fxTag = window.getAccountTag ? window.getAccountTag() : null;
        // OR filter: baris ber-tag akun ini ATAU baris lama tanpa tag (data sebelum migrasi).
        const _fxTagFilter = window.tagOrFilter(_fxTag);
        let cloudData = await window.callSupabaseAPI('transactions', 'GET', null,
            `?book_id=eq.${bookId}&is_deleted=eq.false&order=date.desc&limit=${window.MAX_LOCAL_TXS}${_fxTagFilter}`);
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
        window.showToast('Gagal sinkronisasi, coba lagi nanti', 'error');
    }
};

// [FIX RACE MULTI-DEVICE + MULTI-TAB] Set berisi id transaksi yang berubah di
// PERANGKAT/BROWSER INI sejak push terakhir berhasil. Ditambahkan lewat
// window.markTxDirty() oleh handleSubmit (tambah) dan handleEditSubmit (ubah)
// di render.js. Dipakai supaya pushToCloud() hanya meng-upsert baris yang
// benar-benar diubah, bukan seluruh window.txs.
//
// Kenapa ini penting: sebelumnya pushToCloud() SELALU mengirim seluruh
// window.txs (bisa ratusan baris, lihat MAX_LOCAL_TXS) dengan
// Prefer:resolution=merge-duplicates (upsert full-row overwrite), setiap kali
// SATU transaksi ditambah/diubah. Skenario race:
//   1. Device A & B sama-sama sudah sinkron, 50 transaksi.
//   2. Device A ubah transaksi #10 -> 1.5 detik kemudian debounce push
//      SELURUH 50 transaksi (termasuk salinan lokal A untuk #11..#50 yang
//      SUDAH BASI kalau device lain baru saja mengubahnya).
//   3. Kalau di antara pull terakhir A dan push ini, device B sempat mengubah
//      transaksi #20, maka push A akan MENIMPA perubahan B itu dengan data
//      lama A secara diam-diam -- lost update, tanpa error apa pun.
// Ini persis kelas bug yang sama dengan bug hadiah di Merdeka (menimpa data
// yang tidak sedang diubah), hanya lebih tersembunyi karena terjadi per-baris,
// bukan di dalam satu kolom JSON.
window._dirtyTxIds = new Set();

// [MULTI-TAB] Dirty ids di atas cuma in-memory -> kalau tab A menandai dirty
// lalu di-close SEBELUM debounce 1.5 detik sempat push (atau sebelum sempat
// online), penandaan itu hilang total dan transaksi itu tidak akan pernah
// ter-push kecuali user mengubahnya lagi. window._dirtyStoreKey menyimpan
// peta {txId: bookId} yang sama persis ke localStorage, supaya:
//   1. Tab lain yang masih terbuka bisa lihat dirty ids ini (lewat event
//      'storage' bawaan browser, lihat listener di bawah) dan ikut
//      menganggapnya perlu di-push kalau tab itu yang lebih dulu push.
//   2. Kalau SEMUA tab/tab ini di-close sebelum sempat push, saat app dibuka
//      lagi (device/tab manapun), window.flushPendingDirtyOnStart() akan
//      menemukan sisa dirty ids ini di localStorage dan langsung push --
//      tidak ada transaksi yang "lupa" ter-sync.
window._dirtyStoreKey = 'sk_dirty_pending';

window._loadDirtyStore = function() {
    try { return JSON.parse(localStorage.getItem(window._dirtyStoreKey) || '{}'); }
    catch (e) { return {}; }
};
window._saveDirtyStore = function(storeObj) {
    try { localStorage.setItem(window._dirtyStoreKey, JSON.stringify(storeObj)); }
    catch (e) { /* localStorage penuh/nonaktif — dirty tetap ada di memori tab ini */ }
};

// Tandai satu id transaksi sebagai "perlu di-push", baik di memori tab ini
// maupun di localStorage (supaya tab lain & sesi berikutnya tahu).
window.markTxDirty = function(id, bookId) {
    bookId = bookId || window.currentBookId;
    window._dirtyTxIds.add(id);
    const store = window._loadDirtyStore();
    store[id] = bookId;
    window._saveDirtyStore(store);
};

// Hapus sekumpulan id dari dirty tracking (dipanggil setelah push berhasil),
// baik dari memori tab ini maupun localStorage.
window.clearTxDirty = function(ids) {
    ids.forEach(id => window._dirtyTxIds.delete(id));
    const store = window._loadDirtyStore();
    ids.forEach(id => { delete store[id]; });
    window._saveDirtyStore(store);
};

// [MULTI-TAB] Dipanggil sekali saat app start (lihat app.js continueAppInit).
// Kalau ada dirty ids tersisa dari sesi/tab sebelumnya yang tidak sempat
// ter-push (tab ditutup, koneksi putus, dsb), push sekarang juga -- per buku,
// memakai cache localStorage buku itu (bukan window.txs, karena buku itu
// belum tentu sedang aktif/ditampilkan).
window.flushPendingDirtyOnStart = async function() {
    if (!window.isOnline()) return;
    const store = window._loadDirtyStore();
    const ids = Object.keys(store);
    if (ids.length === 0) return;
    const byBook = {};
    ids.forEach(id => { (byBook[store[id]] = byBook[store[id]] || []).push(id); });
    for (const bookId in byBook) {
        const cacheRaw = localStorage.getItem('sk_txs_' + bookId);
        const cacheTxs = cacheRaw ? JSON.parse(cacheRaw) : [];
        const dirtySet = new Set(byBook[bookId]);
        await window.pushToCloud(bookId, cacheTxs, dirtySet);
    }
};

// [MULTI-TAB] Kalau tab LAIN di browser yang sama menulis ke localStorage,
// event 'storage' otomatis terpicu di tab ini (tidak pernah terpicu di tab
// yang menulis sendiri -- pas untuk kebutuhan kita).
//   - Cache transaksi buku yang sedang dibuka berubah (tab lain
//     tambah/ubah/hapus, atau tab lain barusan pull dari cloud) -> reload
//     window.txs dari localStorage & render ulang, supaya tab ini tidak
//     menampilkan data basi ATAU nanti mem-push balik data basi itu.
//   - Dirty store berubah -> sinkronkan window._dirtyTxIds in-memory tab ini,
//     supaya siapa pun (tab ini atau tab lain) yang debounce-nya lebih dulu
//     selesai, ikut mem-push id yang ditandai tab lain, dan tidak ada tab
//     yang mem-push ulang id yang barusan berhasil di-push tab lain.
window.addEventListener('storage', function(e) {
    if (!e.key) return;
    if (e.key === 'sk_txs_' + window.currentBookId) {
        try {
            window.txs = e.newValue ? JSON.parse(e.newValue) : [];
            window.render();
        } catch (err) { console.warn('[MultiTab] Gagal parse update txs dari tab lain:', err); }
        return;
    }
    if (e.key === window._dirtyStoreKey) {
        try {
            const store = e.newValue ? JSON.parse(e.newValue) : {};
            window._dirtyTxIds = new Set(Object.keys(store).filter(id => store[id] === window.currentBookId));
        } catch (err) { console.warn('[MultiTab] Gagal parse dirty store dari tab lain:', err); }
    }
});

window.pushToCloud = async function(bookId, txs, dirtyIds) {
    // bookId & txs opsional: jika diisi (dari debouncedPushToCloud), pakai snapshot
    // yang di-capture saat debounce dipanggil — bukan nilai currentBookId/txs saat ini
    // yang mungkin sudah berubah karena user pindah buku (Bug Fix 2).
    if (!window.isOnline()) return;
    bookId = bookId || window.currentBookId;
    txs = txs || window.txs;
    // dirtyIds undefined/null -> mode lama (force full push), dipakai sengaja oleh
    // restore backup/import (lihat backup.js: saveTransactions(true)) karena di situ
    // memang SELURUH data lokal harus menang menimpa cloud.
    // dirtyIds diisi (Set, boleh kosong) -> hanya push baris yang berubah di device ini.
    let toPush = txs;
    if (dirtyIds) {
        toPush = txs.filter(t => dirtyIds.has(t.id));
        if (toPush.length === 0) return;
    }
    const _ptTag = window.getAccountTag ? window.getAccountTag() : null;
    const payload = toPush.map(t => ({
        id: t.id,
        book_id: bookId,
        device_id: window.deviceId,
        type: t.type,
        amount: parseFloat(t.amount) || 0,
        category: t.category || '',
        description: t.description || '',
        date: t.date,
        attachment: t.attachment || null,
        updated_at: t.updated_at || new Date().toISOString(),
        ...(_ptTag ? { account_tag: _ptTag } : {})
    }));
    if (payload.length === 0) return;
    let res = await window.callSupabaseAPI('transactions', 'POST', payload);
    if (res && Array.isArray(res)) {
        console.log(`Sinkronisasi ${res.length} transaksi ke Supabase Cloud berhasil.`);
        if (dirtyIds) {
            // Hapus HANYA id yang barusan berhasil di-push, dari memori DAN
            // localStorage (window.clearTxDirty), supaya tab lain juga tahu id
            // ini sudah beres dan tidak mem-push ulang. Kalau ada edit baru
            // masuk selama network delay (setelah snapshot diambil di
            // debouncedPushToCloud), id itu ditandai ulang lewat markTxDirty
            // dan TIDAK ada di toPush ini, jadi tidak ikut terhapus -- akan
            // ke-push di siklus debounce berikutnya.
            window.clearTxDirty(toPush.map(t => t.id));
        }
        window._lastSyncTime = new Date();
        window.updateSyncTimeBadge();
    }
};

window.debouncedPushToCloud = function(forceFullPush) {
    // [BUG FIX 2] Capture bookId SEKARANG (sebelum delay 1500ms).
    // Tanpa ini, jika user switchBook dalam 1.5 detik setelah edit transaksi,
    // pushToCloud() terjadi setelah currentBookId sudah berganti — transaksi
    // buku lama ter-push dengan book_id buku baru di Supabase.
    const bookIdSnapshot = window.currentBookId;
    const txsSnapshot = [...window.txs];
    // Snapshot dirty ids SEKARANG juga, dengan alasan yang sama seperti bookId/txs
    // di atas: supaya id yang ditambahkan ke window._dirtyTxIds SETELAH titik ini
    // (edit baru yang masuk selama delay) tidak ikut ke-clear oleh push ini.
    const dirtySnapshot = forceFullPush ? null : new Set(window._dirtyTxIds);
    if (window._pushDebounceTimer) clearTimeout(window._pushDebounceTimer);
    window._pushDebounceTimer = setTimeout(() => {
        window.pushToCloud(bookIdSnapshot, txsSnapshot, dirtySnapshot);
    }, 1500);
};

window.addCloudLog = async function(actionType, detailsText) {
    let localLogs = JSON.parse(localStorage.getItem('sk_logs_' + window.currentBookId) || '[]');
    let logObj = { timestamp: new Date().toISOString(), device_id: window.deviceId, action: actionType, details: detailsText };
    localLogs.unshift(logObj);
    if (localLogs.length > 50) localLogs.pop();
    localStorage.setItem('sk_logs_' + window.currentBookId, JSON.stringify(localLogs));
    window.renderLogs(localLogs);
    if (!window.isOnline()) return;
    const _alTag = window.getAccountTag ? window.getAccountTag() : null;
    const logPayload = [{
        book_id: window.currentBookId,
        device_id: window.deviceId,
        action: actionType,
        details: detailsText,
        timestamp: new Date().toISOString(),
        ...(_alTag ? { account_tag: _alTag } : {})
    }];
    await window.callSupabaseAPI('audit_logs', 'POST', logPayload);
};

window.refreshLogsFromCloud = async function() {
    let area = document.getElementById('logSummaryArea');
    if (!window.isOnline()) { window.refreshLogsLocal(); return; }
    area.innerText = "Memuat log dari cloud...";
    const _glTag = window.getAccountTag ? window.getAccountTag() : null;
    // OR filter: log ber-tag akun ini ATAU log lama tanpa tag.
    const _glTagFilter = window.tagOrFilter(_glTag);
    let cloudLogs = await window.callSupabaseAPI('audit_logs', 'GET', null, `?book_id=eq.${window.currentBookId}&order=timestamp.desc&limit=30${_glTagFilter}`);
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
    // [MULTI-TAB] Muat dirty ids milik buku ini dari localStorage. Ini bisa berisi
    // id yang ditandai tab lain (belum sempat ke-push tab itu) atau sisa dari sesi
    // sebelumnya yang belum sempat online. Timpa in-memory Set supaya tidak
    // "mencampur" dirty ids buku sebelumnya yang sedang aktif di tab ini.
    const _dirtyStore = window._loadDirtyStore();
    window._dirtyTxIds = new Set(Object.keys(_dirtyStore).filter(id => _dirtyStore[id] === window.currentBookId));
    window.render();
    if (window.isOnline()) window.pullFromCloudSilently();
};

window.saveTransactions = function(forceFullPush) {
    // forceFullPush=true dipakai HANYA oleh restore backup lokal/cloud dan import
    // JSON (lihat backup.js) -- kasus di mana window.txs memang sengaja diganti
    // total dan seluruh isinya harus menang menimpa cloud. Untuk tambah/ubah
    // transaksi biasa, JANGAN pernah pass true di sini -- biarkan default
    // (push hanya baris dirty) supaya tidak menimpa perubahan device lain.
    window.trimAndSaveLocal(window.currentBookId, window.txs);
    window.render();
    window.debouncedPushToCloud(forceFullPush);
};
