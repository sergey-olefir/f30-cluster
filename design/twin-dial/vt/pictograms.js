'use strict';
/**
 * Twin Dial pictograms (package VT, 2026-11-17). OUR OWN DRAWINGS, made here from primitives after the shapes ISO 2575
 * and UN R121 Table 1 standardise (fuel pump, coolant thermometer over waves, battery with + and -, oil can with a
 * drop, a car in side view with its bonnet or boot raised, a foot on the brake pedal, a spanner) and after common
 * generic UI symbols (a music note, a phone, a navigation arrow, a cog, a radio mast). Nothing here was traced,
 * sampled or measured off any maker's artwork, a photo of it, the references or the car's snapshot. Licence: the
 * repository's MIT licence. See PROVENANCE.md beside this file.
 *
 * Same DSL and same contract as design/strip/pictograms/pictograms.js (package P), whose drawings this set reuses
 * unchanged (cc_warn, cc_warn_solid, cc_info, cc_dot, cc_door, cc_brake, cc_tyre, cc_engine, cc_washer, cc_belt):
 *   ICONS[name](x, y) -> distance to the ink in box units (x, y in 0..1, y down, < 0 inside), so
 *   shared/icons.js paintIcon() draws them unchanged; svg(name) gives the vector.
 * The step evaluator is package P's, exported from design/strip/pictograms/pictograms.js (round 2, package A1).
 *
 *   seg  [ax, ay, bx, by, w]     ring [cx, cy, r, w]     arc [cx, cy, r, a0, a1, w] (deg clockwise from 12)
 *   disc [cx, cy, r]             box [cx, cy, hw, hh, r] boxo [cx, cy, hw, hh, r, w]   poly [[x, y], ...], r
 *   a step with cut: true removes ink (d = max(d, -p)); steps apply in order.
 */
const path = require('path');
const STRIP = require(path.join(__dirname, '..', '..', 'strip', 'pictograms', 'pictograms.js'));

const { stepDist } = STRIP;       // package P's step evaluator, exported since round 2 (the copy that stood here is gone)

const S = (k, a, o) => Object.assign({ k, a }, o || {});
const cut = { cut: true };
const W = 0.07;                                     // the stroke of the set (package P's symbols use 0.07 too)
const path_ = (pts, w) => pts.slice(1).map((p, i) => S('seg', [pts[i][0], pts[i][1], p[0], p[1], w]));
// a wave line: alternating half circles, n humps of radius r starting at x0, on the line y
const wave = (x0, y, r, n, w) => Array.from({ length: n }, (_, i) => S('arc', [x0 + r + 2 * r * i, y, r, i % 2 ? 90 : -90, i % 2 ? 270 : 90, w]));
// a car in side view, front to the right: body, cabin, wheels set in cut arches
const CAR_SIDE = [
    S('boxo', [0.5, 0.6, 0.42, 0.1, 0.04, W]),
    ...path_([[0.27, 0.5], [0.38, 0.31], [0.63, 0.31], [0.77, 0.5]], W),
    S('disc', [0.27, 0.72, 0.125], cut), S('disc', [0.73, 0.72, 0.125], cut),
    S('disc', [0.27, 0.74, 0.08]), S('disc', [0.73, 0.74, 0.08]),
];

