'use strict';
/**
 * bench/test-acc-lanes.js - ACC View's lane model and its fallback, our own path (round fixes-1121 AL,
 * docs/fixes-1121/BRIEF-AL-acc-lanes.md). Pure: no bench, no car.
 *
 *   node bench/test-acc-lanes.js
 *
 * - Every chaos kind (apps/acc_view/chaos.js) is refused for its own reason; the probability's scale; nothing throws on any input.
 * - The measures, for every chaos kind alone and mixed, from a good start and from nothing, at the camera's rate (15 Hz) with the
 *   display at 30 Hz: the drawn lane never crosses our car, its edges never closer than wMin or wider than wMax, no line and not
 *   our lane's centre moving faster than the rate limits per step, no non-finite number, no measured line in the fallback.
 * - Good input: the map's lane uniforms byte for byte as 0.1.0 drew them (laneModel), once the filter has settled; a short
 *   dropout (a few frames) changes nothing.
 * - The transitions (measured -> partial -> predicted -> straight and back) blend over blendMs, held holdMs first.
 * - Our path: yaw / speed, the steering at low speed, the blend, the limits, standing, stale; readSource's decoding.
 * - The 7 demo scenes, the table row's words, the log lines (numbers and enum names), the replay hook, the map's costs.
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'acc_view');
const Wo = require(path.join(APP, 'world.js'));
const Ln = require(path.join(APP, 'lanes.js'));
const Ch = require(path.join(APP, 'chaos.js'));
const M = require(path.join(APP, 'model.js'));
const P = require(path.join(APP, 'paint.js'));
const Wd = require(path.join(APP, 'words.js'));
const MapView = require(path.join(APP, 'mapview.js'));
const REC = require(path.join(ROOT, 'shared', 'signal_recorder.js'));

let pass = 0, fail = 0;
function ok(c, what) { if (c) pass++; else { fail++; console.log('FAIL ' + what); } }

const CFG = Wo.cfgOf(require(path.join(APP, 'app.json')).config.world);
const L = CFG.lanes;
const fin = (x) => typeof x === 'number' && isFinite(x);
const G = M.GEO.map;

/** Run a filter: frames(i) -> raw | null at the camera rate, motion(t) -> inp; out(t, o) per 33 ms display step. */
function run(ms, frames, motion, each, cfg) {
    const f = new Ln.Lanes(cfg || CFG);
    let i = 0, o = null;
    for (let t = 0; t <= ms; t += 33) {
        while (i * Ch.RATE_MS <= t) {
            const tf = Math.round(i * Ch.RATE_MS), raw = frames(i, tf);
            if (motion) f.motion(motion(tf));
            if (raw) f.frame(raw, tf, motion ? (motion(tf).v || {}).val : 25);
            i++;
        }
        o = f.output(t);
        if (each) each(t, o, f);
    }
    return { f, o };
}
const mo = (v, yaw, steer) => (t) => ({ v: { val: v, at: t }, yaw: yaw === null ? null : { val: yaw, at: t, raw: yaw }, steer: steer === null ? null : { val: steer, at: t, raw: steer } });

