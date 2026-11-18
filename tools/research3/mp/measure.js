#!/usr/bin/env node
'use strict';
/**
 * Research round 3, package MP (docs/research3/MP-REPORT.md): what an app built on the shared engine costs
 * cluster-render, measured on the Mac with no car and no browser.
 *
 *   node tools/research3/mp/measure.js <app id> [--runs N] [--out <file.json>] [--snap <dir>] [--steady <ms>]
 *                                          [--no-build] [--quick]
 *
 * It builds the app with the kit (kit/tools/build.py -> dist/<app>, as bench/server.js does), stands in for
 * cluster-render on a Unix socket of its own (protocol v1, the bench's limits: 32 layers, 16 / 32 assets, 16 MiB of
 * pixel memory with every image and asset counted twice), runs the built app in the kit's stub head unit
 * (bench/run-app.js, with tools/research3/mp/preload.js for the app-side JS times) and drives a scenario:
 *
 *   f30_cluster : start (Comfort) -> steady -> Sport -> steady -> Eco Pro -> steady -> Comfort -> steady -> night -> day
 *                 -> G20 on -> steady -> G20 off -> a message -> no message
 *   twin_dial   : start -> steady (the centre page cycles) -> page trip -> page clock -> night -> day -> a message
 *                 -> no message -> redline / band gain
 *   any other   : start -> steady
 *
 * Car-like signals go in 300 ms after the app starts, as the car's getters answer on subscribe: the time zone,
 * the resting ccList entry, "no message shown now" and day. Demo driving throughout (the kit's sim.js).
 *
 * Every message the app writes is recorded with its time, connection, op, ref and bytes on the wire; per phase it
 * prints and writes: messages and bytes by kind, pixel bytes (frame payloads: what cluster-render's upload budget
 * paces), layers / assets made and dropped, the pixel-memory peak, the time and bytes to the first complete frame
 * (every layer of the final set made, every image layer's and every sampled asset's whole pixels arrived), the same
 * at the car's upload budget (floor 2000 KB/s, ceiling 5500), identical pixels sent again, and in steady phases
 * the rates per layer and uniform. --snap writes each settled layout as a scene snapshot in tools/strip/O's format
 * (scene.json + px/*.raw) for tools/research3/mp/gpu.py. Bench numbers: the bytes, counts and orders transfer to the
 * car; the milliseconds do not (Mac CPU, Node 22 against the car's Node 8).
 *
 * Exits by itself; it ends its own app child. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { fork, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const APP = argv[0];
const opt = (k, d) => { const i = argv.indexOf(k); return i > 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const flag = (k) => argv.indexOf(k) > 0;
if (!APP || !fs.existsSync(path.join(ROOT, 'apps', APP, 'app.json'))) { console.error('usage: measure.js <app id> [--runs N] [--out f] [--snap dir] [--steady ms] [--no-build] [--quick]'); process.exit(2); }
const RUNS = Math.max(1, Number(opt('--runs', '1')) || 1);
const QUICK = flag('--quick');
const STEADY_MS = Number(opt('--steady', QUICK ? '6000' : '15000'));
const OUT = opt('--out', null);
const SNAP = opt('--snap', null);
const WORK = path.join(ROOT, 'bake', 'work', 'research3', 'MP');
const BUDGET = { floor: 2000, ceiling: 5500 };      // KB/s, cluster-render.conf upload_floor_kb_per_s / upload_kb_per_s
const PIXEL_CAP = 16 * 1024 * 1024, TOTAL_LAYERS = 32, TOTAL_ASSETS = 32, ASSETS_PER_CLIENT = 16;
const TARGETS = { hud: [800, 480], map: [1088, 480], panel: [1920, 720] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };
const r1 = (x) => Math.round(x * 10) / 10;

/* ---------------- shaders, statically ---------------- */

