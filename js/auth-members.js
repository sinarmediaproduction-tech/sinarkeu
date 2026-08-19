// ==================== AUTH: MEMBER MANAGEMENT ====================
// Pecahan dari js/auth.js -- lihat catatan pembagian modul di
// js/auth-core.js. Harus dimuat SETELAH auth-core.js, auth-roles.js &
// auth-shared-book.js.
//
// Isi file ini: bootstrap admin pertama buku shared (skBootstrapFirstAdmin),
// cari calon anggota (skFindUserByEmail/skListAllProfiles), undang/kelola
// anggota (skInviteMember/skInviteMemberByUserId/skAdminCreateMemberAccount/
// skUpdateMemberRole/skRemoveMember/skListBookMembers), render panel
// anggota (skRenderMemberList/skBuildMemberManagementHtml), dan halaman
// "Manajemen User" (openUserManager/skRenderUserManagerPage).

(function() {
'use strict';

if (window.__skAuthMembersJsInitialized) return;
window.__skAuthMembersJsInitialized = true;

window.skBootstrapFirstAdmin = async function(email, password, bookId) {
    const client = window.getSupabaseAuthClient();
    if (!client) {
        return { ok: false, code: 'NO_CLIENT', message: 'Supabase belum tersambung.' };
    }
    let signUpData;
    try {
        const { data, error } = await client.auth.signUp({ email: email, password: password });
        if (error) throw error;
        signUpData = data;
    } catch (e) {
        console.error('[auth.js] skBootstrapFirstAdmin: signUp gagal:', e);
        return { ok: false, code: 'SIGNUP_FAILED', message: e && e.message ? e.message : 'Gagal membuat akun.' };
    }
    // Kalau project ini mewajibkan konfirmasi email, signUp() TIDAK langsung
    // memberi sesi aktif (data.session kosong) -- insert sk_books/book_members
    // di bawah pasti ditolak RLS (auth.uid() masih null/anon) kalau dipaksa
    // jalan. Berhenti di sini dengan pesan jelas -- akun Auth-nya sendiri
    // SUDAH terbuat, tinggal dikonfirmasi lalu login manual + "Jadikan
    // Bersama" dari panel "Kelola Buku" (bukan diulang dari sini).
    if (!signUpData || !signUpData.session) {
        return {
            ok: false,
            code: 'EMAIL_CONFIRM_REQUIRED',
            message: 'Akun admin dibuat, tapi project Supabase ini mewajibkan konfirmasi email. Cek inbox untuk konfirmasi, lalu login lewat gerbang & jadikan buku ini "Bersama" manual dari panel Kelola Buku.'
        };
    }
    window._skAuthUser = signUpData.user ? { id: signUpData.user.id, email: signUpData.user.email } : null;
    if (!window._skAuthUser) {
        return { ok: false, code: 'NO_USER_ID', message: 'Akun dibuat tapi user id tidak didapat dari respons Supabase.' };
    }
    try {
        await window.skMakeBookShared(bookId, true);
    } catch (e) {
        console.error('[auth.js] skBootstrapFirstAdmin: gagal menjadikan buku bersama:', e);
        return { ok: false, code: 'MAKE_SHARED_FAILED', message: e && e.message ? e.message : 'Gagal menjadikan buku ini bersama.' };
    }
    // skMakeBookShared menampilkan toast sukses/gagalnya sendiri. Anggap
    // sukses kalau setelahnya buku sudah tercatat sebagai admin milik kita.
    if (window.skGetRoleForBook(bookId) !== 'admin') {
        return { ok: false, code: 'MAKE_SHARED_FAILED', message: 'Akun dibuat, tapi gagal ditautkan sebagai admin buku ini (cek console / sudah jalankan sql/bootstrap_shared_book.sql?).' };
    }
    await window.skRefreshSharedAccess();
    return { ok: true };
};

// ── Kelola Anggota (undang / hapus / lihat daftar) ──────────────────────
// Cari calon anggota berdasarkan email lewat public.profiles (lihat
// sql/profiles_and_invite.sql). Cocok case-insensitive (ilike exact, tanpa
// wildcard tambahan dari kita -- kalau user isi email polos ya match persis).
window.skFindUserByEmail = async function(email) {
    const client = window.getSupabaseAuthClient();
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

// [PICKER ANGGOTA] Semua pengguna yang pernah daftar (public.profiles --
// SELECT-nya sengaja terbuka untuk semua user login, lihat
// sql/profiles_and_invite.sql). Dipakai supaya admin bisa langsung PILIH
// calon anggota dari daftar (mis. yang sudah jadi anggota buku bersama lain
// yang sama-sama diadminkan), tanpa perlu ingat & ketik ulang emailnya.
window.skListAllProfiles = async function() {
    const client = window.getSupabaseAuthClient();
    if (!client) return [];
    try {
        const res = await client.from('profiles').select('id, email').order('email', { ascending: true });
        if (res.error) throw res.error;
        return res.data || [];
    } catch (e) {
        console.error('[auth.js] Gagal ambil daftar semua pengguna terdaftar:', e);
        return [];
    }
};

// Sama seperti window.skInviteMember, tapi menerima user_id langsung
// (dari picker daftar pengguna) -- tidak perlu skFindUserByEmail lagi
// karena profile-nya sudah di tangan si pemanggil.
window.skInviteMemberByUserId = async function(bookId, userId, email, role) {
    const client = window.getSupabaseAuthClient();
    if (!client) return false;
    if (window.skGetRoleForBook(bookId) !== 'admin') {
        window.showToast && window.showToast('Hanya admin yang bisa mengundang anggota.', 'error');
        return false;
    }
    if (window._skAuthUser && userId === window._skAuthUser.id) {
        window.showToast && window.showToast('Itu akun kamu sendiri.', 'error');
        return false;
    }
    try {
        const res = await client.from('book_members').upsert(
            { book_id: bookId, user_id: userId, role: role },
            { onConflict: 'book_id,user_id' }
        );
        if (res.error) throw res.error;
        window.showToast && window.showToast('Berhasil menambahkan ' + email + ' sebagai ' + role + '.');
        window._skRefreshAllMemberPanels();
        return true;
    } catch (e) {
        console.error('[auth.js] Gagal tambah anggota dari daftar:', e);
        window.showToast && window.showToast('Gagal menambahkan anggota: ' + e.message, 'error');
        return false;
    }
};

// State picker per prefix ('sk'/'um') -- simpan bookId & daftar kandidat
// (semua profil dikurangi yang sudah jadi anggota & diri sendiri) supaya
// filter pencarian tidak perlu fetch ulang ke Supabase tiap ketik.
window._umInviteState = window._umInviteState || {};

window.skRenderInviteMemberPicker = async function(bookId, prefix) {
    prefix = prefix || 'sk';
    const listEl = document.getElementById(prefix + 'InvitePickerList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="um-member-empty">Memuat daftar pengguna terdaftar...</div>';

    const results = await Promise.all([
        window.skListAllProfiles(),
        window.skListBookMembers(bookId)
    ]);
    const allProfiles = results[0];
    const members = results[1];
    const memberIds = {};
    members.forEach(function(m) { memberIds[m.user_id] = true; });
    const myId = window._skAuthUser ? window._skAuthUser.id : null;
    const candidates = allProfiles.filter(function(p) {
        return !memberIds[p.id] && p.id !== myId;
    });

    window._umInviteState[prefix] = { bookId: bookId, candidates: candidates };
    window._umRenderInviteCandidateRows(prefix, candidates);
};

window._umRenderInviteCandidateRows = function(prefix, candidates) {
    const listEl = document.getElementById(prefix + 'InvitePickerList');
    if (!listEl) return;
    const state = window._umInviteState[prefix];
    const bookId = state ? state.bookId : null;
    const esc = window.escapeHtml;
    if (candidates.length === 0) {
        listEl.innerHTML = '<div class="um-member-empty">Tidak ada pengguna terdaftar lain yang cocok -- semua sudah jadi anggota buku ini, atau belum ada yang cocok dicari.</div>';
        return;
    }
    listEl.innerHTML = candidates.map(function(p) {
        const initial = (p.email || '?').charAt(0).toUpperCase();
        return (
            '<div class="um-invite-candidate">' +
                '<div class="um-member-avatar">' + esc(initial) + '</div>' +
                '<div class="um-member-info"><div class="um-member-email">' + esc(p.email) + '</div></div>' +
                '<select class="form-control um-invite-candidate-role">' +
                    '<option value="viewer">Viewer</option>' +
                    '<option value="editor">Editor</option>' +
                    '<option value="admin">Admin</option>' +
                '</select>' +
                '<button type="button" class="btn-mini" onclick="window._umAddInviteCandidate(this,\'' + esc(bookId) + '\',\'' + esc(p.id) + '\',\'' + esc(p.email) + '\',\'' + prefix + '\')">+ Tambah</button>' +
            '</div>'
        );
    }).join('');
};

window._umFilterInviteCandidates = function(inputEl, prefix) {
    const state = window._umInviteState[prefix];
    if (!state) return;
    const q = inputEl.value.trim().toLowerCase();
    const filtered = q ?
        state.candidates.filter(function(p) { return (p.email || '').toLowerCase().indexOf(q) !== -1; }) :
        state.candidates;
    window._umRenderInviteCandidateRows(prefix, filtered);
};

window._umAddInviteCandidate = function(btnEl, bookId, userId, email, prefix) {
    const row = btnEl.closest('.um-invite-candidate');
    const roleSel = row ? row.querySelector('.um-invite-candidate-role') : null;
    const role = roleSel ? roleSel.value : 'viewer';
    btnEl.disabled = true;
    btnEl.textContent = '…';
    window.skInviteMemberByUserId(bookId, userId, email, role).then(function(ok) {
        if (!ok) { btnEl.disabled = false; btnEl.textContent = '+ Tambah'; }
        // Kalau berhasil, window._skRefreshAllMemberPanels (dipanggil di
        // dalam skInviteMemberByUserId) sudah membangun ulang seluruh panel
        // ini dari nol -- termasuk picker-nya -- jadi tidak perlu apa-apa
        // lagi di sini.
    });
};

window._umToggleManualInvite = function(btnEl, prefix) {
    const wrap = document.getElementById(prefix + 'ManualInviteWrap');
    if (!wrap) return;
    const showing = wrap.style.display !== 'none';
    wrap.style.display = showing ? 'none' : '';
    btnEl.textContent = showing ?
        '+ Undang lewat email manual (kalau tidak muncul di daftar)' :
        '– Sembunyikan form email manual';
};

// Dropdown peran di kartu anggota (skRenderMemberList) -- ganti pilihan
// langsung memanggil skUpdateMemberRole, tidak perlu tombol "Simpan"
// terpisah. Dikunci sementara (disabled) selama proses supaya tidak
// terkirim dobel kalau user klak-klik cepat.
window._umHandleRoleSelectChange = function(selectEl, bookId, userId) {
    const newRole = selectEl.value;
    selectEl.disabled = true;
    window.skUpdateMemberRole(bookId, userId, newRole).then(function(ok) {
        // Kalau berhasil, _skRefreshAllMemberPanels di dalam
        // skUpdateMemberRole sudah membangun ulang seluruh panel ini
        // (termasuk <select> ini sendiri) -- tidak perlu apa-apa lagi.
        // Kalau gagal, aktifkan lagi supaya bisa dicoba ulang.
        if (!ok) selectEl.disabled = false;
    });
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
    const client = window.getSupabaseAuthClient();
    if (!client) return [];
    try {
        const res = await client.from('book_members').select('user_id, role').eq('book_id', bookId);
        if (res.error) throw res.error;
        const rows = res.data || [];
        if (rows.length === 0) return [];
        const ids = rows.map(function(r) { return r.user_id; });
        // [LOG LOGIN ANGGOTA] last_login_at ikut ditarik dari profiles (lihat
        // sql/last_login_tracking.sql) supaya panel Kelola Anggota bisa
        // menampilkan kapan terakhir tiap anggota (editor/viewer/admin lain)
        // login ke aplikasi.
        const profRes = await client.from('profiles').select('id, email, last_login_at').in('id', ids);
        const emailById = {};
        const lastLoginById = {};
        (profRes.data || []).forEach(function(p) { emailById[p.id] = p.email; lastLoginById[p.id] = p.last_login_at || null; });
        return rows.map(function(r) {
            return {
                user_id: r.user_id,
                role: r.role,
                email: emailById[r.user_id] || '(email tidak diketahui)',
                last_login_at: Object.prototype.hasOwnProperty.call(lastLoginById, r.user_id) ? lastLoginById[r.user_id] : null
            };
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
    const client = window.getSupabaseAuthClient();
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
    const client = window.getSupabaseAuthClient();
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
            window.skWarn('[auth.js] Gagal memulihkan sesi admin setelah buat akun anggota:', e);
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

// Ubah peran anggota yang SUDAH ada di buku (mis. editor -> viewer) --
// beda dengan skInviteMember/skInviteMemberByUserId (yang MENAMBAHKAN
// anggota baru). RLS book_members_update_by_admin (lihat
// sql/shared_books_roles.sql) sudah menolak ini di database kalau bukan
// admin -- cek role di sini cuma supaya pesan errornya jelas.
window.skUpdateMemberRole = async function(bookId, userId, newRole) {
    const client = window.getSupabaseAuthClient();
    if (!client) return false;
    if (window.skGetRoleForBook(bookId) !== 'admin') {
        window.showToast && window.showToast('Hanya admin yang bisa mengubah peran anggota.', 'error');
        return false;
    }
    // Sengaja tidak boleh ubah peran sendiri lewat sini -- sama seperti
    // skRemoveMember, supaya admin tidak tidak-sengaja menurunkan/mengunci
    // dirinya sendiri dari buku yang sedang dikelolanya.
    if (window._skAuthUser && userId === window._skAuthUser.id) {
        window.showToast && window.showToast('Tidak bisa mengubah peran sendiri dari sini.', 'error');
        return false;
    }
    try {
        const res = await client.from('book_members').update({ role: newRole }).eq('book_id', bookId).eq('user_id', userId);
        if (res.error) throw res.error;
        window.showToast && window.showToast('Peran anggota diubah jadi ' + newRole + '.');
        window._skRefreshAllMemberPanels();
        return true;
    } catch (e) {
        console.error('[auth.js] Gagal ubah peran anggota:', e);
        window.showToast && window.showToast('Gagal mengubah peran: ' + e.message, 'error');
        return false;
    }
};

window.skRemoveMember = async function(bookId, userId) {
    const client = window.getSupabaseAuthClient();
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
// [LOG LOGIN ANGGOTA] Format public.profiles.last_login_at (ISO string dari
// Supabase) jadi teks relatif ringkas ala "5 menit lalu" / "3 hari lalu",
// jatuh ke tanggal+jam lengkap kalau sudah lebih dari seminggu supaya tidak
// berubah-ubah tanpa makna ("2 minggu lalu" vs "3 minggu lalu" kurang
// berguna dibanding tanggal pastinya). null/tidak valid -> "Belum pernah
// login" (anggota dibuatkan akun via skAdminCreateMemberAccount tapi belum
// pernah login sendiri, atau baris ini terisi sebelum migrasi
// sql/last_login_tracking.sql dijalankan).
window._skFormatLastLogin = function(iso) {
    if (!iso) return 'Belum pernah login';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Belum pernah login';
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Baru saja';
    if (diffMin < 60) return diffMin + ' menit lalu';
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return diffHour + ' jam lalu';
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return diffDay + ' hari lalu';
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

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
        // [UBAH PERAN] Anggota lain (bukan diri sendiri) bisa langsung diubah
        // perannya lewat dropdown kecil -- ganti pilihan langsung tersimpan
        // (lihat window._umHandleRoleSelectChange), tidak perlu tombol
        // "Simpan" terpisah. Diri sendiri tetap badge statis (tidak bisa
        // diubah dari sini), sama seperti tombol Hapus yang juga disembunyikan
        // untuk diri sendiri -- lihat skUpdateMemberRole untuk alasannya.
        const roleControl = isMe ?
            '<span class="um-role-badge um-role-badge--' + roleClass + '">' + esc(m.role) + '</span>' :
            '<select class="form-control um-role-select" onchange="window._umHandleRoleSelectChange(this,\'' + bookId + '\',\'' + m.user_id + '\')">' +
                '<option value="viewer"' + (m.role === 'viewer' ? ' selected' : '') + '>Viewer</option>' +
                '<option value="editor"' + (m.role === 'editor' ? ' selected' : '') + '>Editor</option>' +
                '<option value="admin"' + (m.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
            '</select>';
        const removeBtn = isMe ? '' :
            '<button type="button" class="btn-mini btn-mini-danger" onclick="window.skRemoveMember(\'' + bookId + '\',\'' + m.user_id + '\')">Hapus</button>';
        // [LOG LOGIN ANGGOTA] Ditampilkan untuk SEMUA anggota termasuk diri
        // sendiri -- admin yang mengelola juga perlu lihat kapan dirinya
        // sendiri terakhir tercatat login, bukan cuma anggota lain.
        const lastLoginText = window._skFormatLastLogin(m.last_login_at);
        return (
            '<div class="um-member-card">' +
                '<div class="um-member-avatar role-' + roleClass + '">' + esc(initial) + '</div>' +
                '<div class="um-member-info">' +
                    '<div class="um-member-email">' + esc(m.email) + '</div>' +
                    '<div class="um-member-meta">' +
                        roleControl +
                        (isMe ? '<span class="um-member-you">kamu</span>' : '') +
                    '</div>' +
                    '<div class="um-member-lastlogin">Terakhir login: ' + esc(lastLoginText) + '</div>' +
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
// [OPTIMASI TAMPILAN] Status buka/tutup panel "Kelola Anggota" per prefix
// ('sk' = modal Kelola Buku Kas, 'um' = halaman Manajemen User). Sebelumnya
// daftar anggota + picker undang (2 query Supabase: skListBookMembers +
// skListAllProfiles) langsung di-fetch & dirender SETIAP kali modal dibuka
// atau pindah buku, walau usernya belum tentu mau lihat/ubah anggota --
// bikin modal berat & delay tiap dibuka. Sekarang daftarnya disembunyikan
// di balik tombol "Lihat & Kelola Anggota"; query baru jalan begitu tombol
// diklik (lazy-load). Status expanded disimpan supaya tetap terbuka kalau
// panel dirender ulang setelah ada perubahan anggota (lihat
// _skRefreshAllMemberPanels) -- pengalaman user tidak "ketutup sendiri".
window._umPanelExpanded = window._umPanelExpanded || {};

// [PICKER ANGGOTA] Tab aktif di dalam panel "Kelola Anggota" per prefix --
// 'invite' (default, pilih dari daftar pengguna terdaftar / undang lewat
// email) atau 'create' (buatkan akun baru). Disimpan supaya tetap konsisten
// kalau panel dirender ulang lewat _skRefreshAllMemberPanels.
window._umInviteTabActive = window._umInviteTabActive || {};

// Lazy-load daftar picker (skRenderInviteMemberPicker) HANYA kalau panel
// "Kelola Anggota" sedang terbuka DAN tab yang aktif memang 'invite' --
// dipanggil dari beberapa titik refresh (lihat _umToggleMemberPanel,
// skRenderAuthPanel, skRenderUserManagerPage) supaya tidak duplikat logika
// pengecekannya di tiap tempat.
window._umMaybeLoadInvitePicker = function(bookId, prefix) {
    if (!window._umPanelExpanded[prefix]) return;
    const activeTab = window._umInviteTabActive[prefix] || 'invite';
    if (activeTab === 'invite') window.skRenderInviteMemberPicker(bookId, prefix);
};

window.skBuildMemberManagementHtml = function(bookId, prefix) {
    prefix = prefix || 'sk';
    const esc = window.escapeHtml;
    const expanded = !!window._umPanelExpanded[prefix];
    const activeTab = window._umInviteTabActive[prefix] || 'invite';
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
            '<button type="button" class="btn btn-secondary um-member-toggle-btn' + (expanded ? ' is-open' : '') + '" id="' + prefix + 'MemberToggleBtn" onclick="window._umToggleMemberPanel(this,\'' + esc(bookId) + '\',\'' + prefix + '\')">' +
                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
                '<span>' + (expanded ? 'Sembunyikan Daftar Anggota' : 'Lihat &amp; Kelola Anggota') + '</span>' +
            '</button>' +

            '<div id="' + prefix + 'MemberPanelBody" class="um-member-panel-body" style="display:' + (expanded ? '' : 'none') + ';">' +
                '<div id="' + prefix + 'MemberListContent" class="um-member-list">Memuat anggota...</div>' +

                '<div class="um-invite-tabs">' +
                    '<button type="button" class="um-invite-tab' + (activeTab === 'invite' ? ' active' : '') + '" data-um-tab-btn="invite" onclick="window._umSwitchInviteTab(this,\'' + esc(bookId) + '\',\'' + prefix + '\',\'invite\')">Undang Anggota</button>' +
                    '<button type="button" class="um-invite-tab' + (activeTab === 'create' ? ' active' : '') + '" data-um-tab-btn="create" onclick="window._umSwitchInviteTab(this,\'' + esc(bookId) + '\',\'' + prefix + '\',\'create\')">Buatkan Akun Baru</button>' +
                '</div>' +

                // [PICKER ANGGOTA] Tab default -- pilih langsung dari akun yang
                // sudah pernah terdaftar (termasuk yang sudah jadi editor/viewer
                // di buku bersama lain), tanpa perlu ketik ulang email/bikin akun
                // baru. Cari akun spesifik lewat kotak pencarian, atau buka form
                // email manual di bawah kalau memang belum ada di daftar.
                '<div id="' + prefix + 'InviteTabPanel" data-um-tab-panel="invite" style="display:' + (activeTab === 'invite' ? '' : 'none') + ';">' +
                    '<input type="text" id="' + prefix + 'InvitePickerSearch" class="form-control" placeholder="Cari akun terdaftar berdasarkan email..." oninput="window._umFilterInviteCandidates(this,\'' + prefix + '\')" style="margin-bottom:8px;">' +
                    '<div id="' + prefix + 'InvitePickerList" class="um-invite-picker-list"><div class="um-member-empty">Memuat daftar pengguna terdaftar...</div></div>' +
                    '<button type="button" class="um-invite-manual-toggle" id="' + prefix + 'ManualInviteToggleBtn" onclick="window._umToggleManualInvite(this,\'' + prefix + '\')">+ Undang lewat email manual (kalau tidak muncul di daftar)</button>' +
                    '<div id="' + prefix + 'ManualInviteWrap" style="display:none; margin-top:10px;">' +
                        '<form onsubmit="window._skHandleInviteSubmit(event,\'' + esc(bookId) + '\',\'' + prefix + '\')">' +
                            '<input type="email" id="' + prefix + 'InviteEmail" class="form-control" placeholder="Email akun yang sudah terdaftar" required autocomplete="off" style="margin-bottom:6px;">' +
                            '<select id="' + prefix + 'InviteRole" class="form-control" style="margin-bottom:8px;">' + roleOptions + '</select>' +
                            '<button type="submit" class="btn btn-primary" style="width:100%;">Tambahkan sebagai Anggota</button>' +
                        '</form>' +
                        '<div class="um-invite-tab-panel-note">Cara ini cuma butuh email -- akun yang bersangkutan HARUS sudah pernah daftar (Supabase Auth) duluan, lewat buku bersama mana pun.</div>' +
                    '</div>' +
                '</div>' +

                '<div id="' + prefix + 'CreateTabPanel" data-um-tab-panel="create" style="display:' + (activeTab === 'create' ? '' : 'none') + ';">' +
                    '<form onsubmit="window._skHandleCreateMemberSubmit(event,\'' + esc(bookId) + '\',\'' + prefix + '\')">' +
                        '<input type="email" id="' + prefix + 'NewMemberEmail" class="form-control" placeholder="Email untuk akun baru anggota" required autocomplete="off" style="margin-bottom:6px;">' +
                        '<input type="password" id="' + prefix + 'NewMemberPassword" class="form-control" placeholder="Password untuk anggota (min. 6 karakter)" required minlength="6" autocomplete="new-password" style="margin-bottom:6px;">' +
                        '<select id="' + prefix + 'NewMemberRole" class="form-control" style="margin-bottom:8px;">' + roleOptions + '</select>' +
                        '<button type="submit" class="btn btn-primary" style="width:100%;">Buatkan Akun Baru untuk Anggota</button>' +
                    '</form>' +
                    '<div class="um-invite-tab-panel-note">Pakai ini HANYA untuk orang yang benar-benar belum pernah punya akun sama sekali. Kalau orangnya sudah jadi anggota buku bersama lain, cari namanya di tab "Undang Anggota" -- jangan buatkan akun baru lagi (akan jadi akun terpisah, bukan akun yang sama).</div>' +
                '</div>' +
            '</div>' +
        '</div>'
    );
};

// Toggle tombol "Lihat & Kelola Anggota" -- baru fetch daftar anggota
// begitu pertama kali dibuka (lazy-load), bukan otomatis tiap panel
// dirender. Menutup panel cukup sembunyikan (tidak fetch ulang atau buang
// data yang sudah dimuat) supaya buka-tutup berikutnya instan.
window._umToggleMemberPanel = function(btnEl, bookId, prefix) {
    const body = document.getElementById(prefix + 'MemberPanelBody');
    if (!body) return;
    const willShow = body.style.display === 'none';
    body.style.display = willShow ? '' : 'none';
    window._umPanelExpanded[prefix] = willShow;
    const label = btnEl.querySelector('span:last-child');
    if (label) label.textContent = willShow ? 'Sembunyikan Daftar Anggota' : 'Lihat & Kelola Anggota';
    btnEl.classList.toggle('is-open', willShow);
    if (willShow) {
        window.skRenderMemberList(bookId, prefix === 'um' ? 'umMemberListContent' : undefined);
        window._umMaybeLoadInvitePicker(bookId, prefix);
    }
};

// Ganti tab aktif di panel "Kelola Anggota" antara 'invite' (picker akun
// terdaftar + email manual) dan 'create' (buatkan akun baru). Query picker
// (skRenderInviteMemberPicker) baru dipanggil begitu tab 'invite' memang
// dibuka -- bukan otomatis tiap panel dirender -- konsisten dengan pola
// lazy-load daftar anggota (lihat _umToggleMemberPanel).
window._umSwitchInviteTab = function(btnEl, bookId, prefix, tab) {
    window._umInviteTabActive[prefix] = tab;
    const panelWrap = document.getElementById(prefix + 'MemberPanelWrap');
    const scope = panelWrap || document;
    scope.querySelectorAll('[data-um-tab-btn]').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-um-tab-btn') === tab);
    });
    const invitePanel = document.getElementById(prefix + 'InviteTabPanel');
    const createPanel = document.getElementById(prefix + 'CreateTabPanel');
    if (invitePanel) invitePanel.style.display = (tab === 'invite') ? '' : 'none';
    if (createPanel) createPanel.style.display = (tab === 'create') ? '' : 'none';
    if (tab === 'invite') window.skRenderInviteMemberPicker(bookId, prefix);
};

// [MENU PER PERAN] Panel "Atur Tampilan Menu per Peran" -- checkbox
// Editor/Viewer untuk tiap item di window.SK_MENU_ITEMS. Dipakai di halaman
// "Manajemen User" (prefix 'um', lihat window.skRenderUserManagerPage),
// bukan di modal "Kelola Buku Kas" -- supaya tidak terlalu ramai di sana.
// Checkbox pakai data-attribute (bukan id per-bookId) supaya aman untuk
// bookId apa pun tanpa perlu sanitasi karakter untuk id DOM.
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
    // [OPTIMASI TAMPILAN] Sama seperti skRenderAuthPanel -- daftar anggota
    // baru dimuat kalau panelnya sudah/sedang dibuka lewat tombol "Lihat &
    // Kelola Anggota", bukan otomatis tiap ganti buku di dropdown.
    if (window._umPanelExpanded['um']) {
        window.skRenderMemberList(selectedBookId, 'umMemberListContent');
        window._umMaybeLoadInvitePicker(selectedBookId, 'um');
    }
};

// ── Batasi UI sesuai peran (bukan cuma diblokir pas diklik) ─────────────
// [DIUBAH] Sebelumnya cuma berlaku untuk buku yang statusnya "Bersama";
// sekarang role GLOBAL (skComputeGlobalRole) berlaku ke SEMUA buku,
// termasuk buku pribadi -- lihat komentar di skComputeGlobalRole untuk
// alasannya. Sebelumnya openSetelanModal & callSupabaseAPI sudah menolak
// aksi non-admin/viewer, tapi tombolnya sendiri masih kelihatan & bisa
// diklik dulu baru ketahuan ditolak. Ini menyembunyikan/menonaktifkan
// tombolnya duluan supaya tidak menyesatkan.

})();
