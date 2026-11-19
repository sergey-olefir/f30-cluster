'use strict';
/**
 * test-front-vehicle.js - the vehicle ahead, Twin Dial's test mode (front-vehicle FV; docs/twin-dial/FV-SPEC.md).
 *
 *   node bench/test-front-vehicle.js [--no-bench] [--no-cc]          (BENCH_PORT, default 8963; this agent's ports are 8960-8969)
 *
 * Part 1, the decoder (shared/front_vehicle.js) on its own, with an injected clock: the raw values the car showed (57..1736 while
 *   driving, 4093 parked), the "none" values and the qualifier, five levels by the time gap at our speed (distance when slow), a
 *   jittery gap that must not make the level flicker (hysteresis), one spike (the median), a cut-in (another object id), closing
 *   from the gap's slope and never from speedX, silence (stale -> no target, never a frozen car), nothing at all (absent), the
 *   calibrated scale (only then a number), the log (numbers and our own words, rate-limited, capped).
 * Part 2, the pictures (shared/twin_front.js) on their own: every string in Twin Dial's own atlases (Cyrillic included), every
 *   state painted inside its layer, never red, amber only for "closing fast", the car's depth follows the level, the glide moves
 *   in a few frames and never overshoots, the pictogram's rungs count the level, its layer is clear of every keep-out.
 * Part 3, the real app on a bench (bench/server.js twin_dial, bounded): the test OFF = no subscription, no layer, the layout as
 *   0.1.4 builds it; ON = the late watch, one more layer on connection 2 (the budget: <= 8 a connection, pixel memory), every
 *   state walked through POST /fake {front} and read back from GET /probe, the page on tab 1 and the pictogram, the bytes the
 *   two layers upload while a car is followed (BENCH_TRACE), OFF again = the layer gone, the values ignored.
 * Part 4, the message machine with the mode on: bench/test-twin-cc.js run twice (TWIN_CC_FV off / on), both must pass and the
 *   audit's frame traces must be the same.
 * Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const H = require('./twin-harness');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8963;
const FV = require(path.join(ROOT, 'shared', 'front_vehicle.js'));

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const GAP = [1380, 660, 1460, 720], BELT = [497, 660, 688, 720], BMW_PANEL = [696, 595.75, 1226, 704], BLACK_BOX = [1420, 320, 1611, 440];
const DFV = (gap, o) => Object.assign({ frontVehicleObjectID: 7, frontVehicleSpeedX: 1500, frontVehicleSpeedY: 4095, frontVehicleGapX: gap, frontVehicleGapY: 4095,
    qualifierEventDataFunctionFrontVehicle: 0, qualifierExtendedFunctionFrontVehicle: 0 }, o || {});

/* ===================================================================================================================== */
function decoderChecks() {
    console.log('the decoder (shared/front_vehicle.js)');
    const cfg = FV.cfgOf({});
    // ---- one value
    const r = (gap, o) => FV.readOf(cfg, DFV(gap, o));
    ok(r(57).ok && r(1736).ok && r(57).gap === 57 && r(1736).speed === 1500 && r(420).obj === 7, 'the car\'s driving range 57..1736 is a target (raw numbers kept)');
    ok(!r(4093).ok && r(4093).why === 'none value' && !r(4095).ok && !r(4094).ok, '4093 (parked), 4094 and 4095 (the catalogue\'s default) are no target');
    ok(!r(420, { qualifierEventDataFunctionFrontVehicle: 2 }).ok && !r(420, { qualifierEventDataFunctionFrontVehicle: 'EVENT_DATA_NOT_AVAILABLE' }).ok &&
        r(420, { qualifierEventDataFunctionFrontVehicle: 1 }).ok && r(420, { qualifierEventDataFunctionFrontVehicle: 15 }).ok,
        'the qualifier NOT_AVAILABLE (2, by number or name) is no target; REDUCED (1) and the unfilled 15 do not veto a gap');
    ok(!FV.readOf(cfg, null).ok && !FV.readOf(cfg, 'x').ok && !FV.readOf(cfg, {}).ok && FV.readOf(cfg, DFV('420')).ok && !r(0).ok && !r(5000).ok,
        'no struct, no gap, 0 and out of range: no target; a numeric string is read');
    // ---- the scale: no number without a calibration
    ok(FV.metresOf(cfg, 420, true) === null && Math.abs(FV.metresOf(cfg, 420, false) - 42) < 1e-9 && FV.metresOf(FV.cfgOf({ scale: 0.05 }), 420, true) === 21,
        'no calibrated scale: no metres (the assumed 0.1 m only places the level); scale 0.05: 420 -> 21 m');
    ok(FV.metresOf(FV.cfgOf({ nearer: 'larger' }), 4000, false) < FV.metresOf(FV.cfgOf({ nearer: 'larger' }), 1000, false), 'nearer "larger" flips the sense (a key, if the log shows the assumption wrong)');
    // ---- levels: time gap at speed, distance when slow
    const lv = (gap, kmh) => FV.rawLevel(cfg, FV.metresOf(cfg, gap, false), kmh);
    ok([900, 600, 400, 280, 150].map((g) => lv(g, 87).level).join() === '5,4,3,2,1' && lv(400, 87).mode === 'time',
        'at 87 km/h the gaps 900 / 600 / 400 / 280 / 150 are levels 5..1 (time gap 3.7 / 2.5 / 1.65 / 1.16 / 0.62 s)');
    ok([700, 400, 200, 100, 50].map((g) => lv(g, 10).level).join() === '5,4,3,2,1' && lv(400, 10).mode === 'dist' && lv(400, null).mode === 'dist',
        'below 20 km/h (or speed unknown) by distance: 70 / 40 / 20 / 10 / 5 m are levels 5..1');
    ok(lv(400, 40).level > lv(400, 120).level, 'the same gap is a farther level at a lower speed (a time gap)');
    // ---- the tracker
    let t = 0;
    const clock = () => t;
    const lines = [];
    const mk = (c) => { const k = FV.create(Object.assign({ maxLines: 5000 }, c || {}), { clock, log: { info: (s) => lines.push(s) } }); k.start(); return k; };
    let k = mk();
    const feedAt = (gap, kmh, dt, o) => { t += dt === undefined ? 100 : dt; k.feed(DFV(gap, o), kmh === undefined ? 87 : kmh); return k.view(kmh === undefined ? 87 : kmh); };
    let v = feedAt(400);
    ok(v.present && v.level === 3 && v.state === 'seen' && v.closing === 0 && v.metres === null && v.timeGap === null && v.word === 'середньо',
        'a target at 400: present, level 3, "seen", no number (metres / timeGap null), the word "середньо"');
    // jitter around the 2.0 s boundary (level 3 | 4): +-6 % never moves it
    let changes = 0, last = v.level;
    for (let i = 0; i < 300; i++) {
        const g = Math.round(483 * (1 + 0.06 * Math.sin(i * 2.3) * ((i % 3) - 1)));          // 2.0 s at 87 km/h = 48.3 m
        v = feedAt(g);
        if (v.level !== last) { changes++; last = v.level; }
    }
    ok(changes <= 1, 'a gap jittering +-6 % around a level boundary for 30 s: the level moved ' + changes + ' time(s) (hysteresis 12 %, median of 3)');
    k = mk(); t += 1000;
    feedAt(400); feedAt(400);
    v = feedAt(60);
    const v2 = feedAt(400);
    ok(v.level === 3 && v2.level === 3 && v2.closing === 0, 'one spike (60 among 400s) moves nothing (the median of 3)');
    k = mk();
    for (let i = 0; i < 5; i++) v = feedAt(900);
    for (let i = 0; i < 5; i++) v = feedAt(150);
    const jump = v.state;
    for (let i = 0; i < 20; i++) v = feedAt(150);
    ok(v.level === 1 && jump === 'fast' && v.state === 'near', 'a real move (900 -> 150 in half a second) is followed: level 1, "fast" while it shrinks, then "near"');
    // closing: from the gap's slope, never from speedX
    k = mk();
    for (let i = 0; i < 20; i++) v = feedAt(400, 87, 100, { frontVehicleSpeedX: i % 2 ? 100 : 3000 });
    ok(v.closing === 0 && v.state === 'seen', 'a steady gap with speedX swinging 100..3000: not closing (speedX is not read)');
    k = mk();
    for (let i = 0; i < 20; i++) v = feedAt(420 - i * 2);           // 0.2 m in 0.1 s = 2 m/s
    ok(v.closing === 1 && v.state === 'closing' && Math.abs(v.rate - 2) < 0.2, 'the gap shrinking 2 m/s: "closing" (rate ' + (v.rate && v.rate.toFixed(2)) + ' m/s)');
    for (let i = 0; i < 20; i++) v = feedAt(380 + i * 2);
    ok(v.closing === 0, 'the gap opening again: not closing');
    k = mk();
    for (let i = 0; i < 20; i++) v = feedAt(700 - i * 8);            // 8 m/s
    ok(v.closing === 2 && v.state === 'fast', 'the gap shrinking 8 m/s: "fast"');
    k = mk();
    for (let i = 0; i < 20; i++) v = feedAt(100 - i * 2);            // 2 m/s ending at 6.2 m: time to reach it 3.1 s
    ok(v.closing === 2, 'shrinking 2 m/s at under 8 m (time to collision < 4 s): "fast"');
    k = mk();
    for (let i = 0; i < 10; i++) v = feedAt(600, 87, 100, { frontVehicleObjectID: 7 });
    for (let i = 0; i < 3; i++) v = feedAt(200, 87, 100, { frontVehicleObjectID: 9 });
    ok(v.closing === 0 && v.present, 'a cut-in (another object id at 20 m after 60 m): the history starts again, no false "fast"');
    // silence and nothing
    k = mk();
    v = feedAt(400);
    t += 1900; v = k.view(87);
    ok(v.present && !v.stale, 'silent 1.9 s: still the car');
    t += 200; v = k.view(87);
    ok(!v.present && v.stale && v.state === 'none' && v.level === 0, 'silent over staleMs (2 s): no target, stale - never a frozen car');
    v = feedAt(400);
    ok(v.present, 'a value again: the car again');
    v = feedAt(4093);
    ok(!v.present && v.state === 'none' && !v.stale, '4093 arrives: no target (not stale)');
    k = mk();
    t += 9000; v = k.view(87);
    ok(v.state === 'none' && !v.absent, 'nothing for 9 s after the start: no target yet');
    t += 1500; v = k.view(87);
    ok(v.state === 'absent' && v.absent && !v.present, 'nothing for 10 s: "absent" (the page says "Немає даних")');
    v = feedAt(4093);
    ok(v.state === 'none' && !v.absent, 'then a value (none): no longer absent');
    // the calibrated scale: numbers only now
    k = mk({ scale: 0.1 });
    v = feedAt(400);
    ok(Math.abs(v.metres - 40) < 1e-9 && Math.abs(v.timeGap - 40 / (87 / 3.6)) < 1e-9, 'scale 0.1 (calibrated): 40 m, time gap ' + v.timeGap.toFixed(2) + ' s');
    v = feedAt(400, 10);
    ok(v.timeGap === null && v.metres === 40, 'below 20 km/h no time gap (the metres stay)');
    // off
    k.stop();
    v = k.view(87);
    const before = k.state().got;
    k.feed(DFV(400), 87);
    ok(v.state === 'off' && !v.present && k.state().got === before, 'stopped: "off", values ignored');
    // the log
    lines.length = 0;
    t += 10000;
    k = mk();
    for (let i = 0; i < 100; i++) feedAt(i % 2 ? 150 : 900, 87, 10);     // a target flipping between 15 m and 90 m in one second
    t += 1000; k.view(87);
    const fl = lines.filter((s) => /^fv: (seen|near|none|closing|fast|absent)/.test(s));
    ok(fl.length <= 3, 'a state flipping 100 times in a second: ' + fl.length + ' line(s) (one a second at most)');
    for (let i = 0; i < 60; i++) feedAt(400, 87, 100);
    const holds = lines.filter((s) => /^fv: hold /.test(s));
    ok(holds.length >= 1 && holds.length <= 2, 'following one car for 6 s: ' + holds.length + ' "hold" sample line(s) (every 5 s, for the calibration)');
    const re = /^fv: (on \(GapVehicleAhead\.DataFrontVehicle; none [\d/]+, scale [\w.]+, assumed [\d.]+, stale \d+ ms\)|off( \([a-z ]+\))?|(hold )?(off|absent|none|seen|near|closing|fast) level \d gap [\d.-]+ speed [\d.-]+ obj [\d.-]+ q [\w.-]+\/[\w.-]+ v [\d.-]+ rate [\d.-]+ n \d+)$/;
    ok(lines.length > 3 && lines.every((s) => re.test(s)), 'every line is numbers and our own words only (' + lines.length + ' lines; e.g. "' + lines.filter((s) => /level/.test(s))[0] + '")');
    const cap = FV.create({ maxLines: 5 }, { clock, log: { info: (s) => lines.push(s) } });
    const n0 = lines.length;
    cap.start();
    for (let i = 0; i < 50; i++) { t += 1500; cap.feed(DFV(i % 2 ? 150 : 900), 87); cap.view(87); }
    ok(lines.length - n0 === 5, 'the lines stop at maxLines (5 here, 1800 by default)');
    // Node 8: no syntax the car's Node lacks
    [path.join(ROOT, 'shared', 'front_vehicle.js'), path.join(ROOT, 'shared', 'twin_front.js')].forEach((f) => {
        const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
        ok(!/\?\.|\?\?|\.\.\.[a-zA-Z_({[]|catch\s*\{|\.flat\(|Object\.fromEntries|\b\d+n\b/.test(src), path.basename(f) + ': Node 8 syntax only (no ?. ?? spread, optional catch, flat, fromEntries, bigint)');
    });
}

/* ===================================================================================================================== */
function pictureChecks() {
    console.log('the pictures (shared/twin_front.js)');
    const dir = H.tree('twin_dial');
    const TF = require(path.join(dir, 'twin_front.js'));
    const textRaster = require(path.join(dir, 'hud_text.js'));
    const { THEMES } = require(path.join(dir, 'hud_themes.js'));
    const theme = THEMES.twin;
    // fonts
    const atl = (n) => textRaster.loadFont(n).metrics.glyphs;
    const fonts = Object.keys(TF.FONTS).map((k) => TF.fontName(k));
    ok(fonts.every(Boolean) && fonts.join() === 'td_title,td_body,td_val', 'the page uses Twin Dial\'s own atlases only: ' + fonts.join(', '));
    const miss = [];
    TF.STRINGS.forEach((s) => Array.from(s).forEach((ch) => { if (ch !== ' ' && fonts.some((f) => !atl(f)[ch])) miss.push(ch); }));
    ok(!miss.length, 'every letter of every string (' + TF.STRINGS.length + ' strings, Cyrillic included) is in all three atlases' + (miss.length ? ': missing ' + miss.join('') : ''));
    // the page in every state
    const L = { x: 729, y: 248, w: 462, h: 347 };
    const V = {
        absent: { state: 'absent', present: false }, none: { state: 'none', present: false }, stale: { state: 'none', present: false, stale: true },
        l5: { state: 'seen', present: true, level: 5, closing: 0, word: 'далеко' }, l4: { state: 'seen', present: true, level: 4, closing: 0, word: 'далеко' },
        l3: { state: 'seen', present: true, level: 3, closing: 0, word: 'середньо' }, l2: { state: 'seen', present: true, level: 2, closing: 0, word: 'близько' },
        l1: { state: 'near', present: true, level: 1, closing: 0, word: 'близько' }, closing: { state: 'closing', present: true, level: 2, closing: 1, word: 'близько' },
        fast: { state: 'fast', present: true, level: 1, closing: 2, word: 'близько' }, calibrated: { state: 'seen', present: true, level: 3, closing: 0, word: 'середньо', timeGap: 1.84, metres: 44.5 },
    };
    const cruise = { s: 'круїз 90 км/год', c: 'ready' };
    const red = (b) => { let n = 0; for (let i = 0; i < b.length; i += 4) { const a = b[i + 3]; if (a > 40 && b[i] > 140 && b[i + 1] < 90 && b[i + 2] < 90) n++; } return n; };
    const amberN = (b) => { let n = 0; for (let i = 0; i < b.length; i += 4) { if (b[i + 3] > 40 && b[i] > 180 && b[i + 1] > 110 && b[i + 1] < 200 && b[i + 2] < 60) n++; } return n; };
    const P = {};
    Object.keys(V).forEach((k) => { P[k] = TF.paintPage(L, theme, V[k], V[k].level || null, cruise); });
    ok(Object.keys(P).every((k) => P[k].ink.every((i) => i.box[0] >= L.x - 1 && i.box[2] <= L.x + L.w + 1 && i.box[1] >= L.y - 1 && i.box[3] <= L.y + L.h + 8)),
        'every item of every state is inside the page layer [729, 248, 462 x 347] (our own car is cut by its bottom edge)');
    ok(Object.keys(P).every((k) => red(P[k].buf) === 0), 'no state has a red pixel (no brake or warning look of ours)');
    ok(Object.keys(P).every((k) => (k === 'fast') === (amberN(P[k].buf) > 50)), 'amber only for "closing fast" (' + amberN(P.fast.buf) + ' px there)');
    const ids = (k) => P[k].ink.map((i) => i.id);
    ok(ids('absent').indexOf('none') >= 0 && ids('absent').indexOf('car') < 0 && ids('none').indexOf('note') >= 0 && ids('none').indexOf('car') < 0 &&
        Buffer.compare(P.none.buf, P.stale.buf) === 0, 'absent: "Немає даних"; no target: "Авто не видно", no car; stale is the no-target picture, pixel for pixel');
    const carBottom = (k) => P[k].ink.filter((i) => i.id === 'car')[0].box[3];
    ok(carBottom('l1') > carBottom('l2') && carBottom('l2') > carBottom('l3') && carBottom('l3') > carBottom('l4') && carBottom('l4') > carBottom('l5'),
        'the car ahead sits farther up the lane as the level grows (wheel line ' + ['l1', 'l2', 'l3', 'l4', 'l5'].map(carBottom).map(Math.round).join(' > ') + ')');
    const rungs = (k) => ids(k).filter((i) => /^rung/.test(i)).length;
    ok(['l1', 'l2', 'l3', 'l4', 'l5'].map(rungs).join() === '1,2,3,4,5', 'the rungs of the measured gap: one per level (1..5)');
    ok(ids('closing').filter((i) => /^chev/.test(i)).length === 1 && ids('fast').filter((i) => /^chev/.test(i)).length === 2 && ids('l2').filter((i) => /^chev/.test(i)).length === 0,
        'closing: one chevron, fast: two, steady: none');
    ok(ids('l3').indexOf('gap') >= 0 && ids('l3').indexOf('cruise') >= 0 && TF.gapText(V.calibrated).s === '1.8 с · середньо' && TF.gapText(V.l3).s === 'середньо',
        'the meta line: the gap in words (a number only with the calibrated scale: "1.8 с · середньо") and the cruise set speed');
    const gapBox = P.l3.ink.filter((i) => i.id === 'gap')[0].box, cruBox = P.l3.ink.filter((i) => i.id === 'cruise')[0].box;
    ok(gapBox[2] < cruBox[0], 'the gap word and the cruise text never touch (' + Math.round(cruBox[0] - gapBox[2]) + ' px apart)');
    const limP = TF.paintPage(L, theme, V.l3, 3, { s: 'обмежувач 110 км/год', c: 'ready' });
    const lg = limP.ink.filter((i) => i.id === 'gap')[0].box, lc = limP.ink.filter((i) => i.id === 'cruise')[0].box;
    ok(lg[2] + 8 < lc[0], 'a long limiter text beside "середньо" drops its unit and still keeps clear (' + Math.round(lc[0] - lg[2]) + ' px)');
    // night: the theme's roles at their multipliers dim the whole picture
    const night = {}; Object.keys(theme).forEach((k) => { night[k] = theme[k]; });
    [['fg', 0.8], ['dim', 0.75], ['amber', 0.8], ['grey', 0.55], ['ready', 0.75]].forEach((p) => { night[p[0]] = theme[p[0]].map((c, i) => (i < 3 ? Math.round(c * p[1]) : c)); });
    const maxOf = (b) => { let m = 0; for (let i = 0; i < b.length; i += 4) if (b[i + 3] > 200) m = Math.max(m, b[i], b[i + 1], b[i + 2]); return m; };
    ok(maxOf(TF.paintPage(L, night, V.l3, 3, cruise).buf) <= 204 && maxOf(P.l3.buf) === 255, 'by night the page takes the theme\'s night roles (white 255 -> 204)');
    // the glide
    const s = { p: null };
    const path1 = [];
    TF.glide(s, V.l1, 0);
    for (let i = 1; i <= 8; i++) path1.push(TF.glide(s, V.l5, i * 150));
    const reach = path1.indexOf(5);
    ok(reach >= 2 && reach <= 6 && path1.every((p, i) => p <= 5 && (i === 0 || p >= path1[i - 1])), 'the glide 1 -> 5: ' + path1.map((p) => p.toFixed(2)).join(' ') + ' (there in ' + (reach + 1) + ' frames of 150 ms, never past it)');
    ok(TF.glide({ p: 3 }, V.none, 0) === null && TF.glide({ p: null }, V.l4, 0) === 4, 'no target: no position; a new target appears at its level at once');
    // the pictogram
    const I = TF.ICONB;
    const box = [I.x, I.y, I.x + I.w, I.y + I.h];
    ok(I.w % 4 === 0 && ![GAP, BELT, BMW_PANEL, BLACK_BOX].some((b) => hit(box, b)), 'the pictogram\'s layer [' + box.join(', ') + ']: width a multiple of 4, clear of the gear gap, the belt group, BMW\'s panel and the black box');
    const lay = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));
    const wi = lay.widgets.filter((w) => w.type === 'tdfv')[0];
    ok(wi && wi.x === I.x && wi.y === I.y && wi.w === I.w && wi.h === I.h && wi.conn === 2 && wi.toggle === 'fv:on', 'the layout\'s fv_icon is that rect, on connection 2, toggled by "fv:on" (design/gen_twin.py)');
    const IC = {};
    Object.keys(V).forEach((k) => { IC[k] = TF.paintIcon(I, theme, V[k]); });
    const any = (b) => { for (let i = 3; i < b.length; i += 4) if (b[i]) return true; return false; };
    ok(!any(IC.none.buf) && !any(IC.absent.buf) && !any(IC.stale.buf), 'no target, stale or absent: the pictogram is empty (the hub as it was)');
    ok(['l1', 'l2', 'l3', 'l4', 'l5'].every((k, i) => IC[k].ink.filter((x) => /^rung/.test(x.id)).length === i + 1) &&
        Object.keys(IC).every((k) => IC[k].ink.every((x) => x.box[0] >= I.x && x.box[1] >= I.y - 0.5 && x.box[2] <= I.x + I.w && x.box[3] <= I.y + I.h)) &&
        Object.keys(IC).every((k) => red(IC[k].buf) === 0) && amberN(IC.fast.buf) > 20 && amberN(IC.l3.buf) === 0,
        'the pictogram: rungs = the level, everything inside its layer, never red, amber only when closing fast');
}

/* ===================================================================================================================== */
function req(method, url, body, timeout) {
    return new Promise((resolve) => {
        const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
        const r = http.request({ host: '127.0.0.1', port: PORT, path: url, method, timeout: timeout || 8000, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
            const ch = [];
            res.on('data', (d) => ch.push(d));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(ch) }));
        });
        r.on('error', () => resolve(null));
        r.on('timeout', () => { r.destroy(); resolve(null); });
        if (data) r.write(data);
        r.end();
    });
}
const probe = async () => { const r = await req('GET', '/probe'); try { return r && r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null; } catch (e) { return null; } };
const post = (u, b) => req('POST', u, b);
async function until(fn, ms) {
    const end = Date.now() + ms;
    let p = null;
    while (Date.now() < end) { p = await probe(); try { if (p && fn(p)) return p; } catch (e) { /* not yet */ } await sleep(200); }
    return null;
}
/** The full scene (GET /events sends it first). */
function scene() {
    return new Promise((resolve) => {
        const r = http.get({ host: '127.0.0.1', port: PORT, path: '/events', timeout: 8000 }, (res) => {
            let buf = '';
            res.on('data', (d) => {
                buf += d.toString('utf8');
                const i = buf.indexOf('data: {"t":"scene"');
                if (i >= 0) { const j = buf.indexOf('\n', i); if (j > 0) { r.destroy(); try { resolve(JSON.parse(buf.slice(i + 6, j))); } catch (e) { resolve(null); } } }
            });
        });
        r.on('error', () => resolve(null));
        r.on('timeout', () => { r.destroy(); resolve(null); });
    });
}
function layersOf(sc) {
    // the scene's layers carry their app name per connection: twin_dial (0), twin_dial_2 (1), twin_dial_3 (2)
    const per = {}, rects = [];
    (sc && sc.layers || []).forEach((l) => {
        if (l.kind === 'asset') return;
        const m = /_(\d+)$/.exec(String(l.app || '')), conn = String(m ? Number(m[1]) - 1 : 0);
        per[conn] = (per[conn] || 0) + 1;
        if (isFinite(l.x) && isFinite(l.w)) rects.push({ key: l.key, conn, kind: l.kind, r: [l.x, l.y, l.x + l.w, l.y + l.h] });
    });
    return { per, rects, n: Object.keys(per).reduce((a, k) => a + per[k], 0) };
}

