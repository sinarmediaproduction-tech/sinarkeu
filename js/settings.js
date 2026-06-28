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
    
    // Load nama perangkat
    var deviceNameInp = document.getElementById('deviceNameInput');
    var deviceNameSt = document.getElementById('deviceNameStatus');
    if (deviceNameInp) deviceNameInp.value = localStorage.getItem('sk_device_id') || '';
    if (deviceNameSt) deviceNameSt.innerText = '';
    
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
    var deviceNameRaw = (document.getElementById('setupDeviceNameInput').value || '').trim();
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
    
    // Simpan nama perangkat jika diisi
    if (deviceNameRaw) {
        var sanitized = deviceNameRaw.replace(/[^a-zA-Z0-9\u00C0-\u024F\s\-_]/g, '').trim().substring(0, 24);
        if (sanitized) {
            window.deviceId = sanitized;
            localStorage.setItem('sk_device_id', sanitized);
            var badge = document.getElementById('deviceIdDisplay');
            if (badge) badge.innerText = sanitized;
        }
    }
    
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

// ── NAMA PERANGKAT ──
window.saveDeviceName = function() {
    var inp = document.getElementById('deviceNameInput');
    var st = document.getElementById('deviceNameStatus');
    var raw = (inp ? inp.value : '').trim();

    var newId;
    if (raw) {
        // Bersihkan karakter aneh, maks 24 karakter
        var sanitized = raw.replace(/[^a-zA-Z0-9\u00C0-\u024F\s\-_]/g, '').trim().substring(0, 24);
        if (!sanitized) {
            if (st) { st.style.color = '#c0392b'; st.innerText = 'Nama tidak valid. Gunakan huruf, angka, spasi, atau tanda hubung.'; }
            return;
        }
        newId = sanitized;
    } else {
        // Kosong = reset ke ID acak
        newId = 'DEV-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        if (inp) inp.value = newId;
    }

    window.deviceId = newId;
    localStorage.setItem('sk_device_id', newId);
    var badge = document.getElementById('deviceIdDisplay');
    if (badge) badge.innerText = newId;
    if (st) { st.style.color = '#00875a'; st.innerText = 'Tersimpan: ' + newId; }
    window.showToast('Nama perangkat diperbarui!', 'success');
};

// ── PERANGKAT TERHUBUNG ──
window.loadConnectedDevices = async function() {
    var listEl = document.getElementById('devicesList');
    var statusEl = document.getElementById('devicesLoadStatus');
    if (!listEl) return;

    if (!window.isOnline()) {
        if (statusEl) statusEl.innerText = 'Tidak terhubung ke cloud.';
        listEl.innerHTML = '';
        return;
    }

    var bookId = window.currentBookId;
    if (!bookId) {
        if (statusEl) statusEl.innerText = 'Pilih buku aktif terlebih dahulu.';
        return;
    }

    if (statusEl) statusEl.innerText = 'Memuat data perangkat...';
    listEl.innerHTML = '';

    try {
        var tag = window.getAccountTag ? window.getAccountTag() : null;
        var tagFilter = tag ? '&account_tag=eq.' + tag : '';

        var logs = await window.callSupabaseAPI(
            'audit_logs', 'GET', null,
            '?book_id=eq.' + bookId + '&order=timestamp.desc&limit=500' + tagFilter
        );

        if (!logs || !Array.isArray(logs) || logs.length === 0) {
            if (statusEl) statusEl.innerText = '';
            listEl.innerHTML = '<div style="font-size:.72rem; color:#aaa; text-align:center; padding:20px 0;">Belum ada log aktivitas di cloud.</div>';
            return;
        }

        // Agregasi per device_id
        var deviceMap = {};
        logs.forEach(function(l) {
            var did = l.device_id || 'UNKNOWN';
            if (!deviceMap[did]) {
                deviceMap[did] = { device_id: did, count: 0, last_seen: l.timestamp, actions: {} };
            }
            deviceMap[did].count++;
            if (l.timestamp > deviceMap[did].last_seen) deviceMap[did].last_seen = l.timestamp;
            var act = l.action || '-';
            deviceMap[did].actions[act] = (deviceMap[did].actions[act] || 0) + 1;
        });

        var devices = Object.values(deviceMap).sort(function(a, b) {
            return b.last_seen.localeCompare(a.last_seen);
        });

        var myId = window.deviceId || localStorage.getItem('sk_device_id') || '';

        if (statusEl) statusEl.innerText = devices.length + ' perangkat ditemukan dari ' + logs.length + ' log.';

        var html = '';
        devices.forEach(function(d) {
            var isMe = d.device_id === myId;
            var lastDate = new Date(d.last_seen);
            var now = new Date();
            var diffDays = Math.floor((now - lastDate) / 86400000);
            var lastLabel = diffDays === 0 ? 'Hari ini'
                : diffDays === 1 ? 'Kemarin'
                : diffDays < 30 ? diffDays + ' hari lalu'
                : diffDays < 365 ? Math.floor(diffDays / 30) + ' bulan lalu'
                : Math.floor(diffDays / 365) + ' tahun lalu';

            var dotColor = diffDays <= 7 ? '#00875a' : diffDays <= 30 ? '#cc7b00' : '#bbb';
            var topActions = Object.entries(d.actions)
                .sort(function(a, b) { return b[1] - a[1]; })
                .slice(0, 3).map(function(a) { return a[0]; }).join(', ');

            html += '<div style="border:1px solid var(--rule); border-radius:8px; padding:10px 12px; margin-bottom:8px; background:var(--paper);">';
            html += '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">';
            html += '<span style="font-size:.78rem; font-weight:700; color:var(--ink);">';
            html += '<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:' + dotColor + '; margin-right:5px; vertical-align:middle;"></span>';
            html += window.escapeHtml(d.device_id);
            if (isMe) html += ' <span style="font-size:.6rem; background:#e3fcef; color:#006644; padding:1px 7px; border-radius:10px; font-weight:600; vertical-align:middle;">Perangkat ini</span>';
            html += '</span>';
            html += '<span style="font-size:.65rem; color:#888;">' + d.count + ' aksi</span>';
            html += '</div>';
            html += '<div style="font-size:.65rem; color:#888; line-height:1.7;">';
            html += 'Terakhir aktif: <b style="color:var(--ink-mid);">' + lastLabel + '</b> &nbsp;&middot;&nbsp; ';
            html += lastDate.toLocaleDateString("id-ID", {day:"numeric", month:"short", year:"numeric"}) + ' ' + lastDate.toLocaleTimeString("id-ID", {hour:"2-digit", minute:"2-digit"});
            html += '<br>Aktivitas: ' + window.escapeHtml(topActions);
            html += '</div></div>';
        });

        listEl.innerHTML = html;

    } catch(e) {
        if (statusEl) statusEl.innerText = 'Gagal memuat: ' + e.message;
        console.error('[Devices]', e);
    }
};