const DRAWINGS = {
    // ---- gauges and tabs ----
    // fuel: the pump (ISO 2575 fuel), a window in its head, the hose round to a nozzle on the right
    td_fuel: [
        S('boxo', [0.38, 0.55, 0.19, 0.33, 0.04, W]),
        S('box', [0.38, 0.36, 0.1, 0.07, 0.015]),
        S('seg', [0.1, 0.9, 0.66, 0.9, W]),
        ...path_([[0.57, 0.33], [0.72, 0.33], [0.82, 0.45], [0.82, 0.74], [0.72, 0.74], [0.72, 0.58], [0.6, 0.58]], 0.06),
    ],
    // fuel with the filler side marker (a small triangle pointing to the side the filler is on: here right)
    td_fuel_side: [
        S('boxo', [0.3, 0.55, 0.17, 0.33, 0.04, W]),
        S('box', [0.3, 0.36, 0.09, 0.07, 0.015]),
        S('seg', [0.06, 0.9, 0.54, 0.9, W]),
        ...path_([[0.47, 0.33], [0.6, 0.33], [0.68, 0.43], [0.68, 0.72], [0.6, 0.72], [0.6, 0.58], [0.5, 0.58]], 0.06),
        S('poly', [[0.82, 0.42], [0.96, 0.52], [0.82, 0.62]], { r: 0.01 }),
    ],
    // coolant temperature (ISO 2575): a thermometer with a scale, standing in waves
    cc_coolant: [
        S('seg', [0.46, 0.1, 0.46, 0.56, 0.085]),
        S('disc', [0.46, 0.62, 0.09]),
        S('seg', [0.56, 0.18, 0.7, 0.18, 0.05]), S('seg', [0.56, 0.31, 0.7, 0.31, 0.05]), S('seg', [0.56, 0.44, 0.7, 0.44, 0.05]),
        ...wave(0.1, 0.86, 0.08, 5, 0.06),
    ],
    // battery / charging (ISO 2575): a box with two terminals, minus left, plus right
    cc_battery: [
        S('boxo', [0.5, 0.6, 0.4, 0.25, 0.03, W]),
        S('box', [0.26, 0.29, 0.08, 0.05, 0.01]), S('box', [0.74, 0.29, 0.08, 0.05, 0.01]),
        S('seg', [0.2, 0.58, 0.36, 0.58, 0.06]),
        S('seg', [0.64, 0.58, 0.8, 0.58, 0.06]), S('seg', [0.72, 0.5, 0.72, 0.66, 0.06]),
    ],
    // engine oil (ISO 2575 oil pressure): an oil can with a lid, a handle, the spout and a drop
    cc_oil: [
        S('boxo', [0.42, 0.6, 0.2, 0.12, 0.02, W]),
        S('seg', [0.62, 0.54, 0.86, 0.42, 0.06]),
        S('disc', [0.88, 0.62, 0.045]),
        S('seg', [0.36, 0.48, 0.36, 0.38, 0.06]), S('seg', [0.28, 0.37, 0.44, 0.37, 0.06]),
        S('arc', [0.2, 0.58, 0.07, 180, 360, 0.06]),
    ],
    // bonnet open: the car in side view with the front lid raised from its hinge at the windscreen
    cc_bonnet: [
        ...CAR_SIDE,
        S('seg', [0.8, 0.5, 0.93, 0.5, 0.13], cut),
        S('seg', [0.77, 0.5, 0.95, 0.32, W]),
    ],
    // boot open: the same car, the rear lid raised
    cc_boot: [
        ...CAR_SIDE,
        S('seg', [0.07, 0.5, 0.25, 0.5, 0.13], cut),
        S('seg', [0.27, 0.5, 0.06, 0.34, W]),
    ],
    // ready to drive / press the brake pedal: a foot (leg and sole) over a pedal pad on its arm
    // (a leg and shoe in side view, toe to the right, standing on a pedal pad whose arm runs down)
    cc_pedal: [
        S('poly', [[0.24, 0.06], [0.42, 0.06], [0.46, 0.4], [0.8, 0.47], [0.86, 0.55], [0.84, 0.6], [0.2, 0.6]], { r: 0.02 }),
        S('seg', [0.22, 0.71, 0.8, 0.71, 0.09]),
        S('seg', [0.5, 0.71, 0.5, 0.95, W]),
    ],
    // service due: a spanner, ring end top right with its jaw open, handle down left
    cc_service: [
        S('seg', [0.2, 0.8, 0.58, 0.42, 0.12]),
        S('ring', [0.66, 0.34, 0.13, 0.1]),
        S('seg', [0.66, 0.34, 0.9, 0.1, 0.12], cut),
        S('disc', [0.2, 0.8, 0.08]),
    ],
    // media: two beamed notes
    td_media: [
        S('seg', [0.37, 0.27, 0.37, 0.73, 0.06]), S('seg', [0.75, 0.19, 0.75, 0.65, 0.06]),
        S('poly', [[0.34, 0.2], [0.78, 0.1], [0.78, 0.22], [0.34, 0.32]], { r: 0.005 }),
        S('disc', [0.28, 0.75, 0.1]), S('disc', [0.66, 0.67, 0.1]),
    ],
    // radio: a mast with waves either side
    td_radio: [
        S('disc', [0.5, 0.4, 0.065]),
        S('seg', [0.5, 0.48, 0.5, 0.9, W]),
        S('arc', [0.5, 0.4, 0.17, 220, 320, 0.06]), S('arc', [0.5, 0.4, 0.17, 40, 140, 0.06]),
        S('arc', [0.5, 0.4, 0.31, 225, 315, 0.06]), S('arc', [0.5, 0.4, 0.31, 45, 135, 0.06]),
    ],
    // phone: a handset seen from the front, speaker slot and button
    td_phone: [
        S('boxo', [0.5, 0.5, 0.22, 0.4, 0.06, W]),
        S('seg', [0.44, 0.2, 0.56, 0.2, 0.045]),
        S('disc', [0.5, 0.8, 0.04]),
    ],
    // navigation: an outlined arrowhead pointing ahead
    td_nav: [
        ...path_([[0.5, 0.08], [0.85, 0.9], [0.5, 0.72], [0.15, 0.9], [0.5, 0.08]], W),
    ],
    // settings: a cog with eight teeth
    td_settings: [
        S('ring', [0.5, 0.5, 0.24, 0.11]),
        ...Array.from({ length: 8 }, (_, i) => {
            const a = i * Math.PI / 4;
            return S('seg', [0.5 + 0.3 * Math.sin(a), 0.5 - 0.3 * Math.cos(a), 0.5 + 0.41 * Math.sin(a), 0.5 - 0.41 * Math.cos(a), 0.12]);
        }),
    ],
    // the average sign of the trip computer ("ø" before a mean value): a ring crossed by a slash
    td_avg: [
        S('ring', [0.5, 0.52, 0.27, W]),
        S('seg', [0.22, 0.86, 0.78, 0.18, W]),
    ],
};

