// ============================================================
// PAYMENT-REMINDER.JS - Supabase + Local Storage dengan Fallback
// ============================================================

function prCacheKey(bookId) {
    return 'sk_payment_reminders_' + bookId;
}

// ==================== TAHAN-BANTING: PENDING PUSH & PENDING DELETE ====================
// [FIX] Sebelumnya loadPaymentReminders() (dipanggil tiap app start & tiap
// pindah buku) MENIMPA TOTAL localStorage dengan apa pun hasil GET dari
// cloud. Kalau reminder baru dibuat/diedit saat OFFLINE (atau push-nya
// gagal karena sebab lain), savePaymentReminder() tetap mengembalikan
// `true` (dianggap "berhasil") padahal cuma tersimpan lokal -- lalu begitu
// loadPaymentReminders() jalan lagi (misalnya app di-reload), cache lokal
// itu langsung DITIMPA hasil cloud yang TIDAK PUNYA reminder itu. Reminder
// yang baru dibuat lenyap begitu saja, bahkan di device yang sama, tanpa
// pernah offline dalam pengertian "device lain".
//
// Pola di bawah ini sama seperti dirty-tracking transaksi & pending-delete:
// simpan niat (push/delete) ke localStorage SEBELUM dicoba ke cloud, baru
// dihapus SETELAH benar-benar sukses. loadPaymentReminders() sekarang
// MERGE hasil cloud dengan item yang masih pending, bukan menimpa total.
function prPendingPushKey(bookId) { return 'sk_pr_pending_push_' + bookId; }
function prPendingDeleteKey(bookId) { return 'sk_pr_pending_delete_' + bookId; }

function _prLoadPendingPush(bookId) {
    try { return JSON.parse(localStorage.getItem(prPendingPushKey(bookId)) || '{}'); }
    catch (e) { return {}; }
}
function _prSavePendingPush(bookId, obj) {
    try { localStorage.setItem(prPendingPushKey(bookId), JSON.stringify(obj)); } catch (e) {}
}
function _prMarkPendingPush(bookId, reminderData) {
    const store = _prLoadPendingPush(bookId);
    store[reminderData.id] = reminderData;
    _prSavePendingPush(bookId, store);
}
function _prClearPendingPush(bookId, id) {
    const store = _prLoadPendingPush(bookId);
    delete store[id];
    _prSavePendingPush(bookId, store);
}

function _prLoadPendingDelete(bookId) {
    try { return JSON.parse(localStorage.getItem(prPendingDeleteKey(bookId)) || '[]'); }
    catch (e) { return []; }
}
function _prSavePendingDelete(bookId, arr) {
    try { localStorage.setItem(prPendingDeleteKey(bookId), JSON.stringify(arr)); } catch (e) {}
}
function _prMarkPendingDelete(bookId, id) {
    const arr = _prLoadPendingDelete(bookId);
    if (!arr.includes(id)) arr.push(id);
    _prSavePendingDelete(bookId, arr);
}
function _prClearPendingDelete(bookId, id) {
    _prSavePendingDelete(bookId, _prLoadPendingDelete(bookId).filter(x => x !== id));
}

// Dipanggil saat app start & saat koneksi online lagi (lihat app.js), supaya
// reminder yang sempat gagal ter-push/ter-delete akhirnya nyampe ke cloud
// tanpa perlu user mengedit ulang secara manual. Tanpa argumen, fungsi ini
// menyisir SEMUA buku yang punya sisa pending (bukan cuma buku yang sedang
// aktif) -- mirror pola window.flushPendingDirtyOnStart untuk transaksi,
// supaya reminder yang dibuat di buku lain sebelum app ditutup tidak
// terlewat.
window.flushPendingPaymentReminders = async function(bookId) {
    if (!window.isOnline()) return;
    let bookIds;
    if (bookId) {
        bookIds = [bookId];
    } else {
        const ids = new Set();
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (k.startsWith('sk_pr_pending_push_')) ids.add(k.slice('sk_pr_pending_push_'.length));
            if (k.startsWith('sk_pr_pending_delete_')) ids.add(k.slice('sk_pr_pending_delete_'.length));
        }
        bookIds = Array.from(ids);
    }

    for (const bId of bookIds) {
        const pendingPush = _prLoadPendingPush(bId);
        for (const id of Object.keys(pendingPush)) {
            const ok = await window.savePaymentReminder(bId, pendingPush[id], /*skipLocalUpsert*/ true);
            if (ok) _prClearPendingPush(bId, id);
        }

        const pendingDelete = _prLoadPendingDelete(bId);
        for (const id of pendingDelete) {
            const ok = await window.deletePaymentReminder(id, bId, /*skipLocalRemove*/ true);
            if (ok) _prClearPendingDelete(bId, id);
        }
    }
};

