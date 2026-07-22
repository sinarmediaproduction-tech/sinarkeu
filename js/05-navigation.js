/* ============================================================
   NAV / ROUTING
   ============================================================ */
const SECTIONS = [
  {key:'jadwal', label:'Jadwal Kegiatan', sub:'Kelola jadwal dan pengingat', icon:'calendar', adminOnly: false},
  {key:'dashboard', label:'Buku Kegiatan', sub:'Rekap & Reminder', icon:'grid', adminOnly: false},
  {key:'anggota', label:'Iuran Anggota', sub:'Kelola iuran anggota', icon:'users', adminOnly: false},
  {key:'donatur', label:'Donatur', sub:'Sumbangan tunai dari donatur', icon:'heart', adminOnly: false},
  {key:'transaksi', label:'Pemasukan Lain', sub:'Pemasukan di luar iuran & donasi', icon:'swap', adminOnly: false},
  {key:'operasional', label:'Operasional Kegiatan', sub:'Biaya operasional umum event', icon:'briefcase', adminOnly: false},
  {key:'lomba', label:'Lomba & Perlengkapan', sub:'Kebutuhan barang per lomba', icon:'flag', adminOnly: false},
  {key:'hadiah', label:'Kebutuhan Hadiah', sub:'Belanja hadiah per kategori peserta', icon:'gift', adminOnly: false},
  {key:'hadiah-jalan', label:'Hadiah Jalan Santai', sub:'Kelola hadiah jalan santai', icon:'walk', adminOnly: false},
  {key:'belanja-perlengkapan', label:'Belanja Perlengkapan', sub:'Daftar belanja perlengkapan lomba', icon:'package', adminOnly: false},
  {key:'belanja-jalan', label:'Belanja Jalan Santai', sub:'Daftar belanja hadiah jalan santai', icon:'shopping-bag', adminOnly: false},
  {key:'belanja-hadiah', label:'Belanja Hadiah', sub:'Daftar belanja hadiah lomba', icon:'shopping', adminOnly: false},
  {key:'lpj', label:'Laporan (LPJ)', sub:'Cetak laporan pertanggungjawaban', icon:'report', adminOnly: false},
  {key:'daftar-anggota', label:'Daftar Anggota', sub:'Rekap & daftar nama anggota', icon:'clipboard', adminOnly: false},
  {key:'pengaturan', label:'Pengaturan', sub:'Tarif iuran & event', icon:'gear', adminOnly: true},
  {key:'database-anggota', label:'Database Anggota', sub:'Cek & filter semua anggota', icon:'database', adminOnly: false},
  {key:'users', label:'Manajemen User', sub:'Kelola akun pengguna', icon:'users', adminOnly: true},
  {key:'agenda', label:'Agenda Kegiatan', sub:'', icon:'calendar', adminOnly: false},
  {key:'gudang', label:'Gudang Aset', sub:'Inventaris & pinjam aset desa', icon:'package', adminOnly: false},
  {key:'jadwal-sinoman', label:'Sinoman', sub:'Jadwal piket pagi/siang/sore', icon:'calendar', adminOnly: false},
  {key:'panduan', label:'Panduan', sub:'Cara pakai aplikasi ini', icon:'book', adminOnly: false},
  {key:'dokumen', label:'Surat & Dokumen', sub:'Undangan, proposal & absensi', icon:'clipboard', adminOnly: false},
  {key:'kas', label:'Kas Karang Taruna', sub:'', icon:'wallet', adminOnly: false},
  {key:'dana-sosial', label:'Dana Sosial', sub:'Iuran bulanan Rp 5.000/anggota', icon:'coins', adminOnly: false},
  {key:'bookmark', label:'Tautan Penting', sub:'Kumpulan link penting organisasi', icon:'link', adminOnly: false},
];

// `SECTIONS` di atas adalah const statis (dievaluasi sebelum data organisasi
// ter-load), jadi label menu "Kas Karang Taruna" TIDAK BISA langsung baca
// nama kas dari Profil Organisasi di titik itu. Fungsi ini yang dipanggil
// setiap kali menu dirender (bukan `s.label` langsung) supaya label section
// 'kas' selalu ikut nama buku kas terbaru dari Pengaturan > Profil Organisasi.
function sectionLabel(s){
  return s.key === 'kas' ? getOrgNamaKas() : s.label;
}
function sectionLabelByKey(key){
  const s = SECTIONS.find(s=>s.key===key);
  return s ? sectionLabel(s) : key;
}