/* ------------------------------------------------------------------------------------------------ one boundary */
function partBoundary() {
    const reasonOf = (kind, speed) => { const d = Ln.decode(CFG, Ch.message(kind, 3, { seed: 2 }), speed === undefined ? 25 : speed); const ch = Ln.check(CFG, d.cands, [], d.rej, 3.5, 0); return { d, ch }; };
    const exp = {
        zeroLen: 'SHORT', shortLen: 'SHORT', hugeCurv: 'CURVATURE', curvChange: 'CURV_CHANGE', bigAngle: 'ANGLE', notAvailable: 'QUALIFIER',
        probLow: 'PROB', nonFinite: 'NONFINITE', wrongSide: 'SIDE', narrow: 'SIDE', defaults: 'OFFSET', crossing: 'SIDE', wide: 'WIDE',
    };
    Object.keys(exp).forEach((k) => {
        const r = reasonOf(k);
        ok(r.ch.rej[exp[k]] > 0, 'chaos ' + k + ': refused as ' + exp[k] + ' (' + JSON.stringify(r.ch.rej) + ')');
    });
    ok(reasonOf('zeroLen').ch.kept.length === 0 && reasonOf('hugeCurv').ch.kept.length === 0 && reasonOf('nonFinite').ch.kept.length === 0, 'a zero valid length, a huge curvature, non-finite numbers: nothing kept (0.1.0 drew a zero length 120 m long)');
    ok(reasonOf('defaults').ch.kept.length === 0, 'default values (zeros, raw maxima scaled as metres): nothing kept');
    const good = reasonOf('good');
    ok(good.ch.kept.length === 4 && good.ch.kept.map((k) => k.role).join() === 'L2,L1,R1,R2' && Object.keys(good.ch.rej).length === 0, 'good: 4 kept, roles L2 L1 R1 R2, nothing refused');
    // the probability's scale (a bare Float in the catalogue)
    const p100 = Ln.decode(CFG, Ch.message('prob100', 1), 25);
    ok(p100.cands.length === 4 && p100.cands.every((c) => c.prob > 0.8 && c.prob <= 0.96), 'probScale auto: 85..95 read as 0.85..0.95');
    const fix = Wo.cfgOf({ lanes: { probScale: 0.01 } });
    ok(Ln.decode(fix, Ch.good(0, 0), 25).cands.length === 0 && Ln.probOf(fix.lanes, 92) === 0.92, 'probScale 0.01 (config): 0.92 becomes 0.0092 (refused), 92 becomes 0.92');
    ok(Ln.decode(CFG, Ch.message('probLow', 1), 25).rej.PROB === 4, 'a probability under minProb: refused (PROB)');
    // speed-dependent limits: a junction's curvature at walking pace, not on the motorway
    const curve = Ch.msg([Ch.bnd(1.75, { c: 0.03 }), Ch.bnd(-1.75, { c: 0.03 })], ['SOLID', 'SOLID']);
    ok(Ln.decode(CFG, curve, 3).cands.length === 2 && Ln.decode(CFG, curve, 30).rej.CURVATURE === 2, 'curvature 0.03 1/m (R 33 m): kept at 3 m/s, refused at 30 m/s (aLat / v^2)');
    ok(Ln.cMaxAt(L, null) === L.cMax && Ln.aMaxAt(L, 30) === 0.15 && Ln.aMaxAt(L, 2) === 0.6, 'the limits by speed');
    // the camera's own "predicted" and "reduced" keep a line but never start one
    const f = new Ln.Lanes(CFG);
    for (let t = 0; t < 1000; t += 66) f.frame(Ch.message('predicted', 1), t, 25);
    ok(f.output(1000).verdict !== 'measured' && f.count.rej.CAMERA_PREDICTED > 0, 'ELEMENT_PREDICTED / MODEL_AVAILABLE_REDUCED alone: never drawn as measured (CAMERA_PREDICTED)');
    const f2 = new Ln.Lanes(CFG);
    for (let t = 0; t < 1000; t += 66) f2.frame(Ch.good(0, 0), t, 25);
    for (let t = 1000; t < 2500; t += 66) f2.frame(Ch.message('predicted', 1), t, 25);
    ok(f2.output(2500).verdict === 'measured', 'after good frames, the camera\'s predicted lines hold the lanes');
    // the event qualifier
    ok(Ln.decode(CFG, Object.assign(Ch.good(0, 0), { eventDataQualifier: 'EVENT_DATA_NOT_AVAILABLE' }), 25).rej.EVENT_QUALIFIER === 1, 'EVENT_DATA_NOT_AVAILABLE: the whole message refused');
    // nothing throws on any input
    const junk = [null, undefined, 0, 'x', [], {}, { laneBoundaryFront: 'x' }, { laneBoundaryFront: [null, 5, 'a', [], { pointSegment1: null }] },
        { laneBoundaryFront: [{ pointSegment1: { y: {} }, baseSegment1: 7 }], laneBoundaryPropertiesFront: [null] }, { eventDataQualifier: {}, laneRecognitionFront: 3 }];
    let threw = 0;
    const fj = new Ln.Lanes(CFG);
    junk.forEach((j, i) => { try { Ln.decode(CFG, j, 25); Ln.check(CFG, [], null, null); fj.frame(j, i * 66, NaN); fj.motion(j); fj.output(i * 66); fj.logLines(i * 66); Ln.readSource(j, j); } catch (e) { threw++; } });
    const o = fj.output(2000);
    ok(threw === 0 && o.lines.length === 2 && o.lines.every((l) => fin(l.y0) && fin(l.c)), 'junk of every type: no exception, a straight guess drawn');
}

/* ------------------------------------------------------------------------------------------------ the measures under chaos */
function measures(tag, f0, motion) {
    const bad = [];
    let prev = null, prevT = 0;
    const R = L.rate, dt = 0.033, e = 1e-6;
    run(12000, f0, motion, (t, o) => {
        const nums = [];
        o.lines.forEach((l) => nums.push(l.y0, l.a, l.c, l.dc, l.len, l.prob, l.g, l.fade));
        nums.push(o.ego.y0, o.ego.a, o.ego.c, o.ego.half, o.width, o.path.k);
        if (!nums.every(fin)) bad.push(t + ' non-finite');
        // our car (its body x -5.5 .. 0) inside the drawn lane, the lane between wMin and wMax
        [-5.5, -2.75, 0].forEach((x) => { const cy = o.ego.y0 + x * (o.ego.a + 0.5 * o.ego.c * x); if (!(Math.abs(cy) < o.ego.half)) bad.push(t + ' car outside its lane at x ' + x); });
        if (!(2 * o.ego.half >= L.wMin - 1e-6 && 2 * o.ego.half <= L.wMax + 1e-6)) bad.push(t + ' width ' + (2 * o.ego.half).toFixed(2));
        o.lines.forEach((l) => { if (l.fade > 0.3) [-5.5, -2.75, 0].forEach((x) => { if (Math.abs(Wo.lineY(l, x)) < 0.5) bad.push(t + ' line ' + l.key + ' across our car at x ' + x); }); });
        // the drawn ego edges (the nearest left and right) at least wMin apart near us
        const lft = o.lines.filter((l) => l.y0 >= 0 && l.fade > 0.5).sort((a, b) => a.y0 - b.y0)[0], rgt = o.lines.filter((l) => l.y0 < 0 && l.fade > 0.5).sort((a, b) => b.y0 - a.y0)[0];
        if (lft && rgt && !(lft.y0 - rgt.y0 >= L.wMin - 0.05)) bad.push(t + ' edges ' + (lft.y0 - rgt.y0).toFixed(2) + ' m apart');
        // rate limits per display step (the same line, and our lane's centre)
        if (prev && t - prevT === 33) {
            o.lines.forEach((l) => {
                const p = prev.lines.filter((q) => q.key === l.key)[0];
                if (!p) return;
                if (Math.abs(l.y0 - p.y0) > R.y0 * dt + e || Math.abs(l.c - p.c) > R.c * dt + e || Math.abs(l.a - p.a) > R.a * dt + e) bad.push(t + ' line ' + l.key + ' moved ' + (l.y0 - p.y0).toFixed(3) + ' m ' + (l.c - p.c).toFixed(5));
            });
            if (Math.abs(o.ego.y0 - prev.ego.y0) > R.y0 * dt + e || Math.abs(o.ego.c - prev.ego.c) > R.c * dt + e) bad.push(t + ' our lane jumped');
        }
        prev = JSON.parse(JSON.stringify(o)); prevT = t;
    });
    ok(bad.length === 0, tag + ': car inside, edges wMin..wMax, rate limits, finite' + (bad.length ? ' (' + bad.length + ': ' + bad.slice(0, 3).join('; ') + ')' : ''));
}

