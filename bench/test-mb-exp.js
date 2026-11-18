'use strict';
/**
 * test-mb-exp.js - research3 MB (docs/research3/MB-REPORT.md): the black-box experiments of shared/mb_exp.js.
 *
 *   node bench/test-mb-exp.js            (BENCH_PORT, default 8303; --unit: the first part only, no bench)
 *
 * 1. Without the bench: off unless app.json config names one; the pieces round the gap never touch it and cover the rest
 *    of the rectangle exactly; every real shader of shared/shaders.js still has its v_uv after the u_sub rewrite; a cut
 *    layer's uniform / bind / set / drop reach every piece, a calibration move does not; the cover layer and its drop.
 * 2. f30_cluster with config.mbGap (tools/research3/mb/exp/f30-gap.json) and the car's layer cap (8 per connection), in
 *    6WB Comfort, Sport, Eco Pro and Comfort + G20: no layer RECTANGLE of ours touches the gap, nothing waits over the cap,
 *    at most 8 layers on any connection. (The picture outside the gap: tools/research3/mb/diff.py, which needs a GPU.)
 * 3. twin_dial with config.mbCover "clear" and config.mbRebuild.onMode: one layer over the gap at z 1000 with u_c
 *    0,0,0,0; a drive-mode change rebuilds (every layer dropped and made again) and says so.
 * 4. twin_dial as shipped (no mb key): no "mb:" line, no layer of ours touches the gap, a drive-mode change drops nothing.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8303;
const BASE = 'http://127.0.0.1:' + PORT;
const GAP = [1380, 660, 1460, 720];
const MB = require(path.join(ROOT, 'shared', 'mb_exp.js'));
const SH = require(path.join(ROOT, 'shared', 'shaders.js'));
const EXP = path.join(ROOT, 'tools', 'research3', 'mb', 'exp');

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const touches = (r, g) => r[0] < g[2] && g[0] < r[2] && r[1] < g[3] && g[1] < r[3];
const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const inter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const quiet = { info() {}, warn() {} };

/** A stand-in connection that records what it is asked. */
function fakeClient() {
    const calls = [];
    let next = 1;
    return {
        calls,
        effect(o) { const ref = next++; calls.push(['effect', ref, o]); return ref; },
        uniform(ref, name, v, opt) { calls.push(['uniform', ref, name, v, opt]); return true; },
        bind(ref, s, a) { calls.push(['bind', ref, s, a]); return true; },
        set(ref, o) { calls.push(['set', ref, o]); return true; },
        drop(ref) { calls.push(['drop', ref]); return true; },
    };
}

