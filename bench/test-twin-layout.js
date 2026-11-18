'use strict';
/**
 * test-twin-layout.js - Twin Dial's layout (package C, round 2; docs/twin-dial/SPEC.md 3.3, 5, 6, 9, 13).
 *
 *   node bench/test-twin-layout.js
 *
 * No bench, no car: it reads files, runs design/gen_twin.py and plans the layers with the real engine (shared/hud.js _plan,
 * required from a temp tree: bench/twin-harness.js). It checks
 *   1. design/gen_twin.py reproduces apps/twin_dial/hud/layouts/twin.json byte for byte, and its font metrics agree with the atlases;
 *   2. the layout is valid for the engine (shared/layouts.js) and every widget clears shared/visible.js (the hood, BMW's belt
 *      light, its parking-brake lamp, its black area), the dials by their ink (the ring), not by their layer rect;
 *   3. SPEC 3.3's keep-outs: nothing of ours in the belt group, the gear gap, the seven side lamps, the lamp strip; no layer
 *      rect (effects and the sheets the engine plans) meets the gear gap; every lamp and the belt group have a hole in the
 *      background part that covers them; the dial furniture rule;
 *   4. every text sits on the SPEC's baseline and at its x, in the SPEC's font and colour role, and its box is wide and
 *      high enough for the worst text its token can give; no Cyrillic ever reaches a Saira widget; every character a token
 *      can give is in its font; boxes of one sheet do not overlap (an overlap costs a layer);
 *   5. the layer plan: layers per connection, sheets, pixel memory;
 *   6. numeral clearance (SPEC 5.3): >= 4 px of black round every scale numeral, from the atlases.
 * Atlases and faces come from package A1 / A2; before their merge, TWIN_FONTS=<dir of td_*.json> lends them (the checks
 * that need the atlases say "skipped" when there are none). Node 8 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./twin-harness');

const ROOT = H.ROOT;
const APP = path.join(ROOT, 'apps', 'twin_dial');
const LAYOUT = path.join(APP, 'hud', 'layouts', 'twin.json');
let passed = 0, failed = 0, skipped = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const skip = (what) => { skipped++; console.log('  skip ' + what); };
const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const box = (w) => [w.x, w.y, w.x + w.w, w.y + w.h];

const dir = H.tree('twin_dial');
const HudApp = require(path.join(dir, 'hud.js'));
const twin = require(path.join(dir, 'twin_tokens.js'));
const visible = require(path.join(dir, 'visible.js'));
const Layouts = require(path.join(dir, 'layouts.js'));
const { THEMES } = require(path.join(dir, 'hud_themes.js'));
const VG = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'vg', 'layout.json'), 'utf8'));
const L = JSON.parse(fs.readFileSync(LAYOUT, 'utf8'));
const W = L.widgets;
const byId = {}; W.forEach((w) => { byId[w.id] = w; });
const ink = W.filter((w) => w.type === 'text' || w.type === 'icon' || w.type === 'atext');   // what draws glyphs and pictograms
const FONTDIR = fs.existsSync(path.join(dir, 'hud', 'fonts', 'td_big.json')) ? path.join(dir, 'hud', 'fonts') : null;
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'c', 'font_metrics.json'), 'utf8')).fonts;
const atlas = (n) => JSON.parse(fs.readFileSync(path.join(FONTDIR, n + '.json'), 'utf8'));
const glyphsOf = (n) => (FONTDIR ? Object.keys(atlas(n).glyphs) : Object.keys(snap[n].advance));
const advOf = (n, c) => (FONTDIR ? atlas(n).glyphs[c].advance : snap[n].advance[c]);
const widthOf = (n, s) => Array.from(s).reduce((a, c) => a + advOf(n, c), 0);

// ---------------------------------------------------------------------------------------------------------------------
console.log('the generator reproduces the committed layout');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-twin-'));
let gen = true;
try { execFileSync('python3', [path.join(ROOT, 'design', 'gen_twin.py'), tmp].concat(FONTDIR ? ['--fonts', FONTDIR] : []), { stdio: 'pipe' }); } catch (e) { gen = false; ok(false, 'gen_twin.py runs (' + String(e.stderr || e.message).slice(0, 300) + ')'); }
if (gen) {
    const a = fs.readFileSync(LAYOUT), b = fs.readFileSync(path.join(tmp, 'twin.json'));
    let where = '';
    if (!a.equals(b)) {
        const la = String(a).split('\n'), lb = String(b).split('\n');
        const i = la.findIndex((l, k) => l !== lb[k]);
        where = ': first difference at line ' + (i + 1) + ' (' + JSON.stringify((la[i] || '').trim()) + ' committed, ' + JSON.stringify((lb[i] || '').trim()) + ' generated)';
    }
    ok(a.equals(b), 'twin.json is exactly what design/gen_twin.py writes' + where);
}
if (FONTDIR) {
    const bad = Object.keys(snap).filter((n) => {
        const f = atlas(n);
        return f.cellHeight !== snap[n].cellHeight || f.baseline !== snap[n].baseline || Object.keys(snap[n].advance).some((c) => f.glyphs[c] && f.glyphs[c].advance !== snap[n].advance[c]);
    });
    ok(!bad.length, 'design/twin-dial/c/font_metrics.json agrees with the atlases' + (bad.length ? ' (run tools/twin-dial/c/font_snapshot.py; differs: ' + bad.join(', ') + ')' : ''));
} else skip('the font snapshot against the atlases (no atlases in the tree)');

// ---------------------------------------------------------------------------------------------------------------------
console.log('the layout is valid for the engine and clears the hood and BMW\'s lamps');
ok(L.schemaVersion === 2 && L.theme === 'twin' && Array.isArray(W), 'schemaVersion 2, theme "twin"');
ok(new Set(W.map((w) => w.id)).size === W.length, 'every widget id is unique (' + W.length + ' widgets)');
{
    const lay = new Layouts(fs.mkdtempSync(path.join(os.tmpdir(), 'twin-data-')), H.nolog, [1920, 720]);
    const asIs = (() => { try { lay.load('twin'); return null; } catch (e) { return e.message; } })();
    if (asIs === null) ok(true, 'shared/layouts.js loads and validates twin.json whole');
    else if (/unknown type "(tdial|tdback)"/.test(asIs)) {
        skip('shared/layouts.js does not know tdial / tdback yet (package B merges them): ' + asIs);
        // the rest of the layout is validated with those two types taken out
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-data-')), lay2 = new Layouts(dataDir, H.nolog, [1920, 720]);
        fs.mkdirSync(path.join(dataDir, 'layouts'), { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'layouts', 'twin.json'), JSON.stringify(Object.assign({}, L, { widgets: W.filter((w) => w.type !== 'tdial' && w.type !== 'tdback') })));
        let err = null; try { lay2.load('twin'); } catch (e) { err = e.message; }
        ok(err === null, 'shared/layouts.js validates every other widget (toggles, conn, sizes)' + (err ? ': ' + err : ''));
    } else ok(false, 'shared/layouts.js validates twin.json: ' + asIs);
}
{
    const warns = visible.check(ink, 'panel');
    const allowed = warns.filter((s) => /^speed: overlaps BMW's black area/.test(s));
    const rest = warns.filter((s) => allowed.indexOf(s) < 0);
    ok(!rest.length, 'every text and pictogram clears shared/visible.js (hood, belt light, parking-brake lamp)' + (rest.length ? ': ' + rest.join('; ') : ''));
    // the digital speed stands in the middle of the right dial, where f30_cluster's bench model has BMW's black area. SPEC 3.3 does
    // not list it as a keep-out and 17.3 keeps the gear gap closed so that the area is not provoked: the only allowance
    ok(allowed.length <= 1, 'the one allowance: the digital speed overlaps the black-area model of visible.js (' + (allowed.length ? allowed[0] : 'none') + ')');
}
{
    // the dials by their ink: the ring's outer edge (R 300 + 3.9 px), between -144 and +144 degrees, 4 px under the hood line
    let worst = 1e9;
    [VG.dials.tacho.centre, VG.dials.speedo.centre].forEach((c) => {
        for (let a = -144; a <= 144; a += 1) {
            const x = c[0] + 303.9 * Math.sin(a * Math.PI / 180), y = c[1] - 303.9 * Math.cos(a * Math.PI / 180);
            worst = Math.min(worst, y - visible.hoodY(x));
        }
    });
    ok(worst >= 4, 'both rings stay >= 4 px under the hood line (least clearance ' + worst.toFixed(1) + ' px)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('SPEC 3.3: the keep-outs');
const BELT = VG.keep_outs.belt_group.rect, GAP = VG.keep_outs.gear_gap.rect, LAMPS = VG.keep_outs.telltales_holes.rects_plus_3px;
const STRIP = VG.frame.telltale_strip.rect, MARKER = [1240, 588, 1288, 630];
const bgs = W.filter((w) => w.type === 'tdback'), dials = W.filter((w) => w.type === 'tdial');
const others = ink.concat(dials);
ok(!others.some((w) => hit(box(w), BELT)), "nothing of ours in BMW's belt + airbag group " + JSON.stringify(BELT));
ok(!others.some((w) => hit(box(w), GAP)), "nothing of ours in the gear-letter gap " + JSON.stringify(GAP));
ok(!ink.some((w) => LAMPS.some((l) => hit(box(w), l))), "nothing of ours (text, pictogram) inside BMW's seven side lamps' holes");
{
    // the dials by their ink: the ring's outer edge (R + 3.9 px, -144..+144 degrees) against each lamp's box (the hole less its 3 px)
    let least = 1e9;
    dials.forEach((d) => {
        for (let a = -144; a <= 144; a += 0.25) {
            const x = d.centre[0] + 303.9 * Math.sin(a * Math.PI / 180), y = d.centre[1] - 303.9 * Math.cos(a * Math.PI / 180);
            LAMPS.forEach((l) => { least = Math.min(least, Math.hypot(Math.max(l[0] + 3 - x, 0, x - l[2] + 3), Math.max(l[1] + 3 - y, 0, y - l[3] + 3))); });
        }
    });
    ok(least >= 2.9, "both dials' rings keep " + least.toFixed(1) + ' px from every one of the seven lamp boxes (VG: 3.7 on its metric; the hole is the box + 3 px)');
}
ok(!ink.some((w) => hit(box(w), STRIP)), 'nothing of ours in the lamp strip above the tab bar ' + JSON.stringify(STRIP));
ok(!ink.some((w) => w.conn !== 2 && hit(box(w), MARKER)), "BMW's stored-message marker is covered by our black, no text of ours there");
{
    const parts = {};
    bgs.forEach((b) => { parts[b.part] = b; });
    ok(Object.keys(parts).sort().join() === 'L,RB,RT' && bgs.length === 3, 'three tdback layers, parts L, RT and RB');
    const sq = (p) => box(parts[p]);
    ok(JSON.stringify(sq('L')) === '[0,0,1380,720]' && JSON.stringify(sq('RT')) === '[1380,0,1920,660]' && JSON.stringify(sq('RB')) === '[1460,660,1920,720]', 'the three background rects of SPEC 13.2');
    const covers = (r) => bgs.some((b) => hit(box(b), r) && (b.holes || []).some((h) => h[0] <= r[0] && h[1] <= r[1] && h[2] >= r[2] && h[3] >= r[3]));
    ok(covers(BELT), 'the belt + airbag group has a see-through hole in the background');
    ok(LAMPS.every(covers), 'every one of the seven side lamps (box + 3 px) has a see-through hole in the background');
    ok(bgs.every((b) => (b.holes || []).length <= 8 && (b.holes || []).every((h) => hit(h, box(b)))), 'at most 8 holes per layer, each inside its own part (ENGINE-CONTRACT 1.2)');
    ok(!parts.RB.holes.length && parts.RT.holes.length === 3 && parts.L.holes.length === 5, 'holes: L belt + 4 left lamps, RT the 3 right lamps, RB none');
    ok(!parts.RT.tab && !parts.RT.panelMask && !parts.RB.tab && !parts.RB.rules && parts.L.tab && parts.L.panelMask && parts.L.rules, 'only L carries the tab bar, the rules and the panel mask');
}
{
    // plan the layers with the engine's own planner: the effect layers and the sheets, none in the gear gap
    const fake = { _connOf: (w) => w.conn || 0 };
    const plan = HudApp.prototype._plan.call(fake, W.map((w) => (w.type === 'text' && w.gpu ? Object.assign({}, w, { type: 'atext' }) : w)), Math.floor(1920 * 720 / 4), L.packWaste);
    const rects = plan.map((e) => (e.kind === 'sheet' ? [e.x, e.y, e.x + e.w, e.y + e.h] : box(e.w)));
    ok(!rects.some((r) => hit(r, GAP)), 'no layer rect of ours (effects, the sheets the engine plans) meets the gear gap');
    ok(!rects.filter((r, i) => plan[i].kind === 'sheet').some((r) => hit(r, BELT)), 'no sheet meets the belt group');
    dials.forEach((d) => {
        ok(d.y + d.h <= 660 && d.bar.y + d.bar.h / 2 <= 657, d.id + ': the layer ends at y 660 (' + (d.y + d.h) + ') and the bar at y ' + (d.bar.y + d.bar.h / 2));
    });
    // SPEC 3.3's furniture rule: nothing of a dial below y 657 where x is in 494..691 or 1377..1463
    const bad = ink.filter((w) => w.conn !== 2 && w.y + w.h > 657 && [[494, 691], [1377, 1463]].some((r) => w.x < r[1] && w.x + w.w > r[0]));
    ok(!bad.length, 'dial furniture rule: nothing of a dial below y 657 in x 494..691 and 1377..1463' + (bad.length ? ' (' + bad.map((w) => w.id).join(', ') + ')' : ''));
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the dials and the background in the contract\'s fields (docs/twin-dial/ENGINE-CONTRACT.md 1)');
{
    const t = byId.dial_tach, s = byId.dial_speed;
    ok(t && s && t.kind === 'tach' && s.kind === 'speed', 'two tdial layers, a tachometer and a speedometer');
    ok(JSON.stringify([t.centre, t.R, s.centre, s.R]) === JSON.stringify([[380, 400], 300, [1540, 400], 300]), 'centres (380, 400) and (1540, 400), R 300 (SPEC 3.2)');
    ok(JSON.stringify(box(t)) === '[70,90,690,660]' && JSON.stringify(box(s)) === '[1230,90,1850,660]', 'layer rects [70, 90, 620, 570] and [1230, 90, 620, 570] (bottom edge 660)');
    ok(t.sweep === 125 && s.sweep === 125 && t.scaleMax === 8000 && t.redline === 'setting' && t.restDeg === -135, 'sweep 125, the tachometer 0..8000 rpm, the redline from the setting, OFF at -135');
    [t, s].forEach((d) => {
        const f = d.face;
        ok(f.x === d.centre[0] - 308 && f.y === 90 && f.w === 616 && f.h === 560 && f.x >= d.x && f.x + f.w <= d.x + d.w && f.y >= d.y && f.y + f.h <= d.y + d.h, d.id + ': the face (' + f.tex + ') is 616 x 560 on the dial centre and inside the layer');
    });
    ok(t.face.tex === 'face_tacho' && s.face.tex === 'face_speedo', 'faces face_tacho and face_speedo');
    ok(t.bar.y === 619 && t.bar.x0 === 254 && t.bar.x1 === 506 && t.bar.segs === 5 && t.bar.gap === 4 && t.bar.signal === 'fuel' && t.bar.reserve === 'reserve', 'tachometer bar: y 619, x 254..506, 5 segments, fuel, reserve (SPEC 5.1)');
    ok(s.bar.y === 619 && s.bar.x0 === 1414 && s.bar.x1 === 1666 && s.bar.segs === 5 && s.bar.signal === 'coolant' && s.bar.min === 50 && s.bar.max === 130 && s.bar.hotAt === 120, 'speedometer bar: x 1414..1666 (the dial centre +-0.42 R; the contract text 1394..1646 is 20 px off the dial, a typo), coolant 50..130, red from 120 (SPEC 5.2)');
    const L0 = byId.bg_l;
    ok(JSON.stringify(L0.tab.rect) === '[618,127,1302,172]' && JSON.stringify(L0.tab.seps) === '[780,848,1168,1237]' && JSON.stringify(L0.tab.ramp) === '[0.002,0.16]' && JSON.stringify(L0.tab.highlight) === '[780,848]' && JSON.stringify(L0.tab.rule) === '[170,173]', 'tab bar [618, 127, 1302, 172], separators 780 848 1168 1237, ramp 0.002 .. 0.16, tab 2\'s cell 780..848, the rule 3 px (SPEC-R3 3.1)');
    ok(L0.rules.length === 2 && L0.rules[0].y0 === 295.2 && L0.rules[0].x0 === 741 && L0.rules[0].x1 === 1180 && L0.rules[1].y0 === 612.4 && L0.rules[1].x0 === 629 && L0.rules[1].x1 === 1292 && L0.rules[1].ours.y0 === 611 && L0.rules[1].ours.y1 === 615 && L0.rules[1].ours.role === 'severity', 'rules: the title rule y 296, the bottom rule y 613 (4 px in the severity colour while our plate shows) (SPEC 6.2, 6.3, 8.1)');
    const m = L0.panelMask;
    ok(m.tex === 'panel_mask' && m.x === 694 && m.y === 592 && m.w === 536 && m.h === 112, 'panel mask panel_mask at [694, 592, 1230, 704] (package A2)');
    const plate = [694.5, 592, 1230, 720];
    ok(m.x + m.w <= plate[2] && m.y + m.h <= plate[3] && m.x >= Math.floor(plate[0]) && m.y >= plate[1], 'the plate [694.5, 592, 1230, 720] covers the window (SPEC 8.1)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('texts: SPEC positions, fonts, colours, worst-case widths');
const ROLES = ['fg', 'dim', 'hot', 'ready', 'amber', 'grey', 'rule', 'bg'];     // ENGINE-CONTRACT 3: the theme "twin"
const fontBase = (n) => (FONTDIR ? atlas(n).baseline : snap[n].baseline);
const fontCell = (n) => (FONTDIR ? atlas(n).cellHeight : snap[n].cellHeight);
const baseOf = (w) => w.y + fontBase(w.font);
const centreX = (w) => w.x + w.w / 2;
const SAIRA = ['td_big', 'td_clock', 'td_gear', 'td_label', 'td_tach', 'td_scale_l', 'td_scale_s'];
{
    const T = (id) => byId[id];
    // [id, baseline, x of the text's anchor (centre / left / right edge by its align), font, role]
    const spec = [
        ['speed', 441, 1540, 'td_big', 'fg'], ['gear', 539, 374, 'td_gear', 'fg'], ['ready', 348, 380, 'td_label', 'ready'], ['program', 576, 386, 'td_label', 'fg'],
        ['tab_range_u', 156, null, 'td_u19', 'fg'], ['tab_range_v', 156, null, W.find((w) => w.id === 'tab_range_v').font === 'td_tabs' ? 'td_tabs' : 'td_tab', 'fg'],
        ['c_title', 282, 960, 'td_title', 'fg'], ['c_time', 404, 960, 'td_clock', 'fg'], ['c_weekday', 460, 960, 'td_val', 'fg'], ['c_date', 519, 960, 'td_val', 'fg'],
        ['t1_a', 362, 905, 'td_val', 'fg'], ['t1_au', 362, 911, 'td_u21', 'fg'], ['t1_b', 362, 1105, 'td_val', 'fg'], ['t1_bu', 362, 1111, 'td_u21', 'fg'],
        ['t2_a', 430, 905, 'td_val', 'fg'], ['t2_au', 430, 911, 'td_u21', 'fg'], ['t2_b', 430, 1105, 'td_val', 'fg'], ['t2_bu', 430, 1111, 'td_u21', 'fg'],
        ['t_from', 528, 960, 'td_body', 'dim'],
        ['row_l1', 656, 846, 'td_row', 'fg'], ['row_l1u', 656, 851, 'td_u21', 'fg'], ['row_l2', 703, 846, 'td_row', 'fg'],
        ['row_r1', 656, 1153, 'td_row', 'fg'], ['row_r1u', 656, 1158, 'td_u21', 'fg'], ['row_r2', 703, 1153, 'td_row', 'fg'], ['row_r2u', 703, 1158, 'td_u21', 'fg'],
    ];
    const bad = [];
    spec.forEach(([id, base, x, font, role]) => {
        const w = T(id);
        if (!w) { bad.push(id + ' missing'); return; }
        const ax = w.align === 'center' ? centreX(w) : w.align === 'left' ? w.x : w.x + w.w;
        if (baseOf(w) !== base) bad.push(id + ' baseline ' + baseOf(w) + ' (SPEC ' + base + ')');
        if (x !== null && Math.abs(ax - x) > 0.5) bad.push(id + ' x ' + ax + ' (SPEC ' + x + ')');
        if (w.font !== font) bad.push(id + ' font ' + w.font + ' (SPEC ' + font + ')');
        if (w.color !== role) bad.push(id + ' colour ' + w.color + ' (SPEC ' + role + ')');
    });
    ok(!bad.length, 'every text is on the SPEC\'s baseline and x, in its font and colour role (' + spec.length + ' texts)' + (bad.length ? ': ' + bad.join('; ') : ''));
    ok(W.filter((w) => w.type === 'text' || w.type === 'icon').every((w) => ROLES.indexOf(w.color) >= 0), 'every colour is a role of the theme "twin": ' + ROLES.join(' '));
    if (THEMES.twin) ok(ROLES.every((r) => Array.isArray(THEMES.twin[r])), 'the theme "twin" of shared/hud_themes.js has every one of those roles');
    else skip('the theme "twin" is not in shared/hud_themes.js yet (package B merges it)');
    // the icons: SPEC-R3 3.1, 36 px of ink = a 46 px box on the centre line y 147 (the approved mockups); tab 3's cell is ONE live widget (icon + text as a group)
    const icons = { tab_range_i: 'td_fuel', tab_warn_i: 'cc_warn', tab_phone_i: 'td_phone', tab_nav_i: 'td_nav' };
    ok(Object.keys(icons).every((id) => T(id) && T(id).icon === icons[id] && T(id).w === 46 && T(id).h === 46 && T(id).y + 23 === 147 && T(id).tdLive), 'tab bar pictograms: 46 x 46 boxes (36 px of ink) on y 147, all live (night colours repaint them)');
    ok(T('tab_media') && T('tab_media').tdLive === 'media' && T('tab_media').x === 858 && T('tab_media').w === 300 && T('tab_media').h === 46 && T('tab_media').y === 124, 'tab 3: one live widget [858, 124, 1158, 170] painting the source icon and its text as a centred group');
    // the speed and the gear are GPU texts of the right pitch (the atlas decides; the engine's own test)
    ok(T('speed').gpu === true && T('speed').maxLen === 3 && T('gear').gpu === true, 'the digital speed and the gear are GPU texts (hud.js "gpu")');
}
{
    // the strings every token can give, per widget: from the token functions over a sweep of states
    const hud = H.fakeHud(HudApp, { settings: { centre: 'clock' }, config: { trip: { factors: { bc: 1, speed: 0.1, cons: 0.1, way: 0.1 } } } });
    const cands = {};
    const add = (id, s) => { (cands[id] = cands[id] || new Set()).add(s); };
    const T0 = Date.UTC(2026, 10, 17, 12, 43);
    const states = [];
    for (const page of ['clock', 'trip']) for (const tz of [null, 120, -300]) for (const sp of [null, 0, 87.4, 312]) for (const cond of [undefined, 10]) {
        states.push({ page, tz, sp, cond });
    }
    const mkTrip = (big) => ({ avg: { speed1: big ? 4000 : 410, cons1: big ? 999 : 68, speed2: 1, cons2: 1 }, travel: { hours: big ? 99 : 0, minutes: big ? 59 : 43, way: big ? 9999 : 124 }, start: { h: 14, m: 0 } });
    states.forEach((s) => {
        hud._settings.centre = s.page;
        hud.tzCar = s.tz; hud._d = { speed: s.sp === null ? undefined : s.sp, condition: s.cond, stage: 'D', gear: 3 };
        hud.car.live = { condition: s.cond };
        hud.td = twin.fresh(); hud.td.clock = () => T0;
        Object.assign(hud.td, mkTrip(s.sp === 312), { mileage: s.sp === null ? null : 123456 });
        hud.rangeKm = s.sp === null ? null : 999; hud.ambient = s.sp === null ? null : -30.5;
        [[null, null], ['sport', 'plus'], ['eco', null], ['comfort', null], ['sport', null], ['comfort', 'individual']].forEach((m) => {
            hud.driveMode = m[0]; hud.driveVariant = m[1];
            [['D', 3], ['P', 0], ['R', -1], ['N', 0], [undefined, undefined]].forEach((g) => {
                hud._d.stage = g[0]; hud._d.gear = g[1];
                W.filter((w) => w.type === 'text' && /\{\{td:/.test(w.text)).forEach((w) => add(w.id, hud._resolve(w.text)));
            });
        });
    });
    W.filter((w) => w.type === 'text' && !/\{\{/.test(w.text)).forEach((w) => add(w.id, w.text));
    W.filter((w) => w.type === 'text' && /\{\{ccHead\}\}/.test(w.text)).forEach((w) => { delete cands[w.id]; });      // package D's plate placeholder
    const cyr = /[Ѐ-ӿ]/;
    const sairaCyr = [], missing = [], tooWide = [], tooTall = [];
    W.filter((w) => w.type === 'text' && cands[w.id]).forEach((w) => {
        const have = new Set(glyphsOf(w.font));
        cands[w.id].forEach((s) => {
            if (SAIRA.indexOf(w.font) >= 0 && cyr.test(s)) sairaCyr.push(w.id + ' ' + JSON.stringify(s));
            Array.from(s).forEach((c) => { if (!have.has(c)) missing.push(w.id + ' needs ' + JSON.stringify(c) + ' (U+' + c.charCodeAt(0).toString(16) + ') in ' + w.font); });
            if (Array.from(s).every((c) => have.has(c)) && !w.gpu && widthOf(w.font, s) > w.w + 1) tooWide.push(w.id + ' "' + s + '" ' + widthOf(w.font, s) + ' > ' + w.w);
        });
        if (w.h > fontCell(w.font)) tooTall.push(w.id + ' ' + w.h + ' > cell ' + fontCell(w.font));
    });
    ok(!sairaCyr.length, 'no Cyrillic ever reaches a Saira widget (' + W.filter((w) => SAIRA.indexOf(w.font) >= 0).length + ' Saira widgets, every string their tokens can give)' + (sairaCyr.length ? ': ' + sairaCyr.join('; ') : ''));
    ok(!missing.length, 'every character a text can show is in its font (' + Object.keys(cands).length + ' widgets swept over ' + states.length + ' states)' + (missing.length ? ': ' + Array.from(new Set(missing)).slice(0, 8).join('; ') : ''));
    ok(!tooWide.length, 'every text\'s worst case fits its box' + (tooWide.length ? ': ' + tooWide.slice(0, 6).join('; ') : ''));
    ok(!tooTall.length, 'no text box is taller than its font\'s cell' + (tooTall.length ? ': ' + tooTall.join('; ') : ''));
    // GPU texts: the engine's own eligibility test, on the real atlas
    if (FONTDIR) {
        const fakeEng = Object.create(HudApp.prototype); fakeEng.log = H.nolog;
        W.filter((w) => w.gpu).forEach((w) => { ok(fakeEng._gpuTextWhy(w) === null, w.id + ': the engine can draw it on the GPU (whole-pixel figure pitch)'); });
    } else skip('GPU text eligibility (no atlases in the tree)');
    // no Cyrillic in any Saira widget's own template either (a literal)
    ok(W.filter((w) => w.type === 'text' && SAIRA.indexOf(w.font) >= 0).every((w) => !cyr.test(w.text)), 'no Saira widget\'s template holds a Cyrillic letter');
}
{
    // two boxes of one sheet group may not overlap, but the two centre pages' widgets do (they are one sheet each, by design)
    const grp = {};
    W.filter((w) => w.type === 'text' || w.type === 'icon').forEach((w) => { const k = (w.conn || 0) + ':' + w.z; (grp[k] = grp[k] || []).push(w); });
    const clock = ['c_time', 'c_weekday', 'c_date'], trip = W.filter((w) => /^t[12]_|^t_from$/.test(w.id)).map((w) => w.id);
    const bad = [];
    Object.keys(grp).forEach((k) => grp[k].forEach((a, i) => grp[k].slice(i + 1).forEach((b) => {
        const cross = (clock.indexOf(a.id) >= 0 && trip.indexOf(b.id) >= 0) || (clock.indexOf(b.id) >= 0 && trip.indexOf(a.id) >= 0);
        if (!cross && hit(box(a), box(b))) bad.push(a.id + ' / ' + b.id);
    })));
    ok(!bad.length, 'no two boxes of one page, row or bar overlap (each overlap would cost a layer)' + (bad.length ? ': ' + bad.join('; ') : ''));
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the layer plan (the engine\'s own planner, shared/hud.js _plan)');
{
    const fake = { _connOf: (w) => w.conn || 0 };
    const eng = W.map((w) => (w.type === 'text' && w.gpu ? Object.assign({}, w, { type: 'atext' }) : w));
    const plan = HudApp.prototype._plan.call(fake, eng, Math.floor(1920 * 720 / 4), L.packWaste);
    const per = {}; let px = 0;
    plan.forEach((e) => { per[e.conn || 0] = (per[e.conn || 0] || 0) + 1; if (e.kind === 'sheet') px += e.w * e.h * 8; });
    // a "gpu" text with an odd figure pitch is two layers (hud.js _gpuTexts)
    let extra = 0;
    if (FONTDIR) {
        const fakeEng = Object.create(HudApp.prototype); fakeEng.log = H.nolog;
        W.filter((w) => w.gpu).forEach((w) => { extra += Math.max(0, fakeEng._gpuGrid(w).groups.length - 1); });
    }
    const sheets = plan.filter((e) => e.kind === 'sheet');
    ok(Math.max.apply(null, Object.keys(per).map((k) => per[k])) + extra <= 8, 'layers per connection <= 8: ' + JSON.stringify(per) + (extra ? ' + ' + extra + ' for a two-layer GPU text' : ''));
    const mib = px / 1048576;
    ok(mib <= 3.5, 'the text sheets cost ' + mib.toFixed(2) + ' MiB of pixel memory (each image counted twice; the SPEC budgets 6 MiB for everything)');
    console.log('       sheets: ' + sheets.map((s) => 'conn ' + s.conn + ' z ' + s.z + ' ' + s.w + 'x' + s.h + ' [' + s.members.length + ']').join(', '));
    const centre = sheets.filter((s) => s.z === 6);
    ok(centre.length === 2, 'the centre pages are two sheets (the clock page with the title, the trip page): a page change repaints text boxes, nothing is rebuilt');
    ok(sheets.filter((s) => s.conn === 2).length === 2 && sheets.filter((s) => s.conn === 2).every((s) => s.z >= 8), 'connection 2: the bottom row\'s sheet and the plate\'s sheet, both "cc:" layers');
    const cc = W.filter((w) => w.conn === 2 && w.type === 'text');
    ok(cc.length > 0 && cc.every((w) => /cc:/.test(w.toggle || '')), 'every text on connection 2 is toggled by a "cc:" part, so it steps aside live (hud.js _ccLive)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('numeral clearance, SPEC 5.3 (from the atlases)');
if (!FONTDIR) skip('numeral clearance (no atlases in the tree)');
else {
    const textRaster = require(path.join(dir, 'hud_text.js'));
    const inkBox = (fontName, s) => {
        const f = atlas(fontName), w = Math.ceil(textRaster.measure(s, fontName)) + 8, h = f.cellHeight;
        const m = textRaster.mask(w, h, s, { font: fontName, x: 4 });
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x] > 127) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
    };
    const R = 300;
    const spd = (v) => (v <= 100 ? -125 + 25 * v / 20 : 25 * (v - 100) / 40);
    const polar = (a, r) => [r * Math.sin(a * Math.PI / 180), -r * Math.cos(a * Math.PI / 180)];
    const items = [];
    [0, 20, 40, 60, 80, 100, 140, 180, 220, 260, 300].forEach((v) => items.push({ s: String(v), f: 'td_scale_l', c: polar(spd(v), 0.76 * R) }));
    [10, 30, 50, 70, 160, 200, 240, 280].forEach((v) => items.push({ s: String(v), f: 'td_scale_s', c: polar(spd(v), 0.78 * R) }));
    items.forEach((it) => { const b = inkBox(it.f, it.s); it.box = [it.c[0] - b.w / 2, it.c[1] - b.h / 2, it.c[0] + b.w / 2, it.c[1] + b.h / 2]; });
    const gap = (a, b) => Math.max(b[0] - a[2], a[0] - b[2], b[1] - a[3], a[1] - b[1 + 2]);
    let least = 1e9, pair = '';
    items.forEach((a, i) => items.slice(i + 1).forEach((b) => { const g = Math.max(Math.max(b.box[0] - a.box[2], a.box[0] - b.box[2]), Math.max(b.box[1] - a.box[3], a.box[1] - b.box[3])); if (g < least) { least = g; pair = a.s + ' / ' + b.s; } }));
    ok(least >= 4, 'speedometer numerals (the set of SPEC 5.3, 90 and 120 dropped) keep >= 4 px of black to each other (least ' + least.toFixed(1) + ' px: ' + pair + ')');
    ok(!items.some((it) => ['90', '120'].indexOf(it.s) >= 0), '90 and 120 are not in the set');
    // numerals against the ticks' inner end (rho 0.896 R) and the tach's
    const radial = (box) => Math.max.apply(null, [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]].map((p) => Math.hypot(p[0], p[1])));
    const outer = Math.max.apply(null, items.map((it) => radial(it.box)));
    ok(outer + 4 <= 0.893 * R, 'every speedometer numeral stays 4 px inside the tick strip (outermost corner ' + outer.toFixed(1) + ' px, strip at ' + (0.893 * R).toFixed(1) + ')');
    const tach = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => { const c = polar(-125 + 31.25 * k, 0.745 * R), b = inkBox('td_tach', String(k)); return [c[0] - b.w / 2, c[1] - b.h / 2, c[0] + b.w / 2, c[1] + b.h / 2]; });
    ok(Math.max.apply(null, tach.map(radial)) + 4 <= 0.893 * R, 'every tachometer numeral stays 4 px inside the tick strip (outermost ' + Math.max.apply(null, tach.map(radial)).toFixed(1) + ' px)');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
process.exit(failed ? 1 : 0);
