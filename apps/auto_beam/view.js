'use strict';
/**
 * view.js - what Auto Beam shows (round "Auto Beam", package HD): the view state, the 18 drawn states of the brief, the
 * colours, and direction A's geometry (the road from behind our car, both beam cones on it, the lights ahead as points).
 * Pure: no signals, no socket, no clock of its own, no words (shared/i18n through words.js). Plain Node 8.16.
 *
 *   viewOf(o)                 the adapter's output (contract.normal) and the app's own facts -> the view state v:
 *                             { data 'ok' | 'none' | 'stale', adv 'high' | 'low', go (true: "high now" / "dip now", false: a
 *                               standby advice), state, reason (the contract's code), trigger, lamps, disagree, lights [{ id,
 *                               kind (head tail street bike reflector other), x, y (m), ringed, src 'light' | 'object' }],
 *                               src (the data source in use), countdown s | null, yield, act, verdict, speed, bright, limit,
 *                               town ('sign' | 'limit' | null), curve, score }
 *   DEMO                      the 18 states of the brief and a 19th: the fallback (the light stream silent, the camera's
 *                             object list in use) [id, name, v]
 *   keyOf(v)                  one string per band picture (sign, reason, lamps): the same key, the same pixels
 *   colours(placement, night) the palette (0..255): blue ONLY for the sign while high is advised, amber ONLY for the
 *                             disagreement (dip advised, the high beam lit), the tail lamps' warm tone is neither, no red
 *   GEO, project(), beamAt()  the scene's perspective and the two cones' light field (shared by the GPU page, the software
 *                             page and, in GLSL, the map's ab_road shader)
 */

const C = require('./contract');

/* ------------------------------------------------------------------------------------------------ the scene's world */
const RANGE = 450;          // m: the drawn road's far end (from the view's foot)
const EGO_X = 9;            // m: the view's foot behind our front bumper (our car stands at the foot, seen from behind)
const HZ = 0.06;            // the horizon: a share of the scene box's height
const TFAR = 0.11;          // the scale at the far end (1 at the foot): a raised view, so the long beam has room
const KF = 1 / TFAR - 1;
const LOW_M = 60;           // m: the low beam's reach (a flat-topped pool)
const HIGH_M = 220;         // m: the high beam's reach (a long, narrow cone)
const LANE = 3.5;           // m

const GEO = {
    // the centre page: content px of the 1600 x 482 picture (drawn at y 38 of the kit's 1600 x 520 canvas); left half the
    // scene, right half the table. band: the sign, the reason, the lamps. scene: the road box.
    centre: { w: 1600, h: 482, band: [0, 0, 800, 176], scene: [40, 176, 720, 296], pxm: 48, sign: [104, 90, 64], reasonX: 196, divider: 800, table: [860, 1552] },
    // the map target (1088 x 480): everything inside the core x 334..754, y 44..416 that both themes' map windows show
    map: { text: [334, 44, 420, 112], scene: [334, 156, 420, 260], pxm: 30, sign: [392, 100, 44], reasonX: 452 },
    // the head-up display (800 x 480; only x 120 y 100 485 x 278 reaches the eye): mockups only
    hud: { window: [120, 100, 485, 278] },
};

