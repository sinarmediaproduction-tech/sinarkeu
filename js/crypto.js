// ==================== CRYPTO ENGINE ====================
window.deriveKey = async function(password, saltBuf) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBuf, iterations: 300000, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

window.encryptStr = async function(cryptoKey, plaintext) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.encode(plaintext));
    const combined = new Uint8Array(iv.byteLength + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.byteLength);
    return btoa(String.fromCharCode(...combined));
};

window.decryptStr = async function(cryptoKey, b64) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = bytes.slice(0, 12);
    const ct = bytes.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
    return new TextDecoder().decode(plain);
};

window.isPasswordConfigured = function() {
    return !!localStorage.getItem('sk_crypto_check');
};

window.saveEncryptedCredentials = async function(cryptoKey, url, apiKey) {
    const encUrl = await window.encryptStr(cryptoKey, url);
    const encAKey = await window.encryptStr(cryptoKey, apiKey);
    const encCheck = await window.encryptStr(cryptoKey, 'sinarkeu_ok');
    localStorage.setItem('sk_enc_supabase_url', encUrl);
    localStorage.setItem('sk_enc_supabase_key', encAKey);
    localStorage.setItem('sk_crypto_check', encCheck);
};

window.unlockWithPassword = async function(password) {
    const saltB64 = localStorage.getItem('sk_crypto_salt');
    if (!saltB64) return false;
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    let key;
    try {
        key = await window.deriveKey(password, salt);
        const plain = await window.decryptStr(key, localStorage.getItem('sk_crypto_check'));
        if (plain !== 'sinarkeu_ok') return false;
    } catch { return false; }
    let url, apiKey;
    try {
        url = await window.decryptStr(key, localStorage.getItem('sk_enc_supabase_url'));
        apiKey = await window.decryptStr(key, localStorage.getItem('sk_enc_supabase_key'));
    } catch { return false; }

    // ==================== VERIFIKASI KE CLOUD (PASSWORD TERBARU) ====================
    // Cache lokal (sk_crypto_check) di device ini bisa jadi sudah USANG kalau
    // password sudah diganti dari device lain (rotatePasswordKeepingSalt hanya
    // meng-overwrite crypto_check di CLOUD, tidak mendorong perubahan ke device
    // lain -- lihat komentar di rotatePasswordKeepingSalt). Karena salt TIDAK
    // pernah berubah saat ganti password, url/apiKey di atas tetap valid untuk
    // dipakai menghubungi cloud yang sama walau password sudah lama.
    //
    // Begitu url berhasil didekripsi, langsung tanya ke cloud: crypto_check
    // TERBARU yang mana? Kalau derived key dari password yang baru dimasukkan
    // TIDAK cocok dengan crypto_check terbaru itu, berarti password ini sudah
    // tidak berlaku lagi (sudah diganti dari device lain) -> tolak login,
    // walau cache lokal device ini masih menganggapnya benar.
    if (window.isOnline()) {
        const prevUrl = window.globalSupabaseUrl, prevKey = window.globalSupabaseKey;
        window.globalSupabaseUrl = url;
        window.globalSupabaseKey = apiKey;
        try {
            const cloud = await window.pullCryptoSaltCheck();
            if (cloud && cloud.check) {
                let cloudPlain = null;
                try { cloudPlain = await window.decryptStr(key, cloud.check); } catch { cloudPlain = null; }
                if (cloudPlain !== 'sinarkeu_ok') {
                    // Password sudah tidak sinkron dengan yang terbaru di cloud.
                    window.globalSupabaseUrl = prevUrl; window.globalSupabaseKey = prevKey;
                    return false;
                }
                // Sinkronkan cache lokal ke versi cloud terbaru supaya percobaan
                // login berikutnya (termasuk saat offline) memakai nilai yang benar.
                if (cloud.check !== localStorage.getItem('sk_crypto_check')) {
                    localStorage.setItem('sk_crypto_check', cloud.check);
                }
            }
            // cloud null (belum pernah push / baris tidak ditemukan) -> anggap
            // device ini sumber kebenaran, lanjut pakai cache lokal seperti biasa.
        } catch (e) {
            console.warn('[Crypto] Gagal verifikasi password ke cloud, lanjut pakai cache lokal (mode offline-fallback):', e);
        }
    }

    window.globalSupabaseUrl = url;
    window.globalSupabaseKey = apiKey;
    window._sessionCryptoKey = key;
    sessionStorage.setItem('sk_session_unlocked', '1');
    sessionStorage.setItem('sk_session_url', window.globalSupabaseUrl);
    sessionStorage.setItem('sk_session_akey', window.globalSupabaseKey);
    sessionStorage.setItem('sk_session_ts', Date.now().toString());
    window._storeSessionPassword(password);
    return true;
};

