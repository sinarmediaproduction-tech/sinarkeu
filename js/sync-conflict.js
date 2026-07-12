// ==================== DETEKSI & RESOLUSI KONFLIK EDIT MULTI-DEVICE ====================
//
// MASALAH: sebelum file ini ada, semua push (js/transaction.js: pushToCloud)
// memakai POST upsert "menang belakangan" murni berdasar updated_at -- kalau
// device A dan device B SAMA-SAMA mengedit transaksi yang sama saat keduanya
// offline (atau nyaris bersamaan), device yang push TERAKHIR akan menimpa
// device yang push LEBIH DULU secara diam-diam, tanpa pemberitahuan apa pun.
// Device yang "kalah" tidak pernah tahu perubahannya hilang.
//
// SOLUSI: setiap kali user MEMBUKA form edit transaksi, updated_at baris itu
// (persis seperti yang diketahui device ini saat itu) dicatat sebagai
// "baseline" (window.setEditBaseline, dipanggil dari loadEditData di
// render.js). Saat baris itu di-push, alih-alih POST upsert biasa, dipakai
// PATCH KONDISIONAL: "update baris ini HANYA JIKA updated_at di server masih
// persis sama dengan baseline". Kalau ya (0 device lain mengubahnya di
// antara waktu), update berhasil normal. Kalau TIDAK (server mengembalikan 0
// baris ter-update), berarti device lain sudah mengubahnya lebih dulu --
// device ini tidak boleh menimpa begitu saja, jadi ditampilkan dialog
// resolusi konflik ke user: pilih simpan versi lokal (timpa paksa) atau
// pakai versi cloud (buang edit lokal).
//
// Baris transaksi BARU (belum pernah ada baseline, karena memang belum
// pernah dibuka form edit-nya) tetap lewat jalur batch/upsert asli di
// transaction.js -- tidak mungkin konflik untuk insert baris baru bertipe
// id acak.

// -------------------- Penyimpanan baseline (persisten, tahan reload/tab-close) --------------------
window._editBaselineKey = 'sk_edit_baseline';

window._loadEditBaselineStore = function() {
    try { return JSON.parse(localStorage.getItem(window._editBaselineKey) || '{}'); }
    catch (e) { return {}; }
};
window._saveEditBaselineStore = function(storeObj) {
    try { localStorage.setItem(window._editBaselineKey, JSON.stringify(storeObj)); }
    catch (e) { /* localStorage penuh/nonaktif -- baseline tetap ada di memori sesi ini */ }
};

// Dipanggil dari loadEditData() (render.js) tiap kali user membuka form edit
// transaksi. baseUpdatedAt boleh null (baris belum pernah tersinkron sama
// sekali) -- dalam kasus itu tidak ada yang bisa dibandingkan, jadi baris
// tersebut nanti tetap diperlakukan sebagai "baru" (lewat jalur batch biasa).
window.setEditBaseline = function(id, bookId, baseUpdatedAt) {
    if (!baseUpdatedAt) { window.clearEditBaseline(id); return; }
    const store = window._loadEditBaselineStore();
    store[id] = { bookId: bookId, baseUpdatedAt: baseUpdatedAt };
    window._saveEditBaselineStore(store);
};
window.clearEditBaseline = function(id) {
    const store = window._loadEditBaselineStore();
    if (store[id]) { delete store[id]; window._saveEditBaselineStore(store); }
};
window.getEditBaseline = function(id) {
    return window._loadEditBaselineStore()[id] || null;
};

// -------------------- Antrean konflik yang perlu ditinjau user --------------------
// Setiap entri: { id, bookId, localTx, serverTx (bisa null kalau baris sudah
// dihapus permanen -- praktiknya nyaris tidak pernah karena app ini soft-delete),
// serverDeleted (bool) }
window._pendingConflicts = [];
// Id yang SEDANG menunggu resolusi user -- dikecualikan dari percobaan push
// berikutnya (kalau tidak, debounce/auto-sync berikutnya akan mencoba push
// baris yang sama lagi sebelum user sempat memilih, dan berpotensi membuka
// dialog konflik dobel untuk baris yang sama).
window._conflictLockedIds = new Set();

