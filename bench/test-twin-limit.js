'use strict';
/**
 * test-twin-limit.js - Twin Dial's speed limit and cruise (package B5 of the 0.1.1 build; docs/twin-dial/SPEC-R3.md 8 and 9).
 *
 *   node bench/test-twin-limit.js
 *
 * Part 1, shared/twin_limit.js on its own: the angle law and SPEC-R3 8's marker list, every state of the sign (limit,
 * unknown, end, none, conditional, over the limit, mph) as the display and as u_lim, the invalid markers, the cruise struct
 * (dark, active, standby, off, the limiter, a bad value), the sign's and the readout's pixels (ink inside the white disc for
 * every number, the night colours), the geometry of design/twin-dial/b5/limit.json against the module and the layout, and
 * SPEC-R3 8's clearances measured on the layout's numbers.
 *
 * Part 2, the real engine (shared/hud.js, apps/twin_dial built as the Store builds it) in this process against a stand-in
 * cluster-render: signals fed with hu.feed, the layers' pixels and uniforms read back from the engine's own clients.
 * The sign stays while BMW's fallback window is open; cruise is not built at all while config.cruise is null and lit when
 * it is set; the log carries numbers and enum names only (canary strings fed in the struct never appear in it).
 *
 * Mac only, Node 18 or newer. Never shipped. It builds into dist/ (dist/twin_dial, rebuilt by every test of the repo).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const Module = require('module');
const { execFileSync } = require('child_process');
const H = require('./twin-harness');

const ROOT = H.ROOT;
const APP_ID = 'twin_dial';
const STAGE = path.join(ROOT, 'dist', APP_ID);
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-6 : e);

const dir = H.tree('twin_dial');
const L = require(path.join(dir, 'twin_limit.js'));
const B5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'b5', 'limit.json'), 'utf8'));
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'layouts', 'twin.json'), 'utf8'));
const APP = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8'));
const hitR = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// ---- the engine's own reading of config.sign, for the pure part: hud.js signOf through a HudApp-free copy ----------------
// (hud.js does not export signOf; the engine part below runs the real one. Here a display is built from the shape signOf returns.)
const SIGN_NONE = { state: 'none', kmh: null, shown: null, unit: null, warn: 0, supp: null, style: null, sure: null, np: 'none', npM: null };
const sg = (o) => Object.assign({}, SIGN_NONE, o);

// =====================================================================================================================
function pureChecks() {
    console.log('the angle law and the marker list (SPEC-R3 8 b)');
    const list = { 30: -87.5, 50: -62.5, 70: -37.5, 90: -12.5, 110: 6.25, 130: 18.75, 100: 0, 0: -125, 5: -118.75, 250: 93.75, 300: 125 };
    ok(Object.keys(list).every((k) => near(L.angleOf(Number(k)), list[k], 1e-9)), 'the law gives 30 -87.5, 50 -62.5, 70 -37.5, 90 -12.5, 110 +6.25, 130 +18.75 (and 100 = 0, 250 = +93.75, 300 = +125)');
    ok(L.angleOf(400) === 125 && L.angleOf(null) === null && L.angleOf(NaN) === null && L.angleOf(-3) === -125, 'beyond the scale the angle stops at +125; a non-number has none');
    // the engine's _twinDeg is the same law: the marker sits where the needle would for that speed
    const hud = require(path.join(dir, 'hud.js'));
    const fake = Object.create(hud.prototype);
    fake._raw = () => 87;
    const x = { w: { }, tw: { tach: false, sweep: 125 } };
    ok([30, 50, 70, 90, 100, 110, 130, 200, 300].every((v) => { fake._raw = () => v; return near(fake._twinDeg(x), L.angleOf(v), 1e-9); }), 'the marker law equals the engine\'s needle law (hud.js _twinDeg) at 30 50 70 90 100 110 130 200 300 km/h');

    console.log('the states of the sign (SPEC-R3 8)');
    const lim = L.displayOf(sg({ state: 'limit', kmh: 50, shown: 50, unit: 'kmh' }));
    ok(lim.kind === 'limit' && lim.shown === 50 && lim.kmh === 50 && !lim.cond && lim.warn === 0, 'a known limit: kind limit, the number, no dot');
    const mph = L.displayOf(sg({ state: 'limit', kmh: 30 * 1.609344, shown: 30, unit: 'mph' }));
    ok(mph.kind === 'limit' && mph.shown === 30 && mph.unit === 'mph' && near(mph.kmh, 48.28032, 1e-9), 'mph: the number as the car gives it (30), the km/h for the marker (48.28)');
    ok(near(L.limUniform(mph, 'L1')[0], -125 + 1.25 * 48.28032, 1e-2), 'the marker of 30 mph is at the angle of 48.28 km/h (-64.65 deg)');
    ok(L.displayOf(sg({ state: 'unknown' })).kind === 'unknown' && L.displayOf(sg({ state: 'end' })).kind === 'end' && L.displayOf(sg({ state: 'none' })).kind === 'none', 'unknown, end, none keep their kind');
    ok(L.displayOf(null).kind === 'none' && L.displayOf(undefined).kind === 'none' && L.displayOf('x').kind === 'none' && L.displayOf({ state: 'limit' }).kind === 'none', 'nothing received, a non-object, a limit without a number: none (no sign at all)');
    const cond = L.displayOf(sg({ state: 'limit', kmh: 70, shown: 70, unit: 'kmh', supp: 'rain' }));
    ok(cond.cond === true && L.limUniform(cond, 'L1')[1] === L.LIM_STATE.conditional && L.LIM_STATE.conditional === 2, 'a conditional limit (a supplemental sign): the dot, and u_lim.y = 2 (a hollow marker, no red strip: B1\'s table)');
    const over = L.displayOf(sg({ state: 'limit', kmh: 50, shown: 50, unit: 'kmh', warn: 2 }));
    ok(over.warn === 2 && L.limUniform(over, 'L1')[2] === 2 && L.limUniform(L.displayOf(sg({ state: 'limit', kmh: 50, shown: 50, unit: 'kmh', warn: 1 })), 'L1')[2] === 1, 'the car\'s own warning level (1, 2) goes to u_lim.z; the sign itself never changes with it');
    ok(L.displayOf(sg({ state: 'limit', kmh: 50, shown: 50, unit: 'kmh', warn: 7 })).warn === 0, 'a warning level the engine does not know is 0');

    console.log('u_lim: the strip modes and the invalid markers');
    const u50 = L.limUniform(lim, 'L1');
    ok(JSON.stringify(u50) === '[-62.5,1,0,1]', 'limit 50, L1: [-62.5, 1 (limit), 0, 1]');
    ok(L.limUniform(lim, 'L2')[3] === 2 && L.limUniform(lim, 'L3')[3] === 3 && L.limUniform(lim, 'off')[3] === 0 && L.limUniform(lim, 'nonsense')[3] === 1 && L.limUniform(lim, undefined)[3] === 1, 'config.limit.strip: L1 = 1, L2 = 2, L3 = 3, off = 0; anything else (and nothing) = L1');
    const dead = [L.displayOf(sg({ state: 'unknown' })), L.displayOf(sg({ state: 'end' })), L.displayOf(null), L.displayOf(sg({ state: 'none' }))];
    ok(dead.every((d) => { const u = L.limUniform(d, 'L1'); return u[0] === 0 && u[1] === 0 && u[2] === 0; }), 'unknown, end, none: no marker (state 0, angle 0, warn 0), so no red strip either');
    ok(L.limUniform(L.displayOf(sg({ state: 'limit', kmh: NaN, shown: NaN })), 'L1')[1] === 0, 'a limit that is not a number: no marker');
    ok(L.CRU_STATE.active === 1 && JSON.stringify(L.cruUniform(null)) === '[0,0,0,0]', 'u_cru state 1 = active; nothing = [0, 0, 0, 0]');

    console.log('the cruise struct (SPEC-R3 9; the member names are the catalogue\'s, what they mean is a hypothesis)');
    const cfg = L.cruiseCfg({});
    const S = (o) => Object.assign({ invalidFlag: 0, activeFuncLongitudinal: 'XCC_AKTIV', dispXCC: { dispXCCStatus: 'DISP_XCC' }, dispSLD: { dispSLDStatus: 'SLD_OFF' }, valueRequestedSpeed: 110,
        dispRequestedSpeed: { dispRequestedSpeedStatus: 'DISP_OF_REQUESTED_SPEED_ACTIVE', unitOfRequestedSpeedValue: false } }, o || {});
    const a = L.cruiseOf(cfg, S());
    ok(a.kind === 'cruise' && a.status === 'active' && a.shown === 110 && a.kmh === 110 && a.unit === 'kmh', 'XCC_AKTIV + ACTIVE + 110: the cruise, active, 110 km/h');
    ok(L.cruiseOf(cfg, S({ dispXCC: { dispXCCStatus: 'DISP_ACC' } })).kind === 'acc', 'DISP_ACC turns it into the adaptive cruise');
    ok(L.cruiseOf(cfg, S({ activeFuncLongitudinal: 1 })).kind === 'cruise' && L.cruiseOf(cfg, S({ dispRequestedSpeed: { dispRequestedSpeedStatus: 2 } })).status === 'active', 'enums as numbers work as names');
    ok(L.cruiseOf(cfg, S({ dispRequestedSpeed: { dispRequestedSpeedStatus: 'DISP_OF_REQUESTED_SPEED_STANDBY' } })).status === 'standby', 'STANDBY is standby');
    ok(L.cruiseOf(cfg, S({ dispRequestedSpeed: { dispRequestedSpeedStatus: 'NO_DISP_OF_REQUESTED_SPEED' } })).status === 'off', 'NO_DISP is off');
    const lm = L.cruiseOf(cfg, S({ activeFuncLongitudinal: 'SLD_AKTIV', dispRequestedSpeed: { dispRequestedSpeedStatus: 0 }, dispSLD: { dispSLDStatus: 'SLD_ACTIVE' }, valueRequestedSpeed: 90 }));
    ok(lm.kind === 'limiter' && lm.status === 'active' && lm.shown === 90, 'the limiter: SLD_AKTIV, its own status (SLD_ACTIVE) when the requested-speed status is silent');
    ok(L.cruiseOf(cfg, S({ activeFuncLongitudinal: 'HDC_AKTIV' })).status === 'off' && L.cruiseOf(cfg, S({ activeFuncLongitudinal: 'KEINE_LAENGSDYNAMIKFUNKTION_AKTIV' })).kind === null, 'hill descent and "no function" are not drawn');
    ok(L.cruiseOf(cfg, S({ invalidFlag: 1 })).status === 'off', 'invalidFlag: off');
    ok([0, 255, 65535, 3, 400, 'x', null, undefined].every((v) => L.cruiseOf(cfg, S({ valueRequestedSpeed: v })).kmh === null), 'a speed that is 0 / 255 / 65535 / below 5 / above 300 / not a number is not valid: no number, no marker');
    const mp = L.cruiseOf(cfg, S({ valueRequestedSpeed: 60, dispRequestedSpeed: { dispRequestedSpeedStatus: 2, unitOfRequestedSpeedValue: true } }));
    ok(mp.unit === 'mph' && mp.shown === 60 && near(mp.kmh, 96.56064, 1e-9), 'the unit flag set (the hypothesis: mph): 60 mph = 96.56 km/h for the marker');
    ok([null, undefined, 5, 'x', []].every((v) => L.cruiseOf(cfg, v).status === 'off'), 'a value that is not a struct: off');
    ok(JSON.stringify(L.cruUniform(a)) === '[6.25,1,0,0]', 'active at 110: u_cru [6.25, 1, 0, 0]');
    ok(L.cruUniform(L.cruiseOf(cfg, S({ dispRequestedSpeed: { dispRequestedSpeedStatus: 1 } })))[1] === 0, 'standby: no marker (u_cru state 0)');
    ok(L.cruUniform(L.cruiseOf(cfg, S({ valueRequestedSpeed: 0 })))[1] === 0, 'active with no valid speed: no marker');
    const over2 = L.cruiseCfg({ cruise: { place: 'C2', factor: 0.5, funcMap: { 7: 'cruise' } } });
    ok(over2.place === 'C2' && over2.factor === 0.5 && over2.funcMap[7] === 'cruise' && over2.funcMap.XCC_AKTIV === undefined && over2.statusPath[0] === 'dispRequestedSpeed', 'config.cruise keys overlay the defaults (a map named replaces the default map)');
    ok(L.cruiseCfg({ cruise: null }).place === 'C1' && L.cruiseCfg({}).funcPath[0] === 'activeFuncLongitudinal', 'null / absent config.cruise: the defaults (used for the log only)');
}

// ---- pixels ---------------------------------------------------------------------------------------------------------
const px = (buf, W, x, y) => { const o = (y * W + x) * 4; return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]; };
function pixelChecks() {
    console.log('the sign\'s pixels');
    const W = L.SIGN.w, Hh = L.SIGN.h, cx = L.SIGN.cx - L.SIGN.x, cy = L.SIGN.cy - L.SIGN.y, R = L.SIGN.r, Ri = L.SIGN.r - L.SIGN.ring;
    const mk = (n, extra) => L.displayOf(Object.assign(sg({ state: 'limit', kmh: n, shown: n, unit: 'kmh' }), extra || {}));
    const P = (d, o) => L.paintSign(d, Object.assign({ dot: d.cond }, o || {}));
    ok(L.SIGN.x === 1252 && L.SIGN.y === 628 && L.SIGN.w === 96 && L.SIGN.h === 88 && cx === 48 && cy === 44, 'the sheet is [1252, 628, 96, 88] and the disc is at (1300, 672) in it');
    const b50 = P(mk(50));
    ok(b50.length === W * Hh * 4, 'the sheet is 96 x 88 straight RGBA');
    const ringPx = px(b50, W, cx + Math.round(R - L.SIGN.ring / 2), cy), whitePx = px(b50, W, cx, cy - 20), outPx = px(b50, W, 2, 2);
    ok(ringPx.slice(0, 3).join() === L.COL.red.join() && ringPx[3] === 255, 'the ring is red ' + L.COL.red.join(' ') + ' and opaque');
    ok(whitePx.slice(0, 3).join() === L.COL.white.join() && whitePx[3] === 255, 'the disc is white inside the ring');
    ok(outPx[3] === 0, 'the corners are transparent');
    let farthest = 0, ringW = 0;
    for (let x = 0; x < W; x++) if (px(b50, W, x, cy)[0] > 150 && px(b50, W, x, cy)[1] < 60) ringW++;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) if (px(b50, W, x, y)[3] > 0) farthest = Math.max(farthest, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
    ok(farthest <= R + 0.8 && farthest >= R - 0.8, 'nothing is drawn beyond the outer radius ' + R + ' (farthest pixel ' + farthest.toFixed(2) + ')');
    ok(near(ringW, 2 * L.SIGN.ring, 1.5), 'the ring is ' + L.SIGN.ring + ' px wide (' + ringW + ' red pixels across both sides on the middle row)');
    // the figure: dark pixels inside the white disc, clear of the ring, for every number a sign can carry
    const darkR = (buf) => { let n = 0, far = 0, any = 0; for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const p = px(buf, W, x, y); if (p[3] > 200 && p[0] < 90 && p[1] < 90 && p[2] < 90) { n++; far = Math.max(far, Math.hypot(x + 0.5 - cx, y + 0.5 - cy)); } any += p[3] > 0 ? 1 : 0; } return { n, far }; };
    const bad = [];
    [5, 10, 20, 30, 50, 60, 80, 88, 100, 120, 130, 150, 250, 888].forEach((n) => { const r = darkR(P(mk(n))); if (r.n < 60 || r.far > Ri - 1.5) bad.push(n + ' (' + r.n + ' dark px, farthest ' + r.far.toFixed(1) + ')'); });
    ok(!bad.length, 'the figure has ink and stays >= 1.5 px inside the white disc (r ' + Ri.toFixed(1) + ') for 5 .. 888' + (bad.length ? ': ' + bad.join('; ') : ''));
    const d2 = darkR(P(mk(50))), d3 = darkR(P(mk(130)));
    ok(d3.n > 0 && d2.n > 0, 'two digits (' + d2.n + ' dark px) and three (' + d3.n + ') are both drawn');
    // the figure is centred on the disc
    let sx = 0, sy = 0, sn = 0;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const p = px(P(mk(90)), W, x, y); if (p[3] > 200 && p[0] < 90) { sx += x; sy += y; sn++; } }
    ok(Math.abs(sx / sn + 0.5 - cx) <= 3 && Math.abs(sy / sn + 0.5 - cy) <= 3, 'the figure\'s centre of mass is within 3 px of the disc\'s centre');
    const numbers = (buf) => darkR(buf).n;
    ok(!P(mk(50)).equals(P(mk(51))) && P(mk(50)).equals(P(mk(50))), 'the sheet is deterministic and follows the number');
    // unknown: the dashes
    const bu = P(L.displayOf(sg({ state: 'unknown' })));
    const du = darkR(bu);
    let dashRows = 0;
    for (let y = 0; y < Hh; y++) { let r = 0; for (let x = 0; x < W; x++) { const p = px(bu, W, x, y); if (p[3] > 200 && p[0] < 90) r++; } if (r) dashRows++; }
    ok(du.n > 60 && dashRows <= 6 && px(bu, W, cx + Math.round(R - 3), cy)[0] > 150 && px(bu, W, cx + Math.round(R - 3), cy)[1] < 60, 'unknown: a red ring with three dashes (' + du.n + ' dark px in ' + dashRows + ' rows)');
    // end: the derestriction sign
    const be = P(L.displayOf(sg({ state: 'end' })));
    let reds = 0; for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const p = px(be, W, x, y); if (p[3] > 200 && p[0] > 150 && p[1] < 60) reds++; }
    const stripe = (() => { let n = 0; for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const p = px(be, W, x, y); if (p[3] > 200 && p[0] < 140 && p[0] > 60 && Math.hypot(x - cx, y - cy) < R - 5) n++; } return n; })();
    ok(reds === 0 && stripe > 150, 'end: a light disc with diagonal stripes (' + stripe + ' stripe px), no red');
    ok(px(be, W, cx, cy - 25)[0] >= 240 && px(be, W, 2, 2)[3] === 0, 'the derestriction disc is white where there is no stripe');
    // none: blank
    ok(P(L.displayOf(null)).every((v) => v === 0), 'none: the sheet is blank (nothing at all)');
    // the conditional dot
    const bc = P(mk(70, { supp: 'rain' }), { dot: true }), dotY = cy + Math.round(L.SHAPE.dotDy), dp = px(bc, W, cx, dotY);
    ok(L.displayOf(sg({ state: 'limit', kmh: 70, shown: 70, unit: 'kmh', supp: 'rain' })).cond === true && dp[3] === 255 && dp[0] >= 240 && dotY + L.SHAPE.dotR + 1 <= Hh, 'conditional: a white dot under the disc, inside the sheet (y ' + (dotY + L.SIGN.y) + ' of the panel)');
    ok(px(b50, W, cx, dotY)[3] === 0, 'no dot without a conditional sign');
    // night: the multipliers (SPEC-R3 6: white x 0.8, red x 0.85 in linear light)
    const nt = L.paintSign(mk(50), { mult: { white: 0.8, red: 0.85 } });
    const wN = px(nt, W, cx, cy - 20), rN = px(nt, W, cx + Math.round(R - L.SIGN.ring / 2), cy);
    ok(wN[0] < 250 && wN[0] === L.paintSign(mk(50), { mult: { white: 0.8, red: 1 } })[(( cy - 20) * W + cx) * 4] && rN[0] < L.COL.red[0] && rN[1] <= L.COL.red[1], 'night: the white and the red take their multipliers (white ' + wN[0] + ', red ' + rN.slice(0, 3).join(' ') + ')');
    ok(wN[0] >= 220 && wN[0] <= 235, 'night white x 0.8 in linear light is about 231 (' + wN[0] + ')');

    console.log('the readout\'s pixels');
    const cr = (o) => L.cruiseOf(L.cruiseCfg({}), Object.assign({ invalidFlag: 0, activeFuncLongitudinal: 1, dispXCC: { dispXCCStatus: 0 }, valueRequestedSpeed: 110,
        dispRequestedSpeed: { dispRequestedSpeedStatus: 2, unitOfRequestedSpeedValue: false } }, o || {}));
    const C = L.CRU.C1, Wc = C.w, Hc = C.h;
    const ink = (buf, W2, H2, pred) => { let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const p = px(buf, W2, x, y); if (p[3] > 60 && pred(p)) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } } return { n, box: [x0, y0, x1 + 1, y1 + 1] }; };
    const green = (p) => p[1] > p[0] + 40 && p[1] > p[2] + 40, grey = (p) => Math.abs(p[0] - p[1]) < 6 && p[0] > 150;
    // B6's symbols (td_cruise, td_cruise_acc, td_limiter) join ICONS when B6 is merged; until then a stand-in drawn by the same call
    const have = !!require(path.join(dir, 'icons.js')).ICONS.td_cruise;
    const STAND = have ? undefined : { cruise: 'cc_warn', acc: 'cc_warn', limiter: 'cc_warn' };
    const on = L.paintCruise(cr(), { place: 'C1', icons: STAND });
    const gi = ink(on, Wc, Hc, green);
    ok(on.length === Wc * Hc * 4 && gi.n > 300, 'active: the set speed, its unit and the symbol are green (' + gi.n + ' green px)');
    ok(ink(on, Wc, Hc, (p) => !green(p)).n < gi.n * 0.15, 'active: nothing but green (AA edges aside)');
    // the number: right edge at x 1536, its baseline at 540 (the digits sit above it)
    const numArea = ink(on, Wc, Hc, (p) => green(p) && p[3] > 200);
    ok(numArea.box[2] + C.x <= 1597 && numArea.box[0] + C.x >= 1456, 'the readout stays inside its sheet [1456 .. 1596]');
    const digits = (() => { const b = L.paintCruise(cr(), { place: 'C1', icons: { cruise: 'none_such' } }); return ink(b, Wc, Hc, (p) => green(p) && p[3] > 100); })();
    ok(digits.box[2] + C.x <= 1536 + 3 && digits.box[2] + C.x >= 1536 - 6, 'the set speed is right-aligned at x 1536 (last ink at ' + (digits.box[2] + C.x) + ')');
    ok(digits.box[3] + C.y <= 560 + 6 && digits.box[1] + C.y >= 500, 'the set speed and its unit lie between y 500 and y 566 (ink y ' + (digits.box[1] + C.y) + ' .. ' + (digits.box[3] + C.y) + ')');
    const symOnly = ink(on, Wc, Hc, (p) => green(p) && p[3] > 100).box;
    ok(symOnly[2] + C.x <= 1597 && symOnly[2] + C.x >= 1572, 'the symbol reaches x ' + (symOnly[2] + C.x) + ' (36 px centred at 1572)');
    const sb = L.paintCruise(cr({ dispRequestedSpeed: { dispRequestedSpeedStatus: 1 } }), { place: 'C1', icons: STAND });
    ok(ink(sb, Wc, Hc, grey).n > 300 && ink(sb, Wc, Hc, green).n === 0, 'standby: grey (227), no green');
    ok(L.paintCruise(cr({ dispRequestedSpeed: { dispRequestedSpeedStatus: 0 } }), { place: 'C1' }).every((v) => v === 0), 'off: a blank sheet');
    const nov = L.paintCruise(cr({ valueRequestedSpeed: 0 }), { place: 'C1', icons: STAND });
    ok(ink(nov, Wc, Hc, green).n > 60 && ink(nov, Wc, Hc, green).n < gi.n / 2, 'active with no valid speed: the symbol alone');
    ok(!L.paintCruise(cr({ valueRequestedSpeed: 80 }), { place: 'C1', icons: STAND }).equals(on), 'the readout follows the number');
    const c2 = L.paintCruise(cr(), { place: 'C2', icons: STAND });
    ok(c2.length === L.CRU.C2.w * L.CRU.C2.h * 4 && ink(c2, L.CRU.C2.w, L.CRU.C2.h, green).n > 300, 'C2: the readout is drawn in its own sheet [1466, 588, 188, 64]');
    const nGreen = L.paintCruise(cr(), { place: 'C1', green: [30, 80, 15], icons: STAND });
    ok(ink(nGreen, Wc, Hc, (p) => p[1] > 70 && p[1] < 95).n > 300, 'the night colour of the green is taken from the caller');
    ok(L.GREEN.join() === '60,155,34' && L.GREY[0] === 227, 'the green is SPEC-R3 9\'s (60, 155, 34), the grey 227');
}

// ---- geometry: the design file, the module, the layout, the clearances --------------------------------------------------
function geometryChecks() {
    console.log('the geometry: design/twin-dial/b5/limit.json, the module and the layout agree');
    ok(B5.sign.centre.join() === [L.SIGN.cx, L.SIGN.cy].join() && B5.sign.outer_r === L.SIGN.r && B5.sign.ring === L.SIGN.ring && B5.sign.sheet.join() === [L.SIGN.x, L.SIGN.y, L.SIGN.w, L.SIGN.h].join(), 'the sign: centre (1300, 672), r 33, ring 7.6, sheet [1252, 628, 96, 88]');
    ['C1', 'C2'].forEach((p) => {
        const d = B5.cruise[p], m = L.CRU[p];
        ok(d.sheet.join() === [m.x, m.y, m.w, m.h].join() && d.num_right === m.numRight && d.num_base === m.numBase && d.unit_right === m.unitRight && d.unit_base === m.unitBase && d.symbol.join() === m.sym.join() && d.symbol_px === m.symSize && d.num_px === m.numPx,
            p + ': the module\'s numbers are the design file\'s');
    });
    const C1 = B5.cruise.C1;
    ok(C1.num_right === 1536 && C1.num_base === 540 && C1.unit_base === 560 && C1.symbol.join() === '1572,528' && C1.symbol_px === 36 && C1.num_px === 40, 'C1 is SPEC-R3 9: the set speed right-aligned at x 1536, baseline 540, Saira 40; the unit baseline 560; the symbol 36 px at (1572, 528)');
    const by = {}; LAYOUT.widgets.forEach((w) => { by[w.id] = w; });
    const s = by.limit_sign;
    ok(s && s.type === 'tdsign' && s.conn === 2 && [s.x, s.y, s.w, s.h].join() === B5.sign.sheet.join() && s.z === B5.sign.z, 'the layout has the sign\'s sheet on connection 2 at [1252, 628, 96, 88]');
    ok(!s.toggle && !s.holeWhen && !JSON.stringify(s).match(/cc:/), 'the sign is not a "cc:" widget: no toggle, no hole condition, nothing of the message state in it');
    ok(by.cruise_c1.toggle === 'tl:cruise:C1' && by.cruise_c2.toggle === 'tl:cruise:C2' && by.cruise_c1.type === 'tdcru' && by.cruise_c1.conn === 2, 'the readout widgets are built only while config.cruise is set (tl:cruise:<place>)');
    const keep = { belt: [497, 660, 688, 720], gap: [1380, 660, 1460, 720], g20box: [1420, 320, 1611, 440] };
    ['limit_sign', 'cruise_c1', 'cruise_c2'].forEach((id) => {
        const w = by[id], r = [w.x, w.y, w.x + w.w, w.y + w.h];
        ok(!hitR(r, keep.belt) && !hitR(r, keep.gap) && r[0] >= 0 && r[2] <= 1920 && r[3] <= 720, id + ' ' + JSON.stringify(r) + ' touches neither BMW\'s belt group nor the gear-letter gap and lies on the panel');
    });
    ok(!hitR([by.cruise_c1.x, by.cruise_c1.y, by.cruise_c1.x + by.cruise_c1.w, by.cruise_c1.y + by.cruise_c1.h], keep.g20box) && by.cruise_c1.y >= 492 && !hitR([by.cruise_c2.x, by.cruise_c2.y, by.cruise_c2.x + by.cruise_c2.w, by.cruise_c2.y + by.cruise_c2.h], keep.g20box),
        'the readout lies below y 492, out of the G20\'s black-box area [1420, 320, 1611, 440] (C1 and C2)');
    // clearances of the disc (SPEC-R3 8; measured by SV on a render, here on the layout's numbers)
    const c = [L.SIGN.cx, L.SIGN.cy], r = L.SIGN.r;
    const dRect = (b) => { const dx = Math.max(b[0] - c[0], 0, c[0] - b[2]), dy = Math.max(b[1] - c[1], 0, c[1] - b[3]); return Math.hypot(dx, dy); };
    const dSeg = (p, a, b2) => { const ax = b2[0] - a[0], ay = b2[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / (ax * ax + ay * ay || 1))); return Math.hypot(p[0] - a[0] - ax * t, p[1] - a[1] - ay * t); };
    const poly = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'twin-dial', 'vf', 'message_panel.json'), 'utf8')).fallback_window.polygon_px;
    let dWin = Infinity; poly.forEach((p, i) => { dWin = Math.min(dWin, dSeg(c, p, poly[(i + 1) % poly.length])); });
    const stored = [1243.25, 591.75, 1284.75, 627.5];
    const dStored = dRect(stored) - r, dGap = dRect(keep.gap) - r, dWinC = dWin - r, dBottom = 720 - (c[1] + r);
    const rule = LAYOUT.widgets.find((w) => w.type === 'tdback' && w.part === 'L').rules[1];
    const dRule = dRect([rule.x0, rule.y0, rule.ours ? rule.ours.x1 : rule.x1, rule.y1]) - r;
    const dBezel = Math.hypot(c[0] - 1540, c[1] - 400) - 300 * 1.0105 - r;
    console.log('       clearances of the disc: stored marker ' + dStored.toFixed(1) + ', bottom-row rule ' + dRule.toFixed(1) + ', speedometer ring ' + dBezel.toFixed(1) + ', fallback window ' + dWinC.toFixed(1) + ', gear gap ' + dGap.toFixed(1) + ', panel bottom ' + dBottom.toFixed(1) + ' px');
    ok(dStored >= 10, '>= 10 px to BMW\'s stored-message marker (' + dStored.toFixed(1) + '; SV measured 10.7 on a render)');
    ok(dRule >= 25 && dBezel >= 26, '>= 25 px to our ink: the bottom row\'s rule ' + dRule.toFixed(1) + ' and the speedometer\'s ring ' + dBezel.toFixed(1) + ' (SV: 26.0 measured on a render)');
    ok(dWinC >= 41, '>= 41 px to the fallback window (' + dWinC.toFixed(1) + ')');
    ok(dGap >= 47, '>= 47 px to the gear-letter gap (' + dGap.toFixed(1) + ')');
    ok(dBottom >= 15, '>= 15 px to the panel\'s bottom (' + dBottom.toFixed(1) + ')');
    // our own sheets: the sign's sheet does not meet any other widget of the same z on connection 2, so it is a layer of its own
    const others = LAYOUT.widgets.filter((w) => w.conn === 2 && w.z === s.z && w.id !== s.id);
    ok(others.length === 0, 'no other widget shares the sign\'s z on connection 2, so the engine makes one small sheet of it (96 x 88 x 4 x 2 = ' + (96 * 88 * 8 / 1024).toFixed(0) + ' KiB)');
    // the declarations
    const sigs = APP.signals['de.bmw.dass.driverassistanceapplications.TrafficSignDisplayControl'];
    ok(sigs && sigs.displaySpeedLimitAndNoPassingRestriction === 's' && sigs.displayDriverAssistanceLongitudinal === 's', 'app.json declares the sign and the longitudinal field, both notifier only ("s")');
    const f30 = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'app.json'), 'utf8'));
    ok(JSON.stringify(APP.config.sign) === JSON.stringify(f30.config.sign), 'config.sign is f30_cluster\'s, key for key');
    ok(APP.config.cruise && APP.config.cruise.place === 'C1' && APP.config.limit && APP.config.limit.strip === 'L1' && !APP.config.limit.iface, 'config.cruise is { place: "C1" } (car-fix CF2: on), config.limit.strip is "L1" (and config.limit names no field of its own)');
    // car-fix CF2: the real sources' declarations
    const tsrD = APP.signals['de.bmw.dass.TrafficSignRecognition'], camD = APP.signals['de.bmw.environmentalmodel.SignRecognitionFrontCamera'], ddsD = APP.signals['de.bmw.infotainment.displaydataserver.DisplayDataServer'];
    const keysOf = (o) => Object.keys(o).filter((k) => k.charAt(0) !== '_' || k === '_methods' || k === '_broadcasts').sort().join();
    ok(tsrD && tsrD._instances === '1' && tsrD._broadcasts.join() === 'TrafficSignRecognition' && keysOf(tsrD) === '_broadcasts' && camD && camD._broadcasts.join() === 'TrafficSignRecognitionFrontCamera' && keysOf(camD) === '_broadcasts',
        'app.json declares the two events as _broadcasts, instance 1, and nothing else on those interfaces (no field, no method)');
    ok(ddsD && ddsD._instances === '1' && ddsD.functionalLibraryData === 'rs' && keysOf(ddsD) === 'functionalLibraryData', 'DisplayDataServer: functionalLibraryData "rs" only (getter 1, notifier 32769; no setter, no method)');
    ok(['de.bmw.dass.TrafficSignRecognition', 'de.bmw.environmentalmodel.SignRecognitionFrontCamera'].every((i) => JSON.stringify(f30.signals[i]) === JSON.stringify(Object.assign({}, APP.signals[i], { _about: f30.signals[i]._about }))) &&
        !f30.signals['de.bmw.infotainment.displaydataserver.DisplayDataServer'], 'f30_cluster declares the same two events (and not the HUD feed: it draws no cruise)');
    ok(APP.shared.indexOf('limit_src.js') >= 0 && f30.shared.indexOf('limit_src.js') >= 0, 'limit_src.js is packed into both apps');
    ok(APP.shared.indexOf('twin_limit.js') >= 0, 'twin_limit.js is packed into twin_dial');
    const f30shared = f30.shared.indexOf('twin_limit.js') < 0;
    ok(f30shared, 'f30_cluster does not pack twin_limit.js');
    const src = fs.readFileSync(path.join(ROOT, 'shared', 'twin_limit.js'), 'utf8');
    ok(!/\?\.|\?\?|\.\.\.[a-zA-Z_{\[]|Object\.fromEntries|\.flat\(|catch\s*\{/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'twin_limit.js is plain Node 8: no ?. ?? spread, fromEntries, flat, optional catch binding');
}

// ---- the module's handlers with a bare hud ----------------------------------------------------------------------------
function handlerChecks() {
    console.log('the handlers on a bare hud (no engine)');
    const lines = [];
    const log = { info: (s) => lines.push(s), warn: (s) => lines.push('WARN ' + s), error: (s) => lines.push('ERR ' + s) };
    const hud = { config: { sign: { iface: 'I', field: 'sign' }, limit: { strip: 'L2' }, cruise: null }, log, sign: SIGN_NONE };
    const extra = { I: { sign: (v) => { hud.sign = v; } } };
    L.wire(hud, extra);
    ok(typeof extra.I.sign === 'function' && extra[L.IF][L.FIELD] && extra[L.IF].displayDriverAssistanceLongitudinal, 'wire chains behind the engine\'s watch of config.sign and watches the longitudinal field');
    extra.I.sign(sg({ state: 'limit', kmh: 50, shown: 50, unit: 'kmh' }));
    ok(L.displayNow(hud).kind === 'limit' && lines.length === 1 && lines[0] === 'limit: limit 50 kmh (50 km/h) conditional no warn 0', 'a limit: the display, one log line "' + lines[0] + '"');
    extra.I.sign(sg({ state: 'limit', kmh: 50, shown: 50, unit: 'kmh' }));
    ok(lines.length === 1, 'the same value again: no second line');
    extra.I.sign(sg({ state: 'unknown' })); extra.I.sign(sg({ state: 'end' })); extra.I.sign(sg({ state: 'none' }));
    ok(lines.length === 4 && /^limit: unknown /.test(lines[1]) && /^limit: end /.test(lines[2]) && /^limit: none /.test(lines[3]), 'a line per change: unknown, end, none');
    ok(L.displayNow(hud).kind === 'none', 'nothing received after a limit: no sign (holdMs 0)');
    hud.config.sign.holdMs = 5000;
    let t = 1000; L.st(hud).clock = () => t;
    extra.I.sign(sg({ state: 'limit', kmh: 70, shown: 70, unit: 'kmh' }));
    t = 2000; extra.I.sign(sg({ state: 'none' }));
    ok(L.displayNow(hud).kind === 'limit' && L.displayNow(hud).shown === 70, 'config.sign.holdMs keeps the last sign through a short silence');
    t = 7500;
    ok(L.displayNow(hud).kind === 'none', '... and lets it go after holdMs');
    // the cruise handler
    extra[L.IF].displayDriverAssistanceLongitudinal({ activeFuncLongitudinal: 'XCC_AKTIV', valueRequestedSpeed: 110, dispRequestedSpeed: { dispRequestedSpeedStatus: 'DISP_OF_REQUESTED_SPEED_ACTIVE', unitOfRequestedSpeedValue: false }, invalidFlag: 0, dispXCC: { dispXCCStatus: 'NO_DISP_XCC' }, dispSLD: { dispSLDStatus: 'SLD_OFF' } });
    const cl = lines[lines.length - 1];
    ok(/^limit: cruise raw func XCC_AKTIV status DISP_OF_REQUESTED_SPEED_ACTIVE speed 110 unit false xcc NO_DISP_XCC sld SLD_OFF -> cruise active 110 km\/h \(drawing is off: config.cruise null\)$/.test(cl), 'the cruise struct is logged raw (numbers and enum names) with the reading, and says the drawing is off: "' + cl + '"');
    ok(L.cruiseNow(hud).status === 'off' && JSON.stringify(L.cruUniform(L.cruiseNow(hud))) === '[0,0,0,0]', 'config.cruise null: the reading is kept for the log but nothing is drawn (cruiseNow is off, u_cru zero)');
    hud.config.cruise = { place: 'C1' };
    ok(L.cruiseNow(hud).status === 'active' && L.toggle(hud, 'cruise') && L.toggle(hud, 'cruise:C1') && !L.toggle(hud, 'cruise:C2') && !L.toggle(hud, 'nope'), 'config.cruise set: the reading counts and the toggles say "cruise", "cruise:C1" (not C2)');
    hud.config.cruise = null;
    ok(!L.toggle(hud, 'cruise') && !L.toggle(hud, 'cruise:C1'), 'config.cruise null: tl:cruise is off (the sheet is not even built)');
    hud.config.cruise = { place: 'zzz' };
    ok(L.toggle(hud, 'cruise:C1') && !L.toggle(hud, 'cruise:C2'), 'an unknown place is C1');
    // privacy: nothing but numbers and enum names; a canary in any member never reaches the log
    const canary = 'CANARY-Kyiv-Street-12';
    extra.I.sign(Object.assign(sg({ state: 'limit', kmh: 60, shown: 60, unit: 'kmh' }), { text: canary, road: canary }));
    extra[L.IF].displayDriverAssistanceLongitudinal({ activeFuncLongitudinal: 'XCC_AKTIV', note: canary, valueRequestedSpeed: canary, dispRequestedSpeed: { dispRequestedSpeedStatus: 2, name: canary } });
    const badLines = lines.filter((l) => !(l.indexOf(canary) < 0 && /^[A-Za-z0-9 ()._\/:,=\->]*$/.test(l.replace(/^WARN |^ERR /, ''))));
    ok(!badLines.length, 'no line carries more than letters, digits and the words of the format; a canary string in the struct never appears (' + lines.length + ' lines)' + (badLines.length ? ': ' + badLines[0] : ''));
    // a flood of changes is capped
    for (let i = 0; i < 400; i++) extra.I.sign(sg({ state: 'limit', kmh: 5 + (i % 240), shown: 5 + (i % 240), unit: 'kmh' }));
    ok(lines.length <= L.MAX_LINES + 2, 'the log stops after ' + L.MAX_LINES + ' limit lines (' + lines.length + ' written)');
    // a throw in a handler is caught
    const bad = { config: { sign: { iface: 'J', field: 'f' } }, log, sign: null };
    const ex2 = { J: { f: () => {} } };
    L.wire(bad, ex2);
    let threw = false; try { ex2.J.f({}); ex2[L.IF][L.FIELD](undefined); ex2[L.IF][L.FIELD]({ activeFuncLongitudinal: { x: 1 } }); } catch (e) { threw = true; }
    ok(!threw, 'a strange value in either handler never throws into the engine');
    // the marker hand-over
    const h2 = { config: { sign: { iface: 'K', field: 's' }, limit: { strip: 'L3' }, cruise: { place: 'C1' } }, log, sign: SIGN_NONE };
    const ex3 = { K: { s: (v) => { h2.sign = v; } } };
    L.wire(h2, ex3);
    ex3.K.s(sg({ state: 'limit', kmh: 90, shown: 90, unit: 'kmh', warn: 1 }));
    ex3[L.IF][L.FIELD]({ activeFuncLongitudinal: 1, valueRequestedSpeed: 110, dispRequestedSpeed: { dispRequestedSpeedStatus: 2 } });
    const marks = [];
    h2._twinMarks = () => marks.push({ lim: Object.assign({}, h2.twinLim), cru: Object.assign({}, h2.twinCru) });
    const xd = { ref: 1, tw: { tach: false }, c: { uniform() { throw new Error('B1\'s method sends the uniforms, not this file'); } } };
    L.dial(h2, xd); L.dial(h2, xd);
    ok(marks.length === 1 && marks[0].lim.deg === -12.5 && marks[0].lim.state === 1 && marks[0].lim.warn === 1 && marks[0].cru.deg === 6.25 && marks[0].cru.state === 1,
        'with B1\'s _twinMarks: hud.twinLim = { deg -12.5, state 1, warn 1 }, hud.twinCru = { deg 6.25, state 1 }, handed over once, not on every tick');
    ex3.K.s(sg({ state: 'limit', kmh: 130, shown: 130, unit: 'kmh' }));
    L.dial(h2, xd);
    ok(marks.length === 2 && marks[1].lim.deg === 18.75 && marks[1].lim.warn === 0, 'a new limit hands over again');
    // the stand-alone path: the uniforms themselves, to the speedometer only
    const sent = [];
    const h3 = { config: { limit: { strip: 'L2' }, cruise: { place: 'C1' } }, log, sign: SIGN_NONE };
    L.st(h3).disp = L.displayOf(sg({ state: 'limit', kmh: 50, shown: 50, unit: 'kmh' }));
    L.st(h3).cru = L.cruiseOf(L.cruiseCfg(h3.config), { activeFuncLongitudinal: 1, valueRequestedSpeed: 80, dispRequestedSpeed: { dispRequestedSpeedStatus: 2 } });
    const xs = { ref: 7, tw: { tach: false }, c: { uniform: (ref, n, v) => sent.push([ref, n, v.join()]) } }, xt = { ref: 8, tw: { tach: true }, c: { uniform: (ref, n, v) => sent.push([ref, n, v.join()]) } };
    L.dial(h3, xs, 'void main(){} uniform vec4 u_lim; uniform vec4 u_cru;'); L.dial(h3, xt, 'uniform vec4 u_lim; uniform vec4 u_cru;'); L.dial(h3, xs, 'uniform vec4 u_lim; uniform vec4 u_cru;');
    ok(sent.length === 2 && sent[0].join('|') === '7|u_lim|-62.5,1,0,2' && sent[1].join('|') === '7|u_cru|-25,1,0,0', 'alone: u_lim [-62.5, 1, 0, 2 (L2)] and u_cru [-25, 1, 0, 0] to the speedometer only, once');
    const none = [];
    L.dial(h3, { ref: 9, tw: { tach: false }, c: { uniform: () => none.push(1) } }, 'void main(){}');
    ok(none.length === 0, 'alone, with a shader that has no u_lim: nothing is sent (a name the shader lacks must never reach the car)');
}

// ---- car-fix CF2: shared/limit_src.js with the car's own values (2026-11-18) --------------------------------------------
const S = require(path.join(dir, 'limit_src.js'));
/** The TrafficSignRecognition event as the binding hands it over: every one of its 16 outputs, the car's values by default. */
const tsrEv = (o) => Object.assign({ presentWithdrawalLimitSpeed: 1, recognitionNoPassing: 0, nextWithdrawalLimitSpeed: 3, presentClassLimitSpeed: 8, nextClassLimitSpeed: 254,
    countryCodingTrafficSign: 0, displayTextMessage: 0, unitOfMeasurementSpeedLimit: 0, displayTextMessageNpi: 0, statusDataMatchingCameraADAS: 0, statusStreetTyp: 0,
    evaluationStreetTyp: 0, displaySupplementalSign: 0, triggerPresentClassLimitSpeed: 0, displaySpeedNPIDistance: 255, controlSLIWarning: 0 }, o || {});
