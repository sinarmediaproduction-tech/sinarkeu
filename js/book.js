// ==================== BOOK MANAGEMENT ====================
// Hitung saldo akhir sebuah buku dari cache lokal (sk_txs_<id> + sk_balance_offset_<id>)
// TANPA perlu berpindah/membuka buku tsb -- makanya dropdown pindah buku bisa
// langsung menampilkan saldo tiap buku. Catatan: kalau buku itu belum pernah
// dibuka di device ini, cache-nya belum ada, jadi saldo tidak bisa ditampilkan
// (return null, bukan 0, supaya tidak menyesatkan seolah saldonya benar-benar nol).
window.getBookBalanceLabel = function(bookId) {
    try {
        const raw = localStorage.getItem('sk_txs_' + bookId);
        if (raw === null) return null;
        const txs = JSON.parse(raw || '[]');
        let inc = 0, exp = 0;
        txs.forEach(t => {
            const amt = Number(t.amount) || 0;
            if (t.type === 'income') inc += amt; else exp += amt;
        });
        const offset = Number(localStorage.getItem('sk_balance_offset_' + bookId)) || 0;
        return window.rp(inc - exp + offset);
    } catch (e) {
        return null;
    }
};

// [FIX BUKU TAMPIL 0 TRANSAKSI] Jumlah transaksi sebuah buku dari cache lokal
// (sk_txs_<id>), TANPA perlu berpindah/membuka buku tsb -- pasangan dari
// window.getBookBalanceLabel di atas, dipakai window.renderBookList supaya
// modal "Kelola Buku" bisa menampilkan jumlah transaksi tiap buku. PENTING:
// kembalikan null (bukan 0) kalau cache buku ini belum pernah ada sama sekali
// di device ini -- sama seperti getBookBalanceLabel, supaya pemanggil tahu
// bedanya antara "buku ini betul-betul kosong" vs "datanya belum sempat
// dimuat" dan tidak salah menampilkan "0 transaksi" utk kasus kedua.
// Catatan: ini menghitung baris di CACHE LOKAL saja, yang dibatasi
// MAX_LOCAL_TXS transaksi terbaru (lihat trimAndSaveLocal di transaction.js)
// -- untuk buku dengan riwayat sangat panjang, angka ini adalah jumlah
// transaksi TERBARU yang tersimpan di device ini, bukan jumlah total
// sepanjang sejarah buku itu di cloud.
window.getBookTxCount = function(bookId) {
    try {
        const raw = localStorage.getItem('sk_txs_' + bookId);
        if (raw === null) return null;
        const txs = JSON.parse(raw || '[]');
        return Array.isArray(txs) ? txs.length : null;
    } catch (e) {
        return null;
    }
};

// [FIX BUKU TAMPIL 0 TRANSAKSI] Pastikan cache lokal SETIAP buku di
// window.books sudah pernah ditarik minimal sekali sebelum modal "Kelola
// Buku" menampilkan info saldo/jumlah transaksinya -- sebelumnya modal itu
// (dan komponen lain yang memakai getBookBalanceLabel/getBookTxCount) diam-
// diam mengandalkan cache yang kebetulan SUDAH ada dari sesi buka-buku
// sebelumnya; buku yang belum pernah dibuka sama sekali di device ini (mis.
// buku bersama yang baru diterima, atau anak buku yang baru dibuat di device
// lain) cache-nya kosong sama sekali. Tanpa fungsi ini, kondisi itu terlihat
// SAMA seperti buku yang memang benar-benar tidak punya transaksi -- padahal
// dua hal itu beda ("belum dimuat" vs "memang kosong"). Fungsi ini menarik
// (via window.pullOneBookFromCloud) hanya buku-buku yang cache-nya masih
// null, lalu memanggil onLoaded() supaya UI bisa render ulang begitu data
// yang tadinya hilang itu selesai dimuat.
window.ensureAllBooksLoaded = async function(onLoaded) {
    if (!Array.isArray(window.books) || window.books.length === 0) return;
    if (!window.isOnline || !window.isOnline()) return;
    const unloaded = window.books.filter(b => localStorage.getItem('sk_txs_' + b.id) === null);
    if (unloaded.length === 0) return;
    if (typeof window.pullOneBookFromCloud !== 'function') return;
    // [FIX "MEMUAT DATA..." TANPA HENTI] window.pullOneBookFromCloud() bisa
    // gagal diam-diam (mis. error RLS/auth 42501 untuk buku bersama yang
    // status keanggotaannya belum termuat, atau timeout jaringan -- lihat
    // window.callSupabaseAPI di js/db-api.js yang me-return null pada error
    // TANPA melempar exception). Kalau itu terjadi, cache buku ybs TETAP
    // null selamanya, dan sebelumnya UI cuma diam menampilkan "Memuat
    // data..." tanpa pernah mencoba lagi ATAU memberi tahu penggunanya ada
    // yang gagal. window._bookLoadFailed menandai buku mana yang gagal,
    // supaya window.renderBookList bisa menampilkan status "Gagal memuat"
    // dengan tombol coba lagi, bukan status loading yang menggantung.
    if (!window._bookLoadFailed) window._bookLoadFailed = new Set();
    const results = await Promise.allSettled(unloaded.map(async b => {
        await window.pullOneBookFromCloud(b.id);
        // callSupabaseAPI mengembalikan null pada error TANPA melempar --
        // jadi sukses/gagalnya ditentukan dari APAKAH cache akhirnya
        // benar-benar terisi, bukan dari ada/tidaknya exception di sini.
        if (localStorage.getItem('sk_txs_' + b.id) === null) throw new Error('load-failed');
    }));
    unloaded.forEach((b, i) => {
        if (results[i].status === 'fulfilled') window._bookLoadFailed.delete(b.id);
        else window._bookLoadFailed.add(b.id);
    });
    const anyLoaded = results.some(r => r.status === 'fulfilled');
    if (anyLoaded && typeof onLoaded === 'function') onLoaded();
};

// [FIX "MEMUAT DATA..." TANPA HENTI] Coba tarik ulang SATU buku yang gagal
// dimuat, dipicu manual lewat tombol "Coba lagi" di window.renderBookList
// (bukan otomatis -- supaya tidak spam retry sendiri kalau memang lagi ada
// masalah koneksi/RLS yang butuh user melakukan sesuatu dulu, mis. login
// ulang Supabase Auth untuk buku bersama).
window.retryLoadBook = async function(bookId) {
    if (!window.requireOnline || !window.requireOnline('memuat data buku')) return;
    if (typeof window.pullOneBookFromCloud !== 'function') return;
    if (!window._bookLoadFailed) window._bookLoadFailed = new Set();
    try {
        await window.pullOneBookFromCloud(bookId);
        if (localStorage.getItem('sk_txs_' + bookId) === null) throw new Error('load-failed');
        window._bookLoadFailed.delete(bookId);
    } catch (e) {
        window._bookLoadFailed.add(bookId);
        window.showToast('Masih gagal memuat data buku ini. Periksa koneksi, atau coba sinkronisasi ulang lewat Setelan.', 'warning');
    }
    window.renderBookList();
    window.updateBookSelectDropdown();
};

// [SIDEBAR-BOOK] Isi nama buku aktif di elemen paling atas sidebar
// (#sidebarActiveBook). Nama lengkap dipakai saat sidebar normal; inisialnya
// (maks. 2 huruf, dari 2 kata pertama nama buku) dipakai saat sidebar
// diciutkan ke mode icon-only lewat CSS body.sidebar-collapsed. Dipanggil
// dari window.updateBookSelectDropdown() supaya selalu ikut sinkron setiap
// kali daftar buku / buku aktif berubah, tanpa perlu dipanggil manual di
// tempat lain.
window.updateSidebarActiveBook = function() {
    const fullEl = document.getElementById('sidebarActiveBookFull');
    const initialEl = document.getElementById('sidebarActiveBookInitial');
    const wrapEl = document.getElementById('sidebarActiveBook');
    if (!fullEl || !initialEl || !wrapEl) return;

    const book = (window.books || []).find(b => b.id === window.currentBookId);
    const name = book ? book.name : '';

    fullEl.textContent = name;
    wrapEl.title = name;

    const words = name.trim().split(/\s+/).filter(Boolean);
    let initials = '';
    if (words.length >= 2) {
        initials = (words[0][0] || '') + (words[1][0] || '');
    } else if (words.length === 1) {
        initials = words[0].slice(0, 2);
    }
    initialEl.textContent = initials.toUpperCase();
};