function unit() {
    console.log('1. shared/mb_exp.js without the bench');
    ok(MB.create({}, quiet) === null && MB.create({ mbGap: null, mbCover: 'nope', mbRebuild: { everyMs: 100 } }, quiet) === null,
        'off: no key, an unknown cover, a rebuild faster than 5 s -> no experiment object at all');
    const rects = [[0, 0, 1920, 720], [1173, 45, 1843, 715], [1300, 600, 1500, 720], [1390, 670, 1450, 700], [0, 0, 100, 100], [1380, 0, 1460, 660]];
    rects.forEach((r) => {
        const ps = MB.split(r, GAP);
        const sum = ps.reduce((a, p) => a + area(p.r), 0);
        const want = area(r) - (touches(r, GAP) ? area(inter(r, GAP)) : 0);
        const disjoint = ps.every((p, i) => ps.every((q, j) => i === j || !touches(p.r, q.r)));
        ok(ps.every((p) => !touches(p.r, GAP)) && sum === want && disjoint, 'split ' + r.join(',') + ': ' + ps.length + ' pieces, none touches the gap, ' + sum + ' px = the rectangle less the gap, no overlap');
    });
    const shaders = [];
    Object.keys(SH).forEach((k) => {
        const v = SH[k];
        if (typeof v === 'string') shaders.push([k, v]);
        else if (typeof v === 'function' && /For$/.test(k)) [0, 1, 2].forEach((s) => { try { const t = k === 'tdbackFor' ? v(s ? 'R' : 'L') : v(s, s !== 1); if (typeof t === 'string') shaders.push([k + '(' + s + ')', t]); } catch (e) { /* not this style */ } });
    });
    const withUv = shaders.filter(([, s]) => /varying\s+vec2\s+v_uv\s*;/.test(s));
    const bad = withUv.filter(([, s]) => {
        const t = MB.subFs(s);
        if (!t || t.length - s.length > 100 || !/uniform vec4 u_sub;/.test(t)) return true;
        const code = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');      // comments may name it
        const uses = (code.match(/\bv_uv\b/g) || []).length;
        return uses !== 2;          // the declaration and the one line in main() that maps it
    });
    ok(withUv.length >= 20 && bad.length === 0, withUv.length + ' shaders with v_uv: each rewritten, under 100 bytes more, v_uv read only through u_sub' + (bad.length ? ' (bad: ' + bad.map((b) => b[0]).join(', ') + ')' : ''));
    ok(MB.subFs('void main() { gl_FragColor = vec4(1.0); }') === null, 'a shader with no v_uv is not rewritten (null: the layer is made whole)');

    const exp = MB.create({ mbGap: { rect: GAP, conn: { msa: 3 }, z: { oilt: 2 }, keep: { tacho: 'right' } } }, quiet);
    const c = fakeClient();
    const opts = { target: 'panel', klass: 'content', z: 0, x: 0, y: 0, w: 1920, h: 720, fs: SH.fill };
    const ref = exp.effect(c, { id: 'bg' }, opts);
    const made = c.calls.filter((x) => x[0] === 'effect');
    const subs = c.calls.filter((x) => x[0] === 'uniform' && x[2] === 'u_sub');
    ok(made.length === 3 && made.every((x) => !touches([x[2].x, x[2].y, x[2].x + x[2].w, x[2].y + x[2].h], GAP)) && ref === made[0][1],
        'a full-panel effect is made as 3 layers round the gap, the first ref stands for the widget');
    const top = subs.find((x) => x[1] === made[0][1]), right = subs.find((x) => x[1] === made[2][1]);
    ok(top && right && JSON.stringify(top[3]) === JSON.stringify([0, 0, 1, 660 / 720]) && JSON.stringify(right[3]) === JSON.stringify([1460 / 1920, 660 / 720, 460 / 1920, 60 / 720]),
        'u_sub: each piece\'s corner and share of the whole widget');
    c.calls.length = 0;
    c.uniform(ref, 'u_size', [1920, 720]); c.bind(ref, 'u_t0', 9); c.set(ref, { visible: 0, x: 5, w: 10 });
    const u = c.calls.filter((x) => x[0] === 'uniform'), b = c.calls.filter((x) => x[0] === 'bind'), s = c.calls.filter((x) => x[0] === 'set');
    ok(u.length === 3 && b.length === 3 && s.length === 3 && s.every((x) => x[2].visible === 0 && x[2].x === undefined && x[2].w === undefined),
        'uniform, bind and set reach all 3 pieces; a move (x, w) is not passed on');
    c.calls.length = 0; c.drop(ref);
    ok(c.calls.filter((x) => x[0] === 'drop').length === 3, 'drop drops all 3 pieces');
    c.calls.length = 0;
    const r2 = exp.effect(c, { id: 'tacho' }, Object.assign({}, opts, { x: 1173, y: 45, w: 670, h: 670 }));
    ok(c.calls.filter((x) => x[0] === 'effect').length === 2 && r2 > 0, 'keep "right": the tacho as 2 pieces (top, right)');
    c.calls.length = 0;
    exp.effect(c, { id: 'speedo' }, Object.assign({}, opts, { x: 77, y: 45, w: 670, h: 670 }));
    ok(c.calls.length === 1 && c.calls[0][2].fs === SH.fill && c.calls[0][2].w === 670, 'a layer away from the gap is made as before, its shader untouched');
    ok(exp.connOf({ id: 'msa' }, 0) === 3 && exp.connOf({ id: 'x' }, 1) === 1 && exp.zOf({ id: 'oilt' }, 1) === 2 && exp.zOf({ id: 'x' }, 5) === 5, 'conn and z only for the widgets named');

    const cov = MB.create({ mbCover: 'grey' }, quiet), cc = fakeClient();
    cov.afterBuild(() => cc, 'panel');
    const e = cc.calls.find((x) => x[0] === 'effect'), uc = cc.calls.find((x) => x[0] === 'uniform' && x[2] === 'u_c');
    ok(e && e[2].x === 1380 && e[2].y === 660 && e[2].w === 80 && e[2].h === 60 && e[2].z === 1000 && uc && Math.abs(uc[3][0] - 24 / 255) < 1e-9 && uc[3][3] === 1,
        'cover "grey": one layer 1380,660 80x60 at z 1000, u_c the Comfort grey');
    cov.dropOwn();
    ok(cc.calls.filter((x) => x[0] === 'drop').length === 1 && cov.own.length === 0, 'the cover is dropped before a rebuild');
}

