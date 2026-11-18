'use strict';
/**
 * test-twin-cc.js - Twin Dial's check-control messages in the CENTRE (package B3 of the 0.1.1 build; docs/twin-dial/SPEC-R3.md 5;
 * docs/twin-dial/r3b/B3-REPORT.md). Round 2's bottom plate is gone: the message is tab 2's card.
 *
 *   node bench/test-twin-cc.js
 *
 * Part 1, without the engine: shared/twin_cc.js on its own - the symbol table equals VT's, severity, the sheet's layout (the card
 *   wraps to 3 lines, rows 6 / 2 / 1 / 0, the pointer and the empty page, a row counts only when its whole name fits) and raster
 *   (opaque, ONE paint, every item where SPEC-R3 5.1 puts it, clear of BMW's keep-outs), TwinCC (the verdict: VG 5.4's cases,
 *   D7, both witnesses, the latches) with an injected clock.
 * Part 2, the model: SC's 35 cases in every way the service may apply a turn (atomically, op by op, every interleaving of the
 *   connections) with and without the narrowed release, and eight deliberately broken machines (tools/twin-dial/r3/sc/test.js).
 * Part 3, the real engine (shared/hud.js, built by the kit as the Store builds it) in this process, against a stand-in
 *   cluster-render that models the service's rules (layer caps, pixel memory, refusals): the engine's own clients keep every
 *   layer, uniform and pixel they sent, and after EVERY turn of the event loop in which anything was sent the audit looks at BMW's
 *   panel and at tab 2's sheet, pixel for pixel:
 *     V1  while the car says a message shows (or may show) BMW's panel is covered by us ONLY IF our card for exactly that message,
 *         or a row with its whole name, is completely on the sheet (compared with an independent render), and has been for 150 ms;
 *     V2  the bottom row's ink never sits in an open panel;
 *     V3  the centre never takes away the text the cover relied on before the window has been open 150 ms (the window and the
 *         sheet are on different connections: nothing orders sockets);
 *     V4  the bottom row's layer and the window's backdrop are on one connection;
 *     V5  no layer of ours reaches BMW's belt group or the gear-letter gap.
 *   Six deliberately broken engines must each make the audit fail (the row never steps aside, the window never opens, a stale
 *   card stays, a card for the wrong message, the 150 ms waits removed, the row left on connection 2).
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
const TWIN = path.join(ROOT, 'apps', 'twin_dial');
const APP_ID = 'twin_cc_test';
const APP_DIR = path.join(ROOT, 'apps', APP_ID), STAGE = path.join(ROOT, 'dist', APP_ID);

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fonts for the sheet outside the engine: hud_data wants the kit's pack; read Twin Dial's own atlases as plain files -------------
const realLoad = Module._load;
Module._load = function (req) {
    if (req === './kit/pack' && !global.__twinCcEngine) {
        return { open: () => ({ json: (rel) => { for (const d of [path.join(TWIN, 'hud'), path.join(F30, 'hud')]) { try { return JSON.parse(fs.readFileSync(path.join(d, rel), 'utf8')); } catch (e) { /* next */ } } return {}; } }) };
    }
    return realLoad.apply(this, arguments);
};
const T = require(path.join(ROOT, 'shared', 'twin_cc.js'));
const textRaster = require(path.join(ROOT, 'shared', 'hud_text.js'));
const icons = require(path.join(ROOT, 'shared', 'icons.js'));
const deps = { textRaster, paintIcon: icons.paintIcon, icons: icons.ICONS };
const FONTS = T.FONTS;           // td_msg 42, td_cnt 29, td_tab 33, td_val 39: Twin Dial's own atlases
const layDeps = { measure: (f, s) => textRaster.measure(s, f, 0), has: (f, ch) => !!textRaster.loadFont(f).metrics.glyphs[ch], fonts: FONTS };
const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const BELT = [497, 660, 688, 720], GAP = [1380, 660, 1460, 720], BMW_PANEL = [696, 595.75, 1226, 704];

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

    // ---- the sheet's layout (SPEC-R3 5.1) ----
    const S = T.SHEET;
    const mkc = (id, name, color, counter) => ({ key: String(id) + '\u0001' + name, id, name, color, counter: counter || '' });
    const lay = (cand, entries, o) => T.layoutTab2(Object.assign({ cand, shown: !!cand, sev: cand ? T.severityOf(cand.color) : 0, entries: entries || [], night: false }, o || {}), layDeps);
    const one = lay(mkc(15, 'Двері відчинено', 'white'));
    const two = lay(mkc(50, 'Тиск у шинах: перевірте', 'yellow'));
    const three = lay(mkc(42, 'Несправність гальм: зупиніться в безпечному місці', 'red'));
    const cut = lay(mkc(42, 'Несправність гальмівної системи: обережно зупиніться та зверніться до сервісу', 'red'));
    ok(one.card.lines.length === 1 && two.card.lines.length === 2 && three.card.lines.length === 3 && !three.card.cut && cut.card.lines.length === 3 && cut.card.cut && /…$/.test(cut.card.lines[2]),
        'the headline wraps by words to 1 / 2 / 3 lines inside 436 px (Noto 42) and a longer one ends line 3 in "…" (' + [one, two, three, cut].map((p) => p.card.lines.length).join(' / ') + ')');
    ok(one.card.bases.join() === '424' && two.card.bases.join() === '424,471' && three.card.bases.join() === '424,471,518', 'baselines 424 / 471 / 518 (SPEC-R3 5.1)');
    ok([one, two, three, cut].every((p) => p.card.lines.every((l) => layDeps.measure(FONTS.head, l) <= T.HEAD.maxW)), 'every headline line fits 436 px');
    const rowsE = [];
    for (let i = 0; i < 9; i++) rowsE.push({ id: 100 + i, name: 'Повідомлення ' + (i + 1), color: i === 4 ? 'red' : i === 6 ? 'yellow' : 'white' });
    const withRows = (c) => lay(c, rowsE).rows.length;
    ok(withRows(mkc(15, 'Двері відчинено', 'white')) === 2 && withRows(mkc(50, 'Тиск у шинах: перевірте', 'yellow')) === 1 && withRows(mkc(42, 'Несправність гальм: зупиніться в безпечному місці', 'red')) === 0 && lay(null, rowsE).rows.length === 6,
        'rows: 2 under a one-line card, 1 under two lines, none under three; 6 on the list page (pitch 44, y 300 to 564)');
    const lst = lay(null, rowsE);
    ok(lst.kind === 'list' && lst.rows[0].sev === 4 && lst.rows[1].sev === 3 && lst.more === 3 && lst.rows.every((r, i) => r.top === 300 + 44 * i), 'the list: red first, then amber, then the car\'s order; the rest is counted for the scroll line (' + lst.more + ' more)');
    ok(lay(null, []).kind === 'empty' && lay(null, [], { shown: true, sev: 4 }).kind === 'pointer' && lay(null, [], { shown: true }).card.lines.join('|') === 'Повідомлення|на панелі внизу', 'the empty page and the pointer page ("Повідомлення / на панелі внизу")');
    const longRow = lay(null, [{ id: 41, name: 'Потрібне сервісне обслуговування найближчим часом', color: 'white' }, { id: 15, name: 'Двері відчинено', color: 'white' }]);
    ok(longRow.rows[0].cut && !longRow.rows[1].cut && longRow.keys.indexOf(longRow.rows[0].key) < 0 && longRow.keys.indexOf(longRow.rows[1].key) >= 0,
        'a row counts as our text for its message only when its WHOLE name fits (the cut one does not)');
    const greek = lay(null, [{ id: 17, name: 'Πόρτα ανοιχτή', color: 'white' }]);
    ok(greek.rows.length === 0 && greek.keys.length === 0, 'a row whose name has a glyph the font lacks is not drawn and counts for nothing');
    ok(lay(mkc(15, 'Двері відчинено', 'white'), [{ id: 15, name: 'Двері відчинено', color: 'white' }]).rows.length === 0, 'the shown message is the card, never also a row');
    ok(one.sig !== lay(mkc(15, 'Двері відчинено', 'white', '1/2')).sig && one.sig !== lay(mkc(15, 'Двері відчинено', 'white'), [], { night: true }).sig && one.sig === lay(mkc(15, 'Двері відчинено', 'white')).sig,
        'the sig changes with the counter and the night, not otherwise (the stamp of a message keeps its time across those)');

    // ---- the sheet's raster ----
    const P = T.paintSheet(deps, one, { night: false });
    const W = S.w, H = S.h;
    const at = (b, x, y) => { const o = ((y - S.y) * W + (x - S.x)) * 4; return [b[o], b[o + 1], b[o + 2], b[o + 3]]; };
    let opaque = true;
    for (let i = 3; i < P.buf.length; i += 4) if (P.buf[i] !== 255) { opaque = false; break; }
    ok(P.buf.length === W * H * 4 && opaque, 'the sheet is opaque black everywhere, ' + W + ' x ' + H + ' at [' + T.SHEET_RECT.join(', ') + '] (it hides the clock or trip page under it)');
    ok(!hit(T.SHEET_RECT, BELT) && !hit(T.SHEET_RECT, GAP) && !hit(T.SHEET_RECT, BMW_PANEL) && T.SHEET_RECT[1] >= 297.5 && T.SHEET_RECT[0] >= 729 && T.SHEET_RECT[2] <= 1191,
        'the sheet touches neither the belt group, the gear-letter gap nor BMW\'s panel, and lies under the title rule inside the centre window');
    const card = (color, name, o2) => T.paintSheet(deps, lay(mkc(42, name || 'Тест', color, (o2 && o2.counter) || '')), o2 || {});
    ok(at(card('red').buf, 930, 312).slice(0, 3).join() === '176,7,30' && at(card('yellow').buf, 930, 312).slice(0, 3).join() === '240,170,10' && at(card('green').buf, 930, 312).slice(0, 3).join() === '59,155,26',
        'the symbol cell [922, 306, 998, 382] is flat in the severity colour (red 176 7 30, amber 240 170 10, green 59 155 26)');
    const g1 = at(P.buf, 925, 308)[0], g2 = at(P.buf, 925, 380)[0];
    ok(g1 < g2 && g2 >= 90 && g2 <= 112 && at(P.buf, 921, 340).join() === '0,0,0,255' && at(P.buf, 998, 340).join() === '0,0,0,255', 'the grey cell is the tab ramp\'s gradient (top ' + g1 + ' to bottom ' + g2 + ' of 255), exactly the cell\'s box');
    let whiteIn = 0, blackIn = 0;
    const am = card('yellow');
    for (let y = 317; y < 371; y++) for (let x = 933; x < 987; x++) { const a = at(P.buf, x, y), b = at(am.buf, x, y); if (a[0] > 200 && a[1] > 200) whiteIn++; if (b[0] < 60 && b[1] < 60) blackIn++; }
    ok(whiteIn > 100 && blackIn > 100, 'the symbol (54 px at (960, 344)) is white on grey, black on amber (' + whiteIn + ' white px, ' + blackIn + ' black px)');
    // the headline: centred on x 960, ink between baselines - cap and + descent
    const inkBox = (b, x0, y0, x1, y1, th) => { let r = [1e9, 1e9, -1, -1]; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const a = at(b, x, y); if (a[0] > (th || 100)) { r = [Math.min(r[0], x), Math.min(r[1], y), Math.max(r[2], x), Math.max(r[3], y)]; } } return r; };
    const ib = inkBox(P.buf, 735, 395, 1185, 440);
    ok(Math.abs((ib[0] + ib[2]) / 2 - 960) <= 6 && ib[3] <= 424 + 12 && ib[1] >= 424 - 36, 'one headline line: centred on x 960 (ink ' + ib[0] + '..' + ib[2] + '), on baseline 424 (ink y ' + ib[1] + '..' + ib[3] + ')');
    const ib3 = inkBox(T.paintSheet(deps, three, {}).buf, 735, 487, 1185, 535);
    ok(ib3[3] >= 518 - 2 && ib3[3] <= 518 + 12, 'a three-line card puts its third line on baseline 518 (ink to y ' + ib3[3] + ')');
    const cnt = T.paintSheet(deps, lay(mkc(15, 'Двері відчинено', 'white', '2/3')), {});
    const ic = inkBox(cnt.buf, 1050, 300, 1191, 340);
    ok(ic[2] <= 1180 && ic[2] >= 1180 - 6 && ic[3] <= 326 + 2 && ic[3] >= 326 - 2 && ic[1] >= 298, 'the counter "2/3" is top right: right edge x ' + ic[2] + ' (1180), baseline 326 (ink to y ' + ic[3] + '), under the sheet\'s top');
    ok(!P.buf.equals(cnt.buf) && P.buf.equals(T.paintSheet(deps, lay(mkc(15, 'Двері відчинено', 'white')), {}).buf), 'the sheet is deterministic and the counter changes it');
    const rp = T.paintSheet(deps, lay(mkc(15, 'Двері відчинено', 'white'), [{ id: 164, name: 'Мало рідини омивача', color: 'white' }, { id: 50, name: 'Тиск у шинах: перевірте', color: 'yellow' }]), {});
    const r1 = inkBox(rp.buf, 775, 450, 1185, 494), ri = inkBox(rp.buf, 741, 450, 775, 494, 60);
    ok(r1[0] >= 781 - 1 && r1[0] <= 781 + 6 && r1[3] <= 450 + 33 + 12 && ri[0] >= 741 && ri[2] <= 773, 'a row: name from x 781 on baseline top + 33, the 32 px symbol at x 741 (first row top 450)');
    let amberSeen = 0;
    for (let y = 450 + 6; y < 450 + 38; y++) for (let x = 741; x < 773; x++) { const a = at(rp.buf, x, y); if (a[0] > 150 && a[1] > 90 && a[2] < 60) amberSeen++; }
    ok(amberSeen > 20, 'the amber message\'s row symbol is amber (240, 170, 10): ' + amberSeen + ' px');
    const sc = T.paintSheet(deps, lay(null, rowsE), {});
    ok(at(sc.buf, 1189, 320)[0] >= 150 && at(sc.buf, 1189, 560)[0] <= 60 && at(sc.buf, 1189, 560)[0] >= 30 && at(sc.buf, 1180, 320)[0] < 20, 'the scroll line at x 1188..1191: a thumb at the top, a track below, only when more rows exist');
    const nightP = T.paintSheet(deps, one, { night: true });
    ok(!nightP.buf.equals(P.buf) && T.nightRgb([255, 255, 255], 0.8).join() === '231,231,231' && T.nightRgb([218, 16, 48], 0.85).join() === '203,14,44', 'the night sheet is the same drawing in the night multipliers (white 0.8 = 231, red 0.85 = 203 14 44)');
    const empty = T.paintSheet(deps, lay(null, []), {}), pointer = T.paintSheet(deps, lay(null, [], { shown: true, sev: 4 }), {});
    ok(inkBox(empty.buf, 735, 300, 1185, 520, 60)[3] > 0 && inkBox(pointer.buf, 735, 395, 1185, 480)[3] > 0 && at(pointer.buf, 930, 312).slice(0, 3).join() === '176,7,30', 'the empty page ("Немає повідомлень") and the pointer page (a red cell and our two fixed lines) paint');
    let thrown = false;
    try { T.paintSheet(deps, one, { fonts: { head: 'no_such_font', counter: 'td_cnt', row: 'td_tab', text: 'td_val' } }); } catch (e) { thrown = true; }
    ok(thrown, 'a font that will not load throws (the engine latches that: window stays open)');
    ok(T.missingChars(layDeps, FONTS.head, 'Πόρτα').length === 5 && T.missingChars(layDeps, FONTS.head, 'Двері') === '', 'missingChars names the characters a font lacks (Greek)');
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
// Part 2: the model (SC's 35 cases, the connection assignments, the eight broken machines)
// =====================================================================================================================
function modelChecks() {
    console.log('the model: SC\'s cases against shared/twin_cc.js (tools/twin-dial/r3/sc/test.js)');
    const M = require(path.join(ROOT, 'tools', 'twin-dial', 'r3', 'sc', 'test.js'));
    const r = M.main();
    passed += r.passed; failed += r.failed;
}