function partChaos() {
    const motion = mo(25, 0.002, 0.01);
    Ch.KINDS.forEach((k) => {
        measures('chaos ' + k + ' after good lanes', (i) => (i < 30 || i >= 150 ? Ch.good(0, 0) : Ch.message(k, i, { seed: 4 })), motion);
        measures('chaos ' + k + ' from the start', (i) => Ch.message(k, i, { seed: 5 }), motion);
    });
    [1, 2, 3, 4, 5, 6].forEach((seed) => measures('mixed chaos, seed ' + seed + ', in a curve', (i) => (i % 40 < 12 ? Ch.good(1 / 400, 0) : Ch.message('mixed', i, { seed, c: 1 / 400 })), mo(22, 22 / 400, 0.1)));
    measures('lanes gone, no motion at all', (i) => (i < 30 ? Ch.good(0, 0) : null), null);
    measures('the camera at 5 Hz with garbage between', (i) => (i % 3 ? null : i % 6 ? Ch.message('mixed', i) : Ch.good(0, 0.3)), motion);
    // no measured line in the fallback once the blend is over
    let leak = 0, n = 0;
    run(8000, (i) => (i < 30 ? Ch.good(0, 0) : Ch.message('notAvailable', i)), motion, (t, o, f) => {
        if (t > 4000) { n++; if (o.verdict !== 'predicted' || o.lines.some((l) => l.g < 0.99) || o.lines.length !== 2) leak++; }
    });
    ok(n > 50 && leak === 0, 'lanes refused: our path only (2 guessed edges, no neighbour lane, no measured line left)');
}

/* ------------------------------------------------------------------------------------------------ good input */
function partGood() {
    const shapes = [
        ['straight', Ch.good(0, 0)], ['curve', Ch.good(1 / 500, 0)], ['drifted 0.4 m', Ch.good(0, 0.4)],
        ['clothoid', Ch.msg([5.2, 1.7, -1.8, -5.3].map((y) => Ch.bnd(y, { a: 0.01, c: 0.001, dc: 1e-5, len: 70, len2: 15 })), ['SOLID', 'DOUBLE_LINE_CROSSABLE', 'DASHED', 'CURB'])],
        ['two lines', Ch.msg([Ch.bnd(1.8), Ch.bnd(-1.7)], ['SOLID', 'DASHED'])],
        ['the bench\'s', { eventDataQualifier: 'EVENT_DATA_AVAILABLE', laneBoundaryFront: [-1.75, 1.75, 5.25].map((y) => ({ modelQualifier: 'LANE_BOUNDARY_MODEL_AVAILABLE', existenceProbability: 0.9, pointSegment1: { y }, baseSegment1: { angle: 0, curvature: 0.003 }, parametersSegment1: { validLength: 70 } })), laneBoundaryPropertiesFront: [{ typeInfo: { type: 'SOLID' } }, { typeInfo: { type: 'DASHED' } }, { typeInfo: { type: 'ROAD_EDGE' } }] }],
    ];
    shapes.forEach((sh) => {
        let settle = null;
        const want = (night) => JSON.stringify(M.laneUniforms(G, { world: { lanes: Wo.laneModel(CFG, sh[1]) } }, 0.2, night));
        const wc = JSON.stringify(M.laneUniforms(M.GEO.centre, { world: { lanes: Wo.laneModel(CFG, sh[1]) } }, 0.2, false));
        const r = run(4000, () => sh[1], mo(25, 0, 0), (t, o) => {
            const eq = JSON.stringify(M.laneUniforms(G, { world: { lanes: o } }, 0.2, false)) === want(false);
            if (eq && settle === null) settle = t; else if (!eq) settle = null;
        });
        ok(settle !== null && settle <= 1500, 'good input (' + sh[0] + '): the map\'s lane uniforms byte for byte as 0.1.0 drew them, settled after ' + settle + ' ms (from our straight guess at start-up)');
        ok(JSON.stringify(M.laneUniforms(G, { world: { lanes: r.o } }, 0.2, true)) === want(true) && JSON.stringify(M.laneUniforms(M.GEO.centre, { world: { lanes: r.o } }, 0.2, false)) === wc, 'good input (' + sh[0] + '): at night and on the centre page too');
        ok(r.o.verdict === 'measured' && r.o.why === 'OK', 'good input (' + sh[0] + '): measured');
    });
    // a short dropout (a few frames, or the camera's own NOT_AVAILABLE for a few frames) changes nothing
    [['no message', () => null], ['NOT_AVAILABLE', (i) => Ch.message('notAvailable', i)], ['a garbage frame', (i) => Ch.message('mixed', i, { c: 1 / 600 })]].forEach((d) => {
        const good = Ch.good(1 / 600, 0), want = JSON.stringify(M.laneUniforms(G, { world: { lanes: Wo.laneModel(CFG, good) } }, 0, false));
        let diff = 0, verd = {};
        run(9000, (i) => (i > 30 && i % 15 < (d[0] === 'a garbage frame' ? 2 : 5) ? d[1](i) : good), mo(25, 25 / 600, 0), (t, o) => {
            if (t < 2500) return;
            verd[o.verdict] = 1;
            if (JSON.stringify(M.laneUniforms(G, { world: { lanes: o } }, 0, false)) !== want) diff++;
        });
        ok(diff === 0 && Object.keys(verd).join() === 'measured', 'a dropout (' + d[0] + ', ' + (d[0] === 'a garbage frame' ? 2 : 5) + ' frames a second): nothing changes, byte for byte');
    });
}