// ── LOAD dari Supabase (dengan fallback ke Local Storage) ──
window.loadPaymentReminders = async function(bookId) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return [];
    
    // Coba dari Supabase dulu
    if (window.isOnline()) {
        try {
            const tag = window.getAccountTag ? window.getAccountTag() : null;
            const tagFilter = window.tagOrFilter(tag);
            const result = await window.callSupabaseAPI(
                'payment_reminders',
                'GET',
                null,
                `?book_id=eq.${bookId}&order=created_at.desc${tagFilter}`
            );
            
            if (result && Array.isArray(result)) {
                // [FIX] MERGE, jangan timpa total: item yang masih pending-push
                // (belum sukses di-push ke cloud) TETAP dipertahankan di cache
                // lokal walau tidak muncul di hasil cloud ini, supaya tidak
                // lenyap. Item yang masih pending-delete DIBUANG dari hasil
                // cloud (kalaupun masih ada di server), supaya tidak "hidup
                // lagi" secara visual padahal user sudah menghapusnya.
                // [SECURITY] Dekripsi field sensitif (name/note/dll) -- lihat
                // window.decodeCloudReminderRow di crypto.js.
                const decodedResult = await Promise.all(result.map(r => window.decodeCloudReminderRow(r)));
                const pendingPush = _prLoadPendingPush(bookId);
                const pendingDeleteIds = new Set(_prLoadPendingDelete(bookId));
                const merged = decodedResult.filter(r => !pendingDeleteIds.has(r.id));
                const mergedIds = new Set(merged.map(r => r.id));
                Object.values(pendingPush).forEach(r => {
                    if (!pendingDeleteIds.has(r.id) && !mergedIds.has(r.id)) merged.push(r);
                });
                localStorage.setItem(prCacheKey(bookId), JSON.stringify(merged));
                return merged;
            }
        } catch (e) {
            console.warn('[PaymentReminder] Gagal load dari Supabase:', e);
        }
    }
    
    // Fallback ke Local Storage
    try {
        const local = JSON.parse(localStorage.getItem(prCacheKey(bookId)) || '[]');
        return local.filter(r => r.book_id === bookId);
    } catch {
        return [];
    }
};

