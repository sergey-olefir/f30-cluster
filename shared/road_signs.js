'use strict';
/**
 * road_signs.js - our own drawings of the road signs the Road View test shows (round "Road View", package TD), one small vector
 * definition per sign after the GENERIC shapes and colours of the Vienna convention (public road furniture: a red ring, a red
 * triangle, a blue plate ...). No maker's artwork, no font: every figure is built here from circles, boxes, polygons and
 * strokes. Pure: tools/road/bake_signs.js turns them into one RGBA atlas per theme (apps/<id>/hud/scene/rv_signs.json), the
 * mockups and the tests read the same functions.
 *
 *   ORDER                 the atlas order (cell i = ORDER[i]); every id of road_view.SIGNS
 *   DEFS[id]              [op, ...] in a unit square (-1..1, y down); op = [shape, params, colour]
 *   render(id, px, style) -> Buffer RGBA px x px (straight alpha), 4 x 4 samples a pixel
 *   atlas(style, cell)    -> { w, h, cols, cell, cells: { id: [x, y, w, h] }, rgba: Buffer }
 *   STYLES                '6wb' (f30_cluster: printed, a soft top light and a dark keyline) | 'td' (Twin Dial: flat)
 *
 * Colours (sRGB): the signs' own red / blue / yellow / green, the only red any new element of this round uses outside the
 * traffic light's lamp. The figures are deliberately plain: at 44 - 88 px a sign is read by its shape and colour.
 * Plain Node 8. Nothing here throws on a known id; an unknown id renders transparent.
 */

const C = {
    red: [214, 18, 24], white: [246, 246, 244], black: [22, 22, 24], blue: [16, 82, 168], yellow: [250, 196, 20],
    green: [18, 130, 64], grey: [150, 150, 150], dgrey: [96, 96, 96], amber: [244, 160, 16], lgreen: [60, 170, 70],
};

/* ------------------------------------------------------------------ signed distances (unit square, y down) ------------- */