// Menu yang tidak terikat event tertentu (datanya global, bukan per-event).
// Menu ini ditampilkan terpisah di atas, antara info login dan dropdown
// Kegiatan Aktif, supaya jelas tidak berubah walau event aktif diganti.
const GLOBAL_MENU_KEYS = ['kas', 'dana-sosial', 'agenda', 'dokumen', 'database-anggota', 'gudang', 'bookmark', 'jadwal-sinoman', 'panduan', 'users', 'pengaturan'];

/* ============================================================
   FITUR OPSIONAL PER EVENT
   Beberapa event (mis. sekadar iuran rutin) tidak butuh semua modul.
   Fitur di bawah ini bisa dimatikan per-event lewat modal Buat/Edit
   Event. Menu inti (Buku Kegiatan, Iuran, Database Anggota, LPJ,
   Pengaturan, Manajemen User) selalu aktif dan tidak bisa dimatikan.
   ============================================================ */
const FITUR_OPSIONAL = [
  {key:'donatur', label:'Donatur', menus:['donatur']},
  {key:'transaksi', label:'Pemasukan Lain', menus:['transaksi']},
  {key:'operasional', label:'Operasional Kegiatan', menus:['operasional']},
  {key:'lomba', label:'Lomba & Perlengkapan', menus:['lomba','belanja-perlengkapan']},
  {key:'hadiah', label:'Hadiah Lomba', menus:['hadiah','belanja-hadiah']},
  {key:'jalan_santai', label:'Hadiah Jalan Santai', menus:['hadiah-jalan','belanja-jalan']},
  {key:'jadwal', label:'Jadwal Kegiatan', menus:['jadwal']},
];
// Preset dipakai di modal event supaya tidak perlu centang satu-satu tiap bikin event baru.
// Catatan: "dokumen" (Surat & Dokumen) sengaja TIDAK ada di sini lagi — sejak
// menu ini berdiri sendiri seperti Gudang, tidak bisa dimatikan per event.
const FITUR_PRESET_SEDERHANA = {donatur:false, transaksi:false, operasional:false, lomba:false, hadiah:false, jalan_santai:false, jadwal:false};
const FITUR_PRESET_LENGKAP = {donatur:true, transaksi:true, operasional:true, lomba:true, hadiah:true, jalan_santai:true, jadwal:true};