function shaderStats(src) {
    const s = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const c = (re) => (s.match(re) || []).length;
    const uni = [], re = /^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)\s*(\[\s*(\d+)\s*\])?\s*;/gm;
    let m;
    while ((m = re.exec(s))) uni.push({ type: m[1], name: m[2], n: m[4] ? Number(m[4]) : 1 });
    return {
        bytes: Buffer.byteLength(src), lines: src.split('\n').length,
        samplers: uni.filter((u) => u.type === 'sampler2D').map((u) => u.name),
        uniforms: uni.filter((u) => u.type !== 'sampler2D').length,
        uniformFloats: uni.filter((u) => u.type !== 'sampler2D').reduce((a, u) => a + u.n * ({ float: 1, vec2: 2, vec3: 3, vec4: 4, mat4: 16, int: 1, bool: 1 }[u.type] || 1), 0),
        texReads: c(/\btexture2D\s*\(/g), ifs: c(/\bif\s*\(/g), loops: c(/\bfor\s*\(/g), ternaries: c(/\?/g),
        functions: c(/^\s*(?:highp\s+|mediump\s+|lowp\s+)?(?:float|vec[234]|void|bool|int|mat[234])\s+\w+\s*\([^;{]*\)\s*\{/gm),
        exp: c(/\bexp2?\s*\(/g), pow: c(/\bpow\s*\(/g), trig: c(/\b(?:sin|cos|tan|atan|asin|acos)\s*\(/g),
        smoothstep: c(/\bsmoothstep\s*\(/g), length: c(/\b(?:length|distance)\s*\(/g), sqrt: c(/\b(?:inversesqrt|sqrt)\s*\(/g),
        highp: /precision\s+highp\s+float/.test(s), style: (/#define\s+STYLE\s+(-?\d+)/.exec(s) || [])[1] || null,
        night: (/#define\s+NIGHT\s+(\d+)/.exec(s) || [])[1] || null,
        head: ((/^\s*\/\/\s*([^\n]{0,80})/.exec(src) || [])[1] || '').trim(),
    };
}

/* ---------------- the recorder: a stand-in for cluster-render ---------------- */

class Recorder {
    constructor(sockPath) {
        this.sock = sockPath;
        this.t0 = now();
        this.events = [];             // [t, conn, kind, ref, bytes, extra]
        this.layers = new Map();      // "conn:ref" -> layer
        this.conns = new Map();       // conn -> { app, ci, chunks }
        this.shaders = new Map();     // hash -> source
        this.frames = new Map();      // hash of whole pixels -> { n, bytes, keys:Set }
        this.phase = null;
        this.pixPeak = 0;
        this.nextConn = 1;
        this.lastStruct = 0;
        this.maxBuild = 0;            // the newest build marker seen (preload.js "mp-mark" at the start of each _rebuildInner)
        this.hist = new Map();        // "conn:ref" -> { kind, made, have, dropped, samplers, binds, bindAt } for every layer and asset ever made
    }
    t() { return now() - this.t0; }
    pixels() { let n = 0; this.layers.forEach((l) => { if (l.image) n += l.image.length * 2; }); return n; }
    layerCount() { let n = 0; this.layers.forEach((l) => { if (l.kind !== 'asset') n++; }); return n; }
    listen() {
        try { fs.unlinkSync(this.sock); } catch (e) { /* none */ }
        this.server = net.createServer((s) => this._conn(s));
        return new Promise((r) => this.server.listen(this.sock, r));
    }
    close() { try { this.server.close(); } catch (e) { /* closed */ } try { fs.unlinkSync(this.sock); } catch (e) { /* gone */ } }
    _ev(conn, kind, ref, bytes, extra) {
        const st = this.conns.get(conn);
        const e = [r1(this.t()), conn, kind, ref, bytes, extra || null, st ? st.build : 0];
        this.events.push(e);
        return e;
    }
    _conn(sock) {
        const conn = this.nextConn++;
        const st = { app: '?', ci: 0, buf: Buffer.alloc(0), chunks: 0, hello: false, build: this.maxBuild || 0 };
        this.conns.set(conn, st);
        const write = (obj) => {
            const body = Buffer.from(JSON.stringify(obj), 'utf8'), m = Buffer.alloc(5 + body.length);
            m.writeUInt32LE(body.length + 1, 0); m[4] = 0x4a; body.copy(m, 5);
            try { sock.write(m); } catch (e) { /* closed */ }
        };
        sock.on('error', () => {});
        sock.on('close', () => { this.layers.forEach((l, k) => { if (l.conn === conn) this.layers.delete(k); }); this._ev(conn, 'close', 0, 0); });
        sock.on('data', (d) => {
            st.chunks++;
            this._ev(conn, 'chunk', 0, d.length);
            st.buf = st.buf.length ? Buffer.concat([st.buf, d]) : d;
            let off = 0;
            while (st.buf.length - off >= 5) {
                const len = st.buf.readUInt32LE(off);
                if (st.buf.length - off < 4 + len) break;
                const type = st.buf[off + 4], body = st.buf.slice(off + 5, off + 4 + len);
                off += 4 + len;
                try { this._msg(conn, st, type, body, 4 + len, write); } catch (e) { this._ev(conn, 'bad', 0, 0, String(e.message)); }
            }
            st.buf = st.buf.slice(off);
        });
    }
    _msg(conn, st, type, body, bytes, write) {
        if (type === 0x46) return this._frame(conn, body, bytes);
        if (type !== 0x4a) { this._ev(conn, 'other', 0, bytes); return; }
        const m = JSON.parse(body.toString('utf8'));
        const key = conn + ':' + m.ref, l = this.layers.get(key), t = this.t();
        if (m.op === 'hello') {
            st.app = m.app; st.hello = true; st.build = this.maxBuild;
            const mm = /_(\d+)$/.exec(m.app || ''); st.ci = mm ? Number(mm[1]) - 1 : 0;
            this._ev(conn, 'hello', 0, bytes, m.app);
            write({ ev: 'hello', backend: 'mp-recorder', targets: Object.keys(TARGETS).join(',') });
            return;
        }
        const refuse = (reason) => { this._ev(conn, 'refused', m.ref, 0, m.op + ': ' + reason); write({ ev: 'error', op: m.op, ref: m.ref, reason }); };
        switch (m.op) {
            case 'layer': {
                this.lastStruct = t;
                let extra = { kind: m.kind, x: m.x || 0, y: m.y || 0, w: m.w || 0, h: m.h || 0, z: m.z || 0, class: m.class || 'content' };
                if (m.kind === 'image') { extra.iw = m.iw; extra.ih = m.ih; }
                let fsHash = null;
                if (m.kind === 'effect' && m.fs) {
                    fsHash = crypto.createHash('sha1').update(m.fs).digest('hex').slice(0, 12);
                    this.shaders.set(fsHash, m.fs);
                    extra.fs = fsHash; extra.fsBytes = Buffer.byteLength(m.fs);
                }
                this._ev(conn, 'layer', m.ref, bytes, extra);
                if (this.layerCount() >= TOTAL_LAYERS) return refuse('too many layers');
                if (m.kind === 'image' && this.pixels() + m.iw * m.ih * 8 > PIXEL_CAP) return refuse("the service's pixel memory is full");
                const nl = { key, conn, ref: m.ref, kind: m.kind, target: m.target, class: m.class || 'content', z: m.z || 0,
                    x: m.x || 0, y: m.y || 0, w: m.w || 0, h: m.h || 0, visible: m.visible === undefined ? 1 : m.visible,
                    opacity: m.opacity === undefined ? 1 : m.opacity, exclusive: m.exclusive || 0, uniforms: {}, binds: {}, bindAt: {},
                    made: t, have: null, fs: m.fs || null, fsHash, time: !!m.time, samplers: m.fs ? shaderStats(m.fs).samplers : [] };
                if (m.kind === 'image') { nl.iw = m.iw; nl.ih = m.ih; nl.bpp = 4; nl.image = Buffer.alloc(m.iw * m.ih * 4); }
                this.layers.set(key, nl);
                this.hist.set(key, { build: st.build, kind: m.kind, made: t, have: null, dropped: null, samplers: nl.samplers, binds: nl.binds, bindAt: nl.bindAt, px: m.kind === 'image' ? m.iw * m.ih * 4 : 0 });
                this.pixPeak = Math.max(this.pixPeak, this.pixels());
                write({ ev: 'layer', ref: m.ref, state: 'shown' });
                return;
            }
            case 'asset': {
                this.lastStruct = t;
                const format = m.format || 'rgba8', bpp = format === 'r8' ? 1 : 4;
                this._ev(conn, 'asset', m.ref, bytes, { format, w: m.w, h: m.h, sampling: m.sampling });
                let all = 0, mine = 0;
                this.layers.forEach((o) => { if (o.kind === 'asset') { all++; if (o.conn === conn) mine++; } });
                if (all >= TOTAL_ASSETS || mine >= ASSETS_PER_CLIENT) return refuse('too many assets');
                if (this.pixels() + m.w * m.h * bpp * 2 > PIXEL_CAP) return refuse("the service's pixel memory is full");
                this.layers.set(key, { key, conn, ref: m.ref, kind: 'asset', target: m.target, format, bpp, w: m.w, h: m.h, iw: m.w, ih: m.h,
                    x: 0, y: 0, class: '-', z: 0, visible: 0, made: t, have: null, image: Buffer.alloc(m.w * m.h * bpp), uniforms: {}, binds: {} });
                this.hist.set(key, { kind: 'asset', made: t, have: null, dropped: null, px: m.w * m.h * bpp, format, w: m.w, h: m.h });
                this.pixPeak = Math.max(this.pixPeak, this.pixels());
                write({ ev: 'layer', ref: m.ref, state: 'shown' });
                return;
            }
            case 'bind': {
                this._ev(conn, 'bind', m.ref, bytes, { sampler: m.sampler, asset: m.asset });
                if (!l) return refuse('no such layer');
                l.binds[m.sampler] = conn + ':' + m.asset; l.bindAt[m.sampler] = t;
                return;
            }
            case 'drop': {
                this.lastStruct = t;
                this._ev(conn, 'drop', m.ref, bytes, l ? { kind: l.kind } : null);
                if (!l) return refuse('no such layer');
                if (l.kind === 'asset') {
                    let used = false;
                    this.layers.forEach((o) => { if (o.binds && Object.keys(o.binds).some((s) => o.binds[s] === key)) used = true; });
                    if (used) return refuse('asset in use');
                }
                this.layers.delete(key);
                if (this.hist.has(key)) this.hist.get(key).dropped = t;
                return;
            }
            case 'uniform': {
                this._ev(conn, 'uniform', m.ref, bytes, m.name);
                if (!l) return refuse('no such layer');
                l.uniforms[m.name] = { v: String(m.v).trim().split(/\s+/).map(Number), type: m.type || null };
                return;
            }
            case 'set': {
                const keys = Object.keys(m).filter((k) => k !== 'op' && k !== 'ref');
                this._ev(conn, 'set', m.ref, bytes, keys.join(','));
                if (!l) return refuse('no such layer');
                keys.forEach((k) => { l[k] = m[k]; });
                return;
            }
            case 'mp-mark':
                st.build = m.n; this.maxBuild = Math.max(this.maxBuild, m.n);
                this._ev(conn, 'mark', 0, 0, m.n);
                return;
            case 'status':
                this._ev(conn, 'status', 0, bytes);
                write({ ev: 'status', text: 'mp-recorder: ' + this.layerCount() + ' layers, pixel memory ' + (this.pixels() / 1048576).toFixed(1) + ' MiB' });
                return;
            default:
                this._ev(conn, 'op:' + m.op, m.ref || 0, bytes);
        }
    }
    _frame(conn, body, bytes) {
        const ref = body.readUInt32LE(0), n = body.readUInt16LE(12), head = 14 + n * 8;
        const key = conn + ':' + ref, l = this.layers.get(key), px = body.slice(head), t = this.t();
        let hash = null;
        if (n === 0) {
            this.lastStruct = t;
            hash = crypto.createHash('sha1').update(px).digest('hex').slice(0, 12);
            const f = this.frames.get(hash) || { n: 0, bytes: px.length, keys: [] };
            f.n++; if (f.keys.length < 8) f.keys.push(key);
            this.frames.set(hash, f);
        }
        this._ev(conn, n === 0 ? 'whole' : 'rects', ref, bytes, { px: px.length, rects: n, hash, kind: l ? l.kind : '?' });
        if (!l || !l.image) return;
        if (n === 0) { if (px.length === l.image.length) px.copy(l.image); l.have = l.have === null ? t : l.have; const h = this.hist.get(key); if (h && h.have === null) h.have = t; }
        else {
            let o = 0;
            for (let i = 0; i < n; i++) {
                const x = body.readUInt16LE(14 + i * 8), y = body.readUInt16LE(16 + i * 8), w = body.readUInt16LE(18 + i * 8), h = body.readUInt16LE(20 + i * 8);
                for (let r = 0; r < h; r++) { px.copy(l.image, ((y + r) * l.iw + x) * l.bpp, o, o + w * l.bpp); o += w * l.bpp; }
            }
        }
    }
    /** The layers that are on now, as tools/strip/O/render.py's Snapshot wants them. */
    sceneMeta() {
        return Array.from(this.layers.values()).map((l) => ({
            key: l.key, conn: l.conn, ref: l.ref, kind: l.kind, target: l.target, class: l.class, z: l.z, x: l.x, y: l.y, w: l.w, h: l.h,
            visible: l.visible, opacity: l.opacity, exclusive: l.exclusive, iw: l.iw, ih: l.ih, fs: l.fs, time: l.time,
            uniforms: l.uniforms, binds: l.binds, format: l.format, state: 'shown',
        }));
    }
    snapshot(dir, label, extra) {
        fs.mkdirSync(path.join(dir, 'px'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify(Object.assign({ label, pixels: this.pixels(), layers: this.sceneMeta() }, extra || {})));
        this.layers.forEach((l) => {
            if (!l.image) return;
            let out = l.image;
            if (l.bpp === 1) { out = Buffer.alloc(l.image.length * 4); for (let i = 0; i < l.image.length; i++) { const v = l.image[i]; out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = v; } }
            fs.writeFileSync(path.join(dir, 'px', l.key.replace(':', '_') + '.raw'), out);
        });
    }
}

/* ---------------- the app ---------------- */

function build(app) {
    const sdk = path.join(ROOT, 'oap-sdk');
    if (!fs.existsSync(path.join(sdk, 'index.js'))) {
        fs.mkdirSync(sdk, { recursive: true });
        fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for the maker's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
        fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    }
    execFileSync('python3', [path.join(ROOT, 'kit', 'tools', 'build.py'), app], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
}

/* ---------------- scenarios ---------------- */

const CAR_LIKE = [{ clock: { minutes: 120, dst: false } }, { scene: 'cc-clear' }, { ccActive: { number: 0 } }, { dayNight: 'day' }];

function scenario(app) {
    const S = STEADY_MS;
    if (app === 'f30_cluster') {
        return [
            { label: 'start (6WB Comfort)', kind: 'start' },
            { label: 'steady Comfort', kind: 'steady', ms: S },
            { label: 'drive mode -> Sport', kind: 'switch', act: { t: 'drive', value: 1 } },
            { label: 'steady Sport', kind: 'steady', ms: S },
            { label: 'drive mode -> Eco Pro', kind: 'switch', act: { t: 'drive', value: 7 } },
            { label: 'steady Eco Pro', kind: 'steady', ms: S },
            { label: 'drive mode -> Comfort', kind: 'switch', act: { t: 'drive', value: 4 } },
            { label: 'steady Comfort (again)', kind: 'steady', ms: S },
            { label: 'night', kind: 'switch', act: { t: 'fake', v: { dayNight: 'night' } } },
            { label: 'day', kind: 'switch', act: { t: 'fake', v: { dayNight: 'day' } } },
            { label: 'G20 on (6WB Dials + G20)', kind: 'switch', act: { t: 'set', key: 'g20', value: true } },
            { label: 'steady Comfort + G20', kind: 'steady', ms: S },
            { label: 'a message (active-40)', kind: 'switch', act: { t: 'fake', v: { scene: 'active-40' } } },
            { label: 'no message', kind: 'switch', act: [{ t: 'fake', v: { scene: 'cc-clear' } }, { t: 'fake', v: { ccActive: { number: 0 } } }] },
            { label: 'G20 off', kind: 'switch', act: { t: 'set', key: 'g20', value: false } },
            { label: 'drive mode -> Sport (2nd)', kind: 'switch', act: { t: 'drive', value: 1 } },
            { label: 'drive mode -> Comfort (2nd)', kind: 'switch', act: { t: 'drive', value: 4 } },
        ];
    }
    if (app === 'twin_dial') {
        return [
            { label: 'start (Twin Dial)', kind: 'start' },
            { label: 'steady (centre cycles)', kind: 'steady', ms: Math.max(S, 21000) },
            { label: 'page -> trip', kind: 'switch', act: { t: 'set', key: 'centre', value: 'trip' } },
            { label: 'page -> clock', kind: 'switch', act: { t: 'set', key: 'centre', value: 'clock' } },
            { label: 'steady (clock page)', kind: 'steady', ms: S },
            { label: 'night', kind: 'switch', act: { t: 'fake', v: { dayNight: 'night' } } },
            { label: 'day', kind: 'switch', act: { t: 'fake', v: { dayNight: 'day' } } },
            { label: 'a message (active-40)', kind: 'switch', act: { t: 'fake', v: { scene: 'active-40' } } },
            { label: 'no message', kind: 'switch', act: [{ t: 'fake', v: { scene: 'cc-clear' } }, { t: 'fake', v: { ccActive: { number: 0 } } }] },
            { label: 'redline 6000', kind: 'switch', act: { t: 'set', key: 'redline', value: 6000 } },
            { label: 'band gain 1.2', kind: 'switch', act: { t: 'set', key: 'bandGain', value: 1.2 } },
            { label: 'drive mode -> Sport', kind: 'switch', act: { t: 'drive', value: 1 } },
            // the centre page cycles only below holdAboveKmh (5 km/h): parked, the clock and trip pages take turns every 10 s
            { label: 'page -> cycle', kind: 'switch', act: { t: 'set', key: 'centre', value: 'cycle' } },
            { label: 'parked, centre cycles (0 km/h)', kind: 'steady', ms: 22000, act: { t: 'signals', mode: 'manual', values: { rpm: 800, speed: 0, gear: 0, engine: 2, fuelL: 40, range: 450 } } },
        ];
    }
    return [{ label: 'start', kind: 'start' }, { label: 'steady', kind: 'steady', ms: S }];
}

/* ---------------- one run ---------------- */

async function run(app, n) {
    const sock = path.join(os.tmpdir(), 'mp-' + process.pid + '-' + n + '.sock');
    const rec = new Recorder(sock);
    await rec.listen();
    const data = path.join(WORK, 'data', app + '-' + n);
    fs.rmSync(data, { recursive: true, force: true });
    // layouts/ made beforehand, as on a car that has run the app before: on macOS fs.watch reports the folder's own
    // creation a moment later, which the app's watcher (layouts.js) takes for a pushed layout and rebuilds - a bench-only build
    fs.mkdirSync(path.join(data, 'layouts'), { recursive: true });
    const screenDir = path.join(WORK, 'screen', app + '-' + n);
    fs.rmSync(screenDir, { recursive: true, force: true });
    fs.mkdirSync(screenDir, { recursive: true });
    const env = Object.assign({}, process.env, {
        HUD_CLUSTER_SOCKET: sock, MP_PRELOAD: '1', SCREEN_DIR: screenDir, BENCH_IMAGE_DIR: path.join(data, 'hmi-img'),
        NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --require ' + path.join(__dirname, 'preload.js')).trim(),
    });
    fs.mkdirSync(env.BENCH_IMAGE_DIR, { recursive: true });
    const logs = [];
    rec.t0 = now();
    const child = fork(path.join(ROOT, 'bench', 'run-app.js'), [path.join(ROOT, 'dist', app), data], { cwd: data, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const pipe = (s) => { let rest = ''; s.on('data', (d) => { const ls = (rest + d).split('\n'); rest = ls.pop(); ls.forEach((x) => x && logs.push([r1(rec.t()), x])); }); };
    pipe(child.stdout); pipe(child.stderr);
    let exited = null;
    child.on('exit', (c, s) => { exited = { code: c, sig: s, at: r1(rec.t()) }; });
    const send = (m) => { if (child.connected) child.send(m); };
    let takeN = 0;
    const take = () => new Promise((resolve) => {
        const k = ++takeN;
        const on = (m) => { if (m && m.t === 'mp' && m.n === k) { child.removeListener('message', on); clearTimeout(tm); resolve(m); } };
        const tm = setTimeout(() => { child.removeListener('message', on); resolve(null); }, 3000);
        child.on('message', on);
        send({ t: 'mp', cmd: 'take', n: k });
    });
    // settled: no layer / asset / drop / whole frame for `quiet` ms (at least min, at most max)
    const settle = async (min, quiet, max) => {
        const t0 = rec.t();
        await sleep(min);
        while (rec.t() - t0 < max) { if (rec.t() - rec.lastStruct >= quiet) return true; await sleep(100); }
        return false;
    };

    const phases = [];
    const steps = scenario(app);
    send({ t: 'signals', mode: 'demo', values: {} });
    setTimeout(() => CAR_LIKE.forEach((v) => send({ t: 'fake', v })), 300);
    for (const st of steps) {
        if (exited) break;
        const p = { label: st.label, kind: st.kind, from: r1(rec.t()), firstEvent: rec.events.length, startLayers: new Set(Array.from(rec.layers.keys())), pixBefore: rec.pixels() };
        rec.pixPeak = rec.pixels();
        if (st.act) [].concat(st.act).forEach(send);
        let settled = true;
        if (st.kind === 'start') settled = await settle(4000, 2500, 25000);
        else if (st.kind === 'switch') settled = await settle(1500, 2000, 15000);
        else await sleep(st.ms);
        p.to = r1(rec.t()); p.lastEvent = rec.events.length; p.settled = settled;
        p.pixAfter = rec.pixels(); p.pixPeak = rec.pixPeak;
        p.endLayers = Array.from(rec.layers.values()).map((l) => ({ key: l.key, kind: l.kind, made: l.made, have: l.have, binds: Object.assign({}, l.binds), bindAt: Object.assign({}, l.bindAt), samplers: l.samplers || [], fs: l.fsHash || null, x: l.x, y: l.y, w: l.w, h: l.h, iw: l.iw, ih: l.ih, format: l.format, visible: l.visible, class: l.class, z: l.z }));
        const m = await take();
        p.app = m ? m.stats : null;
        p.widgets = m ? m.widgets : null;
        if (SNAP && st.kind !== 'steady' && n === 1) {
            const name = st.label.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
            rec.snapshot(path.join(SNAP, app, name), st.label, { active: p.widgets && p.widgets.active });
        }
        phases.push(p);
    }
    try { child.kill('SIGTERM'); } catch (e) { /* gone */ }
    await sleep(300);
    try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
    rec.close();
    return { rec, phases, logs, exited };
}

/* ---------------- analysis ---------------- */

function analyse(app, out) {
    const { rec, phases, logs } = out;
    const conns = {};
    rec.conns.forEach((c, id) => { conns[id] = { app: c.app, ci: c.ci }; });
    const ciOf = (conn) => (conns[conn] ? conns[conn].ci : 0);
    const res = [];
    phases.forEach((p, pi) => {
        const ev = rec.events.slice(p.firstEvent, p.lastEvent);
        const dur = Math.max(1, p.to - p.from);
        const by = {}, add = (k, b) => { const o = by[k] || (by[k] = { n: 0, bytes: 0 }); o.n++; o.bytes += b; };
        let pxWhole = 0, pxRects = 0, jsonBytes = 0, chunks = 0;
        const made = [], dropped = [], assetsMade = [], refused = [];
        ev.forEach((e) => {
            const [t, conn, kind, ref, bytes, x] = e;
            if (kind === 'chunk') { chunks++; return; }
            if (kind === 'mark') return;
            if (kind === 'close' || kind === 'hello') { add(kind, bytes); return; }
            if (kind === 'whole') { pxWhole += x.px; add('frame whole (' + x.kind + ')', bytes); return; }
            if (kind === 'rects') { pxRects += x.px; add('frame rects (' + x.kind + ')', bytes); return; }
            if (kind === 'refused') { refused.push(x); return; }
            jsonBytes += bytes;
            add(kind, bytes);
            if (kind === 'layer') made.push({ t, key: conn + ':' + ref, kind: x.kind, w: x.w, h: x.h, iw: x.iw, ih: x.ih, fs: x.fs, fsBytes: x.fsBytes });
            if (kind === 'asset') assetsMade.push({ t, key: conn + ':' + ref, format: x.format, w: x.w, h: x.h, bytes: x.w * x.h * (x.format === 'r8' ? 1 : 4) });
            if (kind === 'drop') dropped.push({ t, key: conn + ':' + ref, kind: x && x.kind });
        });
        // Builds: the phase's layer creates cut at each drop of a layer that follows creates (a rebuild drops every layer,
        // then makes the new set). A build is complete when every layer it made is there with its pixels: an image layer's
        // whole frame arrived, an effect layer's every sampler bound to an asset whose whole pixels arrived. It counts as
        // shown complete only if none of its layers was dropped before that moment.
        const builds = [], byN = new Map();
        ev.forEach((e) => {
            const [t, conn, kind, ref] = e, key = conn + ':' + ref, n = e[6];
            if (kind === 'mark' || kind === 'layer' || kind === 'drop') {
                if (!byN.has(n)) { const B = { n, start: t, keys: [] }; byN.set(n, B); builds.push(B); }
                const B = byN.get(n);
                B.start = Math.min(B.start, t);
                if (kind === 'layer') B.keys.push(key);
            }
        });
        for (let i = builds.length - 1; i >= 0; i--) if (!builds[i].keys.length) builds.splice(i, 1);
        builds.sort((x, y) => x.start - y.start);
        const missing = [];
        builds.forEach((B) => {
            let done = B.start, never = false;
            B.keys.forEach((k) => {
                const h = rec.hist.get(k);
                if (!h) { never = true; return; }
                let t = h.made;
                if (h.kind === 'image') { if (h.have === null) { never = true; missing.push(k + ' no pixels'); return; } t = Math.max(t, h.have); }
                if (h.kind === 'effect') {
                    (h.samplers || []).forEach((sm) => {
                        const a = rec.hist.get(h.binds[sm]);
                        if (!a || a.have === null) { never = true; missing.push(k + ' ' + sm + (a ? ' no pixels' : ' unbound')); return; }
                        t = Math.max(t, a.have, h.bindAt[sm] || 0);
                    });
                }
                done = Math.max(done, t);
            });
            B.complete = never ? null : done;
            B.valid = !never && B.keys.every((k) => { const h = rec.hist.get(k); return !h || h.dropped === null || h.dropped >= done; });
            let px = 0, bytes = 0;
            ev.forEach((e) => { if (e[2] === 'chunk' || e[0] < B.start || B.complete === null || e[0] > B.complete) return; bytes += e[4]; if (e[2] === 'whole' || e[2] === 'rects') px += e[5].px; });
            B.px = px; B.bytes = bytes; B.layers = B.keys.length;
        });
        builds.forEach((B, i) => { const next = builds[i + 1]; B.incompleteMs = r1(B.valid ? (next ? Math.min(B.complete, next.start) : B.complete) - B.start : (next ? next.start : p.to) - B.start); });
        const firstValid = builds.find((B) => B.valid), lastB = builds[builds.length - 1];
        const upto = (T) => { let bytes = 0, px = 0; ev.forEach((e) => { if (e[2] === 'chunk' || e[0] > T) return; bytes += e[4]; if (e[2] === 'whole' || e[2] === 'rects') px += e[5].px; }); return { bytes, px }; };
        const at = (T) => { const u = upto(T); return { sincePhase: r1(T - p.from), bytes: u.bytes, px: u.px, atFloorS: +(u.px / 1024 / BUDGET.floor).toFixed(2), atCeilingS: +(u.px / 1024 / BUDGET.ceiling).toFixed(2) }; };
        const uploads = [];
        const lastT = lastB && lastB.complete !== null ? lastB.complete : p.to;
        ev.forEach((e) => { if (e[2] === 'whole' && e[0] <= lastT && e[5].px >= 4096) uploads.push({ t: e[0], key: e[1] + ':' + e[3], px: e[5].px, kind: e[5].kind }); });
        const changed = builds.length > 0;
        // steady-state rates per layer and uniform
        const rates = {};
        if (p.kind === 'steady') {
            ev.forEach((e) => {
                const [t, conn, kind, ref, bytes, x] = e;
                if (kind === 'chunk') return;
                const name = kind === 'uniform' ? 'uniform ' + x : kind === 'rects' || kind === 'whole' ? 'frame ' + kind : kind;
                const k = ciOf(conn) + ':' + ref + ' ' + name;
                const o = rates[k] || (rates[k] = { n: 0, bytes: 0 });
                o.n++; o.bytes += bytes;
            });
            Object.keys(rates).forEach((k) => { rates[k] = { perS: r1(rates[k].n * 1000 / dur), Bps: Math.round(rates[k].bytes * 1000 / dur) }; });
        }
        const rebuildLogs = logs.filter((l) => l[0] >= p.from && l[0] <= p.to && /\] layout "[^"]+": \d+ widgets/.test(l[1])).map((l) => l[1].replace(/^\[[^\]]*\] /, ''));
        res.push({
            label: p.label, kind: p.kind, from: p.from, to: p.to, settled: p.settled,
            msgs: ev.filter((e) => e[2] !== 'chunk' && e[2] !== 'mark').length, bytes: ev.reduce((a, e) => a + (e[2] === 'chunk' ? 0 : e[4]), 0), jsonBytes,
            pxWhole, pxRects, writes: chunks, by,
            layersMade: made.filter((m) => m.kind !== undefined).length, layersDropped: dropped.filter((d) => d.kind !== 'asset').length,
            assetsMade: assetsMade.length, assetsDropped: dropped.filter((d) => d.kind === 'asset').length, assetBytes: assetsMade.reduce((a, x) => a + x.bytes, 0),
            assetList: assetsMade.map((a) => a.format + ' ' + a.w + 'x' + a.h),
            shaderBytesSent: made.reduce((a, m) => a + (m.fsBytes || 0), 0),
            pixBefore: p.pixBefore, pixPeak: p.pixPeak, pixAfter: p.pixAfter,
            builds: builds.map((B) => ({ start: B.start, complete: B.complete, valid: B.valid, layers: B.layers, ms: B.complete === null ? null : r1(B.complete - B.start), px: B.px, bytes: B.bytes, incompleteMs: B.incompleteMs })),
            firstComplete: changed && firstValid ? Object.assign(at(firstValid.complete), { build: builds.indexOf(firstValid) + 1 }) : null,
            finalComplete: changed && lastB && lastB.valid ? at(lastB.complete) : null,
            incompleteMs: r1(builds.reduce((s_, B) => s_ + B.incompleteMs, 0)),
            missing, bigUploads: uploads.slice(0, 60),
            rebuilds: p.app ? p.app.rebuilds : [], rebuildLogs,
            appJs: p.app ? { cpuMs: p.app.cpuMs, wallMs: p.app.ms, lagMax: p.app.lagMax, lagOver50: p.app.lagOver50, rssMB: p.app.rssMB, heapMB: p.app.heapMB,
                fn: Object.fromEntries(Object.entries(p.app.fn).map(([k, v]) => [k, { n: v.n, ms: r1(v.ms), max: r1(v.max) }])), scenes: p.app.scenes } : null,
            refused, rates,
            layers: p.endLayers.map((l) => ({ key: l.key, ci: ciOf(Number(l.key.split(':')[0])), kind: l.kind, x: l.x, y: l.y, w: l.w, h: l.h, iw: l.iw, ih: l.ih, format: l.format, fs: l.fs, samplers: l.samplers, binds: l.binds, class: l.class, z: l.z, visible: l.visible })),
            widgets: p.widgets,
        });
    });
    const shaders = {};
    rec.shaders.forEach((src, h) => { shaders[h] = shaderStats(src); });
    const resent = [];
    rec.frames.forEach((f, h) => { if (f.n > 1) resent.push({ hash: h, n: f.n, bytes: f.bytes, wasted: f.bytes * (f.n - 1), keys: f.keys }); });
    resent.sort((a, b) => b.wasted - a.wasted);
    return { app, conns, phases: res, shaders, resent, exited: out.exited, logLines: logs.length, warn: logs.filter((l) => /WARN|ERROR|refused/.test(l[1])).slice(0, 30).map((l) => l[1].slice(0, 240).replace(/BMW/g, 'the maker')) };
}

/* ---------------- printing ---------------- */

const kb = (b) => (b / 1024).toFixed(0) + ' KB';
const mb = (b) => (b / 1048576).toFixed(2) + ' MiB';
function print(a) {
    console.log('\n=== ' + a.app + ' ===');
    console.log('connections: ' + Object.keys(a.conns).map((k) => a.conns[k].app).join(', '));
    a.phases.forEach((p) => {
        const fc = p.firstComplete;
        console.log('\n-- ' + p.label + ' (' + p.kind + ', ' + r1((p.to - p.from) / 1000) + ' s' + (p.settled ? '' : ', NOT settled') + ')');
        console.log('   msgs ' + p.msgs + ', bytes ' + kb(p.bytes) + ' (json ' + kb(p.jsonBytes) + ', pixels whole ' + kb(p.pxWhole) + ', rects ' + kb(p.pxRects) + '), socket writes seen ' + p.writes);
        console.log('   layers made ' + p.layersMade + ' / dropped ' + p.layersDropped + ', assets made ' + p.assetsMade + ' (' + kb(p.assetBytes) + ') / dropped ' + p.assetsDropped + ', shader source sent ' + kb(p.shaderBytesSent));
        console.log('   pixel memory before ' + mb(p.pixBefore) + ', peak ' + mb(p.pixPeak) + ', after ' + mb(p.pixAfter) + '; rebuilds ' + p.rebuilds.length + (p.rebuilds.length ? ' (' + p.rebuilds.map((r) => r.layout + ' ' + r.ms + ' ms').join(', ') + ')' : ''));
        const fz = p.finalComplete;
        if (p.builds.length) console.log('   builds ' + p.builds.length + ': ' + p.builds.map((B) => B.layers + ' layers ' + (B.ms === null ? 'never complete' : B.ms + ' ms') + (B.valid ? '' : ' (torn down first)') + ', ' + kb(B.px) + ' px').join(' | ') + '; screen incomplete ' + p.incompleteMs + ' ms (bench)');
        if (fc) console.log('   first complete frame +' + fc.sincePhase + ' ms (bench, build ' + fc.build + '), after ' + kb(fc.bytes) + ' (' + kb(fc.px) + ' of pixels): ' + fc.atFloorS + ' s at 2000 KB/s, ' + fc.atCeilingS + ' s at 5500 KB/s');
        if (fz && (!fc || fz.sincePhase !== fc.sincePhase)) console.log('   final layout complete +' + fz.sincePhase + ' ms (bench), after ' + kb(fz.bytes) + ' (' + kb(fz.px) + ' of pixels): ' + fz.atFloorS + ' s at 2000 KB/s, ' + fz.atCeilingS + ' s at 5500 KB/s');
        if (p.missing.length) console.log('   NEVER COMPLETE: ' + p.missing.slice(0, 6).join(', '));
        if (p.appJs) {
            const f = p.appJs.fn, pick = (k) => (f[k] ? k + ' ' + f[k].n + 'x ' + f[k].ms + ' ms (max ' + f[k].max + ')' : null);
            console.log('   app JS: cpu ' + p.appJs.cpuMs + ' ms over ' + p.appJs.wallMs + ' ms; ' + ['rebuild', 'scene texture load', 'glyph atlas', 'exact atlas', 'sheet create', 'tick', 'needle timer'].map(pick).filter(Boolean).join('; ') + '; loop lag max ' + p.appJs.lagMax + ' ms; rss ' + p.appJs.rssMB + ' MB');
        }
        if (p.kind === 'steady') {
            const tot = Object.keys(p.rates).reduce((s, k) => s + p.rates[k].Bps, 0), n = Object.keys(p.rates).reduce((s, k) => s + p.rates[k].perS, 0);
            console.log('   steady: ' + r1(n) + ' msgs/s, ' + Math.round(tot) + ' B/s; top: ' + Object.keys(p.rates).sort((x, y) => p.rates[y].Bps - p.rates[x].Bps).slice(0, 8).map((k) => k + ' ' + p.rates[k].perS + '/s ' + p.rates[k].Bps + ' B/s').join('; '));
        }
        if (p.refused.length) console.log('   REFUSED: ' + p.refused.join('; '));
    });
    console.log('\nidentical whole pixels sent more than once: ' + a.resent.length + ', ' + kb(a.resent.reduce((s, r) => s + r.wasted, 0)) + ' re-sent');
}

(async () => {
    if (!flag('--no-build')) { process.stdout.write('building ' + APP + ' ... '); build(APP); console.log('done'); }
    const all = [];
    for (let n = 1; n <= RUNS; n++) {
        const out = await run(APP, n);
        const a = analyse(APP, out);
        a.run = n;
        fs.mkdirSync(path.join(WORK, 'logs'), { recursive: true });
        fs.writeFileSync(path.join(WORK, 'logs', APP + '-' + n + '.log'), out.logs.map((l) => l[0] + '  ' + l[1]).join('\n') + '\n');
        print(a);
        all.push(a);
    }
    if (OUT) {
        fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
        fs.writeFileSync(OUT, JSON.stringify({ app: APP, when: new Date().toISOString(), node: process.version, steadyMs: STEADY_MS, runs: all }, null, 1));
        console.log('\nwritten ' + OUT);
    }
    process.exit(0);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
