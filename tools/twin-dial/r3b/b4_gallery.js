'use strict';
/**
 * b4_gallery.js - draws every state of the centre pages (round 3, package B4) as a 1920 x 720 PNG: black panel, the page
 * layer where the engine puts it, the title rule. Output goes to bake/work/twin-dial/r3b/b4/ (git-ignored). The pictures
 * are what shared/twin_pages.js paints through the engine's own entry, with invented neutral text.
 *
 *   node tools/twin-dial/r3b/b4_gallery.js [out dir]
 *   uv run -q --no-project --with numpy --with pillow python -I tools/twin-dial/r3b/b4_compare.py   (side by side with K2's mockups)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const S = require('../../../bench/twin-centre-states');

const OUT = process.argv[2] || path.join(__dirname, '..', '..', '..', 'bake', 'work', 'twin-dial', 'r3b', 'b4');

function crc32(buf) {
    let c, crc = ~0;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return ~crc >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
/** An RGB PNG from a straight-alpha RGBA buffer laid over black. */
function png(w, h, rgba) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4, o = y * (w * 3 + 1) + 1 + x * 3, a = rgba[i + 3] / 255;
            raw[o] = Math.round(rgba[i] * a); raw[o + 1] = Math.round(rgba[i + 1] * a); raw[o + 2] = Math.round(rgba[i + 2] * a);
        }
    }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const R = S.rig();
fs.mkdirSync(OUT, { recursive: true });
const W = 1920, H = 720, L = R.widget;
Object.keys(S.STATES).forEach((id) => {
    const h = S.make(R, id);
    const r = S.render(R, h);
    const panel = Buffer.alloc(W * H * 4, 0);
    for (let i = 3; i < panel.length; i += 4) panel[i] = 255;
    // the title rule (tdback draws it: 2.5 px at y 295-297.5, code 205) unless the map window is open
    if (r.page !== 'map') for (let y = 295; y < 298; y++) for (let x = 739; x < 1181; x++) { const k = y === 297 ? 0.5 : 1, o = (y * W + x) * 4; panel[o] = panel[o + 1] = panel[o + 2] = Math.round(205 * k); }
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
        const s = (y * L.w + x) * 4, o = ((L.y + y) * W + L.x + x) * 4, a = r.buf[s + 3] / 255;
        if (!a) continue;
        for (let c = 0; c < 3; c++) panel[o + c] = Math.round(r.buf[s + c] * a + panel[o + c] * (1 - a));
    }
    fs.writeFileSync(path.join(OUT, id + '.png'), png(W, H, panel));
    console.log(id + ' -> page ' + r.page + ', ' + r.ink.length + ' inked items');
});
