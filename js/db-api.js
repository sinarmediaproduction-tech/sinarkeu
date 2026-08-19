// ==================== DB: API CORE & ACCOUNT TAG ====================
// Pecahan dari js/db.js (dulu 1.503 baris satu file) -- lihat catatan
// pembagian di js/db-crypto-sync.js, js/db-settings-push.js,
// js/db-settings-pull.js, js/db-books-sync.js, js/db-payment-reminder.js.
// Semua tetap vanilla window.* (tidak ada import/export module). File ini
// HARUS dimuat PALING AWAL di antara file db-*.js karena mendefinisikan
// window.callSupabaseAPI yang dipakai semua db-*.js lainnya (dan dibungkus
// lebih lanjut oleh js/auth-shared-book.js untuk buku bersama).
//
// Isi file ini: window.callSupabaseAPI (request REST ke Supabase),
// window._supabaseErrDetail (parse pesan error), account tag
// (_accountTagFromSalt/getAccountTag), dan window.tagOrFilter (filter
// query lintas account_tag lama & baru).

// ==================== SUPABASE API ====================
window.callSupabaseAPI = async function(table, method, body = null, queryString = '', options = null) {
    const baseUrl = window.getCloudUrl();
    const apiKey = window.getSupabaseKey();
    if (!baseUrl || !apiKey) return null;
    let url = `${baseUrl}/rest/v1/${table}`;
    if (queryString) url += queryString;
    const headers = { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (method === 'POST') headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
    // [MULTI-DEVICE CONFLICT DETECTION] PATCH biasa (mis. soft-delete) tidak
    // butuh body baris hasil update -- PostgREST defaultnya balas 204 kosong.
    // Tapi untuk PATCH kondisional (window._pushSingleTxConditional di
    // js/sync-conflict.js), kita HARUS tahu persis berapa baris yang kena
    // filter (0 = kondisi tidak cocok = row sudah berubah di device lain
    // sejak terakhir kita lihat -> konflik; 1 = update kita berhasil bersih).
    // options.returnRepresentation memaksa PostgREST mengembalikan baris yang
    // benar-benar ter-update, supaya panjang array itu bisa dipakai sebagai
    // sinyal konflik yang pasti (bukan asumsi).
    if (options && options.returnRepresentation) headers['Prefer'] = 'return=representation';
    // [FIX TIMEOUT] Dinaikkan dari 15s ke 25s -- 15s ternyata sering
    // kepotong duluan di koneksi seluler lambat (bukan benar-benar hang),
    // jadi banyak sync yang gagal padahal cuma butuh sedikit waktu lagi.
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
            // [RETRY] Timeout pertama sering cuma lag sesaat (mis. jaringan
            // seluler yang macet lalu pulih beberapa detik kemudian) --
            // coba sekali lagi dengan timeout baru sebelum benar-benar
            // dianggap gagal & fallback ke data lokal. Signal AbortSignal.timeout
            // lama sudah "terpakai" begitu abort, jadi butuh config baru
            // (buildConfig()) untuk percobaan kedua, bukan reuse config lama.
            // Retry HANYA untuk timeout -- error lain (4xx/5xx, offline)
            // langsung dilempar ke catch luar seperti biasa, tidak perlu
            // buang waktu retry kalau memang bukan soal lag sesaat.
            const isTimeout1 = e1 && (e1.name === 'TimeoutError' || e1.name === 'AbortError');
            if (!isTimeout1) throw e1;
            console.warn(`Supabase API timeout (${table}), mencoba ulang sekali...`);
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
        // [FIX] Sebelumnya fetch() di sini tidak punya timeout sama sekali --
        // kalau jaringan "hang" (bukan langsung gagal/offline, tapi macet:
        // captive portal, DNS nyangkut, server tidak balas tapi koneksi
        // tetap terbuka), fetch bisa menunggu tanpa batas. Karena fungsi ini
        // dipakai di jalur kritis (test koneksi setup awal, bootstrap
        // crypto, tambah akun baru, verifikasi unlock, dst.), itu bikin UI
        // macet permanen -- bukan error, bukan selesai, cuma spinner
        // selamanya. AbortSignal.timeout(25000) memastikan selalu ada batas
        // waktu, konsisten dengan pola yang sudah dipakai di forex.js/ai.js.
        // [FIX] Di Chromium (Chrome/Edge/WebView Android, termasuk versi yang
        // dipakai kebanyakan HP di Indonesia), AbortSignal.timeout() TIDAK
        // pernah menghasilkan e.name === 'TimeoutError' seperti spec --
        // selalu jatuh ke 'AbortError' dengan pesan "The user aborted a
        // request." (bug Chromium #40263649, per Agustus 2026 belum
        // diperbaiki). Karena kode ini tidak pernah memanggil
        // AbortController.abort() secara manual di jalur ini, SATU-SATUNYA
        // sumber AbortError yang mungkin muncul di sini memang timeout 15
        // detik itu sendiri -- jadi aman menganggap AbortError == timeout,
        // bukan "user membatalkan". Cek TimeoutError tetap dipertahankan
        // untuk browser yang sudah sesuai spec (Firefox/Safari terbaru).
        const isTimeoutFinal = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
        if (isTimeoutFinal) {
            e.message = 'Waktu koneksi ke server habis (timeout). Coba lagi.';
        }
        // [FIX LOG LEVEL] Timeout (bahkan setelah retry) dicatat sebagai
        // console.warn, bukan console.error -- ini sudah tertangani dengan
        // baik (fallback ke data lokal, toast di-throttle), jadi tidak
        // perlu tampil seperti error fatal di console. Error lain (4xx/5xx
        // dari server, dsb.) tetap console.error karena itu benar-benar
        // butuh perhatian (mis. RLS/policy salah).
        if (isTimeoutFinal) {
            console.warn(`Supabase API timeout (${table}) setelah retry:`, e);
        } else {
            console.error(`Supabase API Error (${table}):`, e);
        }
        // [FIX SALAH DIAGNOSIS RLS] Pesan RLS di bawah dulu SELALU mengarah
        // ke "jalankan fix_rls_sync_42501.sql" -- benar untuk kasus policy
        // memang belum ada, TAPI ada penyebab lain yang menghasilkan gejala
        // identik (401/42501) walau policy sudah lengkap: request ini lewat
        // jalur ANON (bukan jalur JWT "buku bersama" di js/auth.js), yang
        // hanya terjadi kalau window.skIsSharedBookId(book_id) mengembalikan
        // false di device ini -- padahal server (policy *_legacy_anon di
        // sql/fix_rls_sync_42501.sql sengaja menolak anon untuk buku yang
        // sudah is_shared=true) sudah tahu buku ini Buku Bersama. Mismatch
        // ini terjadi kalau device belum pernah/belum sempat memuat status
        // keanggotaan Buku Bersama-nya (window._skSharedRoles) -- mis.
        // belum login Supabase Auth di device ini, atau load-nya sempat
        // gagal/telat saat app dibuka. Coba self-heal: minta ulang status
        // keanggotaan (throttle 60 detik biar tidak spam kalau memang belum
        // login) supaya permintaan BERIKUTNYA untuk buku ini otomatis lewat
        // jalur JWT yang benar tanpa perlu reload manual.
        const _bookIdForRls = (function() {
            if (body) {
                const row = Array.isArray(body) ? body[0] : body;
                if (row && row.book_id) return row.book_id;
            }
            if (queryString && /book_id=eq\.([^&]+)/.test(queryString)) return decodeURIComponent(RegExp.$1);
            return null;
        })();
        const _isRlsErrForHeal = /row-level security|42501|permission denied for table/i.test(e && e.message || '');
        if (_isRlsErrForHeal && _bookIdForRls && typeof window.skIsSharedBookId === 'function'
            && !window.skIsSharedBookId(_bookIdForRls) && typeof window.skRefreshSharedAccess === 'function') {
            const nowHeal = Date.now();
            if (!window._lastSkRefreshSelfHealAt || nowHeal - window._lastSkRefreshSelfHealAt > 60000) {
                window._lastSkRefreshSelfHealAt = nowHeal;
                window.skRefreshSharedAccess().catch(function() { /* diamkan, coba lagi lain kali */ });
            }
        }
        // [FIX] Sebelumnya kegagalan (selain offline) selalu diam-diam --
        // cuma masuk console, tidak pernah kelihatan oleh user. Ini yang
        // membuat masalah seperti "constraint on_conflict tidak ada di
        // database" (lihat fix_settings_upsert.sql) tidak pernah ketahuan
        // dan hanya terasa sebagai "data acak/tidak sinkron". Tampilkan
        // toast (di-throttle 15 detik) supaya user tahu ada push/pull yang
        // gagal, bukan cuma "kelihatan aneh".
        if (window.isOnline() && window.showToast) {
            const now = Date.now();
            if (!window._lastSyncErrorToastAt || now - window._lastSyncErrorToastAt > 15000) {
                window._lastSyncErrorToastAt = now;
                const isConflictErr = e && e.status === 400 && /on conflict|constraint/i.test(e.message || '');
                // PostgREST dapat membungkus penolakan RLS PostgreSQL
                // (kode 42501) sebagai HTTP 401 untuk request anon. Ini
                // bukan berarti URL/anon key salah; penyebabnya adalah
                // policy RLS tabel belum mencakup jalur akses aplikasi --
                // ATAU (lihat blok self-heal di atas) buku ini sebenarnya
                // sudah jadi Buku Bersama tapi device ini belum mengenali
                // keanggotaannya (belum login / sesi belum termuat).
                const isRlsErr = /row-level security|42501|permission denied for table/i.test(e && e.message || '');
                const detail = window._supabaseErrDetail(e && e.message);
                const msg = isConflictErr
                    ? `Gagal sinkron tabel '${table}': constraint database belum di-setup. Jalankan fix_settings_upsert.sql di Supabase SQL Editor.`
                    : isRlsErr
                        ? `Gagal sinkron tabel '${table}': akses ditolak oleh aturan RLS database. Kalau sql/fix_rls_sync_42501.sql sudah pernah dijalankan, ini mungkin Buku Bersama yang belum dikenali device ini -- coba login ulang.`
                    : `Gagal sinkron tabel '${table}' (${e && e.status ? e.status : 'network'})${detail ? ': ' + detail : '. Cek koneksi/URL/API key.'}`;
                window.showToast(msg, 'error');
            }
        }
        return null;
    }
};

