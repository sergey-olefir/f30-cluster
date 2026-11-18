'use strict';
/**
 * research3 MT: an ETC2 decoder for the bench (cluster-render PROTOCOL.md "etc2rgba" / "etc2rgb" assets), so the page
 * and GET /px get the RGBA pixels the car's GPU would sample. GL_COMPRESSED_RGB8_ETC2 (8 bytes a 4x4 block: ETC1's
 * individual and differential modes plus ETC2's T, H and planar) and GL_COMPRESSED_RGBA8_ETC2_EAC (16 bytes: the EAC
 * alpha block, then the colour block); blocks in rows top to bottom, each big-endian, pixels column by column.
 * tools/research3/mt/test_etc2.py checks it against texture2ddecoder on every texture the prototype bakes. Bench only.
 */
const MODS = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];
const TDIST = [3, 6, 11, 16, 23, 32, 41, 64];
const EAC = [
    [-3, -6, -9, -15, 2, 5, 8, 14], [-3, -7, -10, -13, 2, 6, 9, 12], [-2, -5, -8, -13, 1, 4, 7, 12],
    [-2, -4, -6, -13, 1, 3, 5, 12], [-3, -6, -8, -12, 2, 5, 7, 11], [-3, -7, -9, -11, 2, 6, 8, 10],
    [-4, -7, -8, -11, 3, 6, 7, 10], [-3, -5, -8, -11, 2, 4, 7, 10], [-2, -6, -8, -10, 1, 5, 7, 9],
    [-2, -5, -8, -10, 1, 4, 7, 9], [-2, -4, -8, -10, 1, 3, 7, 9], [-2, -5, -7, -10, 1, 4, 6, 9],
    [-3, -4, -7, -10, 2, 3, 6, 9], [-1, -2, -3, -10, 0, 1, 2, 9], [-4, -6, -8, -9, 3, 5, 7, 8],
    [-3, -5, -7, -9, 2, 4, 6, 8]];

const c8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const x4 = (v) => (v << 4) | v;
const x5 = (v) => (v << 3) | (v >> 2);
const x6 = (v) => (v << 2) | (v >> 4);
const x7 = (v) => (v << 1) | (v >> 6);
/** bits [a..b] (a >= b, 63..0) of the 64-bit block hi:lo */
function bits(hi, lo, a, b) {
    let v = 0;
    for (let i = a; i >= b; i--) v = (v << 1) | (i >= 32 ? (hi >>> (i - 32)) & 1 : (lo >>> i) & 1);
    return v;
}

