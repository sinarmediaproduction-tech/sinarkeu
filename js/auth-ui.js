// ==================== AUTH: UI GATE & PERMISSION GUARDS ====================
// Pecahan dari js/auth.js -- lihat catatan pembagian modul di
// js/auth-core.js. Harus dimuat PALING TERAKHIR di antara file auth-*
// (membungkus window.openModal/openActionMenu/confirmDelete/switchBook
// yang mesti sudah didefinisikan app.js/dkk sebelumnya).
//
// Isi file ini: pembungkus openModal/openActionMenu/confirmDelete/
// switchBook untuk menolak aksi viewer, panel login biasa
// (skRenderAuthPanel/_skHandleLoginSubmit), gerbang login modal
// (skShowLoginGate/skHideLoginGate/skRenderGateAuthPanel/
// _skHandleGateLoginSubmit), dan trigger skRefreshSharedAccess otomatis
// saat app dibuka dengan sesi yang masih tersimpan.

(function() {
'use strict';

if (window.__skAuthUiJsInitialized) return;
window.__skAuthUiJsInitialized = true;

const _originalOpenModal = window.openModal;
window.openModal = function(id) {
    if (window.skIsViewerOnCurrentBook()) {
        // "Ubah transaksi" (editModal) TIDAK termasuk menu yang bisa diatur
        // admin (di luar cakupan fitur "Atur Tampilan Menu per Peran") --
        // tetap fix ditolak untuk viewer.
        if (id === 'editModal') {
            window.showToast && window.showToast('Peran viewer di buku bersama ini hanya bisa melihat, tidak bisa mengubah transaksi.', 'error');
            return;
        }
        // "Tambah transaksi" (addModal) IKUT toggle skGetMenuVisible --
        // kalau admin menyalakan menu ini untuk viewer lewat panel "Atur
        // Tampilan Menu per Peran", tombolnya tampil (skApplyRoleUI) DAN
        // beneran bisa dipakai di sini, bukan cuma tampil lalu ditolak.
        if (id === 'addModal' && !window.skGetMenuVisible(window.currentBookId, 'tambahTransaksi', 'viewer')) {
            window.showToast && window.showToast('Peran viewer di buku bersama ini hanya bisa melihat, tidak bisa menambah transaksi.', 'error');
            return;
        }
    }
    return _originalOpenModal.apply(this, arguments);
};

// ── Patch openActionMenu: viewer tidak perlu lihat menu Ubah/Hapus ──────
const _originalOpenActionMenu = window.openActionMenu;
window.openActionMenu = function(id) {
    if (window.skIsViewerOnCurrentBook()) {
        window.showToast && window.showToast('Peran viewer di buku bersama ini hanya bisa melihat transaksi.', 'error');
        return;
    }
    return _originalOpenActionMenu.apply(this, arguments);
};

// ── Patch confirmDelete: defense-in-depth kalau dipanggil dari jalur lain ─
const _originalConfirmDelete = window.confirmDelete;
window.confirmDelete = function(id) {
    if (window.skIsViewerOnCurrentBook()) {
        window.showToast && window.showToast('Peran viewer di buku bersama ini tidak bisa menghapus transaksi.', 'error');
        return;
    }
    return _originalConfirmDelete.apply(this, arguments);
};

// ── Patch switchBook: pindah buku = peran ikut berubah, refresh UI-nya ──
const _originalSwitchBook = window.switchBook;
window.switchBook = async function(id) {
    const result = await _originalSwitchBook.apply(this, arguments);
    if (typeof window.skApplyRoleUI === 'function') window.skApplyRoleUI();
    // [FIX] Daftar Belanja bisa saja sedang terbuka waktu user pindah buku
    // (mis. lewat dropdown di sidebar) -- render ulang supaya kunci/notice
    // viewer langsung mengikuti peran di buku yang baru, bukan peran buku
    // sebelumnya.
    const slistModal = document.getElementById('shoppingListModal');
    if (slistModal && slistModal.classList.contains('show') && typeof window.renderShoppingList === 'function') {
        window.renderShoppingList();
    }
    return result;
};

// ── Panel login sederhana di modal Kelola Buku ──────────────────────────
window.skRenderAuthPanel = function() {
    if (typeof window.skApplyRoleUI === 'function') window.skApplyRoleUI();
    const el = document.getElementById('skAuthPanelContent');
    if (!el) return;
    if (window._skAuthUser) {
        const bookId = window.currentBookId;
        const role = window.skGetRoleForBook(bookId);
        // [MENU MANAJEMEN USER] Panel kelola anggota TIDAK lagi ditampilkan
        // di sini -- sekarang cuma ada satu tempat untuk kelola anggota &
        // peran, yaitu halaman sidebar "Manajemen User"
        // (window.skRenderUserManagerPage, prefix 'um'). Modal "Kelola
        // Buku Kas" ini murni untuk buat/buka/ganti nama/hapus buku.
        // [UI] Restyle: pakai class setelan-info-row/setelan-badge yang
        // sudah dipakai konsisten di panel Setelan lain (bukan lagi teks
        // polos tumpuk manual). Catatan "Tombol logout ada di footer
        // sidebar" dihapus -- sudah tidak perlu dijelaskan di sini.
        const roleBadge = role
            ? '<span class="setelan-badge setelan-badge--success">Peran: ' + role + '</span>'
            : '<span class="setelan-badge setelan-badge--neutral">Bukan buku bersama</span>';
        // Nama buku aktif -- panel ini ("Kelola Buku Kas") selalu mengelola
        // window.currentBookId, jadi perlu ditampilkan eksplisit supaya user
        // tidak salah kira sedang mengelola buku lain (mis. setelah pindah
        // buku lewat dropdown Buku Kas tapi modal ini masih terbuka dari
        // sebelumnya).
        const activeBook = (window.books || []).find(function(b) { return b.id === bookId; });
        const bookName = activeBook ? activeBook.name : bookId;
        el.innerHTML =
            '<div style="margin-bottom:10px;">' +
                '<div class="setelan-info-row" style="margin-bottom:6px;">Buku aktif: <b>' + window.escapeHtml(bookName) + '</b></div>' +
                '<div class="setelan-info-row" style="margin-bottom:6px;">Login sebagai <b>' + window._skAuthUser.email + '</b></div>' +
                roleBadge +
                (role === 'admin' ? '<div class="setelan-info-row" style="margin-top:6px;">Untuk kelola anggota &amp; peran buku ini, buka menu <b>Manajemen User</b>.</div>' : '') +
            '</div>';
    } else {
        // [MENU DAFTAR MANUAL DIHAPUS] Tidak ada lagi opsi self-signup di
        // sini -- akun anggota baru sekarang HARUS dibuatkan admin lewat
        // skAdminCreateMemberAccount (panel Manajemen User / Kelola Anggota).
        el.innerHTML =
            '<form onsubmit="window._skHandleLoginSubmit(event)">' +
                '<input type="email" id="skAuthEmail" class="form-control" placeholder="Email" required autocomplete="username" style="margin-bottom:6px;">' +
                '<input type="password" id="skAuthPassword" class="form-control" placeholder="Password" required autocomplete="current-password" style="margin-bottom:8px;">' +
                '<button type="submit" class="btn btn-primary" style="width:100%;">Masuk</button>' +
            '</form>';
    }
};

window._skHandleLoginSubmit = function(ev) {
    ev.preventDefault();
    const email = document.getElementById('skAuthEmail').value.trim();
    const password = document.getElementById('skAuthPassword').value;
    window.skSignIn(email, password);
};

// ── [MULTIROLE GATE] Halaman login wajib sebelum masuk app ──────────────
// Dipanggil dari window.continueAppInit (js/app.js) SETELAH lockscreen
// device terbuka -- KALAU cloud sudah pernah di-setup di device ini DAN
// lagi online DAN belum ada sesi Buku Bersama tersimpan (_skAuthUser masih
// null). Kalau cloud belum pernah di-setup sama sekali atau lagi offline,
// continueAppInit TIDAK memanggil ini -- app tetap bisa dipakai seperti
// biasa (role default 'editor', lihat skComputeGlobalRole) supaya user
// solo/offline murni tidak pernah nyangkut di gerbang yang tidak mungkin
// mereka lewati (login butuh koneksi & akun cloud).
//
// Beda dengan panel login di modal "Kelola Buku" (skRenderAuthPanel /
// skAuthPanelContent): panel itu SELALU bisa ditutup/dilewati (cuma
// shortcut, bukan gerbang). Layar ini (skLoginGateScreen) SENGAJA tidak
// punya tombol tutup/skip apapun -- halaman ini yang PALING PERTAMA
// terlihat begitu lockscreen device terbuka, dan tidak ada jalan lain
// menuju app selain login/daftar berhasil di sini.
//
// Kalau sesi login sudah ada dari kunjungan sebelumnya (persist sampai
// logout manual, lihat skRefreshSharedAccess), gerbang ini otomatis
// dilewati -- tidak perlu login ulang tiap buka app.
window._skGateResolve = null;
window._skGateAuthMode = 'login';

window.skShowLoginGate = function() {
    return new Promise(function(resolve) {
        window._skGateResolve = resolve;
        window._skGateAuthMode = 'login';
        const el = document.getElementById('skLoginGateScreen');
        if (el) el.style.display = 'flex';
        window.skRenderGateAuthPanel();
    });
};

window.skHideLoginGate = function() {
    const el = document.getElementById('skLoginGateScreen');
    if (el) el.style.display = 'none';
};

window.skRenderGateAuthPanel = function() {
    const el = document.getElementById('skGateAuthPanelContent');
    if (!el) return;
    // [MENU DAFTAR MANUAL DIHAPUS] Gerbang login ini sekarang hanya
    // menampilkan form login -- tidak ada lagi opsi self-signup. Akun
    // anggota baru harus dibuatkan admin lewat skAdminCreateMemberAccount.
    el.innerHTML =
        '<form onsubmit="window._skHandleGateLoginSubmit(event)">' +
            '<input type="email" id="skGateAuthEmail" class="form-control" placeholder="Email" required autocomplete="username" style="margin-bottom:6px;">' +
            '<input type="password" id="skGateAuthPassword" class="form-control" placeholder="Password" required autocomplete="current-password" style="margin-bottom:8px;">' +
            '<button type="submit" class="btn btn-primary" style="width:100%;">Masuk</button>' +
        '</form>';
};

window._skHandleGateLoginSubmit = async function(ev) {
    ev.preventDefault();
    const email = document.getElementById('skGateAuthEmail').value.trim();
    const password = document.getElementById('skGateAuthPassword').value;
    const ok = await window.skSignIn(email, password);
    if (ok && window._skAuthUser && window._skGateResolve) {
        const resolve = window._skGateResolve;
        window._skGateResolve = null;
        resolve();
    }
};

// Saat app dibuka & sesi Supabase Auth sebelumnya masih tersimpan (belum
// expired), tarik ulang akses buku shared otomatis supaya tidak perlu
// login manual tiap buka app. Delay kecil supaya window.getCloudUrl() dkk
// (dari js/db.js/js/account.js) sudah siap duluan.
if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (typeof window.getCloudUrl === 'function' && window.getCloudUrl()) {
                window.skRefreshSharedAccess().catch(function(e) {
                    console.error('[auth.js] refresh akses awal gagal:', e);
                });
            }
        }, 800);
    });
}


// Saat app dibuka & sesi Supabase Auth sebelumnya masih tersimpan (belum
// expired), tarik ulang akses buku shared otomatis supaya tidak perlu
// login manual tiap buka app. Delay kecil supaya window.getCloudUrl() dkk
// (dari js/db.js/js/account.js) sudah siap duluan.
if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (typeof window.getCloudUrl === 'function' && window.getCloudUrl()) {
                window.skRefreshSharedAccess().catch(function(e) {
                    console.error('[auth-ui.js] refresh akses awal gagal:', e);
                });
            }
        }, 800);
    });
}

})();
