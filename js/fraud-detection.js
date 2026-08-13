// ==================== DETEKSI FRAUD / ANOMALI ====================
// Modul ini TIDAK PERNAH memblokir simpan transaksi -- semua deteksi
// bersifat PERINGATAN pasca-simpan, supaya pencatatan harian yang harus
// cepat (termasuk saat offline) tetap tidak terganggu. Ini murni alat
// bantu REVIEW, bukan validasi wajib.
//
// Dua kategori deteksi:
//  1) ANOMALI TRANSAKSI PRIBADI -- dihitung dari window.txs (lokal, sudah
//     terdekripsi di device ini): nominal jauh di luar kebiasaan kategori,
//     kemungkinan duplikat, tambah beruntun mencurigakan, nominal edit
//     melonjak drastis dari nilai asal.
//  2) AKTIVITAS MENCURIGAKAN ANGGOTA BUKU BERSAMA -- dihitung dari
//     audit_logs (action TAMBAH/UBAH/HAPUS + device_id): device yang
//     menghapus/mengedit transaksi BUKAN buatannya sendiri, atau satu
//     device menghapus banyak transaksi dalam waktu singkat.
//
// SEMUA cek jalan di sisi klien atas data yang SUDAH terdekripsi -- modul
// ini tidak pernah mengirim apa pun ke server selain query GET audit_logs
// yang memang sudah ada. Hasil (flag aktif, yang sudah di-"Abaikan") murni
// disimpan per-buku di localStorage, TIDAK disinkron ke cloud/device lain.

// ---------- Parameter (boleh disetel kalau terlalu sensitif/longgar) ----------
window.FRAUD_MIN_CATEGORY_SAMPLES = 5;    // min. transaksi historis di kategori sebelum cek outlier statistik aktif
window.FRAUD_OUTLIER_STDEV = 3;           // berapa kali stdev di atas rata-rata dianggap outlier
window.FRAUD_OUTLIER_MULTIPLIER = 5;      // fallback kalau sample kategori masih sedikit: berapa kali rata-rata dianggap outlier
window.FRAUD_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;    // 10 menit
window.FRAUD_BURST_WINDOW_MS = 5 * 60 * 1000;         // 5 menit
window.FRAUD_BURST_COUNT = 5;                          // >5 transaksi baru dlm jendela burst = janggal
window.FRAUD_EDIT_JUMP_MULTIPLIER = 3;                 // nominal edit naik >3x dari asal dianggap janggal
window.FRAUD_MASS_DELETE_WINDOW_MS = 60 * 60 * 1000;   // 1 jam
window.FRAUD_MASS_DELETE_COUNT = 5;                    // >=5 hapus oleh 1 device dlm jendela ini = janggal
window.FRAUD_CLOUD_LOG_CACHE_MS = 5 * 60 * 1000;       // seberapa sering log cloud diambil ulang utk cek anggota

// ==================== 1) ANOMALI TRANSAKSI PRIBADI ====================

// Statistik nominal per kategori (dipakai utk deteksi outlier). `txs` idealnya
// tidak menyertakan transaksi yang sedang dicek sendiri (lihat pemanggilan).
window.computeCategoryStats = function(txs, type) {
    const byCat = {};
    (txs || []).forEach(t => {
        if (t.type !== type) return;
        const amt = Number(t.amount) || 0;
        if (amt <= 0) return;
        if (!byCat[t.category]) byCat[t.category] = [];
        byCat[t.category].push(amt);
    });
    const stats = {};
    Object.keys(byCat).forEach(cat => {
        const arr = byCat[cat];
        const n = arr.length;
        const mean = arr.reduce((a, b) => a + b, 0) / n;
        const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
        stats[cat] = { n, mean, std: Math.sqrt(variance) };
    });
    return stats;
};