// Simpan hasil window.bootstrapCryptoForBackend() ke localStorage perangkat
// ini (sk_crypto_salt + kredensial terenkripsi) dan aktifkan sesi.
window.persistBootstrappedCrypto = async function(boot, url, apiKey, password) {
    localStorage.setItem('sk_crypto_salt', boot.saltB64);
    await window.saveEncryptedCredentials(boot.key, url, apiKey);
    window._sessionCryptoKey = boot.key;
    sessionStorage.setItem('sk_session_unlocked', '1');
    sessionStorage.setItem('sk_session_url', url);
    sessionStorage.setItem('sk_session_akey', apiKey);
    sessionStorage.setItem('sk_session_ts', Date.now().toString());
    if (password) window._storeSessionPassword(password);
};

window.setupNewPassword = async function(password, url, apiKey) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem('sk_crypto_salt', btoa(String.fromCharCode(...salt)));
    const key = await window.deriveKey(password, salt);
    await window.saveEncryptedCredentials(key, url, apiKey);
    window._sessionCryptoKey = key;
    sessionStorage.setItem('sk_session_unlocked', '1');
    sessionStorage.setItem('sk_session_url', url);
    sessionStorage.setItem('sk_session_akey', apiKey);
    sessionStorage.setItem('sk_session_ts', Date.now().toString());
};

