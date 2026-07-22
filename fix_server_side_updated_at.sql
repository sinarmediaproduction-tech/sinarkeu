// ==================== TRANSACTIONS ====================

// Parser tanggal "aman timezone": angka jam/menit di string SELALU dibaca
// sebagai angka jam/menit lokal apa adanya, berapa pun suffix timezone-nya
// (tanpa suffix, "Z", atau "+00:00" dari Supabase). Ini mencegah bug
// "tanggal mundur/maju" akibat double timezone conversion saat data
// ditarik ulang dari cloud. Pakai fungsi ini setiap kali butuh objek Date
// dari field date transaksi (sorting, perbandingan, format tampilan),
// JANGAN pakai new Date(t.date) langsung.
window.parseTxDate = function(str) {
    if (!str) return new Date(NaN);
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return new Date(str);
    const [, y, mo, d, h, mi, s] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0));
};

// [FIX CLOCK SKEW MULTI-DEVICE] Cari updated_at TERBESAR di antara baris-baris
// yang baru saja diambil dari cloud, dipakai sebagai cursor sinkronisasi
// incremental berikutnya (window._lastFullSyncTime[bookId]).
//
// KENAPA INI PENTING: sebelumnya cursor itu diisi dengan new Date().toISOString()
// -- jam LOKAL perangkat yang MELAKUKAN PULL. Kalau jam perangkat itu maju
// dibanding jam server (atau dibanding jam perangkat lain yang mengirim data),
// baris yang di-push perangkat lain BISA punya updated_at yang -- menurut jam
// server -- sebenarnya lebih baru dari cursor lama, tapi tetap lolos dari
// query `updated_at=gt.<cursor>` berikutnya karena cursor sudah kadung "di masa
// depan". Efeknya: perubahan dari device lain hilang/basi diam-diam, dan baru
// muncul lagi kalau baris itu diubah SEKALI LAGI. Ini persis pola "device A
// jam-nya beda, device B tidak pernah lihat perubahan A" yang dilaporkan.
//
// Perbaikan: cursor SELALU diturunkan dari nilai updated_at yang sungguhan ada
// di baris hasil query (jam SERVER, lewat trigger DB -- lihat
// sql/server_side_updated_at_trigger.sql), bukan jam device manapun. Kalau
// tidak ada baris sama sekali, cursor lama dipertahankan (belum ada yang
// berubah, aman).
window._maxUpdatedAt = function(rows, fallback) {
    let max = fallback || null;
    (rows || []).forEach(r => {
        const v = r && r.updated_at;
        if (v && (!max || v > max)) max = v;
    });
    return max;
};

// [BUG FIX - CARD "TOTAL PEMASUKAN"/"TOTAL PENGELUARAN" TIDAK LENGKAP] Sebelumnya
// fungsi ini cuma menyimpan balanceOffset (NET pemasukan-pengeluaran dari transaksi
// lama yang ter-trim). Itu cukup untuk mengoreksi "Saldo Akhir" (lihat render.js),
// TAPI tidak cukup untuk kartu "Total Pemasukan"/"Total Pengeluaran" di dashboard --
// dua kartu itu menyiratkan angka SEMUA WAKTU, tapi sebelumnya cuma menjumlah
// window.txs (maks MAX_LOCAL_TXS transaksi terbaru), jadi untuk buku >1000
// transaksi angkanya jauh lebih kecil dari kenyataan walau "Saldo Akhir" di
// sebelahnya sudah benar. Sekarang simpan juga incomeOffset & expenseOffset
// terpisah (bukan cuma net-nya) supaya render.js bisa mengoreksi kedua kartu itu.
window.trimAndSaveLocal = function(bookId, data) {
    const sorted = [...data].sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date) || String(b.id).localeCompare(String(a.id)));
    const trimmed = sorted.slice(0, window.MAX_LOCAL_TXS);
    localStorage.setItem('sk_txs_' + bookId, JSON.stringify(trimmed));
    const remainder = sorted.slice(window.MAX_LOCAL_TXS);
    let balanceOffset = 0, incomeOffset = 0, expenseOffset = 0;
    remainder.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') { balanceOffset += amt; incomeOffset += amt; }
        else { balanceOffset -= amt; expenseOffset += amt; }
    });
    localStorage.setItem('sk_balance_offset_' + bookId, String(balanceOffset));
    localStorage.setItem('sk_income_offset_' + bookId, String(incomeOffset));
    localStorage.setItem('sk_expense_offset_' + bookId, String(expenseOffset));
    return trimmed;
};