// =====================================================================================================================
// Part 3: the engine
// =====================================================================================================================
const RECT = [696, 595, 1226, 704];                // BMW's message panel (bbox of zc.panel dilated 3 px, rounded out)
const HOLE = [696, 595, 530, 109];                 // the stand-in backdrop's fallback hole: x, y, w, h
const SHEET_RECT = [T.SHEET.x, T.SHEET.y, T.SHEET.w, T.SHEET.h];
const SYM = { x: 0 };

const LAY = (name, extra) => {
    const rc = extra && extra.rowConn ? extra.rowConn : 0;
    const row = (id, x, y, w, h, text) => Object.assign({ id, type: 'text', class: 'content', z: 8, x, y, w, h, text, font: 'td_row', color: 'fg', align: 'right', toggle: 'cc:row' }, rc ? { conn: rc } : {});
    const widgets = [
        // a stand-in for tdback L: black, with the fallback hole opened by "cc:window" (the real tdback's uniform is tested below)
        { id: 'back', type: 'fill', class: 'content', z: 0, x: 0, y: 0, w: 1380, h: 720, color: 'bg', hole: HOLE, holeWhen: 'cc:window', holeInset: 0, holeRadius: 0, conn: 0 },
        // the bottom row, as design/gen_twin.py lays it (connection 0, "cc:row"): its ink steps aside while BMW's panel is open
        row('row_l1', 700, 640, 150, 40, '48215'), row('row_r1', 1000, 640, 150, 40, '412.6'), row('row_l2', 700, 678, 150, 36, '14:43'),
        // the warning tab's icon (tdLive "warn")
        { id: 'tab_warn_i', type: 'icon', icon: 'cc_warn', class: 'content', z: 5, x: 760, y: 124, w: 38, h: 38, color: 'fg', conn: 1, tdLive: 'warn' },
    ];
    if (!(extra && extra.noSheet)) widgets.push({ id: 'msg_sheet', type: 'ccsheet', class: 'content', z: 9, x: SHEET_RECT[0], y: SHEET_RECT[1], w: SHEET_RECT[2], h: SHEET_RECT[3],
        font: 'td_msg', counterFont: 'td_cnt', rowFont: 'td_tab', textFont: 'td_val', conn: 2 });
    return { schemaVersion: 2, name: name, theme: 'wb_comfort', widgets };
};

