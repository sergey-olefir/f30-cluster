'use strict';
/**
 * test-fonts.js - the 6WB layouts and their fonts hold together (package F, strip, 2026-11-16; docs/strip/F-REPORT.md).
 *
 *   node bench/test-fonts.js
 *
 * No bench needed: it reads files and runs the generator. It checks
 *   1. design/gen_6wb.py reproduces the five committed 6WB layouts byte for byte (the "generator drift": the layouts
 *      had been built on older font cells, so regenerating moved every wb_cap / wb_capb text by 1-2 px);
 *   2. every text of those layouts sits on the baseline recorded in design/strip/F/text-ink.json, so a font re-bake
 *      that changes a cell (as the Cyrillic one did) cannot move ink without this test saying so, and its box is
 *      exactly its font's cell high (a shorter box clips a descender or a breve, a taller one wastes pixel memory);
 *   3. the fonts that draw the car's own words (wb_cap, wb_capb; wb_road, wb_msg) hold the whole Ukrainian alphabet, the apostrophe
 *      forms, the guillemets, the dashes and the number sign, every glyph one cell high, and U+02BC drawn as U+2019.
 * Node 8 or newer, plain fs and child_process. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LAY = path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'layouts');
const FONTS = path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'fonts');
const NAMES = ['wb_comfort', 'wb_dials', 'wb_sport', 'wb_sport_dials', 'wb_eco'];
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const font = (n) => JSON.parse(fs.readFileSync(path.join(FONTS, n + '.json'), 'utf8'));

console.log('the generator reproduces the committed layouts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-6wb-'));
let gen = true;
try { execFileSync('python3', [path.join(ROOT, 'design', 'gen_6wb.py'), tmp], { stdio: 'pipe' }); } catch (e) { gen = false; ok(false, 'gen_6wb.py runs (' + String(e.stderr || e.message).slice(0, 200) + ')'); }
if (gen) NAMES.forEach((n) => {
    const a = fs.readFileSync(path.join(LAY, n + '.json')), b = fs.readFileSync(path.join(tmp, n + '.json'));
    let where = '';
    if (!a.equals(b)) {
        const la = String(a).split('\n'), lb = String(b).split('\n');
        const i = la.findIndex((l, k) => l !== lb[k]);
        where = ': first difference at line ' + (i + 1) + ' (' + JSON.stringify((la[i] || '').trim()) + ' committed, ' + JSON.stringify((lb[i] || '').trim()) + ' generated)';
    }
    ok(a.equals(b), n + '.json is exactly what design/gen_6wb.py writes' + where);
});

console.log('every text stays on its recorded baseline, in a box its font\'s cell high');
const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'strip', 'F', 'text-ink.json'), 'utf8'));
NAMES.forEach((n) => {
    const L = JSON.parse(fs.readFileSync(path.join(LAY, n + '.json'), 'utf8'));
    const bad = [], tall = [], miss = [];
    let k = 0;
    L.widgets.filter((w) => w.type === 'text').forEach((w) => {
        k++;
        const f = font(w.font), r = (rec[n] || {})[w.id];
        if (!r) { miss.push(w.id); return; }
        if (w.y + f.baseline !== r.baseline) bad.push(w.id + ' ' + (w.y + f.baseline) + ' (recorded ' + r.baseline + ')');
        if (w.h !== f.cellHeight) tall.push(w.id + ' ' + w.h + ' (cell ' + f.cellHeight + ')');
    });
    ok(!miss.length, n + ': every one of its ' + k + ' texts is in the record' + (miss.length ? ' (not: ' + miss.join(', ') + ')' : ''));
    ok(!bad.length, n + ': every text\'s baseline is where it was recorded' + (bad.length ? ' (moved: ' + bad.join(', ') + ')' : ''));
    ok(!tall.length, n + ': every text\'s box is its font\'s cell high' + (tall.length ? ' (' + tall.join(', ') + ')' : ''));
});

console.log('the fonts that draw the car\'s own words carry Ukrainian');
const UA = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя';
const PUNCT = '\'’ʼ«»–—№,.:;!?()"%/-';
// wb_road and wb_msg: the road label's and the message's own faces at BMW's sizes (package T), for package X to use
['wb_cap', 'wb_capb', 'wb_road', 'wb_msg'].forEach((n) => {
    const f = font(n), g = f.glyphs;
    const lack = (UA + PUNCT).split('').filter((c) => !g[c]);
    ok(!lack.length, n + ': all 66 Ukrainian letters and the punctuation are baked' + (lack.length ? ' (missing ' + lack.length + ')' : ''));
    const alpha = Buffer.from(f.alpha, 'base64');
    ok(alpha.length === f.width * f.height, n + ': the atlas is ' + f.width + 'x' + f.height + ' as its header says');
    const off = Object.keys(g).filter((c) => c !== ' ' && g[c].w && g[c].h !== f.cellHeight);
    ok(!off.length, n + ': every glyph is one cell (' + f.cellHeight + ' px) high');
    const pix = (c) => { const q = g[c], out = []; for (let y = 0; y < q.h; y++) out.push(alpha.slice((q.y + y) * f.width + q.x, (q.y + y) * f.width + q.x + q.w).toString('hex')); return out.join('|'); };
    ok(g['ʼ'] && g['’'] && pix('ʼ') === pix('’') && g['ʼ'].advance === g['’'].advance, n + ': U+02BC (the Ukrainian apostrophe) is drawn with U+2019\'s glyph');
    ok(!g['Ω'] && !g['ß'], n + ': and a character outside the set is still missing, so the element falls back to BMW\'s (Greek, German sharp s)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