// ── SAVE ke Supabase + Local Storage ──
window.savePaymentReminder = async function(bookId, reminderData, skipLocalUpsert) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return false;
    
    // Simpan ke Local Storage dulu (cache) -- dilewati saat dipanggil dari
    // flushPendingPaymentReminders() karena item itu sudah ada di cache.
    if (!skipLocalUpsert) {
        let localReminders = [];
        try {
            localReminders = JSON.parse(localStorage.getItem(prCacheKey(bookId)) || '[]');
            const index = localReminders.findIndex(r => r.id === reminderData.id);
            if (index >= 0) {
                localReminders[index] = { ...reminderData, book_id: bookId };
            } else {
                localReminders.push({ ...reminderData, book_id: bookId });
            }
            localStorage.setItem(prCacheKey(bookId), JSON.stringify(localReminders));
        } catch (e) {
            console.warn('[PaymentReminder] Gagal save ke localStorage:', e);
        }
    }

    // [FIX] Tandai dulu sebagai "pending push" SEBELUM mencoba ke cloud --
    // kalau gagal/offline, catatan ini tetap ada dan dicoba lagi otomatis
    // oleh window.flushPendingPaymentReminders() (app start / online lagi).
    _prMarkPendingPush(bookId, { ...reminderData, book_id: bookId });
    
    // Kirim ke Supabase
    if (window.isOnline()) {
        try {
            const tag = window.getAccountTag ? window.getAccountTag() : null;
            // [SECURITY] name/note/day/recurrence/month dienkripsi jadi satu
            // kolom enc_payload -- lihat window.encodeCloudReminderPayload.
            const encPayload = await window.encodeCloudReminderPayload(reminderData);
            const payload = encPayload
                ? { id: reminderData.id, book_id: bookId, enc_payload: encPayload, name: null, day: null, recurrence: null, month: null, note: null, created_at: reminderData.created_at, updated_at: new Date().toISOString(), ...(tag ? { account_tag: tag } : {}) }
                : { ...reminderData, book_id: bookId, updated_at: new Date().toISOString(), ...(tag ? { account_tag: tag } : {}) };

            const result = await window.callSupabaseAPI('payment_reminders', 'POST', [payload]);
            if (result) {
                console.log('[PaymentReminder] Berhasil sync ke cloud');
                _prClearPendingPush(bookId, reminderData.id);
                return true;
            }
        } catch (e) {
            console.error('[PaymentReminder] Gagal save ke Supabase:', e);
            window.showToast('Data tersimpan lokal, gagal sync ke cloud', 'warning');
        }
        // Gagal push walau online: tetap tersimpan lokal (pending), akan
        // dicoba lagi otomatis. Beri tahu pemanggil ini belum benar-benar
        // tersinkron, tapi jangan hilangkan data yang sudah tersimpan lokal.
        return true;
    }
    
    // Offline: tetap "berhasil" secara lokal, pending push akan di-flush
    // otomatis begitu online lagi.
    return true;
};

// ── DELETE dari Supabase + Local Storage ──
window.deletePaymentReminder = async function(reminderId, bookId, skipLocalRemove) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId) return false;
    
    // Hapus dari Local Storage -- dilewati saat dipanggil dari
    // flushPendingPaymentReminders() karena item itu sudah dibuang duluan.
    if (!skipLocalRemove) {
        try {
            let localReminders = JSON.parse(localStorage.getItem(prCacheKey(bookId)) || '[]');
            localReminders = localReminders.filter(r => r.id !== reminderId);
            localStorage.setItem(prCacheKey(bookId), JSON.stringify(localReminders));
        } catch (e) {
            console.warn('[PaymentReminder] Gagal hapus dari localStorage:', e);
        }
        // Kalau reminder ini masih pending-push (belum sempat sampai ke
        // cloud sama sekali), tidak perlu lagi didorong -- cukup batalkan.
        _prClearPendingPush(bookId, reminderId);
    }

    // [FIX] Tandai pending-delete SEBELUM mencoba ke cloud, supaya kalau
    // gagal/koneksi putus, penghapusan ini tetap tercatat dan dicoba lagi
    // otomatis (bukan diam-diam batal, baris "hidup lagi" di pull berikutnya).
    _prMarkPendingDelete(bookId, reminderId);
    
    // Hapus dari Supabase
    if (window.isOnline()) {
        try {
            const tag = window.getAccountTag ? window.getAccountTag() : null;
            const tagFilter = tag ? `&account_tag=eq.${tag}` : '';
            const result = await window.callSupabaseAPI(
                'payment_reminders',
                'DELETE',
                null,
                `?id=eq.${reminderId}&book_id=eq.${bookId}${tagFilter}`
            );
            if (result) {
                console.log('[PaymentReminder] Berhasil hapus dari cloud');
                _prClearPendingDelete(bookId, reminderId);
                return true;
            }
        } catch (e) {
            console.error('[PaymentReminder] Gagal hapus dari Supabase:', e);
            window.showToast('Data lokal terhapus, gagal sync ke cloud', 'warning');
        }
        // Gagal hapus di cloud walau online: tetap dianggap "berhasil" secara
        // lokal (sudah hilang dari layar), pending-delete akan di-flush
        // otomatis begitu koneksi/permintaan berhasil.
        return true;
    }
    
    return true;
};