window.updateBookSelectDropdown = function() {
    let sel = document.getElementById('currentBookSelect');
    sel.innerHTML = '';
    window.updateSidebarActiveBook();

    // Ikuti setelan privasi "Sembunyikan Saldo" (sk_balance_hidden) yang sama
    // dipakai oleh saldo hero di dashboard -- kalau user sedang menyembunyikan
    // saldo, jangan bocorkan saldo tiap buku lewat dropdown ini.
    const balanceHidden = localStorage.getItem('sk_balance_hidden') === '1';

    // [UI] Kelompokkan anak buku tepat di bawah buku induknya (bukan
    // mengikuti urutan asli array window.books apa adanya), supaya
    // hierarki induk → anak terlihat jelas di dropdown pilih buku.
    const childrenByParent = {};
    const topLevel = [];
    const idSet = new Set(window.books.map(b => b.id));
    window.books.forEach(b => {
        if (b.parentId && idSet.has(b.parentId)) {
            (childrenByParent[b.parentId] = childrenByParent[b.parentId] || []).push(b);
        } else {
            // Buku mandiri, ATAU anak buku "yatim" (induknya sudah tidak
            // ada/terhapus) — tetap ditampilkan sebagai level teratas
            // supaya tidak hilang dari daftar.
            topLevel.push(b);
        }
    });

    function addOption(b, isChild) {
        let opt = document.createElement('option');
        opt.value = b.id;
        const namePart = isChild ? '  ↳ ' + b.name : b.name;
        opt.textContent = namePart;
        const balanceLabel = balanceHidden ? null : window.getBookBalanceLabel(b.id);
        if (balanceLabel) opt.setAttribute('data-balance', balanceLabel);
        if (isChild) opt.setAttribute('data-child', '1');
        if (b.id === window.currentBookId) opt.selected = true;
        sel.appendChild(opt);
    }

    topLevel.forEach(b => {
        addOption(b, false);
        (childrenByParent[b.id] || []).forEach(child => addOption(child, true));
    });
};

window.switchBook = async function(id) {
    if (!window.books.find(b => b.id === id)) return;
    if (id === window.currentBookId) return;
    window.currentBookId = id;
    localStorage.setItem('sk_current_book_id', window.currentBookId);
    // [FIX "DAFTAR TRANSAKSI TAMPIL 0 TAPI LAPORAN BULANAN ADA"] Override
    // rentang filter (js/render.js) cuma valid untuk buku yang menghasilkannya
    // -- buang begitu pindah buku supaya buku baru tidak sekilas menampilkan
    // hasil verifikasi cloud milik buku SEBELUMNYA (window.render sendiri
    // sudah mengecek bookId cocok, tapi ini mencegah kedip data buku lama).
    window._cloudFilterOverride = null;

    // [SMOOTH BOOK SWITCH] Tandai body sedang berpindah buku (lihat
    // css/style.css: body.sk-book-switching) supaya konten yang sedang
    // tampil meredup halus alih-alih tiba-tiba "meloncat" berganti isi, dan
    // titik denyut kecil muncul di sebelah nama buku aktif di sidebar.
    // Dropdown pilih buku juga dikunci sementara supaya tidak bisa diklik
    // ganda selagi proses (lokal + tarik cloud) masih berjalan. Dibungkus
    // try/finally supaya SELALU dilepas lagi apa pun hasilnya (termasuk
    // kalau offline dan fungsi berhenti lebih awal, atau pull cloud gagal).
    document.body.classList.add('sk-book-switching');
    const _bookSelectEl = document.getElementById('currentBookSelect');
    if (_bookSelectEl) _bookSelectEl.disabled = true;

    try {
        // Muat data lokal buku baru terlebih dahulu agar UI tidak kosong
        window.budgets = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
        const cached = localStorage.getItem('sk_txs_' + window.currentBookId);
        window.txs = cached ? JSON.parse(cached) : [];
        window.render();
        window.updateBookSelectDropdown();
        if (document.getElementById('bookManagerModal').classList.contains('show')) window.renderBookList();
        if (document.getElementById('shoppingListModal').classList.contains('show') && typeof window.renderShoppingList === 'function') window.renderShoppingList();
        window.showToast("Berhasil beralih ke: " + (window.books.find(b => b.id === id)?.name || id));

        // [REALTIME] Alihkan channel realtime (js/realtime-sync.js) ke buku
        // baru ini -- no-op aman kalau buku ini bukan Buku Bersama (channel
        // lama, kalau ada, tetap dilepas supaya tidak nyangkut ke buku
        // sebelumnya). Dipanggil sebelum guard offline di bawah karena
        // fungsinya sendiri sudah aman dipanggil saat offline (langsung return).
        if (typeof window.skStartRealtimeSync === 'function') window.skStartRealtimeSync(id);

        if (!window.isOnline()) return;

        // Pastikan session crypto key sudah ada sebelum pull cloud.
        // Setelah reload, _sessionCryptoKey hilang (in-memory only) —
        // tanpa ini, _decryptSettingValue() gagal decrypt dan data cloud tidak terbaca.
        if (!window._sessionCryptoKey) {
            await window.restoreSessionCryptoKey();
        }

        // ── PULL SEMUA DATA CLOUD UNTUK BUKU BARU ──
        try {
            // 1. Transaksi + settings sekaligus (parallel)
            await Promise.all([
                window.pullFromCloudSilently(),
                window.pullAllSettings(),
            ]);

            // 2. Payment reminders (per-buku, tidak dicakup pullAllSettings)
            try {
                const reminders = await window.loadPaymentReminders(window.currentBookId);
                if (reminders && reminders.length > 0) {
                    localStorage.setItem('sk_payment_reminders_' + window.currentBookId, JSON.stringify(reminders));
                }
                if (typeof window.renderPaymentReminders === 'function') await window.renderPaymentReminders();
                if (typeof window.updatePaymentReminderBanner === 'function') window.updatePaymentReminderBanner();
            } catch (e) {
                window.skWarn('[switchBook] Gagal pull payment reminders:', e);
            }

            // Render ulang semua card keuangan setelah semua data per-buku selesai dimuat
            if (typeof window.updateFinancialCards === 'function') window.updateFinancialCards();
            if (typeof window.updateFaseCard === 'function') window.updateFaseCard();
            if (typeof window.renderForecastCard === 'function') window.renderForecastCard();

            window._lastSyncTime = new Date();
            if (typeof window.updateSyncTimeBadge === 'function') window.updateSyncTimeBadge();
        } catch (e) {
            console.error('[switchBook] Gagal pull data cloud:', e);
            window.showToast('Sebagian data cloud gagal dimuat', 'warning');
        }
        // [FRAUD-DETECTION] Buku aktif berganti -- pindai ulang & ambil log buku
        // baru (cache log fraud lama milik buku sebelumnya tidak relevan lagi).
        // [LAZY-LOAD] window.skRefreshFraudAlerts (js/utils.js) otomatis
        // memuat js/fraud-detection.js dulu kalau belum ada.
        window.skRefreshFraudAlerts();
    } finally {
        document.body.classList.remove('sk-book-switching');
        if (_bookSelectEl) _bookSelectEl.disabled = false;
    }
};

window.openBookManager = function() {
    if (!window.requireOnline('mengelola buku')) return;
    window.openModal('bookManagerModal');
    // [FIX BUKU TAMPIL 0 TRANSAKSI] Reset guard tiap modal ini dibuka ulang,
    // supaya buku yang cache-nya masih kosong (mis. baru selesai dihapus lalu
    // dibuat lagi, atau baru diterima sbg anggota buku bersama sejak modal
    // terakhir dibuka) tetap dicoba ditarik lagi -- bukan cuma sekali seumur
    // sesi app. Lihat window.renderBookList untuk pemakaiannya.
    window._bookListLoadingTriggered = false;
    window.renderBookList();
    window.renderBookParentOptions();
    if (typeof window.skRenderAuthPanel === 'function') window.skRenderAuthPanel();
};

window.renderBookParentOptions = function() {
    const sel = document.getElementById('newBookParent');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Buku mandiri (tidak ada induk) —</option>';
    window.books.forEach(b => {
        // Hanya tampilkan buku yang bukan anak buku (tidak boleh nested lebih dari 1 level)
        if (b.parentId) return;
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name;
        sel.appendChild(opt);
    });
};

