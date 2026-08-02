// ==================== I18N / LANGUAGE SYSTEM ====================
// Sistem terjemahan Bahasa Indonesia (satu-satunya bahasa yang didukung)
// Penggunaan: t('key') → returns string bahasa Indonesia

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
            final_balance: 'Proyeksi Saldo',
            total_income: 'Total Pemasukan',
            total_expense: 'Total Pengeluaran',
            usd_rate: 'Kurs USD/IDR',
            gold_per_gram: 'Emas / gram',
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
    };

    // Bahasa aplikasi selalu Indonesia
    function getLang() {
        return 'id';
    }

    // Translate function
    window.t = function(key) {
        var dict = translations.id;
        return dict[key] !== undefined ? dict[key] : key;
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
        document.documentElement.lang = 'id';
    };

    // Apply on DOM ready
    document.addEventListener('DOMContentLoaded', function() {
        window.applyI18n();
    });

    // Expose getLang for other modules
    window.getLang = getLang;
})();
