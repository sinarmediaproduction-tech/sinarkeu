// ==================== CONSTANTS ====================
window.CRYPTO_SALT_KEY  = 'sk_crypto_salt';
window.CRYPTO_CHECK_KEY = 'sk_crypto_check';
window.CRYPTO_URL_KEY   = 'sk_enc_supabase_url';
window.CRYPTO_AKEY_KEY  = 'sk_enc_supabase_key';
window.SENTINEL_PLAIN   = 'sinarkeu_ok';
window.MAX_LOCAL_TXS    = 300;

window.ACC_LIST_KEY   = 'sk_accounts';
window.ACC_ACTIVE_KEY = 'sk_active_account';
window.ACC_GLOBAL_KEYS = new Set(['sk_accounts', 'sk_active_account', 'sk_device_id']);

window.EXPENSE_CATEGORIES = [
    'Makanan & Minuman', 'Tagihan', 'Belanja', 'Kesehatan', 
    'Hiburan', 'Pendidikan', 'Transportasi', 'Investasi', 
    'Skin & Body Care', 'Kitchen', 'Cleaning', 'Pajak & Iuran', 
    'Pertanian', 'Sedekah', 'Sumbangan', 'Pulsa', 'Pakan Peliharaan'
];
window.INCOME_CATEGORIES = [
    'Gaji', 'Freelance', 'Bonus', 'THR',
    'Hasil Investasi', 'Jual Aset', 'Hadiah',
    'Penjualan', 'Jasa', 'Uang Muka', 'Pelunasan Piutang', 'Komisi',
    'Pinjaman Diterima', 'Pengembalian Dana', 'Subsidi & Bantuan',
    'Lainnya'
];
window.PAGE_SIZE = 21;

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
