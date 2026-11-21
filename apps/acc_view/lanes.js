'use strict';
/**
 * lanes.js - ACC View's lane model (round fixes-1121 AL, docs/fixes-1121/BRIEF-AL-acc-lanes.md). The owner drove 0.1.0 and,
 * 2026-11-21: "коли авто не бачить полоси малюється хаос. якщо хаос, то я би малював просто пряму лінію, або траєкторію
 * слідування". So only what makes sense is drawn, and when the lanes are not good enough the lane becomes OUR OWN guess of the
 * corridor the car is about to drive, drawn so that nobody reads it as "the car sees the lane". Pure; plain Node 8 (the car's
 * 8.16.2: no ?. / ?? / object spread); no public call throws (a bad value means "not drawn").
 *
 *   decode(cfg, v, speed)        one LaneBoundaries event -> { cands: [{ y0, a, c, dc, len, type, prob, id, hold }], rej, info }:
 *                                per boundary, the qualifier, the probability (its scale: cfg.lanes.probScale), non-finite
 *                                values, a valid length under minLen, a curvature / curvature change / heading no road can have
 *                                at our speed, an offset beyond a few lanes. Each refusal counted by its REASON.
 *   check(cfg, cands, tracks)    the set: our car between its two edges, ordered, not crossing in the near range, neighbours a
 *                                plausible lane width apart (wMin..wMax); clipped where they diverge farther out. -> { kept, rej }
 *   Lanes(cfg)                   the filter, on a fixed 33 ms clock (deterministic whatever the caller's rhythm):
 *                                  .frame(raw, t, speedMs)   a camera message: decode, check, associate with the tracks
 *                                  .motion(inp)              our own motion, decoded (readSource): { v, yaw, steer, curv }
 *                                  .output(now)              the drawn lane set (below)
 *                                  .logLines(now)            the counters, one line each per 10 s (numbers and enum names)
 *                                A boundary is drawn after `confirm` frames and kept `holdFrames` / holdMs when missed; its
 *                                numbers are low-pass filtered; a jump beyond jumpY / jumpA / jumpC restarts it.
 *   Path(cfg)                    our own path: curvature = yaw rate / speed when moving, tan(road wheel angle) / wheelbase at low
 *                                speed (the road wheels' angle from the steering wheel's through the VARIABLE ratio curve:
 *                                roadAngle; the owner's G20 has Variable Sport Steering),
 *                                speed (blended between vYawMin and vSteerMax), or a direct curvature source; never tighter
 *                                than the car turns or than aLat allows; straight when unknown or standing. Filtered.
 *   readSource(spec, v)          one motion member by its config (path, scale, offset, unit, sign, invalid flag, qualifiers)
 *   corridor(L, k, w, len)       the two guessed edges around our path (g 1)
 *
 * The drawn lane set (model.js draws it; world.egoOf uses its ego):
 *   { src, verdict 'measured' | 'partial' | 'predicted' | 'straight', why (a WHY name), path { src, why, k },
 *     lines: [{ key, y0, a, c, dc, len, type, prob, g (0 measured .. 1 our guess), fade (0..1) }] (left to right, up to 4),
 *     ego { y0, a, c, half }, width (the last good lane width), n (measured lines drawn) }
 * Transitions (measured -> partial -> predicted -> straight and back) morph a line into its successor over blendMs: offset,
 * heading and curvature glide under rate limits, the style (g) and strength cross over. A short dropout changes nothing.
 * The colours are never touched here: a guess is thinner, dashed, dimmer and fades with distance (acc_lane's u_lp.w).
 */
const Wo = require('./world');

const VERDICTS = ['measured', 'partial', 'predicted', 'straight'];
const RANK = { straight: 0, predicted: 1, partial: 2, measured: 3 };
/** Every refusal of a boundary, by name (the log counts them). */
const REASONS = ['EVENT_QUALIFIER', 'QUALIFIER', 'PROB', 'NONFINITE', 'SHORT', 'OFFSET', 'ANGLE', 'CURVATURE', 'CURV_CHANGE', 'SIDE',
    'ORDER', 'NARROW', 'WIDE', 'CAMERA_PREDICTED', 'JUMP', 'TENTATIVE', 'HELD', 'DROPPED'];
/** Why a verdict is what it is. */
const WHY = ['OK', 'ONE_EDGE', 'NO_MESSAGE', 'STALE', 'TENTATIVE', 'REJECTED', 'REACQUIRE', 'NO_SPEED', 'NO_MOTION', 'STANDING'];

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
const arr = (a) => (Array.isArray(a) ? a : []);
const has = (x) => x !== undefined && x !== null;
const get = (o, k) => (o && typeof o === 'object' ? o[k] : undefined);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const BAD_EVENT = { EVENT_DATA_NOT_AVAILABLE: 1, 2: 1, EVENT_DATA_INVALID_OR_TIMEOUT: 1, 255: 1 };
const BAD_Q = { LANE_BOUNDARY_MODEL_NOT_AVAILABLE: 1, 2: 1, SIGNAL_UNFILLED: 1, 255: 1 };
const HOLD_Q = { LANE_BOUNDARY_MODEL_AVAILABLE_REDUCED: 1, 1: 1 };      // the camera unsure: may keep a line, never starts one
const PRED_M = { ELEMENT_PREDICTED: 1, 1: 1 };                         // statusMeasurement: the camera's own extrapolation

