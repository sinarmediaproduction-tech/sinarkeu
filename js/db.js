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
window.pushCryptoSaltCheck = async function(saltB64, checkB64) {
    if (!window.isOnline()) return false;
    const now = new Date().toISOString();
    const tag = window.getAccountTag();
    const payload = [
        { book_id: 'global', key: 'crypto_salt', value: saltB64, updated_at: now, ...(tag ? { account_tag: tag } : {}) },
        { book_id: 'global', key: 'crypto_check', value: checkB64, updated_at: now, ...(tag ? { account_tag: tag } : {}) }
    ];
    // FIX PERMANEN: setelah unique constraint settings_unique_row (book_id, key,
    // account_tag) dibuat di Supabase (lihat fix_settings_upsert.sql), parameter
    // on_conflict di bawah membuat POST ini benar-benar meng-UPDATE baris yang
    // sudah ada untuk tag ini, bukan selalu INSERT baris baru seperti sebelumnya.
    // Kalau tag kosong (kasus push salt PERTAMA kali sebelum salt tersimpan ke
    // localStorage, lihat bootstrapCryptoForBackend), tetap INSERT biasa seperti
    // semula -- aman karena baris ber-tag NULL tidak dibatasi unique constraint.
    const onConflict = tag ? '?on_conflict=book_id,key,account_tag' : '';
    const result = await window.callSupabaseAPI(
        'settings', 'POST', payload, onConflict, { bookId: 'global' }
    );
    return result !== null;
};

window.pullCryptoSaltCheck = async function(tagOverride) {
    if (!window.isOnline()) return null;
    const tag = tagOverride !== undefined ? tagOverride : window.getAccountTag();
    // OR filter: ambil baris ber-tag milik akun ini ATAU baris lama tanpa tag.
    // Penting untuk bootstrap multi-device: baris crypto_salt/check lama (NULL)
    // harus bisa dibaca sebelum migrasi men-tag ulang baris tersebut.
    const tagFilter = window.tagOrFilter(tag);
    // FIX: tabel `settings` tidak punya unique constraint dan push selalu INSERT
    // baris baru (bukan upsert sungguhan -- lihat catatan di pullAllSettings/
    // reEncryptAllCloudSettings). Kalau setup/ganti password pernah tersubmit
    // lebih dari sekali, bisa ada BEBERAPA baris crypto_salt/crypto_check untuk
    // tag yang sama. Tanpa ORDER BY, rows.find() bisa mengambil baris LAMA/SALAH
    // -- inilah penyebab device baru menurunkan AES key dari salt yang keliru
    // walau url/anonkey/password sudah sama persis. order=updated_at.desc
    // memastikan baris PERTAMA yang cocok untuk tiap key selalu yang terbaru.
    const rows = await window.callSupabaseAPI('settings', 'GET', null, `?book_id=eq.global&key=in.(crypto_salt,crypto_check)${tagFilter}&order=updated_at.desc`);
    if (!rows || !Array.isArray(rows) || rows.length === 0) return null;
    const saltRow = rows.find(r => r.key === 'crypto_salt');
    const checkRow = rows.find(r => r.key === 'crypto_check');
    if (!saltRow || !checkRow || !saltRow.value || !checkRow.value) return null;
    return { salt: saltRow.value, check: checkRow.value };
};

// ==================== VARIAN STRICT: bedakan "cloud kosong" vs "gagal cek" ====================
// Dipakai KHUSUS oleh window.bootstrapCryptoForBackend (crypto.js) saat
// memutuskan apakah boleh generate salt baru. pullCryptoSaltCheck() biasa di
// atas mengembalikan null untuk 3 kondisi sekaligus: offline, request gagal,
// ATAU memang belum ada data -- ambigu, dan berbahaya kalau dipakai untuk
// memutuskan "generate salt baru": device yang sebenarnya cuma gagal konek
// bisa keliru mengira dirinya device pertama, lalu bikin salt sendiri yang
// berbeda dari salt asli yang sebenarnya sudah ada di cloud (persis kejadian
// yang sudah pernah terjadi).
//
// Varian ini MELEMPAR Error (bukan diam-diam return null) untuk kondisi
// offline/gagal cek, supaya pemanggil berhenti dan menampilkan pesan error
// yang jelas ke user -- bukan lanjut generate salt baru. null hanya
// dikembalikan kalau query ke Supabase BENAR-BENAR sukses dan hasilnya nol
// baris (device pertama yang sah, aman generate salt baru).
window.pullCryptoSaltCheckStrict = async function(tagOverride) {
    if (!window.isOnline()) {
        const err = new Error('Tidak ada koneksi internet -- tidak bisa memastikan apakah backend ini sudah pernah disetup dari device lain. Sambungkan internet dulu sebelum lanjut setup.');
        err.code = 'OFFLINE';
        throw err;
    }
    const tag = tagOverride !== undefined ? tagOverride : window.getAccountTag();
    const tagFilter = window.tagOrFilter(tag);
    const rows = await window.callSupabaseAPI('settings', 'GET', null, `?book_id=eq.global&key=in.(crypto_salt,crypto_check)${tagFilter}&order=updated_at.desc`);
    if (rows === null) {
        // callSupabaseAPI mengembalikan null saat request gagal (network error,
        // Supabase down, url/anonkey salah, dll) -- BUKAN berarti tabelnya kosong.
        const err = new Error('Gagal menghubungi Supabase untuk mengecek salt yang sudah ada. Cek lagi koneksi/URL/API key, jangan lanjutkan setup sampai ini berhasil.');
        err.code = 'CHECK_FAILED';
        throw err;
    }
    if (!Array.isArray(rows) || rows.length === 0) return null; // benar-benar kosong, aman generate salt baru
    const saltRow = rows.find(r => r.key === 'crypto_salt');
    const checkRow = rows.find(r => r.key === 'crypto_check');
    if (!saltRow || !checkRow || !saltRow.value || !checkRow.value) return null;
    return { salt: saltRow.value, check: checkRow.value };
};

// ==================== PUSH SETTINGS ====================
// Semua nilai dienkripsi (AES-GCM) dengan kunci sesi sebelum dikirim ke cloud,
// supaya isi tabel `settings` di Supabase tidak pernah berupa plain text
// (sebelumnya hanya kredensial koneksi yang dienkripsi, isi setting tidak).
//
// PENTING: fungsi ini SEKARANG mengembalikan true/false sesuai hasil push
// yang sebenarnya. Sebelumnya fungsi ini tidak pernah `return` apa pun,
// sehingga semua pemanggil (saveDefaultBudgetToCloud, dst.) selalu menganggap
// hasilnya gagal (`undefined` -> falsy) walau push-nya sebenarnya sukses.
// Pemanggil yang melakukan `await window.pushSetting(...)` sekarang bisa
// mempercayai nilai return-nya untuk menampilkan status yang akurat ke user.
// [FIX SYNC KONFIGURASI DEVICE LINTAS-TAG] Key `settings` (book_id='global')
// yang isinya konfigurasi backend/device -- bukan data pribadi per-identitas
// -- supaya otomatis tersinkron ke SEMUA device yang connect ke backend
// Supabase yang sama, terlepas dari beda-tidaknya password lokal/account_tag
// tiap device. Lihat catatan lengkap di window.pushSetting di bawah.
window.DEVICE_AGNOSTIC_SETTING_KEYS = new Set(['ai_worker_url', 'ai_engine', 'harga_pangan_worker_url', 'emas_api_key']);

