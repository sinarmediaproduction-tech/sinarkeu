// ==================== RENCANA LISTRIK ====================
// Perencanaan pembagian beban perangkat listrik antar meteran (mis. rumah
// dengan 2 meteran/token berbeda, tarif subsidi vs non-subsidi) dan
// estimasi biaya bulanan per meteran. Tersimpan lokal (localStorage) per
// buku DAN disinkronkan ke Supabase (tabel `settings`, key
// 'electricity_plan', per book_id) mengikuti pola yang sama seperti
// Daftar Belanja (lihat js/shopping-list.js) --
// window.saveElectricityPlanToLocal + window.pushSetting. Nilai
// dienkripsi otomatis oleh pushSetting() sebelum dikirim ke cloud
// (kecuali buku bersama). Pull-nya ditangani terpusat di
// window.pullAllSettings (js/db.js).
//
// Struktur data (per buku):
// { meters: [
//     { id, name, capacityVA, tariffPerKwh, devices: [
//         { id, name, watt, hoursPerDay }
//     ] }
// ] }
//
// Estimasi bulanan pakai asumsi 30 hari/bulan -- angka riil bisa
// naik-turun tergantung pola pemakaian harian aktual, sama seperti
// perkiraan di dokumen sumber yang jadi acuan awal fitur ini.

window.getElectricityPlan = function(bookId) {
    const raw = localStorage.getItem('sk_electricity_plan_' + (bookId || window.currentBookId));
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.meters)) return parsed;
        } catch { /* jatuh ke default kosong di bawah */ }
    }
    return { meters: [] };
};

window.saveElectricityPlanToLocal = function(bookId, plan) {
    localStorage.setItem('sk_electricity_plan_' + (bookId || window.currentBookId), JSON.stringify(plan));
};

window.saveElectricityPlan = function(bookId, plan) {
    const targetId = bookId || window.currentBookId;
    window.saveElectricityPlanToLocal(targetId, plan);
    // Fire-and-forget seperti Daftar Belanja -- perubahan lokal tidak
    // menunggu cloud, kegagalan sync ditoast tapi tidak menghalangi UI.
    if (window.isOnline && window.isOnline() && window.pushSetting) {
        window.pushSetting('electricity_plan', plan, targetId).catch(function(e) {
            console.warn('[ElectricityPlan] Gagal sync ke cloud:', e);
            window.showToast && window.showToast('Perubahan tersimpan di perangkat ini, tapi gagal sinkron ke cloud.', 'error');
        });
    }
};

// ── Pembatasan role viewer, pola sama seperti Daftar Belanja
// (js/shopping-list.js, window._slistIsViewer/_slistBlockIfViewer).
window._elecIsViewer = function() {
    return typeof window.skIsViewerOnCurrentBook === 'function' && window.skIsViewerOnCurrentBook();
};
window._elecBlockIfViewer = function() {
    if (window._elecIsViewer()) {
        window.showToast && window.showToast('Peran viewer di buku bersama ini hanya bisa melihat Rencana Listrik, tidak bisa mengubahnya.', 'error');
        return true;
    }
    return false;
};

// ==================== KALKULASI ====================
window._elecDeviceKwhPerDay = function(device) {
    const watt = Number(device.watt) || 0;
    const hours = Number(device.hoursPerDay) || 0;
    return (watt * hours) / 1000;
};

window._elecMeterTotals = function(meter) {
    const devices = Array.isArray(meter.devices) ? meter.devices : [];
    let totalWatt = 0, kwhPerDay = 0;
    devices.forEach(function(d) {
        totalWatt += Number(d.watt) || 0;
        kwhPerDay += window._elecDeviceKwhPerDay(d);
    });
    const kwhPerMonth = kwhPerDay * 30;
    const tariff = Number(meter.tariffPerKwh) || 0;
    const costPerMonth = kwhPerMonth * tariff;
    return { totalWatt: totalWatt, kwhPerDay: kwhPerDay, kwhPerMonth: kwhPerMonth, costPerMonth: costPerMonth };
};