/* ------------------------------------------------------------------------------------------------ one boundary */

function probOf(L, p) {
    if (p === null) return 1;
    const s = L.probScale === 'auto' ? (p > 1.5 ? 0.01 : 1) : (num(L.probScale) !== null ? L.probScale : 1);
    return p * s;
}
/** The largest curvature a road can have at v m/s (1/m): a junction's at walking pace, aLat / v^2 above. */
function cMaxAt(L, v) { const vv = v === null || v === undefined ? 0 : Math.abs(v); return Math.min(L.cMax, L.aLat / Math.max(1, vv * vv)); }
/** The largest heading between our car and a lane line at v m/s (rad). */
function aMaxAt(L, v) {
    const vv = v === null || v === undefined ? 0 : Math.abs(v), t = arr(L.angle);
    for (let i = 0; i < t.length; i++) if (Array.isArray(t[i]) && vv >= t[i][0]) return t[i][1];
    return 0.6;
}

function decode(cfg, v, speed) {
    const L = cfg.lanes, cands = [], rej = {}, info = { probs: [], width: null, vis: null };
    const no = (r) => { rej[r] = (rej[r] || 0) + 1; };
    if (!v || typeof v !== 'object') return { cands, rej, info };
    if (has(v.eventDataQualifier) && BAD_EVENT[v.eventDataQualifier]) { no('EVENT_QUALIFIER'); return { cands, rej, info }; }
    info.width = num(get(v.laneRecognitionFront, 'widthEgoLane'));
    const vis = get(v.laneRecognitionFront, 'visibilityConditions');
    info.vis = typeof vis === 'string' || typeof vis === 'number' ? vis : null;
    const b = arr(v.laneBoundaryFront), pr = arr(v.laneBoundaryPropertiesFront);
    const sp = num(speed), cm = cMaxAt(L, sp), am = aMaxAt(L, sp);
    for (let i = 0; i < Math.min(4, b.length); i++) {
        const s = b[i] && typeof b[i] === 'object' ? b[i] : {}, p = pr[i] && typeof pr[i] === 'object' ? pr[i] : {};
        if (has(s.modelQualifier) && BAD_Q[s.modelQualifier]) { no('QUALIFIER'); continue; }
        const rp = s.existenceProbability;
        if (has(rp) && num(rp) === null) { no('NONFINITE'); continue; }
        if (num(rp) !== null) info.probs.push(rp);
        const prob = probOf(L, num(rp));
        if (!(prob >= L.minProb)) { no('PROB'); continue; }
        const ry0 = get(s.pointSegment1, 'y'), ra = get(s.baseSegment1, 'angle'), rc = get(s.baseSegment1, 'curvature');
        const rdc = get(s.parametersSegment1, 'curvatureChange'), rl1 = get(s.parametersSegment1, 'validLength'), rl2 = get(s.parametersSegment2, 'validLength');
        if (num(ry0) === null || [ra, rc, rdc, rl1, rl2].some((x) => has(x) && num(x) === null)) { no('NONFINITE'); continue; }
        const y0 = ry0 * L.scale * L.ySign, a = (num(ra) || 0) * L.ySign, c = (num(rc) || 0) * L.ySign / L.scale, dc = (num(rdc) || 0) * L.ySign;
        const tot = ((num(rl1) || 0) + (num(rl2) || 0)) * L.scale;
        if (!(tot >= L.minLen)) { no('SHORT'); continue; }
        const len = Math.min(L.maxLen, Math.max(10, tot));
        if (!isFinite(y0) || !isFinite(c) || Math.abs(y0) > L.maxOffset) { no(isFinite(y0) && isFinite(c) ? 'OFFSET' : 'NONFINITE'); continue; }
        if (Math.abs(a) > am) { no('ANGLE'); continue; }
        if (Math.abs(c) > cm) { no('CURVATURE'); continue; }
        if (Math.abs(c + dc * Math.min(len, 60)) > 1.5 * cm) { no('CURV_CHANGE'); continue; }
        const ti = p.typeInfo && typeof p.typeInfo === 'object' ? p.typeInfo : {};
        const type = Object.prototype.hasOwnProperty.call(Wo.LINE_TYPE, String(ti.type)) ? Wo.LINE_TYPE[String(ti.type)] : 'solid';
        cands.push({ y0, a, c, dc, len, type, prob, id: num(s.id), hold: !!(HOLD_Q[s.modelQualifier] || PRED_M[s.statusMeasurement]) });
    }
    return { cands, rej, info };
}

/* ------------------------------------------------------------------------------------------------ the set */

/** l left of r: 'ok', or the worst of ORDER (crossing), NARROW, WIDE over the near range (every 5 m up to nearX). */
function gapCheck(L, l, r) {
    const xmax = Math.min(L.nearX, l.len, r.len);
    let worst = 'ok';
    for (let x = 0; x <= xmax + 1e-9; x += 5) {
        const g = Wo.lineY(l, x) - Wo.lineY(r, x);
        if (!(g > 0)) return 'ORDER';
        if (g < L.wMin) worst = 'NARROW';
        else if (g > L.wMax && worst === 'ok') worst = 'WIDE';
    }
    return worst;
}

