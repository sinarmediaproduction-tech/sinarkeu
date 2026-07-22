/* ============================================================
   DANA SOSIAL
   Iuran bulanan Rp 5.000/anggota — TIDAK terikat event 17-an
   manapun (sama seperti Kas Karang Taruna/Agenda/Gudang).

   Daftar anggota di sini disimpan terpisah secara teknis dari kt_anggota
   (Iuran Anggota per-event) — lihat kt_dana_sosial_anggota di
   supabase-dana-sosial-migration.sql — TAPI Database Anggota (kt_anggota)
   tetap jadi SATU-SATUNYA master nama anggota. Anggota Dana Sosial baru
   HANYA bisa masuk lewat "Ambil dari Database Anggota" (import nama yang
   sudah ada di kt_anggota); tidak ada lagi jalur tambah-manual bebas ketik
   nama di tab Kelola Anggota, supaya nama tidak dobel-master. Anggota baru
   yang gabung di tengah tahun disimpan `tanggal_gabung`-nya; bulan-bulan
   SEBELUM itu otomatis dikosongkan di tabel (bukan dianggap "belum bayar").

   Setiap bulan direkap: jumlah anggota yang lunas dikali Rp 5.000,
   dikurangi potongan konsumsi pertemuan flat Rp 80.000 (tidak bisa
   diubah per bulan — sesuai keputusan awal fitur ini). Potongan ini
   TIDAK disimpan di DB, dihitung on-the-fly saat render supaya gampang
   diubah lagi nanti kalau kebijakan berubah.

   Struktur mengikuti pola modul eventless lain (lihat renderKas() di
   js/12-jadwal-agenda-kas.js): getter global (gDanaSosialAnggota/
   gDanaSosialBayar di js/18-getters-refresh.js), guard canEditSection
   ('dana-sosial'), dan notifyTelegram() untuk perubahan data anggota
   master (BUKAN untuk tiap toggle lunas/belum per sel — itu bisa
   terjadi puluhan kali dalam semenit saat rekap pertemuan bulanan,
   jadi sengaja tidak dikirim ke Telegram supaya tidak spam).

   Anggota dengan flag `perantauan` (lihat
   supabase-dana-sosial-perantauan-migration.sql) ditampilkan di tabel
   TERPISAH di tab Daftar Bayar, karena mereka biasanya tidak bayar
   bulanan seperti anggota reguler — baru bayar/rapel setahun sekali
   saat pulang. Tabelnya cuma satu kolom toggle "Lunas Tahun Ini" (bukan
   12 kolom bulan seperti reguler), tapi di balik layar tetap menulis ke
   SEMUA baris kt_dana_sosial_bayar per bulan yang wajib di tahun itu
   sekaligus (lihat toggleDanaSosialLunasTahunPerantauan), supaya rekap
   bulanan tetap konsisten dan menghitung anggota Perantauan sama seperti
   anggota reguler.
   ============================================================ */

const DANA_SOSIAL_IURAN_PER_ORANG = 5000;
const DANA_SOSIAL_POTONGAN_KONSUMSI = 80000;
const DANA_SOSIAL_BULAN_LABEL = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

// Dipakai untuk jejak audit "siapa yang tandai/batalkan lunas" (lihat
// PENGAMANAN TANDAI LUNAS di bawah). Ambil dari user yang sedang login;
// kalau entah kenapa tidak ada (harusnya tidak mungkin karena toggle sudah
// digerbang canEditSection), fallback ke label netral supaya tetap ada
// catatan daripada kosong sama sekali.
function namaUserDanaSosial(){
  const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  return (u && (u.name || u.username)) || 'Tidak diketahui';
}

// Tahun yang lagi dilihat di tabel/rekap. Reset ke tahun berjalan tiap kali
// halaman dimuat ulang (tidak perlu disimpan permanen) — cukup dropdown di
// halaman utk pindah ke tahun sebelumnya/berikutnya.
let danaSosialTahunAktif = new Date().getFullYear();

// Daftar tahun yang bisa dipilih di dropdown: tahun berjalan, tahun depan
// (biar bisa disiapkan lebih awal), plus tahun mana pun yang sudah punya
// data (baris bayar atau anggota yang gabung di tahun itu).
function danaSosialTahunList(){
  const now = new Date().getFullYear();
  const tahunSet = new Set([now, now + 1]);
  db.danaSosialBayar.forEach(b => tahunSet.add(Number(b.tahun)));
  db.danaSosialAnggota.forEach(a => { if (a.tanggal_gabung) tahunSet.add(Number(a.tanggal_gabung.slice(0,4))); });
  return Array.from(tahunSet).sort((a,b) => b - a);
}

// Anggota wajib bayar bulan ini kalau tanggal gabungnya <= bulan yang dicek.
// Bulan-bulan SEBELUM gabung otomatis tidak wajib (dikosongkan di tabel).
function isWajibDanaSosial(anggota, tahun, bulan){
  // `aktif` (default true, lihat kt_dana_sosial_anggota) menandai anggota
  // yang dinonaktifkan lewat "Nonaktifkan" di tab Kelola Anggota — biasanya
  // karena pindah/keluar tapi datanya tetap disimpan (bukan dihapus, supaya
  // riwayat bayar lama tidak hilang). Anggota nonaktif tidak lagi wajib
  // bayar bulan manapun sejak dinonaktifkan.
  if (anggota.aktif === false) return false;
  if (!anggota.tanggal_gabung) return true;
  const g = new Date(anggota.tanggal_gabung + 'T00:00:00');
  const gKey = g.getFullYear() * 12 + g.getMonth(); // bulan 0-11
  const tKey = Number(tahun) * 12 + (Number(bulan) - 1);
  return tKey >= gKey;
}

function getDanaSosialBayar(anggotaId, tahun, bulan){
  return db.danaSosialBayar.find(b => b.anggota_id === anggotaId && Number(b.tahun) === Number(tahun) && Number(b.bulan) === Number(bulan));
}

// Anggota Perantauan cuma bayar SEKALI setahun (rapel), jadi tabelnya tidak
// perlu 12 kolom bulan seperti anggota reguler — cukup satu status
// "Lunas Tahun Ini". Di baliknya, data tetap disimpan per-bulan di
// kt_dana_sosial_bayar (supaya rekap bulanan tetap konsisten dengan
// anggota reguler); menandai "Lunas" sekali klik otomatis mengisi SEMUA
// bulan wajib di tahun itu sekaligus, dan membatalkannya mengosongkan semua.
function danaSosialBulanWajibList(anggota, tahun){
  const list = [];
  for (let b = 1; b <= 12; b++){ if (isWajibDanaSosial(anggota, tahun, b)) list.push(b); }
  return list;
}

function statusLunasTahunPerantauan(anggota, tahun){
  const wajib = danaSosialBulanWajibList(anggota, tahun);
  if (wajib.length === 0) return { wajib: 0, lunasSemua: false, tanggalTerakhir: null, diubahOleh: null };
  let tanggalTerakhir = null, diubahOleh = null;
  const lunasSemua = wajib.every(b => {
    const r = getDanaSosialBayar(anggota.id, tahun, b);
    if (r && r.lunas && r.tanggal_bayar && (!tanggalTerakhir || r.tanggal_bayar > tanggalTerakhir)){
      tanggalTerakhir = r.tanggal_bayar;
      diubahOleh = r.diubah_oleh || null;
    }
    return r && r.lunas;
  });
  return { wajib: wajib.length, lunasSemua, tanggalTerakhir, diubahOleh };
}

