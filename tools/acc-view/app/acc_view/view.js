'use strict';
/**
 * view.js - ACC View's model and painter (round 1120, package AA; docs/r1120/AA-SPEC.md). Pure: no signals, no socket, no clock of
 * its own. Plain Node 8 (the car's 8.16.2): no ?. / ?? / object spread. Nothing here throws.
 *
 *   stateOf(fv, cru, warn)   the front-vehicle tracker's view (shared/front_vehicle.js), the cruise reading (shared/limit_src.js
 *                            hudCruiseOf) and the car's own warning flag -> the picture's state
 *                            { tgt 1..5 | null, clo 0..2, data 'ok' | 'none' | 'stale' | 'absent', cru null | [kind, status, kmh],
 *                              warn, adv null }   (adv: the outer loop's suggested set speed; no loop yet, always null)
 *   DEMO                     the mockup park's 14 states (tools/acc-view/mockups.py STATES), for the demo setting and the tests
 *   paint(state, night)      -> a straight RGBA Buffer of W x H: the skeleton's picture (direction B, "the ladder", without words:
 *                            the words come with the owner's choice of direction and a glyph atlas; the mockups show them)
 *   diffRect(a, b, w, h)     the one rectangle that changed between two frames, or null
 *   W, H, AT                 the layer's size and its place on the map target (the core every theme window shows: AA-SPEC 2.1)
 *
 * Colours: no red anywhere; amber only for "closing fast"; green only for an active cruise / limiter; cyan only for a suggestion.
 */

const W = 420, H = 372;                 // a multiple of 4 wide (the car shears R8 textures that are not; RGBA is safe either way)
const AT = { x: 334, y: 44 };           // in the map target (1088 x 480): the core inside Twin Dial's W2 and f30's window

const DAY = {
    bg: [0, 0, 0], ink: [236, 239, 243], dim: [150, 156, 165], faint: [58, 62, 68],
    green: [76, 176, 40], amber: [240, 170, 10], cyan: [86, 192, 236],
};
const NIGHT_MUL = { ink: 0.80, dim: 0.75, faint: 0.80, green: 0.75, amber: 0.80, cyan: 0.78 };   // Twin Dial's night roles

function palette(night) {
    const p = {};
    Object.keys(DAY).forEach((k) => {
        const m = night && NIGHT_MUL[k] ? NIGHT_MUL[k] : 1;
        p[k] = DAY[k].map((c) => Math.round(c * m));
    });
    return p;
}

const mix = (c, a, bg) => [0, 1, 2].map((i) => Math.round(bg[i] + (c[i] - bg[i]) * a));

/* ------------------------------------------------------------------------------------------------ the state */

/**
 * fv: { state, level, closing } of front_vehicle.create().view(); cru: { kind, status, kmh } of hudCruiseOf (kind null = off);
 * warn: true while the car's own collision warning is requested (only when config.warn says how to read it; else false).
 */
function stateOf(fv, cru, warn) {
    const v = fv || {};
    let data = 'none', tgt = null, clo = 0;
    if (v.state === 'absent') data = 'absent';
    else if (v.stale) data = 'stale';
    else if (v.present && v.level >= 1 && v.level <= 5) { data = 'ok'; tgt = v.level; clo = v.closing === 2 ? 2 : v.closing === 1 ? 1 : 0; }
    let c = null;
    if (cru && cru.kind && cru.status !== 'off' && typeof cru.kmh === 'number') {
        c = [cru.kind === 'limiter' ? 'limiter' : 'cruise', cru.status === 'active' ? 'active' : 'standby', Math.round(cru.shown || cru.kmh)];
    }
    return { tgt, clo, data, cru: c, warn: !!warn, adv: null };
}

