'use strict';
/**
 * test-twin-fonts.js - Twin Dial's fonts, atlases and pictograms (package A1, round 2, 2026-11-17; docs/twin-dial/R2-A1-REPORT.md).
 *
 *   node bench/test-twin-fonts.js
 *
 * Reads the committed files; the python checks of the bake itself (tools/twin-dial/a1/test_bake.py) run through `uv`
 * when it is on the PATH (set TWIN_NO_PY=1 to skip, it says so). Checks
 *   1. fonts: every slot of design/twin-dial/font_slots.json has its atlas, consistent header, one cell high, tabular
 *      digits, and the budget (a full-text Noto atlas <= 0.8 MiB);
 *   2. Saira carries no Cyrillic and nothing the car sends: no atlas glyph beyond Latin, digits and "-"; and a layout
 *      check (run on apps/twin_dial/hud/layouts/twin.json once package C's file exists) that no text widget in a Saira font
 *      can reach a Cyrillic string - proved to fail on a layout that does it;
 *   3. Noto: the whole car character set, U+02BC with its own glyph, the thin space, Latin accents, and a Greek letter is
 *      still missing (so an element falls back, never draws a hole);
 *   4. pictograms: the 25 of SPEC 10, shared/twin_icons.js is exactly what the generator writes, registers in icons.js,
 *      paints what design/twin-dial/vt/pictograms.js paints, nothing outside its box, the slot table's hashes hold, and
 *      stepDist has one home;
 *   5. nothing of a maker in the shipped files.
 * Node 8 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'twin_dial');
const FONTS = path.join(APP, 'hud', 'fonts');
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const font = (n) => JSON.parse(fs.readFileSync(path.join(FONTS, n + '.json'), 'utf8'));
const slots = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'font_slots.json'), 'utf8')).slots;
const atlases = [...new Set(Object.values(slots).map((s) => s.atlas))];
const saira = atlases.filter((n) => slots[Object.keys(slots).find((k) => slots[k].atlas === n)].face === 'Saira');
const noto = atlases.filter((n) => !saira.includes(n));

// ---- the layout check, a function so it can be shown to fail ----
const CYR = /[Ͱ-ԯ]/;
// tokens whose value is Latin or digits only (our own labels, numbers): the only ones a Saira widget may carry
const SAIRA_TOKEN = /^(speed|spd|rpm|gear|gearNum|mode|program|prog|drive|ready|clock|time|hhmm|hour|minute|digits?|v|value)\b/i;
function sairaViolations(layout, sairaNames, glyphsOf) {
    const bad = [];
    (layout.widgets || []).forEach((w) => {
        if ((w.type !== 'text' && w.type !== 'atext') || !sairaNames.includes(w.font)) return;
        const t = String(w.text === undefined ? '' : w.text);
        const lit = t.replace(/\{\{([^}]*)\}\}/g, '');
        if (CYR.test(lit)) bad.push(w.id + ': Cyrillic in the text');
        (t.match(/\{\{([^}]*)\}\}/g) || []).forEach((tok) => {
            const name = tok.slice(2, -2).split(':')[0].replace(/^[a-z]+\./, '');
            if (!SAIRA_TOKEN.test(name)) bad.push(w.id + ': token ' + tok + ' is not known to be Latin/digits only');
        });
        const g = glyphsOf(w.font);
        lit.split('').filter((c) => !g[c]).forEach((c) => bad.push(w.id + ': ' + JSON.stringify(c) + ' is not in ' + w.font));
    });
    return bad;
}

console.log('every slot of SPEC 9 has its atlas');
ok(Object.keys(slots).length === 17 && atlases.length === 16, '17 slots, 16 atlases (td_big serves the speed and the clock)');
atlases.forEach((n) => {
    const exists = fs.existsSync(path.join(FONTS, n + '.json'));
    ok(exists, n + '.json exists');
    if (!exists) return;
    const f = font(n), g = f.glyphs, alpha = Buffer.from(f.alpha, 'base64');
    ok(alpha.length === f.width * f.height && f.width === 1024, n + ': atlas ' + f.width + 'x' + f.height + ' as its header says');
    const slot = Object.values(slots).find((s) => s.atlas === n);
    ok(f.size === slot.px, n + ': baked at ' + slot.px + ' px');
    const off = Object.keys(g).filter((c) => g[c].w && g[c].h !== f.cellHeight);
    ok(!off.length, n + ': every glyph is one cell (' + f.cellHeight + ' px) high');
    ok(f.baseline > 0 && f.baseline < f.cellHeight, n + ': baseline ' + f.baseline + ' inside the cell');
    const dig = '0123456789'.split('').filter((c) => g[c]);
    ok(dig.length === 10 && dig.every((c) => g[c].advance === g['0'].advance), n + ': ten digits, one tabular advance (' + g['0'].advance + ')');
    const outside = Object.keys(g).filter((c) => g[c].w && (g[c].x < 0 || g[c].x + g[c].w > f.width || g[c].y < 0 || g[c].y + g[c].h > f.height));
    ok(!outside.length, n + ': every glyph lies inside the atlas');
    const mib = f.width * f.height / 1048576;
    if (noto.includes(n) && n !== 'td_cnt') ok(mib <= 0.8, n + ': full-text atlas ' + mib.toFixed(2) + ' MiB <= 0.8');
});
ok(font('td_big').stretch === 1.06 && saira.every((n) => font(n).stretch === 1.06) && noto.every((n) => font(n).stretch === undefined), 'the six Saira atlases were baked at stretch 1.06, no Noto one');

console.log('Saira carries no Cyrillic and nothing the car sends');
saira.forEach((n) => {
    const keys = Object.keys(font(n).glyphs);
    ok(!keys.some((c) => CYR.test(c)) && keys.every((c) => c.charCodeAt(0) < 0x250 || c === '–'), n + ': ' + keys.length + ' glyphs, all Latin, digits, space and the dashes');
    ok(font(n).source === 'Saira[wdth,wght].ttf', n + ': drawn from the Saira file');
});
const gl = (n) => font(n).glyphs;
const LAY = path.join(APP, 'hud', 'layouts', 'twin.json');
const bad1 = sairaViolations({ widgets: [{ id: 'a', type: 'text', font: 'td_big', text: '{{speed}}' }, { id: 'b', type: 'atext', font: 'td_big', text: '{{speed}}' }] }, saira, gl);
ok(!bad1.length, 'a Saira widget with {{speed}} is fine');
ok(sairaViolations({ widgets: [{ id: 'x', type: 'text', font: 'td_label', text: 'Комфорт' }] }, saira, gl).some((v) => /Cyrillic/.test(v)), 'the check fails on a Cyrillic literal in a Saira widget');
ok(sairaViolations({ widgets: [{ id: 'x', type: 'text', font: 'td_big', text: '{{ccHead}}' }] }, saira, gl).length === 1, 'the check fails on the car\'s message text in a Saira widget');
ok(sairaViolations({ widgets: [{ id: 'x', type: 'text', font: 'td_label', text: 'READY {{road}}' }] }, saira, gl).length === 1, 'the check fails on the car\'s road label in a Saira widget');
ok(sairaViolations({ widgets: [{ id: 'x', type: 'text', font: 'td_tach', text: 'A' }] }, saira, gl).length === 1, 'the check fails on a letter an atlas does not have');
if (fs.existsSync(LAY)) {
    const lay = JSON.parse(fs.readFileSync(LAY, 'utf8'));
    const used = (lay.widgets || []).filter((w) => saira.includes(w.font)).length;
    const v = sairaViolations(lay, saira, gl);
    ok(!v.length, 'twin.json: ' + used + ' Saira widgets, none can reach Cyrillic' + (v.length ? ' (' + v.join('; ') + ')' : ''));
} else console.log('  --   apps/twin_dial/hud/layouts/twin.json does not exist yet (package C): the layout check runs once it does');

console.log('Noto carries the whole car character set');
const UA = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя';
const PUNCT = '\'’ʼ«»–—№…„“”,.:;!?()"%/-&#*=_+‘';
const WIDE = 'ЁЪЫЭЎёъыэў' + 'ÄÖÜßäöüÀÂÇÉÈÊËÎÏÔÙÛàâçéèêëîïôùûÁÍÓÚÑáíóúñĄĆĘŁŃŚŹŻąćęłńśźżČĎĚŇŘŠŤŮŽčďěňřšťůž';
const OURS = '°×ø·±− №ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
noto.filter((n) => n !== 'td_cnt').forEach((n) => {
    const g = gl(n);
    const lack = (UA + PUNCT + WIDE + OURS).split('').filter((c) => !g[c]);
    ok(!lack.length, n + ': Ukrainian, Russian, Belarusian, accents, punctuation, our symbols (' + (UA + PUNCT + WIDE + OURS).length + ' characters)' + (lack.length ? ' missing ' + lack.join('') : ''));
    ok(g['ʼ'].w > 0 && g['ʼ'].h === font(n).cellHeight, n + ': U+02BC has a glyph of its own');
    ok(g[' '].w === 0 && g[' '].advance > 0 && g[' '].advance < g[' '].advance, n + ': the thin space has an advance (' + g[' '].advance + ') and no ink');
    ok(!g['Ω'] && !g['λ'], n + ': a Greek letter is still missing, so an element falls back to BMW\'s (never a hole)'.replace('BMW\'s', 'the car\'s own'));
    ok(font(n).source === 'NotoSans-wght.subset.ttf', n + ': drawn from the Noto Sans file');
});
{
    const g = gl('td_cnt');
    ok('0123456789/ '.split('').every((c) => g[c]) && Object.keys(g).length === 12, 'td_cnt: digits, slash, space only');
}
// a zero-ink glyph does not stretch a cell: the cell is the same as without the thin space (checked on the biggest)
{
    const f = font('td_msg');
    ok(f.cellHeight === 57, 'td_msg: cell 57 px (the thin space and the dashes did not enlarge it)');
}

console.log('pictograms');
const icons = require(path.join(ROOT, 'shared', 'icons.js'));
const before = Object.keys(icons.ICONS).length;
const T = require(path.join(ROOT, 'shared', 'twin_icons.js'));
ok(Object.keys(icons.ICONS).length > before, 'requiring shared/twin_icons.js registers its icons in icons.js (' + before + ' -> ' + Object.keys(icons.ICONS).length + ')');
const SPEC10 = ['td_fuel', 'cc_warn', 'td_radio', 'td_media', 'td_phone', 'td_nav', 'td_fuel_side', 'cc_coolant', 'cc_door', 'cc_belt', 'cc_brake', 'cc_tyre', 'cc_engine', 'cc_washer', 'cc_bonnet', 'cc_boot', 'cc_oil', 'cc_pedal', 'cc_service', 'cc_battery', 'cc_info', 'td_avg', 'td_settings', 'cc_warn_solid', 'cc_dot'];
ok(SPEC10.length === 25 && SPEC10.every((n) => typeof T.ICONS[n] === 'function' && icons.ICONS[n] === T.ICONS[n]) && Object.keys(T.ICONS).length === 25, 'the 25 icons of SPEC 10, no more');
const gen = require(path.join(ROOT, 'tools', 'twin-dial', 'a1', 'build_twin_icons.js'));
ok(fs.readFileSync(path.join(ROOT, 'shared', 'twin_icons.js'), 'utf8') === gen.moduleText(), 'shared/twin_icons.js is exactly what tools/twin-dial/a1/build_twin_icons.js writes');
ok(fs.readFileSync(path.join(APP, 'hud', 'icons', 'icons.json'), 'utf8') === gen.manifestText(), 'hud/icons/icons.json (slot table, ink boxes, alpha hashes) is exactly what it writes');
const D = require(path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms.js'));
let diff = 0, worst = '';
SPEC10.forEach((n) => { for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const a = T.ICONS[n]((x + 0.5) / 48, (y + 0.5) / 48), b = D.ICONS[n]((x + 0.5) / 48, (y + 0.5) / 48); if (a !== b) { diff++; worst = n; } } });
ok(diff === 0, 'the engine\'s distance functions equal the design drawings on a 48x48 grid' + (diff ? ' (differ: ' + worst + ')' : ''));
const outside = [];
SPEC10.forEach((n) => { for (let i = 0; i < 400; i++) { const t = i / 400; [[-0.002, t], [1.002, t], [t, -0.002], [t, 1.002]].forEach(([x, y]) => { if (T.ICONS[n](x, y) < -1e-9) outside.push(n); }); } });
ok(!outside.length, 'no icon has ink outside its box (none is clipped)' + (outside.length ? ': ' + [...new Set(outside)].join(' ') : ''));
const man = JSON.parse(fs.readFileSync(path.join(APP, 'hud', 'icons', 'icons.json'), 'utf8'));
ok(man.items.length === 6 + 2 + 15 + 4 && man.slots.tab.w === 38 && man.slots.gauge.w === 32 && man.slots.symbol.w === 54, 'slot table: tab 38, gauge 32, symbol 54 px; ' + man.items.length + ' entries');
ok(man.items.every((i) => i.ink > 20 && i.box[0] >= 0 && i.box[2] <= i.w && i.box[3] <= i.h), 'every icon has ink and its box lies inside its slot');
const stripSrc = fs.readFileSync(path.join(ROOT, 'design', 'strip', 'pictograms', 'pictograms.js'), 'utf8');
const vtSrc = fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms.js'), 'utf8');
ok(typeof require(path.join(ROOT, 'design', 'strip', 'pictograms', 'pictograms.js')).stepDist === 'function' && !/function stepDist|function dSeg/.test(vtSrc) && /function stepDist/.test(stripSrc), 'stepDist is exported by the strip pictograms and the VT copy is gone');
{ // the paint itself: a known icon at its slot size draws ink in the right place
    const px = icons.paintIcon('td_fuel', 38, 38, [255, 255, 255, 255]);
    let n = 0; for (let i = 3; i < px.length; i += 4) n += px[i] ? 1 : 0;
    ok(n > 250 && n < 700, 'td_fuel at 38 px paints ' + n + ' pixels of ink');
}

console.log('nothing of a maker in the shipped files');
const shipped = [path.join(ROOT, 'shared', 'twin_icons.js'), path.join(APP, 'hud', 'icons', 'icons.json')].concat(atlases.map((n) => path.join(FONTS, n + '.json')));
const names = /bmw|mini cooper|rolls/i;
ok(shipped.every((f) => !names.test(fs.readFileSync(f, 'utf8').replace(/"alpha":"[^"]*"/, ''))), 'no maker\'s name in the atlases\' headers, the icon table or twin_icons.js');
ok(!fs.readdirSync(FONTS).some((f) => !/^td_.*\.json$/.test(f)), 'hud/fonts holds only our atlases');

console.log('the bake itself (python)');
if (process.env.TWIN_NO_PY) console.log('  --   skipped (TWIN_NO_PY)');
else {
    const env = Object.assign({}, process.env, { UV_CACHE_DIR: process.env.UV_CACHE_DIR || path.join(ROOT, 'bake', 'work', '.uvcache') });
    const r = spawnSync('uv', ['run', '-q', '--no-project', '--with', 'numpy', '--with', 'pillow', '--with', 'fonttools', 'python', '-I', path.join(ROOT, 'tools', 'twin-dial', 'a1', 'test_bake.py')], { env, encoding: 'utf8' });
    if (r.error) console.log('  --   uv not found (' + r.error.code + '): python checks NOT run');
    else {
        const lines = String(r.stdout).split('\n').filter((l) => /^  (ok|FAIL)/.test(l));
        lines.forEach((l) => { if (/FAIL/.test(l)) { failed++; console.log(l); } else passed++; });
        ok(r.status === 0, 'tools/twin-dial/a1/test_bake.py: ' + lines.length + ' checks' + (r.status ? ' (exit ' + r.status + ': ' + String(r.stderr).slice(-200) + ')' : ''));
    }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