window.pushSetting = async function(key, value, bookId) {
    if (!window.isOnline()) return false;
    const resolvedBookId = bookId || window.currentBookId;
    const plainJson = JSON.stringify(value);
    const isSharedBook = window.skIsSharedBookId && window.skIsSharedBookId(resolvedBookId);
    // [ENKRIPSI DINONAKTIFKAN] Isi tabel `settings` sekarang SELALU ditulis
    // plaintext, baik buku pribadi maupun bersama -- sebelumnya buku pribadi
    // dienkripsi AES-GCM dengan kunci sesi lokal. _decryptSettingValue() di
    // bawah tetap bisa membaca baris LAMA yang sudah kadung terenkripsi
    // (fallback decryptStr, lalu fallback lagi ke plain JSON), jadi data
    // lama tetap terbaca normal walau tidak ada enkripsi baru lagi.
    const encryptedValue = plainJson;
    // [FIX] Buku bersama: JANGAN sertakan account_tag. account_tag dipakai
    // pullAllSettings()/window.tagOrFilter() untuk memfilter baris settings
    // supaya cuma baris ber-tag SAMA (atau tanpa tag) yang terbaca -- itu
    // benar untuk buku pribadi (mencegah tabrakan antar akun berbeda yang
    // pakai backend sama), tapi salah untuk buku shared: anggota lain hampir
    // pasti account_tag-nya BEDA (password/salt lokal beda -- sama seperti
    // alasan enkripsi di-skip di atas). Kalau tetap disertakan, baris yang
    // di-push device A (tag A) tidak akan pernah match filter OR device B
    // (account_tag.eq.tagB OR account_tag.is.null) -- hasilnya baris itu
    // TERSARING HABIS di level query Supabase sebelum sempat sampai ke sini,
    // padahal bukan bug enkripsi/render. Ini yang menyebabkan mis. Daftar
    // Belanja di buku shared "hilang" total di device lain. Solusi: untuk
    // buku shared, kirim account_tag = null (konsisten dengan baris lama
    // sebelum fitur ini ada) supaya cocok dengan filter OR-null di SEMUA
    // device, siapa pun akun yang pull.
    //
    // [FIX SYNC KONFIGURASI DEVICE LINTAS-TAG] Beberapa key di tabel
    // `settings` (lihat DEVICE_AGNOSTIC_SETTING_KEYS) adalah konfigurasi
    // backend/device -- URL Cloudflare Worker untuk Analisis AI & Harga
    // Pangan, API key emas pihak ketiga -- BUKAN data pribadi yang perlu
    // dipisah per-identitas seperti budget/buku. Kalau key-key ini tetap
    // di-tag dengan account_tag (diturunkan dari salt password lokal
    // perangkat), device lain yang login ke backend Supabase SAMA tapi
    // punya salt/password lokal BERBEDA (skenario umum: gabung lewat login
    // Buku Bersama/Supabase Auth di HP baru, bukan mewarisi salt yang
    // sama persis) tidak akan pernah melihat baris ini -- filter OR-null
    // di window.tagOrFilter cuma cocok untuk tag SAMA atau tag NULL, dan
    // baris ber-tag device A tidak NULL dan tidak sama dengan tag device B.
    // Gejalanya: "sudah login akun yang sama, tapi setelan AI/Harga Pangan
    // tetap kosong di HP baru" walau data buku/transaksi (yang jalur
    // bacanya beda) muncul normal. Solusi sama seperti buku bersama di
    // atas: kirim account_tag = null supaya key-key ini otomatis kebaca
    // semua device yang connect ke backend yang sama, siapa pun/apa pun
    // password lokalnya.
    const tag = (isSharedBook || window.DEVICE_AGNOSTIC_SETTING_KEYS.has(key)) ? null : window.getAccountTag();

    const payload = [{
        book_id: resolvedBookId,
        key: key,
        value: encryptedValue,
        updated_at: new Date().toISOString(),
        ...(tag ? { account_tag: tag } : {})
    }];
    // FIX PERMANEN: sama seperti pushCryptoSaltCheck di atas -- setelah unique
    // constraint settings_unique_row (book_id, key, account_tag) dibuat di
    // Supabase (lihat fix_settings_upsert.sql), on_conflict membuat push ini
    // benar-benar UPDATE baris yang sudah ada, bukan numpuk snapshot baru tiap
    // kali. Ini yang menyebabkan bug "buku Debugging menutupi 7 buku asli":
    // versi 'books' TERBARU (berdasar updated_at) selalu menang saat pull,
    // padahal "terbaru" seharusnya = "hasil edit paling baru", bukan sekadar
    // baris mana yang kebetulan ter-insert belakangan dari device manapun.
    const onConflict = tag ? '?on_conflict=book_id,key,account_tag' : '';
    const result = await window.callSupabaseAPI('settings', 'POST', payload, onConflict);
    // callSupabaseAPI mengembalikan null kalau request gagal (lihat fungsi di atas).
    // [FIX] Dulu fungsi ini cuma balikin true/false. Sekarang balikin `result`
    // apa adanya (array baris hasil representasi server, atau null kalau
    // gagal) -- tetap truthy/falsy sama seperti boolean lama (jadi semua
    // pemanggil existing yang cuma cek `if (hasil)` tidak perlu diubah), TAPI
    // pemanggil yang butuh nilai `updated_at` OTORITATIF dari SERVER (bukan
    // `new Date()` milik device sendiri) sekarang bisa mengambilnya dari
    // result[0].updated_at. Dipakai oleh saveFaseKehidupan() di render.js --
    // lihat catatan di sana untuk kenapa ini penting (clock skew antar-device).
    return result;
};

// [FIX RACE STALE-DEVICE RESURRECTION] Dipanggil di awal pushSettingBooks.
// Masalah yang ditutup: device A menghapus Buku Bersama dengan benar
// (deleteBook() sudah menghapus baris sk_books + book_members di server).
// Device B (device lain/sesi lain milik akun yang sama) sempat lama
// offline/tidak dibuka sejak sebelum penghapusan itu -- window.books
// lokalnya MASIH membawa buku itu dengan _isShared=true (dari sesi terakhir
// dia refresh). Begitu device B online lagi dan melakukan aksi apa pun yang
// memicu pushSettingBooks() (banyak sekali titik pemicunya), ia mem-push
// blob 'books' PENUH miliknya sendiri -- termasuk buku yang sudah dihapus
// itu -- menimpa cloud. Device A (atau device lain mana pun) yang pull
// setelahnya akan melihat buku itu "hidup lagi", padahal baris sk_books-nya
// sendiri sudah tidak ada -- device B tidak tahu ini karena pendingDeletes
// (localStorage) itu cuma diketahui device yang benar-benar menjalankan
// penghapusannya, bukan device B.
//
// Perbaikan: sebelum push apa pun, verifikasi ke server (query sk_books
// sekali, batch) buku mana saja yang device INI percaya masih Buku Bersama
// (_isShared true di window.books saat ini, atau tercatat di
// window._skSharedRoles dari refresh sesi ini) yang ternyata SUDAH TIDAK
// ADA lagi di sk_books. Buku begitu langsung dibuang dari window.books +
// cache lokalnya + payload push -- jadi device basi ikut "sembuh" sendiri
// alih-alih menulari device lain lewat push berikutnya.
async function _skDropDeadSharedBooksBeforePush() {
    if (!Array.isArray(window.books) || window.books.length === 0) return;
    const authClient = window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null;
    if (!authClient) return; // tidak pernah login Buku Bersama di sesi ini -- tidak ada yang perlu dicek
    const candidateIds = window.books
        .filter(function(b) {
            return b._isShared || (window._skSharedRoles && Object.prototype.hasOwnProperty.call(window._skSharedRoles, b.id));
        })
        .map(function(b) { return b.id; });
    if (candidateIds.length === 0) return;

    let existingIds;
    try {
        const res = await authClient.from('sk_books').select('id').in('id', candidateIds);
        if (res.error) {
            window.skWarn('[Sync] Gagal verifikasi sk_books sebelum push, lewati pengecekan kali ini:', res.error);
            return;
        }
        existingIds = new Set((res.data || []).map(function(r) { return r.id; }));
    } catch (e) {
        window.skWarn('[Sync] Gagal verifikasi sk_books sebelum push, lewati pengecekan kali ini:', e);
        return;
    }

    const deadIds = candidateIds.filter(function(id) { return !existingIds.has(id); });
    if (deadIds.length === 0) return;
    window.skWarn('[Sync] Buku bersama berikut sudah tidak ada lagi di server (dihapus lewat device/admin lain), dibuang dari device ini sebelum push:', deadIds);

    const deadSet = new Set(deadIds);
    deadIds.forEach(function(id) {
        if (window._skSharedRoles) delete window._skSharedRoles[id];
        localStorage.removeItem('sk_txs_' + id);
        localStorage.removeItem('sk_budgets_' + id);
        localStorage.removeItem('sk_logs_' + id);
        localStorage.removeItem('sk_manual_backups_' + id);
        localStorage.removeItem('sk_last_auto_backup_' + id);
        localStorage.removeItem('sk_last_cloud_backup_' + id);
        localStorage.removeItem('sk_default_budget_' + id);
        localStorage.removeItem('sk_shopping_list_' + id);
        localStorage.removeItem('sk_electricity_plan_' + id);
        localStorage.removeItem('sk_balance_offset_' + id);
        localStorage.removeItem('sk_payment_reminders_' + id);
    });
    const wasCurrent = deadSet.has(window.currentBookId);
    window.books = window.books.filter(function(b) { return !deadSet.has(b.id); });
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    if (wasCurrent && window.books.length > 0 && typeof window.switchBook === 'function') {
        window.switchBook(window.books[0].id);
    } else if (window.books.length === 0 && typeof window._promptCreateFirstBookIfEmpty === 'function') {
        window._promptCreateFirstBookIfEmpty();
    }
    if (window.showToast) {
        window.showToast(
            deadIds.length === 1
                ? 'Buku bersama sudah dihapus di server, dibuang dari device ini.'
                : deadIds.length + ' buku bersama sudah dihapus di server, dibuang dari device ini.',
            'warning'
        );
    }
    if (typeof window.renderBookList === 'function') window.renderBookList();
    if (typeof window.updateBookSelectDropdown === 'function') window.updateBookSelectDropdown();
}

