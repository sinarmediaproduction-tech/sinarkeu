// ==================== LOCKSCREEN INSIGHT ====================
// Kisi-kisi singkat + nasihat + motivasi keuangan yang tampil OTOMATIS di
// layar kunci (#passwordLockScreen), dihitung dari SEMUA buku (bukan cuma
// buku aktif) -- bukan cuma satu buku dan bukan cuma saat modal "Analisis
// AI" dibuka manual seperti js/ai.js.
//
// Kenapa aman ditampilkan SEBELUM password dimasukkan:
//   Cache transaksi (`sk_txs_<bookId>`) & daftar buku (`sk_books`) milik akun
//   yang sedang aktif SUDAH tersimpan plaintext di localStorage begitu akun
//   itu dipilih di layar kunci (lihat window._restoreInAccount di
//   account.js) -- password cuma menggerbangi TAMPILAN/UI dan mendekripsi
//   kredensial Supabase, bukan mengenkripsi cache transaksi lokal itu
//   sendiri. Fitur ini tidak membuka akses baru ke data yang sebelumnya
//   tidak terjangkau; ia cuma menampilkan RINGKASAN KUALITATIF (bukan
//   nominal Rupiah presisi, bukan daftar transaksi) supaya tetap sopan
//   dilihat orang yang cuma lewat di depan layar terkunci.
//
// Dua lapis, keduanya bisa dimatikan lewat Setelan -> Analisis AI:
//   1. LOKAL (default ON) -- selalu instan & offline, status kualitatif +
//      nasihat template + kutipan motivasi harian. TIDAK pernah menyebut
//      angka Rupiah.
//   2. AI (default OFF, opt-in) -- kalau diaktifkan DAN Worker URL (dipakai
//      bersama js/ai.js) sudah diisi, kirim RINGKASAN TERAGREGASI (rasio %,
//      tren %, nama kategori terbesar -- bukan transaksi mentah) ke worker
//      untuk kalimat yang lebih personal. Hasilnya di-cache 6 jam supaya
//      tidak nge-hit worker tiap kali layar kunci muncul (autolock default
//      5 menit, lihat js/autolock.js -- kalau tiap unlock/lock manggil AI,
//      itu boros kuota worker).

