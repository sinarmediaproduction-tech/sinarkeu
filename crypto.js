// ==================== APP INITIALIZATION ====================
window.updateSyncStatusBadge = function() {
    const wrapper = document.getElementById('syncStatusWrapper');
    const tag = document.getElementById('syncStatusTag');
    const online = window.isOnline();
    if (online && window.getCloudUrl() && window.getSupabaseKey()) {
        wrapper.className = 'sync-status-container online';
        tag.innerHTML = 'SUPABASE ON';
    } else if (!navigator.onLine) {
        wrapper.className = 'sync-status-container offline';
        tag.innerHTML = 'MODE BACA SAJA';
    } else {
        wrapper.className = 'sync-status-container offline';
        tag.innerHTML = 'CLOUD OFF';
    }
};
window.updateSyncTimeBadge = function() {
    const el = document.getElementById('syncTimeBadge');
    if (!el) return;
    if (window._lastSyncTime) {
        const timeStr = window._lastSyncTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        el.innerText = `${timeStr}`;
        el.style.color = '#2E6B4F';
    } else {
        el.innerText = `--:--:--`;
        el.style.color = '#9AA2AC';
    }
};
window.updateUIForOnlineStatus = function() {
    const online = window.isOnline();
    const offlineWarning = document.getElementById('offlineWarningBar');
    const actionButtons = ['tambahTransaksiBtn', 'navBookBtn', 'navSetelanBtn', 'manualSyncBtn', 'anggaranBtn', 'anggaranDasarBtn', 'backupBtn'];
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
        // [FIX RACE CONDITION] Kalau sedang menambah/mengedit akun (lihat
        // window._acctCredTestLock di js/account.js), window.globalSupabaseUrl/
        // Key sementara menunjuk ke backend BARU yang sedang diuji, bukan
        // backend akun yang sedang aktif. Lewati tick ini supaya autosync tidak
        // diam-diam push/pull ke backend yang salah pakai kunci enkripsi akun
        // lama -- tick berikutnya (30 detik lagi) akan berjalan normal setelah
        // proses tambah/edit akun selesai.
        if (window._acctCredTestLock) return;
        if (window.isOnline()) {
            // Prioritaskan perubahan Fase Kehidupan yang tersimpan saat
            // offline/gagal koneksi sebelum menarik setting dari cloud,
            // supaya nilai lokal yang paling baru tidak tertimpa snapshot lama.
            if (window.flushPendingFaseKehidupanSync) await window.flushPendingFaseKehidupanSync();
            // Retry dulu penghapusan yang mungkin masih tertunda (gagal PATCH
            // sebelumnya) SEBELUM pull, dengan alasan yang sama seperti di
            // continueAppInit(): supaya baris yang harusnya sudah dihapus tidak
            // sempat "hidup lagi" gara-gara pull duluan menariknya balik.
            await window.flushPendingDeletesOnStart();
            if (window.flushPendingBookDeletesOnStart) await window.flushPendingBookDeletesOnStart();
            await window.flushPendingPaymentReminders();
            await window.flushPendingAuditLogs();
            // [FIX RACE/JARINGAN FLAKY] Self-heal: kalau ada buku yang menurut
            // cache lokal (window.books, persisten dari localStorage) berstatus
            // shared TAPI belum tercatat di window._skSharedRoles (mis. gagal
            // waktu continueAppInit dulu, ATAU retry di skRefreshSharedAccess
            // sendiri juga sempat habis), coba refresh lagi di sini -- supaya
            // sesi yang sempat "salah rute" (pakai anon key utk buku shared)
            // tidak tersangkut begitu terus sampai reload manual. Lihat log
            // toast-error 29 Juli 2026 untuk kasus nyata yang memicu ini.
            const hasUnrefreshedSharedBook = window._skAuthUser && Array.isArray(window.books) &&
                window.books.some(function(b) { return b._isShared && !window.skIsSharedBookId(b.id); });
            if (hasUnrefreshedSharedBook && typeof window.skRefreshSharedAccess === 'function') {
                try { await window.skRefreshSharedAccess(); } catch (e) { console.warn('[AutoSync] Self-heal skRefreshSharedAccess gagal:', e); }
            }
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
    clearTimeout(window._lockAutoTimer);
    if (window._lockUnlockInFlight) return; // cegah proses dobel kalau debounce & Enter nembak bersamaan
    const inp = document.getElementById('lockPasswordInput');
    const pwd = inp.value;
    const status = document.getElementById('lockStatus');
    if (!pwd) { status.innerText = window.t('lock_pwd_empty'); return; }
    // [SECURITY] Anti brute-force: kalau masih dalam masa tunggu akibat
    // percobaan gagal berturut-turut sebelumnya, tolak dulu tanpa mencoba
    // dekripsi/verifikasi ke cloud. Lihat window.getUnlockWaitMs di crypto.js.
    const waitSec = window.getUnlockWaitMs ? window.getUnlockWaitMs() : 0;
    if (waitSec > 0) {
        status.innerText = `Terlalu banyak percobaan gagal. Coba lagi dalam ${waitSec} detik.`;
        return;
    }
    window._lockUnlockInFlight = true;
    inp.disabled = true;
    status.innerText = window.t('lock_verifying');
    const ok = await window.unlockWithPassword(pwd);
    if (window.recordUnlockAttempt) window.recordUnlockAttempt(ok);
    window._lockUnlockInFlight = false;
    if (ok) {
        document.getElementById('passwordLockScreen').style.display = 'none';
        // [SECURITY] Jaga-jaga: pastikan pembatasan akses "hanya panel Akun"
        // (dipasang lewat window.openAccountManagerFromLock, lihat js/account.js)
        // ikut lepas begitu password benar-benar terverifikasi.
        document.body.classList.remove('lockscreen-restricted');
        window.continueAppInit();
    } else {
        inp.disabled = false;
        const nextWait = window.getUnlockWaitMs ? window.getUnlockWaitMs() : 0;
        status.innerText = nextWait > 0
            ? `${window.t('lock_wrong_pwd')} Terlalu banyak percobaan, tunggu ${nextWait} detik.`
            : window.t('lock_wrong_pwd');
        inp.classList.add('error-shake');
        inp.value = '';
        inp.focus();
        setTimeout(() => inp.classList.remove('error-shake'), 400);
    }
};

// [FIX] Layar kunci tampil duluan dari CSS (display:flex default) sebelum
// semua script di bawah <body> selesai dimuat, jadi input/tombolnya sengaja
// disabled di HTML supaya tidak memicu ReferenceError kalau user keburu
// menekan Enter/klik. Begitu baris ini jalan (app.js sudah lengkap, dan
// crypto.js yang berisi toggleLockEye/clearLockError sudah lebih dulu
// selesai dimuat), baru diaktifkan.
(function enableLockScreenInputs() {
    const inp = document.getElementById('lockPasswordInput');
    const eyeBtn = document.getElementById('lockEyeBtn');
    if (inp) inp.disabled = false;
    if (eyeBtn) eyeBtn.disabled = false;

    // [UX] Tidak ada lagi tombol "Buka": password diverifikasi otomatis
    // begitu user berhenti mengetik sejenak (debounce 700ms). Sengaja pakai
    // debounce (bukan tiap keystroke) supaya: (1) tidak memicu dekripsi
    // PBKDF2 + verifikasi cloud yang berat di setiap huruf yang diketik, dan
    // (2) tidak menghabiskan jatah anti-brute-force (recordUnlockAttempt)
    // hanya karena password belum selesai diketik. Kalau password benar,
    // layar langsung tertutup tanpa perlu klik apa pun; kalau salah, pesan
    // error baru muncul setelah user benar-benar berhenti mengetik.
    if (inp) {
        inp.addEventListener('input', () => {
            clearTimeout(window._lockAutoTimer);
            if (!inp.value) return;
            window._lockAutoTimer = setTimeout(() => {
                if (!window._lockUnlockInFlight) window.submitLockPassword();
            }, 700);
        });
    }
})();

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
    // [FIX] Indeks hash URL akun aktif untuk deteksi duplikat Supabase project
    // saat menambah akun baru (lihat window._backfillActiveAccountUrlHash di
    // account.js). Fire-and-forget, tidak menghalangi render UI.
    if (typeof window._backfillActiveAccountUrlHash === 'function') window._backfillActiveAccountUrlHash();

    // [MULTIROLE] Lockscreen device sebagai gerbang utama: begitu password
    // lokal benar (di atas), langsung tarik status Buku Bersama -- KALAU
    // sesi Supabase Auth punya profil/device ini masih tersimpan (dari
    // login manual sebelumnya) -- dan terapkan pembatasan UI-nya seketika.
    // Kalau belum pernah login sama sekali (window._skAuthUser masih
    // null), ini no-op aman untuk fetch-nya -- tapi skApplyRoleUI() di
    // bawah tetap jalan dan akan mengunci Setelan/Backup/Kelola Device
    // (default role global 'editor' kalau belum login, lihat
    // skComputeGlobalRole di js/auth.js).
    if (typeof window.skRefreshSharedAccess === 'function' && window.getCloudUrl && window.getCloudUrl()) {
        try { await window.skRefreshSharedAccess(); } catch (e) { console.warn('[App] Gagal refresh akses Buku Bersama saat unlock:', e); }
    }
    if (typeof window.skApplyRoleUI === 'function') window.skApplyRoleUI();

    // [MULTIROLE GATE] Wajib login Buku Bersama SEBELUM masuk app -- tapi
    // HANYA kalau device ini sudah pernah di-setup ke cloud (kalau belum,
    // panel login tidak mungkin dipakai -- butuh koneksi & akun cloud) DAN
    // lagi online DAN belum ada sesi login tersimpan. Kalau salah satu
    // syarat itu tidak terpenuhi, app tetap bisa dipakai seperti biasa
    // (role default 'editor' dari skComputeGlobalRole) -- solo user
    // offline murni tidak pernah nyangkut di gerbang yang tidak mungkin
    // mereka lewati. Sesi yang sudah ada (dari kunjungan sebelumnya)
    // membuat gerbang ini otomatis dilewati -- tidak perlu login ulang
    // tiap buka app (lihat skShowLoginGate di js/auth.js untuk detail).
    const needsLoginGate = !window._skAuthUser && window.getCloudUrl && window.getCloudUrl() &&
        window.isOnline && window.isOnline() && typeof window.skShowLoginGate === 'function';
    if (needsLoginGate) {
        await window.skShowLoginGate();
        if (typeof window.skHideLoginGate === 'function') window.skHideLoginGate();
        if (typeof window.skApplyRoleUI === 'function') window.skApplyRoleUI();
    }

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
    window.updateSyncStatusBadge();
    if (!window.getCloudUrl() || !window.getSupabaseKey()) {
        setTimeout(() => window.openSetupModal(), 400);
    } else {
        if (window.isOnline()) {
            // [FIX RACE MULTI-TAB/SESSION] Push dulu sisa dirty ids dari sesi/tab
            // sebelumnya yang mungkin belum sempat ter-sync (tab ditutup, koneksi
            // putus, dsb) SEBELUM pullAllBooksFromCloud() di bawah menimpa cache
            // lokal buku-buku itu. Lihat window.flushPendingDirtyOnStart di
            // js/transaction.js untuk detail.
            await window.flushPendingDirtyOnStart();
            await window.flushPendingDeletesOnStart();
            if (window.flushPendingBookDeletesOnStart) await window.flushPendingBookDeletesOnStart();
            await window.flushPendingPaymentReminders();
            await window.flushPendingAuditLogs();
            if (window.flushPendingFaseKehidupanSync) await window.flushPendingFaseKehidupanSync();
            await window.pullAllSettings();
            // Self-heal: kalau device ini sudah lama pakai salt lokal sendiri tapi
            // belum pernah ke-push ke cloud, push sekarang. Mencegah device lain
            // yang setup belakangan generate salt sendiri karena mengira cloud
            // masih kosong. Lihat catatan lengkap di window.ensureCryptoSaltPushed
            // (js/crypto.js).
            await window.ensureCryptoSaltPushed();
            window.loadGoogleSheetsUrl();
            const localGsUrl = localStorage.getItem('sk_google_sheets_url');
            if (localGsUrl && window.isOnline()) {
                window.pushSetting('google_sheets_url', localGsUrl, 'global');
            }
            window.updateBookSelectDropdown();
            window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
            window.updateTgStatusBadge();
            await window.pullAllBooksFromCloud();
            // Render ulang dropdown SETELAH data semua buku ditarik dari Supabase,
            // supaya saldo per buku yang ditampilkan sudah yang terbaru dari cloud
            // -- bukan cache lokal lama dari updateBookSelectDropdown() sebelumnya.
            window.updateBookSelectDropdown();
            
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
            // [FITUR DIHAPUS] Auto-backup harian ke cloud (checkAndRunDailyAutoBackup,
            // dulu di sini) sudah dihapus -- lihat catatan di js/backup.js. Pemulihan
            // data sekarang sepenuhnya lewat Snapshot Keamanan harian (lihat
            // window.checkAndRunDailySafetySnapshot, dijadwalkan di bawah fungsi ini).
            setTimeout(window.scheduleDailySummary, 5000);
        } else {
            window.loadTransactions();
        }
    }
    window.startAutoSync();
    // Checklist belanja adalah daftar rutin: ketika sesi pertama dibuka di
    // bulan baru, buka kembali semua centang tanpa menghapus transaksi bulan
    // sebelumnya. Fungsi yang sama juga dipanggil saat halaman Belanja dibuka.
    if (typeof window.ensureShoppingListMonthlyCycle === 'function') {
        window.ensureShoppingListMonthlyCycle(window.currentBookId);
    }
    if (typeof window.ensureAnnualBudgetYearlyCycle === 'function') {
        window.ensureAnnualBudgetYearlyCycle(window.currentBookId);
    }
    window.updateUIForOnlineStatus();
    // Snapshot Keamanan harian: tidak perlu online (murni localStorage), jadi
    // dipanggil di sini -- di luar percabangan online/offline di atas -- supaya
    // tetap berjalan walau user sedang offline.
    setTimeout(window.checkAndRunDailySafetySnapshot, 2000);
    // Mulai auto-lock: kunci otomatis setelah tidak ada aktivitas
    if (typeof window.autoLock !== 'undefined') window.autoLock.start();
    // [BUG FIX 1] Event listener online/offline/visibilitychange hanya boleh
    // didaftarkan SEKALI. continueAppInit() bisa dipanggil >1x dalam satu sesi
    // (misal: auto-lock -> buka password lagi), sehingga tanpa guard ini
    // listener menumpuk dan forceFullSync() dipanggil berkali-kali.
    if (!window._globalListenersRegistered) {
        window._globalListenersRegistered = true;
        window.addEventListener('online', () => { window.updateSyncStatusBadge(); window.updateUIForOnlineStatus(); Promise.all([window.flushPendingDeletesOnStart(), window.flushPendingBookDeletesOnStart ? window.flushPendingBookDeletesOnStart() : Promise.resolve(), window.flushPendingPaymentReminders(), window.flushPendingAuditLogs()]).then(() => window.forceFullSync()); });
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
    else window.books = [];
    window.currentBookId = localStorage.getItem('sk_current_book_id') || null;
    if (window.books.length && !window.books.find(b => b.id === window.currentBookId)) window.currentBookId = window.books[0].id;
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
    // [FIX RACE] Sebelumnya dipanggil TANPA await -- initApp() (dan promise
    // yang ditunggu DOMContentLoaded di bawah) jadi selesai duluan sebelum
    // continueAppInit() benar-benar rampung (skRefreshSharedAccess, login
    // gate, populate #budgetYear/#budgetMonth, pullAllSettings/
    // pullAllBooksFromCloud, dst). Akibatnya window.restoreLastFullviewModal()
    // (dipanggil persis setelah `await window.initApp()` selesai) bisa jalan
    // SEBELUM #budgetYear terisi opsi tahun -- renderBudget() lalu membaca
    // value "" -> parseInt jadi NaN -> query cloud "NaN-01-01" (lihat
    // toast-error-log 29 Juli 2026, error 22007 invalid input syntax for
    // type timestamp). Menambahkan await ini mengembalikan urutan yang
    // sudah diasumsikan oleh komentar di window.restoreLastFullviewModal
    // (js/utils.js): "dipanggil SETELAH initApp() selesai".
    await window.continueAppInit();
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

// Sidebar (mobile: slide-in dari kiri; desktop: selalu terbuka via CSS)
window.openMobileDrawer = function() {
    document.getElementById("mobileDrawerOverlay").style.opacity = "1";
    document.getElementById("mobileDrawerOverlay").style.pointerEvents = "auto";
    document.getElementById("appSidebar").classList.add("open");
};
window.closeMobileDrawer = function() {
    document.getElementById("mobileDrawerOverlay").style.opacity = "0";
    document.getElementById("mobileDrawerOverlay").style.pointerEvents = "none";
    document.getElementById("appSidebar").classList.remove("open");
};

// [SIDEBAR-COLLAPSE] Ciutkan/perluas sidebar desktop jadi icon-only.
// Cuma berefek di desktop (>=1024px, lihat body.sidebar-collapsed di
// css/style.css) -- di mobile sidebar tetap drawer overlay seperti biasa.
window.toggleSidebarCollapse = function() {
    var collapsed = document.body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sk_sidebar_collapsed', collapsed ? '1' : '0');
    var toggleBtn = document.getElementById('sidebarCollapseToggle');
    if (toggleBtn) {
        var label = collapsed ? 'Perluas Sidebar' : 'Ciutkan Sidebar';
        toggleBtn.title = label;
        toggleBtn.setAttribute('aria-label', label);
    }
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
window.addEventListener('DOMContentLoaded', async () => {
    // Sync dark mode icon state setelah DOM ready
    var savedDark = localStorage.getItem('sk_dark_mode') === '1';
    window.applyTheme(savedDark);

    await window.initApp();
    window.fetchForexRate();
    setTimeout(window.fetchGoldPrice, 1500);
    window.updateEmasQuotaDisplay();

    // [RESTORE-REFRESH] Baru dipanggil SETELAH initApp() selesai (buku
    // aktif, anggaran, dst sudah kebaca) supaya menu yang direstore (mis.
    // Belanja Bulanan, Harga Komoditas) punya data yang benar, bukan
    // render kosong/salah buku.
    if (typeof window.restoreLastFullviewModal === 'function') window.restoreLastFullviewModal();
});

// ==================== DARK MODE ====================

window.applyTheme = function(dark) {
    if (dark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    // Samakan warna title bar (browser/PWA) dengan tema aktif -- sidebar/
    // topbar TIDAK lagi navy konstan di dark mode (sekarang ikut skema
    // GitHub Dark Dimmed), jadi meta ini harus ikut berbeda per tema.
    var themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', dark ? '#1C2128' : '#16233F');
    }
    var icon = document.getElementById('darkModeIcon');
    var iconMobile = document.getElementById('darkModeIconMobile');
    // Sun icon for dark mode (click to go light), moon icon for light mode
    var sunSvg = '<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>';
    var moonSvg = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
    if (icon) icon.innerHTML = dark ? sunSvg : moonSvg;
    if (iconMobile) iconMobile.innerHTML = dark ? sunSvg : moonSvg;
    var mobileLabel = document.querySelector('#navDarkModeToggleBtn span');
    if (mobileLabel) mobileLabel.textContent = dark ? 'Mode Terang' : 'Mode Gelap';
};

window.toggleDarkMode = function() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var newDark = !isDark;
    localStorage.setItem('sk_dark_mode', newDark ? '1' : '0');
    window.applyTheme(newDark);
    // Re-render cards yang backgroundnya di-set via JS agar warna ikut update
    if (typeof window.renderBudget === 'function') window.renderBudget();
    if (typeof window.updateFinancialCards === 'function') window.updateFinancialCards();
    if (typeof window.updatePaymentReminderBanner === 'function') window.updatePaymentReminderBanner();
    // Jika modal pengingat sedang terbuka, render ulang list-nya juga
    var prModal = document.getElementById('paymentReminderModal');
    if (prModal && prModal.classList.contains('open')) {
        if (typeof window.renderPaymentReminders === 'function') window.renderPaymentReminders();
    }
    // Jika modal laporan sedang terbuka dan sudah ada konten, generate ulang
    var repModal = document.getElementById('monthlyReportModal');
    var repContent = document.getElementById('reportContent');
    if (repModal && repModal.classList.contains('open') && repContent && repContent.querySelector('table')) {
        if (typeof generateMonthlyReport === 'function') generateMonthlyReport();
    }
};

// Apply on load (sebelum render apapun untuk menghindari flash)
(function() {
    var saved = localStorage.getItem('sk_dark_mode');
    if (saved === '1') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

// [SIDEBAR-COLLAPSE] Terapkan state ciutkan sidebar sebelum render, sama
// polanya dengan dark mode di atas (hindari flash sidebar lebar penuh
// lalu tiba-tiba menciut). Hanya berpengaruh di desktop lewat CSS.
(function() {
    if (localStorage.getItem('sk_sidebar_collapsed') === '1') {
        document.body.classList.add('sidebar-collapsed');
        var toggleBtn = document.getElementById('sidebarCollapseToggle');
        if (toggleBtn) {
            toggleBtn.title = 'Perluas Sidebar';
            toggleBtn.setAttribute('aria-label', 'Perluas Sidebar');
        }
    }
})();