/** Clip two neighbours' drawn length where, beyond the near range, they cross or run too close or too far apart. */
function clipPair(L, l, r) {
    const xmax = Math.min(l.len, r.len);
    for (let x = L.nearX + 5; x <= xmax + 1e-9; x += 5) {
        const g = Wo.lineY(l, x) - Wo.lineY(r, x);
        if (!(g > L.wMin * 0.75 && g < L.wMax * 1.5)) { const cut = Math.max(L.nearX, x - 5); l.len = Math.min(l.len, cut); r.len = Math.min(r.len, cut); return; }
    }
}

/**
 * The set of candidates -> the ones that make sense together, left to right, each with its role (L1 / R1 our lane's edges,
 * L2 / R2 ... the neighbours'). tracks: the filter's tracks (a candidate near a confirmed one is trusted first; a new one may
 * not start right under our car).
 */
function check(cfg, cands, tracks, rej0, width, pathK) {
    const L = cfg.lanes, rej = rej0 || {}, W = num(width) !== null ? width : L.width, K = num(pathK) || 0;
    const no = (r) => { rej[r] = (rej[r] || 0) + 1; };
    const conf = arr(tracks).filter((t) => t.state === 'conf');
    let list = arr(cands).map((c) => Object.assign({}, c, { m: c.m || conf.some((t) => Math.abs(t.y0 - c.y0) < L.gate) }));
    list = list.filter((c) => {
        // a line that crosses our own path within the near range (a junction's lines, a ghost across the road) is no edge of
        // our lane; a confirmed line nearly parallel to us may (we change lanes across it)
        // (it must cross both the straight-ahead axis and our path: our path's units are unproven, a wrong one refuses nothing)
        const sg = c.y0 >= 0 ? 1 : -1;
        const crosses = (k) => { for (let x = 5; x <= Math.min(L.nearX, c.len) + 1e-9; x += 5) if ((Wo.lineY(c, x) - 0.5 * k * x * x) * sg <= 0) return true; return false; };
        if (crosses(0) && crosses(K) && !(c.m && Math.abs(c.a) <= L.crossA && Math.abs(c.y0) < L.minEdge)) { no('SIDE'); return false; }
        if (c.m) return true;
        const yr = Wo.lineY(c, L.xRear) * sg;
        if (Math.abs(c.y0) < L.minEdge || yr < -L.sideTol) { no('SIDE'); return false; }
        return true;
    });
    // trust: a confirmed track first, then the camera's own confidence, then how near the line is to where the j-th edge of
    // that side is expected (half a lane, one and a half ...: the last good width)
    const trust = (c, j) => (c.m ? 10 : 0) + (c.hold ? -5 : 0) + (c.hits || 0) / 100 + Math.min(1, c.prob) + c.len / 1000 - Math.abs(Math.abs(c.y0) - (j + 0.5) * W);
    const chain = (side, sg) => {
        const out = [];
        side.forEach((c) => {
            if (!out.length) { out.push(c); return; }
            const p = out[out.length - 1], j = out.length - 1;
            const v = sg > 0 ? gapCheck(L, c, p) : gapCheck(L, p, c);
            if (v === 'ok') { out.push(c); return; }
            no(v);
            if (v !== 'WIDE' && trust(c, j) > trust(p, j)) out[out.length - 1] = c;    // the more trusted of two too close
        });
        return out;
    };
    const lc = chain(list.filter((c) => c.y0 >= 0).sort((p, q) => p.y0 - q.y0), 1);
    const rc = chain(list.filter((c) => c.y0 < 0).sort((p, q) => q.y0 - p.y0), -1);
    // our lane must hold our car: an edge farther than wMax - minEdge from us is no edge of ours (a neighbour's, its own lost)
    [lc, rc].forEach((side) => { if (side.length && Math.abs(side[0].y0) > L.wMax - L.minEdge) { no('WIDE'); side.length = 0; } });
    while (lc.length && rc.length) {
        const v = gapCheck(L, lc[0], rc[0]);
        if (v === 'ok') break;
        no(v);
        if (trust(lc[0], 0) >= trust(rc[0], 0)) rc.length = 0; else lc.length = 0;     // the less trusted edge goes with its neighbours
    }
    const kept = lc.slice().reverse().concat(rc).map((c) => Object.assign({}, c));
    lc.forEach((c, i) => { kept[lc.length - 1 - i].role = 'L' + (i + 1); });
    rc.forEach((c, i) => { kept[lc.length + i].role = 'R' + (i + 1); });
    for (let i = 0; i + 1 < kept.length; i++) clipPair(L, kept[i], kept[i + 1]);
    return { kept, rej };
}

/* ------------------------------------------------------------------------------------------------ our own motion */

/** One motion member by its config -> { val (SI: rad/s, rad, 1/m) | null, raw, bad: null | 'MISSING' | 'NONE' | 'INVALID' | 'QUALIFIER' }. */
function readSource(spec, v) {
    try {
        const S = spec || {};
        let raw = v;
        arr(S.path).forEach((k) => { raw = get(raw, k); });
        if (has(v) && typeof v === 'object' && has(v.eventDataQualifier) && BAD_EVENT[v.eventDataQualifier]) return { val: null, raw: num(raw), bad: 'QUALIFIER' };
        if (num(raw) === null) return { val: null, raw: null, bad: 'MISSING' };
        if (arr(S.none).indexOf(raw) >= 0) return { val: null, raw, bad: 'NONE' };
        if (S.invalid) { let f = v; arr(S.invalid).forEach((k) => { f = get(f, k); }); if (f === true || f === 1) return { val: null, raw, bad: 'INVALID' }; }
        if (S.qual) { let q = v; arr(S.qual).forEach((k) => { q = get(q, k); }); if (has(q) && arr(S.bad).indexOf(q) >= 0) return { val: null, raw, bad: 'QUALIFIER' }; }
        const u = S.unit === 'deg' ? Math.PI / 180 : 1;
        const val = (raw * (num(S.scale) !== null ? S.scale : 1) + (num(S.offset) || 0)) * u * (S.sign === -1 ? -1 : 1);
        return isFinite(val) ? { val, raw, bad: null } : { val: null, raw, bad: 'NONE' };
    } catch (e) { return { val: null, raw: null, bad: 'MISSING' }; }
}