// Cek satu transaksi (baru/sudah ada) terhadap kumpulan transaksi lain di
// buku yang sama. `excludeId` dipakai supaya transaksi itu sendiri tidak
// ikut dihitung sbg pembanding/duplikat dirinya sendiri saat pemindaian
// ulang seluruh window.txs (lihat runPersonalFraudScan).
window.checkTransactionAnomaly = function(tx, allTxs, excludeId) {
    const flags = [];
    if (!tx || !window.parseTxDate) return flags;
    const others = (allTxs || []).filter(t => t.id !== (excludeId != null ? excludeId : tx.id));
    const amt = Number(tx.amount) || 0;
    const txTime = window.parseTxDate(tx.date).getTime();

    // -- Outlier nominal vs kebiasaan kategori --
    const stats = window.computeCategoryStats(others, tx.type);
    const s = stats[tx.category];
    if (s && amt > 0) {
        const isStatOutlier = s.n >= window.FRAUD_MIN_CATEGORY_SAMPLES && s.std > 0 &&
            amt > s.mean + window.FRAUD_OUTLIER_STDEV * s.std;
        const isRatioOutlier = s.n < window.FRAUD_MIN_CATEGORY_SAMPLES && s.mean > 0 &&
            amt > s.mean * window.FRAUD_OUTLIER_MULTIPLIER;
        if (isStatOutlier || isRatioOutlier) {
            flags.push({
                code: 'AMOUNT_OUTLIER', level: 'warning',
                message: `Nominal ${window.rp(amt)} jauh di atas kebiasaan kategori "${tx.category}" (rata-rata sekitar ${window.rp(Math.round(s.mean))}).`
            });
        }
    }

    // -- Kemungkinan duplikat: tipe+kategori+nominal+deskripsi sama, dalam jendela waktu pendek --
    const dup = others.find(t => {
        if (t.type !== tx.type || t.category !== tx.category) return false;
        if ((Number(t.amount) || 0) !== amt) return false;
        if ((t.description || '').trim() !== (tx.description || '').trim()) return false;
        const dt = Math.abs(window.parseTxDate(t.date).getTime() - txTime);
        return dt <= window.FRAUD_DUPLICATE_WINDOW_MS;
    });
    if (dup) {
        flags.push({
            code: 'DUPLICATE_SUSPECTED', level: 'warning',
            message: `Kemungkinan transaksi duplikat -- ada transaksi lain dengan kategori, nominal & deskripsi yang sama dalam rentang ${Math.round(window.FRAUD_DUPLICATE_WINDOW_MS / 60000)} menit.`
        });
    }

    // -- Burst: terlalu banyak transaksi baru dalam waktu singkat --
    if (!isNaN(txTime)) {
        const recentCount = others.filter(t => {
            const tt = window.parseTxDate(t.date).getTime();
            return !isNaN(tt) && Math.abs(tt - txTime) <= window.FRAUD_BURST_WINDOW_MS;
        }).length + 1;
        if (recentCount > window.FRAUD_BURST_COUNT) {
            flags.push({
                code: 'RAPID_BURST', level: 'info',
                message: `${recentCount} transaksi tercatat dalam ${Math.round(window.FRAUD_BURST_WINDOW_MS / 60000)} menit -- pastikan semuanya memang sengaja dicatat.`
            });
        }
    }

    return flags;
};

// Dipanggil khusus saat EDIT: membandingkan nominal LAMA vs BARU pada
// transaksi yang sama (lonjakan besar lebih mencurigakan pada edit
// dibanding pada outlier biasa, karena angka aslinya sudah "disetujui"
// sebelumnya lewat proses tambah).
window.checkEditAnomaly = function(oldTx, newTx) {
    const flags = [];
    const oldAmt = Number(oldTx && oldTx.amount) || 0;
    const newAmt = Number(newTx && newTx.amount) || 0;
    if (oldAmt > 0 && newAmt > oldAmt * window.FRAUD_EDIT_JUMP_MULTIPLIER) {
        flags.push({
            code: 'EDIT_AMOUNT_JUMP', level: 'warning',
            message: `Nominal diubah dari ${window.rp(oldAmt)} menjadi ${window.rp(newAmt)} (naik ${(newAmt / oldAmt).toFixed(1)}x). Pastikan perubahan ini memang disengaja.`
        });
    }
    return flags;
};

// Pindai SELURUH window.txs saat ini (bukan cuma transaksi yang baru
// ditambah/diedit) -- supaya data hasil import/restore backup juga ikut
// tercek, bukan cuma transaksi yang lewat form tambah/edit biasa.
window.runPersonalFraudScan = function() {
    const flags = [];
    const txs = window.txs || [];
    txs.forEach(t => {
        const f = window.checkTransactionAnomaly(t, txs, t.id);
        f.forEach(x => flags.push(Object.assign({ tx_id: t.id, timestamp: t.date }, x)));
    });
    return flags;
};

// ==================== 2) AKTIVITAS ANGGOTA BUKU BERSAMA ====================

// Log TAMBAH/UBAH (lihat render.js) menyisipkan penanda "(ID: tx_xxx)" di
// akhir teks detail; log HAPUS memakai format lama "ber-ID: tx_xxx".
// Fungsi ini menangani keduanya supaya bisa menelusuri device PEMBUAT
// sebuah transaksi dari log historisnya.
window.extractTxIdFromLogDetail = function(detail) {
    if (!detail) return null;
    const m = String(detail).match(/(?:\(ID:\s*|ber-ID:\s*)([^)\s]+)\)?/);
    return m ? m[1] : null;
};