window.renderBookList = function() {
    let container = document.getElementById('bookListContainer');
    container.innerHTML = '';
    // [UI] Tidak ada mekanisme "wajib minimal 1 buku utama" di aplikasi ini
    // -- kalau daftar buku benar-benar kosong (mis. semua buku dihapus, atau
    // akun baru yang belum pernah punya buku), tampilkan pesan ramah supaya
    // jelas ini kondisi valid, bukan error/loading macet.
    if (!Array.isArray(window.books) || window.books.length === 0) {
        container.innerHTML = '<div style="padding:1.25rem 1rem; text-align:center; color:#9AA2AC; font-size: var(--text-base);">Belum ada buku kas sama sekali.<br>Buat buku pertama Anda lewat form di atas.</div>';
        return;
    }
    // [FIX BUKU TAMPIL 0 TRANSAKSI] Kalau ada buku yang cache-nya belum
    // pernah dimuat di device ini, tarik datanya di background lalu render
    // ulang daftar ini begitu selesai -- supaya baris "0 transaksi" yang
    // muncul SEBELUM data sungguhan sempat ditarik tidak dikira final.
    // Guard _bookListLoadingTriggered mencegah pemanggilan berulang tiap
    // renderBookList() dipanggil ulang (mis. dari onLoaded() di bawah)
    // memicu tarikan baru lagi selama modal masih terbuka.
    if (!window._bookListLoadingTriggered) {
        window._bookListLoadingTriggered = true;
        window.ensureAllBooksLoaded(() => {
            window._bookListLoadingTriggered = false;
            window.renderBookList();
            window.updateBookSelectDropdown();
        });
    }
    window.books.forEach(b => {
        let div = document.createElement('div');
        div.className = 'book-list-item';
        let isCurrent = b.id === window.currentBookId;
        // [FIX BUKU TAMPIL 0 TRANSAKSI] Saldo & jumlah transaksi per buku.
        // null artinya cache buku ini belum ada sama sekali di device ini
        // (belum pernah dibuka/ditarik) -- BUKAN berarti buku itu kosong,
        // jadi jangan tampilkan "0 transaksi" untuk kasus ini. Selagi
        // window.ensureAllBooksLoaded() di atas menariknya di background,
        // tampilkan label "Memuat data…" supaya jelas ini kondisi sementara.
        const balanceLabel = window.getBookBalanceLabel(b.id);
        const txCount = window.getBookTxCount(b.id);
        const didFail = window._bookLoadFailed && window._bookLoadFailed.has(b.id);
        let statsLabel;
        if (txCount !== null) {
            statsLabel = `<span style="font-size: var(--text-2xs); color:#5C6470;">${txCount.toLocaleString('id-ID')} transaksi${balanceLabel ? ' · Saldo ' + window.escapeHtml(balanceLabel) : ''}</span>`;
        } else if (didFail) {
            // [FIX "MEMUAT DATA..." TANPA HENTI] Cache masih null SETELAH
            // dicoba ditarik (bukan lagi loading pertama kali) -- tampilkan
            // status gagal yang jelas + tombol coba lagi, jangan biarkan
            // pengguna mengira buku ini memang tidak punya transaksi.
            statsLabel = `<span style="font-size: var(--text-2xs); color:#B23B3B;">Gagal memuat data</span> <button type="button" class="btn-mini" style="font-size: var(--text-2xs); padding:1px 6px;" onclick="window.retryLoadBook('${b.id}')">Coba lagi</button>`;
        } else {
            statsLabel = '<span style="font-size: var(--text-2xs); color:#9AA2AC; font-style:italic;">Memuat data…</span>';
        }
        // [FIX BUG #1 & #2] Buku bersama cuma boleh dihapus/diganti nama
        // oleh admin buku itu. Sebelumnya tombol ini muncul untuk semua
        // role (viewer/editor termasuk) tanpa pengecekan apa pun.
        const canManageThisBook = !b._isShared || (typeof window.skGetRoleForBook === 'function' && window.skGetRoleForBook(b.id) === 'admin');
        let delBtn = (window.books.length > 1 && canManageThisBook) ? `<button class="btn-mini btn-mini-danger" onclick="window.deleteBook('${b.id}')">Hapus</button>` : '';
        if (isCurrent) delBtn = '<span style="font-size: var(--text-2xs); color:#2E6B4F; font-weight:bold;">SEDANG AKTIF</span>';
        const parentBook = b.parentId ? window.books.find(x => x.id === b.parentId) : null;
        const parentLabel = parentBook ? `<div style="font-size: var(--text-2xs); color:#5C4E72; margin-top:2px;">↳ Anak dari: <b>${window.escapeHtml(parentBook.name)}</b></div>` : '';
        const sharedLabel = b._isShared ? `<div style="font-size: var(--text-2xs); color:var(--success); margin-top:2px;">🔗 Buku bersama · peran kamu: <b>${window.escapeHtml(b._role || '?')}</b></div>` : '';
        const makeSharedBtn = (!b._isShared && typeof window.skMakeBookShared === 'function') ?
            `<button class="btn-mini" style="background:var(--success-lt); color:var(--success); border:1px solid var(--rule);" onclick="window.skMakeBookShared('${b.id}')" title="Undang orang lain untuk ikut mengelola buku ini">Jadikan Bersama</button>` : '';
        // Kebalikan dari makeSharedBtn -- cuma admin buku ini yang boleh
        // (lihat window.skMakeBookPrivate untuk detail efeknya: semua
        // anggota lain langsung kehilangan akses begitu buku ini jadi
        // pribadi lagi).
        const makePrivateBtn = (b._isShared && canManageThisBook && typeof window.skMakeBookPrivate === 'function') ?
            `<button class="btn-mini" style="background:#F1EBDA; color:#9C7A2E; border:1px solid #B99A4E;" onclick="window.skMakeBookPrivate('${b.id}')" title="Hapus akses semua anggota &amp; kembalikan buku ini jadi pribadi (hanya di device ini)">Jadikan Pribadi Lagi</button>` : '';
        // [FITUR DUPLIKAT BUKU] Buku bersama SENGAJA tidak boleh diduplikat
        // lewat tombol ini (lihat window.duplicateBook untuk alasannya) --
        // jalur otentikasi & tabel book_members/sk_books-nya terpisah dari
        // buku biasa, di luar cakupan fitur ini.
        const duplicateBtn = !b._isShared ?
            `<button class="btn-mini" style="background:#EFEAF7; color:#5C4E72; border:1px solid #B7A8D1;" onclick="window.duplicateBook('${b.id}')" title="Buat salinan buku ini (pengaturan &amp; opsional transaksinya)">Duplikat</button>` : '';
        div.innerHTML = `
            <span class="book-list-name">
                ${window.escapeHtml(b.name)}
                ${parentLabel}
                ${sharedLabel}
                <div style="margin-top:2px;">${statsLabel}</div>
            </span>
            <div class="book-list-actions">
                ${!isCurrent ? `<button class="btn-mini" onclick="window.switchBook('${b.id}')">Buka</button>` : ''}
                <button class="btn-mini" style="background:#E3ECF3; color:#2E5C82; border:1px solid #7FA6C4;" onclick="window.renameBook('${b.id}')" ${canManageThisBook ? '' : 'disabled title="Hanya admin yang bisa mengganti nama buku bersama ini"'}>Nama</button>
                <button class="btn-mini" style="background:#F1EBDA; color:#9C7A2E; border:1px solid #B99A4E;" onclick="window.openCardVisibilityModal('${b.id}')" title="Pilih card yang ditampilkan untuk buku ini">Card</button>
                ${duplicateBtn}
                ${makeSharedBtn}
                ${makePrivateBtn}
                ${b.parentId && isCurrent ? `<button class="btn-mini" style="background:#5C4E72; color:#fff;" onclick="window.closeModal('bookManagerModal'); window.openTutupAnakBuku()">Tutup & Kirim</button>` : ''}
                ${delBtn}
            </div>
        `;
        container.appendChild(div);
    });
};