const S = (tgt, clo, data, cru, warn, adv) => ({ tgt: data === 'ok' ? tgt : null, clo, data, cru, warn: !!warn, adv: adv || null });
const C90 = ['cruise', 'active', 90];
const DEMO = [
    ['01', 'absent', S(null, 0, 'absent', C90)],
    ['02', 'none', S(null, 0, 'none', C90)],
    ['03', 'far', S(5, 0, 'ok', C90)],
    ['04', 'middle', S(3, 0, 'ok', C90)],
    ['05', 'near', S(1, 0, 'ok', C90)],
    ['06', 'closing', S(3, 1, 'ok', C90)],
    ['07', 'fast', S(2, 2, 'ok', C90)],
    ['08', 'cruise-off', S(3, 0, 'ok', null)],
    ['09', 'standby', S(3, 0, 'ok', ['cruise', 'standby', 90])],
    ['10', 'active', S(4, 0, 'ok', ['cruise', 'active', 110])],
    ['11', 'limiter', S(3, 0, 'ok', ['limiter', 'active', 110])],
    ['12', 'stale', S(null, 0, 'stale', C90)],
    ['13', 'warn', S(1, 2, 'ok', C90, true)],
    ['14', 'advice', S(2, 1, 'ok', ['cruise', 'active', 110], false, 96)],
];

/* ------------------------------------------------------------------------------------------------ the painter */

function Canvas(w, h, bg) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) { this.px[i * 4] = bg[0]; this.px[i * 4 + 1] = bg[1]; this.px[i * 4 + 2] = bg[2]; this.px[i * 4 + 3] = 255; }
}

/** Paint every pixel of [x0, x1) x [y0, y1) by coverage(x + 0.5, y + 0.5) in 0..1. */
Canvas.prototype.cover = function (x0, y0, x1, y1, col, alpha, fn) {
    const a0 = Math.max(0, Math.floor(x0)), a1 = Math.min(this.w, Math.ceil(x1)), b0 = Math.max(0, Math.floor(y0)), b1 = Math.min(this.h, Math.ceil(y1));
    for (let y = b0; y < b1; y++) {
        for (let x = a0; x < a1; x++) {
            const k = fn(x + 0.5, y + 0.5) * alpha;
            if (k <= 0) continue;
            const i = (y * this.w + x) * 4, a = k > 1 ? 1 : k;
            this.px[i] = Math.round(this.px[i] + (col[0] - this.px[i]) * a);
            this.px[i + 1] = Math.round(this.px[i + 1] + (col[1] - this.px[i + 1]) * a);
            this.px[i + 2] = Math.round(this.px[i + 2] + (col[2] - this.px[i + 2]) * a);
        }
    }
};

/** The signed distance to a rounded box. */
function sdBox(px, py, cx, cy, bx, by, r) {
    const qx = Math.abs(px - cx) - bx + r, qy = Math.abs(py - cy) - by + r;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A rounded rectangle, filled (stroke 0) or outlined (stroke = line width). */
Canvas.prototype.rrect = function (x0, y0, x1, y1, r, col, stroke, alpha) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bx = (x1 - x0) / 2, by = (y1 - y0) / 2, rr = Math.min(r, bx, by);
    const m = (stroke || 0) + 1.5;
    this.cover(x0 - m, y0 - m, x1 + m, y1 + m, col, alpha === undefined ? 1 : alpha, stroke ?
        (x, y) => clamp01(0.5 - (Math.abs(sdBox(x, y, cx, cy, bx, by, rr)) - stroke / 2)) :
        (x, y) => clamp01(0.5 - sdBox(x, y, cx, cy, bx, by, rr)));
};

/** A thick segment with round ends. */
Canvas.prototype.seg = function (x0, y0, x1, y1, wd, col) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1, m = wd + 1.5;
    this.cover(Math.min(x0, x1) - m, Math.min(y0, y1) - m, Math.max(x0, x1) + m, Math.max(y0, y1) + m, col, 1, (x, y) => {
        const t = clamp01(((x - x0) * dx + (y - y0) * dy) / L2);
        const ex = x - (x0 + t * dx), ey = y - (y0 + t * dy);
        return clamp01(0.5 - (Math.sqrt(ex * ex + ey * ey) - wd / 2));
    });
};