// ===== Round 3 (package B6, 2026-11-18): K2's drawings of the mockups, the symbols of cruise, the limit sign's stripes and the
// guidance set. K2's 24 (tools/twin-dial/mockup/pictos_r3.py on twin-r3/k2) moved here as they were drawn, but for two names:
// td_phone_none is td_phone_off (SPEC-R3 3.3), and td_cruise is redrawn (see below). Everything is our own drawing, MIT.
const RAD = Math.PI / 180;
/** The same drawing mirrored left-right (x -> 1 - x; an arc's angles -> their negatives, swapped). */
function mirror(steps) {
    return steps.map((st) => {
        const a = st.a.slice();
        if (st.k === 'seg') { a[0] = 1 - a[0]; a[2] = 1 - a[2]; }
        else if (st.k === 'ring' || st.k === 'disc' || st.k === 'box' || st.k === 'boxo') a[0] = 1 - a[0];
        else if (st.k === 'arc') { a[0] = 1 - a[0]; const t = a[3]; a[3] = -a[4]; a[4] = -t; }
        else if (st.k === 'poly') return Object.assign({}, st, { a: st.a.map((p) => [1 - p[0], p[1]]) });
        return Object.assign({}, st, { a });
    });
}
/**
 * A route drawn with a turtle (heading phi in degrees clockwise from up, y down): commands ['f', length] and
 * ['t', radius, turn] (turn > 0 to the right); a stroke of width w, and, with head = [length, width], an arrowhead
 * at the end. Returns the steps.
 */
