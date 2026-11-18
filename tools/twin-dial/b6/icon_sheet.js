#!/usr/bin/env node
'use strict';
/**
 * Package B6 (round 3b): paints every pictogram of design/twin-dial/vt/pictograms.js with the engine's own painter
 * (shared/icons.js paintIcon) at its slot sizes (apps/twin_dial/hud/icons/icons.json) and writes the alpha planes for
 * tools/twin-dial/b6/icon_sheet.py, which lays them out on a labelled sheet at 1x and 4x.
 *
 *   node tools/twin-dial/b6/icon_sheet.js <out dir> [scale ...]     (default scales 1 4)
 *
 * <out dir>/icons.json: [{ name, slot, w, h, scale, off }], <out dir>/icons.bin: the alpha bytes. Nothing is shipped.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const icons = require(path.join(ROOT, 'shared', 'icons.js'));
require(path.join(ROOT, 'shared', 'twin_icons.js'));
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'hud', 'icons', 'icons.json'), 'utf8'));
const out = process.argv[2];
if (!out) { console.error('usage: icon_sheet.js <out dir> [scale ...]'); process.exit(2); }
const scales = process.argv.slice(3).map(Number).filter(Boolean);
if (!scales.length) scales.push(1, 4);
fs.mkdirSync(out, { recursive: true });
const rows = [], bufs = [];
let off = 0;
for (const it of man.items) {
    for (const sc of scales) {
        const w = it.w * sc, h = it.h * sc;
        const px = icons.paintIcon(it.name, w, h, [255, 255, 255, 255]);
        const a = Buffer.alloc(w * h);
        for (let i = 0; i < w * h; i++) a[i] = px[i * 4 + 3];
        rows.push({ name: it.name, slot: it.slot, w, h, scale: sc, off });
        bufs.push(a); off += a.length;
    }
}
fs.writeFileSync(path.join(out, 'icons.bin'), Buffer.concat(bufs));
fs.writeFileSync(path.join(out, 'icons.json'), JSON.stringify(rows));
console.log(rows.length + ' paintings, ' + off + ' bytes -> ' + out);