// ── SYNC ALL (push semua data lokal ke cloud) ──
window.syncAllPaymentReminders = async function(bookId) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId || !window.isOnline()) return false;
    
    try {
        const localReminders = JSON.parse(localStorage.getItem(prCacheKey(bookId)) || '[]')
            .filter(r => r.book_id === bookId);
        
        if (localReminders.length === 0) return true;
        
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        // [SECURITY] Enkripsi field sensitif -- lihat window.encodeCloudReminderPayload.
        const payload = await Promise.all(localReminders.map(async r => {
            const encPayload = await window.encodeCloudReminderPayload(r);
            if (encPayload) {
                return { id: r.id, book_id: bookId, enc_payload: encPayload, name: null, day: null, recurrence: null, month: null, note: null, created_at: r.created_at, updated_at: new Date().toISOString(), ...(tag ? { account_tag: tag } : {}) };
            }
            return { ...r, updated_at: new Date().toISOString(), ...(tag ? { account_tag: tag } : {}) };
        }));
        
        const result = await window.callSupabaseAPI('payment_reminders', 'POST', payload);
        return !!result;
    } catch (e) {
        console.error('[PaymentReminder] Gagal sync all:', e);
        return false;
    }
};

// ── MIGRASI data dari key lama ke Supabase ──
window.migratePaymentReminders = async function(bookId) {
    if (!bookId) bookId = window.currentBookId;
    if (!bookId || !window.isOnline()) return;
    
    // Cek apakah sudah ada data di Supabase
    try {
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        const tagFilter = window.tagOrFilter(tag);
        const existing = await window.callSupabaseAPI(
            'payment_reminders',
            'GET',
            null,
            `?book_id=eq.${bookId}&order=updated_at.desc&limit=1${tagFilter}`
        );
        if (existing && Array.isArray(existing) && existing.length > 0) {
            console.log('[PaymentReminder] Data sudah ada di cloud, skip migrasi');
            return;
        }
    } catch (e) {
        console.warn('[PaymentReminder] Gagal cek data existing:', e);
    }
    
    // Ambil dari Local Storage
    let localReminders = [];
    try {
        localReminders = JSON.parse(localStorage.getItem(prCacheKey(bookId)) || '[]');
        if (localReminders.length === 0) {
            // Migrasi dari key lama (global, sebelum per-buku) bila masih ada
            const oldGlobalKey = 'sk_payment_reminders';
            const oldGlobalData = JSON.parse(localStorage.getItem(oldGlobalKey) || '[]');
            const oldGlobalForBook = oldGlobalData.filter(r => r.book_id === bookId);
            if (oldGlobalForBook.length > 0) {
                localReminders = oldGlobalForBook;
                localStorage.setItem(prCacheKey(bookId), JSON.stringify(localReminders));
            }
        }
        if (localReminders.length === 0) {
            const oldKey = 'sinarkeu_payment_reminders';
            const oldData = localStorage.getItem(oldKey);
            if (oldData) {
                localReminders = JSON.parse(oldData);
                localReminders = localReminders.map(r => ({
                    ...r,
                    book_id: bookId,
                    id: r.id || 'pr_' + Date.now() + '_' + Math.random().toString(36).slice(2,7)
                }));
                localStorage.setItem(prCacheKey(bookId), JSON.stringify(localReminders));
                localStorage.removeItem(oldKey);
            }
        }
    } catch (e) {
        console.warn('[PaymentReminder] Gagal baca data lokal:', e);
        return;
    }
    
    if (localReminders.length === 0) return;
    
    const toMigrate = localReminders.filter(r => r.book_id === bookId);
    if (toMigrate.length === 0) return;
    
    console.log(`[PaymentReminder] Migrasi ${toMigrate.length} data ke cloud...`);
    
    try {
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        // [SECURITY] Enkripsi field sensitif -- lihat window.encodeCloudReminderPayload.
        const payload = await Promise.all(toMigrate.map(async r => {
            const encPayload = await window.encodeCloudReminderPayload(r);
            if (encPayload) {
                return { id: r.id, book_id: r.book_id || bookId, enc_payload: encPayload, name: null, day: null, recurrence: null, month: null, note: null, created_at: r.created_at, updated_at: new Date().toISOString(), ...(tag ? { account_tag: tag } : {}) };
            }
            return { ...r, updated_at: new Date().toISOString(), ...(tag ? { account_tag: tag } : {}) };
        }));
        await window.callSupabaseAPI('payment_reminders', 'POST', payload);
        console.log('[PaymentReminder] Migrasi berhasil!');
        window.showToast(`${toMigrate.length} jadwal pembayaran berhasil dimigrasi ke cloud`, 'success');
    } catch (e) {
        console.error('[PaymentReminder] Gagal migrasi:', e);
    }
};

