'use strict';
/** tools/shots/beam/png.js - a straight RGBA buffer -> a PNG file (8-bit RGBA, filter 0). Mac tools only, never shipped. */
const fs = require('fs');
const zlib = require('zlib');

const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
}
function encode(w, h, px) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
function write(file, w, h, px) { fs.writeFileSync(file, encode(w, h, px)); }
/** A PNG file (8-bit RGB or RGBA, any filter, not interlaced) -> { w, h, px } straight RGBA. */
function read(file) {
    const b = fs.readFileSync(file);
    let i = 8, w = 0, h = 0, ct = 6;
    const idat = [];
    while (i < b.length) {
        const len = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8), body = b.slice(i + 8, i + 8 + len);
        if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ct = body[9]; }
        if (type === 'IDAT') idat.push(body);
        i += 12 + len;
    }
    const bpp = ct === 2 ? 3 : 4, st = w * bpp;
    const raw = zlib.inflateSync(Buffer.concat(idat)), q = Buffer.alloc(w * h * bpp);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (st + 1)];
        for (let x = 0; x < st; x++) {
            const v = raw[y * (st + 1) + 1 + x], a = x >= bpp ? q[y * st + x - bpp] : 0, up = y ? q[(y - 1) * st + x] : 0, ul = y && x >= bpp ? q[(y - 1) * st + x - bpp] : 0;
            let p = v;
            if (f === 1) p = v + a; else if (f === 2) p = v + up; else if (f === 3) p = v + ((a + up) >> 1);
            else if (f === 4) { const pp = a + up - ul, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - ul); p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul); }
            q[y * st + x] = p & 255;
        }
    }
    if (bpp === 4) return { w, h, px: q };
    const px = Buffer.alloc(w * h * 4);
    for (let k = 0; k < w * h; k++) { px[k * 4] = q[k * 3]; px[k * 4 + 1] = q[k * 3 + 1]; px[k * 4 + 2] = q[k * 3 + 2]; px[k * 4 + 3] = 255; }
    return { w, h, px };
}
module.exports = { encode, write, read };