/** A ground point x m ahead of our front, y m to the left -> { px, py, k (px / m), t } in the scene box g (its own px). */
function project(g, x, y, curve) {
    const W = g.scene[2], H = g.scene[3], hy = HZ * H;
    const z = Math.max(0, (x + EGO_X) / RANGE);
    const t = 1 / (1 + z * KF);
    const k = g.pxm * t;
    const yy = y - (curve ? 0.5 * curve * Math.max(0, x) * Math.max(0, x) : 0);
    return { px: W / 2 - yy * k, py: hy + (H - hy) * t, k, t };
}
/** The inverse: a pixel row's depth: t -> x (m ahead of our front). */
function xOfT(t) { return (1 / t - 1) / KF * RANGE - EGO_X; }

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The two cones' half widths (m) and strengths at x m ahead; e: the high beam's extent 0 (folded) .. 1 (out). */
function beamAt(x, e, night) {
    if (x < 0.5) return { lowW: 0, low: 0, highW: 0, high: 0 };
    const nm = night ? 0.8 : 1;
    const lowW = 1.0 + 5.2 * (1 - Math.exp(-x / 8));
    const low = 0.62 * nm * (1 - sstep(LOW_M * 0.72, LOW_M, x)) * (0.55 + 0.45 * Math.exp(-x / 25));
    const reach = LOW_M + (HIGH_M - LOW_M) * e;
    const highW = 0.8 + 3.4 * (1 - Math.exp(-x / 40));
    const high = e <= 0.001 ? 0 : 0.50 * nm * Math.sqrt(e) * (1 - sstep(reach * 0.55, reach, x)) * (0.55 + 0.45 * Math.exp(-x / 90));
    return { lowW, low, highW, high };
}

/** An interpreted light (the algorithm's details.lights: az_deg + right, dist_m) -> the scene's metres (x ahead, y left). */
function lightXY(l) {
    const d = l.dist_m === null || l.dist_m === undefined ? 380 : l.dist_m, a = (l.az_deg || 0) * Math.PI / 180;
    return { x: d * Math.cos(a), y: -d * Math.sin(a) };
}
// drawing by the contract's kinds: head (oncoming headlamps, white pair), tail (tail lamps ahead, warm pair), street (pale,
// high up), bike (one white lamp), reflector / other (grey)
const HEIGHT = { head: 0.7, tail: 0.8, street: 6, bike: 1.0, reflector: 0.8, other: 1.0 };
const PAIR = { head: 1.5, tail: 1.4, street: 0, bike: 0, reflector: 0, other: 0 };

/* ------------------------------------------------------------------------------------------------ the view state */
const fin = (x) => typeof x === 'number' && isFinite(x);

/**
 * o: { out (contract.normal), lamps, data, verdictRaw, speed, bright, limit, yield, act, now, score, curve, town ('sign' |
 * 'limit' | null), standIn }
 */
function viewOf(o) {
    const out = o.out || C.normal(null, null);
    const lamps = o.lamps === undefined ? null : o.lamps;
    const lights = (out.lights || []).map((l) => { const p = lightXY(l); return { id: l.id, kind: l.kind, x: p.x, y: p.y, ringed: !!l.cause, src: l.src }; });
    const go = out.state === 'HIGH' || out.state === 'DIPPED' || out.state === 'OVERRIDE';
    const adv = out.want === 'high' ? 'high' : 'low';
    const cd = out.state === 'DIPPED' && out.holdUntil && fin(o.now) && out.holdUntil > o.now && !out.trigger ? Math.ceil((out.holdUntil - o.now) / 1000) : null;
    return {
        data: o.data || 'ok', adv, go, state: out.state, reason: out.reason, trigger: !!out.trigger, lamps,
        disagree: adv === 'low' && (lamps === 'high'),
        lights, src: out.src || null, countdown: cd, yield: !!o.yield, act: o.act || null,
        verdict: out.verdict ? Object.assign({}, out.verdict, { calibration: o.verdictRaw ? o.verdictRaw.calibration : null, vehicles: o.verdictRaw ? o.verdictRaw.vehicles : null, signs: o.verdictRaw ? o.verdictRaw.signs : null, pedestrians: o.verdictRaw ? o.verdictRaw.pedestrians : null }) : null,
        speed: fin(o.speed) ? o.speed : null, bright: fin(o.bright) ? o.bright : null, limit: fin(o.limit) ? o.limit : null,
        town: o.town || null, curve: fin(o.curve) ? o.curve : 0, score: o.score || null, standIn: !!o.standIn,
    };
}

