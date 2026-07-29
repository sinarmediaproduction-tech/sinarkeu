// ==================== SETTINGS ====================

// Semua section Setelan (dan sekarang juga halaman Cadangan Data) tampil
// sekaligus dalam satu halaman panjang (tidak lagi per-tab). Fungsi ini
// dipertahankan hanya untuk menggulir ke section tertentu -- dipakai oleh
// link deep-link seperti "Setelan -> Analisis AI" dari modal lain. Selector
// sengaja dicari di seluruh dokumen (bukan cuma #setelanTabContent) supaya
// tetap jalan untuk panel "backup"/"migration" yang sekarang ada di
// #dataBackupTabContent (lihat window.openDataBackupView).
window.switchSetelanTab = function(tabId) {
    if (!tabId) return;
    var panel = document.querySelector('[data-tab-panel="' + tabId + '"]');
    if (panel && typeof panel.scrollIntoView === 'function') {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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

    if (typeof window.updateEmasQuotaDisplay === 'function') {
        window.updateEmasQuotaDisplay();
    }
    
    if (typeof window.updateEmasApiBadge === 'function') {
        window.updateEmasApiBadge();
    }
    if (typeof window.updateEmasGramPreview === 'function') {
        window.updateEmasGramPreview();
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

    // [SERAGAM DENGAN SETELAN] Akun, Notifikasi Telegram, dan Perangkat
    // Terhubung tetap panel inline di sini (bukan modal terpisah) -- render
    // semuanya setiap kali Setelan dibuka, apapun jalan masuknya (nav
    // sidebar, deep-link, atau openAccountManager/openTelegramSettings/
    // dst.), supaya isinya selalu ter-update, bukan cuma saat dipanggil
    // lewat fungsi open*Manager saja. Cadangan Data, Migrasi, dan Snapshot
    // Keamanan TIDAK lagi dirender di sini -- sudah pindah ke halaman
    // tersendiri, lihat window.openDataBackupView().
    if (typeof window.renderAccModalList === 'function') window.renderAccModalList();
    if (typeof window.loadTgConfigToForm === 'function') window.loadTgConfigToForm();
    if (typeof window.loadConnectedDevices === 'function') window.loadConnectedDevices();
    if (typeof window._refreshToastErrorLogPanel === 'function') window._refreshToastErrorLogPanel();
    // [UI] Dipindah dari modal "Kelola Buku Kas" ke sini (tab Koneksi
    // Supabase) -- lebih pas secara konteks, dan berlaku untuk semua buku
    // seperti setelan lain di tab ini, bukan cuma saat mengelola buku.
    if (typeof window.refreshStorageEstimate === 'function') window.refreshStorageEstimate();

    // Kalau lagi ada menu full-page sidebar lain yang terbuka (Laporan,
    // Anggaran, dst), tutup dulu supaya tidak tumpang tindih dengan Setelan.
    if (window.FULLVIEW_MODALS) {
        Object.keys(window.FULLVIEW_MODALS).forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.classList.remove('show');
        });
    }
    document.body.classList.remove('view-fullpage');

    window.openModal('setelanModal');
    if (initialTab) window.switchSetelanTab(initialTab);

    // Sidebar mobile ikut menutup begitu menu "Pengaturan" dipilih (selaras
    // dengan pola goSection() di merdeka-main yang selalu menutup sidebar
    // mobile setiap kali pindah halaman). Tidak berefek di desktop karena
    // sidebar di sana memang selalu terbuka lewat CSS.
    if (typeof window.closeMobileDrawer === 'function') window.closeMobileDrawer();

    // Setelan tampil sebagai halaman penuh di area utama (bukan modal
    // mengambang) di semua ukuran layar -- sembunyikan dashboard & tandai
    // menu sidebar aktif. Di layar sempit (hp), tampil full-screen; di
    // layar lebar (desktop), tampil di sebelah sidebar (lihat CSS).
    document.body.classList.add('view-settings');
    window.updateAppSidebarNav('setelan');
};