// ── RENDER ULANG (override fungsi existing di index.html) ──
window.renderPaymentReminders = async function() {
    const bookId = window.currentBookId;
    if (!bookId) return;
    
    const list = await window.loadPaymentReminders(bookId);
    const container = document.getElementById('prList');
    const upcomingAlert = document.getElementById('prUpcomingAlert');
    if (!container) return;
    
    if (list.length === 0) {
        container.innerHTML = '<div id="prEmptyMsg" style="font-size:.72rem; color:var(--ink-faint); text-align:center; padding:18px 0;">Belum ada jadwal pembayaran. Tambahkan di bawah.</div>';
        if (upcomingAlert) upcomingAlert.style.display = 'none';
        return;
    }
    
    // Sort by days until next
    const sorted = list.map(item => ({ item, ...window.getDaysUntilNext(item) }))
                       .sort((a, b) => a.days - b.days);
    
    const urgent = sorted.filter(s => s.days <= 3);
    if (urgent.length > 0 && upcomingAlert) {
        upcomingAlert.style.display = 'block';
        upcomingAlert.style.background = 'var(--warning-lt)';
        upcomingAlert.style.border = '1.5px solid var(--warning)';
        upcomingAlert.style.color = 'var(--warning)';
        upcomingAlert.innerHTML = '<strong>Segera jatuh tempo:</strong><br>' +
            urgent.map(s => {
                const label = s.days === 0 ? 'Hari ini!' : `${s.days} hari lagi`;
                return `• ${window.escapeHtml(s.item.name)} — ${window.formatNextDate(s.item)} <strong>${label}</strong>`;
            }).join('<br>');
    } else if (upcomingAlert) {
        upcomingAlert.style.display = 'none';
    }
    
    container.innerHTML = '';
    sorted.forEach(({ item, days }) => {
        const isUrgent = days <= 3;
        const recLabel = item.recurrence === 'monthly'
            ? `Bulanan — tgl ${item.day}`
            : `Tahunan — ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][item.month-1]} tgl ${item.day}`;
        const dayLabel = days === 0 ? 'Hari ini!' : `${days} hari lagi`;
        
        const el = document.createElement('div');
        el.style.cssText = `display:flex; align-items:center; gap:10px; background:${isUrgent ? 'var(--warning-lt)' : 'var(--paper-warm)'}; border:1.5px solid ${isUrgent ? 'var(--warning)' : 'var(--rule)'}; border-radius:8px; padding:10px 12px;`;
        el.innerHTML = `
            <div style="flex:1; min-width:0;">
                <div style="font-size:.8rem; font-weight:700; color:var(--ink);">${window.escapeHtml(item.name)}</div>
                <div style="font-size:.68rem; color:var(--ink-muted); margin-top:2px;">${recLabel} &nbsp;·&nbsp; Berikutnya: ${window.formatNextDate(item)}</div>
                ${item.note ? `<div style="font-size:.65rem; color:var(--ink-faint); margin-top:2px; font-style:italic;">${window.escapeHtml(item.note)}</div>` : ''}
            </div>
            <div style="font-size:.68rem; font-weight:700; white-space:nowrap; color:${isUrgent ? 'var(--warning)' : 'var(--ink-muted)'};">${dayLabel}</div>
            <div style="display:flex; gap:4px;">
                <button onclick="window.editPaymentReminder('${item.id}')" style="background:none; border:1px solid var(--rule); border-radius:5px; padding:3px 7px; cursor:pointer; font-size:.7rem; color:var(--ink-muted);" title="Edit">Edit</button>
                <button onclick="window.deletePaymentReminderHandler('${item.id}')" style="background:none; border:1px solid var(--danger-lt); border-radius:5px; padding:3px 7px; cursor:pointer; font-size:.7rem; color:var(--danger);" title="Hapus">Hapus</button>
            </div>
        `;
        container.appendChild(el);
    });
    
    window.updatePaymentReminderBanner(list);
};

