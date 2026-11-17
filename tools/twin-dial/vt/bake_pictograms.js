#!/usr/bin/env node
'use strict';
/**
 * Package VT (2026-11-17): writes the Twin Dial pictograms of design/twin-dial/vt/pictograms.js as
 *   design/twin-dial/vt/pictograms/svg/<name>.svg         vectors, currentColor
 *   design/twin-dial/vt/pictograms/baked/<name>_<w>x<h>.png white ink + alpha, drawn by shared/icons.js paintIcon()
 *   design/twin-dial/vt/pictograms/baked/index.json         names, groups, sizes, ink boxes
 *   design/twin-dial/vt/pictograms/sheet.png                every pictogram at every size, white on black
 * Our own drawings only; nothing is read from reference/ or from the car.
 *
 *   node tools/twin-dial/vt/bake_pictograms.js [--sizes <json>]     { "<group>": [[w, h], ...], "review": 128 }
 *
 * Default sizes: fractions of R measured on reference 02 rectified, at VG's R = 300 panel px (layout rev 2,
 * provisional until VF publishes; see docs/twin-dial/VT-REPORT.md, "Pictogram sizes").
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms');
const P = require(path.join(ROOT, 'design', 'twin-dial', 'vt', 'pictograms.js'));
const icons = require(path.join(ROOT, 'shared', 'icons.js'));
Object.assign(icons.ICONS, P.ICONS);

const GROUPS = {
    tab: ['td_fuel', 'cc_warn', 'td_media', 'td_radio', 'td_phone', 'td_nav', 'td_settings'],
    gauge: ['td_fuel', 'td_fuel_side', 'cc_coolant', 'cc_battery', 'td_avg'],
    marker: ['cc_warn', 'cc_warn_solid', 'cc_info', 'cc_dot'],
    symbol: ['cc_door', 'cc_bonnet', 'cc_boot', 'cc_belt', 'cc_brake', 'cc_tyre', 'cc_engine', 'cc_washer', 'cc_oil',
        'cc_coolant', 'cc_battery', 'cc_pedal', 'cc_service', 'cc_info', 'cc_warn'],
};
let sizes = {
    tab: [[38, 38]],          // tab icons 0.125 R tall on 02 rectified (warning, pump, phone, arrow: 49-51 px at R 400) -> 37.5 at R 300
    gauge: [[32, 32]],        // the hub's fuel-bar pump ~0.11 R (H) -> 33 at R 300
    marker: [[30, 36], [28, 28]],   // package P's marker slots, unchanged
    symbol: [[54, 54], [66, 66]],   // the message symbol: VF's symbol_h_R 0.18 (M2 bottom plate) and 0.22 (M1 centre card)
    review: 128,
};
const ai = process.argv.indexOf('--sizes');
if (ai > 0) sizes = Object.assign(sizes, JSON.parse(fs.readFileSync(process.argv[ai + 1], 'utf8')));

const NOTES = {
    td_fuel: 'fuel pump (range tab, fuel bar)', td_fuel_side: 'fuel pump with the filler-side marker',
    cc_coolant: 'coolant temperature: thermometer in waves', cc_battery: 'battery / charging: box, terminals, - and +',
    cc_oil: 'engine oil: oil can with a drop', cc_bonnet: 'bonnet open: car side view, front lid raised',
    cc_boot: 'boot open: car side view, rear lid raised', cc_pedal: 'ready to drive / press the brake: foot on pedal',
    cc_service: 'service due: spanner', td_media: 'media: beamed notes', td_radio: 'radio: mast with waves',
    td_phone: 'phone: handset front', td_avg: 'average sign: ring with a slash', td_nav: 'navigation: arrowhead', td_settings: 'settings: cog',
    cc_warn: 'warning: outline triangle with "!" (package P)', cc_warn_solid: 'warning, filled (package P)',
    cc_info: 'information: "i" (package P)', cc_dot: 'neutral dot (package P)', cc_door: 'door open (package P)',
    cc_belt: 'seat belt (package P)', cc_brake: 'brake system (package P)', cc_tyre: 'tyre pressure (package P)',
    cc_engine: 'engine (package P)', cc_washer: 'washer fluid (package P)',
};

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function png(w, h, ga) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 4;
    const raw = Buffer.alloc((w * 2 + 1) * h);
    for (let y = 0; y < h; y++) ga.copy(raw, y * (w * 2 + 1) + 1, y * w * 2, (y + 1) * w * 2);
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
const index = { generator: 'tools/twin-dial/vt/bake_pictograms.js', source: 'design/twin-dial/vt/pictograms.js',
    licence: 'MIT (repository LICENSE); our own drawings', format: 'PNG, 8-bit grey+alpha, white ink; alpha = coverage',
    provisional: 'sizes at R = 300 panel px (VG layout rev 2); re-bake with --sizes if R changes', groups: GROUPS, items: [] };
const rows = [];
const done = new Set();
for (const [group, names] of Object.entries(GROUPS)) {
    for (const n of names) {
        if (!fs.existsSync(path.join(OUT, 'svg', n + '.svg')) || !done.has(n)) fs.writeFileSync(path.join(OUT, 'svg', n + '.svg'), P.svg(n, NOTES[n]));
        const row = [];
        for (const [w, h] of sizes[group].concat(done.has(n) ? [] : [[sizes.review, sizes.review]])) {
            const b = bake(n, w, h);
            const file = `${n}_${w}x${h}.png`;
            fs.writeFileSync(path.join(OUT, 'baked', file), png(w, h, b.ga));
            if (!index.items.some((it) => it.file === file)) index.items.push({ name: n, group, w, h, file, box: b.box, ink: b.ink });
            row.push({ w, h, rgba: b.rgba });
        }
        done.add(n);
        rows.push(row);
    }
}
fs.writeFileSync(path.join(OUT, 'baked', 'index.json'), JSON.stringify(index, null, 1) + '\n');

const G = 8;
const SW = Math.max(...rows.map((r) => r.reduce((s, c) => s + c.w + G, G)));
const SH = rows.reduce((s, r) => s + Math.max(...r.map((c) => c.h)) + G, G);
const sheet = Buffer.alloc(SW * SH * 2);
for (let i = 0; i < SW * SH; i++) sheet[i * 2 + 1] = 255;
let oy = G;
for (const r of rows) {
    let ox = G;
    for (const c of r) {
        for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) sheet[((oy + y) * SW + ox + x) * 2] = c.rgba[(y * c.w + x) * 4 + 3];
        ox += c.w + G;
    }
    oy += Math.max(...r.map((c) => c.h)) + G;
}
fs.writeFileSync(path.join(OUT, 'sheet.png'), png(SW, SH, sheet));
console.log(`twin-dial pictograms: ${index.items.length} baked files, ${done.size} SVGs, sheet ${SW}x${SH}`);