// Default: fitur dianggap aktif kalau belum pernah diset (backward-compat utk event lama).
function eventFitur(ev){
  const f = (ev && ev.fitur) || {};
  const out = {};
  FITUR_OPSIONAL.forEach(x => out[x.key] = f[x.key] !== false);
  return out;
}
// Cek apakah sebuah menu/section aktif untuk event yang sedang dibuka.
// Menu yang tidak terdaftar di FITUR_OPSIONAL (menu inti) selalu true.
function isMenuAktif(menuKey){
  const ev = activeEvent();
  if (!ev) return true;
  const fitur = eventFitur(ev);
  const item = FITUR_OPSIONAL.find(x => x.menus.includes(menuKey));
  if (!item) return true;
  return !!fitur[item.key];
}
const ICONS = {
  grid:'<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" stroke-width="1.6" stroke="currentColor" fill="none" stroke-linejoin="round"/>',
  users:'<circle cx="8.5" cy="8" r="3" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M2.5 20c0-3.5 2.7-6 6-6s6 2.5 6 6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="17" cy="8.5" r="2.4" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M15.5 13c2.6.3 4.5 2.3 4.9 5.3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  database:'<rect x="3" y="4" width="18" height="6" rx="1" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3 10v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3 16v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="12" cy="7" r="1.2" fill="currentColor"/><circle cx="17" cy="7" r="1.2" fill="currentColor"/>',
  heart:'<path d="M12 20s-7.5-4.6-9.4-9.3C1.4 7.6 3 4.7 6.1 4.3c2-.3 3.6.8 5.9 3 2.3-2.2 3.9-3.3 5.9-3 3.1.4 4.7 3.3 3.5 6.4C19.5 15.4 12 20 12 20z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>',
  swap:'<path d="M4 8h14M14 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 16H6M10 20l-4-4 4-4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  briefcase:'<rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3 12h18" stroke="currentColor" stroke-width="1.6"/>',
  flag:'<path d="M5 3v18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5 4c3-1.4 4.7.4 7.5-.9C15 2 17 2.3 19 3.3v9c-2-1-4-1.3-6.5 0-2.8 1.3-4.5-.5-7.5.9V4z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  gift:'<polyline points="20 12 20 22 4 22 4 12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><rect x="2" y="7" width="20" height="5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><line x1="12" y1="22" x2="12" y2="7" stroke="currentColor" stroke-width="1.6"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  gear:'<path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  shopping:'<path d="M6 6h12l2 12H4L6 6z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="9" cy="20" r="1.5" fill="currentColor"/><circle cx="15" cy="20" r="1.5" fill="currentColor"/><path d="M9 12h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  package:'<rect x="3" y="5" width="18" height="14" rx="1" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8 5v14M16 5v14M3 10h18" stroke="currentColor" stroke-width="1.6"/>',
  walk:'<ellipse cx="8.5" cy="9" rx="2" ry="3" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="6.6" cy="4.3" r="0.9" fill="currentColor"/><circle cx="8.5" cy="3.6" r="0.9" fill="currentColor"/><circle cx="10.4" cy="4.3" r="0.9" fill="currentColor"/><ellipse cx="15.5" cy="16" rx="2" ry="3" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="13.6" cy="11.3" r="0.9" fill="currentColor"/><circle cx="15.5" cy="10.6" r="0.9" fill="currentColor"/><circle cx="17.4" cy="11.3" r="0.9" fill="currentColor"/>',
  'shopping-bag':'<rect x="5" y="8" width="14" height="13" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8 6c0-2.2 1.8-4 4-4s4 1.8 4 4v2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="9" cy="14" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1" fill="currentColor"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.6"/><path d="M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/><circle cx="16" cy="14" r="1.2" fill="currentColor"/><circle cx="8" cy="14" r="1.2" fill="currentColor"/>',
  pen:'<path d="M4 20l1-4L15 6l4 4L9 20l-4 1z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M13 8l3 3" stroke="currentColor" stroke-width="1.6"/>',
  pot:'<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-6z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M2 10h20" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M2 8h3M19 8h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  food:'<path d="M7 2v8M5 2v5a2 2 0 0 0 2 2 2 2 0 0 0 2-2V2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10v12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M17 2c-1.5 0-2.5 1.6-2.5 4s1 4 2.5 4v12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  bath:'<path d="M12 3c3 4 5 6.6 5 9.5A5 5 0 0 1 7 12.5C7 9.6 9 7 12 3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  tag:'<path d="M12 3h6a2 2 0 0 1 2 2v6L11 20l-8-8L12 3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="16" cy="7" r="1.3" fill="currentColor"/>',
  report:'<path d="M6 3h9l3 3v15H6V3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M15 3v3h3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M9 12h6M9 15h6M9 9h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  clipboard:'<rect x="5" y="4" width="14" height="17" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><rect x="8.5" y="2.5" width="7" height="3.5" rx="1" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  wallet:'<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3H5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H4a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="16.5" cy="14" r="1.4" fill="currentColor"/>',
  coins:'<circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M14.5 9c2.8.5 4.5 2 4.5 4.5 0 3-3.4 5.5-7.5 5.5-2.7 0-5-1.1-6.3-2.7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M7 9h4M9 6.5v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  book:'<path d="M4 5.5c0-1 .8-1.8 1.8-1.8H12v15.6H5.8c-1 0-1.8.8-1.8 1.8V5.5z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M20 5.5c0-1-.8-1.8-1.8-1.8H12v15.6h6.2c1 0 1.8.8 1.8 1.8V5.5z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
};
function icon(name){ return `<svg viewBox="0 0 24 24">${ICONS[name]||''}</svg>`; }

let currentSection = 'dashboard';