// ── HANDLER SAVE ──
window.savePaymentReminderHandler = async function() {
    const bookId = window.currentBookId;
    if (!bookId) {
        window.showToast('Buku tidak ditemukan', 'error');
        return;
    }
    
    const name = document.getElementById('prName').value.trim();
    const day = parseInt(document.getElementById('prDay').value);
    const recurrence = document.getElementById('prRecurrence').value;
    const month = parseInt(document.getElementById('prMonth').value) || 1;
    const note = document.getElementById('prNote').value.trim();
    const editId = document.getElementById('prEditId').value;
    const statusEl = document.getElementById('prFormStatus');
    
    if (!name) { statusEl.textContent = 'Isi jenis pembayaran.'; return; }
    if (!day || day < 1 || day > 31) { statusEl.textContent = 'Tanggal harus antara 1–31.'; return; }
    statusEl.textContent = '';
    
    const reminderData = {
        id: editId || 'pr_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
        name,
        day,
        recurrence,
        month,
        note: note || '',
        created_at: new Date().toISOString()
    };
    
    const success = await window.savePaymentReminder(bookId, reminderData);
    if (success) {
        window.showToast('Jadwal pembayaran disimpan!', 'success');
        window.cancelPrEdit();
        await window.renderPaymentReminders();
        window.updatePaymentReminderBanner();
    } else {
        window.showToast('Gagal menyimpan jadwal', 'error');
    }
};

// ── HANDLER DELETE ──
window.deletePaymentReminderHandler = async function(id) {
    if (!confirm('Hapus jadwal pembayaran ini?')) return;
    
    const bookId = window.currentBookId;
    if (!bookId) return;
    
    const success = await window.deletePaymentReminder(id, bookId);
    if (success) {
        window.showToast('Jadwal dihapus', 'success');
        await window.renderPaymentReminders();
        window.updatePaymentReminderBanner();
    } else {
        window.showToast('Gagal menghapus jadwal', 'error');
    }
};

// ── HANDLER EDIT ──
window.editPaymentReminder = async function(id) {
    const bookId = window.currentBookId;
    if (!bookId) return;
    
    const list = await window.loadPaymentReminders(bookId);
    const item = list.find(r => r.id === id);
    if (!item) return;
    
    document.getElementById('prEditId').value = item.id;
    document.getElementById('prName').value = item.name;
    document.getElementById('prDay').value = item.day;
    document.getElementById('prRecurrence').value = item.recurrence;
    document.getElementById('prMonth').value = item.month || 1;
    document.getElementById('prNote').value = item.note || '';
    document.getElementById('prFormTitle').textContent = 'Edit Jadwal';
    document.getElementById('prFormStatus').textContent = '';
    window.togglePrMonthField();
};

