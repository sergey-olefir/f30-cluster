'use strict';
/**
 * model.js - ACC View's state, its 28 demo entries (14 states, 7 scenes, 7 lane scenes of fixes-1121 AL), the colours and direction E's geometry (round 1120 AA2; the design is
 * docs/r1120/AA-SPEC.md 3.1 and 4, the decisions docs/AGENT-BRIEF-acc-app.md). Pure: no signals, no socket, no clock of its
 * own, no words (words.js). Plain Node 8 (the car's 8.16.2): no ?. / ?? / object spread. Nothing here throws.
 *
 *   stateOf(fv, cru, warn, lim)  the front-vehicle tracker's view (shared/front_vehicle.js), the cruise reading (limit_src
 *                                hudCruiseOf), the car's own warning flag and the limit read from the road (km/h or null)
 *                                -> { tgt 1..5 | null, clo 0..2, data 'ok' | 'none' | 'stale' | 'absent',
 *                                     cru null | [kind, status, kmh], warn, adv null, lim km/h | null }
 *   DEMO                         the 14 states of the mockup park (tools/acc-view/mockups.py STATES), with their limits
 *   keyOf(s)                     one string per picture: the same key, the same pixels
 *   colours(placement, night)    the palette: Twin Dial's night multipliers, the steel-blue lane lines (a FIXED symbol)
 *   GEO[placement]               E's places on the map target (target px) and on the centre page (content px)
 *   depthOf(level)               the car ahead's depth on the lane, 0 (our foot) .. 1 (the far end)
 *   carRect(g, z)                the car's box (x, y, w, h) standing on the lane at depth z
 *   laneUniforms(g, s, z, night) acc_lane's uniforms for a state; carUniforms(s, night, w, h) acc_car's
 *   pillOf(s)                    the status pill: { key, kind 'info' | 'fast' | 'warn' } or null (events only)
 *   ringOf(s)                    the ring: { fig, key, col } (col: 'green' | 'dim' | 'faint')
 *
 * Colour rules (tested on both placements, day and night): no red anywhere; amber only while closing fast; green only for an
 * active cruise / limiter; cyan only for the loop's suggestion. The lane lines never change with any state.
 */

const Wo = require('./world');
const Ch = require('./chaos');

const STATES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21',
    '22', '23', '24', '25', '26', '27', '28'];

/* ------------------------------------------------------------------------------------------------ the state */

/**
 * fv: { state, present, level, closing, stale } of front_vehicle.create().view(); cru: { kind, status, kmh, shown } of
 * hudCruiseOf (kind null = off); warn: true while the car's own collision warning is requested (only when config.warn says
 * how to read it); lim: the limit read from the road, km/h, or null.
 */
function stateOf(fv, cru, warn, lim) {
    const v = fv || {};
    let data = 'none', tgt = null, clo = 0;
    if (v.absent || v.state === 'absent') data = 'absent';
    else if (v.stale) data = 'stale';
    else if (v.present && v.level >= 1 && v.level <= 5) { data = 'ok'; tgt = v.level; clo = v.closing === 2 ? 2 : v.closing === 1 ? 1 : 0; }
    let c = null;
    if (cru && cru.kind && cru.status !== 'off' && typeof cru.kmh === 'number') {
        c = [cru.kind === 'limiter' ? 'limiter' : 'cruise', cru.status === 'active' ? 'active' : 'standby', Math.round(cru.shown || cru.kmh)];
    }
    const l = typeof lim === 'number' && isFinite(lim) && lim > 0 ? Math.round(lim) : null;
    return { tgt, clo, data, cru: c, warn: !!warn, adv: null, lim: l };
}