// Alias supaya tombol menu sidebar "Setelan" bisa langsung memicu logika
// yang sama dengan membuka Setelan dari tempat lain di aplikasi.
window.showSetelanView = function(initialTab) {
    window.openSetelanModal(initialTab);
};

// [PINDAH DARI SETELAN] Halaman "Cadangan Data" (backup lokal/cloud, impor/
// ekspor, Google Sheets, restore), "Snapshot Keamanan" (restore point
// otomatis), dan "Migrasi Data ke Cloud" -- dulu 3 tab di dalam Setelan,
// sekarang menu sidebar tersendiri (id: dataBackupModal, terdaftar di
// window.FULLVIEW_MODALS). Dipanggil dari tombol sidebar #navBackupBtn
// maupun dari fungsi lama seperti openBackupManager()/
// openSafetySnapshotManager().
window.openDataBackupView = function(initialTab) {
    if (typeof window.renderBackupList === 'function') window.renderBackupList();
    if (typeof window.loadCloudBackupList === 'function') window.loadCloudBackupList();
    if (typeof window.renderSafetySnapshotList === 'function') window.renderSafetySnapshotList();

    var gsUrl = document.getElementById('googleSheetsUrlInput');
    if (gsUrl) gsUrl.value = localStorage.getItem('sk_google_sheets_url') || '';
    var gsStatus = document.getElementById('googleSheetsStatus');
    if (gsStatus) gsStatus.innerText = '';

    window.openModal('dataBackupModal');
    if (initialTab) window.switchSetelanTab(initialTab);
};

window.showDashboardView = function() {
    document.body.classList.remove('view-settings', 'view-fullpage');
    window.updateAppSidebarNav('dashboard');
    // Kalau lagi buka Setelan sebagai modal (mode mobile), tutup juga saat
    // pindah ke menu Dashboard di sidebar.
    if (typeof window.closeModal === 'function') window.closeModal('setelanModal');
    // Kalau lagi ada menu full-page lain yang terbuka (Laporan, Anggaran,
    // Pengingat Pembayaran, Buku Kas, Manajemen User, Cadangan Data), tutup
    // juga.
    if (window.FULLVIEW_MODALS) {
        Object.keys(window.FULLVIEW_MODALS).forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.classList.remove('show');
        });
    }
    if (typeof window.closeMobileDrawer === 'function') window.closeMobileDrawer();
};

