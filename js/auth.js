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
//      viewer di server benar-benar berlaku (anon key tidak bisa lagi
//      dipakai untuk buku shared, lihat PATCH KEAMANAN di file SQL).
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
window._skAuthMode = 'login';   // 'login' | 'signup' -- tampilan panel saat logout

window.skIsSharedBookId = function(bookId) {
    return !!bookId && Object.prototype.hasOwnProperty.call(window._skSharedRoles, bookId);
};

window.skGetRoleForBook = function(bookId) {
    return window._skSharedRoles[bookId] || null;
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

// Daftar akun baru (Supabase Auth). Ini TIDAK otomatis jadi anggota buku
// mana pun -- setelah daftar, orangnya kasih tahu emailnya ke admin buku
// shared yang mau dia ikuti, baru admin undang lewat panel "Kelola Anggota".
window.skSignUp = async function(email, password) {
    const client = getSupabaseAuthClient();
    if (!client) {
        window.showToast && window.showToast('Supabase belum di-setup (cek Setelan → Supabase).', 'error');
        return false;
    }
    if (!password || password.length < 6) {
        window.showToast && window.showToast('Password minimal 6 karakter.', 'error');
        return false;
    }
    const { data, error } = await client.auth.signUp({ email: email, password: password });
    if (error) {
        window.showToast && window.showToast('Daftar gagal: ' + error.message, 'error');
        return false;
    }
    // Kalau project Supabase-nya mewajibkan konfirmasi email, data.session
    // akan null meski data.user ada -- artinya belum bisa langsung dipakai
    // sampai email diklik. Kalau konfirmasi email dimatikan, session langsung
    // ada dan kita bisa auto-login seperti skSignIn.
    if (data.session) {
        window._skAuthUser = data.user ? { id: data.user.id, email: data.user.email } : null;
        await window.skRefreshSharedAccess();
        window.showToast && window.showToast('Berhasil daftar & login: ' + (window._skAuthUser ? window._skAuthUser.email : ''));
    } else {
        window.showToast && window.showToast('Akun dibuat. Cek email untuk konfirmasi, lalu login.', 'success');
    }
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
    if (bookIds.length === 0) {
        if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
        return;
    }

    let bookRows;
    try {
        const res = await client.from('sk_books').select('id, name').in('id', bookIds);
        if (res.error) throw res.error;
        bookRows = res.data;
    } catch (e) {
        console.error('[auth.js] Gagal ambil sk_books:', e);
        return;
    }

    if (!window.books) window.books = [];
    (bookRows || []).forEach(function(row) {
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
        // Belum login / sesi habis: JANGAN jatuh ke anon key (anon key tidak
        // lagi punya akses ke buku shared sejak PATCH KEAMANAN) -- gagal
        // eksplisit supaya user tahu perlu login ulang, bukan diam-diam
        // dianggap sukses.
        window.showToast && window.showToast('Login diperlukan untuk mengakses buku bersama ini.', 'error');
        return null;
    }

    return _originalCallSupabaseAPI(table, method, body, queryString, options);
};

// ── Patch openSetelanModal: kunci untuk role non-admin di buku shared ───
const _originalOpenSetelanModal = window.openSetelanModal;
window.openSetelanModal = function(initialTab) {
    const bookId = window.currentBookId;
    if (window.skIsSharedBookId(bookId)) {
        const role = window.skGetRoleForBook(bookId);
        if (role !== 'admin') {
            window.showToast && window.showToast('Setelan buku bersama ini hanya bisa diubah oleh admin.', 'error');
            return;
        }
    }
    return _originalOpenSetelanModal.apply(this, arguments);
};

// ── Jadikan buku pribadi jadi buku bersama (bootstrap admin pertama) ────
// Syarat: sudah login (skSignIn/skSignUp), dan sudah jalankan
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
        const res1 = await client.from('sk_books').insert({ id: book.id, name: book.name, is_shared: true });
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
        if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
        return true;
    } catch (e) {
        console.error('[auth.js] Gagal undang anggota:', e);
        window.showToast && window.showToast('Gagal menambahkan anggota: ' + e.message, 'error');
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
        if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
        return true;
    } catch (e) {
        console.error('[auth.js] Gagal hapus anggota:', e);
        window.showToast && window.showToast('Gagal menghapus anggota: ' + e.message, 'error');
        return false;
    }
};