function renderSidebar(){
  const sel = document.getElementById('event-select');
  sel.innerHTML = db.events.length
    ? db.events.map(e=>`<option value="${e.id}" ${e.id===db.activeEventId?'selected':''}>${esc(e.nama)}</option>`).join('')
    : `<option value="">— Belum ada event —</option>`;

  const user = getCurrentUser();
  const isLoggedIn = !!user;
  const isAdminUser = user && user.role === 'admin';
  
  // Update user info
  const nameDisplay = document.getElementById('user-name-text');
  const userIcon = document.getElementById('user-icon');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');
  
  if (isLoggedIn) {
    nameDisplay.textContent = user.name;
    userIcon.textContent = user.role === 'admin' ? '⚡' : '👤';
    btnLogin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
  } else {
    nameDisplay.textContent = 'Anggota';
    userIcon.textContent = '👤';
    btnLogin.style.display = 'inline-block';
    btnLogout.style.display = 'none';
  }

  const nav = document.getElementById('nav');
  const navGlobal = document.getElementById('nav-global');
  const isPetugasUser = user && user.role === 'petugas';
  const visibleSections = SECTIONS
    .filter(s => !s.adminOnly || isAdminUser)
    .filter(s => isMenuAktif(s.key))
    .filter(s => {
      if (!isLoggedIn) return isGuestVisible(s.key);
      if (isPetugasUser) return s.key === 'dashboard' || userSections().includes(s.key);
      return true;
    });

  const renderNavItem = s => `
    <div class="nav-item ${s.key===currentSection?'active':''} ${!isLoggedIn && !s.adminOnly ? '' : ''}" data-nav="${s.key}">
      ${icon(s.icon)} <span>${esc(sectionLabel(s))}</span>
      ${s.adminOnly && !isAdminUser ? `<span class="lock-icon">🔒</span>` : ''}
    </div>`;

  navGlobal.innerHTML = visibleSections
    .filter(s => GLOBAL_MENU_KEYS.includes(s.key))
    .sort((a, b) => GLOBAL_MENU_KEYS.indexOf(a.key) - GLOBAL_MENU_KEYS.indexOf(b.key))
    .map(renderNavItem).join('');
  nav.innerHTML = visibleSections.filter(s => !GLOBAL_MENU_KEYS.includes(s.key)).map(renderNavItem).join('');

  // Buat event baru: khusus Administrator
  document.getElementById('btn-new-event').style.display = isAdminUser ? 'inline-block' : 'none';
}

// Nama key localStorage tempat menyimpan halaman terakhir yang dibuka, supaya
// saat halaman di-refresh (F5) user tetap berada di halaman yang sama, tidak
// selalu dilempar balik ke Buku Kegiatan (dashboard).
const LAST_SECTION_KEY = 'merdeka_last_section';

function goSection(key, opts){
  const isFallback = !!(opts && opts.isFallback);
  const user = getCurrentUser();
  const section = SECTIONS.find(s=>s.key===key);
  if (section && section.adminOnly && !(user && user.role === 'admin')) {
    if (!isFallback) toast('⛔ Hanya Admin yang bisa mengakses halaman ini');
    if (key !== 'dashboard') return goSection('dashboard', {isFallback:true});
    return;
  }
  if (section && !isMenuAktif(key)) {
    if (!isFallback) toast('⛔ Fitur ini tidak diaktifkan untuk event ini');
    if (key !== 'dashboard') return goSection('dashboard', {isFallback:true});
    return;
  }
  if (section && !user && !isGuestVisible(key)) {
    if (!isFallback) toast('⛔ Halaman ini tidak tersedia untuk Guest. Silakan login.');
    if (key !== 'dashboard') return goSection('dashboard', {isFallback:true});
    return;
  }
  if (section && user && user.role === 'petugas' && key !== 'dashboard' && !userSections().includes(key)) {
    if (!isFallback) toast('⛔ Anda tidak memiliki akses ke halaman ini');
    if (key !== 'dashboard') return goSection('dashboard', {isFallback:true});
    return;
  }
  const prevSection = currentSection;
  currentSection = key;
  // Kalau admin sempat pilih logo baru di panel Profil Organisasi tapi TIDAK
  // klik "Simpan" (mis. keburu pindah menu lain), buang draft logo itu begitu
  // admin masuk LAGI ke halaman Pengaturan dari menu lain — supaya pilihan
  // logo lama yang sudah dilupakan tidak diam-diam ikut tersimpan saat admin
  // berikutnya cuma niat ganti Nama Organisasi/Nama Kas saja. Dicek lewat
  // prevSection (bukan cuma "key==='pengaturan'") supaya draft yang MASIH
  // sedang diisi tetap aman dari re-render auto-refresh (yang tidak lewat
  // goSection, jadi tidak kena reset ini).
  if(key === 'pengaturan' && prevSection !== 'pengaturan' && typeof _pendingOrgLogo !== 'undefined'){
    _pendingOrgLogo = undefined;
  }
  // Simpan halaman terakhir supaya bertahan walau halaman di-refresh.
  try { localStorage.setItem(LAST_SECTION_KEY, key); } catch(e){}
  const meta = SECTIONS.find(s=>s.key===key);
  document.getElementById('page-title').textContent = meta ? meta.label : 'Dashboard';
  document.getElementById('page-sub').textContent = meta ? (meta.desc || meta.sub) : '';
  renderSidebar();
  renderTopbarSaldo();
  renderContent();
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('show');
  window.scrollTo({top:0, behavior:'instant'});
}

