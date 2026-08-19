// ==================== REALTIME SYNC (BUKU BERSAMA) ====================
// Menggantikan polling 30 detik (js/app.js, window.startAutoSync) untuk
// tabel `transactions` & `settings` KHUSUS Buku Bersama -- kasus paling
// sering dipakai untuk kolaborasi multi-user (lihat permintaan: buku
// pribadi TETAP polling seperti biasa, tidak diubah sama sekali di sini).
//
// Dipakai lewat instance supabase-js yang SUDAH ada (window.getSupabaseAuthClient(),
// js/auth-core.js) -- SENGAJA tidak bikin client/WebSocket baru sendiri,
// supaya tidak menambah koneksi realtime kedua untuk project yang sama
// (sama seperti alasan _getSupabase() di patch sinkronisasi lama, lihat
// index.html sekitar baris 2288).
//
// KENAPA EVENT REALTIME TIDAK LANGSUNG DIPAKAI UNTUK UPDATE UI:
// Payload postgres_changes dari Supabase berisi baris NEW/OLD MENTAH --
// field-field sensitif masih terenkripsi AES-GCM per field (js/crypto.js),
// dan proses merge (dedup snapshot lama, guard baris dirty yang belum
// ke-push, resolusi konflik multi-device, dst.) sudah cukup rumit & sudah
// teruji di window.pullFromCloudSilently (js/transaction.js) dan
// window.pullAllSettings (js/db-settings-pull.js). Jadi event realtime di
// sini HANYA dipakai sebagai "sinyal ada perubahan" -- debounced trigger
// yang memanggil ULANG fungsi pull yang sudah ada, BUKAN reimplementasi
// logic dekripsi/merge dari payload mentahnya.
//
// FALLBACK: kalau channel realtime gagal/putus (CHANNEL_ERROR/TIMED_OUT/
// CLOSED), window._skRealtimeCoveredBookIds otomatis dikosongkan untuk
// buku itu -- window.startAutoSync (js/app.js) dan window.pullAllSettings
// (js/db-settings-pull.js) langsung balik ke polling normal tanpa perlu
// reload manual. Prasyarat sisi database: Replication utk tabel
// `transactions` & `settings` harus aktif -- lihat
// sql/enable_realtime_shared_book.sql.

window._skRealtimeChannel = null;
window._skRealtimeChannelBookId = null;
// Diisi HANYA saat channel status benar-benar 'SUBSCRIBED' -- dipakai
// window.startAutoSync (js/app.js) & window.pullAllSettings
// (js/db-settings-pull.js) sebagai sinyal "buku ini sudah ditangani
// realtime, lewati polling utk buku ini pada tick sekarang".
window._skRealtimeCoveredBookIds = window._skRealtimeCoveredBookIds || new Set();

let _skRtDebounceTimer = null;
function _skRealtimeTriggerPull(bookId) {
    // Debounce: gabungkan beberapa event beruntun (mis. import banyak
    // transaksi sekaligus dari device lain) jadi SATU pull, bukan satu
    // pull per baris yang berubah.
    clearTimeout(_skRtDebounceTimer);
    _skRtDebounceTimer = setTimeout(async function() {
        if (!window.isOnline()) return;
        if (window._acctCredTestLock) return; // sama seperti guard di window.startAutoSync
        try {
            // pullFromCloudSilently SELALU scoped ke window.currentBookId --
            // kalau user sudah pindah buku sejak event ini masuk, jangan
            // dipanggil (buku itu tidak lagi buku aktif; pull-nya akan salah
            // sasaran / sia-sia). pullAllSettings tetap aman dipanggil karena
            // fungsinya sendiri sudah menangani banyak buku sekaligus.
            if (window.currentBookId === bookId) {
                await window.pullFromCloudSilently();
            }
            // Sementara keluarkan bookId ini dari daftar "covered" SELAMA
            // pemanggilan pullAllSettings() di bawah -- window.pullAllSettings
            // (js/db-settings-pull.js) melewati query settings buku yang ada
            // di daftar "covered" (dianggap sudah ditangani realtime), TAPI
            // pull KALI INI justru dipicu OLEH event realtime buku ini
            // sendiri, jadi wajib tetap ditarik. Setelah selesai, kembalikan
            // lagi ke daftar "covered" (channel masih tersambung) supaya
            // tick polling reguler berikutnya (js/app.js) tetap melewatinya.
            const _wasCovered = window._skRealtimeCoveredBookIds && window._skRealtimeCoveredBookIds.has(bookId);
            if (_wasCovered) window._skRealtimeCoveredBookIds.delete(bookId);
            try {
                await window.pullAllSettings();
            } finally {
                if (_wasCovered) window._skRealtimeCoveredBookIds.add(bookId);
            }
        } catch (e) {
            window.skWarn('[Realtime] Gagal pull setelah event perubahan:', e);
        }
    }, 600);
}

