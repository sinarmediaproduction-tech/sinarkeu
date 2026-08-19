// ==================== AUTH: SHARED BOOK (akses, sharing, konversi enkripsi) ====================
// Pecahan dari js/auth.js -- lihat catatan pembagian modul di
// js/auth-core.js. Harus dimuat SETELAH auth-core.js & auth-roles.js
// (skCheckAnonHardeningForBook & callSupabaseAPI override memakai
// window.skGetRoleForBook/skIsSharedBookId dari auth-roles.js).
//
// Isi file ini: tarik akses buku shared dari server (skRefreshSharedAccess,
// _skRevokeStaleSharedBooks), pengecekan hardening RLS anon-key
// (skCheckAnonHardeningForBook), pembungkus window.callSupabaseAPI supaya
// request ke buku shared pakai JWT user, pembungkus openSetelanModal/
// openDataBackupView (tolak non-admin), migrasi book_id, ubah buku pribadi
// <-> bersama (skMakeBookShared/skMakeBookPrivate) berikut konversi
// data plaintext<->terenkripsi yang menyertainya.

(function() {
'use strict';

if (window.__skAuthSharedBookJsInitialized) return;
window.__skAuthSharedBookJsInitialized = true;

async function _skRevokeStaleSharedBooks(stillAccessibleIds) {
    if (!window.books) return;
    const revoked = window.books.filter(function(b) { return b._isShared && !stillAccessibleIds.has(b.id); });
    if (revoked.length === 0) return;

    const revokedIds = new Set(revoked.map(function(b) { return b.id; }));

    // [FIX BUKU HANTU] Tandai dulu SEBAGAI "pending delete" (mekanisme yang
    // sama dipakai window.deleteBook di js/book.js) SEBELUM buku ini
    // difilter dari window.books. Alasan: pullAllSettings (js/db.js)
    // dipanggil TIDAK LAMA setelah fungsi ini selesai (lihat continueAppInit
    // di js/app.js) dan union-merge 'books' di sana akan MENGHIDUPKAN LAGI
    // ID apa pun yang ada di blob cloud tapi tidak ada di window.books saat
    // itu -- KECUALI id-nya ada di daftar pending-delete. Blob 'books' di
    // cloud milik akun INI (viewer/editor) masih membawa buku ini dari
    // sesi-sesi sebelumnya saat masih jadi anggota (device lain milik akun
    // yang sama belum tentu ikut push penghapusan ini), jadi tanpa marker
    // ini buku yang baru saja dicabut aksesnya di sini akan langsung
    // "hidup lagi" begitu pullAllSettings jalan setelah fungsi ini --
    // itulah "buku hantu" yang selalu muncul lagi tiap login.
    revokedIds.forEach(function(id) { if (window.markBookPendingDelete) window.markBookPendingDelete(id); });

    window.books = window.books.filter(function(b) { return !revokedIds.has(b.id); });
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    revoked.forEach(function(b) {
        localStorage.removeItem('sk_txs_' + b.id);
        localStorage.removeItem('sk_budgets_' + b.id);
        localStorage.removeItem('sk_logs_' + b.id);
        localStorage.removeItem('sk_balance_offset_' + b.id);
        localStorage.removeItem('sk_payment_reminders_' + b.id);
        delete window._lastFullSyncTime[b.id];
        delete window._lastSettingsSyncTime.shared[b.id];
    });
    if (window._saveTxSyncCursor) window._saveTxSyncCursor();
    if (window._saveSettingsSyncCursor) window._saveSettingsSyncCursor();

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
    } else if (window.books.length === 0 && typeof window._promptCreateFirstBookIfEmpty === 'function') {
        window._promptCreateFirstBookIfEmpty();
    }
    if (typeof window.renderBookList === 'function' && document.getElementById('bookManagerModal') && document.getElementById('bookManagerModal').classList.contains('show')) {
        window.renderBookList();
    }
    // Propagasikan penghapusan ini juga ke daftar buku pribadi (setting
    // 'books') supaya device lain milik akun yang sama tidak terus
    // menyimpan buku yang sudah tidak bisa diakses ini di cache-nya.
    //
    // [FIX BUKU HANTU] DI-AWAIT (dulu fire-and-forget) supaya caller
    // (skRefreshSharedAccess) selesai lebih dulu daripada pullAllSettings
    // yang dipanggil sesudahnya di continueAppInit -- kalau tidak, pull bisa
    // saja jalan duluan sebelum push ini kekirim, menarik blob 'books' LAMA
    // dari cloud (yang masih membawa buku ini) dan balik menghidupkannya
    // sebelum marker pending-delete sempat dicek. Marker pending-delete di
    // atas tetap jadi jaring pengaman kedua kalau push ini sendiri gagal
    // (offline/network) -- baru dibersihkan setelah beneran terkonfirmasi
    // sukses, sama seperti pola window.deleteBook.
    if (typeof window.pushSettingBooks === 'function') {
        const pushOk = await window.pushSettingBooks();
        if (pushOk && window.clearBookPendingDelete) revokedIds.forEach(function(id) { window.clearBookPendingDelete(id); });
    }
}

// Tarik sk_books + role milik user yang sedang login, gabungkan ke
// window.books. Idempotent -- aman dipanggil ulang kapan saja (mis. tiap
// buka app kalau sesi Supabase Auth masih tersimpan dari kunjungan lalu).
window.skRefreshSharedAccess = async function() {
    const client = window.getSupabaseAuthClient();
    if (!client) return;
    const session = await window.skGetSession();
    if (!session) {
        window._skAuthUser = null;
        window._skSharedRoles = {};
        // [FIX SESI EXPIRED SENYAP] Sebelumnya baris ini `return` polos --
        // kalau refresh token Supabase Auth sudah benar-benar tidak valid
        // lagi (bukan cuma access token dekat kedaluwarsa yang biasanya
        // auto-refresh), device ini diam-diam kehilangan status "buku ini
        // shared", skIsSharedBookId() mengira semua buku shared itu privat,
        // dan transaksi anggota lain tersaring habis dari filter
        // account_tag -- tanpa notifikasi apa pun, jadi user cuma lihat
        // transaksi "hilang" tanpa tahu sebabnya. Cuma munculkan toast ini
        // kalau device ini SEBELUMNYA memang pernah login Buku Bersama
        // (marker sk_had_shared_auth) -- device yang memang belum pernah
        // login sama sekali tidak perlu diberi tahu apa-apa, itu kondisi
        // normal.
        if (localStorage.getItem('sk_had_shared_auth') === '1') {
            window.showToast && window.showToast(
                'Sesi login Buku Bersama sudah berakhir. Login ulang di Setelan supaya transaksi anggota lain muncul kembali.',
                'warning'
            );
        }
        return;
    }
    window._skAuthUser = { id: session.user.id, email: session.user.email };
    localStorage.setItem('sk_had_shared_auth', '1');
    // Sesi Supabase Auth lama berhasil dipulihkan (mis. buka app lagi
    // setelah sebelumnya login) -- ini juga terhitung "login ke aplikasi"
    // dari sudut pandang fitur log terakhir login, walau tidak lewat
    // skSignIn. Guard di dalam skTouchLastLogin mencegah ini jadi spam
    // tiap skRefreshSharedAccess dipanggil ulang (mis. autosync self-heal).
    window.skTouchLastLogin();


    // [FIX RACE/JARINGAN FLAKY] Sebelumnya: SATU kegagalan jaringan di sini
    // (fetch book_members gagal, mis. wifi sempat putus sebentar) membuat
    // window._skSharedRoles tetap KOSONG untuk SISA SESI -- continueAppInit
    // cuma memanggil skRefreshSharedAccess() SEKALI (try/catch yang cuma
    // console.warn, tidak retry). Efeknya: skIsSharedBookId() salah
    // mengira SEMUA buku bersama "privat" utk sisa sesi, dan callSupabaseAPI
    // (patch di atas) salah pakai anon key terus-menerus utk buku itu --
    // ditolak server (backups) atau gagal koneksi (settings/transactions)
    // berulang kali, padahal jaringan sudah pulih. Retry pendek dengan
    // backoff di sini menutup celah race itu tanpa perlu ubah urutan
    // panggilan di continueAppInit/autosync sama sekali.
    const MEMBER_FETCH_RETRIES = 3;
    let memberRows;
    let lastErr = null;
    for (let attempt = 1; attempt <= MEMBER_FETCH_RETRIES; attempt++) {
        try {
            const res = await client.from('book_members').select('book_id, role').eq('user_id', session.user.id);
            if (res.error) throw res.error;
            memberRows = res.data;
            lastErr = null;
            break;
        } catch (e) {
            lastErr = e;
            window.skWarn(`[auth.js] Gagal ambil book_members (percobaan ${attempt}/${MEMBER_FETCH_RETRIES}):`, e);
            if (attempt < MEMBER_FETCH_RETRIES) {
                await new Promise(function(r) { setTimeout(r, attempt * 1000); }); // 1s, lalu 2s
            }
        }
    }
    if (lastErr) {
        console.error('[auth.js] Gagal ambil book_members setelah beberapa percobaan, akses Buku Bersama TIDAK diperbarui sesi ini:', lastErr);
        window.showToast && window.showToast('Gagal memuat akses Buku Bersama (jaringan bermasalah) -- transaksi/pengaturan buku bersama mungkin gagal sinkron sampai kamu reload/refresh.', 'warning');
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
    await _skRevokeStaleSharedBooks(new Set(bookIds));

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
    // Pemanggil yang sudah tahu konteks buku (khususnya POST settings dan
    // backups) dapat mengirim options.bookId. Jangan bergantung hanya pada
    // inferensi query/body karena request tanpa filter book_id pernah salah
    // jatuh ke anon key saat proses awal aplikasi berlangsung.
    let targetBookId = options && options.bookId ? options.bookId : null;
    if (!targetBookId && queryString && /book_id=eq\.([^&]+)/.test(queryString)) {
        targetBookId = decodeURIComponent(RegExp.$1);
    } else if (!targetBookId && body) {
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
            // [FIX] Sama seperti di js/db.js -- tanpa timeout, fetch bisa
            // menggantung tanpa batas kalau jaringan "hang" (bukan langsung
            // offline), bikin UI macet permanen. Batas 25s konsisten dengan
            // callSupabaseAPI di db.js (dinaikkan dari 15s karena koneksi
            // seluler lambat sering kepotong duluan padahal cuma butuh
            // sedikit waktu lagi) dan pola forex.js/ai.js.
            const buildConfig = () => {
                const c = { method: method, headers: headers, signal: AbortSignal.timeout(25000) };
                if (body) c.body = JSON.stringify(body);
                return c;
            };
            try {
                let res;
                try {
                    res = await fetch(url, buildConfig());
                } catch (e1) {
                    // [RETRY] Sama seperti di js/db.js -- timeout pertama sering
                    // cuma lag sesaat, coba sekali lagi dengan config/signal baru
                    // sebelum dianggap gagal. Hanya retry untuk timeout, error
                    // lain langsung dilempar ke catch luar.
                    const isTimeout1 = e1 && (e1.name === 'TimeoutError' || e1.name === 'AbortError');
                    if (!isTimeout1) throw e1;
                    console.warn(`Supabase API timeout (buku bersama, ${table}), mencoba ulang sekali...`);
                    res = await fetch(url, buildConfig());
                }
                if (!res.ok) {
                    const errText = await res.text();
                    const err = new Error(errText);
                    err.status = res.status;
                    throw err;
                }
                const text = await res.text();
                return text ? JSON.parse(text) : true;
            } catch (e) {
                // [FIX] Sama seperti di js/db.js -- di Chromium AbortSignal.timeout()
                // selalu melempar 'AbortError' ("The user aborted a request."),
                // bukan 'TimeoutError' sesuai spec (bug Chromium #40263649).
                // Jalur ini tidak pernah memanggil AbortController.abort()
                // manual, jadi AbortError di sini pasti berasal dari timeout,
                // bukan pembatalan user.
                const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
                // [FIX LOG LEVEL] Timeout (bahkan setelah retry) sudah tertangani
                // baik (fallback lokal, toast di-throttle) -- log sebagai warn,
                // bukan error, supaya console tidak terlihat seperti error fatal.
                if (isTimeout) {
                    console.warn(`Supabase API timeout (buku bersama, ${table}) setelah retry:`, e);
                } else {
                    console.error(`Supabase API Error (buku bersama, ${table}):`, e);
                }
                // [FIX SPAM TOAST] Jalur non-shared di db.js sudah di-throttle 15
                // detik (window._lastSyncErrorToastAt) supaya gagal beruntun (mis.
                // pullAllBooksFromCloud yang loop banyak buku sekaligus saat app
                // init dengan koneksi lagi bermasalah) tidak membanjiri user dengan
                // toast error berkali-kali. Jalur buku bersama ini sebelumnya TIDAK
                // ikut throttle itu -- pakai variabel throttle yang sama (global)
                // supaya konsisten dengan jalur non-shared.
                if (window.isOnline && window.isOnline() && window.showToast) {
                    const now = Date.now();
                    if (!window._lastSyncErrorToastAt || now - window._lastSyncErrorToastAt > 15000) {
                        window._lastSyncErrorToastAt = now;
                        // [FIX WORDING] Dulu pesannya "...(buku bersama, perlu login): network"
                        // -- kesannya user belum login, padahal titik kode ini CUMA tercapai
                        // kalau sesi login sudah valid (lihat pengecekan `session &&
                        // session.access_token` di atas). Kalau e.status kosong berarti
                        // fetch()-nya sendiri yang gagal (jaringan putus/DNS/dsb), bukan
                        // ditolak server -- sekarang dipisah jadi dua pesan yang beda, dan
                        // label "buku bersama" cuma penanda konteks, bukan bagian diagnosis.
                        const detail = window._supabaseErrDetail(e && e.message);
                        const msg = isTimeout
                            ? `Waktu koneksi ke server habis (timeout) saat sinkron '${table}' (buku bersama). Coba lagi.`
                            : (e && e.status)
                                ? `Gagal sinkron '${table}' (buku bersama, ${e.status})${detail ? ': ' + detail : ''}. Coba login ulang kalau berulang.`
                                : `Gagal sinkron '${table}' (buku bersama): koneksi jaringan bermasalah. Coba lagi.`;
                        window.showToast(msg, 'error');
                    }
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
// [DIUBAH] Sekarang berlaku untuk SEMUA buku (termasuk buku pribadi) --
// lihat skComputeGlobalRole.
const _originalOpenSetelanModal = window.openSetelanModal;
window.openSetelanModal = function(initialTab) {
    if (window.skComputeGlobalRole() !== 'admin') {
        window.showToast && window.showToast('Setelan hanya bisa dibuka oleh admin Buku Bersama. Login dulu di "Kelola Buku" kalau kamu admin.', 'error');
        return;
    }
    return _originalOpenSetelanModal.apply(this, arguments);
};

// ── Patch openDataBackupView: kunci menu 'Cadangan Data' sesuai peran ───
// [FIX BOCOR MENU CADANGAN DATA] Menyembunyikan #navBackupBtn di
// skApplyRoleUI di atas cukup untuk UI normal, tapi tombolnya bukan
// satu-satunya pemicu -- window.openDataBackupView juga dipanggil
// langsung dari openBackupManager()/openSafetySnapshotManager() (js/
// backup.js, js/safety-snapshot.js). Defense-in-depth: tolak juga di sini
// kalau menu_visibility 'backup' untuk peran (global) user saat ini
// dimatikan admin -- sama seperti pola openSetelanModal di atas.
const _originalOpenDataBackupView = window.openDataBackupView;
window.openDataBackupView = function(initialTab) {
    if (!window.skGetMenuVisible(window.currentBookId, 'backup')) {
        window.showToast && window.showToast('Menu Cadangan Data tidak diaktifkan untuk peran kamu di buku ini.', 'error');
        return;
    }
    return _originalOpenDataBackupView.apply(this, arguments);
};

// ── Migrasi ID buku default yang bentrok lintas akun ────────────────────
// [FIX ID COLLISION b_default] 'b_default' adalah ID LITERAL yang dipakai
// SEMUA akun untuk buku pertama mereka ("Buku Umum" -- lihat js/account.js,
// js/app.js, js/config.js: semuanya hardcode string 'b_default', beda dari
// buku lain yang ID-nya di-random pakai timestamp+random). `sk_books.id`
// (fondasi Buku Bersama, sql/shared_books_roles.sql) adalah TEXT PRIMARY KEY
// GLOBAL lintas akun -- satu backend Supabase dipakai banyak akun sekaligus,
// isolasi data personal SELAMA INI cuma lewat account_tag, bukan lewat baris
// sk_books.id yang terpisah per akun.
//
// Akibatnya: begitu SATU akun menjadikan "Buku Umum"-nya (id='b_default')
// sebagai Buku Bersama, sk_book_is_shared('b_default') di server jadi TRUE
// untuk SEMUA akun lain yang buku utamanya masih ID default sama -- padahal
// buku mereka tidak terkait sama sekali. Policy settings_legacy_anon/
// transactions_legacy_anon (sql/harden_shared_book_data_rls.sql) yang
// mengizinkan tulis anon-key HANYA kalau `NOT sk_book_is_shared(book_id)`
// jadi menolak semua tulisan mereka ke buku pribadi itu (error 42501),
// walau mereka tidak pernah ikut buku bersama apa pun.
//
// Fix: kalau buku yang mau dijadikan shared masih pakai ID 'b_default',
// generate ID baru yang unik DULU, migrasikan semua data lokal (localStorage)
// ke ID baru itu, baru lanjut proses share pakai ID baru -- supaya
// 'b_default' tetap "bersih"/tidak pernah masuk sk_books, aman dipakai
// sebagai ID buku pribadi biasa oleh siapa pun.

// [FIX DATA HILANG SETELAH JADI BUKU BERSAMA] _skMigrateBookIdLocal (di
// bawah) HANYA memindahkan cache localStorage -- baris transaksi/settings/
// pengingat yang SUDAH ADA di cloud (tabel transactions/settings/
// payment_reminders) tetap tertulis book_id='b_default' lama, TIDAK ikut
// dipindah. Ini tidak kelihatan masalah di sesi yang sama (cache lokal di
// device ini sudah benar), TAPI begitu ada pull/sync penuh berikutnya
// (forceFullSync/pullAllBooksFromCloud -- dipanggil app.js tiap ~beberapa
// menit & saat online lagi, lihat js/transaction.js), klien query cloud
// pakai ID BARU, dapat 0 baris (karena baris aslinya masih ber-book_id
// LAMA), lalu trimAndSaveLocal() MENIMPA cache lokal jadi kosong --
// persis "buku bersama berhasil dibuat tapi datanya hilang" yang
// dilaporkan user. Fungsi ini menutup celah itu: UPDATE book_id di cloud
// (transactions/settings/payment_reminders -- tabel inti yang datanya
// benar-benar hilang kalau tidak ikut pindah) SEBELUM buku ditandai shared,
// selagi masih bisa ditulis anon key (RLS sk_book_is_shared() masih FALSE
// untuk book_id lama). backups/audit_logs ikut dicoba juga tapi
// best-effort saja (riwayat cadangan lama tetap bisa diakses lewat ID lama
// walau tidak dipindah -- bukan data transaksi yang terlihat user).
//
// Discoped dengan account_tag (AND, bukan OR-null seperti query baca biasa
// -- lihat catatan window.tagOrFilter di js/db.js: operasi tulis massal
// SENGAJA tidak pakai OR-null, supaya tidak menyentuh baris akun lain di
// backend yang sama). Kalau akun ini belum punya account_tag sama sekali,
// filter ke baris yang account_tag-nya NULL saja (bukan menyapu semua
// baris 'b_default' tanpa filter, yang bisa kena data akun lain).
window._skMigrateBookIdCloud = async function(oldId, newId) {
    const tag = window.getAccountTag ? window.getAccountTag() : null;
    const tagFilter = tag ? `&account_tag=eq.${tag}` : `&account_tag=is.null`;
    const query = `?book_id=eq.${oldId}${tagFilter}`;
    const CRITICAL_TABLES = ['transactions', 'settings', 'payment_reminders'];
    const BEST_EFFORT_TABLES = ['backups', 'audit_logs'];
    const migrated = [];
    for (const table of CRITICAL_TABLES) {
        try {
            await window.callSupabaseAPI(table, 'PATCH', { book_id: newId }, query);
            migrated.push(table);
        } catch (e) {
            console.error('[auth.js] Gagal migrasi book_id cloud tabel ' + table + ':', e);
            // Rollback tabel yang sudah sempat berhasil dipindah, supaya
            // tidak ada kondisi setengah-jadi (sebagian data sudah di
            // bawah newId padahal buku belum jadi resmi shared/belum
            // ditandai apa pun) -- best-effort juga, kalau ini pun gagal
            // minimal sudah dicoba & dicatat di console untuk investigasi
            // manual admin.
            for (const doneTable of migrated) {
                try { await window.callSupabaseAPI(doneTable, 'PATCH', { book_id: oldId }, `?book_id=eq.${newId}${tagFilter}`); }
                catch (e2) { console.error('[auth.js] Gagal rollback book_id tabel ' + doneTable + ':', e2); }
            }
            return false;
        }
    }
    for (const table of BEST_EFFORT_TABLES) {
        try { await window.callSupabaseAPI(table, 'PATCH', { book_id: newId }, query); }
        catch (e) { window.skWarn('[auth.js] Gagal migrasi book_id cloud tabel (best-effort) ' + table + ':', e); }
    }
    return true;
};

window._skMigrateBookIdLocal = function(oldId, newId) {
    // Semua prefix localStorage yang menyimpan data PER BUKU (hasil audit
    // `grep -noE "'sk_[a-z_]+_'\s*\+" js/*.js` -- kalau nanti nambah fitur
    // baru yang nyimpan data per-buku ke localStorage, tambahkan prefix-nya
    // di sini juga supaya ikut termigrasi kalau kasus ini terulang).
    const PER_BOOK_PREFIXES = [
        'sk_txs_', 'sk_budgets_', 'sk_default_budget_', 'sk_annual_budget_',
        'sk_logs_', 'sk_balance_offset_', 'sk_income_offset_', 'sk_expense_offset_',
        'sk_payment_reminders_', 'sk_hidden_cards_', 'sk_shopping_list_',
        'sk_shopping_list_income_', 'sk_manual_backups_', 'sk_last_auto_backup_',
        'sk_last_cloud_backup_', 'sk_last_gsheets_backup_', 'sk_fase_kehidupan_',
        'sk_emergency_fund_months_', 'sk_pr_pending_push_', 'sk_pr_pending_delete_',
        'sk_electricity_plan_'
    ];
    PER_BOOK_PREFIXES.forEach(function(prefix) {
        const val = localStorage.getItem(prefix + oldId);
        if (val !== null) {
            localStorage.setItem(prefix + newId, val);
            localStorage.removeItem(prefix + oldId);
        }
    });
    if (window.currentBookId === oldId) {
        window.currentBookId = newId;
        localStorage.setItem('sk_current_book_id', newId);
    }
    // book.id dimutasi lewat referensi array window.books di sini supaya
    // pemanggil (skMakeBookShared) yang masih pegang variabel `book` lokal
    // otomatis ikut lihat ID barunya tanpa perlu assignment terpisah.
    if (Array.isArray(window.books)) {
        const b = window.books.find(function(bk) { return bk.id === oldId; });
        if (b) b.id = newId;
    }
};

// ── Jadikan buku pribadi jadi buku bersama (bootstrap admin pertama) ────
// Syarat: sudah login (skSignIn), dan sudah jalankan
// sql/bootstrap_shared_book.sql (jalur RLS khusus buat baris admin pertama).
// skipConfirm: true kalau dipanggil otomatis dari alur setup awal
// (window.skBootstrapFirstAdmin, js/settings.js doFirstTimeSetup) -- di situ
// user SUDAH secara eksplisit mengisi form "Akun Admin Utama", jadi dialog
// confirm() browser di bawah ini cuma pengulangan yang mengganggu. Tombol
// "Jadikan Bersama" manual (js/book.js) TIDAK mengirim param ini -- tetap
// pakai confirm() seperti biasa.
window.skMakeBookShared = async function(bookId, skipConfirm) {
    const client = window.getSupabaseAuthClient();
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
    if (!skipConfirm) {
        const ok = confirm(
            'Jadikan "' + book.name + '" sebagai buku bersama?\n\n' +
            'Setelah ini: buku hanya bisa diakses lewat login (bukan anon key lagi), ' +
            'dan kamu jadi admin pertamanya. Aksi ini tidak bisa dibatalkan sendiri dari UI.'
        );
        if (!ok) return;
    }
    // [FIX ID COLLISION b_default] Lihat catatan lengkap di
    // window._skMigrateBookIdLocal di atas. Migrasi DULU sebelum insert ke
    // sk_books, supaya baris shared yang ter-insert sudah pakai ID unik.
    if (book.id === 'b_default') {
        if (!window.isOnline || !window.isOnline()) {
            window.showToast && window.showToast('Perlu online untuk menjadikan "Buku Umum" sebagai buku bersama (data lama harus dipindah ID dulu di cloud).', 'error');
            return;
        }
        const newId = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        // [FIX DATA HILANG] Migrasi cloud DULU, sebelum cache lokal & sebelum
        // buku resmi ditandai shared -- lihat catatan lengkap di
        // window._skMigrateBookIdCloud. Kalau ini gagal, batalkan seluruhnya
        // (jangan lanjut ke migrasi lokal/insert sk_books) supaya tidak ada
        // kondisi ganjil: local sudah pindah ID tapi data cloud masih di ID
        // lama (atau sebaliknya).
        const cloudMigrationOk = await window._skMigrateBookIdCloud('b_default', newId);
        if (!cloudMigrationOk) {
            window.showToast && window.showToast('Gagal memindahkan data lama ke ID baru di cloud. Buku belum dijadikan bersama -- coba lagi.', 'error');
            return;
        }
        window._skMigrateBookIdLocal('b_default', newId);
        // [FIX BUKU HANTU b_default #2] Push best-effort di bawah TIDAK
        // dijamin sukses (bisa gagal/offline sesaat) -- kalau gagal, snapshot
        // cloud setting 'books' masih membawa baris lama 'b_default', dan
        // pullAllSettings() (js/db.js, union-merge 'books') akan
        // menghidupkannya lagi sebagai buku personal baru yang KOSONG (data
        // aslinya sudah ikut pindah ke newId lewat _skMigrateBookIdLocal di
        // atas) begitu user login lagi -- persis "buku hantu duplikat" yang
        // dilaporkan user. Reuse mekanisme pendingDeletes yang sudah ada
        // untuk fitur hapus buku (window.markBookPendingDelete) -- cocok
        // dipakai di sini juga: union-merge pullAllSettings sudah menolak
        // menghidupkan id yang ada di set ini (lihat pendingDeletes.has(cb.id)
        // di db.js), dan window.flushPendingBookDeletesOnStart (dipanggil
        // app.js saat start & saat online lagi) otomatis push ulang &
        // membersihkan marker ini begitu cloud terkonfirmasi sudah lupa
        // 'b_default' -- jadi aman dari race/offline yang tidak terduga,
        // tanpa perlu mekanisme retry baru.
        if (window.markBookPendingDelete) window.markBookPendingDelete('b_default');
        // book.id sudah ikut termutasi lewat referensi array di
        // _skMigrateBookIdLocal, jadi variabel `book` di sini otomatis
        // pegang ID baru untuk sisa fungsi ini (insert sk_books/book_members
        // di bawah, dst).
        //
        // [FIX BUKU HANTU DUPLIKAT] Selain localStorage 'sk_books' (yang
        // baru saja dimigrasikan _skMigrateBookIdLocal), ada SALINAN LAIN
        // daftar buku ini di cloud -- settings key='books' (lihat
        // window.pushSettingBooks/pullAllSettings di js/db.js), dipakai
        // union-merge lintas device. Kalau salinan cloud itu TIDAK ikut
        // di-push sekarang, dia masih membawa ID LAMA 'b_default'. Pull
        // berikutnya (mis. setelah logout+login ulang di gerbang Buku
        // Bersama) akan melihat 'b_default' "cuma ada di cloud" lalu
        // MENGHIDUPKANNYA LAGI sebagai entri BARU yang KOSONG (cache
        // transaksinya sendiri sudah pindah ke ID baru) -- muncul sebagai
        // dua "Buku Umum" duplikat: satu kosong, satu isi datanya. Push
        // di sini (best-effort, sebelum ada kesempatan pull membangkitkan
        // ID lama itu lagi) supaya cloud langsung ikut lupa 'b_default'.
        if (window.isOnline && window.isOnline() && typeof window.pushSettingBooks === 'function') {
            try { await window.pushSettingBooks(); } catch (e) { window.skWarn('[auth.js] Gagal push daftar buku setelah migrasi ID b_default:', e); }
        }
    }
// ── Konversi data lama (terenkripsi) ke plaintext saat buku jadi Bersama ──
// [FIX DATA "NOL" UNTUK ANGGOTA LAIN] Sebelum jadi Buku Bersama, transaksi &
// payment reminder buku ini ditulis TERENKRIPSI (kolom enc_payload) --
// kuncinya (_sessionCryptoKey) diturunkan dari password LOKAL akun pemilik,
// tidak pernah dibagi ke anggota lain. Desain buku Bersama SENGAJA menulis
// data BARU sebagai plaintext supaya semua anggota, peran apa pun, bisa
// baca -- TAPI baris
// LAMA yang sudah kadung terenkripsi sebelum buku ini jadi shared tidak
// pernah ikut dikonversi. Akibatnya anggota lain (mis. editor yang baru
// diundang) melihat baris itu ADA (jumlahnya benar) tapi tiap kolom sensitif
// gagal didekripsi (dia tidak punya _sessionCryptoKey pemilik) -- fallback
// decodeCloudTxRow/decodeCloudReminderRow lalu memakai kolom plaintext lama
// yang memang kosong (NULL) untuk baris terenkripsi, sehingga muncul
// sebagai transaksi "isi nol/kosong" alih-alih data sungguhan. Fungsi ini
// dipanggil SEKALI tepat setelah buku resmi ditandai shared (memakai
// _sessionCryptoKey PEMILIK yang masih aktif di sesi ini saat itu juga) --
// menarik baris ber-enc_payload milik buku ini, mendekripsinya, lalu
// menulis ulang sebagai plaintext & mengosongkan enc_payload-nya.
// Best-effort: kalau _sessionCryptoKey tidak ada (seharusnya tidak mungkin
// di titik pemanggilan ini) atau sebagian baris gagal dikonversi, fungsi ini
// tidak membatalkan proses "Jadikan Bersama" yang sudah terlanjur sukses --
// cuma dicatat & dilaporkan lewat toast supaya admin tahu perlu diperiksa.
window._skConvertTableToPlaintext = async function(table, bookId, decrypt, buildPlainRow) {
    const skippedIds = [];
    let convertedCount = 0;
    const MAX_PAGES = 200; // guard: jangan sampai loop tak berhenti kalau ada baris yang terus gagal
    for (let page = 0; page < MAX_PAGES; page++) {
        const excludeFilter = skippedIds.length > 0 ? `&id=not.in.(${skippedIds.join(',')})` : '';
        const query = `?book_id=eq.${bookId}&enc_payload=not.is.null&order=id&limit=200${excludeFilter}`;
        let rows;
        try { rows = await window.callSupabaseAPI(table, 'GET', null, query); }
        catch (e) { console.error('[auth.js] Gagal ambil baris ' + table + ' untuk konversi plaintext:', e); break; }
        if (!rows || !Array.isArray(rows) || rows.length === 0) break;
        for (const row of rows) {
            try {
                const plain = await decrypt(row.enc_payload);
                const d = JSON.parse(plain);
                const plainRow = buildPlainRow(row, d);
                plainRow.enc_payload = null;
                const res = await window.callSupabaseAPI(table, 'PATCH', plainRow, `?id=eq.${row.id}`);
                if (res === null) throw new Error('PATCH ditolak');
                convertedCount++;
            } catch (e) {
                console.error('[auth.js] Gagal konversi ' + table + ' id=' + row.id + ' ke plaintext:', e);
                skippedIds.push(row.id);
            }
        }
        if (rows.length < 200) break;
    }
    return { convertedCount, skippedCount: skippedIds.length };
};

window._skConvertBookDataToPlaintext = async function(bookId) {
    if (!window._sessionCryptoKey) return; // tidak ada kunci utk dekripsi -- seharusnya tidak terjadi di titik panggil ini
    const decrypt = (encPayload) => window.decryptStr(window._sessionCryptoKey, encPayload);
    const txResult = await window._skConvertTableToPlaintext('transactions', bookId, decrypt, (row, d) => ({
        type: d.type, amount: d.amount, category: d.category || (d.type === 'income' ? 'Pemasukan' : ''),
        description: d.description || '', attachment: d.attachment || null
    }));
    const prResult = await window._skConvertTableToPlaintext('payment_reminders', bookId, decrypt, (row, d) => ({
        name: d.name || '', day: d.day, recurrence: d.recurrence, month: d.month || 1, note: d.note || ''
    }));
    const totalSkipped = txResult.skippedCount + prResult.skippedCount;
    if (totalSkipped > 0) {
        window.showToast && window.showToast(
            totalSkipped + ' baris data lama gagal dikonversi ke format buku bersama (cek console) -- anggota lain mungkin melihatnya kosong untuk baris itu.',
            'warning'
        );
    }
    return { convertedCount: txResult.convertedCount + prResult.convertedCount, skippedCount: totalSkipped };
};

// [FIX DATA "KOSONG" SETELAH BUKU BERSAMA -- TABEL SETTINGS] Celah yang sama
// seperti window._skConvertBookDataToPlaintext di atas (transaksi & payment
// reminders), tapi utk tabel `settings` (Anggaran Bulanan, Anggaran Dasar,
// Anggaran Tahunan, visibilitas Card, Daftar Belanja + pemasukannya, Fase
// Kehidupan, target Dana Darurat -- daftar lengkap key-nya lihat
// window.DUPLICATE_BOOK_SETTINGS_MAP di js/book.js, dipakai bersama oleh
// fitur Duplikat Buku).
//
// MASALAH: baris `settings` buku ini yang ditulis SEBELUM jadi Bersama masih
// terenkripsi kunci sesi PEMILIK. Beda dari transactions/payment_reminders
// (yang punya kolom `id` biasa sehingga bisa di-PATCH per baris di atas),
// tabel `settings` TIDAK punya kolom `id` (lihat catatan di
// sql/fix_settings_upsert.sql) -- jadi baris lama tidak bisa ditimpa in-place,
// dan desainnya memang insert-only + pullAllSettings() memilih baris
// TERBARU (updated_at.desc) per (book_id, key).
//
// Kalau baris lama ini dibiarkan begitu saja: anggota lain (kunci beda)
// gagal dekripsi saat pull -> ditandai hasStaleRows -> otomatis memicu
// window.reEncryptAllCloudSettings() (js/db.js), yang push ulang CACHE
// LOKAL device pemicunya sendiri -- untuk anggota BARU, cache itu
// kosong/default (dia memang belum pernah dapat data aslinya). Baris kosong
// itu jadi baris TERBARU, dan pull berikutnya (termasuk oleh PEMILIK
// aslinya) akan melihat setting ini seolah ter-reset kosong.
//
// FIX: begitu buku resmi ditandai shared (SELAGI _sessionCryptoKey & cache
// lokal PEMILIK masih membawa nilai ASLI), push ULANG tiap key setting buku
// ini lewat window.pushSetting biasa -- yang sudah otomatis menulis
// PLAINTEXT kalau skIsSharedBookId(bookId) true (lihat js/db.js). Baris
// plaintext baru ini otomatis jadi "pemenang" updated_at.desc pada pull
// berikutnya, tanpa perlu PATCH/hapus baris lama sama sekali. Sebagai lapis
// kedua, window.reEncryptAllCloudSettings() (js/db.js) juga di-guard untuk
// SELALU skip buku bersama -- lihat catatan di sana.
window._skConvertBookSettingsToPlaintext = async function(bookId) {
    if (!Array.isArray(window.DUPLICATE_BOOK_SETTINGS_MAP)) {
        // js/book.js seharusnya selalu sudah termuat lebih dulu (urutan
        // <script> di index.html) -- guard ini cuma jaga-jaga kalau urutan
        // itu berubah di masa depan.
        window.skWarn('[auth.js] DUPLICATE_BOOK_SETTINGS_MAP belum tersedia, lewati konversi plaintext settings buku bersama.');
        return;
    }
    for (const [prefix, settingKey] of window.DUPLICATE_BOOK_SETTINGS_MAP) {
        const raw = localStorage.getItem(prefix + bookId);
        if (raw === null) continue; // tidak ada data lokal utk key ini di buku ini, tidak perlu dikonversi
        let value;
        try { value = JSON.parse(raw); } catch { value = raw; }
        try { await window.pushSetting(settingKey, value, bookId); }
        catch (e) { window.skWarn(`[auth.js] Gagal push plaintext setting '${settingKey}' saat menjadikan buku bersama:`, e); }
    }
};

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

        // [FIX DATA "NOL" UNTUK ANGGOTA LAIN] Lihat catatan lengkap di
        // window._skConvertBookDataToPlaintext di atas -- baris lama yang
        // masih terenkripsi kunci pemilik harus dikonversi ke plaintext DI
        // SINI (bukan cuma barisan baru), selagi window._sessionCryptoKey
        // pemilik masih aktif di sesi ini & book.id sudah dianggap shared
        // (skIsSharedBookId sudah true lewat _skSharedRoles di atas, jadi
        // callSupabaseAPI otomatis pakai JWT bukan anon key). Best-effort,
        // tidak membatalkan proses share yang sudah terlanjur sukses.
        try { await window._skConvertBookDataToPlaintext(book.id); }
        catch (e) { console.error('[auth.js] Gagal konversi data lama ke plaintext:', e); }

        // [FIX DATA "KOSONG" -- TABEL SETTINGS] Lihat catatan lengkap di
        // window._skConvertBookSettingsToPlaintext di atas -- tanpa ini,
        // Anggaran/Card/Daftar Belanja/dst buku ini berisiko ter-reset
        // kosong begitu anggota lain login & memicu heal-otomatis di
        // pullAllSettings (js/db.js).
        try { await window._skConvertBookSettingsToPlaintext(book.id); }
        catch (e) { console.error('[auth.js] Gagal konversi setting lama ke plaintext:', e); }

        window.showToast && window.showToast('"' + book.name + '" sekarang jadi buku bersama. Kamu adalah admin.', 'success');
        if (typeof window.renderBookList === 'function') window.renderBookList();
        if (typeof window.updateBookSelectDropdown === 'function') window.updateBookSelectDropdown();
        if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
    } catch (e) {
        console.error('[auth.js] Gagal menjadikan buku bersama:', e);
        window.showToast && window.showToast('Gagal: ' + e.message + ' (sudah jalankan sql/bootstrap_shared_book.sql?)', 'error');
    }
};

// ── Konversi data lama (plaintext) balik ke terenkripsi saat buku jadi ──
// ── pribadi lagi (kebalikan dari window._skConvertTableToPlaintext) ─────
// Dipanggil SELAGI buku masih tercatat shared di window._skSharedRoles
// (supaya callSupabaseAPI, lihat patch di js/auth.js atas, masih memilih
// JWT -- bukan anon key -- untuk request ke tabel data buku ini; policy
// tulis shared_write/_update di sql/harden_shared_book_data_rls.sql
// mensyaratkan role admin/editor).
window._skConvertTableToEncrypted = async function(table, bookId, buildEncryptedRow) {
    const skippedIds = [];
    let convertedCount = 0;
    const MAX_PAGES = 200; // guard: jangan sampai loop tak berhenti kalau ada baris yang terus gagal
    for (let page = 0; page < MAX_PAGES; page++) {
        const excludeFilter = skippedIds.length > 0 ? `&id=not.in.(${skippedIds.join(',')})` : '';
        const query = `?book_id=eq.${bookId}&enc_payload=is.null&order=id&limit=200${excludeFilter}`;
        let rows;
        try { rows = await window.callSupabaseAPI(table, 'GET', null, query); }
        catch (e) { console.error('[auth.js] Gagal ambil baris ' + table + ' untuk konversi enkripsi:', e); break; }
        if (!rows || !Array.isArray(rows) || rows.length === 0) break;
        for (const row of rows) {
            try {
                const patchRow = await buildEncryptedRow(row);
                const res = await window.callSupabaseAPI(table, 'PATCH', patchRow, `?id=eq.${row.id}`);
                if (res === null) throw new Error('PATCH ditolak');
                convertedCount++;
            } catch (e) {
                console.error('[auth.js] Gagal konversi ' + table + ' id=' + row.id + ' ke terenkripsi:', e);
                skippedIds.push(row.id);
            }
        }
        if (rows.length < 200) break;
    }
    return { convertedCount, skippedCount: skippedIds.length };
};

// [ENKRIPSI DINONAKTIFKAN] Buku pribadi TIDAK LAGI mengenkripsi datanya --
// semua pemanggil sekarang menulis langsung plaintext. Jadi tidak ada lagi yang perlu
// dienkripsi ulang saat sebuah buku bersama dijadikan pribadi lagi -- data
// yang sudah plaintext (ditulis selama jadi buku bersama) tetap plaintext.
// Fungsi ini sengaja jadi no-op, nama & signature dipertahankan supaya
// window.skMakeBookPrivate di bawah tidak perlu diubah.
window._skConvertBookDataToEncrypted = async function(bookId) {
    return;
};

// ── Settings (Anggaran/Card/dll) balik ke terenkripsi ────────────────────
// BEDA urutan dari window._skConvertBookDataToEncrypted di atas: fungsi ini
// wajib dipanggil SETELAH buku tidak lagi tercatat shared secara lokal
// (window._skSharedRoles sudah tidak punya bookId ini) -- window.pushSetting
// (js/db.js) menentukan enkripsi/account_tag berdasarkan
// window.skIsSharedBookId(bookId) saat itu juga. Baris plaintext lama tetap
// ada di cloud (tabel settings insert-only, lihat catatan lengkap di
// window._skConvertBookSettingsToPlaintext) tapi baris terenkripsi baru ini
// otomatis "menang" lewat updated_at.desc di pullAllSettings().
window._skConvertBookSettingsToEncrypted = async function(bookId) {
    if (!Array.isArray(window.DUPLICATE_BOOK_SETTINGS_MAP)) {
        window.skWarn('[auth.js] DUPLICATE_BOOK_SETTINGS_MAP belum tersedia, lewati konversi enkripsi settings buku pribadi.');
        return;
    }
    for (const [prefix, settingKey] of window.DUPLICATE_BOOK_SETTINGS_MAP) {
        const raw = localStorage.getItem(prefix + bookId);
        if (raw === null) continue;
        let value;
        try { value = JSON.parse(raw); } catch { value = raw; }
        try { await window.pushSetting(settingKey, value, bookId); }
        catch (e) { window.skWarn(`[auth.js] Gagal push ulang terenkripsi setting '${settingKey}' saat menjadikan buku pribadi:`, e); }
    }
};

// ── Jadikan buku bersama kembali jadi buku pribadi ───────────────────────
// Kebalikan dari window.skMakeBookShared di atas. HANYA admin buku ini yang
// boleh memanggilnya (ditegakkan di sini DAN oleh RLS sk_books_delete_admin
// di sql/shared_books_roles.sql). Efeknya:
//   1. Data lama yang sempat tersimpan plaintext (enc_payload NULL, lihat
//      catatan window._skConvertBookDataToPlaintext) dienkripsi ULANG
//      memakai kunci sesi lokal admin yang menjalankan ini.
//   2. Baris sk_books buku ini DIHAPUS -- lewat ON DELETE CASCADE di
//      book_members (sql/shared_books_roles.sql), SEMUA anggota (termasuk
//      admin lain kalau ada) langsung kehilangan akses ke buku ini.
//   3. sk_book_is_shared(book_id) otomatis jadi FALSE -> RLS *_legacy_anon
//      (sql/harden_shared_book_data_rls.sql) aktif lagi utk buku ini, jadi
//      anon key bisa dipakai baca/tulis seperti buku pribadi biasa --
//      tidak perlu migrasi skema apa pun untuk langkah ini.
// Tidak memindahkan book.id balik (beda dari skMakeBookShared yang migrasi
// 'b_default' -> id baru) -- ID yang sudah dipakai selama jadi buku bersama
// tetap dipakai sebagai buku pribadi, cukup aman karena skema tabel data
// tidak berubah antara buku shared/pribadi (cuma kolom enc_payload).
window.skMakeBookPrivate = async function(bookId) {
    const client = window.getSupabaseAuthClient();
    if (!client) {
        window.showToast && window.showToast('Supabase belum di-setup (cek Setelan → Supabase).', 'error');
        return;
    }
    const book = window.books.find(function(b) { return b.id === bookId; });
    if (!book || !book._isShared) {
        window.showToast && window.showToast('Buku ini bukan buku bersama.', 'error');
        return;
    }
    if (window.skGetRoleForBook(bookId) !== 'admin') {
        window.showToast && window.showToast('Hanya admin buku ini yang boleh menjadikannya pribadi lagi.', 'error');
        return;
    }
    if (!window._sessionCryptoKey) {
        window.showToast && window.showToast('Kunci enkripsi lokal belum siap -- buka & unlock app dulu di device ini.', 'error');
        return;
    }
    if (!window.isOnline || !window.isOnline()) {
        window.showToast && window.showToast('Perlu online untuk menjadikan buku ini pribadi lagi (data harus dienkripsi ulang & dihapus dari daftar buku bersama di cloud).', 'error');
        return;
    }
    let memberCount = 0;
    try {
        const members = typeof window.skListBookMembers === 'function' ? await window.skListBookMembers(bookId) : null;
        memberCount = Array.isArray(members) ? members.length : 0;
    } catch (e) { /* best-effort, cuma dipakai buat pesan konfirmasi */ }
    const extraWarn = memberCount > 1
        ? '\n\nBuku ini punya ' + memberCount + ' anggota -- SEMUANYA (termasuk admin lain) akan langsung kehilangan akses begitu buku ini jadi pribadi lagi.'
        : '';
    const ok = confirm(
        'Jadikan "' + book.name + '" kembali jadi buku pribadi?\n\n' +
        'Sesudah ini buku hanya bisa diakses dari device yang tahu password lokal kamu (bukan lewat login lagi).' +
        extraWarn +
        '\n\nAksi ini tidak bisa dibatalkan sendiri dari UI.'
    );
    if (!ok) return;

    try {
        // 1) Enkripsi ulang data lama yang masih plaintext -- SEBELUM sk_books
        //    dihapus, supaya callSupabaseAPI masih pakai JWT admin (lihat
        //    catatan di window._skConvertTableToEncrypted).
        await window._skConvertBookDataToEncrypted(bookId);

        // 2) Hapus baris sk_books -- cascade otomatis hapus semua baris
        //    book_members (lihat ON DELETE CASCADE di sql/shared_books_roles.sql),
        //    jadi semua anggota (termasuk admin lain) ikut kehilangan akses.
        const res = await client.from('sk_books').delete().eq('id', bookId);
        if (res.error) throw res.error;

        // 3) Update state lokal SEBELUM langkah 4 -- window.pushSetting
        //    (dipanggil dari _skConvertBookSettingsToEncrypted) menentukan
        //    enkripsi/account_tag berdasarkan window.skIsSharedBookId(bookId)
        //    saat itu juga.
        book._isShared = false;
        delete book._role;
        delete window._skSharedRoles[bookId];
        localStorage.setItem('sk_books', JSON.stringify(window.books));

        // 4) Enkripsi ulang settings (Anggaran/Card/dst) buku ini.
        try { await window._skConvertBookSettingsToEncrypted(bookId); }
        catch (e) { console.error('[auth.js] Gagal konversi setting ke terenkripsi:', e); }

        window.showToast && window.showToast('"' + book.name + '" sekarang jadi buku pribadi lagi.', 'success');
        if (typeof window.renderBookList === 'function') window.renderBookList();
        if (typeof window.updateBookSelectDropdown === 'function') window.updateBookSelectDropdown();
        if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
    } catch (e) {
        console.error('[auth.js] Gagal menjadikan buku pribadi lagi:', e);
        window.showToast && window.showToast('Gagal: ' + e.message, 'error');
    }
};


// ── Bootstrap admin pertama SEKALIGUS saat setup awal ───────────────────
// Dipanggil HANYA dari window.doFirstTimeSetup (js/settings.js), HANYA
// ketika window.bootstrapCryptoForBackend() mengembalikan joined:false --
// artinya ini backend Supabase yang benar-benar kosong/baru pertama kali
// disetup dari device manapun. Tujuannya: menutup kebuntuan ayam-telur yang
// terjadi kalau setup kredensial selesai duluan lalu user "dihadang"
// skLoginGateScreen (js/app.js continueAppInit -> needsLoginGate) padahal
// self-signup di gerbang itu sudah sengaja dihapus (lihat catatan di
// skRenderGateAuthPanel di atas) dan skAdminCreateMemberAccount mensyaratkan
// admin yang SUDAH ADA -- tidak ada satu pun jalan masuk untuk device
// pertama tanpa fungsi ini.
//
// Langkah: signUp akun baru -> pastikan sesinya yang aktif (bukan sesi lama
// yang somehow masih nyangkut) -> panggil skMakeBookShared(bookId, true)
// yang sudah punya semua logika (migrasi ID b_default, insert sk_books,
// insert book_members role admin -- lolos policy
// book_members_insert_bootstrap_admin di sql/bootstrap_shared_book.sql
// karena buku ini belum punya baris book_members sama sekali).
//
// Mengembalikan { ok: true } kalau sukses penuh, atau { ok: false, code,
// message } supaya doFirstTimeSetup bisa tampilkan pesan yang jelas tanpa
// membatalkan setup lokal yang sudah berhasil (URL/key/password tetap
// tersimpan -- app tetap bisa dipakai, hanya fitur Buku Bersama yang perlu
// diulang manual lewat panel "Kelola Buku" kalau langkah ini gagal).

})();
