// ==================== DAFTAR MENU (JADWAL MASAK 2 MINGGUAN) ====================
// Menu sidebar baru: jadwal menu masak untuk 2 minggu (Minggu 1 & Minggu 2,
// masing-masing Senin-Minggu), tiap menu punya daftar bahan (nama, qty,
// satuan). Data disimpan per-minggu: { w1: {senin:[],...}, w2: {senin:[],...} }
// -- lihat window.MENU_PLAN_WEEKS & window.getMenuPlan. User berpindah
// minggu lewat tab (window.switchMenuPlanWeek); tab yang cocok dengan
// minggu kalender berjalan ditentukan otomatis & konsisten lewat
// window._mplanCurrentWeekKey() (paritas nomor minggu sejak epoch), supaya
// badge "Hari Ini" & tab default saat buka halaman selalu pas.
//
// Semua bahan dari seluruh menu DALAM SATU MINGGU YANG SAMA otomatis
// dikumpulkan jadi satu "Estimasi Belanja Mingguan" yang dicocokkan ke
// harga referensi komoditas (js/harga-pangan.js, sama seperti Daftar
// Belanja) untuk memperkirakan total belanja minggu itu. Tiap kartu hari
// juga menampilkan estimasi belanja HARIAN-nya sendiri (badge "≈ Rp ..."
// di sebelah nama hari) -- dihitung dengan cara yang sama, tapi dibatasi
// ke bahan menu hari itu saja (lihat window.aggregateMenuPlanBahanForDay &
// window._mplanEstimateDayTotal).
//
// Tersimpan lokal (localStorage) untuk akses instan/offline, DAN
// disinkronkan ke Supabase (tabel `settings`, key 'menu_plan', per book_id)
// mengikuti pola persis window.saveShoppingList (js/shopping-list.js).
// Nilai dienkripsi otomatis oleh pushSetting() sebelum dikirim ke cloud
// (kecuali buku bersama). Pull-nya ditangani terpusat di
// window.pullAllSettings (js/db.js).
//
// Data lama (format 1 minggu, day-key langsung di root) dimigrasi otomatis
// jadi isi Minggu 1 pertama kali dibuka -- lihat window.getMenuPlan.

window.MENU_PLAN_WEEKS = [
    { key: 'w1', label: 'Minggu 1' },
    { key: 'w2', label: 'Minggu 2' }
];
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

// Menentukan tab minggu ('w1'/'w2') yang cocok dengan minggu kalender
// berjalan, berdasarkan paritas nomor minggu sejak epoch -- fungsi murni
// dari tanggal hari ini saja (tidak perlu state tersimpan), jadi hasilnya
// otomatis bergantian tiap minggu & konsisten di semua perangkat. Dipakai
// untuk badge "Hari Ini" dan tab default saat halaman dibuka.
window._mplanCurrentWeekKey = function() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const daysSinceEpoch = Math.floor(startOfDay.getTime() / 86400000);
    const weekIndex = Math.floor(daysSinceEpoch / 7);
    return (weekIndex % 2 === 0) ? 'w1' : 'w2';
};

window.getMenuPlan = function(bookId) {
    const raw = localStorage.getItem('sk_menu_plan_' + (bookId || window.currentBookId));
    let data = null;
    if (raw) {
        try { data = JSON.parse(raw); } catch { data = null; }
    }
    if (!data || typeof data !== 'object') data = {};

    // Migrasi data lama (format 1 minggu, day-key langsung di root, mis.
    // {senin:[...], selasa:[...]}) ke format 2 minggu {w1:{...}, w2:{...}}
    // -- supaya jadwal yang sudah pernah diisi user tidak hilang, otomatis
    // jadi isi Minggu 1 saat pertama kali dibuka setelah update ini.
    const looksLikeOldFormat = !data.w1 && !data.w2 && window.MENU_PLAN_DAYS.some(function(d) {
        return Array.isArray(data[d.key]);
    });
    if (looksLikeOldFormat) {
        const migrated = {};
        window.MENU_PLAN_DAYS.forEach(function(d) { migrated[d.key] = data[d.key] || []; });
        data = { w1: migrated, w2: {} };
    }

    // Pastikan kedua minggu & semua 7 hari di tiap minggu selalu ada
    // (kalau belum pernah diisi) supaya renderMenuPlan tidak perlu cek
    // keberadaan tiap kali.
    window.MENU_PLAN_WEEKS.forEach(function(w) {
        if (!data[w.key] || typeof data[w.key] !== 'object') data[w.key] = {};
        window.MENU_PLAN_DAYS.forEach(function(d) {
            if (!Array.isArray(data[w.key][d.key])) data[w.key][d.key] = [];
        });
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
            window.skWarn('[MenuPlan] Gagal sync ke cloud:', e);
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
    // Setiap kali halaman dibuka, defaultkan tab ke minggu yang cocok
    // dengan minggu kalender berjalan -- supaya "harus masak apa hari ini"
    // langsung kelihatan tanpa perlu pindah tab dulu. User tetap bisa
    // pindah manual ke minggu lain lewat tab selama halaman ini terbuka.
    window._mplanActiveWeek = window._mplanCurrentWeekKey();
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
            window.skWarn('[MenuPlan] Gagal tarik data terbaru dari cloud saat buka halaman:', e);
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
            window.skWarn('[MenuPlan] Gagal ambil harga referensi pangan:', e.message);
        });
    }
};