/* ------------------------------------------------------------------------------------------------ the states */
const TRIG = C.TRIGGERS;
const V = (state, reason, adv, lamps, extra) => Object.assign({
    data: 'ok', adv, go: state === 'HIGH' || state === 'DIPPED' || state === 'OVERRIDE', state, reason, trigger: TRIG.indexOf(reason) >= 0, lamps,
    disagree: adv === 'low' && lamps === 'high', lights: [], src: 'light', countdown: null, yield: false, act: null, town: null,
    verdict: null, speed: 82, bright: 6, limit: 90, curve: 0, score: { agreePct: 91, totalS: 1260, driver: 14, app: 15, early: 9, late: 4, missed: 1, extra: 2, leadS: 1.4, lagS: 0.9, ring: [] },
}, extra || {});
const head = (x, y, ringed, id, src) => ({ id: id || 1, kind: 'head', x, y, ringed: !!ringed, src: src || 'light' });
const tail = (x, y, ringed, id) => ({ id: id || 2, kind: 'tail', x, y, ringed: !!ringed, src: 'light' });
const street = (x, y, id) => ({ id, kind: 'street', x, y, ringed: false, src: 'light' });
const STREETS = [street(40, 7.5, 11), street(75, -6.5, 12), street(110, 7.5, 13), street(150, -6.5, 14), street(200, 7.5, 15)];
const DEMO = [
    ['01', 'nodata', V('UNAVAILABLE', 'nodata', 'low', 'low', { data: 'none', src: null, speed: 76, bright: null })],
    ['02', 'daylight', V('STANDBY', 'daylight', 'low', 'low', { bright: 120, speed: 74 })],
    ['03', 'slow', V('STANDBY', 'slow', 'low', 'low', { speed: 24 })],
    ['04', 'town', V('STANDBY', 'town', 'low', 'low', { limit: 50, speed: 48, town: 'sign', lights: STREETS.slice(0, 4) })],
    ['05', 'high', V('HIGH', 'clear', 'high', 'high', { speed: 88 })],
    ['06', 'oncomingFar', V('HIGH', 'clear', 'high', 'high', { lights: [head(430, 3.5)], speed: 86 })],
    ['07', 'oncoming', V('DIPPED', 'oncoming', 'low', 'low', { lights: [head(170, 3.5, true)], speed: 86 })],
    ['08', 'preceding', V('DIPPED', 'preceding', 'low', 'low', { lights: [tail(95, 0, true)], speed: 84 })],
    ['09', 'streetlights', V('DIPPED', 'streetlights', 'low', 'low', { lights: STREETS.slice(), speed: 70, limit: 70 })],
    ['10', 'curve', V('DIPPED', 'curve', 'low', 'low', { curve: 1 / 450, speed: 64, countdown: 1 })],
    ['11', 'return', V('DIPPED', 'oncoming', 'low', 'low', { countdown: 2, trigger: false, speed: 86 })],
    ['12', 'driverHigh', V('DIPPED', 'oncoming', 'low', 'high', { lights: [head(150, 3.5, true)], speed: 86 })],
    ['13', 'driverLow', V('HIGH', 'clear', 'high', 'low', { speed: 86 })],
    ['14', 'weather', V('STANDBY', 'weather', 'low', 'low', { speed: 70 })],
    ['15', 'camera', V('UNAVAILABLE', 'camera', 'low', 'low', { verdict: { allow: null, use: 'log', agrees: null, calibration: 1 } })],
    ['16', 'stale', V('UNAVAILABLE', 'nodata', 'low', 'low', { data: 'stale', src: null })],
    ['17', 'carMessage', V('HIGH', 'clear', 'high', 'high', { yield: true })],
    ['18', 'actuator', V('HIGH', 'clear', 'high', 'low', { act: 'high' })],
    ['19', 'fallback', V('DIPPED', 'oncoming', 'low', 'low', { src: 'object', lights: [head(110, 3.5, true, 41, 'object'), tail(70, 0, false, 42)], speed: 84 })],
];
// the camera's own verdict in the demo: present, compared only (states with a verdict of their own keep it)
DEMO.forEach((d) => { if (d[2].verdict === null && d[2].data === 'ok' && d[2].src === 'light') d[2].verdict = { allow: d[2].adv === 'high', use: 'log', agrees: true, calibration: 0, vehicles: d[2].lights.filter((l) => l.kind !== 'street').length, signs: 0, pedestrians: 0 }; });