/** The stand-in cluster-render: protocol v1 enough for the engine's clients, with the service's rules. */
function startRender(sockPath, knobs) {
    const st = { layers: new Map(), violations: [], hellos: [], refusals: [], pixel: 0, peak: 0 };
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
                    st.pixel += bytes; st.peak = Math.max(st.peak, st.pixel);
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
    spec.shared = f30.shared.filter((f) => ['menu.js', 'gallery.js', 'previews.js'].indexOf(f) < 0).concat(['twin_cc.js', 'twin_tokens.js', 'twin_tabs.js', 'twin_pages.js']);     // integration: twin_tokens' icon state lives in twin_tabs (B2)
    spec.settings.forEach((s) => {
        if (s.key === 'hudLayout') { s.options = s.options.concat([['twin_cc', 'Twin CC'], ['twin_cc_b', 'Twin CC b'], ['twin_cc_nosheet', 'Twin CC without a sheet'], ['twin_cc_c', 'Twin CC row on 2']]); s.default = 'twin_cc'; }
        if (s.key === 'byMode') s.default = false;
        if (s.key === 'demo') s.default = 'off';
        if (s.key === 'nightDim') s.default = 'off';
    });
    const c = spec.config;
    c.ccm = null; c.ccMarker = null;
    // car-fix CF1: the message path's config is Twin Dial's own (ccActive.source "displayed", dead, unknownValues, confirmNow,
    // strict), with a short fallback for the test's pace
    const twinCfg = JSON.parse(fs.readFileSync(path.join(TWIN, 'app.json'), 'utf8')).config;
    c.ccActive = Object.assign({}, twinCfg.ccActive, { strict: true, fallback: { on: true, hideAfterMs: 900, keepColors: ['red'] } });
    c.ccDisplayed = Object.assign({}, twinCfg.ccDisplayed);
    fs.rmSync(APP_DIR, { recursive: true, force: true });
    fs.mkdirSync(path.join(APP_DIR, 'hud', 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(APP_DIR, 'app.json'), JSON.stringify(spec, null, 1));
    fs.writeFileSync(path.join(APP_DIR, 'main.js'), [
        "'use strict';", "const mgu = require('./kit/mgu');", "const HudApp = require('./hud');",
        "mgu.run({ start(ctx) { const hud = new HudApp(ctx); hud.start(); process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting */ } }); } });", ''].join('\n'));
    ['td_msg', 'td_cnt', 'td_tab', 'td_val', 'td_row'].forEach((f) => fs.copyFileSync(path.join(TWIN, 'hud', 'fonts', f + '.json'), path.join(APP_DIR, 'hud', 'fonts', f + '.json')));
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

// ---- the backdrop's fill: the selected tab's cell, never the message's severity (SPEC-R3 3.2, 5.3) ------------------------------
function tabFillChecks() {
    console.log('the tab fill and the warning icon, without the engine');
    const H = require('./twin-harness');
    const dir = H.tree('twin_dial');
    const HudApp = require(path.join(dir, 'hud.js'));
    const twinTok = require(path.join(dir, 'twin_tokens.js'));
    const Ld = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));
    const w = Ld.widgets.find((x) => x.id === 'bg_l');
    const h = Object.create(HudApp.prototype);
    const rec = {};
    h.log = H.nolog; h.nightOn = false; h.config = { twin: {} };
    h._scene = () => ({ ref: 7, w: 536, h: 112 });
    const x = { w, ref: 1, c: { uniform: (ref, n, v) => { rec[n] = v; }, bind: () => {} }, ci: 0 };
    h.twinCc = { state: 'none', severity: null };
    h.twinMsg = { tab: 1 };
    h._twinBackInit(x);
    const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.003);
    // integration (B7): B1's fill (SPEC-R3 3.2: the tab's colour in LINEAR light, the black floor out) and the cells of the new separators
    // (780 / 848 / 1168 / 1237); without live tabs the machine's tab is the selected one
    const FLOOR = [0.0012, 0.0009, 0.0056], lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const fillOf = (rgb) => rgb.map((c, i) => Math.max(0, (lin(c) - FLOOR[i]) / (1 - FLOOR[i]))).concat([1]);
    const TAB = { 1: fillOf([176, 10, 37]), 2: fillOf([176, 10, 37]), 3: fillOf([240, 150, 10]) };
    ok(rec.u_hi[2] === 1 && rec.u_hi[0] === 618 - w.x && rec.u_hi[1] === 780 - w.x && near(rec.u_hiC, TAB[1]), 'tab 1 selected: its cell [618, 780] is filled in the tab\'s colour (176, 10, 37)');
    ['red', 'amber', 'green', 'grey'].forEach((sev) => {
        ['window', 'ours'].forEach((state) => {
            h.twinCc = { state, severity: sev }; h.twinMsg.tab = 2; h._twinBackSend(x, false);
            ok(rec.u_hi[0] === 780 - w.x && rec.u_hi[1] === 848 - w.x && near(rec.u_hiC, TAB[2]), 'a ' + sev + ' message (' + state + '), tab 2 selected: the fill is the tab\'s own, never the severity');
        });
    });
    h.twinCc = { state: 'window', severity: 'amber' }; h.twinMsg.tab = 3; h._twinBackSend(x, false);
    ok(rec.u_hi[0] === 848 - w.x && rec.u_hi[1] === 1168 - w.x && near(rec.u_hiC, TAB[3]), 'tab 3 selected with an amber message: tab 3\'s cell in amber-orange (its own colour), the severity nowhere in it');
    h.twinCc = { state: 'ours', severity: 'red' }; h._twinBackSend(x, false);
    ok(rec.u_rule[4] === 629 && rec.u_rule[5] === 611 && rec.u_rule[7] === 615 && near(rec.u_ruleC.slice(4, 8), [176 / 255, 7 / 255, 30 / 255, 1]), 'the bottom rule is the severity colour only while our card covers BMW\'s panel (4 px, y 611..615)');
    h.twinCc = { state: 'window', severity: 'red' }; h._twinBackSend(x, false);
    ok(rec.u_win[0] === 1 && rec.u_rule[5] === 612.4, 'while BMW\'s window is open the rule is the normal 2.2 px white one and u_win is 1');
    // the warning tab's icon
    h.twinCc = { state: 'ours', severity: 'red' }; h.theme = { fg: [255, 255, 255, 255], bg: [0, 0, 0, 255] };
    const warn = Ld.widgets.find((q) => q.id === 'tab_warn_i');
    h.twinMsg.tab = 1;
    // integration: B2's icon state names the severity colour (color 'red' / 'amber'); the engine paints it as SPEC-R3 5.3's (218, 16, 48) / (240, 170, 10)
    ok(twinTok.iconState(h, warn).color === 'red', 'the warning icon is red (218, 16, 48) while a red message shows and tab 2 is not selected');
    h.twinCc = { state: 'window', severity: 'amber' };
    ok(twinTok.iconState(h, warn).color === 'amber', 'amber (240, 170, 10) for an amber one');
    h.twinCc = { state: 'window', severity: 'grey' };
    ok(twinTok.iconState(h, warn).color === null, 'white for a white / green / grey one');
    h.twinCc = { state: 'ours', severity: 'red' }; h.twinMsg.tab = 2;
    ok(twinTok.iconState(h, warn).color === null, 'white on the fill while tab 2 is selected');
    h.twinCc = { state: 'none', severity: null }; h.twinMsg.tab = 1;
    ok(twinTok.iconState(h, warn).color === null, 'white when nothing shows (never dimmed)');
}

