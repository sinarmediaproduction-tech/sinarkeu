/* ============================================================
   AUTH SYSTEM
   ============================================================ */
const AUTH_STORAGE_KEY = 'kt_auth_user';

// Fallback LOKAL kalau RPC gagal dihubungi (mis. belum jalankan supabase-rls-setup.sql).
// Tidak ada field password di sini sama sekali — login SELALU diverifikasi di server
// lewat rpc_login, browser tidak pernah menerima/menyimpan hash password.
const DEFAULT_USERS_FALLBACK = [
  { id: 'admin1', name: 'Admin Utama', username: 'admin', role: 'admin' },
  { id: 'user1', name: 'User 1', username: 'user', role: 'user' },
  { id: 'user2', name: 'User 2', username: 'user2', role: 'user' },
];

function getUsers() {
  if (db.users && db.users.length > 0) return db.users;
  return DEFAULT_USERS_FALLBACK;
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

function setCurrentUser(user) {
  if (user) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

// Token sesi dari rpc_login, dikirim ulang di header `x-session-token` tiap
// request (lihat override fetch di 00-config.js) supaya server bisa
// memverifikasi caller benar-benar sudah login sebelum RPC/tabel sensitif
// mengizinkan aksi (lihat supabase-session-auth-migration.sql).
const SESSION_TOKEN_KEY = 'kt_session_token';

function setSessionToken(token) {
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

function isAdmin() {
  const user = getCurrentUser();
  return user && user.role === 'admin';
}

function isUser() {
  const user = getCurrentUser();
  return user && (user.role === 'user' || user.role === 'admin');
}

function isPetugas() {
  const user = getCurrentUser();
  return user && user.role === 'petugas';
}

function userSections() {
  const user = getCurrentUser();
  return (user && user.allowed_sections) || [];
}

// Bisa akses (lihat) section ini? Admin: semua section. User: semua section
// KECUALI yang adminOnly (Pengaturan, Manajemen User). Petugas: cuma
// dashboard + section yang ditugaskan ke dia (juga tidak pernah termasuk
// section adminOnly, karena adminOnly tidak pernah masuk daftar pilihan
// bidang Petugas — lihat openUserModal di 06-login-users.js).
function canAccessSection(key) {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === 'admin') return true;
  const section = typeof SECTIONS !== 'undefined' ? SECTIONS.find(s => s.key === key) : null;
  if (section && section.adminOnly) return false;
  if (user.role === 'user') return true;
  if (user.role === 'petugas') return key === 'dashboard' || userSections().includes(key);
  return false;
}

// Bisa edit data di section ini? Sama aturannya dengan akses,
// karena Petugas yang boleh masuk ke section-nya otomatis boleh kelola penuh di situ.
function canEditSection(key) {
  return canAccessSection(key);
}

function canEdit() {
  return isUser();
}

function canManageSettings() {
  return isAdmin();
}

// Login diverifikasi 100% di server lewat RPC rpc_login. Password mentah dikirim
// lewat HTTPS (sama seperti panggilan Supabase lain), di-hash & dibandingkan di
// Postgres — hash TIDAK PERNAH dikembalikan ke browser, dan kt_users tidak bisa
// dibaca langsung oleh anon key (lihat supabase-rls-setup.sql Bagian 2).
async function login(username, password) {
  const { data, error } = await sb.rpc('rpc_login', { p_username: username, p_password: password });
  if (error) { console.error('Login error:', error); return null; }
  if (!data || data.length === 0) return null;
  const { session_token, ...user } = data[0];
  setSessionToken(session_token || null);
  setCurrentUser(user);
  return user;
}

async function logout() {
  // Matikan sesi di SERVER dulu (bukan cuma hapus token di localStorage) --
  // kalau token ini sempat bocor, logout beneran membuatnya tidak berlaku lagi.
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (token) {
    try{ await sb.rpc('rpc_logout', { p_token: token }); }catch(e){ console.error('Logout RPC error:', e); }
  }
  setSessionToken(null);
  setCurrentUser(null);
  renderSidebar();
  renderTopbarSaldo();
  renderContent();
  toast('Anda telah logout');
}

