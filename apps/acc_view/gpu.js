'use strict';
/**
 * gpu.js - the centre page drawn as the kit GPU renderer's own commands (round 1120 AA2; the owner, 2026-11-20: "на demo
 * refresh rate досить низький"). With mgu-render on screen (the kit's display.active: seen on this car, car_vitals' log of
 * 2026-11-09 "renderd: connected ... mgu-render/1") the page follows motion at up to ~30 frames a second: each frame is a
 * recording of a few hundred shape commands (kit/runtime/record.js), no pixels.
 *
 *   draw(cv, s, o, ids)   records one frame on the kit's Recorder cv (1600 x 520):
 *                         - the band (ring, limit, suggestion, pill) and the table: pixel images (paint.js band / table),
 *                           uploaded by the kit only when they change (o.bandId / o.tableId, registered by main.js)
 *                         - the lanes: the ground, the lit gap, the chevrons and up to 4 boundaries as strips and segments
 *                           (acc_lane's look), sampled in depth
 *                         - the road users: our generic class shapes from rounded boxes and circles (acc_obj's look)
 *                         - the car ahead and our own car: the acc_car shader's sprites, uploaded once (ids.car / carFast /
 *                           ego, day and night)
 *   SPRITES               the sprite names main.js registers per look
 *
 * Without the renderer the kit plays a recording into its software canvas, which draws pixel images opaque: there the
 * app uses paint.js centre() (one image, a few frames a second). Plain Node 8; nothing here throws on bad input.
 */
const M = require('./model');
const P = require('./paint');

const SPRITES = ['car', 'carFast', 'ego'];
const ROWS = 40;                         // depth samples of the lanes
const OY = 520 - P.PAGE_H;               // the page's content starts under the kit's 38 px strip

const REC = (() => { try { return require('./kit/record'); } catch (e) { return require('../../kit/runtime/record'); } })();

/**
 * Triangles with a colour per vertex, written as the recorder's TRIS op ([x, y, colour] x 3 per triangle). Not cv.quad: on
 * mgu-render/1 the kit rewrites each frame's image ops (renderd.js nativeOps) and stops at the first QUAD op it does not
 * know (op 15), so every image drawn after a quad would go out in the wrong layout (found 2026-11-20 in the emulator).
 */
function tris(cv, v) {
    const k = Math.floor(v.length / 3);
    if (!k) return;
    cv._grow(2 + k * 9);
    const u = cv.u, f = cv.f;
    let i = cv.n;
    u[i++] = 10; u[i++] = k;
    for (let j = 0; j < k * 3; j++) { f[i++] = v[j][0]; f[i++] = v[j][1]; u[i++] = REC.pack(v[j][2]); }
    cv.n = i;
}
const quadTris = (out, a, b, c, d, ca, cb) => { out.push([a[0], a[1], ca], [b[0], b[1], ca], [c[0], c[1], cb], [a[0], a[1], ca], [c[0], c[1], cb], [d[0], d[1], cb]); };

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rgba = (c, a) => [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255), Math.max(0, Math.min(255, Math.round(a * 255)))];
const rgb8 = (c, a) => [c[0], c[1], c[2], Math.max(0, Math.min(255, Math.round(a * 255)))];