const S = (tgt, clo, data, cru, warn, adv, lim, scene) => {
    const o = { tgt: data === 'ok' ? tgt : null, clo, data, cru, warn: !!warn, adv: adv || null, lim: lim || null };
    if (scene) o.scene = scene;
    return o;
};
const C90 = ['cruise', 'active', 90];
const DEMO = [
    ['01', 'absent', S(null, 0, 'absent', C90, false, null, 90)],
    ['02', 'none', S(null, 0, 'none', C90, false, null, 90)],
    ['03', 'far', S(5, 0, 'ok', C90, false, null, 90)],
    ['04', 'middle', S(3, 0, 'ok', C90, false, null, 90)],
    ['05', 'near', S(1, 0, 'ok', C90, false, null, 90)],
    ['06', 'closing', S(3, 1, 'ok', C90, false, null, 90)],
    ['07', 'fast', S(2, 2, 'ok', C90, false, null, 90)],
    ['08', 'cruise-off', S(3, 0, 'ok', null, false, null, 90)],
    ['09', 'standby', S(3, 0, 'ok', ['cruise', 'standby', 90], false, null, 90)],
    ['10', 'active', S(4, 0, 'ok', ['cruise', 'active', 110], false, null, 110)],
    ['11', 'limiter', S(3, 0, 'ok', ['limiter', 'active', 110], false, null, 110)],
    ['12', 'stale', S(null, 0, 'stale', C90, false, null, 90)],
    ['13', 'warn', S(1, 2, 'ok', C90, true, null, 90)],
    ['14', 'advice', S(2, 1, 'ok', ['cruise', 'active', 110], false, 96, 110)],
    // the owner's FOCUS (2026-11-20): what the sensors see; each scene moves (world.js scene(), 10 s a loop)
    ['15', 'busy', S(null, 0, 'ok', C90, false, null, 90, 'busy')],
    ['16', 'crossing', S(null, 0, 'ok', null, false, null, 50, 'crossing')],
    ['17', 'cyclist', S(null, 0, 'ok', null, false, null, 50, 'cyclist')],
    ['18', 'cutin', S(null, 0, 'ok', C90, false, null, 90, 'cutin')],
    ['19', 'lanechange', S(null, 0, 'ok', C90, false, null, 110, 'lanechange')],
    ['20', 'curve', S(null, 0, 'ok', C90, false, null, 90, 'curve')],
    ['21', 'nolanes', S(null, 0, 'ok', null, false, null, null, 'nolanes')],
    // fixes-1121 AL (the owner, 2026-11-21: "коли авто не бачить полоси малюється хаос"): the camera's lanes lost or wrong, run
    // through the real lane model (lanes.js) from the camera's own messages (chaos.js): what is drawn instead
    ['22', 'lost', S(null, 0, 'ok', C90, false, null, 90, 'lost')],
    ['23', 'lostcurve', S(null, 0, 'ok', C90, false, null, 90, 'lostcurve')],
    ['24', 'oneedge', S(null, 0, 'ok', C90, false, null, 90, 'oneedge')],
    ['25', 'flicker', S(null, 0, 'ok', C90, false, null, 110, 'flicker')],
    ['26', 'junction', S(null, 0, 'ok', null, false, null, 50, 'junction')],
    ['27', 'town', S(null, 0, 'ok', null, false, null, 50, 'town')],
    ['28', 'standing', S(null, 0, 'ok', null, false, null, 50, 'standing')],
];

/** A level 1..5 for a lead x metres ahead (the demo scenes; the car's own level comes from front_vehicle.js). */
function levelOfX(x) { return x < 10 ? 1 : x < 20 ? 2 : x < 35 ? 3 : x < 55 ? 4 : 5; }

/**
 * The state with its world at time ms: a demo scene's lanes, objects and lead (the lead sets tgt and closing), or the world the
 * tracker gives (main.js). -> a new state object; s itself is never changed.
 */
function withScene(s, ms) {
    if (!s.scene) return s;
    const w = Ch.SCENES.indexOf(s.scene) >= 0 ? Ch.world(s.scene, ms) : Wo.scene(s.scene, ms);
    const out = Object.assign({}, s, { world: { lanes: w.lanes, objects: w.objects, lead: w.lead, src: 'demo' } });
    if (w.lead) { out.tgt = levelOfX(w.lead.x); out.clo = w.clo || 0; out.data = 'ok'; } else { out.tgt = null; out.clo = 0; out.data = 'none'; }
    return out;
}

/** The lead to draw: the world's measured one, else the level's depth straight ahead; null without a target. */
function leadOf(s) {
    if (s.world && s.world.lead) return s.world.lead;
    return s.tgt ? { x: DEPTH[s.tgt] * RANGE, y: 0, cls: 'car' } : null;
}

/**
 * The view's sideways place (m, left +): the ego lane's centre at our front, so OUR car shifts in its lane when we drift or
 * change lanes (the owner, 2026-11-20); 0 without lane data (centred). s.camY (main.js glides it) overrides.
 */
function camOf(s) {
    if (typeof s.camY === 'number') return s.camY;
    const l = s.world && s.world.lanes;
    return l ? Wo.egoOf(l).y0 : 0;
}

function keyOf(s) {
    return [s.data, s.tgt || 0, s.clo, s.cru ? s.cru.join(':') : '-', s.warn ? 1 : 0, s.adv || 0, s.lim || 0].join('|');
}

