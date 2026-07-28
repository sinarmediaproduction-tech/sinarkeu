// ==================== UTILITY FUNCTIONS ====================
window.rp = function(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); };
window.unRp = function(s) { return Number(String(s).replace(/[^0-9]/g, '')) || 0; };
window.escapeHtml = function(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
window.formatDateTime = function(dtStr) {
    if (!dtStr) return '-';
    let d = window.parseTxDate(dtStr);
    if (isNaN(d.getTime())) return dtStr;
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
};

// [UI] Format tanggal singkat untuk tabel transaksi di tampilan hape,
// mis. "20/7/26" (tanpa nol di depan, tahun 2 digit, tanpa jam).
window.formatDateShort = function(dtStr) {
    if (!dtStr) return '-';
    let d = window.parseTxDate(dtStr);
    if (isNaN(d.getTime())) return dtStr;
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2);
};

// [BUG FIX] Konversi string tanggal apa pun (termasuk format Supabase
// "YYYY-MM-DDTHH:mm:ss+00:00") ke format ketat "YYYY-MM-DDTHH:mm" yang
// disyaratkan oleh <input type="datetime-local">. Tanpa ini, mengisi value
// input datetime-local dengan string yang ber-offset zona waktu akan membuat
// browser DIAM-DIAM mengosongkan input itu (jadi "") tanpa error apa pun —
// lalu saat form disubmit, tanggal transaksi tertimpa string kosong, yang
// ditolak Supabase (kolom timestamptz) dengan error 22007.
window.toDatetimeLocalValue = function(dtStr) {
    if (!dtStr) return '';
    const d = window.parseTxDate(dtStr);
    if (isNaN(d.getTime())) return '';
    const _pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
};

window.formatRupiah = function(el) {
    const selStart = el.selectionStart;
    const selEnd   = el.selectionEnd;
    const oldLen   = el.value.length;
    let v = el.value.replace(/[^0-9]/g, '');
    el.value = v ? Number(v).toLocaleString('id-ID') : '';
    const newLen  = el.value.length;
    const delta   = newLen - oldLen;
    const newPos  = Math.max(0, selStart + delta);
    try { el.setSelectionRange(newPos, newPos); } catch (_) {}
};

window.showToast = function(msg, type = 'success') {
    const toast = document.getElementById('toastMessage');
    const icon = document.getElementById('toastIcon');
    const text = document.getElementById('toastText');
    if (type === 'success') { icon.innerHTML = ''; toast.style.background = 'var(--success)'; }
    else if (type === 'error') { icon.innerHTML = ''; toast.style.background = 'var(--danger)'; }
    else if (type === 'warning') { icon.innerHTML = ''; toast.style.background = 'var(--warning)'; }
    else { icon.innerHTML = 'ℹ'; toast.style.background = 'var(--ink)'; }
    text.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
    // [FIX] Toast merah (error) hilang begitu saja setelah 3 detik tanpa
    // jejak apa pun -- kalau errornya sekilas (mis. gagal koneksi pas app
    // baru dibuka) tidak ada cara telusur ulang apa penyebabnya. Rekam
    // otomatis ke localStorage supaya bisa diekspor & dibaca belakangan
    // (lihat window._recordToastError / window.exportToastErrorLog di
    // bawah, dan panel "Log Error" di Setelan).
    if (type === 'error') window._recordToastError(msg);
};

// ==================== LOG ERROR TOAST (untuk diagnosis) ====================
window.TOAST_ERROR_LOG_KEY = 'sk_toast_error_log';
window.TOAST_ERROR_LOG_MAX = 200;

window._recordToastError = function(msg) {
    try {
        const log = JSON.parse(localStorage.getItem(window.TOAST_ERROR_LOG_KEY) || '[]');
        // Stack di titik ini nunjuk ke showToast()/_recordToastError() sendiri,
        // tapi baris ketiga-dst biasanya sudah pemanggil aslinya -- best-effort
        // saja untuk bantu telusur, bukan jaminan akurat di semua browser.
        let stack = '';
        try { stack = (new Error()).stack || ''; } catch (_) {}
        log.push({
            timestamp: new Date().toISOString(),
            message: String(msg),
            book_id: window.currentBookId || null,
            device_id: window.deviceId || null,
            url: (typeof location !== 'undefined' ? location.href : ''),
            stack: stack,
        });
        // Buang yang paling lama kalau kelebihan kapasitas.
        while (log.length > window.TOAST_ERROR_LOG_MAX) log.shift();
        localStorage.setItem(window.TOAST_ERROR_LOG_KEY, JSON.stringify(log));
        if (typeof window._refreshToastErrorLogPanel === 'function') window._refreshToastErrorLogPanel();
    } catch (e) {
        // Kalau localStorage penuh/diblokir, jangan sampai malah bikin toast asli gagal tampil.
        console.warn('[ToastErrorLog] Gagal merekam:', e);
    }
};

