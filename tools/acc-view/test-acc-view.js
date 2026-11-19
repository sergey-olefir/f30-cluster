'use strict';
/**
 * tools/acc-view: the ACC View skeleton's tests (round 1120, package AA; docs/r1120/AA-SPEC.md).
 *
 *   node tools/acc-view/test-acc-view.js [--no-bench] [--port 8940]
 *
 * Part 1 (pure): the manifest (read-only flags only, off by default, the map target, outside the Store's "apps/*" glob), Node 8
 * syntax, the model (front_vehicle / limit_src readings -> the picture's state), the painter (every demo state day / night: no
 * red pixel, amber only while closing fast, cyan only with a suggestion, green only with an active cruise), diffRect / cut.
 * Part 2 (the bench, its own tree in a temporary folder, port 8940): the app built with the kit and run against the fake
 * cluster-render; off at the start = no layer and no subscription; on = one image layer 420 x 372 on `map` at (334, 44), no
 * contend; the car's raw values fed through POST /fake (DataFrontVehicle, functionalLibraryData) and the manual speed; the
 * layer's pixels read back with GET /px and compared with the painter's own picture for each state; stale after silence; off
 * again = the layer gone.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..');
const APPDIR = path.join(HERE, 'app', 'acc_view');
const args = process.argv.slice(2);
const PORT = Number(args.indexOf('--port') >= 0 ? args[args.indexOf('--port') + 1] : 8940);

let pass = 0, fail = 0;
function ok(c, what) { if (c) { pass++; } else { fail++; console.log('FAIL ' + what); } }

// The app's shared modules, as the build packs them next to view.js
const V = require(path.join(APPDIR, 'view.js'));
const FV = require(path.join(ROOT, 'shared', 'front_vehicle.js'));
const SRC = require(path.join(ROOT, 'shared', 'limit_src.js'));

/* ------------------------------------------------------------------------------------------------ part 1 */
function part1() {
    const app = JSON.parse(fs.readFileSync(path.join(APPDIR, 'app.json'), 'utf8'));
    ok(app.id === 'acc_view' && /^OA[A-Z0-9]{2}$/.test(app.loggingId), 'id and a 4-char logging id');
    const others = fs.readdirSync(path.join(ROOT, 'apps')).map((a) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', a, 'app.json'), 'utf8')); } catch (e) { return null; } }).filter(Boolean);
    ok(others.every((a) => a.loggingId !== app.loggingId && a.id !== app.id), 'logging id and id unique among the apps');
    const flags = [];
    Object.keys(app.signals).forEach((i) => Object.keys(app.signals[i]).forEach((f) => { if (f[0] !== '_') flags.push(app.signals[i][f]); else if (f === '_methods') flags.push('method'); }));
    ok(flags.length === 4 && flags.every((x) => x === 's' || x === 'rs'), 'four fields, read-only flags only (s / rs), no method, no setter');
    ok(app.config.target === 'map' && app.config.layer.target === 'map' && app.config.layer.contend === false && app.config.layer.guideHold === 0, 'the map target, no contend, no guide hold');
    ok(app.settings.every((s) => s.default === false), 'every setting off by default');
    ok(app.config.frontVehicle && app.config.frontVehicle.scale === null, 'the gap scale is unknown (no metres on screen)');
    const repo = JSON.parse(fs.readFileSync(path.join(ROOT, 'mgu-repo.json'), 'utf8'));
    const glob = repo.apps && repo.apps.path;
    ok(glob === 'apps/*' && path.relative(path.join(ROOT, 'apps'), APPDIR).indexOf('..') === 0, 'outside the Store glob ' + glob + ' (not in the Store until the owner says)');
    ok(!fs.existsSync(path.join(ROOT, 'apps', 'acc_view')), 'no apps/acc_view');
    ['view.js', 'main.js'].forEach((f) => {
        const s = fs.readFileSync(path.join(APPDIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        ok(!/\?\.|\?\?|\{\s*\.\.\.|,\s*\.\.\.\w+\s*\}/.test(s), f + ': Node 8 syntax (no ?. ?? or object spread)');
    });
    ok(V.W % 4 === 0 && V.W * V.H * 8 === 1249920, 'the layer 420 x 372: a multiple of 4 wide, 1.19 MiB of pixel memory (counted twice)');
    ok(V.AT.x >= 0 && V.AT.y >= 0 && V.AT.x + V.W <= 1088 && V.AT.y + V.H <= 480, 'inside the map target');
    ok(V.AT.x >= 284 && V.AT.x + V.W <= 804 && V.AT.y >= 33 && V.AT.y + V.H <= 460, 'inside the part Twin Dial\'s W2 shows (284..804, 33..460)');

    // the model
    const fvc = FV.cfgOf(Object.assign({}, app.config.frontVehicle, { on: true }));
    let t = 0;
    const tr = FV.create(fvc, { clock: () => t });
    tr.start();
    let s = V.stateOf(tr.view(90), null, false);
    ok(s.data === 'none' && s.tgt === null, 'nothing yet: no target');
    t = 11000;
    s = V.stateOf(tr.view(90), null, false);
    ok(s.data === 'absent', 'nothing for 10 s: absent');
    for (let i = 0; i < 15; i++) { t += 100; tr.feed({ frontVehicleGapX: 420, frontVehicleSpeedX: 1500, frontVehicleObjectID: 7, qualifierEventDataFunctionFrontVehicle: 0, qualifierExtendedFunctionFrontVehicle: 0 }, 90); }
    s = V.stateOf(tr.view(90), null, false);
    ok(s.data === 'ok' && s.tgt === 3 && s.clo === 0, 'raw 420 at 90 km/h: level 3 (the assumed scale), not closing');
    t += 2500;
    s = V.stateOf(tr.view(90), null, false);
    ok(s.data === 'stale' && s.tgt === null, 'silence for 2.5 s: stale, the car goes (never a frozen car)');
    const hc = SRC.hudCruiseCfg({});
    const dds = (o) => Object.assign({ ldmSym: 'LDM_SYM_NONE', ldmSymColor: 'LDM_OFF', statusLimiter: 'STATUS_INACTIVE', cruiseCtrlSpeedHUD: 65535 }, o);
    ok(JSON.stringify(V.stateOf(null, SRC.hudCruiseOf(hc, dds({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 90 })), false).cru) === '["cruise","active",90]', 'cruise active 90');
    ok(JSON.stringify(V.stateOf(null, SRC.hudCruiseOf(hc, dds({ ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_OFF', cruiseCtrlSpeedHUD: 90 })), false).cru) === '["cruise","standby",90]', 'cruise standby 90');
    ok(JSON.stringify(V.stateOf(null, SRC.hudCruiseOf(hc, dds({ ldmSym: 'LDM_SYM_SLD', ldmSymColor: 'LDM_ACTIVE', cruiseCtrlSpeedHUD: 110 })), false).cru) === '["limiter","active",110]', 'limiter 110');
    ok(V.stateOf(null, SRC.hudCruiseOf(hc, dds({})), false).cru === null, '65535 / NONE: cruise off');

    // the painter
    const P = V.palette(false);
    const isRed = (r, g, b) => r > 150 && g < 90 && b < 90;
    const near = (r, g, b, c, d) => Math.abs(r - c[0]) <= d && Math.abs(g - c[1]) <= d && Math.abs(b - c[2]) <= d;
    V.DEMO.forEach((d) => {
        [false, true].forEach((night) => {
            const px = V.paint(d[2], night), Q = V.palette(night);
            let red = 0, amber = 0, cyan = 0, green = 0;
            for (let i = 0; i < px.length; i += 4) {
                const r = px[i], g = px[i + 1], b = px[i + 2];
                if (isRed(r, g, b)) red++;
                if (near(r, g, b, Q.amber, 6)) amber++;
                if (near(r, g, b, Q.cyan, 6)) cyan++;
                if (near(r, g, b, Q.green, 6)) green++;
            }
            const tag = d[0] + ' ' + d[1] + (night ? ' night' : ' day');
            ok(px.length === V.W * V.H * 4, tag + ': size');
            ok(red === 0, tag + ': no red pixel');
            if (!d[2].warn) {
                ok((amber > 0) === (d[2].clo === 2), tag + ': amber only while closing fast (' + amber + ')');
                ok((cyan > 0) === !!d[2].adv, tag + ': cyan only with a suggestion (' + cyan + ')');
                ok((green > 0) === !!(d[2].cru && d[2].cru[1] === 'active'), tag + ': green only with an active cruise / limiter (' + green + ')');
            }
        });
    });
    const a = V.paint(V.DEMO[3][2], false), b = V.paint(V.DEMO[5][2], false);
    const r = V.diffRect(a, b, V.W, V.H);
    ok(r && r.w > 0 && r.w < V.W && r.h < V.H, 'middle -> closing: one rectangle smaller than the layer (' + (r && r.w + 'x' + r.h) + ')');
    ok(V.diffRect(a, a, V.W, V.H) === null, 'no change: nothing to send');
    const cut = V.cut(b, V.W, r);
    ok(cut.length === r.w * r.h * 4 && cut.readUInt32LE(0) === b.readUInt32LE((r.y * V.W + r.x) * 4), 'cut: the rectangle\'s rows packed');
    ok(P.bg.join() === '0,0,0', 'black background (the map slot under a theme window)');

    // direction E's effect shaders (app/acc_view/shaders): small, one look, GLSL ES 1.00, highp asked for, no sampler
    const SH = path.join(APPDIR, 'shaders');
    const shipped = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n') + '\n';
    const files = fs.readdirSync(SH).filter((f) => /\.glsl$/.test(f));
    ok(files.length === 2, 'two effect shaders (lane, car)');
    files.forEach((f) => {
        const src = fs.readFileSync(path.join(SH, f), 'utf8'), shp = shipped(src);
        ok(Buffer.byteLength(shp) < 8000, f + ': ' + Buffer.byteLength(shp) + ' B shipped, far under the KOMBI reset seen at 26.7 k (our car-proven shaders: 2.7-13 k)');
        ok(/#ifdef GL_FRAGMENT_PRECISION_HIGH\s*\nprecision highp float;/.test(shp), f + ': asks for highp (px distances over 256 overflow fp16)');
        ok(!/sampler2D|texture2D/.test(shp), f + ': no sampler (nothing to leave unbound)');
        ok(!/^#if(?!def GL_FRAGMENT_PRECISION_HIGH)|#else(?!\nprecision mediump)/m.test(shp.replace('#else\nprecision mediump float;', '')), f + ': no #if looks (one look per layer source)');
        ok(/varying vec2 v_uv;/.test(shp) && /gl_FragColor/.test(shp) && !/^\s*(in|out)\s/m.test(shp) && !/\btexture\(/.test(shp), f + ': GLSL ES 1.00 (varying, gl_FragColor)');
        ok(!/\b(all|any|not)\s*=/.test(shp), f + ': no built-in names reused as variables');
    });
}

/* ------------------------------------------------------------------------------------------------ part 2: the bench */
function makeRoot() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-view-'));
    const r = path.join(work, 'root');
    fs.mkdirSync(r);
    const copy = (src, dst) => {
        fs.mkdirSync(dst);
        fs.readdirSync(src).forEach((n) => {
            if (n === '.data') return;
            const s = path.join(src, n), d = path.join(dst, n), st = fs.statSync(s);
            if (st.isDirectory()) copy(s, d); else fs.copyFileSync(s, d);
        });
    };
    copy(path.join(ROOT, 'bench'), path.join(r, 'bench'));
    ['shared', 'kit'].forEach((d) => fs.symlinkSync(path.join(ROOT, d), path.join(r, d)));
    fs.mkdirSync(path.join(r, 'apps'));
    fs.symlinkSync(APPDIR, path.join(r, 'apps', 'acc_view'));
    const sdk = path.join(r, 'oap-sdk');
    fs.mkdirSync(sdk);
    fs.writeFileSync(path.join(sdk, 'index.js'), "'use strict';\n// BENCH_STUB: stands in for BMW's oap-sdk so kit/tools/build.py runs on the Mac. Never ship this.\nthrow new Error('BENCH_STUB oap-sdk');\n");
    fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: 'oap-sdk', version: '0.0.0-bench-stub', main: 'index.js' }) + '\n');
    return { work, root: r };
}

function request(method, url, body) {
    return new Promise((resolve) => {
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const rq = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, (res) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) }));
        });
        rq.on('error', () => resolve({ status: 0, body: Buffer.alloc(0) }));
        if (data) rq.write(data);
        rq.end();
    });
}

/** The bench's scene now: open /events, take its "scene" message, close. */
function scene() {
    return new Promise((resolve) => {
        let buf = '', done = false;
        const rq = http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => {
            res.on('data', (c) => {
                buf += c.toString('utf8');
                const lines = buf.split('\n');
                buf = lines.pop();
                lines.forEach((ln) => {
                    const s = ln.replace(/^data:\s*/, '').trim();
                    if (done || !s || s[0] !== '{') return;
                    try { const m = JSON.parse(s); if (m.t === 'scene') { done = true; rq.abort(); resolve(m.layers || []); } } catch (e) { /* not this one */ }
                });
            });
        });
        rq.on('error', () => { if (!done) { done = true; resolve(null); } });
        setTimeout(() => { if (!done) { done = true; rq.abort(); resolve(null); } }, 5000);
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DDS = 'de.bmw.infotainment.displaydataserver.DisplayDataServer';

async function part2() {
    const { work, root } = makeRoot();
    const dataDir = path.join(work, 'data');
    fs.mkdirSync(dataDir);
    let out = '';
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, BENCH_LAYER_CAP: '8' });
    const srv = spawn(process.execPath, [path.join(root, 'bench', 'server.js'), 'acc_view'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (c) => { out += c; });
    srv.stderr.on('data', (c) => { out += c; });
    const waitFor = async (re, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(out)) return true; await sleep(100); } return false; };
    try {
        ok(await waitFor(/acc: show off, demo off/, 90000), 'the app built by the kit and started (show off)');
        await sleep(800);
        let layers = await scene();
        const mine = (ls) => (ls || []).filter((l) => l.app === 'acc_view' || l.target === 'map');
        ok(layers && mine(layers).length === 0, 'off at the start: no layer');
        ok(!/acc: watch/.test(out), 'off at the start: no subscription');

        await request('POST', '/signals', { mode: 'manual', values: { speed: 90 } });
        await request('POST', '/setting', { key: 'show', value: true });
        ok(await waitFor(/acc: layer 420x372 on map at 334,44 \(waits for the slot\)/, 8000), 'on: the layer asked for, waiting for the slot (no contend)');
        ok(await waitFor(/acc: watch GapVehicleAhead/, 8000) && /acc: watch DisplayDataServer/.test(out), 'on: the fields watched');
        await request('POST', '/fake', { feed: { iface: DDS, field: 'functionalLibraryData', value: { ldmSym: 'LDM_SYM_DCC', ldmSymColor: 'LDM_ACTIVE', statusLimiter: 'STATUS_INACTIVE', cruiseCtrlSpeedHUD: 90 } } });
        await request('POST', '/fake', { front: { gap: 4093, speed: 4093, obj: 255, qual: 2 } });
        await sleep(800);
        layers = await scene();
        const ls = mine(layers);
        ok(ls.length === 1 && ls[0].kind === 'image' && ls[0].target === 'map' && ls[0].x === 334 && ls[0].y === 44 && ls[0].w === 420 && ls[0].h === 372, 'one image layer on map, 420 x 372 at 334,44');
        const key = ls[0] && ls[0].key;
        const grab = async () => (await request('GET', '/px?key=' + encodeURIComponent(key) + '&x=0&y=0&w=' + V.W + '&h=' + V.H)).body;
        const same = (px, st, what) => {
            const want = V.paint(st, false);
            let diff = 0;
            for (let i = 0; i < want.length; i++) if (Math.abs(want[i] - px[i]) > 1) diff++;
            ok(px.length === want.length && diff === 0, what + ' (' + diff + ' bytes differ)');
        };
        same(await grab(), { tgt: null, clo: 0, data: 'none', cru: ['cruise', 'active', 90], warn: false, adv: null }, 'no target, cruise 90: the layer holds the painter\'s picture');

        const feedGap = async (g0, g1, ms) => {
            const n = Math.round(ms / 100);
            for (let i = 0; i <= n; i++) { await request('POST', '/fake', { front: { gap: Math.round(g0 + (g1 - g0) * i / n), speed: 1500, obj: 7, qual: 0, qualExt: 0 } }); await sleep(100); }
        };
        await feedGap(420, 420, 1500);
        await sleep(300);
        same(await grab(), { tgt: 3, clo: 0, data: 'ok', cru: ['cruise', 'active', 90], warn: false, adv: null }, 'raw 420 steady at 90 km/h: level 3');
        await request('POST', '/fake', { feed: { iface: DDS, field: 'functionalLibraryData', value: { ldmSym: 'LDM_SYM_SLD', ldmSymColor: 'LDM_ACTIVE', statusLimiter: 'STATUS_ACTIVE', cruiseCtrlSpeedHUD: 110 } } });
        await feedGap(420, 420, 600);
        await sleep(300);
        same(await grab(), { tgt: 3, clo: 0, data: 'ok', cru: ['limiter', 'active', 110], warn: false, adv: null }, 'the limiter 110');
        await feedGap(420, 150, 2400);
        const px = await grab();
        const Q = V.palette(false);
        let amber = 0;
        for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - Q.amber[0]) < 7 && Math.abs(px[i + 1] - Q.amber[1]) < 7 && Math.abs(px[i + 2] - Q.amber[2]) < 7) amber++;
        ok(amber > 200, 'the gap falling 42 -> 15 m (assumed scale) in 2.4 s: closing fast, amber (' + amber + ' px)');
        await sleep(2600);
        same(await grab(), { tgt: null, clo: 0, data: 'stale', cru: ['limiter', 'active', 110], warn: false, adv: null }, 'silence for 2.6 s: stale, the car goes');
        ok(!/acc: (tick|apply|front|cruise|speed|warn|ready|layer|target|start):\s/.test(out), 'no error from the app\'s guards');

        await request('POST', '/setting', { key: 'show', value: false });
        ok(await waitFor(/acc: layer dropped/, 5000), 'off again: the layer dropped');
        await sleep(600);
        layers = await scene();
        ok(layers && mine(layers).length === 0, 'off again: no layer in the scene');
        const nodeLine = (out.match(/app started on [^\n]+/) || [])[0];
        console.log('bench: ' + (nodeLine || 'the app\'s Node version not logged'));
    } finally {
        srv.kill('SIGTERM');
        await sleep(300);
        if (fail) console.log('--- bench log (tail) ---\n' + out.split('\n').slice(-60).join('\n'));
        try { require('child_process').execFileSync('rm', ['-rf', work]); } catch (e) { /* left behind */ }
    }
}

module.exports = { makeRoot };
if (require.main === module) (async () => {
    part1();
    console.log('part 1 (pure): ' + pass + ' passed, ' + fail + ' failed');
    if (args.indexOf('--no-bench') < 0) {
        const p0 = pass, f0 = fail;
        await part2();
        console.log('part 2 (bench, port ' + PORT + '): ' + (pass - p0) + ' passed, ' + (fail - f0) + ' failed');
    }
    console.log('total: ' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})();
