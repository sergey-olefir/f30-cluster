#!/usr/bin/env node
'use strict';
/**
 * Package P (2026-11-16): writes the strip pictograms of design/strip/pictograms/pictograms.js as
 *   design/strip/pictograms/svg/<name>.svg           vectors, currentColor
 *   design/strip/pictograms/baked/<name>_<w>x<h>.png white ink + alpha (8-bit grey+alpha), drawn by shared/icons.js
 *                                                    paintIcon() itself - the drop-in path, so a baked file is exactly
 *                                                    what the cluster would draw at that size
 *   design/strip/pictograms/sheet.png                a review sheet: every pictogram at every size, white on black
 *   design/strip/pictograms/baked/index.json         names, sizes, alpha ink boxes
 * Our own drawings only; nothing is read from reference/ or from the car.
 *
 *   node tools/strip/P/bake_pictograms.js [--sizes <json file>]
 *
 * Sizes default to the stock slots in docs/G20-DESIGN-SPEC.md (marker slot ~30 x 36, symbol slot ~41 x 53) and to
 * the cap heights of our own line (message cap 26.6, road label cap 30.9). --sizes takes
 * { "markers": [[w, h], ...], "symbols": [[w, h], ...] } (e.g. from packages T / ZR) instead.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'design', 'strip', 'pictograms');
const P = require(path.join(OUT, 'pictograms.js'));
const icons = require(path.join(ROOT, 'shared', 'icons.js'));
Object.assign(icons.ICONS, P.ICONS);                  // the one-line drop-in, as documented in pictograms.js

const MARKERS = ['cc_warn', 'cc_warn_solid', 'cc_info', 'cc_dot'];
const SYMBOLS = ['cc_door', 'cc_brake', 'cc_tyre', 'cc_engine', 'cc_washer', 'cc_belt', 'cc_info'];
let sizes = {
    markers: [[30, 36], [28, 28], [32, 32]],         // stock marker slot; inline at our message / road-label cap
    symbols: [[41, 53], [32, 32]],                   // stock symbol slot (widest stock pictogram 41.3 x 53.0); inline
    review: 128,
};
const ai = process.argv.indexOf('--sizes');
if (ai > 0) sizes = Object.assign(sizes, JSON.parse(fs.readFileSync(process.argv[ai + 1], 'utf8')));

const NOTES = {
    cc_warn: 'severity marker, warning: outline triangle with "!"',
    cc_warn_solid: 'severity marker, warning: filled triangle, "!" knocked out',
    cc_info: 'severity marker / message symbol, information: lower-case "i"',
    cc_dot: 'severity marker, neutral: a dot',
    cc_door: 'message symbol: door open (car from above, front left door out)',
    cc_brake: 'message symbol: brake system (circle in parentheses with "!")',
    cc_tyre: 'message symbol: tyre pressure (tyre profile with "!")',
    cc_engine: 'message symbol: engine / drivetrain',
    cc_washer: 'message symbol: washer fluid (windscreen with jet)',
    cc_belt: 'message symbol: seat belt (seated person, diagonal belt)',
};

// ---- PNG (no dependencies) ------------------------------------------------------------------------------------------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
/** pixels: grey+alpha, 2 bytes per pixel */
function png(w, h, ga) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 4; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const raw = Buffer.alloc((w * 2 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 2 + 1)] = 0; ga.copy(raw, y * (w * 2 + 1) + 1, y * w * 2, (y + 1) * w * 2); }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function bake(name, w, h) {
    const rgba = icons.paintIcon(name, w, h, [255, 255, 255, 255]);
    const ga = Buffer.alloc(w * h * 2);
    let x0 = w, y0 = h, x1 = -1, y1 = -1, sum = 0;
    for (let i = 0; i < w * h; i++) {
        const a = rgba[i * 4 + 3];
        ga[i * 2] = 255; ga[i * 2 + 1] = a; sum += a;
        if (a > 0) { const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return { ga, rgba, box: x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1], ink: +(sum / 255).toFixed(1) };
}

fs.mkdirSync(path.join(OUT, 'svg'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'baked'), { recursive: true });
const index = { generator: 'tools/strip/P/bake_pictograms.js', source: 'design/strip/pictograms/pictograms.js',
    licence: 'MIT (repository LICENSE); our own drawings', format: 'PNG, 8-bit grey+alpha, white ink; alpha = coverage',
    note: 'box: alpha ink box [x0, y0, x1, y1], half-open px; ink: summed alpha in px', items: [] };
const sheetRows = [];
for (const [group, names, list] of [['marker', MARKERS, sizes.markers], ['symbol', SYMBOLS, sizes.symbols]]) {
    for (const n of names) {
        fs.writeFileSync(path.join(OUT, 'svg', n + '.svg'), P.svg(n, NOTES[n]));
        const row = [];
        for (const [w, h] of list.concat([[sizes.review, sizes.review]])) {
            const b = bake(n, w, h);
            const file = `${n}_${w}x${h}.png`;
            fs.writeFileSync(path.join(OUT, 'baked', file), png(w, h, b.ga));
            if (!index.items.some((it) => it.file === file)) index.items.push({ name: n, group, w, h, file, box: b.box, ink: b.ink });
            row.push({ w, h, rgba: b.rgba });
        }
        sheetRows.push(row);
    }
}
fs.writeFileSync(path.join(OUT, 'baked', 'index.json'), JSON.stringify(index, null, 1) + '\n');

// review sheet: white on black, 8 px gutters, every row one pictogram
const G = 8;
const SW = Math.max(...sheetRows.map((r) => r.reduce((s, c) => s + c.w + G, G)));
const SH = sheetRows.reduce((s, r) => s + Math.max(...r.map((c) => c.h)) + G, G);
const sheet = Buffer.alloc(SW * SH * 2);
for (let i = 0; i < SW * SH; i++) { sheet[i * 2] = 0; sheet[i * 2 + 1] = 255; }
let oy = G;
for (const r of sheetRows) {
    let ox = G;
    for (const c of r) {
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
            const a = c.rgba[(y * c.w + x) * 4 + 3];
            sheet[((oy + y) * SW + ox + x) * 2] = a;
        }
        ox += c.w + G;
    }
    oy += Math.max(...r.map((c) => c.h)) + G;
}
fs.writeFileSync(path.join(OUT, 'sheet.png'), png(SW, SH, sheet));
console.log(`pictograms: ${index.items.length} baked files, ${MARKERS.length + SYMBOLS.length - 1} SVGs, sheet ${SW}x${SH}`);