// [BUG FIX - OFFSET SALDO SALAH SAAT FULL SYNC] trimAndSaveLocal() di atas menghitung
// balanceOffset dari SISA (remainder) array yang di-passing ke dalamnya. Itu benar kalau
// array itu berasal dari window.txs LOKAL yang belum dipotong (lihat pemanggilnya di
// transaction.js/book.js/backup.js untuk kasus tambah/ubah/hapus transaksi lokal).
//
// TAPI untuk pull AWAL dari cloud (pullFromCloudSilently saat !lastSync) dan
// pullAllBooksFromCloud (dipakai forceFullSync), query ke Supabase SUDAH membatasi
// hasilnya dengan limit=MAX_LOCAL_TXS di sisi server. Array yang diterima klien
// akibatnya TIDAK PERNAH lebih dari MAX_LOCAL_TXS baris -- remainder-nya selalu [],
// dan trimAndSaveLocal menuliskan balanceOffset = 0, MENGHAPUS histori saldo buku
// yang transaksinya > MAX_LOCAL_TXS. Ini kejadian tiap kali: login di device baru,
// pertama kali buka sesi (reload), atau klik "Sinkron Penuh" -- baru "sembuh" pelan-
// pelan setelah itu (bertambah satu-satu tiap ada transaksi baru yang ke-trim lokal),
// TANPA pernah mendapat kembali offset historis yang sudah hilang.
//
// Server tidak bisa SUM(amount) untuk mengoreksi ini karena amount tersimpan
// terenkripsi (enc_payload) -- lihat crypto.js. Jadi kalau terdeteksi kemungkinan
// terpotong (jumlah baris yang diterima == MAX_LOCAL_TXS persis), tarik ulang KHUSUS
// baris-baris yang lebih tua itu (paginated pakai offset, di luar batas limit biasa),
// dekripsi, dan jumlahkan jadi balanceOffset yang sebenarnya.
//
// [BUG FIX - CARD TOTAL PEMASUKAN/PENGELUARAN] Sekarang mengembalikan objek
// {balanceOffset, incomeOffset, expenseOffset} -- bukan cuma net balanceOffset --
// supaya pemanggil (pullFromCloudSilently/pullAllBooksFromCloud/restore backup)
// bisa mengoreksi kartu Total Pemasukan & Total Pengeluaran juga, bukan cuma
// Saldo Akhir. window._fetchOlderTxsBalanceOffset (nama lama) dipertahankan
// sebagai alias tipis di bawah untuk kompatibilitas pemanggil lama.
window._fetchOlderTxsOffsets = async function(bookId) {
    if (!window.isOnline()) return null; // offline: tidak bisa dihitung, pemanggil harus fallback (biarkan offset lama)
    const _tag = window.getAccountTag ? window.getAccountTag() : null;
    const _tagFilter = window.tagOrFilter(_tag);
    const PAGE_SIZE = 1000;
    let balanceOffset = 0, incomeOffset = 0, expenseOffset = 0;
    let start = window.MAX_LOCAL_TXS;
    while (true) {
        const query = `?book_id=eq.${bookId}&is_deleted=eq.false&order=date.desc,id.desc&limit=${PAGE_SIZE}&offset=${start}${_tagFilter}`;
        const rows = await window.callSupabaseAPI('transactions', 'GET', null, query);
        if (!rows || !Array.isArray(rows) || rows.length === 0) break;
        const decoded = await Promise.all(rows.map(r => window.decodeCloudTxRow(r)));
        decoded.forEach(t => {
            const amt = Number(t.amount) || 0;
            if (t.type === 'income') { balanceOffset += amt; incomeOffset += amt; }
            else { balanceOffset -= amt; expenseOffset += amt; }
        });
        if (rows.length < PAGE_SIZE) break;
        start += PAGE_SIZE;
    }
    return { balanceOffset, incomeOffset, expenseOffset };
};

// Alias lama: sebagian kode (mis. sebelum fix ini) mungkin masih memanggil nama
// ini dan cuma butuh angka net-nya saja.
window._fetchOlderTxsBalanceOffset = async function(bookId) {
    const result = await window._fetchOlderTxsOffsets(bookId);
    return result ? result.balanceOffset : null;
};

// ==================== LAPORAN: AMBIL SATU BULAN LANGSUNG DARI CLOUD ====================
// [FIX] window.txs (dan cache localStorage sk_txs_*) cuma menyimpan
// MAX_LOCAL_TXS (1000) transaksi TERBARU per buku (lihat trimAndSaveLocal).
// Ini cukup untuk tampilan daftar utama & saldo (yang lebih lama dikompensasi
// lewat balance_offset), TAPI kalau dipakai untuk laporan/export PDF bulan
// tertentu yang sudah di luar jendela 1000 itu, transaksi bulan itu akan
// tampil kosong/kurang padahal datanya masih ada di cloud.
//
// Dipakai oleh report.js (generateMonthlyReport, exportReportAsPDF): query
// LANGSUNG per rentang tanggal satu bulan, TANPA batas limit seperti query
// utama, supaya laporan bulan manapun -- baru atau lama -- selalu lengkap
// selama online. Kalau offline atau gagal, return null supaya pemanggil
// fallback ke window.txs (best effort, mungkin tidak lengkap).
window.fetchMonthTransactionsFromCloud = async function(bookId, year, month) {
    if (!window.isOnline() || !bookId) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${year}-${pad(month)}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endStr = `${nextYear}-${pad(nextMonth)}-01`;
    const tag = window.getAccountTag ? window.getAccountTag() : null;
    const tagFilter = window.tagOrFilter(tag);
    const query = `?book_id=eq.${bookId}&is_deleted=eq.false&date=gte.${startStr}&date=lt.${endStr}&order=date.asc${tagFilter}`;
    const rows = await window.callSupabaseAPI('transactions', 'GET', null, query);
    if (!rows || !Array.isArray(rows)) return null;
    // [SECURITY] Dekripsi field sensitif (jumlah/kategori/catatan/lampiran) --
    // lihat window.decodeCloudTxRow di crypto.js.
    return Promise.all(rows.map(c => window.decodeCloudTxRow(c)));
};