const q = (v, k) => Math.round(v / k);
/** The world's picture key (lanes to 5 cm / 1e-4 1/m, objects to 25 cm, their fade in tenths): a change repaints the page. */
function worldKey(s) {
    const w = s.world;
    if (!w) return typeof s.camY === 'number' ? 'c' + q(s.camY, 0.05) : '-';
    const L = w.lanes ? w.lanes.lines.map((l) => q(l.y0, 0.05) + ':' + q(l.a, 0.002) + ':' + q(l.c, 0.0001) + ':' + l.type + ':' + q(l.g || 0, 0.05) + ':' + q(l.fade === undefined ? 1 : l.fade, 0.05) + ':' + q(l.len, 1)).join(',') : 'fixed';
    const O = (w.objects || []).map((o) => o.cls + q(o.x, 0.25) + ':' + q(o.y, 0.25) + ':' + q(o.alpha === undefined ? 1 : o.alpha, 0.1)).join(',');
    const ld = w.lead ? q(w.lead.x, 0.25) + ':' + q(w.lead.y, 0.25) : '-';
    return L + '/' + O + '/' + ld + '/' + q(camOf(s), 0.05);
}

/* ------------------------------------------------------------------------------------------------ colours */

const NIGHT_MUL = { ink: 0.80, dim: 0.75, faint: 0.80, green: 0.75, amber: 0.80, cyan: 0.78, road: 0.70, panel: 0.6 };

/** The palette of a placement ('map' | 'centre'), as 0..255 triples (mockups.py palette()). */
function colours(placement, night) {
    const p = {
        bg: [0, 0, 0], ink: [236, 239, 243], dim: [150, 156, 165], faint: [58, 62, 68], road: [24, 26, 30],
        green: [76, 176, 40], amber: [240, 170, 10], cyan: [86, 192, 236], panel: [14, 15, 18],
    };
    if (placement === 'centre') { p.bg = [22, 24, 28]; p.road = [36, 39, 44]; p.faint = [70, 74, 82]; p.panel = [30, 33, 38]; }
    if (night) {
        Object.keys(NIGHT_MUL).forEach((k) => { p[k] = p[k].map((c) => Math.round(c * NIGHT_MUL[k])); });
        if (placement === 'centre') { p.bg = [6, 7, 9]; p.road = [18, 19, 22]; p.panel = [13, 14, 17]; }
    }
    // the shaders' colours (0..1): the lane lines are our own steel blue, a fixed symbol (never with any state)
    const m = night ? 0.78 : 1;
    p.line = [0.38 * m, 0.60 * m, 0.92 * m];
    p.ground = [0.13, 0.14, 0.16].map((c) => c * (night ? 0.7 : 1));
    p.body = [0.76, 0.79, 0.83].map((c) => c * (night ? 0.75 : 1));
    p.amberF = [0.94, 0.67, 0.04].map((c) => c * (night ? 0.8 : 1));
    p.gap = [0.90, 0.92, 0.95].map((c) => c * m);
    p.fill = [0.60, 0.63, 0.68].map((c) => c * (night ? 0.75 : 1));      // the road users' neutral grey
    p.ego = [0.93, 0.94, 0.95].map((c) => c * (night ? 0.75 : 1));       // our own car: light (the owner's car is white)
    return p;
}

const mix = (c, a, bg) => [0, 1, 2].map((i) => Math.round(bg[i] + (c[i] - bg[i]) * a));

/* ------------------------------------------------------------------------------------------------ geometry */

const HZ = Wo.HZ;           // the horizon, a share of the lane layer's height
const TFAR = Wo.TFAR;       // the lane's scale at the far end (1 at the foot)
const RANGE = Wo.DEFAULT.range;                                        // m: the far end
const DEPTH = { 1: 0.05, 2: 0.14, 3: 0.27, 4: 0.45, 5: 0.70 };      // the car ahead per level: x = DEPTH x RANGE m ahead of our front
// The view's foot is EGO_X m behind our front bumper: our own car (the scene's anchor, the owner 2026-11-20) stands at the
// foot, the road ahead of it. Every depth z is (x + EGO_X) / RANGE, x measured from our front as the sensors report it.
const EGO_X = 6.5;
const EGO_REAR = 1.0;       // our car's rear: 1 m in front of the view's foot (its box stands on the lane there)