// logs: array {action, device_id, details, timestamp} (urutan bebas).
// Mengembalikan flag level-buku (bukan terikat 1 transaksi tunggal saja).
window.analyzeAuditLogsForAbuse = function(logs) {
    const flags = [];
    const sorted = [...(logs || [])]
        .filter(l => l && l.timestamp)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Peta ID transaksi -> device yang PERTAMA membuatnya
    const creatorMap = {};
    sorted.forEach(l => {
        if (l.action !== 'TAMBAH') return;
        const id = window.extractTxIdFromLogDetail(l.details);
        if (id && !creatorMap[id]) creatorMap[id] = l.device_id;
    });

    // Cross-device delete/edit -- lumrah terjadi di buku bersama (memang
    // itu tujuannya dipakai bareng), tapi tetap ditandai supaya kelihatan
    // jelas "siapa mengubah/menghapus punya siapa" untuk ditinjau pemilik buku.
    sorted.forEach(l => {
        if (l.action !== 'HAPUS' && l.action !== 'UBAH') return;
        const id = window.extractTxIdFromLogDetail(l.details);
        const creator = id ? creatorMap[id] : null;
        if (creator && creator !== l.device_id) {
            flags.push({
                code: l.action === 'HAPUS' ? 'CROSS_DEVICE_DELETE' : 'CROSS_DEVICE_EDIT',
                level: l.action === 'HAPUS' ? 'warning' : 'info',
                message: `Device "${l.device_id}" ${l.action === 'HAPUS' ? 'menghapus' : 'mengedit'} transaksi yang dibuat oleh device "${creator}".`,
                timestamp: l.timestamp,
                device_id: l.device_id
            });
        }
    });

    // Mass delete -- 1 device menghapus banyak transaksi dalam waktu singkat
    const deletesByDevice = {};
    sorted.filter(l => l.action === 'HAPUS').forEach(l => {
        (deletesByDevice[l.device_id] = deletesByDevice[l.device_id] || []).push(l);
    });
    Object.keys(deletesByDevice).forEach(dev => {
        const list = deletesByDevice[dev];
        for (let i = 0; i < list.length; i++) {
            const startT = new Date(list[i].timestamp).getTime();
            const endT = startT + window.FRAUD_MASS_DELETE_WINDOW_MS;
            const countInWindow = list.filter(l => {
                const t = new Date(l.timestamp).getTime();
                return t >= startT && t <= endT;
            }).length;
            if (countInWindow >= window.FRAUD_MASS_DELETE_COUNT) {
                flags.push({
                    code: 'MASS_DELETE', level: 'warning',
                    message: `Device "${dev}" menghapus ${countInWindow} transaksi dalam waktu kurang dari ${Math.round(window.FRAUD_MASS_DELETE_WINDOW_MS / 60000)} menit.`,
                    timestamp: list[i].timestamp,
                    device_id: dev
                });
                break; // cukup 1 flag per device supaya tidak duplikat antar-window yang tumpang tindih
            }
        }
    });

    return flags;
};

// ---------- Ambil log cloud (utk cek anggota) secara diam-diam ----------
// Terpisah dari window.refreshLogsFromCloud (render.js) supaya tidak
// mengganggu/menimpa tampilan panel "Log Audit" yang sedang dibuka user --
// fetch ini murni utk kebutuhan analisis, hasilnya di-cache per buku.
window._fraudCloudLogsCache = {}; // bookId -> { logs, fetchedAt }

window._fraudFetchCloudLogs = async function(bookId) {
    if (!window.isOnline() || !window.callSupabaseAPI) return null;
    try {
        const tag = window.getAccountTag ? window.getAccountTag() : null;
        const filter = window.tagOrFilter ? window.tagOrFilter(tag, bookId) : '';
        const logs = await window.callSupabaseAPI('audit_logs', 'GET', null,
            `?book_id=eq.${bookId}&order=timestamp.desc&limit=200${filter}`);
        if (Array.isArray(logs)) {
            window._fraudCloudLogsCache[bookId] = { logs, fetchedAt: Date.now() };
            return logs;
        }
    } catch (e) {
        window.skWarn && window.skWarn('[fraud-detection] Gagal ambil audit_logs:', e);
    }
    return null;
};

// ==================== ORKESTRASI + PERSISTENSI "ABAIKAN" ====================

function _fraudDismissKey(bookId) { return 'sk_fraud_dismissed_' + bookId; }

window._loadDismissedFraudSignatures = function(bookId) {
    try { return JSON.parse(localStorage.getItem(_fraudDismissKey(bookId)) || '[]'); }
    catch (e) { return []; }
};

// Signature stabil per flag, dipakai supaya alert yang sama tidak terus
// muncul lagi setelah user menekan "Abaikan" -- TIDAK termasuk detail yang
// berubah tiap scan (seperti hitungan burst yang bisa naik-turun), cukup
// identitas inti kejadiannya.
window._fraudSignature = function(flag) {
    return [flag.code, flag.device_id || '', flag.tx_id || '', flag.timestamp || ''].join('|');
};