/** One string per band picture. */
function keyOf(v) {
    return [v.data, v.adv, v.go ? 1 : 0, v.state, v.reason, v.trigger ? 1 : 0, v.lamps || '-', v.disagree ? 1 : 0, v.countdown || 0, v.yield ? 1 : 0].join('|');
}
/** The scene's key (the software page repaints when it changes): the lights to 2 m, the curve. */
function sceneKey(v, e) {
    return (v.lights || []).map((l) => l.kind[0] + Math.round(l.x / 2) + ':' + Math.round(l.y) + (l.ringed ? 'r' : '')).join(',') + '/' + Math.round((v.curve || 0) * 1e5) + '/' + Math.round(e * 20) + '/' + (v.yield ? 1 : 0) + '/' + v.adv;
}

/* ------------------------------------------------------------------------------------------------ colours */
const NIGHT = { ink: 0.80, dim: 0.75, faint: 0.80, blue: 0.80, amber: 0.80, tail: 0.75, onc: 0.85, street: 0.75, panel: 0.6, road: 0.7, edge: 0.7, beam: 0.85 };

function colours(placement, night) {
    const p = {
        bg: [0, 0, 0], ink: [236, 239, 243], dim: [150, 156, 165], faint: [58, 62, 68], panel: [14, 15, 18],
        blue: [64, 140, 255],          // the sign while high is advised (blue: the conventional high-beam colour)
        amber: [240, 170, 10],         // the one case that must stand out: dip advised, the high beam lit
        onc: [246, 248, 255],          // oncoming headlamps: white
        tail: [232, 136, 92],          // tail lamps ahead: a warm tone, never a warning red (r 232 g 136 b 92)
        street: [196, 200, 176],       // street lights: small, pale
        other: [140, 146, 155],
        road: [22, 24, 28], edge: [96, 100, 108], car: [70, 74, 82], carHi: [128, 133, 142],
        beam: [255, 244, 218],         // the light on the road: a warm white (never blue: blue means the advice)
    };
    if (placement === 'centre') { p.bg = [20, 22, 26]; p.panel = [30, 33, 38]; p.road = [30, 33, 38]; p.faint = [70, 74, 82]; }
    if (night) {
        Object.keys(NIGHT).forEach((k) => { p[k] = p[k].map((c) => Math.round(c * NIGHT[k])); });
        if (placement === 'centre') { p.bg = [6, 7, 9]; p.panel = [13, 14, 17]; p.road = [14, 15, 18]; }
    }
    return p;
}
const mix = (c, a, bg) => [0, 1, 2].map((i) => Math.round(bg[i] + (c[i] - bg[i]) * a));

/** The sign's colour role: blue while high is advised (and the advice is live), else grey; faint while unavailable. */
function signRole(v) {
    if (v.data !== 'ok' || v.state === 'UNAVAILABLE') return 'faint';
    return v.adv === 'high' && v.go ? 'blue' : 'dim';
}

/** The high beam's extent the advice wants (the picture's main motion runs towards it). */
function extentOf(v) { return v.adv === 'high' && v.go && !v.yield ? 1 : 0; }

module.exports = {
    viewOf, DEMO, keyOf, sceneKey, colours, mix, signRole, extentOf, GEO, project, xOfT, beamAt, lightXY, HEIGHT, PAIR,
    RANGE, EGO_X, HZ, TFAR, KF, LOW_M, HIGH_M, LANE, NIGHT, sstep,
};