window._updateConflictBanner = function() {
    const banner = document.getElementById('conflictBanner');
    if (!banner) return;
    const n = window._pendingConflicts.length;
    if (n === 0) { banner.style.display = 'none'; return; }
    banner.style.display = 'flex';
    document.getElementById('conflictBannerText').innerText =
        n === 1
            ? '1 transaksi diedit bersamaan di perangkat lain -- perlu ditinjau.'
            : `${n} transaksi diedit bersamaan di perangkat lain -- perlu ditinjau.`;
};

window._describeTxForConflict = function(t) {
    if (!t) return null;
    return {
        type: t.type,
        typeLabel: t.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
        category: t.category || '-',
        description: t.description || '-',
        amount: Number(t.amount) || 0,
        date: t.date,
        updated_at: t.updated_at
    };
};

// Dipanggil oleh window.pushToCloud (di bawah) saat _pushSingleTxConditional
// melaporkan konflik. Menambahkan ke antrean (kalau id ini belum ada di
// antrean) dan me-refresh banner.
window._registerConflict = function(id, bookId, localTx, serverTx, serverDeleted) {
    if (window._pendingConflicts.some(c => c.id === id)) return; // sudah tercatat, jangan dobel
    window._conflictLockedIds.add(id);
    window._pendingConflicts.push({
        id, bookId,
        localTx: window._describeTxForConflict(localTx),
        serverTx: serverTx ? window._describeTxForConflict(serverTx) : null,
        serverDeleted: !!serverDeleted
    });
    window._updateConflictBanner();
    if (window.showToast) {
        window.showToast('Ada transaksi yang diedit bersamaan di perangkat lain -- perlu ditinjau.', 'warning');
    }
};

