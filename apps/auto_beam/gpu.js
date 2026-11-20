'use strict';
/**
 * gpu.js - the centre page as the kit GPU renderer's own commands (round "Auto Beam", package HD; ACC View's gpu.js way). With
 * mgu-render on screen (seen on this car: car_vitals' log of 2026-11-09) the page follows the beam's fold and the lights at
 * up to ~30 frames a second while something moves, none while still: each frame is a recording of shape commands, no pixels.
 *
 *   draw(cv, v, o, ids)   records one frame on the kit's Recorder cv (1600 x 520):
 *                         - the band (sign, advice, reason, lamps) and the table: pixel images (paint.js band / table),
 *                           uploaded by the kit only when they change (main.js keys them)
 *                         - the values that change by the second (speed, brightness): GPU text, never in a large image
 *                         - the road, both cones, the markings: strips (TRIS) and lines sampled in depth (ab_road's look)
 *                         - the lights: circles and rings (ab_lights' look); our car: rounded boxes
 * No QUAD op is used (kit/runtime/renderd.js nativeOps knows it since main cfb50e5, but strips are what ACC View proved).
 * Plain Node 8; nothing here throws on bad input.
 */
const V = require('./view');
const P = require('./paint');

const OY = 520 - P.PAGE_H;               // the content starts under the kit's 38 px strip
const ROWS = 48;
const REC = (() => { try { return require('./kit/record'); } catch (e) { return require('../../kit/runtime/record'); } })();

function tris(cv, vs) {
    const k = Math.floor(vs.length / 3);
    if (!k) return;
    cv._grow(2 + k * 9);
    const u = cv.u, f = cv.f;
    let i = cv.n;
    u[i++] = 10; u[i++] = k;
    for (let j = 0; j < k * 3; j++) { f[i++] = vs[j][0]; f[i++] = vs[j][1]; u[i++] = REC.pack(vs[j][2]); }
    cv.n = i;
}
const quad = (out, a, b, c, d, ca, cb) => { out.push([a[0], a[1], ca], [b[0], b[1], ca], [c[0], c[1], cb], [a[0], a[1], ca], [c[0], c[1], cb], [d[0], d[1], cb]); };
const rgba = (c, a) => [c[0], c[1], c[2], Math.max(0, Math.min(255, Math.round(a * 255)))];

/** The depth rows of the scene box g, foot to far: { t, x (m), y (page px), k (px / m), fade, cx (the box's centre x) }. */
function rowsOf(g) {
    const H = g.scene[3], hy = V.HZ * H, out = [];
    for (let i = 0; i <= ROWS; i++) {
        const t = 1 - (1 - V.TFAR) * Math.pow(i / ROWS, 1.25);
        const z = (1 / t - 1) / V.KF;
        out.push({ t, x: z * V.RANGE - V.EGO_X, y: OY + g.scene[1] + hy + (H - hy) * t, k: g.pxm * t, fade: 1 - V.sstep(0.55, 1, z), cx: g.scene[0] + g.scene[2] / 2 });
    }
    return out;
}

/** The road, its markings and both cones. */
function road(cv, g, v, e, Pc) {
    const rows = rowsOf(g), curve = v.curve || 0;
    const shift = (r) => -0.5 * curve * Math.max(0, r.x) * Math.max(0, r.x) * r.k;     // the road bends away; px to the left is +
    const X = (r, ym, s) => r.cx - ym * r.k + (s ? shift(r) : 0);
    // the surface
    const surf = [];
    for (let i = 0; i < ROWS; i++) {
        const a = rows[i], b = rows[i + 1];
        quad(surf, [X(a, 6.1, 1), a.y], [X(a, -2.6, 1), a.y], [X(b, -2.6, 1), b.y], [X(b, 6.1, 1), b.y], rgba(Pc.road, 0.92 * a.fade), rgba(Pc.road, 0.92 * b.fade));
    }
    tris(cv, surf);
    // the markings: the edges solid, the centre dashed (6 m on, 6 m off)
    [-2.3, 5.8, 1.75].forEach((ym, li) => {
        for (let i = 0; i < ROWS; i++) {
            const a = rows[i], b = rows[i + 1];
            if (li === 2) { const m = (a.x + b.x) / 2 + 3; if (m / 12 - Math.floor(m / 12) >= 0.5) continue; }
            const al = a.fade;
            if (al <= 0.02) continue;
            cv.line(X(a, ym, 1), a.y, X(b, ym, 1), b.y, Math.max(1, 0.12 * (a.k + b.k) / 2), rgba(Pc.edge, al));
        }
    });
    // the cones: an inner strip and a soft edge each side, per row (the car's heading: no curve)
    const cone = (wOf, sOf, inner) => {
        const out = [];
        for (let i = 0; i < ROWS; i++) {
            const a = rows[i], b = rows[i + 1];
            if (a.x < 0.5 && b.x < 0.5) continue;
            const sa = sOf(a) * a.fade, sb = sOf(b) * b.fade;
            if (sa <= 0.004 && sb <= 0.004) continue;
            const wa = wOf(a.x), wb = wOf(b.x), ia = wa * inner, ib = wb * inner;
            const ca = rgba(Pc.beam, sa), cb = rgba(Pc.beam, sb), za = rgba(Pc.beam, 0), zb = rgba(Pc.beam, 0);
            quad(out, [X(a, ia), a.y], [X(a, -ia), a.y], [X(b, -ib), b.y], [X(b, ib), b.y], ca, cb);
            out.push([X(a, wa), a.y, za], [X(a, ia), a.y, ca], [X(b, ib), b.y, cb], [X(a, wa), a.y, za], [X(b, ib), b.y, cb], [X(b, wb), b.y, zb]);
            out.push([X(a, -ia), a.y, ca], [X(a, -wa), a.y, za], [X(b, -wb), b.y, zb], [X(a, -ia), a.y, ca], [X(b, -wb), b.y, zb], [X(b, -ib), b.y, cb]);
        }
        tris(cv, out);
    };
    cone((x) => V.beamAt(x, e).lowW, (r) => V.beamAt(r.x, e).low, 0.6);
    if (e > 0.001) cone((x) => V.beamAt(x, e).highW, (r) => V.beamAt(r.x, e).high, 0.45);
}

