// ==================== AUTH (Buku Bersama / Shared Book) ====================
// Modul TERPISAH dari sinkronisasi anon-key biasa yang sudah ada. Dipakai
// KHUSUS untuk buku yang sengaja di-share (is_shared = true di sk_books) --
// lihat sql/shared_books_roles.sql untuk fondasi database & alasan
// desainnya (kenapa perlu login Supabase Auth, bukan anon key polos).
//
// Buku pribadi biasa TIDAK tersentuh sama sekali oleh file ini -- kalau
// window._skSharedRoles kosong (belum pernah login / tidak ada buku
// shared), semua request tetap lewat callSupabaseAPI asli seperti biasa.
//
// Alur:
//   1. window.skSignIn(email, password) -- login Supabase Auth.
//   2. window.skRefreshSharedAccess() -- tarik sk_books + role user dari
//      book_members, gabungkan ke window.books supaya muncul di dropdown
//      Buku Kas seperti buku biasa (ditandai _isShared + _role).
//   3. window.callSupabaseAPI (asli dari js/db.js) di-bungkus: kalau
//      request menyasar book_id yang statusnya shared, header Authorization
//      pakai JWT user (bukan anon key) -- supaya RLS role admin/editor/
//      viewer di server benar-benar berlaku. CATATAN: ini HANYA berlaku
//      efektif kalau sql/harden_shared_book_data_rls.sql SUDAH dijalankan
//      -- file itu OPSIONAL dan tidak otomatis ikut ter-setup. Kalau belum
//      dijalankan, anon key lama MASIH bisa baca/tulis tabel transactions
//      buku ini tanpa peduli statusnya "bersama" -- lihat
//      window.skCheckAnonHardeningForBook di bawah untuk pengecekan
//      runtime-nya (jalan otomatis untuk buku yang diadmin-i user).
//   4. window.openSetelanModal dibungkus: role bukan admin -> ditolak.
//      Ini defense-in-depth di client saja -- garis pertahanan utama tetap
//      RLS di server.
//
// Skip enkripsi field transaksi untuk buku shared: sudah dikerjakan di
// js/crypto.js (lihat encodeCloudTxPayload/encodeCloudReminderPayload).
//
// UI undang anggota (bagian ini): cari calon anggota lewat tabel
// public.profiles (id+email saja, disinkron via trigger dari auth.users --
// lihat sql/profiles_and_invite.sql), lalu admin insert/update/delete baris
// book_members. RLS admin untuk book_members ada di file SQL yang sama.

