'use strict';
/**
 * chaos.js - the bad lane inputs the camera may send, for the tests and the demo (round fixes-1121 AL), and the demo scenes
 * that show the lane model's answer. Pure and deterministic (a seeded generator per frame). Plain Node 8.
 *
 *   KINDS                       the chaos kinds: good, zeroLen, shortLen, hugeCurv, curvChange, bigAngle, wrongSide, defaults,
 *                               oneSide, crossing, narrow, wide, flicker, prob100, probLow, nonFinite, jump, noise, predicted,
 *                               notAvailable, mixed
 *   message(kind, i, o)         frame i of a kind (camera rate RATE_MS): one LaneBoundaries event in the catalogue's shape
 *                               (reference/car/2026-11-15: laneBoundaryFront[4], laneBoundaryPropertiesFront[4] ...).
 *                               o: { c (the true curvature), shift (m), seed }
 *   SCENES / scene(name, ms)    the demo scenes: lost (on a straight), lostcurve (the corridor bends with our yaw), oneedge,
 *                               flicker, junction (lines cross), town (slow, the steering), standing. -> { raw (the camera's
 *                               message or null: nothing arrives), motion { v m/s, yaw rad/s, steer rad }, objects, lead }
 *   world(name, ms, cfg)        the scene through the real filter (lanes.js), memoised per scene: { lanes, objects, lead, src }
 *   unflatten(x) / replay(...)  the hook for a real log: a Signal Probe recorder line ("path=value ..." or a JSON object) back
 *                               into the event's object, and a list of { t, value } run through a fresh filter
 */
const Wo = require('./world');
const Ln = require('./lanes');

const RATE_MS = 1000 / 15;          // the camera: 15 messages a second (a guess: SR-REPORT 10-20 Hz)

function prng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** One boundary in the catalogue's shape. */
function bnd(y, o) {
    const p = o || {};
    return {
        laneBoundaryInvalidFlags: 0, statusMeasurement: p.meas || 'ELEMENT_MEASURED', existenceProbability: p.prob !== undefined ? p.prob : 0.92,
        modelQualifier: p.q || 'LANE_BOUNDARY_MODEL_AVAILABLE', id: p.id !== undefined ? p.id : 0,
        pointSegment1: { x: 0, y }, baseSegment1: { angle: p.a || 0, curvature: p.c || 0 },
        parametersSegment1: { curvatureChange: p.dc || 0, validLength: p.len !== undefined ? p.len : 55 },
        parametersSegment2: { curvatureChange: 0, validLength: p.len2 !== undefined ? p.len2 : 25 },
    };
}
function msg(bs, types, width) {
    return {
        eventDataQualifier: 'EVENT_DATA_AVAILABLE', laneRecognitionFront: { widthEgoLane: width === undefined ? 3.5 : width, visibilityConditions: 'UNKNOWN' },
        laneBoundaryFront: bs, laneBoundaryPropertiesFront: (types || []).map((t) => ({ typeInfo: { type: t } })),
    };
}
const TYPES = ['ROAD_EDGE', 'DASHED', 'DASHED', 'ROAD_EDGE'];
/** The true road: lines at +-1.75 and +-5.25 (+ shift), curvature c. */
function good(c, shift, o) {
    const s = shift || 0;
    return msg([5.25, 1.75, -1.75, -5.25].map((y, i) => bnd(y + s, Object.assign({ c, id: i + 1 }, o || {}))), TYPES);
}

const KINDS = ['good', 'zeroLen', 'shortLen', 'hugeCurv', 'curvChange', 'bigAngle', 'wrongSide', 'defaults', 'oneSide', 'crossing', 'narrow', 'wide',
    'flicker', 'prob100', 'probLow', 'nonFinite', 'jump', 'noise', 'predicted', 'notAvailable', 'mixed'];

