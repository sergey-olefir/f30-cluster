'use strict';
/**
 * bench/road_scene/common.js - what bench/test-road-scene.js's parts share (round fixes-1121 RS): the one counter, the paths,
 * the colour census, the recording stand-in for cluster_render_client, the bench's HTTP helpers. The parts are ACC View's suite
 * (acc.js), AL's lane suite (lanes.js), Auto Beam's suite (beam.js), each carried over to the merged app, and the merge's own
 * checks (merged.js).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const APPDIR = path.join(ROOT, 'apps', 'road_scene');
const args = process.argv.slice(2);
const PORT = Number(args.indexOf('--port') >= 0 ? args[args.indexOf('--port') + 1] : process.env.BENCH_PORT || 8941);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const T = { pass: 0, fail: 0 };
function ok(c, what) { if (c) T.pass++; else { T.fail++; console.log('FAIL ' + what); } }

const CYR = /[\u0400-\u04FF]/;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const isRed = (r, g, b) => r > 150 && g < 90 && b < 90;
const near = (r, g, b, c, d) => Math.abs(r - c[0]) <= d && Math.abs(g - c[1]) <= d && Math.abs(b - c[2]) <= d;
/** Counts per colour role over opaque pixels (x0..x1 of a w-wide picture when given). */
function census(px, Q, x0, x1, w, minA) {
    let red = 0, amber = 0, cyan = 0, green = 0, blue = 0;
    const ma = minA === undefined ? 1 : minA;
    for (let i = 0; i < px.length; i += 4) {
        if (x0 !== undefined && x0 !== null) { const x = (i / 4) % w; if (x < x0 || x >= x1) continue; }
        if (px[i + 3] < ma) continue;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (isRed(r, g, b)) red++;
        if (near(r, g, b, Q.amber, 6)) amber++;
        if (near(r, g, b, Q.cyan, 6)) cyan++;
        if (near(r, g, b, Q.green, 6)) green++;
        if (Q.blue && near(r, g, b, Q.blue, 8)) blue++;
    }
    return { red, amber, cyan, green, blue };
}
const nullLog = () => { const lines = []; return { lines, info: (s) => lines.push(s), warn: (s) => lines.push(s), error: (s) => lines.push('E ' + s) }; };

/** A recording stand-in for cluster_render_client's ClusterRender (the messages MapView sends, with their sizes). */
function FakeCR() {
    this.layers = []; this.msgs = [];
    this.on = () => this; this.connect = () => {}; this.close = () => { this.closed = true; };
}
FakeCR.prototype._add = function (kind, o) { this.layers.push({ kind, o: Object.assign({}, o) }); this.msgs.push({ op: 'layer', kind, bytes: JSON.stringify(o).length }); return this.layers.length; };
FakeCR.prototype.effect = function (o) { return this._add('effect', o); };
FakeCR.prototype.image = function (o) { return this._add('image', o); };
FakeCR.prototype.set = function (ref, o) { Object.assign(this.layers[ref - 1].o, o); this.msgs.push({ op: 'set', ref, o: Object.assign({}, o), bytes: JSON.stringify(o).length + 20 }); };
FakeCR.prototype.uniform = function (ref, name, v, o) { this.msgs.push({ op: 'uniform', ref, name, v: v.slice(), type: o && o.type, bytes: v.join(' ').length + name.length + 30 }); };
FakeCR.prototype.pixels = function (ref, rects, px) { this.msgs.push({ op: 'pixels', ref, rects, bytes: px.length }); };
/** A MapView on a fresh FakeCR. */
function mapOn(MapView, layer, shaders) {
    const fake = new FakeCR();
    const mv = new MapView(null, { layer, socket: 'x', shaders });
    mv.CR = { ClusterRender: function () { return fake; } };
    mv.open();
    return { mv, fake };
}