window.pushSettingBooks = async function() {
    if (!window.isOnline()) return false;
    await _skDropDeadSharedBooksBeforePush();
    // [FIX BUKU HANTU LINTAS DEVICE] Buang dulu buku yang sudah pernah
    // ditandai terhapus permanen (lihat window.addBookTombstone) dari
    // window.books SEBELUM push apa pun -- mencegah device dengan cache
    // window.books basi menghidupkan kembali buku yang sudah dihapus device
    // lain, walau device ini sendiri tidak pernah menjalankan penghapusannya.
    const _tombstones = window._loadBookTombstones ? window._loadBookTombstones() : new Set();
    if (_tombstones.size > 0 && Array.isArray(window.books)) {
        const _beforeLen = window.books.length;
        window.books = window.books.filter(function(b) { return !_tombstones.has(b.id); });
        if (window.books.length !== _beforeLen) {
            window.skLog('[Sync] Buku ber-tombstone dibuang dari payload push:', _beforeLen - window.books.length);
            localStorage.setItem('sk_books', JSON.stringify(window.books));
        }
    }
    // [FIX BOOKS LOST-UPDATE] Dulu fungsi ini tidak pernah `return` apa pun,
    // jadi pemanggil (mis. deleteBook di book.js) tidak pernah tahu pasti
    // apakah push-nya sungguhan berhasil -- penting sekarang karena
    // deleteBook memakai hasil ini utk memutuskan kapan boleh membersihkan
    // marker "pending delete" (lihat window.markBookPendingDelete/
    // clearBookPendingDelete di bawah & pullAllSettings untuk union-merge
    // yang memakainya).
    //
    // [FIX BUG #4] window.books bisa memuat field runtime `_isShared`/
    // `_role` yang ditempel js/auth.js (skRefreshSharedAccess) berdasarkan
    // SESI LOGIN saat ini -- bukan data buku yang sebenarnya. Kalau field
    // ini ikut ter-push ke setting 'books' (dibagikan ke SEMUA device akun
    // ini lewat pullAllSettings), device lain/sesi lain bisa menerima label
    // "buku bersama · peran: admin" yang basi/tidak sesuai keanggotaan
    // book_members yang sebenarnya di device itu -- sampai (kalau sempat)
    // skRefreshSharedAccess() membetulkannya sendiri. Buang dulu field ini
    // sebelum di-push; window._skSharedRoles + skRefreshSharedAccess() satu
    // -satunya sumber kebenaran untuk status shared/role, bukan cloud sync
    // biasa ini.
    const sanitizedBooks = (Array.isArray(window.books) ? window.books : []).map(function(b) {
        const clean = Object.assign({}, b);
        delete clean._isShared;
        delete clean._role;
        return clean;
    });
    const result = await window.pushSetting('books', sanitizedBooks, 'global');
    window.skLog('[Sync] Books saved to cloud:', window.books.length);
    // Sinkronkan tombstone ke cloud juga, best-effort -- kegagalan di sini
    // TIDAK boleh membuat pushSettingBooks dianggap gagal (daftar buku
    // utamanya sendiri sudah berhasil di atas); device lain masih akan
    // menerima tombstone ini di kesempatan push berikutnya.
    if (_tombstones.size > 0) {
        window.pushBookTombstones().catch(function(e) {
            window.skWarn('[Sync] Gagal push tombstone buku (akan dicoba lagi push berikutnya):', e);
        });
    }
    return !!result;
};

window.pushSettingBudgets = async function() {
    if (!window.isOnline()) return;
    const bud = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
    await window.pushSetting('budgets', bud, window.currentBookId);
    await window.pushSettingDefaultBudget();
};

window.pushSettingDefaultBudget = async function() {
    if (!window.isOnline()) return;
    const defaultBudget = window.getDefaultBudget(window.currentBookId);
    await window.pushSetting('default_budget', defaultBudget, window.currentBookId);
};

window.pushSettingTelegram = async function() {
    if (!window.isOnline()) return;
    const cfg = await window.getTgConfig();
    await window.pushSetting('telegram_config', { token: cfg.token, chatId: cfg.chatId, edgeUrl: cfg.edgeUrl }, 'global');
};

// ==================== RE-ENCRYPT SETTINGS (setelah ganti password) ====================
// Dipanggil setelah window.setupNewPassword() mengganti salt + kunci sesi
// (lihat changePassword() di settings.js dan saveNewAccount() di account.js).
//
// MASALAH yang diperbaiki: setupNewPassword() hanya meng-enkripsi-ulang
// kredensial Supabase lokal. Baris-baris di tabel `settings` cloud (books,
// budgets, default_budget, telegram_config) yang sudah terlanjur dienkripsi
// dengan kunci LAMA tidak ikut diperbarui. Akibatnya pullAllSettings() ->
// _decryptSettingValue() akan selalu gagal (OperationError) untuk baris
// tersebut selamanya, lalu baris itu dilewati (JSON.parse gagal karena
// hasil fallback bukan plain text, melainkan ciphertext lama) -> setting
// itu berhenti tersinkron dari cloud sampai ada push baru di key yang sama.
//
// Fungsi ini mem-push ulang semua setting yang diketahui secara lokal,
// dienkripsi dengan window._sessionCryptoKey yang BARU, supaya cloud
// langsung konsisten dengan kunci yang baru saja diganti.
window.reEncryptAllCloudSettings = async function() {
    if (!window.isOnline() || !window._sessionCryptoKey) return;
    try {
        // [FIX RACE CONDITION -- TOAST RLS 42501 BERULANG UTK BUKU BERSAMA]
        // Fungsi ini bisa terpicu OTOMATIS oleh hasStaleRows di
        // pullAllSettings() (lihat pemanggilnya di bawah), termasuk lewat
        // AutoSync tick di js/app.js. window._skSharedRoles bisa saja BELUM
        // sempat ter-refresh ulang sejak reload/login di momen itu (mis. app
        // baru login lagi tapi skRefreshSharedAccess() masih berjalan/belum
        // kepanggil di tick ini) -- kalau begitu, skIsSharedBookId(b.id) di
        // bawah keliru balik false utk buku yang SEBENARNYA shared, lolos ke
        // pushSetting() lewat anon key, lalu ditolak RLS (device "lupa
        // sesaat" kalau buku ini shared, padahal user sudah login). Refresh
        // eksplisit di sini dulu supaya keputusan skip di bawah selalu pakai
        // state ter-update, bukan bergantung self-heal parsial di app.js
        // yang cuma jalan kalau b._isShared SUDAH pernah true sebelumnya.
        if (typeof window.skRefreshSharedAccess === 'function') {
            try { await window.skRefreshSharedAccess(); }
            catch (e) { window.skWarn('[Sync] Gagal refresh akses buku bersama sebelum re-enkripsi (lanjut pakai state lama):', e); }
        }
        await window.pushSettingBooks();
        const books = Array.isArray(window.books) ? window.books : [];
        for (const b of books) {
            // Pemulihan ini dipicu otomatis oleh baris setting lama. Batasi
            // ke buku yang sedang aktif: buku lain yang tersisa di cache
            // lokal bisa sudah menjadi Buku Bersama di server, sementara
            // role-nya belum/tidak lagi dimuat pada sesi ini. Menulisnya
            // lewat anon key akan ditolak RLS dan hanya menghasilkan spam.
            // Setting baru sudah plaintext, jadi buku lain akan tersinkron
            // saat dibuka dan disunting secara normal.
            if (b.id !== window.currentBookId) continue;
            // [FIX SETTINGS BUKU BERSAMA] Baris settings buku bersama SUDAH
            // dikonversi SEKALI ke plaintext tepat di titik "Jadikan Bersama"
            // (window._skConvertBookSettingsToPlaintext, js/auth.js), pakai
            // nilai ASLI milik pemilik. Device siapa pun yang memicu fungsi
            // ini lewat hasStaleRows di pullAllSettings (termasuk anggota
            // BARU yang cache lokalnya utk buku ini masih kosong/default,
            // karena dia memang belum pernah dapat data aslinya) TIDAK BOLEH
            // ikut push ulang dari sini -- tabel `settings` insert-only tanpa
            // kolom `id` (tidak bisa di-PATCH per baris) dan pullAllSettings
            // memilih baris ber-updated_at TERBARU per (book_id, key), jadi
            // push kosong dari sini akan menimpa (secara efektif) data asli
            // buku ini untuk SEMUA orang di pull berikutnya.
            if (window.skIsSharedBookId && window.skIsSharedBookId(b.id)) continue;
            const bud = JSON.parse(localStorage.getItem('sk_budgets_' + b.id) || '{}');
            await window.pushSetting('budgets', bud, b.id);
            const defBud = window.getDefaultBudget(b.id);
            await window.pushSetting('default_budget', defBud, b.id);
            const annBud = window.getAnnualBudget(b.id);
            await window.pushSetting('annual_budget', annBud, b.id);
            const hiddenCards = window.getHiddenCards ? window.getHiddenCards(b.id) : [];
            await window.pushSetting('hidden_cards', hiddenCards, b.id);
            const shoppingList = window.getShoppingList ? window.getShoppingList(b.id) : [];
            await window.pushSetting('shopping_list', shoppingList, b.id);
            const shoppingIncome = window.getShoppingListMonthlyIncome ? window.getShoppingListMonthlyIncome(b.id) : 0;
            await window.pushSetting('shopping_list_income', shoppingIncome, b.id);
            const electricityPlan = window.getElectricityPlan ? window.getElectricityPlan(b.id) : { meters: [] };
            await window.pushSetting('electricity_plan', electricityPlan, b.id);
            // Fase Kehidupan juga setting per-buku. Tanpa baris ini, data
            // fase yang masih memakai format cloud lama tidak ikut dipulihkan
            // saat proses re-enkripsi/self-heal berjalan.
            const faseRaw = localStorage.getItem('sk_fase_kehidupan_' + b.id);
            if (faseRaw) {
                try { await window.pushSetting('fase_kehidupan', JSON.parse(faseRaw), b.id); }
                catch (e) { window.skWarn('[Sync] Fase Kehidupan lokal tidak valid, dilewati:', e); }
            }
        }
        await window.pushSettingTelegram();
        window.skLog('[Sync] Re-enkripsi & push ulang semua setting ke cloud selesai (kunci baru).');
    } catch (e) {
        window.skWarn('[Sync] Gagal re-enkripsi setting cloud setelah ganti password:', e);
    }
};

