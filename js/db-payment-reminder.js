// ==================== DB: PAYMENT REMINDER CLOUD SYNC ====================
// Pecahan dari js/db.js -- lihat catatan pembagian modul di js/db-api.js.
// Harus dimuat setelah db-api.js.
//
// Isi file ini: CRUD payment reminder ke cloud (pushPaymentReminderToCloud/
// pullPaymentRemindersFromCloud/deletePaymentReminderFromCloud), dipakai
// dari js/payment-reminder.js.

// DB.JS - FUNGSI KHUSUS UNTUK PAYMENT REMINDERS
// ============================================================

// ── PUSH PAYMENT REMINDER KE CLOUD ──
window.pushPaymentReminderToCloud = async function(bookId, reminderData) {
    if (!window.isOnline() || !bookId) return false;
    
    try {
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        // (fungsi ini tampaknya tidak lagi dipanggil di mana pun, sudah
        // digantikan window.savePaymentReminder di payment-reminder.js,
        // tapi tetap dipertahankan untuk berjaga-jaga.)
        const payload = { ...reminderData, book_id: bookId, updated_at: new Date().toISOString(), ...(tag ? { account_tag: tag } : {}) };
        
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
            `?book_id=eq.${bookId}&order=created_at.desc${window.tagOrFilter(window.getAccountTag ? window.getAccountTag() : null, bookId)}`
        );
        
        if (result && Array.isArray(result)) {
            localStorage.setItem('sk_payment_reminders_' + bookId, JSON.stringify(result));
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
            `?id=eq.${reminderId}&book_id=eq.${bookId}${(window.getAccountTag && window.getAccountTag()) ? '&account_tag=eq.' + window.getAccountTag() : ''}`
        );
        return !!result;
    } catch (e) {
        console.error('[DB] Gagal delete payment reminder:', e);
        return false;
    }
};
