// tests/check-sw-version.mjs
//
// Gate CI untuk pitfall #1 project ini: mengubah file yang di-cache service
// worker TANPA menaikkan CACHE_VERSION => user (terutama yang sudah install
// PWA) tetap menjalankan kode LAMA berhari-hari, sehingga bug yang sudah
// diperbaiki tampak masih ada dan sangat membingungkan untuk didiagnosis.
//
// Yang diperiksa:
//   1. sw.js punya CACHE_VERSION.
//   2. APP_JS_VERSION di index.html SAMA dengan CACHE_VERSION di sw.js.
//   3. Setiap js/*.js yang ada benar-benar terdaftar di APP_SHELL sw.js
//      (kalau tidak, file itu tidak pernah di-precache).
//   4. (CI push/PR) kalau ada file ter-cache yang berubah dibanding commit
//      sebelumnya, CACHE_VERSION harus ikut berubah.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

let fail = 0;
const bad = (m) => { console.error('✗ ' + m); fail = 1; };
const ok = (m) => console.log('✓ ' + m);

const mSw = sw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!mSw) bad('CACHE_VERSION tidak ditemukan di sw.js');
else ok('CACHE_VERSION = ' + mSw[1]);

const mHtml = html.match(/APP_JS_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!mHtml) bad('APP_JS_VERSION tidak ditemukan di index.html');
else if (mSw && mHtml[1] !== mSw[1]) {
    bad(`APP_JS_VERSION (${mHtml[1]}) != CACHE_VERSION (${mSw[1]}). Keduanya WAJIB sama.`);
} else if (mSw) ok('APP_JS_VERSION sinkron dengan CACHE_VERSION');

// 3. semua js/*.js terdaftar di APP_SHELL
const jsFiles = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
const missing = jsFiles.filter((f) => !sw.includes('js/' + f));
if (missing.length) bad('Tidak terdaftar di APP_SHELL sw.js: ' + missing.join(', '));
else ok(`${jsFiles.length} file js/ semuanya terdaftar di APP_SHELL`);

// 4. cek diff (hanya jika ada git history yang relevan)
try {
    const base = process.env.GITHUB_BASE_REF
        ? execSync(`git merge-base HEAD origin/${process.env.GITHUB_BASE_REF}`).toString().trim()
        : 'HEAD~1';
    const changed = execSync(`git diff --name-only ${base} HEAD`).toString().split('\n').filter(Boolean);
    const cacheable = changed.filter((f) => /^(js\/.*\.js|css\/.*\.css|index\.html|manifest\.json)$/.test(f));
    if (cacheable.length) {
        const swChanged = changed.includes('sw.js');
        const versionBumped = swChanged && execSync(`git diff ${base} HEAD -- sw.js`).toString().includes('CACHE_VERSION');
        if (!versionBumped) {
            bad('File ter-cache berubah (' + cacheable.join(', ') + ') tapi CACHE_VERSION di sw.js TIDAK dinaikkan.');
        } else ok('CACHE_VERSION ikut dinaikkan bersama perubahan aset');
    } else ok('Tidak ada perubahan file ter-cache pada commit ini');
} catch {
    console.log('· Lewati pemeriksaan diff git (history tidak tersedia)');
}

process.exit(fail);