// ==================== HEAL STALE CLOUD SETTING ====================
// Dipanggil saat load*FromCloud gagal JSON.parse hasil dekripsi (lihat
// catatan di reEncryptAllCloudSettings di atas: baris cloud masih
// terenkripsi kunci sesi LAMA, sehingga _decryptSettingValue() fallback
// ke ciphertext mentah yang bukan JSON valid). Daripada baris itu macet
// permanen sampai ada push manual, kita re-push data lokal yang masih
// utuh (tidak terenkripsi password lama, localStorage selalu plain JSON)
// ke cloud dengan kunci sesi SAAT INI, supaya percobaan load berikutnya
// (atau dari device lain) langsung berhasil.
window._healStaleCloudSetting = async function(key, bookId, localValue) {
    if (!window.isOnline() || !window._sessionCryptoKey) return;
    try {
        const ok = await window.pushSetting(key, localValue, bookId);
        if (ok) {
            window.skLog(`[Sync] Heal: '${key}' (book ${bookId}) berhasil di-push ulang dengan kunci sesi saat ini.`);
        }
    } catch (e) {
        window.skWarn(`[Sync] Heal gagal untuk '${key}' (book ${bookId}):`, e);
    }
};

// ==================== PULL SETTINGS ====================
// Mencoba dekripsi nilai dari cloud dengan kunci sesi. Jika gagal (data lama
// dari sebelum migrasi enkripsi, masih plain text), pakai apa adanya sebagai
// fallback supaya tidak memutus kompatibilitas dengan data yang sudah ada.
window._decryptSettingValue = async function(rawValue) {
    if (window._sessionCryptoKey) {
        try {
            return await window.decryptStr(window._sessionCryptoKey, rawValue);
        } catch (e) {
            window.skLog('[Sync] Data cloud terenkripsi kunci lama, akan di-heal otomatis.');
        }
    }
    // Fallback: cek apakah rawValue adalah JSON valid (data lama sebelum enkripsi).
    // Kalau bukan (masih ciphertext dari kunci lama), return null supaya pemanggil
    // bisa skip / trigger heal — daripada melempar SyntaxError di JSON.parse().
    try {
        JSON.parse(rawValue);
        return rawValue; // memang plain JSON (data lama, sebelum fitur enkripsi)
    } catch {
        window.skLog('[Sync] rawValue kunci lama (bukan JSON valid), return null — akan di-heal.');
        return null;
    }
};

