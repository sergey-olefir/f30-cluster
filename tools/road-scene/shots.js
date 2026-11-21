'use strict';
/**
 * tools/road-scene/shots.js - Road Scene's mockups (round fixes-1121 RS): every demo entry, day and night, on both placements,
 * into bake/work/fixes-1121/road-scene/ (git-ignored):
 *
 *   node tools/road-scene/shots.js [--lang en] [--out <dir>] [--only 05,36]
 *
 *   centre/<nn>_<name>_<day|night>.png   the centre page as the HMI gets it (the software path: paint.js centre through the kit's
 *                                        record.js into its canvas), 1600 x 520
 *   map/<nn>_<name>_<day|night>.png      the map target's core (x 334..754, y 44..416, 420 x 372) as the six layers draw it: the
 *                                        three effects run by the app's OWN shipped shaders in headless Chrome's WebGL 1 (GLSL ES
 *                                        1.00, ANGLE / SwiftShader), the two sheets as images, composited in z order on black
 *   contact_<day|night>.png              not made; index.html shows them all
 *   index.html                           every picture, day and night side by side
 * Auto Beam's 5 scenes are played through the real algorithm (scenes.js Player) and shot at 2, 5 and 8 s; ACC View's scenes at 3 s.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const APP = path.join(ROOT, 'apps', 'road_scene');
const M = require(path.join(APP, 'model.js'));
const P = require(path.join(APP, 'paint.js'));
const C = require(path.join(APP, 'contract.js'));
const BV = require(path.join(APP, 'beam_view.js'));
const SC = require(path.join(APP, 'scenes.js'));
const Score = require(path.join(APP, 'score.js'));
const Rec = require(path.join(ROOT, 'kit', 'runtime', 'record.js'));
const { Canvas } = require(path.join(ROOT, 'kit', 'runtime', 'canvas.js'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
const lang = args.indexOf('--lang') >= 0 ? args[args.indexOf('--lang') + 1] : 'uk';
const OUT = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'bake', 'work', 'fixes-1121', 'road-scene' + (lang === 'uk' ? '' : '-' + lang));
const only = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1].split(',') : null;
['centre', 'map'].forEach((d) => fs.mkdirSync(path.join(OUT, d), { recursive: true }));
const app = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const sj = JSON.parse(fs.readFileSync(path.join(APP, 'hud', 'shaders.json'), 'utf8'));

/** Every entry as a state: [file stem, state]. */
function entries() {
    const out = [];
    const pl = new SC.Player(new C.Decider(app.config.algo, { info() {}, warn() {}, error() {} }, 'normal'));
    M.DEMO.forEach((d) => {
        if (only && only.indexOf(d[0]) < 0) return;
        const e = d[2];
        if (e.beamScene) {
            // the scene on its own clock, forward only (main.js's way): one run, three moments taken from it
            const at = {};
            for (let t = 0; t <= 8000; t += 100) { const r0 = pl.step(e.beamScene, t); if (t === 2000 || t === 5000 || t === 8000) at[t] = r0; }
            [2000, 5000, 8000].forEach((ms) => {
                const r = at[ms];
                const v = BV.viewOf({ out: r.out, lamps: r.lamps, data: 'ok', speed: r.world.speed, limit: r.world.limit, curve: r.world.curve, town: r.out.town, now: 15100 + ms, score: new Score({}).summary() });
                out.push([d[0] + '_' + d[1] + '_' + (ms / 1000) + 's', Object.assign(M.withBeamScene(e, v, r.world), { e: r.lamps === 'high' ? 1 : 0 })]);
            });
        } else {
            const s = M.withScene(e, 3000);
            const b = s.beam || BV.NONE;
            out.push([d[0] + '_' + d[1], Object.assign({}, s, { beam: b, e: b.lamps === 'high' || b.lamps === 'flash' ? 1 : 0 })]);
        }
    });
    return out;
}

const list = entries();
const frames = [];
const IMG = 0x52530001;
list.forEach((en) => {
    [false, true].forEach((night) => {
        const name = en[0] + '_' + (night ? 'night' : 'day'), s = en[1];
        const pg = P.centre(s, { night, lang, info: { age: s.data === 'ok' ? 0.5 : s.data === 'stale' ? 2 : null }, demo: en[0].slice(0, 2) });
        Rec.setImage(IMG, P.PAGE_W, P.PAGE_H, pg.px);
        const rc = new Rec.Recorder(1600, 520);
        rc.clear(M.colours('centre', night).bg);
        rc.image(IMG, 0, 520 - P.PAGE_H, P.PAGE_W, P.PAGE_H);
        const cv = new Canvas(1600, 520);
        Rec.play(rc.words(), cv);
        fs.writeFileSync(path.join(OUT, 'centre', name + '.png'), cv.png(6));
        // the map's six layers as mapview.js sends them
        const g = M.GEO.map, lead = M.leadPlace(s), z = lead ? lead.z : 0, yld = !!(s.beam && s.beam.yield);
        const box = lead ? M.carBox(g, z, lead.y) : null, eb = M.egoBox(g, s);
        frames.push({
            name, yld,
            layers: [
                { kind: 'fx', fs: 'acc_lane', rect: g.lane, u: M.laneUniforms(g, s, z, night) },
                { kind: 'fx', fs: 'acc_obj', rect: g.lane, u: M.objUniforms(g, s, night) },
                box ? { kind: 'fx', fs: 'acc_car', rect: box, u: M.carUniforms(s, night, box[2], box[3]) } : null,
                { kind: 'fx', fs: 'acc_car', rect: eb, u: M.egoUniforms(s, night, eb[2], eb[3]) },
                { kind: 'img', rect: g.text, px: P.textSheet(s, night, lang).toString('base64') },
                { kind: 'img', rect: g.pill, px: P.pillSheet(s, night, lang).toString('base64') },
            ].filter(Boolean),
        });
    });
});
console.log('centre pages: ' + frames.length + ' in ' + path.relative(ROOT, path.join(OUT, 'centre')));