/* ============================================================
   PENGAMANAN TANDAI LUNAS
   Menandai lunas (dari kosong/belum → lunas) risikonya rendah — cuma
   mencatat orang sudah bayar, gampang dikoreksi kalau salah pencet.
   Yang risikonya TINGGI dan rawan disalahgunakan adalah arah SEBALIKNYA:
   MEMBATALKAN status lunas yang sudah tercatat (bisa dipakai buat
   "menghapus" bukti seseorang sudah bayar). Makanya arah ini sengaja
   diberi 2 lapis pengamanan:
   1) Wajib konfirmasi eksplisit (tidak bisa kepencet tanpa sengaja),
      dan dialognya menampilkan SIAPA yang menandai lunas terakhir kali
      supaya kelihatan kalau ada yang aneh (mis. dibatalkan oleh orang
      lain, bukan yang menandainya).
   2) Setiap toggle (baik menandai maupun membatalkan) dicatat jejaknya
      (diubah_oleh + diubah_pada) di baris kt_dana_sosial_bayar — lihat
      supabase-dana-sosial-audit-migration.sql — supaya ada riwayat kalau
      suatu saat perlu ditelusuri.
   ============================================================ */
function toggleDanaSosialLunasTahunPerantauan(anggotaId, tahun){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const anggota = db.danaSosialAnggota.find(a => a.id === anggotaId);
  if (!anggota) return;
  const wajib = danaSosialBulanWajibList(anggota, tahun);
  if (wajib.length === 0) return;
  const status = statusLunasTahunPerantauan(anggota, tahun);
  const jadiLunas = !status.lunasSemua;
  if (!jadiLunas){
    const jejak = status.diubahOleh ? ` Terakhir ditandai oleh ${status.diubahOleh}${status.tanggalTerakhir?` (${fmtDate(status.tanggalTerakhir)})`:''}.` : '';
    if (!confirm(`Batalkan status Lunas Tahun ${tahun} untuk "${anggota.nama}"?${jejak}\n\nSemua bulan wajib di tahun ini ikut dibatalkan sekaligus. Tindakan ini tercatat atas nama Anda.`)) return;
  }
  const tgl = jadiLunas ? todayISO() : null;
  const pengubah = namaUserDanaSosial();
  const waktuUbah = new Date().toISOString();
  wajib.forEach(bulan => {
    let rec = getDanaSosialBayar(anggotaId, tahun, bulan);
    if (rec){
      rec.lunas = jadiLunas;
      rec.tanggal_bayar = tgl;
      rec.diubah_oleh = pengubah;
      rec.diubah_pada = waktuUbah;
    } else if (jadiLunas){
      db.danaSosialBayar.push({ id: uid(), anggota_id: anggotaId, tahun: Number(tahun), bulan, lunas: true, tanggal_bayar: tgl, diubah_oleh: pengubah, diubah_pada: waktuUbah, created_at: new Date().toISOString() });
    }
  });
  saveDB(); renderContent();
}

// Bulan ini sudah "terlewati" (sudah terjadi atau sedang berjalan)? Dipakai
// supaya rekap bulan-bulan yang belum terjadi diberi label "proyeksi", bukan
// dianggap sudah pasti defisit Rp 80.000.
function danaSosialSudahBerjalan(tahun, bulan){
  const now = new Date();
  const tKey = Number(tahun) * 12 + (Number(bulan) - 1);
  const nKey = now.getFullYear() * 12 + now.getMonth();
  return tKey <= nKey;
}

// Rekap ini (dan stat "Lunas Bulan Ini" di atas halaman) SENGAJA cuma
// menghitung anggota REGULER (bukan Perantauan) untuk kolom Wajib/Lunas/
// Belum — Anggota Perantauan bayar rapel setahun sekali lewat
// toggleDanaSosialLunasTahunPerantauan (lihat catatan di atas file ini),
// jadi kalau ikut dihitung per bulan di sini datanya akan melompat besar di
// satu bulan tertentu (bulan saat mereka rapel) dan bikin pola kepatuhan
// bulanan reguler jadi salah baca.
//
// TAPI uang yang mereka bayar tetap uang sungguhan yang harus masuk ke
// kas — jadi `terkumpulPerantauan` dihitung TERPISAH di bawah (supaya tetap
// kelihatan sebagai baris/kolom sendiri di UI, bukan disamarkan sebagai
// setoran reguler) dan tetap ditambahkan ke `saldoBersih` supaya "Saldo
// Dana Sosial" mencerminkan kas riil, bukan cuma kas dari anggota reguler.
// (Riwayat: sebelumnya uang Perantauan sama sekali tidak pernah dijumlahkan
// di mana pun di UI meski tercatat lunas di DB — treasurer bisa mengira
// saldo lebih kecil dari kas fisik yang sebenarnya.)
function hitungRekapBulanDanaSosial(tahun, bulan){
  const anggotaWajib = db.danaSosialAnggota.filter(a => !a.perantauan && isWajibDanaSosial(a, tahun, bulan));
  // "Lunas"/"Belum" tetap dilihat dari kewajiban bulan ini (status kepatuhan
  // iuran per bulan wajib) — ini TIDAK berubah walau tunggakan baru dilunasi
  // belakangan, karena statusnya sendiri (rec.lunas pada bulan wajib itu)
  // memang jadi true begitu dibayar, terlepas kapan.
  const lunasList = anggotaWajib.filter(a => { const r = getDanaSosialBayar(a.id, tahun, bulan); return r && r.lunas; });
  // "Terkumpul" (uang masuk) SENGAJA dihitung dari TANGGAL BAYAR AKTUAL
  // (tanggal_bayar), bukan dari field `bulan` (bulan wajib) pada baris
  // pembayaran. Jadi kalau anggota baru melunasi tunggakan bulan lama di
  // bulan berjalan sekarang, uangnya masuk ke rekap BULAN INI (bulan saat
  // fisik dibayar) — bukan menambah rekap bulan lama yang sudah lewat.
  // Ini supaya rekap mencerminkan kas masuk riil untuk keperluan laporan.
  const cocokBulanBayar = (b) => {
    if (!b.lunas || !b.tanggal_bayar) return false;
    const ty = Number(String(b.tanggal_bayar).slice(0, 4));
    const tm = Number(String(b.tanggal_bayar).slice(5, 7));
    return ty === Number(tahun) && tm === Number(bulan);
  };
  const terkumpulList = db.danaSosialBayar.filter(b => {
    if (!cocokBulanBayar(b)) return false;
    const a = db.danaSosialAnggota.find(x => x.id === b.anggota_id);
    return a && !a.perantauan;
  });
  // Uang rapel Perantauan: dihitung terpisah supaya tetap kelihatan sebagai
  // kolom sendiri ("Perantauan") di tabel Rekap Bulanan, tapi tetap masuk ke
  // saldoBersih di bawah supaya totalnya benar.
  const terkumpulPerantauanList = db.danaSosialBayar.filter(b => {
    if (!cocokBulanBayar(b)) return false;
    const a = db.danaSosialAnggota.find(x => x.id === b.anggota_id);
    return a && a.perantauan;
  });
  const terkumpul = terkumpulList.length * DANA_SOSIAL_IURAN_PER_ORANG;
  const terkumpulPerantauan = terkumpulPerantauanList.length * DANA_SOSIAL_IURAN_PER_ORANG;
  const potongan = DANA_SOSIAL_POTONGAN_KONSUMSI;
  return {
    wajib: anggotaWajib.length,
    lunas: lunasList.length,
    belum: anggotaWajib.length - lunasList.length,
    terkumpul, terkumpulPerantauan, potongan,
    saldoBersih: (terkumpul + terkumpulPerantauan) - potongan,
    sudahBerjalan: danaSosialSudahBerjalan(tahun, bulan),
  };
}

