// ==================== SETTINGS ====================

window.switchSetelanTab = function(tabId) {
    var tabs = document.querySelectorAll('#setelanTabs .setelan-tab-btn');
    var panels = document.querySelectorAll('#setelanTabContent .setelan-tab-panel');
    var found = false;

    panels.forEach(function(panel) {
        if (panel.getAttribute('data-tab-panel') === tabId) {
            panel.classList.add('active');
            found = true;
        } else {
            panel.classList.remove('active');
        }
    });

    // Fallback: jika tabId tidak valid, tetap tampilkan tab pertama
    if (!found && panels.length) {
        panels[0].classList.add('active');
        tabId = panels[0].getAttribute('data-tab-panel');
    }

    tabs.forEach(function(btn) {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
            if (typeof btn.scrollIntoView === 'function') {
                btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        } else {
            btn.classList.remove('active');
        }
    });

    var contentEl = document.getElementById('setelanTabContent');
    if (contentEl) contentEl.scrollTop = 0;
};

window.openSetelanModal = function(initialTab) {
    var urlEl = document.getElementById('supabaseUrlInput');
    var keyEl = document.getElementById('supabaseKeyInput');
    var statusEl = document.getElementById('connectionStatus');
    
    if (urlEl) urlEl.value = window.getCloudUrl() || window.globalSupabaseUrl || '';
    if (keyEl) keyEl.value = '';
    if (statusEl) statusEl.innerHTML = '';
    
    var workerInp = document.getElementById('aiWorkerUrlInput');
    var workerSt = document.getElementById('aiWorkerTestStatus');
    if (workerInp) workerInp.value = localStorage.getItem('sk_ai_worker_url') || '';
    if (workerSt) workerSt.innerText = '';
    
    if (typeof window.updateAiWorkerBadge === 'function') {
        window.updateAiWorkerBadge();
    }
    
    var emasInp = document.getElementById('emasApiKeyInput');
    var emasSt = document.getElementById('emasApiTestStatus');
    if (emasInp) emasInp.value = localStorage.getItem('sk_emas_api_key') || '';
    if (emasSt) emasSt.innerText = '';
    
    var emasGramInp = document.getElementById('emasGramInput');
    if (emasGramInp) emasGramInp.value = localStorage.getItem('sk_emas_gram') || '';
    
    if (typeof window.updateEmasApiBadge === 'function') {
        window.updateEmasApiBadge();
    }
    if (typeof window.updateEmasGramPreview === 'function') {
        window.updateEmasGramPreview();
    }
    
    var zakatInp = document.getElementById('zakatPersenInput');
    if (zakatInp) zakatInp.value = localStorage.getItem('sk_zakat_persen') || '';
    if (typeof window.updateZakatPreview === 'function') {
        window.updateZakatPreview();
    }
    
    var gsUrl = document.getElementById('googleSheetsUrlInput');
    if (gsUrl) gsUrl.value = localStorage.getItem('sk_google_sheets_url') || '';
    
    var gsStatus = document.getElementById('googleSheetsStatus');
    if (gsStatus) gsStatus.innerText = '';
    
    window.openModal('setelanModal');
    window.switchSetelanTab(initialTab || 'lang');
};

window.testCloudConnection = async function() {
    var urlInput = document.getElementById('supabaseUrlInput').value.trim();
    var keyInput = document.getElementById('supabaseKeyInput').value.trim();
    var statusDiv = document.getElementById('connectionStatus');
    
    if (!urlInput || !keyInput) {
        statusDiv.innerHTML = '<div class="connection-status error">Gagal: Harap isi URL & Anon Key!</div>';
        return;
    }
    
    statusDiv.innerHTML = '<div class="connection-status testing">Sedang mengetes koneksi ke Supabase...</div>';
    window.globalSupabaseUrl = urlInput;
    window.globalSupabaseKey = keyInput;
    
    var testFetch = await window.callSupabaseAPI('transactions', 'GET', null, '?limit=1');
    
    if (testFetch !== null) {
        await window.reEncryptCredentials(window.globalSupabaseUrl, window.globalSupabaseKey);
        statusDiv.innerHTML = '<div class="connection-status success">Sukses! Koneksi terenkripsi & berlaku untuk semua buku. Memulai unduh data...</div>';
        window.showToast('Supabase terhubung & terenkripsi!', 'success');
        window.updateSyncStatusBadge();
        await window.pullAllSettings();
        window.updateBookSelectDropdown();
        window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
        window.updateTgStatusBadge();
        await window.pullAllBooksFromCloud();
        window.updateUIForOnlineStatus();
    } else {
        window.globalSupabaseUrl = '';
        window.globalSupabaseKey = '';
        statusDiv.innerHTML = '<div class="connection-status error">Koneksi Gagal: Silakan periksa URL, Key, atau Skema Tabel SQL Anda!</div>';
        window.showToast('Koneksi cloud gagal!', 'error');
        window.updateSyncStatusBadge();
    }
};

