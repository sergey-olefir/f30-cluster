'use strict';
/**
 * test-twin-cc.js - Twin Dial's check-control messages (package D of round 2; docs/twin-dial/R2-D-REPORT.md).
 *
 *   node bench/test-twin-cc.js
 *
 * Part 1, without the engine: shared/twin_cc.js on its own - the symbol table equals VT's, the headline wraps to two lines
 * with "...", severity, the plate's raster (opaque, one paint, covers BMW's panel and nothing it must not), and the
 * state machine (VG report 5.4's cases, the D7 latch, both witnesses, the latches) with an injected clock.
 *
 * Part 2, the real engine (shared/hud.js, built by the kit as the Store builds it) in this process, against a stand-in
 * cluster-render that models the service's rules (layer caps, pixel memory, refusals): the engine's own clients keep every
 * layer, uniform and pixel they sent, and after EVERY turn of the event loop in which anything was sent (a frame: all
 * the engine's messages of one turn are applied together by the service) the audit looks at BMW's panel:
 *     while the car says a message shows (or may show), BMW's panel is covered by us ONLY IF the plate on the screen is
 *     our plate for exactly that message (pixel for pixel), and the bottom row's ink never sits in the panel then.
 * That is VG 5.4 cases 1-9 on the stand-in layouts (a plain black backdrop with the fallback hole, the bottom row, the plate;
 * tdback and C's layout are B's and C's: once they land, test-twin-layout.js and the lead's merge run this on them), and
 * three mutants prove the audit is not vacuous: break the engine in three ways and it must fail.
 *
 * Mac only, Node 18 or newer. Never shipped. It builds into dist/ and uses apps/twin_cc_test/ for the time it runs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const F30 = path.join(ROOT, 'apps', 'f30_cluster');
const APP_ID = 'twin_cc_test';
const APP_DIR = path.join(ROOT, 'apps', APP_ID), STAGE = path.join(ROOT, 'dist', APP_ID);

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fonts for the plate outside the engine: hud_data wants the kit's pack; read the f30 fonts as plain files --------------
const realLoad = Module._load;
Module._load = function (req) {
    if (req === './kit/pack' && !global.__twinCcEngine) {
        return { open: () => ({ json: (rel) => { try { return JSON.parse(fs.readFileSync(path.join(F30, 'hud', rel), 'utf8')); } catch (e) { return {}; } } }) };
    }
    return realLoad.apply(this, arguments);
};
const T = require(path.join(ROOT, 'shared', 'twin_cc.js'));
const textRaster = require(path.join(ROOT, 'shared', 'hud_text.js'));
const icons = require(path.join(ROOT, 'shared', 'icons.js'));
const deps = { textRaster, paintIcon: icons.paintIcon, icons: icons.ICONS };
const FONT = 'wb_msg';          // the stand-in for Noto 42 / 29 (Cyrillic, the car's punctuation); A1's atlases come with the app

// =====================================================================================================================
// Part 1: the module on its own
// =====================================================================================================================
function unitChecks() {
    console.log('the module, without the engine');
    // symbols
    const sym = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'vt', 'message_symbols.json'), 'utf8'));
    const want = {};
    Object.keys(sym.by_cc_id).forEach((k) => { want[k] = sym.by_cc_id[k]; });
    const have = {};
    Object.keys(T.SYMBOL_BY_ID).forEach((k) => { have[k] = T.SYMBOL_BY_ID[k]; });
    ok(JSON.stringify(Object.keys(want).sort()) === JSON.stringify(Object.keys(have).sort()) && Object.keys(want).every((k) => want[k] === have[k]),
        'the symbol table is VT\'s message_symbols.json by_cc_id, entry for entry (' + Object.keys(have).length + ' ids)');
    ok(T.symbolFor(15, 'white') === 'cc_door' && T.symbolFor(9999, 'red') === 'cc_warn' && T.symbolFor(9999, 'orange') === 'cc_warn' && T.symbolFor(9999, 'yellow') === 'cc_warn' &&
        T.symbolFor(9999, 'white') === 'cc_info' && T.symbolFor(9999, 'green') === 'cc_info' && T.symbolFor(9999, 'default') === 'cc_info' && T.symbolFor(null, null) === 'cc_warn',
        'an unmapped id gets the generic marker by colour (red / yellow / orange the triangle, white / green / default the "i", unknown colour the triangle)');
    ok(Object.keys(sym.generic_rule).every((k) => k === '_why' || k === 'unknown_colour' || T.GENERIC[k.toLowerCase()] === sym.generic_rule[k]),
        'the generic rule is VT\'s generic_rule');
    ok(T.severityOf('red') === 4 && T.severityOf('yellow') === 3 && T.severityOf('orange') === 3 && T.severityOf('green') === 2 &&
        T.severityOf('white') === 1 && T.severityOf('default') === 1 && T.severityOf(null) === 1 && T.severityOf('pink') === 1,
        'severity: red 4, yellow and orange amber 3, green 2, white / default / unknown grey 1 (SPEC 8.2)');
    ok(T.SEVERITY[4].cell.join() === '176,7,30' && T.SEVERITY[3].cell.join() === '240,170,10' && T.SEVERITY[2].cell.join() === '59,155,26' &&
        T.SEVERITY[1].rule.join() === '231,231,231' && T.SEVERITY[3].symbol.join() === '0,0,0',
        'the severity colours are SPEC 7.1 / 8.2 in B\'s black-floor-corrected codes (red 176 7 30, amber 240 170 10 with a black symbol, green 59 155 26, grey rule 231)');

    // the headline
    const measure = (s) => textRaster.measure(s, FONT, 0);
    const w1 = T.wrapHeadline('Driver door open', measure, 441, 441, '…');
    ok(w1.lines.length === 1 && !w1.cut && w1.lines[0] === 'Driver door open', 'a short headline is one line');
    const long2 = 'Tyre pressure low, check all four tyres soon please';
    const w2 = T.wrapHeadline(long2, measure, 441, 441, '…');
    ok(w2.lines.length === 2 && !w2.cut && w2.lines.every((l) => measure(l) <= 441) && w2.lines.join(' ') === long2, 'a longer one wraps at a space to two lines inside 441 px, losing no word');
    const huge = 'Front passenger restraint system malfunction: the belt tensioner and the airbag may not work in an accident, have it checked';
    const w3 = T.wrapHeadline(huge, measure, 441, 441, '…');
    ok(w3.lines.length === 2 && w3.cut && /…$/.test(w3.lines[1]) && w3.lines.every((l) => measure(l) <= 441), 'too much text: two lines, the second ends in "…" and fits 441 px');
    const w4 = T.wrapHeadline(huge, measure, 441, 399, '…');
    ok(w4.lines.length === 2 && measure(w4.lines[1]) <= 399, 'with a counter, line 2 stops at x 1182 (399 px from the text start)');
    const w5 = T.wrapHeadline('A' + 'W'.repeat(60), measure, 441, 441, '…');
    ok(w5.lines.length === 2 && w5.lines.every((l) => measure(l) <= 441), 'a single word wider than the line is broken between letters');
    ok(T.wrapHeadline('   ', measure, 441, 441).lines[0] === '', 'blank text is an empty line');

    // the plate raster
    const msg = { id: 15, name: 'Driver door open', color: 'white', counter: '' };
    const P = T.paintPlate(deps, msg, { font: FONT, counterFont: FONT });
    const W = T.PLATE.w, H = T.PLATE.h;
    let opaque = true;
    for (let i = 3; i < P.buf.length; i += 4) if (P.buf[i] !== 255) { opaque = false; break; }
    ok(P.buf.length === W * H * 4 && opaque, 'the plate is opaque black everywhere ' + W + ' x ' + H + ' (it covers BMW\'s panel whole)');
    const poly = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json'), 'utf8')).fallback_window.polygon_px;
    const inPlate = poly.every((p) => p[0] >= T.PLATE.x + 1.5 && p[0] <= T.PLATE.x + W - 1.5 && p[1] >= T.PLATE.y + 1.5 && p[1] <= T.PLATE.y + H - 1.5);
    ok(inPlate, 'the fallback window\'s polygon (' + poly.length + ' points) lies inside the plate with at least 1.5 px to spare');
    const belt = [497, 660, 688, 720], gap = [1380, 660, 1460, 720];
    const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const rect = [T.PLATE.x, T.PLATE.y, T.PLATE.x + W, T.PLATE.y + H];
    ok(!hit(rect, belt) && !hit(rect, gap) && rect[0] >= 694 && rect[2] <= 1230, 'the plate rectangle ' + JSON.stringify(rect) + ' touches neither BMW\'s belt group nor the gear-letter gap');
    const px = (x, y) => { const o = ((y - T.PLATE.y) * W + (x - T.PLATE.x)) * 4; return [P.buf[o], P.buf[o + 1], P.buf[o + 2]]; };
    ok(px(900, 612).join() === '231,231,231' && px(900, 614).join() === '231,231,231' && px(900, 610).join() === '0,0,0' && px(900, 615).join() === '0,0,0',
        'the rule is 4 px (y 611-614) in the severity colour (grey 231 for a white message), black above and below');
    const red = T.paintPlate(deps, { id: 50, name: 'Brake', color: 'red' }, { font: FONT });
    const amber = T.paintPlate(deps, { id: 50, name: 'Brake', color: 'orange' }, { font: FONT });
    const green = T.paintPlate(deps, { id: 50, name: 'Brake', color: 'green' }, { font: FONT });
    const at = (r, x, y) => { const o = ((y - T.PLATE.y) * W + (x - T.PLATE.x)) * 4; return [r.buf[o], r.buf[o + 1], r.buf[o + 2]].join(); };
    ok(at(red, 900, 612) === '176,7,30' && at(amber, 900, 612) === '240,170,10' && at(green, 900, 612) === '59,155,26', 'the rule takes red 176 7 30, amber 240 170 10, green 59 155 26');
    ok(at(red, 705, 640) === '176,7,30' && at(amber, 705, 640) === '240,170,10' && at(green, 705, 640) === '59,155,26', 'the symbol cell is flat in the severity colour');
    const g1 = at(P, 705, 626).split(',')[0] | 0, g2 = at(P, 705, 705).split(',')[0] | 0;
    ok(g1 < g2 && g2 >= 100 && g2 <= 112, 'the grey cell is the tab ramp\'s gradient (top ' + g1 + ' to bottom ' + g2 + ' of 255)');
    let whiteIn = 0, ink = 0;
    for (let y = 640; y < 690; y++) for (let x = 710; x < 764; x++) { const o = ((y - T.PLATE.y) * W + (x - T.PLATE.x)) * 4; if (P.buf[o] > 200 && P.buf[o + 1] > 200 && P.buf[o + 2] > 200) whiteIn++; }
    const am = T.paintPlate(deps, { id: 9999, name: 'x', color: 'yellow' }, { font: FONT });
    for (let y = 640; y < 690; y++) for (let x = 710; x < 764; x++) { const o = ((y - T.PLATE.y) * W + (x - T.PLATE.x)) * 4; if (am.buf[o] < 60 && am.buf[o + 1] < 60) ink++; }
    ok(whiteIn > 100 && ink > 100, 'the symbol is white on grey / red / green and black on amber (' + whiteIn + ' white px, ' + ink + ' black px)');
    // the headline starts at x 783, below y 650
    let left = 1e9;
    for (let y = 640; y < 700; y++) for (let x = 770; x < 1230; x++) { const o = ((y - T.PLATE.y) * W + (x - T.PLATE.x)) * 4; if (P.buf[o] > 100) left = Math.min(left, x); }
    ok(left >= 783 - 3 && left <= 783 + 6, 'the headline\'s first ink is at x ' + left + ' (783 plus the glyph\'s side bearing)');
    ok(P.lines.length === 1 && P.bases[0] === 680, 'one line sits on baseline 680, two on 656 / 703');
    const two = T.paintPlate(deps, { id: 15, name: long2, color: 'white' }, { font: FONT });
    ok(two.lines.length === 2 && two.bases.join() === '656,703', 'two lines: baselines 656 and 703');
    const cnt = T.paintPlate(deps, { id: 15, name: 'Driver door open', color: 'white', counter: '2/3' }, { font: FONT, counterFont: FONT });
    let cr = 0;
    for (let y = 684; y < 708; y++) for (let x = 1100; x < 1230; x++) { const o = ((y - T.PLATE.y) * W + (x - T.PLATE.x)) * 4; if (cnt.buf[o] > 100) cr = Math.max(cr, x); }
    ok(cr >= 1224 - 8 && cr <= 1224, 'the counter "2/3" is right-aligned at x 1224 on line 2 (last ink at x ' + cr + ')');
    ok(!P.buf.equals(cnt.buf) && P.buf.equals(T.paintPlate(deps, msg, { font: FONT, counterFont: FONT }).buf), 'the plate is deterministic and the counter changes it');
    const nightP = T.paintPlate(deps, msg, { font: FONT, night: true });
    ok(!nightP.buf.equals(P.buf) && T.nightRgb([255, 255, 255], 0.8).join() === '231,231,231' && T.nightRgb([218, 16, 48], 0.85).join() === '203,14,44',
        'the night plate is the same drawing in the night multipliers (white 0.8 = 231, red 0.85 = 203 14 44, as VC\'s palette)');
    let thrown = false;
    try { T.paintPlate({ textRaster, paintIcon: icons.paintIcon, icons: icons.ICONS }, msg, { font: 'no_such_font' }); } catch (e) { thrown = true; }
    ok(thrown, 'a font that will not load throws (the engine latches that: window stays open)');
}

// ---- the state machine alone, with an injected clock --------------------------------------------------------------------
function machineChecks() {
    console.log('the state machine, injected clock');
    const E = {
        door: { id: 15, name: 'Driver door open', color: 'white', symbol: 2 },
        boot: { id: 14, name: 'Boot lid open', color: 'white', symbol: 2 },
        tyre: { id: 50, name: 'Check tyre pressure', color: 'yellow', symbol: 44 },
        brake: { id: 42, name: 'Brake fault', color: 'red', symbol: 12 },
        noname: { id: 16, name: '', color: 'red', symbol: 2 },
        greek: { id: 17, name: 'Πόρτα', color: 'white', symbol: 2 },
    };
    const mk = (o) => { const lines = []; const t = new T.TwinCC(Object.assign({ log: (l) => lines.push(l) }, o)); return { t, lines }; };
    const list = (...es) => es;
    const inp = (o) => Object.assign({ read: true, actWired: false, act: null, dispWired: false, disp: null, noneValues: [0], shown: null, live: [],
        heurEntry: null, frame: { n: null, of: null, ids: [] }, find: null }, o);
    const finder = (...es) => (id) => es.find((e) => e.id === id) || null;
    let now = 1000;

    {   // blind
        const { t } = mk();
        ok(t.state === 'window' && t.window === true && t.candidate === null, 'a new machine is blind: window open, nothing to draw');
        t.update(inp({ read: false }), now);
        ok(t.state === 'window' && /not been read/.test(t.reason) && t.severity === 0, 'condition 1: signals not readable: window (' + t.reason + ')');
    }
    {   // heuristic only (no witness yet)
        const { t, lines } = mk();
        t.update(inp({ shown: true, live: list(E.door), heurEntry: E.door }), now);
        ok(t.state === 'window' && t.candidate === null && /D7/.test(t.reason) && t.severity === 1, 'D7: the list says a message may show and "shown now" never spoke: window, no plate (' + t.reason + ')');
        t.update(inp({ shown: true, live: list(E.brake), heurEntry: E.brake }), now);
        ok(t.severity === 4, 'the window\'s severity follows the heuristic\'s colours (red 4)');
        t.update(inp({ shown: false }), now);
        ok(t.state === 'none' && t.window === false && t.severity === 0, 'the heuristic saying nothing shows: none, tab unlit');
        ok(lines.every((l) => !/Driver|Brake|door open/i.test(l)) && lines.some((l) => /^cc: id - colour /.test(l)), 'the log line carries ids, colours and lengths, never a name');
    }
    {   // D7 episodes
        const { t, lines } = mk();
        const f = finder(E.door, E.boot);
        t.update(inp({ actWired: true, act: 0, find: f }), now);
        ok(t.state === 'none' && !t.confirmed, 'shown-now 0: none');
        t.update(inp({ actWired: true, act: 15, find: f }), now);
        ok(t.confirmed && t.state === 'window' && t.candidate === null && /confirmed/.test(t.reason), 'the number 15 matches an entry: D7 latch falls, but THIS message stays BMW\'s (' + t.reason + ')');
        ok(lines.some((l) => /cc: shown-now confirmed \(number 15 matched a ccList entry\)/.test(l)), 'the log says "cc: shown-now confirmed"');
        t.update(inp({ actWired: true, act: 0, find: f }), now);
        ok(t.state === 'none', 'the message ends: none');
        t.update(inp({ actWired: true, act: 15, find: f }), now);
        ok(t.state === 'window' && t.candidate && t.candidate.id === 15 && t.needsTick && /not on the screen/.test(t.reason), 'the next message is a candidate for our plate; window open until it is on the screen');
        t.painted(t.candidate.key, now);
        t.update(inp({ actWired: true, act: 15, find: f }), now + 149);
        ok(t.state === 'window', 'sent 149 ms ago: still window');
        t.update(inp({ actWired: true, act: 15, find: f }), now + 150);
        ok(t.state === 'ours' && t.window === false && !t.needsTick, 'sent 150 ms ago: ours, window shut');
        // N -> M (no 0 between)
        t.update(inp({ actWired: true, act: 14, find: f }), now + 400);
        ok(t.state === 'window' && t.candidate.id === 14, 'N -> M: window at once, the candidate is M');
        ok(t.drawn === null || t.drawn.key !== t.candidate.key, 'the stamp of N is not M\'s: M must be painted and settle');
        t.painted(t.candidate.key, now + 400);
        t.update(inp({ actWired: true, act: 14, find: f }), now + 400 + 150);
        ok(t.state === 'ours', 'M settles: ours');
        // same id, new words
        const f2 = finder({ id: 14, name: 'Boot lid still open', color: 'white' });
        t.update(inp({ actWired: true, act: 14, find: f2 }), now + 800);
        ok(t.state === 'window' && /not on the screen yet/.test(t.reason), 'the same id with other words: window again until the new words are on screen');
        t.update(inp({ actWired: true, act: 0, find: f2 }), now + 900);
        ok(t.state === 'none' && t.candidate === null && t.drawn === null, 'the end: none, no plate, no stamp');
    }
    {   // confirmNow
        const { t } = mk({ confirmNow: true });
        t.update(inp({ actWired: true, act: 15, find: finder(E.door) }), now);
        ok(t.candidate && t.candidate.id === 15, 'confirmNow: the confirming message itself may be ours');
    }
    {   // strict false
        const { t } = mk({ strict: false });
        t.update(inp({ shown: true, live: list(E.door), heurEntry: E.door }), now);
        ok(t.candidate && t.candidate.id === 15 && t.state === 'window', 'strict off: the heuristic\'s entry may be drawn (0.7.20\'s behaviour) - after it is on screen');
        t.update(inp({ actWired: true, act: 15, find: finder(E.door) }), now);
        ok(t.candidate && t.candidate.id === 15, 'strict off: no episode wait either');
    }
    {   // no entry, empty name, glyph, throw, sheet
        const { t, lines } = mk({ confirmNow: true });
        const f = finder(E.door, E.noname, E.greek);
        t.update(inp({ actWired: true, act: 99, find: f }), now);
        ok(t.state === 'window' && t.candidate === null && /no ccList entry for number 99/.test(t.reason), 'condition 3: no entry: window, no plate');
        t.update(inp({ actWired: true, act: 16, find: f }), now);
        ok(t.state === 'window' && t.candidate === null && /no name/.test(t.reason), 'condition 4: empty name: window, no plate');
        t.update(inp({ actWired: true, act: 17, find: f }), now);
        ok(t.candidate && t.candidate.id === 17, 'a Greek name is a candidate until painting finds the glyph missing');
        t.fail('glyph', t.candidate.key, '5 characters');
        t.update(inp({ actWired: true, act: 17, find: f }), now);
        ok(t.state === 'window' && t.candidate === null && /missing from our font/.test(t.reason), 'condition 5: a missing glyph latches: window');
        t.update(inp({ actWired: true, act: 17, find: f }), now + 5000);
        ok(t.candidate === null, 'the latch holds while the message stays');
        t.update(inp({ actWired: true, act: 0, find: f }), now + 5100);
        t.update(inp({ actWired: true, act: 15, find: f }), now + 5200);
        ok(t.candidate && t.candidate.id === 15, 'the latch falls when the message ends: the next message can be ours');
        t.fail('throw', t.candidate.key, 'boom');
        t.update(inp({ actWired: true, act: 15, find: f }), now + 5300);
        ok(t.candidate === null && /threw/.test(t.reason), 'condition 6: a throw latches: window');
        t.update(inp({ actWired: true, act: 0, find: f }), now + 5400);
        t.update(inp({ actWired: true, act: 15, find: f }), now + 5500);
        ok(t.candidate !== null, 'one throw does not end ours for good');
        t.fail('throw', '*', 'again'); t.fail('throw', '*', 'again');
        t.update(inp({ actWired: true, act: 0, find: f }), now + 5600);
        t.update(inp({ actWired: true, act: 15, find: f }), now + 5700);
        ok(t.candidate === null && t.dead && /until the app restarts/.test(t.reason), 'three throws: ours is off until the app restarts');
        ok(lines.every((l) => !/Driver|Π/.test(l)), 'no latch line carries a name');
    }
    {
        const { t } = mk({ confirmNow: true });
        t.update(inp({ actWired: true, act: 15, find: finder(E.door) }), now);
        t.sheetRefused('layer: pixel memory is full');
        t.update(inp({ actWired: true, act: 15, find: finder(E.door) }), now);
        ok(t.state === 'window' && t.candidate === null && /sheet was refused/.test(t.reason), 'condition 8: the sheet refused: window, for every message');
        t.rebuilt();
        t.update(inp({ actWired: true, act: 15, find: finder(E.door) }), now);
        ok(t.candidate !== null, 'a rebuild gives the sheet another try');
    }
    {   // two witnesses
        const { t } = mk({ confirmNow: true });
        const f = finder(E.door, E.boot);
        t.update(inp({ actWired: true, act: 15, dispWired: true, disp: 15, find: f }), now);
        ok(t.candidate && t.candidate.id === 15, 'both witnesses name 15: a candidate');
        t.update(inp({ actWired: true, act: 15, dispWired: true, disp: 14, find: f }), now);
        ok(t.state === 'window' && t.candidate === null && /disagree/.test(t.reason), 'the witnesses name 15 and 14: window');
        t.update(inp({ actWired: true, act: 0, dispWired: true, disp: 14, find: f }), now);
        ok(t.state === 'window' && t.candidate === null, 'one says none, the other a message: window (the safe side)');
        t.update(inp({ actWired: true, act: 0, dispWired: true, disp: 0, find: f }), now);
        ok(t.state === 'none', 'both say none: none');
        t.update(inp({ dispWired: true, disp: 14, find: f }), now);
        ok(t.candidate && t.candidate.id === 14, 'only the second witness has spoken: it decides');
    }
    {   // counter
        const { t } = mk({ confirmNow: true });
        const f = finder(E.door, E.boot, E.tyre);
        t.update(inp({ actWired: true, act: 15, find: f, frame: { n: 2, of: 3, ids: [14, 15, 50] } }), now);
        ok(t.candidate.counter === '2/3', 'the counter is the car\'s frame n of m when that frame is this message');
        t.update(inp({ actWired: true, act: 15, find: f, frame: { n: 1, of: 3, ids: [14, 15, 50] } }), now);
        ok(t.candidate.counter === '', 'frame 1 names another message: no counter');
        t.update(inp({ actWired: true, act: 15, find: f, frame: { n: 1, of: 1, ids: [15, 0, 0] } }), now);
        ok(t.candidate.counter === '', 'one frame of one: no counter');
        t.update(inp({ actWired: true, act: 15, find: f, frame: { n: 2, of: 2, ids: [] } }), now);
        ok(t.candidate.counter === '2/2', 'a frame count with no ids is believed');
        const key = t.candidate.key;
        t.painted(key, now);
        t.update(inp({ actWired: true, act: 15, find: f, frame: { n: 1, of: 2, ids: [] } }), now + 200);
        ok(t.state === 'ours' && t.candidate.counter === '1/2', 'a counter change does not reopen the window (the stamp is the headline\'s)');
    }
}

// =====================================================================================================================
// Part 2: the engine
// =====================================================================================================================
const RECT = [696, 595, 1226, 704];                // BMW's message panel (bbox of zc.panel dilated 3 px, rounded out)
const HOLE = [696, 595, 530, 109];                 // the stand-in backdrop's fallback hole: x, y, w, h
const PLATE_RECT = [T.PLATE.x, T.PLATE.y, T.PLATE.w, T.PLATE.h];

const LAY = (name, extra) => {
    const widgets = [
        // a stand-in for tdback L: black, with the fallback hole opened by "cc:window" (B's tdback replaces it)
        { id: 'back', type: 'fill', class: 'content', z: 0, x: 0, y: 0, w: 1380, h: 720, color: 'bg', hole: HOLE, holeWhen: 'cc:window', holeInset: 0, holeRadius: 0, conn: 0 },
        // the bottom row (a "cc:" layer: it steps aside whenever a message shows or may show)
        { id: 'row_l1', type: 'text', class: 'content', z: 2, x: 700, y: 640, w: 150, h: 40, text: '48 215 km', font: FONT, color: 'fg', align: 'right', conn: 2, toggle: 'cc:rest' },
        { id: 'row_r1', type: 'text', class: 'content', z: 2, x: 1000, y: 640, w: 150, h: 40, text: '412.6 km', font: FONT, color: 'fg', align: 'right', conn: 2, toggle: 'cc:rest' },
        { id: 'row_l2', type: 'text', class: 'content', z: 2, x: 700, y: 678, w: 150, h: 36, text: '14:43', font: FONT, color: 'fg', align: 'right', conn: 2, toggle: 'cc:rest' },
    ];
    if (!(extra && extra.noPlate)) widgets.push({ id: 'plate', type: 'ccplate', class: 'content', z: 3, x: PLATE_RECT[0], y: PLATE_RECT[1], w: PLATE_RECT[2], h: PLATE_RECT[3], font: FONT, counterFont: FONT, conn: 2 });
    return { schemaVersion: 2, name: name, theme: 'wb_comfort', widgets };
};

/** The stand-in cluster-render: protocol v1 enough for the engine's clients, with the service's rules. */
function startRender(sockPath, knobs) {
    const st = { layers: new Map(), violations: [], hellos: [], refusals: [], pixel: 0 };
    const writeEv = (sock, obj) => {
        const body = Buffer.from(JSON.stringify(obj), 'utf8'), m = Buffer.alloc(5 + body.length);
        m.writeUInt32LE(body.length + 1, 0); m[4] = 0x4a; body.copy(m, 5); sock.write(m);
    };
    const server = net.createServer((sock) => {
        const c = { app: '?', buf: Buffer.alloc(0), conn: st.hellos.length };
        sock.on('data', (d) => {
            c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d;
            let off = 0;
            while (c.buf.length - off >= 5) {
                const len = c.buf.readUInt32LE(off);
                if (c.buf.length - off < 4 + len) break;
                const type = c.buf[off + 4], body = c.buf.slice(off + 5, off + 4 + len);
                off += 4 + len;
                if (type !== 0x4a) continue;
                let m; try { m = JSON.parse(body.toString('utf8')); } catch (e) { continue; }
                if (m.op === 'hello') { c.app = m.app; c.conn = st.hellos.length; st.hellos.push(m.app); writeEv(sock, { ev: 'hello', backend: 'twin-cc-test', targets: 'panel' }); continue; }
                const key = c.app + ':' + m.ref;
                if (m.op === 'layer' || m.op === 'asset') {
                    const inConn = Array.from(st.layers.values()).filter((l) => l.app === c.app && l.kind !== 'asset').length;
                    const bytes = m.op === 'asset' ? m.w * m.h * (m.format === 'r8' ? 1 : 4) * 2 : (m.kind === 'image' ? (m.iw || m.w) * (m.ih || m.h) * 8 : 0);
                    let why = '';
                    if (knobs.refuse && m.op === 'layer' && knobs.refuse(m)) why = 'the service\'s pixel memory is full';
                    else if (m.op === 'layer' && inConn >= 8) why = 'too many layers';
                    else if (st.pixel + bytes > 16 * 1048576) why = 'the service\'s pixel memory is full';
                    if (why) { st.refusals.push({ app: c.app, ref: m.ref, why }); writeEv(sock, { ev: 'error', op: m.op, ref: m.ref, reason: why }); continue; }
                    st.pixel += bytes;
                    st.layers.set(key, { app: c.app, ref: m.ref, kind: m.op === 'asset' ? 'asset' : m.kind, bytes });
                    writeEv(sock, { ev: 'layer', ref: m.ref, state: 'shown' });
                } else if (m.op === 'drop') {
                    const l = st.layers.get(key);
                    if (l) { st.pixel -= l.bytes; st.layers.delete(key); }
                }
            }
            c.buf = c.buf.slice(off);
        });
        sock.on('error', () => {});
    });
    return new Promise((resolve) => { try { fs.unlinkSync(sockPath); } catch (e) { /* none */ } server.listen(sockPath, () => resolve({ st, server })); });
}

