// ==================== SETTINGS ====================
window.openSetelanModal = function() {
    const urlEl = document.getElementById('supabaseUrlInput');
    const keyEl = document.getElementById('supabaseKeyInput');
    const statusEl = document.getElementById('connectionStatus');
    if (urlEl) urlEl.value = window.getCloudUrl() || window.globalSupabaseUrl || '';
    if (keyEl) keyEl.value = '';
    if (statusEl) statusEl.innerHTML = '';
    const workerInp = document.getElementById('aiWorkerUrlInput');
    const workerSt  = document.getElementById('aiWorkerTestStatus');
    if (workerInp) workerInp.value = localStorage.getItem('sk_ai_worker_url') || '';
    if (workerSt)  workerSt.innerText = '';
    window.updateAiWorkerBadge();
    const emasInp = document.getElementById('emasApiKeyInput');
    const emasSt  = document.getElementById('emasApiTestStatus');
    if (emasInp) emasInp.value = localStorage.getItem('sk_emas_api_key') || '';
    if (emasSt)  emasSt.innerText = '';
    const emasGramInp = document.getElementById('emasGramInput');
    if (emasGramInp) emasGramInp.value = localStorage.getItem('sk_emas_gram') || '';
    window.updateEmasApiBadge();
    window.updateEmasGramPreview();
    const zakatInp = document.getElementById('zakatPersenInput');
    if (zakatInp) zakatInp.value = localStorage.getItem('sk_zakat_persen') || '';
    window.updateZakatPreview();
    const gsUrl = document.getElementById('googleSheetsUrlInput');
    if (gsUrl) gsUrl.value = localStorage.getItem('sk_google_sheets_url') || '';
    const gsStatus = document.getElementById('googleSheetsStatus');
    if (gsStatus) gsStatus.innerText = '';
    window.openModal('setelanModal');
};

window.testCloudConnection = async function() {
    let urlInput = document.getElementById('supabaseUrlInput').value.trim();
    let keyInput = document.getElementById('supabaseKeyInput').value.trim();
    let statusDiv = document.getElementById('connectionStatus');
    if (!urlInput || !keyInput) {
        statusDiv.innerHTML = '<div class="connection-status error">Gagal: Harap isi URL & Anon Key!</div>';
        return;
    }
    statusDiv.innerHTML = '<div class="connection-status testing">Sedang mengetes koneksi ke Supabase...</div>';
    window.globalSupabaseUrl = urlInput;
    window.globalSupabaseKey = keyInput;
    const testFetch = await window.callSupabaseAPI('transactions', 'GET', null, '?limit=1');
    if (testFetch !== null) {
        await window.reEncryptCredentials(window.globalSupabaseUrl, window.globalSupabaseKey);
        statusDiv.innerHTML = '<div class="connection-status success">Sukses! Koneksi terenkripsi & berlaku untuk semua buku. Memulai unduh data...</div>';
        window.showToast("Supabase terhubung & terenkripsi!", "success");
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
        window.showToast("Koneksi cloud gagal!", "error");
        window.updateSyncStatusBadge();
    }
};

