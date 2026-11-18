'use strict';
// research3 MT: the app's own cost of reading its scene textures at start (CPU and bytes read), per encoding on disk:
// today's JSON with base64 (shared/hud.js _scene: data.json + Buffer.from(b64)), raw bytes, and zlib-deflated raw.
//   node tools/research3/mt/load_cost.js <scratch dir> [runs]
// The Mac's CPU is not the head unit's: the ratios between encodings transfer, the milliseconds do not.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..', '..');
const SCENE = path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene');
const out = process.argv[2];
const runs = Number(process.argv[3]) || 5;
const names = fs.readdirSync(SCENE).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
// write the alternative encodings
names.forEach((n) => {
    const j = JSON.parse(fs.readFileSync(path.join(SCENE, n + '.json'), 'utf8'));
    const buf = Buffer.from(j.r8 || j.rgba, 'base64');
    fs.writeFileSync(path.join(out, n + '.bin'), buf);
    fs.writeFileSync(path.join(out, n + '.z'), zlib.deflateSync(buf, { level: 9 }));
});
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const res = {};
['json', 'bin', 'z'].forEach((k) => { res[k] = { bytes: 0, ms: [] }; });
for (let r = 0; r < runs; r++) {
    let t = process.hrtime.bigint(), b = 0;
    names.forEach((n) => { const s = fs.readFileSync(path.join(SCENE, n + '.json'), 'utf8'); b += s.length; const j = JSON.parse(s); Buffer.from(j.r8 || j.rgba, 'base64'); });
    res.json.ms.push(ms(t)); res.json.bytes = b;
    t = process.hrtime.bigint(); b = 0;
    names.forEach((n) => { const x = fs.readFileSync(path.join(out, n + '.bin')); b += x.length; });
    res.bin.ms.push(ms(t)); res.bin.bytes = b;
    t = process.hrtime.bigint(); b = 0;
    names.forEach((n) => { const x = fs.readFileSync(path.join(out, n + '.z')); b += x.length; zlib.inflateSync(x); });
    res.z.ms.push(ms(t)); res.z.bytes = b;
}
Object.keys(res).forEach((k) => { const a = res[k].ms.slice().sort((x, y) => x - y); res[k].median_ms = +a[a.length >> 1].toFixed(1); res[k].min_ms = +a[0].toFixed(1); res[k].max_ms = +a[a.length - 1].toFixed(1); delete res[k].ms; });
console.log(JSON.stringify({ node: process.version, runs, files: names.length, res }, null, 1));