window._elecPlanTotals = function(plan) {
    const meters = Array.isArray(plan.meters) ? plan.meters : [];
    let kwhPerDay = 0, kwhPerMonth = 0, costPerMonth = 0;
    meters.forEach(function(m) {
        const t = window._elecMeterTotals(m);
        kwhPerDay += t.kwhPerDay;
        kwhPerMonth += t.kwhPerMonth;
        costPerMonth += t.costPerMonth;
    });
    return { kwhPerDay: kwhPerDay, kwhPerMonth: kwhPerMonth, costPerMonth: costPerMonth };
};

const _elecNum = function(n, digits) {
    return Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: digits });
};

// ==================== BUKA HALAMAN ====================
window.openElectricityPlanModal = function() {
    window.renderElectricityPlan();
    window.openModal('electricityPlanModal');
};

// ==================== RENDER ====================
window.renderElectricityPlan = function() {
    const plan = window.getElectricityPlan(window.currentBookId);
    const isViewer = window._elecIsViewer();

    const notice = document.getElementById('elecViewerNotice');
    if (notice) notice.style.display = isViewer ? '' : 'none';
    const addMeterBtn = document.getElementById('elecAddMeterBtn');
    if (addMeterBtn) addMeterBtn.style.display = isViewer ? 'none' : '';

    const totals = window._elecPlanTotals(plan);
    const setText = function(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; };
    setText('elecSummaryKwh', _elecNum(totals.kwhPerMonth, 1) + ' kWh');
    setText('elecSummaryCost', window.rp(Math.round(totals.costPerMonth)));
    setText('elecSummaryMeterCount', String(plan.meters.length));

    const container = document.getElementById('elecMetersContainer');
    if (!container) return;

    if (!plan.meters.length) {
        container.innerHTML = '<div class="elec-empty">Belum ada meteran. Tambahkan meteran untuk mulai membagi perangkat &amp; menghitung estimasi biaya listrik bulanan.</div>';
        return;
    }

    container.innerHTML = plan.meters.map(function(meter) {
        const t = window._elecMeterTotals(meter);
        const capNum = Number(meter.capacityVA) || 0;
        // Perkiraan kasar (bukan perhitungan faktor daya presisi): tandai
        // kalau beban total sudah mendekati/lewat 90% kapasitas VA meteran.
        const overCapacity = capNum > 0 && t.totalWatt > capNum * 0.9;
        const devices = Array.isArray(meter.devices) ? meter.devices : [];
        return `
        <div class="elec-meter-card">
            <div class="elec-meter-head">
                <div class="elec-meter-title">
                    <h4>${window.escapeHtml(meter.name || 'Meteran')}</h4>
                    <span class="elec-meter-meta">${capNum ? capNum + ' VA · ' : ''}${window.rp(meter.tariffPerKwh || 0)}/kWh</span>
                </div>
                ${isViewer ? '' : `
                <div class="elec-meter-actions">
                    <button type="button" class="btn-icon" title="Ubah Meteran" onclick="window.openEditElectricityMeterModal('${meter.id}')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></button>
                    <button type="button" class="btn-icon btn-icon-danger" title="Hapus Meteran" onclick="window.deleteElectricityMeter('${meter.id}')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg></button>
                </div>`}
            </div>
            ${overCapacity ? `<div class="elec-warning">Beban perangkat (${_elecNum(t.totalWatt, 0)} W) sudah mendekati/lewat kapasitas ${capNum} VA -- berisiko trip saat perangkat lain menyala bersamaan. Perkiraan kasar, tidak memperhitungkan faktor daya.</div>` : ''}
            <div class="elec-device-list">
                ${devices.length ? devices.map(function(d) {
                    return `
                    <div class="elec-device-row">
                        <span class="elec-device-name">${window.escapeHtml(d.name || '')}</span>
                        <span class="elec-device-watt">${_elecNum(d.watt, 0)} W</span>
                        <span class="elec-device-hours">${_elecNum(d.hoursPerDay, 1)} jam/hari</span>
                        <span class="elec-device-kwh">${_elecNum(window._elecDeviceKwhPerDay(d), 2)} kWh/hari</span>
                        ${isViewer ? '' : `
                        <span class="elec-device-actions">
                            <button type="button" class="btn-icon" title="Ubah" onclick="window.openEditElectricityDeviceModal('${meter.id}','${d.id}')"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg></button>
                            <button type="button" class="btn-icon btn-icon-danger" title="Hapus" onclick="window.deleteElectricityDevice('${meter.id}','${d.id}')">&times;</button>
                        </span>`}
                    </div>`;
                }).join('') : '<div class="elec-device-empty">Belum ada perangkat di meteran ini.</div>'}
            </div>
            ${isViewer ? '' : `<button type="button" class="elec-add-device-btn" onclick="window.openAddElectricityDeviceModal('${meter.id}')">+ Tambah Perangkat</button>`}
            <div class="elec-meter-foot">
                <span>${_elecNum(t.totalWatt, 0)} W · ${_elecNum(t.kwhPerDay, 2)} kWh/hari</span>
                <span><strong>≈ ${_elecNum(t.kwhPerMonth, 1)} kWh/bulan · ${window.rp(Math.round(t.costPerMonth))}/bulan</strong></span>
            </div>
        </div>`;
    }).join('');
};