// Ekstrak pesan yang bisa dibaca dari body error Supabase/PostgREST (biasanya
// JSON: {message, hint, code, details}), dengan fallback ke teks mentah kalau
// bukan JSON. Dipotong supaya toast tidak kepanjangan. Dipakai di sini dan di
// patch callSupabaseAPI buku bersama (js/auth.js) supaya pesan error yang
// ditampilkan ke user (dan ikut kerekam di log toast) langsung menunjukkan
// akar masalah sebenarnya (mis. "Invalid API key" vs "permission denied for
// table settings" vs "JWT expired") -- bukan cuma kode status generik.
window._supabaseErrDetail = function(rawText) {
    if (!rawText) return '';
    try {
        const j = JSON.parse(rawText);
        const parts = [j.message, j.hint, j.code].filter(Boolean);
        const s = parts.join(' | ');
        return s ? (s.length > 160 ? s.slice(0, 160) + '…' : s) : '';
    } catch {
        return rawText.length > 160 ? rawText.slice(0, 160) + '…' : rawText;
    }
};


// Menghasilkan tag 8-karakter dari crypto_salt akun yang sedang aktif.
// Tag ini di-embed ke setiap baris settings di Supabase, sehingga dua akun
// berbeda yang menggunakan Supabase yang sama (URL + API key sama) tidak
// bisa saling membaca data satu sama lain.
//
// Kenapa pakai salt? Karena salt sudah ada, unik per akun, dan sudah
// tersimpan di cloud (tabel settings, key 'crypto_salt'). Tidak perlu
// skema baru atau kolom tambahan di Supabase.
//
// Tag TIDAK dienkripsi (tidak perlu); nilai salt sendiri bukan rahasia —
// yang rahasia adalah password yang dipakai untuk menurunkan AES key dari
// salt itu.
// Diekstrak dari getAccountTag() supaya bisa dipakai untuk salt akun MANAPUN
// (tidak harus akun aktif) -- dibutuhkan oleh verifikasi password-terbaru
// saat unlock akun lain yang sedang terkunci (lihat submitAccountUnlock di
// account.js).
window._accountTagFromSalt = function(saltB64) {
    if (!saltB64) return null;
    // Ambil 6 byte pertama dari salt (sudah 16 byte random), encode base64url
    // tanpa padding -> 8 karakter yang URL-safe dan stabil selama salt tidak
    // berubah. Cukup untuk isolasi; bukan secret.
    try {
        const bytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
        const slice = bytes.slice(0, 6);
        const b64 = btoa(String.fromCharCode(...slice));
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } catch { return null; }
};
window.getAccountTag = function() {
    return window._accountTagFromSalt(localStorage.getItem('sk_crypto_salt'));
};