// Render daftar anggota ke dalam #skMemberListContent (dipanggil setelah
// skRenderAuthPanel menaruh kerangka HTML-nya, karena ini perlu fetch async).
window.skRenderMemberList = async function(bookId) {
    const wrap = document.getElementById('skMemberListContent');
    if (!wrap) return;
    const members = await window.skListBookMembers(bookId);
    if (members.length === 0) {
        wrap.innerHTML = '<div style="color:var(--ink-faint);">Belum ada anggota lain di buku ini.</div>';
        return;
    }
    wrap.innerHTML = members.map(function(m) {
        const isMe = window._skAuthUser && m.user_id === window._skAuthUser.id;
        const removeBtn = isMe ? '' : '<button type="button" class="btn-mini btn-mini-danger" onclick="window.skRemoveMember(\'' + bookId + '\',\'' + m.user_id + '\')">Hapus</button>';
        return '<div style="display:flex; align-items:center; justify-content:space-between; padding:4px 0; gap:8px;">' +
            '<span>' + window.escapeHtml(m.email) + ' <b>(' + window.escapeHtml(m.role) + ')</b>' + (isMe ? ' — kamu' : '') + '</span>' +
            removeBtn +
        '</div>';
    }).join('');
};

window._skHandleInviteSubmit = function(ev) {
    ev.preventDefault();
    const emailInput = document.getElementById('skInviteEmail');
    const roleInput = document.getElementById('skInviteRole');
    const email = emailInput.value.trim();
    const role = roleInput.value;
    window.skInviteMember(window.currentBookId, email, role).then(function(ok) {
        if (ok) emailInput.value = '';
    });
};

// ── Batasi UI sesuai peran (bukan cuma diblokir pas diklik) ─────────────
// Sebelumnya openSetelanModal & callSupabaseAPI sudah menolak aksi non-admin/
// viewer, tapi tombolnya sendiri masih kelihatan & bisa diklik dulu baru
// ketahuan ditolak. Ini menyembunyikan/menonaktifkan tombolnya duluan untuk
// buku bersama yang perannya tidak berhak, supaya tidak menyesatkan.
// Buku pribadi (bukan shared) TIDAK terpengaruh sama sekali.
window.skIsViewerOnCurrentBook = function() {
    const bookId = window.currentBookId;
    return window.skIsSharedBookId(bookId) && window.skGetRoleForBook(bookId) === 'viewer';
};

window.skApplyRoleUI = function() {
    const bookId = window.currentBookId;
    const isShared = window.skIsSharedBookId(bookId);
    const role = isShared ? window.skGetRoleForBook(bookId) : null;
    const hideSettings = isShared && role !== 'admin';
    const isViewer = isShared && role === 'viewer';

    // Menu "Setelan" disembunyikan untuk non-admin di buku bersama --
    // openSetelanModal tetap ditolak juga (defense-in-depth) kalau ada yang
    // memicunya lewat jalur lain (mis. deep-link "Setelan -> Analisis AI").
    const settingsBtn = document.getElementById('navSetelanBtn');
    if (settingsBtn) settingsBtn.style.display = hideSettings ? 'none' : '';

    // Viewer read-only: sembunyikan tombol tambah transaksi. Tombol ubah/
    // hapus (menu "⋮" per baris) tidak perlu disembunyikan satu-satu di sini
    // -- window.openActionMenu di bawah sudah menolaknya duluan sebelum menu
    // sempat terbuka.
    const addTxBtn = document.getElementById('tambahTransaksiBtn');
    if (addTxBtn) addTxBtn.style.display = isViewer ? 'none' : '';
};