/** Our generic rear view of a car (the mockups' shape): a body, a narrower glasshouse, lamp slots, wheels. wy = the wheel line. */
function car(c, cx, wy, w, col, bg, filled) {
    const h = w * 0.62, top = wy - h, lw = 1.8;
    if (filled) {
        c.rrect(cx - w * 0.36, top, cx + w * 0.36, top + h * 0.44, w * 0.10, col, 0);
        c.rrect(cx - w / 2, top + h * 0.38, cx + w / 2, wy - h * 0.12, w * 0.12, col, 0);
        c.rrect(cx - w * 0.28, top + h * 0.08, cx + w * 0.28, top + h * 0.34, w * 0.05, bg, 0);
        c.rrect(cx - w * 0.44, top + h * 0.50, cx - w * 0.30, top + h * 0.62, w * 0.03, bg, 0);
        c.rrect(cx + w * 0.30, top + h * 0.50, cx + w * 0.44, top + h * 0.62, w * 0.03, bg, 0);
        c.rrect(cx - w * 0.14, top + h * 0.62, cx + w * 0.14, top + h * 0.72, w * 0.02, bg, 0);
        c.rrect(cx - w * 0.48, wy - h * 0.16, cx - w * 0.32, wy, w * 0.03, col, 0);
        c.rrect(cx + w * 0.32, wy - h * 0.16, cx + w * 0.48, wy, w * 0.03, col, 0);
    } else {
        c.rrect(cx - w * 0.36, top, cx + w * 0.36, top + h * 0.42, w * 0.10, col, lw);
        c.rrect(cx - w / 2, top + h * 0.40, cx + w / 2, wy - h * 0.12, w * 0.12, col, lw);
        c.rrect(cx - w * 0.48, wy - h * 0.14, cx - w * 0.32, wy, w * 0.03, col, lw);
        c.rrect(cx + w * 0.32, wy - h * 0.14, cx + w * 0.48, wy, w * 0.03, col, lw);
    }
}

/** Segments of a seven-segment figure: a b c d e f g. */
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g' };
function figure(c, x, y, dw, dh, t, ch, col) {
    const s = SEG[ch] || '';
    const g = t * 0.25, hh = dh / 2;
    const bar = (x0, y0, x1, y1) => c.rrect(x0, y0, x1, y1, t / 2, col, 0);
    if (s.indexOf('a') >= 0) bar(x + g, y, x + dw - g, y + t);
    if (s.indexOf('g') >= 0) bar(x + g, y + hh - t / 2, x + dw - g, y + hh + t / 2);
    if (s.indexOf('d') >= 0) bar(x + g, y + dh - t, x + dw - g, y + dh);
    if (s.indexOf('f') >= 0) bar(x, y + g, x + t, y + hh - g);
    if (s.indexOf('b') >= 0) bar(x + dw - t, y + g, x + dw, y + hh - g);
    if (s.indexOf('e') >= 0) bar(x, y + hh + g, x + t, y + dh - g);
    if (s.indexOf('c') >= 0) bar(x + dw - t, y + hh + g, x + dw, y + dh - g);
}
function number(c, cx, y, dh, text, col) {
    const dw = dh * 0.52, t = Math.max(3, dh * 0.12), gap = dh * 0.16;
    const total = text.length * dw + (text.length - 1) * gap;
    let x = cx - total / 2;
    for (let i = 0; i < text.length; i++) { figure(c, x, y, dw, dh, t, text[i], col); x += dw + gap; }
}

function chevronUp(c, cx, cy, w, h, col, lw) {
    c.seg(cx - w / 2, cy + h / 2, cx, cy - h / 2, lw, col);
    c.seg(cx, cy - h / 2, cx + w / 2, cy + h / 2, lw, col);
}