window.renameBook = async function(id) {
    if (!window.requireOnline('mengganti nama buku')) return;
    const book = window.books.find(b => b.id === id);
    if (!book) return;

    // [FIX BUG #2] Sama seperti deleteBook: penjagaan role admin di level
    // fungsi juga (tombol sudah di-disable, ini lapis kedua).
    if (book._isShared && (typeof window.skGetRoleForBook !== 'function' || window.skGetRoleForBook(id) !== 'admin')) {
        window.showToast('Hanya admin yang bisa mengganti nama buku bersama ini.', 'error');
        return;
    }

    const newName = prompt(`Nama baru untuk buku "${book.name}":`, book.name);
    if (!newName || !newName.trim()) return;
    if (newName.trim() === book.name) return;
    const trimmedName = newName.trim();

    // [FIX BUG #2] Sebelumnya rename buku bersama HANYA menulis ke setting
    // pribadi 'books' (localStorage + pushSettingBooks -> tabel `settings`),
    // padahal sistem buku bersama membaca nama dari tabel Supabase
    // `sk_books` (lihat skRefreshSharedAccess di js/auth.js). Akibatnya:
    // 1) anggota lain tidak pernah melihat nama baru, dan
    // 2) nama baru bahkan balik lagi ke nama lama di device sendiri begitu
    //    skRefreshSharedAccess() jalan ulang (mis. reload halaman), karena
    //    fungsi itu selalu menimpa `existing.name = row.name` dari baris
    //    lama di sk_books. Sekarang untuk buku bersama, tabel sk_books
    //    di-update dulu -- kalau ini gagal, jangan lanjut ubah state lokal
    //    supaya tidak ikut "revert sendiri" nanti.
    if (book._isShared) {
        const authClient = window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null;
        if (!authClient) {
            window.showToast('Klien auth Supabase belum siap, coba lagi.', 'error');
            return;
        }
        try {
            const res = await authClient.from('sk_books').update({ name: trimmedName }).eq('id', id);
            if (res.error) throw res.error;
        } catch (e) {
            console.error('[renameBook] Gagal update nama di sk_books:', e);
            window.showToast('Gagal mengganti nama buku bersama: ' + (e && e.message ? e.message : 'error'), 'error');
            return;
        }
    }

    book.name = trimmedName;
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    await window.pushSettingBooks();
    window.renderBookList();
    window.renderBookParentOptions();
    window.updateBookSelectDropdown();
    window.showToast(`Nama buku diubah ke "${book.name}"`, 'success');
    await window.addCloudLog('SISTEM', `Mengganti nama buku ID ${id} menjadi "${book.name}"`);
};

window.addNewBook = async function(e) {
    e.preventDefault();
    if (!window.requireOnline('membuat buku baru')) return;
    let input = document.getElementById('newBookName');
    let name = input.value.trim();
    if (!name) return;
    const parentSel = document.getElementById('newBookParent');
    const parentId = parentSel && parentSel.value ? parentSel.value : null;
    let id = 'b_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newBook = { id, name };
    if (parentId) newBook.parentId = parentId;
    window.books.push(newBook);
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    input.value = '';
    if (parentSel) parentSel.value = '';
    await window.pushSettingBooks();
    await new Promise(r => setTimeout(r, 500));
    await window.pullAllSettings();
    window.renderBookList();
    window.updateBookSelectDropdown();
    const parentName = parentId ? (window.books.find(b => b.id === parentId)?.name || '') : '';
    const label = parentId ? `"${name}" (anak dari "${parentName}")` : `"${name}"`;
    window.showToast(`${label} berhasil dibuat!`, 'success');
    await window.addCloudLog('SISTEM', `Membuat buku kas baru: "${name}" ${parentId ? '(anak dari ' + parentId + ')' : ''} dengan ID ${id}`);
    const cfg = window.getTgConfig();
    if (cfg.active) window.sendTelegramNotif(`<b>Buku Baru Dibuat</b>\n\nNama: ${name}${parentId ? '\nAnak dari: ' + parentName : ''}\nID: ${id}\nDevice: ${window.deviceId}`);
};