window.changePassword = async function() {
    var oldPwd = document.getElementById('changePwdOld').value;
    var newPwd = document.getElementById('changePwdNew').value;
    var newPwd2 = document.getElementById('changePwdNew2').value;
    var status = document.getElementById('changePwdStatus');
    
    status.style.color = '#de350b';
    
    if (!oldPwd || !newPwd || !newPwd2) {
        status.innerText = window.t('all_fields_required');
        return;
    }
    if (newPwd.length < 6) {
        status.innerText = window.t('pwd_min_6');
        return;
    }
    if (newPwd !== newPwd2) {
        status.innerText = window.t('confirm_mismatch');
        return;
    }
    
    status.style.color = '#cc7b00';
    status.innerText = window.t('verifying');
    
    var saltB64 = localStorage.getItem('sk_crypto_salt');
    if (!saltB64) {
        status.style.color = '#de350b';
        status.innerText = window.t('encryption_data_not_found');
        return;
    }
    
    var salt = Uint8Array.from(atob(saltB64), function(c) { return c.charCodeAt(0); });
    var oldKey;
    
    try {
        oldKey = await window.deriveKey(oldPwd, salt);
        var plain = await window.decryptStr(oldKey, localStorage.getItem('sk_crypto_check'));
        if (plain !== 'sinarkeu_ok') throw new Error('wrong');
    } catch (e) {
        status.style.color = '#de350b';
        status.innerText = window.t('old_pwd_wrong');
        return;
    }
    
    var url, apiKey;
    try {
        url = await window.decryptStr(oldKey, localStorage.getItem('sk_enc_supabase_url'));
        apiKey = await window.decryptStr(oldKey, localStorage.getItem('sk_enc_supabase_key'));
    } catch (e) {
        status.style.color = '#de350b';
        status.innerText = window.t('failed_read_encrypted');
        return;
    }
    
    status.innerText = window.t('re_encrypting');
    // PENTING: salt TIDAK diganti (lihat window.rotatePasswordKeepingSalt di
    // crypto.js). Salt yang sama dipakai semua perangkat yang sudah join --
    // kalau diacak ulang di sini, perangkat lain jadi tidak bisa lagi
    // menurunkan kunci yang sama walau memakai password baru yang sama.
    const rotated = await window.rotatePasswordKeepingSalt(newPwd, saltB64);
    await window.saveEncryptedCredentials(rotated.key, url, apiKey);
    window._sessionCryptoKey = rotated.key;
    
    window.globalSupabaseUrl = url;
    window.globalSupabaseKey = apiKey;
    sessionStorage.setItem('sk_session_unlocked', '1');
    sessionStorage.setItem('sk_session_url', url);
    sessionStorage.setItem('sk_session_akey', apiKey);
    sessionStorage.setItem('sk_session_ts', Date.now().toString());
    
    // Overwrite 'crypto_check' di cloud (salt tetap sama) supaya perangkat
    // lain yang BELUM join, atau yang setup ulang nanti, memvalidasi ke
    // password baru. Perangkat yang SUDAH terbuka sebelumnya tetap memakai
    // cache lokalnya sendiri sampai mereka juga menjalankan "Ubah Password"
    // ini dengan password lama+baru yang sama -- tidak ada mekanisme push
    // otomatis ke lock screen perangkat lain tanpa server autentikasi.
    status.innerText = window.t('updating_cloud_pwd');
    await window.pushCryptoSaltCheck(saltB64, rotated.checkB64);
    
    // Push ulang semua setting (books, budgets, default_budget, telegram_config)
    // dienkripsi dengan kunci yang baru, supaya baris lama di cloud yang masih
    // terkunci kunci sebelumnya tidak gagal didekripsi selamanya oleh
    // pullAllSettings() (lihat window.reEncryptAllCloudSettings di db.js).
    status.innerText = window.t('re_syncing_settings');
    await window.reEncryptAllCloudSettings();
    
    status.style.color = '#00875a';
    status.innerText = window.t('pwd_changed_success');
    
    document.getElementById('changePwdOld').value = '';
    document.getElementById('changePwdNew').value = '';
    document.getElementById('changePwdNew2').value = '';
    
    window.showToast('Password berhasil diganti ', 'success');
};