// ==================== FIX: OR-NULL FILTER UNTUK BACA DATA ====================
// SEBELUM PERBAIKAN INI: banyak query GET memakai `tag ? '&account_tag=eq.'+tag : ''`.
// Itu BUKAN filter OR walau komentarnya bilang begitu -- PostgREST meng-AND-kan semua
// parameter query, jadi begitu device mana pun sudah punya tag (hampir selalu, sejak
// crypto_salt lokal ada), semua baris lama yang account_tag-nya masih NULL (dibuat
// sebelum kolom ini ditambahkan, dan tidak pernah di-backfill) langsung tersaring habis
// dan tidak pernah muncul lagi -- termasuk saat device baru join backend yang sama.
//
// window.tagOrFilter(tag, bookId) menghasilkan filter PostgREST yang benar-benar OR:
// baris ber-tag SAMA milik akun ini, ATAU baris lama tanpa tag sama sekali.
// Dipakai di semua query GET (baca) yang sebelumnya cuma AND-tag. Untuk operasi
// DELETE/PATCH massal tetap sengaja pakai AND-tag saja (lebih aman kalau satu
// backend Supabase dipakai lebih dari satu akun/password berbeda).
//
// [FIX "TRANSAKSI TIDAK MUNCUL DI BUKU BERSAMA"] account_tag HANYA berguna
// untuk memisahkan akun PRIBADI berbeda yang kebetulan berbagi satu backend
// Supabase yang sama -- untuk Buku Bersama, akses sudah benar-benar dijaga
// lewat RLS role (public.sk_role_for_book, lihat sql/harden_shared_book_*.sql),
// jadi filter account_tag tidak boleh ikut membatasi bacaan lagi. Kalau tetap
// diterapkan: baris LAMA (ditulis sebelum buku ini jadi Bersama, atau ditulis
// anggota lain dengan salt/password lokal berbeda) tetap membawa account_tag
// SI PENULIS ASLI -- device anggota lain yang tag-nya beda dan bukan NULL
// jadi tidak pernah melihatnya sama sekali, TANPA error apa pun (bukan
// pelanggaran RLS, cuma baris tersaring di WHERE) -- persis gejala "online,
// tidak ada toast error, transaksi cuma kosong" yang dilaporkan user.
// Kalau bookId diberikan dan window.skIsSharedBookId(bookId) true, jangan
// kirim filter account_tag sama sekali -- baca semua baris buku itu apa
// adanya, biar RLS role yang menjaga.
window.tagOrFilter = function(tag, bookId) {
    if (bookId && typeof window.skIsSharedBookId === 'function' && window.skIsSharedBookId(bookId)) return '';
    return tag ? `&or=(account_tag.eq.${tag},account_tag.is.null)` : '';
};

// ==================== MULTI-DEVICE CRYPTO BOOTSTRAP ====================
// Salt PBKDF2 + nilai "check" terenkripsi disimpan di cloud (tabel `settings`,
// book_id='global') TANPA dienkripsi ulang oleh sesi (memang tidak perlu:
// salt bukan rahasia, dan checkB64 sudah berupa ciphertext AES-GCM yang
// fungsinya sendiri adalah verifikasi password — lihat window.bootstrapCryptoForBackend
// di crypto.js). Ini yang membuat semua perangkat yang memakai password sama
// bisa menurunkan AES key yang SAMA, alih-alih masing-masing generate salt
// acak sendiri (yang menyebabkan setting tidak pernah bisa saling didekripsi
// lintas perangkat).
