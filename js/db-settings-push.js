// ==================== DB: PUSH SETTINGS ====================
// Pecahan dari js/db.js -- lihat catatan pembagian modul di js/db-api.js.
// Harus dimuat setelah db-api.js.
//
// Isi file ini: push setting individual ke cloud (window.pushSetting),
// pembuangan buku yang sudah tombstoned sebelum push (
// _skDropDeadSharedBooksBeforePush), shortcut push per jenis setting
// (pushSettingBooks/pushSettingBudgets/pushSettingDefaultBudget/
// pushSettingTelegram), re-enkripsi semua setting cloud setelah ganti
// password (reEncryptAllCloudSettings), dan heal setting cloud yang basi
// (_healStaleCloudSetting, dipanggil dari js/db-settings-pull.js saat
// dekripsi gagal).

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
        // [LAZY-LOAD] js/electricity-plan.js tidak lagi eager-loaded. Fungsi
        // ini mem-push ULANG semua setting termasuk 'electricity_plan' --
        // kalau window.getElectricityPlan belum ada saat baris di bawah
        // jalan, nilai fallback { meters: [] } akan MENIMPA data asli di
        // cloud (lihat komentar "[FIX SETTINGS BUKU BERSAMA]" di bawah soal
        // kenapa push kosong di sini berbahaya). Pastikan modulnya sudah
        // termuat dulu -- gagal load pun tidak fatal, cuma balik ke
        // perilaku fallback lama.
        await window.skLoadModule('electricity-plan').catch(function(e) {
            window.skWarn('[Sync] Gagal memuat electricity-plan.js sebelum re-enkripsi setting:', e);
        });
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
