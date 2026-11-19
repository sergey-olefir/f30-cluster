'use strict';
/**
 * road_shields.js - r1120 F1: the road number at the start of the road label drawn on its plate, as the Ukrainian
 * road signs do (docs/ROAD-SHIELDS.md: DSTU 4100:2021's plates, our own drawing). Pure: no car, no layer, no state.
 *
 *   parse(text)  -> { shields: [{ cat, text }], name }   the leading road numbers (at most two) and the rest
 *   paint(boxW, boxH, text, opts) -> RGBA Buffer | null  the whole label (plates, then the name) in one raster;
 *                                                        null when the text has no road number (draw it as before)
 *
 * The categories (ROAD-SHIELDS.md 0, 2.3, 4.2), after folding the Cyrillic letters to their Latin twins:
 *   M (М, міжнародні) M-nn red, H (Н, національні) H-nn red, P (Р, регіональні) P-nn blue, T (Т, територіальні)
 *   T-nn-nn blue, E (European) "E nnn" green. Anything else - another letter, too many figures, a lower-case letter -
 *   is not a shield: it stays in the name as the car wrote it (the brief: unknown prefixes stay plain text; the neutral
 *   grey plate of ROAD-SHIELDS.md 4.3 is NOT drawn). Only a number at the very START counts, followed by a separator or
 *   the end, so a street that merely contains "M5" is untouched.
 * The plate (ROAD-SHIELDS.md 2.2, rendering A1): 40 px high, a 2 px frame in the theme's "line" role, corners 6 / 4 px,
 * 7 px from the frame to the number, the number in the theme's "fg" role in wb_shield (cap ~20.6), width 18 + the
 * number's advance, at least 44 and even. 8 px between two plates, 14 px to the name. The plate's fill is the
 * category's colour by day and its night value by night (ROAD-SHIELDS.md 5: the frame and the number dim with the
 * theme, the fill does not, so it has its own night hex). Straight alpha, as cluster-render takes it.
 * The group (plates + name) is centred in the box as the plain label is; a name that does not fit is cut with "..."
 * (as hud.js _fitText does for the plain label), the plates never are.
 * The road's text is the car's own and is never logged; this module logs nothing.
 */

const FOLD = { 'М': 'M', 'Н': 'H', 'Р': 'P', 'Т': 'T', 'Е': 'E' };
// day / night fills (ROAD-SHIELDS.md 2.3 "the shipped set" and 5's table; the hex values there are the authority)
const FILL = {
    M: { day: [0xE3, 0x00, 0x13], night: [0x5F, 0x00, 0x08] },
    H: { day: [0xE3, 0x00, 0x13], night: [0x5F, 0x00, 0x08] },
    P: { day: [0x0B, 0x63, 0xA8], night: [0x05, 0x2A, 0x47] },
    T: { day: [0x0B, 0x63, 0xA8], night: [0x05, 0x2A, 0x47] },
    E: { day: [0x03, 0x7D, 0x4A], night: [0x01, 0x34, 0x1F] },
};
const GEO = { h: 40, frame: 2, radius: 6, pad: 7, minW: 44, gap: 8, gapName: 14 };
const MAX_SHIELDS = 2;
// a separator after a number: whitespace, "/", ",", ";", the middle dot, or the end of the text
const SEP = '(?=$|[\\s/,;\\u00b7])';
const RULES = [
    // E first: "E 50" must not fall through (ROAD-SHIELDS.md 4.2); 1-3 figures (E 373), "E 1051" is not one
    { cat: 'E', re: new RegExp('^E[ -]?(\\d{1,3})' + SEP), text: (m) => 'E ' + m[1] },
    { cat: 'M', re: new RegExp('^M[ -]?(\\d{1,2})' + SEP), text: (m) => 'M-' + pad2(m[1]) },
    { cat: 'H', re: new RegExp('^H[ -]?(\\d{1,2})' + SEP), text: (m) => 'H-' + pad2(m[1]) },
    { cat: 'P', re: new RegExp('^P[ -]?(\\d{1,2})' + SEP), text: (m) => 'P-' + pad2(m[1]) },
    { cat: 'T', re: new RegExp('^T[ -]?(\\d{2})[ -]?(\\d{2})' + SEP), text: (m) => 'T-' + m[1] + '-' + m[2] },
];