/** The lanes as strips and segments (acc_lane.glsl's look, in the renderer's own shapes). */
function lanes(cv, g, s, z, P, dim) {
    const U = M.laneUniforms(g, s, z, false);
    const lx = g.lane[0], ly = g.lane[1] + OY, W = g.lane[2], H = g.lane[3];
    const hy = U.u_view[0] * H, pxm = U.u_view[1], kf = U.u_view[2], range = U.u_view[3];
    const ego = U.u_ego, zc = U.u_gap[0], clo = U.u_gap[1], gs = U.u_gap[2];
    const fast = s.clo === 2, gapc = fast ? P.amberF : P.gap, dm = 1 - 0.65 * (dim || 0);
    const sc = (c) => [c[0] * dm, c[1] * dm, c[2] * dm];
    const cx = lx + W / 2, x0 = lx, x1 = lx + W, clampX = (x) => Math.max(x0, Math.min(x1, x));
    // the rows, from the foot (t = 1) to the far end (t = TFAR)
    const rows = [];
    for (let i = 0; i <= ROWS; i++) {
        const t = 1 - (1 - M.TFAR) * Math.pow(i / ROWS, 1.3);
        const zz = (1 / t - 1) / kf;
        rows.push({ t, z: zz, x: zz * range, y: ly + hy + (H - hy) * t, k: pxm * t, fade: 1 - sstep(0.55, 1, zz) });
    }
    const centre = (r) => cx - (ego[0] + r.x * (ego[1] + 0.5 * ego[2] * r.x)) * r.k;
    const strip = (half, colour, alpha, upto) => {
        const v = [];
        for (let i = 0; i < ROWS; i++) {
            const a = rows[i], b = rows[i + 1];
            if (upto !== undefined && a.z >= upto) break;
            const al = alpha(a), bl = alpha(b);
            if (al <= 0.004 && bl <= 0.004) continue;
            const ca = centre(a), cb = centre(b), ha = half * ego[3] * a.k, hb = half * ego[3] * b.k;
            quadTris(v, [clampX(ca - ha), a.y], [clampX(ca + ha), a.y], [clampX(cb + hb), b.y], [clampX(cb - hb), b.y], rgba(sc(colour), al), rgba(sc(colour), bl));
        }
        tris(cv, v);
    };
    // the ground (inner and the soft outer part), the lit gap up to the car ahead
    strip(2.6, P.ground, (r) => (0.30 + 0.70 * Math.max(0, 1 - r.z)) * r.fade);
    strip(4.2, P.ground, (r) => (0.30 + 0.70 * Math.max(0, 1 - r.z)) * r.fade * 0.35);
    if (zc > 0) strip(0.82, gapc, (r) => gs * r.fade, zc);
    // the chevrons while closing
    for (let i = 0; i < 2 && zc > 0; i++) {
        if (!(i + 0.5 < clo)) continue;
        const tc = 1 / (1 + zc * (0.45 + 0.22 * i) * kf), yc = ly + hy + (H - hy) * tc, xm = ((1 / tc - 1) / kf) * range, kc = pxm * tc;
        const cc = cx - (ego[0] + xm * (ego[1] + 0.5 * ego[2] * xm)) * kc, hw = 0.47 * ego[3] * kc, dy = hw * 0.28;
        cv.polyline([[cc - hw, yc + dy], [cc, yc], [cc + hw, yc + dy]], Math.max(2, 2 * (0.1 * pxm * tc * 0.9 + 0.8) * 0.8), rgba(sc(gapc), 1));
    }
    // the boundaries: a soft glow under each, then the marking; dashed 6 m on / 6 m off; double: two
    const edgeCol = P.line.map((c) => c * 0.5 + 0.14);
    for (let li = 0; li < 4; li++) {
        const ty = U.u_ln[li * 4 + 3];
        if (ty < 0.5) continue;
        const y0 = U.u_ln[li * 4], a0 = U.u_ln[li * 4 + 1], c0 = U.u_ln[li * 4 + 2], len = U.u_lp[li * 4], str = U.u_lp[li * 4 + 1], mw = U.u_lp[li * 4 + 2];
        const g = U.u_lp[li * 4 + 3];       // 0 measured .. 1 our own guess (acc_lane's look): thinner, no glow, short dashes, fading
        const lc0 = ty > 3.5 ? edgeCol : P.line;
        const col = sc(g > 0 ? [0, 1, 2].map((j) => lc0[j] + (P.line[j] - lc0[j]) * g) : lc0);
        const offs = ty > 2.5 && ty < 3.5 ? [-1, 1] : [0];
        for (let i = 0; i < ROWS; i++) {
            const a = rows[i], b = rows[i + 1];
            if (a.x >= len) break;
            const m = (a.x + b.x) / 2;
            let dash = ty > 1.5 && ty < 2.5 && m / 12 - Math.floor(m / 12) >= 0.5 ? 0 : 1;
            if (g > 0) dash += ((m / 5 - Math.floor(m / 5) < 0.4 ? 1 : 0) - dash) * g;
            const al = a.fade * str * (1 - sstep(len - 8 - 30 * g, len, a.x)) * dash;
            if (al <= 0.01) continue;
            const pa = cx - (y0 + a.x * (a0 + 0.5 * c0 * a.x)) * a.k, pb = cx - (y0 + b.x * (a0 + 0.5 * c0 * b.x)) * b.k;
            const lw = Math.max(1.2, mw * (a.k + b.k) / 2) * (1 - 0.5 * g);
            offs.forEach((o) => {
                const xa = pa + o * 1.4 * lw * (1 - g), xb = pb + o * 1.4 * lw * (1 - g);
                if (xa < x0 || xa > x1 || xb < x0 || xb > x1) return;
                if (g < 1) cv.line(xa, a.y, xb, b.y, lw * 2.5 + 2, rgba(col, 0.18 * al * (1 - g)));
                cv.line(xa, a.y, xb, b.y, lw, rgba(col, al));
            });
        }
    }
}

