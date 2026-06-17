// ==================== CRYPTO ENGINE ====================
window.deriveKey = async function(password, saltBuf) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBuf, iterations: 300000, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

window.encryptStr = async function(cryptoKey, plaintext) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.encode(plaintext));
    const combined = new Uint8Array(iv.byteLength + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.byteLength);
    return btoa(String.fromCharCode(...combined));
};

window.decryptStr = async function(cryptoKey, b64) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = bytes.slice(0, 12);
    const ct = bytes.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
    return new TextDecoder().decode(plain);
};

window.isPasswordConfigured = function() {
    return !!localStorage.getItem('sk_crypto_check');
};

window.saveEncryptedCredentials = async function(cryptoKey, url, apiKey) {
    const encUrl = await window.encryptStr(cryptoKey, url);
    const encAKey = await window.encryptStr(cryptoKey, apiKey);
    const encCheck = await window.encryptStr(cryptoKey, 'sinarkeu_ok');
    localStorage.setItem('sk_enc_supabase_url', encUrl);
    localStorage.setItem('sk_enc_supabase_key', encAKey);
    localStorage.setItem('sk_crypto_check', encCheck);
};

window.unlockWithPassword = async function(password) {
    const saltB64 = localStorage.getItem('sk_crypto_salt');
    if (!saltB64) return false;
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    let key;
    try {
        key = await window.deriveKey(password, salt);
        const plain = await window.decryptStr(key, localStorage.getItem('sk_crypto_check'));
        if (plain !== 'sinarkeu_ok') return false;
    } catch { return false; }
    try {
        window.globalSupabaseUrl = await window.decryptStr(key, localStorage.getItem('sk_enc_supabase_url'));
        window.globalSupabaseKey = await window.decryptStr(key, localStorage.getItem('sk_enc_supabase_key'));
    } catch { return false; }
    window._sessionCryptoKey = key;
    sessionStorage.setItem('sk_session_unlocked', '1');
    sessionStorage.setItem('sk_session_url', window.globalSupabaseUrl);
    sessionStorage.setItem('sk_session_akey', window.globalSupabaseKey);
    sessionStorage.setItem('sk_session_ts', Date.now().toString());
    return true;
};

window.setupNewPassword = async function(password, url, apiKey) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem('sk_crypto_salt', btoa(String.fromCharCode(...salt)));
    const key = await window.deriveKey(password, salt);
    await window.saveEncryptedCredentials(key, url, apiKey);
    window._sessionCryptoKey = key;
    sessionStorage.setItem('sk_session_unlocked', '1');
    sessionStorage.setItem('sk_session_url', url);
    sessionStorage.setItem('sk_session_akey', apiKey);
    sessionStorage.setItem('sk_session_ts', Date.now().toString());
};

window.reEncryptCredentials = async function(url, apiKey) {
    if (!window._sessionCryptoKey) return;
    await window.saveEncryptedCredentials(window._sessionCryptoKey, url, apiKey);
};

// Lock screen helpers
window.clearLockError = function() {
    document.getElementById('lockStatus').innerText = '';
    document.getElementById('lockPasswordInput').classList.remove('error-shake');
};
window.toggleLockEye = function() {
    const inp = document.getElementById('lockPasswordInput');
    const btn = document.getElementById('lockEyeBtn');
    if (inp.type === 'password') { inp.type = 'text'; btn.innerText = '🙈'; }
    else { inp.type = 'password'; btn.innerText = '👁'; }
};
window.evalSetupPwdStrength = function() {
    const pwd = document.getElementById('setupPwdInput') ? document.getElementById('setupPwdInput').value : '';
    const fill = document.getElementById('setupPwdStrengthFill');
    const lbl = document.getElementById('setupPwdStrengthLabel');
    if (!fill || !lbl) return;
    let score = 0;
    if (pwd.length >= 6) score++;
    if (pwd.length >= 10) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    const levels = [{ w: '0%', bg: '#eee', t: '' }, { w: '25%', bg: '#de350b', t: 'Sangat lemah' }, { w: '50%', bg: '#ff8b00', t: 'Lemah' }, { w: '70%', bg: '#ffab00', t: 'Cukup' }, { w: '88%', bg: '#00875a', t: 'Kuat' }, { w: '100%', bg: '#006644', t: 'Sangat kuat' }];
    const l = levels[score] || levels[0];
    fill.style.width = l.w;
    fill.style.background = l.bg;
    lbl.innerText = l.t;
    lbl.style.color = l.bg;
};