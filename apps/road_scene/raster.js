'use strict';
/**
 * raster.js - Auto Beam's small software painter (round "Auto Beam", package HD; ACC View's raster.js of round 1120 AA2, copied
 * as it was, plus sdf() for our own sign): an RGBA canvas with antialiased shapes and words from our glyph atlases
 * (hud/fonts/ab_*.json). Used for the map target's text sheet and the whole centre page, so both placements draw the same
 * words in the same fonts. Pure JavaScript (Node 8 on the head unit has no native canvas); nothing
 * is uploaded from here. Straight (not premultiplied) RGBA, as cluster-render image layers take it.
 *
 *   new Canvas(w, h, bg)           bg [r, g, b] (opaque) or null (transparent)
 *   cv.rrect(x0, y0, x1, y1, r, col, stroke, alpha)   filled (stroke 0) or outlined
 *   cv.seg(x0, y0, x1, y1, width, col)                a thick segment, round ends
 *   cv.text(str, x, baseline, font, size, col, align, alpha) -> width;  textWidth(str, font, size);  fit(str, font, size, maxW)
 *   cv.sprite(sp, x, y, w, h, mul, alpha)             a baked RGBA sprite, area-averaged into the box
 *   cv.dim(x0, y0, x1, y1, k, bg)                      the region's colours k of the way from bg
 *   fonts: font(name) loads hud/fonts/<name>.json (the kit's data pack on the car, the plain folder elsewhere)
 *   sprite(name): hud/sprites.json's sprite { w, h, px }
 *
 * Plain Node 8. Loaders return null on a missing file (the caller draws without it); nothing here throws on bad input.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let DATA = null;
/** The app's hud/ data: the kit's pack (the car, the bench) or the plain folder (the tests run the sources). */
function data() {
    if (DATA) return DATA;
    const dir = path.join(__dirname, 'hud');
    try { DATA = require('./kit/pack').open(dir); } catch (e) {
        DATA = { json: (rel) => { try { return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')); } catch (err) { return {}; } } };
    }
    return DATA;
}

const fontCache = {};
/** The canvas's mean brightness (Rec. 709 luma of the opaque-composited pixels, 0..255): the night look's measure. */
function meanLuma(px) {
    let s = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; s += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) * a; n++; }
    return n ? s / n : 0;
}
function font(name) {
    if (fontCache[name] !== undefined) return fontCache[name];
    let f = null;
    try {
        const m = data().json('fonts/' + name + '.json');
        if (m && m.glyphs && m.alpha) {
            const a = Buffer.from(m.alpha, 'base64');
            if (a.length === m.width * m.height) f = { name, size: m.size, cell: m.cellHeight, base: m.baseline, glyphs: m.glyphs, w: m.width, a };
        }
    } catch (e) { f = null; }
    fontCache[name] = f;
    return f;
}

const spriteCache = {};
function sprite(name) {
    if (spriteCache[name] !== undefined) return spriteCache[name];
    let s = null;
    try {
        const j = data().json('sprites.json')[name];
        if (j && j.z) {
            const px = zlib.inflateSync(Buffer.from(j.z, 'base64'));
            if (px.length === j.w * j.h * 4) s = { w: j.w, h: j.h, px };
        }
    } catch (e) { s = null; }
    spriteCache[name] = s;
    return s;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sdBox(px, py, cx, cy, bx, by, r) {
    const qx = Math.abs(px - cx) - bx + r, qy = Math.abs(py - cy) - by + r;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function Canvas(w, h, bg) {
    this.w = w; this.h = h;
    this.px = Buffer.alloc(w * h * 4);
    if (bg) for (let i = 0; i < w * h; i++) { this.px[i * 4] = bg[0]; this.px[i * 4 + 1] = bg[1]; this.px[i * 4 + 2] = bg[2]; this.px[i * 4 + 3] = 255; }
}

/** src-over of colour col with coverage k (0..1) at pixel index i (straight alpha). */
Canvas.prototype.put = function (i, col, k) {
    if (k <= 0) return;
    const a = k > 1 ? 1 : k, p = this.px, da = p[i + 3] / 255;
    if (da >= 1) {
        p[i] = Math.round(p[i] + (col[0] - p[i]) * a);
        p[i + 1] = Math.round(p[i + 1] + (col[1] - p[i + 1]) * a);
        p[i + 2] = Math.round(p[i + 2] + (col[2] - p[i + 2]) * a);
        return;
    }
    const oa = a + da * (1 - a), kd = da * (1 - a);
    p[i] = Math.round((col[0] * a + p[i] * kd) / oa);
    p[i + 1] = Math.round((col[1] * a + p[i + 1] * kd) / oa);
    p[i + 2] = Math.round((col[2] * a + p[i + 2] * kd) / oa);
    p[i + 3] = Math.round(oa * 255);
};

/** Paint every pixel of [x0, x1) x [y0, y1) by coverage fn(x + 0.5, y + 0.5) in 0..1. */
Canvas.prototype.cover = function (x0, y0, x1, y1, col, alpha, fn) {
    const a0 = Math.max(0, Math.floor(x0)), a1 = Math.min(this.w, Math.ceil(x1)), b0 = Math.max(0, Math.floor(y0)), b1 = Math.min(this.h, Math.ceil(y1));
    for (let y = b0; y < b1; y++) for (let x = a0; x < a1; x++) this.put((y * this.w + x) * 4, col, fn(x + 0.5, y + 0.5) * alpha);
};

Canvas.prototype.rrect = function (x0, y0, x1, y1, r, col, stroke, alpha) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bx = (x1 - x0) / 2, by = (y1 - y0) / 2, rr = Math.min(r, bx, by);
    const m = (stroke || 0) + 1.5;
    this.cover(x0 - m, y0 - m, x1 + m, y1 + m, col, alpha === undefined ? 1 : alpha, stroke ?
        (x, y) => clamp01(0.5 - (Math.abs(sdBox(x, y, cx, cy, bx, by, rr)) - stroke / 2)) :
        (x, y) => clamp01(0.5 - sdBox(x, y, cx, cy, bx, by, rr)));
};

/** Coverage by a signed distance fn(x, y) (px; < 0 inside) over the box [x0, x1) x [y0, y1): a stroke when width > 0. */
Canvas.prototype.sdf = function (x0, y0, x1, y1, col, alpha, fn, width) {
    const w = width || 0;
    this.cover(x0 - 2, y0 - 2, x1 + 2, y1 + 2, col, alpha === undefined ? 1 : alpha, w > 0 ?
        (x, y) => clamp01(0.5 - (Math.abs(fn(x, y)) - w / 2)) : (x, y) => clamp01(0.5 - fn(x, y)));
};

Canvas.prototype.seg = function (x0, y0, x1, y1, wd, col) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1, m = wd + 1.5;
    this.cover(Math.min(x0, x1) - m, Math.min(y0, y1) - m, Math.max(x0, x1) + m, Math.max(y0, y1) + m, col, 1, (x, y) => {
        const t = clamp01(((x - x0) * dx + (y - y0) * dy) / L2);
        const ex = x - (x0 + t * dx), ey = y - (y0 + t * dy);
        return clamp01(0.5 - (Math.sqrt(ex * ex + ey * ey) - wd / 2));
    });
};

/** Width in px of str in font `name` at `size`. */
function textWidth(str, name, size) {
    const f = font(name);
    if (!f) return 0;
    const k = size / f.size;
    let w = 0;
    String(str).split('').forEach((ch) => { const g = f.glyphs[ch] || f.glyphs[' ']; if (g) w += g.advance * k; });
    return w;
}

/** The largest size (down from `size`, at most 40 % smaller) at which str fits maxW. */
function fit(str, name, size, maxW) {
    let s = size;
    while (s > size * 0.6 && textWidth(str, name, s) > maxW) s -= 0.5;
    return s;
}

/** Characters of str the font lacks ('' when it has them all). */
function missing(str, name) {
    const f = font(name);
    if (!f) return String(str);
    return String(str).split('').filter((ch) => !f.glyphs[ch]).join('');
}

/** Words from an atlas: y is the baseline; align 'left' | 'center' | 'right'. Returns the width drawn. */
Canvas.prototype.text = function (str, x, y, name, size, col, align, alpha) {
    const f = font(name);
    if (!f) return 0;
    const k = size / f.size, w = textWidth(str, name, size);
    let pen = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const top = y - f.base * k, al = alpha === undefined ? 1 : alpha;
    String(str).split('').forEach((ch) => {
        const g = f.glyphs[ch] || f.glyphs[' '];
        if (!g) return;
        if (g.w && g.h) this._glyph(f, g, pen + g.ox * k, top, k, col, al);
        pen += g.advance * k;
    });
    return w;
};

Canvas.prototype._glyph = function (f, g, dx, dy, k, col, al) {
    const tw = g.w * k, th = g.h * k, A = f.a, AW = f.w;
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= g.w || yy >= g.h ? 0 : A[(g.y + yy) * AW + g.x + xx]);
    for (let py = Math.max(0, Math.floor(dy)); py < Math.min(this.h, Math.ceil(dy + th)); py++) {
        const sy = (py + 0.5 - dy) / k - 0.5, iy = Math.floor(sy), fy = sy - iy;
        for (let px = Math.max(0, Math.floor(dx)); px < Math.min(this.w, Math.ceil(dx + tw)); px++) {
            const sx = (px + 0.5 - dx) / k - 0.5, ix = Math.floor(sx), fx = sx - ix;
            const v = at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) + at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
            if (v > 0) this.put((py * this.w + px) * 4, col, (v / 255) * al);
        }
    }
};