(function() {
'use strict';

// [FIX] Kalau js/auth.js somehow ke-eksekusi lebih dari sekali di halaman
// yang sama (mis. race service worker pas PWA update, atau reload ganda),
// closure di bawah ini akan reset -- itu sebabnya "Multiple GoTrueClient
// instances detected" bisa muncul walau kodenya sudah menjaga satu client.
// Guard ini bikin eksekusi kedua langsung berhenti tanpa bikin apa-apa lagi.
if (window.__skAuthJsInitialized) return;
window.__skAuthJsInitialized = true;

let _authClient = null;
let _authClientUrl = null;

function getSupabaseAuthClient() {
    const url = (typeof window.getCloudUrl === 'function') ? window.getCloudUrl() : null;
    const key = (typeof window.getSupabaseKey === 'function') ? window.getSupabaseKey() : null;
    if (!url || !key) return null;
    if (_authClient && _authClientUrl === url) return _authClient;
    // [FIX] Simpan instance-nya juga di window (bukan cuma closure lokal di
    // atas) supaya kalau ADA jalur lain yang somehow bikin auth.js jalan dua
    // kali (guard __skAuthJsInitialized di atas seharusnya sudah mencegah
    // ini, tapi ini lapis kedua), instance lama tetap dipakai ulang --
    // tidak bikin GoTrueClient kedua untuk storageKey Supabase yang sama.
    if (window.__skSupabaseAuthClient && window.__skSupabaseAuthClientUrl === url) {
        _authClient = window.__skSupabaseAuthClient;
        _authClientUrl = url;
        return _authClient;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    try {
        _authClient = window.supabase.createClient(url, key);
        _authClientUrl = url;
        window.__skSupabaseAuthClient = _authClient;
        window.__skSupabaseAuthClientUrl = url;
        return _authClient;
    } catch (e) {
        console.error('[auth.js] Gagal membuat Supabase client:', e);
        return null;
    }
}
window.getSupabaseAuthClient = getSupabaseAuthClient;

window._skAuthUser = null;      // {id, email} kalau sedang login
window._skSharedRoles = {};     // { [bookId]: 'admin' | 'editor' | 'viewer' }
window._skAuthMode = 'login';   // selalu 'login' -- menu daftar manual (signup) sudah dihapus

// ── Atur Tampilan Menu per Peran (bisa diubah admin, lihat sql/menu_visibility.sql) ──
// window._skBookMenuVisibility[bookId] = { editor: {menuKey: bool}, viewer: {menuKey: bool} }
// -- diisi dari kolom sk_books.menu_visibility tiap skRefreshSharedAccess.
// Key yang tidak ada di situ jatuh ke SK_MENU_DEFAULTS (perilaku lama/fix
// sebelum fitur ini ada), jadi buku bersama yang belum pernah diatur
// adminnya tetap berperilaku sama seperti sebelumnya.
window._skBookMenuVisibility = {};

window.SK_MENU_ITEMS = [
    { key: 'setelan', label: 'Setelan' },
    { key: 'backup', label: 'Cadangan Data' },
    { key: 'device', label: 'Kelola Device' },
    { key: 'budget', label: 'Anggaran (Budget)' },
    { key: 'tambahTransaksi', label: 'Tambah Transaksi' },
    { key: 'bukuKas', label: 'Buku Kas' },
    { key: 'akun', label: 'Akun' },
    { key: 'telegram', label: 'Notifikasi Telegram' },
    { key: 'snapshot', label: 'Snapshot Keamanan' }
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
    return !!bookId && Object.prototype.hasOwnProperty.call(window._skSharedRoles, bookId);
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

window.skSignIn = async function(email, password) {
    const client = getSupabaseAuthClient();
    if (!client) {
        window.showToast && window.showToast('Supabase belum di-setup (cek Setelan → Supabase).', 'error');
        return false;
    }
    const { data, error } = await client.auth.signInWithPassword({ email: email, password: password });
    if (error) {
        window.showToast && window.showToast('Login gagal: ' + error.message, 'error');
        return false;
    }
    window._skAuthUser = data.user ? { id: data.user.id, email: data.user.email } : null;
    await window.skRefreshSharedAccess();
    window.showToast && window.showToast('Berhasil login: ' + (window._skAuthUser ? window._skAuthUser.email : ''));
    if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
    return true;
};

window.skSignOut = async function() {
    const client = getSupabaseAuthClient();
    if (client) { try { await client.auth.signOut(); } catch (e) { /* abaikan */ } }
    window._skAuthUser = null;
    window._skSharedRoles = {};
    window._skAuthMode = 'login';
    if (window.books) {
        // Kalau sedang aktif di buku shared yang baru saja hilang aksesnya,
        // pindah ke buku pribadi pertama supaya app tidak nyangkut.
        const stillHasCurrent = window.books.find(function(b) { return b.id === window.currentBookId && !b._isShared; });
        window.books = window.books.filter(function(b) { return !b._isShared; });
        if (!stillHasCurrent && window.books.length > 0 && typeof window.switchBook === 'function') {
            window.switchBook(window.books[0].id);
        }
        if (typeof window.renderBookSelector === 'function') window.renderBookSelector();
    }
    window.showToast && window.showToast('Berhasil logout dari buku bersama.');
    if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();

    // [FIX] Sebelumnya setelah logout, user cuma "nyangkut" pakai app dalam
    // status belum login -- padahal desain aslinya (lihat needsLoginGate di
    // js/app.js continueAppInit) mewajibkan login dulu SETIAP KALI syarat
    // ini terpenuhi (cloud sudah di-setup + online). Tampilkan lagi
    // gerbang login supaya konsisten -- gerbang ini position:fixed,
    // z-index tertinggi di app (sama seperti layar kunci device), jadi
    // otomatis menutup modal apa pun yang mungkin masih terbuka di
    // belakangnya tanpa perlu ditutup manual dulu.
    const needsLoginGateAfterSignOut = window.getCloudUrl && window.getCloudUrl() &&
        window.isOnline && window.isOnline() && typeof window.skShowLoginGate === 'function';
    if (needsLoginGateAfterSignOut) {
        await window.skShowLoginGate();
        if (typeof window.skHideLoginGate === 'function') window.skHideLoginGate();
        if (typeof window.skApplyRoleUI === 'function') window.skApplyRoleUI();
        if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
    }
};

window.skGetSession = async function() {
    const client = getSupabaseAuthClient();
    if (!client) return null;
    try {
        const { data } = await client.auth.getSession();
        return data ? data.session : null;
    } catch (e) {
        console.error('[auth.js] Gagal ambil session:', e);
        return null;
    }
};

// [FIX BUG #3] Buang dari window.books buku-buku yang DULU ditandai shared
// (_isShared=true) tapi sekarang tidak lagi ada di daftar akses terkini
// (mis. admin mengeluarkan kita lewat skRemoveMember, atau buku itu sendiri
// sudah dihapus admin). Sebelumnya skRefreshSharedAccess() cuma
// menambah/mengupdate buku yang ADA di hasil query book_members saat ini --
// tidak pernah membersihkan yang HILANG, jadi buku begini nangkring
// selamanya di daftar/dropdown buku dengan _isShared/_role basi, padahal
// user sudah tidak bisa mengakses apa pun di buku itu (RLS akan menolak
// semua request cloud-nya).
function _skRevokeStaleSharedBooks(stillAccessibleIds) {
    if (!window.books) return;
    const revoked = window.books.filter(function(b) { return b._isShared && !stillAccessibleIds.has(b.id); });
    if (revoked.length === 0) return;

    const revokedIds = new Set(revoked.map(function(b) { return b.id; }));
    window.books = window.books.filter(function(b) { return !revokedIds.has(b.id); });
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    revoked.forEach(function(b) {
        localStorage.removeItem('sk_txs_' + b.id);
        localStorage.removeItem('sk_budgets_' + b.id);
        localStorage.removeItem('sk_logs_' + b.id);
        localStorage.removeItem('sk_balance_offset_' + b.id);
        localStorage.removeItem('sk_payment_reminders_' + b.id);
    });

    window.showToast && window.showToast(
        (revoked.length === 1
            ? 'Akses ke buku bersama "' + revoked[0].name + '" sudah dicabut.'
            : 'Akses ke ' + revoked.length + ' buku bersama sudah dicabut.') +
        ' Dihapus dari daftar buku di device ini.',
        'warning'
    );

    // Kalau buku yang sedang aktif termasuk yang dicabut, pindah ke buku
    // pertama yang tersisa supaya app tidak nyangkut di buku yang sudah
    // tidak bisa diakses lagi.
    if (revokedIds.has(window.currentBookId) && window.books.length > 0 && typeof window.switchBook === 'function') {
        window.switchBook(window.books[0].id);
    }
    if (typeof window.renderBookList === 'function' && document.getElementById('bookManagerModal') && document.getElementById('bookManagerModal').classList.contains('show')) {
        window.renderBookList();
    }
    // Propagasikan penghapusan ini juga ke daftar buku pribadi (setting
    // 'books') supaya device lain milik akun yang sama tidak terus
    // menyimpan buku yang sudah tidak bisa diakses ini di cache-nya.
    if (typeof window.pushSettingBooks === 'function') window.pushSettingBooks();
}

// Tarik sk_books + role milik user yang sedang login, gabungkan ke
// window.books. Idempotent -- aman dipanggil ulang kapan saja (mis. tiap
// buka app kalau sesi Supabase Auth masih tersimpan dari kunjungan lalu).
window.skRefreshSharedAccess = async function() {
    const client = getSupabaseAuthClient();
    if (!client) return;
    const session = await window.skGetSession();
    if (!session) { window._skAuthUser = null; window._skSharedRoles = {}; return; }
    window._skAuthUser = { id: session.user.id, email: session.user.email };

    let memberRows;
    try {
        const res = await client.from('book_members').select('book_id, role').eq('user_id', session.user.id);
        if (res.error) throw res.error;
        memberRows = res.data;
    } catch (e) {
        console.error('[auth.js] Gagal ambil book_members:', e);
        return;
    }

    window._skSharedRoles = {};
    (memberRows || []).forEach(function(r) { window._skSharedRoles[r.book_id] = r.role; });

    const bookIds = Object.keys(window._skSharedRoles);

    // [FIX BUG #3] Query book_members di atas berhasil & OTORITATIF (bukan
    // gagal/timeout) -- artinya ini benar-benar daftar akses terkini user
    // ini, aman dipakai untuk membersihkan buku yang sudah tidak ada lagi
    // di situ. Dilakukan SEBELUM early-return di bawah supaya kasus
    // "kehilangan akses ke semua buku bersama" (bookIds kosong) juga ikut
    // dibersihkan, bukan cuma kasus "masih ada beberapa buku bersama lain".
    _skRevokeStaleSharedBooks(new Set(bookIds));

    if (bookIds.length === 0) {
        if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
        if (typeof window.skApplyRoleUI === 'function') window.skApplyRoleUI();
        return;
    }

    let bookRows;
    try {
        let res = await client.from('sk_books').select('id, name, menu_visibility').in('id', bookIds);
        if (res.error) {
            // [FALLBACK] kolom menu_visibility belum ada berarti admin belum
            // menjalankan sql/menu_visibility.sql -- jangan sampai itu bikin
            // SELURUH refresh akses buku bersama gagal, cukup ambil ulang
            // tanpa kolom itu (fitur "Atur Tampilan Menu per Peran" saja
            // yang tidak aktif sampai migrasinya dijalankan).
            res = await client.from('sk_books').select('id, name').in('id', bookIds);
        }
        if (res.error) throw res.error;
        bookRows = res.data;
    } catch (e) {
        console.error('[auth.js] Gagal ambil sk_books:', e);
        return;
    }

    if (!window.books) window.books = [];
    (bookRows || []).forEach(function(row) {
        // [MENU PER PERAN] simpan konfigurasi menu_visibility buku ini --
        // dipakai window.skGetMenuVisible. row.menu_visibility bisa null
        // kalau kolomnya belum ada (belum jalankan sql/menu_visibility.sql)
        // -- fallback {} aman, berarti semua menu jatuh ke SK_MENU_DEFAULTS.
        window._skBookMenuVisibility[row.id] = row.menu_visibility || {};

        const existing = window.books.find(function(b) { return b.id === row.id; });
        if (existing) {
            existing._isShared = true;
            existing._role = window._skSharedRoles[row.id];
            existing.name = row.name;
        } else {
            window.books.push({ id: row.id, name: row.name, _isShared: true, _role: window._skSharedRoles[row.id] });
        }
    });
    if (typeof window.renderBookSelector === 'function') window.renderBookSelector();
    if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
    if (typeof window.skApplyRoleUI === 'function') window.skApplyRoleUI();

    // [DIAGNOSTIK KEAMANAN] Cek buku yang DIADMIN-I user ini apakah
    // sql/harden_shared_book_data_rls.sql sudah aktif -- lihat
    // window.skCheckAnonHardeningForBook di bawah. Fire-and-forget (tidak
    // di-await) supaya tidak menunda proses refresh akses biasa.
    bookIds.filter(function(id) { return window._skSharedRoles[id] === 'admin'; })
        .forEach(function(id) { window.skCheckAnonHardeningForBook(id).catch(function() {}); });
};

// [DIAGNOSTIK KEAMANAN] Tes NYATA (bukan asumsi dari komentar kode) apakah
// anon key masih bisa membaca tabel transactions buku bersama ini --
// artinya sql/harden_shared_book_data_rls.sql (OPSIONAL, lihat catatan di
// kepala file ini) belum dijalankan admin database. Dipanggil otomatis oleh
// skRefreshSharedAccess, sekali per bookId per sesi (di-cache lewat
// window._skHardeningWarnedBooks), khusus untuk buku yang diadmin-i user
// yang sedang login -- supaya cuma orang yang bisa menindaklanjuti yang
// diberi tahu.
//
// PRINSIP KEHATI-HATIAN: hasil GET yang kosong/gagal TIDAK disimpulkan
// "berarti sudah aman" -- bisa saja karena buku itu memang belum punya
// transaksi sama sekali, atau lagi offline. Peringatan HANYA muncul kalau
// ada BUKTI KONKRET: anon key berhasil membaca baris data transaksi asli.
window._skHardeningWarnedBooks = window._skHardeningWarnedBooks || new Set();
window.skCheckAnonHardeningForBook = async function(bookId) {
    if (window._skHardeningWarnedBooks.has(bookId)) return;
    const baseUrl = window.getCloudUrl();
    const apiKey = window.getSupabaseKey();
    if (!baseUrl || !apiKey) return;
    try {
        // Sengaja pakai fetch mentah dengan HANYA anon key (tanpa JWT) --
        // ini simulasi persis apa yang bisa dilakukan siapa pun yang punya
        // URL+anon key project ini, terlepas dari login/keanggotaan.
        const res = await fetch(
            `${baseUrl}/rest/v1/transactions?book_id=eq.${encodeURIComponent(bookId)}&select=id&limit=1`,
            { headers: { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}` } }
        );
        if (!res.ok) return; // ditolak (kemungkinan sudah terproteksi) -- tidak disimpulkan apa-apa lebih jauh
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0) {
            window._skHardeningWarnedBooks.add(bookId);
            const book = (window.books || []).find(function(b) { return b.id === bookId; });
            window.showToast && window.showToast(
                'PERINGATAN KEAMANAN: buku bersama "' + (book ? book.name : bookId) + '" masih bisa dibaca lewat anon key tanpa login (RLS data belum diproteksi). ' +
                'Jalankan sql/harden_shared_book_data_rls.sql di Supabase SQL Editor secepatnya.',
                'error'
            );
        }
    } catch (e) {
        // Offline / gagal jaringan -- diamkan, jangan sok tahu ini "aman".
    }
};

// ── Patch callSupabaseAPI: pakai JWT user untuk request ke buku shared ──
const _originalCallSupabaseAPI = window.callSupabaseAPI;
window.callSupabaseAPI = async function(table, method, body, queryString, options) {
    let targetBookId = null;
    if (queryString && /book_id=eq\.([^&]+)/.test(queryString)) {
        targetBookId = decodeURIComponent(RegExp.$1);
    } else if (body) {
        const row = Array.isArray(body) ? body[0] : body;
        if (row && row.book_id) targetBookId = row.book_id;
    }

    if (targetBookId && window.skIsSharedBookId(targetBookId)) {
        const session = await window.skGetSession();
        const baseUrl = window.getCloudUrl();
        const apiKey = window.getSupabaseKey();
        if (session && session.access_token && baseUrl && apiKey) {
            let url = `${baseUrl}/rest/v1/${table}`;
            if (queryString) url += queryString;
            const headers = {
                'apikey': apiKey,
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json'
            };
            if (method === 'POST') headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
            if (options && options.returnRepresentation) headers['Prefer'] = 'return=representation';
            const config = { method: method, headers: headers };
            if (body) config.body = JSON.stringify(body);
            try {
                const res = await fetch(url, config);
                if (!res.ok) {
                    const errText = await res.text();
                    const err = new Error(errText);
                    err.status = res.status;
                    throw err;
                }
                const text = await res.text();
                return text ? JSON.parse(text) : true;
            } catch (e) {
                console.error(`Supabase API Error (buku bersama, ${table}):`, e);
                if (window.isOnline && window.isOnline() && window.showToast) {
                    window.showToast(`Gagal sinkron '${table}' (buku bersama, perlu login): ${e && e.status ? e.status : 'network'}`, 'error');
                }
                return null;
            }
        }
        // Belum login / sesi habis: JANGAN jatuh ke anon key -- kalau
        // sql/harden_shared_book_data_rls.sql sudah dijalankan, anon key
        // memang sudah ditolak database untuk buku shared, jadi lebih baik
        // gagal eksplisit di sini supaya user tahu perlu login ulang. Kalau
        // migrasi itu BELUM dijalankan, anon key sebenarnya masih bisa
        // tembus di level database -- tapi kita tetap TIDAK mau
        // menggunakannya di jalur ini (client seharusnya tidak diam-diam
        // memanfaatkan celah proteksi yang belum lengkap).
        window.showToast && window.showToast('Login diperlukan untuk mengakses buku bersama ini.', 'error');
        return null;
    }

    return _originalCallSupabaseAPI(table, method, body, queryString, options);
};

// ── Patch openSetelanModal: kunci untuk role global non-admin ───────────
// [DIUBAH] Sekarang berlaku untuk SEMUA buku (termasuk buku pribadi),
// bukan cuma buku yang statusnya "Bersama" -- lihat skComputeGlobalRole.
const _originalOpenSetelanModal = window.openSetelanModal;
window.openSetelanModal = function(initialTab) {
    if (window.skComputeGlobalRole() !== 'admin') {
        window.showToast && window.showToast('Setelan hanya bisa dibuka oleh admin Buku Bersama. Login dulu di "Kelola Buku" kalau kamu admin.', 'error');
        return;
    }
    return _originalOpenSetelanModal.apply(this, arguments);
};

// ── Jadikan buku pribadi jadi buku bersama (bootstrap admin pertama) ────
// Syarat: sudah login (skSignIn), dan sudah jalankan
// sql/bootstrap_shared_book.sql (jalur RLS khusus buat baris admin pertama).
window.skMakeBookShared = async function(bookId) {
    const client = getSupabaseAuthClient();
    if (!client) {
        window.showToast && window.showToast('Supabase belum di-setup (cek Setelan → Supabase).', 'error');
        return;
    }
    if (!window._skAuthUser) {
        window.showToast && window.showToast('Login dulu di panel "Buku Bersama" di atas sebelum menjadikan buku ini bersama.', 'error');
        return;
    }
    const book = window.books.find(function(b) { return b.id === bookId; });
    if (!book) return;
    if (book._isShared) {
        window.showToast && window.showToast('Buku ini sudah jadi buku bersama.', 'error');
        return;
    }
    const ok = confirm(
        'Jadikan "' + book.name + '" sebagai buku bersama?\n\n' +
        'Setelah ini: buku hanya bisa diakses lewat login (bukan anon key lagi), ' +
        'dan kamu jadi admin pertamanya. Aksi ini tidak bisa dibatalkan sendiri dari UI.'
    );
    if (!ok) return;
    try {
        // [FIX] created_by wajib diisi -- kolom NOT NULL di sk_books & juga
        // dipakai policy RLS sk_books_insert_self (WITH CHECK created_by =
        // auth.uid()). Kalau tidak dikirim, Postgres menolaknya dengan
        // error 23502 (null value in column "created_by").
        const res1 = await client.from('sk_books').insert({ id: book.id, name: book.name, is_shared: true, created_by: window._skAuthUser.id });
        if (res1.error) throw res1.error;
        const res2 = await client.from('book_members').insert({ book_id: book.id, user_id: window._skAuthUser.id, role: 'admin' });
        if (res2.error) throw res2.error;

        book._isShared = true;
        book._role = 'admin';
        window._skSharedRoles[book.id] = 'admin';
        localStorage.setItem('sk_books', JSON.stringify(window.books));

        window.showToast && window.showToast('"' + book.name + '" sekarang jadi buku bersama. Kamu adalah admin.', 'success');
        if (typeof window.renderBookList === 'function') window.renderBookList();
        if (typeof window.updateBookSelectDropdown === 'function') window.updateBookSelectDropdown();
        if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
    } catch (e) {
        console.error('[auth.js] Gagal menjadikan buku bersama:', e);
        window.showToast && window.showToast('Gagal: ' + e.message + ' (sudah jalankan sql/bootstrap_shared_book.sql?)', 'error');
    }
};

// ── Kelola Anggota (undang / hapus / lihat daftar) ──────────────────────
// Cari calon anggota berdasarkan email lewat public.profiles (lihat
// sql/profiles_and_invite.sql). Cocok case-insensitive (ilike exact, tanpa
// wildcard tambahan dari kita -- kalau user isi email polos ya match persis).
window.skFindUserByEmail = async function(email) {
    const client = getSupabaseAuthClient();
    if (!client || !email) return null;
    try {
        const res = await client.from('profiles').select('id, email').ilike('email', email.trim()).maybeSingle();
        if (res.error) throw res.error;
        return res.data || null;
    } catch (e) {
        console.error('[auth.js] Gagal cari user by email:', e);
        return null;
    }
};

// [MENU MANAJEMEN USER] Refresh terpusat untuk SEMUA tempat yang menampilkan
// panel kelola anggota -- sekarang ada dua: panel kecil di dalam modal
// "Kelola Buku Kas" (skAuthPanelContent, khusus buku yang lagi aktif) DAN
// halaman penuh "Manajemen User" di sidebar (userManagerModal, bisa pilih
// buku bersama mana pun yang diadminkan). Dipanggil setiap kali ada
// perubahan anggota/role supaya kedua tempat itu tetap konsisten, terlepas
// dari yang mana yang memicu perubahannya.
window._skRefreshAllMemberPanels = function() {
    if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
    const umModal = document.getElementById('userManagerModal');
    if (umModal && umModal.classList.contains('show') && typeof window.skRenderUserManagerPage === 'function') {
        window.skRenderUserManagerPage(window._umSelectedBookId);
    }
};

// Daftar anggota sebuah buku shared, digabung dengan email dari profiles
// (book_members sendiri cuma simpan user_id, bukan email).
window.skListBookMembers = async function(bookId) {
    const client = getSupabaseAuthClient();
    if (!client) return [];
    try {
        const res = await client.from('book_members').select('user_id, role').eq('book_id', bookId);
        if (res.error) throw res.error;
        const rows = res.data || [];
        if (rows.length === 0) return [];
        const ids = rows.map(function(r) { return r.user_id; });
        const profRes = await client.from('profiles').select('id, email').in('id', ids);
        const emailById = {};
        (profRes.data || []).forEach(function(p) { emailById[p.id] = p.email; });
        return rows.map(function(r) {
            return { user_id: r.user_id, role: r.role, email: emailById[r.user_id] || '(email tidak diketahui)' };
        });
    } catch (e) {
        console.error('[auth.js] Gagal ambil daftar anggota:', e);
        return [];
    }
};

// Undang anggota: hanya boleh oleh admin buku itu. Calon anggota HARUS
// sudah pernah daftar akun (Supabase Auth) duluan -- fitur ini tidak
// mengirim undangan email, cuma menautkan akun yang sudah ada ke buku.
window.skInviteMember = async function(bookId, email, role) {
    const client = getSupabaseAuthClient();
    if (!client) return false;
    if (window.skGetRoleForBook(bookId) !== 'admin') {
        window.showToast && window.showToast('Hanya admin yang bisa mengundang anggota.', 'error');
        return false;
    }
    const profile = await window.skFindUserByEmail(email);
    if (!profile) {
        window.showToast && window.showToast('Email itu belum pernah daftar akun. Minta orangnya daftar dulu, baru bisa diundang.', 'error');
        return false;
    }
    if (window._skAuthUser && profile.id === window._skAuthUser.id) {
        window.showToast && window.showToast('Itu email kamu sendiri.', 'error');
        return false;
    }
    try {
        const res = await client.from('book_members').upsert(
            { book_id: bookId, user_id: profile.id, role: role },
            { onConflict: 'book_id,user_id' }
        );
        if (res.error) throw res.error;
        window.showToast && window.showToast('Berhasil menambahkan ' + profile.email + ' sebagai ' + role + '.');
        window._skRefreshAllMemberPanels();
        return true;
    } catch (e) {
        console.error('[auth.js] Gagal undang anggota:', e);
        window.showToast && window.showToast('Gagal menambahkan anggota: ' + e.message, 'error');
        return false;
    }
};

// ── Admin membuatkan akun baru langsung untuk anggota (bukan self-signup) ─
// Beda dengan skInviteMember (yang mensyaratkan calon anggota SUDAH pernah
// daftar akun sendiri): fungsi ini membuat akun Supabase Auth BARU atas nama
// admin, langsung dengan role tertentu -- jadi admin tinggal kasih tahu
// email+password itu ke staf/anggota, dan mereka tinggal login pakai
// kredensial itu (lihat js/app.js continueAppInit -- begitu mereka login
// sekali di device mereka, unlock berikutnya otomatis masuk ke tampilan
// sesuai role, tanpa perlu login manual lagi).
//
// [PENTING] client.auth.signUp() di Supabase, kalau konfirmasi email di
// project itu DIMATIKAN, otomatis MENGGANTI sesi client yang sedang aktif
// jadi sesi akun baru itu -- artinya admin yang tadinya login, tiba-tiba
// "ganti jadi" akun barunya sendiri di device admin. Supaya admin tidak
// ter-logout diam-diam, sesi admin disimpan dulu sebelum signUp, lalu
// dipulihkan lagi (client.auth.setSession) segera setelah akun baru dibuat,
// SEBELUM baris book_members di-insert (insert butuh JWT admin, bukan JWT
// akun baru, supaya RLS admin-only-nya lolos).
window.skAdminCreateMemberAccount = async function(bookId, email, password, role) {
    const client = getSupabaseAuthClient();
    if (!client) {
        window.showToast && window.showToast('Supabase belum di-setup (cek Setelan → Supabase).', 'error');
        return false;
    }
    if (window.skGetRoleForBook(bookId) !== 'admin') {
        window.showToast && window.showToast('Hanya admin yang bisa membuatkan akun anggota.', 'error');
        return false;
    }
    if (!email || !password || password.length < 6) {
        window.showToast && window.showToast('Email wajib diisi & password minimal 6 karakter.', 'error');
        return false;
    }

    // Simpan sesi admin saat ini (kalau ada) supaya bisa dipulihkan setelah
    // signUp -- lihat catatan [PENTING] di atas kenapa ini perlu.
    let adminSession = null;
    try {
        const cur = await client.auth.getSession();
        adminSession = (cur && cur.data) ? cur.data.session : null;
    } catch (e) { /* lanjut saja, anggap tidak ada sesi tersimpan */ }

    let newUserId = null;
    try {
        const { data, error } = await client.auth.signUp({ email: email, password: password });
        if (error) throw error;
        newUserId = data && data.user ? data.user.id : null;
        if (!newUserId) throw new Error('Akun dibuat tapi user id tidak didapat dari respons Supabase.');
    } catch (e) {
        console.error('[auth.js] Gagal membuat akun anggota baru:', e);
        window.showToast && window.showToast('Gagal membuat akun: ' + e.message, 'error');
        return false;
    }

    // Pulihkan sesi admin (kalau signUp tadi diam-diam menggantinya).
    if (adminSession && adminSession.access_token && adminSession.refresh_token) {
        try {
            await client.auth.setSession({
                access_token: adminSession.access_token,
                refresh_token: adminSession.refresh_token
            });
        } catch (e) {
            console.warn('[auth.js] Gagal memulihkan sesi admin setelah buat akun anggota:', e);
        }
    }

    try {
        const res = await client.from('book_members').upsert(
            { book_id: bookId, user_id: newUserId, role: role },
            { onConflict: 'book_id,user_id' }
        );
        if (res.error) throw res.error;
        window.showToast && window.showToast(
            'Akun "' + email + '" berhasil dibuat sebagai ' + role + '. Kasih tahu email & password ini ke orangnya untuk login di device mereka.',
            'success'
        );
        // Pastikan panel & role UI di device admin sendiri konsisten lagi
        // (jaga-jaga kalau sesi sempat "goyang" selama proses di atas).
        await window.skRefreshSharedAccess();
        window._skRefreshAllMemberPanels();
        return true;
    } catch (e) {
        console.error('[auth.js] Akun dibuat tapi gagal ditautkan ke buku:', e);
        window.showToast && window.showToast(
            'Akun "' + email + '" sudah dibuat, tapi GAGAL ditautkan ke buku ini: ' + e.message + '. Coba undang manual lewat form "Undang Anggota" di atas.',
            'error'
        );
        return false;
    }
};

window.skRemoveMember = async function(bookId, userId) {
    const client = getSupabaseAuthClient();
    if (!client) return false;
    if (window.skGetRoleForBook(bookId) !== 'admin') {
        window.showToast && window.showToast('Hanya admin yang bisa menghapus anggota.', 'error');
        return false;
    }
    if (window._skAuthUser && userId === window._skAuthUser.id) {
        window.showToast && window.showToast('Tidak bisa menghapus diri sendiri dari sini.', 'error');
        return false;
    }
    if (!confirm('Hapus anggota ini dari buku bersama?')) return false;
    try {
        const res = await client.from('book_members').delete().eq('book_id', bookId).eq('user_id', userId);
        if (res.error) throw res.error;
        window.showToast && window.showToast('Anggota dihapus.');
        window._skRefreshAllMemberPanels();
        return true;
    } catch (e) {
        console.error('[auth.js] Gagal hapus anggota:', e);
        window.showToast && window.showToast('Gagal menghapus anggota: ' + e.message, 'error');
        return false;
    }
};

// Render daftar anggota ke dalam container yang dipilih (default
// #skMemberListContent, dipakai panel di modal "Kelola Buku Kas"; halaman
// "Manajemen User" pakai #umMemberListContent lewat parameter kedua supaya
// dua tempat ini bisa aktif berbarengan di DOM tanpa bentrok id). Dipanggil
// setelah kerangka HTML panelnya ditaruh, karena ini perlu fetch async.
window.skRenderMemberList = async function(bookId, containerId) {
    containerId = containerId || 'skMemberListContent';
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.className = 'um-member-list';
    // Turunkan prefix ('sk'/'um') dari containerId untuk update badge jumlah
    // anggota di header panel (id-nya <prefix>MemberCount, lihat
    // skBuildMemberManagementHtml) -- tidak fatal kalau elemennya tidak ada.
    const countEl = document.getElementById(containerId.replace('MemberListContent', 'MemberCount'));
    const members = await window.skListBookMembers(bookId);
    if (countEl) countEl.textContent = members.length + ' anggota';
    if (members.length === 0) {
        wrap.innerHTML = '<div class="um-member-empty">Belum ada anggota lain di buku ini.</div>';
        return;
    }
    const esc = window.escapeHtml;
    // Peran yang dikenal punya warna badge sendiri (lihat .um-role-badge--*
    // di css/style.css); peran lain (harusnya tidak pernah terjadi, tapi
    // dijaga) jatuh ke gaya viewer/netral supaya tidak pecah tampilan.
    const knownRoles = { admin: 1, editor: 1, viewer: 1 };
    wrap.innerHTML = members.map(function(m) {
        const isMe = window._skAuthUser && m.user_id === window._skAuthUser.id;
        const roleClass = knownRoles[m.role] ? m.role : 'viewer';
        const initial = (m.email || '?').charAt(0).toUpperCase();
        const removeBtn = isMe ? '' :
            '<button type="button" class="btn-mini btn-mini-danger" onclick="window.skRemoveMember(\'' + bookId + '\',\'' + m.user_id + '\')">Hapus</button>';
        return (
            '<div class="um-member-card">' +
                '<div class="um-member-avatar role-' + roleClass + '">' + esc(initial) + '</div>' +
                '<div class="um-member-info">' +
                    '<div class="um-member-email">' + esc(m.email) + '</div>' +
                    '<div class="um-member-meta">' +
                        '<span class="um-role-badge um-role-badge--' + roleClass + '">' + esc(m.role) + '</span>' +
                        (isMe ? '<span class="um-member-you">kamu</span>' : '') +
                    '</div>' +
                '</div>' +
                removeBtn +
            '</div>'
        );
    }).join('');
};

// [MENU MANAJEMEN USER] Blok HTML "Kelola Anggota" (daftar anggota + form
// undang + form buatkan akun baru) diekstrak jadi fungsi reusable dengan
// `prefix` untuk id elemen -- dipakai DUA kali di DOM sekarang: prefix 'sk'
// di panel modal "Kelola Buku Kas" (perilaku lama, tidak berubah) dan
// prefix 'um' di halaman penuh "Manajemen User" (baru). `bookId` dibekukan
// ke dalam onsubmit supaya form tahu buku bersama mana yang sedang dikelola
// tanpa bergantung ke window.currentBookId (di halaman "Manajemen User",
// buku yang dipilih di dropdown bisa berbeda dari buku aktif di dashboard).
window.skBuildMemberManagementHtml = function(bookId, prefix) {
    prefix = prefix || 'sk';
    const esc = window.escapeHtml;
    const roleOptions =
        '<option value="viewer">Viewer (lihat saja)</option>' +
        '<option value="editor">Editor (CRUD transaksi)</option>' +
        '<option value="admin">Admin (akses penuh)</option>';
    return (
        '<div id="' + prefix + 'MemberPanelWrap" class="um-panel">' +
            '<div class="um-panel-header">' +
                '<span class="um-panel-title">KELOLA ANGGOTA BUKU INI</span>' +
                '<span class="um-member-count" id="' + prefix + 'MemberCount">…</span>' +
            '</div>' +
            '<div id="' + prefix + 'MemberListContent" class="um-member-list">Memuat anggota...</div>' +

            '<div class="um-invite-tabs" role="tablist">' +
                '<button type="button" class="um-invite-tab active" data-um-panel="invite" onclick="window._umSwitchInviteTab(this,\'' + prefix + '\')">Undang (sudah punya akun)</button>' +
                '<button type="button" class="um-invite-tab" data-um-panel="create" onclick="window._umSwitchInviteTab(this,\'' + prefix + '\')">Buat Akun Baru</button>' +
            '</div>' +

            '<div id="' + prefix + 'InviteTabPanel" data-um-tab-panel="invite">' +
                '<form onsubmit="window._skHandleInviteSubmit(event,\'' + esc(bookId) + '\',\'' + prefix + '\')">' +
                    '<input type="email" id="' + prefix + 'InviteEmail" class="form-control" placeholder="Email anggota (harus sudah punya akun)" required autocomplete="off" style="margin-bottom:6px;">' +
                    '<select id="' + prefix + 'InviteRole" class="form-control" style="margin-bottom:8px;">' + roleOptions + '</select>' +
                    '<button type="submit" class="btn btn-primary" style="width:100%;">Undang Anggota</button>' +
                '</form>' +
            '</div>' +

            '<div id="' + prefix + 'CreateTabPanel" data-um-tab-panel="create" style="display:none;">' +
                '<form onsubmit="window._skHandleCreateMemberSubmit(event,\'' + esc(bookId) + '\',\'' + prefix + '\')">' +
                    '<input type="email" id="' + prefix + 'NewMemberEmail" class="form-control" placeholder="Email untuk akun baru anggota" required autocomplete="off" style="margin-bottom:6px;">' +
                    '<input type="password" id="' + prefix + 'NewMemberPassword" class="form-control" placeholder="Password untuk anggota (min. 6 karakter)" required minlength="6" autocomplete="new-password" style="margin-bottom:6px;">' +
                    '<select id="' + prefix + 'NewMemberRole" class="form-control" style="margin-bottom:8px;">' + roleOptions + '</select>' +
                    '<button type="submit" class="btn btn-primary" style="width:100%;">Buatkan Akun Baru untuk Anggota</button>' +
                '</form>' +
                '<div class="um-invite-tab-panel-note">Anggota belum punya akun? Buatkan langsung di sini, lalu kasih tahu email &amp; password ini ke orangnya untuk login di device mereka.</div>' +
            '</div>' +
        '</div>'
    );
};

// Toggle sederhana antara panel "Undang" & "Buat Akun Baru" di dalam satu
// wrapper .um-panel -- discope pakai `prefix` supaya aman kalau panel 'sk'
// (modal Kelola Buku) dan 'um' (halaman Manajemen User) sama-sama ada di
// DOM bersamaan.
window._umSwitchInviteTab = function(btnEl, prefix) {
    const wrap = btnEl.closest('.um-panel');
    if (!wrap) return;
    wrap.querySelectorAll('.um-invite-tab').forEach(function(b) { b.classList.remove('active'); });
    btnEl.classList.add('active');
    const target = btnEl.getAttribute('data-um-panel');
    const invitePanel = document.getElementById(prefix + 'InviteTabPanel');
    const createPanel = document.getElementById(prefix + 'CreateTabPanel');
    if (invitePanel) invitePanel.style.display = (target === 'invite') ? '' : 'none';
    if (createPanel) createPanel.style.display = (target === 'create') ? '' : 'none';
};

// [MENU PER PERAN] Panel "Atur Tampilan Menu per Peran" -- checkbox
// Editor/Viewer untuk tiap item di window.SK_MENU_ITEMS. Dipakai di halaman
// "Manajemen User" (prefix 'um', lihat window.skRenderUserManagerPage),
// bukan di modal "Kelola Buku Kas" -- supaya tidak terlalu ramai di sana.
// Checkbox pakai data-attribute (bukan id per-bookId) supaya aman untuk
// bookId apa pun tanpa perlu sanitasi karakter untuk id DOM.
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
            '<div style="font-size:.66rem; color:var(--ink-faint); margin-bottom:10px; line-height:1.5;">Admin selalu bisa lihat semua menu (tidak bisa dikunci sendiri lewat sini). Centang menu yang boleh dilihat Editor / Viewer khusus di buku ini.</div>' +
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
            '<div style="font-size:.64rem; color:var(--ink-faint); margin-top:8px; line-height:1.5;">Catatan: kalau proteksi database tambahan (sql/harden_shared_book_data_rls.sql) sudah dijalankan, Viewer tetap ditolak database saat menyimpan perubahan walau menu "Tambah Transaksi"/"Setelan" dinyalakan di sini. Kalau proteksi itu <b>belum</b> dijalankan, menyalakannya beneran memberi Viewer akses tulis -- pertimbangkan baik-baik sebelum mengaktifkan untuk Viewer.</div>' +
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
    const client = getSupabaseAuthClient();
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

window._skHandleInviteSubmit = function(ev, bookId, prefix) {
    ev.preventDefault();
    prefix = prefix || 'sk';
    bookId = bookId || window.currentBookId;
    const emailInput = document.getElementById(prefix + 'InviteEmail');
    const roleInput = document.getElementById(prefix + 'InviteRole');
    const email = emailInput.value.trim();
    const role = roleInput.value;
    window.skInviteMember(bookId, email, role).then(function(ok) {
        if (ok) emailInput.value = '';
    });
};

// Handler form "Buatkan Akun Baru untuk Anggota" -- lihat
// window.skAdminCreateMemberAccount di atas untuk detail alur & alasannya.
window._skHandleCreateMemberSubmit = function(ev, bookId, prefix) {
    ev.preventDefault();
    prefix = prefix || 'sk';
    bookId = bookId || window.currentBookId;
    const emailInput = document.getElementById(prefix + 'NewMemberEmail');
    const pwdInput = document.getElementById(prefix + 'NewMemberPassword');
    const roleInput = document.getElementById(prefix + 'NewMemberRole');
    const email = emailInput.value.trim();
    const password = pwdInput.value;
    const role = roleInput.value;
    window.skAdminCreateMemberAccount(bookId, email, password, role).then(function(ok) {
        if (ok) { emailInput.value = ''; pwdInput.value = ''; }
    });
};

// ── Halaman sidebar "Manajemen User" ─────────────────────────────────────
// Beda dengan panel di dalam modal "Kelola Buku Kas" (yang cuma menampilkan
// kelola-anggota untuk buku yang SEDANG AKTIF): halaman ini mendaftar SEMUA
// buku bersama yang diadminkan user yang sedang login, dengan dropdown
// untuk pindah antar buku -- jadi admin tidak perlu switchBook() dulu cuma
// untuk mengelola anggota buku bersama lain yang tidak sedang dibuka.
window._umSelectedBookId = null;

window.openUserManager = function() {
    if (!window._skAuthUser) {
        window.showToast && window.showToast('Login dulu ke Buku Bersama lewat menu "Buku Kas" sebelum mengelola user.', 'error');
        if (typeof window.openBookManager === 'function') window.openBookManager();
        return;
    }
    window.openModal('userManagerModal');
    window.skRenderUserManagerPage();
};

window.skRenderUserManagerPage = function(selectedBookId) {
    const wrap = document.getElementById('userManagerContent');
    if (!wrap) return;

    if (!window._skAuthUser) {
        wrap.innerHTML =
            '<div class="um-empty-state">' +
                '<div class="um-empty-state-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg></div>' +
                '<div class="um-empty-state-text">Belum login ke Buku Bersama. Login dulu lewat menu <b>Buku Kas</b> → panel "Buku Bersama" di atas daftar buku.</div>' +
            '</div>';
        return;
    }

    const adminBookIds = Object.keys(window._skSharedRoles).filter(function(id) {
        return window._skSharedRoles[id] === 'admin';
    });

    if (adminBookIds.length === 0) {
        wrap.innerHTML =
            '<div class="um-empty-state">' +
                '<div class="um-empty-state-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></div>' +
                '<div class="um-empty-state-text">Kamu belum jadi admin di buku bersama mana pun, jadi belum ada yang bisa dikelola di sini. ' +
                'Jadikan salah satu buku milikmu sebagai buku bersama lewat menu <b>Buku Kas</b> (tombol "Jadikan Bersama"), ' +
                'kamu otomatis jadi admin pertamanya.</div>' +
            '</div>';
        return;
    }

    if (!selectedBookId || adminBookIds.indexOf(selectedBookId) === -1) {
        selectedBookId = (adminBookIds.indexOf(window.currentBookId) !== -1) ? window.currentBookId : adminBookIds[0];
    }
    window._umSelectedBookId = selectedBookId;

    const options = adminBookIds.map(function(id) {
        const book = (window.books || []).find(function(b) { return b.id === id; });
        const name = book ? book.name : id;
        return '<option value="' + window.escapeHtml(id) + '"' + (id === selectedBookId ? ' selected' : '') + '>' + window.escapeHtml(name) + '</option>';
    }).join('');

    const selectorHtml =
        '<div class="um-select-wrap">' +
        (adminBookIds.length > 1
            ? '<div class="form-group" style="margin-bottom:0;"><label style="font-size:.7rem; font-weight:700; color:var(--ink-muted);">Buku Bersama</label>' +
              '<select id="umBookSelect" class="form-control" onchange="window.skRenderUserManagerPage(this.value)">' + options + '</select></div>'
            : '<div style="font-size:.72rem; color:var(--ink-muted);">Buku: <b>' + window.escapeHtml((window.books || []).find(function(b) { return b.id === selectedBookId; }) ? window.books.find(function(b) { return b.id === selectedBookId; }).name : selectedBookId) + '</b></div>'
        ) +
        '</div>';

    wrap.innerHTML = selectorHtml + window.skBuildMemberManagementHtml(selectedBookId, 'um') + window.skBuildMenuVisibilityHtml(selectedBookId);
    window.skRenderMemberList(selectedBookId, 'umMemberListContent');
};

// ── Batasi UI sesuai peran (bukan cuma diblokir pas diklik) ─────────────
// [DIUBAH] Sebelumnya cuma berlaku untuk buku yang statusnya "Bersama";
// sekarang role GLOBAL (skComputeGlobalRole) berlaku ke SEMUA buku,
// termasuk buku pribadi -- lihat komentar di skComputeGlobalRole untuk
// alasannya. Sebelumnya openSetelanModal & callSupabaseAPI sudah menolak
// aksi non-admin/viewer, tapi tombolnya sendiri masih kelihatan & bisa
// diklik dulu baru ketahuan ditolak. Ini menyembunyikan/menonaktifkan
// tombolnya duluan supaya tidak menyesatkan.
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
    setVisible('setelanBtnDevice', window.skGetMenuVisible(bookId, 'device'));
    setVisible('navBudgetBtn', window.skGetMenuVisible(bookId, 'budget'));
    setVisible('tambahTransaksiBtn', window.skGetMenuVisible(bookId, 'tambahTransaksi'));
    // [PERMINTAAN] Sembunyikan dari user selain admin -- ikut skema
    // menu_visibility yang sama supaya admin tetap bisa menyalakannya lagi
    // per-role kalau perlu (lihat SK_MENU_DEFAULTS).
    setVisible('navBookBtn', window.skGetMenuVisible(bookId, 'bukuKas'));
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

    // [MULTIROLE] Tombol logout Buku Bersama sekarang di footer sidebar
    // (dipindah dari panel "Kelola Buku") -- tampil kapan pun sedang login,
    // terlepas dari role & buku aktif.
    setVisible('navSkLogoutBtn', !!window._skAuthUser);
};

// ── Patch openModal: viewer tidak boleh buka form tambah/ubah transaksi ─
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
        const roleLine = role ? `<div style="margin-top:4px;">Peran kamu di buku aktif: <b>${role}</b></div>` : '<div style="margin-top:4px; color:var(--ink-faint);">Buku aktif bukan buku bersama.</div>';
        // [MENU MANAJEMEN USER] HTML blok ini sekarang juga dipakai halaman
        // sidebar "Manajemen User" (window.skRenderUserManagerPage) --
        // diekstrak ke window.skBuildMemberManagementHtml supaya tidak
        // duplikat. Panel di sini tetap ada (bukan dihapus) karena tetap
        // berguna sebagai jalan pintas cepat untuk buku yang sedang aktif,
        // tanpa perlu pindah halaman.
        const memberPanel = (role === 'admin') ? window.skBuildMemberManagementHtml(bookId, 'sk') : '';
        el.innerHTML =
            '<div style="font-size:.75rem;">Login sebagai <b>' + window._skAuthUser.email + '</b>' + roleLine +
            '<div style="margin-top:4px; color:var(--ink-faint);">Tombol logout ada di footer sidebar.</div></div>' +
            memberPanel;
        if (role === 'admin') window.skRenderMemberList(bookId);
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

})();