window.changePassword = async function() {
    const oldPwd = document.getElementById('changePwdOld').value;
    const newPwd = document.getElementById('changePwdNew').value;
    const newPwd2 = document.getElementById('changePwdNew2').value;
    const status = document.getElementById('changePwdStatus');
    status.style.color = '#de350b';
    if (!oldPwd || !newPwd || !newPwd2) { status.innerText = '❌ Semua field wajib diisi.'; return; }
    if (newPwd.length < 6) { status.innerText = '❌ Password baru minimal 6 karakter.'; return; }
    if (newPwd !== newPwd2) { status.innerText = '❌ Konfirmasi tidak cocok.'; return; }
    status.style.color = '#cc7b00';
    status.innerText = '⏳ Memverifikasi...';
    const saltB64 = localStorage.getItem('sk_crypto_salt');
    if (!saltB64) { status.style.color = '#de350b'; status.innerText = '❌ Data enkripsi tidak ditemukan.'; return; }
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    let oldKey;
    try {
        oldKey = await window.deriveKey(oldPwd, salt);
        const plain = await window.decryptStr(oldKey, localStorage.getItem('sk_crypto_check'));
        if (plain !== 'sinarkeu_ok') throw new Error('wrong');
    } catch { status.style.color = '#de350b'; status.innerText = '❌ Password lama salah.'; return; }
    let url, apiKey;
    try {
        url = await window.decryptStr(oldKey, localStorage.getItem('sk_enc_supabase_url'));
        apiKey = await window.decryptStr(oldKey, localStorage.getItem('sk_enc_supabase_key'));
    } catch { status.style.color = '#de350b'; status.innerText = '❌ Gagal membaca data terenkripsi.'; return; }
    status.innerText = '⏳ Mengenkripsi ulang...';
    await window.setupNewPassword(newPwd, url, apiKey);
    window.globalSupabaseUrl = url;
    window.globalSupabaseKey = apiKey;
    sessionStorage.setItem('sk_session_url', url);
    sessionStorage.setItem('sk_session_akey', apiKey);
    sessionStorage.setItem('sk_session_ts', Date.now().toString());
    status.style.color = '#00875a';
    status.innerText = '✅ Password berhasil diganti!';
    document.getElementById('changePwdOld').value = '';
    document.getElementById('changePwdNew').value = '';
    document.getElementById('changePwdNew2').value = '';
    window.showToast('Password berhasil diganti 🔐', 'success');
};

window.doFirstTimeSetup = async function() {
    const url = document.getElementById('setupUrlInput').value.trim();
    const key = document.getElementById('setupKeyInput').value.trim();
    const pwd = document.getElementById('setupPwdInput').value;
    const pwd2 = document.getElementById('setupPwdConfirm').value;
    const st = document.getElementById('setupStatusMsg');
    const btn = document.getElementById('setupConnectBtn');
    if (!url || !key) { st.className = 'setup-status error'; st.innerText = '❌ Supabase URL dan Anon Key wajib diisi!'; return; }
    if (!pwd || pwd.length < 6) { st.className = 'setup-status error'; st.innerText = '❌ Password minimal 6 karakter!'; return; }
    if (pwd !== pwd2) { st.className = 'setup-status error'; st.innerText = '❌ Konfirmasi password tidak cocok!'; return; }
    btn.disabled = true;
    btn.innerText = '⏳ Mengetes koneksi...';
    st.className = 'setup-status warning';
    st.innerText = '⏳ Menghubungkan ke Supabase...';
    window.globalSupabaseUrl = url;
    window.globalSupabaseKey = key;
    const test = await window.callSupabaseAPI('transactions', 'GET', null, '?limit=1');
    if (test === null) {
        window.globalSupabaseUrl = '';
        window.globalSupabaseKey = '';
        btn.disabled = false;
        btn.innerText = '🔐 Simpan & Mulai';
        st.className = 'setup-status error';
        st.innerText = '❌ Koneksi gagal! Periksa kembali URL dan Anon Key Anda.';
        return;
    }
    st.innerText = '⏳ Mengenkripsi kredensial...';
    await window.setupNewPassword(pwd, url, key);
    window.updateSyncStatusBadge();
    st.className = 'setup-status success';
    st.innerText = '✅ Berhasil! Kredensial terenkripsi dengan password Anda.';
    btn.innerText = '✅ Tersambung';
    setTimeout(async () => {
        window.closeModal('firstTimeSetupModal');
        window.showToast('Setup selesai! Data terenkripsi aman 🔐', 'success');
        await window.continueAppInit();
    }, 900);
};

// ============================================================
// SETTINGS.JS - FUNGSI MIGRASI & STATUS
// ============================================================

