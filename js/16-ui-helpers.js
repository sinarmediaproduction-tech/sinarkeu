/* ============================================================
   MODAL / TOAST HELPERS
   ============================================================ */
function setModal(title, bodyHtml, buttons){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-foot').innerHTML = '';
  const foot = document.getElementById('modal-foot');
  buttons.forEach(b=>{
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.cls||'');
    btn.textContent = b.label;
    btn.type = 'button';
    btn.onclick = b.onclick;
    foot.appendChild(btn);
  });
  document.getElementById('overlay').classList.add('show');
  
  // Setup currency inputs after modal body is rendered
  setTimeout(setupAllCurrencyInputs, 50);
  setTimeout(setupAutoResizeTextareas, 50);
}
function closeModal(){ document.getElementById('overlay').classList.remove('show'); if(typeof closeAllGudangCombos==='function') closeAllGudangCombos(); }
document.getElementById('modal-close').onclick = closeModal;
// Catatan: tutup overlay HANYA jika mousedown & click sama-sama kena backdrop.
// Ini mencegah modal tertutup tidak sengaja saat user scroll/geser di dalam modal
// (jari mulai di dalam modal, geser, lalu lepas di area backdrop) atau saat
// posisi modal bergeser akibat munculnya keyboard di HP.
let overlayMouseDownOnBackdrop = false;
document.getElementById('overlay').addEventListener('mousedown', (e)=>{ overlayMouseDownOnBackdrop = (e.target.id==='overlay'); });
document.getElementById('overlay').addEventListener('click', (e)=>{ if(e.target.id==='overlay' && overlayMouseDownOnBackdrop) closeModal(); overlayMouseDownOnBackdrop = false; });

let toastTimer;
function toast(msg, durationMs = 2400){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), durationMs);
}

/* ============================================================
   PROMPT MODAL — pengganti window.prompt() bawaan browser (yang
   tampilannya "native" & tidak bisa di-style) dengan modal ber-tema
   app sendiri, pakai overlay/setModal yang sudah ada.
   Dipakai dgn async/await, contoh:
     const isi = await promptModal({title:'Isi per pack', label:'...', defaultValue:5, type:'number'});
     if(isi===null) return; // user tekan Batal
   type: 'text' (default) | 'number' | 'currency'
   ============================================================ */
function promptModal({title, label, hint, defaultValue, type='text', okLabel='OK', cancelLabel='Batal'}){
  return new Promise((resolve) => {
    const inputId = 'pm-input-' + uid();
    const isCurrency = type === 'currency';
    const isNumber = type === 'number';
    const initialVal = defaultValue==null ? '' : String(defaultValue);
    setModal(title, `
      <div class="field">
        ${label ? `<label>${esc(label)}</label>` : ''}
        <input id="${inputId}" class="${isCurrency?'currency-input':''}" type="${isNumber?'number':'text'}" value="${esc(isCurrency?formatCurrency(defaultValue):initialVal)}">
        ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      </div>
    `, [
      {label:cancelLabel, cls:'secondary', onclick:()=>{ closeModal(); resolve(null); }},
      {label:okLabel, cls:'', onclick:()=>{
        const el = document.getElementById(inputId);
        const val = isCurrency ? getCurrencyValue(el) : el.value;
        closeModal();
        resolve(val);
      }}
    ]);
    setTimeout(()=>{
      const el = document.getElementById(inputId);
      if(!el) return;
      el.focus(); el.select();
      el.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ e.preventDefault(); document.querySelector('#modal-foot .btn:not(.secondary)')?.click(); }
      });
    }, 60);
  });
}

/* ============================================================
   FUNGSI HITUNG BUKU UTAMA
   ============================================================ */
function hitungBukuUtama(){
  const anggotaLunas = gAnggota().filter(a=>a.status==='lunas');
  const iuran = anggotaLunas.reduce((s,a)=>s+Number(a.nominal_wajib||0),0);
  const donaturList = gDonatur();
  const donasi = donaturList.reduce((s,d)=>s+Number(d.jumlah||0),0);
  const transaksiLainList = gTransaksiLain();
  const transaksiLain = transaksiLainList.reduce((s,t)=>s+Number(t.jumlah||0),0);
  const pemasukan = iuran + donasi + transaksiLain;

  const operasionalList = gOperasional();
  const opsional = operasionalList.reduce((s,o)=>s+Number(o.jumlah||0),0);
  const lombaIds = gLomba().map(l=>l.id);
  const kebutuhanLombaList = db.lombaKebutuhan.filter(k=>lombaIds.includes(k.lomba_id));
  const kebutuhanLomba = kebutuhanLombaList
    .reduce((s,k)=> s + (Number(k.harga_realisasi ?? k.harga_estimasi ?? 0) * Number(k.qty||0)), 0);

  // Pakai hitungHargaAktualHadiahLomba() (di 11-belanja.js) supaya konsisten
  // dengan Belanja Hadiah — rumus flat harga_satuan*qty_dibeli mengabaikan
  // harga_eceran untuk sisa pcs yang dibeli satuan (lihat Bug #2).
  const hadiahAktual = hitungHargaAktualHadiahLomba();
  let hadiahLomba = hadiahAktual.total; let jumlahItemHadiahLomba = 0;
  gHadiahKategori().forEach(h => {
    h.items.forEach(() => { jumlahItemHadiahLomba++; });
  });

  const hadiahJalanList = gHadiahJalanSantai();
  const hadiahJalan = hadiahJalanList.reduce((s,h) => s + (Number(h.harga_satuan||0) * Number(h.qty||0)), 0);

  const pengeluaran = opsional + kebutuhanLomba + hadiahLomba + hadiahJalan;
  return {
    iuran, donasi, transaksiLain, pemasukan, opsional, kebutuhanLomba, hadiahLomba, hadiahJalan, pengeluaran, saldo: pemasukan - pengeluaran,
    jumlahIuranLunas: anggotaLunas.length,
    jumlahDonatur: donaturList.length,
    jumlahTransaksiLain: transaksiLainList.length,
    jumlahOperasional: operasionalList.length,
    jumlahKebutuhanLomba: kebutuhanLombaList.length,
    jumlahItemHadiahLomba,
    jumlahHadiahJalan: hadiahJalanList.length,
  };
}

