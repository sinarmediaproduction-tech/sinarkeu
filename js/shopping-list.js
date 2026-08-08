// ==================== BELANJA BULANAN ====================
// Checklist belanja per buku kas. Tersimpan lokal (localStorage) untuk
// akses instan/offline, DAN disinkronkan ke Supabase (tabel `settings`,
// key 'shopping_list', per book_id) mengikuti pola window.saveHiddenCardsToLocal
// + window.pushSetting di js/render.js. Nilai dienkripsi otomatis oleh
// pushSetting() sebelum dikirim ke cloud (kecuali buku bersama). Pull-nya
// ditangani terpusat di window.pullAllSettings (js/db.js).
window.getShoppingList = function(bookId) {
    const raw = localStorage.getItem('sk_shopping_list_' + (bookId || window.currentBookId));
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    }
    return [];
};
window.saveShoppingListToLocal = function(bookId, items) {
    localStorage.setItem('sk_shopping_list_' + (bookId || window.currentBookId), JSON.stringify(items));
};
window.saveShoppingList = function(bookId, items) {
    const targetId = bookId || window.currentBookId;
    window.saveShoppingListToLocal(targetId, items);
    // Sync ke cloud tidak di-await (fire-and-forget) supaya interaksi
    // checklist tetap terasa instan; kegagalan sync tidak menghalangi
    // perubahan lokal, dan akan tersinkron lagi di push/pull berikutnya.
    if (window.isOnline && window.isOnline() && window.pushSetting) {
        window.pushSetting('shopping_list', items, targetId).catch(function(e) {
            window.skWarn('[ShoppingList] Gagal sync ke cloud:', e);
            // [FIX] Sebelumnya kegagalan sync cuma dilempar ke console.warn --
            // perubahan terlihat berhasil di layar (sudah tersimpan lokal)
            // padahal cuma nyangkut di device ini (mis. ditolak RLS Supabase
            // kalau akun ini viewer di buku bersama). Tampilkan toast supaya
            // kegagalan tidak lagi tersembunyi.
            window.showToast && window.showToast('Perubahan tersimpan di perangkat ini, tapi gagal sinkron ke cloud. Barang tidak akan muncul di perangkat lain sampai sinkron berhasil.', 'error');
        });
    }
};