window.pullFromCloudSilently = async function() {
    if (!window.isOnline()) return;
    // [BUG FIX 3] Guard concurrent pull: jika pull sebelumnya masih berjalan
    // (koneksi lambat / buku banyak), skip — daripada dua proses merge localMap
    // berjalan bersamaan dan hasilnya tidak deterministik.
    if (window._isPullingTransactions) return;
    window._isPullingTransactions = true;
    try {
        const lastSync = window._lastFullSyncTime[window.currentBookId];
        // Catatan soft-delete: untuk load awal (tanpa lastSync) kita filter
        // is_deleted=eq.false langsung di query, karena di sini tidak ada proses
        // merge — baris terhapus memang tidak boleh pernah masuk ke window.txs.
        // Untuk query incremental (ada lastSync), JANGAN difilter, karena kita
        // justru butuh baris tombstone (is_deleted=true) itu untuk tahu transaksi
        // mana yang baru dihapus di perangkat lain, supaya bisa dibuang dari
        // cache lokal perangkat ini juga (lihat loop di bawah).
        const _txTag = window.getAccountTag ? window.getAccountTag() : null;
        // OR filter: ambil baris ber-tag milik akun ini ATAU baris lama tanpa tag (NULL).
        // Baris NULL adalah data sebelum fitur account_tag ditambahkan; harus tetap terbaca
        // sampai migrasi selesai men-tag ulang semua baris tersebut.
        const _txTagFilter = window.tagOrFilter(_txTag);
        let query = `?book_id=eq.${window.currentBookId}&is_deleted=eq.false&order=date.desc&limit=${window.MAX_LOCAL_TXS}${_txTagFilter}`;
        if (lastSync) {
            // [FIX] Timestamp dari SERVER (lihat sql/fix_server_side_updated_at.sql)
            // berformat "...+00:00" (offset eksplisit), beda dari
            // new Date().toISOString() milik JS yang selalu berakhiran "Z".
            // Tanda "+" itu, kalau ditaruh mentah-mentah di query string, dibaca
            // sebagai SPASI oleh URL decoder Supabase -- bukan lagi tanda plus --
            // sehingga timestamp-nya jadi tidak valid dan request ditolak (400,
            // kode 22007). Selalu encodeURIComponent() nilai yang masuk ke query
            // string, terutama untuk cursor ini yang sekarang bisa mengandung "+".
            query = `?book_id=eq.${window.currentBookId}&order=updated_at.desc&updated_at=gt.${encodeURIComponent(lastSync)}&limit=${window.MAX_LOCAL_TXS}${_txTagFilter}`;
        }
        let cloudData = await window.callSupabaseAPI('transactions', 'GET', null, query);
        if (cloudData && Array.isArray(cloudData)) {
            if (lastSync && cloudData.length > 0) {
                const localMap = {};
                window.txs.forEach(t => { localMap[t.id] = t; });
                // [SECURITY] Dekripsi dulu semua baris (paralel) sebelum di-merge,
                // supaya perbandingan updated_at/is_deleted tetap pakai data mentah dari cloud.
                const decoded = await Promise.all(cloudData.map(c => window.decodeCloudTxRow(c)));
                cloudData.forEach((c, i) => {
                    const cloudUpdated = c.updated_at || '1970-01-01T00:00:00.000Z';
                    const local = localMap[c.id];
                    const localUpdated = local ? (local.updated_at || '1970-01-01T00:00:00.000Z') : '1970-01-01T00:00:00.000Z';
                    if (!local || cloudUpdated >= localUpdated) {
                        if (c.is_deleted) {
                            // Tombstone dari perangkat lain: buang dari cache lokal ini juga.
                            delete localMap[c.id];
                        } else {
                            localMap[c.id] = decoded[i];
                        }
                    }
                });
                window.txs = Object.values(localMap).sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date) || String(b.id).localeCompare(String(a.id)));
            } else if (!lastSync) {
                window.txs = (await Promise.all(cloudData.map(c => window.decodeCloudTxRow(c))))
                    .sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date) || String(b.id).localeCompare(String(a.id)));
            }
            window.trimAndSaveLocal(window.currentBookId, window.txs);
            // [BUG FIX] lihat catatan di _fetchOlderTxsOffsets -- kalau ini pull AWAL
            // (bukan incremental) dan hasilnya persis MAX_LOCAL_TXS baris (indikasi mungkin
            // masih ada baris lebih lama di cloud), trimAndSaveLocal barusan SALAH menuliskan
            // balanceOffset/incomeOffset/expenseOffset = 0. Tarik ulang yang sebenarnya sebelum render.
            if (!lastSync && cloudData.length >= window.MAX_LOCAL_TXS) {
                const trueOffsets = await window._fetchOlderTxsOffsets(window.currentBookId);
                if (trueOffsets !== null) {
                    localStorage.setItem('sk_balance_offset_' + window.currentBookId, String(trueOffsets.balanceOffset));
                    localStorage.setItem('sk_income_offset_' + window.currentBookId, String(trueOffsets.incomeOffset));
                    localStorage.setItem('sk_expense_offset_' + window.currentBookId, String(trueOffsets.expenseOffset));
                }
            }
            // [FIX CLOCK SKEW] Cursor diambil dari updated_at TERBESAR di data
            // yang baru ditarik (jam server), BUKAN new Date() (jam device ini).
            // Lihat window._maxUpdatedAt di atas untuk alasan lengkap.
            window._lastFullSyncTime[window.currentBookId] = window._maxUpdatedAt(cloudData, lastSync);
            window.render();
            window._lastSyncTime = new Date();
            window.updateSyncTimeBadge();
        }
    } finally {
        // Pastikan lock selalu dilepas, bahkan jika ada exception tak terduga.
        window._isPullingTransactions = false;
    }
};

