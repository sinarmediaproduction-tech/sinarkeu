// ==================== AUTH: ROLES & MENU VISIBILITY ====================
// Pecahan dari js/auth.js -- lihat catatan pembagian modul di
// js/auth-core.js. Harus dimuat SETELAH auth-core.js.
//
// Isi file ini: definisi menu (SK_MENU_ITEMS/SK_MENU_DEFAULTS), perhitungan
// role efektif per buku (skComputeGlobalRole, skGetRoleForBook,
// skGetEffectiveRoleForBook, skIsSharedBookId, skGetMenuVisible), penerapan
// role ke UI (skApplyRoleUI, skIsViewerOnCurrentBook), dan panel "Atur
// Tampilan Menu per Peran" (skBuildMenuVisibilityHtml/skSaveMenuVisibility,
// dipakai dari halaman Manajemen User di js/auth-members.js).

(function() {
'use strict';

if (window.__skAuthRolesJsInitialized) return;
window.__skAuthRolesJsInitialized = true;

window._skBookMenuVisibility = {};

// [DISEDERHANAKAN] Cuma menu yang memang masuk akal untuk digilirkan ke
// Editor/Viewer yang muncul di panel ini. Setelan, Cadangan Data, Kelola
// Device, Akun, Notifikasi Telegram, dan Snapshot Keamanan tetap ada di
// aplikasi seperti biasa, tapi TIDAK lagi bisa diatur per-peran di sini --
// key & nilai defaultnya di SK_MENU_DEFAULTS (di bawah) tetap dipakai apa
// adanya oleh skGetMenuVisible/skApplyRoleUI, jadi menu-menu itu SELALU
// tersembunyi dari Editor & Viewer (hanya admin yang bisa lihat), tidak
// bisa dinyalakan admin lewat panel ini lagi.
window.SK_MENU_ITEMS = [
    { key: 'budget', label: 'Anggaran (Budget)' },
    { key: 'tambahTransaksi', label: 'Tambah Transaksi' },
    { key: 'bukuKas', label: 'Kelola Buku Kas' }
];

window.SK_MENU_DEFAULTS = {
    setelan:         { editor: false, viewer: false },
    backup:          { editor: false, viewer: false },
    device:          { editor: false, viewer: false },
    budget:          { editor: true,  viewer: false },
    tambahTransaksi: { editor: true,  viewer: false },
    // [PERMINTAAN] Default disembunyikan dari editor & viewer -- hanya
    // admin yang lihat. Admin tetap bisa menyalakannya per-role lewat
    // panel "Atur Tampilan Menu per Peran" kalau suatu saat perlu.
    bukuKas:         { editor: false, viewer: false },
    akun:            { editor: false, viewer: false },
    telegram:        { editor: false, viewer: false },
    snapshot:        { editor: false, viewer: false }
};

// [MULTIROLE GLOBAL] Peran sekarang dihitung SEKALI per device/sesi login,
// bukan per-buku lagi -- berlaku ke SEMUA buku termasuk buku pribadi.
// Aturan (sudah disepakati, lihat riwayat percakapan):
//   1. Admin di buku manapun -> global admin (menang di atas segalanya).
//   2. Kalau tidak admin di manapun tapi punya role editor/viewer di suatu
//      buku (yang mana saja) -> pakai role tertinggi itu (editor > viewer).
//   3. Belum login Buku Bersama sama sekali di device ini -> dianggap
//      'editor' (CRUD transaksi biasa boleh, tapi Setelan/Backup/Kelola
//      Device tetap terkunci) -- ini SENGAJA, bukan bug, supaya password
//      Buku Bersama benar-benar jadi gerbang untuk fitur sensitif walau
//      buku yang dibuka buku pribadi.
// Modal "Kelola Buku" (login/signup Buku Bersama) & "Jadikan Bersama" itu
// sendiri TIDAK ikut dibatasi oleh role ini -- supaya tidak ada masalah
// ayam-telur (harus bisa login/bootstrap dulu sebelum punya role apapun).
window.skComputeGlobalRole = function() {
    if (!window._skAuthUser) return 'editor';
    const roles = Object.keys(window._skSharedRoles).map(function(id) { return window._skSharedRoles[id]; });
    if (roles.indexOf('admin') !== -1) return 'admin';
    if (roles.indexOf('editor') !== -1) return 'editor';
    if (roles.indexOf('viewer') !== -1) return 'viewer';
    // Sudah login tapi belum jadi anggota buku bersama manapun (baru bikin
    // akun, belum diundang ke buku manapun) -- tetap default paling ketat
    // yang masih bisa transaksi, sama seperti belum login.
    return 'editor';
};

// Dipakai skApplyRoleUI & patch openModal (addModal) -- SATU sumber
// kebenaran untuk "menu X boleh dilihat/dipakai role global Y". Admin
// selalu true (tidak disimpan di kolom menu_visibility sama sekali) supaya
// admin tidak bisa mengunci dirinya sendiri sampai tidak bisa buka Setelan
// lagi. bookId dipakai HANYA untuk menu_visibility kustom kalau buku aktif
// itu buku bersama yang sudah diatur admin-nya -- kalau tidak ada
// pengaturan khusus, jatuh ke SK_MENU_DEFAULTS berdasarkan role global.
// [FIX BUG LOGIKA MULTIUSER] roleOverride (opsional): kalau diisi, dipakai
// APA ADANYA sebagai peran acuan, tidak lagi menghitung ulang dari
// skComputeGlobalRole(). Dipakai oleh gerbang addModal di bawah supaya toggle
// "tambahTransaksi" dicek dengan peran EFEKTIF di buku itu (viewer), bukan
// peran global yang mungkin lebih longgar (mis. editor di buku lain) --
// tanpa roleOverride, perilaku lama (Setelan/Backup/dst, yang memang sengaja
// global) tidak berubah sama sekali.
window.skGetMenuVisible = function(bookId, menuKey, roleOverride) {
    const role = roleOverride || window.skComputeGlobalRole();
    if (role === 'admin') return true;
    const cfg = window._skBookMenuVisibility[bookId];
    const roleCfg = cfg && cfg[role];
    if (roleCfg && Object.prototype.hasOwnProperty.call(roleCfg, menuKey)) return !!roleCfg[menuKey];
    const def = window.SK_MENU_DEFAULTS[menuKey];
    return def ? !!def[role] : false;
};

// [PER-BUKU -- TIDAK BERUBAH] Dua fungsi ini TETAP per-buku (bukan
// global) -- dipakai db.js (pilih JWT vs anon key), crypto.js (skip
// enkripsi field), book.js (rename/hapus buku bersama tertentu), dan
// skInviteMember/skAdminCreateMemberAccount dkk (kelola anggota buku
// tertentu, harus admin BUKU ITU karena RLS server juga per-buku). Jangan
// dipakai lagi untuk menentukan visibilitas menu/Setelan -- pakai
// skComputeGlobalRole untuk itu.
window.skIsSharedBookId = function(bookId) {
    if (!bookId) return false;
    if (Object.prototype.hasOwnProperty.call(window._skSharedRoles, bookId)) return true;

    // _skSharedRoles diisi ulang dari jaringan saat app mulai. Jika request
    // awal itu sempat gagal/terlambat, daftar role dapat kosong sesaat padahal
    // metadata buku yang sudah dimuat masih menandainya sebagai shared.
    // Mengandalkan role saja membuat callSupabaseAPI jatuh ke anon key untuk
    // settings/backup dan kemudian ditolak policy RLS (42501). Metadata ini
    // hanya fallback klasifikasi client; otorisasi tetap sepenuhnya diputuskan
    // oleh JWT + RLS Supabase pada server.
    const book = Array.isArray(window.books)
        ? window.books.find(function(item) { return item && item.id === bookId; })
        : null;
    return !!(book && book._isShared === true);
};

window.skGetRoleForBook = function(bookId) {
    return window._skSharedRoles[bookId] || null;
};

// [FIX BUG LOGIKA MULTIUSER] Peran EFEKTIF untuk buku tertentu -- dipakai
// khusus untuk gerbang CRUD transaksi (skIsViewerOnCurrentBook & sekitarnya),
// BUKAN untuk gerbang Setelan/Backup/dst yang memang sengaja global (lihat
// skComputeGlobalRole di atas). Sebelumnya skIsViewerOnCurrentBook memakai
// skComputeGlobalRole() langsung -- akibatnya user yang editor di Buku A
// tapi viewer di Buku B tetap bisa Tambah/Ubah/Hapus transaksi saat sedang
// membuka Buku B, karena peran "tertinggi di buku manapun" (editor) menang,
// padahal peran dia DI BUKU B sendiri cuma viewer. Fungsi ini mengembalikan
// peran user KHUSUS untuk bookId itu kalau dia anggota buku bersama itu
// (null berarti bukan buku bersama / bukan anggota -> jatuh ke peran global,
// sama seperti perilaku lama untuk buku pribadi -- lihat aturan #3 di
// skComputeGlobalRole).
window.skGetEffectiveRoleForBook = function(bookId) {
    const perBookRole = window.skGetRoleForBook(bookId);
    return perBookRole || window.skComputeGlobalRole();
};

// [LOG LOGIN ANGGOTA] Catat "terakhir login" user yang sedang aktif ke
// public.profiles.last_login_at lewat RPC sk_touch_last_login (lihat
// sql/last_login_tracking.sql -- RPC dipakai, bukan update langsung, karena
// profiles sengaja tidak punya policy UPDATE untuk client biasa).
// Di-guard dengan window._skLastLoginTouched supaya HANYA dipanggil sekali
// per sesi tab (dipanggil ulang tiap skRefreshSharedAccess akan jadi
// spam -- fungsi itu juga jalan tiap self-heal autosync, bukan cuma saat
// login sungguhan). Guard direset di skSignOut supaya login berikutnya
// (di tab yang sama) tetap tercatat sebagai login baru.
window.skBuildMenuVisibilityHtml = function(bookId) {
    const esc = window.escapeHtml;
    const cfg = window._skBookMenuVisibility[bookId] || {};
    function isChecked(role, key) {
        const roleCfg = cfg[role];
        const has = roleCfg && Object.prototype.hasOwnProperty.call(roleCfg, key);
        const val = has ? !!roleCfg[key] : !!(window.SK_MENU_DEFAULTS[key] && window.SK_MENU_DEFAULTS[key][role]);
        return val ? ' checked' : '';
    }
    const rows = window.SK_MENU_ITEMS.map(function(item) {
        return '<tr>' +
            '<td>' + esc(item.label) + '</td>' +
            '<td class="um-menu-role-col"><input type="checkbox" data-mv-book="' + esc(bookId) + '" data-mv-role="editor" data-mv-key="' + item.key + '"' + isChecked('editor', item.key) + '></td>' +
            '<td class="um-menu-role-col"><input type="checkbox" data-mv-book="' + esc(bookId) + '" data-mv-role="viewer" data-mv-key="' + item.key + '"' + isChecked('viewer', item.key) + '></td>' +
        '</tr>';
    }).join('');

    return (
        '<div id="mvPanelWrap" class="um-panel">' +
            '<div class="um-panel-header"><span class="um-panel-title">ATUR TAMPILAN MENU PER PERAN</span></div>' +
            '<div style="font-size: var(--text-xs); color:var(--ink-faint); margin-bottom:10px; line-height:1.5;">Admin selalu bisa lihat semua menu (tidak bisa dikunci sendiri lewat sini). Centang menu yang boleh dilihat Editor / Viewer khusus di buku ini.</div>' +
            '<div class="um-menu-table-wrap">' +
                '<table class="um-menu-table">' +
                    '<thead><tr>' +
                        '<th>Menu</th>' +
                        '<th class="um-menu-role-col">Editor</th>' +
                        '<th class="um-menu-role-col">Viewer</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                '</table>' +
            '</div>' +
            '<div style="font-size: var(--text-2xs); color:var(--ink-faint); margin-top:8px; line-height:1.5;">Catatan: kalau proteksi database tambahan (sql/harden_shared_book_data_rls.sql) sudah dijalankan, Viewer tetap ditolak database saat menyimpan perubahan walau menu "Tambah Transaksi"/"Setelan" dinyalakan di sini. Kalau proteksi itu <b>belum</b> dijalankan, menyalakannya beneran memberi Viewer akses tulis -- pertimbangkan baik-baik sebelum mengaktifkan untuk Viewer.</div>' +
            '<button type="button" class="btn btn-primary" style="width:100%; margin-top:10px;" onclick="window.skSaveMenuVisibility(\'' + esc(bookId) + '\')">Simpan Pengaturan Menu</button>' +
        '</div>'
    );
};

// Kumpulkan semua checkbox data-mv-book="<bookId>" di DOM lalu upsert ke
// kolom sk_books.menu_visibility. RLS sk_books_update_admin (lihat
// sql/shared_books_roles.sql) sudah menolak ini di database kalau bukan
// admin -- cek role di sini cuma supaya pesan errornya jelas, bukan
// pertahanan utama.
window.skSaveMenuVisibility = async function(bookId) {
    if (window.skGetRoleForBook(bookId) !== 'admin') {
        window.showToast && window.showToast('Hanya admin yang bisa mengubah pengaturan menu.', 'error');
        return;
    }
    const client = window.getSupabaseAuthClient();
    if (!client) return;

    const inputs = document.querySelectorAll('input[data-mv-book]');
    const cfg = { editor: {}, viewer: {} };
    inputs.forEach(function(el) {
        if (el.getAttribute('data-mv-book') !== bookId) return;
        const role = el.getAttribute('data-mv-role');
        const key = el.getAttribute('data-mv-key');
        if (cfg[role]) cfg[role][key] = el.checked;
    });

    try {
        const res = await client.from('sk_books').update({ menu_visibility: cfg }).eq('id', bookId);
        if (res.error) throw res.error;
    } catch (e) {
        console.error('[auth.js] Gagal simpan menu_visibility:', e);
        // Kolom belum ada = migrasi sql/menu_visibility.sql belum dijalankan.
        const msg = (e && /column .*menu_visibility/i.test(e.message || '')) ?
            'Kolom menu_visibility belum ada di database. Jalankan sql/menu_visibility.sql dulu di Supabase SQL Editor.' :
            'Gagal menyimpan pengaturan menu.';
        window.showToast && window.showToast(msg, 'error');
        return;
    }

    window._skBookMenuVisibility[bookId] = cfg;
    window.showToast && window.showToast('Pengaturan menu disimpan.', 'success');
    if (typeof window.skApplyRoleUI === 'function') window.skApplyRoleUI();
};

window.skIsViewerOnCurrentBook = function() {
    return window.skGetEffectiveRoleForBook(window.currentBookId) === 'viewer';
};

window.skApplyRoleUI = function() {
    const bookId = window.currentBookId;
    const role = window.skComputeGlobalRole();

    // Helper kecil: set display sebuah elemen kalau elemennya ada. Aman
    // dipanggil untuk id yang mungkin tidak ada di semua versi markup.
    function setVisible(id, visible) {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    }

    // [DIUBAH] Visibilitas 5 menu ini sekarang mengikuti role GLOBAL lewat
    // window.skGetMenuVisible (bisa diatur admin lewat panel "Atur
    // Tampilan Menu per Peran" di halaman Manajemen User, kalau buku aktif
    // itu buku bersama yang sudah diatur) -- berlaku untuk buku pribadi
    // juga sekarang, bukan cuma buku bersama. openSetelanModal tetap
    // ditolak juga (defense-in-depth) kalau ada yang memicunya lewat jalur
    // lain (mis. deep-link "Setelan -> Analisis AI").
    // [PINDAH KE SETELAN] Akun/Cadangan Data/Telegram/Snapshot/Perangkat
    // sudah tidak punya tombol sidebar sendiri -- targetnya sekarang
    // tombol di panel "Akun & Perangkat" pada halaman Setelan.
    setVisible('navSetelanBtn', window.skGetMenuVisible(bookId, 'setelan'));
    setVisible('setelanBtnBackup', window.skGetMenuVisible(bookId, 'backup'));
    // [FIX BOCOR MENU CADANGAN DATA] 'Cadangan Data' sekarang punya tombol
    // sidebar SENDIRI (#navBackupBtn, lihat index.html + window.APP_NAV_BTN_MAP
    // di js/settings.js) sejak fitur ini dipindah keluar dari Setelan --
    // komentar lama di atas ("Akun/Cadangan Data/dst sudah tidak punya
    // tombol sidebar sendiri") sudah tidak akurat untuk versi ini. Sebelum
    // fix ini, hanya #setelanBtnBackup (tombol lama, sudah tidak dipakai
    // alur normal) yang ikut di-toggle skGetMenuVisible -- #navBackupBtn
    // luput sama sekali, jadi editor/viewer tetap bisa lihat & buka menu
    // ini dari sidebar walau admin sudah set 'backup' ke false lewat panel
    // "Atur Tampilan Menu per Peran".
    setVisible('navBackupBtn', window.skGetMenuVisible(bookId, 'backup'));
    setVisible('setelanBtnDevice', window.skGetMenuVisible(bookId, 'device'));
    setVisible('navBudgetBtn', window.skGetMenuVisible(bookId, 'budget'));
    setVisible('tambahTransaksiBtn', window.skGetMenuVisible(bookId, 'tambahTransaksi'));
    // [PERMINTAAN] Sembunyikan dari user selain admin -- ikut skema
    // menu_visibility yang sama supaya admin tetap bisa menyalakannya lagi
    // per-role kalau perlu (lihat SK_MENU_DEFAULTS).
    // [BUG FIX - EDITOR/VIEWER TERKUNCI PERMANEN DI DEVICE BARU] Modal yang
    // dibuka tombol ini (bookManagerModal) adalah SATU-SATUNYA tempat panel
    // login Buku Bersama (skRenderAuthPanel) berada -- sementara role
    // 'editor'/'viewer' sendiri baru didapat SETELAH berhasil login lewat
    // panel itu. Device yang BELUM PERNAH login sama sekali jatuh ke role
    // default 'editor' (lihat skComputeGlobalRole), yang mana default di
    // atas MENYEMBUNYIKAN tombol ini juga -- akibatnya user itu tidak
    // pernah punya cara membuka panel login di device tsb sama sekali.
    // Gejalanya persis "buku sudah di-share tapi transaksi/anggaran selalu
    // Rp 0 di device editor": request-nya lewat anon key (RLS menolak
    // baca/tulis), dan tidak ada jalan UI untuk login supaya lewat JWT.
    // Fix: kalau device ini belum pernah login (window._skAuthUser null),
    // SELALU tampilkan tombolnya terlepas dari menu_visibility -- begitu
    // user berhasil login, render berikutnya (skApplyRoleUI dipanggil lagi
    // dari skRefreshSharedAccess) kembali menghormati setelan admin seperti
    // biasa.
    setVisible('navBookBtn', !window._skAuthUser || window.skGetMenuVisible(bookId, 'bukuKas'));
    setVisible('setelanBtnAkun', window.skGetMenuVisible(bookId, 'akun'));
    setVisible('setelanBtnTelegram', window.skGetMenuVisible(bookId, 'telegram'));
    setVisible('setelanBtnSnapshot', window.skGetMenuVisible(bookId, 'snapshot'));

    // [MENU MANAJEMEN USER] Relevan selama role global admin (admin di
    // buku bersama MANA PUN), terlepas dari buku apa yang sedang dibuka --
    // supaya admin tetap bisa mengelola anggota buku bersama lain tanpa
    // perlu pindah ke buku itu dulu. Menu ini SENGAJA TIDAK ikut masuk
    // daftar yang bisa diatur admin (di luar cakupan fitur ini) -- selalu
    // admin-only.
    setVisible('navUserManagerBtn', role === 'admin' && !!window._skAuthUser);

    // [FIX LABEL "KELOLA" KOSONG UNTUK EDITOR/VIEWER] Ketiga tombol di atas
    // (#navUserManagerBtn, #navBackupBtn, #navSetelanBtn) sudah benar
    // disembunyikan per role lewat setVisible di atas, TAPI judul group
    // "<div class="app-nav-group-label">Kelola</div>" di index.html tidak
    // punya id sendiri dan tidak pernah ikut di-toggle -- jadi begitu
    // ketiganya sembunyi (editor/viewer, atau admin yang menu 'setelan'/
    // 'backup'-nya sengaja dimatikan lewat "Atur Tampilan Menu per Peran"),
    // label "KELOLA" tetap tampil sendirian tanpa isi apa pun di
    // bawahnya. Sembunyikan seluruh grup (#navKelolaGroup, wrapper div-nya
    // di index.html) kalau ketiga tombol di dalamnya sama-sama tersembunyi.
    const _kelolaGroupHasVisibleItem = ['navUserManagerBtn', 'navBackupBtn', 'navSetelanBtn'].some(function(id) {
        const el = document.getElementById(id);
        return el && el.style.display !== 'none';
    });
    setVisible('navKelolaGroup', _kelolaGroupHasVisibleItem);

    // [MULTIROLE] Tombol logout Buku Bersama sekarang di footer sidebar
    // (dipindah dari panel "Kelola Buku") -- tampil kapan pun sedang login,
    // terlepas dari role & buku aktif.
    setVisible('navSkLogoutBtn', !!window._skAuthUser);
};

// ── Patch openModal: viewer tidak boleh buka form tambah/ubah transaksi ─

})();
