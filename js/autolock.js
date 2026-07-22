// ==================== AUTO-LOCK ====================
// Mengunci aplikasi otomatis setelah tidak ada aktivitas selama LOCK_TIMEOUT ms.
// Cara kerja:
//   - Dengarkan event aktivitas user (mouse, keyboard, touch, scroll)
//   - Reset timer setiap ada aktivitas
//   - Jika timer habis dan sesi terbuka → panggil logoutToLockScreen()
//   - Tampilkan countdown kecil di UI (opsional, bisa dimatikan)

(function () {
    'use strict';

    const LOCK_TIMEOUT = 60 * 1000; // 1 menit (ms)
    const WARN_BEFORE  = 15 * 1000; // munculkan peringatan 15 detik sebelum kunci

    let _lockTimer   = null;
    let _warnTimer   = null;
    let _warnEl      = null;  // elemen toast peringatan
    let _countdownId = null;  // interval countdown di toast
    let _started     = false;

    // ── Buat elemen toast peringatan ─────────────────────────────────────────
    function _createWarnEl() {
        if (_warnEl) return;
        _warnEl = document.createElement('div');
        _warnEl.id = 'autoLockWarnToast';
        _warnEl.style.cssText = [
            'position:fixed',
            'bottom:72px',
            'left:50%',
            'transform:translateX(-50%) translateY(20px)',
            'background:#1a1a1a',
            'color:#fff',
            'padding:10px 18px',
            'border-radius: var(--radius-sm)',
            'font-size:.78rem',
            'font-weight:600',
            'z-index:9999',
            'opacity:0',
            'transition:opacity .3s, transform .3s',
            'pointer-events:auto',
            'cursor:pointer',
            'white-space:nowrap',
            'box-shadow:0 4px 16px rgba(0,0,0,.35)',
        ].join(';');
        _warnEl.title = 'Klik untuk tetap aktif';
        _warnEl.addEventListener('click', _resetTimer);
        document.body.appendChild(_warnEl);
    }

    function _showWarn(secsLeft) {
        if (!_warnEl) _createWarnEl();
        _warnEl.innerHTML = `Mengunci dalam <b>${secsLeft}</b> detik — <u>klik untuk tetap aktif</u>`;
        _warnEl.style.opacity  = '1';
        _warnEl.style.transform = 'translateX(-50%) translateY(0)';
    }

    function _hideWarn() {
        if (!_warnEl) return;
        _warnEl.style.opacity   = '0';
        _warnEl.style.transform = 'translateX(-50%) translateY(20px)';
        if (_countdownId) { clearInterval(_countdownId); _countdownId = null; }
    }

    // ── Kunci aplikasi ───────────────────────────────────────────────────────
    function _lock() {
        _hideWarn();
        // Pastikan sesi memang sedang terbuka sebelum mengunci
        const unlocked = sessionStorage.getItem('sk_session_unlocked');
        if (!unlocked) return; // sudah di layar kunci, tidak perlu apa-apa
        console.log('[AutoLock] Sesi dikunci karena tidak aktif.');
        if (typeof window.logoutToLockScreen === 'function') {
            window.logoutToLockScreen();
        }
    }

    // ── Reset timer setiap ada aktivitas ────────────────────────────────────
    window._autoLockReset = function _resetTimer() {
        if (!_started) return;
        _hideWarn();

        if (_lockTimer)  clearTimeout(_lockTimer);
        if (_warnTimer)  clearTimeout(_warnTimer);

        // Peringatan muncul (LOCK_TIMEOUT - WARN_BEFORE) ms setelah aktivitas terakhir
        _warnTimer = setTimeout(() => {
            let secsLeft = Math.round(WARN_BEFORE / 1000);
            _showWarn(secsLeft);
            _countdownId = setInterval(() => {
                secsLeft--;
                if (secsLeft <= 0) {
                    clearInterval(_countdownId);
                    _countdownId = null;
                } else {
                    _showWarn(secsLeft);
                }
            }, 1000);
        }, LOCK_TIMEOUT - WARN_BEFORE);

        _lockTimer = setTimeout(_lock, LOCK_TIMEOUT);
    };

    var _resetTimer = window._autoLockReset;

    // ── Daftar event yang dianggap "aktivitas" ────────────────────────────────
    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'click'];

    function _attachListeners() {
        ACTIVITY_EVENTS.forEach(ev => {
            document.addEventListener(ev, _resetTimer, { passive: true });
        });
    }

    function _detachListeners() {
        ACTIVITY_EVENTS.forEach(ev => {
            document.removeEventListener(ev, _resetTimer);
        });
    }

    // ── API publik ────────────────────────────────────────────────────────────
    window.autoLock = {
        start() {
            if (_started) return;
            _started = true;
            _attachListeners();
            _resetTimer(); // mulai hitung mundur dari sekarang
            console.log(`[AutoLock] Aktif — kunci otomatis setelah ${LOCK_TIMEOUT / 1000} detik tidak aktif.`);
        },
        stop() {
            _started = false;
            _detachListeners();
            _hideWarn();
            if (_lockTimer)  clearTimeout(_lockTimer);
            if (_warnTimer)  clearTimeout(_warnTimer);
            _lockTimer = null;
            _warnTimer = null;
            console.log('[AutoLock] Dinonaktifkan.');
        },
        reset: _resetTimer,
    };
})();
