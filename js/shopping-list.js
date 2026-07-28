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
        });
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

window.renderShoppingList = function() {
    const container = document.getElementById('shoppingListContainer');
    const items = window.getShoppingList(window.currentBookId);

    if (!items.length) {
        container.innerHTML = '<div class="slist-empty">Daftar belanja masih kosong. Tambahkan barang lewat form di atas.</div>';
        window._updateShoppingListSummary(items);
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="slist-item${item.done ? ' done' : ''}" data-id="${window.escapeHtml(item.id)}">
            <input type="checkbox" class="slist-checkbox" ${item.done ? 'checked' : ''} onchange="window.toggleShoppingListItem('${window.escapeHtml(item.id)}')">
            <div class="slist-body">
                <span class="slist-name">${window.escapeHtml(item.name)}</span>
                ${item.qty && Number(item.qty) > 1 ? `<span class="slist-qty">x${window.escapeHtml(String(item.qty))}</span>` : ''}
                ${item.category ? `<span class="slist-cat-badge">${window.escapeHtml(item.category)}</span>` : ''}
            </div>
            <div class="slist-trail">
                <span class="slist-price">${item.price ? window.rp(window._shoppingListItemSubtotal(item)) : ''}</span>
                <button type="button" class="slist-del-btn" title="Hapus" onclick="window.deleteShoppingListItem('${window.escapeHtml(item.id)}')">×</button>
            </div>
        </div>
    `).join('');

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
    const items = window.getShoppingList(window.currentBookId);
    const item = items.find(i => i.id === id);
    if (!item) return;
    item.done = !item.done;
    window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
};

window.deleteShoppingListItem = function(id) {
    const items = window.getShoppingList(window.currentBookId).filter(i => i.id !== id);
    window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
};

window.resetShoppingListChecks = function() {
    const items = window.getShoppingList(window.currentBookId);
    if (!items.length) return;
    items.forEach(i => { i.done = false; });
    window.saveShoppingList(window.currentBookId, items);
    window.renderShoppingList();
    window.showToast('Semua centang direset — daftar siap dipakai lagi.', 'success');
};

window.clearBoughtShoppingListItems = function() {
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
