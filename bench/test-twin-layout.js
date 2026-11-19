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
const ink = W.filter((w) => w.type === 'text' || w.type === 'icon' || w.type === 'atext' || w.type === 'tdpage');   // what draws glyphs and pictograms (round 3: the centre pages' one layer)
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
    // the three lamps of the belt group (docs/G20-DESIGN-SPEC.md 2, ZL's boxes) are see-through; BMW's own speed-limit sign
    // above the rear belts (ring ink box [497.5, 580.2, 579.4, 662.2], moat to y 663.7) is not: the car photo of 2026-11-19
    // showed its red ring through a hole that started at y 660
    const BELT_LAMPS = [[500.5, 677.75, 580.25, 715.25], [590.0, 664.5, 628.75, 715.25], [632.75, 664.25, 684.25, 715.5]];
    const BMW_SIGN = [497.5 - 1.5, 580.2 - 1.5, 579.4 + 1.5, 662.2 + 1.5];
    ok(BELT_LAMPS.every(covers), 'the rear belts, the driver belt and the airbag lamp each have a see-through hole in the background');
    ok(!bgs.some((b) => (b.holes || []).some((h) => hit(h, BMW_SIGN))), "no hole meets BMW's own speed-limit sign (its ring and moat " + JSON.stringify(BMW_SIGN) + ')');
    ok(bgs.every((b) => (b.holes || []).filter((h) => hit(h, BELT)).every((h) => h[0] >= BELT[0] && h[1] >= BELT[1] && h[2] <= BELT[2] && h[3] <= BELT[3])), 'the belt holes stay inside the belt group ' + JSON.stringify(BELT));
    ok(LAMPS.every(covers), 'every one of the seven side lamps (box + 3 px) has a see-through hole in the background');
    ok(bgs.every((b) => (b.holes || []).length <= 8 && (b.holes || []).every((h) => hit(h, box(b)))), 'at most 8 holes per layer, each inside its own part (ENGINE-CONTRACT 1.2)');
    ok(!parts.RB.holes.length && parts.RT.holes.length === 3 && parts.L.holes.length === 6, 'holes: L the belt group (two rects) + 4 left lamps, RT the 3 right lamps, RB none');
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
    // round 3 B4 (SPEC-R3 4): the title rule is 2.5 px at y 295-297.5, x 739-1181, code 205 (role "title")
    ok(L0.rules.length === 2 && L0.rules[0].y0 === 295 && L0.rules[0].y1 === 297.5 && L0.rules[0].x0 === 739 && L0.rules[0].x1 === 1181 && L0.rules[0].role === 'title' && L0.rules[1].y0 === 612.4 && L0.rules[1].x0 === 629 && L0.rules[1].x1 === 1292 && L0.rules[1].ours.y0 === 611 && L0.rules[1].ours.y1 === 615 && L0.rules[1].ours.role === 'severity', 'rules: the title rule 2.5 px at y 295-297.5 (SPEC-R3 4), the bottom rule y 613 (4 px in the severity colour while our plate shows) (SPEC 6.3, 8.1)');
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
const SAIRA = ['td_big', 'td_clock', 'td_label', 'td_prog', 'td_dist', 'td_cru', 'td_sign', 'td_sign3', 'td_tach', 'td_scale_l', 'td_scale_s'];
{
    const T = (id) => byId[id];
    // [id, baseline, x of the text's anchor (centre / left / right edge by its align), font, role]
    const spec = [
        ['speed', 441, 1540, 'td_big', 'fg'], ['gear', 432, 380, 'td_big', 'fg'], ['ready', 321, 380, 'td_label', 'ready'], ['program', 471, 380, 'td_prog', 'fg'],
        ['tab_range_u', 156, null, 'td_u19', 'fg'], ['tab_range_v', 156, null, W.find((w) => w.id === 'tab_range_v').font === 'td_tabs' ? 'td_tabs' : 'td_tab', 'fg'],
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
    // FIN: the media widget reaches into the cell that grows when tab 2 is hidden (780-1168): from the warning icon's box to 1158
    ok(T('tab_media') && T('tab_media').tdLive === 'media' && T('tab_media').x === 837 && T('tab_media').w === 321 && T('tab_media').h === 46 && T('tab_media').y === 124, 'tab 3: one live widget [837, 124, 1158, 170] painting the source icon and its text as a centred group (FIN: in the cell it has now)');
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
    const clock = [], trip = [];
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
    const centre = plan.filter((e) => e.kind === 'layer' && e.w.type === 'tdpage');
    ok(centre.length === 1 && sheets.filter((s) => s.z === 6).length === 0, 'the centre pages are ONE own image layer (tdpage), no sheet: a page change repaints it, nothing is rebuilt (round 3 B4)');
    ok(centre.length === 1 && centre[0].conn === 1, 'the centre layer is on connection 1');
    // B3 (SPEC-R3 5.1, 5.5): the bottom plate is gone; tab 2's ONE sheet is the only "cc:" sheet on connection 2, the bottom row's sheet is on
    // connection 0 with the window; B5's sign sheet (and the cruise readout's, built only with config.cruise) share connection 2 and are not "cc:" (integration)
    // front-vehicle FV: the pictogram's sheet (tdfv, built only while the test is on) is not "cc:" either
    const ccSheets = sheets.filter((s) => s.conn === 2 && !s.members.every((m) => m.type === 'tdsign' || m.type === 'tdcru' || m.type === 'tdfv'));
    ok(ccSheets.length === 1 && ccSheets.every((s) => s.z === 9 && s.members.length === 1 && s.members[0].type === 'ccsheet' &&
        s.x === 729 && s.y === 298 && s.w === 462 && s.h === 270), 'connection 2: tab 2\'s sheet [729, 298, 462 x 270], a "ccsheet", the only "cc:" sheet there (the old bottom plate is gone)');
    ok(!W.some((w) => w.type === 'ccplate'), 'no "ccplate" widget in the layout (the code path is gone)');
    const rowTexts = W.filter((w) => w.type === 'text' && /^row_/.test(w.id));
    ok(rowTexts.length === 7 && rowTexts.every((w) => !w.conn && w.toggle === 'cc:row'), 'the bottom row\'s seven texts are on connection 0 (the window\'s) and toggled by "cc:row", so they step aside live (hud.js _ccLive)');
    ok(sheets.filter((s) => s.conn === 0 && s.z === 8).length === 1 && (per[0] || 0) <= 8 && (per[1] || 0) <= 8 && (per[2] || 0) <= 8, 'layers per connection: ' + (per[0] || 0) + ' / ' + (per[1] || 0) + ' / ' + (per[2] || 0) + ' (connection 0 gains the bottom row\'s sheet; at most 8 each)');
    const ccTexts = W.filter((w) => w.type === 'text' && /cc:/.test(w.toggle || ''));
    ok(ccTexts.length > 0 && ccTexts.every((w) => !w.conn), 'every "cc:" text is on connection 0, one socket with the window (an order for "row aside" before "window open")');
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

// ---------------------------------------------------------------------------------------------------------------------
console.log('the tachometer\'s hub (SPEC-R3 2.7): gear (0, 0) R, programme (0, +0.209) R, READY (0, -0.29) R');
if (!FONTDIR) skip('the hub (no atlases in the tree)');
else {
    const textRaster = require(path.join(dir, 'hud_text.js'));
    const C = VG.dials.tacho.centre, Rr = VG.R_px;
    const inkOf = (font, s) => {       // the ink box of a text drawn on its baseline 0 at x 0 (centred): [x0, y0, x1, y1] relative to baseline and centre
        const f = atlas(font), wd = Math.ceil(textRaster.measure(s, font)) + 8, m = textRaster.mask(wd, f.cellHeight, s, { font, x: 4 });
        let x0 = wd, y0 = f.cellHeight, x1 = -1, y1 = -1;
        for (let y = 0; y < f.cellHeight; y++) for (let x = 0; x < wd; x++) if (m[y * wd + x] > 127) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const w0 = textRaster.measure(s, font);
        return [x0 - 4 - w0 / 2, y0 - f.baseline, x1 + 1 - 4 - w0 / 2, y1 + 1 - f.baseline];
    };
    const gear = byId.gear, prog = byId.program, rdy = byId.ready;
    const centreOf = (w, s) => { const b = inkOf(w.font, s), base = w.y + atlas(w.font).baseline; return [(C[0] + (w.x + w.w / 2 - C[0]) + (b[0] + b[2]) / 2 - C[0]) , (base + (b[1] + b[3]) / 2 - C[1])]; };
    // SPEC-R3 2.7: the centres of the gear (0, 0) R, the programme (0, +0.209) R, READY (0, -0.29) R, from the atlases' own ink
    const gc = centreOf(gear, 'D3'), pc = centreOf(prog, 'COMFORT'), rc = centreOf(rdy, 'READY');
    ok(Math.abs(gc[1]) <= 1.5 && Math.abs(gc[0]) <= 1.5, 'the gear\'s ink is centred on the dial centre (offset ' + gc.map((v) => v.toFixed(1)).join(', ') + ' px)');
    ok(Math.abs(pc[1] - 0.209 * Rr) <= 1.5 && Math.abs(pc[0]) <= 1.5, 'the drive programme is centred at (0, +0.209) R (y ' + pc[1].toFixed(1) + ' of ' + (0.209 * Rr).toFixed(1) + ')');
    ok(Math.abs(rc[1] + 0.29 * Rr) <= 1.5 && Math.abs(rc[0]) <= 1.5, 'READY is centred at (0, -0.29) R (y ' + rc[1].toFixed(1) + ' of ' + (-0.29 * Rr).toFixed(1) + ')');
    const cap = inkOf('td_big', 'D')[3] - inkOf('td_big', 'D')[1], capSpeed = inkOf('td_big', '8')[3] - inkOf('td_big', '8')[1];
    ok(Math.abs(cap - 0.222 * Rr) <= 4 && Math.abs(cap - capSpeed) <= 2, 'the gear\'s cap height is ' + cap + ' px (0.222 R = ' + (0.222 * Rr).toFixed(1) + '), the digital speed\'s: ' + capSpeed);
    ok(gear.gpu === true && gear.maxLen === 2 && gear.w >= 164 && gear.font === 'td_big', 'the gear is a GPU text of td_big in a box >= 164 px (two figure pitches of 82)');
    // every gear string: glyphs in td_big, the ink inside the box
    const strs = ['P', 'R', 'N', 'D', '–'].concat([1, 2, 3, 4, 5, 6, 7, 8].map((n) => 'D' + n), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => 'M' + n), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => 'S' + n));
    const miss = [], wide = [];
    strs.forEach((t) => { Array.from(t).forEach((c) => { if (glyphsOf('td_big').indexOf(c) < 0) miss.push(t + ':' + c); }); const b = inkOf('td_big', t); if (b[2] - b[0] > gear.w + 4) wide.push(t + ' ' + (b[2] - b[0])); });
    ok(!miss.length, 'every gear string is in td_big (D M N P R S, the figures, the dash)' + (miss.length ? ': ' + miss.join(', ') : ''));
    ok(!wide.length, 'every gear string\'s ink fits the 164 px layer (the GPU text is four 41 px cells) to within 2 px a side (M4 is 166 px: the outer stems of the M may lose their last pixel; M8 is 164)' + (wide.length ? ': ' + wide.join(', ') : ''));
    // the programme's worst text and READY inside their boxes; no Cyrillic in any of the three (Saira)
    const progs = ['COMFORT', 'SPORT', 'SPORT+', 'ECO PRO', 'ADAPTIVE'];
    ok(progs.every((t) => Array.from(t).every((c) => glyphsOf('td_prog').indexOf(c) >= 0) && textRaster.measure(t, 'td_prog') <= prog.w), 'every drive programme fits td_prog and its ' + prog.w + ' px box (the widest ' + Math.max.apply(null, progs.map((t) => textRaster.measure(t, 'td_prog'))) + ' px)');
    ok(textRaster.measure('READY', 'td_label') <= rdy.w, 'READY fits its ' + rdy.w + ' px box');
    ok([gear, prog, rdy].every((w) => SAIRA.indexOf(w.font) >= 0 && !/[Ѐ-ӿ]/.test(w.text)), 'the three hub widgets are Saira widgets whose templates carry no Cyrillic letter');
    // the clearance to the inner ring: its outer edge 0.544 R + 0.004 R; every corner of each box (and of the ink) stays >= 4 px inside it
    const ring = 0.548 * Rr;
    [gear, prog, rdy].forEach((w) => {
        const cs = [[w.x, w.y], [w.x + w.w, w.y], [w.x, w.y + w.h], [w.x + w.w, w.y + w.h]].map((p) => Math.hypot(p[0] - C[0], p[1] - C[1]));
        ok(Math.max.apply(null, cs) + 4 <= ring, w.id + ': every corner of its box is >= 4 px inside the inner ring (farthest ' + Math.max.apply(null, cs).toFixed(1) + ' of ' + ring.toFixed(1) + ')');
    });
    // vertical room between the three: ink gaps
    const ink = (w, s) => { const b = inkOf(w.font, s), base = w.y + atlas(w.font).baseline; return [base + b[1], base + b[3]]; };
    const gi = ink(gear, 'D3'), pi = ink(prog, 'COMFORT'), ri = ink(rdy, 'READY');
    ok(gi[0] - ri[1] >= 20 && pi[0] - gi[1] >= 12, 'READY, the gear and the programme keep clear of each other (gaps ' + (gi[0] - ri[1]).toFixed(0) + ' and ' + (pi[0] - gi[1]).toFixed(0) + ' px)');
    ok(![gear, prog, rdy].some((w) => hit(box(w), BELT) || hit(box(w), GAP) || LAMPS.some((l) => hit(box(w), l))), 'the hub widgets keep clear of the belt group, the gear-letter gap and the lamps');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('the centre pages (round 3 B4, SPEC-R3 4): one layer, every page, every text inside its box');
{
    const S = require('./twin-centre-states');
    const R = S.rig();
    const P = byId.c_page;
    ok(P && P.type === 'tdpage' && P.own === true && P.conn === 1 && P.z === 6 && JSON.stringify(box(P)) === '[729,248,1191,595]', 'c_page: a tdpage, its own layer, connection 1, z 6, rect [729, 248, 1191, 595]');
    ok(!hit(box(P), BELT) && !hit(box(P), GAP) && !LAMPS.some((l) => hit(box(P), l)) && !hit(box(P), STRIP) && !hit(box(P), MARKER) && !hit(box(P), [1406, 342, 1597, 419]) && !hit(box(P), [1420, 320, 1611, 440]),
        'the page layer keeps clear of the belt group, the gear gap, the lamps, the lamp strip, the stored-message marker and the black box');
    ok(P.y >= 173 && P.y + P.h <= 595.75, 'the page layer is under the tab bar (y 173) and ends above BMW\'s panel (y 595.75): nothing of it can sit on the message panel');
    ok(!bgs.some((b) => (b.holes || []).some((h) => hit(h, box(P)))), 'no see-through hole of the backdrop lies under the page layer (the map window is a uniform, not a hole)');
    const need = ['clock', 'trip', 'tech', 'tyres', 'msg', 'media', 'radio', 'track', 'phone', 'call', 'map', 'guide', 'calc', 'road', 'none'];
    ok(need.every((k) => P.pages[k] && Array.isArray(P.pages[k].items) && P.pages[k].items.length), 'every page of the spec has its items: ' + need.join(' '));
    // the grammar: title baseline 281, meta line baseline 326 right edge 1190, footer baseline 565
    const items = (page, id) => P.pages[page].items.filter((i) => i.id === id)[0];
    const titled = need.filter((k) => k !== 'map');
    ok(titled.every((k) => { const t = items(k, 'title'); return t && t.b === 281 && t.x === 960 && t.al === 'c' && t.f === 'title' && t.s === '{{td:pgTitle}}'; }), 'every page but the map has the title at baseline 281, centred, Noto 41');
    ok(['trip', 'radio', 'track', 'call'].every((k) => { const m = items(k, 'meta'); return m && m.b === 326 && m.x === 1190 && m.al === 'r'; }), 'the meta line: baseline 326, right edge 1190');
    ok(['trip', 'radio'].every((k) => items(k, 'foot').b === 565), 'the footer: baseline 565');
    // SPEC-R3 4.1: the clock, the trip table, the technical rows
    ok(items('clock', 'time').b === 404 && items('clock', 'weekday').b === 460 && items('clock', 'date').b === 519 && items('clock', 'time').f === 'clock', 'clock page: the time Saira 92 at baseline 404, weekday 460, date 519');
    ok(items('trip', 'cons').x === 896 && items('trip', 'speed').x === 1109 && items('trip', 'way').x === 896 && items('trip', 'cons').b === 384 && items('trip', 'way').b === 455 && items('trip', 'i1').sz === 46, 'trip page: number columns right at 896 / 1109, rows at 384 / 455, the pictogram at x 729');
    const techB = [352, 418, 484, 550];
    ok([0, 1, 2, 3].every((i) => items('tech', 'l' + i).b === techB[i] && items('tech', 'l' + i).x === 745 && items('tech', 'v' + i).x === 1150 && items('tech', 'u' + i).x === (i === 2 ? 1152 : 1156) && (i === 3 ? !items('tech', 'b3') : (items('tech', 'b' + i).y === techB[i] + 12 && items('tech', 'b' + i).x0 === 745 && items('tech', 'b' + i).x1 === 1175 && items('tech', 'b' + i).h === 6))),
        'technical data: labels at x 745, values right at 1150, units 6 px after ("бар" 2 px: the layer ends at 1191), baselines 352 / 418 / 484 / 550, bars x 745-1175 12 px under the baseline, 6 px thick, none under the outside temperature');
    ok(P.pages.tech.items.filter((i) => i.k === 't' && /^l\d$/.test(i.id)).map((i) => i.s).join() === 'Олива,Охолодження,Наддув,Зовні', 'technical data: the labels Олива / Охолодження / Наддув / Зовні');
    // SPEC-R3 4.3 / 4.4 / 4.5
    ok(items('media', 'src').sz === 66 && items('media', 'src').cx === 960 && items('media', 'src').cy === 392, 'the certain media page: the source pictogram 66 px at (960, 392), nothing else but the title');
    ok(items('radio', 'ic').sz === 54 && items('radio', 'ic').cy === 344 && items('radio', 'station').b === 424 && items('radio', 'text').b === 471, 'radio page: pictogram 54 px at y 344, station at 424, radio text at 471');
    ok(items('track', 'name').b === 400 && items('track', 'artist').b === 444 && items('track', 'prog').x0 === 800 && items('track', 'prog').x1 === 1120 && items('track', 'prog').y === 500, 'now playing: title 400, artist 444, the progress line x 800-1120 at y 500');
    ok(items('phone', 'ic').sz === 54 && items('phone', 'ic').cy === 344 && items('phone', 'l1').b === 424 && items('phone', 'l2').b === 471, 'idle phone page: pictogram 54 px at y 344, lines at 424 / 471');
    ok(items('call', 'ring').sz === 66 && items('call', 'ring').cy === 372 && items('call', 'timer').b === 410 && items('call', 'timer').f === 's72' && items('call', 'who').b === 478, 'call card: the handset 66 px at (960, 372), the timer Saira 72 at 410, who at 478');
    ok(items('guide', 'arrow').sz === 120 && items('guide', 'arrow').cx === 830 && items('guide', 'arrow').cy === 378 && items('guide', 'dist').x === 915 && items('guide', 'dist').b === 410 && items('guide', 'road').b === 480 && items('guide', 'lanes').pitch === 34 && items('guide', 'lanes').sz === 30 && items('guide', 'foot').b === 560,
        'guidance page: arrow 120 px at [770, 318, 890, 438], distance at x 915 baseline 410, road 480, lanes 34 px pitch / 30 px arrows, footer 560');
    ok(items('calc', 'msg').b === 400 && items('road', 'road').b === 400 && items('road', 'sub').b === 452, 'fallback pages: calculating at 400, the road at 400 with the grey line at 452');
    ok(!P.pages.map.items.some((i) => i.id === 'title') && P.pages.map.items.every((i) => i.y1 === undefined || i.y1 <= 595), 'the map page has no title and only a road bar at the window\'s foot');
    // renders: every state, no data and with data: ink inside the layer, inside the window's sides, bodies inside y 300-568
    const SAIRA_KEYS = R.pages.SAIRA, cyr2 = /[Ѐ-ӿ]/;
    const bad = [], badSaira = [], unresolved = [], missing = [];
    Object.keys(S.STATES).forEach((id) => {
        const h = S.make(R, id), r = S.render(R, h);
        const spec = P.pages[r.page];
        if (r.page !== S.STATES[id].page) bad.push(id + ' shows ' + r.page + ', wanted ' + S.STATES[id].page);
        r.ink.forEach((i) => {
            const b = i.box, isTitle = i.id === 'title', isBar = r.page === 'map';
            if (b[0] < 729 || b[2] > 1191) bad.push(id + '/' + i.id + ' x ' + b[0] + '..' + b[2] + ' leaves the window\'s sides');
            if (b[1] < 248 || b[3] > (isBar ? 595 : 575)) bad.push(id + '/' + i.id + ' y ' + b[1] + '..' + b[3]);
            if (!isTitle && !isBar && b[1] < 300 && !/^meta/.test(i.id) && i.id !== 'cons_u.t' && i.id !== 'time') bad.push(id + '/' + i.id + ' above the body (y ' + b[1] + ')');
            if (isTitle && (b[1] < 248 || b[3] > 296)) bad.push(id + '/title y ' + b[1] + '..' + b[3] + ' (the rule is at 295)');
        });
        // every answer: no token left over, no Cyrillic in a Saira item, every character in its font
        const res = R.pages.resolveItems(h, spec.items);
        res.forEach((q) => {
            const it = q.it, strs = [q.s].concat((q.parts || []).map((x) => x.s)).filter((x) => typeof x === 'string');
            const fonts = it.k === 't' ? [it.f] : (it.parts || []).map((x) => x.f);
            strs.forEach((t, k) => {
                if (/\{\{/.test(t)) unresolved.push(id + '/' + it.id + ' ' + t);
                const f = it.k === 't' ? it.f : (it.parts || [])[k] && it.parts[k].f;
                if (!f) return;
                if (SAIRA_KEYS.indexOf(f) >= 0 && cyr2.test(t)) badSaira.push(id + '/' + it.id + ' ' + JSON.stringify(t));
                const name = R.pages.fontName(f);
                if (!name) { missing.push(id + '/' + it.id + ' font role ' + f + ' has no atlas'); return; }
                const g = JSON.parse(fs.readFileSync(path.join(FONTDIR, name + '.json'), 'utf8')).glyphs;
                Array.from(t).forEach((c) => { if (!g[c]) missing.push(id + '/' + it.id + ' needs ' + JSON.stringify(c) + ' in ' + name); });
            });
        });
    });
    ok(!bad.length, 'every state renders on its page, every ink box inside the layer and the window\'s sides, titles above the rule, bodies in y 300-575 (' + Object.keys(S.STATES).length + ' states)' + (bad.length ? ': ' + bad.slice(0, 6).join('; ') : ''));
    ok(!unresolved.length, 'no token is left unanswered in any state' + (unresolved.length ? ': ' + unresolved.slice(0, 4).join('; ') : ''));
    ok(!badSaira.length, 'no Cyrillic ever reaches a Saira item of a page (the clock, the call timer, the guidance distance)' + (badSaira.length ? ': ' + badSaira.join('; ') : ''));
    ok(!missing.length, 'every character a page can draw is in its font (the atlases in the tree; a role without its own atlas uses its stand-in)' + (missing.length ? ': ' + Array.from(new Set(missing)).slice(0, 6).join('; ') : ''));
    // the furniture rules: nothing of the page below y 657 (it ends at 595) and nothing in x 494..691 / 1377..1463
    ok(P.x >= 729 && P.x + P.w <= 1191, 'the page layer lies between the dials\' bezels (x 729..1191; the bezel\'s inner edge at y 400 is 684 / 1236)');
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('car-issues MW: the map window W3 (the whole free space between the dials) against the layout');
{
    const M = HudApp.TW_MAP || {}, W3 = M.W3, W2 = M.W2;
    ok(!!(W3 && W3.arc && W2 && !W2.arc && !(M.W1 || {}).arc), 'W3 exists with arcs; W1 and W2 have none (they are as before)');
    if (W3 && W3.arc) {
        const [b0, b1, b2, b3] = W3.box, [lx, rx, cy, rr] = W3.arc;
        const T = byId.dial_tach, S = byId.dial_speed;
        ok(T.centre[0] === lx && S.centre[0] === rx && T.centre[1] === cy && S.centre[1] === cy, 'its arcs are round the dials\' own centres (' + T.centre + ' / ' + S.centre + ')');
        // tdial draws alpha 1 inside 1.0128 R and fades to 0 at 1.0128 R + 0.5 (shaders.js TDIAL): the black ring between is the backdrop's
        const edge = 1.0128 * Math.max(T.R, S.R) + 0.5;
        ok(rr - edge >= 5 && rr - edge <= 24, 'a black ring of ' + (rr - edge).toFixed(1) + ' px between the bezel\'s outer edge (' + edge.toFixed(1) + ' px) and the window (' + rr + ' px): 5..24');
        ok(Math.abs(lx + rr - W2.box[0]) <= 6 && Math.abs(rx - rr - W2.box[2]) <= 6, 'at mid-height (y 400) its sides are within 6 px of W2\'s (' + (lx + rr) + ' / ' + (rx - rr) + ' against ' + W2.box[0] + ' / ' + W2.box[2] + ')');
        const tab = byId.bg_l.tab;
        ok(b0 === tab.rect[0] && b2 === tab.rect[2] && b1 === tab.rule[1], 'the box\'s sides end where the tab bar ends (' + b0 + ' / ' + b2 + ') and its top is the tab rule\'s foot (y ' + b1 + ')');
        const rule = byId.bg_l.rules.filter((r) => r.role === 'rule')[0];
        ok(b3 <= MARKER[1] && b3 < rule.y0 && b3 < 611, 'its foot (y ' + b3 + ') is above BMW\'s stored-message marker (from y ' + MARKER[1] + ') and the bottom row\'s rule (y ' + rule.y0 + ', ' + (rule.ours || {}).y0 + ' with our message)');
        // the see-through region, pixel by pixel (centres): in the box, outside both discs
        const open = (x, y) => x >= b0 && x < b2 && y >= b1 && y < b3 && Math.hypot(x - lx, y - cy) > rr && Math.hypot(x - rx, y - cy) > rr;
        const inR = (x, y, r) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
        const meets = (r) => { for (let y = Math.max(r[1], b1); y < Math.min(r[3], b3); y++) for (let x = Math.max(r[0], b0); x < Math.min(r[2], b2); x++) if (open(x + 0.5, y + 0.5)) return true; return false; };
        ok(!meets(BELT) && !meets(GAP) && !LAMPS.some((l) => meets(l)) && !meets(STRIP) && !meets(MARKER), 'the hole never meets BMW\'s belt group, the gear gap, the seven side lamps, the lamp strip or the stored-message marker');
        // BMW's stock layout is drawn under a theme (photo 14): at mid-height its items come nearest the gap, measured on the rectified
        // stock photos 08 / 09 / 39 / 61 / 68 (+-1 px): the rule under its digital speed ends at x 694 (y 412-415); its drive-mode label and
        // the rule under it start at x 1223 (y 337-415). W2 keeps them out; so must W3
        const STOCK_L = [600, 405, 695, 420], STOCK_R = [1223, 335, 1400, 420];
        ok(!meets(STOCK_L) && !meets(STOCK_R), 'the hole never meets BMW\'s stock mid-height items (the speed rule\'s end ' + JSON.stringify(STOCK_L) + ', the drive-mode label and rule ' + JSON.stringify(STOCK_R) + ')');
        const mw2 = (r) => { for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) if (x + 0.5 >= W2.box[0] && x + 0.5 < W2.box[2] && y + 0.5 >= W2.box[1] && y + 0.5 < W2.box[3]) return true; return false; };
        ok(!mw2(STOCK_L) && !mw2(STOCK_R), '... (W2 does not either: the same keep-outs hold for the window the car has shown)');
        ok(!meets(tab.rect.slice(0, 3).concat([173])) && !meets([0, 612, 1920, 720]), 'the tab bar and its rule (y < 173) and the bottom row (y >= 612) stay opaque');
        const panel = [696, 595.75, 1226, 704];
        ok(!meets(panel.map(Math.floor)), 'it never reaches BMW\'s message panel ' + JSON.stringify(panel) + ' (W2 does, by its rows y 595..599)');
        // which of our layers lie where W3 opens and W2 did not: they must be see-through there (the dials outside their disc), or
        // a sheet with nothing of its members there; nothing of ours sits over the new part of the map
        const fake = { _connOf: (w) => w.conn || 0 };
        const eng = W.map((w) => (w.type === 'text' && w.gpu ? Object.assign({}, w, { type: 'atext' }) : w));
        const plan = HudApp.prototype._plan.call(fake, eng, Math.floor(1920 * 720 / 4), L.packWaste);
        const w2 = W2.box, extra = (x, y) => open(x, y) && !(x >= w2[0] && x < w2[2] && y >= w2[1] && y < w2[3]);
        const meetsExtra = (r) => { for (let y = Math.max(Math.floor(r[1]), b1); y < Math.min(Math.ceil(r[3]), b3); y++) for (let x = Math.max(Math.floor(r[0]), b0); x < Math.min(Math.ceil(r[2]), b2); x++) if (extra(x + 0.5, y + 0.5)) return true; return false; };
        const over = [], why = [];
        plan.forEach((e) => {
            const r = e.kind === 'sheet' ? [e.x, e.y, e.x + e.w, e.y + e.h] : box(e.w);
            if (!meetsExtra(r)) return;
            if (e.kind === 'layer' && e.w.type === 'tdback') { why.push(e.w.id + ' (the backdrop: the window is its hole)'); return; }
            if (e.kind === 'layer' && e.w.type === 'tdial' && 1.0128 * e.w.R + 0.5 < rr) { why.push(e.w.id + ' (alpha 0 outside ' + (1.0128 * e.w.R + 0.5).toFixed(1) + ' px)'); return; }
            if (e.kind === 'sheet' && !e.members.some((m) => meetsExtra(box(m)))) { why.push('a sheet, none of its members there'); return; }
            over.push((e.kind === 'sheet' ? 'sheet ' + e.members.map((m) => m.id).join('+') : e.w.id) + ' ' + JSON.stringify(r));
        });
        ok(!over.length, 'nothing of ours draws where W3 opens beyond W2 (' + why.join('; ') + ')' + (over.length ? ': ' + over.join('; ') : ''));
        const roadBar = (byId.c_page.pages.map.items || []).filter((i) => i.y1 !== undefined);
        ok(roadBar.length > 0 && roadBar.every((i) => !meetsExtra([i.x0 !== undefined ? i.x0 : 729, i.y0 !== undefined ? i.y0 : 248, i.x1 !== undefined ? i.x1 : 1191, i.y1])), 'the road bar stays where it is (inside W2: W3 leaves it as it is)');
    }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
process.exit(failed ? 1 : 0);