/* ------------------------------------------------------------------------------------------------ transitions */
function partTransitions() {
    // measured -> (held holdMs) -> predicted, blended over blendMs; then back
    const seq = [], gs = [];
    run(9000, (i, t) => (t < 2000 || t >= 5000 ? Ch.good(1 / 400, 0) : null), mo(22, 22 / 400, 0.1), (t, o) => {
        if (!seq.length || seq[seq.length - 1][1] !== o.verdict) seq.push([t, o.verdict]);
        gs.push([t, Math.max.apply(null, o.lines.map((l) => l.g))]);
    });
    const vs = seq.map((s) => s[1]);
    ok(vs.slice(-3).join() === 'measured,predicted,measured', 'lost then back: measured -> predicted -> measured (' + seq.map((s) => s[0] + ' ' + s[1]).join(', ') + ')');
    const down = seq.filter((s) => s[1] === 'predicted').slice(-1)[0];
    ok(down && down[0] >= 2000 + L.holdMs - 70 && down[0] <= 2000 + L.holdMs + 140, 'the lanes held ' + (down && down[0] - 2000) + ' ms before the fallback (holdMs ' + L.holdMs + ', a short dropout changes nothing)');
    const g0 = gs.filter((x) => x[0] >= down[0] && x[1] >= 0.999)[0];
    ok(g0 && g0[0] - down[0] >= L.blendMs - 70 && g0[0] - down[0] <= L.blendMs + 70, 'the guess style crosses over in ' + (g0 && g0[0] - down[0]) + ' ms (blendMs ' + L.blendMs + ')');
    const up = seq.filter((s) => s[1] === 'measured').slice(-1)[0];
    ok(up && up[0] - 5000 >= 2 * Ch.RATE_MS && up[0] - 5000 <= L.reacquireMs + 200, 'back to measured after the confirmation (' + (up && up[0] - 5000) + ' ms)');
    // the corridor follows our path's curvature (the lost curve), not a frozen picture
    const r = run(4000, (i, t) => (t < 1500 ? Ch.good(1 / 400, 0) : null), mo(22, 22 / 400, 0));
    ok(r.o.verdict === 'predicted' && r.o.path.src === 'yaw' && r.o.lines.every((l) => Math.abs(l.c - 1 / 400) < 2e-5 && l.g === 1), 'the predicted corridor bends with yaw / speed (1/400 1/m)');
    // one edge lost: partial, the missing edge our guess parallel to the measured one at the last good width
    const p = run(5000, (i, t) => { const m = Ch.good(1 / 800, 0.2); if (t > 2000) { m.laneBoundaryFront[2].modelQualifier = 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE'; m.laneBoundaryFront[3].modelQualifier = 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE'; } return m; }, mo(25, 0, 0)).o;
    const gl = p.lines.filter((l) => l.key[0] === 'g')[0], ml = p.lines.filter((l) => l.g === 0 && l.y0 > 0 && l.y0 < 3)[0];
    ok(p.verdict === 'partial' && gl && ml && Math.abs(ml.y0 - gl.y0 - 3.5) < 0.01 && gl.c === ml.c && gl.g === 1 && p.lines.every((l) => l.y0 > -3), 'one edge lost: partial, our guess at the last good width (3.5 m) parallel to it, no neighbour on the lost side');
    // and straight without motion, centred
    const s = run(5000, (i, t) => (t < 1500 ? Ch.good(0, 0.5) : null), null).o;
    ok(s.verdict === 'straight' && Math.abs(s.ego.y0) < 1e-9 && s.lines.every((l) => l.c === 0 && l.g === 1), 'lanes and motion gone: straight, our car centred');
    // the verdict never flips back and forth: a better picture waits reacquireMs after a fall
    let flips = 0, last = null;
    run(10000, (i) => (i % 15 < 8 ? Ch.good(0, 0) : null), mo(25, 0, 0), (t, o) => { if (t > 1000 && last && o.verdict !== last) flips++; last = o.verdict; });
    ok(flips === 0 && last === 'measured', 'lanes missing for 0.53 s every second (under holdMs): measured throughout, no change');
    flips = 0; last = null;
    run(10000, (i) => (i % 40 < 20 ? Ch.good(0, 0) : null), mo(25, 0, 0), (t, o) => { if (t > 1000 && last && o.verdict !== last) flips++; last = o.verdict; });
    ok(flips <= 8, 'lanes on 1.33 s, off 1.33 s for 10 s: ' + flips + ' verdict changes, two a cycle at most (each blended)');
}

