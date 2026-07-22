/* ============================================================
   DONATUR, TRANSAKSI, OPERASIONAL (dengan auth check)
   ============================================================ */
function renderDonatur(){
  const list = gDonatur().slice().sort((a,b)=>(b.tanggal||'').localeCompare(a.tanggal||''));
  const total = list.reduce((s,d)=>s+Number(d.jumlah||0),0);
  const isLoggedIn = !!getCurrentUser();
  const rows = list.map(d=>`<tr${isLoggedIn ? ` class="row-clickable" onclick="openDonaturModal('${d.id}')"` : ''}><td>${fmtDateShort(d.tanggal)}</td><td>${esc(d.nama_donatur)}</td><td>${esc(d.keterangan||'-')}</td><td class="num">${fmtRp(d.jumlah)}</td>${isLoggedIn ? `<td style="text-align:right;">
    <button class="icon-btn" onclick="event.stopPropagation();hapusDonatur('${d.id}')">🗑</button>
  </td>` : ''}</tr>`).join('');
  return `<div class="stat-grid"><div class="stat-card pemasukan"><div class="lbl">Total Donasi</div><div class="val">${fmtRp(total)}</div></div></div>
  <div class="panel"><div class="panel-head"><h3>Daftar Donatur</h3>${isLoggedIn ? `<button class="btn" onclick="openDonaturModal()">+ Tambah</button>` : ''}</div>
  <div class="panel-body flush"><table class="general-table tanggal-nominal-table"><thead><tr><th>Tanggal</th><th>Nama</th><th>Keterangan</th><th class="num">Jumlah</th>${isLoggedIn ? '<th></th>' : ''}</tr></thead>
  <tbody>${rows||`<tr class="empty-row"><td colspan="${isLoggedIn?5:4}">Belum ada donasi.</td></tr>`}</tbody></table></div></div>`;
}
function openDonaturModal(id){
  if (!canEditSection('donatur')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.donatur.find(d=>d.id===id) : null;
  setModal(editing?'Edit Donasi':'Tambah Donasi', `
    <div class="field"><label>Nama Donatur</label><input id="f-nama" value="${editing?esc(editing.nama_donatur):''}"></div>
    <div class="field-row"><div class="field"><label>Jumlah (Rp)</label><input id="f-jumlah" class="currency-input" type="text" value="${editing?formatCurrency(editing.jumlah):''}"></div>
    <div class="field"><label>Tanggal</label><input id="f-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div></div>
    <div class="field"><label>Keterangan</label><input id="f-ket" value="${editing?esc(editing.keterangan||''):''}"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const nama = document.getElementById('f-nama').value.trim();
      const jumlah = getCurrencyValue(document.getElementById('f-jumlah'));
      const tanggal = document.getElementById('f-tanggal').value||todayISO();
      const ket = document.getElementById('f-ket').value.trim();
      if(!nama||jumlah<=0){ toast('Nama & jumlah wajib'); return; }
      let actionMsg = '';
      if(editing){ 
        actionMsg = `✏️ Edit donasi: ${editing.nama_donatur} → ${nama}`;
        Object.assign(editing,{nama_donatur:nama,jumlah,tanggal,keterangan:ket}); 
      }
      else{ 
        actionMsg = `➕ Donasi baru dari ${nama}`;
        db.donatur.push({id:uid(),event_id:eid(),nama_donatur:nama,jumlah,tanggal,keterangan:ket}); 
      }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Disimpan');
      notifyTelegram(actionMsg, `Nama: ${nama}\nJumlah: ${fmtRp(jumlah)}\nTanggal: ${fmtDate(tanggal)}\nKeterangan: ${ket || '-'}`, 'donasi');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}
function hapusDonatur(id){ 
  if (!canEditSection('donatur')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!confirm('Hapus?')) return; 
  const d = db.donatur.find(x=>x.id===id);
  db.donatur=db.donatur.filter(d=>d.id!==id); 
  saveDB(); renderContent(); renderTopbarSaldo();
  if(d) notifyTelegram(`🗑️ Hapus donasi dari ${d.nama_donatur}`, `Jumlah: ${fmtRp(d.jumlah)}`, 'donasi');
}

function renderTransaksi(){
  const list = gTransaksiLain().slice().sort((a,b)=>(b.tanggal||'').localeCompare(a.tanggal||''));
  const total = list.reduce((s,t)=>s+Number(t.jumlah||0),0);
  const isLoggedIn = !!getCurrentUser();
  const rows = list.map((t,idx)=>`<tr${isLoggedIn ? ` class="row-clickable" onclick="openTransaksiModal('${t.id}')"` : ''}><td>${idx+1}</td><td>${fmtDateShort(t.tanggal)}</td><td>${esc(t.keterangan||'-')}</td><td class="num">${fmtRp(t.jumlah)}</td>${isLoggedIn ? `<td style="text-align:right;">
    <button class="icon-btn" onclick="event.stopPropagation();hapusTransaksi('${t.id}')">🗑</button>
  </td>` : ''}</tr>`).join('');
  return `<div class="stat-grid"><div class="stat-card pemasukan"><div class="lbl">Total Pemasukan Lain</div><div class="val">${fmtRp(total)}</div></div></div>
  <div class="panel"><div class="panel-head"><h3>Pemasukan Lain</h3>${isLoggedIn ? `<button class="btn" onclick="openTransaksiModal()">+ Tambah</button>` : ''}</div>
  <div class="panel-body flush"><table class="general-table tanggal-nominal-table transaksi-lain-table"><thead><tr><th>No</th><th>Tanggal</th><th>Keterangan</th><th class="num">Jumlah</th>${isLoggedIn ? '<th></th>' : ''}</tr></thead>
  <tbody>${rows||`<tr class="empty-row"><td colspan="${isLoggedIn?5:4}">Belum ada transaksi.</td></tr>`}</tbody></table></div></div>`;
}
function openTransaksiModal(id){
  if (!canEditSection('transaksi')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.transaksiLain.find(t=>t.id===id) : null;
  setModal(editing?'Edit Transaksi':'Tambah Transaksi', `
    <div class="field-row"><div class="field"><label>Jumlah (Rp)</label><input id="f-jumlah" class="currency-input" type="text" value="${editing?formatCurrency(editing.jumlah):''}"></div>
    <div class="field"><label>Tanggal</label><input id="f-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div></div>
    <div class="field"><label>Keterangan</label><input id="f-ket" value="${editing?esc(editing.keterangan||''):''}"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const jumlah = getCurrencyValue(document.getElementById('f-jumlah'));
      const tanggal = document.getElementById('f-tanggal').value||todayISO();
      const ket = document.getElementById('f-ket').value.trim();
      if(!ket||jumlah<=0){ toast('Keterangan & jumlah wajib'); return; }
      let actionMsg = '';
      if(editing){ actionMsg = `✏️ Edit transaksi: ${ket}`; Object.assign(editing,{jumlah,tanggal,keterangan:ket}); }
      else{ actionMsg = `➕ Transaksi baru: ${ket}`; db.transaksiLain.push({id:uid(),event_id:eid(),jumlah,tanggal,keterangan:ket}); }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Disimpan');
      notifyTelegram(actionMsg, `Jumlah: ${fmtRp(jumlah)}\nTanggal: ${fmtDate(tanggal)}\nKeterangan: ${ket || '-'}`, 'transaksi');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}
function hapusTransaksi(id){ 
  if (!canEditSection('transaksi')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!confirm('Hapus?')) return; 
  const t = db.transaksiLain.find(x=>x.id===id);
  db.transaksiLain=db.transaksiLain.filter(t=>t.id!==id); 
  saveDB(); renderContent(); renderTopbarSaldo();
  if(t) notifyTelegram(`🗑️ Hapus transaksi: ${t.keterangan||'-'}`, `Jumlah: ${fmtRp(t.jumlah)}`, 'transaksi');
}

function renderOperasional(){
  // Transaksi paling baru di atas: urutkan berdasarkan `created_at` (waktu baris
  // benar-benar dibuat), bukan `tanggal` (tanggal pilihan user yang bisa sama
  // atau diisi mundur untuk banyak baris sekaligus).
  const list = gOperasional().slice().sort((a,b)=>(b.created_at||b.tanggal||'').localeCompare(a.created_at||a.tanggal||''));
  const total = list.reduce((s,o)=>s+Number(o.jumlah||0),0);
  const isLoggedIn = !!getCurrentUser();
  const rows = list.map((o,idx)=>`<tr${isLoggedIn ? ` class="row-clickable" onclick="openOperasionalModal('${o.id}')"` : ''}><td data-label="No">${idx+1}</td><td data-label="Keterangan">${esc(o.keterangan)}</td><td data-label="Harga" class="num">${fmtRp(o.satuan||0)}</td><td data-label="QTY" class="num">${o.qty||1}</td><td data-label="Jumlah" class="num">${fmtRp(o.jumlah)}</td>${isLoggedIn ? `<td class="operasional-actions" data-label="" style="text-align:right;">
    <button class="icon-btn" onclick="event.stopPropagation();hapusOperasional('${o.id}')">🗑</button>
  </td>` : ''}</tr>`).join('');
  return `<div class="stat-grid"><div class="stat-card pengeluaran"><div class="lbl">Total Operasional</div><div class="val">${fmtRp(total)}</div></div></div>
  <div class="panel"><div class="panel-head"><h3>Biaya Operasional</h3>${isLoggedIn ? `<button class="btn" onclick="openOperasionalModal()">+ Tambah</button>` : ''}</div>
  <div class="panel-body flush"><table class="general-table operasional-table"><thead><tr><th>No</th><th>Keterangan</th><th class="num">Harga</th><th class="num">QTY</th><th class="num">Jumlah</th>${isLoggedIn ? '<th></th>' : ''}</tr></thead>
  <tbody>${rows||`<tr class="empty-row"><td colspan="${isLoggedIn?6:5}">Belum ada biaya.</td></tr>`}</tbody></table></div></div>`;
}
function hitungJumlahOperasionalModal(){
  const satuanInput = document.getElementById('f-satuan');
  const qtyInput = document.getElementById('f-qty');
  const preview = document.getElementById('f-jumlah-preview');
  if(!satuanInput || !qtyInput || !preview) return;
  const satuan = getCurrencyValue(satuanInput);
  const qty = Number(qtyInput.value) || 1;
  preview.textContent = fmtRp(satuan * qty);
}
function openOperasionalModal(id){
  if (!canEditSection('operasional')) { toast('⛔ Login untuk mengedit data'); return; }
  const editing = id ? db.operasional.find(o=>o.id===id) : null;
  setModal(editing?'Edit Biaya':'Tambah Biaya', `
    <div class="field"><label>Tanggal</label><input id="f-tanggal" type="date" value="${editing?editing.tanggal:todayISO()}"></div>
    <div class="field"><label>Keterangan</label><input id="f-ket" value="${editing?esc(editing.keterangan):''}"></div>
    <div class="field-row"><div class="field"><label>Harga Satuan (Rp)</label><input id="f-satuan" class="currency-input" type="text" oninput="hitungJumlahOperasionalModal()" value="${editing?formatCurrency(editing.satuan||0):''}"></div>
    <div class="field"><label>QTY</label><input id="f-qty" type="number" min="1" step="1" oninput="hitungJumlahOperasionalModal()" value="${editing?(editing.qty||1):1}"></div></div>
    <div class="field"><label>Jumlah</label><div id="f-jumlah-preview" style="font-weight:700; font-size:16px; padding:6px 0;">${fmtRp((editing?Number(editing.satuan||0):0)*(editing?(editing.qty||1):1))}</div><div class="hint">Otomatis: Harga Satuan × QTY</div></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:editing?'Simpan':'Tambah', cls:'', onclick:()=>{
      const ket = document.getElementById('f-ket').value.trim();
      const satuan = getCurrencyValue(document.getElementById('f-satuan'));
      const qty = Number(document.getElementById('f-qty').value) || 1;
      const jumlah = satuan * qty;
      const tanggal = document.getElementById('f-tanggal').value||todayISO();
      if(!ket||jumlah<=0){ toast('Keterangan & harga satuan wajib'); return; }
      let actionMsg = '';
      if(editing){ actionMsg = `✏️ Edit biaya operasional: ${editing.keterangan} → ${ket}`; Object.assign(editing,{keterangan:ket,satuan,qty,jumlah,tanggal}); }
      else{ actionMsg = `➕ Biaya operasional baru: ${ket}`; db.operasional.push({id:uid(),event_id:eid(),keterangan:ket,satuan,qty,jumlah,tanggal,created_at:new Date().toISOString()}); }
      saveDB(); closeModal(); renderContent(); renderTopbarSaldo(); toast('Disimpan');
      notifyTelegram(actionMsg, `Keterangan: ${ket}\nHarga Satuan: ${fmtRp(satuan)}\nQTY: ${qty}\nJumlah: ${fmtRp(jumlah)}\nTanggal: ${fmtDate(tanggal)}`, 'operasional');
    }}
  ]);
  setTimeout(setupAllCurrencyInputs, 50);
}
function hapusOperasional(id){ 
  if (!canEditSection('operasional')) { toast('⛔ Login untuk mengedit data'); return; }
  if(!confirm('Hapus?')) return; 
  const o = db.operasional.find(x=>x.id===id);
  db.operasional=db.operasional.filter(o=>o.id!==id); 
  saveDB(); renderContent(); renderTopbarSaldo();
  if(o) notifyTelegram(`🗑️ Hapus biaya operasional: ${o.keterangan}`, `Jumlah: ${fmtRp(o.jumlah)}`, 'operasional');
}