/** DisplayDataServer.functionalLibraryData: the probe's first line (cruise 65535, LDM_SYM_NONE, LDM_OFF, the HUD off), then overrides. */
const hudEv = (o) => Object.assign({ speed: { kmH: 0, mlsH: 0 }, activeCruiseControl: { symbolACC: 'LDM_CAR_OFF', accBarsHUD: 0, barsColorACC: 'LDM_OFF' },
    xSpeedLimitAssist: { vSLISymbol: 'LDM_VZA_VSLI_NO_SYMBOL', vSLISpeedValue: 0 }, system: { modeHUD: 0, statusHUD: 'HUDSTATUS_OFF' }, rpm: 780, currentGear: 0,
    ldmSym: 'LDM_SYM_NONE', ldmSymColor: 'LDM_OFF', statusLimiter: 'STATUS_INACTIVE', cruiseCtrlSpeedHUD: 65535 }, o || {});

function srcChecks() {
    console.log('car-fix CF2: the TrafficSignRecognition event (shared/limit_src.js) with the car\'s values');
    const c = S.tsrCfg(APP.config.sign);
    ok(c && c.iface === S.TSR_IF && c.event === S.TSR_EV && c.factor === 5 && c.instance === '1', 'config.sign.tsr names the event de.bmw.dass.TrafficSignRecognition.TrafficSignRecognition, instance 1, factor 5');
    const seen = { 8: 40, 6: 30, 10: 50, 12: 60, 2: 10, 1: 5, 26: 130, 30: 150 };
    ok(Object.keys(seen).every((k) => { const r = S.tsrOf(c, tsrEv({ presentClassLimitSpeed: Number(k) })); return r.state === 'limit' && r.shown === seen[k] && r.kmh === seen[k] && r.unit === 'kmh' && r.src === 'tsr' && r.cls === Number(k); }),
        'class x 5 = km/h: 8 -> 40, 6 -> 30, 10 -> 50, 12 -> 60, 2 -> 10, 1 -> 5 (the car\'s), 26 -> 130, 30 -> 150');
    ok([0, 29, 253, 254, 255, 51, 99, -1, 'x', null, undefined].every((k) => S.tsrOf(c, tsrEv({ presentClassLimitSpeed: k })).state === 'none'),
        '0, 29 (the chime request), 253, 254, 255, out of range (51 = 255 km/h, 99, -1), not a number: no sign');
    ok(S.tsrOf(c, tsrEv({ presentClassLimitSpeed: '8' })).kmh === 40, 'a class handed over as a numeric string still reads');
    ok(S.tsrOf(c, tsrEv({ controlSLIWarning: 1 })).warn === 1 && S.tsrOf(c, tsrEv({ controlSLIWarning: 0 })).warn === 0 && S.tsrOf(c, tsrEv({ controlSLIWarning: 3 })).warn === 0,
        'controlSLIWarning 1 -> warn 1 (over the limit: the hypothesis), 0 and 3 (unfilled) -> 0');
    const m = S.tsrOf(c, tsrEv({ unitOfMeasurementSpeedLimit: 1, presentClassLimitSpeed: 6 }));
    ok(m.unit === 'mph' && m.shown === 30 && near(m.kmh, 48.28032, 1e-9) && S.tsrOf(c, tsrEv({ unitOfMeasurementSpeedLimit: 3 })).unit === 'kmh' && S.tsrOf(c, tsrEv({ unitOfMeasurementSpeedLimit: 2 })).unit === 'kmh',
        'the unit: 1 (MPH by FASuS\'s enum) -> 30 mph = 48.28 km/h for the marker; 0, 2, 3 -> km/h');
    ok(S.tsrOf(c, tsrEv({ presentWithdrawalLimitSpeed: 2 })).state === 'limit' && S.tsrOf(Object.assign({}, c, { endOn: [2] }), tsrEv({ presentWithdrawalLimitSpeed: 2 })).state === 'end',
        'withdrawal 2 (AUFHEBUNG) changes nothing until config.sign.tsr.endOn names it (then the end sign)');
    ok([null, undefined, 5, 'x', []].every((v) => S.tsrOf(c, v).state === 'none') && S.tsrOf(null, tsrEv()).state === 'none', 'not a struct, or no config: no sign');
    ok(S.tsrCfg({ iface: 'I', field: 'f' }) === null && S.tsrCfg({ tsr: null }) === null && S.events({ iface: 'I', field: 'f' }).length === 0 && S.events(APP.config.sign).join() === [S.TSR_IF, S.TSR_EV].join(),
        'a config.sign without "tsr" subscribes no event (an app opts in); twin_dial\'s does: [' + S.events(APP.config.sign).join(', ') + ']');
    // the display through twin_limit, and the marker
    ok(L.displayOf(S.tsrOf(c, tsrEv())).kind === 'limit' && L.limUniform(L.displayOf(S.tsrOf(c, tsrEv())), 'L1').join() === '-75,1,0,1' &&
        L.limUniform(L.displayOf(S.tsrOf(c, tsrEv({ presentClassLimitSpeed: 6 }))), 'L1').join() === '-87.5,1,0,1' && L.limUniform(L.displayOf(S.tsrOf(c, tsrEv({ presentClassLimitSpeed: 10, controlSLIWarning: 1 }))), 'L1').join() === '-62.5,1,1,1',
        'the event\'s 40 / 30 / 50 (warn 1) give u_lim [-75, 1, 0, 1], [-87.5, 1, 0, 1], [-62.5, 1, 1, 1]');

    console.log('car-fix CF2: the camera witness');
    const cam = { eventDataQualifier: 'X', trafficSignRecognition: { version: 1, speedLimitUnit: 'KMH' }, trafficSign: [{ value: 0, type: 'NO_PASSING' }, { value: 40, type: 'SPEED_LIMIT', trafficSignForm: 'ROUND' }] };
    const w = S.camOf(cam);
    ok(w && w.value === 40 && w.kmh === 40 && w.unit === 'kmh' && w.n === 2, 'the camera\'s [value=40 type=SPEED_LIMIT form=ROUND] reads as 40 km/h (the first speed-limit sign of the list)');
    ok(S.camOf({ trafficSign: [{ value: 40, type: 'END_OF_SPEED_LIMIT' }] }) === null && S.camOf({ trafficSign: [] }) === null && S.camOf(null) === null, 'an end sign, an empty list or nothing: no witness');

    console.log('car-fix CF2: the merger (the event first, config.sign\'s field the fallback)');
    const lines = [];
    let t = 1000;
    const mg = S.create(APP.config.sign, { log: { info: (s) => lines.push(s) }, clock: () => t });
    ok(mg.current().state === 'none' && mg.source() === null, 'nothing yet: no sign');
    let r = mg.tsr(tsrEv());
    ok(r.state === 'limit' && r.kmh === 40 && mg.source() === 'tsr', 'the event alone (the owner\'s car): its 40 is the sign');
    t = 1400; r = mg.field(sg({ state: 'limit', kmh: 70, shown: 70, unit: 'kmh' }));
    ok(r.kmh === 40 && r.src === 'tsr', 'the field speaks while the event is live: the event still wins (config.sign.order tsr, field)');
    t = 5000; r = mg.field(sg({ state: 'limit', kmh: 70, shown: 70, unit: 'kmh' }));
    ok(r.kmh === 70 && r.src === 'field' && mg.source() === 'field', 'the event silent for longer than staleMs (3000): the field takes over');
    t = 5100; r = mg.tsr(tsrEv({ presentClassLimitSpeed: 6 }));
    ok(r.kmh === 30 && mg.source() === 'tsr', 'the event back: it wins again');
    t = 5200; r = mg.tsr(tsrEv({ presentClassLimitSpeed: 255 }));
    ok(r.kmh === 70 && r.src === 'field', 'the event says "none" (255) while the field holds a limit: the field\'s');
    const solo = S.create(APP.config.sign, { log: null, clock: () => t });
    solo.tsr(tsrEv()); t = 99999;
    ok(solo.tsr(tsrEv({ presentClassLimitSpeed: 255 })).state === 'none' && solo.current().state === 'none', 'the event alone saying 255: no sign (no field to fall back on)');
    t = 200000;
    ok(solo.current().src === 'tsr', 'the event alone, gone quiet: its last reading stays (nothing newer)');
    mg.cam({ trafficSignRecognition: { speedLimitUnit: 'KMH' }, trafficSign: [{ value: 30, type: 'SPEED_LIMIT' }] });
    mg.tsr(tsrEv({ presentClassLimitSpeed: 6 }));
    ok(lines.some((l) => l === 'limit: camera 30 kmh') && lines.some((l) => l === 'limit: camera 30 km/h, tsr 30 km/h agree'), 'the camera is logged as a witness, with the verdict "agree"');
    mg.cam({ trafficSignRecognition: { speedLimitUnit: 'KMH' }, trafficSign: [{ value: 50, type: 'SPEED_LIMIT' }] });
    ok(lines[lines.length - 1] === 'limit: camera 50 km/h, tsr 30 km/h differ', '... and "differ" when it reads another number: "' + lines[lines.length - 1] + '"');
    ok(lines.some((l) => /^limit: tsr class 8 -> limit 40 kmh warn 0 \(warn raw 0, withdrawal 1, unit raw 0, next class 254\)$/.test(l)) && lines.some((l) => l === 'limit: source tsr (TrafficSignRecognition event)') && lines.some((l) => l === 'limit: source field (TrafficSignDisplayControl)'),
        'the log: "limit: tsr class 8 -> limit 40 kmh ..." and a line per change of source');
    const n0 = lines.length;
    for (let i = 0; i < 20; i++) mg.tsr(tsrEv({ presentClassLimitSpeed: 6 }));
    ok(lines.length === n0, 'the event twice a second with nothing new writes nothing');
    const canary = 'CANARY-Kyiv-Street-12';
    mg.tsr(tsrEv({ presentClassLimitSpeed: 12, unitOfMeasurementSpeedLimit: canary, controlSLIWarning: canary, nextClassLimitSpeed: canary, road: canary }));
    mg.cam({ trafficSignRecognition: { speedLimitUnit: canary }, trafficSign: [{ value: 60, type: 'SPEED_LIMIT', text: canary }] });
    ok(lines.every((l) => l.indexOf(canary) < 0 && /^[A-Za-z0-9 ()._\/:,=\->]*$/.test(l)), 'every line is numbers, enum names and the format\'s words; a canary in any member never appears (' + lines.length + ' lines)');
    const flood = S.create(APP.config.sign, { log: { info: (s) => lines.push(s) }, clock: () => t });
    const f0 = lines.length;
    for (let i = 0; i < 500; i++) flood.tsr(tsrEv({ presentClassLimitSpeed: 1 + (i % 28) }));
    ok(lines.length - f0 <= S.MAX_LINES, 'a flood of changes is capped at ' + S.MAX_LINES + ' lines (' + (lines.length - f0) + ')');
    const ex = {}, got = [];
    const wm = S.create(APP.config.sign, { log: null });
    ex[S.TSR_IF] = { [S.TSR_EV]: () => got.push('before') };
    wm.wire(ex, (rd) => got.push(rd.kmh));
    ex[S.TSR_IF][S.TSR_EV](tsrEv({ presentClassLimitSpeed: 10 }));
    ex[S.CAM_IF][S.CAM_EV]({ trafficSign: [{ value: 50, type: 'SPEED_LIMIT' }] });
    ok(got.join() === 'before,50' && !ex[S.TSR_IF].$instance && Object.keys(ex).length === 2 && typeof ex[S.CAM_IF][S.CAM_EV] === 'function',
        'wire: the event handler (a handler already there runs first) hands the merged reading to the engine; the camera is subscribed, instance 1 (no $instance)');

    console.log('car-fix CF2: cruise / limiter from DisplayDataServer (the car\'s values)');
    const h = S.hudCruiseCfg(APP.config.cruise);
    const hc = (o) => S.hudCruiseOf(h, hudEv(o));
    ok(APP.config.cruise && APP.config.cruise.place === 'C1', 'config.cruise is { place: "C1" }: switched on');
    ok(hc().status === 'off' && hc().kind === null, 'the probe\'s first line (cruise 65535, LDM_SYM_NONE, LDM_OFF): nothing');
    const a61 = hc({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 61 });
    ok(a61.kind === 'cruise' && a61.status === 'active' && a61.shown === 61 && a61.kmh === 61 && a61.unit === 'kmh', 'DCC, ACTIVE, 61: the cruise, active (green), 61 km/h');
    ok(hc({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 59 }).shown === 59, '59 the same');
    const s40 = hc({ ldmSym: 'LDM_SYM_SLD', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 40 });
    ok(s40.kind === 'limiter' && s40.status === 'active' && s40.shown === 40, 'SLD, ACTIVE, 40: the limiter, active, 40');
    ok(hc({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_OFF', cruiseCtrlSpeedHUD: 61 }).status === 'standby' && hc({ ldmSym: 'LDM_SYM_SLD', ldmSymColor: 'LDM_STANDBY', cruiseCtrlSpeedHUD: 40 }).status === 'standby' &&
        hc({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_UEBERTRETEN', cruiseCtrlSpeedHUD: 61 }).status === 'standby', 'any colour but LDM_ACTIVE (OFF, STANDBY, overridden): grey (standby)');
    ok(hc({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 65535 }).status === 'off' && hc({ ldmSym: 'LDM_SYM_NONE', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 61 }).status === 'off' &&
        hc({ ldmSym: 'LDM_SYM_HDC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 8 }).status === 'off', 'set speed 65535, LDM_SYM_NONE, hill descent: nothing at all');
    ok(hc({ ldmSym: 1, ldmSymColor: 1, cruiseCtrlSpeedHUD: 61 }).status === 'active' && hc({ ldmSym: 7, ldmSymColor: 0, cruiseCtrlSpeedHUD: 40 }).kind === 'limiter' && hc({ ldmSym: 'LDM_SYM_ACC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 100 }).kind === 'acc',
        'enums as numbers (1 DCC, 7 SLD, colour 1 ACTIVE) and the adaptive family (LDM_SYM_ACC -> acc)');
    ok(JSON.stringify(L.cruUniform(a61)) === '[-48.75,1,0,0]' && JSON.stringify(L.cruUniform(s40)) === '[-75,1,0,0]' && L.cruUniform(hc({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_OFF', cruiseCtrlSpeedHUD: 61 }))[1] === 0,
        'u_cru: 61 active [-48.75, 1, 0, 0], the limiter at 40 [-75, 1, 0, 0], grey: no marker');
    // the handlers through twin_limit: the HUD feed wins once it has spoken
    const hl = [];
    const hud = { config: { sign: APP.config.sign, limit: { strip: 'L1' }, cruise: { place: 'C1' } }, log: { info: (x) => hl.push(x), warn: (x) => hl.push('WARN ' + x), error: (x) => hl.push('ERR ' + x) }, sign: SIGN_NONE };
    const ex2 = { [APP.config.sign.iface]: { [APP.config.sign.field]: () => {} }, [S.TSR_IF]: { [S.TSR_EV]: (v) => { hud.sign = S.tsrOf(S.tsrCfg(APP.config.sign), v); } } };
    L.wire(hud, ex2);
    ok(typeof ex2[S.DDS_IF][S.DDS_F] === 'function' && !ex2[S.DDS_IF].$instance, 'twin_limit.wire watches DisplayDataServer.functionalLibraryData (instance 1)');
    ex2[S.TSR_IF][S.TSR_EV](tsrEv());
    ok(L.displayNow(hud).kind === 'limit' && L.displayNow(hud).shown === 40 && hl.some((x) => x === 'limit: limit 40 kmh (40 km/h) conditional no warn 0'), 'the event reaches the sign through twin_limit\'s chain: 40, logged');
    ex2[L.IF][L.FIELD]({ activeFuncLongitudinal: 'XCC_AKTIV', valueRequestedSpeed: 110, dispRequestedSpeed: { dispRequestedSpeedStatus: 2 } });
    ok(L.cruiseNow(hud).shown === 110, 'before the HUD feed: TrafficSignDisplayControl\'s struct is the reading (the fallback)');
    ex2[S.DDS_IF][S.DDS_F](hudEv());
    ok(L.cruiseNow(hud).status === 'off', 'the HUD feed arrives (65535, NONE): it wins, nothing is drawn');
    ex2[S.DDS_IF][S.DDS_F](hudEv({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 61 }));
    ok(L.cruiseNow(hud).kind === 'cruise' && L.cruiseNow(hud).shown === 61, 'DCC 61 active');
    const nh = hl.length;
    for (let i = 0; i < 30; i++) ex2[S.DDS_IF][S.DDS_F](hudEv({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 61, rpm: 1500 + i * 10, speed: { kmH: 60 + i, mlsH: 0 } }));
    ok(hl.length === nh, 'the feed again and again (rpm and speed changing): no new line');
    ok(hl.some((x) => x === 'limit: cruise hud ldm LDM_SYM_DCC colour LDM_ACTIVE speed 61 limiter STATUS_INACTIVE -> cruise active 61 km/h'), 'the line names ldm, colour, speed, limiter and the reading');
}

// =====================================================================================================================
// Part 2: the engine
// =====================================================================================================================
function startRender(sockPath) {
    const st = { layers: new Map(), hellos: [], refusals: [] };
    const writeEv = (sock, obj) => {
        const body = Buffer.from(JSON.stringify(obj), 'utf8'), m = Buffer.alloc(5 + body.length);
        m.writeUInt32LE(body.length + 1, 0); m[4] = 0x4a; body.copy(m, 5); sock.write(m);
    };
    const server = net.createServer((sock) => {
        const c = { app: '?', buf: Buffer.alloc(0) };
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
                if (m.op === 'hello') { c.app = m.app; st.hellos.push(m.app); writeEv(sock, { ev: 'hello', backend: 'twin-limit-test', targets: 'panel' }); continue; }
                if (m.op === 'layer' || m.op === 'asset') { st.layers.set(c.app + ':' + m.ref, m); writeEv(sock, { ev: 'layer', ref: m.ref, state: 'shown' }); }
                else if (m.op === 'drop') st.layers.delete(c.app + ':' + m.ref);
            }
            c.buf = c.buf.slice(off);
        });
        sock.on('error', () => {});
    });
    return new Promise((resolve) => { try { fs.unlinkSync(sockPath); } catch (e) { /* none */ } server.listen(sockPath, () => resolve({ st, server })); });
}

function buildApp() {
    const sdk = path.join(ROOT, 'oap-sdk');
    if (!fs.existsSync(path.join(sdk, 'index.js'))) {
        fs.mkdirSync(sdk, { recursive: true });
        fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
        fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    }
    execFileSync('python3', [path.join(ROOT, 'kit', 'tools', 'build.py'), APP_ID], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function engineChecks() {
    console.log('the real engine: apps/twin_dial built, signals fed, the layers read back');
    buildApp();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twin-limit-'));
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const sockPath = path.join(tmp, 'render.sock');
    const { st, server } = await startRender(sockPath);
    process.env.HUD_CLUSTER_SOCKET = sockPath;
    const logs = [];
    const log = { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERROR ' + a.join(' ')), debug: () => {} };
    const { headUnit } = require(path.join(ROOT, 'kit', 'tools', 'hu-stub.js'));
    const hu = headUnit(STAGE, { live: true, dataDir, log, image: () => Promise.resolve(), sets: { demo: 'off' } });
    let hud = null;
    const realLoad = Module._load;
    Module._load = function (req) {
        const m = realLoad.apply(this, arguments);
        if (req === './hud' && typeof m === 'function' && !m.__twinLimit) {
            const W = class extends m { constructor(ctx) { super(ctx); hud = this; } };
            W.__twinLimit = true;
            return W;
        }
        return m;
    };
    const fakeSigns = require(path.join(__dirname, 'fake-signs')).install(hu, hu.spec.config, log);
    const turn = () => new Promise((r) => setImmediate(() => setImmediate(r)));
    const until = async (fn, ms) => { const end = Date.now() + (ms || 4000); while (Date.now() < end) { if (fn()) { await turn(); return true; } await sleep(15); } return fn(); };

    const SIGN_IF = L.IF, SIGN_F = 'displaySpeedLimitAndNoPassingRestriction';
    const feedSign = (o) => hu.feed(SIGN_IF, SIGN_F, Object.assign({ invalidFlag: 0, displaySymbolStyle: 'ECE', displayNoPassingRestriction: 'KEIN_UEBERHOLVERBOT_ERKANNT', displayRemainingDistanceNoPassingRestriction: 0,
        displaySpeedLimitSupplemental: 'KEIN_ZUSATZZEICHEN', displaySpeedLimitUnit: 'KMH', displaySpeedLimit: 50, displaySpeedLimitWarning: 'SLI_WARNUNG_NICHT_ANGEFORDERT' }, o || {}));
    const feedCru = (o) => hu.feed(SIGN_IF, L.FIELD, Object.assign({ invalidFlag: 0, activeFuncLongitudinal: 'XCC_AKTIV', dispXCC: { dispXCCStatus: 'DISP_XCC' }, dispSLD: { dispSLDStatus: 'SLD_OFF' }, valueRequestedSpeed: 110,
        dispRequestedSpeed: { dispRequestedSpeedStatus: 'DISP_OF_REQUESTED_SPEED_ACTIVE', unitOfRequestedSpeedValue: false } }, o || {}));
    // the sheet of a widget as the engine's own client holds it
    const sheetOf = (id) => {
        const x = hud.widgets.get(id);
        if (!x || !x.sheet) return null;
        const l = x.c.layers.get(x.sheet.ref);
        if (!l || !l.image) return null;
        return { buf: l.image, w: l.iw, h: l.ih, x: x.sheet.x, y: x.sheet.y, layer: l };
    };
    const inkOf = (s, pred) => { let n = 0; for (let i = 0; i < s.w * s.h; i++) { const p = [s.buf[i * 4], s.buf[i * 4 + 1], s.buf[i * 4 + 2], s.buf[i * 4 + 3]]; if (p[3] > 60 && (!pred || pred(p))) n++; } return n; };
    const dishes = (s) => px(s.buf, s.w, 48, 24);          // white disc, above the figure
    const marks = [];
    const settle = async () => { await sleep(160); await turn(); };

    hu.start();
    const started = await until(() => hud && hud.client && hud.client.ready && hud.widgets.has('limit_sign') && hud.widgets.has('dial_speed'), 10000);
    ok(started, 'the engine is up on twin_dial\'s layout (' + (hud ? hud.widgets.size : 0) + ' widgets)');
    if (!started) { console.log(logs.slice(-20).join('\n')); throw new Error('engine did not start'); }
    // B1's _twinMarks, when it is not in the tree yet, is stood in for by a recorder; when it is, it is wrapped
    const own = typeof hud._twinMarks === 'function' ? hud._twinMarks : null;
    hud._twinMarks = function () { marks.push({ lim: Object.assign({}, hud.twinLim), cru: Object.assign({}, hud.twinCru) }); if (own) return own.apply(this, arguments); return undefined; };
    hu.settings.set('nightLook', 'off');          // by day (the default "auto" follows the sun: the test must not depend on the hour)
    await sleep(400);

    // layers and memory
    const perConn = {}; hud.clients.forEach((c, i) => { let n = 0; c.layers.forEach((l) => { if (l.kind !== 'asset') n++; }); perConn[i] = n; });
    ok(Object.keys(perConn).every((k) => perConn[k] <= 8), 'at most 8 layers on every connection: ' + JSON.stringify(perConn));
    const sheet0 = sheetOf('limit_sign');
    ok(sheet0 && sheet0.w === 96 && sheet0.h === 88 && sheet0.x === 1252 && sheet0.y === 628 && hud.widgets.get('limit_sign').ci === 2, 'the sign is an image sheet of exactly 96 x 88 at [1252, 628] on connection 2 (a layer of its own)');
    ok(sheet0 && inkOf(sheet0) === 0, 'before the car says anything: the sheet is blank (no sign at all)');
    ok(hud.widgets.has('cruise_c1') && !hud.widgets.has('cruise_c2') && sheetOf('cruise_c1') && inkOf(sheetOf('cruise_c1')) === 0, 'config.cruise is { place: "C1" } (car-fix CF2): the C1 readout is built, blank before the car says anything');
    ok(hud.config.sign && hud.config.sign.iface === SIGN_IF && hud.subsOk !== false, 'the engine\'s own reading of config.sign is on (hud.sign)');

    // the signal path: the field arrives
    marks.length = 0;
    feedSign({ displaySpeedLimit: 50 });
    await settle();
    let s = sheetOf('limit_sign');
    ok(hud.sign && hud.sign.state === 'limit' && near(hud.sign.kmh, 50), 'the engine\'s signOf reads the struct: limit 50');
    ok(inkOf(s) > 3000 && px(s.buf, s.w, 48 + 29, 44).slice(0, 3).join() === L.COL.red.join() && dishes(s)[3] === 255 && dishes(s)[0] === 250, 'a limit of 50: the sign is on the sheet (red ring, white disc, ' + inkOf(s) + ' px of ink; ring pixel ' + px(s.buf, s.w, 48 + 29, 44) + ', disc pixel ' + dishes(s) + ')');
    ok(marks.length >= 1 && near(hud.twinLim.deg, -62.5) && hud.twinLim.state === 1 && hud.twinLim.warn === 0 && hud.twinCru.state === 0, 'the marker: hud.twinLim = { deg -62.5, state 1, warn 0 }, no cruise marker');
    const one = marks.length;
    await sleep(300);
    ok(marks.length === one, 'a tick with nothing new hands nothing over again');
    ok(logs.some((l) => l === 'limit: limit 50 kmh (50 km/h) conditional no warn 0'), 'the log has "limit: limit 50 kmh (50 km/h) conditional no warn 0"');

    // every marker angle of SPEC-R3 8 through the engine
    const want = { 30: -87.5, 70: -37.5, 90: -12.5, 110: 6.25, 130: 18.75 };
    let angOk = true;
    for (const k of Object.keys(want)) { feedSign({ displaySpeedLimit: Number(k) }); await settle(); if (!near(hud.twinLim.deg, want[k], 1e-6) || hud.twinLim.state !== 1) angOk = false; }
    ok(angOk, 'the markers at 30 70 90 110 130 are at -87.5 -37.5 -12.5 +6.25 +18.75 degrees');

    // over the limit
    feedSign({ displaySpeedLimit: 50, displaySpeedLimitWarning: 'SLI_WARNUNG_ANGEFORDERT' });
    await settle();
    ok(hud.twinLim.warn === 1 && hud.twinLim.state === 1, 'the car\'s warning (level 1) reaches u_lim.z; the sign is not repainted differently');
    const keyOver = sheetOf('limit_sign').buf.toString('base64');
    feedSign({ displaySpeedLimit: 50 });
    await settle();
    ok(hud.twinLim.warn === 0 && sheetOf('limit_sign').buf.toString('base64') === keyOver, 'the sign\'s pixels are the same with and without the warning (we never flash it)');

    // unknown / end / none / invalid / conditional / mph
    feedSign({ displaySpeedLimit: 254 });
    await settle();
    s = sheetOf('limit_sign');
    ok(hud.sign.state === 'unknown' && inkOf(s) > 3000 && hud.twinLim.state === 0 && hud.twinLim.deg === 0, 'unknown (254): the empty sign with its dashes, no marker');
    feedSign({ displaySpeedLimit: 255 }); await settle();
    ok(hud.sign.state === 'unknown' && hud.twinLim.state === 0, 'unknown (255): the same');
    feedSign({ displaySpeedLimit: 50, displaySpeedLimitUnit: 'NICHT_VERFUEGBAR' }); await settle();
    ok(hud.sign.state === 'unknown' && hud.twinLim.state === 0, 'unknown (the unit "not available"): the same');
    feedSign({ displaySpeedLimit: 0 });
    await settle();
    s = sheetOf('limit_sign');
    ok(hud.sign.state === 'end' && inkOf(s) > 3000 && inkOf(s, (p) => p[0] > 150 && p[1] < 60) === 0 && hud.twinLim.state === 0, 'end of restrictions (0): the derestriction sign (no red), no marker');
    feedSign({ displaySpeedLimit: 90, invalidFlag: 1 });
    await settle();
    s = sheetOf('limit_sign');
    ok(hud.sign.state === 'none' && inkOf(s) === 0 && hud.twinLim.state === 0, 'invalidFlag: nothing at all (a blank sheet), no marker');
    feedSign({ displaySpeedLimit: 3 }); await settle();
    ok(hud.sign.state === 'none' && hud.twinLim.state === 0 && inkOf(sheetOf('limit_sign')) === 0, 'a value outside 5..250: nothing, no marker');
    feedSign({ displaySpeedLimit: 70, displaySpeedLimitSupplemental: 'REGEN' });
    await settle();
    s = sheetOf('limit_sign');
    ok(hud.twinLim.state === 2 && near(hud.twinLim.deg, -37.5) && px(s.buf, s.w, 48, 44 + Math.round(L.SHAPE.dotDy))[3] === 255, 'conditional (rain): the sign with the dot under it, the marker hollow (state 2)');
    feedSign({ displaySpeedLimit: 30, displaySpeedLimitUnit: 'MPH' });
    await settle();
    ok(hud.sign.unit === 'mph' && near(hud.twinLim.deg, -125 + 1.25 * 48.28032, 1e-2) && hud.twinLim.state === 1, 'mph: the sign shows 30, the marker is at 48.28 km/h (-64.65 deg)');
    const mphSheet = sheetOf('limit_sign').buf.toString('base64');
    feedSign({ displaySpeedLimit: 30, displaySpeedLimitUnit: 'KMH' }); await settle();
    ok(sheetOf('limit_sign').buf.toString('base64') === mphSheet, 'the sign shows the number as the car gives it: 30 mph and 30 km/h look the same');

    // the sign stays while BMW's fallback window is open
    feedSign({ displaySpeedLimit: 50 });
    await settle();
    const before = sheetOf('limit_sign').buf.toString('base64');
    fakeSigns.control({ ccList: [{ id: 15, name: 'Door open', color: 'white', symbol: 2 }] });
    await sleep(400);
    ok(hud._toggleOn('cc:window') && hud._ccOpen() === true, 'BMW\'s fallback window is open (a message may show and the engine is blind to it)');
    ok(sheetOf('limit_sign').buf.toString('base64') === before && inkOf(sheetOf('limit_sign')) > 3000 && hud.widgets.get('limit_sign').w.toggle === undefined, 'the sign is still on the sheet, pixel for pixel, with the window open');
    feedSign({ displaySpeedLimit: 80 });
    await settle();
    ok(near(hud.twinLim.deg, -25) && sheetOf('limit_sign').buf.toString('base64') !== before, 'and it still follows the car while the window is open');

    // the sign survives a rebuild (a layout rebuild paints it again from what it knows)
    hud._rebuild();
    await until(() => hud.widgets.has('limit_sign') && sheetOf('limit_sign') && inkOf(sheetOf('limit_sign')) > 0, 5000);
    ok(inkOf(sheetOf('limit_sign')) > 3000, 'after a rebuild the sign is painted again at once (' + inkOf(sheetOf('limit_sign')) + ' px)');

    // night
    const dayWhite = dishes(sheetOf('limit_sign'))[0];
    hu.settings.set('nightLook', 'on');
    await settle(); await sleep(200);
    const nightWhite = dishes(sheetOf('limit_sign'))[0];
    ok(nightWhite < dayWhite && nightWhite >= 220 && nightWhite <= 235, 'night: the sign\'s white is x 0.8 in linear light, in place (' + dayWhite + ' -> ' + nightWhite + ')');
    hu.settings.set('nightLook', 'off');
    await settle(); await sleep(200);
    ok(dishes(sheetOf('limit_sign'))[0] === dayWhite, 'and back to day');

    // car-fix CF2: the sign from the TrafficSignRecognition event, through the real engine (hud.js -> limit_src -> twin_limit)
    ok(hud.limitSrc && hud.limitSrc.source() === 'field', 'so far only config.sign\'s field has spoken (the bench\'s stand-in): its source is the field');
    hu.feed(S.TSR_IF, S.TSR_EV, tsrEv({ presentClassLimitSpeed: 8 }));
    await settle();
    s = sheetOf('limit_sign');
    ok(hud.sign.src === 'tsr' && hud.sign.state === 'limit' && hud.sign.kmh === 40 && hud.limitState === 'limit' && hud.limitKmh === 40 && near(hud.twinLim.deg, -75) && hud.twinLim.state === 1,
        'the event, class 8: the engine\'s sign is 40 from the event (limitKmh 40), the marker at -75 degrees');
    const s40 = s.buf.toString('base64');
    feedSign({ displaySpeedLimit: 90 }); await settle();
    ok(hud.sign.kmh === 40 && hud.sign.src === 'tsr' && sheetOf('limit_sign').buf.toString('base64') === s40, 'the field says 90 while the event is live: the event\'s 40 stays (pixel for pixel)');
    hu.feed(S.TSR_IF, S.TSR_EV, tsrEv({ presentClassLimitSpeed: 6 })); await settle();
    ok(hud.sign.kmh === 30 && near(hud.twinLim.deg, -87.5) && sheetOf('limit_sign').buf.toString('base64') !== s40, 'class 6 (a 30 sign): 30, the marker at -87.5 degrees, the sign repainted');
    hu.feed(S.TSR_IF, S.TSR_EV, tsrEv({ presentClassLimitSpeed: 10, controlSLIWarning: 1 })); await settle();
    ok(hud.sign.kmh === 50 && hud.sign.warn === 1 && hud.twinLim.warn === 1 && near(hud.twinLim.deg, -62.5), 'class 10 with controlSLIWarning 1: 50, the over-limit level 1 reaches u_lim.z');
    const limLogs = () => logs.filter((l) => /^limit:|^sign:/.test(l)).length;
    const m0 = marks.length, l0 = limLogs();
    for (let i = 0; i < 6; i++) { hu.feed(S.TSR_IF, S.TSR_EV, tsrEv({ presentClassLimitSpeed: 10, controlSLIWarning: 1 })); await sleep(40); }
    await settle();
    ok(marks.length === m0 && limLogs() === l0, 'the event repeating (twice a second on the car) hands nothing over and logs nothing');
    hu.feed(S.TSR_IF, S.TSR_EV, tsrEv({ presentClassLimitSpeed: 12, unitOfMeasurementSpeedLimit: 1 })); await settle();
    ok(hud.sign.unit === 'mph' && hud.sign.shown === 60 && near(hud.twinLim.deg, L.angleOf(60 * 1.609344), 1e-2), 'the unit 1 (MPH): 60 on the sign, the marker at 96.6 km/h');
    hu.feed(S.TSR_IF, S.TSR_EV, tsrEv({ presentClassLimitSpeed: 8 })); await settle();
    ok(logs.some((l) => l === 'limit: source tsr (TrafficSignRecognition event)') && logs.some((l) => /^limit: tsr class 8 -> limit 40 kmh warn 0 /.test(l)) && logs.some((l) => l === 'limit: limit 40 kmh (40 km/h) conditional no warn 0'),
        'the log: the source, "limit: tsr class 8 -> limit 40 kmh ...", and twin_limit\'s own "limit: limit 40 kmh ..."');
    hu.feed(S.CAM_IF, S.CAM_EV, { eventDataQualifier: 'X', trafficSignRecognition: { version: 1, speedLimitUnit: 'KMH' }, trafficSign: [{ value: 40, type: 'SPEED_LIMIT', trafficSignForm: 'ROUND' }] }); await settle();
    ok(logs.some((l) => l === 'limit: camera 40 km/h, tsr 40 km/h agree') && hud.sign.kmh === 40, 'the camera\'s 40 is logged as agreeing; it draws nothing of its own');
    // the event goes quiet: the field takes over after staleMs (shortened here: the merger reads it live)
    hud.limitSrc.cfg.tsr.staleMs = 150;
    await sleep(250);
    feedSign({ displaySpeedLimit: 90 }); await settle();
    ok(hud.sign.src === 'field' && hud.sign.kmh === 90 && near(hud.twinLim.deg, -12.5) && logs.some((l) => l === 'limit: source field (TrafficSignDisplayControl)'), 'the event silent past staleMs: config.sign\'s field (90) is the fallback');
    hu.feed(S.TSR_IF, S.TSR_EV, tsrEv({ presentClassLimitSpeed: 255 })); await settle();
    ok(hud.sign.src === 'field' && hud.sign.kmh === 90, 'the event back with 255 (no limit known): the field\'s 90 stays');
    hud.limitSrc.cfg.tsr.staleMs = 3000;

    // cruise: dark (the fallback struct first: the HUD feed has not spoken yet)
    hud.config.cruise = null;
    hud._rebuild();
    await until(() => !hud.widgets.has('cruise_c1') && hud.widgets.has('limit_sign') && sheetOf('limit_sign'), 6000);
    await settle();
    marks.length = 0;
    feedCru();
    await settle();
    ok(hud.tl.cru.status === 'active' && hud.twinCru.state === 0 && !hud.widgets.has('cruise_c1'), 'config.cruise null: the struct is read (active, 110) but nothing is drawn and the marker stays off');
    ok(logs.some((l) => /^limit: cruise raw func XCC_AKTIV status DISP_OF_REQUESTED_SPEED_ACTIVE speed 110 .* -> cruise active 110 km\/h \(drawing is off: config.cruise null\)$/.test(l)), 'the log line for the car session names the raw members and says the drawing is off');

    // cruise: lit
    hud.config.cruise = { place: 'C1' };
    hud._rebuild();
    const lit = await until(() => hud.widgets.has('cruise_c1') && sheetOf('cruise_c1'), 6000);
    ok(lit && !hud.widgets.has('cruise_c2'), 'config.cruise = { place: "C1" }: the readout is built (and only the C1 one)');
    await settle();
    const green = (p) => p[1] > p[0] + 40 && p[1] > p[2] + 40;
    let c1 = sheetOf('cruise_c1');
    ok(c1.w === 140 && c1.h === 70 && c1.x === 1456 && c1.y === 500 && inkOf(c1, green) > 300, 'cruise 110, active: the readout is on its sheet [1456, 500, 140, 70] in green (' + inkOf(c1, green) + ' px)');
    ok(near(hud.twinCru.deg, 6.25) && hud.twinCru.state === 1, 'and the green marker is at +6.25 degrees (u_cru state 1)');
    feedCru({ dispRequestedSpeed: { dispRequestedSpeedStatus: 'DISP_OF_REQUESTED_SPEED_STANDBY', unitOfRequestedSpeedValue: false } }); await settle();
    c1 = sheetOf('cruise_c1');
    ok(hud.twinCru.state === 0 && inkOf(c1, green) === 0 && inkOf(c1) > 300, 'standby: the readout turns grey and the marker goes');
    feedCru({ dispRequestedSpeed: { dispRequestedSpeedStatus: 'NO_DISP_OF_REQUESTED_SPEED', unitOfRequestedSpeedValue: false } }); await settle();
    ok(hud.twinCru.state === 0 && inkOf(sheetOf('cruise_c1')) === 0, 'off: nothing');
    feedCru({ activeFuncLongitudinal: 'SLD_AKTIV', valueRequestedSpeed: 90, dispRequestedSpeed: { dispRequestedSpeedStatus: 'DISP_OF_REQUESTED_SPEED_ACTIVE', unitOfRequestedSpeedValue: false } }); await settle();
    ok(hud.tl.cru.kind === 'limiter' && near(hud.twinCru.deg, -12.5) && inkOf(sheetOf('cruise_c1'), green) > 300, 'the limiter at 90: the readout and the marker at -12.5 degrees');
    ok(inkOf(sheetOf('limit_sign')) > 3000, 'the sign is unaffected by cruise');
    // C2
    hud.config.cruise = { place: 'C2' };
    hud._rebuild();
    const lit2 = await until(() => hud.widgets.has('cruise_c2') && sheetOf('cruise_c2'), 6000);
    await settle();
    ok(lit2 && !hud.widgets.has('cruise_c1') && sheetOf('cruise_c2').x === 1466 && sheetOf('cruise_c2').y === 588, 'config.cruise.place = "C2": only the C2 readout is built, at [1466, 588]');
    ok(inkOf(sheetOf('cruise_c2'), green) > 300, 'and it shows the limiter\'s 90 in green');
    // back to dark
    hud.config.cruise = null;
    hud._rebuild();
    await until(() => !hud.widgets.has('cruise_c2') && hud.widgets.has('limit_sign') && sheetOf('limit_sign'), 6000);
    await settle();
    ok(!hud.widgets.has('cruise_c1') && !hud.widgets.has('cruise_c2') && hud.twinCru.state === 0, 'config.cruise null again: both readouts are gone, the marker is off');

    // car-fix CF2: cruise / limiter from DisplayDataServer with the car's values (61 / 59 / 40, DCC <-> SLD, 65535 off)
    hud.config.cruise = { place: 'C1' };
    hud._rebuild();
    await until(() => hud.widgets.has('cruise_c1') && sheetOf('cruise_c1'), 6000);
    await settle();
    const feedHud = async (o) => { hu.feed(S.DDS_IF, S.DDS_F, hudEv(o)); await settle(); };
    await feedHud({});
    ok(hud.tl.cruHud && hud.tl.cruHud.status === 'off' && inkOf(sheetOf('cruise_c1')) === 0 && hud.twinCru.state === 0, 'the HUD feed\'s first line (65535, LDM_SYM_NONE): it takes over from the struct (whose limiter was on) and nothing is drawn');
    await feedHud({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 61 });
    c1 = sheetOf('cruise_c1');
    ok(inkOf(c1, green) > 300 && near(hud.twinCru.deg, -48.75) && hud.twinCru.state === 1, 'DCC 61 active: green readout (' + inkOf(c1, green) + ' px), the green marker at -48.75 degrees');
    const g61 = c1.buf.toString('base64');
    await feedHud({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 59 });
    ok(sheetOf('cruise_c1').buf.toString('base64') !== g61 && near(hud.twinCru.deg, -51.25), 'DCC 59: the number changes, the marker at -51.25');
    const m1 = marks.length, l1 = limLogs();
    for (let i = 0; i < 8; i++) { hu.feed(S.DDS_IF, S.DDS_F, hudEv({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 59, rpm: 1500 + 50 * i, speed: { kmH: 57 + i, mlsH: 0 } })); await sleep(30); }
    await settle();
    ok(marks.length === m1 && limLogs() === l1, 'the feed repeating with rpm and speed changing: nothing handed over, nothing logged');
    await feedHud({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_OFF', cruiseCtrlSpeedHUD: 59 });
    c1 = sheetOf('cruise_c1');
    ok(inkOf(c1, green) === 0 && inkOf(c1) > 300 && hud.twinCru.state === 0, 'DCC 59 with LDM_OFF: grey, no marker');
    const greyDcc = c1.buf.toString('base64');
    await feedHud({ ldmSym: 'LDM_SYM_SLD', ldmSymColor: 'LDM_OFF', cruiseCtrlSpeedHUD: 59 });
    ok(hud.tl.cruHud.kind === 'limiter' && sheetOf('cruise_c1').buf.toString('base64') !== greyDcc, 'DCC -> SLD at the same speed: the symbol changes to the limiter\'s');
    await feedHud({ ldmSym: 'LDM_SYM_SLD', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 40 });
    ok(inkOf(sheetOf('cruise_c1'), green) > 300 && near(hud.twinCru.deg, -75) && hud.twinCru.state === 1, 'SLD 40 active: green, the marker at -75 degrees');
    await feedHud({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 61 });
    ok(hud.tl.cruHud.kind === 'cruise' && near(hud.twinCru.deg, -48.75) && sheetOf('cruise_c1').buf.toString('base64') === g61, 'SLD -> DCC 61: the cruise again, the same pixels as before');
    await feedHud({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 65535 });
    ok(inkOf(sheetOf('cruise_c1')) === 0 && hud.twinCru.state === 0, 'the set speed 65535: nothing at all, no marker');
    await feedHud({ ldmSym: 'LDM_SYM_NONE', ldmSymColor: 'LDM_OFF', cruiseCtrlSpeedHUD: 65535 });
    ok(inkOf(sheetOf('cruise_c1')) === 0 && hud.twinCru.state === 0, 'LDM_SYM_NONE: nothing');
    feedCru({ activeFuncLongitudinal: 'XCC_AKTIV', valueRequestedSpeed: 120 }); await settle();
    ok(inkOf(sheetOf('cruise_c1')) === 0, 'once the HUD feed has spoken, the struct (now saying 120 active) no longer draws');
    ok(logs.some((l) => l === 'limit: cruise hud ldm LDM_SYM_SLD colour LDM_ACTIVE speed 40 limiter STATUS_INACTIVE -> limiter active 40 km/h'), 'the log names the raw ldm, colour, speed and limiter with the reading');

    // the shader: the markers reach u_lim / u_cru when the compiled speedometer shader has them (B1's tdial)
    if (L.shaderReady()) {
        const dl = hud.widgets.get('dial_speed'), ul = dl.c.layers.get(dl.ref).uniforms['0:u_lim'], uc = dl.c.layers.get(dl.ref).uniforms['0:u_cru'];
        ok(!!ul && !!uc, 'the speedometer layer carries u_lim and u_cru (B1\'s shader is in this tree)');
        const dt = hud.widgets.get('dial_tach'), lt = dt.c.layers.get(dt.ref);
        ok(!lt.uniforms['0:u_lim'] || String(lt.uniforms['0:u_lim'].v).trim().split(/\s+/).map(Number).slice(0, 2).join() === '0,0', 'the tachometer never gets a marker');
    } else console.log('  skip the dial layer\'s u_lim / u_cru (the compiled tdial has no such uniform until B1\'s shader is merged: the contract is checked on hud.twinLim / hud.twinCru above)');

    // the log: numbers and enum names only
    const limitLines = logs.filter((l) => /^limit: /.test(l));
    ok(limitLines.length >= 10 && limitLines.every((l) => /^[A-Za-z0-9 ()._\/:,=\->]*$/.test(l)), 'every "limit:" log line is letters, digits and the format\'s own words (' + limitLines.length + ' lines)');
    ok(logs.filter((l) => /^ERROR|^WARN/.test(l) && /limit|sign|cruise|tdsign|tdcru/i.test(l)).length === 0, 'no warning or error about the sign, the limit or cruise in the app\'s log');

    // layers and pixel memory with everything on
    hud.config.cruise = { place: 'C1' }; hud._rebuild();
    await until(() => hud.widgets.has('cruise_c1') && sheetOf('cruise_c1'), 6000);
    const per2 = {}; let bytes = 0;
    hud.clients.forEach((c, i) => { let n = 0; c.layers.forEach((l) => { if (l.kind !== 'asset') n++; if (l.image) bytes += l.image.length * 2; else if (l.kind === 'asset' && l.data) bytes += l.data.length * 2; }); per2[i] = n; });
    ok(Object.keys(per2).every((k) => per2[k] <= 8), 'with the sign and the cruise readout on: at most 8 layers on every connection ' + JSON.stringify(per2));
    console.log('       connection layers ' + JSON.stringify(per2) + '; sign sheet ' + (96 * 88 * 8 / 1024).toFixed(0) + ' KiB, readout sheet ' + (140 * 70 * 8 / 1024).toFixed(0) + ' KiB (each image counted twice)');

    hud.stop();
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
}

(async () => {
    try {
        pureChecks();
        pixelChecks();
        geometryChecks();
        handlerChecks();
        srcChecks();
        await engineChecks();
    } catch (e) {
        failed++;
        console.log('  FAIL ' + (e && e.stack || e));
    }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();