// -------------------- Push kondisional untuk SATU baris hasil edit --------------------
// Return: { ok: true, updatedAt } kalau berhasil bersih,
//         { ok: false, retry: true } kalau gagal jaringan (baris tetap dirty,
//         akan dicoba lagi otomatis nanti),
//         { ok: false, conflict: true } kalau device lain sudah mengubah baris
//         ini duluan (sudah otomatis masuk antrean review lewat _registerConflict).
window._pushSingleTxConditional = async function(bookId, tx, baseline) {
    const tag = window.getAccountTag ? window.getAccountTag() : null;
    const tagFilter = window.tagOrFilter(tag);
    const encPayload = await window.encodeCloudTxPayload(tx);
    const nowIso = new Date().toISOString();
    const base = {
        id: tx.id,
        book_id: bookId,
        device_id: window.deviceId,
        date: tx.date,
        updated_at: nowIso,
        ...(tag ? { account_tag: tag } : {})
    };
    const body = encPayload
        ? { ...base, enc_payload: encPayload, type: null, amount: null, category: null, description: null, attachment: null }
        : { ...base, type: tx.type, amount: parseFloat(tx.amount) || 0, category: tx.category || '', description: tx.description || '', attachment: tx.attachment || null };

    const query = `?id=eq.${tx.id}&book_id=eq.${bookId}&updated_at=eq.${encodeURIComponent(baseline)}${tagFilter}`;
    let res;
    try {
        res = await window.callSupabaseAPI('transactions', 'PATCH', body, query, { returnRepresentation: true });
    } catch (e) {
        return { ok: false, retry: true };
    }
    if (res === null) return { ok: false, retry: true }; // network/error -- callSupabaseAPI sudah menampilkan toast

    if (Array.isArray(res) && res.length === 1) {
        return { ok: true, updatedAt: res[0].updated_at };
    }

    // 0 baris ter-update lewat PATCH kondisional -> ambil kondisi baris ini
    // di server SEKARANG untuk tahu APA sebabnya (bukan otomatis dianggap
    // konflik -- lihat catatan penting di bawah).
    const rows = await window.callSupabaseAPI('transactions', 'GET', null, `?id=eq.${tx.id}&book_id=eq.${bookId}${tagFilter}`);

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
        // [PENTING] Karena app ini SOFT-DELETE (baris yang dihapus tetap ada
        // di server dengan is_deleted=true, tidak pernah benar-benar hilang
        // -- lihat pushDeleteToCloud), "tidak ditemukan sama sekali" di sini
        // TIDAK PERNAH berarti "sudah dihapus di device lain". Itu berarti
        // baris ini MEMANG BELUM PERNAH ter-push ke server sama sekali --
        // misalnya transaksi baru yang dibuat lalu langsung diedit lagi
        // sebelum sempat online, atau push pertamanya sempat gagal. Kalau
        // ini diperlakukan sebagai konflik, user akan disodori dialog
        // konflik palsu untuk transaksi yang sama sekali belum pernah
        // disentuh device lain. Solusinya: langsung upsert normal (baris ini
        // memang belum ada apa pun untuk "ditimpa").
        const res2 = await window.callSupabaseAPI('transactions', 'POST', [body]);
        if (res2 && Array.isArray(res2) && res2[0]) return { ok: true, updatedAt: res2[0].updated_at };
        return { ok: false, retry: true };
    }

    const serverRow = rows[0];
    const serverDeleted = !!serverRow.is_deleted;
    if (!serverDeleted && serverRow.updated_at === baseline) {
        // Baris ada, belum dihapus, dan updated_at-nya PERSIS sama dengan
        // baseline -- berarti PATCH kondisional tadi sebenarnya cocok, tapi
        // gagal karena sebab lain (mis. jaringan terputus di tengah jalan
        // sebelum respons diterima). Bukan konflik sungguhan -- aman dicoba
        // lagi nanti oleh siklus retry biasa.
        return { ok: false, retry: true };
    }
    const serverTx = await window.decodeCloudTxRow(serverRow);
    window._registerConflict(tx.id, bookId, tx, serverTx, serverDeleted);
    return { ok: false, conflict: true };
};

// -------------------- Membungkus pushToCloud batch asli --------------------
// window.pushToCloud (didefinisikan di js/transaction.js, dimuat SEBELUM file
// ini) di-capture di sini sebagai _pushToCloudBatch, lalu ditimpa dengan
// versi yang memisahkan id "hasil edit dengan baseline" (jalur kondisional,
// bisa mendeteksi konflik) dari id "baris baru tanpa baseline" (tetap jalur
// batch/upsert asli, aman karena tidak ada yang bisa ditimpa).
window._pushToCloudBatch = window.pushToCloud;