/** The lights ahead (far first) and the cause's ring. */
function lights(cv, g, v, Pc) {
    (v.lights || []).slice().sort((a, b) => b.x - a.x).forEach((l) => {
        if (l.x < 0 || l.x > V.RANGE - V.EGO_X) return;
        const q = P.lightPlace(g, l, v.curve || 0), c = Pc[P.KIND_ROLE[l.kind] || 'other'];
        const x0 = g.scene[0] + q.px, y0 = OY + g.scene[1] + q.py;
        (q.hs > 0.8 ? [-q.hs, q.hs] : [0]).forEach((dx) => {
            cv.circle(x0 + dx, y0, q.r * 3, rgba(c, 0.16));
            cv.circle(x0 + dx, y0, q.r, rgba(c, 1));
        });
        if (l.ringed) { const rr = Math.max(q.hs + q.r * 3, q.r * 5, 9); cv.arc(x0, y0, rr - 0.8, rr + 0.8, 0, 360, rgba(Pc.ink, 0.85)); }
    });
}

/** Our car at the foot, from behind. */
function car(cv, g, Pc) {
    const b = P.carBoxes(g), ox = g.scene[0], oy = OY + g.scene[1], k = b.k;
    const rr = (r, rad, c, a) => cv.roundRect(ox + r[0], oy + r[1], r[2], r[3], rad, rgba(c, a === undefined ? 1 : a));
    rr([b.cx - 1.0 * k, b.foot - 0.12 * k, 2.0 * k, 0.18 * k], 0.08 * k, [0, 0, 0], 0.45);
    rr(b.cabin, 0.22 * k, Pc.car);
    rr([b.cabin[0] + 0.1 * k, b.cabin[1] + 0.1 * k, b.cabin[2] - 0.2 * k, b.cabin[3] - 0.16 * k], 0.14 * k, V.mix(Pc.road, 0.5, Pc.car));
    rr(b.body, 0.16 * k, Pc.car);
    rr(b.band, 0.05 * k, V.mix(Pc.carHi, 0.5, Pc.car));
}

/** One frame. ids: { band, table }. o: { night, lang, e, follow, demo }. */
function draw(cv, v, o, ids) {
    const opt = o || {};
    const night = !!opt.night, g = V.GEO.centre, Pc = V.colours('centre', night);
    const e = typeof opt.e === 'number' ? opt.e : V.extentOf(v);
    cv.clear(Pc.bg);
    cv.image(ids.table, g.divider, OY, P.PAGE_W - g.divider, P.PAGE_H);
    cv.image(ids.band, 0, OY, P.BAND_W, P.BAND_H);
    cv.clip(g.scene[0], OY + g.scene[1], g.scene[2], g.scene[3]);
    road(cv, g, v, e, Pc);
    lights(cv, g, v, Pc);
    car(cv, g, Pc);
    if (v.yield) cv.fillRect(g.scene[0], OY + g.scene[1], g.scene[2], g.scene[3], rgba(Pc.bg, 0.65));
    cv.noclip();
    P.dyn(v, opt).forEach((d) => cv.text(d.str, d.x, OY + d.y, d.size, rgba(Pc[d.role], 1), { font: 'label', align: 'right' }));
}

module.exports = { draw, tris, rowsOf, OY };