/**
 * The road wheels' angle (rad) for a steering-wheel angle sw (rad) under a variable ratio: the integral of d(sw) / ratio(sw)
 * over P.steerCurve ([[wheel deg, ratio], ...], linear between, flat beyond; odd in sw), or sw / steerRatio without a curve.
 * A table at 0.5 deg is built once per config.
 */
function roadAngle(P, sw) {
    const c = arr(P.steerCurve).filter((p) => Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null && p[1] > 1).sort((a, b) => a[0] - b[0]);
    if (!c.length || num(sw) === null) return num(sw) === null ? 0 : sw / P.steerRatio;
    if (!P._road || P._roadOf !== P.steerCurve) {
        const ratio = (d) => { if (d <= c[0][0]) return c[0][1]; for (let i = 1; i < c.length; i++) if (d <= c[i][0]) return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * (d - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); return c[c.length - 1][1]; };
        const T = [0];
        for (let i = 1; i <= 1600; i++) { const a = (i - 1) * 0.5, b = i * 0.5; T.push(T[i - 1] + (0.5 / 6) * (1 / ratio(a) + 4 / ratio((a + b) / 2) + 1 / ratio(b))); }      // Simpson, deg
        Object.defineProperty(P, '_road', { value: T, writable: true, configurable: true, enumerable: false });
        Object.defineProperty(P, '_roadOf', { value: P.steerCurve, writable: true, configurable: true, enumerable: false });
    }
    const T = P._road, d = Math.min(799.999, Math.abs(sw) * 180 / Math.PI), i = Math.floor(d / 0.5), f = (d - i * 0.5) / 0.5;
    return (sw < 0 ? -1 : 1) * (T[i] + (T[i + 1] - T[i]) * f) * Math.PI / 180;
}

function Path(cfg) {
    this.P = cfg.path;
    this.k = 0; this.src = null; this.why = 'NO_SPEED'; this.v = null; this.kRaw = {};
}
/** The curvature the inputs ask for now: { k, src, why, v, kRaw { yaw, steer, curv } } (k 0 when unknown or standing). */
Path.prototype.target = function (inp, now) {
    const P = this.P, I = inp || {};
    const fresh = (x) => !!x && num(x.val) !== null && num(x.at) !== null && now - x.at <= (num(x.stale) !== null ? x.stale : P.staleMs);
    const v = fresh(I.v) ? Math.abs(I.v.val) : null;
    const kRaw = {};
    if (fresh(I.curv)) kRaw.curv = I.curv.val;
    if (fresh(I.yaw) && v !== null && v >= P.vYawMin) kRaw.yaw = I.yaw.val / v;
    if (fresh(I.steer)) kRaw.steer = Math.tan(clamp(I.steer.road ? I.steer.val : roadAngle(P, I.steer.val), -0.7, 0.7)) / P.wheelbase;
    if (P.on === false) return { k: 0, src: null, why: 'NO_MOTION', v, kRaw };
    if (v === null) return { k: 0, src: null, why: 'NO_SPEED', v, kRaw };
    if (v < P.vStand) return { k: 0, src: null, why: 'STANDING', v, kRaw };
    let k = null, src = null;
    const ks = has(kRaw.steer) && (v < P.vSteerMax || !has(kRaw.yaw)) ? kRaw.steer : null;
    if (has(kRaw.curv)) { k = kRaw.curv; src = 'curv'; }
    else if (has(kRaw.yaw) && ks !== null) { const w = clamp((v - P.vYawMin) / Math.max(0.1, P.vSteerMax - P.vYawMin), 0, 1); k = w * kRaw.yaw + (1 - w) * ks; src = w >= 0.5 ? 'yaw' : 'steer'; }
    else if (has(kRaw.yaw)) { k = kRaw.yaw; src = 'yaw'; }
    else if (ks !== null) { k = ks; src = 'steer'; }
    if (k === null || !isFinite(k)) return { k: 0, src: null, why: 'NO_MOTION', v, kRaw };
    const lim = Math.min(1 / P.turnRadius, P.aLat / Math.max(0.01, v * v));
    return { k: clamp(k, -lim, lim), src, why: 'OK', v, kRaw, clip: Math.abs(k) > lim };
};
/** One fixed step of dt ms toward the target: exponential (tauMs) under a rate limit (cRate 1/m per second). */
Path.prototype.step = function (inp, now, dt) {
    const P = this.P, t = this.target(inp, now);
    const kk = 1 - Math.exp(-dt / P.tauMs), lim = P.cRate * dt / 1000;
    let k = this.k + clamp((t.k - this.k) * kk, -lim, lim);
    if (Math.abs(t.k - k) < 2e-6) k = t.k;
    this.k = k; this.src = t.src; this.why = t.why; this.v = t.v; this.kRaw = t.kRaw; this.clip = !!t.clip;
    return t;
};