window.pullAllBooksFromCloud = async function() {
    if (!window.isOnline()) return;
    const bookIds = window.books.map(b => b.id);
    if (bookIds.length === 0) return;
    for (const bookId of bookIds) {
        const _fxTag = window.getAccountTag ? window.getAccountTag() : null;
        // OR filter: baris ber-tag akun ini ATAU baris lama tanpa tag (data sebelum migrasi).
        const _fxTagFilter = window.tagOrFilter(_fxTag);
        let cloudData = await window.callSupabaseAPI('transactions', 'GET', null,
            `?book_id=eq.${bookId}&is_deleted=eq.false&order=date.desc&limit=${window.MAX_LOCAL_TXS}${_fxTagFilter}`);
        if (!cloudData || !Array.isArray(cloudData)) continue;
        // [SECURITY] Dekripsi field sensitif -- lihat window.decodeCloudTxRow di crypto.js.
        const cloudMapped = await Promise.all(cloudData.map(c => window.decodeCloudTxRow(c)));
        const trimmed = window.trimAndSaveLocal(bookId, cloudMapped);
        // [BUG FIX] sama seperti pullFromCloudSilently -- query di atas dibatasi
        // limit=MAX_LOCAL_TXS di server, jadi trimAndSaveLocal tidak pernah melihat
        // remainder yang sebenarnya. Kalau hasilnya persis MAX_LOCAL_TXS baris, tarik
        // ulang offset yang benar dari baris-baris yang lebih tua.
        if (cloudMapped.length >= window.MAX_LOCAL_TXS) {
            const trueOffsets = await window._fetchOlderTxsOffsets(bookId);
            if (trueOffsets !== null) {
                localStorage.setItem('sk_balance_offset_' + bookId, String(trueOffsets.balanceOffset));
                localStorage.setItem('sk_income_offset_' + bookId, String(trueOffsets.incomeOffset));
                localStorage.setItem('sk_expense_offset_' + bookId, String(trueOffsets.expenseOffset));
            }
        }
        // [FIX CLOCK SKEW] Sama seperti pullFromCloudSilently: cursor dari jam
        // server (updated_at baris), bukan jam device. forceFullSync() memanggil
        // fungsi ini untuk SEMUA buku -- kalau cursor-nya salah pakai jam device,
        // pull incremental berikutnya (pullFromCloudSilently) ikut kebawa salah
        // untuk buku itu juga.
        window._lastFullSyncTime[bookId] = window._maxUpdatedAt(cloudMapped, window._lastFullSyncTime[bookId]);
        if (bookId === window.currentBookId) {
            window.txs = trimmed;
            window.render();
        }
    }
    window._lastSyncTime = new Date();
    window.updateSyncTimeBadge();
    console.log('[Sync] Selesai pull semua buku —', bookIds.length, 'buku diproses');
};

window.forceFullSync = async function() {
    if (!window.requireOnline('sinkronisasi')) return;
    // [FIX RACE CONDITION] Sama seperti guard di startAutoSync (js/app.js):
    // jangan sinkron sementara kredensial global sedang dialihkan untuk
    // menguji/bootstrap akun baru di menu Manajer Akun.
    if (window._acctCredTestLock) {
        window.showToast('Tunggu proses tambah/edit akun selesai sebelum sinkronisasi.', 'info');
        return;
    }
    try {
        await window.pullAllSettings();
        await window.pullAllBooksFromCloud();
        window.updateBookSelectDropdown();
        window.updateTgStatusBadge();
        window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
        // Catatan: window.renderBudget() tidak dipanggil di sini karena pullAllSettings()
        // sudah memanggil renderBudget() sendiri jika ada perubahan budget dari cloud.
        await window.addCloudLog('SISTEM', 'Sinkronisasi penuh manual dari perangkat ' + window.deviceId);
    } catch (e) {
        console.error('[Sync] Gagal sinkronisasi:', e);
        window.showToast('Gagal sinkronisasi, coba lagi nanti', 'error');
    }
};