/** A baked sprite area-averaged (premultiplied) into the box x, y, w, h; rgb times mul, alpha times alpha. */
Canvas.prototype.sprite = function (sp, x, y, w, h, mul, alpha) {
    if (!sp || !(w > 0 && h > 0)) return;
    const fx = sp.w / w, fy = sp.h / h, S = sp.px, m = mul === undefined ? 1 : mul, al = alpha === undefined ? 1 : alpha;
    const col = [0, 0, 0];
    for (let py = Math.max(0, Math.floor(y)); py < Math.min(this.h, Math.ceil(y + h)); py++) {
        const s0 = Math.max(0, (py - y) * fy), s1 = Math.min(sp.h, (py + 1 - y) * fy);
        const r0 = Math.floor(s0), r1 = Math.max(r0 + 1, Math.ceil(s1));
        for (let px = Math.max(0, Math.floor(x)); px < Math.min(this.w, Math.ceil(x + w)); px++) {
            const t0 = Math.max(0, (px - x) * fx), t1 = Math.min(sp.w, (px + 1 - x) * fx);
            const c0 = Math.floor(t0), c1 = Math.max(c0 + 1, Math.ceil(t1));
            let r = 0, gg = 0, b = 0, a = 0, n = 0;
            for (let yy = r0; yy < Math.min(sp.h, r1); yy++) {
                for (let xx = c0; xx < Math.min(sp.w, c1); xx++) {
                    const i = (yy * sp.w + xx) * 4, sa = S[i + 3] / 255;
                    r += S[i] * sa; gg += S[i + 1] * sa; b += S[i + 2] * sa; a += sa; n++;
                }
            }
            if (!n || a <= 0) continue;
            col[0] = (r / a) * m; col[1] = (gg / a) * m; col[2] = (b / a) * m;
            this.put((py * this.w + px) * 4, col, (a / n) * al);
        }
    }
};

/** The region's colours k of the way from bg (the car's own warning: our picture steps back to 35 %). */
Canvas.prototype.dim = function (x0, y0, x1, y1, k, bg) {
    for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) {
            const i = (y * this.w + x) * 4;
            for (let c = 0; c < 3; c++) this.px[i + c] = Math.round(bg[c] + (this.px[i + c] - bg[c]) * k);
        }
    }
};

/** The bounding rectangle of the pixels that differ (RGBA, w x h), or null; a missing frame: the whole. */
function diffRect(a, b, w, h) {
    if (!a || !b || a.length !== b.length) return { x: 0, y: 0, w, h };
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        for (let x = 0; x < w; x++) {
            const i = row + x * 4;
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
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

/** A JSON file of hud/ ({} when missing). */
function hudJson(rel) { try { return data().json(rel) || {}; } catch (e) { return {}; } }

module.exports = { Canvas, font, sprite, hudJson, textWidth, fit, missing, diffRect, cut, clamp01, sdBox, meanLuma };