// Lepas channel realtime yang sedang aktif (kalau ada). Aman dipanggil
// berkali-kali / saat tidak ada channel aktif sama sekali.
window.skStopRealtimeSync = function() {
    if (window._skRealtimeChannel) {
        try {
            const client = window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null;
            if (client && typeof client.removeChannel === 'function') {
                client.removeChannel(window._skRealtimeChannel);
            } else if (typeof window._skRealtimeChannel.unsubscribe === 'function') {
                window._skRealtimeChannel.unsubscribe();
            }
        } catch (e) {
            window.skWarn('[Realtime] Gagal melepas channel lama:', e);
        }
        window._skRealtimeChannel = null;
    }
    if (window._skRealtimeChannelBookId) {
        window._skRealtimeCoveredBookIds.delete(window._skRealtimeChannelBookId);
    }
    window._skRealtimeChannelBookId = null;
};

// Mulai/alihkan channel realtime ke `bookId`. No-op aman kalau `bookId`
// bukan Buku Bersama (window.skIsSharedBookId false) -- buku pribadi
// memang sengaja TIDAK dapat channel realtime, tetap murni polling seperti
// sebelumnya. Dipanggil dari:
//   - js/app.js (continueAppInit, setelah skRefreshSharedAccess & sebelum
//     window.startAutoSync)
//   - js/book.js (window.switchBook, setiap kali buku aktif berganti)
//   - listener 'online' (js/app.js) -- reconnect setelah koneksi putus
window.skStartRealtimeSync = function(bookId) {
    if (!bookId || typeof window.skIsSharedBookId !== 'function' || !window.skIsSharedBookId(bookId)) {
        window.skStopRealtimeSync();
        return;
    }
    if (window._skRealtimeChannelBookId === bookId && window._skRealtimeChannel) {
        return; // sudah ada channel aktif utk buku ini, tidak perlu bikin ulang
    }
    window.skStopRealtimeSync();
    if (!window.isOnline()) return; // akan dicoba lagi lewat listener 'online'

    const client = window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null;
    // window.supabase (vendor/supabase.js, dimuat via CDN defer di
    // index.html) bisa saja belum siap kalau dipanggil sangat awal --
    // aman diam-diam skip, window.startAutoSync tetap polling sebagai
    // fallback sampai channel berhasil dibuat di kesempatan berikutnya.
    if (!client || typeof client.channel !== 'function') return;

    try {
        const channel = client
            .channel('sk-realtime-book-' + bookId)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'transactions', filter: `book_id=eq.${bookId}` },
                function() { _skRealtimeTriggerPull(bookId); }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'settings', filter: `book_id=eq.${bookId}` },
                function() { _skRealtimeTriggerPull(bookId); }
            )
            .subscribe(function(status) {
                if (status === 'SUBSCRIBED') {
                    window._skRealtimeCoveredBookIds.add(bookId);
                    window.skLog('[Realtime] Terhubung utk buku bersama', bookId, '-- polling settings/transaksi buku ini dijeda, memakai event realtime.');
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    // Fallback aman: buang dari daftar "covered" supaya
                    // window.startAutoSync & window.pullAllSettings otomatis
                    // balik polling buku ini tanpa perlu reload manual.
                    window._skRealtimeCoveredBookIds.delete(bookId);
                    window.skWarn('[Realtime] Channel buku', bookId, 'status:', status, '-- fallback ke polling.');
                }
            });
        window._skRealtimeChannel = channel;
        window._skRealtimeChannelBookId = bookId;
    } catch (e) {
        window.skWarn('[Realtime] Gagal membuat channel:', e);
    }
};