/* ------------------------------------------------------------------------------------------------ the guessed corridor */

/** Our corridor's two edges, w wide around the path of curvature k, len m long: drawn as our guess (g 1). */
function corridor(L, k, w, len) {
    const e = (key, role, y) => ({ key, role, y0: y, a: 0, c: k, dc: 0, len, type: 'solid', prob: L.guessStr, g: 1 });
    return [e('gL', 'L1', w / 2), e('gR', 'R1', -w / 2)];
}

/* ------------------------------------------------------------------------------------------------ the counters */

function Counter(period) { this.period = period || 10000; this.first = true; this.reset(0); }
Counter.prototype.reset = function (now) {
    this.at = now; this.msgs = 0; this.ms = { measured: 0, partial: 0, predicted: 0, straight: 0 }; this.flips = 0; this.rej = {};
    this.prob = [null, null]; this.vis = {}; this.pms = {}; this.k = [null, null]; this.v = [null, null]; this.raw = {}; this.bad = {}; this.cal = {}; this.clip = 0; this.err = 0;
};
const rng = (r, x) => { if (num(x) === null) return; r[0] = r[0] === null ? x : Math.min(r[0], x); r[1] = r[1] === null ? x : Math.max(r[1], x); };
const fx = (x, d) => (x === null ? '-' : x.toFixed(d));
const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : null; };

/* ------------------------------------------------------------------------------------------------ the filter */

function Lanes(cfg) {
    this.cfg = cfg; this.L = cfg.lanes;
    this.path = new Path(cfg);
    this.tracks = []; this.nid = 1;
    this.t = null; this.disp = []; this.ego = null;
    this.verdict = null; this.why = 'NO_MESSAGE'; this.downAt = -1e12; this.upTo = null; this.upSince = 0;
    this.width = this.L.width; this.lastFrame = null; this.inp = {};
    this.count = new Counter(10000);
    this.out = null;
    this.maxCatchUp = 2000;
}

/** A camera message at time t (ms), our speed (m/s or null). */
Lanes.prototype.frame = function (raw, t, speed) {
    try {
        const L = this.L, C = this.count;
        if (this.t === null) this.t = t;
        if (t > this.t) this.advance(t);
        const d = decode(this.cfg, raw, speed);
        const ch = check(this.cfg, d.cands, this.tracks, d.rej, this.width, this.path.k);
        this.associate(ch.kept, t, ch.rej);
        Object.keys(ch.rej).forEach((r) => { C.rej[r] = (C.rej[r] || 0) + ch.rej[r]; });
        C.msgs++;
        d.info.probs.forEach((p) => rng(C.prob, p));
        if (d.info.vis !== null) C.vis[d.info.vis] = (C.vis[d.info.vis] || 0) + 1;
        if (d.info.width !== null && d.info.width >= L.wMin && d.info.width <= L.wMax) this.wHint = d.info.width;
        this.lastFrame = t;
    } catch (e) { this.count.err++; }
};

/** Tracks: associate the kept candidates (same camera id, else the nearest offset within gate), filter, confirm, hold, drop. */
Lanes.prototype.associate = function (kept, t, rej) {
    const L = this.L, no = (r) => { rej[r] = (rej[r] || 0) + 1; };
    const free = this.tracks.slice(), seen = {};
    kept.forEach((c) => {
        let best = null, bd = 1e9;
        free.forEach((tr) => {
            if (seen[tr.id]) return;
            const sameId = c.id !== null && tr.cam !== null && c.id === tr.cam;
            const d = Math.abs(tr.y0 - c.y0) - (sameId ? 0.5 : 0);
            if (Math.abs(tr.y0 - c.y0) < L.gate * (sameId ? 1.5 : 1) && d < bd) { bd = d; best = tr; }
        });
        if (!best) {
            if (c.hold) { no('CAMERA_PREDICTED'); return; }
            const nt = { id: this.nid++, cam: c.id, y0: c.y0, a: c.a, c: c.c, dc: c.dc, len: c.len, type: c.type, prob: c.prob, hits: 1, miss: 0, seen: t, state: 'tent', tc: null, tn: 0 };
            this.tracks.push(nt); seen[nt.id] = true;
            if (L.confirm <= 1) nt.state = 'conf';
            return;
        }
        const tr = best;
        if (Math.abs(c.y0 - tr.y0) > L.jumpY || Math.abs(c.a - tr.a) > L.jumpA || Math.abs(c.c - tr.c) > L.jumpC) {
            // a jump: the track keeps its last good numbers (and misses this frame); the jumped value starts a candidate of its
            // own, drawn only once it has been seen `confirm` frames running (a real change of the road gets there)
            no('JUMP');
            if (c.hold) return;
            const nt = { id: this.nid++, cam: c.id, y0: c.y0, a: c.a, c: c.c, dc: c.dc, len: c.len, type: c.type, prob: c.prob, hits: 1, miss: 0, seen: t, state: L.confirm <= 1 ? 'conf' : 'tent', tc: null, tn: 0 };
            this.tracks.push(nt); seen[nt.id] = true;
            return;
        }
        seen[best.id] = true;
        if (c.hold && tr.state !== 'conf') { no('CAMERA_PREDICTED'); return; }
        const dt = Math.max(1, t - tr.seen), k = 1 - Math.exp(-dt / L.tauMs), kc = 1 - Math.exp(-dt / L.tauCMs);
        const lp = (p, kk, eps) => { const v = tr[p] + (c[p] - tr[p]) * kk; tr[p] = Math.abs(c[p] - v) < eps ? c[p] : v; };
        lp('y0', k, 0.002); lp('a', k, 1e-5); lp('c', kc, 1e-6); lp('dc', kc, 1e-8); lp('len', k, 0.05); lp('prob', k, 0.002);
        if (c.type !== tr.type) { if (tr.tc === c.type) tr.tn++; else { tr.tc = c.type; tr.tn = 1; } if (tr.tn >= L.typeFrames) { tr.type = c.type; tr.tc = null; tr.tn = 0; } }
        else { tr.tc = null; tr.tn = 0; }
        tr.cam = c.id !== null ? c.id : tr.cam;
        tr.hits++; tr.miss = 0; tr.seen = t;
        if (tr.state !== 'conf' && tr.hits >= L.confirm) tr.state = 'conf';
    });
    this.tracks = this.tracks.filter((tr) => {
        if (seen[tr.id]) { if (tr.state !== 'conf') no('TENTATIVE'); return true; }
        tr.miss++;
        if (tr.miss > L.holdFrames) { if (tr.state === 'conf') no('DROPPED'); return false; }
        if (tr.state === 'conf') no('HELD');
        return true;
    });
};