/**
 * map: target px of the map target (1088 x 480); every element inside the core x 334..754, y 44..416 (AA-SPEC 2.1).
 * centre: px of the centre page's content picture (1600 x 482, drawn at y 38 of the kit's 1600 x 520 canvas; the left
 * 800 px are E, the right part the data table). pxm: px per metre across the road at the foot (our lane 3.5 m wide);
 * mw: a marking's drawn width (m).
 */
const GEO = {
    map: {
        lane: [334, 198, 420, 218], pxm: 90 / 1.75, mw: 0.08,
        text: [368, 54, 380, 96], ring: [544, 98, 40], plate: [680, 64, 66, 70], adv: [398, 98], word: 18, fig: 40,
        pill: [374, 150, 340, 44],
    },
    centre: {
        w: 1600, h: 482,
        lane: [50, 206, 700, 276], pxm: 150 / 1.75, mw: 0.08,
        ring: [400, 78, 50], plate: [608, 36, 96, 84], adv: [196, 78], word: 22, fig: 52,
        pill: [150, 150, 500, 50],
        table: [860, 1552], divider: 800,
    },
};

function zOf(x) { return (x + EGO_X) / RANGE; }
function depthOf(level) { return DEPTH[level] ? zOf(DEPTH[level] * RANGE) : 0; }
function tOf(z) { return 1 / (1 + z * (1 / TFAR - 1)); }

/** The car ahead's box (x, y, w, h; floats) standing x m ahead, y m left: a 1.8 m wide body (the acc_car box is 1.7 x its
 *  height, the body 1.4 x). z (depth) given instead of x: the level's place. */
function carRect(g, z, y) {
    const p = Wo.project(g, RANGE, z * RANGE, y || 0);
    const qh = 1.8 * p.k / 1.40, qw = qh * 1.70;
    return [p.px - qw / 2, p.py - 0.955 * qh, qw, qh];
}

/** The same box in whole px for a layer (x, y, w, h integers, w and h at least 8 and 5). */
function carBox(g, z, y) {
    const r = carRect(g, z, y);
    return [Math.round(r[0]), Math.round(r[1]), Math.max(8, Math.round(r[2])), Math.max(5, Math.round(r[3]))];
}

/** Our own car: the acc_car box at the foot, sideways where the ego lane puts us (y = -camOf). */
function egoRect(g, s) { return carRect(g, EGO_REAR / RANGE, -camOf(s)); }
function egoBox(g, s) { return carBox(g, EGO_REAR / RANGE, -camOf(s)); }

/** A clothoid re-expressed about the view's foot (EGO_X behind our front) and the view's sideways place C. */
function shifted(l, C) {
    const E = EGO_X;
    return { y0: l.y0 - l.a * E + 0.5 * l.c * E * E - C, a: l.a - l.c * E, c: l.c, len: l.len + E, type: l.type, prob: l.prob, g: l.g || 0, fade: l.fade === undefined ? 1 : l.fade };
}

const fix = (a) => a.map((x) => Math.round(x * 10000) / 10000);

/** acc_lane's uniforms ({ name: numbers }) for state s with the car ahead at depth z (the glide's, else its level's). */
function laneUniforms(g, s, z, night) {
    const P = colours('map', night);
    const fast = s.clo === 2;
    const lanes = (s.world && s.world.lanes) || Wo.FIXED;
    const C = camOf(s);
    const ln = [], lp = [];
    for (let i = 0; i < 4; i++) {
        const l = lanes.lines[i] ? shifted(lanes.lines[i], C) : null;
        // u_lp.w: 0 measured .. 1 our own guess (lanes.js: thinner, dashed, dimmer, fading with distance; never another colour);
        // the strength fades a line in or out (a boundary confirmed or dropped, a transition)
        if (l) { ln.push(l.y0, l.a, l.c, Wo.TYPE_CODE[l.type] || 0); lp.push(l.len, Math.max(0.35, Math.min(1, l.prob)) * l.fade, g.mw, l.g); }
        else { ln.push(0, 0, 0, 0); lp.push(0, 0, 0, 0); }
    }
    const e0 = Wo.egoOf(lanes), e = shifted({ y0: e0.y0, a: e0.a, c: e0.c, len: 0 }, C);
    e.half = e0.half;
    const lead = leadOf(s);
    return {
        u_size: [g.lane[2], g.lane[3]],
        u_view: fix([HZ, g.pxm, 1 / TFAR - 1, RANGE]),
        u_ln: fix(ln), u_lp: fix(lp),
        u_ego: fix([e.y0, e.a, e.c, e.half]),
        u_line: fix(P.line),
        u_ground: fix(P.ground),
        u_gap: fix([lead ? z : 0, lead ? s.clo : 0, fast ? 0.13 : 0.08, s.warn ? 1 : 0]),
        u_gapc: fix(fast ? P.amberF : P.gap),
    };
}