// ==================== MULTI-DEVICE: JOIN ATAU BUAT KUNCI BARU ====================
// Dipakai saat menyambungkan SATU backend Supabase tertentu untuk pertama
// kalinya DI PERANGKAT INI (first-time setup / tambah akun baru). Daripada
// langsung generate salt acak (yang membuat tiap perangkat punya AES key
// berbeda walau password sama -- lihat diskusi sebelumnya), fungsi ini:
//   1. Cek ke cloud (tabel `settings`, key 'crypto_salt' & 'crypto_check')
//      apakah backend ini SUDAH pernah disetup dari perangkat lain.
//   2a. Kalau SUDAH ADA -> turunkan key dari password yang diketik + salt
//       cloud, lalu verifikasi ke 'crypto_check' cloud. Cocok berarti
//       password yang dimasukkan SAMA dengan yang dipakai perangkat lain,
//       dan perangkat ini akan memakai AES key yang IDENTIK -> semua isi
//       `settings` (books, budgets, telegram_config, dst.) langsung bisa
//       saling terbaca lintas perangkat.
//       Tidak cocok -> lempar Error dengan .code = 'PASSWORD_MISMATCH'.
//   2b. Kalau BELUM ADA SAMA SEKALI -> backend baru, generate salt+check
//       baru lalu push ke cloud supaya perangkat berikutnya yang join bisa
//       memakai salt yang sama.
// Mengembalikan { key, saltB64, checkB64, joined } -- pemanggil yang
// menyimpannya ke localStorage (lihat doFirstTimeSetup di settings.js).
window.bootstrapCryptoForBackend = async function(password, url, apiKey) {
    window.globalSupabaseUrl = url;
    window.globalSupabaseKey = apiKey;
    // PENTING: pakai varian STRICT di sini, bukan window.pullCryptoSaltCheck()
    // biasa. Varian biasa mengembalikan null baik saat cloud memang kosong
    // MAUPUN saat pengecekan gagal (offline/network error) -- ambigu, dan kalau
    // dipakai di sini bisa membuat device yang sebenarnya cuma gagal konek
    // keliru mengira dirinya "device pertama" lalu generate salt sendiri yang
    // berbeda dari salt asli yang sudah ada di cloud. Varian strict melempar
    // Error untuk kasus gagal-cek, jadi setup BERHENTI dengan pesan jelas
    // alih-alih diam-diam membuat akun yang tidak bisa sinkron dengan device lain.
    const cloud = await window.pullCryptoSaltCheckStrict();
    if (cloud) {
        const salt = Uint8Array.from(atob(cloud.salt), c => c.charCodeAt(0));
        const key = await window.deriveKey(password, salt);
        let plain = null;
        try { plain = await window.decryptStr(key, cloud.check); } catch { plain = null; }
        if (plain !== 'sinarkeu_ok') {
            const err = new Error('Password tidak cocok dengan akun yang sudah tersambung di backend ini.');
            err.code = 'PASSWORD_MISMATCH';
            throw err;
        }
        return { key, saltB64: cloud.salt, checkB64: cloud.check, joined: true };
    }
    // Sampai di sini HANYA kalau pullCryptoSaltCheckStrict() sukses mengecek dan
    // memang tidak menemukan baris apa pun -- baru aman generate salt baru.
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = btoa(String.fromCharCode(...saltBytes));
    const key = await window.deriveKey(password, saltBytes);
    const checkB64 = await window.encryptStr(key, 'sinarkeu_ok');
    await window.pushCryptoSaltCheck(saltB64, checkB64);
    return { key, saltB64, checkB64, joined: false };
};

// ==================== MULTI-DEVICE: GANTI PASSWORD TANPA UBAH SALT ====================
// changePassword() (settings.js) & edit kredensial akun aktif (account.js)
// dulu memanggil setupNewPassword(), yang SELALU generate salt baru. Itu
// memutus perangkat lain yang sudah join: salt mereka jadi tidak relevan
// lagi, dan baris `settings` lama di cloud terkunci kunci lama selamanya
// (lihat window.reEncryptAllCloudSettings di db.js, yang menutup separuh
// masalah ini -- tapi tidak menyelesaikan ketidakcocokan salt antar device).
//
// Fungsi ini SENGAJA mempertahankan salt yang sama, hanya menurunkan key
// baru dari salt lama + password baru, lalu push 'crypto_check' yang baru
// ke cloud (overwrite). Perangkat lain yang BELUM pernah unlock sejak
// password diganti tetap memakai cache lokalnya sendiri sampai mereka juga
// menjalankan "Ubah Password" dengan password lama+baru yang sama -- ini
// adalah batasan bawaan dari skema tanpa server autentikasi terpusat.
window.rotatePasswordKeepingSalt = async function(newPassword, saltB64) {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const key = await window.deriveKey(newPassword, salt);
    const checkB64 = await window.encryptStr(key, 'sinarkeu_ok');
    return { key, saltB64, checkB64 };
};

