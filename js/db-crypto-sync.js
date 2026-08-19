// ==================== DB: CRYPTO SALT BOOTSTRAP (MULTI-DEVICE) ====================
// Pecahan dari js/db.js -- lihat catatan pembagian modul di js/db-api.js.
// Harus dimuat setelah db-api.js (memakai window.callSupabaseAPI).
//
// Isi file ini: push/pull "salt check" ke cloud supaya device kedua dst.
// bisa tahu apakah password/kunci enkripsi lokalnya cocok dengan device
// pertama sebelum mulai sinkron (pushCryptoSaltCheck/pullCryptoSaltCheck/
// pullCryptoSaltCheckStrict).

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