window.pushToCloud = async function(bookId, txs, dirtyIds) {
    if (!window.isOnline()) return;
    bookId = bookId || window.currentBookId;
    txs = txs || window.txs;

    if (!dirtyIds) {
        // Mode force-full-push (restore backup/import) -- SENGAJA tidak lewat
        // jalur kondisional sama sekali, karena di situ seluruh data lokal
        // memang harus menang menimpa cloud. Lihat komentar di transaction.js.
        return window._pushToCloudBatch(bookId, txs, dirtyIds);
    }

    const byId = {};
    txs.forEach(t => { byId[t.id] = t; });

    const conditionalIds = [];
    const batchIds = new Set();
    dirtyIds.forEach(id => {
        if (window._conflictLockedIds.has(id)) return; // sedang menunggu resolusi user, jangan coba push dulu
        const bl = window.getEditBaseline(id);
        if (bl && bl.bookId === bookId && byId[id]) conditionalIds.push(id);
        else batchIds.add(id);
    });

    // Baris baru / tanpa baseline tercatat -> jalur batch/upsert asli.
    if (batchIds.size > 0) {
        await window._pushToCloudBatch(bookId, txs, batchIds);
    }

    // Baris hasil edit dengan baseline -> satu per satu, kondisional.
    for (const id of conditionalIds) {
        const tx = byId[id];
        const bl = window.getEditBaseline(id);
        const result = await window._pushSingleTxConditional(bookId, tx, bl.baseUpdatedAt);
        if (result.ok) {
            window.clearEditBaseline(id);
            window.clearTxDirty([id]);
            const newUpdatedAt = result.updatedAt;
            if (bookId === window.currentBookId) {
                window.txs = window.txs.map(t => t.id === id ? { ...t, updated_at: newUpdatedAt } : t);
                localStorage.setItem('sk_txs_' + bookId, JSON.stringify(window.txs));
            } else {
                const cacheRaw = localStorage.getItem('sk_txs_' + bookId);
                if (cacheRaw) {
                    try {
                        const cache = JSON.parse(cacheRaw).map(t => t.id === id ? { ...t, updated_at: newUpdatedAt } : t);
                        localStorage.setItem('sk_txs_' + bookId, JSON.stringify(cache));
                    } catch (e) { /* cache buku lain tidak valid, biarkan apa adanya */ }
                }
            }
            window._lastSyncTime = new Date();
            if (window.updateSyncTimeBadge) window.updateSyncTimeBadge();
        }
        // result.conflict -> sudah masuk antrean review lewat _registerConflict,
        // dirty & baseline SENGAJA dibiarkan (baru dibersihkan setelah user
        // memilih resolusi -- lihat window.resolveConflictKeepMine/KeepCloud).
        // result.retry -> gagal jaringan, dirty & baseline dibiarkan, akan
        // dicoba lagi otomatis oleh siklus auto-sync/flush berikutnya.
    }
};

// -------------------- UI resolusi konflik --------------------
// Menampilkan konflik pertama di antrean pada modal. Dipanggil saat user
// menekan tombol "Tinjau" di banner, dan otomatis lanjut ke konflik
// berikutnya (kalau ada) setelah satu konflik diselesaikan.
window.openConflictReview = function() {
    if (window._pendingConflicts.length === 0) return;
    const c = window._pendingConflicts[0];
    document.getElementById('conflictModalCount').innerText =
        window._pendingConflicts.length > 1 ? ` (1 dari ${window._pendingConflicts.length})` : '';

    const renderSide = (t, label, isDeleted) => {
        if (isDeleted) {
            return `<div class="conflict-side"><div class="conflict-side-label">${label}</div><div class="conflict-deleted-note">Transaksi ini sudah dihapus di perangkat lain.</div></div>`;
        }
        if (!t) return `<div class="conflict-side"><div class="conflict-side-label">${label}</div><div class="conflict-deleted-note">Tidak ada data.</div></div>`;
        return `<div class="conflict-side">
            <div class="conflict-side-label">${label}</div>
            <div class="conflict-row"><span>Jenis</span><b>${window.escapeHtml(t.typeLabel)}</b></div>
            <div class="conflict-row"><span>Jumlah</span><b>${window.rp(t.amount)}</b></div>
            <div class="conflict-row"><span>Kategori</span><b>${window.escapeHtml(t.category)}</b></div>
            <div class="conflict-row"><span>Deskripsi</span><b>${window.escapeHtml(t.description)}</b></div>
            <div class="conflict-row"><span>Tanggal</span><b>${window.formatDateTime(t.date)}</b></div>
        </div>`;
    };

    const body = document.getElementById('conflictModalBody');
    body.innerHTML =
        renderSide(c.localTx, 'Versi Anda (perangkat ini)', false) +
        renderSide(c.serverTx, 'Versi di Cloud (perangkat lain)', c.serverDeleted);

    const keepCloudBtn = document.getElementById('conflictKeepCloudBtn');
    keepCloudBtn.innerText = c.serverDeleted ? 'Ikut hapus di sini' : 'Pakai versi cloud';
    const keepMineBtn = document.getElementById('conflictKeepMineBtn');
    keepMineBtn.innerText = c.serverDeleted ? 'Simpan lagi versi saya' : 'Simpan versi saya';

    window.openModal('conflictModal');
};

