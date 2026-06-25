// ==================== APP INITIALIZATION ====================
window.updateSyncStatusBadge = function() {
    const wrapper = document.getElementById('syncStatusWrapper');
    const tag = document.getElementById('syncStatusTag');
    const online = window.isOnline();
    if (online && window.getCloudUrl() && window.getSupabaseKey()) {
        wrapper.className = 'sync-status-container online';
        tag.innerHTML = '☁️ SUPABASE ON';
    } else if (!navigator.onLine) {
        wrapper.className = 'sync-status-container offline';
        tag.innerHTML = '📴 MODE BACA SAJA';
    } else {
        wrapper.className = 'sync-status-container offline';
        tag.innerHTML = '📴 CLOUD OFF';
    }
};
window.updateSyncTimeBadge = function() {
    const el = document.getElementById('syncTimeBadge');
    if (!el) return;
    if (window._lastSyncTime) {
        const timeStr = window._lastSyncTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        el.innerText = `🕐 ${timeStr}`;
        el.style.color = '#00875a';
    } else {
        el.innerText = `🕐 --:--:--`;
        el.style.color = '#888';
    }
};
window.updateUIForOnlineStatus = function() {
    const online = window.isOnline();
    const offlineWarning = document.getElementById('offlineWarningBar');
    const actionButtons = ['tambahTransaksiBtn', 'kelolaBukuBtn', 'setelanBtn', 'manualSyncBtn', 'anggaranBtn', 'anggaranDasarBtn', 'backupBtn'];
    if (online) {
        if (offlineWarning) offlineWarning.classList.remove('show');
        actionButtons.forEach(id => { const btn = document.getElementById(id); if (btn) { btn.removeAttribute('disabled'); btn.style.opacity = '1'; } });
        document.querySelectorAll('.action-btn').forEach(btn => btn.removeAttribute('disabled'));
        document.querySelectorAll('.btn-icon').forEach(btn => btn.removeAttribute('disabled'));
    } else {
        if (offlineWarning) offlineWarning.classList.add('show');
        actionButtons.forEach(id => { const btn = document.getElementById(id); if (btn) { btn.setAttribute('disabled', true); btn.style.opacity = '0.5'; } });
        document.querySelectorAll('.action-btn').forEach(btn => btn.setAttribute('disabled', true));
        document.querySelectorAll('.btn-icon').forEach(btn => btn.setAttribute('disabled', true));
    }
    window.updateSyncStatusBadge();
};
window.startAutoSync = function() {
    if (window._syncInterval) clearInterval(window._syncInterval);
    window._syncInterval = setInterval(async () => {
        if (window.isOnline()) {
            await window.pullAllSettings();
            await window.pullFromCloudSilently();
            window.updateBookSelectDropdown();
            // Catatan: window.renderBudget() TIDAK dipanggil di sini karena
            // pullAllSettings() sudah memanggil renderBudget() sendiri apabila
            // ada perubahan budget dari cloud (budgetUpdated = true di db.js).
            // Memanggil renderBudget() lagi di sini hanya akan menyebabkan
            // render ganda yang boros dan bisa menyebabkan flicker UI.
            window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');

            // ── PULL PAYMENT REMINDERS ──
            // payment_reminders pakai tabel Supabase sendiri, bukan tabel `settings`,
            // jadi tidak ter-cover oleh pullAllSettings() di atas.
            // Cache disimpan per-buku (sk_payment_reminders_{bookId}) agar tidak
            // menimpa data buku lain saat multi-buku aktif.
            try {
                const reminders = await window.loadPaymentReminders(window.currentBookId);
                if (reminders && reminders.length > 0) {
                    localStorage.setItem('sk_payment_reminders_' + window.currentBookId, JSON.stringify(reminders));
                }
                if (typeof window.renderPaymentReminders === 'function') await window.renderPaymentReminders();
                if (typeof window.updatePaymentReminderBanner === 'function') window.updatePaymentReminderBanner();
            } catch (e) {
                console.warn('[AutoSync] Gagal pull payment reminders:', e);
            }
        }
    }, 30000);
    console.log('[AutoSync] Dimulai, interval 30 detik.');
};
window.stopAutoSync = function() {
    if (window._syncInterval) { clearInterval(window._syncInterval); window._syncInterval = null; }
    console.log('[AutoSync] Dihentikan.');
};

