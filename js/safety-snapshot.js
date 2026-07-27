// ==================== SNAPSHOT KEAMANAN (Restore Point Otomatis) ====================
// Fitur ini SENGAJA dipisah dari "Cadangan Data" (js/backup.js, tab Setelan >
// Cadangan Data). Bedanya:
//   - Cadangan Data   = backup transaksi BUKU AKTIF yang dibuat MANUAL oleh user
//                        (lokal/cloud/Google Sheets), untuk kebutuhan arsip & laporan.
//   - Snapshot Keamanan = jaring pengaman OTOMATIS. Setiap kali aplikasi akan
//                        menjalankan aksi yang berisiko/merusak data secara permanen
//                        (hapus buku, hapus akun, reset total aplikasi, arsipkan &
//                        kosongkan database, restore dari Cadangan Data, impor JSON),
//                        aplikasi diam-diam merekam SELURUH data akun ini (semua
//                        buku, anggaran, pengingat pembayaran, setelan -- bukan cuma
//                        transaksi 1 buku) tepat SEBELUM aksi itu benar-benar
//                        dijalankan. Kalau ternyata prosesnya error atau hasilnya
//                        salah, user bisa pulihkan lewat tab Setelan > Snapshot
//                        Keamanan tanpa perlu sudah membuat Cadangan Data lebih dulu.
//
// [PENTING - BATASAN] Snapshot ini HANYA menyimpan salinan localStorage di
// BROWSER INI. Untuk aksi yang juga menghapus data di Supabase (cloud) secara
// permanen -- misalnya hapus buku, reset total, arsipkan & kosongkan database --
// snapshot TIDAK bisa mengembalikan data yang sudah terhapus di cloud; snapshot
// hanya memulihkan salinan lokal di perangkat ini. Ini tetap berguna sebagai
// jaring pengaman kalau prosesnya error di tengah jalan, datanya keliru, atau
// user berubah pikiran sebelum sempat sinkron ulang.

window.SAFETY_SNAPSHOT_KEY = 'sk_safety_snapshots';
window.SAFETY_SNAPSHOT_MAX = 10; // menampung snapshot harian otomatis (~10 hari terakhir) + snapshot sebelum aksi berisiko

// Dipanggil oleh aksi-aksi berisiko, SETELAH semua dialog konfirmasi user selesai
// (supaya tidak nyampah snapshot kalau user akhirnya batal) dan SEBELUM data
// apapun benar-benar diubah/dihapus. Sengaja tidak pernah melempar error ke
// pemanggilnya -- kalau snapshot gagal dibuat (mis. kuota localStorage penuh),
// aksi berisiko yang memanggilnya harus tetap bisa lanjut; snapshot cuma jaring
// pengaman tambahan, bukan syarat wajib.
window.createSafetySnapshot = function(reason) {
    try {
        const dump = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('sk_') && k !== window.SAFETY_SNAPSHOT_KEY) {
                dump[k] = localStorage.getItem(k);
            }
        }
        const entry = {
            id: 'snap_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            timestamp: new Date().toISOString(),
            reason: reason || 'Aksi berisiko',
            sizeKB: Math.max(1, Math.round(JSON.stringify(dump).length / 1024)),
            data: dump
        };
        let list = [];
        try { list = JSON.parse(localStorage.getItem(window.SAFETY_SNAPSHOT_KEY) || '[]'); } catch { list = []; }
        list.unshift(entry);
        while (list.length > window.SAFETY_SNAPSHOT_MAX) list.pop();

        try {
            localStorage.setItem(window.SAFETY_SNAPSHOT_KEY, JSON.stringify(list));
        } catch (quotaErr) {
            // [GUARD KUOTA] localStorage penuh -- buang snapshot paling lama dulu lalu
            // coba lagi sekali. Kalau masih gagal, lewati snapshot ini saja: lebih
            // baik aksi berisiko tetap jalan tanpa jaring pengaman daripada aplikasi
            // macet gara-gara localStorage penuh.
            console.warn('[SafetySnapshot] Kuota localStorage penuh, coba pangkas snapshot terlama:', quotaErr);
            while (list.length > 1) {
                list.pop();
                try {
                    localStorage.setItem(window.SAFETY_SNAPSHOT_KEY, JSON.stringify(list));
                    return true;
                } catch (e2) { /* masih gagal, lanjut pangkas lagi kalau ada sisa */ }
            }
            console.error('[SafetySnapshot] Tetap gagal menyimpan snapshot, dilewati.');
            return false;
        }
        return true;
    } catch (e) {
        console.error('[SafetySnapshot] Gagal membuat snapshot keamanan:', e);
        return false;
    }
};

window.getSafetySnapshots = function() {
    try { return JSON.parse(localStorage.getItem(window.SAFETY_SNAPSHOT_KEY) || '[]'); }
    catch { return []; }
};

