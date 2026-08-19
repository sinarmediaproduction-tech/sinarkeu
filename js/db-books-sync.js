// ==================== DB: BOOKS TOMBSTONE & PENDING-DELETE ====================
// Pecahan dari js/db.js -- lihat catatan pembagian modul di js/db-api.js.
// Harus dimuat setelah db-api.js & db-settings-push.js (memakai
// window.pushSetting/window.pushSettingBooks).
//
// Isi file ini: tombstone permanen buku yang sudah dihapus supaya tidak
// "hidup lagi" lintas device (addBookTombstone/pushBookTombstones/dkk),
// tracking pending-delete lintas restart (markBookPendingDelete/
// flushPendingBookDeletesOnStart/dkk), dan window.updateSettingsSyncStatus
// (indikator "terakhir sync" di UI).

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