window.submitLockPassword = async function() {
    const pwd = document.getElementById('lockPasswordInput').value;
    const status = document.getElementById('lockStatus');
    const btn = document.getElementById('lockSubmitBtn');
    if (!pwd) { status.innerText = '❌ Password tidak boleh kosong'; return; }
    btn.disabled = true;
    btn.innerText = '⏳ Memverifikasi...';
    status.innerText = '';
    const ok = await window.unlockWithPassword(pwd);
    if (ok) {
        document.getElementById('passwordLockScreen').style.display = 'none';
        window.continueAppInit();
    } else {
        btn.disabled = false;
        btn.innerText = '🔓 Buka';
        status.innerText = '❌ Password salah';
        const inp = document.getElementById('lockPasswordInput');
        inp.classList.add('error-shake');
        inp.value = '';
        inp.focus();
        setTimeout(() => inp.classList.remove('error-shake'), 400);
    }
};

window.continueAppInit = async function() {
    if (!window.globalSupabaseUrl) {
        sessionStorage.removeItem('sk_session_unlocked');
        sessionStorage.removeItem('sk_session_url');
        sessionStorage.removeItem('sk_session_akey');
        sessionStorage.removeItem('sk_session_ts');
        window.renderLockScreenPicker();
        document.getElementById('passwordLockScreen').style.display = 'flex';
        return;
    }
    document.getElementById('passwordLockScreen').style.display = 'none';
    window.updateActiveAccountLabel();
    window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
    let currentYear = new Date().getFullYear();
    let selectYear = document.getElementById('budgetYear');
    selectYear.innerHTML = '';
    for (let y = currentYear - 2; y <= currentYear + 2; y++) {
        let opt = document.createElement('option');
        opt.value = y;
        opt.innerText = y;
        if (y === currentYear) opt.selected = true;
        selectYear.appendChild(opt);
    }
    document.getElementById('budgetMonth').value = new Date().getMonth() + 1;
    window.updateBookSelectDropdown();
    window.updateHeaderTitle();
    window.updateSyncStatusBadge();
    if (!window.getCloudUrl() || !window.getSupabaseKey()) {
        setTimeout(() => window.openSetupModal(), 400);
    } else {
        if (window.isOnline()) {
            await window.pullAllSettings();
            window.loadGoogleSheetsUrl();
            const localGsUrl = localStorage.getItem('sk_google_sheets_url');
            if (localGsUrl && window.isOnline()) {
                window.pushSetting('google_sheets_url', localGsUrl, 'global');
            }
            window.updateBookSelectDropdown();
            window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
            window.updateTgStatusBadge();
            await window.pullAllBooksFromCloud();
            
            // ── LOAD PAYMENT REMINDERS DARI CLOUD ──
            // Cache disimpan per-buku (sk_payment_reminders_{bookId}) agar tidak
            // menimpa data buku lain saat multi-buku aktif.
            if (window.isOnline()) {
                try {
                    const cloudReminders = await window.loadPaymentReminders(window.currentBookId);
                    if (cloudReminders && cloudReminders.length > 0) {
                        localStorage.setItem('sk_payment_reminders_' + window.currentBookId, JSON.stringify(cloudReminders));
                    } else {
                        await window.migratePaymentReminders(window.currentBookId);
                    }
                } catch (e) {
                    console.warn('[App] Gagal load payment reminders:', e);
                }
            }

            // Catatan: budget (default, monthly, annual) dan fase_kehidupan TIDAK perlu
            // di-load ulang secara terpisah di sini karena pullAllSettings() di atas
            // sudah menangani dekripsi dan penyimpanan semua setting dari cloud ke
            // localStorage — termasuk 'default_budget', 'budgets', 'annual_budget',
            // dan 'fase_kehidupan'. Memanggil ulang fungsi-fungsi load terpisah di sini
            // justru menyebabkan error JSON.parse karena nilai terenkripsi diproses
            // tanpa _sessionCryptoKey yang sudah siap di pullAllSettings().
            window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
            window._lastSyncTime = new Date();
            window.updateSyncTimeBadge();
            setTimeout(window.checkAndRunDailyAutoBackup, 3000);
            setTimeout(window.scheduleDailySummary, 5000);
        } else {
            window.loadTransactions();
        }
    }
    setInterval(() => {
        let clock = document.getElementById('liveClock');
        if (clock) clock.innerText = new Date().toLocaleTimeString('id-ID');
    }, 1000);
    window.startAutoSync();
    window.updateUIForOnlineStatus();
    // Mulai auto-lock: kunci otomatis setelah tidak ada aktivitas
    if (typeof window.autoLock !== 'undefined') window.autoLock.start();
    // [BUG FIX 1] Event listener online/offline/visibilitychange hanya boleh
    // didaftarkan SEKALI. continueAppInit() bisa dipanggil >1x dalam satu sesi
    // (misal: auto-lock -> buka password lagi), sehingga tanpa guard ini
    // listener menumpuk dan forceFullSync() dipanggil berkali-kali.
    if (!window._globalListenersRegistered) {
        window._globalListenersRegistered = true;
        window.addEventListener('online', () => { window.updateSyncStatusBadge(); window.updateUIForOnlineStatus(); window.forceFullSync(); });
        window.addEventListener('offline', () => { window.updateSyncStatusBadge(); window.updateUIForOnlineStatus(); });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && window.isOnline()) {
                const secondsSinceSync = window._lastSyncTime ? (Date.now() - window._lastSyncTime.getTime()) / 1000 : Infinity;
                if (secondsSinceSync > 60) window.forceFullSync();
            }
        });
    }
};