// Snapshot harian otomatis -- terpisah dari snapshot sebelum aksi berisiko, tapi
// disimpan di daftar/pool yang sama (lihat SAFETY_SNAPSHOT_MAX di atas) supaya
// user cukup lihat satu tab "Snapshot Keamanan" untuk semuanya. Dicek sekali di
// setiap sesi/muat ulang aplikasi (lihat pemanggilannya di js/app.js), tapi hanya
// benar-benar membuat snapshot kalau belum ada snapshot harian pada TANGGAL hari
// ini -- jadi tetap cuma 1 snapshot harian per hari walau app dibuka berkali-kali.
// Tidak butuh koneksi online karena murni menyalin localStorage.
window.SAFETY_SNAPSHOT_LAST_DAILY_KEY = 'sk_last_daily_safety_snapshot';
window.checkAndRunDailySafetySnapshot = function() {
    try {
        const now = new Date();
        const last = localStorage.getItem(window.SAFETY_SNAPSHOT_LAST_DAILY_KEY);
        if (last && new Date(last).toDateString() === now.toDateString()) return; // sudah ada snapshot harian hari ini
        const ok = window.createSafetySnapshot('Snapshot Harian Otomatis');
        if (ok) {
            localStorage.setItem(window.SAFETY_SNAPSHOT_LAST_DAILY_KEY, now.toISOString());
            if (typeof window.renderSafetySnapshotList === 'function') window.renderSafetySnapshotList();
        }
    } catch (e) {
        console.error('[SafetySnapshot] Gagal menjalankan snapshot harian otomatis:', e);
    }
};

// Dipanggil dari panel "Snapshot Keamanan" -- sekarang panel inline di
// halaman Setelan (safetySnapshotModal terpisah sudah dihapus dari HTML).
window.openSafetySnapshotManager = function() {
    window.renderSafetySnapshotList();
    if (typeof window.openSetelanModal === 'function') window.openSetelanModal('snapshot');
};

window.renderSafetySnapshotList = function() {
    const container = document.getElementById('safetySnapshotListContainer');
    if (!container) return;
    const list = window.getSafetySnapshots();
    if (list.length === 0) {
        container.innerHTML = '<div style="color:var(--ink-faint); font-size:.7rem; text-align:center; padding:14px 0;">Belum ada snapshot keamanan. Snapshot akan otomatis dibuat sebelum aksi berisiko seperti hapus buku, hapus akun, reset total aplikasi, arsipkan & kosongkan database, restore Cadangan Data, atau impor JSON.</div>';
        return;
    }
    container.innerHTML = list.map((s) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:.7rem; padding:8px 0; border-bottom:1px solid var(--rule);">
            <div>
                <div style="font-weight:600;">${window.escapeHtml(window.formatDateTime(s.timestamp))}</div>
                <div style="color:var(--ink-faint);">${window.escapeHtml(s.reason)} · ${s.sizeKB} KB</div>
            </div>
            <div style="display:flex; gap:6px; flex:0 0 auto;">
                <button class="btn-mini" onclick="window.restoreSafetySnapshot('${s.id}')">Pulihkan</button>
            </div>
        </div>
    `).join('');
};

window.restoreSafetySnapshot = async function(id) {
    const list = window.getSafetySnapshots();
    const snap = list.find(s => s.id === id);
    if (!snap) { window.showToast('Snapshot tidak ditemukan', 'error'); return; }

    const ok = await window.customConfirm({
        title: 'Pulihkan Snapshot Keamanan',
        message: `Kembalikan SELURUH data lokal akun ini (semua buku, anggaran, pengingat pembayaran, setelan) ke kondisi pada ${window.formatDateTime(snap.timestamp)}?\n\nDibuat otomatis sebelum: ${snap.reason}\n\nData lokal saat ini akan DIGANTI dan halaman akan dimuat ulang. Catatan: jika aksi tadi sudah menghapus data di cloud/Supabase secara permanen, data cloud TIDAK ikut kembali -- snapshot ini hanya memulihkan salinan lokal di perangkat ini.`,
        confirmLabel: 'Pulihkan'
    });
    if (!ok) return;

    // Hapus dulu semua key sk_* saat ini (kecuali daftar snapshot itu sendiri) supaya
    // key yang dibuat SETELAH snapshot ini (mis. buku baru yang sempat ditambah lalu
    // ternyata keliru) benar-benar hilang, bukan cuma ketiban key lama.
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('sk_') && k !== window.SAFETY_SNAPSHOT_KEY) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    Object.keys(snap.data).forEach(k => localStorage.setItem(k, snap.data[k]));

    window.showToast('Data lokal dipulihkan dari snapshot keamanan, memuat ulang...', 'success');
    setTimeout(() => location.reload(), 900);
};
