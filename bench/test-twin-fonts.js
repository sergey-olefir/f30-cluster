'use strict';
/**
 * test-twin-fonts.js - Twin Dial's fonts, atlases and pictograms (package A1, round 2, 2026-11-17; docs/twin-dial/R2-A1-REPORT.md;
 * extended in round 3 by package B6, 2026-11-18: docs/twin-dial/r3b/B6-REPORT.md - the gear letters, the new atlases, the sign's
 * number, the new pictograms and their slot sizes).
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
 *   4. pictograms: the set of SPEC 10 and SPEC-R3 7 (K2's drawings, cruise, the sign's stripes, the guidance set), shared/twin_icons.js is exactly what the generator writes, registers in icons.js,
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
// round 3 (B6): the set speed, the guidance distance, the call timer and the sign's number are digits (and ':' '.' ',' '-' '–')
const SAIRA_TOKEN = /^(speed|cTime|spd|rpm|gear|gearNum|mode|program|prog|drive|ready|clock|time|hhmm|hour|minute|digits?|v|value|cruise|cruiseSpeed|cruSpeed|setSpeed|gDist|guideDist|distNum|callTimer|timer|limNum|signNum|limit)\b/i;
function sairaViolations(layout, sairaNames, glyphsOf) {
    const bad = [];
    (layout.widgets || []).forEach((w) => {
        if ((w.type !== 'text' && w.type !== 'atext') || !sairaNames.includes(w.font)) return;
        const t = String(w.text === undefined ? '' : w.text);
        const lit = t.replace(/\{\{([^}]*)\}\}/g, '');
        if (CYR.test(lit)) bad.push(w.id + ': Cyrillic in the text');
        (t.match(/\{\{([^}]*)\}\}/g) || []).forEach((tok) => {
            const raw = tok.slice(2, -2), name = raw.indexOf('td:') === 0 ? raw.slice(3) : raw.split(':')[0].replace(/^[a-z]+\./, '');       // package C: {{td:speed}} is the name "speed"
            if (!SAIRA_TOKEN.test(name)) bad.push(w.id + ': token ' + tok + ' is not known to be Latin/digits only');
        });
        const g = glyphsOf(w.font);
        lit.split('').filter((c) => !g[c]).forEach((c) => bad.push(w.id + ': ' + JSON.stringify(c) + ' is not in ' + w.font));
    });
    return bad;
}

console.log('every slot of SPEC 9 / SPEC-R3 7 has its atlas');
const EXPECTED = ['td_scale_l', 'td_scale_s', 'td_tach', 'td_big', 'td_clock', 'td_gear', 'td_label', 'td_prog', 'td_cru', 'td_dist', 'td_sign', 'td_sign3',
    'td_title', 'td_val', 'td_body', 'td_row', 'td_tab', 'td_tabs', 'td_sub', 'td_u19', 'td_u20', 'td_u21', 'td_msg', 'td_cnt'];
ok(atlases.length === EXPECTED.length && EXPECTED.every((n) => atlases.includes(n)), EXPECTED.length + ' atlases in the slot table: ' + EXPECTED.length + ' (td_big serves the digital speed and, from round 3, the gear; td_gear is 0.1.0\'s, superseded)');
ok(fs.readdirSync(FONTS).filter((f) => /\.json$/.test(f)).length === EXPECTED.length, 'hud/fonts holds exactly those ' + EXPECTED.length + ' files');
ok(Object.values(slots).every((s) => s.atlas && s.face && s.px > 0), Object.keys(slots).length + ' slots, each with an atlas, a face and a size');
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
    if (n === 'td_clock') ok(dig.length === 10 && g['1'].advance < g['0'].advance, n + ': ten digits, PROPORTIONAL (package C: "14:43" is not gapped)');
    else ok(dig.length === 10 && dig.every((c) => g[c].advance === g['0'].advance), n + ': ten digits, one tabular advance (' + g['0'].advance + ')');
    const outside = Object.keys(g).filter((c) => g[c].w && (g[c].x < 0 || g[c].x + g[c].w > f.width || g[c].y < 0 || g[c].y + g[c].h > f.height));
    ok(!outside.length, n + ': every glyph lies inside the atlas');
    const mib = f.width * f.height / 1048576;
    if (noto.includes(n) && n !== 'td_cnt') ok(mib <= 0.8, n + ': full-text atlas ' + mib.toFixed(2) + ' MiB <= 0.8');
});
const SIGN = ['td_sign', 'td_sign3'];
ok(saira.filter((n) => !SIGN.includes(n)).every((n) => font(n).stretch === 1.06) && noto.every((n) => font(n).stretch === undefined), 'the ' + (saira.length - 2) + ' dial Saira atlases were baked at stretch 1.06, no Noto one');
ok(font('td_sign').stretch === 0.88 && font('td_sign3').stretch === 0.85, 'the sign\'s two atlases are Saira 700 squeezed (0.88 and 0.85: the file has no width below 100)');

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

console.log('round 3: the gear, the program, the set speed, the distance, the sign\'s number');
{
    const big = font('td_big'), g = big.glyphs, D = '0123456789';
    ok('DMNPRS'.split('').every((c) => g[c] && g[c].w > 0 && g[c].h === big.cellHeight), 'td_big: the gear letters D M N P R S each have a glyph one cell high');
    ok(big.cellHeight === 70 && big.baseline === 67 && D.split('').every((c) => g[c].advance === 82) && g['0'].ox === -1 && g['0'].w === 85, 'td_big: the cell (70), the baseline (67) and the digits (advance 82) are 0.1.0\'s: the digital speed does not move');
    ok(g['-'] && g['–'] && g[':'], 'td_big: "-", "–" and ":" kept');
    const cap = (c) => { const a = Buffer.from(big.alpha, 'base64'); let top = 1e9, bot = -1; for (let y = 0; y < g[c].h; y++) for (let x = 0; x < g[c].w; x++) if (a[(g[c].y + y) * big.width + g[c].x + x] > 127) { top = Math.min(top, y); bot = Math.max(bot, y); } return bot - top + 1; };
    ok(cap('D') >= 62 && cap('D') <= 68 && Math.abs(cap('D') - cap('0')) <= 3, 'td_big: the gear\'s cap height is ' + cap('D') + ' px (SPEC-R3 2.7: about 66, the digital speed\'s size; a digit is ' + cap('0') + ')');
    // every string the engine's gear token can give: P R N, or D S M and the gear's digit (hud.js case \'gear\')
    const gears = ['P', 'R', 'N'].concat(['D', 'S', 'M'].map((l) => '12345678'.split('').map((d) => l + d)).reduce((a, b) => a.concat(b), []), ['D', 'S', 'M']);
    ok(gears.every((t) => t.split('').every((c) => g[c])), 'td_big draws all ' + gears.length + ' gear strings (P R N and D S M with 1..8)');
    // the engine's own grid for a gear widget on td_big: a box of two pitches (164 px), gpu text, at most two characters
    const H = require('./twin-harness');
    const HudApp = require(path.join(H.tree('twin_dial'), 'hud.js'));
    const grid = Object.create(HudApp.prototype)._gpuGrid({ font: 'td_big', w: 164, h: 70, align: 'center', maxLen: 2 });
    ok(grid.pitch === 82 && grid.max === 2 && grid.cw === 41 && grid.groups.length === 1 && grid.figs.join('') === D, 'the engine\'s gpu grid for a gear widget (box 164, maxLen 2): pitch 82, cells of 41, one layer, the ten digits as figures');
    const cells = (t) => Math.ceil(t.split('').reduce((a, c) => a + g[c].advance, 0) / grid.cw) + 1;
    ok(gears.every((t) => cells(t) <= 6), 'every gear string needs at most 6 spare atlas cells (the engine has 6): worst "' + gears.slice().sort((a, b) => cells(b) - cells(a))[0] + '" ' + Math.max.apply(null, gears.map(cells)));
    ok(slots.gear.atlas === 'td_big' && slots.gear_010.atlas === 'td_gear' && slots.gear_010.superseded === true, 'font_slots.json: "gear" is td_big, 0.1.0\'s td_gear is marked superseded');
}
{
    const has = (n, chars) => chars.split('').every((c) => font(n).glyphs[c]);
    ok(has('td_prog', 'COMFORT SPORT+ ECO PRO ADAPTIVE'), 'td_prog (Saira 24): COMFORT, SPORT, SPORT+, ECO PRO, ADAPTIVE');
    ok(font('td_prog').cellHeight === 25 && font('td_prog').size === 24, 'td_prog: Saira 24, cell 25 (cap 17 px, SPEC-R3 2.7)');
    ok(has('td_label', 'READY OFF'), 'td_label (Saira 22): READY and OFF still there');
    ok(has('td_cru', '0123456789–-') && font('td_cru').glyphs['0'].advance === 36, 'td_cru (Saira 40): the set speed\'s digits and the dashes, one tabular advance (36)');
    ok(has('td_dist', '0123456789:.,-–') && '0123456789'.split('').every((c) => font('td_dist').glyphs[c].advance === font('td_dist').glyphs['0'].advance), 'td_dist (Saira 72): digits, ":" "." "," and the dashes; tabular (a timer must not shift sideways)');
    // the sign: SPEC-R3 8, the white disc inside the 7.6 px ring is 25.4 px in radius
    ['td_sign', 'td_sign3'].forEach((n, i) => {
        const f = font(n), g = f.glyphs, cap = f.cellHeight - 4, ink = g['8'].w - 4, digits = i ? 3 : 2;
        const w = (digits - 1) * g['8'].advance + ink, corner = Math.hypot(w / 2, cap / 2), clear = 25.4 - corner;
        ok(has(n, '0123456789-–'), n + ': digits and the dashes of the empty sign');
        ok(clear >= 3, n + ': ' + digits + ' digits are ' + w + ' x ' + cap + ' px, ' + clear.toFixed(1) + ' px clear of the red ring at their corners (at least 3)');
    });
    ok(font('td_sign').size > font('td_sign3').size && font('td_sign3').cellHeight < font('td_sign').cellHeight, 'the number shrinks with the digit count (td_sign 31 px, td_sign3 23 px)');
    ok(has('td_tabs', 'КМ км 123 …') && font('td_tabs').size === 34 && font('td_tabs').cellHeight === 47, 'td_tabs: Noto 34, the tab bar text (cap 24 px)');
    ok(font('td_sub').size === 29 && has('td_sub', 'Підключено · CarPlay 80 % 3/4 Маршрут не прокладено'), 'td_sub: Noto 29 with full text');
}

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
const gen = require(path.join(ROOT, 'tools', 'twin-dial', 'a1', 'build_twin_icons.js'));
const D = require(path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms.js'));
const man = JSON.parse(fs.readFileSync(path.join(APP, 'hud', 'icons', 'icons.json'), 'utf8'));
// SPEC 10's 25 (the 0.1.0 set), then round 3's: K2's drawings of the mockups, then B6's
const SPEC10 = ['td_fuel', 'cc_warn', 'td_radio', 'td_media', 'td_phone', 'td_nav', 'td_fuel_side', 'cc_coolant', 'cc_door', 'cc_belt', 'cc_brake', 'cc_tyre', 'cc_engine', 'cc_washer', 'cc_bonnet', 'cc_boot', 'cc_oil', 'cc_pedal', 'cc_service', 'cc_battery', 'cc_info', 'td_avg', 'td_settings', 'cc_warn_solid', 'cc_dot'];
const K2 = ['td_car', 'td_engine', 'td_gauge', 'td_clock', 'td_road', 'td_rain', 'td_play', 'td_pause', 'td_mute', 'td_handset', 'td_phone_ring', 'td_mic_off', 'td_bars', 'td_phone_bars', 'td_phone_off', 'td_turn_right', 'td_turn_left', 'td_straight', 'td_flag', 'td_compass', 'td_limit', 'td_check', 'td_dot'];
const TURNS = ['td_straight', 'td_turn_slight_left', 'td_turn_left', 'td_turn_hard_left', 'td_uturn_left', 'td_turn_slight_right', 'td_turn_right', 'td_turn_hard_right', 'td_uturn_right'];
const FORKS = ['td_fork_left', 'td_fork_right', 'td_fork_straight', 'td_exit_left', 'td_exit_right', 'td_merge_left', 'td_merge_right'];
const FLAGS = ['td_flag_left', 'td_flag_centre', 'td_flag_right'];
const RB = [1, 2, 3, 4, 5, 6].reduce((a, n) => a.concat(['td_rb' + n + '_r', 'td_rb' + n + '_l']), []);
const NEW = ['td_proj', 'td_cruise', 'td_cruise_acc', 'td_limiter', 'td_end_stripes', 'td_lane_change_left', 'td_lane_change_right'];
const ALL = SPEC10.concat(K2.filter((n) => !SPEC10.includes(n)), TURNS.filter((n) => !K2.includes(n)), FORKS, FLAGS, RB, NEW);
const uniq = [...new Set(ALL)];
ok(uniq.length === ALL.length, 'no name twice in the expected set (' + ALL.length + ' icons: 25 of SPEC 10, ' + K2.filter((n) => !SPEC10.includes(n)).length + ' of K2\'s drawings, ' + (ALL.length - 25 - K2.filter((n) => !SPEC10.includes(n)).length) + ' new)');
ok(ALL.every((n) => typeof T.ICONS[n] === 'function' && icons.ICONS[n] === T.ICONS[n]) && Object.keys(T.ICONS).length === ALL.length, 'every icon of the set is in shared/twin_icons.js and registered in icons.js, and nothing else is');
ok(!T.ICONS.td_phone_none && !D.DRAWINGS.td_phone_none && T.ICONS.td_phone_off, 'K2\'s td_phone_none is td_phone_off (SPEC-R3 3.3 and the brief name it so)');
ok(fs.readFileSync(path.join(ROOT, 'shared', 'twin_icons.js'), 'utf8') === gen.moduleText(), 'shared/twin_icons.js is exactly what tools/twin-dial/a1/build_twin_icons.js writes');
ok(fs.readFileSync(path.join(APP, 'hud', 'icons', 'icons.json'), 'utf8') === gen.manifestText(), 'hud/icons/icons.json (slot table, ink boxes, alpha hashes) is exactly what it writes');
let diff = 0, worst = '';
ALL.forEach((n) => { for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const a = T.ICONS[n]((x + 0.5) / 48, (y + 0.5) / 48), b = D.ICONS[n]((x + 0.5) / 48, (y + 0.5) / 48); if (a !== b) { diff++; worst = n; } } });
ok(diff === 0, 'the engine\'s distance functions equal the design drawings on a 48x48 grid' + (diff ? ' (differ: ' + worst + ')' : ''));
// No ink outside the box (nothing is clipped) - but two sets are drawn to the edge on purpose and are listed: the manoeuvre arrows'
// stems run out of the bottom (an arrow starts at the edge of its picture, by up to 0.08 of the box, as K2 drew them), and K2's
// td_bars has its tallest bar 0.04 over the top (kept as drawn in the mockups).
const STEMS = TURNS.concat(FORKS, ['td_lane_change_left', 'td_lane_change_right']);
const outside = [];
ALL.forEach((n) => {
    const slack = { bottom: STEMS.includes(n) ? 0.08 : 0, top: n === 'td_bars' ? 0.045 : 0 };
    for (let i = 0; i < 400; i++) {
        const t = i / 400;
        [[-0.002, t], [1.002, t], [t, -0.002 - slack.top]].concat(slack.bottom ? [] : [[t, 1.002]]).forEach(([x, y]) => { if (T.ICONS[n](x, y) < -1e-9) outside.push(n + (y > 1 ? ' (bottom)' : y < 0 ? ' (top)' : '')); });
        if (T.ICONS[n](t, 1.002 + slack.bottom) < -1e-9) outside.push(n + ' (bottom beyond ' + slack.bottom + ')');
    }
});
ok(!outside.length, 'no icon has ink outside its box (none is clipped; the arrows\' stems and td_bars excepted by design)' + (outside.length ? ': ' + [...new Set(outside)].join(' ') : ''));
// the slot table: sizes of SPEC-R3 7 and the places that name them
const sz = (k) => man.slots[k] && man.slots[k].w + 'x' + man.slots[k].h;
ok(sz('tab') === '36x36' && sz('gauge') === '32x32' && sz('symbol') === '54x54' && sz('row') === '32x32' && sz('big') === '66x66' && sz('page') === '54x54' && sz('cruise') === '36x36' && sz('arrow') === '120x120' && sz('lane') === '30x30' && sz('sign') === '51x51',
    'slot table: tab 36, gauge 32, symbol 54, row 32, page 54, big 66, cruise 36, arrow 120, lane 30, sign 51 (SPEC-R3 3.1, 4, 5.1, 8, 9)');
ok(man.items.length === Object.keys(gen.SLOTS).reduce((a, k) => a + gen.SLOTS[k].names.length, 0) && man.items.every((i) => i.ink > 20 && i.box[0] >= 0 && i.box[1] >= 0 && i.box[2] <= i.w && i.box[3] <= i.h), 'slot table: ' + man.items.length + ' entries, each with ink and its ink box inside its slot');
const slotNames = new Set(man.items.map((i) => i.name));
ok(ALL.every((n) => slotNames.has(n)), 'every icon of the set sits in a slot (a size to draw it at)');
// the tab bar (SPEC-R3 3.3), cruise (9), the sign (8), guidance (4.5) as the brief lists them
const inSlot = (k, n) => man.items.some((i) => i.slot === k && i.name === n);
ok(['td_fuel', 'cc_warn', 'td_radio', 'td_media', 'td_proj', 'td_phone', 'td_phone_bars', 'td_phone_off', 'td_nav'].every((n) => inSlot('tab', n)), 'the nine tab icons are at 36 px');
ok(['td_cruise', 'td_cruise_acc', 'td_limiter'].every((n) => inSlot('cruise', n)) && inSlot('sign', 'td_end_stripes'), 'cruise, adaptive cruise and limiter at 36 px; the derestriction stripes for the sign');
ok(TURNS.concat(FORKS, FLAGS, RB, ['td_dot']).every((n) => inSlot('arrow', n)) && TURNS.every((n) => inSlot('lane', n)), 'the manoeuvre set (9 turns, 7 forks and exits, 3 flags, 12 roundabouts) at 120 px; the 9 turns also at 30 px for the lane row');
// pairs: a left icon is its right icon mirrored; a roundabout for left-hand traffic is the right-hand one mirrored; the six exits differ
const mirrorOf = (a, b) => { let bad = 0; for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (Math.abs(T.ICONS[a]((x + 0.5) / 40, (y + 0.5) / 40) - T.ICONS[b](1 - (x + 0.5) / 40, (y + 0.5) / 40)) > 1e-9) bad++; return bad === 0; };
const pairs = [['td_turn_left', 'td_turn_right'], ['td_turn_slight_left', 'td_turn_slight_right'], ['td_turn_hard_left', 'td_turn_hard_right'], ['td_uturn_left', 'td_uturn_right'], ['td_fork_left', 'td_fork_right'], ['td_exit_left', 'td_exit_right'], ['td_merge_left', 'td_merge_right'], ['td_lane_change_left', 'td_lane_change_right']]
    .concat([1, 2, 3, 4, 5, 6].map((n) => ['td_rb' + n + '_l', 'td_rb' + n + '_r']));
ok(pairs.every((p) => mirrorOf(p[0], p[1])), pairs.length + ' left / right pairs are exact mirrors of each other');
const sig = (n) => man.items.find((i) => i.slot === 'arrow' && i.name === n).alpha_sha1;
ok(new Set(RB.map(sig)).size === 12 && new Set(TURNS.concat(FORKS, FLAGS).map(sig)).size === 19, 'the 12 roundabouts and the 19 other manoeuvres are all different drawings');
// the stripes: five of them across the disc's diameter, none outside the disc (the page paints the disc and the ring)
{
    let runs = 0, prev = false, out = 0;
    for (let i = 0; i < 2000; i++) { const u = 0.5 + ((i / 2000) - 0.5) * 0.7072; const ink = T.ICONS.td_end_stripes(u, u) < 0; /* across the stripes, through the centre */ if (ink && !prev) runs++; prev = ink; }
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) { const px = (x + 0.5) / 100, py = (y + 0.5) / 100; if (T.ICONS.td_end_stripes(px, py) < -0.002 && Math.hypot(px - 0.5, py - 0.5) > 0.5 + 1e-9) out++; }
    ok(runs === 5, 'td_end_stripes: five stripes across the disc\'s diagonal (' + runs + ')');
    ok(out === 0, 'td_end_stripes: no ink outside the disc of the box');
}
const stripSrc = fs.readFileSync(path.join(ROOT, 'design', 'strip', 'pictograms', 'pictograms.js'), 'utf8');
const vtSrc = fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms.js'), 'utf8');
ok(typeof require(path.join(ROOT, 'design', 'strip', 'pictograms', 'pictograms.js')).stepDist === 'function' && !/function stepDist|function dSeg/.test(vtSrc) && /function stepDist/.test(stripSrc), 'stepDist is exported by the strip pictograms and the VT copy is gone');
{ // the paint itself: known icons at their slot sizes draw ink in the right place
    const ink = (n, w, h) => { const px = icons.paintIcon(n, w, h, [255, 255, 255, 255]); let c = 0; for (let i = 3; i < px.length; i += 4) c += px[i] ? 1 : 0; return c; };
    const f = ink('td_fuel', 36, 36), a = ink('td_straight', 120, 120), l = ink('td_straight', 30, 30);
    ok(f > 220 && f < 700, 'td_fuel at 36 px paints ' + f + ' pixels of ink');
    ok(a > 2500 && a < 6000 && l > 100 && l < 400, 'td_straight paints ' + a + ' pixels at 120 px and ' + l + ' at 30 px');
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