const CLS_CODE = { car: 1, truck: 2, two: 3, ped: 4, cyc: 5, unk: 6 };
/** The objects' boxes in the lane box's own px (centre x, foot y, w, h) with their class code and fade: up to 16, far first. */
function objectBoxes(g, s) {
    const out = [], C = camOf(s);
    ((s.world && s.world.objects) || []).slice(-16).forEach((o) => {
        const p = Wo.project(g, RANGE, o.x + EGO_X, o.y - C), sz = Wo.SIZE[o.cls] || Wo.SIZE.unk;
        const wm = o.wid || sz[0], hm = sz[1];
        out.push({ cx: p.px - g.lane[0], fy: p.py - g.lane[1], w: wm * p.k, h: hm * p.k, cls: CLS_CODE[o.cls] || 6, alpha: o.alpha === undefined ? 1 : o.alpha, cname: o.cls });
    });
    return out;
}

/** acc_obj's uniforms for state s. */
function objUniforms(g, s, night) {
    const ob = [], oc = [];
    const bx = objectBoxes(g, s);
    for (let i = 0; i < 16; i++) {
        const b = bx[i];
        if (b) { ob.push(b.cx, b.fy, b.w, b.h); oc.push(b.cls, b.alpha, 0, 0); } else { ob.push(0, 0, 0, 0); oc.push(0, 0, 0, 0); }
    }
    const r = (a, k) => a.map((x) => Math.round(x * k) / k);
    return { u_size: [g.lane[2], g.lane[3]], u_ob: r(ob, 10), u_oc: r(oc, 100), u_fill: fix(colours('map', night).fill), u_dim: [s.warn ? 1 : 0, 0] };
}

/** acc_car's uniforms for our own car: the light body (the owner's car is white), dimmed with the rest in the warning. */
function egoUniforms(s, night, w, h) {
    return { u_size: [w, h], u_body: fix(colours('map', night).ego), u_dim: [s.warn ? 1 : 0, 0] };
}

/** The lead's place for the layers: z and the sideways y relative to the view (null: no car ahead). */
function leadPlace(s) {
    const l = leadOf(s);
    return l ? { z: zOf(l.x), y: l.y - camOf(s), cls: l.cls } : null;
}

/** acc_car's uniforms for state s, the layer w x h px. */
function carUniforms(s, night, w, h) {
    const P = colours('map', night);
    const body = s.clo === 2 ? [0, 1, 2].map((i) => 0.35 * P.body[i] + 0.65 * P.amberF[i]) : P.body;
    return { u_size: [w, h], u_body: fix(body), u_dim: [s.warn ? 1 : 0, 0] };
}

/** The status pill (events only, our own wording; mockups.py e_pill). */
function pillOf(s) {
    if (s.warn) return { key: 'pillWarn', kind: 'warn' };
    if (s.data === 'absent') return { key: 'pillNoData', kind: 'info' };
    if (s.data === 'stale') return { key: 'pillStale', kind: 'info' };
    if (s.data === 'none') return { key: 'pillNoTarget', kind: 'info' };
    if (s.clo === 2) return { key: 'pillFast', kind: 'fast' };
    if (s.cru && s.cru[1] === 'standby') return { key: 'pillPaused', kind: 'info' };
    return null;
}

/** The ring: the set speed (green active, grey paused) with our word under it, or a dash with "ВИМК.". */
function ringOf(s) {
    if (!s.cru) return { fig: '–', key: 'ringOff', col: 'faint', wcol: 'dim' };
    const col = s.cru[1] === 'active' ? 'green' : 'dim';
    const key = s.cru[0] === 'limiter' ? 'ringLimiter' : s.cru[1] === 'active' ? 'ringCruise' : 'ringPause';
    return { fig: String(s.cru[2]), key, col, wcol: col };
}

module.exports = {
    STATES, DEMO, stateOf, keyOf, worldKey, withScene, leadOf, leadPlace, camOf, zOf, EGO_X, EGO_REAR, egoRect, egoBox, egoUniforms, shifted, levelOfX, colours, mix, GEO, HZ, TFAR, RANGE, DEPTH, depthOf, tOf, carRect, carBox,
    laneUniforms, objUniforms, objectBoxes, carUniforms, pillOf, ringOf, NIGHT_MUL, CLS_CODE,
};
