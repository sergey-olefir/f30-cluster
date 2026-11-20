'use strict';
/**
 * world.js - what the car's sensors see, as ACC View draws it (round 1120 AA2, the owner's FOCUS of 2026-11-20: "трафік,
 * пішоходи, смуги руху, все що може побачити авто"). Pure: decoders, a tracker, the demo scenes, the perspective. Plain Node 8.
 *
 * Coordinates: x metres ahead of the car, y metres to the LEFT (ISO 8855). Both are HYPOTHESES for this car's events (Floats
 * in the catalogue; ObjectPodCameraTCP's are typed EmMeter): config.world.objects / lanes carry the scale and the sign of y, as
 * front_vehicle.js carries assumeScale, so a drive corrects a line, not the code.
 *
 * The sources (the catalogue reference/car/2026-11-15; every one an EVENT, declared under _broadcasts; nothing is written):
 *   cam    de.bmw.environmentalmodel.ObjectRecognitionFrontCamera: ObjectRecognition (class, lane mapping, id; 40 slots) and
 *          ObjectPosition (x, y Float, length / width; 40 slots), joined slot by slot (an assumption: the same index = the same
 *          object; the ids are checked when both carry one)
 *   tcp    de.bmw.sensors.objects.RecogFrontCameraObjectlist.objectlistTCP: up to 20 objects, x / y EmMeter, class percentages
 *   lanes  de.bmw.environmentalmodel.LaneBoundaries.LaneBoundaries: 4 front boundaries, clothoids (point y, angle, curvature,
 *          curvature change, valid length) and their type (SOLID, DASHED, DOUBLE_LINE_*, ROAD_EDGE, CURB ...)
 *   the lead: GapVehicleAhead.DataFrontVehicle (the level, front_vehicle.js) and DataFrontVehicleExtended (its class)
 *
 *   camObjects(cfg, rec, pos)       -> [{ id, cls, x, y, len, wid, lane }]      (cls: car truck two ped cyc unk)
 *   tcpObjects(cfg, v)              -> the same from objectlistTCP
 *   laneModel(cfg, v)               -> { src: 'measured', lines: [{ y0, a, c, dc, len, type, prob }] (sorted left to right), ego }
 *                                      or null when no boundary is usable
 *   FIXED                           AA's fixed symbol: two straight lines at +-1.75 m (when no lane model is present)
 *   Tracker(cfg)                    objects by source and id: glide (exponential), fade when lost, never frozen; .frame(now)
 *   scene(name, ms)                 the demo scenes: busy, crossing, cyclist, cutin, lanechange, curve, nolanes
 *   SourceLog                       counts, classes, rates and ranges per source for the log (numbers and enum names only)
 *   lineY(line, x), egoOf(lanes)    the clothoid's y at x; the ego lane's centre line and half width
 *   project(g, x, y)                -> { px, py, k (px per metre), t } in the lane box of placement g (model.GEO)
 */

const CLS = ['car', 'truck', 'two', 'ped', 'cyc', 'unk'];
/** Physical sizes (m) per class when the sensor gives none, and the drawn box's height (m). */
const SIZE = { car: [1.8, 1.45], truck: [2.5, 3.2], two: [0.7, 1.5], ped: [0.6, 1.75], cyc: [0.7, 1.75], unk: [1.0, 1.2] };

