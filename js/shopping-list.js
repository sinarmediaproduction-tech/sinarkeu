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
            console.warn('[ShoppingList] Gagal sync ke cloud:', e);
            // [FIX] Sebelumnya kegagalan sync cuma dilempar ke console.warn --
            // perubahan terlihat berhasil di layar (sudah tersimpan lokal)
            // padahal cuma nyangkut di device ini (mis. ditolak RLS Supabase
            // kalau akun ini viewer di buku bersama). Tampilkan toast supaya
            // kegagalan tidak lagi tersembunyi.
            window.showToast && window.showToast('Perubahan tersimpan di perangkat ini, tapi gagal sinkron ke cloud. Barang tidak akan muncul di perangkat lain sampai sinkron berhasil.', 'error');
        });
    }
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
    if (nameInput) nameInput.value = '';
    if (qtyInput) qtyInput.value = '';
    if (priceInput) priceInput.value = '';
    if (categorySelect) categorySelect.value = '';
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
    window._populateShoppingListCategorySelect();
    window.renderShoppingList();
    window.openModal('shoppingListModal');

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
            console.warn('[ShoppingList] Gagal tarik data terbaru dari cloud saat buka modal:', e);
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
            console.warn('[ShoppingList] Gagal ambil harga referensi pangan:', e.message);
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

// Urutan tampil = urutan kategori di window.EXPENSE_CATEGORIES (js/config.js),
// supaya konsisten dengan urutan anggaran. Barang "Tanpa kategori" atau
// dengan nama kategori yang sudah tidak ada di daftar anggaran (mis. sisa
// data lama sebelum rename) ditaruh paling akhir. Di dalam kategori yang
// sama, urutan asli (urutan input) dipertahankan (stable sort) -- hanya
// urutan TAMPILAN yang diubah, array tersimpan di localStorage/cloud tidak
// diubah urutannya, jadi id-based lookup (edit/hapus/toggle) tetap aman.
window._sortShoppingListForDisplay = function(items) {
    const cats = window.EXPENSE_CATEGORIES || [];
    const rank = function(item) {
        const idx = item.category ? cats.indexOf(item.category) : -1;
        return idx === -1 ? cats.length : idx;
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
    const container = document.getElementById('shoppingListContainer');
    const items = window._sortShoppingListForDisplay(window.getShoppingList(window.currentBookId));
    const isViewer = window._slistIsViewer();
    window._slistApplyViewerUI();

    if (!items.length) {
        container.innerHTML = '<div class="slist-empty">Daftar belanja masih kosong. Tambahkan barang lewat form di atas.</div>';
        window._updateShoppingListSummary(items);
        window._renderShoppingListForecast(items);
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
    container.innerHTML = headerHtml + items.map(item => {
        const qtyText = (item.qty && Number(item.qty) > 1) ? `x${window.escapeHtml(String(item.qty))}` : '';
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
            <span class="slist-name">${window.escapeHtml(item.name)}</span>
            <span class="slist-qty">${qtyText}</span>
            <span class="slist-cat-badge"${catStyleAttr}>${catText}</span>
            <span class="${unitPriceClass}"${unitPriceTitle}>${unitPriceText}</span>
            <span class="slist-price">${priceText}</span>
            <div class="slist-trail">${actionsHtml}</div>
        </div>
    `;
    }).join('');

    window._updateShoppingListSummary(items);
    window._renderShoppingListBudgetWarnings(items);
    window._renderShoppingListForecast(items);
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
            console.warn('[ShoppingList] Gagal sync pemasukan bulanan ke cloud:', e);
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

window._updateShoppingListSummary = function(items) {
    const total = items.length;
    const done = items.filter(i => i.done).length;
    const remaining = items.filter(i => !i.done).reduce((sum, i) => sum + window._shoppingListItemSubtotal(i), 0);
    const valEl = document.getElementById('slistRemainingValue');
    if (valEl) valEl.innerText = window.rp(remaining);
    const metaEl = document.getElementById('slistProgressCount');
    if (metaEl) metaEl.innerText = `${done} dari ${total} dibeli`;
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
        done: false
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

window.toggleShoppingListItem = function(id) {
    if (window._slistBlockIfViewer()) { window.renderShoppingList(); return; }
    const items = window.getShoppingList(window.currentBookId);
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.done = !item.done;
    window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
};

window.deleteShoppingListItem = function(id) {
    if (window._slistBlockIfViewer()) return;
    const items = window.getShoppingList(window.currentBookId).filter(i => i.id !== id);
    window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
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
    const remaining = items.filter(i => !i.done);
    if (remaining.length === items.length) {
        window.showToast('Belum ada barang yang dicentang sebagai sudah dibeli.', 'warning');
        return;
    }
    window.saveShoppingList(window.currentBookId, remaining);
    window.renderShoppingList();
    window.showToast('Barang yang sudah dibeli dihapus dari daftar.', 'success');
};