// ---- the bench ----
let server = null, logText = '';
async function req(method, url, body) {
    for (let i = 0; i < 8; i++) {
        try {
            const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', connection: 'close' }, body: body ? JSON.stringify(body) : undefined });
            if (r.status === 200) return r.json();
            if (r.status === 204) return null;
            throw new Error(method + ' ' + url + ': ' + r.status);
        } catch (e) { if (i === 7) throw e; await sleep(400); }
    }
    return null;
}
const probe = () => req('GET', '/probe');
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* app (re)starting */ }
        await sleep(150);
    }
    return p;
}

async function bench(app, config, settings) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mbexp-'));
    const data = path.join(tmp, 'data');
    fs.mkdirSync(data);
    if (settings) fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(settings));
    const trace = path.join(tmp, 'trace.jsonl');
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: data, BENCH_TRACE: trace, BENCH_LAYER_CAP: '8', SCREEN_DIR: path.join(tmp, 'screen') });
    if (config) env.BENCH_CONFIG = config;
    else delete env.BENCH_CONFIG;
    logText = '';
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), app], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (d) => { logText += d; });
    server.stderr.on('data', (d) => { logText += d; });
    const p = await until((q) => q && q.ready && q.activeName, 90000);
    await req('POST', '/signals', { mode: 'manual', values: { rpm: 1500, speed: 50, gear: 3, oil: 95, coolant: 90, ambient: 22, range: 368, fuelL: 40 } });
    return { p, trace };
}
async function stop() {
    if (!server) return;
    const s = server;
    server = null;
    await new Promise((r) => { s.once('exit', r); s.kill('SIGTERM'); setTimeout(r, 5000); });
}

/** The live layers per connection and every 'waiting' event, from the trace so far. */
function live(trace) {
    const L = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const m = new Map();
    let waiting = 0, drops = 0;
    L.forEach((e) => {
        if (e.dir === 'out' && e.ev === 'layer' && e.state === 'waiting') waiting++;
        if (e.dir !== 'in') return;
        const k = e.conn + ':' + e.ref;
        if (e.op === 'layer') m.set(k, { conn: e.conn, rect: [e.x || 0, e.y || 0, (e.x || 0) + (e.w || 0), (e.y || 0) + (e.h || 0)], z: e.z || 0, fsLen: e.fsLen || 0 });
        if (e.op === 'drop') { if (m.delete(k)) drops++; }
    });
    const per = {};
    m.forEach((v) => { per[v.conn] = (per[v.conn] || 0) + 1; });
    return { layers: Array.from(m.values()), per, waiting, drops };
}

