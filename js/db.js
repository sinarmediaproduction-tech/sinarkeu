// ==================== SUPABASE API ====================
window.callSupabaseAPI = async function(table, method, body = null, queryString = '') {
    const baseUrl = window.getCloudUrl();
    const apiKey = window.getSupabaseKey();
    if (!baseUrl || !apiKey) return null;
    let url = `${baseUrl}/rest/v1/${table}`;
    if (queryString) url += queryString;
    const headers = { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (method === 'POST') headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
    const config = { method: method, headers: headers };
    if (body) config.body = JSON.stringify(body);
    try {
        const res = await fetch(url, config);
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : true;
    } catch (e) {
        console.error(`Supabase API Error (${table}):`, e);
        return null;
    }
};

// ==================== ACCOUNT ISOLATION TAG ====================
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
window.getAccountTag = function() {
    const saltB64 = localStorage.getItem('sk_crypto_salt');
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
    const result = await window.callSupabaseAPI('settings', 'POST', payload);
    return result !== null;
};

window.pullCryptoSaltCheck = async function() {
    if (!window.isOnline()) return null;
    const tag = window.getAccountTag();
    const tagFilter = tag ? `&account_tag=eq.${tag}` : '';
    const rows = await window.callSupabaseAPI('settings', 'GET', null, `?book_id=eq.global&key=in.(crypto_salt,crypto_check)${tagFilter}`);
    if (!rows || !Array.isArray(rows) || rows.length === 0) return null;
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
window.pushSetting = async function(key, value, bookId) {
    if (!window.isOnline()) return false;
    if (!window._sessionCryptoKey) {
        console.warn(`[Sync] Crypto key sesi tidak tersedia, push '${key}' dibatalkan (mencegah kebocoran plain text ke cloud).`);
        return false;
    }
    const plainJson = JSON.stringify(value);
    const encryptedValue = await window.encryptStr(window._sessionCryptoKey, plainJson);
    const tag = window.getAccountTag();
    const payload = [{
        book_id: bookId || window.currentBookId,
        key: key,
        value: encryptedValue,
        updated_at: new Date().toISOString(),
        ...(tag ? { account_tag: tag } : {})
    }];
    const result = await window.callSupabaseAPI('settings', 'POST', payload);
    // callSupabaseAPI mengembalikan null kalau request gagal (lihat fungsi di atas).
    return result !== null;
};

window.pushSettingBooks = async function() {
    if (!window.isOnline()) return;
    await window.pushSetting('books', window.books, 'global');
    console.log('[Sync] Books saved to cloud:', window.books.length);
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
        await window.pushSettingBooks();
        const books = Array.isArray(window.books) ? window.books : [];
        for (const b of books) {
            const bud = JSON.parse(localStorage.getItem('sk_budgets_' + b.id) || '{}');
            await window.pushSetting('budgets', bud, b.id);
            const defBud = window.getDefaultBudget(b.id);
            await window.pushSetting('default_budget', defBud, b.id);
            const annBud = window.getAnnualBudget(b.id);
            await window.pushSetting('annual_budget', annBud, b.id);
        }
        await window.pushSettingTelegram();
        console.log('[Sync] Re-enkripsi & push ulang semua setting ke cloud selesai (kunci baru).');
    } catch (e) {
        console.warn('[Sync] Gagal re-enkripsi setting cloud setelah ganti password:', e);
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
            console.log(`[Sync] Heal: '${key}' (book ${bookId}) berhasil di-push ulang dengan kunci sesi saat ini.`);
        }
    } catch (e) {
        console.warn(`[Sync] Heal gagal untuk '${key}' (book ${bookId}):`, e);
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
            console.log('[Sync] Data cloud terenkripsi kunci lama, akan di-heal otomatis.');
        }
    }
    // Fallback: cek apakah rawValue adalah JSON valid (data lama sebelum enkripsi).
    // Kalau bukan (masih ciphertext dari kunci lama), return null supaya pemanggil
    // bisa skip / trigger heal — daripada melempar SyntaxError di JSON.parse().
    try {
        JSON.parse(rawValue);
        return rawValue; // memang plain JSON (data lama, sebelum fitur enkripsi)
    } catch {
        console.log('[Sync] rawValue kunci lama (bukan JSON valid), return null — akan di-heal.');
        return null;
    }
};