/** The road users as our generic class shapes (acc_obj's look), far first. */
function users(cv, g, s, fill, dim) {
    const lx = g.lane[0], ly = g.lane[1] + OY, dm = 1 - 0.65 * (dim || 0);
    const body = fill.map((c) => c * 0.86 * dm), top = fill.map((c) => c * 0.98 * dm), dark = fill.map((c) => c * 0.62 * dm);
    M.objectBoxes(g, s).forEach((b) => {
        if (b.h <= 1.5) return;
        const h = b.h, w = b.w, cx = lx + b.cx, y0 = ly + b.fy - h, a = b.alpha;
        if (cx + w < lx || cx - w > lx + g.lane[2]) return;
        const rr = (qx, qy, hx, hy, r, c) => cv.roundRect(cx + qx - hx, y0 + qy * h - hy, 2 * hx, 2 * hy, r, rgba(c, a));
        const circ = (qy, r, c) => cv.circle(cx, y0 + qy * h, r * h, rgba(c, a));
        cv.roundRect(cx - 0.5 * w - 0.06 * h, y0 + 0.95 * h, w + 0.12 * h, 0.1 * h, 0.05 * h, [0, 0, 0, Math.round(90 * a)]);     // the shadow
        if (b.cls === 1) { rr(0, 0.64, 0.48 * w, 0.27 * h, 0.1 * h, body); rr(0, 0.30, 0.33 * w, 0.17 * h, 0.07 * h, top); rr(0, 0.64, 0.40 * w, 0.03 * h, 0.01 * h, dark); }
        else if (b.cls === 2) { rr(0, 0.52, 0.48 * w, 0.47 * h, 0.04 * h, body); rr(0, 0.96, 0.40 * w, 0.04 * h, 0.02 * h, dark); }
        else if (b.cls === 3) { rr(0, 0.46, 0.12 * h, 0.27 * h, 0.09 * h, body); circ(0.11, 0.09, top); rr(0, 0.85, 0.05 * h, 0.15 * h, 0.04 * h, dark); }
        else if (b.cls === 4 || b.cls === 5) {
            circ(0.08, 0.075, top); rr(0, 0.34, 0.13 * h, 0.19 * h, 0.07 * h, body);
            if (b.cls === 4) { rr(-0.06 * h, 0.76, 0.045 * h, 0.23 * h, 0.04 * h, body); rr(0.06 * h, 0.76, 0.045 * h, 0.23 * h, 0.04 * h, body); }
            else cv.arc(cx, y0 + 0.79 * h, 0.15 * h, 0.21 * h, 0, 360, rgba(dark, a));
        } else {
            const yc = y0 + 0.5 * h, r = 0.42 * h;
            cv.polyline([[cx, yc - r], [cx + r, yc], [cx, yc + r], [cx - r, yc], [cx, yc - r]], Math.max(1.5, 0.07 * h), rgba(top, a));
        }
    });
}

/** One frame of the page on the kit's Recorder. ids: { band, table, sprites: { name: [dayId, nightId] } }. */
function draw(cv, s, o, ids) {
    const opt = o || {};
    const night = !!opt.night;
    const Pc = M.colours('centre', night), g = M.GEO.centre;
    const Pf = Object.assign({}, Pc, { ground: Pc.ground, line: Pc.line, gap: Pc.gap, amberF: Pc.amberF });
    const fill = Pc.fill;
    cv.clear(Pc.bg);
    cv.image(ids.table, g.divider, OY, P.PAGE_W - g.divider, P.PAGE_H);
    cv.image(ids.band, 0, OY, g.divider, P.BAND_H);
    cv.clip(0, OY + P.BAND_H, g.divider, P.PAGE_H - P.BAND_H);
    const lead = M.leadPlace(s);
    const z = typeof opt.z === 'number' ? opt.z : lead ? lead.z : 0;
    lanes(cv, g, s, z, Pf, 0);
    users(cv, g, s, fill, 0);
    const sp = (name, r) => { const id = ids.sprites[name] && ids.sprites[name][night ? 1 : 0]; if (id) cv.image(id, r[0], r[1] + OY, r[2], r[3]); };
    if (lead) sp(s.clo === 2 ? 'carFast' : 'car', M.carRect(g, z, lead.y));
    sp('ego', M.egoRect(g, s));
    if (s.warn) cv.fillRect(0, OY + P.BAND_H, g.divider, P.PAGE_H - P.BAND_H, rgb8(Pc.bg, 0.65));
    cv.noclip();
}

module.exports = { draw, lanes, users, tris, SPRITES, OY };