/* ------------------------------------------------------------------------------------------------ our path */
function partPath() {
    const p = new Ln.Path(CFG), I = (o) => Object.assign({ v: { val: 20, at: 0 } }, o);
    const tg = (o, now) => p.target(o, now === undefined ? 0 : now);
    ok(Math.abs(tg(I({ yaw: { val: 0.1, at: 0 } })).k - 0.005) < 1e-12 && tg(I({ yaw: { val: 0.1, at: 0 } })).src === 'yaw', 'moving: curvature = yaw rate / speed');
    const st = tg({ v: { val: 1.5, at: 0 }, steer: { val: 0.2, at: 0 } });
    ok(Math.abs(st.k - Math.tan(Ln.roadAngle(CFG.path, 0.2)) / CFG.path.wheelbase) < 1e-12 && st.src === 'steer', 'slow (under vYawMin): tan(road wheels\' angle) / wheelbase');
    const bl = tg({ v: { val: 3.5, at: 0 }, yaw: { val: 0.05, at: 0 }, steer: { val: 0.5, at: 0 } });
    ok(Math.abs(bl.k - (0.5 * (0.05 / 3.5) + 0.5 * Math.tan(Ln.roadAngle(CFG.path, 0.5)) / 2.851)) < 1e-9, 'between vYawMin and vSteerMax: the two blended');
    ok(tg({ v: { val: 6, at: 0 }, yaw: { val: 0.05, at: 0 }, steer: { val: 0.5, at: 0 } }).src === 'yaw' && tg({ v: { val: 2.5, at: 0 }, yaw: { val: 0.05, at: 0 }, steer: { val: 0.5, at: 0 } }).src === 'steer' &&
        CFG.path.vYawMin === 2 && CFG.path.vSteerMax === 5, 'the yaw rate preferred wherever we move: from 5 m/s alone, the steering alone only under 2 m/s');
    ok(tg({ v: { val: 20, at: 0 }, steer: { val: 0.1, at: 0 } }).src === 'steer', 'no yaw rate at all: the steering at any speed');
    // the variable ratio (the owner's G20 330i xDrive has Variable Sport Steering; the curve is an assumption: no published figure)
    const D = Math.PI / 180, ra = (deg) => Ln.roadAngle(CFG.path, deg * D) / D;
    ok(CFG.path.wheelbase === 2.851 && JSON.stringify(CFG.path.steerCurve) === '[[0,15],[20,15],[100,13],[200,12]]', 'G20 sedan wheelbase 2.851 m; the ratio curve 15 on centre, 13 at 100 deg, 12 from 200 deg (assumed)');
    ok(Math.abs(ra(10) - 10 / 15) < 1e-9 && Math.abs(ra(20) - 20 / 15) < 1e-9, 'on centre (|wheel| <= 20 deg): ratio 15 exactly');
    const exact200 = 20 / 15 + 40 * Math.log(15 / 13) + 100 * Math.log(13 / 12);
    ok(Math.abs(ra(200) - exact200) < 1e-4 && Math.abs(ra(300) - (exact200 + 100 / 12)) < 1e-4, 'the road angle is the integral of d(wheel) / ratio: 200 deg -> ' + ra(200).toFixed(3) + ' deg (exact ' + exact200.toFixed(3) + '), 300 deg -> ' + ra(300).toFixed(3));
    ok(ra(-150) === -ra(150) && ra(0) === 0, 'odd: left and right alike');
    let mono = true, quick = true, prevA = 0, prevD = 1 / 15;
    for (let dg = 1; dg <= 600; dg++) { const a = ra(dg), dd = a - prevA; if (!(a > prevA)) mono = false; if (dg > 21 && dg < 200 && !(dd > prevD - 1e-9)) quick = false; prevA = a; if (dg > 1) prevD = dd; }
    ok(mono && quick, 'monotonic, and quicker away from centre (each degree turns the wheels more between 20 and 200 deg)');
    ok(ra(200) / 200 > 1 / 15 && 200 / ra(200) > 12 && Math.abs(ra(90) / 90 - 1 / 14.3) < 0.002, 'overall ratio at 200 deg ' + (200 / ra(200)).toFixed(2) + ' (between 12 and 15), at 90 deg ' + (90 / ra(90)).toFixed(2));
    const noCurve = Object.assign({}, CFG.path, { steerCurve: null });
    ok(Math.abs(Ln.roadAngle(noCurve, 0.6) - 0.6 / 15) < 1e-12, 'without a curve: the constant steerRatio');
    const k90 = tg({ v: { val: 1.5, at: 0 }, steer: { val: 90 * D, at: 0 } }).k, kConst = Math.tan(90 * D / 15) / 2.851;
    ok(k90 > kConst && k90 < kConst * 1.1, 'a 90 deg turn of the wheel bends our path more than a constant 15 would (' + (1 / k90).toFixed(1) + ' m against ' + (1 / kConst).toFixed(1) + ' m)');
    ok(tg(I({ curv: { val: 0.004, at: 0 }, yaw: { val: 1, at: 0 } })).src === 'curv', 'a direct curvature source first, when on');
    ok(tg({ v: { val: 0.2, at: 0 }, steer: { val: 3, at: 0 } }).why === 'STANDING' && tg({ steer: { val: 3, at: 0 } }).why === 'NO_SPEED' && tg(I({})).why === 'NO_MOTION', 'standing, no speed, no motion: straight, each with its reason');
    ok(tg({ v: { val: 20, at: 1500 }, yaw: { val: 0.1, at: 0 } }, 1500).why === 'NO_MOTION' && tg({ v: { val: 20, at: 4000 }, yaw: { val: 0.1, at: 0, stale: 5000 } }, 4000).src === 'yaw', 'a stale source counts for nothing (a field\'s own staleMs: 5 s)');
    const lim = tg({ v: { val: 30, at: 0 }, yaw: { val: 3, at: 0 } });
    ok(lim.clip && Math.abs(lim.k - CFG.path.aLat / 900) < 1e-12, 'never tighter than aLat / v^2 at speed');
    const lim2 = tg({ v: { val: 1, at: 0 }, steer: { val: 9, at: 0 } });
    ok(Math.abs(lim2.k) <= 1 / CFG.path.turnRadius + 1e-12, 'never tighter than the car turns (' + (1 / lim2.k).toFixed(1) + ' m)');
    // the filter: rate-limited, then exact
    const p2 = new Ln.Path(CFG);
    let maxStep = 0, k0 = 0;
    for (let t = 0; t <= 3000; t += 33) { p2.step(I({ v: { val: 20, at: t }, yaw: { val: 0.2, at: t } }), t, 33); maxStep = Math.max(maxStep, Math.abs(p2.k - k0)); k0 = p2.k; }
    ok(maxStep <= CFG.path.cRate * 0.033 + 1e-12 && p2.k === 0.01, 'the path\'s curvature glides under its rate limit, then sits exactly on 0.01');
    // readSource: the configured scale, offset, unit, none, invalid flag and qualifiers
    const S = CFG.path.sources;
    const y = Ln.readSource(S.yaw, { yawRate: { yawRate: 5.73, invalidFlag: false }, qualifierYawRate: 'SIGNALWERT_PLAUSIBEL' });
    ok(Math.abs(y.val - 5.73 * Math.PI / 180) < 1e-12 && y.bad === null, 'yaw rate: deg/s (assumed) to rad/s');
    ok(Ln.readSource(S.yaw, { yawRate: { yawRate: 5, invalidFlag: true } }).bad === 'INVALID' && Ln.readSource(S.yaw, { yawRate: { yawRate: 5 }, qualifierYawRate: 'SIGNAL_UNGUELTIG' }).bad === 'QUALIFIER' &&
        Ln.readSource(S.yaw, { yawRate: { yawRate: 5 }, eventDataQualifier: 2 }).bad === 'QUALIFIER', 'yaw rate: the invalid flag, a bad qualifier, the event\'s NOT_AVAILABLE refused');
    const sw = Ln.readSource(S.steer, { actualValueSteeringAngleDriver: 34095, qualifierActualValueSteeringAngleDriver: 1 });
    ok(Math.abs(sw.val - (34095 * 0.04395 - 1440) * Math.PI / 180) < 1e-12 && Ln.readSource(S.steer, { actualValueSteeringAngleDriver: 65535 }).bad === 'NONE', 'steering: raw x 0.04395 - 1440 deg (assumed); 65535 = none');
    ok(Ln.readSource(S.curv, { curvature: { ActualValueCurvatureVehicleMotion: 0.002, invalidFlag: false }, qualifierCurvature: 'GUELTIG' }).val === 0.002, 'the chassis\' curvature: 1/m as it comes');
    ok(Ln.readSource(S.steer, null).bad === 'MISSING' && Ln.readSource(null, 'x').bad === 'MISSING', 'nothing to read: MISSING, no exception');
    ok(S.yaw.on && S.steer.on && !S.yawHu.on && !S.steerAxle.on && !S.curv.on, 'the chosen pair on (yaw rate event + the driver\'s steering angle), the alternatives off');
}

