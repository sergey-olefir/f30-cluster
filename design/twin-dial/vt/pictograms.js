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

module.exports = { ICONS, DRAWINGS, svg };