window.runFullMigration = async function() {
    const bookId = window.currentBookId;
    const st = document.getElementById('migrationStatus');
    
    if (!window.isOnline()) {
        st.style.color = '#de350b';
        st.innerText = '❌ Anda harus ONLINE untuk migrasi!';
        return;
    }
    
    st.style.color = '#cc7b00';
    st.innerText = '⏳ Memulai migrasi data...';
    
    try {
        st.innerText = '⏳ Migrasi jadwal pembayaran...';
        await window.migratePaymentReminders(bookId);
        
        st.innerText = '⏳ Migrasi anggaran...';
        await window.migrateAllBudgets(bookId);
        
        st.innerText = '⏳ Sinkronisasi akhir...';
        await window.syncAllPaymentReminders(bookId);
        await window.syncAllBudgetsToCloud(bookId);
        
        st.style.color = '#00875a';
        st.innerText = '✅ Migrasi selesai! Semua data tersinkronisasi ke cloud.';
        window.showToast('✅ Migrasi data berhasil!', 'success');
        
        await window.pullAllSettings();
        await window.pullPaymentRemindersFromCloud(bookId);
        window.renderBudget();
        await window.renderPaymentReminders();
        
    } catch (e) {
        st.style.color = '#de350b';
        st.innerText = `❌ Gagal migrasi: ${e.message}`;
        console.error('[Migration] Error:', e);
    }
};

window.checkMigrationStatus = async function() {
    const bookId = window.currentBookId;
    const st = document.getElementById('migrationStatus');
    
    if (!window.isOnline()) {
        st.style.color = '#de350b';
        st.innerText = '❌ Anda harus ONLINE untuk cek status!';
        return;
    }
    
    st.style.color = '#cc7b00';
    st.innerText = '⏳ Memeriksa status...';
    
    try {
        const prResult = await window.callSupabaseAPI(
            'payment_reminders',
            'GET',
            null,
            `?book_id=eq.${bookId}&limit=1`
        );
        const hasPR = prResult && Array.isArray(prResult) && prResult.length > 0;
        
        const budgetResult = await window.callSupabaseAPI(
            'settings',
            'GET',
            null,
            `?book_id=eq.${bookId}&key=eq.default_budget&limit=1`
        );
        const hasBudget = budgetResult && Array.isArray(budgetResult) && budgetResult.length > 0;
        
        const annualResult = await window.callSupabaseAPI(
            'settings',
            'GET',
            null,
            `?book_id=eq.${bookId}&key=eq.annual_budget&limit=1`
        );
        const hasAnnual = annualResult && Array.isArray(annualResult) && annualResult.length > 0;
        
        let status = [];
        if (hasPR) status.push('✅ Jadwal pembayaran');
        else status.push('❌ Jadwal pembayaran (belum di-cloud)');
        
        if (hasBudget) status.push('✅ Anggaran dasar & bulanan');
        else status.push('❌ Anggaran (belum di-cloud)');
        
        if (hasAnnual) status.push('✅ Anggaran tahunan');
        else status.push('❌ Anggaran tahunan (belum di-cloud)');
        
        st.style.color = '#1a1a1a';
        st.innerHTML = status.join('<br>');
        
        if (!hasPR || !hasBudget || !hasAnnual) {
            st.innerHTML += '<br><span style="color:#cc7b00;">💡 Klik "Migrasi Semua Data" untuk menyinkronkan.</span>';
        }
        
    } catch (e) {
        st.style.color = '#de350b';
        st.innerText = `❌ Gagal cek status: ${e.message}`;
    }
};

// ── PULL SETTING (untuk fase kehidupan dll) ──
window.pullSetting = async function(key, bookId) {
    if (!window.isOnline()) return null;
    if (!bookId) bookId = window.currentBookId;
    
    try {
        const result = await window.callSupabaseAPI(
            'settings',
            'GET',
            null,
            `?book_id=eq.${bookId}&key=eq.${key}&limit=1`
        );
        
        if (result && Array.isArray(result) && result.length > 0) {
            const decrypted = await window._decryptSettingValue(result[0].value);
            const parsed = JSON.parse(decrypted);
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
    const modal = document.getElementById('firstTimeSetupModal');
    if (modal) {
        modal.classList.add('show');
        document.getElementById('setupStatusMsg').className = 'setup-status';
        document.getElementById('setupStatusMsg').innerText = '';
        document.getElementById('setupConnectBtn').disabled = false;
        document.getElementById('setupConnectBtn').innerText = '🔐 Simpan & Mulai';
    }
};
