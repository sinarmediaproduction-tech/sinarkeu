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

// ── Panel login sederhana di modal Kelola Buku ──────────────────────────
window.skRenderAuthPanel = function() {
    const el = document.getElementById('skAuthPanelContent');
    if (!el) return;
    if (window._skAuthUser) {
        const bookId = window.currentBookId;
        const role = window.skGetRoleForBook(bookId);
        const roleLine = role ? `<div style="margin-top:4px;">Peran kamu di buku aktif: <b>${role}</b></div>` : '<div style="margin-top:4px; color:var(--ink-faint);">Buku aktif bukan buku bersama.</div>';
        const memberPanel = (role === 'admin') ?
            '<div id="skMemberPanelWrap" style="margin-top:12px; border-top:1px dashed #D7DBE3; padding-top:12px;">' +
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