async function benchChecks() {
    console.log('the real app on a bench (port ' + PORT + ')');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-bench-'));
    const data = path.join(tmp, 'data'), stop = path.join(tmp, 'STOP'), logf = path.join(tmp, 'bench.log'), trace = path.join(tmp, 'trace.jsonl');
    fs.mkdirSync(data);
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: data, BENCH_TRACE: trace });
    const kid = spawn('python3', ['-I', path.join(ROOT, 'tools', 'shots', 'bounded.py'), '900', stop, logf, '--', 'node', path.join(ROOT, 'bench', 'server.js'), 'twin_dial'],
        { cwd: ROOT, env, stdio: 'ignore' });
    const logText = () => { try { return fs.readFileSync(logf, 'utf8'); } catch (e) { return ''; } };
    try {
        let p = await until((q) => q.ready && q.activeName === 'twin' && /layout "Twin Dial": \d+ widgets/.test(logText()), 120000);
        ok(!!p, 'the bench is up with Twin Dial');
        if (!p) { console.log(logText().split('\n').slice(-15).join('\n')); return; }
        await post('/signals', { mode: 'manual', values: { speed: 87, rpm: 2300, gear: 3, engine: 2, condition: 10 } });
        await sleep(1500);
        // ---- OFF: as 0.1.4
        let sc = await scene(), L0 = layersOf(sc);
        p = await probe();
        ok(p.settings.diagFrontVehicle === false && !p.fv && !/GapVehicleAhead/.test(logText()) && !L0.rects.some((x) => x.r[0] === 1504 && x.r[1] === 250),
            'the test OFF (the default): no tracker, no watch of GapVehicleAhead, no pictogram layer');
        ok(L0.n === 14 && L0.per['0'] === 7 && L0.per['1'] === 4 && L0.per['2'] === 3, 'off: 14 layers, 7 / 4 / 3 per connection (0.1.4\'s budget, unchanged): ' + JSON.stringify(L0.per));
        const px0 = sc.pixels;
        // ---- ON: the late watch, the layer, the budget
        await post('/click', { id: 'SET_DIAGFRONTVEHICLE' });
        p = await until((q) => q.fv && q.fv.on && q.fv.icon && q.fv.page === 'front', 20000);
        ok(!!p && p.fv.subscribed === 'late' && /fv: watch GapVehicleAhead\.DataFrontVehicle ok/.test(logText()) && /diag: diagFrontVehicle on/.test(logText()),
            'switched ON: the field is watched late (once), tab 1 shows the page "front", the pictogram is built');
        await sleep(800);
        sc = await scene();
        const L1 = layersOf(sc);
        ok(L1.n === 15 && L1.per['0'] === 7 && L1.per['1'] === 4 && L1.per['2'] === 4, 'on: 15 layers, 7 / 4 / 4 (one more on connection 2; at most 8 each): ' + JSON.stringify(L1.per));
        const pxMore = isFinite(sc.pixels) && isFinite(px0) ? sc.pixels - px0 : null;
        ok(pxMore !== null && pxMore <= 64 * 68 * 4 * 2 + 64 && sc.pixels <= 6 * 1048576, 'pixel memory: +' + pxMore + ' bytes (the 64 x 68 sheet, counted twice), ' + (sc.pixels / 1048576).toFixed(2) + ' MiB in all (<= 6 MiB)');
        const icon = L1.rects.filter((x) => x.r[0] === 1504 && x.r[1] === 250 && x.r[2] === 1568 && x.r[3] === 318);
        ok(icon.length === 1 && icon[0].conn === '2' && icon[0].kind === 'image' && !L1.rects.some((x) => x.kind === 'image' && (hit(x.r, GAP) || hit(x.r, BELT))) && !hit(icon[0].r, BLACK_BOX),
            'the pictogram is one image layer [1504, 250, 64 x 68] on connection 2; no image layer meets the gear gap or the belt group, the pictogram not the black box');
        // ---- every state, through the field
        const feed = (gap, o) => post('/fake', { front: Object.assign({ gap, speed: 1500, obj: 7 }, o || {}) });
        const view = async () => { const q = await probe(); return q && q.fv && q.fv.view; };
        await sleep(10500);
        let vw = await view();
        ok(vw && vw.state === 'absent', 'nothing fed for 10 s after the watch: "absent" (' + (vw && vw.state) + ')');
        await feed(4093, { speed: 4093, obj: 255, qual: 2 });
        await sleep(400);
        vw = await view();
        ok(vw && vw.state === 'none' && !vw.present, 'the parked 4093: no target');
        const states = [];
        for (const [gap, want] of [[900, 5], [600, 4], [400, 3], [280, 2], [150, 1]]) {
            for (let i = 0; i < 4; i++) { await feed(gap); await sleep(110); }
            await sleep(300);
            vw = await view();
            states.push(vw ? vw.level : null);
        }
        p = await probe();
        ok(states.join() === '5,4,3,2,1' && ['near', 'fast'].indexOf(p.fv.view.state) >= 0, 'levels walked 5..1 through the field at 87 km/h: ' + states.join(' ') + ' (level 1: ' + p.fv.view.state + ', the jump in is closing)');
        for (let i = 0; i < 20; i++) { await feed(320 - i * 2); await sleep(100); }      // 2 s: the window (1.5 s) holds only the run, not the jump into it
        vw = await view();
        ok(vw && vw.closing === 1 && vw.state === 'closing', 'the gap shrinking about 0.2 m a value (1-2 m/s): "closing" (' + (vw && vw.state + ', rate ' + vw.rate) + ')');
        for (let i = 0; i < 20; i++) { await feed(480 - i * 12); await sleep(100); }
        vw = await view();
        ok(vw && vw.closing === 2 && vw.state === 'fast', 'shrinking 1.2 m a value: "fast" (' + (vw && vw.state + ', rate ' + vw.rate) + ')');
        await sleep(2600);
        vw = await view();
        ok(vw && vw.state === 'none' && vw.stale, 'silent 2.6 s: no target, stale (the pictogram and the page drop the car by themselves)');
        // ---- the upload while a car is followed: the trace's image frames of the page and the pictogram
        for (let i = 0; i < 20; i++) { await feed(400); await sleep(100); }          // the car appears and settles (its first frame is not "following")
        const mark = () => ({ t: Date.now(), n: fs.readFileSync(trace, 'utf8').split('\n').length - 1 });
        const m0 = mark();
        for (let i = 0; i < 80; i++) { await feed(Math.round(400 * (1 + 0.04 * Math.sin(i * 1.9)))); await sleep(100); }       // 8 s steady, +-4 % jitter, 10 a second
        const m1 = mark();
        for (let i = 0; i <= 80; i++) { await feed(Math.round(400 + 200 * i / 80)); await sleep(100); }      // the car ahead pulls away 40 -> 60 m in 8 s (level 3 -> 4)
        for (let i = 0; i <= 80; i++) { await feed(Math.round(600 - 200 * i / 80)); await sleep(100); }      // and we close in again at 2.5 m/s ("closing", 4 -> 3)
        const m2 = mark();
        for (let k2 = 0; k2 < 4; k2++) for (let i = 0; i < 20; i++) { await feed(k2 % 2 ? 900 : 150); await sleep(100); }     // abrupt: the whole range (5 <-> 1) every 2 s, the worst case
        const m3 = mark();
        const tr = fs.readFileSync(trace, 'utf8').split('\n');
        // the trace's frames name their layer by connection and ref; the scene says which layer is which
        const scM = await scene(), byKey = {};
        (scM && scM.layers || []).forEach((l) => { if (l.kind === 'image') byKey[l.conn + ':' + l.ref] = [l.x, l.y, l.w, l.h].join(','); });
        const bytesIn = (from, to) => {
            let page = 0, icon = 0, other = 0;
            tr.slice(from, to).forEach((ln) => {
                if (!ln || ln.indexOf('"frame"') < 0) return;
                let m; try { m = JSON.parse(ln); } catch (e) { return; }
                if (m.op !== 'frame' || !isFinite(m.bytes)) return;
                const r = byKey[m.conn + ':' + m.ref];
                if (r === '729,248,462,347') page += m.bytes; else if (r === '1504,250,64,68') icon += m.bytes; else other += m.bytes;
            });
            return { page, icon, other };
        };
        const span = (a2, b2) => ({ b: bytesIn(a2.n, b2.n), s: (b2.t - a2.t) / 1000 });
        const U = { steady: span(m0, m1), drift: span(m1, m2), abrupt: span(m2, m3) };
        const rate = (u) => Math.round((u.b.page + u.b.icon) / u.s);
        Object.keys(U).forEach((k3) => console.log('       upload, ' + k3 + ': ' + rate(U[k3]) + ' B/s (page ' + U[k3].b.page + ' B, pictogram ' + U[k3].b.icon + ' B in ' + U[k3].s.toFixed(1) + ' s)'));
        try { fs.writeFileSync(path.join(ROOT, 'bake', 'work', 'front-vehicle', 'upload.json'), JSON.stringify(U, null, 1)); } catch (e) { /* no bake/work: only the log */ }
        ok(rate(U.steady) < 5000 && rate(U.drift) < 60000 && U.drift.b.page > 0 && U.drift.b.icon > 0 && rate(U.abrupt) < 400000,
            'the upload: a steady gap ' + rate(U.steady) + ' B/s (< 5 KB/s); drifting a level away and closing back in 16 s ' + rate(U.drift) + ' B/s (< 60 KB/s); ' +
            'the worst case, 5 <-> 1 every 2 s, ' + rate(U.abrupt) + ' B/s (< 400 KB/s; the floor is 2000 KB/s)');
        // ---- OFF again
        await post('/click', { id: 'SET_DIAGFRONTVEHICLE' });
        p = await until((q) => q.fv && !q.fv.on && !q.fv.icon && q.fv.page !== 'front', 20000);
        await sleep(800);
        sc = await scene();
        const L2 = layersOf(sc);
        const got = p && p.fv.tracker.got;
        await feed(400); await sleep(300);
        const p2 = await probe();
        ok(!!p && L2.n === 14 && L2.per['2'] === 3 && p2.fv.tracker.got === got && !p2.fv.tracker.running && /fv: off \(the subscription stays until the app restarts\)/.test(logText()),
            'switched OFF: the pictogram\'s layer is gone (14 layers), tab 1 has its own pages again, the values are ignored (the proxy stays until a restart)');
        const errs = logText().replace(/WARN layout "twin": [^\n]*/g, '').split('\n').filter((l) => /\bERROR\b|uncaught|too many layers|pixel memory is full|refused/.test(l));
        ok(!errs.length, 'the bench log has no error, no refusal' + (errs.length ? ': ' + errs.slice(0, 2).join(' | ') : ''));
        const fvLines = logText().split('\n').filter((l) => /\bfv: /.test(l));
        ok(fvLines.length > 5 && fvLines.every((l) => !/[A-Za-z]{2,}\d|text\d/.test(l.split('fv: ')[1].replace(/GapVehicleAhead\.DataFrontVehicle/, ''))), 'the app\'s "fv:" lines: ' + fvLines.length);
    } finally {
        fs.writeFileSync(stop, 'done\n');
        await new Promise((r) => { kid.on('exit', r); setTimeout(r, 15000); });
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    }
}

