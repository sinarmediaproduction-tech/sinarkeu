// ==================== BOOK MANAGEMENT ====================
// Hitung saldo akhir sebuah buku dari cache lokal (sk_txs_<id> + sk_balance_offset_<id>)
// TANPA perlu berpindah/membuka buku tsb -- makanya dropdown pindah buku bisa
// langsung menampilkan saldo tiap buku. Catatan: kalau buku itu belum pernah
// dibuka di device ini, cache-nya belum ada, jadi saldo tidak bisa ditampilkan
// (return null, bukan 0, supaya tidak menyesatkan seolah saldonya benar-benar nol).
window.getBookBalanceLabel = function(bookId) {
    try {
        const raw = localStorage.getItem('sk_txs_' + bookId);
        if (raw === null) return null;
        const txs = JSON.parse(raw || '[]');
        let inc = 0, exp = 0;
        txs.forEach(t => {
            const amt = Number(t.amount) || 0;
            if (t.type === 'income') inc += amt; else exp += amt;
        });
        const offset = Number(localStorage.getItem('sk_balance_offset_' + bookId)) || 0;
        return window.rp(inc - exp + offset);
    } catch (e) {
        return null;
    }
};

window.updateBookSelectDropdown = function() {
    let sel = document.getElementById('currentBookSelect');
    sel.innerHTML = '';

    // Ikuti setelan privasi "Sembunyikan Saldo" (sk_balance_hidden) yang sama
    // dipakai oleh saldo hero di dashboard -- kalau user sedang menyembunyikan
    // saldo, jangan bocorkan saldo tiap buku lewat dropdown ini.
    const balanceHidden = localStorage.getItem('sk_balance_hidden') === '1';

    // [UI] Kelompokkan anak buku tepat di bawah buku induknya (bukan
    // mengikuti urutan asli array window.books apa adanya), supaya
    // hierarki induk → anak terlihat jelas di dropdown pilih buku.
    const childrenByParent = {};
    const topLevel = [];
    const idSet = new Set(window.books.map(b => b.id));
    window.books.forEach(b => {
        if (b.parentId && idSet.has(b.parentId)) {
            (childrenByParent[b.parentId] = childrenByParent[b.parentId] || []).push(b);
        } else {
            // Buku mandiri, ATAU anak buku "yatim" (induknya sudah tidak
            // ada/terhapus) — tetap ditampilkan sebagai level teratas
            // supaya tidak hilang dari daftar.
            topLevel.push(b);
        }
    });

    function addOption(b, isChild) {
        let opt = document.createElement('option');
        opt.value = b.id;
        const namePart = isChild ? '  ↳ ' + b.name : b.name;
        opt.textContent = namePart;
        const balanceLabel = balanceHidden ? null : window.getBookBalanceLabel(b.id);
        if (balanceLabel) opt.setAttribute('data-balance', balanceLabel);
        if (isChild) opt.setAttribute('data-child', '1');
        if (b.id === window.currentBookId) opt.selected = true;
        sel.appendChild(opt);
    }

    topLevel.forEach(b => {
        addOption(b, false);
        (childrenByParent[b.id] || []).forEach(child => addOption(child, true));
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
    if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
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
        // [FIX BUG #1 & #2] Buku bersama cuma boleh dihapus/diganti nama
        // oleh admin buku itu. Sebelumnya tombol ini muncul untuk semua
        // role (viewer/editor termasuk) tanpa pengecekan apa pun.
        const canManageThisBook = !b._isShared || (typeof window.skGetRoleForBook === 'function' && window.skGetRoleForBook(b.id) === 'admin');
        let delBtn = (window.books.length > 1 && canManageThisBook) ? `<button class="btn-mini btn-mini-danger" onclick="window.deleteBook('${b.id}')">Hapus</button>` : '';
        if (isCurrent) delBtn = '<span style="font-size:.65rem; color:#2E6B4F; font-weight:bold;">SEDANG AKTIF</span>';
        const parentBook = b.parentId ? window.books.find(x => x.id === b.parentId) : null;
        const parentLabel = parentBook ? `<div style="font-size:.6rem; color:#5C4E72; margin-top:2px;">↳ Anak dari: <b>${window.escapeHtml(parentBook.name)}</b></div>` : '';
        const sharedLabel = b._isShared ? `<div style="font-size:.6rem; color:var(--success); margin-top:2px;">🔗 Buku bersama · peran kamu: <b>${window.escapeHtml(b._role || '?')}</b></div>` : '';
        const makeSharedBtn = (!b._isShared && typeof window.skMakeBookShared === 'function') ?
            `<button class="btn-mini" style="background:var(--success-lt); color:var(--success); border:1px solid var(--rule);" onclick="window.skMakeBookShared('${b.id}')" title="Undang orang lain untuk ikut mengelola buku ini">Jadikan Bersama</button>` : '';
        div.innerHTML = `
            <span class="book-list-name">
                ${window.escapeHtml(b.name)}
                ${parentLabel}
                ${sharedLabel}
            </span>
            <div class="book-list-actions">
                ${!isCurrent ? `<button class="btn-mini" onclick="window.switchBook('${b.id}')">Buka</button>` : ''}
                <button class="btn-mini" style="background:#E3ECF3; color:#2E5C82; border:1px solid #7FA6C4;" onclick="window.renameBook('${b.id}')" ${canManageThisBook ? '' : 'disabled title="Hanya admin yang bisa mengganti nama buku bersama ini"'}>Nama</button>
                <button class="btn-mini" style="background:#F1EBDA; color:#9C7A2E; border:1px solid #B99A4E;" onclick="window.openCardVisibilityModal('${b.id}')" title="Pilih card yang ditampilkan untuk buku ini">Card</button>
                ${makeSharedBtn}
                ${b.parentId && isCurrent ? `<button class="btn-mini" style="background:#5C4E72; color:#fff;" onclick="window.closeModal('bookManagerModal'); window.openTutupAnakBuku()">Tutup & Kirim</button>` : ''}
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

    // [FIX BUG #2] Sama seperti deleteBook: penjagaan role admin di level
    // fungsi juga (tombol sudah di-disable, ini lapis kedua).
    if (book._isShared && (typeof window.skGetRoleForBook !== 'function' || window.skGetRoleForBook(id) !== 'admin')) {
        window.showToast('Hanya admin yang bisa mengganti nama buku bersama ini.', 'error');
        return;
    }

    const newName = prompt(`Nama baru untuk buku "${book.name}":`, book.name);
    if (!newName || !newName.trim()) return;
    if (newName.trim() === book.name) return;
    const trimmedName = newName.trim();

    // [FIX BUG #2] Sebelumnya rename buku bersama HANYA menulis ke setting
    // pribadi 'books' (localStorage + pushSettingBooks -> tabel `settings`),
    // padahal sistem buku bersama membaca nama dari tabel Supabase
    // `sk_books` (lihat skRefreshSharedAccess di js/auth.js). Akibatnya:
    // 1) anggota lain tidak pernah melihat nama baru, dan
    // 2) nama baru bahkan balik lagi ke nama lama di device sendiri begitu
    //    skRefreshSharedAccess() jalan ulang (mis. reload halaman), karena
    //    fungsi itu selalu menimpa `existing.name = row.name` dari baris
    //    lama di sk_books. Sekarang untuk buku bersama, tabel sk_books
    //    di-update dulu -- kalau ini gagal, jangan lanjut ubah state lokal
    //    supaya tidak ikut "revert sendiri" nanti.
    if (book._isShared) {
        const authClient = window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null;
        if (!authClient) {
            window.showToast('Klien auth Supabase belum siap, coba lagi.', 'error');
            return;
        }
        try {
            const res = await authClient.from('sk_books').update({ name: trimmedName }).eq('id', id);
            if (res.error) throw res.error;
        } catch (e) {
            console.error('[renameBook] Gagal update nama di sk_books:', e);
            window.showToast('Gagal mengganti nama buku bersama: ' + (e && e.message ? e.message : 'error'), 'error');
            return;
        }
    }

    book.name = trimmedName;
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
        await window.customAlert({ title: 'Tidak Bisa Dihapus', message: 'Tidak bisa menghapus buku kas yang sedang dibuka! Silakan pindah ke buku lain terlebih dahulu.' });
        return;
    }
    let b = window.books.find(x => x.id === id);
    if (!b) { window.showToast('Buku sudah tidak ada (mungkin sudah dihapus device lain)', 'warning'); return; }

    // [FIX BUG #1] Penjagaan sisi klien: buku bersama hanya boleh dihapus
    // oleh admin. Tombol di renderBookList sudah disembunyikan untuk
    // non-admin, ini lapis kedua (defense-in-depth) kalau dipicu lewat
    // jalur lain.
    if (b._isShared && (typeof window.skGetRoleForBook !== 'function' || window.skGetRoleForBook(id) !== 'admin')) {
        window.showToast('Hanya admin yang bisa menghapus buku bersama ini.', 'error');
        return;
    }

    const confirm1 = await window.customConfirm({
        title: 'Hapus Buku Permanen',
        message: `Hapus permanen buku "${b.name}"?\n\nData yang dihapus:\n- Semua transaksi dalam buku ini\n- Anggaran bulanan\n- Anggaran Dasar\n- Log aktivitas${b._isShared ? '\n- Semua anggota & akses buku bersama ini' : ''}\n\nData TIDAK BISA dikembalikan!`,
        confirmLabel: 'Lanjut'
    });
    if (!confirm1) return;
    const typedName = await window.customPrompt({
        title: 'Ketik Nama Buku untuk Konfirmasi',
        message: `Ketik nama buku "${b.name}" persis sama untuk mengonfirmasi penghapusan permanen.`,
        expectedValue: b.name
    });
    if (typedName === null) return;
    window.createSafetySnapshot(`Hapus buku "${b.name}"`);
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
            // [FIX BUG #1] callSupabaseAPI TIDAK PERNAH throw kalau request
            // gagal (baik versi asli di db.js maupun versi yang dibungkus
            // auth.js untuk buku shared) -- keduanya catch sendiri lalu
            // return null. Sebelumnya hasil ketiga panggilan ini tidak
            // pernah dicek sama sekali, jadi kalau salah satunya ditolak
            // server (mis. RLS menolak non-admin di buku bersama, atau
            // error lain), blok try ini tetap dianggap "berhasil" -- toast
            // sukses tetap muncul & buku tetap dihapus dari device ini
            // padahal data cloud-nya utuh. Sekarang null dianggap gagal
            // eksplisit, sama seperti exception.
            const r1 = await window.callSupabaseAPI('transactions', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            const r2 = await window.callSupabaseAPI('audit_logs', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            const r3 = await window.callSupabaseAPI('settings', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            if (r1 === null || r2 === null || r3 === null) {
                throw new Error('Salah satu penghapusan data cloud ditolak/gagal (cek console untuk detail).');
            }

            // [FIX BUG #1] Buku bersama tersimpan di tabel sk_books +
            // book_members (sistem terpisah, lihat js/auth.js) -- BUKAN
            // cuma di setting 'books' pribadi yang dibersihkan di bawah.
            // Sebelumnya baris ini tidak pernah dihapus, sehingga
            // skRefreshSharedAccess() akan menghidupkan lagi buku "yang
            // sudah dihapus" ini pada kunjungan berikutnya (baik untuk
            // admin sendiri maupun anggota lain), karena baris
            // book_members & sk_books-nya masih utuh di server.
            if (b._isShared) {
                const authClient = window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null;
                if (!authClient) throw new Error('Klien auth Supabase belum siap, tidak bisa menghapus akses buku bersama.');
                const resMembers = await authClient.from('book_members').delete().eq('book_id', id);
                if (resMembers.error) throw resMembers.error;
                const resBook = await authClient.from('sk_books').delete().eq('id', id);
                if (resBook.error) throw resBook.error;
                if (window._skSharedRoles) delete window._skSharedRoles[id];
            }

            console.log(`Data cloud buku "${b.name}" berhasil dihapus.`);
        } catch (e) {
            console.error('Gagal hapus data cloud:', e);
            window.showToast('Gagal menghapus data cloud, coba lagi' + (e && e.message ? ': ' + e.message : ''), 'error');
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
    // [FIX BOOKS LOST-UPDATE] Tandai id ini sebagai "sengaja dihapus lokal"
    // SEBELUM difilter dari window.books, supaya union-merge di
    // pullAllSettings (js/db.js) tidak salah menghidupkannya lagi kalau
    // pull berikutnya kebetulan masih melihat buku ini di cloud (mis. push
    // di bawah gagal/terputus). Baru dibersihkan setelah push benar-benar
    // dikonfirmasi berhasil (lihat window.clearBookPendingDelete di bawah
    // dan window.flushPendingBookDeletesOnStart di app.js untuk retry-nya).
    if (window.markBookPendingDelete) window.markBookPendingDelete(id);
    window.books = window.books.filter(x => x.id !== id);
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    window.renderBookList();
    window.updateBookSelectDropdown();
    window.showToast(`Buku "${b.name}" & data cloud dihapus`, "warning");
    const pushOk = await window.pushSettingBooks();
    if (pushOk && window.clearBookPendingDelete) window.clearBookPendingDelete(id);
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
    const colorClass = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--info)';
    return `
        <div style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                <span style="font-size:.7rem; font-weight:600; color:var(--ink);">${label}</span>
                <span style="font-size:.68rem; color:var(--ink-muted);">${window.formatBytes(usedBytes)} / ${window.formatBytes(totalBytes)} &nbsp;·&nbsp; <b style="color:${colorClass}">${pct.toFixed(1)}%</b></span>
            </div>
            <div style="height:8px; background:var(--rule); border-radius: var(--radius-sm); overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:${colorClass}; border-radius: var(--radius-sm); transition:width .4s;"></div>
            </div>
            <div style="font-size:.63rem; color:var(--ink-faint); margin-top:3px; text-align:right;">Sisa: ${window.formatBytes(totalBytes - usedBytes)}</div>
        </div>`;
};

window.refreshStorageEstimate = async function() {
    const el  = document.getElementById('storageEstimContent');
    const btn = document.getElementById('storageRefreshBtn');
    if (!el) return;
    el.innerHTML = '<div style="font-size:.7rem; color:var(--ink-faint); text-align:center; padding:8px 0;">Menghitung...</div>';
    if (btn) btn.disabled = true;
    const data = await window.estimateSupabaseStorage();
    if (btn) btn.disabled = false;
    if (!data) {
        el.innerHTML = '<div style="font-size:.7rem; color:var(--danger); text-align:center; padding:8px 0;">Tidak dapat memuat — pastikan koneksi Supabase aktif.</div>';
        return;
    }
    const { txCount, logCount, settCount, estimatedBytes } = data;
    const totalRows = txCount + logCount + settCount;
    const SUPABASE_FREE_DB_BYTES = 500 * 1024 * 1024;
    const dbBar   = window.renderStorageBar(estimatedBytes, SUPABASE_FREE_DB_BYTES, 'Database (estimasi)');
    const pctNum  = Math.min((estimatedBytes / SUPABASE_FREE_DB_BYTES) * 100, 100);
    const statusColor = pctNum >= 90 ? 'var(--danger)' : pctNum >= 70 ? 'var(--warning)' : 'var(--success)';
    const statusBg     = pctNum >= 90 ? 'var(--danger-lt)' : pctNum >= 70 ? 'var(--warning-lt)' : 'var(--success-lt)';
    const statusText  = pctNum >= 90 ? 'Hampir penuh! Pertimbangkan arsipkan data lama.' :
                        pctNum >= 70 ? 'Mendekati batas — pantau secara berkala.' :
                                       'Kapasitas masih aman.';
    el.innerHTML = `
        ${dbBar}
        <div style="background:var(--paper-warm); border-radius: var(--radius-sm); padding:10px 12px; font-size:.68rem; color:var(--ink); line-height:1.8; margin-bottom:10px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 16px;">
                <span>Transaksi</span><b>${txCount.toLocaleString('id-ID')} baris</b>
                <span>Log Aktivitas</span><b>${logCount.toLocaleString('id-ID')} baris</b>
                <span>Setelan</span><b>${settCount.toLocaleString('id-ID')} baris</b>
                <span>Total Baris</span><b>${totalRows.toLocaleString('id-ID')} baris</b>
            </div>
        </div>
        <div style="font-size:.68rem; color:${statusColor}; font-weight:600; text-align:center; padding:4px 8px; background:${statusBg}; border-radius: var(--radius-sm);">
            ${statusText}
        </div>
        <div style="font-size:.6rem; color:var(--ink-faint); margin-top:8px; text-align:right;">
            * Estimasi berdasarkan jumlah baris × rata-rata ukuran baris. Free tier Supabase: DB 500 MB, File Storage 1 GB.
        </div>
    `;
};

window.openTelegramSettings = async function() {
    if (!window.requireOnline('mengatur Telegram')) return;
    document.getElementById('tgTestStatus').innerHTML = '';
    // [SERAGAM DENGAN SETELAN] Notifikasi Telegram sekarang panel inline di
    // halaman Setelan (telegramSettingsModal terpisah sudah dihapus dari
    // HTML) -- buka Setelan lalu gulir ke sana.
    if (typeof window.openSetelanModal === 'function') window.openSetelanModal('telegram');
    window.loadTgConfigToForm();
    if (window.isOnline()) {
        const _tgTag = window.getAccountTag ? window.getAccountTag() : null;
        const _tgTagFilter = window.tagOrFilter(_tgTag);
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

// [BUG FIX] Sebelumnya tutupAnakBuku() SELALU menghitung ulang SEMUA transaksi
// anak buku dari awal setiap kali dipanggil, tanpa ada penanda "sudah pernah
// ditutup". Akibatnya kalau tombol "Kirim Ringkasan ke Induk" diklik lagi
// (klik ganda, atau anak buku dibuka ulang bulan berikutnya tanpa transaksi
// baru), ringkasan yang SAMA terkirim lagi ke buku induk -> double count.
//
// Fix: simpan book.lastClosedAt (timestamp ISO) setiap kali berhasil ditutup.
// Panggilan berikutnya hanya menghitung transaksi yang tanggalnya SETELAH
// lastClosedAt tersebut, bukan seluruh riwayat lagi.
//
// Catatan: balanceOffset (saldo dari transaksi lama yang sudah di-trim dari
// cache lokal, lihat trimAndSaveLocal) hanya diikutkan pada penutupan
// PERTAMA KALI (saat lastClosedAt belum ada) -- pada penutupan berikutnya,
// riwayat lama itu sudah pernah terhitung & terkirim sebelumnya, sehingga
// tidak boleh ditambahkan lagi.
// [FIX LOGIKA KEUANGAN - TRANSAKSI HILANG SAAT TUTUP ANAK BUKU] Sebelumnya
// fungsi ini SELALU mengandalkan window.txs, yang (lihat trimAndSaveLocal di
// transaction.js) cuma menyimpan MAX_LOCAL_TXS (1000) transaksi TERBARU per
// buku. Untuk anak buku yang jumlah transaksinya (sejak lastClosedAt, atau
// sejak awal kalau belum pernah ditutup) melebihi 1000, filter
// `window.txs.filter(...)` TIDAK PERNAH melihat transaksi yang sudah
// ter-trim dari cache -- padahal transaksi itu sah dan belum pernah dikirim
// ke buku induk. Karena lastClosedAt langsung maju ke waktu SEKARANG setelah
// ringkasan terkirim, transaksi yang ter-skip itu TIDAK PERNAH bisa terkirim
// ke induk lagi -- uangnya hilang permanen dari ringkasan konsolidasi, tanpa
// peringatan apa pun. Ini persis kelas bug yang sudah diperbaiki di
// report.js/budget.js/telegram.js (selalu tarik LANGSUNG dari cloud, tidak
// mengandalkan window.txs, untuk operasi yang butuh total lengkap) tapi
// kelewat di fitur ini.
//
// FIX: kalau online, tarik SEMUA transaksi anak buku ini langsung dari
// Supabase (paginated, tanpa batas MAX_LOCAL_TXS, difilter date > lastClosedAt
// kalau ada), dekripsi, jumlahkan -- otomatis lengkap, tidak butuh
// balanceOffset lagi sama sekali (bukan cuma mengandalkan cache lokal).
// Offline atau fetch gagal total: fallback ke window.txs + balanceOffset
// seperti sebelumnya (best effort, sama seperti pola fallback offline di
// tempat lain di codebase ini).
window._getUnclosedChildTxs = async function(book) {
    const lastClosedAt = book && book.lastClosedAt ? book.lastClosedAt : null;
    const bookId = window.currentBookId;

    if (window.isOnline()) {
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        const tagFilter = window.tagOrFilter(tag);
        const dateFilter = lastClosedAt ? `&date=gt.${encodeURIComponent(lastClosedAt)}` : '';
        const PAGE_SIZE = 1000;
        let allRows = [];
        let offset = 0;
        let fetchFailed = false;
        while (true) {
            const query = `?book_id=eq.${bookId}&is_deleted=eq.false${dateFilter}&order=date.asc&limit=${PAGE_SIZE}&offset=${offset}${tagFilter}`;
            const rows = await window.callSupabaseAPI('transactions', 'GET', null, query);
            if (rows === null) { fetchFailed = true; break; } // network/error -- callSupabaseAPI sudah toast
            if (!Array.isArray(rows) || rows.length === 0) break; // benar-benar habis (bisa nol baris, itu valid)
            allRows = allRows.concat(rows);
            if (rows.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
        }
        if (!fetchFailed) {
            // Hasil cloud lengkap & otoritatif (walau allRows kosong -- itu valid,
            // artinya memang belum ada transaksi baru sejak penutupan terakhir).
            const decoded = await Promise.all(allRows.map(r => window.decodeCloudTxRow(r)));
            let totalInc = 0, totalExp = 0;
            decoded.forEach(t => {
                const amt = Number(t.amount) || 0;
                if (t.type === 'income') totalInc += amt; else totalExp += amt;
            });
            return { txs: decoded, totalInc, totalExp, balanceOffset: 0, netTotal: totalInc - totalExp, lastClosedAt };
        }
        // fetchFailed -- lanjut ke fallback lokal di bawah.
    }

    // Offline atau cloud fetch gagal total: fallback best-effort ke cache lokal
    // (mungkin tidak lengkap untuk anak buku dengan >MAX_LOCAL_TXS transaksi).
    const txs = lastClosedAt
        ? window.txs.filter(t => {
            const d = window.parseTxDate(t.date);
            return d && !isNaN(d) && d > new Date(lastClosedAt);
          })
        : window.txs;
    const balanceOffset = lastClosedAt
        ? 0
        : (Number(localStorage.getItem('sk_balance_offset_' + bookId)) || 0);
    let totalInc = 0, totalExp = 0;
    txs.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    return { txs, totalInc, totalExp, balanceOffset, netTotal: totalInc - totalExp + balanceOffset, lastClosedAt };
};

window.openTutupAnakBuku = async function() {
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

    // Tampilkan modal dulu dengan status "menghitung", karena
    // _getUnclosedChildTxs sekarang bisa menarik data langsung dari cloud
    // (paginated) supaya totalnya lengkap -- lihat catatan [FIX LOGIKA
    // KEUANGAN] di window._getUnclosedChildTxs untuk alasannya.
    const elLoading = document.getElementById('tutupAnakBukuInfo');
    if (elLoading) elLoading.innerHTML = `<div style="padding:12px 14px; font-size:.78rem; color:var(--ink-faint);">Menghitung total transaksi...</div>`;
    const submitBtnLoading = document.getElementById('tutupAnakBukuSubmitBtn');
    if (submitBtnLoading) submitBtnLoading.disabled = true;
    window.openModal('tutupAnakBukuModal');

    // Hitung total — HANYA transaksi yang belum pernah dikirim ke induk
    // (lihat window._getUnclosedChildTxs, [BUG FIX] double-count).
    const calc = await window._getUnclosedChildTxs(book);
    const { totalInc, totalExp, netTotal } = calc;
    const txCount = calc.txs.length;
    const sinceLabel = calc.lastClosedAt
        ? `sejak penutupan terakhir (${new Date(calc.lastClosedAt).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })})`
        : 'dari seluruh riwayat (belum pernah ditutup sebelumnya)';

    // Isi modal konfirmasi
    const el = document.getElementById('tutupAnakBukuInfo');
    if (el) {
        if (txCount === 0) {
            el.innerHTML = `
                <div style="background:#F1EBDA; border:1px solid #B99A4E; border-radius: var(--radius-sm); padding:12px 14px; font-size:.78rem; line-height:1.8; color:#6B5320;">
                    Tidak ada transaksi baru ${window.escapeHtml(sinceLabel)}. Tidak ada yang perlu dikirim ke buku induk.
                </div>
            `;
        } else {
            el.innerHTML = `
                <div style="background:#E9EBF2; border:1px solid #A6AFC9; border-radius: var(--radius-sm); padding:12px 14px; font-size:.78rem; line-height:1.8;">
                    <div><b>Anak Buku:</b> ${window.escapeHtml(book.name)}</div>
                    <div><b>Kirim ke Induk:</b> ${window.escapeHtml(parentBook.name)}</div>
                    <div style="font-size:.68rem; color:#5C4E72; margin-top:2px;">Dihitung ${window.escapeHtml(sinceLabel)}</div>
                    <hr style="margin:8px 0; border-color:#DCE0E6;">
                    <div>Jumlah transaksi: <b>${txCount}</b></div>
                    <div>Total pemasukan: <b style="color:#2E6B4F">${window.rp(totalInc)}</b></div>
                    <div>Total pengeluaran: <b style="color:#A13A3A">${window.rp(totalExp)}</b></div>
                    <div><b>Net yang dikirim: <span style="color:${netTotal >= 0 ? '#2E6B4F' : '#A13A3A'}">${window.rp(Math.abs(netTotal))}</span></b>
                        ${netTotal < 0 ? ' (pengeluaran)' : ' (pemasukan)'}</div>
                </div>
                <div style="margin-top:10px; font-size:.72rem; color:#5B6472;">
                    Satu transaksi ringkasan akan ditambahkan ke buku <b>${window.escapeHtml(parentBook.name)}</b>.<br>
                    Anak buku ini <b>tidak dihapus</b> — tetap bisa dibuka sebagai arsip. Penutupan berikutnya hanya akan menghitung transaksi baru setelah ini.
                </div>
            `;
        }
    }

    // Isi default deskripsi
    const descEl = document.getElementById('tutupAnakBukuDesc');
    if (descEl) descEl.value = `Ringkasan: ${book.name}`;

    // Nonaktifkan tombol kirim kalau tidak ada transaksi baru sejak penutupan
    // terakhir — mencegah klik tak sengaja yang tidak akan mengirim apa pun.
    const submitBtn = document.getElementById('tutupAnakBukuSubmitBtn');
    if (submitBtn) submitBtn.disabled = (txCount === 0);
};

window.tutupAnakBuku = async function() {
    if (!window.requireOnline('menutup anak buku')) return;

    const book = window.books.find(b => b.id === window.currentBookId);
    if (!book || !book.parentId) return;
    const parentBook = window.books.find(b => b.id === book.parentId);
    if (!parentBook) return;

    const descEl = document.getElementById('tutupAnakBukuDesc');
    const deskripsi = (descEl ? descEl.value.trim() : '') || `Ringkasan: ${book.name}`;

    // Hitung net — HANYA transaksi yang belum pernah dikirim ke induk
    // (lihat window._getUnclosedChildTxs, [BUG FIX] double-count &
    // [FIX LOGIKA KEUANGAN] tarik lengkap dari cloud, bukan cuma window.txs).
    const calc = await window._getUnclosedChildTxs(book);
    const { netTotal } = calc;
    const closeTimestamp = new Date().toISOString();

    if (calc.txs.length === 0) {
        window.showToast('Tidak ada transaksi baru untuk dikirim sejak penutupan terakhir.', 'warning');
        return;
    }
    if (netTotal === 0) {
        // Ada transaksi baru tapi net-nya nol (income = expense persis) — tetap
        // tandai sebagai sudah ditutup supaya transaksi ini tidak dihitung lagi
        // di penutupan berikutnya, walau tidak ada apa pun yang dikirim ke induk.
        book.lastClosedAt = closeTimestamp;
        localStorage.setItem('sk_books', JSON.stringify(window.books));
        await window.pushSettingBooks();
        window.showToast('Tidak ada net transaksi untuk dikirim, tapi transaksi ini sudah ditandai selesai.', 'info');
        window.closeModal('tutupAnakBukuModal');
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

    // [BUG FIX] Tandai anak buku ini sudah ditutup pada timestamp ini, supaya
    // penutupan berikutnya HANYA menghitung transaksi baru setelah sekarang —
    // bukan mengulang seluruh riwayat lagi (mencegah double-count ke induk).
    book.lastClosedAt = closeTimestamp;
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    await window.pushSettingBooks();

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