window.pullAllSettings = async function(forceFull) {
    if (!window.isOnline()) return;
    // [PERF FIX - EGRESS] forceFull=true dipakai window.forceFullSync ("Sinkron
    // Penuh", tombol manual) supaya sesuai namanya: benar-benar tarik ulang
    // SELURUH settings, bukan cuma delta -- berguna untuk troubleshooting/
    // self-heal manual saat user curiga ada yang tidak sinkron. Autosync
    // (js/app.js, tiap 30 detik) TIDAK memakai ini -- tetap incremental.
    if (forceFull) {
        window._lastSettingsSyncTime.global = null;
        window._lastSettingsSyncTime.shared = {};
        if (window._saveSettingsSyncCursor) window._saveSettingsSyncCursor();
    }
    const tag = window.getAccountTag();
    // OR filter: baris ber-tag milik akun ini ATAU baris lama tanpa tag (data sebelum
    // fitur account_tag). Setelah migrasi selesai, semua baris sudah punya tag dan
    // baris NULL tidak akan muncul lagi — filter ini aman dipakai permanen.
    const tagFilter = window.tagOrFilter(tag);
    // [PERF FIX - EGRESS] Sebelumnya baris ini SELALU menarik SELURUH baris
    // settings (semua buku milik akun ini, semua key) pada TIAP pemanggilan --
    // termasuk tiap tick autosync 30 detik (js/app.js, window.startAutoSync)
    // yang jalan terus-menerus selama app terbuka, walau hampir selalu tidak
    // ada apa pun yang berubah sejak pull sebelumnya. Ini penyumbang egress
    // Supabase terbesar untuk tabel `settings` (lihat sql/fix_settings_upsert.sql
    // untuk sisi lain masalah ini -- tabel yang insert-only/menumpuk; PENTING:
    // migrasi itu WAJIB sudah dijalankan di database supaya baris per key
    // benar-benar ke-upsert, bukan cuma numpuk -- kalau belum, jalankan dulu,
    // supaya full pull pertama di bawah juga tidak menarik histori lama yang
    // seharusnya sudah tidak relevan).
    //
    // Fix: cursor incremental sama seperti window.pullFromCloudSilently untuk
    // transaksi (lihat window._maxUpdatedAt, js/transaction.js). Pull PERTAMA
    // di tiap sesi (cursor masih null) tetap full seperti sebelumnya -- supaya
    // semua state yang sudah ada di cloud SEBELUM sesi ini mulai tetap
    // tertangkap. Setelah itu, tiap pull berikutnya cuma minta baris yang
    // updated_at-nya lebih baru dari cursor: kalau memang tidak ada perubahan,
    // Supabase balas array kosong (beberapa byte), bukan seluruh tabel lagi.
    // Ini aman karena tiap `key` settings adalah snapshot JSON MANDIRI (lihat
    // blok pemrosesan 'books'/'budgets'/dst di bawah) -- key yang tidak ikut
    // ter-fetch karena belum berubah memang tidak perlu diproses ulang, cache
    // lokalnya sudah benar. Penghapusan (books, dll) juga tidak bergantung ke
    // "hilang dari full fetch" -- itu lewat key tombstone ('deleted_book_ids')
    // yang sendirinya ikut ter-fetch begitu berubah, jadi tetap aman diproses
    // secara incremental.
    const _settingsCursor = window._lastSettingsSyncTime.global;
    let _settingsQuery = `?order=updated_at.desc${tagFilter}`;
    if (_settingsCursor) _settingsQuery += `&updated_at=gt.${encodeURIComponent(_settingsCursor)}`;
    let allRows = await window.callSupabaseAPI('settings', 'GET', null, _settingsQuery);
    if (allRows && Array.isArray(allRows)) {
        window._lastSettingsSyncTime.global = window._maxUpdatedAt(allRows, _settingsCursor);
        if (window._saveSettingsSyncCursor) window._saveSettingsSyncCursor();
    }

    // [FIX SYNC SHARED BOOK PULL]
    // Pull global/tag rows above cannot see settings rows belonging to shared
    // books because auth.js only upgrades requests to the authenticated JWT
    // path when book_id is present. Fetch shared-book settings explicitly so
    // RLS settings_shared_select can apply, then merge them into the normal
    // pull result. Without this, push succeeds but other devices silently pull
    // an empty result from Supabase.
    const _sharedBookIds = [];
    try {
        const _localBooks = Array.isArray(window.books) ? window.books : [];
        for (const _b of _localBooks) {
            const _id = _b.id || _b.book_id;
            if (_id && window.skIsSharedBookId && window.skIsSharedBookId(_id)) {
                _sharedBookIds.push(_id);
            }
        }
    } catch (e) {}
    if (_sharedBookIds.length) {
        // [PERF FIX] Sama seperti window.pullAllBooksFromCloud (js/transaction.js)
        // -- sebelumnya loop ini menunggu tiap buku bersama SATU-SATU (for-loop
        // + await berurutan), padahal request-nya independen per book_id. Makin
        // banyak buku bersama yang diikuti user, makin lama switchBook()/pull
        // penuh macet nunggu network round-trip demi round-trip. Jalankan
        // paralel lewat Promise.allSettled -- satu buku gagal tetap tidak
        // membatalkan buku lain (sama seperti try/catch per-iterasi yang lama).
        // [PERF FIX - EGRESS] Cursor incremental per buku Bersama, sama alasan
        // & mekanisme seperti cursor `.global` di atas -- pull pertama untuk
        // suatu book_id (belum pernah tersimpan di window._lastSettingsSyncTime.shared)
        // tetap full, supaya histori yang sudah ada di cloud (mis. baru saja
        // gabung buku Bersama yang sudah lama dipakai anggota lain) tetap
        // tertangkap; pull berikutnya untuk book_id yang sama jadi incremental.
        const _sharedRowsResults = await Promise.allSettled(_sharedBookIds.map(function(_bookId) {
            const _sharedCursor = window._lastSettingsSyncTime.shared[_bookId];
            let _sharedQuery = `?book_id=eq.${encodeURIComponent(_bookId)}&order=updated_at.desc`;
            if (_sharedCursor) _sharedQuery += `&updated_at=gt.${encodeURIComponent(_sharedCursor)}`;
            return window.callSupabaseAPI('settings', 'GET', null, _sharedQuery);
        }));
        const _sharedRows = [];
        _sharedRowsResults.forEach(function(_result, _idx) {
            const _bookId = _sharedBookIds[_idx];
            if (_result.status === 'fulfilled' && Array.isArray(_result.value)) {
                _sharedRows.push(..._result.value);
                window._lastSettingsSyncTime.shared[_bookId] = window._maxUpdatedAt(_result.value, window._lastSettingsSyncTime.shared[_bookId]);
            } else if (_result.status === 'rejected') {
                window.skWarn('[Sync] shared book pull failed', _bookId, _result.reason);
            }
        });
        if (_sharedBookIds.length && window._saveSettingsSyncCursor) window._saveSettingsSyncCursor();
        if (Array.isArray(allRows)) allRows = allRows.concat(_sharedRows);
        else allRows = _sharedRows;
    }
    if (allRows && Array.isArray(allRows)) {
        let booksUpdated = false;
        let telegramUpdated = false;
        let budgetUpdated = false;
        let hasStaleRows = false; // ada baris cloud terenkripsi kunci lama
        // ==== FIX: cegah baris riwayat lama menimpa balik data terbaru ====
        // Tabel `settings` di sini TIDAK melakukan upsert sungguhan (lihat
        // callSupabaseAPI: header 'Prefer: resolution=merge-duplicates' tanpa
        // parameter 'on_conflict', dan payload push tidak pernah menyertakan
        // 'id'). Akibatnya SETIAP penyimpanan (books, budgets, dst.) selalu
        // INSERT baris baru, bukan menimpa baris lama -- jadi tabel ini bisa
        // berisi banyak snapshot historis untuk (book_id, key) yang sama.
        // Query di atas sudah diurutkan `updated_at.desc` (terbaru duluan),
        // jadi baris PERTAMA yang ditemukan untuk kombinasi (book_id, key)
        // tertentu adalah yang paling baru -- baris berikutnya untuk
        // kombinasi yang sama WAJIB dilewati, kalau tidak, snapshot lama bisa
        // menimpa balik data terbaru di akhir loop (mis. buku yang sudah
        // dihapus muncul lagi).
        //
        // [PERF FIX] Dedup dilakukan DULU (sinkron, murah) SEBELUM dekripsi,
        // supaya baris snapshot lama yang sudah kalah tidak ikut didekripsi
        // sia-sia. Baris yang lolos dedup baru didekripsi PARALEL lewat
        // Promise.all -- sebelumnya dekripsi jalan satu-satu di dalam for-loop
        // (setiap baris menunggu WebCrypto baris sebelumnya selesai), padahal
        // tabel settings ini insert-only dan terus membengkak seiring waktu,
        // jadi switchBook() (yang memanggil pullAllSettings ini) makin lama
        // makin lambat. Urutan pemrosesan hasil TETAP sama seperti for-loop
        // asli, jadi semua logic key-by-key di bawah tidak berubah perilaku.
        const _seenSettingKeys = new Set();
        const rowsToDecrypt = [];
        for (const row of allRows) {
            // crypto_salt & crypto_check bukan setting JSON terenkripsi biasa
            // (lihat window.pushCryptoSaltCheck) -- jangan diproses di sini,
            // supaya tidak memicu warning dekripsi & JSON.parse yang sia-sia.
            if (row.key === 'crypto_salt' || row.key === 'crypto_check') continue;
            const _rowDedupKey = (row.book_id || '') + '::' + row.key;
            if (_seenSettingKeys.has(_rowDedupKey)) continue; // sudah ada versi lebih baru
            _seenSettingKeys.add(_rowDedupKey);
            rowsToDecrypt.push(row);
        }
        const decryptedValues = await Promise.all(
            rowsToDecrypt.map(row => window._decryptSettingValue(row.value))
        );
        // [FIX BUKU HANTU LINTAS DEVICE] Proses 'deleted_book_ids' LEBIH DULU
        // (union ke tombstone lokal) sebelum blok 'books' di bawah dijalankan,
        // supaya union-merge daftar buku bisa langsung memakai tombstone
        // gabungan terbaru saat memutuskan buku mana yang boleh/tidak boleh
        // dihidupkan kembali dari cloud maupun dipertahankan dari cache lokal.
        for (let _t = 0; _t < rowsToDecrypt.length; _t++) {
            if (rowsToDecrypt[_t].key !== 'deleted_book_ids') continue;
            const _dv = decryptedValues[_t];
            if (_dv === null) continue;
            try {
                const _parsedTomb = JSON.parse(_dv);
                if (Array.isArray(_parsedTomb) && window._loadBookTombstones) {
                    const _localTomb = window._loadBookTombstones();
                    let _tChanged = false;
                    _parsedTomb.forEach(function(id) {
                        if (id && !_localTomb.has(id)) { _localTomb.add(id); _tChanged = true; }
                    });
                    if (_tChanged) window._saveBookTombstones(_localTomb);
                }
            } catch (e) { /* baris rusak, lewati */ }
        }

        for (let _i = 0; _i < rowsToDecrypt.length; _i++) {
            const row = rowsToDecrypt[_i];
            const decryptedValue = decryptedValues[_i];
            let parsed;
            if (row.key === 'deleted_book_ids') continue; // sudah diproses di atas
            if (decryptedValue === null) {
                // Baris ini terenkripsi kunci lama — tandai untuk heal setelah loop.
                hasStaleRows = true;
                continue;
            }
            try { parsed = JSON.parse(decryptedValue); } catch { continue; }
            if (parsed === null || typeof parsed === 'undefined') { continue; } // JSON.parse(null) = null, skip
            if (row.key === 'books' && Array.isArray(parsed) && parsed.length > 0) {
                // [FIX LOST-UPDATE BOOKS LIST] Dulu window.books SELALU
                // ditimpa TOTAL oleh array dari cloud (settings key 'books'
                // memang cuma satu blob JSON, bukan baris per-buku seperti
                // transaksi -- lihat pushSettingBooks). Skenario yang rusak:
                // Device A menambah buku baru lalu push. Device B (belum
                // sempat pull perubahan A) menghapus/mengubah buku lain,
                // lalu ikut push -- push B menimpa TOTAL isi cloud dengan
                // daftarnya sendiri yang tidak tahu-menahu soal buku baru A.
                // Begitu A pull, buku yang baru saja dibuatnya raib begitu
                // saja -- dan lebih parah, cache lokalnya (transaksi,
                // anggaran, log) ikut DIHAPUS oleh kode lama karena
                // "tidak ada di cloud" dulu langsung diartikan "sudah
                // dihapus device lain".
                //
                // FIX: union-merge per id (bukan overwrite total array):
                //  - Ada di cloud & lokal -> pakai field dari cloud (rename
                //    dari device lain menang, sama seperti perilaku lama).
                //  - Ada di cloud saja -> buku baru dari device lain, KECUALI
                //    id ini ada di daftar "baru saja kita hapus sendiri,
                //    push-nya belum ke-confirm" (window._loadBooksPendingDeletes,
                //    diisi oleh markBookPendingDelete di book.js) -- dalam
                //    kasus itu JANGAN dihidupkan lagi, biarkan hilang lokal.
                //  - Ada di lokal saja -> JANGAN dihapus (buku baru yang
                //    belum sempat ke-push, ATAU korban overwrite-total push
                //    device lain). Pertahankan datanya, lalu push ulang di
                //    bawah supaya cloud ikut "sembuh" -- KECUALI kita sendiri
                //    yang barusan menghapusnya (ada di pending-delete): baru
                //    di situ aman membersihkan cache lokal terkait buku itu,
                //    karena sekarang benar-benar terkonfirmasi hilang juga
                //    di cloud.
                const localById = {};
                window.books.forEach(b => { localById[b.id] = b; });
                const pendingDeletes = window._loadBooksPendingDeletes ? window._loadBooksPendingDeletes() : new Set();
                // [FIX BUKU HANTU LINTAS DEVICE] Beda dari pendingDeletes (cuma
                // dikenal device yang menghapus, dibersihkan setelah push
                // terkonfirmasi), tombstones ini permanen & union dari cloud
                // (lihat blok 'deleted_book_ids' di atas) -- berlaku untuk
                // SEMUA device begitu tersinkron, tidak peduli device mana yang
                // menghapusnya.
                const tombstones = window._loadBookTombstones ? window._loadBookTombstones() : new Set();
                // b_default adalah placeholder yang dibuat versi lama saat
                // perangkat baru belum sempat menarik daftar buku cloud.
                // Jika cloud sudah punya buku lain namun b_default tidak ada
                // di sana, anggap ia sisa bootstrap lokal, bukan buku baru
                // yang harus di-union lalu dikirim ulang ke cloud.
                const cloudHasRealBook = parsed.some(function(book) { return book && book.id !== 'b_default'; });
                let changed = false;
                let needsHealPush = false;
                const merged = [];
                const seenIds = new Set();

                parsed.forEach(cb => {
                    // Bersihkan placeholder default lama yang sudah sempat
                    // ter-push oleh perangkat baru. Hanya nama bootstrap
                    // standar yang dibuang, dan hanya jika cloud jelas punya
                    // buku lain; buku b_default yang masih menjadi satu-satunya
                    // buku tetap aman untuk kompatibilitas instalasi lama.
                    if (cloudHasRealBook && cb.id === 'b_default' && /^(Buku Utama|Buku Umum)$/i.test(String(cb.name || '').trim())) {
                        changed = true;
                        needsHealPush = true;
                        return;
                    }
                    seenIds.add(cb.id);
                    const lb = localById[cb.id];
                    // [FIX BUG #4] `cb` (baris dari cloud) bisa membawa
                    // `_isShared`/`_role` basi kalau blob 'books' lama
                    // sempat ter-push sebelum fix di pushSettingBooks (yang
                    // sekarang membuang field ini). Field-field itu
                    // menggambarkan SESI LOGIN Buku Bersama di device yang
                    // mem-push-nya dulu, bukan status di device ini --
                    // jangan pernah dipakai dari cloud. Satu-satunya sumber
                    // kebenaran untuk status shared/role adalah
                    // window._skSharedRoles (diisi skRefreshSharedAccess di
                    // js/auth.js). Di sini kita buang field itu dari `cb`,
                    // lalu (kalau ada) pertahankan nilai yang SUDAH ada di
                    // window.books lokal saat ini (`lb`) -- karena itu hasil
                    // skRefreshSharedAccess yang sudah jalan di sesi ini,
                    // lebih baru & lebih valid daripada apa pun dari cloud.
                    delete cb._isShared;
                    delete cb._role;
                    if (lb && lb._isShared) {
                        cb._isShared = lb._isShared;
                        cb._role = lb._role;
                    }
                    if (!lb) {
                        if (pendingDeletes.has(cb.id) || tombstones.has(cb.id)) {
                            // Kita sendiri baru saja menghapus buku ini secara
                            // lokal (pendingDeletes), ATAU buku ini pernah
                            // ditombstone permanen -- device manapun yang
                            // menghapusnya (tombstones) -- baik cloud belum
                            // sempat ter-update maupun baris 'books' cloud ini
                            // kebetulan snapshot basi: jangan hidupkan lagi.
                            changed = true;
                            needsHealPush = true;
                        } else {
                            merged.push(cb);
                            changed = true;
                        }
                    } else if (tombstones.has(cb.id)) {
                        // Buku ini ada di cloud & cache lokal, TAPI ternyata
                        // sudah ditombstone permanen (mis. tombstone-nya baru
                        // saja diterima di pull ini, dari device lain yang
                        // menghapusnya) -- jangan pertahankan, biarkan hilang.
                        changed = true;
                        needsHealPush = true;
                    } else {
                        if (lb.name !== cb.name || lb.parentId !== cb.parentId) changed = true;
                        merged.push(cb);
                    }
                });

                window.books.forEach(lb => {
                    if (seenIds.has(lb.id)) return; // sudah diproses di atas
                    if (lb.id === 'b_default' && cloudHasRealBook) {
                        window.skLog('[Sync] Menghapus placeholder b_default yang tidak ada di cloud.');
                        changed = true;
                        return;
                    }
                    if (pendingDeletes.has(lb.id) || tombstones.has(lb.id)) {
                        // Penghapusan buku ini sekarang terkonfirmasi juga
                        // hilang di cloud -- baru di sini aman membersihkan
                        // cache lokal terkait buku itu.
                        window.skLog('[Sync] Penghapusan buku terkonfirmasi cloud, bersihkan cache lokal:', lb.name);
                        localStorage.removeItem('sk_txs_' + lb.id);
                        localStorage.removeItem('sk_budgets_' + lb.id);
                        localStorage.removeItem('sk_logs_' + lb.id);
                        localStorage.removeItem('sk_default_budget_' + lb.id);
                        if (window.clearBookPendingDelete) window.clearBookPendingDelete(lb.id);
                        changed = true;
                    } else {
                        // Ada di lokal, tidak ada di cloud, dan KITA TIDAK
                        // PERNAH menghapusnya -- buku belum sempat ke-push
                        // atau korban overwrite-total push device lain.
                        // Pertahankan datanya, push ulang supaya cloud ikut
                        // sinkron dengan keberadaan buku ini.
                        merged.push(lb);
                        needsHealPush = true;
                    }
                });

                if (changed) {
                    window.books = merged;
                    localStorage.setItem('sk_books', JSON.stringify(window.books));
                    booksUpdated = true;
                    if (!window.books.find(b => b.id === window.currentBookId) && window.books.length > 0) {
                        window.currentBookId = window.books[0].id;
                        localStorage.setItem('sk_current_book_id', window.currentBookId);
                    } else if (window.books.length === 0 && typeof window._promptCreateFirstBookIfEmpty === 'function') {
                        window._promptCreateFirstBookIfEmpty();
                    }
                    if (needsHealPush && window.isOnline()) {
                        window.skLog('[Sync] Menyembuhkan daftar buku di cloud (union-merge lokal vs cloud)...');
                        window.pushSettingBooks();
                    }
                }
            }
            if (row.key === 'harga_komoditas_manual') {
                // Merge per-slug (bukan timpa total) -- lihat catatan lengkap
                // di window._hkMergeManualFromCloud (js/harga-pangan.js).
                const _hkChanged = window._hkMergeManualFromCloud && window._hkMergeManualFromCloud(parsed);
                if (_hkChanged && typeof window.renderHargaKomoditasModal === 'function') {
                    window.renderHargaKomoditasModal(); // no-op aman kalau modalnya sedang tidak terbuka
                }
            }
            if (row.key === 'telegram_config') {
                // Simpan ke encrypted storage, bukan plain-text
                await window.saveTelegramConfigEncrypted(
                    parsed.token  || '',
                    parsed.chatId || '',
                    parsed.edgeUrl || ''
                );
                telegramUpdated = true;
                window.updateTgStatusBadge();
            }
            if (row.key === 'budgets') {
                // Guard: pastikan parsed adalah object valid, bukan null/primitive
                const safeParsed = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
                localStorage.setItem('sk_budgets_' + row.book_id, JSON.stringify(safeParsed));
                if (row.book_id === window.currentBookId) {
                    window.budgets = safeParsed;
                    budgetUpdated = true;
                }
            }
            if (row.key === 'default_budget') {
                window.saveDefaultBudgetToLocal(row.book_id, parsed);
                if (row.book_id === window.currentBookId) {
                    budgetUpdated = true;
                }
            }
            if (row.key === 'annual_budget') {
                window.saveAnnualBudgetToLocal(row.book_id, parsed);
                if (row.book_id === window.currentBookId) {
                    budgetUpdated = true;
                }
            }
            if (row.key === 'emergency_fund_months') {
                const months = parseInt(parsed);
                if (!isNaN(months) && months > 0) {
                    localStorage.setItem('sk_emergency_fund_months_' + row.book_id, String(months));
                    if (row.book_id === window.currentBookId) {
                        budgetUpdated = true;
                    }
                }
            }
            if (row.key === 'hidden_cards') {
                if (Array.isArray(parsed)) {
                    localStorage.setItem('sk_hidden_cards_' + row.book_id, JSON.stringify(parsed));
                    if (row.book_id === window.currentBookId) {
                        budgetUpdated = true;
                    }
                }
            }
            if (row.key === 'shopping_list') {
                if (Array.isArray(parsed)) {
                    localStorage.setItem('sk_shopping_list_' + row.book_id, JSON.stringify(parsed));
                    // Render ulang hanya kalau modalnya sedang terbuka untuk buku aktif
                    // (sama seperti guard di window.switchBook, js/book.js).
                    if (row.book_id === window.currentBookId) {
                        const modalEl = document.getElementById('shoppingListModal');
                        if (modalEl && modalEl.classList.contains('show') && typeof window.renderShoppingList === 'function') {
                            window.renderShoppingList();
                        }
                    }
                }
            }
            if (row.key === 'shopping_list_income') {
                // Pemasukan bulanan yang diinput di card "Proyeksi Keuangan"
                // (Belanja Bulanan, js/shopping-list.js) -- pola sama seperti
                // 'emergency_fund_months' di atas (angka tunggal per buku).
                // Beda dengan months, income boleh 0 (artinya belum diisi/
                // sengaja dikosongkan), bukan ditolak seperti months<=0.
                const income = Number(parsed);
                if (!isNaN(income) && income >= 0) {
                    localStorage.setItem('sk_shopping_list_income_' + row.book_id, String(income));
                    if (row.book_id === window.currentBookId) {
                        const modalEl = document.getElementById('shoppingListModal');
                        if (modalEl && modalEl.classList.contains('show') && typeof window.renderShoppingList === 'function') {
                            window.renderShoppingList();
                        }
                    }
                }
            }
            if (row.key === 'menu_plan') {
                if (parsed && typeof parsed === 'object') {
                    localStorage.setItem('sk_menu_plan_' + row.book_id, JSON.stringify(parsed));
                    if (row.book_id === window.currentBookId) {
                        const modalEl = document.getElementById('menuPlanModal');
                        if (modalEl && modalEl.classList.contains('show') && typeof window.renderMenuPlan === 'function') {
                            window.renderMenuPlan();
                        }
                    }
                }
            }
            if (row.key === 'electricity_plan') {
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.meters)) {
                    localStorage.setItem('sk_electricity_plan_' + row.book_id, JSON.stringify(parsed));
                    if (row.book_id === window.currentBookId) {
                        const modalEl = document.getElementById('electricityPlanModal');
                        if (modalEl && modalEl.classList.contains('show') && typeof window.renderElectricityPlan === 'function') {
                            window.renderElectricityPlan();
                        }
                    }
                }
            }
            if (row.key === 'fase_kehidupan') {
                if (parsed && typeof parsed === 'object') {
                    // [FIX CLOCK SKEW] Sebelumnya perbandingan "versi mana yang
                    // menang" pakai parsed.updatedAt -- field DI DALAM JSON,
                    // di-set dari jam DEVICE saat disimpan (new Date() di
                    // render.js). Field itu tidak ke-cover trigger DB (trigger
                    // cuma menjamin kolom updated_at di level BARIS, bukan isi
                    // JSON-nya), jadi bug clock-skew yang sama seperti pada
                    // transaksi/settings lain masih bisa terjadi di sini.
                    // Sekarang pakai row.updated_at -- kolom asli tabel
                    // `settings`, sudah dijamin server (lihat
                    // sql/fix_server_side_updated_at.sql) -- dan disimpan
                    // sebagai _serverUpdatedAt di cache lokal supaya
                    // perbandingan berikutnya (termasuk saat push, lihat
                    // saveFaseKehidupan di render.js) konsisten pakai jam yang
                    // sama untuk semua device.
                    const localRaw = localStorage.getItem('sk_fase_kehidupan_' + row.book_id);
                    const localFase = localRaw ? JSON.parse(localRaw) : null;
                    const localServerTime = localFase && localFase._serverUpdatedAt;
                    if (!localFase || !localServerTime || row.updated_at > localServerTime) {
                        localStorage.setItem('sk_fase_kehidupan_' + row.book_id, JSON.stringify({ ...parsed, _serverUpdatedAt: row.updated_at }));
                        if (row.book_id === window.currentBookId) {
                            budgetUpdated = true;
                        }
                    }
                }
            }
            if (row.key === 'google_sheets_url') {
                if (typeof parsed === 'string' && parsed) {
                    localStorage.setItem('sk_google_sheets_url', parsed);
                    const gsInput = document.getElementById('googleSheetsUrlInput');
                    if (gsInput) gsInput.value = parsed;
                } else {
                    localStorage.removeItem('sk_google_sheets_url');
                }
            }
            // [SYNC MULTI-DEVICE] Alamat API/worker berikut sebelumnya cuma
            // tersimpan di localStorage per perangkat (harus diketik ulang
            // manual tiap ganti/tambah device) -- lihat pasangan push-nya di
            // window.saveAiWorkerUrl (js/ai.js), window.saveEmasApiKey
            // (js/forex.js), dan window.saveHargaPanganWorkerUrl
            // (js/settings.js). Sama seperti google_sheets_url di atas:
            // string kosong dari cloud berarti "sudah dihapus di device
            // lain" -> ikut dihapus juga di sini.
            if (row.key === 'ai_worker_url') {
                if (typeof parsed === 'string' && parsed) {
                    localStorage.setItem('sk_ai_worker_url', parsed);
                } else {
                    localStorage.removeItem('sk_ai_worker_url');
                }
                const workerInp = document.getElementById('aiWorkerUrlInput');
                if (workerInp) workerInp.value = localStorage.getItem('sk_ai_worker_url') || '';
                if (typeof window.updateAiWorkerBadge === 'function') window.updateAiWorkerBadge();
            }
            if (row.key === 'ai_engine') {
                // [SYNC MULTI-DEVICE] Pilihan mesin AI ('worker'/'gemini',
                // lihat window.setAIEngine di js/ai.js) ikut disamakan di
                // semua perangkat, sama seperti ai_worker_url di atas.
                if (parsed === 'gemini' || parsed === 'worker') {
                    localStorage.setItem('sk_ai_engine', parsed);
                } else {
                    localStorage.removeItem('sk_ai_engine');
                }
                if (typeof window.updateAiWorkerBadge === 'function') window.updateAiWorkerBadge();
            }
            if (row.key === 'emas_api_key') {
                if (typeof parsed === 'string' && parsed) {
                    localStorage.setItem('sk_emas_api_key', parsed);
                } else {
                    localStorage.removeItem('sk_emas_api_key');
                }
                const emasInp = document.getElementById('emasApiKeyInput');
                if (emasInp) emasInp.value = localStorage.getItem('sk_emas_api_key') || '';
                if (typeof window.updateEmasApiBadge === 'function') window.updateEmasApiBadge();
                if (typeof window.fetchGoldPrice === 'function') window.fetchGoldPrice();
            }
            if (row.key === 'emas_gram') {
                const gramNum = parseFloat(parsed);
                if (!isNaN(gramNum) && gramNum > 0) {
                    localStorage.setItem('sk_emas_gram', String(gramNum));
                } else {
                    localStorage.removeItem('sk_emas_gram');
                }
                const emasGramInp = document.getElementById('emasGramInput');
                if (emasGramInp) emasGramInp.value = localStorage.getItem('sk_emas_gram') || '';
                if (typeof window.updateEmasGramPreview === 'function') window.updateEmasGramPreview();
            }
            if (row.key === 'harga_pangan_worker_url') {
                if (typeof parsed === 'string' && parsed) {
                    localStorage.setItem('sk_harga_pangan_worker_url', parsed);
                } else {
                    localStorage.removeItem('sk_harga_pangan_worker_url');
                }
                const hpwInp = document.getElementById('hargaPanganWorkerUrlInput');
                if (hpwInp) hpwInp.value = localStorage.getItem('sk_harga_pangan_worker_url') || '';
                if (typeof window.updateHargaPanganWorkerBadge === 'function') window.updateHargaPanganWorkerBadge();
            }
        }
        if (booksUpdated) {
            window.updateBookSelectDropdown();
        }
        if (budgetUpdated) {
            window.renderBudget();
            window.updateFinancialCards && window.updateFinancialCards();
            if (typeof window.updateFaseCard === 'function') window.updateFaseCard();
            if (typeof window.renderForecastCard === 'function') window.renderForecastCard();
            if (document.getElementById('budgetModal').classList.contains('show')) {
                window.renderBudgetFormFields();
            }
        }
        // Ada baris cloud yang terenkripsi kunci lama dan tidak bisa didekripsi.
        // Push ulang semua setting dari localStorage ke cloud dengan kunci sesi saat ini,
        // supaya baris-baris itu tertimpa dan pull berikutnya tidak memicu warning lagi.
        if (hasStaleRows && window._sessionCryptoKey) {
            window.skLog('[Sync] Terdeteksi data cloud kunci lama — memulai re-enkripsi otomatis...');
            window.reEncryptAllCloudSettings().then(() => {
                window.skLog('[Sync] Re-enkripsi otomatis selesai. Pull berikutnya tidak akan ada warning kunci lama.');
            }).catch(e => {
                window.skWarn('[Sync] Re-enkripsi otomatis gagal:', e);
            });
        }

    }
    window.updateSettingsSyncStatus('pull');
};