window.pullAllSettings = async function() {
    if (!window.isOnline()) return;
    const tag = window.getAccountTag();
    // Kalau sudah punya tag (salt sudah ada), filter ketat hanya baris milik
    // akun ini. Kalau belum punya tag (setup awal), ambil semua — ini hanya
    // terjadi sebelum crypto selesai di-bootstrap.
    const tagFilter = tag ? `&account_tag=eq.${tag}` : '';
    const allRows = await window.callSupabaseAPI('settings', 'GET', null, `?order=updated_at.desc${tagFilter}`);
    if (allRows && Array.isArray(allRows)) {
        let booksUpdated = false;
        let telegramUpdated = false;
        let budgetUpdated = false;
        let hasStaleRows = false; // ada baris cloud terenkripsi kunci lama
        for (const row of allRows) {
            // crypto_salt & crypto_check bukan setting JSON terenkripsi biasa
            // (lihat window.pushCryptoSaltCheck) -- jangan diproses di sini,
            // supaya tidak memicu warning dekripsi & JSON.parse yang sia-sia.
            if (row.key === 'crypto_salt' || row.key === 'crypto_check') continue;
            let parsed;
            const decryptedValue = await window._decryptSettingValue(row.value);
            if (decryptedValue === null) {
                // Baris ini terenkripsi kunci lama — tandai untuk heal setelah loop.
                hasStaleRows = true;
                continue;
            }
            try { parsed = JSON.parse(decryptedValue); } catch { continue; }
            if (parsed === null || typeof parsed === 'undefined') { continue; } // JSON.parse(null) = null, skip
            if (row.key === 'books' && Array.isArray(parsed) && parsed.length > 0) {
                const cloudIds = new Set(parsed.map(b => b.id));
                const localIds = new Set(window.books.map(b => b.id));
                let changed = false;
                let merged = parsed.map(cb => {
                    const localBook = window.books.find(b => b.id === cb.id);
                    if (!localBook) { changed = true; }
                    else if (localBook.name !== cb.name) { changed = true; }
                    return cb;
                });
                window.books.forEach(lb => {
                    if (!cloudIds.has(lb.id)) {
                        console.log('[Sync] Buku dihapus dari cloud, hapus lokal:', lb.name);
                        localStorage.removeItem('sk_txs_' + lb.id);
                        localStorage.removeItem('sk_budgets_' + lb.id);
                        localStorage.removeItem('sk_logs_' + lb.id);
                        localStorage.removeItem('sk_default_budget_' + lb.id);
                        changed = true;
                    }
                });
                if (changed) {
                    window.books = merged;
                    localStorage.setItem('sk_books', JSON.stringify(window.books));
                    booksUpdated = true;
                    if (!window.books.find(b => b.id === window.currentBookId) && window.books.length > 0) {
                        window.currentBookId = window.books[0].id;
                        localStorage.setItem('sk_current_book_id', window.currentBookId);
                    }
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
            if (row.key === 'google_sheets_url') {
                if (typeof parsed === 'string' && parsed) {
                    localStorage.setItem('sk_google_sheets_url', parsed);
                    const gsInput = document.getElementById('googleSheetsUrlInput');
                    if (gsInput) gsInput.value = parsed;
                } else {
                    localStorage.removeItem('sk_google_sheets_url');
                }
            }
        }
        if (booksUpdated) {
            window.updateBookSelectDropdown();
            window.updateHeaderTitle();
        }
        if (budgetUpdated) {
            window.renderBudget();
            window.updateFinancialCards && window.updateFinancialCards();
            if (document.getElementById('budgetModal').classList.contains('show')) {
                window.renderBudgetFormFields();
            }
        }
        // Ada baris cloud yang terenkripsi kunci lama dan tidak bisa didekripsi.
        // Push ulang semua setting dari localStorage ke cloud dengan kunci sesi saat ini,
        // supaya baris-baris itu tertimpa dan pull berikutnya tidak memicu warning lagi.
        if (hasStaleRows && window._sessionCryptoKey) {
            console.log('[Sync] Terdeteksi data cloud kunci lama — memulai re-enkripsi otomatis...');
            window.reEncryptAllCloudSettings().then(() => {
                console.log('[Sync] Re-enkripsi otomatis selesai. Pull berikutnya tidak akan ada warning kunci lama.');
            }).catch(e => {
                console.warn('[Sync] Re-enkripsi otomatis gagal:', e);
            });
        }

        // MIGRASI: kalau pull berhasil tapi tidak ada baris yang relevan (semua
        // dilewati karena crypto_salt/check), cek apakah ada baris LAMA tanpa
        // account_tag yang bisa dimigrasikan.
        const relevantRows = allRows.filter(r => r.key !== 'crypto_salt' && r.key !== 'crypto_check');
        if (relevantRows.length === 0 && tag && window._sessionCryptoKey) {
            console.log('[Sync] Tidak ada baris ber-tag — coba migrasi baris lama tanpa account_tag...');
            window._migrateUntaggedCloudSettings(tag).then(() => {
                console.log('[Sync] Migrasi account_tag selesai.');
            }).catch(e => {
                console.warn('[Sync] Migrasi account_tag gagal:', e);
            });
        }
    }
    window.updateSettingsSyncStatus('pull');
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
// yang menambahkan fitur account_tag. Fungsi ini:
//   1. Menarik semua baris TANPA account_tag (baris lama) dari Supabase.
//   2. Membaca hanya baris yang bisa didekripsi dengan kunci sesi akun ini
//      (baris akun lain akan gagal dekripsi dan dilewati).
//   3. Mem-push ulang baris tersebut dengan account_tag yang benar.
// Setelah migrasi, pullAllSettings() berikutnya sudah pakai filter tag.
window._migrateUntaggedCloudSettings = async function(tag) {
    if (!window.isOnline() || !window._sessionCryptoKey || !tag) return;
    try {
        // Ambil semua baris yang TIDAK punya account_tag (is.null)
        const oldRows = await window.callSupabaseAPI('settings', 'GET', null, '?account_tag=is.null&order=updated_at.desc');
        if (!oldRows || !Array.isArray(oldRows) || oldRows.length === 0) {
            console.log('[Sync] Tidak ada baris lama tanpa account_tag — migrasi tidak diperlukan.');
            return;
        }
        console.log(`[Sync] Ditemukan ${oldRows.length} baris lama tanpa tag. Memulai migrasi...`);
        let migratedCount = 0;
        for (const row of oldRows) {
            if (row.key === 'crypto_salt' || row.key === 'crypto_check') continue;
            const decrypted = await window._decryptSettingValue(row.value);
            if (decrypted === null) {
                // Baris ini terenkripsi kunci akun lain — lewati, jangan disentuh.
                continue;
            }
            // Baris ini milik akun kita (dekripsi berhasil). Push ulang dengan tag.
            const now = new Date().toISOString();
            const payload = [{
                book_id: row.book_id,
                key: row.key,
                value: row.value, // nilai sudah terenkripsi, langsung pakai
                updated_at: now,
                account_tag: tag
            }];
            const ok = await window.callSupabaseAPI('settings', 'POST', payload);
            if (ok) migratedCount++;
        }
        console.log(`[Sync] Migrasi selesai: ${migratedCount} baris diberi account_tag '${tag}'.`);
    } catch (e) {
        console.warn('[Sync] _migrateUntaggedCloudSettings error:', e);
    }
};

// ============================================================
// DB.JS - FUNGSI KHUSUS UNTUK PAYMENT REMINDERS
// ============================================================

// ── PUSH PAYMENT REMINDER KE CLOUD ──
window.pushPaymentReminderToCloud = async function(bookId, reminderData) {
    if (!window.isOnline() || !bookId) return false;
    
    try {
        const payload = {
            ...reminderData,
            book_id: bookId,
            updated_at: new Date().toISOString()
        };
        
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
            `?book_id=eq.${bookId}&order=created_at.desc`
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
            `?id=eq.${reminderId}&book_id=eq.${bookId}`
        );
        return !!result;
    } catch (e) {
        console.error('[DB] Gagal delete payment reminder:', e);
        return false;
    }
};