window.doFirstTimeSetup = async function() {
    var url = document.getElementById('setupUrlInput').value.trim();
    var key = document.getElementById('setupKeyInput').value.trim();
    var pwd = document.getElementById('setupPwdInput').value;
    var pwd2 = document.getElementById('setupPwdConfirm').value;
    var st = document.getElementById('setupStatusMsg');
    var btn = document.getElementById('setupConnectBtn');
    
    if (!url || !key) {
        st.className = 'setup-status error';
        st.innerText = window.t('supabase_url_key_required');
        return;
    }
    if (!pwd || pwd.length < 6) {
        st.className = 'setup-status error';
        st.innerText = window.t('pwd_min_6_short');
        return;
    }
    if (pwd !== pwd2) {
        st.className = 'setup-status error';
        st.innerText = window.t('confirm_pwd_mismatch');
        return;
    }
    
    btn.disabled = true;
    btn.innerText = window.t('testing_connection');
    st.className = 'setup-status warning';
    st.innerText = window.t('connecting_supabase');
    
    window.globalSupabaseUrl = url;
    window.globalSupabaseKey = key;
    
    var test = await window.callSupabaseAPI('transactions', 'GET', null, '?limit=1');
    
    if (test === null) {
        window.globalSupabaseUrl = '';
        window.globalSupabaseKey = '';
        btn.disabled = false;
        btn.innerText = window.t('save_start');
        st.className = 'setup-status error';
        st.innerText = window.t('connection_failed');
        return;
    }
    
    st.innerText = window.t('checking_backend');
    let boot;
    try {
        boot = await window.bootstrapCryptoForBackend(pwd, url, key);
    } catch (e) {
        window.globalSupabaseUrl = '';
        window.globalSupabaseKey = '';
        btn.disabled = false;
        btn.innerText = window.t('save_start');
        st.className = 'setup-status error';
        if (e && e.code === 'PASSWORD_MISMATCH') {
            st.innerText = window.t('backend_diff_password');
        } else {
            st.innerText = 'Gagal menyiapkan enkripsi: ' + (e && e.message ? e.message : 'error tidak diketahui');
        }
        return;
    }
    st.innerText = window.t('encrypting_credentials');
    await window.persistBootstrappedCrypto(boot, url, key, pwd);
    window.updateSyncStatusBadge();
    
    st.className = 'setup-status success';
    st.innerText = boot.joined
        ? 'Berhasil! Perangkat ini bergabung memakai kunci yang sama dengan perangkat lain.'
        : 'Berhasil! Kredensial terenkripsi dengan password Anda.';
    btn.innerText = window.t('connected');
    
    setTimeout(async function() {
        window.closeModal('firstTimeSetupModal');
        window.showToast('Setup selesai! Data terenkripsi aman ', 'success');
        await window.continueAppInit();
    }, 900);
};

// ============================================================
// SETTINGS.JS - FUNGSI MIGRASI & STATUS
// ============================================================

window.runFullMigration = async function() {
    var bookId = window.currentBookId;
    var st = document.getElementById('migrationStatus');
    
    if (!st) {
        console.error('[Migration] Element migrationStatus tidak ditemukan');
        return;
    }
    
    if (!window.isOnline()) {
        st.style.color = '#de350b';
        st.innerText = window.t('must_be_online');
        return;
    }
    
    st.style.color = '#cc7b00';
    st.innerText = window.t('starting_migration');
    
    try {
        st.innerText = window.t('migrating_payment');
        if (typeof window.migratePaymentReminders === 'function') {
            await window.migratePaymentReminders(bookId);
        } else {
            console.warn('[Migration] Fungsi migratePaymentReminders belum tersedia');
        }
        
        st.innerText = window.t('migrating_budget');
        if (typeof window.migrateAllBudgets === 'function') {
            await window.migrateAllBudgets(bookId);
        } else {
            console.warn('[Migration] Fungsi migrateAllBudgets belum tersedia');
        }
        
        st.innerText = window.t('final_sync');
        if (typeof window.syncAllPaymentReminders === 'function') {
            await window.syncAllPaymentReminders(bookId);
        }
        if (typeof window.syncAllBudgetsToCloud === 'function') {
            await window.syncAllBudgetsToCloud(bookId);
        }
        
        st.style.color = '#00875a';
        st.innerText = window.t('migration_done');
        window.showToast('Migrasi data berhasil!', 'success');
        
        await window.pullAllSettings();
        if (typeof window.pullPaymentRemindersFromCloud === 'function') {
            await window.pullPaymentRemindersFromCloud(bookId);
        }
        window.renderBudget();
        if (typeof window.renderPaymentReminders === 'function') {
            await window.renderPaymentReminders();
        }
        
    } catch (e) {
        st.style.color = '#de350b';
        st.innerText = window.t('migration_failed') + e.message;
        console.error('[Migration] Error:', e);
    }
};