// User memilih: TIMPA versi cloud dengan versi lokal device ini (force push,
// tanpa syarat updated_at lagi). Kalau server bilang baris sudah dihapus,
// paksa is_deleted=false supaya transaksinya "hidup" lagi dengan data lokal.
window.resolveConflictKeepMine = async function() {
    if (window._pendingConflicts.length === 0) return;
    const c = window._pendingConflicts.shift();
    window._conflictLockedIds.delete(c.id);
    const tx = window.txs.find(t => t.id === c.id) ||
        JSON.parse(localStorage.getItem('sk_txs_' + c.bookId) || '[]').find(t => t.id === c.id);
    if (tx && window.isOnline()) {
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        const tagFilter = window.tagOrFilter(tag);
        const encPayload = await window.encodeCloudTxPayload(tx);
        const body = {
            id: tx.id, book_id: c.bookId, device_id: window.deviceId, date: tx.date,
            updated_at: new Date().toISOString(), is_deleted: false,
            ...(tag ? { account_tag: tag } : {}),
            ...(encPayload
                ? { enc_payload: encPayload, type: null, amount: null, category: null, description: null, attachment: null }
                : { type: tx.type, amount: parseFloat(tx.amount) || 0, category: tx.category || '', description: tx.description || '', attachment: tx.attachment || null })
        };
        // Upsert tanpa syarat (menang paksa) -- dipilih user secara sadar
        // setelah melihat kedua versi, jadi ini BUKAN lagi "diam-diam menimpa".
        await window.callSupabaseAPI('transactions', 'POST', [body]);
    }
    window.clearEditBaseline(c.id);
    window.clearTxDirty([c.id]);
    window.showToast('Versi Anda disimpan ke cloud.', 'success');
    window._updateConflictBanner();
    if (window._pendingConflicts.length > 0) window.openConflictReview();
    else window.closeModal('conflictModal');
};

// User memilih: BUANG edit lokal, pakai versi yang ada di cloud sekarang.
window.resolveConflictKeepCloud = async function() {
    if (window._pendingConflicts.length === 0) return;
    const c = window._pendingConflicts.shift();
    window._conflictLockedIds.delete(c.id);
    if (c.bookId === window.currentBookId) {
        if (c.serverDeleted) {
            window.txs = window.txs.filter(t => t.id !== c.id);
        } else if (c.serverTx) {
            window.txs = window.txs.map(t => t.id === c.id ? { ...t, ...c.serverTx, id: c.id } : t);
        }
        localStorage.setItem('sk_txs_' + c.bookId, JSON.stringify(window.txs));
        window.render();
    } else {
        const cacheRaw = localStorage.getItem('sk_txs_' + c.bookId);
        if (cacheRaw) {
            try {
                let cache = JSON.parse(cacheRaw);
                cache = c.serverDeleted
                    ? cache.filter(t => t.id !== c.id)
                    : cache.map(t => t.id === c.id ? { ...t, ...c.serverTx, id: c.id } : t);
                localStorage.setItem('sk_txs_' + c.bookId, JSON.stringify(cache));
            } catch (e) { /* cache buku lain tidak valid, biarkan apa adanya */ }
        }
    }
    window.clearEditBaseline(c.id);
    window.clearTxDirty([c.id]);
    window.showToast('Perubahan lokal dibuang, memakai versi cloud.', 'warning');
    window._updateConflictBanner();
    if (window._pendingConflicts.length > 0) window.openConflictReview();
    else window.closeModal('conflictModal');
};