// ==================== RENDER ====================

window.switchMenuPlanWeek = function(weekKey) {
    window._mplanActiveWeek = weekKey;
    window.renderMenuPlan();
};

window.renderMenuPlan = function() {
    const data = window.getMenuPlan(window.currentBookId);
    const activeWeek = window._mplanActiveWeek || (window._mplanActiveWeek = window._mplanCurrentWeekKey());
    const weekData = data[activeWeek];
    const currentWeekKey = window._mplanCurrentWeekKey();

    const tabsContainer = document.getElementById('mplanWeekTabs');
    if (tabsContainer) {
        tabsContainer.innerHTML = window.MENU_PLAN_WEEKS.map(function(w) {
            const isCurrentCalendarWeek = w.key === currentWeekKey;
            return `<button type="button" class="mplan-week-tab${w.key === activeWeek ? ' is-active' : ''}" onclick="window.switchMenuPlanWeek('${w.key}')">${w.label}${isCurrentCalendarWeek ? '<span class="mplan-week-tab-dot" title="Minggu kalender berjalan"></span>' : ''}</button>`;
        }).join('');
    }

    const container = document.getElementById('mplanDaysContainer');
    if (container) {
        const isViewer = window._mplanIsViewer();
        const todayKey = window._mplanTodayKey();
        container.innerHTML = window.MENU_PLAN_DAYS.map(function(d) {
            const meals = weekData[d.key] || [];
            const isToday = activeWeek === currentWeekKey && d.key === todayKey;
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
                                <button type="button" class="slist-edit-btn" title="Ubah" onclick="window.openEditMenuPlanMealModal('${activeWeek}','${d.key}','${m.id}')"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 21h8"/><path d="m15 5 4 4"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg></button>
                                <button type="button" class="slist-del-btn" title="Hapus" onclick="window.deleteMenuPlanMeal('${activeWeek}','${d.key}','${m.id}')"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                            </div>`}
                        </div>`;
                }).join('')}</div>`
                : '';
            const dayEstimate = window._mplanEstimateDayTotal(weekData, d.key);
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
                        ${isViewer ? '' : `<button type="button" class="mplan-add-meal-btn" title="Tambah Menu" onclick="window.openAddMenuPlanMealModal('${activeWeek}','${d.key}')">+ <span class="mplan-add-meal-btn-full">Tambah Menu</span><span class="mplan-add-meal-btn-short">Menu</span></button>`}
                    </div>
                    ${mealsHtml}
                </div>`;
        }).join('');
    }
    window.renderMenuPlanEstimate(weekData, activeWeek);
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
    return { matched: true, ref: ref, subtotal: normQty * ref.price, normQty: normQty, unitMismatch: false };
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