function message(kind, i, o) {
    const p = o || {}, c = p.c || 0, sh = p.shift || 0, r = prng((p.seed || 1) * 7919 + i * 104729 + KINDS.indexOf(kind) * 31);
    const sg = () => (r() < 0.5 ? -1 : 1);
    switch (kind) {
    case 'good': return good(c, sh);
    case 'zeroLen': return good(c, sh, { len: 0, len2: 0 });                              // a zero valid length (0.1.0 drew it 120 m long)
    case 'shortLen': return good(c, sh, { len: 2 + r() * 3, len2: 0 });
    case 'hugeCurv': return msg([1.75, -1.75].map((y) => bnd(y + sh, { c: sg() * (0.05 + r() * 0.2) })), ['DASHED', 'DASHED']);
    case 'curvChange': return msg([1.75, -1.75].map((y) => bnd(y + sh, { c, dc: sg() * (0.002 + r() * 0.01) })), ['DASHED', 'DASHED']);
    case 'bigAngle': return msg([1.75, -1.75].map((y) => bnd(y + sh, { a: sg() * (0.4 + r() * 0.8), c })), ['DASHED', 'DASHED']);
    case 'wrongSide': return msg([bnd(-0.9 + sh, { c }), bnd(0.9 + sh, { c }), bnd(-2.2 + sh, { c })], ['SOLID', 'SOLID', 'DASHED']);
    case 'defaults':                // unfilled zeros, and raw maxima scaled as if they were metres
        return msg([bnd(0, { prob: 0, len: 0, len2: 0 }), bnd(327.67, { prob: 0.5, len: 655.35, len2: 0 }), bnd(0, { prob: 1, len: 655.35, len2: 655.35 }), bnd(-327.68, { a: 3.2767, c: 3.2767, len: 655.35 })], TYPES);
    case 'oneSide': { const m = good(c, sh); m.laneBoundaryFront[2].modelQualifier = 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE'; m.laneBoundaryFront[3].modelQualifier = 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE'; return m; }
    case 'crossing': return msg([bnd(1.75 + sh, { a: -0.12, c: -0.006 }), bnd(-1.75 + sh, { a: 0.05, c: 0.004 }), bnd(4.5 + sh, { a: -0.2 })], ['SOLID', 'DASHED', 'ROAD_EDGE']);
    case 'narrow': return msg([bnd(0.3 + sh, { c }), bnd(-0.3 + sh, { c }), bnd(1.75 + sh, { c }), bnd(1.2 + sh, { c })], ['SOLID', 'SOLID', 'DASHED', 'DASHED']);
    case 'wide': return msg([bnd(6 + sh, { c }), bnd(-6 + sh, { c })], ['ROAD_EDGE', 'ROAD_EDGE']);
    case 'flicker': { const m = good(c, sh); m.laneBoundaryFront.forEach((b) => { if (r() < (p.drop || 0.5)) b.modelQualifier = 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE'; }); return m; }
    case 'prob100': return good(c, sh, { prob: 85 + r() * 10 });                          // 0..100, as a percentage
    case 'probLow': return good(c, sh, { prob: 0.02 + r() * 0.2 });
    case 'nonFinite': { const m = good(c, sh); m.laneBoundaryFront[1].pointSegment1.y = NaN; m.laneBoundaryFront[2].baseSegment1.curvature = Infinity; m.laneBoundaryFront[0].parametersSegment1.validLength = -Infinity; m.laneBoundaryFront[3].baseSegment1.angle = 'x'; return m; }
    case 'jump': return good(c, sh + (i % 6 < 3 ? 0 : sg() * (1.2 + r())));
    case 'noise': return msg([0, 1, 2, 3].map(() => bnd((r() - 0.5) * 16, { a: (r() - 0.5) * 0.6, c: (r() - 0.5) * 0.04, len: r() * 90, prob: r() })), TYPES);
    case 'predicted': return good(c, sh, { meas: 'ELEMENT_PREDICTED', q: 'LANE_BOUNDARY_MODEL_AVAILABLE_REDUCED' });
    case 'notAvailable': return msg([0, 1, 2, 3].map(() => bnd(0, { q: 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE', len: 0, len2: 0 })), TYPES);
    case 'mixed': default: {
        const bad = KINDS.filter((k) => k !== 'good' && k !== 'mixed' && k !== 'predicted' && k !== 'prob100');
        return message(bad[Math.floor(r() * bad.length)], i, Object.assign({}, p, { seed: (p.seed || 1) + 17 }));
    }
    }
}

/* ------------------------------------------------------------------------------------------------ the demo scenes */

const SCENES = ['lost', 'lostcurve', 'oneedge', 'flicker', 'junction', 'town', 'standing'];
const SCENE_MS = Wo.SCENE_MS;
const D2R = Math.PI / 180;

/** Scene name at ms (0..SCENE_MS) -> { raw, motion: { v, yaw, steer }, objects, lead }. */
function scene(name, ms) {
    const t = Math.max(0, Math.min(SCENE_MS, ms)) / 1000, i = Math.floor(ms / RATE_MS);
    const O = (id, cls, x, y, lane) => ({ id, cls, x, y, wid: null, lane: lane || null });
    if (name === 'lost') {          // lanes lost on a straight: garbage of every kind for 4.5 s, then back
        const v = 25, raw = t < 3 || t >= 7.5 ? good(0, 0) : message('mixed', i, { seed: 3 });
        return { raw, motion: { v, yaw: 0.002 * Math.sin(t * 3), steer: 0.01 * Math.sin(t * 2) }, objects: [O('a1', 'car', 60 - t, 3.5, 'OBJECT_IN_NEXT_LANE_LEFT')], lead: { x: 32 + Math.sin(t) * 2, y: 0, cls: 'car' } };
    }
    if (name === 'lostcurve') {     // lost in a left curve (R 350 m): nothing arrives, the corridor bends with our yaw rate
        const c = 1 / 350, v = 22, raw = t < 2.5 || t >= 8 ? good(c, 0) : null;
        const on = (x) => 0.5 * c * x * x;
        return { raw, motion: { v, yaw: v * c, steer: Math.atan(c * 2.851) * 15.0 }, objects: [O('c1', 'car', 55, 3.5 + on(55), 'OBJECT_IN_NEXT_LANE_LEFT'), O('c2', 'truck', 75, -3.5 + on(75), 'OBJECT_IN_NEXT_LANE_RIGHT')], lead: { x: 30, y: on(30), cls: 'car' } };
    }
    if (name === 'oneedge') {       // the right edge lost (zero length, then not available) for 6 s: the other drawn as our guess
        const v = 24, m = good(0, 0);
        if (t >= 2 && t < 8) { m.laneBoundaryFront[2].parametersSegment1.validLength = 0; m.laneBoundaryFront[2].parametersSegment2.validLength = 0; m.laneBoundaryFront[3].modelQualifier = 'LANE_BOUNDARY_MODEL_NOT_AVAILABLE'; }
        return { raw: m, motion: { v, yaw: 0, steer: 0 }, objects: [O('o1', 'car', 45, -3.5, 'OBJECT_IN_NEXT_LANE_RIGHT')], lead: { x: 28, y: 0, cls: 'car' } };
    }
    if (name === 'flicker') {       // every frame a different subset (each line missing 35 % of the frames), a fifth of them garbage
        const r = prng(i * 2654435761);
        const raw = r() < 0.2 ? message('mixed', i, { seed: 5 }) : message('flicker', i, { seed: 9, drop: 0.35 });
        return { raw, motion: { v: 27, yaw: 0, steer: 0 }, objects: [O('f1', 'car', 50, 3.5, 'OBJECT_IN_NEXT_LANE_LEFT')], lead: { x: 35, y: 0, cls: 'car' } };
    }
    if (name === 'junction') {      // the lines cross at a junction (and a ghost line under us): the near part only, or our path
        const v = 12, raw = t < 2.5 || t >= 8 ? good(0, 0) : t < 5 ? message('crossing', i) : message('narrow', i);
        return { raw, motion: { v, yaw: 0.02 * Math.sin(t), steer: 0.2 * Math.sin(t) }, objects: [O('j1', 'car', 22, -6, 'OBJECT_IN_NEXT_LANE_RIGHT'), O('j2', 'ped', 18, 5)], lead: null };
    }
    if (name === 'town') {          // a slow left turn at a junction (6.5 km/h, under vYawMin), no lane message: the path from the steering wheel
        const v = 1.8, sw = 110 * D2R * Math.sin(Math.min(1, t / 8) * Math.PI);
        const k = Math.tan(Ln.roadAngle(CFG0.path, sw)) / 2.851;
        return { raw: null, motion: { v, yaw: v * k, steer: sw }, objects: [O('t1', 'car', 14, 0.5 * k * 196, 'OBJECT_IN_EGO_LANE'), O('t2', 'ped', 9, -4.5)], lead: { x: 14, y: 0.5 * k * 196, cls: 'car' } };
    }
    // standing: at a stop, the wheel turned, nothing from the camera: the corridor follows the turned wheels (the owner, 2026-11-21);
    // fixes-1121 RS: anchored at our rear axle, 200 deg of wheel bends it to R 10.6 m (0.2.1 held it to 20 m), our car inside it
    return { raw: null, motion: { v: 0, yaw: 0, steer: 200 * D2R }, objects: [O('s1', 'car', 7, 0, 'OBJECT_IN_EGO_LANE'), O('s2', 'cyc', 10, -3)], lead: { x: 7, y: 0, cls: 'car' } };
}

const MEMO = {};
const CFG0 = Wo.cfgOf({});
/**
 * A scene through the real lane filter at ms. The filter's clock starts at the scene's 0 and every step is taken in the same
 * order whatever the caller's rhythm (the display steps up to a frame, then the motion, then the frame), so the picture at ms is
 * the same for one call or many. Sequential calls advance; an earlier ms starts the scene again.
 */
function world(name, ms, cfg) {
    const c = cfg || CFG0;
    let m = MEMO[name];
    if (!m || ms < m.ms || m.cfg !== c) {
        m = MEMO[name] = { f: new Ln.Lanes(c), ms: -1, i: 0, cfg: c };
        m.f.maxCatchUp = Infinity;
        m.f.output(0);
    }
    const f = m.f;
    while (m.i * RATE_MS <= ms) {
        const tf = Math.round(m.i * RATE_MS), sc = scene(name, tf), mo = sc.motion;
        f.advance(tf);
        f.motion({ v: { val: mo.v, at: tf }, yaw: { val: mo.yaw, at: tf, raw: mo.yaw / D2R }, steer: { val: mo.steer, at: tf, raw: mo.steer / D2R } });
        if (sc.raw) f.frame(sc.raw, tf, mo.v);
        m.i++;
    }
    m.ms = ms;
    const sc = scene(name, ms);
    return { lanes: f.output(ms), objects: sc.objects, lead: sc.lead, src: 'demo' };
}

/* ------------------------------------------------------------------------------------------------ the replay hook */

/** A recorder line's "a.0.b=1.5 c=NAME" (or a { path: value } object, or the event object itself) -> the event object. */
function unflatten(x) {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
        if (!Object.keys(x).some((k) => k.indexOf('.') >= 0)) return x;
        return build(Object.keys(x).map((k) => [k, x[k]]));
    }
    const pairs = String(x || '').trim().split(/\s+/).map((tok) => { const j = tok.indexOf('='); return j > 0 ? [tok.slice(0, j), tok.slice(j + 1)] : null; }).filter(Boolean)
        .map((p) => [p[0], /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(p[1]) ? Number(p[1]) : p[1] === 'true' ? true : p[1] === 'false' ? false : p[1] === 'NaN' ? NaN : p[1]]);
    return build(pairs);
}
function build(pairs) {
    const root = {};
    pairs.forEach((p) => {
        const ks = p[0].split('.');
        let o = root;
        for (let i = 0; i < ks.length; i++) {
            const k = /^\d+$/.test(ks[i]) ? Number(ks[i]) : ks[i];
            if (i === ks.length - 1) { if (k !== 'n') o[k] = p[1]; break; }
            if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') o[k] = /^\d+$/.test(ks[i + 1]) || ks[i + 1] === 'n' ? [] : {};
            o = o[k];
        }
    });
    return root;
}
/** frames: [{ t (ms), value (object or a recorder line), speed (m/s, optional) }] -> [{ t, verdict, why, lines }] through a fresh filter. */
function replay(frames, cfg) {
    const f = new Ln.Lanes(cfg || Wo.cfgOf({}));
    return (frames || []).map((fr) => {
        const v = typeof fr.value === 'string' ? unflatten(fr.value) : fr.value;
        if (typeof fr.speed === 'number') f.motion({ v: { val: fr.speed, at: fr.t } });
        f.frame(v, fr.t, typeof fr.speed === 'number' ? fr.speed : null);
        const o = f.output(fr.t);
        return { t: fr.t, verdict: o.verdict, why: o.why, lines: o.lines, rej: Object.assign({}, f.count.rej) };
    });
}

module.exports = { KINDS, RATE_MS, message, good, bnd, msg, SCENES, SCENE_MS, scene, world, unflatten, replay, prng };