// Menu yang tidak terikat event (bisa diakses walau belum ada event 17-an
// yang dibuat/dipilih). Dipakai di renderContent (supaya halaman tidak
// nampilin "Belum ada event aktif") dan di renderTopbarSaldo (supaya chip
// saldo proyeksi kegiatan/event tidak ikut nongol di menu yang memang tidak
// terikat event tersebut — chip itu punya arti khusus untuk event aktif,
// jadi kalau ditampilkan di menu eventless malah bikin salah paham).
const EVENTLESS_SECTIONS = ['gudang', 'dokumen', 'agenda', 'kas', 'dana-sosial', 'bookmark', 'dashboard', 'pengaturan', 'users', 'panduan', 'jadwal-sinoman'];

function renderTopbarSaldo(){
  const chip = document.getElementById('saldo-chip');
  // Chip ini menampilkan proyeksi anggaran EVENT/kegiatan khusus yang aktif
  // (dari hitungBukuUtama). Di menu yang tidak terikat event (lihat
  // EVENTLESS_SECTIONS) angka ini tidak relevan dan gampang disalahpahami
  // sebagai saldo milik menu tersebut, jadi disembunyikan di menu-menu itu.
  if(!activeEvent() || EVENTLESS_SECTIONS.includes(currentSection)){ chip.style.visibility='hidden'; return; }
  chip.style.visibility='visible';
  const {saldo} = hitungBukuUtama();
  chip.classList.toggle('negatif', saldo < 0);
  document.getElementById('saldo-val').textContent = fmtRp(saldo);
}

