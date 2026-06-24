// ==================== TELEGRAM NOTIFICATIONS ====================
// getTgConfig sekarang async karena membaca dari enkripsi
window.getTgConfig = async function() {
    const { token, chatId, edgeUrl } = await window.getTelegramConfigDecrypted();
    return { token, edgeUrl, chatId, active: !!(token || edgeUrl) };
};

window.saveTelegramConfig = async function() {
    let token = document.getElementById('tgBotTokenInput').value.trim();
    let chatId = document.getElementById('tgChatIdInput').value.trim();
    if (!chatId) { window.showToast('Chat ID penerima wajib diisi!', 'error'); return; }
    if (!token) { window.showToast('Bot Token wajib diisi!', 'error'); return; }
    await window.saveTelegramConfigEncrypted(token, chatId, '');
    window.updateTgStatusBadge();
    window.showToast('Konfigurasi Telegram disimpan ✅', 'success');
    window.pushSettingTelegram();
};

window.clearTelegramConfig = function() {
    if (!confirm('Hapus konfigurasi Telegram?')) return;
    // Hapus versi terenkripsi
    localStorage.removeItem('sk_tg_token_enc');
    localStorage.removeItem('sk_tg_chatid_enc');
    localStorage.removeItem('sk_tg_edge_enc');
    // Hapus versi plain-text (migrasi lama)
    localStorage.removeItem('sk_tg_token');
    localStorage.removeItem('sk_tg_edge_url');
    localStorage.removeItem('sk_tg_chatid');
    document.getElementById('tgBotTokenInput').value = '';
    document.getElementById('tgEdgeUrlInput').value = '';
    document.getElementById('tgChatIdInput').value = '';
    window.updateTgStatusBadge();
    window.showToast('Konfigurasi Telegram dihapus', 'warning');
    window.pushSettingTelegram();
};

window.updateTgStatusBadge = async function() {
    let badge = document.getElementById('tgStatusBadge');
    if (!badge) return;
    let cfg = await window.getTgConfig();
    if (cfg.active) {
        badge.style.background = '#e3fcef';
        badge.style.color = '#006644';
        badge.innerText = '✅ Aktif';
    } else {
        badge.style.background = '#eee';
        badge.style.color = '#666';
        badge.innerText = 'Belum dikonfigurasi';
    }
};

window.loadTgConfigToForm = async function() {
    let cfg = await window.getTgConfig();
    let tokenEl = document.getElementById('tgBotTokenInput');
    let edgeEl = document.getElementById('tgEdgeUrlInput');
    let chatEl = document.getElementById('tgChatIdInput');
    if (tokenEl) tokenEl.value = cfg.token;
    if (edgeEl) edgeEl.value = cfg.edgeUrl;
    if (chatEl) chatEl.value = cfg.chatId;
    window.updateTgStatusBadge();
};

window.sendTelegramNotif = async function(msg) {
    let cfg = await window.getTgConfig();
    if (!cfg.active) return;
    try {
        if (cfg.edgeUrl) {
            const body = { message: msg };
            if (cfg.chatId) body.chat_id = cfg.chatId;
            const res = await fetch(cfg.edgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.getSupabaseKey()}` },
                body: JSON.stringify(body)
            });
            if (!res.ok) console.warn('[Telegram] Edge Function error:', await res.text());
        } else if (cfg.token && cfg.chatId) {
            const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: cfg.chatId, text: msg, parse_mode: 'HTML' })
            });
            const data = await res.json();
            if (!data.ok) console.warn('[Telegram] Gagal kirim:', data.description);
        }
    } catch(e) {
        console.warn('[Telegram] Gagal kirim notifikasi:', e.message);
    }
};

window.testTelegramNotif = async function() {
    let token = document.getElementById('tgBotTokenInput').value.trim();
    let edgeUrl = document.getElementById('tgEdgeUrlInput').value.trim();
    let chatId = document.getElementById('tgChatIdInput').value.trim();
    let statusEl = document.getElementById('tgTestStatus');
    if (!chatId) { window.showToast('Chat ID penerima wajib diisi!', 'error'); return; }
    if (!token && !edgeUrl) { window.showToast('Isi Bot Token!', 'error'); return; }
    // Simpan terenkripsi
    await window.saveTelegramConfigEncrypted(token, chatId, edgeUrl);
    window.updateTgStatusBadge();
    statusEl.innerHTML = '<span style="color:#cc7b00;">⏳ Mengirim pesan tes...</span>';
    const testMsg = `🔔 <b>Sinarkeu — Tes Notifikasi</b>\n\nKonfigurasi berhasil! Notifikasi transaksi akan dikirim ke sini.\n\n<i>Chat ID: ${chatId}</i>`;
    try {
        let res, data;
        if (edgeUrl) {
            res = await fetch(edgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.getSupabaseKey()}` },
                body: JSON.stringify({ message: testMsg, chat_id: chatId })
            });
            data = await res.json();
            if (data.ok) {
                statusEl.innerHTML = '<span style="color:#006644;">✅ Berhasil via Edge Function!</span>';
                window.showToast('Tes Telegram berhasil! ✅', 'success');
            } else {
                statusEl.innerHTML = `<span style="color:#de350b;">❌ Gagal: ${window.escapeHtml(data.error || JSON.stringify(data))}</span>`;
            }
        } else {
            res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: testMsg, parse_mode: 'HTML' })
            });
            data = await res.json();
            if (data.ok) {
                statusEl.innerHTML = '<span style="color:#006644;">✅ Berhasil! Cek Telegram kamu.</span>';
                window.showToast('Tes Telegram berhasil! ✅', 'success');
            } else {
                let errMsg = data.description || JSON.stringify(data);
                if (errMsg.includes('chat not found')) errMsg = 'Chat ID tidak ditemukan. Pastikan bot sudah di-/start atau ditambah ke grup.';
                if (errMsg.includes('Unauthorized')) errMsg = 'Bot Token tidak valid. Cek kembali dari @BotFather.';
                statusEl.innerHTML = `<span style="color:#de350b;">❌ ${window.escapeHtml(errMsg)}</span>`;
            }
        }
    } catch(e) {
        statusEl.innerHTML = `<span style="color:#de350b;">❌ Error jaringan: ${window.escapeHtml(e.message)}</span>`;
    }
};