window.checkMigrationStatus = async function() {
    var bookId = window.currentBookId;
    var st = document.getElementById('migrationStatus');
    
    if (!st) {
        console.error('[Migration] Element migrationStatus tidak ditemukan');
        return;
    }
    
    if (!window.isOnline()) {
        st.style.color = '#de350b';
        st.innerText = window.t('must_be_online_check');
        return;
    }
    
    st.style.color = '#cc7b00';
    st.innerText = window.t('checking_status');
    
    try {
        var _stTag = window.getAccountTag ? window.getAccountTag() : null;
        var _stTagFilter = _stTag ? '&account_tag=eq.' + _stTag : '';
        var prResult = await window.callSupabaseAPI(
            'payment_reminders',
            'GET',
            null,
            '?book_id=eq.' + bookId + '&limit=1' + _stTagFilter
        );
        var hasPR = prResult && Array.isArray(prResult) && prResult.length > 0;
        
        var budgetResult = await window.callSupabaseAPI(
            'settings',
            'GET',
            null,
            '?book_id=eq.' + bookId + '&key=eq.default_budget&limit=1' + _stTagFilter
        );
        var hasBudget = budgetResult && Array.isArray(budgetResult) && budgetResult.length > 0;
        
        var annualResult = await window.callSupabaseAPI(
            'settings',
            'GET',
            null,
            '?book_id=eq.' + bookId + '&key=eq.annual_budget&limit=1' + _stTagFilter
        );
        var hasAnnual = annualResult && Array.isArray(annualResult) && annualResult.length > 0;
        
        var status = [];
        if (hasPR) status.push('Jadwal pembayaran');
        else status.push('Jadwal pembayaran (belum di-cloud)');
        
        if (hasBudget) status.push('Anggaran dasar & bulanan');
        else status.push('Anggaran (belum di-cloud)');
        
        if (hasAnnual) status.push('Anggaran tahunan');
        else status.push('Anggaran tahunan (belum di-cloud)');
        
        st.style.color = '#1a1a1a';
        st.innerHTML = status.join('<br>');
        
        if (!hasPR || !hasBudget || !hasAnnual) {
            st.innerHTML += '<br><span style="color:#cc7b00;">Klik "Migrasi Semua Data" untuk menyinkronkan.</span>';
        }
        
    } catch (e) {
        st.style.color = '#de350b';
        st.innerText = window.t('migration_failed_check') + e.message;
    }
};

// ── PULL SETTING (untuk fase kehidupan dll) ──
window.pullSetting = async function(key, bookId) {
    if (!window.isOnline()) return null;
    if (!bookId) bookId = window.currentBookId;
    
    try {
        var _psTag = window.getAccountTag ? window.getAccountTag() : null;
        var _psTagFilter = _psTag ? '&account_tag=eq.' + _psTag : '';
        var result = await window.callSupabaseAPI(
            'settings',
            'GET',
            null,
            '?book_id=eq.' + bookId + '&key=eq.' + key + '&limit=1' + _psTagFilter
        );
        
        if (result && Array.isArray(result) && result.length > 0) {
            var decrypted = await window._decryptSettingValue(result[0].value);
            var parsed = JSON.parse(decrypted);
            return parsed;
        }
        return null;
    } catch (e) {
        console.warn('[Settings] Gagal pull setting:', e);
        return null;
    }
};

// ── OPEN SETUP MODAL ──
window.openSetupModal = function() {
    var modal = document.getElementById('firstTimeSetupModal');
    if (modal) {
        modal.classList.add('show');
        var statusMsg = document.getElementById('setupStatusMsg');
        if (statusMsg) {
            statusMsg.className = 'setup-status';
            statusMsg.innerText = '';
        }
        var btn = document.getElementById('setupConnectBtn');
        if (btn) {
            btn.disabled = false;
            btn.innerText = window.t('save_start');
        }
    }
};
