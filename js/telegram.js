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
    window.showToast('Konfigurasi Telegram disimpan ', 'success');
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
        badge.style.background = '#E3F0E9';
        badge.style.color = '#1F5138';
        badge.innerText = window.t('telegram_active');
    } else {
        badge.style.background = '#EFE7D8';
        badge.style.color = '#5B6472';
        badge.innerText = window.t('telegram_not_configured');
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
    const humanizeEl = document.getElementById('tgHumanizeToggle');
    if (humanizeEl) humanizeEl.checked = window.getTgHumanizeEnabled();
    window.updateTgStatusBadge();
};

// ==================== GAYA BAHASA AI (opsional) ====================
// Toggle lokal per-perangkat (mirip pola window.setLockscreenAiEnabled di
// js/lockscreen-insight.js) -- SENGAJA tidak disinkronkan ke cloud, karena
// ini murni preferensi tampilan, bukan data yang perlu sama di semua device.
window.getTgHumanizeEnabled = function() {
    return localStorage.getItem('sk_tg_humanize') === '1';
};
window.setTgHumanizeEnabled = function(on) {
    localStorage.setItem('sk_tg_humanize', on ? '1' : '0');
    if (on && typeof window.resolveAIEndpoint === 'function' && !window.resolveAIEndpoint().ok) {
        window.showToast('Atur dulu mesin AI di Setelan → Analisis Sinarkeu, supaya gaya bahasa notifikasi Telegram bisa dibuat Sinarkeu.', 'error');
    }
};

// [FITUR - GAYA BAHASA AI] Semua notifikasi Telegram di app ini (transaksi,
// ringkasan harian, anggaran, buku, backup, dst) dibangun dari TEMPLATE HTML
// tetap (lihat buildTxNotifMessage dkk) -- rapi & selalu benar angkanya,
// tapi kalau dibaca terus-menerus terasa seperti pesan robot/laporan sistem,
// bukan sesuatu yang manusiawi.
//
// Fungsi ini dipasang SATU TEMPAT di window.sendTelegramNotif (titik akhir
// SEMUA jalur notifikasi di atas) supaya tidak perlu mengubah tiap pemanggil
// satu-satu: kalau toggle aktif & mesin AI sudah dikonfigurasi (lihat
// window.resolveAIEndpoint, js/ai.js), teks template dilucuti tag HTML-nya
// lalu diminta AI ditulis ulang jadi 1-3 kalimat santai ala manusia --
// dengan larangan KETAT mengubah/mengarang angka atau info apa pun, cuma
// menyusun ulang kalimatnya. Best-effort murni: toggle mati, AI belum
// dikonfigurasi, request gagal/timeout, atau hasilnya kosong/mencurigakan
// -> diam-diam balik pakai teks template asli. Notifikasi TIDAK PERNAH gagal
// terkirim gara-gara fitur opsional ini bermasalah.
//
// CATATAN BIAYA: tiap notifikasi yang di-humanize berarti satu panggilan
// tambahan ke mesin AI aktif (Groq/Cloudflare Worker atau Gemini/Supabase
// Edge Function). Kalau mesin aktifnya 'gemini', ini menambah beban ke
// project Supabase yang sama (invocation Edge Function) -- pertimbangkan
// pakai mesin 'worker' (Cloudflare, di luar Supabase) untuk fitur ini kalau
// kuota Supabase sedang ketat.
window._humanizeTelegramText = async function(templatedMsg) {
    if (!window.getTgHumanizeEnabled()) return templatedMsg;
    if (typeof window.resolveAIEndpoint !== 'function' || !window.resolveAIEndpoint().ok) return templatedMsg;
    if (typeof window.callAIEngine !== 'function') return templatedMsg;
    // Lucuti tag HTML supaya AI menerima teks fakta yang bersih, bukan markup.
    const plainFacts = String(templatedMsg)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
    if (!plainFacts) return templatedMsg;
    const prompt = `Tulis ulang notifikasi berikut jadi 1-3 kalimat pendek berbahasa Indonesia yang santai dan enak dibaca, seperti pesan singkat dari asisten pribadi ke pemiliknya -- BUKAN gaya laporan/template sistem.

ATURAN KETAT (wajib dipatuhi):
- JANGAN mengubah, membulatkan, atau mengarang angka/nominal/tanggal/nama apa pun -- salin persis apa adanya dari data di bawah.
- JANGAN menambahkan informasi yang tidak ada di data.
- JANGAN pakai markdown atau HTML (tanpa **, tanpa tag <b>, maksimal 1 emoji kalau memang pas).
- Balas HANYA kalimat hasil tulis ulangnya saja, tanpa embel-embel seperti "Berikut adalah" atau tanda kutip pembuka/penutup.

DATA (fakta ini harus tetap akurat & lengkap di hasil tulisan):
${plainFacts}`;
    try {
        const { text } = await window.callAIEngine(prompt);
        const cleaned = (text || '').trim();
        // Guard minimal: hasil kosong/terlalu pendek kemungkinan respons error
        // atau tidak masuk akal -- lebih aman fallback ke template asli
        // daripada mengirim sesuatu yang mencurigakan ke Telegram.
        if (!cleaned || cleaned.length < 5) return templatedMsg;
        // [KEAMANAN] Escape entity HTML pada hasil AI -- jaga-jaga kalau AI
        // kebetulan menulis literal '<'/'>'/'&' (mis. "kurang dari 500rb"),
        // supaya tidak dibaca sebagai tag HTML yang salah/rusak oleh Telegram
        // saat dikirim dengan parse_mode HTML (lihat window.sendTelegramNotif).
        return window.escapeHtml ? window.escapeHtml(cleaned) : cleaned;
    } catch (e) {
        window.skWarn('[Telegram] Gagal humanize teks notifikasi, pakai template asli:', e.message);
        return templatedMsg;
    }
};

