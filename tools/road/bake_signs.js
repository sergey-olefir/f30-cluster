'use strict';
/**
 * tools/road/bake_signs.js - the Road View sign atlas of each theme (round "Road View", package TD), from the vector definitions
 * in shared/road_signs.js. One RGBA8 scene texture per app (colour needs it; nothing here is a mask, so no R8):
 *
 *   node tools/road/bake_signs.js            writes apps/f30_cluster/hud/scene/rv_signs.json   (88 px cells, style "6wb")
 *                                                   apps/twin_dial/hud/scene/rv_signs.json     (52 px cells, style "td")
 *   node tools/road/bake_signs.js --check    exits 1 when a written atlas differs from what the definitions make now
 *
 * The file is the engine's scene-texture format (shared/hud.js _scene: { w, h, rgba (base64) }) plus the cell table and the
 * style. Pixel memory on the car: w * h * 4 bytes, counted twice by cluster-render.
 */
const fs = require('fs');
const path = require('path');
const R = require('../../shared/road_signs');

const ROOT = path.join(__dirname, '..', '..');
const THEMES = [
    { app: 'f30_cluster', style: '6wb', cell: 88, cols: 8 },
    { app: 'twin_dial', style: 'td', cell: 52, cols: 8 },
];

function make(t) {
    const a = R.atlas(t.style, t.cell, t.cols);
    return { w: a.w, h: a.h, style: t.style, cell: a.cell, cols: a.cols, order: R.ORDER, cells: a.cells,
        _about: 'Road View (round "Road View", package TD): our own sign drawings (shared/road_signs.js, after the Vienna convention\'s generic shapes), baked by tools/road/bake_signs.js. RGBA8, straight alpha.',
        rgba: a.rgba.toString('base64') };
}

const check = process.argv.indexOf('--check') >= 0;
let bad = 0;
THEMES.forEach((t) => {
    const out = path.join(ROOT, 'apps', t.app, 'hud', 'scene', 'rv_signs.json');
    const j = make(t);
    const text = JSON.stringify(j) + '\n';
    if (check) {
        const was = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
        if (was !== text) { bad++; console.log(t.app + ': rv_signs.json differs from the definitions'); } else console.log(t.app + ': rv_signs.json up to date');
        return;
    }
    fs.writeFileSync(out, text);
    console.log(t.app + ': rv_signs.json ' + j.w + 'x' + j.h + ' RGBA8 (' + R.ORDER.length + ' signs, ' + t.cell + ' px cells, style ' + t.style + '), ' +
        (j.w * j.h * 4) + ' bytes, ' + (j.w * j.h * 4 * 2 / 1048576).toFixed(2) + ' MiB of pixel memory (counted twice), file ' + text.length + ' bytes');
});
if (bad) process.exit(1);
