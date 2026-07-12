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
    document.getElementById(id).classList.add('show');
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
    document.getElementById(id).classList.remove('show');
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
