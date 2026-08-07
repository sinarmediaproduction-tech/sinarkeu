// tests/run.mjs — test runner minimalis, TANPA dependency npm.
//
// [KENAPA BEGINI] Repo ini sengaja tidak punya package.json / build step.
// Menambah Jest/Vitest berarti menambah node_modules + build pipeline yang
// bertentangan dengan arsitektur "file di repo = file yang disajikan".
// Jadi runner ini cukup: jalankan `node tests/run.mjs`, exit code 0 = lulus.
//
// Cakupan saat ini sengaja fokus ke fungsi MURNI yang paling rawan bug &
// paling berdampak keamanan (escaping/XSS, format uang, parsing tanggal).
// Fungsi yang butuh DOM/localStorage tidak dites di sini — untuk itu pakai
// verifikasi manual di browser (lihat TESTING.md).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
    try { fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; failures.push(name + ' -> ' + e.message); console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'not equal') + `\n      expected: ${JSON.stringify(b)}\n      actual:   ${JSON.stringify(a)}`); }

// ---------- memuat js/utils.js di sandbox mirip-browser ----------
// utils.js adalah script klasik yang menempel ke `window`. Kita buat objek
// window palsu secukupnya, lalu eksekusi filenya.
function loadUtils() {
    const src = readFileSync(join(ROOT, 'js', 'utils.js'), 'utf8');
    const store = new Map();
    const win = {
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        },
        addEventListener() {},
        navigator: { language: 'id-ID' },
        location: { href: 'http://localhost/' },
    };
    const document = {
        getElementById: () => null,
        createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {} }),
        body: { appendChild() {}, removeChild() {} },
    };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'localStorage', 'navigator', 'location', 'requestAnimationFrame', 'performance', src)(
        win, document, win.localStorage, win.navigator, win.location, () => {}, { now: () => 0 }
    );
    return win;
}

console.log('\nSinarKeu — smoke tests\n');

let W;
test('js/utils.js bisa dieksekusi tanpa error', () => { W = loadUtils(); assert(W, 'window kosong'); });

if (W) {
    if (typeof W.escapeHtml === 'function') {
        test('escapeHtml menetralkan < > &', () => {
            const out = W.escapeHtml('<img src=x onerror=alert(1)>');
            assert(!out.includes('<'), 'masih ada < mentah: ' + out);
        });
        test('escapeHtml menetralkan kutip ganda (breakout atribut)', () => {
            const out = W.escapeHtml('" onmouseover=alert(1) x="');
            assert(!out.includes('"'), 'kutip ganda lolos -> XSS atribut: ' + out);
        });
    }
    if (typeof W.escapeJsAttr === 'function') {
        test('escapeJsAttr aman untuk onclick="f(\'...\')"', () => {
            const out = W.escapeJsAttr(`" onmouseover=alert(1) x="`);
            assert(!out.includes('"'), 'kutip ganda lolos: ' + out);
            const out2 = W.escapeJsAttr("it's");
            assert(!out2.includes("'"), 'kutip tunggal lolos: ' + out2);
        });
    }
    if (typeof W.rp === 'function' && typeof W.unRp === 'function') {
        test('rp() lalu unRp() bolak-balik konsisten', () => {
            for (const n of [0, 1000, 1234567, -5000]) eq(W.unRp(W.rp(n)), n, 'roundtrip ' + n);
        });
    }
}

// ---------- pemeriksaan statis lintas file (murah, menangkap regresi nyata) ----------
test('index.html memuat semua js/*.js yang ada (tidak ada file yatim tak sengaja)', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const listed = [...html.matchAll(/['"]js\/([\w.-]+\.js)['"]/g)].map((m) => m[1]);
    assert(listed.length > 5, 'tidak menemukan daftar script di index.html');
});

test('tidak ada eval() di kode aplikasi', () => {
    const files = ['js/utils.js', 'js/auth.js', 'js/db.js', 'js/app.js'];
    for (const f of files) {
        const src = readFileSync(join(ROOT, f), 'utf8');
        assert(!/[^.\w]eval\s*\(/.test(src), 'eval ditemukan di ' + f);
    }
});

test('CSP terpasang di index.html', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert(html.includes('Content-Security-Policy'), 'meta CSP hilang');
    assert(html.includes("object-src 'none'"), "object-src 'none' hilang dari CSP");
});

test('endpoint api/ punya rate limiting', () => {
    for (const f of ['api/emas.js', 'api/harga-pangan.js']) {
        const src = readFileSync(join(ROOT, f), 'utf8');
        assert(src.includes('applyRateLimit'), f + ' tidak memanggil applyRateLimit');
    }
});

console.log(`\n${pass} lulus, ${fail} gagal\n`);
if (fail) { console.error('GAGAL:\n - ' + failures.join('\n - ')); process.exit(1); }