/** The catalogue's ObjectType (ObjectRecognitionFrontCamera, DataFrontVehicleExtended) -> our class. */
const OBJECT_TYPE = {
    PEDESTRIAN: 'ped', 0: 'ped', CYCLIST: 'cyc', 1: 'cyc', BIKE_MOTORBIKE_MOPED: 'two', 2: 'two',
    CAR_WITH_OR_WITHOUT_TRAILER: 'car', 3: 'car', TRUCK_BUS_VAN: 'truck', 4: 'truck',
    OTHER_VEHICLE_CUSTOMARY_ROAD_USER_ACCORDING_TO_SCENE_CATALOGUE: 'unk', 5: 'unk', UNKNOWN: 'unk', 8: 'unk',
    ROAD_BOUNDARY: null, 6: null, BRIDGE: null, 7: null, SIGNAL_UNFILLED: null, 255: null,
};
/** LaneBoundaryType -> how we draw it ('none' = not drawn). */
const LINE_TYPE = {
    SOLID: 'solid', 2: 'solid', DASHED: 'dashed', 1: 'dashed', DOTTED: 'dashed', 3: 'dashed',
    DOUBLE_LINE_CROSSABLE: 'double', 5: 'double', DOUBLE_LINE_UNCROSSABLE: 'double', 6: 'double',
    MULTIPLE_LINES_CROSSABLE: 'double', 7: 'double', MULTIPLE_LINES_UNCROSSABLE: 'double', 8: 'double',
    ROAD_EDGE: 'edge', 4: 'edge', CURB: 'edge', 9: 'edge', SNOW_EDGE: 'edge', 10: 'edge',
};
const TYPE_CODE = { none: 0, solid: 1, dashed: 2, double: 3, edge: 4 };

const DEFAULT = {
    range: 100,                 // m: the far end of the drawn lane (a display choice)
    objects: { scale: 1, ySign: 1, xMin: 1, xMax: 95, yMax: 12, glideMs: 250, lostMs: 500, fadeMs: 600, max: 16, minProb: 0 },
    lanes: { scale: 1, ySign: 1, minProb: 0.3, staleMs: 1500, maxLen: 120, halfDefault: 1.75 },
};

function cfgOf(c) {
    const o = c && typeof c === 'object' ? c : {};
    return {
        range: typeof o.range === 'number' ? o.range : DEFAULT.range,
        objects: Object.assign({}, DEFAULT.objects, o.objects || {}),
        lanes: Object.assign({}, DEFAULT.lanes, o.lanes || {}),
    };
}

const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
const val = (x) => (x && typeof x === 'object' && 'value' in x ? num(x.value) : num(x));          // EmMeter { value }
const arr = (a) => (Array.isArray(a) ? a : []);

/* ------------------------------------------------------------------------------------------------ the decoders */

function camObjects(cfg, rec, pos) {
    const C = cfg.objects, out = [];
    const ri = arr(rec && rec.objectRecognitionInfo), pi = arr(pos && pos.objectPositionInfo), di = arr(pos && pos.objectDimensionInfo);
    const n = Math.min(40, num(pos && pos.numberOfObjects) !== null ? pos.numberOfObjects : pi.length, pi.length);
    for (let i = 0; i < n; i++) {
        const p = pi[i] || {}, r = ri[i] || {}, d = di[i] || {};
        const cls = Object.prototype.hasOwnProperty.call(OBJECT_TYPE, String(r.classificationType)) ? OBJECT_TYPE[String(r.classificationType)] : 'unk';
        if (cls === null) continue;
        const x = num(p.positionX), y = num(p.positionY);
        if (x === null || y === null) continue;
        out.push(fit(C, { id: 'c' + (num(r.objectID) !== null ? r.objectID : i), cls, x: x * C.scale, y: y * C.scale * C.ySign, len: num(d.length), wid: num(d.width), lane: r.drivingTubeMapping }));
    }
    return out.filter(Boolean);
}

const TCP_CLS = [['class_car', 'car'], ['class_truck', 'truck'], ['class_motorcycle', 'two'], ['class_bicycle', 'cyc'], ['class_pedestrian', 'ped'], ['class_unknown', 'unk'], ['class_animal', 'unk'], ['class_hazard', 'unk']];
function tcpObjects(cfg, v) {
    const C = cfg.objects, out = [];
    const list = arr(v && v.objectListSmall);
    const n = Math.min(20, num(v && v.numberOfObjects) !== null ? v.numberOfObjects : list.length, list.length);
    for (let i = 0; i < n; i++) {
        const o = list[i] || {}, pos = o.position || {}, cl = o.classification || {}, sh = o.shape || {};
        const ex = o.existence || {};
        if (num(ex.existence_probability) !== null && ex.existence_probability < C.minProb) continue;
        let best = 'unk', bp = -1;
        TCP_CLS.forEach((c) => { const p = num(cl[c[0]]); if (p !== null && p > bp) { bp = p; best = c[1]; } });
        const x = val(pos.x), y = val(pos.y);
        if (x === null || y === null) continue;
        const id = o.summary && num(o.summary.id) !== null ? o.summary.id : i;
        out.push(fit(C, { id: 't' + id, cls: best, x: x * C.scale, y: y * C.scale * C.ySign, len: val(sh.length && sh.length.value !== undefined ? sh.length : null), wid: null, lane: null }));
    }
    return out.filter(Boolean);
}

