// ==================== DAFTAR MENU (JADWAL MASAK MINGGUAN) ====================
// Menu sidebar baru: jadwal menu masak untuk 1 minggu (Senin-Minggu), tiap
// menu punya daftar bahan (nama, qty, satuan). Semua bahan dari seluruh
// menu minggu itu otomatis dikumpulkan jadi satu "Estimasi Belanja
// Mingguan" yang dicocokkan ke harga referensi komoditas (js/harga-pangan.js,
// sama seperti Daftar Belanja) untuk memperkirakan total belanja. Tiap
// kartu hari juga menampilkan estimasi belanja HARIAN-nya sendiri (badge
// "≈ Rp ..." di sebelah nama hari) -- dihitung dengan cara yang sama,
// tapi dibatasi ke bahan menu hari itu saja (lihat
// window.aggregateMenuPlanBahanForDay & window._mplanEstimateDayTotal).
//
// Tersimpan lokal (localStorage) untuk akses instan/offline, DAN
// disinkronkan ke Supabase (tabel `settings`, key 'menu_plan', per book_id)
// mengikuti pola persis window.saveShoppingList (js/shopping-list.js).
// Nilai dienkripsi otomatis oleh pushSetting() sebelum dikirim ke cloud
// (kecuali buku bersama). Pull-nya ditangani terpusat di
// window.pullAllSettings (js/db.js).

window.MENU_PLAN_DAYS = [
    { key: 'senin', label: 'Senin' },
    { key: 'selasa', label: 'Selasa' },
    { key: 'rabu', label: 'Rabu' },
    { key: 'kamis', label: 'Kamis' },
    { key: 'jumat', label: 'Jumat' },
    { key: 'sabtu', label: 'Sabtu' },
    { key: 'minggu', label: 'Minggu' }
];
window.MENU_PLAN_WAKTU = ['Sarapan', 'Makan Siang', 'Makan Malam', 'Camilan'];
// Satuan bahan -- 'kg'/'gram' dan 'liter'/'ml' dikonversi otomatis saat
// dicocokkan ke satuan komoditas acuan (lihat window._mplanEstimateIngredient).
// Satuan lain hanya dihitung ke total kalau PERSIS sama dengan satuan
// komoditas acuan (mis. 'bungkus' utk Mie Instan, 'tabung' utk Gas Melon).
window.MENU_PLAN_UNITS = ['kg', 'gram', 'liter', 'ml', 'butir', 'buah', 'ikat', 'siung', 'bungkus', 'kaleng', 'dus', 'sdm', 'sdt', 'secukupnya'];

// Date.getDay(): 0=Minggu, 1=Senin, ..., 6=Sabtu -- dipetakan ke key hari
// yang dipakai window.MENU_PLAN_DAYS supaya kartu hari ini bisa disorot
// di renderMenuPlan().
window._mplanTodayKey = function() {
    const map = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    return map[new Date().getDay()];
};

window.getMenuPlan = function(bookId) {
    const raw = localStorage.getItem('sk_menu_plan_' + (bookId || window.currentBookId));
    let data = null;
    if (raw) {
        try { data = JSON.parse(raw); } catch { data = null; }
    }
    if (!data || typeof data !== 'object') data = {};
    // Pastikan semua 7 hari selalu ada (kalau belum pernah diisi) supaya
    // renderMenuPlan tidak perlu cek keberadaan tiap kali.
    window.MENU_PLAN_DAYS.forEach(function(d) {
        if (!Array.isArray(data[d.key])) data[d.key] = [];
    });
    return data;
};

window.saveMenuPlanToLocal = function(bookId, data) {
    localStorage.setItem('sk_menu_plan_' + (bookId || window.currentBookId), JSON.stringify(data));
};

window.saveMenuPlan = function(bookId, data) {
    const targetId = bookId || window.currentBookId;
    window.saveMenuPlanToLocal(targetId, data);
    // Sync ke cloud fire-and-forget, sama seperti window.saveShoppingList --
    // interaksi tetap terasa instan, kegagalan sync tidak menghalangi
    // perubahan lokal (akan tersinkron lagi di push/pull berikutnya).
    if (window.isOnline && window.isOnline() && window.pushSetting) {
        window.pushSetting('menu_plan', data, targetId).catch(function(e) {
            console.warn('[MenuPlan] Gagal sync ke cloud:', e);
            window.showToast && window.showToast('Perubahan tersimpan di perangkat ini, tapi gagal sinkron ke cloud. Menu tidak akan muncul di perangkat lain sampai sinkron berhasil.', 'error');
        });
    }
};