window.renderMenuPlanEstimate = function(weekData, weekKey) {
    const activeWeek = weekKey || window._mplanActiveWeek || 'w1';
    weekData = weekData || window.getMenuPlan(window.currentBookId)[activeWeek];
    const aggregated = window.aggregateMenuPlanBahan(weekData);
    const listEl = document.getElementById('mplanEstimateList');
    const emptyEl = document.getElementById('mplanEstimateEmpty');
    const totalEl = document.getElementById('mplanEstimateTotal');
    const labelEl = document.getElementById('mplanEstimateHeaderLabel');
    if (labelEl) {
        const weekMeta = window.MENU_PLAN_WEEKS.find(function(w) { return w.key === activeWeek; });
        labelEl.innerText = `Estimasi Belanja ${weekMeta ? weekMeta.label : 'Mingguan'}`;
    }
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

window.openAddMenuPlanMealModal = function(weekKey, dayKey) {
    if (window._mplanBlockIfViewer()) return;
    document.getElementById('mplanMealModalTitle').innerText = 'Tambah Menu';
    document.getElementById('mplanMealId').value = '';
    document.getElementById('mplanMealWeek').value = weekKey;
    document.getElementById('mplanMealDay').value = dayKey;
    document.getElementById('mplanMealNama').value = '';
    window._mplanPopulateWaktuSelect();
    document.getElementById('mplanMealWaktu').value = window.MENU_PLAN_WAKTU[0];
    window._mplanBahanRows = [{ id: 'r0', name: '', qty: '', unit: 'kg' }];
    window._mplanRenderBahanRows();
    window.openModal('menuPlanMealModal');
};

window.openEditMenuPlanMealModal = function(weekKey, dayKey, mealId) {
    if (window._mplanBlockIfViewer()) return;
    const data = window.getMenuPlan(window.currentBookId);
    const weekData = data[weekKey] || {};
    const meal = (weekData[dayKey] || []).find(function(m) { return m.id === mealId; });
    if (!meal) return;
    document.getElementById('mplanMealModalTitle').innerText = 'Ubah Menu';
    document.getElementById('mplanMealId').value = meal.id;
    document.getElementById('mplanMealWeek').value = weekKey;
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
    const weekKey = document.getElementById('mplanMealWeek').value || 'w1';
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
    if (!data[weekKey] || typeof data[weekKey] !== 'object') data[weekKey] = {};
    if (!Array.isArray(data[weekKey][dayKey])) data[weekKey][dayKey] = [];

    if (id) {
        const meal = data[weekKey][dayKey].find(function(m) { return m.id === id; });
        if (meal) {
            meal.waktu = waktu;
            meal.nama = nama;
            meal.bahan = bahan;
        }
    } else {
        data[weekKey][dayKey].push({
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

window.deleteMenuPlanMeal = async function(weekKey, dayKey, mealId) {
    if (window._mplanBlockIfViewer()) return;
    const confirmed = await window.customConfirm({
        title: 'Hapus Menu',
        message: 'Hapus menu ini dari jadwal? Bahan-bahannya juga akan hilang dari estimasi belanja minggu itu.',
        confirmLabel: 'Hapus'
    });
    if (!confirmed) return;
    const data = window.getMenuPlan(window.currentBookId);
    if (!data[weekKey]) return;
    data[weekKey][dayKey] = (data[weekKey][dayKey] || []).filter(function(m) { return m.id !== mealId; });
    window.saveMenuPlan(window.currentBookId, data);
    window.renderMenuPlan();
    window.showToast && window.showToast('Menu dihapus.', 'success');
};

// ==================== KIRIM ESTIMASI KE DAFTAR BELANJA BULANAN ====================
// Menambahkan seluruh bahan yang sudah dikumpulkan (window._mplanLastAggregated)
// ke Daftar Belanja (js/shopping-list.js), lengkap dengan harga referensi
// komoditas yang sudah cocok -- supaya user tidak perlu ketik ulang
// satu-satu bahan yang sama persis di Daftar Belanja.
//
// Barang hasil push ditandai `item.mplanKey` (nama bahan, lowercase) supaya
// push BERIKUTNYA (mis. dari minggu lain, atau setelah jadwal menu diubah)
// bisa MENGUPDATE jumlah & harga barang yang sama, bukan cuma skip diam-diam
// seperti sebelumnya -- supaya kalau "Bawang Merah" dipakai di Minggu 1 & 2
// dengan jumlah beda, Daftar Belanja tetap mencerminkan total yang benar.
// Barang yang sudah ada TAPI bukan hasil push (ditambah manual oleh user,
// tanpa mplanKey) tetap TIDAK disentuh sama sekali -- dianggap sudah "milik"
// user, cuma dihitung sebagai "sudah ada" di ringkasan. Barang hasil push
// yang harganya sudah pernah diedit manual (priceSource 'manual') juga tidak
// pernah ditimpa lagi, mengikuti pola yang sama dengan
// window._applyHargaPanganReferensiToShoppingList.
window.pushMenuPlanEstimateToShoppingList = function() {
    if (window._mplanBlockIfViewer()) return;
    const activeWeek = window._mplanActiveWeek || 'w1';
    const weekMeta = window.MENU_PLAN_WEEKS.find(function(w) { return w.key === activeWeek; });
    const weekLabel = weekMeta ? weekMeta.label : 'ini';
    const aggregated = window._mplanLastAggregated || window.aggregateMenuPlanBahan(window.getMenuPlan(window.currentBookId)[activeWeek]);
    if (!aggregated.length) {
        window.showToast && window.showToast(`Belum ada bahan di jadwal menu ${weekLabel}.`, 'warning');
        return;
    }
    const items = window.getShoppingList(window.currentBookId);
    // Index barang yang sudah ada: barang hasil push sebelumnya dicari lewat
    // mplanKey; barang manual (tanpa mplanKey) dicari lewat nama, sama
    // seperti perilaku dedup lama -- supaya tidak menimpa barang yang user
    // tambahkan sendiri.
    const byKey = new Map();
    items.forEach(function(item) {
        const k = item.mplanKey || (item.name || '').trim().toLowerCase();
        if (!byKey.has(k)) byKey.set(k, item);
    });

    let added = 0, updated = 0, skippedManual = 0;
    aggregated.forEach(function(ing) {
        const key = ing.name.trim().toLowerCase();
        const est = window._mplanEstimateIngredient(ing.name, ing.qty, ing.unit);
        // Kalau bahan cocok ke komoditas acuan & satuannya sesuai: pakai
        // jumlah HASIL KONVERSI (mis. gram->kg) apa adanya, TIDAK dibulatkan
        // paksa ke bilangan bulat -- field qty di Daftar Belanja sudah
        // mendukung desimal, dan harga acuan dihitung per satuan itu (mis.
        // per kg), jadi qty pecahan (mis. 0,3) memang perlu supaya
        // Qty x Harga di Daftar Belanja tetap = perkiraan biaya bahan itu
        // yang benar (sebelumnya dibulatkan minimal 1, jadi bahan dalam
        // jumlah kecil bisa dihitung seolah 1 kg penuh -- taksiran jauh
        // meleset lebih mahal).
        const matched = est.matched && !est.unitMismatch;
        let qty = Math.round((matched ? est.normQty : ing.qty) * 100) / 100;
        if (!(qty > 0)) qty = ing.qty > 0 ? Math.round(ing.qty * 100) / 100 : 1;
        const price = matched ? est.ref.price : 0;

        const existing = byKey.get(key);
        if (existing) {
            if (!existing.mplanKey) { skippedManual++; return; } // barang manual, jangan disentuh
            const priceLocked = existing.priceSource === 'manual';
            let changed = false;
            if (!priceLocked) {
                if (existing.qty !== qty) { existing.qty = qty; changed = true; }
                if (existing.price !== price) {
                    existing.price = price;
                    existing.priceSource = price ? 'ref' : existing.priceSource;
                    existing.priceRefDate = (matched && est.ref) ? est.ref.date : existing.priceRefDate;
                    changed = true;
                }
            }
            if (changed) updated++;
            return;
        }

        const newItem = {
            id: 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name: ing.name,
            qty: qty,
            price: price,
            priceSource: price ? 'ref' : undefined,
            priceRefDate: (matched && est.ref) ? est.ref.date : undefined,
            category: 'Belanja Harian',
            done: false,
            mplanKey: key
        };
        items.push(newItem);
        byKey.set(key, newItem);
        added++;
    });

    if (!added && !updated) {
        window.showToast && window.showToast(
            skippedManual ? 'Semua bahan sudah ada di Daftar Belanja (ditambahkan manual sebelumnya).' : 'Semua bahan sudah sesuai di Daftar Belanja.',
            'warning'
        );
        return;
    }
    window.saveShoppingList(window.currentBookId, items);
    const parts = [];
    if (added) parts.push(`${added} ditambahkan`);
    if (updated) parts.push(`${updated} diperbarui`);
    if (skippedManual) parts.push(`${skippedManual} sudah ada manual`);
    window.showToast && window.showToast(`Daftar Belanja dari ${weekLabel}: ${parts.join(', ')}.`, 'success');
};