window.sendTelegramNotif = async function(msg) {
    let cfg = await window.getTgConfig();
    if (!cfg.active) return;
    // Lihat window._humanizeTelegramText di atas -- best-effort, aman fallback.
    const finalMsg = await window._humanizeTelegramText(msg);
    try {
        if (cfg.edgeUrl) {
            const body = { message: finalMsg };
            if (cfg.chatId) body.chat_id = cfg.chatId;
            const res = await fetch(cfg.edgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.getSupabaseKey()}` },
                body: JSON.stringify(body)
            });
            if (!res.ok) window.skWarn('[Telegram] Edge Function error:', await res.text());
        } else if (cfg.token && cfg.chatId) {
            const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: cfg.chatId, text: finalMsg, parse_mode: 'HTML' })
            });
            const data = await res.json();
            if (!data.ok) window.skWarn('[Telegram] Gagal kirim:', data.description);
        }
    } catch(e) {
        window.skWarn('[Telegram] Gagal kirim notifikasi:', e.message);
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
    statusEl.innerHTML = '<span style="color:#9C7A2E;">Mengirim pesan tes...</span>';
    const testMsg = `<b>Sinarkeu — Tes Notifikasi</b>\n\nKonfigurasi berhasil! Notifikasi transaksi akan dikirim ke sini.\n\n<i>Chat ID: ${chatId}</i>`;
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
                statusEl.innerHTML = '<span style="color:#1F5138;">Berhasil via Edge Function!</span>';
                window.showToast('Tes Telegram berhasil! ', 'success');
            } else {
                statusEl.innerHTML = `<span style="color:#A13A3A;">Gagal: ${window.escapeHtml(data.error || JSON.stringify(data))}</span>`;
            }
        } else {
            res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: testMsg, parse_mode: 'HTML' })
            });
            data = await res.json();
            if (data.ok) {
                statusEl.innerHTML = '<span style="color:#1F5138;">Berhasil! Cek Telegram kamu.</span>';
                window.showToast('Tes Telegram berhasil! ', 'success');
            } else {
                let errMsg = data.description || JSON.stringify(data);
                if (errMsg.includes('chat not found')) errMsg = 'Chat ID tidak ditemukan. Pastikan bot sudah di-/start atau ditambah ke grup.';
                if (errMsg.includes('Unauthorized')) errMsg = 'Bot Token tidak valid. Cek kembali dari @BotFather.';
                statusEl.innerHTML = `<span style="color:#A13A3A;">${window.escapeHtml(errMsg)}</span>`;
            }
        }
    } catch(e) {
        statusEl.innerHTML = `<span style="color:#A13A3A;">Error jaringan: ${window.escapeHtml(e.message)}</span>`;
    }
};

window.buildTxNotifMessage = function(action, tx, bookName) {
    let typeLabel = tx.type === 'income' ? 'PEMASUKAN' : 'PENGELUARAN';
    let actionLabel = action === 'TAMBAH' ? 'Transaksi Baru' : action === 'UBAH' ? 'Transaksi Diubah' : 'Transaksi Dihapus';
    let totalInc = 0, totalExp = 0;
    window.txs.forEach(t => {
        let amt = Number(t.amount) || 0;
        if (t.type === 'income') totalInc += amt;
        else totalExp += amt;
    });
    // Catatan: untuk aksi HAPUS, confirmDelete() sudah menghapus transaksi dari
    // window.txs SEBELUM memanggil fungsi ini, sehingga saldo di atas sudah
    // mencerminkan kondisi setelah penghapusan — koreksi manual tidak diperlukan.
    // [BUG FIX] window.txs hanya menyimpan MAX_LOCAL_TXS transaksi terakhir
    // (lihat trimAndSaveLocal) — transaksi lama yang sudah di-trim harus
    // dikompensasi lewat balanceOffset, sama seperti render.js/ai.js/forecast.js.
    // Tanpa ini, saldo yang dikirim ke Telegram beda dari yang tampil di dashboard
    // untuk buku dengan >1000 transaksi.
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    let saldoSekarang = totalInc - totalExp + balanceOffset;
    return `<b>${actionLabel}</b>\n━━━━━━━━━━━━━━━━━━\nBuku: <b>${bookName}</b>\nJenis: ${typeLabel}${tx.category ? ' · <i>' + tx.category + '</i>' : ''}\nCatatan: ${tx.description}\nJumlah: <b>${window.rp(tx.amount)}</b>\nWaktu: ${window.formatDateTime(tx.date)}\n━━━━━━━━━━━━━━━━━━\nSaldo Saat Ini: <b>${window.rp(saldoSekarang)}</b>`;
};

window.getCurrentBookName = function() {
    let book = window.books.find(b => b.id === window.currentBookId);
    return book ? book.name : window.currentBookId;
};

window.sendDailySummaryToTelegram = async function() {
    // [FIX RACE CONDITION] Lihat catatan di js/app.js (startAutoSync) --
    // window.globalSupabaseUrl/Key bisa sementara menunjuk ke backend akun
    // baru yang sedang diuji lewat Manajer Akun.
    if (window._acctCredTestLock) return;
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
        let d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date);
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
    // [BUG FIX] sama seperti buildTxNotifMessage — tambahkan balanceOffset agar
    // saldo total konsisten dengan dashboard untuk buku dengan >1000 transaksi.
    const balanceOffset = Number(localStorage.getItem('sk_balance_offset_' + window.currentBookId)) || 0;
    let saldo = totalInc - totalExp + balanceOffset;
    let msg = `<b>Ringkasan Harian Sinarkeu</b>\n${today}\nBuku: <b>${window.getCurrentBookName()}</b>\n━━━━━━━━━━━━━━━━━━\n<b>Hari Ini:</b>\nMasuk: ${window.rp(incToday)}\nKeluar: ${window.rp(expToday)}\nSelisih: ${window.rp(incToday - expToday)}\n\n<b>Bulan ${monthNames[m - 1]} ${y}:</b>\nPemasukan: ${window.rp(incBulan)}\nPengeluaran: ${window.rp(expBulan)}\nSelisih: ${window.rp(incBulan - expBulan)}\n━━━━━━━━━━━━━━━━━━\n<b>Saldo Total: ${window.rp(saldo)}</b>`;
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
    window.skLog(`[Telegram] Ringkasan harian dijadwalkan pukul 21:00`);
};