// ==================== MODAL METERAN (Tambah/Ubah, satu modal) ====================
window.openAddElectricityMeterModal = function() {
    if (window._elecBlockIfViewer()) return;
    document.getElementById('elecMeterModalTitle').textContent = 'Tambah Meteran';
    document.getElementById('elecMeterId').value = '';
    document.getElementById('elecMeterName').value = '';
    document.getElementById('elecMeterCapacity').value = '';
    document.getElementById('elecMeterTariff').value = '';
    window.openModal('electricityMeterModal');
};

window.openEditElectricityMeterModal = function(meterId) {
    if (window._elecBlockIfViewer()) return;
    const plan = window.getElectricityPlan(window.currentBookId);
    const meter = plan.meters.find(function(m) { return m.id === meterId; });
    if (!meter) return;
    document.getElementById('elecMeterModalTitle').textContent = 'Ubah Meteran';
    document.getElementById('elecMeterId').value = meter.id;
    document.getElementById('elecMeterName').value = meter.name || '';
    document.getElementById('elecMeterCapacity').value = meter.capacityVA || '';
    document.getElementById('elecMeterTariff').value = meter.tariffPerKwh ? window.rp(meter.tariffPerKwh).replace('Rp', '').trim() : '';
    window.openModal('electricityMeterModal');
};

window.handleElectricityMeterSubmit = function(e) {
    e.preventDefault();
    if (window._elecBlockIfViewer()) return;
    const id = document.getElementById('elecMeterId').value;
    const name = document.getElementById('elecMeterName').value.trim();
    if (!name) return;
    const capacityVA = parseInt(document.getElementById('elecMeterCapacity').value) || 0;
    const tariffPerKwh = window.unRp(document.getElementById('elecMeterTariff').value);

    const plan = window.getElectricityPlan(window.currentBookId);
    if (id) {
        const meter = plan.meters.find(function(m) { return m.id === id; });
        if (!meter) return;
        meter.name = name;
        meter.capacityVA = capacityVA;
        meter.tariffPerKwh = tariffPerKwh;
    } else {
        plan.meters.push({
            id: 'em_' + Date.now() + Math.random().toString(36).slice(2, 7),
            name: name,
            capacityVA: capacityVA,
            tariffPerKwh: tariffPerKwh,
            devices: []
        });
    }
    window.saveElectricityPlan(window.currentBookId, plan);
    window.closeModal('electricityMeterModal');
    window.renderElectricityPlan();
    window.showToast(id ? 'Meteran diperbarui.' : 'Meteran ditambahkan.', 'success');
};