// [FIX RACE MULTI-DEVICE + MULTI-TAB] Set berisi id transaksi yang berubah di
// PERANGKAT/BROWSER INI sejak push terakhir berhasil. Ditambahkan lewat
// window.markTxDirty() oleh handleSubmit (tambah) dan handleEditSubmit (ubah)
// di render.js. Dipakai supaya pushToCloud() hanya meng-upsert baris yang
// benar-benar diubah, bukan seluruh window.txs.
//
// Kenapa ini penting: sebelumnya pushToCloud() SELALU mengirim seluruh
// window.txs (bisa ratusan baris, lihat MAX_LOCAL_TXS) dengan
// Prefer:resolution=merge-duplicates (upsert full-row overwrite), setiap kali
// SATU transaksi ditambah/diubah. Skenario race:
//   1. Device A & B sama-sama sudah sinkron, 50 transaksi.
//   2. Device A ubah transaksi #10 -> 1.5 detik kemudian debounce push
//      SELURUH 50 transaksi (termasuk salinan lokal A untuk #11..#50 yang
//      SUDAH BASI kalau device lain baru saja mengubahnya).
//   3. Kalau di antara pull terakhir A dan push ini, device B sempat mengubah
//      transaksi #20, maka push A akan MENIMPA perubahan B itu dengan data
//      lama A secara diam-diam -- lost update, tanpa error apa pun.
// Ini persis kelas bug yang sama dengan bug hadiah di Merdeka (menimpa data
// yang tidak sedang diubah), hanya lebih tersembunyi karena terjadi per-baris,
// bukan di dalam satu kolom JSON.
// ==================== SOFT-DELETE: TAHAN-BANTING KONEKSI PUTUS ====================
// [FIX] Sebelumnya confirmDelete() (render.js) langsung PATCH ke Supabase
// TANPA di-`await` dan tanpa dicek hasilnya, lalu baris itu langsung dibuang
// dari window.txs & localStorage seolah sudah pasti berhasil. Kalau request
// itu gagal atau terputus di tengah jalan (koneksi flaky, tab/app ditutup
// tepat setelah klik hapus, dsb), TIDAK ADA CATATAN bahwa penghapusan itu
// masih tertunda -- beda dengan tambah/ubah transaksi yang sudah punya
// dirty-tracking + flushPendingDirtyOnStart (lihat di atas). Akibatnya:
// baris di cloud tetap hidup (is_deleted masih false), device ini sudah
// terlanjur menganggapnya terhapus, dan begitu device ini (atau device lain)
// melakukan pull berikutnya, transaksi itu "hidup lagi" secara diam-diam.
//
// Pola di bawah ini meniru persis dirty-tracking untuk create/update:
// simpan niat "baris ini perlu di-tandai is_deleted di cloud" ke localStorage
// SEBELUM mencoba PATCH, baru hapus catatan itu SETELAH PATCH benar-benar
// sukses. Kalau gagal/terputus, catatan itu tetap ada dan akan dicoba lagi
// oleh window.flushPendingDeletesOnStart() (dipanggil saat app start, DAN
// setiap kali koneksi kembali online -- lihat app.js).
window._pendingDeleteStoreKey = 'sk_delete_pending';

window._loadPendingDeleteStore = function() {
    try { return JSON.parse(localStorage.getItem(window._pendingDeleteStoreKey) || '{}'); }
    catch (e) { return {}; }
};
window._savePendingDeleteStore = function(storeObj) {
    try { localStorage.setItem(window._pendingDeleteStoreKey, JSON.stringify(storeObj)); }
    catch (e) { /* localStorage penuh/nonaktif -- tetap dicoba lagi di sesi ini */ }
};
window.markTxPendingDelete = function(id, bookId) {
    const store = window._loadPendingDeleteStore();
    store[id] = bookId || window.currentBookId;
    window._savePendingDeleteStore(store);
};
window.clearTxPendingDelete = function(id) {
    const store = window._loadPendingDeleteStore();
    delete store[id];
    window._savePendingDeleteStore(store);
};

// Satu-satunya tempat yang benar-benar mem-PATCH is_deleted=true ke cloud.
// SELALU di-await oleh pemanggil, dan mengembalikan true/false sesuai hasil
// sungguhan -- tidak pernah "fire and forget" seperti sebelumnya.
window.pushDeleteToCloud = async function(id, bookId) {
    if (!window.isOnline()) return false;
    const tag = window.getAccountTag ? window.getAccountTag() : null;
    const tagFilter = window.tagOrFilter(tag);
    const result = await window.callSupabaseAPI(
        'transactions', 'PATCH',
        { is_deleted: true, updated_at: new Date().toISOString() },
        `?id=eq.${id}&book_id=eq.${bookId || window.currentBookId}${tagFilter}`
    );
    return result !== null;
};

// Dipanggil saat app start (setelah flushPendingDirtyOnStart, SEBELUM
// pullAllBooksFromCloud -- lihat app.js) dan setiap kali koneksi online lagi,
// supaya penghapusan yang sempat gagal/terputus tidak pernah "hidup lagi"
// gara-gara pull berikutnya menarik ulang baris yang harusnya sudah mati.
window.flushPendingDeletesOnStart = async function() {
    if (!window.isOnline()) return;
    const store = window._loadPendingDeleteStore();
    const ids = Object.keys(store);
    if (ids.length === 0) return;
    for (const id of ids) {
        const ok = await window.pushDeleteToCloud(id, store[id]);
        if (ok) window.clearTxPendingDelete(id);
    }
};

window._dirtyTxIds = new Set();

// [MULTI-TAB] Dirty ids di atas cuma in-memory -> kalau tab A menandai dirty
// lalu di-close SEBELUM debounce 1.5 detik sempat push (atau sebelum sempat
// online), penandaan itu hilang total dan transaksi itu tidak akan pernah
// ter-push kecuali user mengubahnya lagi. window._dirtyStoreKey menyimpan
// peta {txId: bookId} yang sama persis ke localStorage, supaya:
//   1. Tab lain yang masih terbuka bisa lihat dirty ids ini (lewat event
//      'storage' bawaan browser, lihat listener di bawah) dan ikut
//      menganggapnya perlu di-push kalau tab itu yang lebih dulu push.
//   2. Kalau SEMUA tab/tab ini di-close sebelum sempat push, saat app dibuka
//      lagi (device/tab manapun), window.flushPendingDirtyOnStart() akan
//      menemukan sisa dirty ids ini di localStorage dan langsung push --
//      tidak ada transaksi yang "lupa" ter-sync.
window._dirtyStoreKey = 'sk_dirty_pending';