window.APP_NAV_BTN_MAP = {
    dashboard: 'navDashboardBtn',
    setelan:   'navSetelanBtn',
    laporan:   'navReportBtn',
    anggaran:  'navBudgetBtn',
    belanja:   'navShoppingListBtn',
    hargaKomoditas: 'navHargaKomoditasBtn',
    reminder:  'navReminderBtn',
    buku:      'navBookBtn',
    // [PINDAH KE SETELAN] Halaman ini sekarang dibuka dari panel "Akun &
    // Perangkat" di Setelan (bukan tombol sidebar sendiri lagi) -- tetap
    // menyorot navSetelanBtn supaya sidebar tidak terlihat kosong aktifnya.
    akun:      'navSetelanBtn',
    telegram:  'navSetelanBtn',
    devices:   'navSetelanBtn',
    userManager: 'navUserManagerBtn',
    // [PINDAH DARI SETELAN] backup, migration & snapshot sekarang punya
    // tombol sidebar sendiri (lihat window.openDataBackupView, dataBackupModal).
    backup:      'navBackupBtn',
    migration:   'navBackupBtn',
    snapshot:    'navBackupBtn',
    backupData:  'navBackupBtn'
};
window.updateAppSidebarNav = function(which) {
    Object.keys(window.APP_NAV_BTN_MAP).forEach(function(key) {
        var btn = document.getElementById(window.APP_NAV_BTN_MAP[key]);
        if (btn) btn.classList.toggle('active', key === which);
    });
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
    
    status.style.color = '#A13A3A';
    
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
    
    status.style.color = '#9C7A2E';
    status.innerText = window.t('verifying');
    
    var saltB64 = localStorage.getItem('sk_crypto_salt');
    if (!saltB64) {
        status.style.color = '#A13A3A';
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
        status.style.color = '#A13A3A';
        status.innerText = window.t('old_pwd_wrong');
        return;
    }
    
    var url, apiKey;
    try {
        url = await window.decryptStr(oldKey, localStorage.getItem('sk_enc_supabase_url'));
        apiKey = await window.decryptStr(oldKey, localStorage.getItem('sk_enc_supabase_key'));
    } catch (e) {
        status.style.color = '#A13A3A';
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
    
    status.style.color = '#2E6B4F';
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
        } else if (e && e.code === 'OFFLINE') {
            st.innerText = 'Tidak ada koneksi internet. Sambungkan internet dulu, lalu coba setup lagi -- jangan lanjutkan dalam keadaan offline supaya tidak membuat salt/akun baru yang terpisah.';
        } else if (e && e.code === 'CHECK_FAILED') {
            st.innerText = 'Gagal mengecek apakah backend ini sudah pernah disetup dari device lain (cek URL/API key/koneksi). Coba lagi, jangan lanjutkan sampai ini berhasil.';
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
        var _psTagFilter = window.tagOrFilter(_psTag);
        var result = await window.callSupabaseAPI(
            'settings',
            'GET',
            null,
            '?book_id=eq.' + bookId + '&key=eq.' + key + '&order=updated_at.desc&limit=1' + _psTagFilter
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
            if (st) { st.style.color = '#7E2E2E'; st.innerText = 'Nama tidak valid. Gunakan huruf, angka, spasi, atau tanda hubung.'; }
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
    if (st) { st.style.color = '#2E6B4F'; st.innerText = 'Tersimpan: ' + newId; }
    window.showToast('Nama perangkat diperbarui!', 'success');
};

// ── PERANGKAT TERHUBUNG ──
// Dipanggil dari panel "Perangkat Terhubung" -- sekarang panel inline di
// halaman Setelan (deviceManagerModal terpisah sudah dihapus dari HTML).
window.openDeviceManager = function() {
    if (typeof window.openSetelanModal === 'function') window.openSetelanModal('devices');
    window.loadConnectedDevices();
};

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
        var tagFilter = window.tagOrFilter(tag);

        var logs = await window.callSupabaseAPI(
            'audit_logs', 'GET', null,
            '?book_id=eq.' + bookId + '&order=timestamp.desc&limit=500' + tagFilter
        );

        if (!logs || !Array.isArray(logs) || logs.length === 0) {
            if (statusEl) statusEl.innerText = '';
            listEl.innerHTML = '<div style="font-size:.72rem; color:#9AA2AC; text-align:center; padding:20px 0;">Belum ada log aktivitas di cloud.</div>';
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

        var now = new Date();
        var allDevices = Object.values(deviceMap).sort(function(a, b) {
            return b.last_seen.localeCompare(a.last_seen);
        });

        // [FIX] Perangkat yang tidak aktif lebih dari 30 hari terakhir tidak
        // ditampilkan lagi di daftar -- daftar ini untuk memantau perangkat
        // yang masih dipakai, bukan arsip semua perangkat yang pernah pernah
        // terhubung sejak awal.
        var devices = allDevices.filter(function(d) {
            var diffDays = Math.floor((now - new Date(d.last_seen)) / 86400000);
            return diffDays <= 30;
        });
        var hiddenCount = allDevices.length - devices.length;

        var myId = window.deviceId || localStorage.getItem('sk_device_id') || '';

        if (statusEl) {
            statusEl.innerText = devices.length + ' perangkat aktif dari ' + logs.length + ' log' +
                (hiddenCount > 0 ? ' (' + hiddenCount + ' perangkat tidak aktif >30 hari disembunyikan).' : '.');
        }

        if (!devices.length) {
            listEl.innerHTML = '<div style="font-size:.72rem; color:#9AA2AC; text-align:center; padding:20px 0;">Tidak ada perangkat yang aktif dalam 30 hari terakhir.</div>';
            return;
        }

        var html = '';
        devices.forEach(function(d) {
            var isMe = d.device_id === myId;
            var lastDate = new Date(d.last_seen);
            var diffDays = Math.floor((now - lastDate) / 86400000);
            var lastLabel = diffDays === 0 ? 'Hari ini'
                : diffDays === 1 ? 'Kemarin'
                : diffDays + ' hari lalu';

            var dotColor = diffDays <= 7 ? '#2E6B4F' : '#9C7A2E';
            var topActions = Object.entries(d.actions)
                .sort(function(a, b) { return b[1] - a[1]; })
                .slice(0, 3).map(function(a) { return a[0]; }).join(', ');

            html += '<div style="border:1px solid var(--rule); border-radius: var(--radius-sm); padding:10px 12px; margin-bottom:8px; background:var(--paper);">';
            html += '<div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:4px 8px; margin-bottom:4px;">';
            html += '<span style="font-size:.78rem; font-weight:700; color:var(--ink); word-break:break-word;">';
            html += '<span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:' + dotColor + '; margin-right:5px; vertical-align:middle;"></span>';
            html += window.escapeHtml(d.device_id);
            if (isMe) html += ' <span style="font-size:.6rem; background:#E3F0E9; color:#1F5138; padding:1px 7px; border-radius: var(--radius-sm); font-weight:600; vertical-align:middle;">Perangkat ini</span>';
            html += '</span>';
            html += '<span style="font-size:.65rem; color:#9AA2AC;">' + d.count + ' aksi</span>';
            html += '</div>';
            html += '<div style="font-size:.65rem; color:#9AA2AC; line-height:1.7;">';
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

// ── LOG ERROR (toast merah) ──
// Render ulang badge jumlah + preview terbaru di panel "Log Error" Setelan.
// Dipanggil saat Setelan dibuka (openSetelanModal) dan setiap kali ada
// error baru direkam (lihat window._recordToastError di js/utils.js).
window._refreshToastErrorLogPanel = function() {
    var badge = document.getElementById('errorLogCountBadge');
    var preview = document.getElementById('errorLogPreview');
    if (!badge && !preview) return; // panel belum ada di DOM (mis. saat init awal)

    var log = window.getToastErrorLog ? window.getToastErrorLog() : [];
    if (badge) {
        badge.textContent = log.length + ' tercatat';
        badge.className = 'setelan-badge ' + (log.length > 0 ? 'setelan-badge--warning' : 'setelan-badge--neutral');
    }
    if (!preview) return;

    if (!log.length) {
        preview.innerHTML = '<div style="font-size:.72rem; color:#9AA2AC; text-align:center; padding:16px 0;">Belum ada error tercatat.</div>';
        return;
    }

    // Tampilkan yang terbaru dulu, maksimal 10 di preview (semua tetap ikut
    // saat diekspor -- lihat window.exportToastErrorLog).
    var recent = log.slice(-10).reverse();
    var html = '';
    recent.forEach(function(entry) {
        var d = new Date(entry.timestamp);
        var dateLabel = d.toLocaleDateString('id-ID', {day:'2-digit', month:'short'}) + ' ' + d.toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit'});
        html += '<div style="border-left:2px solid var(--danger); padding:6px 10px; margin-bottom:6px; background:var(--paper);">';
        html += '<div style="font-size:.65rem; color:#9AA2AC; margin-bottom:2px;">' + dateLabel + '</div>';
        html += '<div style="font-size:.72rem; color:var(--ink);">' + window.escapeHtml(entry.message) + '</div>';
        html += '</div>';
    });
    if (log.length > 10) {
        html += '<div style="font-size:.65rem; color:#9AA2AC; text-align:center; padding-top:4px;">+ ' + (log.length - 10) + ' lainnya (ikut ke ekspor)</div>';
    }
    preview.innerHTML = html;
};