window.deleteBook = async function(id) {
    if (!window.requireOnline('menghapus buku')) return;
    if (id === window.currentBookId) {
        await window.customAlert({ title: 'Tidak Bisa Dihapus', message: 'Tidak bisa menghapus buku kas yang sedang dibuka! Silakan pindah ke buku lain terlebih dahulu.' });
        return;
    }
    let b = window.books.find(x => x.id === id);
    if (!b) { window.showToast('Buku sudah tidak ada (mungkin sudah dihapus device lain)', 'warning'); return; }

    // [FIX BUG #1] Penjagaan sisi klien: buku bersama hanya boleh dihapus
    // oleh admin. Tombol di renderBookList sudah disembunyikan untuk
    // non-admin, ini lapis kedua (defense-in-depth) kalau dipicu lewat
    // jalur lain.
    if (b._isShared && (typeof window.skGetRoleForBook !== 'function' || window.skGetRoleForBook(id) !== 'admin')) {
        window.showToast('Hanya admin yang bisa menghapus buku bersama ini.', 'error');
        return;
    }

    const confirm1 = await window.customConfirm({
        title: 'Hapus Buku Permanen',
        message: `Hapus permanen buku "${b.name}"?\n\nData yang dihapus:\n- Semua transaksi dalam buku ini\n- Anggaran bulanan\n- Anggaran Dasar\n- Log aktivitas${b._isShared ? '\n- Semua anggota & akses buku bersama ini' : ''}\n\nData TIDAK BISA dikembalikan!`,
        confirmLabel: 'Lanjut'
    });
    if (!confirm1) return;
    const typedName = await window.customPrompt({
        title: 'Ketik Nama Buku untuk Konfirmasi',
        message: `Ketik nama buku "${b.name}" persis sama untuk mengonfirmasi penghapusan permanen.`,
        expectedValue: b.name
    });
    if (typedName === null) return;
    window.createSafetySnapshot(`Hapus buku "${b.name}"`);
    const cfg = window.getTgConfig();
    if (cfg.active) {
        window.sendTelegramNotif(`<b>Penghapusan Buku</b>\n\nBuku <b>${b.name}</b> akan dihapus oleh device ${window.deviceId}\n\nData akan dihapus dalam 3 detik...`);
        await new Promise(r => setTimeout(r, 2000));
    }
    if (window.isOnline()) {
        const prevBookId = window.currentBookId;
        window.currentBookId = id;
        try {
            const tag_del = window.getAccountTag ? window.getAccountTag() : null;
            const tagFilter_del = tag_del ? `&account_tag=eq.${tag_del}` : '';
            // [FIX BUG #1] callSupabaseAPI TIDAK PERNAH throw kalau request
            // gagal (baik versi asli di db.js maupun versi yang dibungkus
            // auth.js untuk buku shared) -- keduanya catch sendiri lalu
            // return null. Sebelumnya hasil ketiga panggilan ini tidak
            // pernah dicek sama sekali, jadi kalau salah satunya ditolak
            // server (mis. RLS menolak non-admin di buku bersama, atau
            // error lain), blok try ini tetap dianggap "berhasil" -- toast
            // sukses tetap muncul & buku tetap dihapus dari device ini
            // padahal data cloud-nya utuh. Sekarang null dianggap gagal
            // eksplisit, sama seperti exception.
            const r1 = await window.callSupabaseAPI('transactions', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            const r2 = await window.callSupabaseAPI('audit_logs', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            const r3 = await window.callSupabaseAPI('settings', 'DELETE', null, `?book_id=eq.${id}${tagFilter_del}`);
            if (r1 === null || r2 === null || r3 === null) {
                throw new Error('Salah satu penghapusan data cloud ditolak/gagal (cek console untuk detail).');
            }

            // [FIX BUG #1] Buku bersama tersimpan di tabel sk_books +
            // book_members (sistem terpisah, lihat js/auth.js) -- BUKAN
            // cuma di setting 'books' pribadi yang dibersihkan di bawah.
            // Sebelumnya baris ini tidak pernah dihapus, sehingga
            // skRefreshSharedAccess() akan menghidupkan lagi buku "yang
            // sudah dihapus" ini pada kunjungan berikutnya (baik untuk
            // admin sendiri maupun anggota lain), karena baris
            // book_members & sk_books-nya masih utuh di server.
            if (b._isShared) {
                const authClient = window.getSupabaseAuthClient ? window.getSupabaseAuthClient() : null;
                if (!authClient) throw new Error('Klien auth Supabase belum siap, tidak bisa menghapus akses buku bersama.');
                const resMembers = await authClient.from('book_members').delete().eq('book_id', id);
                if (resMembers.error) throw resMembers.error;
                const resBook = await authClient.from('sk_books').delete().eq('id', id);
                if (resBook.error) throw resBook.error;
                if (window._skSharedRoles) delete window._skSharedRoles[id];
            }

            window.skLog(`Data cloud buku "${b.name}" berhasil dihapus.`);
        } catch (e) {
            console.error('Gagal hapus data cloud:', e);
            window.showToast('Gagal menghapus data cloud, coba lagi' + (e && e.message ? ': ' + e.message : ''), 'error');
            window.currentBookId = prevBookId;
            return;
        }
        window.currentBookId = prevBookId;
    }
    localStorage.removeItem('sk_txs_' + id);
    localStorage.removeItem('sk_budgets_' + id);
    localStorage.removeItem('sk_logs_' + id);
    localStorage.removeItem('sk_manual_backups_' + id);
    localStorage.removeItem('sk_last_auto_backup_' + id);
    localStorage.removeItem('sk_last_cloud_backup_' + id);
    localStorage.removeItem('sk_default_budget_' + id);
    localStorage.removeItem('sk_shopping_list_' + id);
    localStorage.removeItem('sk_electricity_plan_' + id);
    delete window._lastFullSyncTime[id];
    delete window._lastSettingsSyncTime.shared[id];
    if (window._saveTxSyncCursor) window._saveTxSyncCursor();
    if (window._saveSettingsSyncCursor) window._saveSettingsSyncCursor();
    // [FIX BOOKS LOST-UPDATE] Tandai id ini sebagai "sengaja dihapus lokal"
    // SEBELUM difilter dari window.books, supaya union-merge di
    // pullAllSettings (js/db.js) tidak salah menghidupkannya lagi kalau
    // pull berikutnya kebetulan masih melihat buku ini di cloud (mis. push
    // di bawah gagal/terputus). Baru dibersihkan setelah push benar-benar
    // dikonfirmasi berhasil (lihat window.clearBookPendingDelete di bawah
    // dan window.flushPendingBookDeletesOnStart di app.js untuk retry-nya).
    if (window.markBookPendingDelete) window.markBookPendingDelete(id);
    // [FIX BUKU HANTU LINTAS DEVICE] Tombstone permanen, beda dari
    // markBookPendingDelete di atas (yang cuma device ini & dibersihkan
    // setelah push terkonfirmasi) -- ini disinkronkan ke cloud lewat
    // pushSettingBooks() dan berlaku untuk SEMUA device/akun yang membaca
    // backend yang sama, supaya buku ini tidak bisa dihidupkan lagi walau
    // ada device lain yang masih membawa cache lama berisi buku ini.
    if (window.addBookTombstone) window.addBookTombstone(id);
    window.books = window.books.filter(x => x.id !== id);
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    window.renderBookList();
    window.updateBookSelectDropdown();
    window.showToast(`Buku "${b.name}" & data cloud dihapus`, "warning");
    const pushOk = await window.pushSettingBooks();
    if (pushOk && window.clearBookPendingDelete) window.clearBookPendingDelete(id);
    if (cfg.active) window.sendTelegramNotif(`<b>Buku Dihapus</b>\n\nBuku <b>${b.name}</b> telah dihapus permanen.\nDevice: ${window.deviceId}`);
};

// ==================== DUPLIKAT BUKU ====================
// Bikin buku baru sebagai salinan dari buku yang sudah ada. Yang otomatis
// disalin (selalu, tanpa tanya): setting per-buku yang dipush lewat
// window.pushSetting (lihat daftar prefix localStorage <-> key setting di
// DUPLICATE_BOOK_SETTINGS_MAP di bawah -- sinkron dengan yang dipakai
// window.reEncryptAllCloudSettings di js/db.js) -- yaitu Anggaran Bulanan,
// Anggaran Dasar, Anggaran Tahunan, visibilitas card, Daftar Belanja +
// pemasukan bulanannya, Daftar Menu (jadwal masak mingguan), Fase
// Kehidupan, dan target bulan Dana Darurat.
// Transaksi (bisa banyak & makan waktu) BUKAN otomatis disalin -- user
// ditanya dulu lewat customConfirm.
//
// SENGAJA TIDAK disalin (beda dari daftar PER_BOOK_PREFIXES di
// js/auth.js window._skMigrateBookIdLocal, yang untuk MIGRASI id buku yang
// SAMA, bukan duplikasi jadi buku BARU):
// - sk_logs_ (log aktivitas lokal, spesifik histori device ini)
// - sk_payment_reminders_ / sk_pr_pending_push_ / sk_pr_pending_delete_
//   (pengingat pembayaran -- di luar cakupan awal fitur ini, tabel &
//   enkripsi terpisah dari settings/transactions biasa)
// - sk_manual_backups_ / sk_last_auto_backup_ / sk_last_cloud_backup_ /
//   sk_last_gsheets_backup_ (metadata backup, tidak relevan utk buku baru)
// - book.lastClosedAt (status "tutup anak buku" milik riwayat buku LAMA,
//   buku baru harus mulai dari status belum pernah ditutup)
window.DUPLICATE_BOOK_SETTINGS_MAP = [
    ['sk_budgets_', 'budgets'],
    ['sk_default_budget_', 'default_budget'],
    ['sk_annual_budget_', 'annual_budget'],
    ['sk_hidden_cards_', 'hidden_cards'],
    ['sk_shopping_list_', 'shopping_list'],
    ['sk_shopping_list_income_', 'shopping_list_income'],
    ['sk_menu_plan_', 'menu_plan'],
    ['sk_electricity_plan_', 'electricity_plan'],
    ['sk_fase_kehidupan_', 'fase_kehidupan'],
    ['sk_emergency_fund_months_', 'emergency_fund_months'],
];

window.duplicateBook = async function(id) {
    if (!window.requireOnline('menduplikat buku')) return;
    const book = window.books.find(b => b.id === id);
    if (!book) { window.showToast('Buku tidak ditemukan (mungkin sudah dihapus device lain).', 'warning'); return; }

    // Buku bersama pakai jalur otentikasi & tabel (book_members/sk_books)
    // yang terpisah dari buku biasa -- tombol di renderBookList sudah
    // disembunyikan, ini lapis kedua kalau dipanggil lewat jalur lain.
    if (book._isShared) {
        window.showToast('Buku bersama belum bisa diduplikat lewat menu ini.', 'warning');
        return;
    }

    const defaultName = `${book.name} (Salinan)`;
    const newNameRaw = prompt('Nama untuk buku hasil duplikat:', defaultName);
    if (!newNameRaw || !newNameRaw.trim()) return;
    const newName = newNameRaw.trim();

    const copyTxs = await window.customConfirm({
        title: 'Salin Transaksi Juga?',
        message: `Anggaran, visibilitas card, Daftar Belanja, Fase Kehidupan, dan target Dana Darurat dari "${book.name}" akan otomatis disalin ke buku baru.\n\nSalin juga SEMUA transaksi dari buku ini? Untuk buku dengan banyak transaksi, proses ini bisa memakan waktu beberapa saat.`,
        confirmLabel: 'Ya, Salin Transaksi',
        cancelLabel: 'Tidak, Buku Kosong Saja',
        danger: false
    });

    const newId = 'b_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const newBook = { id: newId, name: newName };
    if (book.parentId) newBook.parentId = book.parentId;
    window.books.push(newBook);
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    const pushBooksOk = await window.pushSettingBooks();
    if (!pushBooksOk) {
        // Rollback state lokal supaya tidak ada buku "hantu" yang gagal tersimpan di cloud.
        window.books = window.books.filter(b => b.id !== newId);
        localStorage.setItem('sk_books', JSON.stringify(window.books));
        window.showToast('Gagal membuat buku baru di cloud, coba lagi.', 'error');
        return;
    }

    window.showToast(`Menyalin pengaturan buku "${book.name}"...`, 'info');

    // Salin setting per-buku: localStorage lokal + push ke cloud (settings table).
    for (const [prefix, settingKey] of window.DUPLICATE_BOOK_SETTINGS_MAP) {
        const raw = localStorage.getItem(prefix + book.id);
        if (raw === null) continue; // tidak ada data lokal utk key ini, biarkan buku baru pakai default
        localStorage.setItem(prefix + newId, raw);
        let value;
        try { value = JSON.parse(raw); } catch { value = raw; }
        try { await window.pushSetting(settingKey, value, newId); }
        catch (e) { window.skWarn(`[duplicateBook] Gagal salin setting '${settingKey}' ke buku baru:`, e); }
    }

    // Salin transaksi (opsional, sesuai pilihan user).
    if (copyTxs) {
        window.showToast('Menyalin transaksi, mohon tunggu...', 'info');
        try {
            const tag = window.getAccountTag ? window.getAccountTag() : null;
            const tagFilter = window.tagOrFilter(tag, book.id);
            // Tarik SEMUA transaksi buku sumber langsung dari cloud (paginated,
            // sama seperti pola di window._getUnclosedChildTxs) -- bukan cuma
            // window.txs, supaya buku sumber dengan >MAX_LOCAL_TXS transaksi
            // tetap tersalin lengkap.
            const PAGE_SIZE = 1000;
            let allRows = [];
            let offset = 0;
            while (true) {
                const query = `?book_id=eq.${book.id}&is_deleted=eq.false&order=date.asc&limit=${PAGE_SIZE}&offset=${offset}${tagFilter}`;
                const rows = await window.callSupabaseAPI('transactions', 'GET', null, query);
                if (rows === null) throw new Error('Gagal menarik transaksi buku sumber dari cloud.');
                if (!Array.isArray(rows) || rows.length === 0) break;
                allRows = allRows.concat(rows);
                if (rows.length < PAGE_SIZE) break;
                offset += PAGE_SIZE;
            }
            const decoded = await Promise.all(allRows.map(r => window.decodeCloudTxRow(r)));
            const nowIso = new Date().toISOString();
            // ID baru per transaksi (bukan salinan id lama) -- mencegah
            // tabrakan primary key dengan baris asli yang masih ada di buku sumber.
            const newTxs = decoded.map(t => ({
                ...t,
                id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
                updated_at: nowIso
            }));

            // Push ke cloud per-batch supaya payload POST tidak raksasa sekaligus
            // untuk buku sumber yang sangat besar.
            const PUSH_CHUNK = 300;
            for (let i = 0; i < newTxs.length; i += PUSH_CHUNK) {
                const chunk = newTxs.slice(i, i + PUSH_CHUNK);
                const payload = chunk.map(t => ({
                    id: t.id,
                    book_id: newId,
                    device_id: window.deviceId,
                    date: t.date,
                    updated_at: t.updated_at,
                    ...(tag ? { account_tag: tag } : {}),
                    type: t.type, amount: parseFloat(t.amount) || 0, category: t.category || '', description: t.description || '', attachment: t.attachment || null
                }));
                const res = await window.callSupabaseAPI('transactions', 'POST', payload);
                if (res === null) throw new Error('Gagal mengirim sebagian transaksi ke buku baru.');
            }

            // Simpan cache lokal buku baru (trimAndSaveLocal juga menghitung ulang
            // balanceOffset/incomeOffset/expenseOffset dengan benar kalau jumlah
            // transaksinya melebihi MAX_LOCAL_TXS).
            window.trimAndSaveLocal(newId, newTxs);
            window.showToast(`${newTxs.length} transaksi berhasil disalin ke "${newName}".`, 'success');
        } catch (e) {
            console.error('[duplicateBook] Gagal salin transaksi:', e);
            window.showToast('Buku baru berhasil dibuat, tapi sebagian/semua transaksi gagal disalin: ' + (e && e.message ? e.message : 'error'), 'warning');
        }
    }

    window.renderBookList();
    window.renderBookParentOptions();
    window.updateBookSelectDropdown();
    window.showToast(`Buku "${newName}" berhasil dibuat sebagai duplikat "${book.name}"!`, 'success');
    await window.addCloudLog('SISTEM', `Menduplikat buku "${book.name}" (ID ${book.id}) menjadi "${newName}" (ID ${newId})${copyTxs ? ', termasuk transaksi' : ', tanpa transaksi'}`);
    const cfg = await window.getTgConfig();
    if (cfg.active) window.sendTelegramNotif(`<b>Duplikat Buku</b>\n\nBuku baru: ${newName}\nSumber: ${book.name}\nSalin transaksi: ${copyTxs ? 'Ya' : 'Tidak'}\nID: ${newId}\nDevice: ${window.deviceId}`);
};

// Storage Estimasi
window.estimateSupabaseStorage = async function() {
    if (!window.isOnline()) return null;
    const baseUrl = window.getCloudUrl();
    const apiKey  = window.getSupabaseKey();
    if (!baseUrl || !apiKey) return null;
    const headers = { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Prefer': 'count=exact' };

    // Tiap tabel punya primary key berbeda, gunakan HEAD request agar tidak perlu tahu nama kolom
    async function countTable(table) {
        try {
            const res = await fetch(`${baseUrl}/rest/v1/${table}?select=*`, {
                method: 'HEAD',
                headers
            });
            const cnt = res.headers.get('content-range');
            if (cnt) {
                const m = cnt.match(/\/(\d+)$/);
                if (m) return parseInt(m[1]);
            }
            return 0;
        } catch { return 0; }
    }
    const [txCount, logCount, settCount] = await Promise.all([
        countTable('transactions'),
        countTable('audit_logs'),
        countTable('settings'),
    ]);
    const TX_ROW_BYTES   = 380;
    const LOG_ROW_BYTES  = 250;
    const SET_ROW_BYTES  = 180;
    const estimatedBytes = (txCount * TX_ROW_BYTES) + (logCount * LOG_ROW_BYTES) + (settCount * SET_ROW_BYTES);
    return { txCount, logCount, settCount, estimatedBytes };
};

window.formatBytes = function(bytes) {
    if (bytes < 1024)          return bytes + ' B';
    if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024**3)       return (bytes / (1024*1024)).toFixed(2) + ' MB';
    return (bytes / (1024**3)).toFixed(2) + ' GB';
};

window.renderStorageBar = function(usedBytes, totalBytes, label) {
    const pct = Math.min((usedBytes / totalBytes) * 100, 100);
    const colorClass = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--info)';
    return `
        <div style="margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                <span style="font-size: var(--text-xs); font-weight:600; color:var(--ink);">${label}</span>
                <span style="font-size: var(--text-xs); color:var(--ink-muted);">${window.formatBytes(usedBytes)} / ${window.formatBytes(totalBytes)} &nbsp;·&nbsp; <b style="color:${colorClass}">${pct.toFixed(1)}%</b></span>
            </div>
            <div style="height:8px; background:var(--rule); border-radius: var(--radius-sm); overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:${colorClass}; border-radius: var(--radius-sm); transition:width .4s;"></div>
            </div>
            <div style="font-size: var(--text-2xs); color:var(--ink-faint); margin-top:3px; text-align:right;">Sisa: ${window.formatBytes(totalBytes - usedBytes)}</div>
        </div>`;
};

window.refreshStorageEstimate = async function() {
    const el  = document.getElementById('storageEstimContent');
    const btn = document.getElementById('storageRefreshBtn');
    if (!el) return;
    el.innerHTML = '<div style="font-size: var(--text-xs); color:var(--ink-faint); text-align:center; padding:8px 0;">Menghitung...</div>';
    if (btn) btn.disabled = true;
    const data = await window.estimateSupabaseStorage();
    if (btn) btn.disabled = false;
    if (!data) {
        el.innerHTML = '<div style="font-size: var(--text-xs); color:var(--danger); text-align:center; padding:8px 0;">Tidak dapat memuat — pastikan koneksi Supabase aktif.</div>';
        return;
    }
    const { txCount, logCount, settCount, estimatedBytes } = data;
    const totalRows = txCount + logCount + settCount;
    const SUPABASE_FREE_DB_BYTES = 500 * 1024 * 1024;
    const dbBar   = window.renderStorageBar(estimatedBytes, SUPABASE_FREE_DB_BYTES, 'Database (estimasi)');
    const pctNum  = Math.min((estimatedBytes / SUPABASE_FREE_DB_BYTES) * 100, 100);
    const statusColor = pctNum >= 90 ? 'var(--danger)' : pctNum >= 70 ? 'var(--warning)' : 'var(--success)';
    const statusBg     = pctNum >= 90 ? 'var(--danger-lt)' : pctNum >= 70 ? 'var(--warning-lt)' : 'var(--success-lt)';
    const statusText  = pctNum >= 90 ? 'Hampir penuh! Pertimbangkan arsipkan data lama.' :
                        pctNum >= 70 ? 'Mendekati batas — pantau secara berkala.' :
                                       'Kapasitas masih aman.';
    el.innerHTML = `
        ${dbBar}
        <div style="background:var(--paper-warm); border-radius: var(--radius-sm); padding:10px 12px; font-size: var(--text-xs); color:var(--ink); line-height:1.8; margin-bottom:10px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 16px;">
                <span>Transaksi</span><b>${txCount.toLocaleString('id-ID')} baris</b>
                <span>Log Aktivitas</span><b>${logCount.toLocaleString('id-ID')} baris</b>
                <span>Setelan</span><b>${settCount.toLocaleString('id-ID')} baris</b>
                <span>Total Baris</span><b>${totalRows.toLocaleString('id-ID')} baris</b>
            </div>
        </div>
        <div style="font-size: var(--text-xs); color:${statusColor}; font-weight:600; text-align:center; padding:4px 8px; background:${statusBg}; border-radius: var(--radius-sm);">
            ${statusText}
        </div>
        <div style="font-size: var(--text-2xs); color:var(--ink-faint); margin-top:8px; text-align:right;">
            * Estimasi berdasarkan jumlah baris × rata-rata ukuran baris. Free tier Supabase: DB 500 MB, File Storage 1 GB.
        </div>
    `;
};

window.openTelegramSettings = async function() {
    if (!window.requireOnline('mengatur Telegram')) return;
    document.getElementById('tgTestStatus').innerHTML = '';
    // [SERAGAM DENGAN SETELAN] Notifikasi Telegram sekarang panel inline di
    // halaman Setelan (telegramSettingsModal terpisah sudah dihapus dari
    // HTML) -- buka Setelan lalu gulir ke sana.
    if (typeof window.openSetelanModal === 'function') window.openSetelanModal('telegram');
    window.loadTgConfigToForm();
    if (window.isOnline()) {
        const _tgTag = window.getAccountTag ? window.getAccountTag() : null;
        const _tgTagFilter = window.tagOrFilter(_tgTag);
        const allRows = await window.callSupabaseAPI('settings', 'GET', null, `?key=eq.telegram_config&order=updated_at.desc&limit=1${_tgTagFilter}`);
        if (allRows && Array.isArray(allRows) && allRows.length > 0) {
            try {
                const parsed = JSON.parse(allRows[0].value);
                if (parsed.token) localStorage.setItem('sk_tg_token', parsed.token);
                if (parsed.chatId) localStorage.setItem('sk_tg_chatid', parsed.chatId);
                if (parsed.edgeUrl) localStorage.setItem('sk_tg_edge_url', parsed.edgeUrl);
            } catch (e) { }
        }
        window.loadTgConfigToForm();
    }
};

// ==================== TUTUP ANAK BUKU ====================

// [BUG FIX] Sebelumnya tutupAnakBuku() SELALU menghitung ulang SEMUA transaksi
// anak buku dari awal setiap kali dipanggil, tanpa ada penanda "sudah pernah
// ditutup". Akibatnya kalau tombol "Kirim Ringkasan ke Induk" diklik lagi
// (klik ganda, atau anak buku dibuka ulang bulan berikutnya tanpa transaksi
// baru), ringkasan yang SAMA terkirim lagi ke buku induk -> double count.
//
// Fix: simpan book.lastClosedAt (timestamp ISO) setiap kali berhasil ditutup.
// Panggilan berikutnya hanya menghitung transaksi yang tanggalnya SETELAH
// lastClosedAt tersebut, bukan seluruh riwayat lagi.
//
// Catatan: balanceOffset (saldo dari transaksi lama yang sudah di-trim dari
// cache lokal, lihat trimAndSaveLocal) hanya diikutkan pada penutupan
// PERTAMA KALI (saat lastClosedAt belum ada) -- pada penutupan berikutnya,
// riwayat lama itu sudah pernah terhitung & terkirim sebelumnya, sehingga
// tidak boleh ditambahkan lagi.
// [FIX LOGIKA KEUANGAN - TRANSAKSI HILANG SAAT TUTUP ANAK BUKU] Sebelumnya
// fungsi ini SELALU mengandalkan window.txs, yang (lihat trimAndSaveLocal di
// transaction.js) cuma menyimpan MAX_LOCAL_TXS (1000) transaksi TERBARU per
// buku. Untuk anak buku yang jumlah transaksinya (sejak lastClosedAt, atau
// sejak awal kalau belum pernah ditutup) melebihi 1000, filter
// `window.txs.filter(...)` TIDAK PERNAH melihat transaksi yang sudah
// ter-trim dari cache -- padahal transaksi itu sah dan belum pernah dikirim
// ke buku induk. Karena lastClosedAt langsung maju ke waktu SEKARANG setelah
// ringkasan terkirim, transaksi yang ter-skip itu TIDAK PERNAH bisa terkirim
// ke induk lagi -- uangnya hilang permanen dari ringkasan konsolidasi, tanpa
// peringatan apa pun. Ini persis kelas bug yang sudah diperbaiki di
// report.js/budget.js/telegram.js (selalu tarik LANGSUNG dari cloud, tidak
// mengandalkan window.txs, untuk operasi yang butuh total lengkap) tapi
// kelewat di fitur ini.
//
// FIX: kalau online, tarik SEMUA transaksi anak buku ini langsung dari
// Supabase (paginated, tanpa batas MAX_LOCAL_TXS, difilter date > lastClosedAt
// kalau ada), dekripsi, jumlahkan -- otomatis lengkap, tidak butuh
// balanceOffset lagi sama sekali (bukan cuma mengandalkan cache lokal).
// Offline atau fetch gagal total: fallback ke window.txs + balanceOffset
// seperti sebelumnya (best effort, sama seperti pola fallback offline di
// tempat lain di codebase ini).
window._getUnclosedChildTxs = async function(book) {
    const lastClosedAt = book && book.lastClosedAt ? book.lastClosedAt : null;
    const bookId = window.currentBookId;

    if (window.isOnline()) {
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        const tagFilter = window.tagOrFilter(tag, bookId);
        const dateFilter = lastClosedAt ? `&date=gt.${encodeURIComponent(lastClosedAt)}` : '';
        const PAGE_SIZE = 1000;
        let allRows = [];
        let offset = 0;
        let fetchFailed = false;
        while (true) {
            const query = `?book_id=eq.${bookId}&is_deleted=eq.false${dateFilter}&order=date.asc&limit=${PAGE_SIZE}&offset=${offset}${tagFilter}`;
            const rows = await window.callSupabaseAPI('transactions', 'GET', null, query);
            if (rows === null) { fetchFailed = true; break; } // network/error -- callSupabaseAPI sudah toast
            if (!Array.isArray(rows) || rows.length === 0) break; // benar-benar habis (bisa nol baris, itu valid)
            allRows = allRows.concat(rows);
            if (rows.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
        }
        if (!fetchFailed) {
            // Hasil cloud lengkap & otoritatif (walau allRows kosong -- itu valid,
            // artinya memang belum ada transaksi baru sejak penutupan terakhir).
            const decoded = await Promise.all(allRows.map(r => window.decodeCloudTxRow(r)));
            let totalInc = 0, totalExp = 0;
            decoded.forEach(t => {
                const amt = Number(t.amount) || 0;
                if (t.type === 'income') totalInc += amt; else totalExp += amt;
            });
            return { txs: decoded, totalInc, totalExp, balanceOffset: 0, netTotal: totalInc - totalExp, lastClosedAt };
        }
        // fetchFailed -- lanjut ke fallback lokal di bawah.
    }

    // Offline atau cloud fetch gagal total: fallback best-effort ke cache lokal
    // (mungkin tidak lengkap untuk anak buku dengan >MAX_LOCAL_TXS transaksi).
    const txs = lastClosedAt
        ? window.txs.filter(t => {
            const d = window.parseTxDate(t.date);
            return d && !isNaN(d) && d > new Date(lastClosedAt);
          })
        : window.txs;
    const balanceOffset = lastClosedAt
        ? 0
        : (Number(localStorage.getItem('sk_balance_offset_' + bookId)) || 0);
    let totalInc = 0, totalExp = 0;
    txs.forEach(t => {
        const amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    return { txs, totalInc, totalExp, balanceOffset, netTotal: totalInc - totalExp + balanceOffset, lastClosedAt };
};

window.openTutupAnakBuku = async function() {
    const book = window.books.find(b => b.id === window.currentBookId);
    if (!book || !book.parentId) {
        window.showToast('Buku ini bukan anak buku.', 'warning');
        return;
    }
    const parentBook = window.books.find(b => b.id === book.parentId);
    if (!parentBook) {
        window.showToast('Buku induk tidak ditemukan.', 'error');
        return;
    }

    // Tampilkan modal dulu dengan status "menghitung", karena
    // _getUnclosedChildTxs sekarang bisa menarik data langsung dari cloud
    // (paginated) supaya totalnya lengkap -- lihat catatan [FIX LOGIKA
    // KEUANGAN] di window._getUnclosedChildTxs untuk alasannya.
    const elLoading = document.getElementById('tutupAnakBukuInfo');
    if (elLoading) elLoading.innerHTML = `<div style="padding:12px 14px; font-size: var(--text-sm); color:var(--ink-faint);">Menghitung total transaksi...</div>`;
    const submitBtnLoading = document.getElementById('tutupAnakBukuSubmitBtn');
    if (submitBtnLoading) submitBtnLoading.disabled = true;
    window.openModal('tutupAnakBukuModal');

    // Hitung total — HANYA transaksi yang belum pernah dikirim ke induk
    // (lihat window._getUnclosedChildTxs, [BUG FIX] double-count).
    const calc = await window._getUnclosedChildTxs(book);
    const { totalInc, totalExp, netTotal } = calc;
    const txCount = calc.txs.length;
    const sinceLabel = calc.lastClosedAt
        ? `sejak penutupan terakhir (${new Date(calc.lastClosedAt).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })})`
        : 'dari seluruh riwayat (belum pernah ditutup sebelumnya)';

    // Isi modal konfirmasi
    const el = document.getElementById('tutupAnakBukuInfo');
    if (el) {
        if (txCount === 0) {
            el.innerHTML = `
                <div style="background:#F1EBDA; border:1px solid #B99A4E; border-radius: var(--radius-sm); padding:12px 14px; font-size: var(--text-sm); line-height:1.8; color:#6B5320;">
                    Tidak ada transaksi baru ${window.escapeHtml(sinceLabel)}. Tidak ada yang perlu dikirim ke buku induk.
                </div>
            `;
        } else {
            el.innerHTML = `
                <div style="background:#E9EBF2; border:1px solid #A6AFC9; border-radius: var(--radius-sm); padding:12px 14px; font-size: var(--text-sm); line-height:1.8;">
                    <div><b>Anak Buku:</b> ${window.escapeHtml(book.name)}</div>
                    <div><b>Kirim ke Induk:</b> ${window.escapeHtml(parentBook.name)}</div>
                    <div style="font-size: var(--text-xs); color:#5C4E72; margin-top:2px;">Dihitung ${window.escapeHtml(sinceLabel)}</div>
                    <hr style="margin:8px 0; border-color:#DCE0E6;">
                    <div>Jumlah transaksi: <b>${txCount}</b></div>
                    <div>Total pemasukan: <b style="color:#2E6B4F">${window.rp(totalInc)}</b></div>
                    <div>Total pengeluaran: <b style="color:#A13A3A">${window.rp(totalExp)}</b></div>
                    <div><b>Net yang dikirim: <span style="color:${netTotal >= 0 ? '#2E6B4F' : '#A13A3A'}">${window.rp(Math.abs(netTotal))}</span></b>
                        ${netTotal < 0 ? ' (pengeluaran)' : ' (pemasukan)'}</div>
                </div>
                <div style="margin-top:10px; font-size: var(--text-xs); color:#5B6472;">
                    Satu transaksi ringkasan akan ditambahkan ke buku <b>${window.escapeHtml(parentBook.name)}</b>.<br>
                    Anak buku ini <b>tidak dihapus</b> — tetap bisa dibuka sebagai arsip. Penutupan berikutnya hanya akan menghitung transaksi baru setelah ini.
                </div>
            `;
        }
    }

    // Isi default deskripsi
    const descEl = document.getElementById('tutupAnakBukuDesc');
    if (descEl) descEl.value = `Ringkasan: ${book.name}`;

    // Nonaktifkan tombol kirim kalau tidak ada transaksi baru sejak penutupan
    // terakhir — mencegah klik tak sengaja yang tidak akan mengirim apa pun.
    const submitBtn = document.getElementById('tutupAnakBukuSubmitBtn');
    if (submitBtn) submitBtn.disabled = (txCount === 0);
};

window.tutupAnakBuku = async function() {
    if (!window.requireOnline('menutup anak buku')) return;

    const book = window.books.find(b => b.id === window.currentBookId);
    if (!book || !book.parentId) return;
    const parentBook = window.books.find(b => b.id === book.parentId);
    if (!parentBook) return;

    const descEl = document.getElementById('tutupAnakBukuDesc');
    const deskripsi = (descEl ? descEl.value.trim() : '') || `Ringkasan: ${book.name}`;

    // Hitung net — HANYA transaksi yang belum pernah dikirim ke induk
    // (lihat window._getUnclosedChildTxs, [BUG FIX] double-count &
    // [FIX LOGIKA KEUANGAN] tarik lengkap dari cloud, bukan cuma window.txs).
    const calc = await window._getUnclosedChildTxs(book);
    const { netTotal } = calc;
    const closeTimestamp = new Date().toISOString();

    if (calc.txs.length === 0) {
        window.showToast('Tidak ada transaksi baru untuk dikirim sejak penutupan terakhir.', 'warning');
        return;
    }
    if (netTotal === 0) {
        // Ada transaksi baru tapi net-nya nol (income = expense persis) — tetap
        // tandai sebagai sudah ditutup supaya transaksi ini tidak dihitung lagi
        // di penutupan berikutnya, walau tidak ada apa pun yang dikirim ke induk.
        book.lastClosedAt = closeTimestamp;
        localStorage.setItem('sk_books', JSON.stringify(window.books));
        await window.pushSettingBooks();
        window.showToast('Tidak ada net transaksi untuk dikirim, tapi transaksi ini sudah ditandai selesai.', 'info');
        window.closeModal('tutupAnakBukuModal');
        return;
    }

    const txType = netTotal >= 0 ? 'income' : 'expense';
    const txAmount = Math.abs(netTotal);
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') +
        'T' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0') + ':00';

    const _ntTag = window.getAccountTag ? window.getAccountTag() : null;
    const newTx = {
        id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        book_id: parentBook.id,
        device_id: window.deviceId,
        type: txType,
        amount: txAmount,
        category: txType === 'income' ? 'Pemasukan' : 'Lainnya',
        description: deskripsi,
        date: dateStr,
        attachment: null,
        updated_at: new Date().toISOString(),
        ...(_ntTag ? { account_tag: _ntTag } : {})
    };

    // Push ke Supabase langsung ke buku induk
    const result = await window.callSupabaseAPI('transactions', 'POST', [newTx]);
    if (!result) {
        window.showToast('Gagal mengirim ke buku induk!', 'error');
        return;
    }

    // Jika sedang di buku yang sama dengan induk nanti, update lokal
    const parentCached = JSON.parse(localStorage.getItem('sk_txs_' + parentBook.id) || '[]');
    parentCached.unshift(newTx);
    window.trimAndSaveLocal(parentBook.id, parentCached);

    // [BUG FIX] Tandai anak buku ini sudah ditutup pada timestamp ini, supaya
    // penutupan berikutnya HANYA menghitung transaksi baru setelah sekarang —
    // bukan mengulang seluruh riwayat lagi (mencegah double-count ke induk).
    book.lastClosedAt = closeTimestamp;
    localStorage.setItem('sk_books', JSON.stringify(window.books));
    await window.pushSettingBooks();

    await window.addCloudLog('SISTEM', `Tutup anak buku "${book.name}" → kirim ${window.rp(txAmount)} ke "${parentBook.name}"`);

    window.closeModal('tutupAnakBukuModal');
    window.showToast(`Ringkasan ${window.rp(txAmount)} berhasil dikirim ke "${parentBook.name}"!`, 'success');

    // Tawarkan pindah ke buku induk
    setTimeout(() => {
        if (confirm(`Berhasil! Mau langsung buka buku "${parentBook.name}" untuk melihat hasilnya?`)) {
            window.switchBook(parentBook.id);
        }
    }, 300);
};