// ── Pembatasan role viewer (pola sama seperti window._slistIsViewer /
// window._slistBlockIfViewer di js/shopping-list.js). ──
window._mplanIsViewer = function() {
    return typeof window.skIsViewerOnCurrentBook === 'function' && window.skIsViewerOnCurrentBook();
};
window._mplanBlockIfViewer = function() {
    if (window._mplanIsViewer()) {
        window.showToast && window.showToast('Peran viewer di buku bersama ini hanya bisa melihat Daftar Menu, tidak bisa mengubahnya.', 'error');
        return true;
    }
    return false;
};

window.openMenuPlanView = function() {
    window.openModal('menuPlanModal');

    window.runAfterNextPaint(function() {
        const modal = document.getElementById('menuPlanModal');
        if (modal && modal.classList.contains('show')) window.renderMenuPlan();
        // Langsung scroll ke kartu hari ini supaya jawaban "harus masak apa
        // hari ini" kelihatan tanpa perlu cari-cari manual di antara 7 hari.
        // setTimeout kecil supaya menunggu layout halaman full-page selesai
        // (transisi buka halaman + render kartu) sebelum scrollIntoView.
        setTimeout(function() {
            const todayCard = document.getElementById('mplanTodayCard');
            if (todayCard) todayCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
    });

    // Sama seperti Daftar Belanja: tarik data terbaru dari cloud diam-diam
    // tiap kali halaman dibuka, supaya menu yang ditambah di device lain
    // ikut muncul tanpa harus keluar-masuk buku dulu.
    if (window.isOnline && window.isOnline() && typeof window.pullAllSettings === 'function') {
        const bookAtOpen = window.currentBookId;
        window.pullAllSettings().then(function() {
            const modalEl = document.getElementById('menuPlanModal');
            if (modalEl && modalEl.classList.contains('show') && window.currentBookId === bookAtOpen) {
                window.renderMenuPlan();
            }
        }).catch(function(e) {
            console.warn('[MenuPlan] Gagal tarik data terbaru dari cloud saat buka halaman:', e);
        });
    }

    // Tarik harga referensi komoditas (js/harga-pangan.js) supaya estimasi
    // belanja langsung terisi begitu halaman dibuka, bukan cuma setelah
    // Daftar Belanja/Harga Komoditas pernah dibuka lebih dulu.
    if (window.isOnline && window.isOnline() && typeof window.prefetchHargaPanganReferensi === 'function') {
        const bookAtOpen = window.currentBookId;
        window.prefetchHargaPanganReferensi().then(function() {
            const modalEl = document.getElementById('menuPlanModal');
            if (!modalEl || !modalEl.classList.contains('show') || window.currentBookId !== bookAtOpen) return;
            window.renderMenuPlan();
        }).catch(function(e) {
            console.warn('[MenuPlan] Gagal ambil harga referensi pangan:', e.message);
        });
    }
};

// ==================== RENDER ====================

window.renderMenuPlan = function() {
    const data = window.getMenuPlan(window.currentBookId);
    const container = document.getElementById('mplanDaysContainer');
    if (container) {
        const isViewer = window._mplanIsViewer();
        const todayKey = window._mplanTodayKey();
        container.innerHTML = window.MENU_PLAN_DAYS.map(function(d) {
            const meals = data[d.key] || [];
            const isToday = d.key === todayKey;
            const isEmpty = meals.length === 0;
            // Hari tanpa menu TIDAK lagi menampilkan paragraf "Belum ada
            // menu." + wrapper .mplan-meal-list kosong -- di layar hp,
            // kartu-kartu kosong ini (biasanya mayoritas di awal minggu)
            // paling banyak makan ruang vertikal tanpa info baru (tombol
            // "+ Tambah Menu" di header sudah cukup menjelaskan kartu ini
            // masih kosong). Class `is-empty` dipakai CSS mobile untuk
            // memangkas padding bawah kartu kosong lebih jauh.
            const mealsHtml = meals.length
                ? `<div class="mplan-meal-list">${meals.map(function(m) {
                    const bahanSummary = (m.bahan || []).map(function(b) {
                        return window.escapeHtml(b.name) + (b.qty ? ` (${window._mplanFormatQty(b.qty)} ${window.escapeHtml(b.unit || '')})` : '');
                    }).join(', ');
                    return `
                        <div class="mplan-meal">
                            <div class="mplan-meal-main">
                                <span class="mplan-meal-waktu">${window.escapeHtml(m.waktu || '')}</span>
                                <span class="mplan-meal-nama">${window.escapeHtml(m.nama || '')}</span>
                                ${bahanSummary ? `<span class="mplan-meal-bahan">${bahanSummary}</span>` : ''}
                            </div>
                            ${isViewer ? '' : `
                            <div class="mplan-meal-trail">
                                <button type="button" class="mplan-meal-edit-btn" title="Ubah menu" aria-label="Ubah menu" onclick="window.openEditMenuPlanMealModal('${d.key}','${m.id}')"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg></button>
                                <button type="button" class="mplan-meal-del-btn" title="Hapus menu" aria-label="Hapus menu" onclick="window.deleteMenuPlanMeal('${d.key}','${m.id}')"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                            </div>`}
                        </div>`;
                }).join('')}</div>`
                : '';
            const dayEstimate = window._mplanEstimateDayTotal(data, d.key);
            let dayEstimateHtml = '';
            if (dayEstimate.hasIngredients) {
                const title = dayEstimate.unmatchedCount
                    ? `${dayEstimate.unmatchedCount} bahan hari ini belum punya harga acuan komoditas -- belum termasuk di angka ini.`
                    : 'Perkiraan belanja hari ini berdasarkan harga referensi komoditas.';
                dayEstimateHtml = `<span class="mplan-day-estimate" title="${window.escapeHtml(title)}">≈ ${window.rp(dayEstimate.total)}${dayEstimate.unmatchedCount ? '*' : ''}</span>`;
            }
            return `
                <div class="mplan-day-card${isToday ? ' is-today' : ''}${isEmpty ? ' is-empty' : ''}"${isToday ? ' id="mplanTodayCard"' : ''}>
                    <div class="mplan-day-header">
                        <span class="mplan-day-label">${d.label}${isToday ? '<span class="mplan-today-badge">Hari Ini</span>' : ''}${dayEstimateHtml}</span>
                        ${isViewer ? '' : `<button type="button" class="mplan-add-meal-btn" title="Tambah Menu" onclick="window.openAddMenuPlanMealModal('${d.key}')">+ <span class="mplan-add-meal-btn-full">Tambah Menu</span><span class="mplan-add-meal-btn-short">Menu</span></button>`}
                    </div>
                    ${mealsHtml}
                </div>`;
        }).join('');
    }
    window.renderMenuPlanEstimate(data);
};

window._mplanFormatQty = function(qty) {
    const n = Number(qty);
    if (!isFinite(n)) return qty;
    return (Math.round(n * 100) / 100).toString().replace('.', ',');
};

// Kumpulkan SEMUA bahan dari seluruh hari & menu jadi satu daftar, gabung
// (jumlahkan qty) untuk nama+satuan yang sama -- supaya bahan yang dipakai
// berulang kali dalam seminggu (mis. "Bawang Merah" tiap hari) tidak
// tampil sebagai baris estimasi terpisah-pisah.
window.aggregateMenuPlanBahan = function(data) {
    const map = new Map();
    window.MENU_PLAN_DAYS.forEach(function(d) {
        (data[d.key] || []).forEach(function(meal) {
            (meal.bahan || []).forEach(function(b) {
                const name = (b.name || '').trim();
                if (!name) return;
                const unit = (b.unit || '').trim();
                const qty = Number(b.qty) || 0;
                const key = name.toLowerCase() + '|' + unit.toLowerCase();
                if (map.has(key)) {
                    map.get(key).qty += qty;
                } else {
                    map.set(key, { name: name, unit: unit, qty: qty });
                }
            });
        });
    });
    return Array.from(map.values()).sort(function(a, b) { return a.name.localeCompare(b.name); });
};

// Cocokkan 1 bahan ke harga referensi komoditas & hitung subtotal, dengan
// konversi satuan sederhana (gram->kg, ml->liter) supaya input bahan yang
// wajar dipakai di resep (mis. "200 gram" bukan "0,2 kg") tetap kena harga
// acuan yang disimpan per kg. Satuan lain yang tidak cocok PERSIS dengan
// satuan komoditas dianggap tidak bisa dihitung otomatis (unitMismatch).
window._mplanEstimateIngredient = function(name, qty, unit) {
    if (typeof window.getHargaPanganUntukItem !== 'function') return { matched: false };
    const ref = window.getHargaPanganUntukItem(name);
    if (!ref) return { matched: false };
    const u = (unit || '').trim().toLowerCase();
    const refUnit = (ref.unit || '').trim().toLowerCase();
    let normQty = null;
    if (u === refUnit) {
        normQty = qty;
    } else if (u === 'gram' && refUnit === 'kg') {
        normQty = qty / 1000;
    } else if (u === 'ml' && refUnit === 'liter') {
        normQty = qty / 1000;
    }
    if (normQty === null) return { matched: true, ref: ref, subtotal: null, unitMismatch: true };
    return { matched: true, ref: ref, subtotal: normQty * ref.price, unitMismatch: false };
};

// Sama seperti aggregateMenuPlanBahan, tapi dibatasi ke SATU hari saja --
// dipakai untuk estimasi belanja per hari (lihat window._mplanEstimateDayTotal
// & badge di kartu hari, renderMenuPlan). Menjumlahkan qty bahan yang sama
// dalam hari itu (mis. dipakai di menu sarapan & makan malam sekaligus).
window.aggregateMenuPlanBahanForDay = function(data, dayKey) {
    const map = new Map();
    (data[dayKey] || []).forEach(function(meal) {
        (meal.bahan || []).forEach(function(b) {
            const name = (b.name || '').trim();
            if (!name) return;
            const unit = (b.unit || '').trim();
            const qty = Number(b.qty) || 0;
            const key = name.toLowerCase() + '|' + unit.toLowerCase();
            if (map.has(key)) {
                map.get(key).qty += qty;
            } else {
                map.set(key, { name: name, unit: unit, qty: qty });
            }
        });
    });
    return Array.from(map.values()).sort(function(a, b) { return a.name.localeCompare(b.name); });
};

// Total estimasi belanja untuk satu hari, pakai harga referensi komoditas
// yang sama dengan estimasi mingguan (window._mplanEstimateIngredient).
// unmatchedCount = jumlah bahan hari itu yang belum bisa dihitung otomatis
// (belum ada harga acuan, atau satuannya beda) -- dipakai untuk tooltip
// supaya user tahu angka yang ditampilkan belum tentu lengkap.
window._mplanEstimateDayTotal = function(data, dayKey) {
    const aggregated = window.aggregateMenuPlanBahanForDay(data, dayKey);
    let total = 0;
    let unmatchedCount = 0;
    aggregated.forEach(function(item) {
        const est = window._mplanEstimateIngredient(item.name, item.qty, item.unit);
        if (est.matched && est.subtotal !== null) {
            total += est.subtotal;
        } else {
            unmatchedCount++;
        }
    });
    return { total: total, unmatchedCount: unmatchedCount, hasIngredients: aggregated.length > 0 };
};

window.renderMenuPlanEstimate = function(data) {
    data = data || window.getMenuPlan(window.currentBookId);
    const aggregated = window.aggregateMenuPlanBahan(data);
    const listEl = document.getElementById('mplanEstimateList');
    const emptyEl = document.getElementById('mplanEstimateEmpty');
    const totalEl = document.getElementById('mplanEstimateTotal');
    window._mplanLastAggregated = aggregated;

    if (!aggregated.length) {
        if (listEl) listEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
        if (totalEl) totalEl.innerText = window.rp(0);
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    let total = 0;
    let unmatchedCount = 0;
    if (listEl) {
        listEl.innerHTML = aggregated.map(function(item) {
            const est = window._mplanEstimateIngredient(item.name, item.qty, item.unit);
            let priceHtml = '<span class="mplan-estimate-price is-unknown">-</span>';
            if (est.matched && est.subtotal !== null) {
                total += est.subtotal;
                priceHtml = `<span class="mplan-estimate-price is-ref-price">≈ ${window.rp(est.subtotal)}</span>`;
            } else if (est.matched && est.unitMismatch) {
                unmatchedCount++;
                priceHtml = `<span class="mplan-estimate-price is-unknown" title="Satuan bahan berbeda dari satuan acuan (${window.escapeHtml(est.ref.unit)}) -- tidak bisa dihitung otomatis.">satuan beda</span>`;
            } else {
                unmatchedCount++;
            }
            return `
                <div class="mplan-estimate-row">
                    <span class="mplan-estimate-name">${window.escapeHtml(item.name)}</span>
                    <span class="mplan-estimate-qty">${window._mplanFormatQty(item.qty)} ${window.escapeHtml(item.unit || '')}</span>
                    ${priceHtml}
                </div>`;
        }).join('');
    }
    if (totalEl) totalEl.innerText = window.rp(total);
    const noteEl = document.getElementById('mplanEstimateNote');
    if (noteEl) {
        noteEl.innerText = unmatchedCount
            ? `${unmatchedCount} bahan belum punya harga acuan komoditas -- estimasi di atas belum termasuk bahan tersebut.`
            : '';
    }
};

// ==================== FORM TAMBAH/UBAH MENU ====================

window._mplanBahanRows = []; // draft baris bahan yang sedang diedit di form

window.openAddMenuPlanMealModal = function(dayKey) {
    if (window._mplanBlockIfViewer()) return;
    document.getElementById('mplanMealModalTitle').innerText = 'Tambah Menu';
    document.getElementById('mplanMealId').value = '';
    document.getElementById('mplanMealDay').value = dayKey;
    document.getElementById('mplanMealNama').value = '';
    window._mplanPopulateWaktuSelect();
    document.getElementById('mplanMealWaktu').value = window.MENU_PLAN_WAKTU[0];
    window._mplanBahanRows = [{ id: 'r0', name: '', qty: '', unit: 'kg' }];
    window._mplanRenderBahanRows();
    window.openModal('menuPlanMealModal');
};

window.openEditMenuPlanMealModal = function(dayKey, mealId) {
    if (window._mplanBlockIfViewer()) return;
    const data = window.getMenuPlan(window.currentBookId);
    const meal = (data[dayKey] || []).find(function(m) { return m.id === mealId; });
    if (!meal) return;
    document.getElementById('mplanMealModalTitle').innerText = 'Ubah Menu';
    document.getElementById('mplanMealId').value = meal.id;
    document.getElementById('mplanMealDay').value = dayKey;
    document.getElementById('mplanMealNama').value = meal.nama || '';
    window._mplanPopulateWaktuSelect();
    document.getElementById('mplanMealWaktu').value = meal.waktu || window.MENU_PLAN_WAKTU[0];
    window._mplanBahanRows = (meal.bahan && meal.bahan.length)
        ? meal.bahan.map(function(b, i) { return { id: 'r' + i, name: b.name, qty: b.qty, unit: b.unit }; })
        : [{ id: 'r0', name: '', qty: '', unit: 'kg' }];
    window._mplanRenderBahanRows();
    window.openModal('menuPlanMealModal');
};

window._mplanPopulateWaktuSelect = function() {
    const sel = document.getElementById('mplanMealWaktu');
    if (!sel) return;
    sel.innerHTML = window.MENU_PLAN_WAKTU.map(function(w) {
        return `<option value="${window.escapeHtml(w)}">${window.escapeHtml(w)}</option>`;
    }).join('');
};

window._mplanRenderBahanRows = function() {
    const wrap = document.getElementById('mplanBahanRows');
    if (!wrap) return;
    wrap.innerHTML = window._mplanBahanRows.map(function(row) {
        return `
            <div class="mplan-bahan-row" data-row-id="${row.id}">
                <input type="text" class="form-control mplan-bahan-name" placeholder="Nama bahan" value="${window.escapeHtml(row.name || '')}" oninput="window._mplanUpdateBahanRow('${row.id}','name',this.value)">
                <input type="number" class="form-control mplan-bahan-qty" placeholder="Qty" min="0" step="any" inputmode="decimal" value="${row.qty || ''}" oninput="window._mplanUpdateBahanRow('${row.id}','qty',this.value)">
                <select class="form-control mplan-bahan-unit" onchange="window._mplanUpdateBahanRow('${row.id}','unit',this.value)">
                    ${window.MENU_PLAN_UNITS.map(function(u) {
                        return `<option value="${u}" ${row.unit === u ? 'selected' : ''}>${u}</option>`;
                    }).join('')}
                </select>
                <button type="button" class="slist-del-btn" title="Hapus bahan" onclick="window.removeMenuPlanBahanRow('${row.id}')">✕</button>
            </div>`;
    }).join('');
};

window._mplanUpdateBahanRow = function(rowId, field, value) {
    const row = window._mplanBahanRows.find(function(r) { return r.id === rowId; });
    if (row) row[field] = value;
};

window.addMenuPlanBahanRow = function() {
    window._mplanBahanRows.push({ id: 'r' + Date.now() + Math.random().toString(36).slice(2, 5), name: '', qty: '', unit: 'kg' });
    window._mplanRenderBahanRows();
};

window.removeMenuPlanBahanRow = function(rowId) {
    if (window._mplanBahanRows.length <= 1) {
        // Jangan sampai form tanpa baris bahan sama sekali -- kosongkan
        // saja baris terakhirnya, bukan dihapus habis.
        window._mplanBahanRows = [{ id: 'r0', name: '', qty: '', unit: 'kg' }];
    } else {
        window._mplanBahanRows = window._mplanBahanRows.filter(function(r) { return r.id !== rowId; });
    }
    window._mplanRenderBahanRows();
};

window.saveMenuPlanMeal = function(e) {
    e.preventDefault();
    if (window._mplanBlockIfViewer()) return;
    const id = document.getElementById('mplanMealId').value;
    const dayKey = document.getElementById('mplanMealDay').value;
    const waktu = document.getElementById('mplanMealWaktu').value;
    const nama = document.getElementById('mplanMealNama').value.trim();
    if (!nama || !dayKey) return;

    const bahan = window._mplanBahanRows
        .filter(function(r) { return (r.name || '').trim(); })
        .map(function(r) {
            return {
                id: 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: r.name.trim(),
                qty: parseFloat(r.qty) || 0,
                unit: r.unit || 'kg'
            };
        });

    const data = window.getMenuPlan(window.currentBookId);
    if (!Array.isArray(data[dayKey])) data[dayKey] = [];

    if (id) {
        const meal = data[dayKey].find(function(m) { return m.id === id; });
        if (meal) {
            meal.waktu = waktu;
            meal.nama = nama;
            meal.bahan = bahan;
        }
    } else {
        data[dayKey].push({
            id: 'mp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            waktu: waktu,
            nama: nama,
            bahan: bahan
        });
    }

    window.saveMenuPlan(window.currentBookId, data);
    window.closeModal('menuPlanMealModal');
    window.renderMenuPlan();
    window.showToast && window.showToast(id ? 'Menu diperbarui.' : 'Menu ditambahkan.', 'success');
};

window.deleteMenuPlanMeal = async function(dayKey, mealId) {
    if (window._mplanBlockIfViewer()) return;
    const confirmed = await window.customConfirm({
        title: 'Hapus Menu',
        message: 'Hapus menu ini dari jadwal? Bahan-bahannya juga akan hilang dari estimasi belanja mingguan.',
        confirmLabel: 'Hapus'
    });
    if (!confirmed) return;
    const data = window.getMenuPlan(window.currentBookId);
    data[dayKey] = (data[dayKey] || []).filter(function(m) { return m.id !== mealId; });
    window.saveMenuPlan(window.currentBookId, data);
    window.renderMenuPlan();
    window.showToast && window.showToast('Menu dihapus.', 'success');
};

// ==================== KIRIM ESTIMASI KE DAFTAR BELANJA BULANAN ====================
// Menambahkan seluruh bahan yang sudah dikumpulkan (window._mplanLastAggregated)
// sebagai barang baru ke Daftar Belanja (js/shopping-list.js), lengkap
// dengan harga referensi komoditas yang sudah cocok -- supaya user tidak
// perlu ketik ulang satu-satu bahan yang sama persis di Daftar Belanja.
window.pushMenuPlanEstimateToShoppingList = function() {
    if (window._mplanBlockIfViewer()) return;
    const aggregated = window._mplanLastAggregated || window.aggregateMenuPlanBahan(window.getMenuPlan(window.currentBookId));
    if (!aggregated.length) {
        window.showToast && window.showToast('Belum ada bahan di jadwal menu minggu ini.', 'warning');
        return;
    }
    const items = window.getShoppingList(window.currentBookId);
    const existingNames = new Set(items.map(function(i) { return (i.name || '').trim().toLowerCase(); }));
    let added = 0;
    aggregated.forEach(function(ing) {
        const key = ing.name.trim().toLowerCase();
        if (existingNames.has(key)) return; // hindari duplikat kalau sudah ada barang dengan nama sama
        const est = window._mplanEstimateIngredient(ing.name, ing.qty, ing.unit);
        const price = (est.matched && !est.unitMismatch) ? est.ref.price : 0;
        items.push({
            id: 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: ing.name,
            qty: Math.max(1, Math.round(ing.qty) || 1),
            price: price,
            priceSource: price ? 'ref' : undefined,
            priceRefDate: (est.matched && est.ref) ? est.ref.date : undefined,
            category: '',
            done: false
        });
        existingNames.add(key);
        added++;
    });
    if (!added) {
        window.showToast && window.showToast('Semua bahan sudah ada di Daftar Belanja.', 'warning');
        return;
    }
    window.saveShoppingList(window.currentBookId, items);
    window.showToast && window.showToast(`${added} bahan ditambahkan ke Daftar Belanja Bulanan.`, 'success');
};