/** Our own motion, decoded: { v: { val m/s, at }, yaw: { val rad/s, at, raw }, steer: { val rad, at, raw, road }, curv: { val 1/m, at, raw } }. */
Lanes.prototype.motion = function (inp) {
    try {
        this.inp = inp && typeof inp === 'object' ? inp : {};
        const C = this.count;
        this.seenAt = this.seenAt || {};
        ['yaw', 'steer', 'curv'].forEach((k) => {
            const x = this.inp[k];
            if (!x || this.seenAt[k] === x.at) return;                     // each message counted once
            this.seenAt[k] = x.at;
            if (num(x.raw) !== null) { C.raw[k] = C.raw[k] || [null, null]; rng(C.raw[k], x.raw); }
            if (x.bad) C.bad[k + ' ' + x.bad] = (C.bad[k + ' ' + x.bad] || 0) + 1;
        });
    } catch (e) { this.count.err++; }
};

Lanes.prototype.advance = function (now) {
    const L = this.L, step = L.stepMs;
    if (this.t === null) this.t = now;
    if (now - this.t > this.maxCatchUp) this.t = now - this.maxCatchUp;      // the app was away: no long catch-up
    while (this.t + step <= now) { this.t += step; this.stepOnce(step); }
};

/** The tracks that are drawn: confirmed, not expired, consistent as a set (check() over the tracks themselves). */
Lanes.prototype.drawnTracks = function () {
    const L = this.L;
    const conf = this.tracks.filter((tr) => tr.state === 'conf' && this.t - tr.seen <= L.holdMs);
    return check(this.cfg, conf.map((tr) => ({ key: 't' + tr.id, y0: tr.y0, a: tr.a, c: tr.c, dc: tr.dc, len: tr.len, type: tr.type, prob: tr.prob, hits: tr.hits, m: true })), null, {}, this.width, this.path.k).kept;
};

Lanes.prototype.stepOnce = function (dt) {
    const L = this.L, C = this.count, now = this.t;
    this.tracks = this.tracks.filter((tr) => {
        if (now - tr.seen <= L.holdMs) return true;
        if (tr.state === 'conf') C.rej.DROPPED = (C.rej.DROPPED || 0) + 1;        // the camera went quiet: held, then gone
        return false;
    });
    const pt = this.path.step(this.inp, now, dt);
    if (pt.src) C.pms[pt.src] = (C.pms[pt.src] || 0) + dt; else C.pms.none = (C.pms.none || 0) + dt;
    if (pt.clip) C.clip++;
    rng(C.k, this.path.k); if (num(pt.v) !== null) rng(C.v, pt.v);
    // the verdict, with its reason
    const kept = this.drawnTracks();
    const l1 = kept.filter((k) => k.role === 'L1')[0], r1 = kept.filter((k) => k.role === 'R1')[0];
    let v, why;
    if (l1 && r1) { v = 'measured'; why = 'OK'; }
    else if (l1 || r1) { v = 'partial'; why = 'ONE_EDGE'; }
    else {
        v = this.path.src ? 'predicted' : 'straight';
        why = this.lastFrame === null ? 'NO_MESSAGE' : now - this.lastFrame > L.staleMs ? 'STALE' : this.tracks.some((tr) => tr.state !== 'conf') ? 'TENTATIVE' : 'REJECTED';
    }
    // back up only after the better picture has held reacquireMs, when we came down less than reacquireMs ago
    if (this.verdict !== null && RANK[v] > RANK[this.verdict]) {
        if (this.upTo !== v) { this.upTo = v; this.upSince = now; }
        if (now - this.downAt < L.reacquireMs && now - this.upSince < L.reacquireMs) {
            const held = this.verdict;
            if (held === 'partial' && v === 'measured') { v = 'partial'; why = 'REACQUIRE'; }
            else if (RANK[held] <= 1) { v = this.path.src ? 'predicted' : 'straight'; why = 'REACQUIRE'; }
            else { v = held; why = 'REACQUIRE'; }
        }
    } else this.upTo = null;
    if (this.verdict !== null && v !== this.verdict) { C.flips++; if (RANK[v] < RANK[this.verdict]) this.downAt = now; }
    this.verdict = v; this.why = why;
    C.ms[v] += dt;
    // the lane width we keep for the guess: our measured lane's, glided; else the camera's own figure; else the default
    if (v === 'measured') { const w = clamp(l1.y0 - r1.y0, L.wMin, L.wMax); this.width += (w - this.width) * (1 - Math.exp(-dt / 1000)); if (Math.abs(w - this.width) < 0.002) this.width = w; }
    else if (v !== 'partial' && num(this.wHint) !== null && this.lastFrame !== null && now - this.lastFrame < L.staleMs) this.width += (this.wHint - this.width) * (1 - Math.exp(-dt / 1000));
    // the targets for the drawn lines
    let T;
    if (v === 'measured') T = kept.map((k) => Object.assign({}, k, { g: 0 }));
    else if (v === 'partial') {
        const e = l1 || r1, w = clamp(Math.max(this.width, Math.abs(e.y0) + L.minEdge), L.wMin, L.wMax);     // our car inside
        T = kept.filter((k) => k.role[0] === e.role[0]).map((k) => Object.assign({}, k, { g: 0 }));
        T.push({ key: l1 ? 'gR' : 'gL', role: l1 ? 'R1' : 'L1', y0: e.y0 + (l1 ? -w : w), a: e.a, c: e.c, dc: e.dc, len: Math.min(e.len, 60), type: 'solid', prob: L.guessStr, g: 1 });
    } else {
        const len = v === 'predicted' ? clamp((this.path.v || 0) * this.path.P.lenS, this.path.P.lenMin, this.path.P.lenMax) : L.straightLen;
        T = corridor(L, this.path.k, this.width, len);
    }
    this.glide(T, dt, v);
};