// ==================== BOOKS: PERMANENT DELETE TOMBSTONE (LINTAS DEVICE) ====================
// [FIX BUKU HANTU LINTAS DEVICE] window._loadBooksPendingDeletes di bawah
// cuma mencegah buku yang baru dihapus "hidup lagi" gara-gara PULL di device
// YANG SAMA yang menghapusnya -- begitu marker itu dibersihkan (push delete
// sudah dikonfirmasi), device LAIN yang kebetulan masih membawa cache
// window.books versi lama (mis. device yang lama tidak dibuka/sempat offline
// sejak sebelum penghapusan) tetap bisa menimpa balik daftar buku di cloud
// dan menghidupkan lagi buku yang sudah dihapus -- karena pushSettingBooks()
// selama ini SELALU mengirim window.books milik device itu apa adanya, tanpa
// tahu buku mana yang sudah "resmi" dihapus oleh device lain. Ini penyebab
// utama laporan "buku yang sudah dihapus muncul lagi, kadang jadi double"
// tiap login di perangkat/akun baru.
//
// Fix: simpan daftar ID buku yang PERNAH dihapus permanen -- TIDAK PERNAH
// dibersihkan/expired (beda dari pending-delete di atas) -- dan sinkronkan
// ke cloud lewat setting 'deleted_book_ids' (union-merge, cuma bertambah).
// Dipakai di 2 titik:
//   1. pushSettingBooks() MEMBUANG dulu id mana pun yang ada di tombstone
//      SEBELUM mengirim window.books ke cloud -- device manapun yang masih
//      membawa cache lama buku yang sudah dihapus tidak akan pernah bisa
//      menghidupkannya lagi lewat push-nya sendiri.
//   2. Union-merge saat pull (blok row.key === 'books' di bawah) -- id yang
//      ada di tombstone tidak akan pernah di-revive dari cloud maupun
//      dipertahankan dari cache lokal.
window._booksTombstoneKey = 'sk_books_tombstone';