/* ------------------------------------------------------------------------------------------------ the scenes, the row, the log, the hook */
function partScenes() {
    const at = (name, s) => M.withScene(M.DEMO.filter((d) => d[2].scene === name)[0][2], s * 1000);
    const lv = (name, s) => at(name, s).world.lanes;
    ok(lv('lost', 2.5).verdict === 'measured' && lv('lost', 6).verdict !== 'measured' && lv('lost', 9.9).verdict === 'measured', 'scene lost: measured, then not trusted while garbage arrives, then measured again');
    const lc = lv('lostcurve', 6);
    ok(lc.verdict === 'predicted' && lc.path.src === 'yaw' && Math.abs(lc.path.k - 1 / 350) < 1e-5 && lc.lines.length === 2, 'scene lostcurve: our path bends with the yaw rate (1/350 1/m), two guessed edges');
    const oe = lv('oneedge', 5);
    ok(oe.verdict === 'partial' && oe.lines.filter((l) => l.g === 1).length === 1, 'scene oneedge: partial, one edge our guess');
    let meas = 0, n = 0, flips = 0, prev = null;
    for (let ms = 1500; ms <= 10000; ms += 33) { const v = lv('flicker', ms / 1000).verdict; n++; if (v === 'measured') meas++; if (prev && v !== prev) flips++; prev = v; }
    ok(meas / n > 0.7 && flips <= 6, 'scene flicker: measured ' + Math.round(100 * meas / n) + ' % of the time, ' + flips + ' changes in 8.5 s (each blended)');
    let across = 0;
    for (let ms = 2500; ms <= 8000; ms += 99) { const l = lv('junction', ms / 1000); l.lines.forEach((x) => { if (x.fade > 0.5) for (let xx = 5; xx <= 20; xx += 5) if (Wo.lineY(x, xx) * (x.y0 >= 0 ? 1 : -1) <= 0) across++; }); }
    ok(across === 0, 'scene junction: no drawn line crosses our path within 20 m');
    const tw = lv('town', 4.5);
    ok(tw.verdict === 'predicted' && tw.path.src === 'steer' && tw.path.k > 0.03, 'scene town: our path from the steering wheel (R ' + (1 / tw.path.k).toFixed(0) + ' m, left)');
    const sd = lv('standing', 5);
    ok(sd.verdict === 'straight' && sd.path.why === 'STANDING' && sd.path.k === 0 && sd.ego.y0 === 0, 'scene standing: straight, our car centred, the wheel ignored');
    // the row "Смуги", both languages
    const row = (s, lang) => P.rows(s, {}, lang).filter((r) => r[0] === 'rowLanes')[0][1];
    ok(row(at('lost', 2.5), 'uk') === 'виміряні · 4' && row(at('oneedge', 5), 'uk') === 'частково: одна межа' && row(at('town', 4.5), 'uk') === 'траєкторія за кермом' &&
        row(at('lostcurve', 6), 'uk') === 'траєкторія за рухом' && row(at('standing', 5), 'uk') === 'пряма: даних немає', 'the row Смуги: виміряні · 4, частково: одна межа, траєкторія за кермом / за рухом, пряма: даних немає');
    ok(row(at('town', 4.5), 'en') === 'path from the steering' && row(at('standing', 5), 'en') === 'straight: no data' && row(M.DEMO[2][2], 'uk') === Wd.word('uk', 'lanesFixed'), 'in English too; the 14 cruise states keep the symbol\'s words');
    // the map's uniforms: the line colour never changes; the guess only in u_lp.w (0 for every measured line)
    const cols = {};
    M.DEMO.forEach((d) => [1000, 4000, 7000].forEach((ms) => { const u = M.laneUniforms(G, M.withScene(d[2], ms), 0.2, false); cols[u.u_line.join()] = 1; }));
    ok(Object.keys(cols).length === 1, 'the lane colour (u_line) one value in all 28 entries at 3 moments: never changed by a state');
    const uP = M.laneUniforms(G, at('lostcurve', 6), 0.2, false), uM = M.laneUniforms(G, at('lostcurve', 1.5), 0.2, false);
    ok([3, 7].every((i) => uP.u_lp[i] === 1) && [3, 7, 11, 15].every((i) => uM.u_lp[i] === 0) && uP.u_lp[1] < uM.u_lp[1], 'u_lp.w: 1 for our guess, 0 for measured lines; the guess dimmer');
    // the log: numbers and enum names only, once per 10 s
    const f = run(10000, (i) => (i % 40 < 20 ? Ch.good(1 / 500, 0) : Ch.message('mixed', i)), mo(22, 22 / 500, 0.05)).f;
    const lines = f.logLines(10000);
    ok(lines.length === 2 && /^acc: lanes first msgs \d+ ms measured \d+ partial \d+ predicted \d+ straight \d+ flips \d+ now (measured|partial|predicted|straight) [A-Z_]+ w \d+\.\d\d rej ([A-Z_]+ \d+ ?)+ prob [\d.]+\.\.[\d.]+( vis [A-Z_]+ \d+)?$/.test(lines[0]), 'the lanes line: ' + lines[0]);
    ok(/^acc: path ms ([a-z]+ \d+ ?)+ now [a-z]+ [A-Z_]+ k -?[\d.]+\.\.-?[\d.]+ v [\d.]+\.\.[\d.]+ raw (steer|yaw) [-\d.]+\.\.[-\d.]+( (steer|yaw) [-\d.]+\.\.[-\d.]+)* cal( (steer|yaw) -?[\d.]+ n \d+)+ clip \d+$/.test(lines[1]), 'the path line, with the calibration against the camera: ' + lines[1]);
    ok(f.logLines(12000).length === 0 && f.logLines(20000).length === 2, 'then once per 10 s');
    const fc = run(6000, () => Ch.good(1 / 500, 0), mo(22, 22 / 500, Math.atan(2.851 / 500) * 15.0)).f.logLines(6000);
    ok(/cal steer 1\.00 n \d+ yaw 1\.00 n \d+/.test(fc[1]), 'the calibration ratio is 1.00 for both sources when their units and signs are right (' + (fc[1] || '').replace(/.* cal /, 'cal ') + ')');
    const fs2 = run(6000, () => Ch.good(1 / 500, 0), mo(22, -22 / 500 * 180 / Math.PI, 0)).f.logLines(6000);
    ok(/cal yaw -0\.02 /.test(fs2[1]), 'and -0.02 when the yaw rate is degrees and the wrong sign (the log tells both): ' + (fs2[1] || '').replace(/.* cal /, 'cal '));
    // the replay hook: a recorder line pasted back
    const msg = Ch.good(1 / 600, 0.1), fl = REC.flatten(msg, null, 24), line = fl.keys.map((k, i) => k + '=' + fl.vals[i]).join(' ');
    const back = Ch.unflatten(line);
    ok(JSON.stringify(Wo.laneModel(CFG, back)) === JSON.stringify(Wo.laneModel(CFG, msg)), 'the replay hook: a recorder line ("path=value ...") back into the event: the same lanes');
    const rp = Ch.replay(Array.apply(null, Array(20)).map((x, i) => ({ t: i * 66, value: line, speed: 25 })));
    ok(rp.length === 20 && rp[19].verdict === 'measured' && rp[19].lines.length === 4, 'replay: 20 frames of that line through a fresh filter: measured, 4 lines');
}