window.initApp = async function() {
    window.bootstrapMultiAccount();
    window.deviceId = localStorage.getItem('sk_device_id');
    if (!window.deviceId) {
        window.deviceId = 'DEV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        localStorage.setItem('sk_device_id', window.deviceId);
    }
    document.getElementById('deviceIdDisplay').innerText = window.deviceId;
    let storedBooks = localStorage.getItem('sk_books');
    if (storedBooks) window.books = JSON.parse(storedBooks);
    else { window.books = [{ id: 'b_default', name: 'Buku Utama' }]; localStorage.setItem('sk_books', JSON.stringify(window.books)); }
    window.currentBookId = localStorage.getItem('sk_current_book_id') || 'b_default';
    if (!window.books.find(b => b.id === window.currentBookId)) window.currentBookId = window.books[0].id;
    window.loadGoogleSheetsUrl();

    if (!window.isPasswordConfigured()) {
        document.getElementById('passwordLockScreen').style.display = 'none';
        const legacyUrls = JSON.parse(localStorage.getItem('sk_cloud_urls') || '{}');
        const legacyUrl = localStorage.getItem('sk_supabase_url_global') || '';
        const firstKey = Object.keys(legacyUrls)[0];
        if (legacyUrl || firstKey) {
            document.getElementById('setupUrlInput').value = legacyUrl || legacyUrls[firstKey] || '';
            document.getElementById('setupKeyInput').value = localStorage.getItem('sk_supabase_key_global') || '';
        }
        setTimeout(() => window.openSetupModal(), 300);
        return;
    }
    if (!sessionStorage.getItem('sk_session_unlocked')) {
        window.renderLockScreenPicker();
        document.getElementById('passwordLockScreen').style.display = 'flex';
        document.getElementById('lockPasswordInput').focus();
        return;
    }
    const _sessTs = parseInt(sessionStorage.getItem('sk_session_ts') || '0');
    const _sessAge = Date.now() - _sessTs;
    const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 jam (sebelumnya hanya 60 detik — terlalu singkat)
    if (_sessAge > SESSION_TIMEOUT_MS) {
        sessionStorage.removeItem('sk_session_unlocked');
        sessionStorage.removeItem('sk_session_url');
        sessionStorage.removeItem('sk_session_akey');
        sessionStorage.removeItem('sk_session_ts');
        window.renderLockScreenPicker();
        document.getElementById('passwordLockScreen').style.display = 'flex';
        document.getElementById('lockPasswordInput').focus();
        return;
    }
    if (!window.globalSupabaseUrl) {
        window.globalSupabaseUrl = sessionStorage.getItem('sk_session_url') || '';
        window.globalSupabaseKey = sessionStorage.getItem('sk_session_akey') || '';
    }
    // Derive ulang _sessionCryptoKey jika hilang setelah location.reload().
    // Kasus: switch akun -> _doSwitch() -> reload; key in-memory hilang tapi
    // salt ada di localStorage akun baru & password ada di sk_pending_switch_pwd
    // atau sk_session_pwd (diset saat unlock terakhir).
    if (!window._sessionCryptoKey) {
        // Jika ada password dari switch akun yang baru selesai, konversi ke
        // sk_session_pwd (XOR-obfuscated) menggunakan URL sesi yang sudah aktif.
        const pendingPwd = sessionStorage.getItem('sk_pending_switch_pwd');
        if (pendingPwd) {
            window._storeSessionPassword(pendingPwd);
            sessionStorage.removeItem('sk_pending_switch_pwd');
        }
        const restored = await window.restoreSessionCryptoKey();
        if (!restored) {
            console.warn('[App] Gagal restore session crypto key; push setting akan dinonaktifkan sampai user lock+unlock ulang.');
        }
    }
    window.continueAppInit();
};

