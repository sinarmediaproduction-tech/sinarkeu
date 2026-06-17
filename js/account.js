// ==================== MULTI-ACCOUNT ENGINE ====================
window.getAllAccounts = function() {
    try { return JSON.parse(localStorage.getItem('sk_accounts') || '[]'); } catch { return []; }
};
window.saveAllAccounts = function(list) { localStorage.setItem('sk_accounts', JSON.stringify(list)); };
window.getActiveAccountId = function() { return localStorage.getItem('sk_active_account') || null; };
window._setActiveAccountId = function(id) { localStorage.setItem('sk_active_account', id); };

window._nsKey = function(accId, rawKey) { return 'sk_a' + accId + '_' + rawKey.slice(3); };
window._collectActiveKeys = function() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sk_') && !window.ACC_GLOBAL_KEYS.has(k) && !k.startsWith('sk_a')) keys.push(k);
    }
    return keys;
};
window._saveOutAccount = function(accId) {
    const nsPrefix = 'sk_a' + accId + '_';
    const oldSnap = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(nsPrefix)) oldSnap.push(k);
    }
    oldSnap.forEach(k => localStorage.removeItem(k));
    window._collectActiveKeys().forEach(k => {
        const v = localStorage.getItem(k);
        if (v !== null) localStorage.setItem(window._nsKey(accId, k), v);
    });
};
window._clearActiveKeys = function() {
    const keys = window._collectActiveKeys();
    keys.forEach(k => localStorage.removeItem(k));
};
window._restoreInAccount = function(accId) {
    const nsPrefix = 'sk_a' + accId + '_';
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(nsPrefix)) {
            const canonical = 'sk_' + k.slice(nsPrefix.length);
            localStorage.setItem(canonical, localStorage.getItem(k));
        }
    }
};
window.isAccountConfigured = function(accId) {
    const checkKey = 'sk_a' + accId + '_enc_supabase_url';
    if (localStorage.getItem(checkKey)) return true;
    if (window.getActiveAccountId() === accId && localStorage.getItem('sk_enc_supabase_url')) return true;
    return false;
};

window._pendingUnlockAccId = null;

window.switchAccount = function(accId) {
    const accounts = window.getAllAccounts();
    const acc = accounts.find(a => a.id === accId);
    if (!acc) return;
    const currentId = window.getActiveAccountId();
    if (accId === currentId) return;
    if (!window.isAccountConfigured(accId)) { window.openAccountManager(accId); return; }
    const sessKey = 'sk_acc_sess_' + accId;
    if (!sessionStorage.getItem(sessKey)) {
        window._pendingUnlockAccId = accId;
        document.getElementById('accUnlockTitle').innerText = '🔑 Buka "' + acc.name + '"';
        document.getElementById('accUnlockSubtitle').innerText = 'Masukkan password enkripsi untuk akun ' + acc.name;
        document.getElementById('accUnlockPwdInput').value = '';
        document.getElementById('accUnlockStatus').innerText = '';
        window.openModal('accountUnlockModal');
        return;
    }
    window._doSwitch(currentId, accId);
};

window._doSwitch = function(fromId, toId) {
    localStorage.setItem('sk_switching_in_progress', JSON.stringify({ fromId, toId, ts: Date.now() }));
    if (fromId) window._saveOutAccount(fromId);
    window._clearActiveKeys();
    window._restoreInAccount(toId);
    const nsHasBooks = localStorage.getItem('sk_a' + toId + '_books');
    if (!nsHasBooks && !localStorage.getItem('sk_books')) {
        const defaultBook = [{ id: 'b_default', name: 'Buku Utama' }];
        localStorage.setItem('sk_books', JSON.stringify(defaultBook));
        localStorage.setItem('sk_current_book_id', 'b_default');
    }
    window._setActiveAccountId(toId);
    localStorage.removeItem('sk_switching_in_progress');
    sessionStorage.setItem('sk_session_unlocked', '1');
    location.reload();
};