function pad2(d) { return d.length < 2 ? '0' + d : d; }

/** The car's Cyrillic category letters as their Latin twins, character for character (the same length, so an index
 *  into the folded text is an index into the original). Only the five; everything else is left as it is. */
function fold(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) out += FOLD[s[i]] || s[i];
    return out;
}

/** -> { shields: [{ cat: 'M'|'H'|'P'|'T'|'E', text: 'M-04' }], name: the rest, trimmed }. Never throws. */
function parse(text) {
    const src = typeof text === 'string' ? text : '';
    const shields = [];
    let rest = src.replace(/^\s+/, '');
    while (shields.length < MAX_SHIELDS && rest) {
        const f = fold(rest);
        let hit = null;
        for (let i = 0; i < RULES.length && !hit; i++) {
            const m = RULES[i].re.exec(f);
            if (m) hit = { cat: RULES[i].cat, text: RULES[i].text(m), len: m[0].length };
        }
        if (!hit) break;
        shields.push({ cat: hit.cat, text: hit.text });
        // the separators between a number and what follows: spaces, "/", ",", ";", the middle dot, a dash
        rest = rest.slice(hit.len).replace(/^[\s/,;·–—-]+/, '');
    }
    return { shields, name: shields.length ? rest.replace(/\s+$/, '') : src.trim() };
}

/** One plate's width for its number in the shield font: 18 + the advances, at least 44, rounded up to even. */
function plateW(textRaster, font, s) {
    const w = 2 * GEO.frame + 2 * GEO.pad + textRaster.measure(s, font, 0);
    const v = Math.max(GEO.minW, Math.ceil(w));
    return v % 2 ? v + 1 : v;
}

/** The rounded box's signed distance at pixel centre (px, py); < 0 inside (ROAD-SHIELDS.md 3.1's sdBox). */
function sdBox(px, py, x, y, w, h, rad) {
    const hx = w * 0.5, hy = h * 0.5;
    const qx = Math.abs(px - (x + hx)) - (hx - rad), qy = Math.abs(py - (y + hy)) - (hy - rad);
    const mx = Math.max(qx, 0), my = Math.max(qy, 0);
    return Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0) - rad;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The cap box of the shield font, read off its "H": [top, bottom) rows of the cell where the ink is >= half. */
function capRows(textRaster, font) {
    const f = textRaster.loadFont(font), g = f.metrics.glyphs.H;
    if (!g) return [0, f.metrics.baseline];
    let top = -1, bot = -1;
    for (let y = 0; y < g.h; y++) {
        let ink = false;
        for (let x = 0; x < g.w && !ink; x++) ink = f.alpha[(g.y + y) * f.width + g.x + x] >= 128;
        if (ink) { if (top < 0) top = y; bot = y + 1; }
    }
    return top < 0 ? [0, f.metrics.baseline] : [top, bot];
}

/** Put src (RGBA, sw x sh) over dst (RGBA, dw wide) at (ox, oy), straight alpha, "over". */
function over(dst, dw, dh, src, sw, sh, ox, oy) {
    for (let y = 0; y < sh; y++) {
        const ty = oy + y;
        if (ty < 0 || ty >= dh) continue;
        for (let x = 0; x < sw; x++) {
            const tx = ox + x;
            if (tx < 0 || tx >= dw) continue;
            const s = (y * sw + x) * 4, sa = src[s + 3] / 255;
            if (sa <= 0) continue;
            const d = (ty * dw + tx) * 4, da = dst[d + 3] / 255, a = sa + da * (1 - sa);
            for (let k = 0; k < 3; k++) dst[d + k] = Math.round((src[s + k] * sa + dst[d + k] * da * (1 - sa)) / a);
            dst[d + 3] = Math.round(a * 255);
        }
    }
}

