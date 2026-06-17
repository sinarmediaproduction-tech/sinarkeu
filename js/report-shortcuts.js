// ==================== MONTHLY REPORT SHORTCUTS ====================
// openMonthlyReport: dipanggil dari tombol "📄 Laporan" di panel anggaran.
// Membuka modal laporan bulanan, otomatis diset ke bulan & tahun saat ini,
// lalu langsung menampilkan laporannya.
window.openMonthlyReport = function() {
    const now = new Date();
    const monthSel = document.getElementById('reportMonth');
    const yearInp = document.getElementById('reportYear');
    if (monthSel) monthSel.value = String(now.getMonth() + 1);
    if (yearInp) yearInp.value = String(now.getFullYear());
    window.openModal('monthlyReportModal');
    if (typeof generateMonthlyReport === 'function') {
        generateMonthlyReport();
    }
};

// generatePDFReport: dipanggil dari tombol pintas "📎 PDF" di panel anggaran.
// Langsung men-generate & mengunduh PDF laporan bulan ini tanpa perlu
// membuka modal laporan terlebih dahulu.
window.generatePDFReport = function() {
    const now = new Date();
    const monthSel = document.getElementById('reportMonth');
    const yearInp = document.getElementById('reportYear');
    if (monthSel) monthSel.value = String(now.getMonth() + 1);
    if (yearInp) yearInp.value = String(now.getFullYear());
    if (typeof exportReportAsPDF === 'function') {
        exportReportAsPDF();
    } else {
        window.showToast('❌ Fitur export PDF belum tersedia', 'error');
    }
};