// Saldo Dana Sosial keseluruhan (sejak anggota pertama gabung sampai bulan
// berjalan sekarang) — dijumlahkan dari saldo bersih tiap bulan yang MEMANG
// sudah punya anggota wajib bayar (bulan sebelum ada anggota sama sekali
// tidak ikut dihitung, karena belum ada pertemuan/potongan konsumsi).
// Bulan yang belum terlewati (masa depan) sengaja tidak diikutkan supaya
// saldo tidak "dipotong" duluan untuk pertemuan yang belum terjadi.
function hitungSaldoDanaSosialTotal(){
  if (db.danaSosialAnggota.length === 0) return 0;
  const now = new Date();
  const tahunMulai = db.danaSosialAnggota.reduce((min, a) => {
    const y = a.tanggal_gabung ? Number(a.tanggal_gabung.slice(0,4)) : now.getFullYear();
    return Math.min(min, y);
  }, now.getFullYear());
  let total = 0;
  for (let y = tahunMulai; y <= now.getFullYear(); y++){
    const bulanAkhir = (y === now.getFullYear()) ? (now.getMonth() + 1) : 12;
    for (let b = 1; b <= bulanAkhir; b++){
      const r = hitungRekapBulanDanaSosial(y, b);
      // Ikutkan bulan yang punya kewajiban reguler ATAU ada uang Perantauan
      // yang masuk bulan itu (jarang, tapi bisa terjadi kalau anggota
      // Perantauan sudah gabung sebelum ada anggota reguler sama sekali).
      if (r.wajib > 0 || r.terkumpulPerantauan > 0) total += r.saldoBersih;
    }
  }
  return total;
}

// Total yang HARUS dibayar anggota reguler di tahun ini: dihitung dari
// jumlah bulan wajib yang sudah terjadi/berjalan (bukan bulan depan) tapi
// belum ditandai lunas, dikali iuran per bulan. Kalau anggota rutin bayar
// tiap bulan, nilainya selalu pas 1x iuran (bulan berjalan saja). Kalau ada
// bulan sebelumnya yang kelewat belum dibayar, nilainya ikut menumpuk
// (2x, 3x, dst iuran) sampai semua bulan yang nunggak itu dilunasi satu-
// satu. Sengaja dihitung per TAHUN yang sedang dilihat saja (tidak
// menumpuk lintas tahun) supaya angkanya konsisten dengan tabel Daftar
// Bayar yang juga per tahun.
function hitungTunggakanDanaSosial(anggota, tahun){
  let bulanBelum = 0;
  let adaBulanJatuhTempo = false; // apakah ada bulan wajib yang SUDAH berjalan di tahun ini
  for (let b = 1; b <= 12; b++){
    if (!isWajibDanaSosial(anggota, tahun, b)) continue;
    if (!danaSosialSudahBerjalan(tahun, b)) continue; // bulan depan belum dihitung nunggak
    adaBulanJatuhTempo = true;
    const rec = getDanaSosialBayar(anggota.id, tahun, b);
    if (!(rec && rec.lunas)) bulanBelum++;
  }
  // PENTING: bulanBelum === 0 BUKAN berarti "sudah lunas" kalau belum ada satupun
  // bulan yang jatuh tempo (mis. tahun sepenuhnya di masa depan). adaBulanJatuhTempo
  // membedakan dua kondisi ini supaya UI tidak salah menampilkan "Lunas" padahal
  // belum ada kewajiban apapun yang jatuh tempo.
  return { bulanBelum, total: bulanBelum * DANA_SOSIAL_IURAN_PER_ORANG, adaBulanJatuhTempo };
}

function gantiTahunDanaSosial(v){
  danaSosialTahunAktif = Number(v);
  renderContent();
}

/* ============================================================
   DROPDOWN TAHUN (pengganti <select> native)
   Sebelumnya <select> polos — kotaknya sudah dipercantik lewat CSS
   (appearance:none + panah custom), TAPI daftar pilihan yang muncul saat
   diklik tetap dirender native oleh OS/browser dan sama sekali di luar
   jangkauan CSS. Makanya diganti total jadi dropdown buatan sendiri
   (tombol trigger + panel melayang), mengikuti pola yang sama dipakai
   combo pilih Barang Gudang (js/17b-gudang-pinjam.js) dan combo pilih
   Koordinator Lomba (js/10-lomba.js) — supaya kotak DAN daftar
   pilihannya full custom, senada tema app.
   Dipakai di 3 tempat (tab Daftar Bayar/Perantauan/Rekap), semuanya
   mengubah tahun aktif yang SAMA (danaSosialTahunAktif) lewat
   gantiTahunDanaSosial() yang sudah ada di atas — jadi cukup satu set
   fungsi generik, dibedakan lewat idSuffix trigger-nya saja
   ('daftar'/'perantauan'/'rekap').
   ============================================================ */
function dsComboIconChevron(){
  return `<svg class="combo-chevron" width="15" height="15" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function dsComboIconCheck(){
  return `<svg class="combo-check" width="15" height="15" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function dsTahunTriggerHtml(idSuffix){
  return `<button type="button" id="ds-tahun-trigger-${idSuffix}" class="combo-trigger ds-tahun-trigger" onclick="toggleDsTahunCombo('${idSuffix}')">
    <span class="combo-trigger-label">${danaSosialTahunAktif}</span>
    ${dsComboIconChevron()}
  </button>`;
}
function dsTahunComboPanelHtml(){
  const tahun = danaSosialTahunAktif;
  const optionsHtml = danaSosialTahunList().map(t=>{
    const selected = t === tahun;
    return `<button type="button" class="combo-option${selected?' selected':''}" onclick="selectDsTahun(${t})">
      <span class="combo-option-main"><span class="combo-option-name">${t}</span></span>
      <span class="combo-option-side">${selected ? dsComboIconCheck() : ''}</span>
    </button>`;
  }).join('');
  return `<div class="combo-list" data-combo-list>${optionsHtml}</div>`;
}
let _dsTahunComboOpenId = null;
let _dsTahunComboPanelEl = null;
function dsTahunComboPositionPanel(trigger, panel){
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const panelWidth = Math.max(rect.width, 120);
  panel.style.left = Math.max(8, rect.left) + 'px';
  panel.style.width = panelWidth + 'px';
  const panelH = panel.offsetHeight || 240;
  const spaceBelow = vh - rect.bottom;
  const spaceAbove = rect.top;
  if(spaceBelow < panelH + 12 && spaceAbove > spaceBelow){
    panel.style.top = Math.max(8, rect.top - panelH - 6) + 'px';
  } else {
    panel.style.top = (rect.bottom + 6) + 'px';
  }
  const maxLeft = vw - panelWidth - 8;
  if(parseFloat(panel.style.left) > maxLeft) panel.style.left = Math.max(8, maxLeft) + 'px';
}
function toggleDsTahunCombo(idSuffix){
  const trigger = document.getElementById(`ds-tahun-trigger-${idSuffix}`);
  if(!trigger) return;
  if(_dsTahunComboOpenId === idSuffix){ closeDsTahunCombo(); return; }
  closeDsTahunCombo();
  const panel = document.createElement('div');
  panel.className = 'combo-panel combo-panel-floating';
  panel.id = 'ds-tahun-combo-floating';
  panel.innerHTML = dsTahunComboPanelHtml();
  document.body.appendChild(panel);
  dsTahunComboPositionPanel(trigger, panel);
  requestAnimationFrame(()=>panel.classList.add('show'));
  trigger.classList.add('open');
  _dsTahunComboOpenId = idSuffix;
  _dsTahunComboPanelEl = panel;
}
function closeDsTahunCombo(){
  if(_dsTahunComboPanelEl){ _dsTahunComboPanelEl.remove(); _dsTahunComboPanelEl = null; }
  document.querySelectorAll('.ds-tahun-trigger.open').forEach(t=>t.classList.remove('open'));
  _dsTahunComboOpenId = null;
}
function selectDsTahun(tahun){
  // Tutup dulu sebelum ganti tahun — gantiTahunDanaSosial() memanggil
  // renderContent() yang merender ulang seluruh halaman (termasuk tombol
  // trigger-nya), jadi panel lama harus sudah dilepas dari body duluan
  // supaya tidak nyangkut nunjuk ke trigger yang sudah tidak ada lagi.
  closeDsTahunCombo();
  gantiTahunDanaSosial(tahun);
}
document.addEventListener('click', (e)=>{
  if(e.target.closest('.combo-panel-floating') || e.target.closest('.ds-tahun-trigger')) return;
  closeDsTahunCombo();
});
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') closeDsTahunCombo();
});
window.addEventListener('resize', ()=>{
  if(_dsTahunComboOpenId===null || !_dsTahunComboPanelEl) return;
  const trigger = document.getElementById(`ds-tahun-trigger-${_dsTahunComboOpenId}`);
  if(!trigger || !document.body.contains(trigger)){ closeDsTahunCombo(); return; }
  dsTahunComboPositionPanel(trigger, _dsTahunComboPanelEl);
});