// ==================== SELF-HEAL: PASTIKAN SALT LOKAL SUDAH ADA DI CLOUD ====================
// KASUS NYATA yang memicu ini: device lama sudah lama dipakai dengan salt
// lokalnya sendiri, tapi baris crypto_salt/crypto_check TIDAK PERNAH ke-push
// ke cloud (mis. setup pertama terjadi sebelum fitur bootstrapCryptoForBackend
// ada, atau kebetulan offline saat setup). Saat device KEDUA melakukan setup
// dan mengecek cloud (pullCryptoSaltCheck), cloud kosong -> device kedua
// mengira dirinya paling pertama, generate salt SENDIRI, dan push itu.
// Hasilnya dua device dengan dua salt/tag berbeda yang tidak pernah bisa
// saling baca data walau url/anonkey/password sama persis.
//
// Dipanggil tiap kali app berhasil unlock & online (lihat continueAppInit di
// app.js). Kalau device ini sudah punya salt lokal TAPI cloud belum punya
// baris apa pun untuk tag salt ini, push sekarang -- supaya device lain yang
// join belakangan menemukan salt yang benar, bukan generate salt baru sendiri.
// Tidak melakukan apa-apa (aman) kalau cloud sudah punya baris untuk tag ini.
window.ensureCryptoSaltPushed = async function() {
    if (!window.isOnline() || !window._sessionCryptoKey) return;
    const localSalt = localStorage.getItem('sk_crypto_salt');
    const localCheck = localStorage.getItem('sk_crypto_check');
    if (!localSalt || !localCheck) return;
    try {
        const cloud = await window.pullCryptoSaltCheck();
        if (!cloud) {
            const pushed = await window.pushCryptoSaltCheck(localSalt, localCheck);
            if (pushed) {
                console.log('[Crypto] Self-heal: salt lokal belum ada di cloud, sudah di-push otomatis.');
            }
        }
    } catch (e) {
        console.warn('[Crypto] Gagal self-heal crypto salt ke cloud:', e);
    }
};

// ==================== SESSION KEY RESTORE SETELAH RELOAD ====================
// Setelah location.reload() (mis. switch akun), window._sessionCryptoKey
// hilang karena hanya in-memory. Fungsi ini men-derive ulang AES key dari:
//   • sk_crypto_salt  — salt PBKDF2 di localStorage (namespace akun aktif)
//   • sk_session_pwd  — password yang disimpan TERENKRIPSI di sessionStorage
//                       (dienkripsi dengan XOR-key berbasis sk_session_url agar
//                        tidak tersimpan sebagai plain text, tapi tetap bisa
//                        di-recover selama sesi browser hidup)
//
// sk_session_pwd di-set oleh unlockWithPassword() dan submitAccountUnlock()
// saat password berhasil diverifikasi. Ia hanya hidup selama tab browser
// terbuka (sessionStorage), sehingga tetap memenuhi requirement "lock on close".
//
// Mengembalikan true jika berhasil, false jika data sesi tidak lengkap atau
// verifikasi check-value gagal.
window.restoreSessionCryptoKey = async function() {
    if (window._sessionCryptoKey) return true; // sudah ada, skip
    const saltB64     = localStorage.getItem('sk_crypto_salt');
    const checkEnc    = localStorage.getItem('sk_crypto_check');
    const sessUrl     = sessionStorage.getItem('sk_session_url');
    const encPwdB64   = sessionStorage.getItem('sk_session_pwd');
    if (!saltB64 || !checkEnc || !sessUrl || !encPwdB64) return false;
    try {
        // Pulihkan password: XOR-cipher sederhana dengan bytes UTF-8 dari sessUrl
        const enc      = new TextEncoder();
        const encBytes = Uint8Array.from(atob(encPwdB64), c => c.charCodeAt(0));
        const keyBytes = enc.encode(sessUrl);
        const pwdBytes = encBytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
        const password = new TextDecoder().decode(pwdBytes);

        const salt         = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
        const candidateKey = await window.deriveKey(password, salt);
        const plain        = await window.decryptStr(candidateKey, checkEnc);
        if (plain !== 'sinarkeu_ok') return false;

        window._sessionCryptoKey = candidateKey;
        console.log('[Crypto] Session key berhasil di-derive ulang setelah reload.');
        return true;
    } catch (e) {
        console.warn('[Crypto] Gagal restore session key setelah reload:', e);
        return false;
    }
};