(function () {
    'use strict';

    const TOGGLE_KEY      = 'sk_lockscreen_insight_enabled'; // tampil/tidaknya kartu sama sekali
    const AI_TOGGLE_KEY   = 'sk_lockscreen_ai_enabled';      // lapis AI (opt-in, default OFF)
    const AI_CACHE_KEY    = 'sk_lockscreen_ai_cache';
    const AI_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam

    const MOTIVASI = [
        'Sedikit demi sedikit, lama-lama jadi bukit.',
        'Uang yang dikelola dengan sabar akan bekerja untuk Anda, bukan sebaliknya.',
        'Anggaran bukan pembatas, tapi peta supaya sampai ke tujuan.',
        'Konsisten mencatat itu sendiri sudah separuh jalan menuju sehat finansial.',
        'Dana darurat adalah pelukan Anda ke diri sendiri di masa depan.',
        'Setiap pengeluaran yang dicatat adalah keputusan yang lebih sadar.',
        'Menabung sedikit tapi rutin mengalahkan menabung banyak tapi jarang.',
        'Keuangan sehat bukan soal berapa banyak, tapi seberapa terkendali.',
        'Hari ini adalah waktu terbaik untuk menata ulang prioritas belanja.',
        'Kebiasaan kecil hari ini menentukan kelonggaran finansial tahun depan.',
        'Progres kecil tetap progres -- jangan berkecil hati kalau belum sempurna.',
        'Rencana keuangan terbaik adalah yang benar-benar Anda jalankan.',
    ];

    function _isEnabled() {
        const v = localStorage.getItem(TOGGLE_KEY);
        return v === null ? true : v === '1'; // default ON (kualitatif, tanpa nominal)
    }
    function _isAiEnabled() {
        return localStorage.getItem(AI_TOGGLE_KEY) === '1'; // default OFF
    }

    // ── Kumpulkan ringkasan SEMUA buku dari cache lokal, tanpa switch buku ──
    function _collectAllBooksSnapshot() {
        const books = Array.isArray(window.books) ? window.books : [];
        const now = new Date();
        const curM = now.getMonth(), curY = now.getFullYear();
        const lmDate = new Date(curY, curM - 1, 1);
        const lastM = lmDate.getMonth(), lastY = lmDate.getFullYear();

        let incomeThis = 0, expenseThis = 0, expenseLast = 0, txCount = 0;
        const catMap = {};

        books.forEach(function (b) {
            let raw;
            try { raw = JSON.parse(localStorage.getItem('sk_txs_' + b.id) || '[]'); } catch (e) { raw = []; }
            if (!Array.isArray(raw)) return;
            txCount += raw.length;
            raw.forEach(function (t) {
                let d;
                try { d = window.parseTxDate ? window.parseTxDate(t.date) : new Date(t.date); } catch (e) { d = null; }
                if (!d || isNaN(d.getTime())) return;
                const amt = Number(t.amount) || 0;
                const isThis = d.getMonth() === curM && d.getFullYear() === curY;
                const isLast = d.getMonth() === lastM && d.getFullYear() === lastY;
                if (t.type === 'income') {
                    if (isThis) incomeThis += amt;
                } else {
                    if (isThis) {
                        expenseThis += amt;
                        const cat = t.category || 'Lain-lain';
                        catMap[cat] = (catMap[cat] || 0) + amt;
                    }
                    if (isLast) expenseLast += amt;
                }
            });
        });

        let topCategory = null, topAmt = 0;
        Object.keys(catMap).forEach(function (c) { if (catMap[c] > topAmt) { topAmt = catMap[c]; topCategory = c; } });

        const savingsRate     = incomeThis > 0 ? (incomeThis - expenseThis) / incomeThis : null;
        const expenseTrendPct = expenseLast > 0 ? ((expenseThis - expenseLast) / expenseLast) * 100 : null;

        return { bookCount: books.length, txCount: txCount, savingsRate: savingsRate, expenseTrendPct: expenseTrendPct, topCategory: topCategory };
    }

    // ── Status kualitatif (tidak pernah menyebut nominal) ────────────────────
    function _deriveStatus(snap) {
        if (snap.txCount === 0) {
            return {
                tier: 'kosong', label: 'Belum Ada Data', color: 'neutral',
                kisi: 'Belum ada transaksi tercatat di buku manapun.',
                nasihat: 'Mulai catat transaksi pertama setelah masuk, supaya SinarKeu bisa membantu memantau kondisi keuangan Anda.'
            };
        }
        if (snap.savingsRate === null) {
            return {
                tier: 'tanpa-pemasukan', label: 'Perlu Perhatian', color: 'warning',
                kisi: 'Belum ada pemasukan tercatat bulan ini, sementara pengeluaran tetap berjalan.',
                nasihat: 'Cek lagi apakah semua pemasukan bulan ini sudah tercatat, atau mulai susun rencana pemasukan baru.'
            };
        }
        if (snap.savingsRate < 0) {
            return {
                tier: 'defisit', label: 'Perlu Perhatian', color: 'danger',
                kisi: 'Pengeluaran bulan ini melebihi pemasukan.',
                nasihat: snap.topCategory
                    ? `Coba tinjau ulang pos "${snap.topCategory}" — porsinya paling besar bulan ini.`
                    : 'Coba tinjau ulang kembali pos pengeluaran terbesar bulan ini.'
            };
        }
        if (snap.savingsRate < 0.15) {
            return {
                tier: 'tipis', label: 'Cukup Stabil', color: 'info',
                kisi: 'Pemasukan masih menutup pengeluaran, tapi sisanya masih tipis.',
                nasihat: 'Coba sisihkan sedikit lebih banyak di awal bulan, sebelum terpakai untuk hal lain.'
            };
        }
        return {
            tier: 'sehat', label: 'Kondisi Sehat', color: 'success',
            kisi: 'Pemasukan bulan ini cukup jauh melebihi pengeluaran.',
            nasihat: 'Pertahankan ritme ini — pertimbangkan alihkan sisa dana ke tabungan atau dana darurat.'
        };
    }

    function _pickMotivasi() {
        const startOfYear = new Date(new Date().getFullYear(), 0, 0);
        const dayOfYear = Math.floor((Date.now() - startOfYear.getTime()) / 86400000);
        return MOTIVASI[((dayOfYear % MOTIVASI.length) + MOTIVASI.length) % MOTIVASI.length];
    }

    function _statusFingerprint(status, snap) {
        return [status.tier, snap.bookCount, Math.round(snap.expenseTrendPct || 0), snap.topCategory || ''].join('|');
    }

    // ── Render kartu di layar kunci ───────────────────────────────────────────
    function _ensureCardEl() {
        let el = document.getElementById('lockAIInsight');
        if (el) return el;
        const title = document.getElementById('lockGreetingTitle');
        if (!title || !title.parentNode) return null;
        el = document.createElement('div');
        el.id = 'lockAIInsight';
        el.className = 'lock-insight-card';
        title.parentNode.insertBefore(el, title.nextSibling);
        return el;
    }

    function _renderCard(status, opts) {
        opts = opts || {};
        const el = _ensureCardEl();
        if (!el) return;
        const badgeClass = 'lock-insight-badge lock-insight-badge--' + status.color;
        const aiTag = opts.fromAI ? '<span class="lock-insight-ai-tag" title="Dibantu Analisis AI">AI</span>' : '';
        const bodyText = opts.text || (status.kisi + ' ' + status.nasihat);
        const motivasiText = opts.fromAI ? '' : `<div class="lock-insight-motivasi">&ldquo;${window.escapeHtml(_pickMotivasi())}&rdquo;</div>`;
        el.innerHTML =
            '<div class="lock-insight-head">' +
                '<span class="' + badgeClass + '">' + window.escapeHtml(status.label) + '</span>' +
                aiTag +
            '</div>' +
            '<div class="lock-insight-body">' + window.escapeHtml(bodyText) + '</div>' +
            motivasiText;
    }

    // ── Prompt ringkas ke worker AI (statistik teragregasi, bukan data mentah) ──
    function _buildAiPrompt(status, snap) {
        const trend = snap.expenseTrendPct === null
            ? 'tidak ada pembanding bulan lalu'
            : (snap.expenseTrendPct >= 0 ? `naik sekitar ${Math.round(snap.expenseTrendPct)}%` : `turun sekitar ${Math.round(Math.abs(snap.expenseTrendPct))}%`);
        const rate = snap.savingsRate === null ? 'tidak diketahui' : `${Math.round(snap.savingsRate * 100)}%`;
        return `Kamu adalah asisten keuangan yang hangat dan ringkas. Buat SATU paragraf pendek (maksimal 45 kata, Bahasa Indonesia) untuk ditampilkan di layar kunci aplikasi keuangan pribadi, berisi kisi-kisi kondisi keuangan, satu nasihat singkat, dan satu kalimat motivasi -- digabung mengalir dalam satu paragraf.

Status keuangan gabungan dari ${snap.bookCount} buku: ${status.label}
Perkiraan rasio sisa pemasukan bulan ini: ${rate}
Tren pengeluaran dibanding bulan lalu: ${trend}
Kategori pengeluaran terbesar bulan ini: ${snap.topCategory || 'tidak ada data'}

ATURAN: Jangan menyebut angka Rupiah spesifik apa pun (tidak ada data itu, hanya persentase di atas). Maksimal 1 emoji. Tanpa heading atau poin-poin, langsung satu paragraf singkat.`;
    }

    async function _tryAiEnhance(status, snap) {
        if (!_isAiEnabled()) return;
        const workerUrl = (localStorage.getItem('sk_ai_worker_url') || '').trim();
        if (!workerUrl) return;

        const fp = _statusFingerprint(status, snap);
        let cache = null;
        try { cache = JSON.parse(localStorage.getItem(AI_CACHE_KEY) || 'null'); } catch (e) { cache = null; }
        if (cache && cache.fp === fp && cache.text && (Date.now() - cache.ts) < AI_CACHE_TTL_MS) {
            _renderCard(status, { fromAI: true, text: cache.text });
            return;
        }

        try {
            const prompt = _buildAiPrompt(status, snap);
            const res = await fetch(workerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: prompt }) });
            const json = await res.json();
            const text = ((json && json.result) || '').trim();
            if (!res.ok || !text) return;
            localStorage.setItem(AI_CACHE_KEY, JSON.stringify({ fp: fp, ts: Date.now(), text: text }));
            // Cuma timpa tampilan kalau layar kunci masih tampil (hindari nimpa
            // layar lain kalau user sudah keburu login sebelum fetch selesai).
            const lockScreen = document.getElementById('passwordLockScreen');
            if (lockScreen && lockScreen.style.display !== 'none') {
                _renderCard(status, { fromAI: true, text: text });
            }
        } catch (e) {
            if (window.skLog) window.skLog('[LockInsight] AI gagal, tetap pakai versi lokal: ' + e.message);
        }
    }

    // ── Entry point -- dipanggil tiap kali layar kunci ditampilkan ──────────
    window.renderLockScreenInsight = function () {
        if (!_isEnabled()) {
            const el = document.getElementById('lockAIInsight');
            if (el) el.remove();
            return;
        }
        try {
            const snap = _collectAllBooksSnapshot();
            const status = _deriveStatus(snap);
            _renderCard(status);       // instan, lokal, offline, tanpa nominal
            _tryAiEnhance(status, snap); // best-effort di belakang layar, opsional
        } catch (e) {
            if (window.skLog) window.skLog('[LockInsight] Gagal render: ' + e.message);
        }
    };

    // ── Toggle publik, dipanggil dari Setelan -> Analisis AI ─────────────────
    window.setLockscreenInsightEnabled = function (on) {
        localStorage.setItem(TOGGLE_KEY, on ? '1' : '0');
        if (typeof window.renderLockScreenInsight === 'function') window.renderLockScreenInsight();
    };
    window.setLockscreenAiEnabled = function (on) {
        localStorage.setItem(AI_TOGGLE_KEY, on ? '1' : '0');
        if (on && !(localStorage.getItem('sk_ai_worker_url') || '').trim()) {
            if (window.showToast) window.showToast('Isi dulu Worker URL di atas supaya AI di layar kunci bisa aktif.', 'error');
        }
        if (typeof window.renderLockScreenInsight === 'function') window.renderLockScreenInsight();
    };

    // ── Hook otomatis: setiap renderLockScreenPicker() jalan (tampil pertama
    // kali, setelah autolock, ganti akun, dst -- lihat account.js/app.js),
    // ikut render kartu insight ini. Pola monkey-patch ini konsisten dengan
    // yang sudah dipakai di js/auth.js untuk fungsi lain.
    const _originalRenderLockScreenPicker = window.renderLockScreenPicker;
    window.renderLockScreenPicker = function () {
        if (typeof _originalRenderLockScreenPicker === 'function') _originalRenderLockScreenPicker.apply(this, arguments);
        window.renderLockScreenInsight();
    };
})();
