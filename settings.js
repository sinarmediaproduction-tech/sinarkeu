// ==================== I18N / LANGUAGE SYSTEM ====================
// Sistem terjemahan Bahasa Indonesia ↔ English
// Penggunaan: t('key') → returns string sesuai bahasa aktif
// Untuk mengganti bahasa: window.setLang('en') atau window.setLang('id')

(function() {
    const translations = {
        id: {
            // === UMUM ===
            save: 'Simpan',
            cancel: 'Batal',
            delete: 'Hapus',
            edit: 'Edit',
            close: 'Tutup',
            add: 'Tambah',
            confirm: 'Konfirmasi',
            loading: 'Memuat...',
            yes: 'Ya',
            no: 'Tidak',
            ok: 'OK',
            error: 'Error',
            success: 'Berhasil',
            warning: 'Peringatan',
            search: 'Cari...',
            test: 'Tes',
            status: 'Status',
            name: 'Nama',
            description: 'Deskripsi',
            date: 'Tanggal',
            amount: 'Jumlah',
            category: 'Kategori',
            note: 'Catatan',
            action: 'Aksi',
            all: 'Semua',
            none: 'Tidak ada',
            set: 'Atur',
            manage: 'Kelola',
            configure: 'Konfigurasi',
            refresh: 'Refresh',
            export: 'Ekspor',
            import: 'Impor',
            backup: 'Backup',
            reset: 'Reset',
            connect: 'Hubungkan',
            disconnect: 'Putuskan',
            send: 'Kirim',
            copy: 'Salin',
            month: 'Bulan',
            year: 'Tahun',
            password: 'Password',

            // === NAVIGASI & HEADER ===
            book_label: 'BUKU:',
            manage_book: 'Kelola',
            sync: 'Sinkronisasi',
            dark_mode: 'Mode Gelap',
            settings: 'Setelan',
            payment_reminder: 'Pengingat Pembayaran',
            switch_account: 'Ganti Akun',
            menu: 'Menu',
            ai_placeholder: 'Tanya AI keuangan...',

            // === DASHBOARD STATS ===
            final_balance: 'Saldo Akhir',
            total_income: 'Total Pemasukan',
            total_expense: 'Total Pengeluaran',
            usd_rate: 'Kurs USD/IDR',
            gold_per_gram: 'Emas / gram',
            charity_fund: 'Dana Sedekah',
            loading_data: 'Memuat...',

            // === KARTU PERENCANAAN ===
            monthly_budget: 'Anggaran Bulanan',
            annual_budget: 'Anggaran Tahunan',
            emergency_fund: 'Dana Darurat',
            annual_needs: 'Cadangan Wajib',
            life_phase: 'Fase Kehidupan',
            mutual_fund: 'Dana Saling Jaga',
            monthly_template: 'Template per kategori, berlaku tiap bulan',
            annual_costs: 'Biaya tahunan: hari raya, pajak, dll',
            emergency_ideal: '12× anggaran bulanan (target ideal)',
            annual_need_desc: 'Dana darurat + anggaran tahunan',
            dsj_note: '30% dari saldo setelah dana darurat',

            // === ANGGARAN ===
            target: 'Target:',
            actual: 'Realisasi:',
            remaining: 'Sisa:',
            budget_btn: 'Anggarkan',
            report_btn: 'Laporan',
            pdf_btn: 'PDF',
            monthly_total: 'Total Anggaran Bulanan: ',
            annual_total: 'Total Anggaran Tahunan: ',
            this_month_only: 'Khusus bulan ini',
            no_budget: 'Tidak ada',

            // === FILTER & KONTROL ===
            filter_all: 'Semua',
            filter_income: 'Masuk',
            filter_expense: 'Keluar',
            add_transaction: '+ Transaksi',
            ai_analysis: 'Analisis AI',
            ask_ai: 'Tanya AI',

            // === TABEL TRANSAKSI ===
            col_no: 'No',
            col_date: 'Tanggal',
            col_category: 'Kategori',
            col_description: 'Deskripsi',
            col_income: 'Pemasukan',
            col_expense: 'Pengeluaran',
            col_balance: 'Saldo',
            col_receipt: 'Nota',
            col_action: 'Aksi',
            transaction_count: ' transaksi',
            no_transactions: 'Belum ada transaksi.',

            // === ESTIMASI KEUANGAN ===
            financial_estimate: 'Estimasi Keuangan',

            // === GRAFIK PENGELUARAN ===
            expense_by_category: ' Pengeluaran per Kategori',
            show: '▼ Tampilkan',
            hide: '▲ Sembunyikan',
            chart_all: 'Semua',
            chart_month: 'Bulan Ini',
            no_expense_data: 'Belum ada data pengeluaran',

            // === BACKUP ===
            manage_backup: 'Kelola Backup',
            audit_log: 'Log Audit',
            loading_log: 'Memuat log...',
            exporting_json: 'Mengekspor data ke JSON...',
            deleting_supabase: 'Menghapus data dari Supabase...',
            url_empty: 'URL tidak boleh kosong!',
            url_invalid: 'URL harus diawali https://script.google.com/macros/ ...',
            sheets_url_saved: 'URL Google Sheets Web App berhasil disimpan!',
            last_backup: 'Backup terakhir: ',
            never_backup: 'Belum pernah backup ke Google Sheets.',
            preparing_export: 'Menyiapkan file ekspor...',
            backup_to_sheets: 'Backup ke Google Sheets',
            save_url: 'Simpan URL',
            sheets_url_label: 'Google Sheets Web App URL',

            // === SETELAN ===
            settings_title: 'Setelan',
            ai_analysis_section: 'Analisis AI',
            ai_not_configured: 'Belum dikonfigurasi',
            ai_desc: 'Masukkan URL Cloudflare Worker milik Anda untuk mengaktifkan fitur Analisis Keuangan AI.',
            worker_url: 'Worker URL',
            worker_placeholder: 'https://nama-worker-anda.workers.dev',
            test_connection: 'Tes Koneksi',
            clear: 'Hapus',

            gold_price_section: 'Harga Emas Antam',
            gold_api_desc: 'Masukkan API key dari emas.maulanar.my.id untuk menampilkan harga emas Antam terkini.',
            api_key_label: 'API Key',
            api_key_placeholder: 'Masukkan API key dari emas.maulanar.my.id',
            gold_amount_label: 'Jumlah Emas yang Dimiliki (gram)',
            gold_amount_placeholder: 'Contoh: 5.5',

            charity_section: 'Sedekah',
            charity_desc: 'Sedekah dihitung otomatis 2,5% dari total pemasukan bulan kalender berjalan.',

            telegram_section: 'Notifikasi Telegram',
            telegram_desc: 'Kirim notifikasi transaksi, peringatan anggaran, dan ringkasan harian lewat Telegram Bot.',
            telegram_settings_btn: 'Atur Notifikasi Telegram',

            supabase_section: 'Koneksi Supabase',
            supabase_all_books: 'Berlaku untuk semua buku',
            supabase_url_label: 'Supabase URL Connection',
            supabase_key_label: 'Supabase Anon Key',
            connect_sync: 'Hubungkan & Sinkronkan Semua Buku',

            change_password_section: 'Ganti Password Keamanan',
            change_pwd_desc: 'Ganti password yang digunakan untuk mengenkripsi koneksi Supabase Anda.',
            current_pwd: 'Password saat ini',
            new_pwd: 'Password baru (min. 6 karakter)',
            confirm_pwd: 'Konfirmasi password baru',
            change_pwd_btn: 'Ganti Password',

            settings_sync_section: 'Sinkronisasi Setelan',
            settings_sync_auto: 'Otomatis',
            settings_sync_desc: 'Daftar buku kas, anggaran dasar, anggaran bulanan, dan konfigurasi Telegram tersinkronisasi otomatis ke Supabase setiap kali ada perubahan.',

            data_backup_section: 'Cadangan Data',
            migration_section: 'Migrasi Data ke Cloud',
            migration_desc: 'Pindahkan semua data (anggaran, jadwal pembayaran) dari Local Storage ke Supabase agar tersinkronisasi di semua perangkat.',
            migrate_all: 'Migrasi Semua Data',
            check_status: 'Cek Status',

            reset_app_section: 'Reset Total Aplikasi',
            reset_app_desc: 'Hapus semua buku, transaksi, dan setelan baik di Supabase maupun di penyimpanan lokal. Aplikasi akan kembali ke kondisi bersih seperti baru dipasang.',
            export_all_json: 'Ekspor Semua Data (JSON)',

            archive_section: 'Arsipkan & Kosongkan Database',

            language_section: 'Bahasa / Language',
            language_desc: 'Pilih bahasa tampilan aplikasi.',
            lang_id: '🇮🇩 Bahasa Indonesia',
            lang_en: '🇬🇧 English',

            // === PESAN STATUS ===
            all_fields_required: 'Semua field wajib diisi.',
            pwd_min_6: 'Password baru minimal 6 karakter.',
            confirm_mismatch: 'Konfirmasi tidak cocok.',
            verifying: 'Memverifikasi...',
            encryption_data_not_found: 'Data enkripsi tidak ditemukan.',
            old_pwd_wrong: 'Password lama salah.',
            failed_read_encrypted: 'Gagal membaca data terenkripsi.',
            re_encrypting: 'Mengenkripsi ulang...',
            updating_cloud_pwd: 'Memperbarui verifikasi password di cloud...',
            re_syncing_settings: 'Menyinkronkan ulang setting ke cloud...',
            pwd_changed_success: 'Password berhasil diganti & disinkronkan ke cloud! Ganti password yang sama di perangkat lain juga ya.',
            supabase_url_key_required: 'Supabase URL dan Anon Key wajib diisi!',
            pwd_min_6_short: 'Password minimal 6 karakter!',
            confirm_pwd_mismatch: 'Konfirmasi password tidak cocok!',
            testing_connection: 'Mengetes koneksi...',
            connecting_supabase: 'Menghubungkan ke Supabase...',
            save_start: 'Simpan & Mulai',
            connection_failed: 'Koneksi gagal! Periksa kembali URL dan Anon Key Anda.',
            checking_backend: 'Mengecek apakah backend ini sudah pernah disambungkan dari perangkat lain...',
            backend_diff_password: 'Backend ini sudah pernah disetup dari perangkat lain dengan password yang berbeda. Gunakan password yang SAMA dengan perangkat tersebut.',
            encrypting_credentials: 'Mengenkripsi kredensial...',
            connected: 'Tersambung',
            must_be_online: 'Anda harus ONLINE untuk migrasi!',
            starting_migration: 'Memulai migrasi data...',
            migrating_payment: 'Migrasi jadwal pembayaran...',
            migrating_budget: 'Migrasi anggaran...',
            final_sync: 'Sinkronisasi akhir...',
            migration_done: 'Migrasi selesai! Semua data tersinkronisasi ke cloud.',
            migration_failed: 'Gagal migrasi: ',
            must_be_online_check: 'Anda harus ONLINE untuk cek status!',
            checking_status: 'Memeriksa status...',
            migration_failed_check: 'Gagal cek status: ',

            // === LOCK SCREEN ===
            lock_show_hide: 'Tampilkan/sembunyikan',
            lock_show: 'Lihat',
            lock_hide: 'Tutup',
            lock_open: 'Buka',
            lock_pwd_empty: 'Password tidak boleh kosong',
            lock_verifying: 'Memverifikasi...',
            lock_wrong_pwd: 'Password salah',

            // === AKUN ===
            open_account: 'Buka "',
            enter_pwd_for: 'Masukkan password enkripsi untuk akun ',
            enter_pwd_first: 'Masukkan password terlebih dahulu.',
            acc_name_required: 'Nama akun wajib diisi!',
            acc_fields_required: 'URL, Anon Key, dan Password (min 6 karakter) wajib diisi!',
            acc_connection_failed: 'Koneksi gagal! Periksa URL dan Anon Key.',
            acc_encrypting_saving: 'Mengenkripsi dan menyimpan...',
            acc_updated: 'Akun berhasil diperbarui!',
            acc_added: 'Akun berhasil ditambahkan!',
            testing_supabase: 'Mengetes koneksi ke Supabase...',

            // === RENDER / UI ===
            emergency_insufficient: 'Saldo belum cukup untuk dana darurat',
            emergency_50pct: '50% dari saldo setelah cadangan wajib',
            life_phase_not_set: 'Belum diatur',
            life_phase_click: 'Klik untuk mengatur fase kehidupan pernikahan Anda',
            ai_analysis_btn: 'Analisis AI',
            new_receipt: 'Nota baru siap disimpan',
            has_attachment: 'Sudah memiliki lampiran nota.',
            no_attachment: 'Belum ada lampiran.',

            // === TELEGRAM ===
            telegram_active: 'Aktif',
            telegram_not_configured: 'Belum dikonfigurasi',

            // === FOREX ===
            forex_configured: 'Terkonfigurasi',
            forex_not_configured: 'Belum dikonfigurasi',

            // === AI ===
            ai_worker_not_configured: 'Worker URL belum dikonfigurasi.',
            ai_open_settings: 'Setelan → Analisis AI',

            // === OFFLINE ===
            offline_mode: 'Mode Baca Saja',
            offline_desc: 'Anda sedang offline. Untuk menambah/mengedit/menghapus data, sambungkan ke internet.',

            // === BULAN ===
            jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr',
            may: 'Mei', jun: 'Jun', jul: 'Jul', aug: 'Agu',
            sep: 'Sep', oct: 'Okt', nov: 'Nov', dec: 'Des',

            // === KATEGORI PEMASUKAN ===
            cat_salary: 'Gaji',
            cat_freelance: 'Freelance',
            cat_bonus: 'Bonus',
            cat_thr: 'THR',
            cat_investment: 'Hasil Investasi',
            cat_asset_sale: 'Jual Aset',
            cat_gift: 'Hadiah',
            cat_sales: 'Penjualan',
            cat_service: 'Jasa',
            cat_advance: 'Uang Muka',
            cat_receivable: 'Pelunasan Piutang',
            cat_commission: 'Komisi',
            cat_loan_received: 'Pinjaman Diterima',
            cat_refund: 'Pengembalian Dana',
            cat_subsidy: 'Subsidi & Bantuan',
            cat_other: 'Lainnya',

            // === TAMBAH TRANSAKSI ===
            add_transaction_title: 'Tambah Transaksi',
            edit_transaction_title: 'Edit Transaksi',
            income_tab: 'Pemasukan',
            expense_tab: 'Pengeluaran',
            pick_category: '-- Pilih Kategori --',
            select_category: 'Kategori',

            // === MISC ===
            hide_balance: 'Sembunyikan/Tampilkan saldo',
            payment_reminder_banner: 'Pengingat Pembayaran',
            see_all: 'Lihat Semua',
            ai_chat_placeholder: 'Tanya sesuatu tentang keuanganmu...',
        },

        en: {
            // === GENERAL ===
            save: 'Save',
            cancel: 'Cancel',
            delete: 'Delete',
            edit: 'Edit',
            close: 'Close',
            add: 'Add',
            confirm: 'Confirm',
            loading: 'Loading...',
            yes: 'Yes',
            no: 'No',
            ok: 'OK',
            error: 'Error',
            success: 'Success',
            warning: 'Warning',
            search: 'Search...',
            test: 'Test',
            status: 'Status',
            name: 'Name',
            description: 'Description',
            date: 'Date',
            amount: 'Amount',
            category: 'Category',
            note: 'Note',
            action: 'Action',
            all: 'All',
            none: 'None',
            set: 'Set',
            manage: 'Manage',
            configure: 'Configure',
            refresh: 'Refresh',
            export: 'Export',
            import: 'Import',
            backup: 'Backup',
            reset: 'Reset',
            connect: 'Connect',
            disconnect: 'Disconnect',
            send: 'Send',
            copy: 'Copy',
            month: 'Month',
            year: 'Year',
            password: 'Password',

            // === NAVIGATION & HEADER ===
            book_label: 'BOOK:',
            manage_book: 'Manage',
            sync: 'Sync',
            dark_mode: 'Dark Mode',
            settings: 'Settings',
            payment_reminder: 'Payment Reminder',
            switch_account: 'Switch Account',
            menu: 'Menu',
            ai_placeholder: 'Ask AI about your finances...',

            // === DASHBOARD STATS ===
            final_balance: 'Balance',
            total_income: 'Total Income',
            total_expense: 'Total Expenses',
            usd_rate: 'USD/IDR Rate',
            gold_per_gram: 'Gold / gram',
            charity_fund: 'Charity Fund',
            loading_data: 'Loading...',

            // === PLANNING CARDS ===
            monthly_budget: 'Monthly Budget',
            annual_budget: 'Annual Budget',
            emergency_fund: 'Emergency Fund',
            annual_needs: 'Mandatory Reserve',
            life_phase: 'Life Phase',
            mutual_fund: 'Mutual Fund',
            monthly_template: 'Template per category, applies each month',
            annual_costs: 'Annual costs: holidays, taxes, etc.',
            emergency_ideal: '12× monthly budget (ideal target)',
            annual_need_desc: 'Emergency fund + annual budget',
            dsj_note: '30% of balance after emergency fund',

            // === BUDGET ===
            target: 'Target:',
            actual: 'Actual:',
            remaining: 'Remaining:',
            budget_btn: 'Budget',
            report_btn: 'Report',
            pdf_btn: 'PDF',
            monthly_total: 'Total Monthly Budget: ',
            annual_total: 'Total Annual Budget: ',
            this_month_only: 'This month only',
            no_budget: 'None',

            // === FILTER & CONTROLS ===
            filter_all: 'All',
            filter_income: 'Income',
            filter_expense: 'Expense',
            add_transaction: '+ Transaction',
            ai_analysis: 'AI Analysis',
            ask_ai: 'Ask AI',

            // === TRANSACTION TABLE ===
            col_no: 'No',
            col_date: 'Date',
            col_category: 'Category',
            col_description: 'Description',
            col_income: 'Income',
            col_expense: 'Expense',
            col_balance: 'Balance',
            col_receipt: 'Receipt',
            col_action: 'Action',
            transaction_count: ' transactions',
            no_transactions: 'No transactions yet.',

            // === FINANCIAL ESTIMATE ===
            financial_estimate: 'Financial Estimate',

            // === EXPENSE CHART ===
            expense_by_category: ' Expenses by Category',
            show: '▼ Show',
            hide: '▲ Hide',
            chart_all: 'All',
            chart_month: 'This Month',
            no_expense_data: 'No expense data yet',

            // === BACKUP ===
            manage_backup: 'Manage Backup',
            audit_log: 'Audit Log',
            loading_log: 'Loading log...',
            exporting_json: 'Exporting data to JSON...',
            deleting_supabase: 'Deleting data from Supabase...',
            url_empty: 'URL cannot be empty!',
            url_invalid: 'URL must start with https://script.google.com/macros/ ...',
            sheets_url_saved: 'Google Sheets Web App URL saved successfully!',
            last_backup: 'Last backup: ',
            never_backup: 'Never backed up to Google Sheets.',
            preparing_export: 'Preparing export file...',
            backup_to_sheets: 'Backup to Google Sheets',
            save_url: 'Save URL',
            sheets_url_label: 'Google Sheets Web App URL',

            // === SETTINGS ===
            settings_title: 'Settings',
            ai_analysis_section: 'AI Analysis',
            ai_not_configured: 'Not configured',
            ai_desc: 'Enter your Cloudflare Worker URL to enable the AI Financial Analysis feature.',
            worker_url: 'Worker URL',
            worker_placeholder: 'https://your-worker-name.workers.dev',
            test_connection: 'Test Connection',
            clear: 'Clear',

            gold_price_section: 'Antam Gold Price',
            gold_api_desc: 'Enter the API key from emas.maulanar.my.id to display the latest Antam gold price.',
            api_key_label: 'API Key',
            api_key_placeholder: 'Enter API key from emas.maulanar.my.id',
            gold_amount_label: 'Amount of Gold Owned (grams)',
            gold_amount_placeholder: 'e.g. 5.5',

            charity_section: 'Charity (Sedekah)',
            charity_desc: 'Charity is automatically calculated at 2.5% of total income for the current calendar month.',

            telegram_section: 'Telegram Notifications',
            telegram_desc: 'Send transaction notifications, budget alerts, and daily summaries via Telegram Bot.',
            telegram_settings_btn: 'Set Up Telegram Notifications',

            supabase_section: 'Supabase Connection',
            supabase_all_books: 'Applies to all books',
            supabase_url_label: 'Supabase URL Connection',
            supabase_key_label: 'Supabase Anon Key',
            connect_sync: 'Connect & Sync All Books',

            change_password_section: 'Change Security Password',
            change_pwd_desc: 'Change the password used to encrypt your Supabase connection.',
            current_pwd: 'Current password',
            new_pwd: 'New password (min. 6 characters)',
            confirm_pwd: 'Confirm new password',
            change_pwd_btn: 'Change Password',

            settings_sync_section: 'Settings Sync',
            settings_sync_auto: 'Automatic',
            settings_sync_desc: 'The list of ledger books, base budgets, monthly budgets, and Telegram configuration are automatically synced to Supabase whenever a change occurs.',

            data_backup_section: 'Data Backup',
            migration_section: 'Migrate Data to Cloud',
            migration_desc: 'Move all data (budgets, payment schedules) from Local Storage to Supabase so it syncs across all devices.',
            migrate_all: 'Migrate All Data',
            check_status: 'Check Status',

            reset_app_section: 'Full App Reset',
            reset_app_desc: 'Delete all books, transactions, and settings from both Supabase and local storage. The app will return to a clean state as if newly installed.',
            export_all_json: 'Export All Data (JSON)',

            archive_section: 'Archive & Clear Database',

            language_section: 'Bahasa / Language',
            language_desc: 'Choose the display language of the app.',
            lang_id: '🇮🇩 Bahasa Indonesia',
            lang_en: '🇬🇧 English',

            // === STATUS MESSAGES ===
            all_fields_required: 'All fields are required.',
            pwd_min_6: 'New password must be at least 6 characters.',
            confirm_mismatch: 'Confirmation does not match.',
            verifying: 'Verifying...',
            encryption_data_not_found: 'Encryption data not found.',
            old_pwd_wrong: 'Old password is incorrect.',
            failed_read_encrypted: 'Failed to read encrypted data.',
            re_encrypting: 'Re-encrypting...',
            updating_cloud_pwd: 'Updating password verification in cloud...',
            re_syncing_settings: 'Re-syncing settings to cloud...',
            pwd_changed_success: 'Password changed and synced to cloud! Make sure to update the password on other devices too.',
            supabase_url_key_required: 'Supabase URL and Anon Key are required!',
            pwd_min_6_short: 'Password must be at least 6 characters!',
            confirm_pwd_mismatch: 'Password confirmation does not match!',
            testing_connection: 'Testing connection...',
            connecting_supabase: 'Connecting to Supabase...',
            save_start: 'Save & Start',
            connection_failed: 'Connection failed! Please check your URL and Anon Key.',
            checking_backend: 'Checking if this backend has been connected from another device...',
            backend_diff_password: 'This backend was already set up from another device with a different password. Use the SAME password as that device.',
            encrypting_credentials: 'Encrypting credentials...',
            connected: 'Connected',
            must_be_online: 'You must be ONLINE to migrate!',
            starting_migration: 'Starting data migration...',
            migrating_payment: 'Migrating payment schedules...',
            migrating_budget: 'Migrating budgets...',
            final_sync: 'Final sync...',
            migration_done: 'Migration complete! All data synced to cloud.',
            migration_failed: 'Migration failed: ',
            must_be_online_check: 'You must be ONLINE to check status!',
            checking_status: 'Checking status...',
            migration_failed_check: 'Status check failed: ',

            // === LOCK SCREEN ===
            lock_show_hide: 'Show/hide',
            lock_show: 'Show',
            lock_hide: 'Hide',
            lock_open: 'Unlock',
            lock_pwd_empty: 'Password cannot be empty',
            lock_verifying: 'Verifying...',
            lock_wrong_pwd: 'Incorrect password',

            // === ACCOUNT ===
            open_account: 'Open "',
            enter_pwd_for: 'Enter encryption password for account ',
            enter_pwd_first: 'Please enter your password first.',
            acc_name_required: 'Account name is required!',
            acc_fields_required: 'URL, Anon Key, and Password (min 6 characters) are required!',
            acc_connection_failed: 'Connection failed! Check your URL and Anon Key.',
            acc_encrypting_saving: 'Encrypting and saving...',
            acc_updated: 'Account updated successfully!',
            acc_added: 'Account added successfully!',
            testing_supabase: 'Testing Supabase connection...',

            // === RENDER / UI ===
            emergency_insufficient: 'Balance is not enough for emergency fund',
            emergency_50pct: '50% of balance after mandatory reserve',
            life_phase_not_set: 'Not set',
            life_phase_click: 'Click to set your life phase',
            ai_analysis_btn: 'AI Analysis',
            new_receipt: 'New receipt ready to save',
            has_attachment: 'Receipt already attached.',
            no_attachment: 'No receipt attached.',

            // === TELEGRAM ===
            telegram_active: 'Active',
            telegram_not_configured: 'Not configured',

            // === FOREX ===
            forex_configured: 'Configured',
            forex_not_configured: 'Not configured',

            // === AI ===
            ai_worker_not_configured: 'Worker URL not configured.',
            ai_open_settings: 'Settings → AI Analysis',

            // === OFFLINE ===
            offline_mode: 'Read-Only Mode',
            offline_desc: 'You are offline. To add/edit/delete data, please connect to the internet.',

            // === MONTHS ===
            jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr',
            may: 'May', jun: 'Jun', jul: 'Jul', aug: 'Aug',
            sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec',

            // === INCOME CATEGORIES ===
            cat_salary: 'Salary',
            cat_freelance: 'Freelance',
            cat_bonus: 'Bonus',
            cat_thr: 'Holiday Allowance',
            cat_investment: 'Investment Returns',
            cat_asset_sale: 'Asset Sale',
            cat_gift: 'Gift',
            cat_sales: 'Sales',
            cat_service: 'Service',
            cat_advance: 'Down Payment',
            cat_receivable: 'Receivable Settlement',
            cat_commission: 'Commission',
            cat_loan_received: 'Loan Received',
            cat_refund: 'Refund',
            cat_subsidy: 'Subsidy & Aid',
            cat_other: 'Other',

            // === ADD TRANSACTION ===
            add_transaction_title: 'Add Transaction',
            edit_transaction_title: 'Edit Transaction',
            income_tab: 'Income',
            expense_tab: 'Expense',
            pick_category: '-- Select Category --',
            select_category: 'Category',

            // === MISC ===
            hide_balance: 'Hide/Show Balance',
            payment_reminder_banner: 'Payment Reminder',
            see_all: 'See All',
            ai_chat_placeholder: 'Ask something about your finances...',
        }
    };

    // Get current language (default: id)
    function getLang() {
        return localStorage.getItem('sk_lang') || 'id';
    }

    // Translate function
    window.t = function(key) {
        var lang = getLang();
        var dict = translations[lang] || translations['id'];
        return dict[key] !== undefined ? dict[key] : (translations['id'][key] || key);
    };

    // Set language and re-render all i18n elements
    window.setLang = function(lang) {
        if (!translations[lang]) return;
        localStorage.setItem('sk_lang', lang);
        window.applyI18n();
        // Re-render dynamic parts if app is loaded
        if (typeof window.render === 'function') window.render();
        if (typeof window.renderBudget === 'function') window.renderBudget();
        if (typeof window.renderForecastCard === 'function') window.renderForecastCard();
        if (typeof window.renderZakatCard === 'function') window.renderZakatCard();
    };

    // Apply translations to all elements with data-i18n attribute
    window.applyI18n = function() {
        document.querySelectorAll('[data-i18n]').forEach(function(el) {
            var key = el.getAttribute('data-i18n');
            var attr = el.getAttribute('data-i18n-attr');
            var val = window.t(key);
            if (attr) {
                el.setAttribute(attr, val);
            } else {
                el.textContent = val;
            }
        });
        // Update html lang attribute
        document.documentElement.lang = getLang() === 'en' ? 'en' : 'id';
        // Update language toggle buttons if they exist
        _updateLangButtons();
    };

    function _updateLangButtons() {
        var lang = getLang();
        var btnId = document.getElementById('langBtnId');
        var btnEn = document.getElementById('langBtnEn');
        if (btnId) {
            btnId.style.background = lang === 'id' ? '#1a56db' : '#eee';
            btnId.style.color = lang === 'id' ? '#fff' : '#333';
            btnId.style.borderColor = lang === 'id' ? '#1a56db' : '#ccc';
        }
        if (btnEn) {
            btnEn.style.background = lang === 'en' ? '#1a56db' : '#eee';
            btnEn.style.color = lang === 'en' ? '#fff' : '#333';
            btnEn.style.borderColor = lang === 'en' ? '#1a56db' : '#ccc';
        }
    }

    // Apply on DOM ready
    document.addEventListener('DOMContentLoaded', function() {
        window.applyI18n();
    });

    // Expose getLang for other modules
    window.getLang = getLang;
})();