async function engineChecks() {
    console.log('the real engine, frame by frame');
    const spec = buildApp();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-cc-'));
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(path.join(dataDir, 'layouts'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'layouts', 'twin_cc.json'), JSON.stringify(LAY('Twin CC')));
    fs.writeFileSync(path.join(dataDir, 'layouts', 'twin_cc_b.json'), JSON.stringify(LAY('Twin CC b')));
    fs.writeFileSync(path.join(dataDir, 'layouts', 'twin_cc_nosheet.json'), JSON.stringify(LAY('Twin CC without a sheet', { noSheet: true })));
    fs.writeFileSync(path.join(dataDir, 'layouts', 'twin_cc_c.json'), JSON.stringify(LAY('Twin CC row on 2', { rowConn: 2 })));
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

    // ---- the independent reference renders: our card for K, a whole row for K (the audit's idea of "our text is on the screen") ----
    const keyOf = (e) => String(e.id) + '\u0001' + e.name;
    const refCache = {};
    const refCard = (e, night) => {
        const k = 'c' + keyOf(e) + night;
        if (!refCache[k]) {
            const p = T.layoutTab2({ cand: { key: keyOf(e), id: e.id, name: String(e.name).replace(/\s+/g, ' ').trim(), color: e.color, counter: '' }, shown: true, entries: [], night }, layDeps);
            refCache[k] = { buf: T.paintSheet(deps, p, { night }).buf, y1: p.card.bases[p.card.bases.length - 1] + 14 - T.SHEET.y };
        }
        return refCache[k];
    };
    const refRow = (e, night, top) => {
        const k = 'r' + keyOf(e) + night + top;
        if (!refCache[k]) {
            const r = { key: keyOf(e), id: e.id, sev: T.severityOf(e.color), symbol: T.symbolFor(e.id, e.color), text: e.name, cut: false, top };
            refCache[k] = T.paintSheet(deps, { kind: 'list', card: null, rows: [r], more: 0 }, { night }).buf;
        }
        return refCache[k];
    };
    const SW = T.SHEET.w;
    const same = (a, b, x0, y0, x1, y1, skip) => {
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            if (skip && skip(x, y)) continue;
            const o = (y * SW + x) * 4;
            if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) return false;
        }
        return true;
    };
    const TOPS = [];
    [300, 450, 497].forEach((t0) => { for (let t = t0; t + 44 <= 564; t += 44) TOPS.push(t); });
    /** 'card' | 'row' | '' - where the sheet's pixels carry the WHOLE text of entry e (pixel for pixel against our own render) */
    function textOf(img, e) {
        if (!img || !e || !e.name) return '';
        for (const night of [false, true]) {
            const c = refCard(e, night);
            if (same(img, c.buf, 0, 0, SW, c.y1, (x, y) => x >= 1186 - T.SHEET.x || (x >= 1100 - T.SHEET.x && y < 334 - T.SHEET.y))) return 'card';   // (the counter's box and the scroll line are not the message's)
        }
        for (const night of [false, true]) for (const top of TOPS) {
            if (same(img, refRow(e, night, top), 0, top - T.SHEET.y, 1186 - T.SHEET.x, top - T.SHEET.y + 44)) return 'row';
        }
        return '';
    }

    // ---- the model and the audit ------------------------------------------------------------------------------------
    const CR = require(path.join(STAGE, 'source', 'javascript', 'cluster_render_client.js'));
    const model = { frames: 0, violations: [], truth: { shown: false, may: true, expect: [] }, trace: [], since: {}, watch: {}, openSince: 0, hadText: false };
    let pending = false, last = '';
    const clientsOf = () => (hud ? hud.clients : []);
    const accepted = (c, l) => !(knobs.refuse && knobs.refuse(Object.assign({ kind: l.kind }, l.opts)));
    const isSheet = (o) => o.x === SHEET_RECT[0] && o.y === SHEET_RECT[1] && o.w === SHEET_RECT[2] && o.h === SHEET_RECT[3];
    /** what covers BMW's panel now: every layer of ours the service accepted, over the panel's bbox, sampled on a 3 px grid */
    function snapshot() {
        const layers = [];
        clientsOf().forEach((c, ci) => c.layers.forEach((l) => { if (l.kind !== 'asset' && l.opts && accepted(c, l) && l.opts.visible !== false && l.opts.visible !== 0) layers.push(Object.assign({ ci }, l, { l })); }));
        let covered = 0, rows = 0, sheet = null, rowConn = null, backConn = null;
        const at = (l, x, y) => {
            const o = l.opts, lx = x - o.x, ly = y - o.y;
            if (lx < 0 || ly < 0 || lx >= o.w || ly >= o.h) return 0;
            if (l.kind === 'image') return l.image[(ly * l.iw + lx) * 4 + 3] > 0 ? 1 : 0;
            if (l.kind === 'effect') {
                const u = l.uniforms['0:u_hole'];
                if (u) { const v = String(u.v).trim().split(/\s+/).map(Number); if (v[2] > 0 && lx >= v[0] && ly >= v[1] && lx < v[0] + v[2] && ly < v[1] + v[3]) return 0; }
                return 1;
            }
            return 0;
        };
        const rowsL = layers.filter((l) => l.kind === 'image' && hit([l.opts.x, l.opts.y, l.opts.x + l.opts.w, l.opts.y + l.opts.h], RECT));
        const back = layers.find((l) => l.kind === 'effect' && l.uniforms['0:u_hole']);
        layers.forEach((l) => { if (l.kind === 'image' && isSheet(l.opts)) sheet = l.image; });
        if (rowsL.length) rowConn = rowsL[0].ci;
        if (back) backConn = back.ci;
        for (let y = RECT[1]; y < RECT[3]; y += 3) {
            for (let x = RECT[0]; x < RECT[2]; x += 3) {
                let c = 0, r = 0;
                layers.forEach((l) => { if (l.kind === 'effect' && l !== back) return; const a = at(l, x, y); if (a) { c = 1; if (l.kind === 'image') r = 1; } });
                covered += c; rows += r;
            }
        }
        let open = false;
        if (back) { const v = String(back.uniforms['0:u_hole'].v).trim().split(/\s+/).map(Number); open = v[2] > 0; }
        let keepOut = 0;
        layers.forEach((l) => { if (l.kind !== 'image') return; const o = l.opts; [BELT, GAP].forEach((b) => { if (hit([o.x, o.y, o.x + o.w, o.y + o.h], b)) keepOut++; }); });
        let sheetBlank = true;
        if (sheet) for (let i = 3; i < sheet.length; i += 4) if (sheet[i]) { sheetBlank = false; break; }
        const has = sheet ? model.truth.expect.map((e) => textOf(sheet, e)).filter(Boolean)[0] || '' : '';
        // since when each known message's text is on the sheet (continuously): the settle is measured per message
        const now = model.frameAt || T.mono();
        Object.keys(model.watch).forEach((k) => { if (sheet && textOf(sheet, model.watch[k])) { if (model.since[k] === undefined) model.since[k] = now; } else delete model.since[k]; });
        return { covered, rows, sheet, sheetBlank, has, open, keepOut, rowConn, backConn };
    }
    function audit() {
        pending = false;
        if (!hud || !hud.client || !hud.client.ready) return;
        model.frames++;
        const now = model.frameAt || T.mono(), s = snapshot();      // the clocks run on the turn's own time, not on how long the audit took
        const tr = [s.covered > 0 ? 'C' : '-', s.rows > 0 ? 'R' : '-', s.has ? (s.has === 'card' ? 'P' : 'W') : s.sheetBlank ? 'b' : 'x', s.open ? 'O' : 'S', hud.twinMsg ? hud.twinMsg.state[0] : '?', hud.twinMsg ? String(hud.twinMsg.tab) : '?'].join('');
        if (tr !== last) { last = tr; model.trace.push({ t: now, tr, state: hud.twinMsg && hud.twinMsg.state, covered: s.covered, rows: s.rows, has: s.has, open: s.open, blank: s.sheetBlank }); }
        const why = (w) => { model.violations.push({ w, tr, t: Date.now(), truth: JSON.stringify({ shown: model.truth.shown, may: model.truth.may }) }); };
        // the clocks of the audit itself: since when our text is on the sheet, since when the window is open
        if (s.open) { if (model.openSince === null) model.openSince = now; } else model.openSince = null;
        if (s.keepOut) why('V5 a layer of ours reaches BMW\'s belt group or gear gap');
        if (s.rowConn !== null && s.backConn !== null && s.rowConn !== s.backConn) why('V4 the bottom row is on connection ' + s.rowConn + ', the window on ' + s.backConn);
        if ((model.truth.shown || model.truth.may) && s.covered) {
            if (!s.has) why('V1 BMW\'s panel is covered (' + s.covered + ' samples) while our text for the shown message is not on the sheet' + (s.rows ? ' (the bottom row\'s ink is in the panel)' : '') + ' [expect ' + model.truth.expect.map((e) => e.id).join() + ', whole on the sheet: ' + Object.keys(model.since).map((k) => k.split('\u0001')[0]).join() + ']');
            else {
                const ages = model.truth.expect.map((e) => model.since[keyOf(e)]).filter((v) => v !== undefined).map((v) => now - v);
                const best = ages.length ? Math.max.apply(null, ages) : 0;
                if (!s.open && best < 140) why('V1 BMW\'s panel covered ' + Math.round(best) + ' ms after our text first showed (settle 150)');
            }
        }
        if (s.rows && s.open) why('V2 the bottom row\'s ink is in BMW\'s open panel');
        if (model.truth.shown && model.hadText && !s.has && s.open && model.openSince !== null && now - model.openSince < 140) why('V3 our text was taken away ' + Math.round(now - model.openSince) + ' ms after the window opened (open settle 150)');
        model.hadText = !!s.has;
    }
    const dirty = () => { if (!pending) { pending = true; model.frameAt = T.mono(); setImmediate(audit); } };
    ['_send', 'pixels', '_add', 'drop', 'uniform', 'set'].forEach((m) => {
        const o = CR.ClusterRender.prototype[m];
        CR.ClusterRender.prototype[m] = function () { const r = o.apply(this, arguments); dirty(); return r; };
    });

    // ---- helpers for the cases --------------------------------------------------------------------------------------
    const truth = (shown, may, entry) => { model.truth = { shown, may, expect: shown && entry ? [entry] : [] }; model.hadText = false; dirty(); };
    const none = () => { model.truth = { shown: false, may: false, expect: [] }; model.hadText = false; dirty(); };
    const feedList = (arr) => fakeSigns.control({ ccList: arr });
    const feedDisp = (n) => hu.feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusDisplayedCCMessage', { statusNumberCheckControlMessageDisplay: n });
    // car-fix CF1: KombiIF statusActiveCCMessage as the owner's car sends it (its catalogue default the whole run), or any number
    const feedActive = (n, extra) => fakeSigns.control({ ccActive: Object.assign(n === 65535 ? { number: 65535, control: 4095, frame: 15, of: 15, utility: 16777215 } : { number: n, control: n ? 1 : 0, frame: 1, of: 1 }, extra || {}) });
    // car-fix CF1: "the number the car says it shows now" is Vehicle2 statusDisplayedCCMessage (config.ccActive.source "displayed")
    let feedAct = (n) => feedDisp(n);
    const feedFrame = (n, of, ids) => fakeSigns.control({ ccFrame: { frame: n, of, ids } });
    const press = (key, value) => {
        const s = hu.settings.item(key), comp = hu.ui.comp('SET_' + key.toUpperCase());
        const rows = s.type === 'choice' ? s.options.map((o) => o[0]) : s.steps;
        comp.emit('action', { row: rows.indexOf(value) });
    };
    const turn = () => new Promise((r) => setImmediate(() => setImmediate(r)));
    const until = async (fn, ms) => { const end = Date.now() + (ms || 3000); while (Date.now() < end) { if (fn()) { await turn(); return true; } await sleep(15); } return fn(); };
    const T0 = () => hud.twinMsg;
    const E = {
        door: { id: 15, name: 'Driver door open', color: 'white' },
        boot: { id: 14, name: 'Boot lid open', color: 'white' },
        tyre: { id: 50, name: 'Check the tyre pressure', color: 'yellow' },
        brake: { id: 42, name: 'Brake fault: stop the car at the next safe place and call for help right now', color: 'red' },
        wash: { id: 164, name: 'Washer fluid low', color: 'white' },
        noname: { id: 16, name: '', color: 'red' },
        greek: { id: 17, name: 'Πόρτα ανοιχτή', color: 'white' },
        rest: { id: 0, name: 'All systems OK', color: 'green' },
    };
    Object.keys(E).forEach((k) => { if (E[k].name && k !== 'greek') model.watch[keyOf(E[k])] = E[k]; });
    const L = (...es) => es.map((e) => Object.assign({ symbol: 2 }, e));
    const clean = () => { model.violations.length = 0; };
    const noViolations = (what) => ok(model.violations.length === 0, what + ' (' + model.frames + ' frames audited, ' + model.violations.length + ' violations' +
        (model.violations[0] ? ': ' + model.violations[0].w + ' [' + model.violations[0].tr + ']' : '') + ')');
    const warnIcon = () => { const x = hud.widgets.get('tab_warn_i'); return x ? String(x.last) : ''; };
    const endMsg = async () => { none(); feedAct(0); await sleep(250); };

    // ---- case 1: the blind start --------------------------------------------------------------------------------------
    hu.start();
    const started = await until(() => hud && hud.client && hud.client.ready && hud.widgets.size >= 5 && hud.twinMsg, 8000);
    ok(started, 'the engine is up with ' + (hud ? hud.widgets.size : 0) + ' widgets on the stand-in layout and a TwinCentre (config.ccActive.strict)');
    if (!started) { console.log(logs.slice(-20).join('\n')); throw new Error('engine did not start'); }
    await sleep(400);
    truth(false, true);
    await sleep(300);
    {
        const t = T0(), s = snapshot();
        ok(t.state === 'window' && t.window && s.open && s.rows === 0 && s.covered === 0 && t.tab === 1 && hud.twinCc.severity === null, '1. blind start: window open, no row ink, nothing of ours over BMW\'s panel, tab 1 (a window with no severity is not a message: no pull)');
        ok(s.sheet && s.sheetBlank, '1. tab 2\'s sheet is made and empty (transparent) while tab 1 is selected');
        ok(hud._toggleOn('cc:window') && !hud._toggleOn('cc:row') && !hud._toggleOn('cc:ours') && hud._toggleOn('cc:any') && hud._ccOpen() === true, 'the toggles cc:window / cc:row / cc:ours / cc:any and _ccOpen follow the state');
        noViolations('1. no frame covered BMW\'s panel while the car could not be read');
    }

    // ---- case 2: ccList fits, no active number ever -----------------------------------------------------------------
    clean();
    none();
    feedList(L(E.rest));
    await sleep(200);
    ok(T0().state === 'none' && !T0().window && snapshot().rows > 0 && hud._toggleOn('cc:row'), '2a. a list with only the resting entry and no message: none, the bottom row is back (' + snapshot().rows + ' ink samples)');
    model.truth = { shown: false, may: true, expect: [] };
    feedList(L(E.door));
    await sleep(500);
    {
        const t = T0(), s = snapshot();
        ok(t.state === 'window' && s.open && s.rows === 0 && s.covered === 0 && /D7/.test(t.reason) && t.tab === 2 && t.page.kind === 'pointer', '2b. the list shows a door entry, "shown now" never spoke: window open, no row ink, tab 2 with the pointer page - never a card (' + t.reason + ')');
        noViolations('2b. never covered while D7 was open');
    }
    await until(() => T0().state === 'none', 2000);
    ok(T0().state === 'none' && snapshot().rows > 0 && !snapshot().open, '2c. the heuristic lets go of a white entry after hideAfterMs: none, row back, window shut');
    none(); feedList(L(E.rest)); await sleep(150);
    clean();
    model.truth = { shown: false, may: true, expect: [] };
    feedList(L(E.brake));
    await sleep(1400);
    ok(T0().state === 'window' && snapshot().covered === 0, '2d. a RED entry keeps the window open for as long as it is listed (' + T0().reason + ')');
    noViolations('2d. never covered by a red entry');
    none(); feedList(L(E.rest)); await sleep(200);

    // ---- case 2e (car-fix CF1): the car's start (2026-11-18) - active 65535 the whole run (dead), displayed 65535 (unknown) -----
    clean();
    model.truth = { shown: false, may: true, expect: [] };     // unknown: BMW may show something, nothing of ours may cover it
    feedActive(65535); feedDisp(65535);
    await sleep(300);
    {
        const t = T0(), s = snapshot();
        ok(t.state === 'window' && s.open && s.covered === 0 && s.rows === 0 && t.tab === 1 && hud.twinCc.severity === null && /unknown \(65535\)/.test(t.reason),
            '2e. the car\'s start, active 65535 and displayed 65535: unknown - window open, the row aside, tab 1 (no pull: nothing is known to show) (' + t.reason + ')');
        noViolations('2e. the start');
    }
    none(); feedDisp(0);
    await sleep(250);
    ok(T0().state === 'none' && snapshot().rows > 0 && !snapshot().open && hud.ccAct && hud.ccAct.number === 65535,
        '2f. displayed 0, the list at rest, active STILL 65535: none, the window shut, the row back (0.7.20 / 0.1.1 kept it open: the stuck window)');

    // ---- case 3 (car-fix CF1): the car's door - ccList 15 and displayed 15 together; D7 falls on that first match and, with
    // confirmNow (the numbering car-verified), that very message is ours after its 150 ms; the car's close ----------------------
    clean();
    const stored = { id: 987, name: 'Stored notice', color: 'white' };
    truth(true, true, E.door);
    feedList(L(E.door, stored)); feedDisp(15);
    await sleep(40);
    {
        const t = T0(), s = snapshot();
        ok(t.confirmed && t.state === 'window' && s.open && s.has === 'card' && s.rows === 0 && t.tab === 2,
            '3a. the first number that matches an entry confirms D7; in that turn: tab 2, the window open, the card for exactly it on the sheet (' + t.reason + ')');
        ok(logs.some((l) => /cc: shown-now confirmed \(number 15 matched a ccList entry\)/.test(l)), '3a. the log says "cc: shown-now confirmed"');
    }
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && !snapshot().open && snapshot().has === 'card', '3a. after the settle the confirming message itself is ours (config.ccActive.confirmNow)');
    noViolations('3a. the first match');
    clean();
    feedList(L(E.rest, stored));                     // the car: the list at rest first, displayed still 15
    await sleep(120);
    ok(T0().state === 'window' && snapshot().open && snapshot().rows === 0 && /no ccList entry for number 15/.test(T0().reason) && T0().tab === 2,
        '3b. the car\'s close - the list at rest, displayed still 15: BMW\'s panel opens at once (' + T0().reason + ')');
    await sleep(580);
    none(); feedDisp(0);                             // ... and displayed 0 0.7 s after the list
    await sleep(250);
    ok(T0().state === 'none' && snapshot().rows > 0 && !snapshot().open && T0().tab === 1, '3b. displayed 0, 0.7 s later: none, the row back, tab 1 again');
    noViolations('3b. the car\'s close');
    clean();
    const nTrace3 = model.trace.length;
    truth(true, true, E.door);
    feedList(L(E.door, stored));
    feedAct(15);
    await sleep(40);
    {
        const s = snapshot(), t = T0();
        ok(t.state === 'window' && s.open && s.has === 'card' && s.rows === 0 && t.tab === 2 && hud.twinCc.state === 'window',
            '3c. in the turn the number arrives: tab 2, window open AND our card for exactly that message on the sheet, the row gone (' + t.reason + ')');
        ok(hud._token('td:cTitle') === 'Повідомлення', '3c. the centre\'s title is "Повідомлення" on tab 2');
    }
    await until(() => T0().state === 'ours', 1500);
    await sleep(60);
    const since3 = model.trace.slice(nTrace3);
    const trUp = since3.filter((x) => x.has === 'card')[0], trShut = since3.filter((x) => !x.open && x.state === 'ours')[0];
    if (!(trShut && trUp)) console.log('  trace since the paint: ' + since3.map((x) => x.tr).join(' '));
    ok(T0().state === 'ours' && !snapshot().open && trShut && trUp && trShut.t - trUp.t >= 145 && trShut.t - trUp.t < 400,
        '3c. the window shut ' + (trShut && trUp ? Math.round(trShut.t - trUp.t) : '?') + ' ms after the card went up (CC_SETTLE_MS 150)');
    ok(snapshot().rows > 0 && hud._toggleOn('cc:row'), '3c. the bottom row came back after the window shut (SPEC-R3 5.4.2)');
    ok(hud.twinCc.state === 'ours' && hud.twinCc.severity === 'grey' && hud.ccFit && hud.ccFit.symbol === 'cc_door', '3c. this.twinCc ours / grey (the bottom rule in the severity colour, tdback), the symbol cc_door');
    ok(!/218,16,48|240,170,10/.test(warnIcon()) && /cc_warn/.test(warnIcon()), '3c. the warning tab\'s icon is white while tab 2 is selected (' + warnIcon() + ')');
    noViolations('3c. at no frame was BMW\'s panel covered without our text for the shown number');

    // ---- case 4: leaving tab 2 while the message shows (SPEC-R3 5.4.4) ---------------------------------------------------
    clean();
    const nTrace4 = model.trace.length;
    hud._twinTabChosen(1, 'driver');
    await turn();
    {
        const s = snapshot(), t = T0();
        ok(t.tab === 1 && t.state === 'window' && s.open && s.rows === 0, '4a. the driver leaves tab 2: in the SAME turn the window opens and the row steps aside');
        ok(s.has === 'card' && t.deferred, '4a. the card stays on the sheet until the window has been open 150 ms (the open settle)');
    }
    await sleep(300);
    {
        const s = snapshot(), since = model.trace.slice(nTrace4);
        const opened = since.filter((x) => x.open)[0], gone = since.filter((x) => !x.has)[0];
        ok(s.sheetBlank && s.open && T0().tab === 1 && gone && opened && gone.t - opened.t >= 145, '4b. then the sheet goes (' + (gone && opened ? Math.round(gone.t - opened.t) : '?') + ' ms after the window opened); BMW\'s panel shows the message');
        ok(!/218,16,48|240,170,10/.test(warnIcon()) && hud._token('td:cTitle') !== 'Повідомлення', '4b. the title is tab 1\'s again; the warning icon follows the severity (the text colour for a white message: ' + warnIcon() + ')');
    }
    noViolations('4. leaving tab 2');
    clean();
    hud._twinTabChosen(2, 'driver');
    await turn();
    ok(T0().tab === 2 && snapshot().has === 'card' && snapshot().open, '4c. back to tab 2: the card again, the window still open');
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && !snapshot().open, '4c. and after the settle: ours');
    noViolations('4c. coming back');
    await endMsg();
    ok(T0().state === 'none' && T0().tab === 1 && snapshot().sheetBlank && !snapshot().open && snapshot().rows > 0, '4d. the end: tab 1 again, the sheet empty, the window shut, the row back');

    // ---- case 5: no entry / empty name / a Greek letter / a throw: window, latched until the message ends ------------
    const never = async (what, start, extra) => {
        clean();
        model.truth = { shown: true, may: true, expect: [] };
        start();
        await sleep(450);
        const t = T0(), s = snapshot();
        ok(t.state === 'window' && s.open && s.covered === 0 && s.rows === 0, what + ': window open, nothing of ours over BMW\'s panel (' + t.reason + ')');
        if (extra) extra(t);
        await sleep(300);
        ok(T0().state === 'window' && snapshot().covered === 0, what + ': the latch holds while the message stays');
        noViolations(what);
        await endMsg();
        ok(T0().state === 'none' && snapshot().rows > 0, what + ': the message ends: the latch falls, the row is back');
    };
    await never('5a. a "shown now" number with no ccList entry', () => { feedAct(77); }, (t) => ok(/no ccList entry for number 77/.test(t.reason), '5a. the reason is named'));
    await never('5b. an entry with an empty name', () => { feedList(L(E.noname)); feedAct(16); }, (t) => ok(/no name/.test(t.reason), '5b. the reason is named'));
    await never('5c. a name with a character the font lacks (Greek)', () => { feedList(L(E.greek)); feedAct(17); },
        (t) => ok(/missing from our font/.test(t.reason) && logs.some((l) => /cc: card latched until the message ends: a character of the name is missing/.test(l)) && logs.every((l) => !/Π/.test(l)), '5c. latched, the reason in the log, and not one letter of the name there'));
    {
        feedList(L(E.door));
        const realPaint = hud.twin.paintSheet;
        hud.twin.paintSheet = () => { throw new Error('bench: an injected failure while painting the sheet'); };
        await never('5d. a throw while painting the card', () => { feedAct(15); }, (t) => ok(/threw/.test(t.reason) && logs.some((l) => /cc: card latched until the message ends: drawing the card threw/.test(l)), '5d. latched, reason logged'));
        hud.twin.paintSheet = realPaint;
        clean();
        truth(true, true, E.door);
        feedAct(15);
        await until(() => T0().state === 'ours', 1500);
        ok(T0().state === 'ours', '5d. one failure did not end ours: the next message is drawn again');
        noViolations('5d. and it was audited too');
        await endMsg();
    }

    // ---- case 6: N -> M, a row already whole on the page, a cut row, the counter -----------------------------------------
    clean();
    feedList(L(E.door, E.boot, E.tyre));
    truth(true, true, E.door);
    feedAct(15);
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && snapshot().has === 'card', '6. N: ours (the door card)');
    const nTrace6 = model.trace.length;
    truth(true, true, E.tyre);                // the tyre message is on the page as a whole row under the door card? (amber first: yes)
    const tyreRowFirst = textOf(snapshot().sheet, E.tyre) === 'row';
    feedAct(50);
    await turn();
    if (tyreRowFirst) ok(T0().state === 'ours' && !snapshot().open && snapshot().has === 'card', '6a. N -> M where M was already a whole row on the page: ours at once, the window never opened, M\'s card now');
    else ok(T0().state === 'window' && snapshot().open, '6a. N -> M (M not wholly on the page): the window opens at once');
    await until(() => T0().state === 'ours', 1500);
    noViolations('6a. N -> M');
    void nTrace6;
    feedList(L(E.door, E.boot, E.tyre, E.brake));
    await sleep(60);
    truth(true, true, E.brake);                 // a long red message: never a whole row (cut), so the window opens until its card settles
    feedAct(42);
    await turn();
    ok(T0().state === 'window' && snapshot().open && snapshot().rows === 0 && T0().deferred, '6b. N -> M whose row is cut: the window opens at once; the sheet keeps N\'s card until it has been open 150 ms (the open settle)');
    await sleep(260);
    ok(snapshot().has === 'card' && T0().state === 'window', '6b. then M\'s card goes up, the window stays open for its own 150 ms');
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && hud.twinCc.severity === 'red', '6b. M settles: ours, severity red in this.twinCc (the bottom rule)');
    noViolations('6b. a cut row never counted');
    truth(true, true, null);
    feedAct(88);
    await turn();
    ok(T0().state === 'window' && snapshot().open && snapshot().covered === 0, '6c. N -> a message with no entry: the window opens in the very turn');
    await sleep(300);
    ok(T0().page && T0().page.kind === 'pointer' && !snapshot().has, '6c. tab 2 shows the pointer page ("Повідомлення / на панелі внизу"), never a card');
    noViolations('6c. N -> unnamed');
    truth(true, true, E.tyre);
    feedFrame(2, 3, [14, 50, 15]);
    feedAct(50);
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && T0().candidate.counter === '2/3', '6d. a message with the car\'s frame counter: "2/3" on the card');
    const n6 = model.trace.length;
    feedFrame(3, 3, [14, 50, 15]);
    await sleep(250);
    ok(T0().state === 'ours' && T0().candidate.counter === '' && !model.trace.slice(n6).some((x) => x.open), '6d. a frame of another message takes the counter away without opening the window');
    noViolations('6d. counters');
    await endMsg();
    feedFrame(0, 0, [0, 0, 0]);
    ok(T0().state === 'none' && snapshot().sheetBlank && !snapshot().open && snapshot().rows > 0, '6e. number 0: the sheet empty, the window shut, the row back');

    // ---- case 7: a stored entry whole on the list page becomes ours at once (C12) ----------------------------------------
    clean();
    feedList(L(E.wash));
    await sleep(200);
    hud._twinTabChosen(2, 'driver');
    await sleep(300);
    ok(T0().tab === 2 && T0().state === 'none' && T0().page.kind === 'list' && textOf(snapshot().sheet, E.wash) === 'row', '7a. the driver opens tab 2 with nothing shown: the list page, the stored entry a whole row');
    const n7 = model.trace.length;
    truth(true, true, E.wash);
    feedAct(164);
    await sleep(300);
    ok(T0().state === 'ours' && !model.trace.slice(n7).some((x) => x.open), '7b. shown-now names it: ours at once, BMW\'s panel never opened (our text for it was on the screen)');
    noViolations('7. a whole row as our text');
    await endMsg();
    hud._twinTabChosen(1, 'driver');
    await sleep(200);
    ok(T0().tab === 1 && snapshot().sheetBlank, '7c. back to tab 1: the sheet is empty');

    // ---- case 8: the second witness, the sheet refused, a layout without a sheet ---------------------------------------------
    // car-fix CF1: the active number is a witness only where it moves and config.ccActive.dead is not set (the owner's car: dead)
    clean();
    feedList(L(E.door, E.boot));
    none();
    feedActive(14);
    await sleep(200);
    ok(T0().state === 'none' && hud.ccActLive === true && !hud._ccActWitness() && snapshot().rows > 0,
        '8a. config.ccActive.dead: the active number moves to 14 while displayed says 0 - no witness, none (displayed decides)');
    hud.config.ccActive.dead = false;
    truth(true, true, null);
    hud._ccListEval(Date.now(), false); hud._ccPush();
    await sleep(200);
    ok(hud._ccActWitness() && T0().state === 'window' && snapshot().open && snapshot().covered === 0 && /disagree/.test(T0().reason),
        '8a. dead false: an active number that has moved is a witness again - 14 against displayed 0: window, nothing of ours over BMW\'s panel (' + T0().reason + ')');
    truth(true, true, E.boot);
    feedDisp(14);
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours', '8a. both say 14: ours');
    noViolations('8a. two witnesses');
    none(); feedActive(0); feedDisp(0); await sleep(250);
    hud.config.ccActive.dead = true;
    knobs.refuse = (m) => m.kind === 'image' && m.w === SHEET_RECT[2] && m.h === SHEET_RECT[3];
    press('hudLayout', 'twin_cc_b');
    await until(() => hud.activeName === 'twin_cc_b' && st.refusals.length > 0, 3000);
    await sleep(300);
    ok(st.refusals.some((r) => /pixel memory/.test(r.why)), '8b. the service refused the tab-2 sheet');
    clean();
    truth(true, true, null);
    feedAct(15);
    await sleep(500);
    ok(T0().state === 'window' && T0().sheetLatch && snapshot().open && snapshot().covered === 0 && /refused/.test(T0().reason), '8b. refused sheet: window open for the message (' + T0().reason + ')');
    ok(logs.some((l) => /cc: tab-2 sheet refused/.test(l)), '8b. the log says the sheet was refused');
    noViolations('8b. a refused sheet never closes the window');
    none(); feedAct(0); await sleep(250);
    knobs.refuse = null; st.refusals.length = 0;
    press('hudLayout', 'twin_cc');
    await until(() => hud.activeName === 'twin_cc', 3000);
    await sleep(200);
    clean();
    truth(true, true, E.door);
    feedAct(15);
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && !T0().sheetLatch, '8b. the next build tries the sheet again and it works: ours');
    await endMsg();
    press('hudLayout', 'twin_cc_nosheet');
    await until(() => hud.activeName === 'twin_cc_nosheet', 3000);
    await sleep(200);
    clean();
    truth(true, true, null);
    feedAct(15);
    await sleep(500);
    ok(T0().state === 'window' && snapshot().open && snapshot().covered === 0, '8c. a layout with no tab-2 sheet: window open for every message, never closed (' + T0().reason + ')');
    noViolations('8c. no sheet widget');
    await endMsg();
    press('hudLayout', 'twin_cc');
    await until(() => hud.activeName === 'twin_cc', 3000);
    await sleep(200);

    // ---- case 9: a layout switch and day / night with a message showing ---------------------------------------------------
    clean();
    truth(true, true, E.door);
    feedAct(15);
    await until(() => T0().state === 'ours', 1500);
    const nb = model.frames;
    press('hudLayout', 'twin_cc_b');
    await sleep(40);
    ok(hud.activeName === 'twin_cc_b' && T0().state === 'window' && snapshot().open, '9a. layout switch with a message showing: the new backdrop is born with BMW\'s window open (' + T0().state + ')');
    await until(() => T0().state === 'ours', 1500);
    ok(T0().state === 'ours' && model.frames > nb, '9a. after the rebuild the card is painted again and settles: ours');
    noViolations('9a. across the layout switch');
    press('nightDim', 'always');
    await sleep(150);
    await until(() => T0().state === 'ours' && T0().night === true, 1500);
    ok(hud.nightOn === true && T0().state === 'ours' && T0().night === true, '9b. night colours with a message showing: the card painted again at night, ours');
    noViolations('9b. across the day / night change');
    press('nightDim', 'off');
    await sleep(300);
    noViolations('9b. and back to day');
    await endMsg();

    // ---- case 10: the narrowed release (config.ccActive.release, SPEC-R3 5.4.7; SC's S3b) -----------------------------------
    // car-fix CF1: the release acts on the ACTIVE number only (obsolete while displayed is the source): these cases run with
    // config.ccActive.source "active" and both numbers fed together, as before CF1
    hud.config.ccActive.source = 'active';
    const feedBoth = (n) => { feedActive(n); feedDisp(n); };
    const feedAct0 = feedAct;
    feedAct = feedBoth;
    const s3b = async (leftList) => {
        clean();
        hud.config.ccActive.release = { deferValues: [65535], leftList };
        none(); feedList(L(E.rest)); feedAct(0); await sleep(200);
        truth(true, true, E.door); feedList(L(E.rest, E.door)); feedAct(15);
        await until(() => T0().state === 'ours', 1500);
        none(); feedList(L(E.rest)); feedAct(0); await sleep(300);
        truth(true, true, null); feedAct(15);              // the door again: its number before its list entry
        await sleep(600);
        truth(true, true, E.door); feedList(L(E.rest, E.door));
        await sleep(600);
        none(); feedList(L(E.rest)); feedAct(0); await sleep(300);
        const n = model.violations.length;
        hud.config.ccActive.release = null;
        return n;
    };
    const wide = await s3b('wide');
    ok(wide > 0, '10a. MC\'s wide leftList ("wide") covers BMW\'s panel when a door message comes back with its number before its list entry: ' + wide + ' violations (the test fails without the narrowing)');
    const narrow = await s3b('kept');
    ok(narrow === 0, '10b. the narrowed leftList ("kept") keeps the window open there: 0 violations');
    const asTrue = await s3b(true);
    ok(asTrue === 0, '10b. leftList true on Twin Dial is read as "kept" (its machine never takes the wide rule): 0 violations');
    {
        clean();
        hud.config.ccActive.release = { deferValues: [65535], leftList: 'kept' };
        none(); feedList(L(E.rest)); feedAct(0); await sleep(200);
        truth(true, true, E.door); feedList(L(E.rest, E.door)); feedAct(15);
        await until(() => T0().state === 'ours', 1500);
        none(); feedList(L(E.rest));                          // the number is never notified again (MC's A3): kept 15
        await sleep(400);
        ok(T0().state === 'none' && hud.ccReleased === true && logs.some((l) => /released to the list \(listed\): number 15 was kept after its entry left ccList/.test(l)),
            '10c. a number KEPT after its entry left is released: the list decides, none (MC\'s A3 no longer hangs)');
        noViolations('10c. the release');
        hud.config.ccActive.release = null;
        feedAct(0); await sleep(200);
    }
    ok(JSON.parse(fs.readFileSync(path.join(TWIN, 'app.json'), 'utf8')).config.ccActive.release === null, '10d. Twin Dial\'s app.json ships the release off (config.ccActive.release null)');
    feedAct = feedAct0;
    hud.config.ccActive.source = 'displayed';
    hud._ccListEval(Date.now(), false); hud._ccPush();
    await sleep(200);

    // ---- case 12 (car-fix CF1, config.ccActive.unlistedPullsTab): a number with no ccList entry keeps BMW's panel open, pulls no tab ----
    clean();
    none(); feedList(L(E.rest)); feedAct(0); await sleep(200);
    hud._twinTabChosen(1, 'driver'); await sleep(150);
    truth(true, true, null);
    feedAct(285);
    await sleep(400);
    {
        const t = T0(), s = snapshot();
        ok(hud.config.ccActive.unlistedPullsTab === false && t.state === 'window' && s.open && s.covered === 0 && s.rows === 0 && t.tab === 1 && t.page.kind === 'other',
            '12a. displayed 285 with no ccList entry (unlistedPullsTab false, as shipped): BMW\'s panel open, the row aside, tab 1 stays - no pull, no pointer page (' + t.reason + ')');
        noViolations('12a. an unlisted number');
    }
    await endMsg();
    ok(T0().state === 'none' && T0().tab === 1 && !snapshot().open, '12a. displayed 0: none, still tab 1');
    hud.config.ccActive.unlistedPullsTab = true;
    clean();
    truth(true, true, null);
    feedAct(926);
    await sleep(400);
    ok(T0().state === 'window' && snapshot().open && T0().tab === 2 && T0().page.kind === 'pointer', '12b. unlistedPullsTab true: the same number pulls tab 2 with the pointer page (SPEC-R3 5.1)');
    noViolations('12b. the pull on');
    await endMsg();
    hud.config.ccActive.unlistedPullsTab = false;
    clean();
    truth(true, true, null);
    feedList(L(E.door)); feedAct(65535);
    await sleep(400);
    ok(T0().state === 'window' && snapshot().open && T0().tab === 2 && T0().page.kind === 'pointer', '12c. 65535 (unknown) with a message in the list still pulls tab 2 (the pointer page)');
    noViolations('12c. unknown with a listed message');
    none(); feedList(L(E.rest)); feedAct(0); await sleep(250);
    clean();
    truth(true, true, E.door); feedList(L(E.rest, E.door)); feedAct(15);
    await until(() => T0().state === 'ours', 1500);
    truth(true, true, null); feedAct(285);                  // the car at 13:41: an unlisted number over a listed one
    await sleep(400);
    ok(T0().state === 'window' && snapshot().open && T0().tab === 2 && T0().page.kind === 'pointer', '12d. 285 over a listed message that already pulled tab 2: the window opens, tab 2 stays (no new pull), the pointer page');
    noViolations('12d. unlisted over listed');
    none(); feedList(L(E.rest)); feedAct(0); await sleep(250);
    ok(T0().state === 'none' && T0().tab === 1, '12d. the end: tab 1 again');

    // ---- case 11: the audit itself ------------------------------------------------------------------------------------
    ok(model.frames >= 50, '11. the pixel audit ran on ' + model.frames + ' frames');
    const seen = (re) => model.trace.some((x) => re.test(x.tr));
    ok(seen(/^CRPSo2/) && seen(/^--POw2/) && seen(/^CRbSn1/) && seen(/^--bOw1/) && seen(/^--xOw2/),
        '11. the trace saw ours (card, window shut, row back), the card with the window open, the row alone, BMW\'s panel alone, the old card kept under the open window (' + model.trace.length + ' states)');

    // ---- the mutants: the audit must fail when the engine is broken -----------------------------------------------------
    const mutant = async (what, apply, restore, play) => {
        clean();
        apply();
        try { await play(); } finally { restore(); }
        const n = model.violations.length;
        ok(n > 0, 'mutant: ' + what + ' - the audit saw ' + n + ' violation' + (n === 1 ? '' : 's') + (n ? ' (first: ' + model.violations[0].w + ')' : ''));
        clean();
        none(); feedAct(0); await sleep(300); feedAct(0); await sleep(100);
        if (hud.activeName !== 'twin_cc') { press('hudLayout', 'twin_cc'); await until(() => hud.activeName === 'twin_cc', 3000); await sleep(200); }
        clean();
    };
    feedList(L(E.door, E.boot, E.tyre));
    await sleep(100);
    {
        const live = hud._ccLiveSync;
        await mutant('the bottom row never steps aside', () => { hud._ccLiveSync = () => {}; hud._ccHidden = () => false; }, () => { hud._ccLiveSync = live; delete hud._ccHidden; hud._ccPush(); },
            async () => { truth(true, true, E.boot); feedAct(14); await sleep(400); });
    }
    {
        const sync = hud._twinSync, holes = hud._twinHoles, send = hud._twinSheetSend;
        await mutant('the window never opens, our card goes up late', () => {
            hud._twinSync = () => {}; hud._twinHoles = () => {};
            hud._twinSheetSend = function (x, op, buf) { setTimeout(() => send.call(hud, x, op, buf), 300); };
        }, () => { hud._twinSync = sync; hud._twinHoles = holes; hud._twinSheetSend = send; hud._ccPush(); }, async () => { truth(true, true, E.tyre); feedAct(50); await sleep(600); });
    }
    {
        const send = hud._twinSheetSend;
        await mutant('a stale card stays (the sheet is never repainted when M arrives)', () => {}, () => { hud._twinSheetSend = send; hud._ccPush(); }, async () => {
            truth(true, true, E.door); feedAct(15);
            await until(() => T0().state === 'ours', 1500);
            hud._twinSheetSend = function () { return undefined; };
            feedList(L(E.door, E.boot, E.tyre, E.brake));
            truth(true, true, E.brake); feedAct(42);
            await sleep(500);
        });
    }
    {
        const buf = hud._twinSheetBuf;
        await mutant('the card is painted for the WRONG message', () => {
            hud._twinSheetBuf = function (page) {
                const p = page.card && page.card.key ? Object.assign({}, page, { card: Object.assign({}, page.card, { lines: ['Stale words'], bases: [424] }) }) : page;
                return buf.call(hud, p);
            };
        }, () => { hud._twinSheetBuf = buf; hud._ccPush(); }, async () => { truth(true, true, E.boot); feedAct(14); await sleep(500); });
    }
    await mutant('the 150 ms waits removed (the window shuts on the card\'s own turn; the centre drops it when the tab is left)', () => { T0().settleMs = 0; T0().openSettleMs = 0; },
        () => { T0().settleMs = 150; T0().openSettleMs = 150; }, async () => {
            truth(true, true, E.door); feedAct(15);
            await sleep(300);
            hud._twinTabChosen(1, 'driver');
            await sleep(300);
            hud._twinTabChosen(2, 'driver');
            await sleep(100);
        });
    await mutant('the bottom row left on connection 2 (the window on 0)', () => { press('hudLayout', 'twin_cc_c'); }, () => {}, async () => {
        await until(() => hud.activeName === 'twin_cc_c', 3000);
        await sleep(300);
        truth(true, true, E.door); feedAct(15); await sleep(400);
    });

    // ---- budgets and the log -------------------------------------------------------------------------------------------
    const perApp = {};
    st.layers.forEach((l) => { if (l.kind !== 'asset') perApp[l.app] = (perApp[l.app] || 0) + 1; });
    ok(Object.keys(perApp).every((a) => perApp[a] <= 8) && st.peak <= 16 * 1048576, 'the service\'s own limits hold (layers per connection ' + JSON.stringify(perApp) + ', peak pixel memory ' + (st.peak / 1048576).toFixed(2) + ' MiB)');
    ok(!logs.some((l) => /^ERROR/.test(l)), 'the engine logged no error (' + logs.filter((l) => /^ERROR/.test(l)).slice(0, 2).join(' | ') + ')');
    const text = logs.join('\n');
    ok(!/Driver door|Boot lid|Brake fault|tyre pressure|Washer fluid|Stored notice|Πόρτα/i.test(text.replace(/layer "[^"]*"/g, '')), 'no message text ever reached the log (' + logs.length + ' lines checked)');
    ok(/cc: centre ours, tab 2, page card \(our text for the shown message is on the screen\)/.test(text) && /cc: centre window, tab 1, page other \(the driver left tab 2/.test(text),
        'the log has the centre\'s own lines ("cc: centre ours, tab 2, page card ...", "... the driver left tab 2 ...")');
    // car-fix CF1: (the D7 line "this is the message that confirmed" is gone with confirmNow) the unknown and the dead-active lines
    ok(/cc: id 65535 colour - name len 0 shown-now 65535 → window \(the "shown now" number is unknown \(65535\)\)/.test(text) &&
        /active cc: wired - not the "shown now" source \(config\.ccActive\.source displayed, dead\)/.test(text) && !/D7: this is the message that confirmed/.test(text),
        'and the car-fix lines: "cc: id 65535 ... → window (the "shown now" number is unknown (65535))", "active cc: wired - not the "shown now" source (..., dead)"');

    hud.stop();
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    if (process.env.TWIN_CC_TRACE) console.log(model.trace.map((x) => x.tr).join(' '));
}

(async () => {
    try {
        unitChecks();
        machineChecks();
        modelChecks();
        tabFillChecks();
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