function route(x, y, phi, cmds, w, head) {
    const out = [];
    for (const c of cmds) {
        if (c[0] === 'f') {
            const nx = x + Math.sin(phi * RAD) * c[1], ny = y - Math.cos(phi * RAD) * c[1];
            out.push(S('seg', [x, y, nx, ny, w])); x = nx; y = ny;
        } else {
            const r = c[1], d = c[2], sg = d > 0 ? 1 : -1;
            const cx = x + Math.cos(phi * RAD) * sg * r, cy = y + Math.sin(phi * RAD) * sg * r;
            const a0 = phi - 90 * sg, a1 = a0 + d;
            out.push(S('arc', [cx, cy, r, Math.min(a0, a1), Math.max(a0, a1), w]));
            x = cx + r * Math.sin(a1 * RAD); y = cy - r * Math.cos(a1 * RAD); phi += d;
        }
    }
    if (head) {
        const hx = Math.sin(phi * RAD), hy = -Math.cos(phi * RAD), nx = Math.cos(phi * RAD), ny = Math.sin(phi * RAD);
        out.push(S('poly', [[x - nx * head[1] / 2, y - ny * head[1] / 2], [x + hx * head[0], y + hy * head[0]], [x + nx * head[1] / 2, y + ny * head[1] / 2]], { r: 0.01 }));
    }
    return out;
}
/**
 * Centres a drawing in the box (and, when it is bigger than the box less its margin, scales it down; every width and radius
 * with it). Measured on the drawing's own distance field, so a stroke's width counts. Design time only: the result is data.
 * opts: v (also centre vertically; default true), margin (default 0.04), scale (let it grow to the margin; default false).
 */