/** Keep an object in the drawn range; null otherwise. */
function fit(C, o) {
    if (!(o.x >= C.xMin && o.x <= C.xMax && Math.abs(o.y) <= C.yMax)) return null;
    if (!(o.wid > 0.2 && o.wid < 4)) o.wid = null;
    return o;
}

function laneModel(cfg, v) {
    const L = cfg.lanes, lines = [];
    const b = arr(v && v.laneBoundaryFront), pr = arr(v && v.laneBoundaryPropertiesFront);
    for (let i = 0; i < Math.min(4, b.length); i++) {
        const s = b[i] || {}, p = pr[i] || {};
        const q = s.modelQualifier;
        if (q === 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE' || q === 2 || q === 'SIGNAL_UNFILLED' || q === 255) continue;
        const prob = num(s.existenceProbability);
        if (prob !== null && prob < L.minProb) continue;
        const y0 = num(s.pointSegment1 && s.pointSegment1.y), a = num(s.baseSegment1 && s.baseSegment1.angle), c = num(s.baseSegment1 && s.baseSegment1.curvature);
        if (y0 === null) continue;
        const ti = p.typeInfo || {};
        const type = Object.prototype.hasOwnProperty.call(LINE_TYPE, String(ti.type)) ? LINE_TYPE[String(ti.type)] : 'solid';
        const len = num(s.parametersSegment1 && s.parametersSegment1.validLength), len2 = num(s.parametersSegment2 && s.parametersSegment2.validLength);
        lines.push({
            y0: y0 * L.scale * L.ySign, a: (a || 0) * L.ySign, c: (c || 0) * L.ySign / L.scale, dc: (num(s.parametersSegment1 && s.parametersSegment1.curvatureChange) || 0) * L.ySign,
            len: Math.min(L.maxLen, Math.max(10, ((len || 0) + (len2 || 0)) * L.scale || L.maxLen)), type, prob: prob === null ? 1 : prob,
        });
    }
    if (!lines.length) return null;
    lines.sort((p, q) => q.y0 - p.y0);                    // left (y +) first
    return { src: 'measured', lines, width: num(v && v.laneRecognitionFront && v.laneRecognitionFront.widthEgoLane) };
}

const FIXED = { src: 'fixed', lines: [{ y0: 1.75, a: 0, c: 0, dc: 0, len: 250, type: 'solid', prob: 1 }, { y0: -1.75, a: 0, c: 0, dc: 0, len: 250, type: 'solid', prob: 1 }] };

function lineY(l, x) { return l.y0 + x * (l.a + x * (0.5 * l.c + x * (l.dc || 0) / 6)); }

/** The ego lane: the nearest line left of us and the nearest right; its centre clothoid and half width. */
function egoOf(lanes) {
    const ls = (lanes || FIXED).lines;
    let left = null, right = null;
    ls.forEach((l) => { if (l.y0 >= 0 && (!left || l.y0 < left.y0)) left = l; if (l.y0 < 0 && (!right || l.y0 > right.y0)) right = l; });
    const half = left && right ? Math.max(1.2, Math.min(2.6, (left.y0 - right.y0) / 2)) : 1.75;
    if (left && right) return { y0: (left.y0 + right.y0) / 2, a: (left.a + right.a) / 2, c: (left.c + right.c) / 2, half };
    const one = left || right;
    if (one) return { y0: one.y0 + (one === left ? -half : half), a: one.a, c: one.c, half };
    return { y0: 0, a: 0, c: 0, half };
}

/* ------------------------------------------------------------------------------------------------ the tracker */

/**
 * Objects by source and id. update(src, list, now) takes a decoded list; frame(now) the objects to draw: positions glide
 * toward the measured ones (time constant glideMs), an object not in its source's latest list fades out over fadeMs after
 * lostMs and is then dropped, so nothing is ever frozen. One source draws at a time: the first in `order` that spoke within
 * lostMs + fadeMs.
 */
function Tracker(cfg, order) {
    this.cfg = cfg;
    this.order = order || ['cam', 'tcp', 'demo'];
    this.src = {};
}
Tracker.prototype.update = function (src, list, now) {
    const S = this.src[src] || (this.src[src] = { at: 0, objs: {} });
    S.at = now;
    const seen = {};
    (list || []).forEach((o) => {
        seen[o.id] = true;
        const t = S.objs[o.id];
        if (!t) S.objs[o.id] = { id: o.id, cls: o.cls, x: o.x, y: o.y, tx: o.x, ty: o.y, wid: o.wid, at: now, upd: now, seen: now };
        else { t.tx = o.x; t.ty = o.y; t.cls = o.cls; t.wid = o.wid || t.wid; t.seen = now; }
    });
    return Object.keys(seen).length;
};
Tracker.prototype.frame = function (now) {
    const C = this.cfg.objects, life = C.lostMs + C.fadeMs;
    let use = null;
    for (let i = 0; i < this.order.length; i++) { const S = this.src[this.order[i]]; if (S && now - S.at < life) { use = S; break; } }
    const out = [];
    Object.keys(this.src).forEach((k) => {
        const S = this.src[k];
        Object.keys(S.objs).forEach((id) => {
            const t = S.objs[id], lost = now - t.seen;
            if (lost > life) { delete S.objs[id]; return; }
            const kk = 1 - Math.exp(-Math.max(0, now - t.upd) / C.glideMs);
            t.x += (t.tx - t.x) * kk; t.y += (t.ty - t.y) * kk; t.upd = now;
            if (S !== use) return;
            const alpha = lost <= C.lostMs ? 1 : Math.max(0, 1 - (lost - C.lostMs) / C.fadeMs);
            if (alpha > 0.02) out.push({ id: t.id, cls: t.cls, x: t.x, y: t.y, wid: t.wid, alpha });
        });
    });
    out.sort((a, b) => b.x - a.x);                 // far first: the near ones are drawn over them
    return out.slice(-C.max);
};
Tracker.prototype.sourceNow = function (now) {
    const C = this.cfg.objects, life = C.lostMs + C.fadeMs;
    for (let i = 0; i < this.order.length; i++) { const S = this.src[this.order[i]]; if (S && now - S.at < life) return this.order[i]; }
    return null;
};

/** The vehicle ahead from a list: the nearest vehicle in the ego lane (|y - centre| < 0.8 half width), or null. */
function leadOf(objs, lanes) {
    const e = egoOf(lanes);
    let best = null;
    (objs || []).forEach((o) => {
        if (['car', 'truck', 'two', 'unk'].indexOf(o.cls) < 0) return;
        const c = e.y0 + o.x * (e.a + 0.5 * e.c * o.x);
        if (Math.abs(o.y - c) < e.half * 0.8 && (!best || o.x < best.x)) best = o;
    });
    return best;
}

/* ------------------------------------------------------------------------------------------------ the demo scenes */

const SCENES = ['busy', 'crossing', 'cyclist', 'cutin', 'lanechange', 'curve', 'nolanes'];
const SCENE_MS = 10000;

function lanesOf(n, shift, c, types) {
    // n lanes to the left and to the right of ours (lines at +-1.75, +-5.25 ...), shifted sideways by `shift` m
    const lines = [];
    const ty = types || {};
    for (let k = -n - 1; k <= n; k++) {
        const y = (k + 0.5) * 3.5 + shift;
        const outer = k === -n - 1 || k === n;
        lines.push({ y0: y, a: 0, c: c || 0, dc: 0, len: 110, type: ty[k] || (outer ? 'edge' : 'dashed'), prob: 1 });
    }
    lines.sort((p, q) => q.y0 - p.y0);
    return { src: 'measured', lines: lines.filter((l) => Math.abs(l.y0) < 9), width: 3.5 };
}

const wrap = (v, lo, hi) => { const w = hi - lo; return lo + ((((v - lo) % w) + w) % w); };

/** A scene at time ms (0..SCENE_MS, it loops): { lanes, objects, lead: { x, y, cls } | null, clo }. */
function scene(name, ms) {
    const t = (wrap(ms, 0, SCENE_MS)) / 1000;
    const O = (id, cls, x, y) => ({ id, cls, x, y, wid: null });
    if (name === 'busy') {
        const lanes = lanesOf(1, 0, 0, { '-2': 'edge', 1: 'solid' });
        const objs = [
            O('b1', 'car', wrap(18 + t * 2.5, 8, 90), 3.5), O('b2', 'truck', wrap(42 - t * 1.5, 8, 90), 3.5), O('b3', 'car', wrap(70 + t * 3, 8, 90), 3.5),
            O('b4', 'car', wrap(12 + t * 4, 6, 90), -3.5), O('b5', 'two', wrap(35 + t * 5, 6, 90), -3.6), O('b6', 'car', wrap(60 - t * 2, 6, 90), -3.5),
            O('b7', 'truck', wrap(85 - t * 1, 6, 90), -3.5), O('b8', 'car', 55, 0.1), O('b9', 'car', wrap(80 - t * 12, 10, 95), 7.0), O('b10', 'car', wrap(40 - t * 12, 10, 95), 7.0),
        ];
        return { lanes, objects: objs, lead: { x: 26 - Math.sin(t) * 2, y: 0, cls: 'car' }, clo: 0 };
    }
    if (name === 'crossing') {
        const lanes = lanesOf(0, 0, 0, { '-1': 'edge', 0: 'edge' });
        const px = 4.5 - (t % 10) * 0.9;
        return { lanes, objects: [O('p1', 'ped', 22, px), O('p2', 'ped', 23, px + 1.2), O('c1', 'car', 45, 0.2)], lead: null, clo: 0 };
    }
    if (name === 'cyclist') {
        const lanes = lanesOf(0, 0, 0, { '-1': 'edge', 0: 'dashed' });
        return { lanes, objects: [O('y1', 'cyc', 9 + t * 0.6, -2.4), O('y2', 'car', wrap(50 - t * 8, 15, 95), 3.5)], lead: { x: 40, y: 0, cls: 'car' }, clo: 0 };
    }
    if (name === 'cutin') {
        const lanes = lanesOf(1, 0, 0);
        const k = Math.min(1, Math.max(0, (t - 2) / 4));
        const y = -3.5 * (1 - k * k * (3 - 2 * k));
        const x = 28 - k * 8;
        const inLane = Math.abs(y) < 1.4;
        return { lanes, objects: inLane ? [O('k2', 'car', 60, 0)] : [O('k1', 'car', x, y), O('k2', 'car', 60, 0)], lead: inLane ? { x, y, cls: 'car' } : { x: 60, y: 0, cls: 'car' }, clo: inLane && k < 1 ? 1 : 0 };
    }
    if (name === 'lanechange') {
        const k = Math.min(1, Math.max(0, (t - 2) / 5));
        const shift = -3.5 * k * k * (3 - 2 * k);          // we move left: the world moves right
        const lanes = lanesOf(1, shift, 0);
        return { lanes, objects: [O('l1', 'car', 30, 0 + shift), O('l2', 'truck', 18, -3.5 + shift), O('l3', 'car', 50, 3.5 + shift)], lead: k > 0.6 ? { x: 50, y: 3.5 + shift, cls: 'car' } : { x: 30, y: shift, cls: 'car' }, clo: 0 };
    }
    if (name === 'curve') {
        const c = 1 / 260 * Math.sin(t * Math.PI / 5);
        const lanes = lanesOf(1, 0, c);
        const on = (x, y) => O('v' + x, 'car', x, y + 0.5 * c * x * x);
        return { lanes, objects: [on(55, 3.5), on(70, -3.5), O('vt', 'truck', 85, -3.5 + 0.5 * c * 85 * 85)], lead: { x: 32, y: 0.5 * c * 32 * 32, cls: 'car' }, clo: 0 };
    }
    // nolanes: no lane model: the fixed symbol, objects still placed
    return { lanes: null, objects: [O('n1', 'car', wrap(30 + t * 2, 10, 80), 3.4), O('n2', 'ped', 14, -4.2)], lead: { x: 24, y: 0, cls: 'car' }, clo: 0 };
}

/* ------------------------------------------------------------------------------------------------ the perspective */

const HZ = 0.04, TFAR = 0.20, KF = 1 / TFAR - 1;      // the far end (RANGE) at 0.2 of the foot's scale

/** Screen place of the world point (x m ahead, y m left) in the lane box g.lane (px of the placement). */
function project(g, range, x, y) {
    const z = x / range, t = 1 / (1 + z * KF);
    const lx = g.lane[0], ly = g.lane[1], W = g.lane[2], H = g.lane[3], hy = HZ * H;
    const k = g.pxm * t;
    return { px: lx + W / 2 - y * k, py: ly + hy + (H - hy) * t, k, t, z };
}

/* ------------------------------------------------------------------------------------------------ the log */

/** Per source: messages, objects (min..max), classes, x / y ranges (relative metres), qualifiers; a line every periodMs. */
function SourceLog(name, periodMs) {
    this.name = name; this.period = periodMs || 10000; this.reset(0); this.total = 0; this.first = true;
}
SourceLog.prototype.reset = function (now) { this.at = now; this.n = 0; this.oMin = null; this.oMax = 0; this.cls = {}; this.x = [null, null]; this.y = [null, null]; this.words = {}; };
SourceLog.prototype.add = function (objs, word) {
    this.n++; this.total++;
    const k = objs ? objs.length : 0;
    this.oMin = this.oMin === null ? k : Math.min(this.oMin, k); this.oMax = Math.max(this.oMax, k);
    (objs || []).forEach((o) => {
        if (o.cls) this.cls[o.cls] = (this.cls[o.cls] || 0) + 1;
        if (typeof o.x === 'number') { this.x[0] = this.x[0] === null ? o.x : Math.min(this.x[0], o.x); this.x[1] = this.x[1] === null ? o.x : Math.max(this.x[1], o.x); }
        if (typeof o.y === 'number') { this.y[0] = this.y[0] === null ? o.y : Math.min(this.y[0], o.y); this.y[1] = this.y[1] === null ? o.y : Math.max(this.y[1], o.y); }
    });
    if (word) this.words[word] = (this.words[word] || 0) + 1;
};
const r1 = (v) => (v === null ? '-' : (Math.round(v * 10) / 10).toFixed(1));
/** The line to log now (or null): the first message at once, then one summary per period. */
SourceLog.prototype.line = function (now) {
    if (!this.first && now - this.at < this.period) return null;
    if (!this.n) { if (!this.first) this.reset(now); return null; }
    const dt = Math.max(1, now - this.at) / 1000;
    const s = 'acc: src ' + this.name + (this.first ? ' first' : '') + ' n ' + this.n + ' rate ' + (this.first ? '-' : (this.n / dt).toFixed(1)) + '/s objs ' + this.oMin + '..' + this.oMax +
        ' cls ' + (Object.keys(this.cls).sort().map((k) => k + ' ' + this.cls[k]).join(' ') || '-') + ' x ' + r1(this.x[0]) + '..' + r1(this.x[1]) + ' m y ' + r1(this.y[0]) + '..' + r1(this.y[1]) + ' m' +
        (Object.keys(this.words).length ? ' q ' + Object.keys(this.words).sort().map((k) => k + ' ' + this.words[k]).join(' ') : '');
    this.first = false;
    this.reset(now);
    return s;
};

module.exports = {
    CLS, SIZE, OBJECT_TYPE, LINE_TYPE, TYPE_CODE, DEFAULT, cfgOf, camObjects, tcpObjects, laneModel, FIXED, lineY, egoOf, Tracker, leadOf,
    SCENES, SCENE_MS, scene, project, HZ, TFAR, KF, SourceLog,
};