window.submitAccountUnlock = async function() {
    const pwd = document.getElementById('accUnlockPwdInput').value;
    const st  = document.getElementById('accUnlockStatus');
    if (!pwd) { st.innerText = 'Masukkan password terlebih dahulu.'; return; }
    st.innerText = '⏳ Memverifikasi...';
    const accId = window._pendingUnlockAccId;
    const nsPrefix = 'sk_a' + accId + '_';
    const saltKey  = nsPrefix + 'crypto_salt';
    const checkKey = nsPrefix + 'crypto_check';
    const saltB64  = localStorage.getItem(saltKey);
    const checkEnc = localStorage.getItem(checkKey);
    if (!saltB64 || !checkEnc) { st.innerText = '❌ Data enkripsi tidak ditemukan.'; return; }
    try {
        const salt  = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
        const key   = await window.deriveKey(pwd, salt);
        const plain = await window.decryptStr(key, checkEnc);
        if (plain !== 'sinarkeu_ok') throw new Error('wrong');
    } catch { st.innerText = '❌ Password salah. Coba lagi.'; return; }
    sessionStorage.setItem('sk_acc_sess_' + accId, '1');
    window.closeModal('accountUnlockModal');
    window.showToast('Membuka akun...', 'info');
    const currentId = window.getActiveAccountId();
    window._doSwitch(currentId, accId);
};

