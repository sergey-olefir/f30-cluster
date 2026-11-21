'use strict';
/**
 * tools/road-scene/bake_shaders.js - Road Scene's shipped shader text (round fixes-1121 RS): apps/road_scene/hud/shaders.json holds
 * each effect shader of apps/road_scene/shaders/*.glsl as the app sends it, comments and blank lines stripped and runs of spaces
 * collapsed (tools/acc-view/lane_gl.py's shipped(), the measure the KOMBI's limit is known in: 26.7 k reset, 25.4 k accepted).
 *
 *   node tools/road-scene/bake_shaders.js [--check]      writes the file (or, with --check, exits 1 when it differs)
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..', 'apps', 'road_scene');

function shipped(src) {
    const s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return s.split('\n').map((ln) => ln.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n') + '\n';
}
function all() {
    const out = {};
    fs.readdirSync(path.join(APP, 'shaders')).filter((f) => /\.glsl$/.test(f)).sort().forEach((f) => { out[f.slice(0, -5)] = shipped(fs.readFileSync(path.join(APP, 'shaders', f), 'utf8')); });
    return out;
}
function text(sh) {
    const keys = Object.keys(sh).sort(), o = {};
    keys.forEach((k) => { o[k] = sh[k]; });
    return JSON.stringify(o, null, 1) + '\n';
}

module.exports = { shipped, all, text, APP };

if (require.main === module) {
    const sh = all(), t = text(sh), file = path.join(APP, 'hud', 'shaders.json');
    if (process.argv.indexOf('--check') >= 0) {
        const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === t;
        console.log(same ? 'hud/shaders.json is up to date' : 'hud/shaders.json differs: run node tools/road-scene/bake_shaders.js');
        process.exit(same ? 0 : 1);
    }
    fs.writeFileSync(file, t);
    console.log('shaders.json: ' + Object.keys(sh).map((k) => k + ' ' + Buffer.byteLength(sh[k]) + ' B').join(', ') + ', together ' + Object.keys(sh).reduce((n, k) => n + Buffer.byteLength(sh[k]), 0) + ' B');
}