window._loadDirtyStore = function() {
    try { return JSON.parse(localStorage.getItem(window._dirtyStoreKey) || '{}'); }
    catch (e) { return {}; }
};
window._saveDirtyStore = function(storeObj) {
    try { localStorage.setItem(window._dirtyStoreKey, JSON.stringify(storeObj)); }
    catch (e) { /* localStorage penuh/nonaktif — dirty tetap ada di memori tab ini */ }
};

// Tandai satu id transaksi sebagai "perlu di-push", baik di memori tab ini
// maupun di localStorage (supaya tab lain & sesi berikutnya tahu).
window.markTxDirty = function(id, bookId) {
    bookId = bookId || window.currentBookId;
    window._dirtyTxIds.add(id);
    const store = window._loadDirtyStore();
    store[id] = bookId;
    window._saveDirtyStore(store);
};

// Hapus sekumpulan id dari dirty tracking (dipanggil setelah push berhasil),
// baik dari memori tab ini maupun localStorage.
window.clearTxDirty = function(ids) {
    ids.forEach(id => window._dirtyTxIds.delete(id));
    const store = window._loadDirtyStore();
    ids.forEach(id => { delete store[id]; });
    window._saveDirtyStore(store);
};

// [MULTI-TAB] Dipanggil sekali saat app start (lihat app.js continueAppInit).
// Kalau ada dirty ids tersisa dari sesi/tab sebelumnya yang tidak sempat
// ter-push (tab ditutup, koneksi putus, dsb), push sekarang juga -- per buku,
// memakai cache localStorage buku itu (bukan window.txs, karena buku itu
// belum tentu sedang aktif/ditampilkan).
window.flushPendingDirtyOnStart = async function() {
    if (!window.isOnline()) return;
    const store = window._loadDirtyStore();
    const ids = Object.keys(store);
    if (ids.length === 0) return;
    const byBook = {};
    ids.forEach(id => { (byBook[store[id]] = byBook[store[id]] || []).push(id); });
    for (const bookId in byBook) {
        const cacheRaw = localStorage.getItem('sk_txs_' + bookId);
        const cacheTxs = cacheRaw ? JSON.parse(cacheRaw) : [];
        const dirtySet = new Set(byBook[bookId]);
        await window.pushToCloud(bookId, cacheTxs, dirtySet);
    }
};

// [MULTI-TAB] Kalau tab LAIN di browser yang sama menulis ke localStorage,
// event 'storage' otomatis terpicu di tab ini (tidak pernah terpicu di tab
// yang menulis sendiri -- pas untuk kebutuhan kita).
//   - Cache transaksi buku yang sedang dibuka berubah (tab lain
//     tambah/ubah/hapus, atau tab lain barusan pull dari cloud) -> reload
//     window.txs dari localStorage & render ulang, supaya tab ini tidak
//     menampilkan data basi ATAU nanti mem-push balik data basi itu.
//   - Dirty store berubah -> sinkronkan window._dirtyTxIds in-memory tab ini,
//     supaya siapa pun (tab ini atau tab lain) yang debounce-nya lebih dulu
//     selesai, ikut mem-push id yang ditandai tab lain, dan tidak ada tab
//     yang mem-push ulang id yang barusan berhasil di-push tab lain.
window.addEventListener('storage', function(e) {
    if (!e.key) return;
    if (e.key === 'sk_txs_' + window.currentBookId) {
        try {
            window.txs = e.newValue ? JSON.parse(e.newValue) : [];
            window.render();
        } catch (err) { console.warn('[MultiTab] Gagal parse update txs dari tab lain:', err); }
        return;
    }
    if (e.key === window._dirtyStoreKey) {
        try {
            const store = e.newValue ? JSON.parse(e.newValue) : {};
            window._dirtyTxIds = new Set(Object.keys(store).filter(id => store[id] === window.currentBookId));
        } catch (err) { console.warn('[MultiTab] Gagal parse dirty store dari tab lain:', err); }
    }
});