// Helper internal: simpan password ke sessionStorage dengan XOR-obfuscation
// berbasis URL sesi. Dipanggil setiap kali password berhasil diverifikasi.
window._storeSessionPassword = function(password) {
    const sessUrl = sessionStorage.getItem('sk_session_url') || '';
    const enc     = new TextEncoder();
    const pwdBytes  = enc.encode(password);
    const keyBytes  = enc.encode(sessUrl);
    const obfuscated = pwdBytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
    sessionStorage.setItem('sk_session_pwd', btoa(String.fromCharCode(...obfuscated)));
};

window.reEncryptCredentials = async function(url, apiKey) {
    if (!window._sessionCryptoKey) return;
    await window.saveEncryptedCredentials(window._sessionCryptoKey, url, apiKey);
};

// ==================== TELEGRAM SECURE STORAGE ====================
window.saveTelegramConfigEncrypted = async function(token, chatId, edgeUrl) {
    if (!window._sessionCryptoKey) {
        // Fallback plain-text jika session key belum tersedia
        if (token)   localStorage.setItem('sk_tg_token', token);
        if (chatId)  localStorage.setItem('sk_tg_chatid', chatId);
        if (edgeUrl) localStorage.setItem('sk_tg_edge_url', edgeUrl);
        else         localStorage.removeItem('sk_tg_edge_url');
        return;
    }
    try {
        const encToken  = token   ? await window.encryptStr(window._sessionCryptoKey, token)   : '';
        const encChatId = chatId  ? await window.encryptStr(window._sessionCryptoKey, chatId)  : '';
        const encEdge   = edgeUrl ? await window.encryptStr(window._sessionCryptoKey, edgeUrl) : '';
        localStorage.setItem('sk_tg_token_enc',  encToken);
        localStorage.setItem('sk_tg_chatid_enc', encChatId);
        localStorage.setItem('sk_tg_edge_enc',   encEdge);
        // Hapus nilai plain-text lama
        localStorage.removeItem('sk_tg_token');
        localStorage.removeItem('sk_tg_chatid');
        localStorage.removeItem('sk_tg_edge_url');
    } catch (e) {
        console.warn('[Crypto] Gagal enkripsi Telegram config, fallback plain-text:', e);
        localStorage.setItem('sk_tg_token', token);
        localStorage.setItem('sk_tg_chatid', chatId);
        if (edgeUrl) localStorage.setItem('sk_tg_edge_url', edgeUrl);
    }
};

window.getTelegramConfigDecrypted = async function() {
    const tryDecrypt = async (encVal) => {
        if (!encVal || !window._sessionCryptoKey) return '';
        try { return await window.decryptStr(window._sessionCryptoKey, encVal); }
        catch { return ''; }
    };
    const encToken  = localStorage.getItem('sk_tg_token_enc');
    const encChatId = localStorage.getItem('sk_tg_chatid_enc');
    const encEdge   = localStorage.getItem('sk_tg_edge_enc');
    if (encToken || encChatId) {
        // Baca versi terenkripsi
        return {
            token:   await tryDecrypt(encToken),
            chatId:  await tryDecrypt(encChatId),
            edgeUrl: await tryDecrypt(encEdge),
        };
    }
    // Fallback migrasi: baca plain-text lama, lalu enkripsi ulang
    const token   = localStorage.getItem('sk_tg_token')    || '';
    const chatId  = localStorage.getItem('sk_tg_chatid')   || '';
    const edgeUrl = localStorage.getItem('sk_tg_edge_url') || '';
    if (token || chatId) {
        // Migrasi otomatis ke enkripsi
        await window.saveTelegramConfigEncrypted(token, chatId, edgeUrl);
    }
    return { token, chatId, edgeUrl };
};