// Tab aktif di halaman Dana Sosial: 'daftar' (list nama + centang bayar saja,
// tanpa aksi kelola), 'perantauan' (tabel anggota Perantauan, terpisah dari
// tabel Daftar Bayar reguler karena bayarnya rapel setahun sekali),
// 'kelola' (tambah/ubah/hapus/ambil dari Database Anggota), atau 'rekap'
// (Rekap Bulanan). Reset ke 'daftar' tiap kali halaman dimuat ulang (tidak
// perlu disimpan permanen), sama seperti pola tab di renderLomba().
let danaSosialActiveTab = 'daftar';
function setDanaSosialTab(tab){
  danaSosialActiveTab = tab;
  renderContent();
}

function renderDanaSosial(){
  const canEdit = canEditSection('dana-sosial');
  const tahun = danaSosialTahunAktif;
  const anggotaList = gDanaSosialAnggota();
  // Tabel Daftar Bayar & stat "Total Anggota" cuma menghitung yang masih
  // aktif — anggota yang dinonaktifkan (lihat isWajibDanaSosial) tetap ada
  // di tab Kelola Anggota supaya datanya tidak hilang, tapi disembunyikan
  // dari tabel bayar/rekap harian.
  const anggotaAktifList = anggotaList.filter(a => a.aktif !== false);
  const anggotaReguler = anggotaAktifList.filter(a => !a.perantauan);
  const anggotaPerantauan = anggotaAktifList.filter(a => a.perantauan);
  const now = new Date();
  const rekapBulanIni = hitungRekapBulanDanaSosial(now.getFullYear(), now.getMonth() + 1);
  const saldoTotal = hitungSaldoDanaSosialTotal();

  // Header kolom bulan disiapkan dua versi (nama & angka 1-12); yang
  // ditampilkan diatur lewat CSS (.ds-bulan-full/.ds-bulan-num) supaya di
  // layar sempit (HP) otomatis pindah ke angka biar kolom tidak kesempitan.
  const theadBulan = DANA_SOSIAL_BULAN_LABEL.map((l,i) => `<th class="ds-bulan-h"><span class="ds-bulan-full">${l}</span><span class="ds-bulan-num">${i+1}</span></th>`).join('');

  function buatBarisBayar(list){
    return list.map((a, idx) => {
      const cells = DANA_SOSIAL_BULAN_LABEL.map((_, i) => {
        const bulan = i + 1;
        if (!isWajibDanaSosial(a, tahun, bulan)){
          return `<td class="ds-cell"><span class="ds-toggle ds-muted" title="Belum gabung">·</span></td>`;
        }
        const rec = getDanaSosialBayar(a.id, tahun, bulan);
        const lunas = !!(rec && rec.lunas);
        const titleTxt = `${esc(a.nama)} · ${DANA_SOSIAL_BULAN_LABEL[i]} ${tahun} — ${lunas ? 'Lunas (klik untuk batalkan)' : 'Belum bayar (klik untuk tandai lunas)'}${lunas && rec && rec.diubah_oleh ? ` · ditandai oleh ${esc(rec.diubah_oleh)}` : ''}`;
        return `<td class="ds-cell"><button type="button" class="ds-toggle ${lunas?'lunas':'belum'}" ${canEdit?`onclick="toggleDanaSosialBayar('${a.id}',${tahun},${bulan})"`:'disabled'} title="${titleTxt}"><span class="ds-toggle-mark">${lunas?'✓':''}</span><span class="ds-toggle-label">${lunas?'Sudah':'Belum'}</span></button></td>`;
      }).join('');
      const tunggakan = hitungTunggakanDanaSosial(a, tahun);
      const tunggakanTitle = !tunggakan.adaBulanJatuhTempo
        ? 'Belum ada bulan yang jatuh tempo di tahun ini'
        : (tunggakan.bulanBelum === 0
          ? 'Tidak ada tunggakan'
          : `Nunggak ${tunggakan.bulanBelum} bulan × ${fmtRp(DANA_SOSIAL_IURAN_PER_ORANG)}`);
      const tunggakanCell = !tunggakan.adaBulanJatuhTempo
        ? `<span class="ds-toggle-mono ds-muted" style="font-size:12px;">Belum jatuh tempo</span>`
        : (tunggakan.bulanBelum === 0
          ? `<span class="ds-lunas-tag">Lunas</span>`
          : `<span class="${tunggakan.bulanBelum>1?'ds-tunggakan-angka lebih':'ds-tunggakan-angka'}">${fmtRp(tunggakan.total)}</span>`);
      return `<tr>
        <td class="ds-no">${idx+1}</td>
        <td class="ds-nama">${esc(a.nama)}</td>
        ${cells}
        <td class="ds-cell ds-tunggakan" title="${tunggakanTitle}">${tunggakanCell}</td>
      </tr>`;
    }).join('');
  }

  const rowsReguler = buatBarisBayar(anggotaReguler);

  // Versi kartu (mobile) dari tabel Daftar Bayar reguler — dipakai di layar
  // sempit (lihat .ds-cards-mobile/.ds-daftar-bayar-desktop di CSS) supaya
  // tidak perlu scroll ke samping untuk 12 kolom bulan. Tiap anggota jadi
  // satu kartu dengan grid 4 kolom berisi 12 tombol bulan (chip kecil),
  // memakai fungsi bantu & data yang SAMA (isWajibDanaSosial/
  // getDanaSosialBayar/hitungTunggakanDanaSosial/toggleDanaSosialBayar)
  // seperti versi tabel, supaya perilaku klik & aturan tetap identik —
  // cuma tampilannya yang beda.
  function buatKartuBayar(list){
    return list.map((a, idx) => {
      const chips = DANA_SOSIAL_BULAN_LABEL.map((l, i) => {
        const bulan = i + 1;
        if (!isWajibDanaSosial(a, tahun, bulan)){
          return `<span class="ds-chip ds-chip-muted" title="${esc(a.nama)} · ${l} ${tahun} — Belum gabung">${l}</span>`;
        }
        const rec = getDanaSosialBayar(a.id, tahun, bulan);
        const lunas = !!(rec && rec.lunas);
        const titleTxt = `${esc(a.nama)} · ${l} ${tahun} — ${lunas ? 'Lunas (ketuk untuk batalkan)' : 'Belum bayar (ketuk untuk tandai lunas)'}${lunas && rec && rec.diubah_oleh ? ` · ditandai oleh ${esc(rec.diubah_oleh)}` : ''}`;
        return `<button type="button" class="ds-chip ${lunas?'lunas':'belum'}" ${canEdit?`onclick="toggleDanaSosialBayar('${a.id}',${tahun},${bulan})"`:'disabled'} title="${titleTxt}"><span class="ds-chip-mark">${lunas?'✓':''}</span>${l}</button>`;
      }).join('');
      const tunggakan = hitungTunggakanDanaSosial(a, tahun);
      const tunggakanCell = !tunggakan.adaBulanJatuhTempo
        ? `<span class="ds-toggle-mono ds-muted" style="font-size:11.5px;">Belum jatuh tempo</span>`
        : (tunggakan.bulanBelum === 0
          ? `<span class="ds-lunas-tag">Lunas</span>`
          : `<span class="${tunggakan.bulanBelum>1?'ds-tunggakan-angka lebih':'ds-tunggakan-angka'}">${fmtRp(tunggakan.total)}</span>`);
      return `<div class="ds-card">
        <div class="ds-card-head">
          <span class="ds-card-no">${idx+1}</span>
          <span class="ds-card-nama">${esc(a.nama)}</span>
          <span class="ds-card-tunggakan">${tunggakanCell}</span>
        </div>
        <div class="ds-chip-grid">${chips}</div>
      </div>`;
    }).join('');
  }
  const cardsReguler = buatKartuBayar(anggotaReguler);

  function buatBarisPerantauanTahunan(list){
    return list.map((a, idx) => {
      const status = statusLunasTahunPerantauan(a, tahun);
      const cell = status.wajib === 0
        ? `<span class="ds-toggle ds-toggle-mono ds-muted" style="width:auto; padding:0 10px;" title="Belum jadi anggota di tahun ${tahun}">·</span>`
        : `<button type="button" class="ds-toggle ds-toggle-mono ${status.lunasSemua?'lunas':'belum'}" style="width:auto; min-width:110px; padding:0 12px; white-space:nowrap;" ${canEdit?`onclick="toggleDanaSosialLunasTahunPerantauan('${a.id}',${tahun})"`:'disabled'} title="${status.lunasSemua?`Lunas ${tahun}${status.tanggalTerakhir?` · dibayar ${fmtDate(status.tanggalTerakhir)}`:''}${status.diubahOleh?` · ditandai oleh ${esc(status.diubahOleh)}`:''} (klik untuk batalkan)`:`Belum lunas ${tahun} (klik untuk tandai lunas)`}">${status.lunasSemua?'✓ Lunas':'Belum Lunas'}</button>`;
      return `<tr>
        <td class="ds-no">${idx+1}</td>
        <td class="ds-nama">${esc(a.nama)}</td>
        <td class="ds-cell ds-status">${cell}</td>
      </tr>`;
    }).join('');
  }
  const rowsPerantauan = buatBarisPerantauanTahunan(anggotaPerantauan);

  const kelolaRows = anggotaList.map((a, idx) => {
    const nonaktif = a.aktif === false;
    return `<tr ${nonaktif?'style="opacity:.55;"':''}>
    <td class="ds-no">${idx+1}</td>
    <td class="ds-nama">${esc(a.nama)}${a.perantauan?' <span class="kategori-pill khusus">Perantauan</span>':''}${nonaktif?' <span class="kategori-pill">Nonaktif</span>':''}</td>
    <td style="text-align:left; padding-left:10px;">${fmtDate(a.tanggal_gabung)}</td>
    <td style="text-align:right; white-space:nowrap;">
      ${canEdit?`<button class="icon-btn" onclick="toggleAktifDanaSosialAnggota('${a.id}')" title="${nonaktif?'Aktifkan kembali':'Nonaktifkan (tanpa hapus data)'}">${nonaktif?'↩️':'⏸'}</button>
      <button class="icon-btn" onclick="openDanaSosialAnggotaModal('${a.id}')" title="Edit">✎</button>
      <button class="icon-btn" onclick="hapusDanaSosialAnggota('${a.id}')" title="Hapus">🗑</button>`:''}
    </td>
  </tr>`;
  }).join('');

  const rekapRows = DANA_SOSIAL_BULAN_LABEL.map((l, i) => {
    const bulan = i + 1;
    const r = hitungRekapBulanDanaSosial(tahun, bulan);
    // Kalau tidak ada kewajiban reguler DAN tidak ada uang Perantauan masuk
    // bulan ini, baris tampil kosong seperti semula. Tapi kalau ada uang
    // Perantauan (rapel) yang kebetulan masuk di bulan tanpa anggota reguler
    // wajib, tetap tampilkan barisnya — supaya uang itu tidak "hilang" dari
    // rekap sama sekali.
    if (r.wajib === 0 && r.terkumpulPerantauan === 0){
      return `<tr class="ds-rekap-kosong"><td>${l} ${tahun}</td><td colspan="6" class="hint">Belum ada anggota wajib bayar</td></tr>`;
    }
    return `<tr>
      <td>${l} ${tahun}</td>
      <td class="num">${r.wajib}</td>
      <td class="num">${r.lunas}</td>
      <td class="num">${fmtRp(r.terkumpul)}</td>
      <td class="num" title="Uang rapel dari anggota Perantauan, dihitung terpisah dari kepatuhan bulanan reguler tapi tetap masuk ke Saldo Bersih">${r.terkumpulPerantauan>0?fmtRp(r.terkumpulPerantauan):'–'}</td>
      <td class="num">${fmtRp(r.potongan)}</td>
      <td class="num ${r.saldoBersih<0?'ds-minus':''}">${fmtRp(r.saldoBersih)}${!r.sudahBerjalan?' <span class="hint">(proyeksi)</span>':''}</td>
    </tr>`;
  }).join('');

  let totalTerkumpulTahun = 0, totalTerkumpulPerantauanTahun = 0, totalPotonganTahun = 0;
  for (let b = 1; b <= 12; b++){
    const r = hitungRekapBulanDanaSosial(tahun, b);
    totalTerkumpulTahun += r.terkumpul;
    totalTerkumpulPerantauanTahun += r.terkumpulPerantauan;
    if (r.wajib > 0) totalPotonganTahun += r.potongan;
  }
  const totalSaldoTahun = (totalTerkumpulTahun + totalTerkumpulPerantauanTahun) - totalPotonganTahun;

  return `
  <div class="stat-grid-ringkasan" style="margin-bottom:26px;">
    <div class="stat-card"><div class="lbl">Total Anggota</div><div class="val">${anggotaAktifList.length}</div></div>
    <div class="stat-card pemasukan"><div class="lbl">Lunas Bulan Ini (${DANA_SOSIAL_BULAN_LABEL[now.getMonth()]} ${now.getFullYear()})</div><div class="val">${rekapBulanIni.lunas} / ${rekapBulanIni.wajib}</div></div>
    <div class="stat-card ${saldoTotal<0?'defisit':'saldo'}"><div class="lbl">Saldo Dana Sosial</div><div class="val">${fmtRp(saldoTotal)}</div></div>
  </div>

  <div class="lomba-tabs">
    <button type="button" class="lomba-tabbtn ${danaSosialActiveTab==='daftar'?'active':''}" onclick="setDanaSosialTab('daftar')"><i data-lucide="wallet" class="inline-icon"></i> Daftar Bayar</button>
    <button type="button" class="lomba-tabbtn ${danaSosialActiveTab==='perantauan'?'active':''}" onclick="setDanaSosialTab('perantauan')"><i data-lucide="compass" class="inline-icon"></i> Perantauan</button>
    <button type="button" class="lomba-tabbtn ${danaSosialActiveTab==='rekap'?'active':''}" onclick="setDanaSosialTab('rekap')"><i data-lucide="bar-chart-3" class="inline-icon"></i> Rekap Bulanan</button>
    <button type="button" class="lomba-tabbtn ${danaSosialActiveTab==='kelola'?'active':''}" onclick="setDanaSosialTab('kelola')"><i data-lucide="users" class="inline-icon"></i> Kelola Anggota</button>
  </div>

  <div style="display:${danaSosialActiveTab==='daftar'?'block':'none'};">
  <div class="panel">
    <div class="panel-head">
      <div><h3>Daftar Bayar</h3>
        <div class="desc">Iuran ${fmtRp(DANA_SOSIAL_IURAN_PER_ORANG)}/orang/bulan · klik sel bulan untuk tandai lunas/belum · kolom Harus Bayar menumpuk kalau ada bulan sebelumnya yang belum dilunasi</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${dsTahunTriggerHtml('daftar')}
      </div>
    </div>
    <div class="panel-body flush">
      <div class="ds-daftar-bayar-desktop" style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
        <table class="ds-table ds-has-no">
          <thead><tr><th class="ds-no-h">No</th><th class="ds-nama-h">Nama</th>${theadBulan}<th class="ds-tunggakan-h">Harus Bayar</th></tr></thead>
          <tbody>${rowsReguler || `<tr class="empty-row"><td colspan="15">Belum ada anggota Dana Sosial. ${canEdit?'Buka tab Kelola Anggota untuk mulai.':'Hanya role tertentu yang bisa menambah anggota.'}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="ds-cards-mobile">
        ${cardsReguler || `<div class="ds-cards-empty">Belum ada anggota Dana Sosial. ${canEdit?'Buka tab Kelola Anggota untuk mulai.':'Hanya role tertentu yang bisa menambah anggota.'}</div>`}
      </div>
    </div>
  </div>
  </div>

  <div style="display:${danaSosialActiveTab==='perantauan'?'block':'none'};">
  <div class="panel">
    <div class="panel-head">
      <div><h3>Anggota Perantauan</h3>
        <div class="desc">Bayar setahun sekali (rapel) saat pulang/nitip bayar · tandai Lunas kalau sudah bayar penuh tahun ${tahun}</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${dsTahunTriggerHtml('perantauan')}
      </div>
    </div>
    <div class="panel-body flush">
      <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
        <table class="ds-table ds-has-no">
          <thead><tr><th class="ds-no-h">No</th><th class="ds-nama-h">Nama</th><th class="ds-status-h">Lunas Tahun ${tahun}</th></tr></thead>
          <tbody>${rowsPerantauan || `<tr class="empty-row"><td colspan="3">Belum ada anggota Perantauan. ${canEdit?'Tandai anggota sebagai Perantauan di tab Kelola Anggota.':''}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </div>
  </div>

  <div style="display:${danaSosialActiveTab==='rekap'?'block':'none'};">
  <div class="panel">
    <div class="panel-head">
      <div><h3>Rekap Bulanan ${tahun}</h3>
        <div class="desc">Terkumpul (reguler) + Perantauan (rapel), dikurangi potongan konsumsi pertemuan (flat ${fmtRp(DANA_SOSIAL_POTONGAN_KONSUMSI)}/bulan)</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${dsTahunTriggerHtml('rekap')}
      </div>
    </div>
    <div class="panel-body flush">
      <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
        <table class="ds-rekap-table">
          <thead><tr><th>Bulan</th><th>Wajib</th><th>Lunas</th><th>Terkumpul</th><th>Perantauan</th><th>Potongan</th><th>Saldo Bersih</th></tr></thead>
          <tbody>${rekapRows}</tbody>
          <tfoot><tr class="ds-rekap-total"><td>Total ${tahun}</td><td></td><td></td><td class="num">${fmtRp(totalTerkumpulTahun)}</td><td class="num">${fmtRp(totalTerkumpulPerantauanTahun)}</td><td class="num">${fmtRp(totalPotonganTahun)}</td><td class="num ${totalSaldoTahun<0?'ds-minus':''}">${fmtRp(totalSaldoTahun)}</td></tr></tfoot>
        </table>
      </div>
      <div class="ds-footnote">* Saldo bulan yang belum terlewati bersifat proyeksi (asumsi potongan konsumsi tetap berlaku).</div>
    </div>
  </div>
  </div>

  <div style="display:${danaSosialActiveTab==='kelola'?'block':'none'};">
  <div class="panel">
    <div class="panel-head">
      <div><h3>Kelola Anggota Dana Sosial</h3>
        <div class="desc">Tambah, ubah, atau hapus anggota master Dana Sosial</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${canEdit?`<button class="btn secondary" onclick="sinkronkanPerantauanDanaSosial()">🔄 Sinkronkan Status Perantauan</button>`:''}
        ${canEdit?`<button class="btn" onclick="openImporDanaSosialModal()">📥+ Tambah dari Database Anggota</button>`:''}
      </div>
    </div>
    <div class="field-hint" style="color:var(--ink-soft); font-size:12px; padding:10px 18px 0;">Nama anggota baru wajib ditambahkan lewat <a href="#" onclick="goSection('anggota'); return false;">Database Anggota</a> terlebih dahulu, lalu diambil ke sini — supaya hanya ada satu master data anggota.</div>
    <div class="panel-body flush" style="padding-top:12px;">
      <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
        <table class="ds-table ds-has-no">
          <thead><tr><th class="ds-no-h">No</th><th class="ds-nama-h">Nama</th><th style="text-align:left; padding-left:10px;">Tanggal Gabung</th><th style="text-align:right;">Aksi</th></tr></thead>
          <tbody>${kelolaRows || `<tr class="empty-row"><td colspan="4">Belum ada anggota Dana Sosial. ${canEdit?'Klik + Tambah dari Database Anggota untuk mulai.':'Hanya role tertentu yang bisa menambah anggota.'}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  </div>
  </div>`;
}

// Pengamanan sama seperti toggleDanaSosialLunasTahunPerantauan di atas:
// membatalkan lunas (rec.lunas true → false) wajib konfirmasi + tampilkan
// siapa yang menandainya terakhir, dan setiap toggle dicatat jejaknya.
// Menandai lunas (belum → lunas) tetap satu klik, tidak dipersulit, karena
// itu arah yang risikonya rendah (cuma mencatat orang sudah bayar).
async function toggleDanaSosialBayar(anggotaId, tahun, bulan){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const anggota = db.danaSosialAnggota.find(a => a.id === anggotaId);
  if (!anggota) return;
  if (!isWajibDanaSosial(anggota, tahun, bulan)) return;
  let rec = getDanaSosialBayar(anggotaId, tahun, bulan);
  if (rec && rec.lunas){
    const jejak = rec.diubah_oleh ? ` Terakhir ditandai oleh ${rec.diubah_oleh}${rec.tanggal_bayar?` (${fmtDate(rec.tanggal_bayar)})`:''}.` : '';
    if (!confirm(`Batalkan status LUNAS "${anggota.nama}" untuk ${DANA_SOSIAL_BULAN_LABEL[bulan-1]} ${tahun}?${jejak}\n\nTindakan ini tercatat atas nama Anda.`)) return;
    rec.lunas = false;
    rec.tanggal_bayar = null;
    rec.diubah_oleh = namaUserDanaSosial();
    rec.diubah_pada = new Date().toISOString();
  } else if (rec){
    rec.lunas = true;
    rec.tanggal_bayar = todayISO();
    rec.diubah_oleh = namaUserDanaSosial();
    rec.diubah_pada = new Date().toISOString();
  } else {
    rec = { id: uid(), anggota_id: anggotaId, tahun: Number(tahun), bulan: Number(bulan), lunas: true, tanggal_bayar: todayISO(), diubah_oleh: namaUserDanaSosial(), diubah_pada: new Date().toISOString(), created_at: new Date().toISOString() };
    db.danaSosialBayar.push(rec);
  }
  saveDB(); renderContent();
}

// Anggota Dana Sosial baru HANYA boleh masuk lewat "Ambil dari Database
// Anggota" (openImporDanaSosialModal) — supaya Database Anggota (kt_anggota)
// tetap jadi satu-satunya master nama anggota. Fungsi ini jadi khusus EDIT
// (tanggal gabung & status perantauan) untuk anggota yang sudah ada di sini;
// kalau terpanggil tanpa id (jalur lama), arahkan ke Database Anggota saja.
function openDanaSosialAnggotaModal(id){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const editing = id ? db.danaSosialAnggota.find(a => a.id === id) : null;
  if (!editing){
    toast('➡️ Tambahkan nama anggota baru di Database Anggota, lalu ambil ke sini');
    goSection('anggota');
    return;
  }
  setModal('Edit Anggota Dana Sosial', `
    <div class="field"><label>Nama</label><input id="f-ds-nama" value="${esc(editing.nama)}" disabled style="opacity:.6; cursor:not-allowed;"></div>
    <div class="field-hint" style="color:var(--ink-soft); font-size:12px; margin:-8px 0 10px;">Nama diambil dari Database Anggota dan tidak bisa diubah di sini. Kalau salah ketik, perbaiki dulu di <a href="#" onclick="closeModal(); goSection('anggota'); return false;">Database Anggota</a>, lalu hapus &amp; ambil ulang anggota ini.</div>
    <div class="field"><label>Tanggal Gabung</label><input id="f-ds-gabung" type="date" value="${editing.tanggal_gabung}"></div>
    <div class="hint">Bulan sebelum tanggal gabung otomatis dikosongkan di tabel (dianggap belum wajib bayar).</div>
    <label style="display:flex; align-items:center; gap:8px; margin-top:10px; cursor:pointer;">
      <input type="checkbox" id="f-ds-perantauan" ${editing.perantauan?'checked':''}> Perantauan
    </label>
    <div class="hint">Anggota Perantauan ditampilkan di tabel terpisah (biasanya bayar setahun sekali/rapel).</div>
  `, [
    {label:'Batal', cls:'secondary', onclick:()=>closeModal()},
    {label:'Hapus', cls:'danger', onclick:()=>{ closeModal(); hapusDanaSosialAnggota(editing.id); }},
    {label:'Simpan', cls:'', onclick:()=>{
      const tanggal_gabung = document.getElementById('f-ds-gabung').value || todayISO();
      const perantauan = document.getElementById('f-ds-perantauan').checked;
      closeModal();
      editing.tanggal_gabung = tanggal_gabung; editing.perantauan = perantauan;
      notifyTelegram(`✏️ Edit anggota Dana Sosial: ${editing.nama}`, 'dana_sosial');
      saveDB(); renderContent();
    }}
  ]);
}

// Nonaktifkan (bukan hapus): dipakai untuk anggota yang pindah/keluar tapi
// riwayat bayarnya tetap mau disimpan. Anggota nonaktif otomatis hilang dari
// tabel Daftar Bayar & Rekap Bulanan (lihat isWajibDanaSosial), tapi masih
// kelihatan (pudar + label "Nonaktif") di tab Kelola Anggota dan bisa
// diaktifkan lagi kapan saja lewat tombol yang sama.
function toggleAktifDanaSosialAnggota(id){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const a = db.danaSosialAnggota.find(x => x.id === id); if (!a) return;
  const jadiAktif = a.aktif === false; // sebelumnya nonaktif -> aktifkan, sebaliknya nonaktifkan
  if (!jadiAktif && !confirm(`Nonaktifkan "${a.nama}" dari Dana Sosial? Anggota ini akan hilang dari tabel Daftar Bayar & Rekap Bulanan, tapi riwayat bayarnya tetap tersimpan dan bisa diaktifkan lagi kapan saja.`)) return;
  a.aktif = jadiAktif;
  saveDB(); renderContent();
  toast(jadiAktif ? `✓ ${a.nama} diaktifkan kembali` : `⏸ ${a.nama} dinonaktifkan`);
  notifyTelegram(jadiAktif ? `↩️ Aktifkan kembali anggota Dana Sosial: ${a.nama}` : `⏸ Nonaktifkan anggota Dana Sosial: ${a.nama}`, 'dana_sosial');
}

function hapusDanaSosialAnggota(id){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const a = db.danaSosialAnggota.find(x => x.id === id); if (!a) return;
  if (!confirm(`Hapus "${a.nama}" dari Dana Sosial? Semua riwayat bayar bulanan anggota ini juga akan ikut terhapus.`)) return;
  db.danaSosialAnggota = db.danaSosialAnggota.filter(x => x.id !== id);
  db.danaSosialBayar = db.danaSosialBayar.filter(b => b.anggota_id !== id);
  saveDB(); renderContent();
  notifyTelegram(`🗑️ Hapus anggota Dana Sosial: ${a.nama}`, 'dana_sosial');
}

/* ============================================================
   IMPOR ANGGOTA DARI DATABASE ANGGOTA (kt_anggota)
   Dana Sosial punya daftar anggota MASTER TERPISAH dari kt_anggota
   (lihat catatan di atas file ini), jadi fitur ini cuma cara CEPAT
   mengisi anggota Dana Sosial dari nama-nama yang sudah ada di
   Database Anggota (iuran per-event) — bukan sinkronisasi permanen.
   Nama diambil dari SEMUA event (unik per nama, tidak peduli event
   mana), lalu nama yang sudah terdaftar di Dana Sosial dilewati
   otomatis (anti dobel).

   PENTING soal urutan dedup: nama yang sama bisa muncul di lebih dari
   satu tahun event dengan kategori berbeda (mis. dulu 'Sekolah',
   sekarang 'Perantauan'). Baris yang "menang" saat dedup dipakai untuk
   pre-centang checkbox Perantauan di modal impor, jadi harus baris dari
   TAHUN EVENT TERBARU orang itu — bukan menang cuma karena kebetulan
   duluan secara abjad. Makanya diurutkan tahun (desc) dulu, baru nama
   sebagai tie-breaker dalam tahun yang sama.
   ============================================================ */
function daftarNamaUnikDariDatabaseAnggota(){
  const tahunEvent = new Map(db.events.map(e => [e.id, Number(e.tahun) || 0]));
  const seen = new Set();
  const out = [];
  db.anggota.slice()
    .sort((a,b)=>{
      const ta = tahunEvent.get(a.event_id) || 0;
      const tb = tahunEvent.get(b.event_id) || 0;
      if (tb !== ta) return tb - ta; // tahun terbaru duluan
      return a.nama.localeCompare(b.nama,'id',{sensitivity:'base'});
    })
    .forEach(a=>{
      const key = (a.nama||'').trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(a);
    });
  // Baris yang dipakai (kategori dari tahun terbaru) sudah terpilih di atas;
  // urutan TAMPILAN di modal tetap abjad seperti semula.
  return out.sort((a,b)=>a.nama.localeCompare(b.nama,'id',{sensitivity:'base'}));
}

function openImporDanaSosialModal(){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const sumber = daftarNamaUnikDariDatabaseAnggota();
  if (sumber.length === 0){ toast('Database Anggota masih kosong'); return; }
  setModal('📥 Ambil Anggota dari Database Anggota', `
    <div class="field-hint" style="color:var(--ink-soft); font-size:12.5px; margin:-2px 0 10px;">Nama diambil dari Database Anggota (semua event, tanpa duplikat). Nama yang sudah terdaftar di Dana Sosial otomatis dilewati. Tanggal gabung diisi hari ini untuk semua yang dipilih.</div>
    <div class="field"><label>Tanggal Gabung</label><input id="impor-ds-gabung" type="date" value="${todayISO()}"></div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
      <label style="font-size:12px; display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="impor-ds-pilih-semua" onchange="toggleImporDanaSosialPilihSemua(this.checked)"> Pilih Semua</label>
      <span id="impor-ds-count-label" style="font-size:12px; color:var(--ink-soft);"></span>
    </div>
    <div id="impor-ds-list" style="max-height:320px; overflow-y:auto; border:1px solid var(--line); border-radius:8px; padding:4px 8px;"></div>
  `, [
    {label:'Batal', cls:'secondary', onclick:closeModal},
    {label:'Ambil Anggota Terpilih', cls:'', onclick:konfirmasiImporDanaSosial}
  ]);
  setTimeout(renderImporDanaSosialList, 0);
}

function renderImporDanaSosialList(){
  const listEl = document.getElementById('impor-ds-list');
  if (!listEl) return;
  const namaSekarang = new Set(db.danaSosialAnggota.map(a=>a.nama.trim().toLowerCase()));
  const sumber = daftarNamaUnikDariDatabaseAnggota();
  listEl.innerHTML = sumber.map(a=>{
    const dobel = namaSekarang.has(a.nama.trim().toLowerCase());
    const isPerantauan = a.kategori === 'perantauan';
    return `<label style="display:flex; align-items:center; gap:8px; padding:6px 2px; ${dobel?'opacity:.5;':''} border-bottom:1px solid var(--line);">
      <input type="checkbox" class="impor-ds-chk" value="${esc(a.nama)}" data-perantauan="${isPerantauan?'1':'0'}" ${dobel?'disabled':'checked'} onchange="updateImporDanaSosialCountLabel()">
      <span style="flex:1;">${esc(a.nama)} ${isPerantauan?'<span class="kategori-pill khusus">Perantauan</span>':''}</span>
      ${dobel?'<span style="font-size:11px;color:var(--ink-soft);">sudah ada</span>':''}
    </label>`;
  }).join('');
  const selectableCount = document.querySelectorAll('.impor-ds-chk:not(:disabled)').length;
  const pilihSemuaEl = document.getElementById('impor-ds-pilih-semua');
  if (pilihSemuaEl) pilihSemuaEl.checked = selectableCount > 0;
  updateImporDanaSosialCountLabel();
}

function toggleImporDanaSosialPilihSemua(checked){
  document.querySelectorAll('.impor-ds-chk:not(:disabled)').forEach(c=>c.checked=checked);
  updateImporDanaSosialCountLabel();
}

function updateImporDanaSosialCountLabel(){
  const label = document.getElementById('impor-ds-count-label');
  if (!label) return;
  const total = document.querySelectorAll('.impor-ds-chk').length;
  const checked = document.querySelectorAll('.impor-ds-chk:checked').length;
  label.textContent = total ? `${checked} dari ${total} dipilih` : '';
}

function konfirmasiImporDanaSosial(){
  const checked = Array.from(document.querySelectorAll('.impor-ds-chk:checked'));
  if (checked.length === 0){ toast('Pilih minimal satu anggota untuk diambil'); return; }
  const tanggal_gabung = document.getElementById('impor-ds-gabung').value || todayISO();
  let count = 0;
  checked.forEach(chk=>{
    const nama = chk.value.trim();
    if (!nama) return;
    const perantauan = chk.dataset.perantauan === '1';
    db.danaSosialAnggota.push({ id: uid(), nama, tanggal_gabung, perantauan, aktif: true, created_at: new Date().toISOString() });
    count++;
  });
  saveDB(); closeModal(); renderContent();
  toast(`✓ ${count} anggota diambil dari Database Anggota`);
  notifyTelegram(`📥 Ambil ${count} anggota Dana Sosial dari Database Anggota`, `Tanggal gabung: ${fmtDate(tanggal_gabung)}`, 'dana_sosial');
}

/* ============================================================
   SINKRONISASI STATUS PERANTAUAN UNTUK DATA YANG SUDAH ADA
   Anggota Dana Sosial yang ditambahkan sebelum fitur pemisahan
   Perantauan ada, semuanya masih `perantauan=false` (tercampur
   dengan reguler di tabel utama). Fungsi ini mencocokkan nama tiap
   anggota Dana Sosial dengan Database Anggota (kt_anggota, semua
   event) — kalau ADA salah satu baris dengan nama yang sama dan
   kategori 'perantauan', anggota tsb otomatis ditandai Perantauan.
   Nama yang sudah ditandai manual sebagai Perantauan tidak diutak-
   atik lagi (hanya menambah, tidak pernah menghapus status).
   ============================================================ */
// Logika inti (dipakai baik oleh tombol manual maupun auto-sync di bawah):
// tandai perantauan=true untuk anggota Dana Sosial yang namanya (huruf
// kecil, sudah di-trim) ada di set yang diberikan. Tidak pernah menghapus
// status yang sudah ditandai manual — hanya menambah. Tidak memanggil
// saveDB()/render/notifyTelegram(); itu tanggung jawab pemanggil.
function terapkanStatusPerantauanDanaSosial(namaSetLower){
  let count = 0;
  db.danaSosialAnggota.forEach(a => {
    if (!a.perantauan && namaSetLower.has((a.nama||'').trim().toLowerCase())){
      a.perantauan = true;
      count++;
    }
  });
  return count;
}

function sinkronkanPerantauanDanaSosial(){
  if (!canEditSection('dana-sosial')) { toast('⛔ Anda tidak memiliki akses untuk mengedit Dana Sosial'); return; }
  const namaPerantauan = new Set(
    db.anggota.filter(a => a.kategori === 'perantauan').map(a => (a.nama||'').trim().toLowerCase())
  );
  if (namaPerantauan.size === 0){ toast('Tidak ada anggota berkategori Perantauan di Database Anggota'); return; }
  const count = terapkanStatusPerantauanDanaSosial(namaPerantauan);
  if (count === 0){ toast('Semua anggota sudah sesuai — tidak ada yang perlu disesuaikan'); return; }
  saveDB(); renderContent();
  toast(`✓ ${count} anggota dipindah ke tabel Perantauan`);
  notifyTelegram(`🔄 Sinkronkan status Perantauan Dana Sosial`, `${count} anggota ditandai Perantauan (dicocokkan dari Database Anggota)`, 'dana_sosial');
}

// Dipanggil OTOMATIS dari Database Anggota (js/08-anggota.js) tiap kali
// seseorang ditambah/diedit dengan kategori 'perantauan' — supaya status
// Perantauan di Dana Sosial tidak ketinggalan cuma karena tombol
// "Sinkronkan Status Perantauan" di atas lupa/belum diklik. Sengaja SILENT
// (tanpa toast/notifyTelegram sendiri) karena cuma efek samping dari save
// Database Anggota yang sedang berjalan — saveDB() dipanggil di sana.
// Tombol manual tetap dipertahankan untuk sinkron massal data lama.
function autoSinkronkanPerantauanUntukNama(nama){
  if (!nama) return;
  terapkanStatusPerantauanDanaSosial(new Set([nama.trim().toLowerCase()]));
}