window.getToastErrorLog = function() {
    try { return JSON.parse(localStorage.getItem(window.TOAST_ERROR_LOG_KEY) || '[]'); }
    catch (_) { return []; }
};

window.exportToastErrorLog = function() {
    const log = window.getToastErrorLog();
    if (!log.length) { window.showToast('Belum ada error tercatat.', 'info'); return; }
    const payload = {
        exported_at: new Date().toISOString(),
        app: 'sinarkeu',
        count: log.length,
        entries: log,
    };
    if (typeof window._downloadJSON === 'function') {
        window._downloadJSON(payload, 'toast-error-log.json');
    } else {
        // Fallback kalau backup.js (sumber _downloadJSON) belum sempat termuat.
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'toast-error-log.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    window.showToast('Log error diekspor (' + log.length + ' entri).', 'success');
};

window.clearToastErrorLog = function() {
    localStorage.removeItem(window.TOAST_ERROR_LOG_KEY);
    if (typeof window._refreshToastErrorLogPanel === 'function') window._refreshToastErrorLogPanel();
    window.showToast('Log error dibersihkan.', 'success');
};

// ==================== MODAL KONFIRMASI/PROMPT/ALERT KUSTOM ====================
// [FIX UX] Pengganti confirm()/prompt()/alert() bawaan browser, khusus
// dipakai untuk aksi PERMANEN (hapus buku, reset app, hapus akun). Lihat
// markup #customConfirmModal di index.html untuk alasan lengkap.
window._customConfirmPending = null;

function _openCustomConfirmModal(opts) {
    document.getElementById('customConfirmTitle').textContent = opts.title || 'Konfirmasi';
    document.getElementById('customConfirmMessage').textContent = opts.message || '';
    const input = document.getElementById('customConfirmInput');
    const hint = document.getElementById('customConfirmInputHint');
    const okBtn = document.getElementById('customConfirmOkBtn');
    const cancelBtn = document.getElementById('customConfirmCancelBtn');

    okBtn.textContent = opts.confirmLabel || 'OK';
    cancelBtn.textContent = opts.cancelLabel || 'Batal';
    okBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
    cancelBtn.style.display = opts.mode === 'alert' ? 'none' : '';

    if (opts.mode === 'prompt') {
        input.style.display = 'block';
        input.value = '';
        input.placeholder = opts.placeholder || opts.expectedValue || '';
        hint.style.display = 'block';
        hint.textContent = `Ketik "${opts.expectedValue}" persis sama untuk mengaktifkan tombol konfirmasi.`;
        okBtn.disabled = true;
    } else {
        input.style.display = 'none';
        hint.style.display = 'none';
        okBtn.disabled = false;
    }

    window.openModal('customConfirmModal');
    if (opts.mode === 'prompt') setTimeout(() => input.focus(), 50);
}

// Dipanggil dari onclick tombol OK/Batal/close di markup modal (index.html).
window._customConfirmValidateInput = function() {
    const state = window._customConfirmPending;
    if (!state || state.mode !== 'prompt') return;
    const input = document.getElementById('customConfirmInput');
    document.getElementById('customConfirmOkBtn').disabled = (input.value !== state.expectedValue);
};

window._customConfirmResolve = function(confirmed) {
    const state = window._customConfirmPending;
    if (!state) return;
    // Untuk mode prompt, tombol OK sudah disabled selama teks belum cocok
    // persis (lihat _customConfirmValidateInput), jadi confirmed=true di
    // sini sudah pasti berarti teksnya benar.
    window._customConfirmPending = null;
    window.closeModal('customConfirmModal');
    if (state.mode === 'prompt') {
        const input = document.getElementById('customConfirmInput');
        state.resolve(confirmed ? input.value : null);
    } else if (state.mode === 'alert') {
        state.resolve();
    } else {
        state.resolve(!!confirmed);
    }
};

// Pengganti confirm(). Contoh: `if (await window.customConfirm({message:'...'})) { ... }`
window.customConfirm = function(opts) {
    opts = opts || {};
    return new Promise(resolve => {
        window._customConfirmPending = { resolve, mode: 'confirm' };
        _openCustomConfirmModal({ mode: 'confirm', danger: true, ...opts });
    });
};

// Pengganti prompt() untuk pola "ketik X untuk konfirmasi". Resolusinya
// berupa string yang diketik user (selalu cocok persis, tombol OK baru aktif
// kalau sudah cocok) kalau dikonfirmasi, atau null kalau dibatalkan.
window.customPrompt = function(opts) {
    opts = opts || {};
    return new Promise(resolve => {
        window._customConfirmPending = { resolve, mode: 'prompt', expectedValue: opts.expectedValue };
        _openCustomConfirmModal({ mode: 'prompt', confirmLabel: 'Konfirmasi', danger: true, ...opts });
    });
};

// Pengganti alert(). Cuma tombol OK (tanpa Batal).
window.customAlert = function(opts) {
    opts = opts || {};
    return new Promise(resolve => {
        window._customConfirmPending = { resolve, mode: 'alert' };
        _openCustomConfirmModal({ mode: 'alert', confirmLabel: 'OK', danger: false, ...opts });
    });
};

window.isOnline = function() {
    return window.globalSupabaseUrl && window.globalSupabaseKey && navigator.onLine;
};

window.requireOnline = function(operationName) {
    if (!window.isOnline()) {
        window.showToast(`Anda harus ONLINE untuk ${operationName}!`, 'warning');
        return false;
    }
    return true;
};

// Daftar modal yang sekarang tampil sebagai halaman penuh di area utama
// (pola sama seperti Setelan) alih-alih kotak dialog mengambang -- dipetakan
// ke id tombol nav sidebar masing-masing supaya nav bisa ikut ditandai aktif.
// [SERAGAM DENGAN SETELAN] akun/telegram/snapshot/devices TIDAK masuk
// daftar ini -- section-nya tetap panel inline langsung di dalam halaman
// Setelan (index.html, #setelanTabContent). Pengecualian: backup & migrasi
// SUDAH dikeluarkan lagi dari Setelan ke halaman fullview tersendiri
// (dataBackupModal) karena dianggap cukup penting untuk punya menu sidebar
// sendiri, terpisah dari setelan umum lainnya.
// Lihat CLAUDE.md bagian "Sidebar/nav" untuk konvensinya.
window.FULLVIEW_MODALS = {
    monthlyReportModal:    'laporan',
    defaultBudgetModal:    'anggaran',
    shoppingListModal:     'belanja',
    paymentReminderModal:  'reminder',
    bookManagerModal:      'buku',
    userManagerModal:      'userManager',
    // [PINDAH DARI SETELAN] Cadangan Data & Migrasi sekarang halaman penuh
    // tersendiri di sidebar (dulu 2 tab di dalam Setelan) -- lihat
    // js/settings.js window.openDataBackupView().
    dataBackupModal:       'backupData'
};

// Modal utility (dipanggil dari onclick di HTML)
window.openModal = function(id) {
    // [FIX UX] addModal & editModal sekarang boleh dibuka offline -- lihat
    // catatan lengkap di handleSubmit/handleEditSubmit/confirmDelete
    // (render.js) untuk kenapa ini aman. bookManagerModal TETAP diblokir:
    // manajemen buku (buat/hapus/pindah buku) belum punya jalur offline-safe
    // yang sama, jadi tetap butuh koneksi supaya tidak terjadi hal aneh
    // seperti dua device sama-sama membuat buku baru dengan asumsi state
    // cloud yang sudah usang.
    if (!window.isOnline() && id === 'bookManagerModal') {
        window.showToast('Anda harus ONLINE untuk operasi ini!', 'warning');
        return;
    }
    // [FULLVIEW] Menu sidebar (Laporan, Anggaran, Pengingat Pembayaran, Buku
    // Kas, Akun, Cadangan Data) tampil full-page seperti Dashboard/Setelan,
    // bukan modal mengambang -- sembunyikan Dashboard/Setelan, tandai nav
    // sidebar aktif, dan tutup drawer mobile kalau lagi terbuka.
    if (window.FULLVIEW_MODALS[id]) {
        document.body.classList.remove('view-settings');
        document.getElementById('setelanModal').classList.remove('show');
        // Kalau lagi pindah langsung dari satu menu full-page ke menu
        // full-page lain (mis. dari Laporan ke Anggaran), tutup dulu yang
        // lama supaya tidak tumpang tindih di layar.
        Object.keys(window.FULLVIEW_MODALS).forEach(function(otherId) {
            if (otherId !== id) {
                var otherEl = document.getElementById(otherId);
                if (otherEl) otherEl.classList.remove('show');
            }
        });
        document.body.classList.add('view-fullpage');
        if (typeof window.updateAppSidebarNav === 'function') window.updateAppSidebarNav(window.FULLVIEW_MODALS[id]);
        if (typeof window.closeMobileDrawer === 'function') window.closeMobileDrawer();
    }
    // [FIX] Beberapa fungsi lama (mis. openBackupManager, openTelegramSettings)
    // mungkin masih memanggil openModal() dengan id yang sudah tidak ada lagi
    // di HTML karena section-nya sudah dipindah jadi panel inline di Setelan.
    // Guard null di sini supaya panggilan lama itu tidak melempar error dan
    // menghentikan sisa fungsi (mis. render list) yang seharusnya tetap jalan.
    var _modalEl = document.getElementById(id);
    if (!_modalEl) return;
    _modalEl.classList.add('show');
    if (id === 'addModal') {
        document.getElementById('addForm').reset();
        // Sync custom selects setelah form.reset()
        ['txCategory', 'txIncomeCategory'].forEach(function(sid) {
            var sel = document.getElementById(sid);
            if (sel) sel.dispatchEvent(new Event('change'));
        });
        document.getElementById('attachmentPreview').style.display = 'none';
        window.currentAttachmentData = null;
        window.currentAttachmentFile = null;
        window.toggleCategoryField();
        if (!window.isOnline()) window.showToast('Sedang offline — transaksi akan disimpan lokal dan disinkron otomatis nanti.', 'warning');
    }
};
window.closeModal = function(id) {
    // [KONFLIK MULTI-DEVICE] Kalau user membatalkan edit (tutup editModal
    // TANPA submit), baseline yang sempat dicatat window.setEditBaseline saat
    // modal dibuka (lihat loadEditData di render.js) jadi tidak relevan lagi
    // -- bersihkan supaya tidak menumpuk entri basi di localStorage.
    if (id === 'editModal' && window.clearEditBaseline) {
        const editingId = document.getElementById('editId') && document.getElementById('editId').value;
        if (editingId) window.clearEditBaseline(editingId);
    }
    // [FIX] Sama seperti di openModal() -- guard null supaya pemanggilan
    // closeModal() dengan id modal lama yang sudah dihapus dari HTML (karena
    // sudah jadi panel inline di Setelan) tidak melempar error dan
    // menghentikan kode setelahnya (mis. window.switchAccount(accId)).
    var _closeEl = document.getElementById(id);
    if (!_closeEl) return;
    _closeEl.classList.remove('show');
    if (id === 'setelanModal') {
        document.body.classList.remove('view-settings');
        if (typeof window.updateAppSidebarNav === 'function') window.updateAppSidebarNav('dashboard');
    }
    // [FULLVIEW] Kalau yang ditutup salah satu menu full-page sidebar,
    // kembali ke Dashboard (bukan sekadar hilang, karena Dashboard-nya
    // sendiri disembunyikan selama mode fullview aktif).
    if (window.FULLVIEW_MODALS[id]) {
        document.body.classList.remove('view-fullpage');
        if (typeof window.updateAppSidebarNav === 'function') window.updateAppSidebarNav('dashboard');
    }
};

window.getCloudUrl = function() { return window.globalSupabaseUrl || ''; };
window.getSupabaseKey = function() { return window.globalSupabaseKey || ''; };

window.escHtml = window.escapeHtml; // alias for older code

// Tombol "Copy SQL" di Panduan Pengguna — dipakai untuk beberapa blok skrip
// SQL berbeda (1a. Setup Database untuk project baru, 1b. Migrasi untuk
// project lama). blockId default ke skrip setup awal (perilaku lama tetap
// sama persis untuk pemanggil yang tidak mengirim argumen).
window.copySqlBlock = function(blockId) {
    const block = document.getElementById(blockId || 'supabaseSetupSqlBlock');
    if (!block) return;
    const sql = block.innerText || block.textContent || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sql)
            .then(() => window.showToast('Skrip SQL disalin ke clipboard!', 'success'))
            .catch(() => window.showToast('Gagal menyalin, silakan select & copy manual', 'warning'));
    } else {
        // Fallback untuk browser lama tanpa Clipboard API
        const ta = document.createElement('textarea');
        ta.value = sql;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            window.showToast('Skrip SQL disalin ke clipboard!', 'success');
        } catch (e) {
            window.showToast('Gagal menyalin, silakan select & copy manual', 'warning');
        }
        document.body.removeChild(ta);
    }
};
// Alias lama dipertahankan supaya tombol "Copy SQL" di 1a (dibuat sebelum
// copySqlBlock generik ini ada) tetap berfungsi tanpa perlu ubah HTML.
window.copySupabaseSetupSql = function() { window.copySqlBlock('supabaseSetupSqlBlock'); };

// Animasi angka dari nilai lama ke nilai baru dengan easing
window.animateValue = function(id, toVal, duration, onComplete) {
    const el = document.getElementById(id);
    if (!el) return;
    duration = duration || 500;
    const fromVal = window.unRp(el.innerText) || 0;
    if (fromVal === toVal) { el.innerText = window.rp(toVal); if (onComplete) onComplete(); return; }
    const startTime = performance.now();
    // easeOutQuart
    function ease(t) { return 1 - Math.pow(1 - t, 4); }
    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const current = Math.round(fromVal + (toVal - fromVal) * ease(progress));
        el.innerText = window.rp(current);
        if (progress < 1) requestAnimationFrame(step);
        else if (onComplete) onComplete();
    }
    requestAnimationFrame(step);
};
