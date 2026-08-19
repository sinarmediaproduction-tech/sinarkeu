// ==================== DB: PULL SETTINGS ====================
// Pecahan dari js/db.js -- lihat catatan pembagian modul di js/db-api.js.
// Harus dimuat setelah db-api.js & db-settings-push.js (memakai
// window.pushSetting/window._healStaleCloudSetting saat heal data basi).
//
// Isi file ini: dekripsi nilai setting dari cloud (_decryptSettingValue)
// dan window.pullAllSettings -- tarik & gabungkan semua setting
// (buku, anggaran, buku bersama, dst.) dari cloud ke lokal.


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

