// ==================== SUPABASE API ====================
window.callSupabaseAPI = async function(table, method, body = null, queryString = '') {
    const baseUrl = window.getCloudUrl();
    const apiKey = window.getSupabaseKey();
    if (!baseUrl || !apiKey) return null;
    let url = `${baseUrl}/rest/v1/${table}`;
    if (queryString) url += queryString;
    const headers = { 'apikey': apiKey, 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (method === 'POST') headers['Prefer'] = 'resolution=merge-duplicates,return=representation';
    const config = { method: method, headers: headers };
    if (body) config.body = JSON.stringify(body);
    try {
        const res = await fetch(url, config);
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : true;
    } catch (e) {
        console.error(`Supabase API Error (${table}):`, e);
        return null;
    }
};

// ==================== PUSH SETTINGS ====================
// Semua nilai dienkripsi (AES-GCM) dengan kunci sesi sebelum dikirim ke cloud,
// supaya isi tabel `settings` di Supabase tidak pernah berupa plain text
// (sebelumnya hanya kredensial koneksi yang dienkripsi, isi setting tidak).
window.pushSetting = async function(key, value, bookId) {
    if (!window.isOnline()) return;
    if (!window._sessionCryptoKey) {
        console.warn(`[Sync] Crypto key sesi tidak tersedia, push '${key}' dibatalkan (mencegah kebocoran plain text ke cloud).`);
        return;
    }
    const plainJson = JSON.stringify(value);
    const encryptedValue = await window.encryptStr(window._sessionCryptoKey, plainJson);
    const payload = [{
        book_id: bookId || window.currentBookId,
        key: key,
        value: encryptedValue,
        updated_at: new Date().toISOString()
    }];
    await window.callSupabaseAPI('settings', 'POST', payload);
};

window.pushSettingBooks = async function() {
    if (!window.isOnline()) return;
    await window.pushSetting('books', window.books, 'global');
    console.log('[Sync] Books saved to cloud:', window.books.length);
};

window.pushSettingBudgets = async function() {
    if (!window.isOnline()) return;
    const bud = JSON.parse(localStorage.getItem('sk_budgets_' + window.currentBookId) || '{}');
    await window.pushSetting('budgets', bud, window.currentBookId);
    await window.pushSettingDefaultBudget();
};

window.pushSettingDefaultBudget = async function() {
    if (!window.isOnline()) return;
    const defaultBudget = window.getDefaultBudget(window.currentBookId);
    await window.pushSetting('default_budget', defaultBudget, window.currentBookId);
};

window.pushSettingTelegram = async function() {
    if (!window.isOnline()) return;
    const cfg = await window.getTgConfig();
    await window.pushSetting('telegram_config', { token: cfg.token, chatId: cfg.chatId, edgeUrl: cfg.edgeUrl }, 'global');
};

// ==================== PULL SETTINGS ====================
// Mencoba dekripsi nilai dari cloud dengan kunci sesi. Jika gagal (data lama
// dari sebelum migrasi enkripsi, masih plain text), pakai apa adanya sebagai
// fallback supaya tidak memutus kompatibilitas dengan data yang sudah ada.
window._decryptSettingValue = async function(rawValue) {
    if (window._sessionCryptoKey) {
        try {
            return await window.decryptStr(window._sessionCryptoKey, rawValue);
        } catch (e) {
            console.warn('[Sync] Gagal dekripsi nilai setting, asumsikan data lama (plain text):', e);
        }
    }
    return rawValue;
};

window.pullAllSettings = async function() {
    if (!window.isOnline()) return;
    const allRows = await window.callSupabaseAPI('settings', 'GET', null, '?order=updated_at.desc');
    if (allRows && Array.isArray(allRows)) {
        let booksUpdated = false;
        let telegramUpdated = false;
        let budgetUpdated = false;
        for (const row of allRows) {
            let parsed;
            const decryptedValue = await window._decryptSettingValue(row.value);
            try { parsed = JSON.parse(decryptedValue); } catch { continue; }
            if (row.key === 'books' && Array.isArray(parsed) && parsed.length > 0) {
                const cloudIds = new Set(parsed.map(b => b.id));
                const localIds = new Set(window.books.map(b => b.id));
                let changed = false;
                let merged = parsed.map(cb => {
                    const localBook = window.books.find(b => b.id === cb.id);
                    if (!localBook) { changed = true; }
                    else if (localBook.name !== cb.name) { changed = true; }
                    return cb;
                });
                window.books.forEach(lb => {
                    if (!cloudIds.has(lb.id)) {
                        console.log('[Sync] Buku dihapus dari cloud, hapus lokal:', lb.name);
                        localStorage.removeItem('sk_txs_' + lb.id);
                        localStorage.removeItem('sk_budgets_' + lb.id);
                        localStorage.removeItem('sk_logs_' + lb.id);
                        localStorage.removeItem('sk_default_budget_' + lb.id);
                        changed = true;
                    }
                });
                if (changed) {
                    window.books = merged;
                    localStorage.setItem('sk_books', JSON.stringify(window.books));
                    booksUpdated = true;
                    if (!window.books.find(b => b.id === window.currentBookId) && window.books.length > 0) {
                        window.currentBookId = window.books[0].id;
                        localStorage.setItem('sk_current_book_id', window.currentBookId);
                    }
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
                localStorage.setItem('sk_budgets_' + row.book_id, JSON.stringify(parsed));
                if (row.book_id === window.currentBookId) {
                    window.budgets = parsed;
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
            if (row.key === 'google_sheets_url') {
                if (typeof parsed === 'string' && parsed) {
                    localStorage.setItem('sk_google_sheets_url', parsed);
                    const gsInput = document.getElementById('googleSheetsUrlInput');
                    if (gsInput) gsInput.value = parsed;
                } else {
                    localStorage.removeItem('sk_google_sheets_url');
                }
            }
        }
        if (booksUpdated) window.updateBookSelectDropdown();
        if (budgetUpdated) {
            window.renderBudget();
            window.updateFinancialCards && window.updateFinancialCards();
            if (document.getElementById('budgetModal').classList.contains('show')) {
                window.renderBudgetFormFields();
            }
        }
    }
    window.updateSettingsSyncStatus('pull');
};

window.updateSettingsSyncStatus = function(direction) {
    const el = document.getElementById('settingsSyncStatus');
    if (!el) return;
    const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const label = direction === 'pull' ? 'Ditarik dari cloud' : 'Disimpan ke cloud';
    el.innerText = `Terakhir ${label}: ${now}`;
};

// ============================================================
// DB.JS - FUNGSI KHUSUS UNTUK PAYMENT REMINDERS
// ============================================================

// ── PUSH PAYMENT REMINDER KE CLOUD ──
window.pushPaymentReminderToCloud = async function(bookId, reminderData) {
    if (!window.isOnline() || !bookId) return false;
    
    try {
        const payload = {
            ...reminderData,
            book_id: bookId,
            updated_at: new Date().toISOString()
        };
        
        const result = await window.callSupabaseAPI('payment_reminders', 'POST', [payload]);
        return !!result;
    } catch (e) {
        console.error('[DB] Gagal push payment reminder:', e);
        return false;
    }
};

// ── PULL PAYMENT REMINDER DARI CLOUD ──
window.pullPaymentRemindersFromCloud = async function(bookId) {
    if (!window.isOnline() || !bookId) return null;
    
    try {
        const result = await window.callSupabaseAPI(
            'payment_reminders',
            'GET',
            null,
            `?book_id=eq.${bookId}&order=created_at.desc`
        );
        
        if (result && Array.isArray(result)) {
            localStorage.setItem('sk_payment_reminders', JSON.stringify(result));
            return result;
        }
        return null;
    } catch (e) {
        console.error('[DB] Gagal pull payment reminders:', e);
        return null;
    }
};

// ── DELETE PAYMENT REMINDER DARI CLOUD ──
window.deletePaymentReminderFromCloud = async function(reminderId, bookId) {
    if (!window.isOnline() || !bookId) return false;
    
    try {
        const result = await window.callSupabaseAPI(
            'payment_reminders',
            'DELETE',
            null,
            `?id=eq.${reminderId}&book_id=eq.${bookId}`
        );
        return !!result;
    } catch (e) {
        console.error('[DB] Gagal delete payment reminder:', e);
        return false;
    }
};