/** One colour block (hi, lo: its 64 bits) into out (RGBA rows of width w) at x0, y0. */
function colourBlock(hi, lo, out, w, x0, y0) {
    const idx = (i) => ((lo >>> (16 + i)) & 1) << 1 | ((lo >>> i) & 1);      // pixel i = x * 4 + y
    const put = (i, r, g, b) => {
        const x = x0 + (i >> 2), y = y0 + (i & 3), o = (y * w + x) * 4;
        out[o] = c8(r); out[o + 1] = c8(g); out[o + 2] = c8(b);
    };
    const diff = (hi >>> 1) & 1, flip = hi & 1;
    let c1, c2;
    if (!diff) {
        c1 = [x4(bits(hi, lo, 63, 60)), x4(bits(hi, lo, 55, 52)), x4(bits(hi, lo, 47, 44))];
        c2 = [x4(bits(hi, lo, 59, 56)), x4(bits(hi, lo, 51, 48)), x4(bits(hi, lo, 43, 40))];
    } else {
        const R = bits(hi, lo, 63, 59), G = bits(hi, lo, 55, 51), B = bits(hi, lo, 47, 43);
        const s3 = (v) => (v & 4 ? v - 8 : v);
        const R2 = R + s3(bits(hi, lo, 58, 56)), G2 = G + s3(bits(hi, lo, 50, 48)), B2 = B + s3(bits(hi, lo, 42, 40));
        if (R2 < 0 || R2 > 31) {                                   // T mode
            const a = [x4((bits(hi, lo, 60, 59) << 2) | bits(hi, lo, 57, 56)), x4(bits(hi, lo, 55, 52)), x4(bits(hi, lo, 51, 48))];
            const b = [x4(bits(hi, lo, 47, 44)), x4(bits(hi, lo, 43, 40)), x4(bits(hi, lo, 39, 36))];
            const d = TDIST[(bits(hi, lo, 35, 34) << 1) | bits(hi, lo, 32, 32)];
            const p = [a, [b[0] + d, b[1] + d, b[2] + d], b, [b[0] - d, b[1] - d, b[2] - d]];
            for (let i = 0; i < 16; i++) { const c = p[idx(i)]; put(i, c[0], c[1], c[2]); }
            return;
        }
        if (G2 < 0 || G2 > 31) {                                   // H mode
            const r1 = bits(hi, lo, 62, 59), g1 = (bits(hi, lo, 58, 56) << 1) | bits(hi, lo, 52, 52);
            const b1 = (bits(hi, lo, 51, 51) << 3) | bits(hi, lo, 49, 47);
            const r2 = bits(hi, lo, 46, 43), g2 = bits(hi, lo, 42, 39), b2 = bits(hi, lo, 38, 35);
            const v1 = (r1 << 8) | (g1 << 4) | b1, v2 = (r2 << 8) | (g2 << 4) | b2;
            const d = TDIST[(bits(hi, lo, 34, 34) << 2) | (bits(hi, lo, 32, 32) << 1) | (v1 >= v2 ? 1 : 0)];
            const a = [x4(r1), x4(g1), x4(b1)], b = [x4(r2), x4(g2), x4(b2)];
            const p = [[a[0] + d, a[1] + d, a[2] + d], [a[0] - d, a[1] - d, a[2] - d], [b[0] + d, b[1] + d, b[2] + d], [b[0] - d, b[1] - d, b[2] - d]];
            for (let i = 0; i < 16; i++) { const c = p[idx(i)]; put(i, c[0], c[1], c[2]); }
            return;
        }
        if (B2 < 0 || B2 > 31) {                                   // planar mode
            const ro = x6(bits(hi, lo, 62, 57)), go = x7((bits(hi, lo, 56, 56) << 6) | bits(hi, lo, 54, 49));
            const bo = x6((bits(hi, lo, 48, 48) << 5) | (bits(hi, lo, 44, 43) << 3) | bits(hi, lo, 41, 39));
            const rh = x6((bits(hi, lo, 38, 34) << 1) | bits(hi, lo, 32, 32)), gh = x7(bits(hi, lo, 31, 25)), bh = x6(bits(hi, lo, 24, 19));
            const rv = x6(bits(hi, lo, 18, 13)), gv = x7(bits(hi, lo, 12, 6)), bv = x6(bits(hi, lo, 5, 0));
            for (let i = 0; i < 16; i++) {
                const x = i >> 2, y = i & 3;
                put(i, (x * (rh - ro) + y * (rv - ro) + 4 * ro + 2) >> 2, (x * (gh - go) + y * (gv - go) + 4 * go + 2) >> 2,
                    (x * (bh - bo) + y * (bv - bo) + 4 * bo + 2) >> 2);
            }
            return;
        }
        c1 = [x5(R), x5(G), x5(B)];
        c2 = [x5(R2), x5(G2), x5(B2)];
    }
    const t1 = MODS[bits(hi, lo, 39, 37)], t2 = MODS[bits(hi, lo, 36, 34)];
    for (let i = 0; i < 16; i++) {
        const x = i >> 2, y = i & 3, second = flip ? y >= 2 : x >= 2;
        const c = second ? c2 : c1, t = second ? t2 : t1, k = idx(i);
        const m = k === 0 ? t[0] : k === 1 ? t[1] : k === 2 ? -t[0] : -t[1];
        put(i, c[0] + m, c[1] + m, c[2] + m);
    }
}

function alphaBlock(hi, lo, out, w, x0, y0) {
    const base = hi >>> 24, mul = (hi >>> 20) & 15, tab = EAC[(hi >>> 16) & 15];
    for (let i = 0; i < 16; i++) {
        const k = bits(hi, lo, 47 - 3 * i, 45 - 3 * i);
        const x = x0 + (i >> 2), y = y0 + (i & 3);
        out[(y * w + x) * 4 + 3] = c8(base + mul * tab[k]);
    }
}

/** fmt 'etc2rgba' | 'etc2rgb', w and h multiples of 4 -> Buffer of RGBA rows. */
function decode(fmt, data, w, h) {
    const out = Buffer.alloc(w * h * 4, 255);
    const bs = fmt === 'etc2rgba' ? 16 : 8;
    let o = 0;
    for (let by = 0; by < h; by += 4) {
        for (let bx = 0; bx < w; bx += 4, o += bs) {
            if (bs === 16) alphaBlock(data.readUInt32BE(o), data.readUInt32BE(o + 4), out, w, bx, by);
            const c = o + bs - 8;
            colourBlock(data.readUInt32BE(c), data.readUInt32BE(c + 4), out, w, bx, by);
        }
    }
    return out;
}

/** Bytes of an ETC2 texture of that size (PROTOCOL.md: 16 or 8 a 4x4 block), 0 for another format. */
function bytes(fmt, w, h) {
    const bs = fmt === 'etc2rgba' ? 16 : fmt === 'etc2rgb' ? 8 : 0;
    return bs * Math.ceil(w / 4) * Math.ceil(h / 4);
}

module.exports = { decode, bytes };