/** The drawn lines follow their targets: a line keeps its identity (a track's key, or gL / gR), so a lane change never sweeps
 *  a line across; a target without a line takes over the line that held its role (the morph), else a new line fades in. */
Lanes.prototype.glide = function (T, dt, v) {
    const L = this.L, R = L.rate, tau = L.blendMs / 4, bk = 1 - Math.exp(-dt / tau), lin = dt / L.blendMs;
    const used = {};
    const byKey = {};
    this.disp.forEach((d) => { byKey[d.key] = d; d.tg = null; });
    T.forEach((t) => { const d = byKey[t.key]; if (d && !used[d.key]) { d.tg = t; used[d.key] = true; } });
    T.forEach((t) => {
        if (used[t.key] || (t.role !== 'L1' && t.role !== 'R1')) return;
        let best = null;
        this.disp.forEach((d) => { if (!d.tg && d.role === t.role && Math.abs(d.y0 - t.y0) < L.morphY && (!best || d.fade > best.fade)) best = d; });
        if (best) { best.key = t.key; best.tg = t; best.morph = L.blendMs; used[t.key] = true; }
    });
    T.forEach((t) => {
        if (used[t.key]) return;
        const d = { key: t.key, role: t.role, y0: t.y0, a: t.a, c: t.c, dc: t.dc, len: t.len, type: t.type, prob: t.prob, g: t.g, fade: 0, morph: 0, tg: t };
        this.disp.push(d); used[t.key] = true;
    });
    const EPS = { y0: 0.003, a: 2e-5, c: 2e-6, dc: 1e-7 };
    this.disp.forEach((d) => {
        const t = d.tg;
        if (!t) { d.fade = Math.max(0, d.fade - lin); return; }
        const soft = d.morph > 0 || t.g > 0 || d.g > 0;
        const k = soft ? bk : 1;
        ['y0', 'a', 'c', 'dc'].forEach((p) => {
            const lim = R[p] * dt / 1000;
            let nv = d[p] + clamp((t[p] - d[p]) * k, -lim, lim);
            if (Math.abs(t[p] - nv) < EPS[p]) nv = t[p];
            d[p] = nv;
        });
        d.len += (t.len - d.len) * k; if (Math.abs(t.len - d.len) < 0.05) d.len = t.len;
        d.prob += (t.prob - d.prob) * k; if (Math.abs(t.prob - d.prob) < 0.002) d.prob = t.prob;
        d.g = t.g > d.g ? Math.min(t.g, d.g + lin) : Math.max(t.g, d.g - lin);
        d.fade = Math.min(1, d.fade + lin);
        if (!(t.g > 0.5 && d.g < 0.999)) d.type = t.type;                        // a line keeps its marking until it is all guess
        d.role = t.role;
        d.morph = Math.max(0, d.morph - dt);
    });
    this.disp = this.disp.filter((d) => d.fade > 0 || d.tg);
    // our lane's centre and half width: from the targets, glided like the lines
    const e = Wo.egoOf({ lines: T });
    const morphing = this.disp.some((d) => d.morph > 0 || (d.tg && d.g !== d.tg.g));
    if (!this.ego) this.ego = { y0: e.y0, a: e.a, c: e.c, half: e.half };
    else {
        const k = v === 'measured' && !morphing ? 1 : bk, ER = { y0: R.y0, a: R.a, c: R.c, half: R.y0 };
        ['y0', 'a', 'c', 'half'].forEach((p) => {
            const lim = ER[p] * dt / 1000;
            let nv = this.ego[p] + clamp((e[p] - this.ego[p]) * k, -lim, lim);
            if (Math.abs(e[p] - nv) < (p === 'half' ? EPS.y0 : EPS[p])) nv = e[p];
            this.ego[p] = nv;
        });
    }
};