/**
 * The label in one raster, or null when it starts with no road number (the caller draws the plain text as before).
 * opts: { textRaster, font (the name's, wb_road), shieldFont (wb_shield), fg, line (rgba arrays: the theme's "fg" and
 *         "line" roles, night-dimmed by the theme already), night (bool), plateTop (px from the box top: BMW's street
 *         row's top, 669 on the panel), spacing }
 * Returns { buf, shields: [{ cat, text, x, w }], name: the name as drawn (possibly cut), nameX } with buf boxW x boxH.
 */
function paint(boxW, boxH, text, opts) {
    const o = opts || {}, tr = o.textRaster;
    const p = parse(text);
    if (!p.shields.length || !tr) return null;
    const sf = o.shieldFont || 'wb_shield', nf = o.font;
    const plates = p.shields.map((s) => ({ cat: s.cat, text: s.text, w: plateW(tr, sf, s.text) }));
    const platesW = plates.reduce((a, s, i) => a + s.w + (i ? GEO.gap : 0), 0);
    // the name in the room left; cut with "..." as the plain label is (hud.js _fitText), never the plates
    let name = p.name;
    const room = boxW - platesW - (name ? GEO.gapName : 0);
    if (name && tr.measure(name, nf, o.spacing) > room) {
        let t = name;
        while (t.length > 1 && tr.measure(t + '...', nf, o.spacing) > room) t = t.slice(0, -1);
        t = t.replace(/[\s,.;:/-]+$/, '');
        name = t && room > tr.measure('...', nf, o.spacing) ? t + '...' : '';
    }
    const nameW = name ? tr.measure(name, nf, o.spacing) : 0;
    const total = platesW + (name ? GEO.gapName + nameW : 0);
    let x = Math.max(0, Math.round((boxW - total) / 2));
    const buf = Buffer.alloc(boxW * boxH * 4, 0);
    const top = Math.round(o.plateTop || 0), H = Math.min(GEO.h, boxH - top);
    const fg = o.fg || [255, 255, 255, 255], line = o.line || fg;
    const cap = capRows(tr, sf), capH = cap[1] - cap[0];
    const out = [];
    plates.forEach((pl, i) => {
        if (i) x += GEO.gap;
        const fill = (FILL[pl.cat] || FILL.P)[o.night ? 'night' : 'day'];
        const img = Buffer.alloc(pl.w * H * 4, 0);
        for (let yy = 0; yy < H; yy++) {
            for (let xx = 0; xx < pl.w; xx++) {
                const d = sdBox(xx + 0.5, yy + 0.5, 0, 0, pl.w, GEO.h, GEO.radius);
                const a = clamp01(0.5 - d);
                if (a <= 0) continue;
                const e = clamp01(d + GEO.frame + 0.5);         // 1 within the frame
                const q = (yy * pl.w + xx) * 4;
                for (let k = 0; k < 3; k++) img[q + k] = Math.round(fill[k] * (1 - e) + line[k] * e);
                img[q + 3] = Math.round(a * 255);
            }
        }
        // the number: centred across the plate, its cap box centred in the plate's height
        const offY = Math.round((GEO.h - capH) / 2) - cap[0];
        const num = tr.drawText(pl.w, H, pl.text, { font: sf, color: fg, align: 'center', offsetY: offY });
        over(img, pl.w, H, num, pl.w, H, 0, 0);
        over(buf, boxW, boxH, img, pl.w, H, x, top);
        out.push({ cat: pl.cat, text: pl.text, x, w: pl.w });
        x += pl.w;
    });
    let nameX = null;
    if (name) {
        x += GEO.gapName;
        nameX = x;
        // 4 px either side: a glyph's ink may start left of its pen (ox < 0) or run past its advance
        const M = 4, nb = tr.drawText(nameW + 2 * M, boxH, name, { font: nf, color: fg, align: 'left', spacing: o.spacing, x: M });
        over(buf, boxW, boxH, nb, nameW + 2 * M, boxH, x - M, 0);
    }
    return { buf, shields: out, name, nameX };
}

module.exports = { parse, paint, plateW, FILL, GEO };