/** The skeleton's picture: direction B ("the ladder") in the layer's own px. */
function paint(st, night) {
    const P = palette(!!night);
    const c = new Canvas(W, H, P.bg);
    const s = st || DEMO[1][2];
    const amber = s.clo === 2;
    const gapCol = amber ? P.amber : P.ink;
    // the ladder: five floor stripes, near at the foot; lit up to the car ahead (the measured gap), outlines beyond
    const lx = 34, ly = 86, lw = 172, lh = 284, cx = lx + lw / 2, foot = ly + lh, usH = lh * 0.17, step = (lh - usH) / 5;
    car(c, cx, foot - 2, lw * 0.34, mix(P.ink, 0.70, P.bg), P.bg, false);
    for (let q = 1; q <= 5; q++) {
        const yb = foot - usH - (q - 1) * step - step * 0.12, wk = lw * (0.98 - 0.10 * (q - 1)), hk = step * (0.42 - 0.04 * (q - 1));
        if (s.tgt && q < s.tgt) c.rrect(cx - wk / 2, yb - hk, cx + wk / 2, yb, hk / 2, amber ? P.amber : mix(P.ink, s.clo ? 0.85 : 0.55, P.bg), 0);
        else if (s.tgt && q === s.tgt) car(c, cx, yb + step * 0.08, Math.min(wk * 0.52, step * 1.45), gapCol, P.bg, true);
        else c.rrect(cx - wk / 2, yb - hk, cx + wk / 2, yb, hk / 2, mix(P.ink, s.data === 'ok' ? 0.24 : 0.12, P.bg), 1.5);
    }
    if (s.tgt && s.clo) {
        const yc = foot - usH - step * (s.tgt - 1) * 0.5 - step * 0.2;
        [-1, 1].forEach((sx) => { for (let q = 0; q < s.clo; q++) chevronUp(c, cx + sx * (lw / 2 + 18), yc - q * 13, 20, 9, amber ? P.amber : P.ink, 2.8); });
    }
    if (s.data === 'stale' || s.data === 'absent') c.rrect(cx - 30, ly + lh * 0.40, cx + 30, ly + lh * 0.40 + 8, 4, P.dim, 0);   // a dash where a car would be
    // the capsule: the set speed (green active, grey standby, faint when off)
    const kx = 262, ky = 64, kw = 150, kh = 80;
    if (s.cru) {
        const col = s.cru[1] === 'active' ? P.green : P.dim;
        c.rrect(kx, ky, kx + kw, ky + kh, kh / 2, col, 2.6);
        number(c, kx + kw / 2, ky + 16, kh - 32, String(s.cru[2]), col);
        if (s.cru[0] === 'limiter') c.rrect(kx + kw * 0.30, ky + kh + 12, kx + kw * 0.70, ky + kh + 18, 3, col, 0);   // the limiter's bar under it
    } else {
        c.rrect(kx, ky, kx + kw, ky + kh, kh / 2, P.faint, 2.0);
        number(c, kx + kw / 2, ky + 16, kh - 32, '-', P.faint);
    }
    if (s.adv) {
        const ay = ky + kh + 40, ah = 56;
        c.rrect(kx + kw * 0.14, ay, kx + kw * 0.86, ay + ah, ah / 2, P.cyan, 2.0);
        number(c, kx + kw / 2, ay + 12, ah - 24, String(s.adv), P.cyan);
    }
    if (s.warn) {
        // the car's own warning: our picture steps back to 35 %; the word "Увага" comes with the glyph atlas (AA-SPEC 4)
        for (let i = 0; i < W * H; i++) for (let k = 0; k < 3; k++) c.px[i * 4 + k] = Math.round(P.bg[k] + (c.px[i * 4 + k] - P.bg[k]) * 0.35);
    }
    return c.px;
}

/** The bounding rectangle of the pixels that differ (RGBA, w x h), or null. */
function diffRect(a, b, w, h) {
    if (!a || !b || a.length !== b.length) return { x: 0, y: 0, w, h };
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            const i = row + x * 4;
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The rows of one rectangle of an RGBA image, packed (cluster_render_client.pixels' layout). */
function cut(px, w, r) {
    const out = Buffer.alloc(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) px.copy(out, y * r.w * 4, ((r.y + y) * w + r.x) * 4, ((r.y + y) * w + r.x + r.w) * 4);
    return out;
}

module.exports = { W, H, AT, DAY, palette, stateOf, DEMO, paint, diffRect, cut };