// Siklus checklist mengikuti bulan kalender. Saat aplikasi dibuka pada bulan
// baru (atau daftar belanja kembali ditampilkan), semua centang bulan lalu
// dibuka lagi. Daftar barang dan transaksi TIDAK disentuh; penanda
// lastExpenseMonth menjaga agar satu barang hanya masuk sekali per bulan.
window.getShoppingListMonthKey = function(date) {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

window.ensureShoppingListMonthlyCycle = function(bookId) {
    const targetId = bookId || window.currentBookId;
    if (!targetId) return false;
    const raw = localStorage.getItem('sk_shopping_list_' + targetId);
    if (!raw) return false;
    let items;
    try { items = JSON.parse(raw); } catch { return false; }
    if (!Array.isArray(items) || !items.length) return false;

    const monthKey = window.getShoppingListMonthKey();
    let changed = false;
    items.forEach(function(item) {
        // Data sebelum fitur ini dianggap sebagai checklist bulan berjalan,
        // sehingga upgrade aplikasi tidak tiba-tiba membatalkan belanja hari ini.
        if (!item.checklistMonth) {
            item.checklistMonth = monthKey;
            changed = true;
        } else if (item.checklistMonth !== monthKey) {
            item.done = false;
            item.checklistMonth = monthKey;
            changed = true;
        }
    });
    if (changed) window.saveShoppingList(targetId, items);
    return changed;
};

// ── Pembatasan role viewer (mengikuti pola yang sama seperti transaksi di
// js/auth.js -- lihat window.skIsViewerOnCurrentBook & patch openModal di
// sana). Daftar Belanja sebelumnya TIDAK masuk daftar menu yang dibatasi
// per-role (js/auth.js, SK_MENU_DEFAULTS baris ~106-117), jadi viewer
// tetap bisa tambah/ubah/centang/hapus barang di UI meskipun push ke
// Supabase pasti ditolak RLS (lihat policy settings_shared_write /
// settings_shared_update di sql/harden_shared_book_data_rls.sql yang
// hanya mengizinkan admin/editor). Dicek lewat typeof guard karena
// js/shopping-list.js dimuat SEBELUM js/auth.js di index.html -- aman,
// karena fungsi-fungsi di bawah baru benar-benar dipanggil belakangan
// (lewat interaksi user), saat js/auth.js sudah selesai load.
window._slistIsViewer = function() {
    return typeof window.skIsViewerOnCurrentBook === 'function' && window.skIsViewerOnCurrentBook();
};

window._slistBlockIfViewer = function() {
    if (window._slistIsViewer()) {
        window.showToast && window.showToast('Peran viewer di buku bersama ini hanya bisa melihat daftar belanja, tidak bisa mengubahnya.', 'error');
        return true;
    }
    return false;
};

// Sembunyikan/kunci bagian-bagian yang bisa mengubah daftar (form tambah,
// tombol Reset Centang/Hapus yang Dibeli) untuk viewer, dan tampilkan
// notice-nya -- dipanggil dari renderShoppingList() supaya selalu
// mengikuti peran user di buku yang sedang aktif tiap kali modal dibuka
// atau daftar dirender ulang.
window._slistApplyViewerUI = function() {
    const isViewer = window._slistIsViewer();
    const notice = document.getElementById('slistViewerNotice');
    const addToggle = document.getElementById('slistAddToggle');
    const actions = document.getElementById('slistActions');
    if (notice) notice.style.display = isViewer ? '' : 'none';
    // Tombol "+ Tambah Barang" (yang membuka pop up tambah barang) juga
    // disembunyikan untuk viewer -- tidak ada gunanya buka form yang
    // toh tidak bisa disubmit.
    if (addToggle) addToggle.style.display = isViewer ? 'none' : '';
    if (actions) actions.style.display = isViewer ? 'none' : '';
};

// [UBAH JADI POP UP] Sebelumnya form tambah barang berupa panel yang
// slide turun di bawah tombol "+ Tambah Barang" (lihat riwayat git untuk
// versi lama window.toggleShoppingListAddForm & .slist-add-wrap.collapsed
// di css/style.css). Sekarang form-nya dipindah ke modal terpisah
// (#addShoppingListItemModal, lihat index.html) yang muncul sebagai pop up
// di tengah layar -- field-field-nya (slistNewName dkk.) & handler submit
// (window.addShoppingListItem) tetap sama persis, cuma wadahnya yang beda.
window.openAddShoppingListItemModal = function() {
    if (window._slistBlockIfViewer()) return;
    window._populateShoppingListCategorySelect();
    const nameInput = document.getElementById('slistNewName');
    const qtyInput = document.getElementById('slistNewQty');
    const priceInput = document.getElementById('slistNewPrice');
    const categorySelect = document.getElementById('slistNewCategory');
    const staleCheckbox = document.getElementById('slistNewIsStaple');
    if (nameInput) nameInput.value = '';
    if (qtyInput) qtyInput.value = '';
    if (priceInput) priceInput.value = '';
    if (categorySelect) categorySelect.value = '';
    if (staleCheckbox) staleCheckbox.checked = false;
    window.openModal('addShoppingListItemModal');
    // Fokus ke field nama begitu pop up terbuka supaya user bisa langsung
    // ketik tanpa ketuk lagi -- tunda dikit supaya tidak bentrok dengan
    // animasi buka modal.
    setTimeout(function() { nameInput && nameInput.focus(); }, 210);
};

// Subtotal per baris = harga satuan x qty. Fallback qty=1 kalau qty kosong
// atau bukan angka valid (mis. data lama sebelum qty jadi field angka,
// yang formatnya dulu teks bebas seperti "2 pak") -- supaya data lama
// tetap dihitung seperti sebelumnya (harga = total baris), tidak tiba-tiba
// berubah nilainya.
window._shoppingListItemSubtotal = function(item) {
    const price = Number(item.price) || 0;
    const qtyNum = Number(item.qty);
    const qty = (qtyNum > 0) ? qtyNum : 1;
    return price * qty;
};

window.openShoppingListModal = function() {
    window.ensureShoppingListMonthlyCycle(window.currentBookId);
    window._populateShoppingListCategorySelect();
    window.openModal('shoppingListModal');

    window.runAfterNextPaint(function() {
        const modal = document.getElementById('shoppingListModal');
        if (modal && modal.classList.contains('show')) window.renderShoppingList();
    });

    // Daftar masih kosong -> langsung buka pop up tambah barang supaya
    // user baru tidak perlu ketuk "+ Tambah Barang" dulu untuk mulai isi.
    if (!window._slistIsViewer() && window.getShoppingList(window.currentBookId).length === 0) {
        window.openAddShoppingListItemModal();
    }

    // [FIX SYNC ANTAR PERANGKAT] Sebelumnya modal ini HANYA merender dari
    // localStorage -- pull dari cloud cuma terjadi di titik lain (buka
    // app/login, ganti buku, setelah transaksi tertentu). Kalau device B
    // idle di buku yang sama dan tidak memicu salah satu titik itu, dia
    // tidak akan pernah lihat barang baru yang diinput di device A sampai
    // salah satu trigger itu terjadi -- inilah penyebab utama laporan
    // "tersimpan di A tapi tidak muncul di B". Sekarang: tampilkan dulu
    // data lokal (instan, termasuk saat offline), lalu diam-diam tarik
    // versi terbaru dari cloud tiap kali modal dibuka, dan render ulang
    // kalau modal masih terbuka & masih di buku yang sama saat pull selesai
    // (guard supaya tidak menimpa layar kalau user keburu tutup modal atau
    // pindah buku sebelum pull kelar).
    if (window.isOnline && window.isOnline() && typeof window.pullAllSettings === 'function') {
        const bookAtOpen = window.currentBookId;
        window.pullAllSettings().then(function() {
            const modalEl = document.getElementById('shoppingListModal');
            if (modalEl && modalEl.classList.contains('show') && window.currentBookId === bookAtOpen) {
                window.renderShoppingList();
            }
        }).catch(function(e) {
            window.skWarn('[ShoppingList] Gagal tarik data terbaru dari cloud saat buka modal:', e);
        });
    }

    // [AUTO HARGA PANGAN] Tarik harga referensi BI (js/harga-pangan.js) tiap
    // kali modal dibuka, lalu isi otomatis barang yang belum ada harganya
    // (atau sebelumnya juga terisi otomatis). Viewer tetap lihat referensinya
    // (badge "≈" di render), tapi tidak memicu penyimpanan -- write-nya pasti
    // ditolak RLS untuk viewer, tidak perlu memaksa & memunculkan toast error
    // cuma gara-gara buka modal.
    if (window.isOnline && window.isOnline() && typeof window.prefetchHargaPanganReferensi === 'function') {
        const bookAtOpen = window.currentBookId;
        window.prefetchHargaPanganReferensi().then(function() {
            const modalEl = document.getElementById('shoppingListModal');
            if (!modalEl || !modalEl.classList.contains('show') || window.currentBookId !== bookAtOpen) return;
            if (window._slistIsViewer()) {
                window.renderShoppingList();
            } else {
                window._applyHargaPanganReferensiToShoppingList();
            }
        }).catch(function(e) {
            window.skWarn('[ShoppingList] Gagal ambil harga referensi pangan:', e.message);
        });
    }
};

// Isi otomatis kolom harga barang yang BELUM punya harga (atau sebelumnya
// juga terisi otomatis lewat fitur ini -- ditandai item.priceSource==='ref')
// dengan harga referensi PIHPS BI terbaru, kalau nama barangnya cocok
// salah satu komoditas yang ditrack (lihat window.HARGA_PANGAN_COMMODITIES
// di js/harga-pangan.js). Barang yang harganya sudah diisi MANUAL oleh user
// tidak pernah ditimpa -- ini cuma bantu isi yang masih kosong, bukan
// menimpa input user.
window._applyHargaPanganReferensiToShoppingList = function() {
    const items = window.getShoppingList(window.currentBookId);
    let changed = false;
    items.forEach(function(item) {
        const isEmptyOrRef = !item.price || item.priceSource === 'ref';
        if (!isEmptyOrRef) return;
        const ref = window.getHargaPanganUntukItem(item.name);
        if (!ref) return;
        if (item.price === ref.price && item.priceSource === 'ref' && item.priceRefDate === ref.date) return;
        item.price = ref.price;
        item.priceSource = 'ref';
        item.priceRefDate = ref.date;
        changed = true;
    });
    if (changed) window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
};

// Isi dropdown kategori barang dari daftar kategori pengeluaran yang sama
// dipakai anggaran (window.EXPENSE_CATEGORIES, js/config.js), supaya nama
// kategori di daftar belanja selalu konsisten dengan kategori anggaran.
window._populateShoppingListCategorySelect = function() {
    const sel = document.getElementById('slistNewCategory');
    if (!sel || sel.dataset.filled === '1') return;
    const cats = window.EXPENSE_CATEGORIES || [];
    sel.innerHTML = '<option value="">Tanpa kategori</option>' +
        cats.map(c => `<option value="${window.escapeHtml(c)}">${window.escapeHtml(c)}</option>`).join('');
    sel.dataset.filled = '1';
};

// [URUTKAN PER ANGGARAN] Urutan tampil = kategori dengan Anggaran Bulanan
// efektif (custom bulan ini, atau jatuh balik ke Anggaran Dasar -- sama
// seperti window.getEffectiveBudget yang dipakai di
// _renderShoppingListBudgetWarnings/_renderShoppingListCategoryBreakdown)
// PALING BESAR ditaruh paling atas. Kategori dengan anggaran sama besar
// (termasuk sama-sama tidak punya anggaran/0) mempertahankan urutannya di
// window.EXPENSE_CATEGORIES (js/config.js) supaya tetap stabil & mudah
// diprediksi. Barang "Tanpa kategori" atau dengan nama kategori yang sudah
// tidak ada di daftar anggaran (mis. sisa data lama sebelum rename) tetap
// ditaruh paling akhir. Di dalam kategori yang sama, urutan asli (urutan
// input) dipertahankan (stable sort) -- hanya urutan TAMPILAN yang diubah,
// array tersimpan di localStorage/cloud tidak diubah urutannya, jadi
// id-based lookup (edit/hapus/toggle) tetap aman.
window._sortShoppingListForDisplay = function(items) {
    const cats = window.EXPENSE_CATEGORIES || [];
    let budgetMap = {};
    if (cats.length && typeof window.getEffectiveBudget === 'function') {
        const now = new Date();
        const effective = window.getEffectiveBudget(now.getFullYear(), now.getMonth() + 1, window.currentBookId);
        budgetMap = effective.budget || {};
    }
    const orderedCats = cats.slice().sort((a, b) => {
        const budgetDiff = (budgetMap[b] || 0) - (budgetMap[a] || 0);
        return budgetDiff !== 0 ? budgetDiff : cats.indexOf(a) - cats.indexOf(b);
    });
    const rank = function(item) {
        const idx = item.category ? orderedCats.indexOf(item.category) : -1;
        return idx === -1 ? orderedCats.length : idx;
    };
    return items
        .map((item, i) => ({ item, i }))
        .sort((a, b) => {
            const diff = rank(a.item) - rank(b.item);
            return diff !== 0 ? diff : a.i - b.i;
        })
        .map(x => x.item);
};

window.renderShoppingList = function() {
    window.ensureShoppingListMonthlyCycle(window.currentBookId);
    const container = document.getElementById('shoppingListContainer');
    const items = window._sortShoppingListForDisplay(window.getShoppingList(window.currentBookId));
    const isViewer = window._slistIsViewer();
    window._slistApplyViewerUI();

    if (!items.length) {
        container.innerHTML = '<div class="slist-empty">Daftar belanja masih kosong. Tambahkan barang lewat form di atas.</div>';
        window._updateShoppingListSummary(items);
        window._renderShoppingListCategoryBreakdown(items);
        window._renderShoppingListForecast(items);
        window._renderShoppingListStapleReminders(items);
        return;
    }

    // Header kolom -- cuma tampak di layar lebar (lihat CSS .slist-list-header,
    // disembunyikan lewat media query max-width:640px). Diikutkan di dalam
    // innerHTML container (bukan markup statis di index.html) supaya otomatis
    // ikut hilang bareng daftar saat kosong, tanpa perlu toggle terpisah.
    const headerHtml = `
        <div class="slist-list-header" aria-hidden="true">
            <span></span><span>Nama Barang</span><span>Qty</span><span>Kategori</span><span>Satuan</span><span>Subtotal</span><span></span>
        </div>
    `;

    // Markup tiap barang sengaja dibuat FLAT (checkbox, nama, qty, kategori,
    // harga, aksi semua jadi anak langsung .slist-item) alih-alih dibungkus
    // .slist-body/.slist-trail seperti sebelumnya -- supaya di desktop bisa
    // dijadikan grid kolom yang benar-benar sejajar antar baris (lihat CSS),
    // termasuk saat qty/kategori kosong (span dibiarkan kosong, bukan
    // dihilangkan, biar kolom tidak geser). Di hp, kolom yang sama disusun
    // ulang jadi kartu 1-3 baris lewat flex + `order` (lihat media query).
    // Nomor urut per kategori: dimulai dari 1 lagi tiap kali kategori
    // barang berganti dari baris sebelumnya. Karena daftar sudah
    // dikelompokkan per kategori (lihat _sortShoppingListForDisplay di
    // atas), ini otomatis menghasilkan nomor 1..n di dalam tiap kategori.
    let _slistNoCounter = 0;
    let _slistNoPrevCat = undefined;
    container.innerHTML = headerHtml + items.map(item => {
        if (item.category !== _slistNoPrevCat) {
            _slistNoCounter = 0;
            _slistNoPrevCat = item.category;
        }
        _slistNoCounter++;
        const itemNo = _slistNoCounter;
        // Tampilkan badge qty kecuali persis 1 (default barang biasa) --
        // qty pecahan (mis. 0,3) TETAP ditampilkan, bukan cuma disembunyikan
        // seperti sebelumnya (dulu cuma dicek `> 1`), supaya barang hasil
        // push dari Daftar Menu (js/menu-plan.js, bisa pecahan kg/liter)
        // tetap kelihatan jumlah persisnya, bukan cuma subtotal harganya.
        const qtyNum = Number(item.qty);
        const qtyText = (item.qty && qtyNum !== 1) ? `x${window.escapeHtml(String(item.qty).replace('.', ','))}` : '';
        const catText = item.category ? window.escapeHtml(item.category) : '';
        const catColor = item.category ? window.getCategoryColor(item.category) : null;
        const catStyleAttr = catColor ? ` style="--cat-color:${catColor}"` : '';
        // [AUTO HARGA PANGAN] item.priceSource==='ref' -> harga ini diisi
        // otomatis dari referensi BI (js/harga-pangan.js), bukan diketik
        // manual oleh user. Ditandai "≈" + title penjelasan supaya jelas ini
        // perkiraan, bukan harga yang benar-benar sudah dicek user sendiri.
        const isRefPrice = item.priceSource === 'ref' && item.price;
        const unitPriceText = item.price ? (isRefPrice ? '≈ ' : '') + window.rp(item.price) : '';
        const unitPriceClass = isRefPrice ? 'slist-unit-price is-ref-price' : 'slist-unit-price';
        const unitPriceTitle = isRefPrice
            ? ` title="Harga referensi otomatis dari PIHPS Bank Indonesia (${window.escapeHtml(item.priceRefDate || '')}). Ubah manual lewat ✎ kalau harga sebenarnya beda."`
            : '';
        const priceText = item.price ? window.rp(window._shoppingListItemSubtotal(item)) : '';
        const actionsHtml = isViewer ? '' : `
                <button type="button" class="slist-edit-btn" title="Ubah" onclick="window.openEditShoppingListItemModal('${window.escapeHtml(item.id)}')">✎</button>
                <button type="button" class="slist-del-btn" title="Hapus" onclick="window.deleteShoppingListItem('${window.escapeHtml(item.id)}')">×</button>`;
        return `
        <div class="slist-item${item.done ? ' done' : ''}" data-id="${window.escapeHtml(item.id)}">
            <input type="checkbox" class="slist-checkbox" ${item.done ? 'checked' : ''} ${isViewer ? 'disabled' : ''} onchange="window.toggleShoppingListItem('${window.escapeHtml(item.id)}')">
            <span class="slist-name"><span class="slist-item-no">${itemNo}.</span>${window.escapeHtml(item.name)}${window._slistStapleBadgeHtml(item)}</span>
            <span class="slist-qty">${qtyText}</span>
            <span class="slist-cat-badge"${catStyleAttr}>${catText}</span>
            <span class="${unitPriceClass}"${unitPriceTitle}>${unitPriceText}</span>
            <span class="slist-price">${priceText}</span>
            <div class="slist-trail">${actionsHtml}</div>
        </div>
    `;
    }).join('');

    window._updateShoppingListSummary(items);
    window._renderShoppingListCategoryBreakdown(items);
    window._renderShoppingListBudgetWarnings(items);
    window._renderShoppingListForecast(items);
    window._renderShoppingListStapleReminders(items);
};

// ==================== PROYEKSI KEUANGAN ====================
// Card "Proyeksi Keuangan" di Belanja Bulanan: user isi pemasukan bulanan
// sendiri (angka bebas, bukan dari transaksi), dikurangi total daftar
// belanja saat ini (semua barang, sama seperti grandTotal di
// _renderShoppingListBudgetWarnings), hasilnya dikali 12 untuk perkiraan
// dana terkumpul dalam setahun kalau pola pemasukan & belanja ini konsisten
// tiap bulan -- dipakai user sebagai acuan kasar untuk menutup kebutuhan
// tahunan (THR, pajak tahunan, dst).
//
// Pemasukan disimpan per buku, localStorage + sync cloud lewat
// window.pushSetting (key 'shopping_list_income'), mengikuti pola yang
// sama dengan window.saveShoppingList di atas. Pull-nya ditangani terpusat
// di window.pullAllSettings (js/db.js, blok row.key === 'shopping_list_income').
window.getShoppingListMonthlyIncome = function(bookId) {
    const raw = localStorage.getItem('sk_shopping_list_income_' + (bookId || window.currentBookId));
    const num = Number(raw);
    return (num > 0) ? num : 0;
};

window.saveShoppingListMonthlyIncome = function(bookId, income) {
    const targetId = bookId || window.currentBookId;
    localStorage.setItem('sk_shopping_list_income_' + targetId, String(income));
    if (window.isOnline && window.isOnline() && window.pushSetting) {
        window.pushSetting('shopping_list_income', income, targetId).catch(function(e) {
            window.skWarn('[ShoppingList] Gagal sync pemasukan bulanan ke cloud:', e);
            window.showToast && window.showToast('Pemasukan bulanan tersimpan di perangkat ini, tapi gagal sinkron ke cloud.', 'error');
        });
    }
};

// Dipanggil dari onchange input pemasukan (bukan oninput -- supaya tidak
// nge-push ke cloud & re-render di setiap ketukan angka, cukup sekali saat
// user selesai mengisi/pindah fokus, sama seperti pola field harga di form
// tambah barang yang commit-nya di submit, bukan tiap ketik).
window.handleShoppingListIncomeChange = function(input) {
    if (window._slistBlockIfViewer()) {
        window.renderShoppingList();
        return;
    }
    const income = window.unRp(input.value);
    window.saveShoppingListMonthlyIncome(window.currentBookId, income);
    window._renderShoppingListForecast(window.getShoppingList(window.currentBookId));
};

window._renderShoppingListForecast = function(items) {
    const card = document.getElementById('slistForecastCard');
    if (!card) return;

    const isViewer = window._slistIsViewer();
    const income = window.getShoppingListMonthlyIncome(window.currentBookId);

    const incomeInput = document.getElementById('slistMonthlyIncome');
    if (incomeInput) {
        // Jangan timpa nilai input kalau lagi difokus/diketik user --
        // render ulang bisa dipicu di tengah user mengisi (mis. pull cloud
        // setelah barang berubah dari device lain).
        if (document.activeElement !== incomeInput) {
            incomeInput.value = income ? window.rp(income).replace('Rp', '').trim() : '';
        }
        incomeInput.disabled = isViewer;
    }

    const totalBelanja = (items || []).reduce((sum, i) => sum + window._shoppingListItemSubtotal(i), 0);
    const sisaBulanan = income - totalBelanja;
    const proyeksiTahunan = sisaBulanan * 12;
    const isNegative = sisaBulanan < 0;

    const fmtSigned = function(n) { return (n < 0 ? '-' : '') + window.rp(Math.abs(n)); };

    const incomeEl = document.getElementById('slistForecastIncome');
    const expenseEl = document.getElementById('slistForecastExpense');
    const surplusEl = document.getElementById('slistForecastMonthlySurplus');
    const yearlyEl = document.getElementById('slistForecastYearly');
    const noteEl = document.getElementById('slistForecastNote');

    if (incomeEl) incomeEl.innerText = window.rp(income);
    if (expenseEl) expenseEl.innerText = window.rp(totalBelanja);
    if (surplusEl) {
        surplusEl.innerText = fmtSigned(sisaBulanan);
        surplusEl.classList.toggle('is-negative', isNegative);
    }
    if (yearlyEl) {
        yearlyEl.innerText = fmtSigned(proyeksiTahunan);
        yearlyEl.classList.toggle('is-negative', isNegative);
    }
    if (noteEl) {
        if (!income) {
            noteEl.innerText = 'Isi pemasukan bulanan di atas untuk melihat proyeksi setahun.';
        } else if (isNegative) {
            noteEl.innerText = 'Total daftar belanja melebihi pemasukan bulanan -- proyeksi tahunan jadi minus.';
        } else {
            noteEl.innerText = 'Perkiraan dana terkumpul dalam 12 bulan ke depan kalau pemasukan & belanja bulanan ini konsisten, sebagai acuan kasar untuk menutup kebutuhan tahunan.';
        }
    }
};

// ==================== PENGINGAT STOK BAHAN POKOK ====================
// Barang yang ditandai `isStaple` (checkbox "Bahan pokok" di form tambah/
// ubah) diingatkan otomatis kalau sudah waktunya beli lagi -- TANPA tabel
// atau key sync baru: cukup satu field tambahan pada item yang sudah
// tersinkron lewat key 'shopping_list' yang ada (lihat window.saveShoppingList
// di atas), dan histori pembelian diambil dari window.txs yang sudah ada
// (setiap centang barang bikin transaksi dengan `shoppingListItemId` --
// lihat window.toggleShoppingListItem di bawah).
//
// Interval "beli lagi" dihitung dua cara:
// 1. Kalau item sudah punya >=2 transaksi tercatat, interval dipelajari
//    dari rata-rata jarak antar pembelian sungguhan (learned=true).
// 2. Kalau belum, jatuh balik ke tabel perkiraan umum per jenis barang
//    (mis. beras/gas ~30 hari, telur/susu ~14 hari) lewat pencocokan kata
//    kunci nama barang -- fallback generik 30 hari kalau tidak cocok satupun.
window.SK_STAPLE_DEFAULT_INTERVALS = [
    { keywords: ['beras'], days: 30 },
    { keywords: ['minyak goreng', 'minyak'], days: 30 },
    { keywords: ['gas', 'lpg', 'elpiji'], days: 30 },
    { keywords: ['gula'], days: 30 },
    { keywords: ['garam'], days: 60 },
    { keywords: ['telur'], days: 14 },
    { keywords: ['susu'], days: 14 },
    { keywords: ['galon', 'air minum', 'aqua'], days: 14 },
    { keywords: ['kopi'], days: 21 },
    { keywords: ['teh'], days: 30 },
    { keywords: ['sabun', 'shampo', 'sampo'], days: 30 },
    { keywords: ['deterjen', 'cucian'], days: 30 },
    { keywords: ['pasta gigi', 'odol'], days: 45 },
    { keywords: ['tisu'], days: 21 },
];

window._slistDefaultIntervalForName = function(name) {
    const n = (name || '').toLowerCase();
    for (const rule of window.SK_STAPLE_DEFAULT_INTERVALS) {
        if (rule.keywords.some(k => n.includes(k))) return rule.days;
    }
    return 30; // fallback generik kalau nama barang tidak cocok kata kunci manapun
};

// Ambil tanggal-tanggal pembelian sungguhan untuk satu barang, dari
// transaksi yang dibuat otomatis oleh toggleShoppingListItem (ditandai
// shoppingListItemId). Diurutkan lama -> baru.
window._slistGetPurchaseHistory = function(itemId) {
    if (!Array.isArray(window.txs)) return [];
    return window.txs
        .filter(t => t.shoppingListItemId === itemId && t.type === 'expense')
        .map(t => new Date(t.date))
        .filter(d => !isNaN(d))
        .sort((a, b) => a - b);
};

// Hitung status pengingat untuk satu item staple. Return null kalau item
// bukan bahan pokok (tidak perlu dihitung sama sekali).
window._slistComputeRestockInfo = function(item) {
    if (!item || !item.isStaple) return null;
    const history = window._slistGetPurchaseHistory(item.id);
    let intervalDays = window._slistDefaultIntervalForName(item.name);
    let learned = false;

    if (history.length >= 2) {
        const gaps = [];
        for (let i = 1; i < history.length; i++) {
            gaps.push((history[i] - history[i - 1]) / 86400000);
        }
        const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        // Jarak rata-rata < 1 hari (mis. data uji/dobel input) diabaikan --
        // tidak masuk akal jadi interval, tetap pakai perkiraan umum.
        if (avgGap >= 1) { intervalDays = Math.round(avgGap); learned = true; }
    }

    if (!history.length) {
        return { hasHistory: false, intervalDays, learned: false, daysSinceLast: null, dueInDays: null, isDue: false };
    }

    const lastDate = history[history.length - 1];
    const daysSinceLast = Math.floor((new Date() - lastDate) / 86400000);
    const dueInDays = intervalDays - daysSinceLast;
    return { hasHistory: true, intervalDays, learned, daysSinceLast, dueInDays, isDue: dueInDays <= 0, lastDate };
};

// Badge kecil di baris barang (dipanggil dari renderShoppingList).
window._slistStapleBadgeHtml = function(item) {
    if (!item.isStaple) return '';
    const info = window._slistComputeRestockInfo(item);
    if (!info) return '';
    if (!info.hasHistory) {
        return `<span class="slist-staple-badge is-pending" title="Bahan pokok -- pengingat aktif otomatis setelah pembelian pertama tercatat (centang barang ini saat dibeli).">📦</span>`;
    }
    const basis = info.learned ? 'histori pembelian barang ini' : 'perkiraan umum untuk jenis barang ini';
    if (info.isDue) {
        const lewat = Math.abs(info.dueInDays);
        const lewatText = lewat > 0 ? ` (${lewat} hari lewat dari perkiraan)` : '';
        return `<span class="slist-staple-badge is-due" title="Berdasarkan ${basis}: diperkirakan tiap ${info.intervalDays} hari sekali beli${lewatText}.">🔔 Beli lagi</span>`;
    }
    if (info.dueInDays <= 5) {
        return `<span class="slist-staple-badge is-soon" title="Berdasarkan ${basis}: diperkirakan tiap ${info.intervalDays} hari sekali beli.">⏳ ${info.dueInDays} hari lagi</span>`;
    }
    return `<span class="slist-staple-badge is-ok" title="Stok diperkirakan masih cukup ~${info.dueInDays} hari lagi (berdasarkan ${basis}).">📦</span>`;
};

// Banner ringkasan di atas daftar -- supaya bahan pokok yang sudah waktunya
// dibeli lagi tidak cuma kelihatan kalau user kebetulan scroll ke barisnya.
window._renderShoppingListStapleReminders = function(items) {
    const el = document.getElementById('slistStapleReminders');
    if (!el) return;
    const due = (items || [])
        .filter(i => i.isStaple)
        .map(i => ({ item: i, info: window._slistComputeRestockInfo(i) }))
        .filter(x => x.info && x.info.isDue);

    if (!due.length) {
        el.style.display = 'none';
        el.innerHTML = '';
        return;
    }
    const names = due.map(x => window.escapeHtml(x.item.name)).join(', ');
    el.style.display = '';
    el.innerHTML = `<div class="slist-staple-banner">🔔 Bahan pokok sudah waktunya dibeli lagi: <strong>${names}</strong></div>`;
};

// ==================== PERINGATAN ANGGARAN ====================
// Bandingkan total belanja per kategori di daftar ini dengan anggaran
// bulan berjalan (window.getEffectiveBudget -- otomatis pakai Anggaran
// Bulanan khusus kalau sudah disetel utk bulan ini, atau jatuh balik ke
// Anggaran Dasar kalau belum). Dihitung dari SEMUA barang di daftar
// (baik yang sudah maupun belum dicentang) karena daftar ini mewakili
// rencana total belanja bulan ini, bukan cuma realisasi yang sudah dibeli.
window._renderShoppingListBudgetWarnings = function(items) {
    const box = document.getElementById('slistBudgetWarnings');
    if (!box) return;
    if (!window.EXPENSE_CATEGORIES || typeof window.getEffectiveBudget !== 'function') {
        box.innerHTML = '';
        window._lastShoppingListWarnings = [];
        return;
    }
    const now = new Date();
    const effective = window.getEffectiveBudget(now.getFullYear(), now.getMonth() + 1, window.currentBookId);
    const currentBudget = effective.budget || {};

    // Total per kategori dari daftar belanja
    const catTotals = {};
    let grandTotal = 0;
    items.forEach(i => {
        const subtotal = window._shoppingListItemSubtotal(i);
        grandTotal += subtotal;
        if (i.category && window.EXPENSE_CATEGORIES.includes(i.category)) {
            catTotals[i.category] = (catTotals[i.category] || 0) + subtotal;
        }
    });

    const warnings = [];
    window.EXPENSE_CATEGORIES.forEach(cat => {
        const spent = catTotals[cat] || 0;
        const target = currentBudget[cat] || 0;
        if (spent > 0 && target > 0 && spent > target) {
            warnings.push({
                category: cat,
                text: `<b>${window.escapeHtml(cat)}</b>: daftar belanja ${window.rp(spent)} melebihi anggaran ${window.rp(target)}`,
                plainText: `Anggaran "${cat}" terlampaui: daftar belanja ${window.rp(spent)} vs anggaran ${window.rp(target)}`,
                over: true
            });
        }
    });

    // Total keseluruhan anggaran bulan ini (jumlah semua kategori)
    let totalBudget = 0;
    window.EXPENSE_CATEGORIES.forEach(c => totalBudget += (currentBudget[c] || 0));
    if (totalBudget > 0 && grandTotal > totalBudget) {
        const sourceLabel = effective.source === 'custom' ? 'Anggaran Bulanan' : 'Anggaran Dasar';
        warnings.unshift({
            category: '__total__',
            text: `<b>Total daftar belanja</b> ${window.rp(grandTotal)} melebihi ${sourceLabel} bulan ini (${window.rp(totalBudget)})`,
            plainText: `Total daftar belanja ${window.rp(grandTotal)} melebihi ${sourceLabel} bulan ini (${window.rp(totalBudget)})`,
            over: true
        });
    }

    if (!warnings.length) {
        box.innerHTML = '';
        window._lastShoppingListWarnings = [];
        return;
    }
    box.innerHTML = warnings.map(w => `
        <div class="slist-budget-warning${w.over ? ' is-over' : ''}">
            <span>⚠️ ${w.text}</span>
        </div>
    `).join('');
    window._lastShoppingListWarnings = warnings;
};

// ==================== RINCIAN SISA ANGGARAN PER KATEGORI ====================
// Menjawab "anggaran mana saja yang masih bersisa": daftar tiap kategori
// yang punya anggaran bulan ini (custom atau Anggaran Dasar), dibandingkan
// dengan total belanja kategori itu di daftar belanja ini (SEMUA barang,
// dicentang maupun belum -- sama seperti _renderShoppingListBudgetWarnings,
// karena daftar ini mewakili rencana belanja bulan ini). Diurutkan dari
// sisa TERBANYAK ke yang paling sedikit/minus, supaya kategori yang masih
// longgar langsung terlihat di atas.
window._renderShoppingListCategoryBreakdown = function(items) {
    const box = document.getElementById('slistCategoryBreakdown');
    if (!box) return;
    if (!window.EXPENSE_CATEGORIES || typeof window.getEffectiveBudget !== 'function') {
        box.innerHTML = '';
        return;
    }
    const now = new Date();
    const effective = window.getEffectiveBudget(now.getFullYear(), now.getMonth() + 1, window.currentBookId);
    const currentBudget = effective.budget || {};

    const catTotals = {};
    items.forEach(i => {
        if (i.category && window.EXPENSE_CATEGORIES.includes(i.category)) {
            catTotals[i.category] = (catTotals[i.category] || 0) + window._shoppingListItemSubtotal(i);
        }
    });

    const rows = window.EXPENSE_CATEGORIES
        .filter(cat => (currentBudget[cat] || 0) > 0)
        .map(cat => {
            const budget = currentBudget[cat] || 0;
            const spent = catTotals[cat] || 0;
            const sisa = budget - spent;
            const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
            return { cat, budget, spent, sisa, pct };
        })
        .sort((a, b) => b.sisa - a.sisa);

    if (!rows.length) {
        box.innerHTML = `
            <div class="slist-cat-breakdown-title">Sisa Anggaran per Kategori</div>
            <div class="slist-cat-breakdown-empty">Belum ada anggaran kategori yang disetel untuk bulan ini.</div>
        `;
        return;
    }

    box.innerHTML = `
        <div class="slist-cat-breakdown-title">Sisa per Kategori</div>
        <div class="slist-cat-rows">
            ${rows.map(r => `
                <div class="slist-cat-row">
                    <div class="slist-cat-row-top">
                        <span class="slist-cat-row-name" title="${window.escapeHtml(r.cat)}">${window.escapeHtml(r.cat)}</span>
                        <span class="slist-cat-row-sisa${r.sisa < 0 ? ' is-over' : ''}">${window.rp(r.sisa)}</span>
                    </div>
                    <span class="slist-cat-row-bar"><span class="slist-cat-row-bar-fill${r.sisa < 0 ? ' is-over' : ''}" style="width:${r.pct}%"></span></span>
                </div>
            `).join('')}
        </div>
    `;
};

window._updateShoppingListSummary = function(items) {
    const total = items.length;
    const done = items.filter(i => i.done).length;
    const remaining = items.filter(i => !i.done).reduce((sum, i) => sum + window._shoppingListItemSubtotal(i), 0);
    const totalBelanja = items.reduce((sum, i) => sum + window._shoppingListItemSubtotal(i), 0);

    const valEl = document.getElementById('slistRemainingValue');
    if (valEl) valEl.innerText = window.rp(remaining);
    const totalValEl = document.getElementById('slistTotalValue');
    if (totalValEl) totalValEl.innerText = window.rp(totalBelanja);
    const metaEl = document.getElementById('slistProgressCount');
    if (metaEl) metaEl.innerText = `${done} dari ${total} dibeli`;

    // Anggaran Bulanan (efektif -- custom bulan ini, atau jatuh balik ke
    // Anggaran Dasar) & Sisa Anggaran (anggaran dikurangi total belanja).
    const budgetEl = document.getElementById('slistBudgetValue');
    const budgetRemainingEl = document.getElementById('slistBudgetRemainingValue');
    let totalBudget = 0;
    if (window.EXPENSE_CATEGORIES && typeof window.getEffectiveBudget === 'function') {
        const now = new Date();
        const effective = window.getEffectiveBudget(now.getFullYear(), now.getMonth() + 1, window.currentBookId);
        const currentBudget = effective.budget || {};
        window.EXPENSE_CATEGORIES.forEach(c => totalBudget += (currentBudget[c] || 0));
    }
    if (budgetEl) budgetEl.innerText = window.rp(totalBudget);

    // [TREN ANGGARAN] Perubahan %-vs-bulan-lalu, dihitung dari total Anggaran
    // Bulanan efektif bulan ini vs bulan sebelumnya (perubahan biasanya
    // "berlaku" per tanggal 1 lewat auto-copy Anggaran Dasar / ensureMonthlyBudgetExists,
    // sama seperti indikator naik/turun di Harga Komoditas). '-' kalau bulan
    // lalu belum ada anggaran sama sekali (belum bisa dibandingkan).
    const changeMetaEl = document.getElementById('slistBudgetChangeMeta');
    if (changeMetaEl) {
        changeMetaEl.innerHTML = '';
        if (window.EXPENSE_CATEGORIES && typeof window.getEffectiveBudget === 'function') {
            const now = new Date();
            let prevMonth = now.getMonth(); // 0-based bulan sekarang = bulan lalu (1-based)
            let prevYear = now.getFullYear();
            if (prevMonth === 0) { prevMonth = 12; prevYear -= 1; }
            const prevEffective = window.getEffectiveBudget(prevYear, prevMonth, window.currentBookId);
            const prevBudgetObj = prevEffective.budget || {};
            let prevTotalBudget = 0;
            window.EXPENSE_CATEGORIES.forEach(c => prevTotalBudget += (prevBudgetObj[c] || 0));
            if (prevTotalBudget > 0) {
                const pct = ((totalBudget - prevTotalBudget) / prevTotalBudget) * 100;
                const up = pct > 0;
                const flat = Math.abs(pct) < 0.05;
                const color = flat ? 'var(--text-secondary)' : (up ? 'var(--danger)' : 'var(--success)');
                const arrow = flat ? '' : (up ? '\u25B2 ' : '\u25BC ');
                changeMetaEl.innerHTML = '<span style="color:' + color + '">' + arrow + Math.abs(pct).toFixed(1) + '% dari bulan lalu</span>';
            } else {
                changeMetaEl.innerHTML = '<span style="color:var(--text-secondary)">-</span>';
            }
        }
    }

    if (budgetRemainingEl) {
        const sisaAnggaran = totalBudget - totalBelanja;
        budgetRemainingEl.innerText = window.rp(sisaAnggaran);
        budgetRemainingEl.classList.toggle('is-negative', sisaAnggaran < 0);
    }
    const absorptionEl = document.getElementById('slistBudgetAbsorptionMeta');
    if (absorptionEl) {
        const pct = totalBudget > 0 ? Math.round((totalBelanja / totalBudget) * 100) : 0;
        absorptionEl.innerText = `Penyerapan anggaran ${pct}%`;
        absorptionEl.classList.toggle('is-negative', pct > 100);
    }
};

window.addShoppingListItem = function(e) {
    e.preventDefault();
    if (window._slistBlockIfViewer()) return;
    const nameInput = document.getElementById('slistNewName');
    const qtyInput = document.getElementById('slistNewQty');
    const priceInput = document.getElementById('slistNewPrice');
    const categorySelect = document.getElementById('slistNewCategory');
    const name = nameInput.value.trim();
    if (!name) return;
    const items = window.getShoppingList(window.currentBookId);
    const qtyParsed = parseFloat(qtyInput.value);
    const qty = (qtyParsed > 0) ? qtyParsed : 1;
    // [AUTO HARGA PANGAN] Kolom harga sengaja dikosongkan user -> coba isi
    // dari harga referensi BI kalau nama barangnya cocok salah satu
    // komoditas yang ditrack (js/harga-pangan.js). Kalau user memang mengisi
    // harga sendiri, itu yang dipakai apa adanya -- referensi tidak pernah
    // menimpa input manual.
    const rawPrice = window.unRp(priceInput.value);
    const ref = (!rawPrice && typeof window.getHargaPanganUntukItem === 'function')
        ? window.getHargaPanganUntukItem(name) : null;
    items.push({
        id: 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: name,
        qty: qty,
        price: rawPrice || (ref ? ref.price : 0),
        priceSource: rawPrice ? 'manual' : (ref ? 'ref' : undefined),
        priceRefDate: ref ? ref.date : undefined,
        category: categorySelect ? categorySelect.value : '',
        done: false,
        isStaple: !!(document.getElementById('slistNewIsStaple') && document.getElementById('slistNewIsStaple').checked)
    });
    const addedCategory = categorySelect ? categorySelect.value : '';
    window.saveShoppingList(window.currentBookId, items);
    nameInput.value = '';
    qtyInput.value = '';
    priceInput.value = '';
    if (categorySelect) {
        categorySelect.value = '';
        categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    nameInput.focus();
    window.renderShoppingList();

    // Kalau barang yang baru saja ditambahkan membuat kategorinya (atau
    // total daftar belanja) melebihi anggaran, beri tahu lewat toast juga
    // -- banner di atas form sudah tampil, tapi toast lebih kelihatan
    // langsung setelah aksi tambah barang.
    const warns = window._lastShoppingListWarnings || [];
    const relevant = warns.find(w => w.category === addedCategory || w.category === '__total__');
    if (relevant) {
        window.showToast(relevant.plainText, 'warning');
    }
};

window.toggleShoppingListItem = async function(id) {
    if (window._slistBlockIfViewer()) { window.renderShoppingList(); return; }
    window.ensureShoppingListMonthlyCycle(window.currentBookId);
    const items = window.getShoppingList(window.currentBookId);
    const item = items.find(i => i.id === id);
    if (!item) return;
    const willBeDone = !item.done;
    if (willBeDone) {
        const amount = window._shoppingListItemSubtotal(item);
        if (amount <= 0) {
            window.showToast('Isi harga barang terlebih dahulu agar pengeluaran dapat dibuat otomatis.', 'warning');
            window.renderShoppingList();
            return;
        }

        const monthKey = window.getShoppingListMonthKey();
        // Satu centang hanya mencatat satu transaksi untuk siklus bulan ini.
        // Penanda ini tersimpan bersama item agar reload/offline tidak membuat
        // transaksi ganda; bulan berikutnya otomatis memakai monthKey baru.
        if (item.lastExpenseMonth !== monthKey) {
            const now = new Date();
            const pad = n => String(n).padStart(2, '0');
            const txId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            const transaction = {
                id: txId,
                type: 'expense',
                date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
                category: item.category || 'Belanja Harian',
                description: `[Belanja Bulanan] ${item.name}`,
                amount: amount,
                attachment: null,
                shoppingListItemId: item.id,
                shoppingListMonth: monthKey,
                updated_at: now.toISOString()
            };
            window.txs.unshift(transaction);
            window.markTxDirty(transaction.id);
            window.saveTransactions();
            item.lastExpenseMonth = monthKey;
            item.lastExpenseTransactionId = transaction.id;
            if (typeof window.checkBudgetWarningAfterSave === 'function') {
                window.checkBudgetWarningAfterSave(transaction.date, transaction.category);
            }
            if (typeof window.addCloudLog === 'function') {
                window.addCloudLog('TAMBAH', `Mencatat belanja "${item.name}" otomatis sebesar ${window.rp(amount)}`).catch(function() {});
            }
            if (typeof window.sendTelegramNotif === 'function' && typeof window.buildTxNotifMessage === 'function') {
                window.sendTelegramNotif(window.buildTxNotifMessage('TAMBAH', transaction, window.getCurrentBookName()));
            }
            window.showToast('Pengeluaran otomatis ditambahkan ke dashboard.', 'success');
        }
    } else {
        // Uncheck berarti pembelian dibatalkan. Hapus HANYA transaksi yang
        // dibuat otomatis untuk item ini pada bulan aktif; transaksi bulan
        // sebelumnya tidak pernah disentuh.
        const monthKey = window.getShoppingListMonthKey();
        const txId = item.lastExpenseMonth === monthKey ? item.lastExpenseTransactionId : null;
        if (txId) {
            const transaction = window.txs.find(t => t.id === txId);
            // Batalkan antrean upsert bila centang dibatalkan sebelum transaksi
            // sempat tersinkron, agar transaksi yang sudah dihapus tidak malah
            // terkirim kemudian.
            if (typeof window.clearTxDirty === 'function') window.clearTxDirty([txId]);
            window.txs = window.txs.filter(t => t.id !== txId);
            window.saveTransactions();

            // Penghapusan cloud memakai soft-delete dan antrean persisten yang
            // sama dengan hapus transaksi biasa, jadi tetap aman saat offline.
            if (typeof window.markTxPendingDelete === 'function') {
                window.markTxPendingDelete(txId, window.currentBookId);
                if (window.isOnline && window.isOnline() && typeof window.pushDeleteToCloud === 'function') {
                    const deleted = await window.pushDeleteToCloud(txId, window.currentBookId);
                    if (deleted && typeof window.clearTxPendingDelete === 'function') window.clearTxPendingDelete(txId);
                }
            }
            if (transaction && typeof window.addCloudLog === 'function') {
                window.addCloudLog('HAPUS', `Membatalkan pengeluaran belanja otomatis "${item.name}" ber-ID: ${txId}`).catch(function() {});
            }
            if (transaction && typeof window.sendTelegramNotif === 'function' && typeof window.buildTxNotifMessage === 'function') {
                window.sendTelegramNotif(window.buildTxNotifMessage('HAPUS', transaction, window.getCurrentBookName()));
            }
            item.lastExpenseMonth = null;
            item.lastExpenseTransactionId = null;
            window.showToast('Centang dibatalkan dan pengeluaran otomatis dihapus.', 'success');
        }
    }
    item.done = willBeDone;
    item.checklistMonth = window.getShoppingListMonthKey();
    window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
};

window.deleteShoppingListItem = function(id) {
    if (window._slistBlockIfViewer()) return;
    const all = window.getShoppingList(window.currentBookId);
    const target = all.find(i => i.id === id);
    const wasStaple = !!(target && target.isStaple);
    const items = all.filter(i => i.id !== id);
    window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
    if (wasStaple) {
        window.showToast && window.showToast('Barang bahan pokok dihapus -- pengingat stoknya juga tidak berlaku lagi untuk barang ini.', 'warning');
    }
};

// Buka modal edit, isi form dengan data barang yang sudah ada. Dropdown
// kategori diisi ulang tiap kali dibuka (bukan cuma sekali seperti dropdown
// tambah barang) supaya selalu sinkron kalau kategori berubah di anggaran.
window.openEditShoppingListItemModal = function(id) {
    if (window._slistBlockIfViewer()) return;
    const items = window.getShoppingList(window.currentBookId);
    const item = items.find(i => i.id === id);
    if (!item) return;

    const catSelect = document.getElementById('slistEditCategory');
    const cats = window.EXPENSE_CATEGORIES || [];
    catSelect.innerHTML = '<option value="">Tanpa kategori</option>' +
        cats.map(c => `<option value="${window.escapeHtml(c)}">${window.escapeHtml(c)}</option>`).join('');
    catSelect.value = item.category || '';

    document.getElementById('slistEditId').value = item.id;
    document.getElementById('slistEditName').value = item.name || '';
    document.getElementById('slistEditQty').value = (Number(item.qty) > 0) ? item.qty : '';
    const priceInput = document.getElementById('slistEditPrice');
    priceInput.value = item.price ? window.rp(item.price).replace('Rp', '').trim() : '';
    const staleCheckbox = document.getElementById('slistEditIsStaple');
    if (staleCheckbox) staleCheckbox.checked = !!item.isStaple;

    window.openModal('editShoppingListItemModal');
};

window.handleEditShoppingListItemSubmit = function(e) {
    e.preventDefault();
    if (window._slistBlockIfViewer()) return;
    const id = document.getElementById('slistEditId').value;
    const name = document.getElementById('slistEditName').value.trim();
    if (!name) return;
    const qtyParsed = parseFloat(document.getElementById('slistEditQty').value);
    const qty = (qtyParsed > 0) ? qtyParsed : 1;
    const rawPrice = window.unRp(document.getElementById('slistEditPrice').value);
    const category = document.getElementById('slistEditCategory').value;

    const items = window.getShoppingList(window.currentBookId);
    const item = items.find(i => i.id === id);
    if (!item) return;
    // [AUTO HARGA PANGAN] Sama seperti addShoppingListItem: kalau field
    // harga sengaja dikosongkan, coba isi dari referensi BI dulu sebelum
    // jatuh ke 0. Kalau user isi angka sendiri (termasuk sengaja menimpa
    // harga referensi sebelumnya), itu jadi harga manual & tidak akan
    // ditimpa lagi oleh auto-update berikutnya.
    const ref = (!rawPrice && typeof window.getHargaPanganUntukItem === 'function')
        ? window.getHargaPanganUntukItem(name) : null;
    item.name = name;
    item.qty = qty;
    item.price = rawPrice || (ref ? ref.price : 0);
    item.priceSource = rawPrice ? 'manual' : (ref ? 'ref' : undefined);
    item.priceRefDate = ref ? ref.date : undefined;
    item.category = category;
    const staleCheckboxEl = document.getElementById('slistEditIsStaple');
    item.isStaple = !!(staleCheckboxEl && staleCheckboxEl.checked);

    window.saveShoppingList(window.currentBookId, items);
    window.closeModal('editShoppingListItemModal');
    window.renderShoppingList();
    window.showToast('Barang diperbarui.', 'success');
};

window.resetShoppingListChecks = function() {
    if (window._slistBlockIfViewer()) return;
    const items = window.getShoppingList(window.currentBookId);
    if (!items.length) return;
    items.forEach(i => { i.done = false; });
    window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
    window.showToast('Semua centang direset — daftar siap dipakai lagi.', 'success');
};

window.clearBoughtShoppingListItems = function() {
    if (window._slistBlockIfViewer()) return;
    const items = window.getShoppingList(window.currentBookId);
    // Barang bahan pokok (isStaple) sengaja TIDAK ikut dihapus di sini
    // meskipun sudah dicentang -- kalau ikut terhapus, histori pembeliannya
    // (dilacak lewat shoppingListItemId di window.txs) putus dan pengingat
    // "waktunya beli lagi" jadi tidak berguna karena baris pengingatnya
    // sendiri lenyap. Barang non-staple yang sudah dibeli tetap dihapus
    // seperti sebelumnya.
    const remaining = items.filter(i => !i.done || i.isStaple);
    if (remaining.length === items.length) {
        window.showToast('Belum ada barang yang dicentang sebagai sudah dibeli.', 'warning');
        return;
    }
    window.saveShoppingList(window.currentBookId, remaining);
    window.renderShoppingList();
    window.showToast('Barang yang sudah dibeli dihapus dari daftar.', 'success');
};