// ==================== ENKRIPSI DATA TRANSAKSI (ZERO-KNOWLEDGE) ====================
// SEBELUM INI: hanya kredensial Supabase & isi tabel `settings` yang dienkripsi
// (lihat saveEncryptedCredentials, pushSetting/pullSetting di db.js). Tabel
// `transactions` (jumlah uang, kategori, catatan, lampiran nota) dikirim ke
// Supabase APA ADANYA / PLAINTEXT -- siapa pun yang bisa membaca database
// (RLS salah konfigurasi, service-role key bocor, dsb.) bisa melihat seluruh
// riwayat keuangan pengguna. Fungsi berikut menutup celah itu: field sensitif
// dikemas jadi satu JSON, dienkripsi AES-GCM dengan kunci sesi yang SAMA
// dipakai untuk settings, lalu disimpan sebagai satu kolom `enc_payload`.
// Kolom lama (amount/category/description/attachment/type) TIDAK diisi lagi
// data asli -- lihat sql/harden_transactions_encryption.sql untuk migrasi
// kolomnya (dibuat nullable, tidak perlu tahu skema live sebelumnya).
window.encodeCloudTxPayload = async function(t) {
    if (!window._sessionCryptoKey) return null; // seharusnya selalu ada saat sesi terbuka
    const plain = JSON.stringify({
        type: t.type,
        amount: t.amount,
        category: t.category || '',
        description: t.description || '',
        attachment: t.attachment || null
    });
    return await window.encryptStr(window._sessionCryptoKey, plain);
};

// Menerjemahkan satu baris hasil GET dari Supabase menjadi objek transaksi
// yang dipakai di seluruh app (window.txs dst). Mendukung baris LAMA (belum
// bermigrasi, masih plaintext di kolom asli) secara transparan, supaya
// migrasi bisa berjalan bertahap tanpa kehilangan data.
window.decodeCloudTxRow = async function(c) {
    if (c.enc_payload && window._sessionCryptoKey) {
        try {
            const plain = await window.decryptStr(window._sessionCryptoKey, c.enc_payload);
            const d = JSON.parse(plain);
            return {
                id: c.id, type: d.type, amount: Number(d.amount) || 0,
                category: d.category || (d.type === 'income' ? 'Pemasukan' : ''),
                description: d.description, date: c.date,
                attachment: d.attachment || null, updated_at: c.updated_at || null
            };
        } catch (e) {
            console.warn('[Crypto] Gagal dekripsi transaksi', c.id, '-- fallback ke kolom plaintext (jika ada).', e);
        }
    }
    // Fallback: baris pra-migrasi, atau dekripsi gagal (mis. kunci sesi belum siap).
    return {
        id: c.id, type: c.type, amount: Number(c.amount) || 0,
        category: c.category || (c.type === 'income' ? 'Pemasukan' : ''),
        description: c.description, date: c.date,
        attachment: c.attachment || null, updated_at: c.updated_at || null
    };
};

// ==================== ENKRIPSI PAYMENT REMINDERS (pola sama seperti transaksi) ====================
// Field sensitif: `name` (nama tagihan, mis. "Cicilan Motor", "SPP Anak")
// dan `note`. day/recurrence/month juga ikut dienkripsi sekalian (tidak
// pernah dipakai untuk query server-side, aman dienkripsi semua).
window.encodeCloudReminderPayload = async function(r) {
    if (!window._sessionCryptoKey) return null;
    const plain = JSON.stringify({
        name: r.name || '', day: r.day, recurrence: r.recurrence,
        month: r.month || 1, note: r.note || ''
    });
    return await window.encryptStr(window._sessionCryptoKey, plain);
};
window.decodeCloudReminderRow = async function(row) {
    if (row.enc_payload && window._sessionCryptoKey) {
        try {
            const plain = await window.decryptStr(window._sessionCryptoKey, row.enc_payload);
            const d = JSON.parse(plain);
            return {
                id: row.id, book_id: row.book_id, name: d.name, day: d.day,
                recurrence: d.recurrence, month: d.month || 1, note: d.note || '',
                created_at: row.created_at, updated_at: row.updated_at
            };
        } catch (e) {
            console.warn('[Crypto] Gagal dekripsi payment reminder', row.id, '-- fallback ke kolom plaintext (jika ada).', e);
        }
    }
    // Fallback: baris pra-migrasi.
    return {
        id: row.id, book_id: row.book_id, name: row.name, day: row.day,
        recurrence: row.recurrence, month: row.month || 1, note: row.note || '',
        created_at: row.created_at, updated_at: row.updated_at
    };
};