// [UI] Tidak ada aturan "setiap akun wajib minimal 1 buku utama" di
// aplikasi ini -- window.books memang boleh kosong (mis. semua buku dihapus,
// akses buku bersama terakhir dicabut, atau akun baru yang belum pernah
// membuat buku). Beberapa alur (switchBook otomatis ke buku lain saat buku
// aktif hilang) sengaja hanya jalan kalau window.books.length > 0; kalau
// sampai 0, currentBookId bisa menggantung menunjuk buku yang sudah tidak
// ada. Dashboard (render()) tetap aman dipanggil dalam kondisi ini (tidak
// crash, cuma menampilkan 0/kosong), tapi user tidak diberi tahu KENAPA --
// helper ini memberi penjelasan eksplisit & mengarahkan ke form buat buku.
window._promptCreateFirstBookIfEmpty = function() {
    if (Array.isArray(window.books) && window.books.length > 0) return;
    if (window.showToast) {
        window.showToast('Semua buku sudah tidak ada. Buat buku baru untuk melanjutkan.', 'warning');
    }
    if (typeof window.openBookManager === 'function') {
        window.openBookManager();
    }
};

window._loadBookTombstones = function() {
    try { return new Set(JSON.parse(localStorage.getItem(window._booksTombstoneKey) || '[]')); }
    catch (e) { return new Set(); }
};
window._saveBookTombstones = function(idSet) {
    try { localStorage.setItem(window._booksTombstoneKey, JSON.stringify(Array.from(idSet))); }
    catch (e) { /* localStorage penuh/nonaktif -- tetap dicoba lagi sesi ini */ }
};
// Dipanggil window.deleteBook (book.js) begitu sebuah buku resmi dihapus.
window.addBookTombstone = function(id) {
    const s = window._loadBookTombstones();
    if (!s.has(id)) {
        s.add(id);
        window._saveBookTombstones(s);
    }
};
// Push tombstone lokal ke cloud. Best-effort & idempotent -- aman dipanggil
// berkali-kali, tidak pernah menghapus entri tombstone milik device lain
// karena Supabase-side ini cuma satu array JSON yang di-UNION dulu di sisi
// klien sebelum dikirim (lihat pemrosesan row.key === 'deleted_book_ids' di
// pullAllSettings), bukan overwrite buta.
window.pushBookTombstones = async function() {
    if (!window.isOnline()) return false;
    const local = window._loadBookTombstones();
    if (local.size === 0) return true;
    const result = await window.pushSetting('deleted_book_ids', Array.from(local), 'global');
    return !!result;
};

