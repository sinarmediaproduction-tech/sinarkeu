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

window.openShoppingListModal = function() {
    window.renderShoppingList();
    window.openModal('shoppingListModal');
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
                ${item.qty ? `<span class="slist-qty">${window.escapeHtml(item.qty)}</span>` : ''}
            </div>
            <span class="slist-price">${item.price ? window.rp(item.price) : ''}</span>
            <button type="button" class="slist-del-btn" title="Hapus" onclick="window.deleteShoppingListItem('${window.escapeHtml(item.id)}')">×</button>
        </div>
    `).join('');

    window._updateShoppingListSummary(items);
};

window._updateShoppingListSummary = function(items) {
    const total = items.length;
    const done = items.filter(i => i.done).length;
    const remaining = items.filter(i => !i.done).reduce((sum, i) => sum + (Number(i.price) || 0), 0);
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
    const name = nameInput.value.trim();
    if (!name) return;
    const items = window.getShoppingList(window.currentBookId);
    items.push({
        id: 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: name,
        qty: qtyInput.value.trim(),
        price: window.unRp(priceInput.value),
        done: false
    });
    window.saveShoppingList(window.currentBookId, items);
    nameInput.value = '';
    qtyInput.value = '';
    priceInput.value = '';
    nameInput.focus();
    window.renderShoppingList();
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