const len = (x, y) => Math.sqrt(x * x + y * y);
function sdCircle(p, a) { return len(p[0] - a[0], p[1] - a[1]) - a[2]; }
function sdRing(p, a) { return Math.abs(len(p[0] - a[0], p[1] - a[1]) - a[2]) - a[3] / 2; }
function sdEllipse(p, a) {          // approximate: scaled circle (good enough for small figures)
    const k = Math.min(a[2], a[3]);
    return (len((p[0] - a[0]) / a[2], (p[1] - a[1]) / a[3]) - 1) * k;
}
function sdBox(p, a) {               // cx, cy, hw, hh, r
    const r = a[4] || 0;
    const qx = Math.abs(p[0] - a[0]) - (a[2] - r), qy = Math.abs(p[1] - a[1]) - (a[3] - r);
    return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdSeg(p, a) {               // ax, ay, bx, by, thickness
    const dx = a[2] - a[0], dy = a[3] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    return len(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) - a[4] / 2;
}
function sdPoly(p, pts) {            // a closed polygon [[x, y] ...]
    let d = Infinity, s = 1;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
        const a = pts[j], b = pts[i];
        const ex = b[0] - a[0], ey = b[1] - a[1], wx = p[0] - a[0], wy = p[1] - a[1];
        const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
        d = Math.min(d, len(wx - ex * t, wy - ey * t));
        const c1 = p[1] >= a[1], c2 = p[1] < b[1], c3 = ex * wy > ey * wx;
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * d;
}
/** A polygon rounded by r (the shape grows by r: give the points r inside). */
function sdPolyR(p, a) { return sdPoly(p, a.pts) - (a.r || 0); }
/** An arc of a ring: centre, radius, thickness, from / to angle (radians, 0 = east, y down so + = clockwise). */
function sdArc(p, a) {
    const ang = Math.atan2(p[1] - a[1], p[0] - a[0]);
    let t = ang;
    while (t < a[4]) t += Math.PI * 2;
    if (t <= a[5]) return Math.abs(len(p[0] - a[0], p[1] - a[1]) - a[2]) - a[3] / 2;
    const e = (q) => len(p[0] - (a[0] + Math.cos(q) * a[2]), p[1] - (a[1] + Math.sin(q) * a[2])) - a[3] / 2;
    return Math.min(e(a[4]), e(a[5]));
}
const SD = { circle: sdCircle, ring: sdRing, ellipse: sdEllipse, box: sdBox, seg: sdSeg, poly: sdPolyR, arc: sdArc };

/* ------------------------------------------------------------------ shared parts ---------------------------------------- */

const TRI = { pts: [[0, -0.80], [0.90, 0.78], [-0.90, 0.78]], r: 0.09 };                 // a warning triangle, point up
const TRI_IN = { pts: [[0, -0.47], [0.58, 0.58], [-0.58, 0.58]], r: 0.03 };
const tri = (fig) => [['poly', TRI, 'red'], ['poly', TRI_IN, 'white']].concat(fig || []);
const disc = (fig, ring) => [['circle', [0, 0, 0.97], ring || 'red'], ['circle', [0, 0, 0.75], 'white']].concat(fig || []);
const plate = (bg, fig, border) => [['box', [0, 0, 0.97, 0.82, 0.12], border || 'white'], ['box', [0, 0, 0.88, 0.73, 0.08], bg]].concat(fig || []);
const square = (bg, fig) => [['box', [0, 0, 0.92, 0.92, 0.14], 'white'], ['box', [0, 0, 0.84, 0.84, 0.10], bg]].concat(fig || []);
/** The end sign's diagonal stripes (lower left to upper right) across a field of half size k. */
function stripes(k, colour, n) {
    const out = [], m = n || 5, pitch = 0.16 * k;
    for (let i = 0; i < m; i++) {
        const o = (i - (m - 1) / 2) * pitch;
        out.push(['seg', [-0.62 * k + o, 0.62 * k + o, 0.62 * k + o, -0.62 * k + o, 0.045 * k], colour]);
    }
    return out;
}
const redBar = [['seg', [-0.80, 0.62, 0.80, -0.62, 0.15], 'red']];
/** A small car seen from behind (no maker's shape): body, glasshouse, wheels. cx, cy = its centre; s = its width. */
function carRear(cx, cy, s, col) {
    return [
        ['box', [cx, cy - s * 0.28, s * 0.32, s * 0.20, s * 0.08], col],
        ['box', [cx, cy + s * 0.05, s * 0.50, s * 0.20, s * 0.08], col],
        ['box', [cx - s * 0.34, cy + s * 0.30, s * 0.11, s * 0.10, s * 0.03], col],
        ['box', [cx + s * 0.34, cy + s * 0.30, s * 0.11, s * 0.10, s * 0.03], col],
    ];
}
/** A walking figure (plain strokes): head, body, arms, legs. */
function walker(cx, cy, s, col, back) {
    const k = back ? -1 : 1;
    return [
        ['circle', [cx + 0.05 * s * k, cy - 0.52 * s, 0.13 * s], col],
        ['seg', [cx + 0.02 * s * k, cy - 0.34 * s, cx - 0.04 * s * k, cy + 0.08 * s, 0.17 * s], col],
        ['seg', [cx - 0.04 * s * k, cy + 0.08 * s, cx + 0.22 * s * k, cy + 0.52 * s, 0.13 * s], col],
        ['seg', [cx - 0.04 * s * k, cy + 0.08 * s, cx - 0.26 * s * k, cy + 0.52 * s, 0.13 * s], col],
        ['seg', [cx + 0.02 * s * k, cy - 0.28 * s, cx + 0.26 * s * k, cy - 0.02 * s, 0.11 * s], col],
        ['seg', [cx + 0.02 * s * k, cy - 0.28 * s, cx - 0.22 * s * k, cy - 0.06 * s, 0.11 * s], col],
    ];
}

/* ------------------------------------------------------------------ the signs ------------------------------------------- */

const DEFS = {
    // tier 1: rules for a stretch
    noOvertaking: disc([].concat(carRear(-0.27, 0.02, 0.52, 'red'), carRear(0.27, 0.02, 0.52, 'black'))),
    noOvertakingEnd: [['circle', [0, 0, 0.97], 'white'], ['ring', [0, 0, 0.93, 0.05], 'grey']].concat(
        carRear(-0.27, 0.02, 0.52, 'grey'), carRear(0.27, 0.02, 0.52, 'grey'), stripes(1.0, 'black', 5)),
    town: plate('white', [
        ['box', [-0.42, 0.18, 0.13, 0.30, 0.01], 'black'], ['box', [-0.12, 0.05, 0.12, 0.43, 0.01], 'black'],
        ['poly', { pts: [[-0.24, -0.38], [-0.12, -0.60], [0.0, -0.38]], r: 0 }, 'black'],
        ['box', [0.18, 0.22, 0.13, 0.26, 0.01], 'black'], ['box', [0.46, 0.12, 0.13, 0.36, 0.01], 'black'],
        ['box', [0, 0.52, 0.72, 0.05, 0.01], 'black']], 'black'),
    townEnd: null,                  // town + the red bar (below)
    motorway: square('blue', [
        ['poly', { pts: [[-0.62, 0.70], [-0.12, -0.12], [-0.03, -0.12], [-0.30, 0.70]], r: 0 }, 'white'],
        ['poly', { pts: [[0.62, 0.70], [0.12, -0.12], [0.03, -0.12], [0.30, 0.70]], r: 0 }, 'white'],
        ['box', [0, -0.30, 0.70, 0.07, 0.02], 'white'], ['box', [0, -0.47, 0.70, 0.04, 0.01], 'white'],
        ['box', [-0.56, -0.40, 0.05, 0.12, 0.01], 'white'], ['box', [0.56, -0.40, 0.05, 0.12, 0.01], 'white']]),
    motorwayEnd: null,
    expressway: square('blue', [
        ['box', [0, -0.12, 0.40, 0.18, 0.10], 'white'], ['box', [0, 0.16, 0.62, 0.22, 0.10], 'white'],
        ['box', [-0.38, 0.44, 0.13, 0.12, 0.04], 'white'], ['box', [0.38, 0.44, 0.13, 0.12, 0.04], 'white'],
        ['box', [0, -0.12, 0.30, 0.10, 0.06], 'blue'], ['circle', [-0.38, 0.14, 0.08], 'blue'], ['circle', [0.38, 0.14, 0.08], 'blue']]),
    expresswayEnd: null,
    envZone: plate('white', [
        ['ring', [0, -0.12, 0.42, 0.13], 'red'],
        ['poly', { pts: [[-0.02, 0.10], [-0.20, -0.08], [-0.14, -0.30], [0.08, -0.36], [0.20, -0.18], [0.12, 0.02]], r: 0.03 }, 'green'],
        ['seg', [-0.06, 0.18, 0.08, -0.22, 0.05], 'white'],
        ['box', [0, 0.56, 0.62, 0.05, 0.01], 'black']], 'black'),
    envZoneEnd: null,
    // tier 2: rules at a point
    stop: [['poly', { pts: oct(0.86), r: 0.08 }, 'white'], ['poly', { pts: oct(0.80), r: 0.04 }, 'red'],
        ['box', [0, 0, 0.52, 0.10, 0.08], 'white']],
    giveWay: [['poly', { pts: [[-0.86, -0.72], [0.86, -0.72], [0, 0.82]], r: 0.09 }, 'red'],
        ['poly', { pts: [[-0.54, -0.50], [0.54, -0.50], [0, 0.44]], r: 0.03 }, 'white']],
    priority: [['poly', { pts: [[0, -0.90], [0.90, 0], [0, 0.90], [-0.90, 0]], r: 0.06 }, 'black'],
        ['poly', { pts: [[0, -0.84], [0.84, 0], [0, 0.84], [-0.84, 0]], r: 0.05 }, 'white'],
        ['poly', { pts: [[0, -0.52], [0.52, 0], [0, 0.52], [-0.52, 0]], r: 0.03 }, 'yellow']],
    priorityEnd: [['poly', { pts: [[0, -0.90], [0.90, 0], [0, 0.90], [-0.90, 0]], r: 0.06 }, 'black'],
        ['poly', { pts: [[0, -0.84], [0.84, 0], [0, 0.84], [-0.84, 0]], r: 0.05 }, 'white'],
        ['poly', { pts: [[0, -0.52], [0.52, 0], [0, 0.52], [-0.52, 0]], r: 0.03 }, 'yellow']].concat(stripes(0.86, 'black', 5)),
    noEntry: [['circle', [0, 0, 0.97], 'white'], ['circle', [0, 0, 0.92], 'red'], ['box', [0, 0, 0.62, 0.15, 0.03], 'white']],
    // tier 3: warnings (a red triangle, a black figure on white)
    crossing: tri([].concat(walker(0.02, 0.06, 0.62, 'black'), [['box', [-0.28, 0.48, 0.06, 0.035, 0], 'black'], ['box', [-0.10, 0.48, 0.06, 0.035, 0], 'black'],
        ['box', [0.08, 0.48, 0.06, 0.035, 0], 'black'], ['box', [0.26, 0.48, 0.06, 0.035, 0], 'black']])),
    children: tri([].concat(walker(-0.15, 0.10, 0.58, 'black'), walker(0.20, 0.22, 0.40, 'black'))),
    roadWorks: tri([].concat(walker(-0.06, 0.10, 0.56, 'black', true), [['seg', [0.12, -0.02, 0.30, 0.42, 0.06], 'black'],
        ['poly', { pts: [[0.22, 0.52], [0.46, 0.52], [0.34, 0.26]], r: 0.01 }, 'black'], ['poly', { pts: [[0.16, 0.54], [0.52, 0.54], [0.40, 0.40], [0.26, 0.42]], r: 0 }, 'black']])),
    lightAhead: tri([['box', [0, 0.10, 0.15, 0.38, 0.06], 'black'], ['circle', [0, -0.15, 0.085], 'red'], ['circle', [0, 0.10, 0.085], 'amber'], ['circle', [0, 0.35, 0.085], 'lgreen']]),
    levelCrossing: tri([['box', [-0.36, 0.26, 0.04, 0.28, 0], 'black'], ['box', [0.36, 0.26, 0.04, 0.28, 0], 'black'],
        ['box', [0, 0.08, 0.40, 0.045, 0], 'black'], ['box', [0, 0.30, 0.40, 0.045, 0], 'black'],
        ['seg', [-0.30, 0.08, -0.12, 0.30, 0.05], 'black'], ['seg', [-0.06, 0.08, 0.12, 0.30, 0.05], 'black'], ['seg', [0.18, 0.08, 0.34, 0.28, 0.05], 'black']]),
    slippery: tri([].concat(carRear(0, -0.02, 0.46, 'black'), [['arc', [-0.20, 0.36, 0.10, 0.05, 0, Math.PI], 'black'], ['arc', [0.0, 0.36, 0.10, 0.05, Math.PI, Math.PI * 2], 'black'],
        ['arc', [0.20, 0.36, 0.10, 0.05, 0, Math.PI], 'black']])),
    animals: tri(shift([['ellipse', [0.0, 0.14, 0.25, 0.11], 'black'], ['seg', [0.20, 0.08, 0.32, -0.10, 0.085], 'black'], ['ellipse', [0.36, -0.14, 0.085, 0.055], 'black'],
        ['seg', [0.33, -0.18, 0.28, -0.30, 0.035], 'black'], ['seg', [0.39, -0.18, 0.44, -0.30, 0.035], 'black'],
        ['seg', [-0.16, 0.20, -0.27, 0.44, 0.055], 'black'], ['seg', [-0.09, 0.20, -0.04, 0.44, 0.055], 'black'],
        ['seg', [0.12, 0.20, 0.09, 0.44, 0.055], 'black'], ['seg', [0.18, 0.20, 0.27, 0.44, 0.055], 'black'], ['seg', [-0.24, 0.10, -0.34, 0.03, 0.045], 'black']], -0.04, 0.08)),
};
/** Ops moved by (dx, dy) (the figures' own coordinates are kept readable above). */
function shift(ops, dx, dy) {
    return ops.map((op) => {
        const a = op[1], t = op[0];
        if (t === 'seg') return [t, [a[0] + dx, a[1] + dy, a[2] + dx, a[3] + dy, a[4]], op[2]];
        if (t === 'poly') return [t, { pts: a.pts.map((q) => [q[0] + dx, q[1] + dy]), r: a.r }, op[2]];
        const b = a.slice(); b[0] += dx; b[1] += dy; return [t, b, op[2]];
    });
}
function oct(r) { const p = []; for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; }
DEFS.townEnd = DEFS.town.concat(redBar);
DEFS.motorwayEnd = DEFS.motorway.concat(redBar);
DEFS.expresswayEnd = DEFS.expressway.concat(redBar);
DEFS.envZoneEnd = DEFS.envZone.map((op) => (op[2] === 'red' || op[2] === 'green' ? [op[0], op[1], 'grey'] : op)).concat(stripes(0.82, 'black', 5));

const ORDER = ['noOvertaking', 'noOvertakingEnd', 'town', 'townEnd', 'motorway', 'motorwayEnd', 'expressway', 'expresswayEnd', 'envZone', 'envZoneEnd',
    'stop', 'giveWay', 'priority', 'priorityEnd', 'noEntry',
    'crossing', 'children', 'roadWorks', 'lightAhead', 'levelCrossing', 'slippery', 'animals'];

/** Which of the signs' colours each sign uses (the tests: red only where the real sign has it). */
function coloursOf(id) { const out = []; (DEFS[id] || []).forEach((op) => { if (out.indexOf(op[2]) < 0) out.push(op[2]); }); return out; }

/* ------------------------------------------------------------------ the rasteriser -------------------------------------- */

const STYLES = {
    // f30_cluster's 6WB: printed signs with a soft top light (+6 % at the top, -8 % at the foot) and a dark keyline outside
    '6wb': { gloss: [0.06, -0.08], keyline: 0.055, keyAlpha: 0.55, margin: 0.035 },
    // Twin Dial: flat, a thin keyline only so a white sign holds its edge on black
    td: { gloss: [0, 0], keyline: 0.035, keyAlpha: 0.45, margin: 0.035 },
};

/** RGBA (straight alpha) px x px of one sign. */
function render(id, px, style) {
    const ops = DEFS[id] || [];
    const S = STYLES[style] || STYLES.td;
    const n = Math.max(1, Math.round(px)), buf = Buffer.alloc(n * n * 4, 0);
    const SS = 4, scale = 2 / (n * (1 - 2 * S.margin));
    const outer = ops.length ? ops[0] : null;           // the sign's outline is its first shape
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const p = [((x + (sx + 0.5) / SS) - n / 2) * scale, ((y + (sy + 0.5) / SS) - n / 2) * scale];
                    let col = null, cov = 0;
                    // the keyline: a dark rim just outside the outline
                    if (outer && S.keyline > 0) {
                        const d = SD[outer[0]](p, outer[1]);
                        if (d >= 0 && d < S.keyline) { col = [0, 0, 0]; cov = S.keyAlpha; }
                    }
                    for (let i = 0; i < ops.length; i++) {
                        const op = ops[i];
                        if (SD[op[0]](p, op[1]) < 0) { col = C[op[2]] || C.black; cov = 1; }
                    }
                    if (!col) continue;
                    let k = 1;
                    if (cov === 1 && (S.gloss[0] || S.gloss[1])) k = 1 + S.gloss[0] + (S.gloss[1] - S.gloss[0]) * Math.max(0, Math.min(1, (p[1] + 1) / 2));
                    r += Math.min(255, col[0] * k) * cov; g += Math.min(255, col[1] * k) * cov; b += Math.min(255, col[2] * k) * cov; a += cov;
                }
            }
            if (a <= 0) continue;
            const o = (y * n + x) * 4;
            buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a); buf[o + 2] = Math.round(b / a); buf[o + 3] = Math.round(a / (SS * SS) * 255);
        }
    }
    return buf;
}

/** One atlas: every sign of ORDER in cells of `cell` px, `cols` a row (the width a multiple of 4). */
function atlas(style, cell, cols) {
    const c = Math.round(cell), k = cols || 8;
    const rows = Math.ceil(ORDER.length / k);
    let w = k * c;
    while (w % 4) w++;
    const h = rows * c, rgba = Buffer.alloc(w * h * 4, 0), cells = {};
    ORDER.forEach((id, i) => {
        const x0 = (i % k) * c, y0 = Math.floor(i / k) * c, px = render(id, c, style);
        for (let y = 0; y < c; y++) px.copy(rgba, ((y0 + y) * w + x0) * 4, y * c * 4, (y + 1) * c * 4);
        cells[id] = [x0, y0, c, c];
    });
    return { w, h, cols: k, cell: c, cells, rgba };
}

/** The cell of `id` in an atlas of `cell` px and `cols` columns (the runtime computes it; the bake writes the same table). */
function cellOf(id, cell, cols) {
    const i = ORDER.indexOf(id), k = cols || 8;
    return i < 0 ? null : [(i % k) * cell, Math.floor(i / k) * cell, cell, cell];
}

module.exports = { C, DEFS, ORDER, STYLES, render, atlas, cellOf, coloursOf, SD };