window.deleteElectricityMeter = async function(meterId) {
    if (window._elecBlockIfViewer()) return;
    const plan = window.getElectricityPlan(window.currentBookId);
    const meter = plan.meters.find(function(m) { return m.id === meterId; });
    if (!meter) return;
    const confirmed = await window.customConfirm({
        title: 'Hapus Meteran',
        message: `Hapus meteran "${meter.name}" beserta ${(meter.devices || []).length} perangkat di dalamnya?`,
        confirmLabel: 'Hapus'
    });
    if (!confirmed) return;
    plan.meters = plan.meters.filter(function(m) { return m.id !== meterId; });
    window.saveElectricityPlan(window.currentBookId, plan);
    window.renderElectricityPlan();
    window.showToast('Meteran dihapus.', 'success');
};

// ==================== MODAL PERANGKAT (Tambah/Ubah, satu modal) ====================
window.openAddElectricityDeviceModal = function(meterId) {
    if (window._elecBlockIfViewer()) return;
    document.getElementById('elecDeviceModalTitle').textContent = 'Tambah Perangkat';
    document.getElementById('elecDeviceMeterId').value = meterId;
    document.getElementById('elecDeviceId').value = '';
    document.getElementById('elecDeviceName').value = '';
    document.getElementById('elecDeviceWatt').value = '';
    document.getElementById('elecDeviceHours').value = '';
    window.openModal('electricityDeviceModal');
};

window.openEditElectricityDeviceModal = function(meterId, deviceId) {
    if (window._elecBlockIfViewer()) return;
    const plan = window.getElectricityPlan(window.currentBookId);
    const meter = plan.meters.find(function(m) { return m.id === meterId; });
    const device = meter && (meter.devices || []).find(function(d) { return d.id === deviceId; });
    if (!device) return;
    document.getElementById('elecDeviceModalTitle').textContent = 'Ubah Perangkat';
    document.getElementById('elecDeviceMeterId').value = meterId;
    document.getElementById('elecDeviceId').value = device.id;
    document.getElementById('elecDeviceName').value = device.name || '';
    document.getElementById('elecDeviceWatt').value = device.watt || '';
    document.getElementById('elecDeviceHours').value = device.hoursPerDay || '';
    window.openModal('electricityDeviceModal');
};

window.handleElectricityDeviceSubmit = function(e) {
    e.preventDefault();
    if (window._elecBlockIfViewer()) return;
    const meterId = document.getElementById('elecDeviceMeterId').value;
    const id = document.getElementById('elecDeviceId').value;
    const name = document.getElementById('elecDeviceName').value.trim();
    if (!name) return;
    const watt = parseFloat(document.getElementById('elecDeviceWatt').value) || 0;
    const hoursPerDay = parseFloat(document.getElementById('elecDeviceHours').value) || 0;

    const plan = window.getElectricityPlan(window.currentBookId);
    const meter = plan.meters.find(function(m) { return m.id === meterId; });
    if (!meter) return;
    if (!Array.isArray(meter.devices)) meter.devices = [];
    if (id) {
        const device = meter.devices.find(function(d) { return d.id === id; });
        if (!device) return;
        device.name = name;
        device.watt = watt;
        device.hoursPerDay = hoursPerDay;
    } else {
        meter.devices.push({
            id: 'ed_' + Date.now() + Math.random().toString(36).slice(2, 7),
            name: name,
            watt: watt,
            hoursPerDay: hoursPerDay
        });
    }
    window.saveElectricityPlan(window.currentBookId, plan);
    window.closeModal('electricityDeviceModal');
    window.renderElectricityPlan();
    window.showToast(id ? 'Perangkat diperbarui.' : 'Perangkat ditambahkan.', 'success');
};

window.deleteElectricityDevice = function(meterId, deviceId) {
    if (window._elecBlockIfViewer()) return;
    const plan = window.getElectricityPlan(window.currentBookId);
    const meter = plan.meters.find(function(m) { return m.id === meterId; });
    if (!meter) return;
    meter.devices = (meter.devices || []).filter(function(d) { return d.id !== deviceId; });
    window.saveElectricityPlan(window.currentBookId, plan);
    window.renderElectricityPlan();
    window.showToast('Perangkat dihapus.', 'success');
};