// [KONFLIK MULTI-DEVICE] Fungsi ini adalah implementasi "batch" asli (push
// banyak baris sekaligus lewat POST upsert -- menang berdasar updated_at
// terbaru, TANPA pengecekan apakah baris itu berubah di device lain sejak
// device ini terakhir melihatnya). Untuk baris yang BARU (belum pernah ada
// di cloud) ini tidak masalah -- tidak ada yang bisa "ditimpa".
//
// Tapi untuk baris HASIL EDIT transaksi yang sudah ada, js/sync-conflict.js
// MEMBUNGKUS fungsi ini: window.pushToCloud di bawah ini ditimpa ulang di
// sana supaya baris hasil edit (yang device ini punya "baseline" updated_at
// dari saat form edit dibuka -- lihat window.setEditBaseline) di-push lewat
// jalur kondisional (window._pushSingleTxConditional) yang bisa mendeteksi
// kalau device LAIN sudah mengubah baris yang sama duluan, lalu menampilkan
// dialog resolusi konflik -- bukan diam-diam saling timpa. Baris baru (tanpa
// baseline) tetap lewat jalur batch ini seperti biasa. Lihat js/sync-conflict.js
// untuk detail lengkap.
window.pushToCloud = async function(bookId, txs, dirtyIds) {
    // bookId & txs opsional: jika diisi (dari debouncedPushToCloud), pakai snapshot
    // yang di-capture saat debounce dipanggil — bukan nilai currentBookId/txs saat ini
    // yang mungkin sudah berubah karena user pindah buku (Bug Fix 2).
    if (!window.isOnline()) return;
    bookId = bookId || window.currentBookId;
    txs = txs || window.txs;
    // dirtyIds undefined/null -> mode lama (force full push), dipakai sengaja oleh
    // restore backup/import (lihat backup.js: saveTransactions(true)) karena di situ
    // memang SELURUH data lokal harus menang menimpa cloud.
    // dirtyIds diisi (Set, boleh kosong) -> hanya push baris yang berubah di device ini.
    let toPush = txs;
    if (dirtyIds) {
        toPush = txs.filter(t => dirtyIds.has(t.id));
        if (toPush.length === 0) return;
    }
    const _ptTag = window.getAccountTag ? window.getAccountTag() : null;
    // [SECURITY] Jumlah/kategori/catatan/lampiran dienkripsi jadi satu kolom
    // enc_payload sebelum dikirim -- kolom lama (amount/category/description/
    // attachment/type) SENGAJA tidak lagi diisi nilai asli. Lihat
    // window.encodeCloudTxPayload di crypto.js dan
    // sql/harden_transactions_encryption.sql untuk migrasi kolomnya.
    // Jika kunci sesi entah kenapa belum siap (seharusnya tidak mungkin saat
    // terkunci), fallback aman: tetap kirim plaintext ke kolom lama supaya
    // data tidak hilang, daripada gagal total.
    const payload = await Promise.all(toPush.map(async t => {
        const encPayload = await window.encodeCloudTxPayload(t);
        const base = {
            id: t.id,
            book_id: bookId,
            device_id: window.deviceId,
            date: t.date,
            updated_at: t.updated_at || new Date().toISOString(),
            ...(_ptTag ? { account_tag: _ptTag } : {})
        };
        if (encPayload) {
            return { ...base, enc_payload: encPayload, type: null, amount: null, category: null, description: null, attachment: null };
        }
        console.warn('[Security] Kunci sesi tidak tersedia, transaksi', t.id, 'dikirim TIDAK terenkripsi (fallback).');
        return { ...base, type: t.type, amount: parseFloat(t.amount) || 0, category: t.category || '', description: t.description || '', attachment: t.attachment || null };
    }));
    if (payload.length === 0) return;
    let res = await window.callSupabaseAPI('transactions', 'POST', payload);
    if (res && Array.isArray(res)) {
        console.log(`Sinkronisasi ${res.length} transaksi ke Supabase Cloud berhasil.`);
        // [FIX CLOCK SKEW] `res` adalah representasi baris SETELAH trigger DB
        // menimpa updated_at dengan jam SERVER (lihat
        // sql/server_side_updated_at_trigger.sql). Timpa cache lokal (tab ini
        // dan buku lain di localStorage) dengan updated_at server yang
        // sungguhan, supaya device ini juga memakai jam yang sama dengan
        // device lain saat membandingkan cloudUpdated >= localUpdated nanti.
        const byId = {};
        res.forEach(r => { byId[r.id] = r.updated_at; });
        if (bookId === window.currentBookId) {
            window.txs = window.txs.map(t => byId[t.id] ? { ...t, updated_at: byId[t.id] } : t);
            localStorage.setItem('sk_txs_' + bookId, JSON.stringify(window.txs));
        } else {
            const cacheRaw = localStorage.getItem('sk_txs_' + bookId);
            if (cacheRaw) {
                try {
                    const cache = JSON.parse(cacheRaw).map(t => byId[t.id] ? { ...t, updated_at: byId[t.id] } : t);
                    localStorage.setItem('sk_txs_' + bookId, JSON.stringify(cache));
                } catch (e) { /* cache buku lain tidak valid, biarkan apa adanya */ }
            }
        }
        if (dirtyIds) {
            // Hapus HANYA id yang barusan berhasil di-push, dari memori DAN
            // localStorage (window.clearTxDirty), supaya tab lain juga tahu id
            // ini sudah beres dan tidak mem-push ulang. Kalau ada edit baru
            // masuk selama network delay (setelah snapshot diambil di
            // debouncedPushToCloud), id itu ditandai ulang lewat markTxDirty
            // dan TIDAK ada di toPush ini, jadi tidak ikut terhapus -- akan
            // ke-push di siklus debounce berikutnya.
            window.clearTxDirty(toPush.map(t => t.id));
        }
        window._lastSyncTime = new Date();
        window.updateSyncTimeBadge();
    }
};