/* ===================================================================================================================== */
function ccChecks() {
    console.log('the message machine with the test mode on (bench/test-twin-cc.js, off and on)');
    const run = (fv) => {
        const r = spawnSync(process.execPath, [path.join(__dirname, 'test-twin-cc.js')], { cwd: ROOT, env: Object.assign({}, process.env, { TWIN_CC_TRACE: '1', TWIN_CC_FV: fv ? '1' : '0' }), encoding: 'utf8', maxBuffer: 64 << 20, timeout: 900000 });
        const out = (r.stdout || '') + (r.stderr || '');
        const all = out.match(/\n\d+ passed, \d+ failed/g) || [];          // the last one is the file's total (the model prints its own first)
        const tot = all.length ? /(\d+) passed, (\d+) failed/.exec(all[all.length - 1]) : null;
        const lines = out.split('\n');
        const trace = lines.filter((l) => /^(\S{6} )+\S{6}$/.test(l.trim()) || /^[-CRPWbxOS?a-z0-9]{6}( [-CRPWbxOS?a-z0-9]{6})*$/.test(l.trim())).pop() || '';
        return { pass: tot ? Number(tot[1]) : 0, fail: tot ? Number(tot[2]) : -1, trace: trace.trim(), fvLine: lines.filter((l) => /front-vehicle FV/.test(l)).join(' | '), out };
    };
    // the audit itself (V1..V5, every case, with the mode on) is the safety proof; the identical trace is a second one. The trace is
    // timing-sensitive on a loaded machine, so a pair that differs is run once more before it counts as a difference
    let off = run(false), on = run(true), pairs = 1;
    if (off.trace !== on.trace) { off = run(false); on = run(true); pairs = 2; }
    ok(off.fail === 0 && off.pass > 0, 'test-twin-cc.js with the test OFF: ' + off.pass + ' passed, ' + off.fail + ' failed');
    ok(on.fail === 0 && on.pass === off.pass + 1 && /ok\s+front-vehicle FV/.test(on.fvLine), 'test-twin-cc.js with the test ON (every case audited, no violation): ' + on.pass + ' passed, ' + on.fail + ' failed (' + on.fvLine.trim().slice(0, 140) + ')');
    const a = off.trace.split(' '), b = on.trace.split(' ');
    const at = a.findIndex((x, i) => x !== b[i]);
    ok(a.length > 20 && off.trace === on.trace, 'the audit\'s frame trace is the same with the mode on: ' + a.length + ' state changes of BMW\'s panel, the sheet and the window' +
        (off.trace === on.trace ? (pairs > 1 ? ' (the second pair; the first differed under load)' : '') : ' (differs at ' + at + ': off ' + a.slice(Math.max(0, at - 2), at + 3).join(' ') + ' / on ' + b.slice(Math.max(0, at - 2), at + 3).join(' ') + ')'));
    if (on.fail || off.fail) console.log(on.out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 8).join('\n'));
}

(async () => {
    try {
        decoderChecks();
        pictureChecks();
        if (process.argv.indexOf('--no-bench') < 0) await benchChecks();
        if (process.argv.indexOf('--no-cc') < 0) ccChecks();
    } catch (e) {
        failed++;
        console.log('  FAIL ' + (e && e.stack || e));
    }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
