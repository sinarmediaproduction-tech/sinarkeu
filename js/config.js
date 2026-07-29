// ==================== CONSTANTS ====================
window.CRYPTO_SALT_KEY  = 'sk_crypto_salt';
window.CRYPTO_CHECK_KEY = 'sk_crypto_check';
window.CRYPTO_URL_KEY   = 'sk_enc_supabase_url';
window.CRYPTO_AKEY_KEY  = 'sk_enc_supabase_key';
window.SENTINEL_PLAIN   = 'sinarkeu_ok';
window.MAX_LOCAL_TXS    = 1000;

window.ACC_LIST_KEY   = 'sk_accounts';
window.ACC_ACTIVE_KEY = 'sk_active_account';
window.ACC_GLOBAL_KEYS = new Set(['sk_accounts', 'sk_active_account', 'sk_device_id']);

window.EXPENSE_CATEGORIES = [
    'Jajan', 'Tagihan Bulanan', 'Belanja Harian', 'Kesehatan',
    'Hiburan', 'Pendidikan', 'Transport', 'Investasi',
    'Perawatan Tubuh', 'Bumbu Dapur', 'Kebersihan Rumah', 'Iuran Warga',
    'Pertanian', 'Sedekah', 'Sumbangan', 'Pulsa', 'Pakan Peliharaan',
    'Kosmetik', 'Token Listrik', 'Gas Melon', 'Internet'
];
// Warna per kategori -- dipakai badge kategori di Daftar Belanja (js/shopping-list.js)
// supaya tiap kategori punya warna sendiri yang konsisten dan gampang dibedakan
// sekilas. Sengaja MEREUSE palet yang sama dengan grafik pengeluaran
// (window._EXPENSE_CHART_COLORS, didefinisikan di js/expense-chart.js) via index
// posisi nama kategori di EXPENSE_CATEGORIES -- bukan urutan label di grafik --
// supaya satu kategori selalu dapat warna yang sama di mana pun ditampilkan,
// tidak berubah-ubah tergantung urutan kemunculan di chart bulan itu.
// Aman dipanggil walau expense-chart.js belum sempat load lebih dulu, karena
// fungsi ini baru benar-benar butuh window._EXPENSE_CHART_COLORS saat DIPANGGIL
// (saat render), bukan saat didefinisikan -- dan render selalu terjadi belakangan,
// setelah semua script defer selesai jalan.
window.getCategoryColor = function(categoryName) {
    const palette = window._EXPENSE_CHART_COLORS;
    if (!categoryName || !palette || !palette.length) return null;
    const idx = window.EXPENSE_CATEGORIES.indexOf(categoryName);
    if (idx === -1) return null;
    return palette[idx % palette.length];
};

// Peta nama kategori LAMA -> BARU (2026-07-28, rombak Anggaran Dasar).
// Dipakai window.migrateBudgetCategoryKeys() supaya anggaran yang sudah
// tersimpan dengan nama kategori lama tetap "ketemu" nilainya di bawah
// nama baru, bukannya kelihatan kosong. Ini HANYA memigrasikan data
// ANGGARAN (settings) — transaksi lama yang sudah tercatat dengan nama
// kategori lama tetap memakai nama lama itu di riwayat & laporan.
window.CATEGORY_RENAME_MAP = {
    'Tagihan': 'Tagihan Bulanan',
    'Belanja': 'Belanja Harian',
    'Transportasi': 'Transport',
    'Skin & Body Care': 'Perawatan Tubuh',
    'Kitchen': 'Bumbu Dapur',
    'Cleaning': 'Kebersihan Rumah',
    'Pajak & Iuran': 'Iuran Warga',
    'Makanan & Minuman': 'Jajan'
};
window.migrateBudgetCategoryKeys = function(budgetObj) {
    if (!budgetObj || typeof budgetObj !== 'object') return budgetObj;
    const result = { ...budgetObj };
    Object.keys(window.CATEGORY_RENAME_MAP).forEach(oldName => {
        if (Object.prototype.hasOwnProperty.call(result, oldName)) {
            const newName = window.CATEGORY_RENAME_MAP[oldName];
            const oldVal = Number(result[oldName]) || 0;
            const newVal = Number(result[newName]) || 0;
            result[newName] = oldVal + newVal;
            delete result[oldName];
        }
    });
    return result;
};
window.INCOME_CATEGORIES = [
    'Gaji', 'Freelance', 'Bonus', 'THR',
    'Hasil Investasi', 'Jual Aset', 'Hadiah',
    'Penjualan', 'Jasa', 'Uang Muka', 'Pelunasan Piutang', 'Komisi',
    'Pinjaman Diterima', 'Pengembalian Dana', 'Subsidi & Bantuan',
    'Lainnya'
];
window.PAGE_SIZE = 21;

// ==================== LAZY-LOADED LIBRARIES ====================
// [PERF] chart.js & html2pdf.js sebelumnya dimuat lewat <script defer> statis
// di <head>, jadi ikut di-download & dieksekusi di SETIAP kali app dibuka,
// walau baru benar-benar dipakai saat user buka grafik pengeluaran / export
// PDF laporan. Sekarang keduanya dimuat on-demand lewat loadScriptOnce().
window.CHART_JS_URL    = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
window.HTML2PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

window._scriptLoadPromises = {};
// Memuat <script src="url"> sekali saja (cache promise per-URL) -- aman
// dipanggil berkali-kali dari beberapa tempat tanpa duplikat request.
window.loadScriptOnce = function(url) {
    if (window._scriptLoadPromises[url]) return window._scriptLoadPromises[url];
    window._scriptLoadPromises[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => {
            delete window._scriptLoadPromises[url];
            reject(new Error('Gagal memuat skrip: ' + url));
        };
        document.head.appendChild(s);
    });
    return window._scriptLoadPromises[url];
};

// ==================== GLOBAL VARIABLES (shared) ====================
window.txs = [];
window.books = [];
window.currentBookId = 'b_default';
window.globalSupabaseUrl = '';
window.globalSupabaseKey = '';
window.budgets = {};
window.currentFilter = 'all';
window.filterStartDate = '';
window.filterEndDate = '';
window.actionId = null;
window.deviceId = '';
window.currentAttachmentData = null;
window.currentAttachmentFile = null;
window.reportChart = null;
window.expenseChart = null;
window.expenseChartMode = 'all';
window.expenseChartVisible = false;
window._expenseChartInitialized = false;
window._lastBalance = 0;
window.currentPage = 1;
window._lastSyncTime = null;
window._syncInterval = null;
window._pushDebounceTimer = null;
window._lastFullSyncTime = {};