// ==================== THROTTLE PERCOBAAN UNLOCK (ANTI BRUTE-FORCE) ====================
// SEBELUM INI: tidak ada batasan berapa kali password lock screen boleh dicoba.
// PBKDF2 300rb iterasi memang memperlambat brute-force OFFLINE (mis. kalau
// attacker punya salinan crypto_salt+crypto_check dari database), tapi TIDAK
// ada penalti sama sekali untuk percobaan ONLINE lewat UI ini sendiri. Fungsi
// di bawah menambah jeda (exponential backoff, dibatasi 5 menit) setelah 3x
// percobaan gagal berturut-turut, disimpan per-perangkat di localStorage.
// Ini bukan pengganti kekuatan password, tapi mengurangi kecepatan tebak-tebakan
// otomatis dari UI, dan direkomendasikan dikombinasikan dengan password kuat.
window._unlockThrottleKey = 'sk_unlock_throttle';
window.getUnlockWaitMs = function() {
    let data;
    try { data = JSON.parse(localStorage.getItem(window._unlockThrottleKey) || '{}'); } catch { data = {}; }
    const count = data.count || 0;
    if (count < 3) return 0;
    const waitSec = Math.min(15 * Math.pow(2, count - 3), 300); // maks 5 menit
    const remain = (data.lastAt || 0) + waitSec * 1000 - Date.now();
    return remain > 0 ? Math.ceil(remain / 1000) : 0; // dikembalikan dalam DETIK
};
window.recordUnlockAttempt = function(success) {
    if (success) { localStorage.removeItem(window._unlockThrottleKey); return; }
    let data;
    try { data = JSON.parse(localStorage.getItem(window._unlockThrottleKey) || '{}'); } catch { data = {}; }
    const count = (data.count || 0) + 1;
    localStorage.setItem(window._unlockThrottleKey, JSON.stringify({ count, lastAt: Date.now() }));
};

// Lock screen helpers
window.clearLockError = function() {
    document.getElementById('lockStatus').innerText = '';
    document.getElementById('lockPasswordInput').classList.remove('error-shake');
};
window.toggleLockEye = function() {
    const inp = document.getElementById('lockPasswordInput');
    const btn = document.getElementById('lockEyeBtn');
    if (inp.type === 'password') { inp.type = 'text'; btn.innerText = window.t('lock_hide'); }
    else { inp.type = 'password'; btn.innerText = window.t('lock_show'); }
};
window.evalSetupPwdStrength = function() {
    const pwd = document.getElementById('setupPwdInput') ? document.getElementById('setupPwdInput').value : '';
    const fill = document.getElementById('setupPwdStrengthFill');
    const lbl = document.getElementById('setupPwdStrengthLabel');
    if (!fill || !lbl) return;
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 10) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    const levels = [{ w: '0%', bg: '#eee', t: '' }, { w: '25%', bg: '#de350b', t: 'Sangat lemah' }, { w: '50%', bg: '#ff8b00', t: 'Lemah' }, { w: '70%', bg: '#ffab00', t: 'Cukup' }, { w: '88%', bg: '#00875a', t: 'Kuat' }, { w: '100%', bg: '#006644', t: 'Sangat kuat' }];
    const l = levels[score] || levels[0];
    fill.style.width = l.w;
    fill.style.background = l.bg;
    lbl.innerText = l.t;
    lbl.style.color = l.bg;
};