function request(method, url, body, port) {
    return new Promise((resolve) => {
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const rq = http.request({ host: '127.0.0.1', port: port || PORT, path: url, method, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }));
        });
        rq.on('error', () => resolve({ status: 0, body: Buffer.alloc(0) }));
        if (data) rq.write(data);
        rq.end();
    });
}
/** The bench's event stream, kept open: its scene messages and the pixel notices (t 'px'). */
function stream(port) {
    const s = { scene: null, px: [], close: () => {} };
    let buf = '';
    const rq = http.get({ host: '127.0.0.1', port: port || PORT, path: '/events' }, (res) => {
        res.on('data', (c) => {
            buf += c.toString('utf8');
            const lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach((ln) => {
                const t = ln.replace(/^data:\s*/, '').trim();
                if (!t || t[0] !== '{') return;
                try { const m = JSON.parse(t); if (m.t === 'scene') s.scene = m.layers || []; else if (m.t === 'px') s.px.push(m); } catch (e) { /* not this one */ }
            });
        });
    });
    rq.on('error', () => {});
    s.close = () => { try { rq.abort(); } catch (e) { /* gone */ } };
    return s;
}
/** A PNG the kit wrote (8-bit RGBA, any filter) -> { w, h, px }. */
function readPng(file) {
    const b = fs.readFileSync(file);
    let i = 8, w = 0, h = 0;
    const idat = [];
    while (i < b.length) {
        const len = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8), body = b.slice(i + 8, i + 8 + len);
        if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); }
        if (type === 'IDAT') idat.push(body);
        i += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat)), st = w * 4, px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (st + 1)];
        for (let x = 0; x < st; x++) {
            const v = raw[y * (st + 1) + 1 + x], a = x >= 4 ? px[y * st + x - 4] : 0, up = y ? px[(y - 1) * st + x] : 0, ul = y && x >= 4 ? px[(y - 1) * st + x - 4] : 0;
            let p = v;
            if (f === 1) p = v + a; else if (f === 2) p = v + up; else if (f === 3) p = v + ((a + up) >> 1);
            else if (f === 4) { const q = a + up - ul, pa = Math.abs(q - a), pb = Math.abs(q - up), pc = Math.abs(q - ul); p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul); }
            px[y * st + x] = p & 255;
        }
    }
    return { w, h, px };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A headless Chrome WebGL 1 run: shaders { name: text }, uniforms { run: { shader, size: [w, h], u } } -> { dom, res: { run: { okc, okl, lit } } }. */
function webgl(shaders, runs) {
    const { spawnSync } = require('child_process');
    const os = require('os');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'road-scene-gl-'));
    const html = '<!doctype html><meta charset="utf-8"><body><pre id="o">running</pre><script>\n' +
        'const SH = ' + JSON.stringify(shaders) + ';\nconst RUNS = ' + JSON.stringify(runs) + ';\n' +
        'const VS = "attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }";\n' +
        'const out = []; const c = document.createElement("canvas"); c.width = 420; c.height = 260; const gl = c.getContext("webgl");\n' +
        'out.push("webgl " + (gl ? gl.getParameter(gl.SHADING_LANGUAGE_VERSION) : "none") + " fuv " + (gl ? gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) : 0));\n' +
        'for (const n of Object.keys(RUNS)) { const R = RUNS[n]; c.width = R.size[0]; c.height = R.size[1]; gl.viewport(0, 0, R.size[0], R.size[1]);\n' +
        ' const mk = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };\n' +
        ' const v = mk(gl.VERTEX_SHADER, VS), f = mk(gl.FRAGMENT_SHADER, SH[R.shader]); const okc = gl.getShaderParameter(f, gl.COMPILE_STATUS);\n' +
        ' const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); const okl = gl.getProgramParameter(p, gl.LINK_STATUS);\n' +
        ' let lit = 0; if (okc && okl) { gl.useProgram(p); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);\n' +
        '  const l = gl.getAttribLocation(p, "a_pos"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);\n' +
        '  for (const k of Object.keys(R.u)) { const a = R.u[k]; const u = gl.getUniformLocation(p, k) || gl.getUniformLocation(p, k + "[0]"); if (u) gl["uniform" + (a.length > 4 ? 4 : a.length) + "fv"](u, new Float32Array(a)); }\n' +
        '  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); const px = new Uint8Array(R.size[0] * R.size[1] * 4); gl.readPixels(0, 0, R.size[0], R.size[1], gl.RGBA, gl.UNSIGNED_BYTE, px); for (let i = 3; i < px.length; i += 4) if (px[i] > 128) lit++; }\n' +
        ' out.push(n + " compile " + okc + " link " + okl + " lit " + lit + " log " + JSON.stringify(gl.getShaderInfoLog(f) || "")); }\n' +
        'document.getElementById("o").textContent = out.join("\\n");\n</script>';
    const file = path.join(work, 'gl.html');
    fs.writeFileSync(file, html);
    const r = spawnSync(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--virtual-time-budget=5000', '--dump-dom', 'file://' + file], { encoding: 'utf8', timeout: 90000 });
    const dom = (r.stdout || '').replace(/&quot;/g, '"');
    const res = {};
    Object.keys(runs).forEach((n) => { const m = new RegExp('\\b' + n + ' compile (\\w+) link (\\w+) lit (\\d+)').exec(dom); res[n] = m ? { okc: m[1] === 'true', okl: m[2] === 'true', lit: Number(m[3]) } : null; });
    try { require('child_process').execFileSync('rm', ['-rf', work]); } catch (e) { /* left behind */ }
    return { dom, res, text: ((dom.match(/<pre id="o">([\s\S]*?)<\/pre>/) || [])[1] || 'no output') };
}

module.exports = { ROOT, APPDIR, args, PORT, CHROME, T, ok, CYR, stripComments, isRed, near, census, nullLog, FakeCR, mapOn, request, stream, readPng, sleep, webgl };