function buildApp() {
    const f30 = JSON.parse(fs.readFileSync(path.join(F30, 'app.json'), 'utf8'));
    const spec = JSON.parse(JSON.stringify(f30));
    spec.id = APP_ID; spec.title = 'Twin CC test'; spec.description = 'test stand-in for twin_dial\'s message path (bench/test-twin-cc.js); never shipped';
    spec.version = '0.0.1'; spec.loggingId = 'OATC'; spec.iconGlyph = 'TC';
    spec.shared = f30.shared.filter((f) => ['menu.js', 'gallery.js', 'previews.js'].indexOf(f) < 0).concat(['twin_cc.js']);
    spec.settings.forEach((s) => {
        if (s.key === 'hudLayout') { s.options = s.options.concat([['twin_cc', 'Twin CC'], ['twin_cc_b', 'Twin CC b'], ['twin_cc_noplate', 'Twin CC without a plate']]); s.default = 'twin_cc'; }
        if (s.key === 'byMode') s.default = false;
        if (s.key === 'demo') s.default = 'off';
        if (s.key === 'nightDim') s.default = 'off';
    });
    const c = spec.config;
    c.ccm = null; c.ccMarker = null;
    c.ccActive = Object.assign({}, c.ccActive, { strict: true, fallback: { on: true, hideAfterMs: 900, keepColors: ['red'] } });
    c.ccDisplayed = { iface: 'de.bmw.infotainment.vehicle.Vehicle2', field: 'statusDisplayedCCMessage', numberPath: ['statusNumberCheckControlMessageDisplay'] };
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(APP_DIR, 'hud', 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(APP_DIR, 'app.json'), JSON.stringify(spec, null, 1));
    fs.writeFileSync(path.join(APP_DIR, 'main.js'), [
        "'use strict';", "const mgu = require('./kit/mgu');", "const HudApp = require('./hud');",
        "mgu.run({ start(ctx) { const hud = new HudApp(ctx); hud.start(); process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting */ } }); } });", ''].join('\n'));
    ['wb_msg'].forEach((f) => fs.copyFileSync(path.join(F30, 'hud', 'fonts', f + '.json'), path.join(APP_DIR, 'hud', 'fonts', f + '.json')));
    const sdk = path.join(ROOT, 'oap-sdk');
    if (!fs.existsSync(path.join(sdk, 'index.js'))) {
        fs.mkdirSync(sdk, { recursive: true });
        fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
        fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    }
    execFileSync('python3', [path.join(ROOT, 'kit', 'tools', 'build.py'), APP_ID], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    return spec;
}

function cleanup() {
    try { fs.rmSync(APP_DIR, { recursive: true, force: true }); } catch (e) { /* gone */ }
    try { fs.rmSync(STAGE, { recursive: true, force: true }); } catch (e) { /* gone */ }
    try { fs.readdirSync(path.join(ROOT, 'dist')).filter((f) => f.indexOf(APP_ID + '@') === 0).forEach((f) => fs.rmSync(path.join(ROOT, 'dist', f), { force: true })); } catch (e) { /* none */ }
}

async function engineChecks() {
    console.log('the real engine, frame by frame');
    const spec = buildApp();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-cc-'));
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(path.join(dataDir, 'layouts'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'layouts', 'twin_cc.json'), JSON.stringify(LAY('Twin CC')));
    fs.writeFileSync(path.join(dataDir, 'layouts', 'twin_cc_b.json'), JSON.stringify(LAY('Twin CC b')));
    fs.writeFileSync(path.join(dataDir, 'layouts', 'twin_cc_noplate.json'), JSON.stringify(LAY('Twin CC without a plate', { noPlate: true })));
    const sockPath = path.join(tmp, 'render.sock');
    const knobs = { refuse: null };
    const { st, server } = await startRender(sockPath, knobs);
    process.env.HUD_CLUSTER_SOCKET = sockPath;

    const logs = [];
    const log = { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERROR ' + a.join(' ')), debug: () => {} };
    global.__twinCcEngine = true;
    const { headUnit } = require(path.join(ROOT, 'kit', 'tools', 'hu-stub.js'));
    const hu = headUnit(STAGE, { live: true, dataDir, log, image: () => Promise.resolve() });
    let hud = null;
    const realLoad2 = Module._load;
    Module._load = function (req) {
        const m = realLoad2.apply(this, arguments);
        if (req === './hud' && typeof m === 'function' && !m.__twin) {
            const W = class extends m { constructor(ctx) { super(ctx); hud = this; } };
            W.__twin = true;
            return W;
        }
        return m;
    };
    const fakeSigns = require(path.join(__dirname, 'fake-signs')).install(hu, spec.config, log);

    // ---- the model and the audit ------------------------------------------------------------------------------------
    const CR = require(path.join(STAGE, 'source', 'javascript', 'cluster_render_client.js'));
    const model = { frames: 0, violations: [], truth: { shown: false, may: true, expect: [] }, trace: [], rowsInk: 0 };
    let pending = false, last = '';
    const clientsOf = () => (hud ? hud.clients : []);
    const accepted = (c, l) => !(knobs.refuse && knobs.refuse(Object.assign({ kind: l.kind }, l.opts)));
    /** what covers BMW's panel now: every layer of ours the service accepted, over the panel's bbox, sampled on a 3 px grid */
    function snapshot() {
        const layers = [];
        clientsOf().forEach((c) => c.layers.forEach((l) => { if (l.kind !== 'asset' && l.opts && accepted(c, l) && l.opts.visible !== false && l.opts.visible !== 0) layers.push(l); }));
        let covered = 0, rows = 0, hole = null;
        let plate = null;
        const at = (l, x, y) => {
            const o = l.opts, lx = x - o.x, ly = y - o.y;
            if (lx < 0 || ly < 0 || lx >= o.w || ly >= o.h) return 0;
            if (l.kind === 'image') return l.image[(ly * l.iw + lx) * 4 + 3] > 0 ? 1 : 0;
            if (l.kind === 'effect') {
                const u = l.uniforms['0:u_hole'];
                if (u) {
                    const v = String(u.v).trim().split(/\s+/).map(Number);
                    hole = v;
                    if (v[2] > 0 && lx >= v[0] && ly >= v[1] && lx < v[0] + v[2] && ly < v[1] + v[3]) return 0;
                }
                return 1;
            }
            return 0;
        };
        layers.forEach((l) => { if (l.kind === 'image' && l.opts.w === PLATE_RECT[2] && l.opts.h === PLATE_RECT[3] && l.opts.x === PLATE_RECT[0]) plate = l.image; });
        for (let y = RECT[1]; y < RECT[3]; y += 3) {
            for (let x = RECT[0]; x < RECT[2]; x += 3) {
                let c = 0, r = 0;
                layers.forEach((l) => { const a = at(l, x, y); if (a) { c = 1; if (l.kind === 'image' && !(l.opts.w === PLATE_RECT[2] && l.opts.h === PLATE_RECT[3])) r = 1; } });
                covered += c; rows += r;
            }
        }
        const back = layers.find((l) => l.kind === 'effect');
        let open = false;
        if (back) { const u = back.uniforms['0:u_hole']; if (u) { const v = String(u.v).trim().split(/\s+/).map(Number); open = v[2] > 0; } }
        // BMW's belt group and the gear-letter gap: no pixel of ours
        let keepOut = 0;
        layers.forEach((l) => {
            if (l.kind !== 'image') return;
            const o = l.opts;
            [[497, 660, 688, 720], [1380, 660, 1460, 720]].forEach((b) => { if (o.x < b[2] && b[0] < o.x + o.w && o.y < b[3] && b[1] < o.y + o.h) keepOut++; });
        });
        let plateBlank = true;
        if (plate) for (let i = 3; i < plate.length; i += 4) if (plate[i]) { plateBlank = false; break; }
        return { covered, rows, plate, plateBlank, open, keepOut };
    }
    function audit() {
        pending = false;
        if (!hud || !hud.client || !hud.client.ready) return;
        model.frames++;
        const s = snapshot();
        const tr = [s.covered > 0 ? 'C' : '-', s.rows > 0 ? 'R' : '-', s.plateBlank ? 'b' : 'P', s.open ? 'O' : 'S', hud.twinMsg ? hud.twinMsg.state[0] : '?'].join('');
        if (tr !== last) { last = tr; model.trace.push({ t: T.mono(), tr, state: hud.twinMsg && hud.twinMsg.state, covered: s.covered, rows: s.rows, plateBlank: s.plateBlank, open: s.open }); }
        const why = (w) => { model.violations.push({ w, tr, t: Date.now(), truth: JSON.stringify({ shown: model.truth.shown, may: model.truth.may }) }); };
        if (s.keepOut) why('a layer of ours reaches BMW\'s belt group or gear gap');
        if ((model.truth.shown || model.truth.may) && s.covered) {
            const same = s.plate && model.truth.expect.some((b) => b.equals(s.plate));
            if (!same) why('BMW\'s panel is covered (' + s.covered + ' samples) while our plate for the shown message is not on the screen' + (s.rows ? ' (the bottom row\'s ink is in the panel)' : ''));
        }
        // the bottom row returns only after the window has shut, and never over a plate or an open window
        if (s.rows && (s.open || !s.plateBlank)) why('the bottom row\'s ink is in BMW\'s panel while the window is open or the plate is up');
    }
    const dirty = () => { if (!pending) { pending = true; setImmediate(audit); } };
    ['_send', 'pixels', '_add', 'drop', 'uniform', 'set'].forEach((m) => {
        const o = CR.ClusterRender.prototype[m];
        CR.ClusterRender.prototype[m] = function () { const r = o.apply(this, arguments); dirty(); return r; };
    });

    // ---- helpers for the cases --------------------------------------------------------------------------------------
    const planned = (entry, counter, night) => {
        const base = { id: entry.id, name: String(entry.name).replace(/\s+/g, ' ').trim(), color: entry.color, counter: counter || '' };
        return [false, true].filter((n) => night === undefined || n === night).map((n) => T.paintPlate(deps, base, { font: FONT, counterFont: FONT, night: n }).buf);
    };
    const truth = (shown, may, entry, counter, night) => { model.truth = { shown, may, expect: shown && entry ? planned(entry, counter, night) : [] }; dirty(); };
    const feedList = (arr) => fakeSigns.control({ ccList: arr });
    let both = false;               // once the second witness has spoken, the car sends both numbers together
    const feedDisp = (n) => hu.feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusDisplayedCCMessage', { statusNumberCheckControlMessageDisplay: n });
    const feedAct = (n, extra) => {
        fakeSigns.control({ ccActive: Object.assign({ number: n, control: n ? 1 : 0, frame: 1, of: 1 }, extra || {}) });
        if (both) feedDisp(n);
    };
    const feedFrame = (n, of, ids) => fakeSigns.control({ ccFrame: { frame: n, of, ids } });
    const press = (key, value) => {
        const s = hu.settings.item(key), comp = hu.ui.comp('SET_' + key.toUpperCase());
        const rows = s.type === 'choice' ? s.options.map((o) => o[0]) : s.steps;
        comp.emit('action', { row: rows.indexOf(value) });
    };
    // (a satisfied wait lets the audit's own setImmediate run before it returns: both can be due in one pass of the event loop)
    const turn = () => new Promise((r) => setImmediate(() => setImmediate(r)));
    const until = async (fn, ms) => { const end = Date.now() + (ms || 3000); while (Date.now() < end) { if (fn()) { await turn(); return true; } await sleep(15); } return fn(); };
    const T0 = () => hud.twinMsg;
    const E = {
        door: { id: 15, name: 'Driver door open', color: 'white' },
        boot: { id: 14, name: 'Boot lid open', color: 'white' },
        tyre: { id: 50, name: 'Check the tyre pressure', color: 'yellow' },
        brake: { id: 42, name: 'Brake fault: stop the car at the next safe place and call for help right now', color: 'red' },
        noname: { id: 16, name: '', color: 'red' },
        greek: { id: 17, name: 'Πόρτα ανοιχτή', color: 'white' },
        rest: { id: 0, name: 'All systems OK', color: 'green' },
    };
    const clean = () => { model.violations.length = 0; };
    const noViolations = (what) => ok(model.violations.length === 0, what + ' (' + model.frames + ' frames audited, ' + model.violations.length + ' violations' +
        (model.violations[0] ? ': ' + model.violations[0].w + ' [' + model.violations[0].tr + ']' : '') + ')');

    // ---- case 1: the blind start --------------------------------------------------------------------------------------
    hu.start();
    const started = await until(() => hud && hud.client && hud.client.ready && hud.widgets.size >= 5 && hud.twinMsg, 8000);
    ok(started, 'the engine is up with ' + (hud ? hud.widgets.size : 0) + ' widgets on the stand-in layout and a TwinCC (config.ccActive.strict)');
    if (!started) { console.log(logs.slice(-20).join('\n')); throw new Error('engine did not start'); }
    // B's contract (ENGINE-CONTRACT 2): D assigns this.twinCc and calls this._twinSync() (B's method; a counter stands in here)
    let syncs = 0, seenCc = [];
    hud._twinSync = () => { syncs++; seenCc.push(hud.twinCc.state + '/' + hud.twinCc.severity); };
    await sleep(400);
    truth(false, true);         // blind: the car may be showing anything
    await sleep(300);
    {
        const t = T0(), s = snapshot();
        ok(t.state === 'window' && t.window && s.open && s.plateBlank && s.rows === 0 && s.covered === 0, '1. blind start: window open (hole ' + s.open + '), the plate empty, no row ink, nothing of ours over BMW\'s panel');
        ok(hud._toggleOn('cc:window') && !hud._toggleOn('cc:rest') && !hud._toggleOn('cc:ours') && hud._toggleOn('cc:any') && hud._ccOpen() === true, 'the toggles cc:window / cc:rest / cc:ours / cc:any and _ccOpen follow the state');
        noViolations('1. no frame covered BMW\'s panel while the car could not be read');
    }

    // ---- case 2: ccList fits, no active number ever -----------------------------------------------------------------
    clean();
    model.truth = { shown: false, may: false, expect: [] };      // the car's list says only its resting entry: no message
    feedList([E.rest]);
    await sleep(200);
    {
        const t = T0();
        ok(t.state === 'none' && !t.window && snapshot().rows > 0, '2a. a list with only the resting entry (id 0) and no message: none - the bottom row is back (' + snapshot().rows + ' ink samples in the panel)');
    }
    model.truth = { shown: false, may: true, expect: [] };
    feedList([Object.assign({ symbol: 2 }, E.door)]);
    await sleep(500);
    {
        const t = T0(), s = snapshot();
        ok(t.state === 'window' && t.candidate === null && s.open && s.plateBlank && s.rows === 0 && s.covered === 0 && /D7/.test(t.reason), '2b. the list shows a door entry, "shown now" never spoke: window open, no plate, no row ink (' + t.reason + ')');
        noViolations('2b. never covered while D7 was open');
    }
    await sleep(900);                   // the heuristic's 900 ms: a white entry stops showing
    await until(() => T0().state === 'none', 2000);
    ok(T0().state === 'none' && snapshot().rows > 0 && !snapshot().open, '2c. the heuristic lets go of a white entry after hideAfterMs: none, row back, window shut');
    model.truth = { shown: false, may: false, expect: [] };
    feedList([E.rest]);
    await sleep(150);
    clean();
    model.truth = { shown: false, may: true, expect: [] };
    feedList([Object.assign({ symbol: 12 }, E.brake)]);
    await sleep(1400);
    ok(T0().state === 'window' && snapshot().covered === 0, '2d. a RED entry keeps the window open for as long as it is listed (' + T0().reason + ')');
    noViolations('2d. never covered by a red entry');
    model.truth = { shown: false, may: false, expect: [] };
    feedList([E.rest]);
    await sleep(200);

    // ---- case 3: the D7 latch, then ours ---------------------------------------------------------------------------
    clean();
    model.truth = { shown: true, may: true, expect: [] };      // while D7 holds there is NO plate of ours to be on the screen
    feedList([Object.assign({ symbol: 2 }, E.door), Object.assign({ symbol: 5 }, { id: 987, name: 'Stored notice', color: 'white' })]);
    feedAct(15);
    await sleep(500);
    {
        const t = T0(), s = snapshot();
        ok(t.confirmed && t.state === 'window' && s.plateBlank && s.covered === 0 && /confirmed/.test(t.reason), '3a. the first "shown now" that matches an entry confirms D7 - and that very message stays BMW\'s (' + t.reason + ')');
        ok(logs.some((l) => /cc: shown-now confirmed \(number 15 matched a ccList entry\)/.test(l)), '3a. the log says "cc: shown-now confirmed"');
        noViolations('3a. the confirming message was never covered');
    }
    model.truth = { shown: false, may: false, expect: [] };
    feedAct(0);
    await sleep(250);
    ok(T0().state === 'none' && snapshot().rows > 0, '3b. the message ends: none, the row is back');
    clean();
    const nTrace3 = model.trace.length;
    truth(true, true, E.door);
    feedAct(15);                         // the same message again: now ours may be drawn
    await sleep(60);
    {
        const s = snapshot(), t = T0();
        ok(t.state === 'window' && s.open && !s.plateBlank && s.plate && model.truth.expect.some((b) => b.equals(s.plate)) && s.rows === 0,
            '3c. in the turn the number arrives: window open AND our plate for exactly that message is up, the row gone (state ' + t.state + ', ' + t.reason + ')');
    }
    await until(() => T0().state === 'ours', 1500);
    const since3 = model.trace.slice(nTrace3);          // the frames from the turn the number arrived (by index: a millisecond can hold two)
    const trUp = since3.filter((x) => !x.plateBlank)[0];
    const trShut = since3.filter((x) => !x.open && x.state === 'ours')[0];
    if (!(trShut && trUp)) console.log('  trace since the paint: ' + since3.map((x) => x.tr).join(' '));
    ok(T0().state === 'ours' && !snapshot().open && trShut && trUp && trShut.t - trUp.t >= 145 && trShut.t - trUp.t < 400,
        '3c. the window shut ' + (trShut && trUp ? Math.round(trShut.t - trUp.t) : '?') + ' ms after the plate went up (CC_SETTLE_MS 150, the audit\'s own jitter 5 ms, not much more)');
    noViolations('3c. at no frame was BMW\'s panel covered without our text for the shown number');
    // the text is on screen: the plate is the pixels of OUR plate for 15, with the symbol the table gives
    ok(syncs > 0 && hud.twinCc.state === 'ours' && hud.twinCc.severity === 'grey' && seenCc.indexOf('window/grey') >= 0,
        '3c. B\'s contract: this.twinCc was assigned and _twinSync() called in step (' + seenCc.slice(-4).join(', ') + '; ' + syncs + ' calls)');
    ok(hud.ccFit && hud.ccFit.symbol === 'cc_door' && hud.ccFit.sev === 1, '3c. the symbol is cc_door (id 15) and the severity grey (white message)');

    // ---- case 4: no entry / empty name / a Greek letter / a throw: window, latched until the message ends ------------
    // (each with a plate that must NEVER be up: expect is empty, so any cover is a violation)
    const never = async (what, start, extra) => {
        clean();
        model.truth = { shown: true, may: true, expect: [] };
        start();
        await sleep(450);
        const t = T0(), s = snapshot();
        ok(t.state === 'window' && t.candidate === null && s.open && s.plateBlank && s.covered === 0 && s.rows === 0, what + ': window open, nothing of ours over BMW\'s panel (' + t.reason + ')');
        if (extra) extra(t);
        await sleep(300);
        ok(T0().state === 'window' && snapshot().covered === 0, what + ': the latch holds while the message stays');
        noViolations(what);
        model.truth = { shown: false, may: false, expect: [] };
        feedAct(0);
        await sleep(250);
        ok(T0().state === 'none' && snapshot().rows > 0, what + ': the message ends: the latch falls, the row is back');
    };
    await never('4a. a "shown now" number with no ccList entry', () => { feedAct(77); }, (t) => ok(/no ccList entry for number 77/.test(t.reason) && logs.some((l) => /active cc: no ccList entry for number 77/.test(l)), '4a. the reason is named and logged'));
    await never('4b. an entry with an empty name', () => { feedList([Object.assign({ symbol: 2 }, E.noname)]); feedAct(16); }, (t) => ok(/no name/.test(t.reason), '4b. the reason is named'));
    await never('4c. a name with a character the font lacks (Greek)', () => { feedList([Object.assign({ symbol: 2 }, E.greek)]); feedAct(17); },
        (t) => ok(/missing from our font/.test(t.reason) && logs.some((l) => /cc: plate latched until the message ends: a character of the name is missing/.test(l)) && logs.every((l) => !/Π/.test(l)), '4c. latched with the reason in the log, and not one letter of the name there'));
    {
        feedList([Object.assign({ symbol: 2 }, E.door)]);
        const realPaint = hud.twin.paintPlate;
        hud.twin.paintPlate = () => { throw new Error('bench: an injected failure while painting the plate'); };
        await never('4d. a throw while painting the plate', () => { feedAct(15); }, (t) => ok(/threw/.test(t.reason) && logs.some((l) => /cc: plate latched until the message ends: drawing the plate threw/.test(l)), '4d. latched, reason logged'));
        hud.twin.paintPlate = realPaint;
        clean();
        truth(true, true, E.door);
        feedAct(15);
        await until(() => T0().state === 'ours', 1500);
        ok(T0().state === 'ours', '4d. one failure did not end ours: the next message is drawn again');
        noViolations('4d. and it was audited too');
        model.truth = { shown: false, may: false, expect: [] };
        feedAct(0);
        await sleep(250);
    }

    // ---- case 5: N -> M, window at once, closes only after M's text ------------------------------------------------
    clean();
    feedList([Object.assign({ symbol: 2 }, E.door), Object.assign({ symbol: 2 }, E.boot), Object.assign({ symbol: 44 }, E.tyre)]);
    truth(true, true, E.door);
    feedAct(15);
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours', '5. N: ours (door)');
    const nTrace5 = model.trace.length;
    truth(true, true, E.boot);
    feedAct(14);                         // N -> M with no 0 between
    {
        const s = snapshot(), t = T0();
        ok(t.state === 'window' && s.open && !s.plateBlank && model.truth.expect.some((b) => b.equals(s.plate)),
            '5. N -> M in one turn: the window is open at once and the plate already says M, not N');
    }
    await until(() => T0().state === 'ours', 1500);
    const since5 = model.trace.slice(nTrace5), up5 = since5.filter((x) => !x.plateBlank)[0], sw = since5.filter((x) => !x.open && x.state === 'ours')[0];
    if (!(up5 && sw)) console.log('  trace since the switch: ' + since5.map((x) => x.tr).join(' '));
    ok(T0().state === 'ours' && up5 && sw && sw.t - up5.t >= 145, '5. the window shut ' + (up5 && sw ? Math.round(sw.t - up5.t) : '?') + ' ms after M\'s plate went up (not before 150)');
    noViolations('5. N -> M');
    // N -> a message we cannot draw (no entry): the plate must go in the same turn the window opens
    truth(true, true, null);
    feedAct(88);
    {
        const s = snapshot();
        ok(T0().state === 'window' && s.open && s.plateBlank && s.covered === 0, '5. N -> a message with no entry: the plate is cleared in the very turn the window opens');
    }
    await sleep(250);
    noViolations('5. N -> unnamed');
    // and a counter: frame 2 of 3 comes with the next message
    truth(true, true, E.tyre, '2/3');
    feedFrame(2, 3, [14, 50, 15]);
    feedAct(50);
    await until(() => T0().state === 'ours', 1500);
    ok(hud.twinCc.severity === 'amber', '5. a yellow message gives severity "amber" in this.twinCc');
    ok(T0().state === 'ours' && T0().candidate.counter === '2/3', '5. a message with the car\'s frame counter: "2/3" is on the plate');
    truth(true, true, E.tyre, '3/3');
    feedFrame(3, 3, [14, 50, 15]);       // frame 3 of 3 is message 15's, not this one's: no counter
    truth(true, true, E.tyre, '');
    await sleep(250);
    ok(T0().state === 'ours' && T0().candidate.counter === '', '5. a frame whose id is not this message takes the counter away without reopening the window');
    noViolations('5. counters');

    // ---- case 6: the end ---------------------------------------------------------------------------------------------
    model.truth = { shown: false, may: false, expect: [] };
    feedAct(0);
    feedFrame(0, 0, [0, 0, 0]);         // the car's frame counter goes quiet with the message
    {
        const s = snapshot(), t = T0();
        ok(t.state === 'none' && s.plateBlank && !s.open && s.rows > 0, '6. number 0: the plate goes, the window shuts and the row returns, in that order, in one turn');
    }
    await sleep(200);
    noViolations('6. the end');

    // ---- case 7: the second witness, and the plate sheet refused -------------------------------------------------------
    clean();
    truth(true, true, null);
    feedDisp(14);                        // the second witness says 14 while the first says 0: they disagree
    both = true;                         // (from here on the car sends both numbers together)
    await sleep(200);
    ok(T0().state === 'window' && snapshot().covered === 0, '7a. the witnesses disagree (0 and 14): window, nothing of ours over BMW\'s panel');
    truth(true, true, E.boot);
    feedAct(14);
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours', '7a. both witnesses say 14: ours');
    noViolations('7a. two witnesses');
    model.truth = { shown: false, may: false, expect: [] };
    feedAct(0); feedDisp(0);
    await sleep(250);
    // the sheet refused: the service has no room for the plate's sheet at the next build
    knobs.refuse = (m) => m.kind === 'image' && m.w === PLATE_RECT[2] && m.h === PLATE_RECT[3];
    press('hudLayout', 'twin_cc_b');
    await until(() => hud.activeName === 'twin_cc_b' && st.refusals.length > 0, 3000);
    await sleep(300);
    ok(st.refusals.some((r) => /pixel memory/.test(r.why)), '7b. the service refused the plate\'s sheet ("' + (st.refusals[0] && st.refusals[0].why) + '")');
    clean();
    truth(true, true, null);
    feedAct(15);
    await sleep(500);
    {
        const s = snapshot(), t = T0();
        ok(t.state === 'window' && t.sheetLatch && s.open && s.covered === 0 && /refused/.test(t.reason), '7b. refused sheet: window open for the message, nothing of ours over BMW\'s panel (' + t.reason + ')');
        ok(logs.some((l) => /cc: plate sheet refused/.test(l)), '7b. the log says the sheet was refused');
        noViolations('7b. a plate with no sheet never closes the window');
    }
    model.truth = { shown: false, may: false, expect: [] };
    feedAct(0);
    await sleep(250);
    knobs.refuse = null;
    st.refusals.length = 0;
    press('hudLayout', 'twin_cc');
    await until(() => hud.activeName === 'twin_cc', 3000);
    await sleep(200);
    clean();
    truth(true, true, E.door);
    feedAct(15);
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && !T0().sheetLatch, '7b. the next build tries the sheet again and it works: ours');
    model.truth = { shown: false, may: false, expect: [] };
    feedAct(0);
    await sleep(250);
    // a layout with no plate at all can never close the window
    press('hudLayout', 'twin_cc_noplate');
    await until(() => hud.activeName === 'twin_cc_noplate', 3000);
    await sleep(200);
    clean();
    truth(true, true, null);
    feedAct(15);
    await sleep(500);
    ok(T0().state === 'window' && snapshot().open && snapshot().covered === 0, '7c. a layout with no plate widget: window open for every message, never closed');
    noViolations('7c. no plate widget');
    model.truth = { shown: false, may: false, expect: [] };
    feedAct(0);
    await sleep(250);
    press('hudLayout', 'twin_cc');
    await until(() => hud.activeName === 'twin_cc', 3000);
    await sleep(200);

    // ---- case 8: a layout switch and day / night with a message showing -------------------------------------------------
    clean();
    truth(true, true, E.door);
    feedAct(15);
    await until(() => T0().state === 'ours', 1500);
    const nb = model.frames;
    press('hudLayout', 'twin_cc_b');
    await sleep(40);
    {
        const s = snapshot();
        ok(hud.activeName === 'twin_cc_b' && T0().state === 'window' && s.open, '8a. layout switch with a message showing: the new backdrop is born with BMW\'s window open (state ' + T0().state + ')');
    }
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && model.frames > nb, '8a. after the rebuild the plate is painted again and settles: ours');
    noViolations('8a. across the layout switch');
    press('nightDim', 'always');
    await sleep(100);
    truth(true, true, E.door);          // accepts the day or the night plate of the same message
    await until(() => T0().state === 'ours', 1500);
    ok(hud.nightOn === true && T0().state === 'ours', '8b. night colours with a message showing: the plate is painted again (' + (hud.nightOn ? 'night' : 'day') + '), ours');
    noViolations('8b. across the day / night change');
    press('nightDim', 'off');
    await sleep(300);
    noViolations('8b. and back to day');

    // ---- case 9: the audit itself ------------------------------------------------------------------------------------
    model.truth = { shown: false, may: false, expect: [] };
    feedAct(0);
    await sleep(250);
    ok(model.frames >= 50, '9. the pixel audit ran on ' + model.frames + ' frames (every turn of the event loop in which the engine sent anything)');
    const seen = (re) => model.trace.some((x) => re.test(x.tr));
    ok(seen(/^C-PSo/) && seen(/^C-PO[wn]/) && seen(/^CRbSn/) && seen(/^--bOw/),
        '9. the trace saw every kind of frame: ours (plate up, window shut), the plate up with the window open, the row alone, BMW\'s panel alone (' + model.trace.length + ' distinct states)');

    // ---- the mutants: the audit must fail when the engine is broken -----------------------------------------------------
    const mutant = async (what, apply, restore, play) => {
        clean();
        apply();
        try { await play(); } finally { restore(); }
        const n = model.violations.length;
        ok(n > 0, 'mutant: ' + what + ' - the audit saw ' + n + ' violation' + (n === 1 ? '' : 's') + (n ? ' (first: ' + model.violations[0].w + ')' : ''));
        clean();
        model.truth = { shown: false, may: false, expect: [] };
        feedAct(0);
        await sleep(300);
        feedAct(0);
    };
    {   // M1: the rows never step aside
        const live = hud._ccLiveSync;
        await mutant('the bottom row never steps aside', () => { hud._ccLiveSync = () => {}; hud._ccHidden = () => false; }, () => { hud._ccLiveSync = live; delete hud._ccHidden; hud._ccPush(); },
            async () => { truth(true, true, E.boot); feedAct(14); await sleep(400); });
        await sleep(300);
    }
    {   // M2: the window never opens (the hole stays shut) while the plate is not yet on the screen
        const upd = hud.twinMsg.update;
        await mutant('the window never opens, our plate goes up late', () => {
            hud.twinMsg.update = function () { const r = upd.apply(this, arguments); this.window = false; this.state = 'ours'; this.candidate = this.candidate && null; return r; };
        }, () => { hud.twinMsg.update = upd; hud._ccPush(); }, async () => { truth(true, true, E.tyre); feedAct(50); await sleep(400); });
        await sleep(300);
    }
    {   // M3: N's plate stays up when M arrives (the plate is never replaced or cleared)
        const send = hud._twinSend;
        let ours = false;
        await mutant('the plate of N stays up when M arrives', () => {
            truth(true, true, E.door); feedAct(15);
        }, () => { hud._twinSend = send; hud._ccPush(); }, async () => {
            await until(() => T0().state === 'ours', 1500);
            hud._twinSend = function () { return undefined; };           // from now on no plate is painted or cleared
            truth(true, true, E.boot); feedAct(14);
            await sleep(400);
        });
        void ours;
        await sleep(300);
    }
    {   // M4: the stale-plate check itself: a plate of ANOTHER message is "covered without our text for the shown number"
        const upd = hud.twinMsg.update;
        await mutant('the window opens but the plate is painted for the WRONG message', () => {
            hud.twinMsg.update = function () { const r = upd.apply(this, arguments); if (this.candidate) this.candidate = Object.assign({}, this.candidate, { name: this.candidate.name + ' (stale)', key: this.candidate.key + '*' }); return r; };
        }, () => { hud.twinMsg.update = upd; hud._ccPush(); }, async () => { truth(true, true, E.boot); feedAct(14); await sleep(400); });
        await sleep(300);
    }

    // ---- budgets the stand-in layout and the engine keep: layers per connection, pixel memory -------------------------------
    const perApp = {};
    st.layers.forEach((l) => { if (l.kind !== 'asset') perApp[l.app] = (perApp[l.app] || 0) + 1; });
    ok(Object.keys(perApp).every((a) => perApp[a] <= 8) && st.pixel <= 16 * 1048576, 'the service\'s own limits hold (layers per connection ' + JSON.stringify(perApp) + ', pixel memory ' + (st.pixel / 1048576).toFixed(2) + ' MiB)');
    ok(!logs.some((l) => /^ERROR/.test(l)), 'the engine logged no error (' + logs.filter((l) => /^ERROR/.test(l)).slice(0, 2).join(' | ') + ')');
    const text = logs.join('\n');
    ok(!/Driver door|Boot lid|Brake fault|tyre pressure|Πόρτα/i.test(text.replace(/layer "[^"]*"/g, '')), 'no message text ever reached the log (' + logs.length + ' lines checked)');
    ok(/cc: id 15 colour white name len 16 shown-now 15 → ours \(our plate is on the screen\)/.test(text), 'the log has the evaluation line: "cc: id 15 colour white name len 16 shown-now 15 → ours (our plate is on the screen)"');
    ok(/cc: id 15 colour white name len 16 shown-now 15 → window \(D7: this is the message that confirmed/.test(text), 'and the D7 one: "→ window (D7: this is the message that confirmed ...)"');

    hud.stop();
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    if (process.env.TWIN_CC_TRACE) console.log(model.trace.map((x) => x.tr).join(' '));
}

(async () => {
    try {
        unitChecks();
        machineChecks();
        await engineChecks();
    } catch (e) {
        failed++;
        console.log('  FAIL ' + (e && e.stack || e));
    } finally {
        cleanup();
    }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