window.openAccountManager = function(highlightId) { window.renderAccModalList(highlightId); window.cancelEditAccount(); window.openModal('accountManagerModal'); };
window.renderAccModalList = function(highlightId) {
    const accounts = window.getAllAccounts();
    const activeId = window.getActiveAccountId();
    const el = document.getElementById('accModalList');
    if (!accounts.length) { el.innerHTML = '<div style="text-align:center;color:#aaa;font-size:.75rem;padding:10px 0;">Belum ada akun tersimpan.</div>'; return; }
    el.innerHTML = accounts.map(acc => {
        const isActive  = acc.id === activeId;
        const hasConfig = window.isAccountConfigured(acc.id);
        const hasSess   = !!sessionStorage.getItem('sk_acc_sess_' + acc.id);
        const badge = isActive ? '<span class="acc-modal-item-badge acc-badge-active">● Aktif</span>' : (hasSess ? '<span class="acc-modal-item-badge" style="background:#e8f0fe;color:#1a56db;">Terbuka</span>' : (hasConfig ? '<span class="acc-modal-item-badge acc-badge-locked">🔒 Terkunci</span>' : '<span class="acc-modal-item-badge acc-badge-noconn">Belum setup</span>'));
        return `<div class="acc-modal-item${isActive ? ' current' : ''}" onclick="window.handleAccModalItemClick('${acc.id}')">
            <div><div class="acc-modal-item-name">${window.escapeHtml(acc.name)}</div></div>
            <div class="acc-item-actions">${badge}<button class="btn-mini" onclick="event.stopPropagation(); window.editAccount('${acc.id}')">✏️</button>${!isActive ? `<button class="btn-mini btn-mini-danger" onclick="event.stopPropagation(); window.deleteAccount('${acc.id}')">🗑️</button>` : ''}</div>
        </div>`;
    }).join('');
};
window.handleAccModalItemClick = function(accId) { if (accId === window.getActiveAccountId()) return; window.closeModal('accountManagerModal'); window.switchAccount(accId); };
window.editAccount = function(accId) {
    const acc = window.getAllAccounts().find(a => a.id === accId);
    if (!acc) return;
    document.getElementById('editingAccId').value = accId;
    document.getElementById('newAccName').value = acc.name || '';
    document.getElementById('newAccUrl').value = '';
    document.getElementById('newAccKey').value = '';
    document.getElementById('newAccPwd').value = '';
    document.getElementById('newAccPwd').placeholder = 'Isi untuk update password / credentials';
    document.getElementById('newAccStatus').innerText = '⚠️ Isi URL, Key, dan Password baru untuk memperbarui koneksi.';
};
window.cancelEditAccount = function() {
    document.getElementById('editingAccId').value = '';
    document.getElementById('newAccName').value = '';
    document.getElementById('newAccUrl').value = '';
    document.getElementById('newAccKey').value = '';
    document.getElementById('newAccPwd').value = '';
    document.getElementById('newAccPwd').placeholder = 'Min. 6 karakter — wajib diingat!';
    document.getElementById('newAccStatus').innerText = '';
};
window.saveNewAccount = async function() {
    const editId = document.getElementById('editingAccId').value.trim();
    const name   = document.getElementById('newAccName').value.trim();
    const url    = document.getElementById('newAccUrl').value.trim();
    const key    = document.getElementById('newAccKey').value.trim();
    const pwd    = document.getElementById('newAccPwd').value;
    const st     = document.getElementById('newAccStatus');
    if (!name) { st.style.color='#de350b'; st.innerText='❌ Nama akun wajib diisi!'; return; }
    const isEdit = !!editId;
    const hasCredentials = url && key && pwd;
    if (!isEdit && (!url || !key || !pwd || pwd.length < 6)) { st.style.color='#de350b'; st.innerText='❌ URL, Anon Key, dan Password (min 6 karakter) wajib diisi!'; return; }
    if (isEdit && hasCredentials && pwd.length < 6) { st.style.color='#de350b'; st.innerText='❌ Password minimal 6 karakter!'; return; }
    let accounts = window.getAllAccounts();
    const accId  = editId || ('acc_' + Date.now());
    if (isEdit) { const idx = accounts.findIndex(a => a.id === editId); if (idx >= 0) accounts[idx].name = name; }
    else accounts.push({ id: accId, name });
    if (hasCredentials) {
        st.style.color='#888'; st.innerText='⏳ Mengetes koneksi ke Supabase...';
        const oldUrl = window.globalSupabaseUrl, oldKey = window.globalSupabaseKey;
        window.globalSupabaseUrl = url; window.globalSupabaseKey = key;
        const test = await window.callSupabaseAPI('transactions', 'GET', null, '?limit=1');
        window.globalSupabaseUrl = oldUrl; window.globalSupabaseKey = oldKey;
        if (test === null) { st.style.color='#de350b'; st.innerText='❌ Koneksi gagal! Periksa URL dan Anon Key.'; return; }
        st.innerText = '⏳ Mengenkripsi dan menyimpan...';
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const saltB64 = btoa(String.fromCharCode(...salt));
        const cryptoKey = await window.deriveKey(pwd, salt);
        const encUrl   = await window.encryptStr(cryptoKey, url);
        const encAKey  = await window.encryptStr(cryptoKey, key);
        const encCheck = await window.encryptStr(cryptoKey, 'sinarkeu_ok');
        const ns = 'sk_a' + accId + '_';
        if (isEdit && accId === window.getActiveAccountId()) {
            localStorage.setItem('sk_crypto_salt', saltB64);
            localStorage.setItem('sk_crypto_check', encCheck);
            localStorage.setItem('sk_enc_supabase_url', encUrl);
            localStorage.setItem('sk_enc_supabase_key', encAKey);
            window.globalSupabaseUrl = url;
            window.globalSupabaseKey = key;
            await window.setupNewPassword(pwd, url, key);
        }
        localStorage.setItem(ns + 'crypto_salt', saltB64);
        localStorage.setItem(ns + 'crypto_check', encCheck);
        localStorage.setItem(ns + 'enc_supabase_url', encUrl);
        localStorage.setItem(ns + 'enc_supabase_key', encAKey);
        sessionStorage.setItem('sk_acc_sess_' + accId, '1');
    }
    window.saveAllAccounts(accounts);
    st.style.color='#00875a';
    st.innerText = isEdit ? '✅ Akun berhasil diperbarui!' : '✅ Akun berhasil ditambahkan!';
    window.showToast(isEdit ? 'Akun diperbarui!' : 'Akun baru ditambahkan!', 'success');
    window.cancelEditAccount();
    window.renderAccModalList();
    window.renderAccountBar();
    if (!isEdit && (!window.getActiveAccountId() || accounts.length === 1)) {
        window._setActiveAccountId(accId);
        setTimeout(() => { window.closeModal('accountManagerModal'); location.reload(); }, 800);
    }
};
window.deleteAccount = async function(accId) {
    const acc = window.getAllAccounts().find(a => a.id === accId);
    if (!acc) return;
    if (!confirm(`Hapus akun "${acc.name}"?\n\nData lokal akun ini akan dihapus dari browser. Data di Supabase TIDAK terpengaruh.`)) return;
    const nsPrefix = 'sk_a' + accId + '_';
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(nsPrefix)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    sessionStorage.removeItem('sk_acc_sess_' + accId);
    let accounts = window.getAllAccounts().filter(a => a.id !== accId);
    window.saveAllAccounts(accounts);
    if (window.getActiveAccountId() === accId) {
        if (accounts.length > 0) {
            const nextId = accounts[0].id;
            window._clearActiveKeys();
            window._restoreInAccount(nextId);
            window._setActiveAccountId(nextId);
        } else {
            window._clearActiveKeys();
            localStorage.removeItem('sk_active_account');
        }
        location.reload();
        return;
    }
    window.renderAccModalList();
    window.renderAccountBar();
    window.showToast('Akun dihapus.', 'success');
};