window.buildTxNotifMessage = function(action, tx, bookName) {
    let emoji = tx.type === 'income' ? '💰' : '💸';
    let typeLabel = tx.type === 'income' ? 'PEMASUKAN' : 'PENGELUARAN';
    let actionLabel = action === 'TAMBAH' ? '➕ Transaksi Baru' : action === 'UBAH' ? '✏️ Transaksi Diubah' : '🗑️ Transaksi Dihapus';
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        let amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    // Catatan: untuk aksi HAPUS, confirmDelete() sudah menghapus transaksi dari
    // window.txs SEBELUM memanggil fungsi ini, sehingga saldo di atas sudah
    // mencerminkan kondisi setelah penghapusan — koreksi manual tidak diperlukan.
    let saldoSekarang = totalInc - totalExp;
    let saldoEmoji = saldoSekarang >= 0 ? '🟢' : '🔴';
    return `${emoji} <b>${actionLabel}</b>\n━━━━━━━━━━━━━━━━━━\n📒 <b>${bookName}</b>\n📂 ${typeLabel}${tx.category && tx.category !== 'Pemasukan' ? ' · <i>' + tx.category + '</i>' : ''}\n📝 ${tx.description}\n💵 <b>${window.rp(tx.amount)}</b>\n🕐 ${window.formatDateTime(tx.date)}\n━━━━━━━━━━━━━━━━━━\n${saldoEmoji} <b>Saldo Saat Ini: ${window.rp(saldoSekarang)}</b>`;
};

window.getCurrentBookName = function() {
    let book = window.books.find(b => b.id === window.currentBookId);
    return book ? book.name : window.currentBookId;
};

window.sendDailySummaryToTelegram = async function() {
    let cfg = await window.getTgConfig();
    if (!cfg.active) return;
    let now = new Date();
    let today = now.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    let m = now.getMonth() + 1;
    let y = now.getFullYear();
    let monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    let incToday = 0, expToday = 0;
    let todayStr = now.toISOString().slice(0, 10);
    window.txs.forEach(t => {
        if (!t.date) return;
        let d = t.date.slice(0, 10);
        if (d === todayStr) {
            let amt = Number(t.amount) || 0;
            if (t.type === 'income') incToday += amt;
            else expToday += amt;
        }
    });
    let incBulan = 0, expBulan = 0;
    window.txs.forEach(t => {
        let d = new Date(t.date);
        if ((d.getMonth() + 1) === m && d.getFullYear() === y) {
            let amt = Number(t.amount) || 0;
            if (t.type === 'income') incBulan += amt;
            else expBulan += amt;
        }
    });
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        let amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    let saldo = totalInc - totalExp;
    let msg = `📅 <b>Ringkasan Harian Sinarkeu</b>\n${today}\n📒 Buku: <b>${window.getCurrentBookName()}</b>\n━━━━━━━━━━━━━━━━━━\n<b>Hari Ini:</b>\n💰 Masuk: ${window.rp(incToday)}\n💸 Keluar: ${window.rp(expToday)}\n📊 Selisih: ${window.rp(incToday - expToday)}\n\n<b>Bulan ${monthNames[m - 1]} ${y}:</b>\n💰 Pemasukan: ${window.rp(incBulan)}\n💸 Pengeluaran: ${window.rp(expBulan)}\n📊 Selisih: ${window.rp(incBulan - expBulan)}\n━━━━━━━━━━━━━━━━━━\n${saldo >= 0 ? '🟢' : '🔴'} <b>Saldo Total: ${window.rp(saldo)}</b>`;
    window.sendTelegramNotif(msg);
};

window.scheduleDailySummary = async function() {
    let cfg = await window.getTgConfig();
    if (!cfg.active) return;
    let now = new Date();
    let target = new Date(now);
    target.setHours(21, 0, 0, 0);
    if (now >= target) target.setDate(target.getDate() + 1);
    let msUntil = target - now;
    setTimeout(() => {
        window.sendDailySummaryToTelegram();
        setInterval(window.sendDailySummaryToTelegram, 24 * 60 * 60 * 1000);
    }, msUntil);
    console.log(`[Telegram] Ringkasan harian dijadwalkan pukul 21:00`);
};