// ── Patch openModal: viewer tidak boleh buka form tambah/ubah transaksi ─
const _originalOpenModal = window.openModal;
window.openModal = function(id) {
    if ((id === 'addModal' || id === 'editModal') && window.skIsViewerOnCurrentBook()) {
        window.showToast && window.showToast('Peran viewer di buku bersama ini hanya bisa melihat, tidak bisa menambah/mengubah transaksi.', 'error');
        return;
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
        const memberPanel = (role === 'admin') ?
            '<div id="skMemberPanelWrap" style="margin-top:12px; border-top:1px dashed var(--rule); padding-top:12px;">' +
                '<div style="font-size:.7rem; font-weight:700; color:var(--ink-muted); margin-bottom:6px;">Kelola Anggota Buku Ini</div>' +
                '<div id="skMemberListContent" style="font-size:.7rem; margin-bottom:8px;">Memuat anggota...</div>' +
                '<form onsubmit="window._skHandleInviteSubmit(event)">' +
                    '<input type="email" id="skInviteEmail" class="form-control" placeholder="Email anggota (harus sudah punya akun)" required autocomplete="off" style="margin-bottom:6px;">' +
                    '<select id="skInviteRole" class="form-control" style="margin-bottom:8px;">' +
                        '<option value="viewer">Viewer (lihat saja)</option>' +
                        '<option value="editor">Editor (CRUD transaksi)</option>' +
                        '<option value="admin">Admin (akses penuh)</option>' +
                    '</select>' +
                    '<button type="submit" class="btn btn-primary" style="width:100%;">Undang Anggota</button>' +
                '</form>' +
            '</div>' : '';
        el.innerHTML =
            '<div style="font-size:.75rem;">Login sebagai <b>' + window._skAuthUser.email + '</b>' + roleLine + '</div>' +
            '<button type="button" class="btn btn-secondary" style="margin-top:8px; width:100%;" onclick="window.skSignOut()">Logout Buku Bersama</button>' +
            memberPanel;
        if (role === 'admin') window.skRenderMemberList(bookId);
    } else if (window._skAuthMode === 'signup') {
        el.innerHTML =
            '<form onsubmit="window._skHandleSignUpSubmit(event)">' +
                '<input type="email" id="skAuthEmail" class="form-control" placeholder="Email" required autocomplete="username" style="margin-bottom:6px;">' +
                '<input type="password" id="skAuthPassword" class="form-control" placeholder="Password (min. 6 karakter)" required minlength="6" autocomplete="new-password" style="margin-bottom:8px;">' +
                '<button type="submit" class="btn btn-primary" style="width:100%;">Daftar Akun Buku Bersama</button>' +
            '</form>' +
            '<div style="font-size:.68rem; color:var(--ink-faint); margin-top:8px; line-height:1.6;">Daftar dulu di sini, lalu kasih tahu email kamu ke admin buku bersama yang mau kamu ikuti.</div>' +
            '<button type="button" class="btn btn-secondary" style="margin-top:8px; width:100%;" onclick="window._skToggleAuthMode(\'login\')">Sudah punya akun? Login</button>';
    } else {
        el.innerHTML =
            '<form onsubmit="window._skHandleLoginSubmit(event)">' +
                '<input type="email" id="skAuthEmail" class="form-control" placeholder="Email" required autocomplete="username" style="margin-bottom:6px;">' +
                '<input type="password" id="skAuthPassword" class="form-control" placeholder="Password" required autocomplete="current-password" style="margin-bottom:8px;">' +
                '<button type="submit" class="btn btn-primary" style="width:100%;">Login Buku Bersama</button>' +
            '</form>' +
            '<button type="button" class="btn btn-secondary" style="margin-top:8px; width:100%;" onclick="window._skToggleAuthMode(\'signup\')">Belum punya akun? Daftar</button>';
    }
};

window._skToggleAuthMode = function(mode) {
    window._skAuthMode = mode;
    window.skRenderAuthPanel();
};

window._skHandleLoginSubmit = function(ev) {
    ev.preventDefault();
    const email = document.getElementById('skAuthEmail').value.trim();
    const password = document.getElementById('skAuthPassword').value;
    window.skSignIn(email, password);
};

window._skHandleSignUpSubmit = function(ev) {
    ev.preventDefault();
    const email = document.getElementById('skAuthEmail').value.trim();
    const password = document.getElementById('skAuthPassword').value;
    window.skSignUp(email, password);
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