// ── UPDATE BANNER ──
window.updatePaymentReminderBanner = function(list) {
    if (!list) {
        const bookId = window.currentBookId;
        try { list = bookId ? JSON.parse(localStorage.getItem(prCacheKey(bookId)) || '[]') : []; }
        catch { list = []; }
    }
    
    const urgent = list.map(item => ({ item, ...window.getDaysUntilNext(item) }))
                       .filter(s => s.days <= 3)
                       .sort((a, b) => a.days - b.days);
    
    const banner = document.getElementById('paymentReminderBanner');
    const bannerText = document.getElementById('paymentReminderBannerText');
    const badge = document.getElementById('reminderBadge');
    const drawerBadge = document.getElementById('drawerReminderBadge');
    
    if (urgent.length > 0) {
        if (banner) {
            banner.style.display = 'block';
            banner.style.background = 'var(--warning-lt)';
            banner.style.border = '1.5px solid var(--warning)';
            const titleEl = banner.querySelector('.pr-banner-title');
            const textEl = banner.querySelector('.pr-banner-text');
            if (titleEl) titleEl.style.color = 'var(--warning)';
            if (textEl) textEl.style.color = 'var(--ink-muted)';
            bannerText.innerHTML = urgent.map(s => {
                const label = s.days === 0 ? `<strong style="color:var(--danger)">Hari ini!</strong>` : `<strong>${s.days} hari lagi</strong>`;
                return `<strong>${window.escapeHtml(s.item.name)}</strong> — ${window.formatNextDate(s.item)} · ${label}`;
            }).join('<br>');
        }
        if (badge) { badge.style.display = 'inline-block'; badge.textContent = urgent.length; }
        if (drawerBadge) { drawerBadge.style.display = 'inline-block'; drawerBadge.textContent = urgent.length + ' mendesak'; }
    } else {
        if (banner) banner.style.display = 'none';
        if (badge) badge.style.display = 'none';
        if (drawerBadge) drawerBadge.style.display = 'none';
    }
};

// ── HELPER FUNCTIONS ──
window.getDaysUntilNext = function(item) {
    const today = new Date();
    today.setHours(0,0,0,0);
    let candidate;
    
    function daysInMonth(year, monthIndex) {
        return new Date(year, monthIndex + 1, 0).getDate();
    }
    function clampDay(year, monthIndex, day) {
        return Math.min(day, daysInMonth(year, monthIndex));
    }
    
    if (item.recurrence === 'monthly') {
        let y = today.getFullYear(), m = today.getMonth();
        candidate = new Date(y, m, clampDay(y, m, item.day));
        if (candidate < today) {
            m += 1;
            if (m > 11) { m = 0; y += 1; }
            candidate = new Date(y, m, clampDay(y, m, item.day));
        }
    } else {
        let y = today.getFullYear();
        candidate = new Date(y, item.month - 1, clampDay(y, item.month - 1, item.day));
        if (candidate < today) {
            y += 1;
            candidate = new Date(y, item.month - 1, clampDay(y, item.month - 1, item.day));
        }
    }
    const diff = Math.round((candidate - today) / (1000 * 60 * 60 * 24));
    return { days: diff, date: candidate };
};

window.formatNextDate = function(item) {
    const { date } = window.getDaysUntilNext(item);
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
};

window.cancelPrEdit = function() {
    document.getElementById('prEditId').value = '';
    document.getElementById('prName').value = '';
    document.getElementById('prDay').value = '';
    document.getElementById('prRecurrence').value = 'monthly';
    document.getElementById('prMonth').value = '1';
    document.getElementById('prNote').value = '';
    document.getElementById('prFormTitle').textContent = '＋ Tambah Jadwal Baru';
    document.getElementById('prFormStatus').textContent = '';
    const mg = document.getElementById('prMonthGroup');
    if (mg) mg.style.display = 'none';
};

window.togglePrMonthField = function() {
    const rec = document.getElementById('prRecurrence').value;
    const mg = document.getElementById('prMonthGroup');
    if (mg) mg.style.display = rec === 'yearly' ? 'block' : 'none';
};

window.openPaymentReminderModal = function() {
    window.renderPaymentReminders();
    window.cancelPrEdit();
    window.openModal('paymentReminderModal');
};