// ==================== BOOKS: PENDING-DELETE TRACKING ====================
// [FIX BOOKS LOST-UPDATE] Dipakai oleh union-merge daftar buku di
// pullAllSettings (lihat blok row.key === 'books' di atas) supaya bisa
// membedakan 2 kondisi yang keduanya terlihat sama ("buku ada di lokal,
// tidak ada di cloud"):
//   1. Buku itu baru dibuat lokal & belum sempat ke-push (atau ke-drop
//      gara-gara push penuh device lain menimpa total daftar cloud) ->
//      HARUS dipertahankan, jangan dianggap terhapus.
//   2. Kita sendiri yang baru saja menghapus buku itu (deleteBook di
//      book.js), push penghapusannya cuma belum sempat ke-confirm ke cloud
//      (offline sesaat/gagal jaringan) -> JANGAN dihidupkan lagi kalau
//      cloud pull berikutnya kebetulan masih menunjukkan buku itu ada
//      (mis. push sebelumnya gagal separuh jalan).
// Tanpa pembeda ini, fix union-merge yang "mempertahankan buku lokal-saja"
// akan salah menghidupkan kembali buku yang justru sengaja dihapus user.
window._booksPendingDeleteKey = 'sk_books_delete_pending';

window._loadBooksPendingDeletes = function() {
    try { return new Set(JSON.parse(localStorage.getItem(window._booksPendingDeleteKey) || '[]')); }
    catch (e) { return new Set(); }
};
window._saveBooksPendingDeletes = function(idSet) {
    try { localStorage.setItem(window._booksPendingDeleteKey, JSON.stringify(Array.from(idSet))); }
    catch (e) { /* localStorage penuh/nonaktif -- tetap dicoba lagi sesi ini */ }
};
window.markBookPendingDelete = function(id) {
    const s = window._loadBooksPendingDeletes();
    s.add(id);
    window._saveBooksPendingDeletes(s);
};
window.clearBookPendingDelete = function(id) {
    const s = window._loadBooksPendingDeletes();
    if (s.delete(id)) window._saveBooksPendingDeletes(s);
};

// Dipanggil saat app start & setiap kali koneksi online lagi (lihat app.js),
// pola sama seperti window.flushPendingDeletesOnStart untuk transaksi.
// window.books di localStorage (sk_books) sudah benar (buku terhapus sudah
// di-filter keluar oleh deleteBook SEBELUM fungsi ini dipanggil) -- yang
// perlu diselesaikan cuma memastikan cloud ikut menerima daftar terbaru itu
// kalau push sebelumnya sempat gagal/terputus.
window.flushPendingBookDeletesOnStart = async function() {
    if (!window.isOnline()) return;
    const pending = window._loadBooksPendingDeletes();
    if (pending.size === 0) return;
    const ok = await window.pushSettingBooks();
    if (ok) {
        pending.forEach(id => window.clearBookPendingDelete(id));
    }
};

window.updateSettingsSyncStatus = function(direction) {
    const el = document.getElementById('settingsSyncStatus');
    if (!el) return;
    const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const label = direction === 'pull' ? 'Ditarik dari cloud' : 'Disimpan ke cloud';
    el.innerText = `Terakhir ${label}: ${now}`;
};

// ==================== MIGRASI ACCOUNT_TAG ====================
// Dipanggil satu kali saat pertama kali user membuka app setelah update
// ============================================================
// DB.JS - FUNGSI KHUSUS UNTUK PAYMENT REMINDERS
// ============================================================

// ── PUSH PAYMENT REMINDER KE CLOUD ──
window.pushPaymentReminderToCloud = async function(bookId, reminderData) {
    if (!window.isOnline() || !bookId) return false;
    
    try {
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        // (fungsi ini tampaknya tidak lagi dipanggil di mana pun, sudah
        // digantikan window.savePaymentReminder di payment-reminder.js,
        // tapi tetap dipertahankan untuk berjaga-jaga.)
        const payload = { ...reminderData, book_id: bookId, updated_at: new Date().toISOString(), ...(tag ? { account_tag: tag } : {}) };
        
        const result = await window.callSupabaseAPI('payment_reminders', 'POST', [payload]);
        return !!result;
    } catch (e) {
        console.error('[DB] Gagal push payment reminder:', e);
        return false;
    }
};

// ── PULL PAYMENT REMINDER DARI CLOUD ──
window.pullPaymentRemindersFromCloud = async function(bookId) {
    if (!window.isOnline() || !bookId) return null;
    
    try {
        const result = await window.callSupabaseAPI(
            'payment_reminders',
            'GET',
            null,
            `?book_id=eq.${bookId}&order=created_at.desc${window.tagOrFilter(window.getAccountTag ? window.getAccountTag() : null, bookId)}`
        );
        
        if (result && Array.isArray(result)) {
            localStorage.setItem('sk_payment_reminders_' + bookId, JSON.stringify(result));
            return result;
        }
        return null;
    } catch (e) {
        console.error('[DB] Gagal pull payment reminders:', e);
        return null;
    }
};

// ── DELETE PAYMENT REMINDER DARI CLOUD ──
window.deletePaymentReminderFromCloud = async function(reminderId, bookId) {
    if (!window.isOnline() || !bookId) return false;
    
    try {
        const result = await window.callSupabaseAPI(
            'payment_reminders',
            'DELETE',
            null,
            `?id=eq.${reminderId}&book_id=eq.${bookId}${(window.getAccountTag && window.getAccountTag()) ? '&account_tag=eq.' + window.getAccountTag() : ''}`
        );
        return !!result;
    } catch (e) {
        console.error('[DB] Gagal delete payment reminder:', e);
        return false;
    }
};