window.dismissFraudAlert = function(signature) {
    const bookId = window.currentBookId;
    if (!bookId) return;
    const arr = window._loadDismissedFraudSignatures(bookId);
    if (!arr.includes(signature)) arr.push(signature);
    if (arr.length > 300) arr.splice(0, arr.length - 300); // jaga localStorage tidak membengkak
    localStorage.setItem(_fraudDismissKey(bookId), JSON.stringify(arr));
    window.refreshFraudAlerts();
};

window._fraudActiveFlags = [];

// Titik masuk utama -- panggil ini setiap kali ada perubahan yang relevan
// (transaksi tambah/edit/hapus, ganti buku, buka app). Aman dipanggil
// berkali-kali (murni baca lokal + cache log cloud, tidak menulis apa pun
// ke cloud).
window.refreshFraudAlerts = async function() {
    const bookId = window.currentBookId;
    if (!bookId) return;

    const personal = window.runPersonalFraudScan();

    const cached = window._fraudCloudLogsCache[bookId];
    let logs = cached ? cached.logs : null;
    const stale = !cached || (Date.now() - cached.fetchedAt > window.FRAUD_CLOUD_LOG_CACHE_MS);
    if (stale && window.isOnline()) {
        // Ambil ulang di background; render ulang begitu hasilnya datang.
        // Tidak di-await supaya banner memakai data lama/lokal dulu (cepat),
        // baru diperbarui begitu fetch selesai.
        window._fraudFetchCloudLogs(bookId).then(fresh => {
            if (fresh && window.currentBookId === bookId) window.refreshFraudAlerts();
        });
    }
    if (!logs) {
        // Fallback: log lokal device ini saja (belum tentu lengkap utk buku
        // bersama, tapi lebih baik daripada kosong sama sekali saat offline).
        try { logs = JSON.parse(localStorage.getItem('sk_logs_' + bookId) || '[]'); }
        catch (e) { logs = []; }
    }
    const memberFlags = window.analyzeAuditLogsForAbuse(logs);

    const dismissed = window._loadDismissedFraudSignatures(bookId);
    const seen = new Set();
    window._fraudActiveFlags = [...personal, ...memberFlags].filter(f => {
        const sig = window._fraudSignature(f);
        if (dismissed.includes(sig) || seen.has(sig)) return false;
        seen.add(sig);
        return true;
    });

    window.renderFraudBanner();
};

// ==================== UI ====================

window.renderFraudBanner = function() {
    const banner = document.getElementById('fraudAlertBanner');
    const textEl = document.getElementById('fraudAlertBannerText');
    if (!banner || !textEl) return;
    const flags = window._fraudActiveFlags || [];
    if (flags.length === 0) { banner.style.display = 'none'; return; }
    const warnCount = flags.filter(f => f.level === 'warning').length;
    textEl.innerText = warnCount > 0
        ? `${flags.length} aktivitas perlu ditinjau (${warnCount} peringatan penting)`
        : `${flags.length} aktivitas perlu ditinjau`;
    banner.style.display = '';
};

window.openFraudAlertModal = function() {
    const list = document.getElementById('fraudAlertList');
    if (list) {
        const flags = window._fraudActiveFlags || [];
        if (flags.length === 0) {
            list.innerHTML = '<div style="font-size:.72rem; color:var(--ink-faint); text-align:center; padding:18px 0;">Tidak ada aktivitas mencurigakan saat ini.</div>';
        } else {
            const sorted = [...flags].sort((a, b) => (b.level === 'warning') - (a.level === 'warning'));
            list.innerHTML = sorted.map(f => {
                const sig = window._fraudSignature(f).replace(/'/g, "\\'");
                const isWarn = f.level === 'warning';
                const badgeColor = isWarn ? '#dc2626' : '#d97706';
                return `<div style="border:1.5px solid var(--ink); border-radius:var(--radius-sm); padding:10px 12px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
                        <span style="font-size:.62rem; font-weight:700; color:#fff; background:${badgeColor}; padding:2px 8px; border-radius:4px; white-space:nowrap;">${isWarn ? 'PERINGATAN' : 'INFO'}</span>
                        <button type="button" style="font-size:.65rem; background:none; border:1px solid var(--rule); border-radius:4px; padding:2px 8px; cursor:pointer; white-space:nowrap;" onclick="window.dismissFraudAlert('${sig}')">Abaikan</button>
                    </div>
                    <div style="font-size:.75rem; margin-top:6px; line-height:1.5;">${window.escapeHtml(f.message)}</div>
                    ${f.timestamp ? `<div style="font-size:.62rem; color:var(--ink-faint); margin-top:4px;">${new Date(f.timestamp).toLocaleString('id-ID')}</div>` : ''}
                </div>`;
            }).join('');
        }
    }
    if (window.openModal) window.openModal('fraudAlertModal');
};