function renderContent(){
  const el = document.getElementById('content');
  const isLoggedIn = !!getCurrentUser();
  const isAdminUser = getCurrentUser()?.role === 'admin';

  // Simpan fokus & posisi kursor input aktif (mis. kolom pencarian) agar tidak hilang saat re-render
  const activeEl = document.activeElement;
  let focusInfo = null;
  if (activeEl && el.contains(activeEl) && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.id) {
    focusInfo = { id: activeEl.id, selStart: activeEl.selectionStart, selEnd: activeEl.selectionEnd };
  }
  
  // Menu yang tidak terikat event tetap bisa diakses walau belum ada
  // event 17-an yang dibuat/dipilih (lihat EVENTLESS_SECTIONS di atas).
  if(!activeEvent() && !EVENTLESS_SECTIONS.includes(currentSection)){
    el.innerHTML = `<div class="empty-state"><h3>Belum ada event aktif</h3><p>${isLoggedIn ? 'Buat event tahunan dulu.' : 'Login untuk membuat atau mengelola event.'}</p>
      ${isLoggedIn ? `<button class="btn" onclick="openEventModal()">+ Buat Event Pertama</button>` : `<button class="btn" onclick="openLoginModal()">🔑 Login untuk Mengelola</button>`}
    </div>`;
    return;
  }
  
  // Check if current section is admin-only
  const section = SECTIONS.find(s=>s.key===currentSection);
  if (section && section.adminOnly && !isAdminUser) {
    el.innerHTML = `<div class="empty-state"><h3>⛔ Akses Ditolak</h3><p>Halaman ini hanya untuk Admin.</p><button class="btn" onclick="goSection('dashboard')">Kembali ke Dashboard</button></div>`;
    return;
  }

  // Check if current section's feature is turned off for this event
  if (section && !isMenuAktif(currentSection)) {
    el.innerHTML = `<div class="empty-state"><h3>Fitur tidak aktif</h3><p>Fitur ini dimatikan untuk event "${esc(activeEvent().nama)}". Aktifkan lagi lewat tombol ✎ di daftar event pada halaman Pengaturan kalau dibutuhkan.</p><button class="btn" onclick="goSection('dashboard')">Kembali ke Dashboard</button></div>`;
    return;
  }

  // Check if current section is hidden for guest
  if (section && !isLoggedIn && !isGuestVisible(currentSection)) {
    el.innerHTML = `<div class="empty-state"><h3>⛔ Akses Ditolak</h3><p>Halaman ini tidak tersedia untuk Guest.</p><button class="btn" onclick="openLoginModal()">🔑 Login untuk Mengakses</button></div>`;
    return;
  }

  // Check if current section is outside Petugas' assigned bidang
  if (section && isPetugas() && currentSection !== 'dashboard' && !userSections().includes(currentSection)) {
    el.innerHTML = `<div class="empty-state"><h3>⛔ Akses Ditolak</h3><p>Anda tidak memiliki akses ke halaman ini.</p><button class="btn" onclick="goSection('dashboard')">Kembali ke Dashboard</button></div>`;
    return;
  }
  
  switch(currentSection){
    case 'panduan': el.innerHTML = renderPanduan(); break;
    case 'dashboard': el.innerHTML = renderDashboard(); break;
    case 'anggota': el.innerHTML = renderAnggota(); break;
    case 'database-anggota': el.innerHTML = renderDatabaseAnggota(); break;
    case 'donatur': el.innerHTML = renderDonatur(); break;
    case 'transaksi': el.innerHTML = renderTransaksi(); break;
    case 'operasional': el.innerHTML = renderOperasional(); break;
    case 'lomba': el.innerHTML = renderLomba(); break;
    case 'hadiah': el.innerHTML = renderHadiah(); break;
    case 'belanja-hadiah': el.innerHTML = renderBelanjaHadiah(); break;
    case 'belanja-perlengkapan': el.innerHTML = renderBelanjaPerlengkapan(); break;
    case 'hadiah-jalan': el.innerHTML = renderHadiahJalanSantai(); break;
    case 'belanja-jalan': el.innerHTML = renderBelanjaJalanSantai(); break;
    case 'jadwal': el.innerHTML = renderJadwal(); break;
    case 'agenda': el.innerHTML = renderAgenda(); break;
    case 'gudang': el.innerHTML = renderGudang(); break;
    case 'dokumen': el.innerHTML = renderDokumen(); break;
    case 'jadwal-sinoman': el.innerHTML = renderJadwalSinoman(activeEvent()); break;
    case 'kas': el.innerHTML = renderKas(); break;
    case 'dana-sosial': el.innerHTML = renderDanaSosial(); break;
    case 'bookmark': el.innerHTML = renderBookmark(); break;
    case 'lpj': el.innerHTML = renderLPJ(); break;
    case 'daftar-anggota': el.innerHTML = renderDaftarAnggota(); break;
    case 'pengaturan': el.innerHTML = renderPengaturan(); break;
    case 'users': el.innerHTML = renderUsers(); break;
    default: el.innerHTML = renderDashboard();
  }
  
  // Setup currency inputs after content rendered
  setTimeout(setupAllCurrencyInputs, 50);
  setTimeout(setupAutoResizeTextareas, 50);

  if (currentSection === 'lpj' || currentSection === 'dokumen' || currentSection === 'daftar-anggota' || currentSection === 'jadwal-sinoman') {
    requestAnimationFrame(applyLpjMobileScale);
  }

  // Kembalikan fokus & posisi kursor ke input yang sama (jika masih ada di DOM baru)
  if (focusInfo) {
    const newEl = document.getElementById(focusInfo.id);
    if (newEl) {
      newEl.focus();
      if (typeof newEl.setSelectionRange === 'function' && focusInfo.selStart != null) {
        try { newEl.setSelectionRange(focusInfo.selStart, focusInfo.selEnd); } catch(e){}
      }
    }
  }
}