function fit(steps, opts) {
    const o = Object.assign({ v: true, margin: 0.04, scale: false }, opts || {});
    let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
    const f = (x, y) => { let d = Infinity; for (const s of steps) { const p = stepDist(s, x, y); d = s.cut ? Math.max(d, -p) : Math.min(d, p); } return d; };
    const N = 240;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = -0.4 + 1.8 * (i + 0.5) / N, y = -0.4 + 1.8 * (j + 0.5) / N;
        if (f(x, y) < 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    const room = 1 - 2 * o.margin;
    let k = Math.min(1, room / Math.max(x1 - x0, y1 - y0));
    if (o.scale) k = room / Math.max(x1 - x0, y1 - y0);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const X = (x) => +((x - mx) * k + 0.5).toFixed(4), Y = (y) => +((o.v ? (y - my) * k + 0.5 : (y - 0.5) * k + 0.5)).toFixed(4);
    const L = (v) => +(v * k).toFixed(4);
    return steps.map((st) => {
        const a = st.a;
        let b;
        switch (st.k) {
            case 'seg': b = [X(a[0]), Y(a[1]), X(a[2]), Y(a[3]), L(a[4])]; break;
            case 'ring': b = [X(a[0]), Y(a[1]), L(a[2]), L(a[3])]; break;
            case 'arc': b = [X(a[0]), Y(a[1]), L(a[2]), +a[3].toFixed(3), +a[4].toFixed(3), L(a[5])]; break;
            case 'disc': b = [X(a[0]), Y(a[1]), L(a[2])]; break;
            case 'box': b = [X(a[0]), Y(a[1]), L(a[2]), L(a[3]), L(a[4])]; break;
            case 'boxo': b = [X(a[0]), Y(a[1]), L(a[2]), L(a[3]), L(a[4]), L(a[5])]; break;
            case 'poly': b = a.map((p) => [X(p[0]), Y(p[1])]); break;
            default: throw new Error('fit: ' + st.k);
        }
        const n = Object.assign({}, st, { a: b });
        if (st.r) n.r = L(st.r);
        return n;
    });
}
const BOLD = 0.15, MID = 0.12, THIN = 0.06, HEAD = [0.3, 0.46];       // a manoeuvre's own stroke, the roads round it, an arrowhead
const flip = (steps) => mirror(steps);

// roundabouts: a ring, the way in from below, the way out at a fixed angle per exit number (clockwise from straight
// ahead; right-hand traffic goes round counter-clockwise, so the first exit is the right-hand one). A hypothesis: the
// angles are ours, a drawing convention; the exitAngle the car may give (unit unconfirmed) overrides them on the page
// that has it (probe P12). The number of the exit is drawn by the page inside the ring (a clear disc of 0.17 of the box).
const RB_EXIT = [96, 52, 8, -38, -84, -132];
function roundabout(n, left) {
    const cx = 0.5, cy = 0.55, r = 0.24, a = RB_EXIT[n - 1];
    const ex = cx + Math.sin(a * RAD) * r, ey = cy - Math.cos(a * RAD) * r;
    const steps = fit([S('ring', [cx, cy, r, 0.075]), S('seg', [0.5, 0.96, 0.5, cy + r, 0.075])].concat(route(ex, ey, a, [['f', 0.15]], 0.1, [0.24, 0.38])), { v: true, margin: 0.03 });
    return left ? mirror(steps) : steps;
}
// a flag standing at the end of the way: on the left, ahead, or on the right (the road bends to it)
function flagAt(px) {
    return fit([S('seg', [px, 0.1, px, 0.6, 0.07]), S('poly', [[px + 0.02, 0.1], [px + 0.4, 0.23], [px + 0.02, 0.36]], { r: 0.01 }),
        S('seg', [0.5, 0.92, 0.5, 0.82, 0.1]), S('seg', [0.5, 0.82, px, 0.62, 0.1])], { v: true, margin: 0.04 });
}

const ROUND3 = {
    // ---- K2's drawings of the round-3 mockups (tab and page symbols) ----
    td_car: [S('boxo', [0.5, 0.5, 0.21, 0.43, 0.13, 0.065]), S('seg', [0.33, 0.33, 0.67, 0.33, 0.06]), S('seg', [0.36, 0.74, 0.64, 0.74, 0.06]), S('seg', [0.29, 0.38, 0.2, 0.41, 0.05]), S('seg', [0.71, 0.38, 0.8, 0.41, 0.05])],
    td_engine: [S('boxo', [0.5, 0.58, 0.27, 0.2, 0.03, 0.065]), S('seg', [0.36, 0.3, 0.64, 0.3, 0.065]), S('seg', [0.5, 0.3, 0.5, 0.38, 0.065]), S('seg', [0.13, 0.48, 0.13, 0.68, 0.065]), S('seg', [0.13, 0.58, 0.23, 0.58, 0.065]), S('seg', [0.77, 0.52, 0.89, 0.45, 0.065]), S('seg', [0.89, 0.45, 0.89, 0.72, 0.065]), S('seg', [0.89, 0.72, 0.77, 0.65, 0.065])],
    td_gauge: [S('arc', [0.5, 0.58, 0.36, -125, 125, 0.07]), S('seg', [0.5, 0.58, 0.7, 0.36, 0.07]), S('disc', [0.5, 0.58, 0.07])],
    td_clock: [S('ring', [0.5, 0.5, 0.38, 0.07]), S('seg', [0.5, 0.5, 0.5, 0.26, 0.07]), S('seg', [0.5, 0.5, 0.68, 0.6, 0.07])],
    td_road: [S('seg', [0.28, 0.92, 0.42, 0.1, 0.07]), S('seg', [0.72, 0.92, 0.58, 0.1, 0.07]), S('seg', [0.5, 0.82, 0.5, 0.66, 0.05]), S('seg', [0.5, 0.5, 0.5, 0.38, 0.05]), S('seg', [0.5, 0.24, 0.5, 0.17, 0.045])],
    td_rain: [S('disc', [0.25, 0.66, 0.1]), S('poly', [[0.155, 0.63], [0.25, 0.38], [0.345, 0.63]]), S('disc', [0.5, 0.5, 0.1]), S('poly', [[0.405, 0.47], [0.5, 0.22], [0.595, 0.47]]), S('disc', [0.75, 0.66, 0.1]), S('poly', [[0.655, 0.63], [0.75, 0.38], [0.845, 0.63]])],
    td_play: [S('poly', [[0.3, 0.18], [0.82, 0.5], [0.3, 0.82]], { r: 0.02 })],
    td_pause: [S('box', [0.35, 0.5, 0.08, 0.32, 0.01]), S('box', [0.65, 0.5, 0.08, 0.32, 0.01])],
    td_mute: [S('poly', [[0.12, 0.38], [0.3, 0.38], [0.52, 0.16], [0.52, 0.84], [0.3, 0.62], [0.12, 0.62]], { r: 0.02 }), S('seg', [0.66, 0.36, 0.9, 0.64, 0.07]), S('seg', [0.66, 0.64, 0.9, 0.36, 0.07])],
    td_handset: [S('arc', [0.5, 0.86, 0.42, -62, 62, 0.11]), S('box', [0.16, 0.66, 0.11, 0.08, 0.04]), S('box', [0.84, 0.66, 0.11, 0.08, 0.04])],
    td_phone_ring: [S('boxo', [0.5, 0.55, 0.17, 0.32, 0.05, 0.065]), S('seg', [0.45, 0.3, 0.55, 0.3, 0.04]), S('arc', [0.5, 0.55, 0.31, 35, 75, 0.05]), S('arc', [0.5, 0.55, 0.42, 30, 80, 0.05]), S('arc', [0.5, 0.55, 0.31, 285, 325, 0.05]), S('arc', [0.5, 0.55, 0.42, 280, 330, 0.05])],
    td_mic_off: [S('boxo', [0.5, 0.36, 0.12, 0.22, 0.12, 0.065]), S('arc', [0.5, 0.42, 0.25, 95, 265, 0.065]), S('seg', [0.5, 0.67, 0.5, 0.86, 0.065]), S('seg', [0.36, 0.87, 0.64, 0.87, 0.065]), S('seg', [0.16, 0.1, 0.84, 0.9, 0.17], cut), S('seg', [0.16, 0.1, 0.84, 0.9, 0.07])],
    td_bars: [S('box', [0.17, 0.78, 0.07, 0.1, 0.01]), S('box', [0.39, 0.66, 0.07, 0.22, 0.01]), S('box', [0.61, 0.54, 0.07, 0.34, 0.01]), S('box', [0.83, 0.42, 0.07, 0.46, 0.01])],
    // the tab bar's phone: a handset with signal bars when a phone is connected, crossed out when there is none (no dimmed icon: SPEC-R3 3.1)
    td_phone_bars: [S('boxo', [0.32, 0.5, 0.18, 0.38, 0.05, 0.065]), S('seg', [0.27, 0.21, 0.37, 0.21, 0.045]), S('box', [0.66, 0.79, 0.04, 0.07, 0.01]), S('box', [0.77, 0.7, 0.04, 0.16, 0.01]), S('box', [0.88, 0.6, 0.04, 0.26, 0.01])],
    td_phone_off: [S('boxo', [0.5, 0.5, 0.22, 0.4, 0.06, 0.07]), S('seg', [0.44, 0.2, 0.56, 0.2, 0.045]), S('seg', [0.18, 0.92, 0.82, 0.08, 0.18], cut), S('seg', [0.18, 0.92, 0.82, 0.08, 0.065])],
    td_flag: [S('seg', [0.25, 0.1, 0.25, 0.92, 0.07]), S('poly', [[0.27, 0.1], [0.82, 0.25], [0.27, 0.42]], { r: 0.01 })],
    td_compass: [S('ring', [0.5, 0.5, 0.4, 0.06]), S('poly', [[0.5, 0.18], [0.62, 0.52], [0.38, 0.52]])],
    td_limit: [S('ring', [0.5, 0.5, 0.38, 0.12])],
    td_check: [S('seg', [0.18, 0.52, 0.42, 0.76, 0.09]), S('seg', [0.42, 0.76, 0.84, 0.26, 0.09])],
    td_dot: [S('disc', [0.5, 0.5, 0.3])],
    // ---- new in round 3 ----
    // projection (the tab 3 icon while the media comes from the phone over the projection): a display on its foot with the
    // broadcast waves of "cast" in its lower left corner. Generic: not the logo of any projection system.
    td_proj: [S('boxo', [0.5, 0.42, 0.43, 0.29, 0.06, 0.065]), S('seg', [0.5, 0.71, 0.5, 0.85, 0.065]), S('seg', [0.3, 0.88, 0.7, 0.88, 0.065]),
        S('disc', [0.2, 0.6, 0.04]), S('arc', [0.2, 0.6, 0.14, 0, 90, 0.06]), S('arc', [0.2, 0.6, 0.25, 0, 90, 0.06])],
    // cruise control: a speedometer (an open arc, a needle) whose needle ends in an arrowhead (SPEC-R3 9)
    td_cruise: [S('arc', [0.5, 0.56, 0.38, -125, 125, 0.07]), S('seg', [0.5, 0.56, 0.64, 0.4, 0.075]), S('poly', [[0.58, 0.28], [0.8, 0.26], [0.74, 0.5]], { r: 0.01 }), S('disc', [0.5, 0.56, 0.075])],
    // adaptive cruise control: the same, smaller, over the car ahead seen from behind with its distance bar
    td_cruise_acc: [S('arc', [0.5, 0.29, 0.25, -125, 125, 0.065]), S('seg', [0.5, 0.29, 0.58, 0.19, 0.07]), S('poly', [[0.53, 0.1], [0.7, 0.09], [0.66, 0.26]], { r: 0.01 }), S('disc', [0.5, 0.29, 0.055]),
        S('seg', [0.1, 0.56, 0.9, 0.56, 0.05]),
        S('seg', [0.31, 0.78, 0.38, 0.67, 0.06]), S('seg', [0.38, 0.67, 0.62, 0.67, 0.06]), S('seg', [0.62, 0.67, 0.69, 0.78, 0.06]),
        S('boxo', [0.5, 0.82, 0.27, 0.075, 0.035, 0.06]), S('seg', [0.31, 0.92, 0.31, 0.93, 0.08]), S('seg', [0.69, 0.92, 0.69, 0.93, 0.08])],
    // the speed limiter: the letters LIM in a frame
    td_limiter: [S('boxo', [0.5, 0.5, 0.46, 0.3, 0.08, 0.065]),
        S('seg', [0.17, 0.36, 0.17, 0.64, 0.07]), S('seg', [0.17, 0.64, 0.3, 0.64, 0.07]),
        S('seg', [0.45, 0.36, 0.45, 0.64, 0.07]),
        S('seg', [0.6, 0.64, 0.6, 0.36, 0.07]), S('seg', [0.6, 0.36, 0.7, 0.52, 0.07]), S('seg', [0.7, 0.52, 0.8, 0.36, 0.07]), S('seg', [0.8, 0.36, 0.8, 0.64, 0.07])],
    // the end-of-restrictions sign: five diagonal stripes clipped to the disc of the box (the page paints the ring, the white
    // disc and these stripes dark over it; the box is the disc's own, 0.5 radius)
    td_end_stripes: [...[-0.34, -0.17, 0, 0.17, 0.34].map((t) => S('seg', [0.5 + t * 0.7071 - 0.8 * 0.7071, 0.5 + t * 0.7071 + 0.8 * 0.7071, 0.5 + t * 0.7071 + 0.8 * 0.7071, 0.5 + t * 0.7071 - 0.8 * 0.7071, 0.09])),
        S('ring', [0.5, 0.5, 1.0, 1.0], cut)],
    // ---- guidance: the manoeuvres (120 px on the page, 30 px in the lane row) ----
    td_straight: [S('seg', [0.5, 0.95, 0.5, 0.4, 0.15]), S('poly', [[0.5, 0.05], [0.78, 0.42], [0.22, 0.42]], { r: 0.01 })],
    td_turn_right: [S('seg', [0.34, 0.95, 0.34, 0.52, 0.15]), S('arc', [0.6, 0.52, 0.26, 270, 360, 0.15]), S('seg', [0.6, 0.26, 0.66, 0.26, 0.15]), S('poly', [[0.62, 0.04], [0.95, 0.26], [0.62, 0.48]], { r: 0.01 })],
    td_turn_slight_right: fit(route(0.3, 0.95, 0, [['f', 0.3], ['t', 0.34, 45], ['f', 0.1]], BOLD, HEAD), { v: false }),
    td_turn_hard_right: fit(route(0.34, 0.95, 0, [['f', 0.32], ['t', 0.17, 130], ['f', 0.06]], BOLD, [0.3, 0.46]), { v: false }),
    td_uturn_right: fit(route(0.3, 0.95, 0, [['f', 0.5], ['t', 0.2, 180], ['f', 0.12]], BOLD, HEAD), { v: false }),
    // forks and exits: the road is thin, the way to take is bold and has the head
    td_fork_right: fit(route(0.5, 0.97, 0, [['f', 0.35]], MID).concat(route(0.5, 0.62, 0, [['t', 0.3, -40], ['f', 0.12]], THIN), route(0.5, 0.62, 0, [['t', 0.3, 40], ['f', 0.12]], MID, [0.26, 0.4])), { v: false }),
    td_fork_straight: fit(route(0.5, 0.97, 0, [['f', 0.35]], MID).concat(route(0.5, 0.64, 0, [['t', 0.36, -50], ['f', 0.15]], THIN), route(0.5, 0.64, 0, [['t', 0.36, 50], ['f', 0.15]], THIN), route(0.5, 0.64, 0, [['f', 0.3]], MID, [0.24, 0.3])), { v: false }),
    td_exit_right: fit(route(0.3, 0.97, 0, [['f', 0.62]], THIN).concat(route(0.3, 0.97, 0, [['f', 0.3], ['t', 0.4, 38], ['f', 0.05]], MID, [0.26, 0.4])), { v: false }),
    td_merge_right: fit(route(0.36, 0.97, 0, [['f', 0.6]], MID, [0.26, 0.4]).concat(route(0.9, 0.97, 0, [['f', 0.1], ['t', 0.42, -38], ['f', 0.04]], THIN)), { v: false }),
    td_flag_centre: flagAt(0.33),
    td_flag_right: flagAt(0.5),
    td_flag_left: flagAt(0.14),
    td_lane_change_right: fit(route(0.3, 0.95, 0, [['f', 0.2], ['t', 0.3, 30], ['t', 0.3, -30], ['f', 0.12]], BOLD, HEAD), { v: false }),
};
for (let n = 1; n <= 6; n++) { ROUND3['td_rb' + n + '_r'] = roundabout(n, false); ROUND3['td_rb' + n + '_l'] = roundabout(n, true); }
for (const k of ['turn_right', 'turn_slight_right', 'turn_hard_right', 'uturn_right', 'fork_right', 'exit_right', 'merge_right', 'lane_change_right']) ROUND3['td_' + k.replace('_right', '_left').replace(/^td_/, '')] = mirror(ROUND3['td_' + k]);
Object.assign(DRAWINGS, ROUND3);

// the strip set, reused unchanged
for (const n of Object.keys(STRIP.DRAWINGS)) if (!DRAWINGS[n]) DRAWINGS[n] = STRIP.DRAWINGS[n];

function sdf(steps) {
    return (x, y) => {
        let d = Infinity;
        for (const s of steps) {
            const p = stepDist(s, x, y);
            d = s.cut ? Math.max(d, -p) : Math.min(d, p);
        }
        return d;
    };
}
const ICONS = {};
for (const n of Object.keys(DRAWINGS)) ICONS[n] = sdf(DRAWINGS[n]);

/** svg: package P's writer, fed our drawings (it reads its own DRAWINGS object, so ours are lent to it). */
function svg(name, note) {
    const had = STRIP.DRAWINGS[name];
    STRIP.DRAWINGS[name] = DRAWINGS[name];
    try { return STRIP.svg(name, note).replace('package P, f30-cluster, 2026-11-16', 'package P / VT, f30-cluster').replace('tools/strip/P/bake_pictograms.js from\n     design/strip/pictograms/pictograms.js', 'tools/twin-dial/vt/bake_pictograms.js from\n     design/twin-dial/vt/pictograms.js'); }
    finally { if (had) STRIP.DRAWINGS[name] = had; else delete STRIP.DRAWINGS[name]; }
}

module.exports = { ICONS, DRAWINGS, svg, mirror, route };