/** The drawn lane set at `now` (see the head comment). Never null; never throws. */
Lanes.prototype.output = function (now) {
    try {
        if (this.t === null) this.t = now - this.L.stepMs;
        this.advance(now);
        if (!this.disp.length) this.glide(corridor(this.L, 0, this.width, this.L.straightLen), this.L.stepMs, 'straight');
        let ls = this.disp.filter((d) => d.fade > 0.001);
        if (ls.length > 4) ls = ls.slice().sort((p, q) => (q.tg ? 1 : 0) - (p.tg ? 1 : 0) || q.fade - p.fade).slice(0, 4);
        ls = ls.slice().sort((p, q) => q.y0 - p.y0);
        const lines = ls.map((d) => ({ key: d.key, y0: d.y0, a: d.a, c: d.c, dc: d.dc, len: d.len, type: d.type, prob: d.prob, g: d.g, fade: d.fade }));
        const v = this.verdict || 'straight';
        this.out = {
            src: v, verdict: v, why: this.why, path: { src: this.path.src, why: this.path.why, k: this.path.k }, lines,
            ego: Object.assign({}, this.ego || Wo.egoOf(null)), width: this.width, n: lines.filter((l) => l.g < 0.5 && l.fade > 0.5).length,
        };
        this.calibrate();
        return this.out;
    } catch (e) {
        this.count.err++;
        const w = this.L.width || 3.5;
        return { src: 'straight', verdict: 'straight', why: 'NO_MESSAGE', path: { src: null, why: 'NO_MOTION', k: 0 }, lines: corridor(this.L, 0, w, 50).map((l) => Object.assign(l, { fade: 1 })), ego: { y0: 0, a: 0, c: 0, half: w / 2 }, width: w, n: 0 };
    }
};

/** The log, once per 10 s (and once at the first message): numbers and enum names only. -> [lines] */
Lanes.prototype.logLines = function (now) {
    try {
        const C = this.count;
        if (!C.first && now - C.at < C.period) return [];
        if (C.first && !C.msgs) { if (now - C.at >= C.period) C.reset(now); return []; }
        // the calibration: the camera's own curvature of our lane against each motion source's (sign and scale in one ratio)
        const k = Object.keys(C.ms).map((x) => x + ' ' + Math.round(C.ms[x])).join(' ');
        const rej = Object.keys(C.rej).sort().map((x) => x + ' ' + C.rej[x]).join(' ') || '-';
        const vis = Object.keys(C.vis).sort().map((x) => x + ' ' + C.vis[x]).join(' ');
        const out = ['acc: lanes' + (C.first ? ' first' : '') + ' msgs ' + C.msgs + ' ms ' + k + ' flips ' + C.flips + ' now ' + (this.verdict || '-') + ' ' + this.why +
            ' w ' + this.width.toFixed(2) + ' rej ' + rej + ' prob ' + fx(C.prob[0], 2) + '..' + fx(C.prob[1], 2) + (vis ? ' vis ' + vis : '') + (C.err ? ' err ' + C.err : '')];
        const pms = Object.keys(C.pms).sort().map((x) => x + ' ' + Math.round(C.pms[x])).join(' ') || '-';
        const raw = Object.keys(C.raw).sort().map((x) => x + ' ' + fx(C.raw[x][0], 2) + '..' + fx(C.raw[x][1], 2)).join(' ') || '-';
        const bad = Object.keys(C.bad).sort().map((x) => x.replace(' ', '_') + ' ' + C.bad[x]).join(' ');
        const cal = Object.keys(C.cal).sort().map((x) => x + ' ' + fx(med(C.cal[x]), 2) + ' n ' + C.cal[x].length).join(' ');
        out.push('acc: path ms ' + pms + ' now ' + (this.path.src || 'none') + ' ' + this.path.why + ' k ' + fx(C.k[0], 4) + '..' + fx(C.k[1], 4) + ' v ' + fx(C.v[0], 1) + '..' + fx(C.v[1], 1) +
            ' raw ' + raw + (bad ? ' bad ' + bad : '') + (cal ? ' cal ' + cal : '') + ' clip ' + C.clip);
        C.first = false;
        C.reset(now);
        return out;
    } catch (e) { return []; }
};

/** The calibration sample, per output while the lanes are measured and bend: the camera's curvature of our lane over each
 *  motion source's own (yaw / v, steering, direct). About 1 when the unit and sign are right; -1 a sign; 57 or 0.017 deg / rad. */
Lanes.prototype.calibrate = function () {
    try {
        const C = this.count, o = this.out;
        if (!o || o.verdict !== 'measured' || !o.ego || Math.abs(o.ego.c) < 2e-4 || o.lines.some((l) => l.g !== 0 || l.fade !== 1)) return;
        const kr = this.path.kRaw || {};
        Object.keys(kr).forEach((s) => { if (num(kr[s]) !== null && Math.abs(kr[s]) > 1e-5) { C.cal[s] = C.cal[s] || []; if (C.cal[s].length < 400) C.cal[s].push(o.ego.c / kr[s]); } });
    } catch (e) { /* a sample less */ }
};

module.exports = { VERDICTS, REASONS, WHY, RANK, decode, check, gapCheck, readSource, roadAngle, Path, Lanes, corridor, cMaxAt, aMaxAt, probOf, Counter };