async function f30Gap() {
    console.log('2. f30_cluster, config.mbGap, layer cap 8');
    const cfg = path.join(EXP, 'f30-gap.json');
    for (const [label, settings, drive, want] of [['6WB Comfort', {}, 4, 'wb_comfort'], ['6WB Sport', {}, 1, 'wb_sport'], ['6WB Eco Pro', {}, 7, 'wb_eco'], ['Comfort + G20', { g20: true }, 4, 'wb_dials']]) {
        const { p, trace } = await bench('f30_cluster', cfg, settings);
        ok(p && p.ready, label + ': the app runs');
        await req('POST', '/drive', { value: drive });
        const q = await until((x) => x.activeName === want, 15000);
        await sleep(2500);
        const s = live(trace);
        const over = s.layers.filter((l) => touches(l.rect, GAP));
        const maxPer = Math.max.apply(null, Object.values(s.per));
        ok(q && q.activeName === want, label + ': "' + (q && q.activeName) + '" drawn');
        ok(over.length === 0, label + ': no layer rectangle touches the gap (' + s.layers.length + ' layers)');
        ok(s.waiting === 0 && maxPer <= 8, label + ': nothing waits over the cap, at most ' + maxPer + ' layers on a connection ' + JSON.stringify(s.per));
        ok(/mb gap: widget "bg" 0,0 1920x720 as 3 layers/.test(logText) && /mb gap: widget "tacho"/.test(logText), label + ': the log names the cut layers');
        await stop();
    }
}

async function twinCover() {
    console.log('3. twin_dial, config.mbCover "clear" + config.mbRebuild.onMode');
    const { p, trace } = await bench('twin_dial', JSON.stringify({ mbCover: 'clear', mbRebuild: { onMode: true } }));
    ok(p && p.ready, 'the app runs');
    await sleep(2500);
    let s = live(trace);
    const cov = s.layers.filter((l) => touches(l.rect, GAP));
    ok(cov.length === 1 && cov[0].rect.join(',') === '1380,660,1460,720' && cov[0].z === 1000, 'one layer over the gap, 1380,660 - 1460,720, z 1000');
    const d0 = s.drops;
    await req('POST', '/drive', { value: 1 });
    await until(() => /mb: drive mode changed, the layout stays: rebuilding "twin"/.test(logText), 8000);
    await sleep(1500);
    s = live(trace);
    ok(/mb: drive mode changed, the layout stays: rebuilding "twin"/.test(logText) && s.drops - d0 >= 10, 'a drive-mode change rebuilds the same layout (' + (s.drops - d0) + ' layers dropped and made again) and says so');
    ok(s.layers.filter((l) => touches(l.rect, GAP)).length === 1, 'the cover is made again with the layout');
    await stop();
}

async function twinShipped() {
    console.log('4. twin_dial as shipped');
    const { p, trace } = await bench('twin_dial', null);
    ok(p && p.ready, 'the app runs');
    await sleep(2500);
    const d0 = live(trace).drops;
    await req('POST', '/drive', { value: 1 });
    await sleep(2500);
    const s = live(trace);
    ok(!/\bmb: /.test(logText), 'no "mb:" line: nothing of the experiments runs');
    ok(s.layers.filter((l) => touches(l.rect, GAP)).length === 0, 'no layer of ours touches the gap');
    ok(s.drops === d0, 'a drive-mode change drops nothing');
    await stop();
}

async function main() {
    unit();
    if (process.argv.indexOf('--unit') < 0) {
        await f30Gap();
        await twinCover();
        await twinShipped();
    }
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
}

main().catch(async (e) => { console.log('  FAIL ' + (e && e.stack || e)); failed++; await stop(); process.exitCode = 1; });
process.on('exit', () => { if (server) try { server.kill('SIGTERM'); } catch (e) { /* gone */ } });