window.debouncedPushToCloud = function(forceFullPush) {
    // [BUG FIX 2] Capture bookId SEKARANG (sebelum delay 1500ms).
    // Tanpa ini, jika user switchBook dalam 1.5 detik setelah edit transaksi,
    // pushToCloud() terjadi setelah currentBookId sudah berganti — transaksi
    // buku lama ter-push dengan book_id buku baru di Supabase.
    const bookIdSnapshot = window.currentBookId;
    const txsSnapshot = [...window.txs];
    // Snapshot dirty ids SEKARANG juga, dengan alasan yang sama seperti bookId/txs
    // di atas: supaya id yang ditambahkan ke window._dirtyTxIds SETELAH titik ini
    // (edit baru yang masuk selama delay) tidak ikut ke-clear oleh push ini.
    const dirtySnapshot = forceFullPush ? null : new Set(window._dirtyTxIds);
    if (window._pushDebounceTimer) clearTimeout(window._pushDebounceTimer);
    window._pushDebounceTimer = setTimeout(() => {
        window.pushToCloud(bookIdSnapshot, txsSnapshot, dirtySnapshot);
    }, 1500);
};

window.addCloudLog = async function(actionType, detailsText) {
    let localLogs = JSON.parse(localStorage.getItem('sk_logs_' + window.currentBookId) || '[]');
    let logObj = { timestamp: new Date().toISOString(), device_id: window.deviceId, action: actionType, details: detailsText };
    localLogs.unshift(logObj);
    if (localLogs.length > 50) localLogs.pop();
    localStorage.setItem('sk_logs_' + window.currentBookId, JSON.stringify(localLogs));
    window.renderLogs(localLogs);
    if (!window.isOnline()) return;
    const _alTag = window.getAccountTag ? window.getAccountTag() : null;
    const logPayload = [{
        book_id: window.currentBookId,
        device_id: window.deviceId,
        action: actionType,
        details: detailsText,
        timestamp: new Date().toISOString(),
        ...(_alTag ? { account_tag: _alTag } : {})
    }];
    await window.callSupabaseAPI('audit_logs', 'POST', logPayload);
};

window.refreshLogsFromCloud = async function() {
    let area = document.getElementById('logSummaryArea');
    if (!window.isOnline()) { window.refreshLogsLocal(); return; }
    area.innerText = "Memuat log dari cloud...";
    const _glTag = window.getAccountTag ? window.getAccountTag() : null;
    // OR filter: log ber-tag akun ini ATAU log lama tanpa tag.
    const _glTagFilter = window.tagOrFilter(_glTag);
    let cloudLogs = await window.callSupabaseAPI('audit_logs', 'GET', null, `?book_id=eq.${window.currentBookId}&order=timestamp.desc&limit=30${_glTagFilter}`);
    if (cloudLogs && Array.isArray(cloudLogs)) {
        window.renderLogs(cloudLogs);
    } else {
        area.innerText = "Gagal memuat log dari cloud, menampilkan log lokal jika ada.";
        window.refreshLogsLocal();
    }
};
window.refreshLogsLocal = function() {
    let localLogs = JSON.parse(localStorage.getItem('sk_logs_' + window.currentBookId) || '[]');
    window.renderLogs(localLogs);
};
window.renderLogs = function(logArray) {
    let area = document.getElementById('logSummaryArea');
    if (!area) return;
    if (logArray.length === 0) { area.innerText = "Belum ada log aktivitas."; return; }
    area.innerHTML = '';
    logArray.forEach(l => {
        let div = document.createElement('div');
        div.className = 'log-line';
        let tagClass = 'tag-system';
        if (l.action === 'TAMBAH') tagClass = 'tag-add';
        else if (l.action === 'UBAH') tagClass = 'tag-edit';
        else if (l.action === 'HAPUS') tagClass = 'tag-delete';
        let t = l.timestamp ? new Date(l.timestamp).toLocaleTimeString('id-ID') : '';
        div.innerHTML = `<span class="log-tag ${tagClass}">${window.escapeHtml(l.action)}</span> [${window.escapeHtml(t)}] Device:${window.escapeHtml(l.device_id || 'UNKNOWN')} - ${window.escapeHtml(l.details)}`;
        area.appendChild(div);
    });
};

window.loadTransactions = function() {
    let stored = localStorage.getItem('sk_txs_' + window.currentBookId);
    window.txs = stored ? JSON.parse(stored) : [];
    window.txs.sort((a, b) => window.parseTxDate(b.date) - window.parseTxDate(a.date));
    // [MULTI-TAB] Muat dirty ids milik buku ini dari localStorage. Ini bisa berisi
    // id yang ditandai tab lain (belum sempat ke-push tab itu) atau sisa dari sesi
    // sebelumnya yang belum sempat online. Timpa in-memory Set supaya tidak
    // "mencampur" dirty ids buku sebelumnya yang sedang aktif di tab ini.
    const _dirtyStore = window._loadDirtyStore();
    window._dirtyTxIds = new Set(Object.keys(_dirtyStore).filter(id => _dirtyStore[id] === window.currentBookId));
    window.render();
    if (window.isOnline()) window.pullFromCloudSilently();
};

window.saveTransactions = function(forceFullPush) {
    // forceFullPush=true dipakai HANYA oleh restore backup lokal/cloud dan import
    // JSON (lihat backup.js) -- kasus di mana window.txs memang sengaja diganti
    // total dan seluruh isinya harus menang menimpa cloud. Untuk tambah/ubah
    // transaksi biasa, JANGAN pernah pass true di sini -- biarkan default
    // (push hanya baris dirty) supaya tidak menimpa perubahan device lain.
    window.trimAndSaveLocal(window.currentBookId, window.txs);
    window.render();
    window.debouncedPushToCloud(forceFullPush);
};