// Toggle Manual
window.toggleManual = function() {
    const modal = document.getElementById('manualModal');
    if (modal.classList.contains('show')) {
        window.closeModal('manualModal');
    } else {
        window.openModal('manualModal');
    }
};

// Drawer
window.openMobileDrawer = function() {
    const src = document.getElementById('activeAccountLabel');
    const dst = document.getElementById('drawerAccountLabel');
    if (src && dst) dst.textContent = src.textContent;
    document.getElementById("mobileDrawerOverlay").style.opacity = "1";
    document.getElementById("mobileDrawerOverlay").style.pointerEvents = "auto";
    document.getElementById("mobileDrawer").style.transform = "translateX(0)";
};
window.closeMobileDrawer = function() {
    document.getElementById("mobileDrawerOverlay").style.opacity = "0";
    document.getElementById("mobileDrawerOverlay").style.pointerEvents = "none";
    document.getElementById("mobileDrawer").style.transform = "translateX(100%)";
};
window.drawerAction = function(fn) {
    window.closeMobileDrawer();
    setTimeout(fn, 180);
};
window.toggleAuditLogInline = function() {
    const body = document.getElementById('auditLogInlineBody');
    const arrow = document.getElementById('auditLogInlineArrow');
    if (!body) return;
    if (body.style.display === 'none') {
        body.style.display = 'block';
        if (arrow) arrow.textContent = '▲';
        window.refreshLogsFromCloud();
    } else {
        body.style.display = 'none';
        if (arrow) arrow.textContent = '▼';
    }
};

// ==================== START APP ====================
window.addEventListener('DOMContentLoaded', () => {
    window.initApp();
    window.fetchForexRate();
    setTimeout(window.fetchGoldPrice, 1500);
});