// the map: the app's own shaders in headless Chrome (WebGL 1), batched
function renderMaps(batch) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'road-scene-shots-'));
    const html = '<!doctype html><meta charset="utf-8"><body><pre id="o">running</pre><script>\n' +
        'const SH = ' + JSON.stringify(sj) + ';\nconst F = ' + JSON.stringify(batch) + ';\n' +
        'const VS = "attribute vec2 a_pos; uniform vec4 u_rect; uniform vec2 u_tgt; varying vec2 v_uv; void main(){ v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); vec2 p = (u_rect.xy + v_uv * u_rect.zw) / u_tgt; gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0); }";\n' +
        'const IFS = "precision mediump float; varying vec2 v_uv; uniform sampler2D u_img; void main(){ gl_FragColor = texture2D(u_img, v_uv); }";\n' +
        'const c = document.createElement("canvas"); c.width = 1088; c.height = 480; const gl = c.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false });\n' +
        'const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };\n' +
        'const progs = {}; const prog = (fs) => { if (!progs[fs]) { const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs === "img" ? IFS : SH[fs])); gl.linkProgram(p); progs[fs] = p; } return progs[fs]; };\n' +
        'const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);\n' +
        'gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.viewport(0, 0, 1088, 480);\n' +
        'const crop = document.createElement("canvas"); crop.width = 420; crop.height = 372; const cx = crop.getContext("2d"); const out = [];\n' +
        'for (const f of F) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);\n' +
        ' if (!f.yld) for (const L of f.layers) { const p = prog(L.kind === "img" ? "img" : L.fs); gl.useProgram(p); const a = gl.getAttribLocation(p, "a_pos"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);\n' +
        '  gl.uniform4fv(gl.getUniformLocation(p, "u_rect"), new Float32Array(L.rect)); gl.uniform2fv(gl.getUniformLocation(p, "u_tgt"), new Float32Array([1088, 480]));\n' +
        '  if (L.kind === "img") { const bin = atob(L.px); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, L.rect[2], L.rect[3], 0, gl.RGBA, gl.UNSIGNED_BYTE, u8); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.uniform1i(gl.getUniformLocation(p, "u_img"), 0); }\n' +
        '  else { for (const k of Object.keys(L.u)) { const v = L.u[k]; const u = gl.getUniformLocation(p, k) || gl.getUniformLocation(p, k + "[0]"); if (u) gl["uniform" + (v.length > 4 ? 4 : v.length) + "fv"](u, new Float32Array(v)); } }\n' +
        '  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }\n' +
        ' cx.clearRect(0, 0, 420, 372); cx.drawImage(c, 334, 44, 420, 372, 0, 0, 420, 372); out.push(f.name + " " + crop.toDataURL("image/png")); }\n' +
        'document.getElementById("o").textContent = out.join("\\n");\n</script>';
    const file = path.join(work, 'maps.html');
    fs.writeFileSync(file, html);
    const r = spawnSync(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--virtual-time-budget=60000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 300000, maxBuffer: 512 * 1048576 });
    const txt = ((r.stdout || '').match(/<pre id="o">([\s\S]*?)<\/pre>/) || [])[1] || '';
    let n = 0;
    txt.split('\n').forEach((ln) => {
        const m = /^(\S+) data:image\/png;base64,(\S+)$/.exec(ln.trim());
        if (!m) return;
        fs.writeFileSync(path.join(OUT, 'map', m[1] + '.png'), Buffer.from(m[2], 'base64'));
        n++;
    });
    try { require('child_process').execFileSync('rm', ['-rf', work]); } catch (e) { /* left behind */ }
    return n;
}
if (fs.existsSync(CHROME)) {
    let n = 0;
    for (let i = 0; i < frames.length; i += 24) n += renderMaps(frames.slice(i, i + 24));
    console.log('map cores: ' + n + ' of ' + frames.length + ' in ' + path.relative(ROOT, path.join(OUT, 'map')) + ' (the app\'s own shaders, WebGL 1)');
} else console.log('map cores: skipped (no Chrome)');

// the index: day and night side by side
const rows = list.map((en) => '<tr><td>' + en[0] + '</td>' + ['day', 'night'].map((l) => '<td><img src="centre/' + en[0] + '_' + l + '.png" width="800"></td>').join('') +
    ['day', 'night'].map((l) => '<td><img src="map/' + en[0] + '_' + l + '.png" width="315"></td>').join('') + '</tr>').join('\n');
fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Road Scene mockups</title><style>body{background:#111;color:#ddd;font:13px sans-serif}td{padding:3px;vertical-align:top}</style>' +
    '<h3>Road Scene 0.1.0: centre page (day, night) and the cluster map core (day, night), ' + lang + '</h3><table>' + rows + '</table>\n');
console.log('index: ' + path.relative(ROOT, path.join(OUT, 'index.html')));
