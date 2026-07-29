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
    const addRow = document.getElementById('slistAddRow');
    const addToggle = document.getElementById('slistAddToggle');
    const actions = document.getElementById('slistActions');
    if (notice) notice.style.display = isViewer ? '' : 'none';
    if (addRow) addRow.style.display = isViewer ? 'none' : '';
    // Tombol pill "+ Tambah Barang" (cuma tampak di hp, lihat CSS) juga
    // disembunyikan untuk viewer -- tidak ada gunanya buka form yang
    // toh tidak bisa disubmit.
    if (addToggle) addToggle.style.display = isViewer ? 'none' : '';
    if (actions) actions.style.display = isViewer ? 'none' : '';
};

// Buka/tutup form tambah barang di layar hp (lihat .slist-add-wrap.collapsed
// di css/style.css -- di layar lebar rule collapse-nya tidak berlaku sama
// sekali, jadi tombol ini otomatis disembunyikan lewat CSS di sana).
window.toggleShoppingListAddForm = function() {
    const wrap = document.getElementById('slistAddWrap');
    const toggle = document.getElementById('slistAddToggle');
    if (!wrap || !toggle) return;
    const willExpand = wrap.classList.contains('collapsed');
    wrap.classList.toggle('collapsed', !willExpand);
    toggle.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
    if (willExpand) {
        const nameInput = document.getElementById('slistNewName');
        // Fokus ke field nama begitu form terbuka supaya user bisa langsung
        // ketik tanpa ketuk lagi -- tapi tunda dikit sampai transisi CSS
        // (max-height 200ms) beres, supaya keyboard hp tidak memicu jump
        // scroll di tengah animasi.
        setTimeout(function() { nameInput && nameInput.focus(); }, 210);
    }
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

    // Daftar masih kosong -> langsung buka form tambah barang (di hp,
    // form ini default collapsed lewat tombol pill) supaya user baru
    // tidak perlu ketuk "+ Tambah Barang" dulu untuk lihat form-nya.
    const wrap = document.getElementById('slistAddWrap');
    const toggle = document.getElementById('slistAddToggle');
    if (wrap && toggle && !window._slistIsViewer() && window.getShoppingList(window.currentBookId).length === 0) {
        wrap.classList.remove('collapsed');
        toggle.setAttribute('aria-expanded', 'true');
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
        const unitPriceText = item.price ? window.rp(item.price) : '';
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
            <span class="slist-unit-price">${unitPriceText}</span>
            <span class="slist-price">${priceText}</span>
            <div class="slist-trail">${actionsHtml}</div>
        </div>
    `;
    }).join('');

    window._updateShoppingListSummary(items);
    window._renderShoppingListBudgetWarnings(items);
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
    items.push({
        id: 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: name,
        qty: qty,
        price: window.unRp(priceInput.value),
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
    const price = window.unRp(document.getElementById('slistEditPrice').value);
    const category = document.getElementById('slistEditCategory').value;

    const items = window.getShoppingList(window.currentBookId);
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.name = name;
    item.qty = qty;
    item.price = price;
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
