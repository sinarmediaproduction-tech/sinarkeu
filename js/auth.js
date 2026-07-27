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
// BELUM ada di file ini (tahap terpisah, menyusul kalau tahap ini oke):
//   - Skip enkripsi field transaksi untuk buku shared (transaction.js/db.js
//     masih enkripsi semua buku termasuk yang shared -- artinya buku
//     shared BELUM aman dipakai penuh sampai bagian ini selesai).
//   - UI undang anggota (insert baris book_members + atur role).

(function() {
'use strict';

let _authClient = null;
let _authClientUrl = null;

function getSupabaseAuthClient() {
    const url = (typeof window.getCloudUrl === 'function') ? window.getCloudUrl() : null;
    const key = (typeof window.getSupabaseKey === 'function') ? window.getSupabaseKey() : null;
    if (!url || !key) return null;
    if (_authClient && _authClientUrl === url) return _authClient;
    // Pakai ulang client yang sudah dibuat modul sync-patch kalau URL cocok,
    // supaya tidak ada dua instance GoTrueClient nyala bersamaan untuk
    // storageKey yang sama (Supabase akan warning kalau begitu).
    if (window._syncPatchSupabaseClient && window._syncPatchClientUrl === url) {
        _authClient = window._syncPatchSupabaseClient;
        _authClientUrl = url;
        return _authClient;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    try {
        _authClient = window.supabase.createClient(url, key);
        _authClientUrl = url;
        return _authClient;
    } catch (e) {
        console.error('[auth.js] Gagal membuat Supabase client:', e);
        return null;
    }
}
window.getSupabaseAuthClient = getSupabaseAuthClient;

window._skAuthUser = null;      // {id, email} kalau sedang login
window._skSharedRoles = {};     // { [bookId]: 'admin' | 'editor' | 'viewer' }

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

window.skSignOut = async function() {
    const client = getSupabaseAuthClient();
    if (client) { try { await client.auth.signOut(); } catch (e) { /* abaikan */ } }
    window._skAuthUser = null;
    window._skSharedRoles = {};
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

// ── Panel login sederhana di modal Kelola Buku ──────────────────────────
window.skRenderAuthPanel = function() {
    const el = document.getElementById('skAuthPanelContent');
    if (!el) return;
    if (window._skAuthUser) {
        const bookId = window.currentBookId;
        const role = window.skGetRoleForBook(bookId);
        const roleLine = role ? `<div style="margin-top:4px;">Peran kamu di buku aktif: <b>${role}</b></div>` : '<div style="margin-top:4px; color:var(--ink-faint);">Buku aktif bukan buku bersama.</div>';
        el.innerHTML =
            '<div style="font-size:.75rem;">Login sebagai <b>' + window._skAuthUser.email + '</b>' + roleLine + '</div>' +
            '<button type="button" class="btn btn-secondary" style="margin-top:8px; width:100%;" onclick="window.skSignOut()">Logout Buku Bersama</button>';
    } else {
        el.innerHTML =
            '<form onsubmit="window._skHandleLoginSubmit(event)">' +
                '<input type="email" id="skAuthEmail" class="form-control" placeholder="Email" required autocomplete="username" style="margin-bottom:6px;">' +
                '<input type="password" id="skAuthPassword" class="form-control" placeholder="Password" required autocomplete="current-password" style="margin-bottom:8px;">' +
                '<button type="submit" class="btn btn-primary" style="width:100%;">Login Buku Bersama</button>' +
            '</form>';
    }
};

window._skHandleLoginSubmit = function(ev) {
    ev.preventDefault();
    const email = document.getElementById('skAuthEmail').value.trim();
    const password = document.getElementById('skAuthPassword').value;
    window.skSignIn(email, password);
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
