// ==================== AUTH: CORE (client, session, sign in/out) ====================
// Pecahan dari js/auth.js (dulu 2.513 baris satu file) -- lihat catatan
// pembagian modul di js/auth-roles.js, js/auth-shared-book.js,
// js/auth-members.js, js/auth-ui.js. Semuanya tetap vanilla window.* (tidak
// ada import/export module), urutan <script> di index.html TETAP PENTING:
// auth-core.js harus dimuat SEBELUM 4 file auth-* lainnya karena mereka
// memanggil window.getSupabaseAuthClient()/window.skSignIn/dkk yang
// didefinisikan di sini.
//
// Isi file ini: koneksi Supabase Auth client (getSupabaseAuthClient),
// state user yang sedang login (window._skAuthUser/_skSharedRoles/
// _skAuthMode), skSignIn/skSignOut, cache sesi (skGetSession), dan
// skTouchLastLogin (catat last_login_at, best-effort/non-fatal).

(function() {
'use strict';

if (window.__skAuthCoreJsInitialized) return;
window.__skAuthCoreJsInitialized = true;

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
window._skLastLoginTouched = false;
window.skTouchLastLogin = async function() {
    if (window._skLastLoginTouched) return;
    if (!window._skAuthUser) return;
    const client = window.getSupabaseAuthClient();
    if (!client) return;
    window._skLastLoginTouched = true; // set duluan -- gagal pun tidak retry terus tiap refresh
    try {
        const res = await client.rpc('sk_touch_last_login');
        if (res.error) throw res.error;
    } catch (e) {
        // Non-fatal: kalau RPC belum di-setup (sql/last_login_tracking.sql
        // belum dijalankan) atau lagi offline, cukup log -- jangan ganggu
        // alur login/refresh akses yang jauh lebih penting.
        window.skWarn('[auth.js] Gagal mencatat last_login_at (cek sql/last_login_tracking.sql sudah dijalankan?):', e);
    }
};

window.skSignIn = async function(email, password) {
    const client = window.getSupabaseAuthClient();
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
    window._skInvalidateSessionCache(); // [OPT] jangan pakai cache session lama dari sebelum login ini
    // [FIX SESI EXPIRED SENYAP] Tandai bahwa device ini PERNAH login akses
    // Buku Bersama, supaya kalau nanti skRefreshSharedAccess() dapat session
    // null (refresh token sudah tidak valid), kita bisa bedakan "memang
    // belum pernah login" (wajar, tidak perlu toast) vs "sudah login tapi
    // sesinya diam-diam mati" (perlu toast eksplisit, lihat di bawah).
    if (window._skAuthUser) localStorage.setItem('sk_had_shared_auth', '1');
    await window.skRefreshSharedAccess();
    window.skTouchLastLogin();
    window.showToast && window.showToast('Berhasil login: ' + (window._skAuthUser ? window._skAuthUser.email : ''));
    if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
    return true;
};

window.skSignOut = async function() {
    const client = window.getSupabaseAuthClient();
    if (client) { try { await client.auth.signOut(); } catch (e) { /* abaikan */ } }
    window._skInvalidateSessionCache(); // [OPT] session sudah tidak valid, buang cache-nya
    window._skAuthUser = null;
    window._skSharedRoles = {};
    // Logout ini disengaja, bukan sesi mati sendiri -- bersihkan marker
    // supaya kunjungan berikutnya (belum login lagi) tidak dianggap "sesi
    // expired diam-diam" dan tidak memunculkan toast peringatan yang salah.
    localStorage.removeItem('sk_had_shared_auth');
    window._skAuthMode = 'login';
    window._skLastLoginTouched = false; // supaya login berikutnya (tab yg sama) tercatat lagi
    if (window.books) {
        // Kalau sedang aktif di buku shared yang baru saja hilang aksesnya,
        // pindah ke buku pribadi pertama supaya app tidak nyangkut.
        const stillHasCurrent = window.books.find(function(b) { return b.id === window.currentBookId && !b._isShared; });
        window.books = window.books.filter(function(b) { return !b._isShared; });
        if (!stillHasCurrent && window.books.length > 0 && typeof window.switchBook === 'function') {
            window.switchBook(window.books[0].id);
        } else if (window.books.length === 0 && typeof window._promptCreateFirstBookIfEmpty === 'function') {
            window._promptCreateFirstBookIfEmpty();
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

// [OPT PERFORMA BUKU BERSAMA] Sebelumnya setiap request cloud ke buku
// bersama (report.js, budget.js, forecast.js -- semua lewat
// fetchMonthTransactionsFromCloud) memanggil client.auth.getSession() dari
// NOL, tanpa cache. Biasanya cepat (baca localStorage), TAPI kalau access
// token sudah dekat/lewat masa berlaku, Supabase JS diam-diam melakukan
// refresh token ke server (POST /auth/v1/token) dulu sebelum getSession()
// resolve -- nambah satu round-trip PENUH sebelum request datanya sendiri
// sempat mulai. Ini yang bikin buku bersama terasa lebih lambat dari buku
// pribadi (yang tidak pernah butuh langkah ini sama sekali). forecast.js
// juga bisa memanggil ini sampai 8x beruntun (satu per bulan) dalam satu
// render, jadi tanpa cache, delay itu bisa terkumpul jadi cukup terasa.
//
// Cache session di memori (BUKAN localStorage -- session-nya sendiri sudah
// dikelola/di-refresh oleh Supabase client, ini cuma mempercepat baca
// ULANG dalam jendela pendek) dengan TTL singkat (10 detik) -- cukup untuk
// meredam banyak pemanggil yang saling tumpang tindih dalam satu siklus
// render/fetch, tapi cukup pendek supaya token yang baru saja di-refresh
// (mis. oleh panggilan lain) tetap segera terpakai, bukan basi berlama-lama.
// Kalau ada request in-flight, pemanggil berikutnya menumpang promise yang
// SAMA (dedupe) alih-alih memicu getSession() paralel yang berlipat.
window._skSessionCache = null; // { session, ts }
window._skSessionInFlight = null;
const SK_SESSION_CACHE_TTL = 10000;

window._skInvalidateSessionCache = function() {
    window._skSessionCache = null;
    window._skSessionInFlight = null;
};

window.skGetSession = async function() {
    const client = window.getSupabaseAuthClient();
    if (!client) return null;

    const cached = window._skSessionCache;
    if (cached && (Date.now() - cached.ts) < SK_SESSION_CACHE_TTL) {
        return cached.session;
    }
    // [DEDUPE] Beberapa pemanggil (mis. report + budget + forecast) bisa
    // memicu skGetSession() nyaris bersamaan saat cache kosong/kedaluwarsa --
    // tanpa ini, masing-masing akan mulai request getSession()-nya sendiri
    // secara paralel (dan kalau perlu refresh token, jadi beberapa refresh
    // token paralel sekaligus, yang justru tidak perlu dan boros).
    if (window._skSessionInFlight) return window._skSessionInFlight;

    window._skSessionInFlight = (async () => {
        try {
            const { data } = await client.auth.getSession();
            const session = data ? data.session : null;
            window._skSessionCache = { session, ts: Date.now() };
            return session;
        } catch (e) {
            console.error('[auth.js] Gagal ambil session:', e);
            // Jangan simpan hasil gagal ke cache -- biar percobaan
            // berikutnya (bukan dalam 10 detik yang sama) langsung coba lagi,
            // bukan ikut menahan status gagal itu.
            return null;
        } finally {
            window._skSessionInFlight = null;
        }
    })();
    return window._skSessionInFlight;
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

})();