window.renderAccountBar = function() { window.renderLockScreenPicker(); window.updateActiveAccountLabel(); };
window.renderLockScreenPicker = function() {
    const accounts = window.getAllAccounts();
    const activeId = window.getActiveAccountId();
    const el = document.getElementById('lockAccountPicker');
    if (!el) return;
    if (accounts.length <= 1) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = accounts.map(acc => {
        const isSelected = acc.id === activeId;
        const initials = acc.name.slice(0, 2).toUpperCase();
        const hasConfig = window.isAccountConfigured(acc.id);
        const sub = hasConfig ? 'Sudah terkonfigurasi' : 'Belum setup';
        return `<button class="lock-account-item${isSelected ? ' selected' : ''}" onclick="window.selectLockAccount(event, '${acc.id}')">
            <div class="lock-account-avatar">${initials}</div>
            <div class="lock-account-info"><div class="lock-account-name">${window.escapeHtml(acc.name)}</div><div class="lock-account-sub">${sub}</div></div>
            <span class="lock-account-check">&#10003;</span>
        </button>`;
    }).join('');
};
window.selectLockAccount = function(e, accId) {
    document.querySelectorAll('.lock-account-item').forEach(el => el.classList.remove('selected'));
    e.currentTarget.classList.add('selected');
    const currentActiveId = window.getActiveAccountId();
    if (accId !== currentActiveId) {
        if (currentActiveId) window._saveOutAccount(currentActiveId);
        window._clearActiveKeys();
        window._restoreInAccount(accId);
        window._setActiveAccountId(accId);
    }
    document.getElementById('lockPasswordInput').value = '';
    document.getElementById('lockStatus').innerText = '';
    document.getElementById('lockPasswordInput').focus();
};
window.updateActiveAccountLabel = function() {
    const accounts = window.getAllAccounts();
    const activeId = window.getActiveAccountId();
    const acc = accounts.find(a => a.id === activeId);
    const el = document.getElementById('activeAccountLabel');
    if (el && acc) el.innerText = '👤 ' + acc.name;
};
window.logoutToLockScreen = function() {
    sessionStorage.removeItem('sk_session_unlocked');
    sessionStorage.removeItem('sk_session_url');
    sessionStorage.removeItem('sk_session_akey');
    sessionStorage.removeItem('sk_session_ts');
    location.reload();
};
window.openAccountManagerFromLock = function() {
    document.getElementById('passwordLockScreen').style.display = 'none';
    window.openAccountManager();
    // Gunakan flag, bukan override global closeModal
    window._fromLockScreen = true;
};

// Patch closeModal agar aman: cek flag _fromLockScreen
const _origCloseModal = window.closeModal;
window.closeModal = function(id) {
    _origCloseModal(id);
    if (id === 'accountManagerModal' && window._fromLockScreen) {
        window._fromLockScreen = false;
        window.renderLockScreenPicker();
        document.getElementById('passwordLockScreen').style.display = 'flex';
    }
};
window.bootstrapMultiAccount = function() {
    const pendingSwitch = localStorage.getItem('sk_switching_in_progress');
    if (pendingSwitch) {
        try {
            const { toId } = JSON.parse(pendingSwitch);
            console.warn('[MultiAccount] Terdeteksi crash saat switch. Memulihkan ke akun:', toId);
            localStorage.removeItem('sk_switching_in_progress');
            window._clearActiveKeys();
            window._restoreInAccount(toId);
            window._setActiveAccountId(toId);
            sessionStorage.setItem('sk_session_unlocked', '1');
        } catch (e) { console.error('[MultiAccount] Gagal memulihkan dari crash switch:', e); localStorage.removeItem('sk_switching_in_progress'); }
    }
    let accounts = window.getAllAccounts();
    if (accounts.length === 0) {
        const defaultAcc = { id: 'acc_default', name: 'Akun Utama' };
        accounts = [defaultAcc];
        window.saveAllAccounts(accounts);
        window._setActiveAccountId('acc_default');
        sessionStorage.setItem('sk_acc_sess_acc_default', '1');
    }
    let activeId = window.getActiveAccountId();
    if (!activeId || !accounts.find(a => a.id === activeId)) {
        activeId = accounts[0].id;
        window._setActiveAccountId(activeId);
    }
    sessionStorage.setItem('sk_acc_sess_' + activeId, '1');
    window.renderAccountBar();
};