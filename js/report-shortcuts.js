// ==================== MONTHLY REPORT SHORTCUTS ====================
// openMonthlyReport: dipanggil dari tombol "Laporan" di panel anggaran.
// Membuka modal laporan bulanan, otomatis diset ke bulan & tahun saat ini,
// lalu langsung menampilkan laporannya.
// [LAZY-LOAD] js/report.js (generateMonthlyReport, exportReportAsPDF) tidak
// lagi eager-loaded (lihat SK_JS_FILES di index.html) -- di-load di sini
// lewat window.skLoadModule sebelum dipakai, bukan cuma dicek typeof.
window.openMonthlyReport = function() {
    const now = new Date();
    const monthSel = document.getElementById('reportMonth');
    const yearInp = document.getElementById('reportYear');
    if (monthSel) monthSel.value = String(now.getMonth() + 1);
    if (yearInp) yearInp.value = String(now.getFullYear());
    window.openModal('monthlyReportModal');
    window.skLoadModule('report').catch(function(e) {
        window.skWarn('[Report] Gagal memuat modul laporan (report.js):', e);
    }).then(function() {
        window.runAfterNextPaint(function() {
            const modal = document.getElementById('monthlyReportModal');
            if (modal && modal.classList.contains('show') && typeof generateMonthlyReport === 'function') generateMonthlyReport();
        });
    });
};

// generatePDFReport: dipanggil dari tombol pintas "PDF" di panel anggaran.
// Langsung men-generate & mengunduh PDF laporan bulan ini tanpa perlu
// membuka modal laporan terlebih dahulu.
window.generatePDFReport = function() {
    const now = new Date();
    const monthSel = document.getElementById('reportMonth');
    const yearInp = document.getElementById('reportYear');
    if (monthSel) monthSel.value = String(now.getMonth() + 1);
    if (yearInp) yearInp.value = String(now.getFullYear());
    window.skLoadModule('report').then(function() {
        if (typeof exportReportAsPDF === 'function') {
            exportReportAsPDF();
        } else {
            window.showToast('Fitur export PDF belum tersedia', 'error');
        }
    }).catch(function(e) {
        window.skWarn('[Report] Gagal memuat modul laporan (report.js):', e);
        window.showToast('Fitur export PDF belum tersedia', 'error');
    });
};
