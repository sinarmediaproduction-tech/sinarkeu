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
    if (type === 'success') { icon.innerHTML = ''; toast.style.background = '#00875a'; }
    else if (type === 'error') { icon.innerHTML = ''; toast.style.background = '#de350b'; }
    else if (type === 'warning') { icon.innerHTML = ''; toast.style.background = '#cc7b00'; }
    else { icon.innerHTML = 'ℹ'; toast.style.background = '#1a1a1a'; }
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
    if (!window.isOnline() && (id === 'addModal' || id === 'editModal' || id === 'bookManagerModal')) {
        window.showToast('Anda harus ONLINE untuk operasi ini!', 'warning');
        return;
    }
    document.getElementById(id).classList.add('show');
    if (id === 'addModal') {
        document.getElementById('addForm').reset();
        document.getElementById('attachmentPreview').style.display = 'none';
        window.currentAttachmentData = null;
        window.currentAttachmentFile = null;
        window.toggleCategoryField();
    }
};
window.closeModal = function(id) {
    document.getElementById(id).classList.remove('show');
};

window.getCloudUrl = function() { return window.globalSupabaseUrl || ''; };
window.getSupabaseKey = function() { return window.globalSupabaseKey || ''; };

window.escHtml = window.escapeHtml; // alias for older code