/* ------------------------------------------------------------------------------------------------ costs on the map */
function partCosts() {
    function FakeCR() { this.msgs = []; this.n = 0; this.on = () => this; this.connect = () => {}; this.close = () => {}; }
    FakeCR.prototype.effect = function () { return ++this.n; };
    FakeCR.prototype.image = function () { return ++this.n; };
    FakeCR.prototype.set = function (ref, o) { this.msgs.push({ op: 'set', bytes: JSON.stringify(o).length + 20 }); };
    FakeCR.prototype.uniform = function (ref, name, v) { this.msgs.push({ op: 'uniform', name, bytes: v.join(' ').length + name.length + 30 }); };
    FakeCR.prototype.pixels = function (ref, rects, px) { this.msgs.push({ op: 'pixels', bytes: px.length }); };
    const fake = new FakeCR(), mv = new MapView(null, { layer: {}, socket: 'x', shaders: require(path.join(APP, 'hud', 'shaders.json')) });
    mv.CR = { ClusterRender: function () { return fake; } };
    mv.open();
    const tick = (name, a, b) => {
        const e = M.DEMO.filter((d) => d[2].scene === name)[0][2];
        mv.update(M.withScene(e, a * 1000), 0.2, false, 'uk');
        const k0 = fake.msgs.length;
        let ticks = 0;
        for (let ms = a * 1000 + 150; ms <= b * 1000; ms += 150) { mv.update(M.withScene(e, ms), 0.2, false, 'uk'); ticks++; }
        const m = fake.msgs.slice(k0);
        return { per: m.filter((x) => x.op !== 'pixels').reduce((s, x) => s + x.bytes, 0) / ticks, px: m.filter((x) => x.op === 'pixels').length, lane: m.filter((x) => x.name === 'u_ln' || x.name === 'u_lp' || x.name === 'u_ego').length / ticks };
    };
    const tr = tick('lostcurve', 2.4, 4.4), steady = tick('lostcurve', 5, 7.5), town = tick('town', 1, 5);
    console.log('map: lane transition ' + Math.round(tr.per) + ' B a 150 ms tick (' + tr.lane.toFixed(1) + ' lane uniforms), steady predicted curve ' + Math.round(steady.per) + ' B, town (the path bending) ' + Math.round(town.per) + ' B');
    ok(tr.px === 0 && steady.px === 0 && town.px === 0, 'lane transitions and a bending path on the map: 0 pixel uploads (uniforms only)');
    ok(tr.per < 1500 && town.per < 1500, 'a few hundred bytes of messages a tick (' + Math.round(tr.per) + ', ' + Math.round(town.per) + ' B)');
    ok(fake.n === 6, 'still 6 layers on the map (8 allowed)');
    const sj = require(path.join(APP, 'hud', 'shaders.json')), total = Object.keys(sj).reduce((s, k) => s + Buffer.byteLength(sj[k]), 0);
    console.log('shaders: acc_lane ' + Buffer.byteLength(sj.acc_lane) + ' B, the three ' + total + ' B (KOMBI reset near 26.7 k)');
    ok(Buffer.byteLength(sj.acc_lane) < 2600 && total < 7000, 'acc_lane ' + Buffer.byteLength(sj.acc_lane) + ' B shipped (was 2 238), the three ' + total + ' B: a quarter of the KOMBI\'s reset size');
    // the pixel painter and the GPU page follow the same look: a guessed line is thinner, dimmer and dashed on the centre page
    const s = M.withScene(M.DEMO.filter((d) => d[2].scene === 'lostcurve')[0][2], 6000), m = M.withScene(M.DEMO.filter((d) => d[2].scene === 'lostcurve')[0][2], 1500);
    const lum = (st) => { const px = P.centre(st, { lang: 'uk' }).px; let n = 0; for (let y = 230; y < 470; y++) for (let x = 60; x < 740; x++) { const i = (y * 1600 + x) * 4; if (px[i + 2] > 120 && px[i + 2] > px[i] + 40) n++; } return n; };
    const lp = lum(s), lmz = lum(m);
    ok(lp > 50 && lp < lmz * 0.4, 'the centre page: our guessed corridor has far less line ink than the measured lanes (' + lp + ' vs ' + lmz + ' px)');
}

partBoundary();
console.log('boundaries: ' + pass + ' passed, ' + fail + ' failed');
partChaos();
console.log('chaos: ' + pass + ' passed, ' + fail + ' failed');
partGood();
partTransitions();
partPath();
partScenes();
partCosts();
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
