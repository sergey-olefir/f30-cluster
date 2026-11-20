'use strict';
/**
 * test-gpu-rows.js - car issues of 2026-11-19, package GL (docs/car-issues/GL-REPORT.md): the "gpu" texts' glyph atlases have
 * rows of a multiple of 4 bytes, and so has every rect written into one.
 *
 *   node bench/test-gpu-rows.js
 *
 * On the car (photo A) Twin Dial 0.1.3's gear showed slanted pieces of glyphs: its td_big atlas is R8, 26 cells of 41 = 1066
 * bytes a row, and drawn as if its rows were 1068 apart (a 4-byte row alignment) it gives exactly that. The engine runs here
 * without a bench (bench/twin-harness.js): its real _gpuTexts / _exactAtlas / _exactCodes / _exactPut against a recording
 * client that keeps the texels as the uploads leave them, read three ways: tight (what the bench and the protocol say), every
 * write after the first re-reading the whole texture at a 4-byte row pitch ("whole"), and each write's rows at a 4-byte pitch
 * ("rect"). Checks
 *   1. Twin Dial: every atlas asset and every rect written into it is a multiple of 4 texels wide (x too), through the
 *      gear's whole value set and the speed's; fails on 0.1.3 (1066, 41);
 *   2. what the shader draws is the image text's own coverage, pixel for pixel, for every value (aligned and legacy alike);
 *   3. under both car models the aligned atlas still draws every value exactly; the legacy one ("config.gpuText": "legacy",
 *      the Діагностика switch for the car test) does not - the model sees the fault the fix removes;
 *   4. f30_cluster (Sport's digital speed, wb_big): the same bytes and the same uploads as before (it was aligned already);
 *   5. the plain glyph atlases (_atlas) of every font of both apps: rows a multiple of 4 bytes;
 *   6. "pixels": the "gpu" texts are drawn as images; Twin Dial's app.json wires the setting diagGpuText to config.gpuText, and a
 *      change of it asks for a rebuild (diag_settings.js) with another atlas key;
 *   7. on the bench (BENCH_PORT, default 8920; --static skips it): Twin Dial switched off -> legacy -> pixels -> off from the DIAG
 *      screen: the atlases made each time (1148 / 1066 / none / 1148), no asset dropped while a layer still binds it (the
 *      trace), no protocol error, the app still up.
 * 1-6 Node 8 or newer; 7 Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const path = require('path');
const H = require('./twin-harness');

const ROOT = H.ROOT;
let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };

const engines = {};
function engine(app) {
    if (!engines[app]) {
        const dir = H.tree(app);
        engines[app] = { dir, HudApp: require(path.join(dir, 'hud.js')), text: require(path.join(dir, 'hud_text.js')) };
    }
    return engines[app];
}

/** A client that keeps each asset's texels as the uploads leave them, read by `reader` ('tight' | 'whole' | 'rect'). */
function client(reader) {
    const assets = new Map(), writes = [];
    let next = 1;
    return {
        assets, writes,
        asset(o) { const r = next++; assets.set(r, { w: o.w, h: o.h, fmt: o.format, copy: Buffer.alloc(o.w * o.h, 0), tex: Buffer.alloc(o.w * o.h, 0), n: 0 }); return r; },
        pixels(ref, rects, px) {
            const a = assets.get(ref), rs = rects && rects.length ? rects : [{ x: 0, y: 0, w: a.w, h: a.h }];
            let off = 0;
            rs.forEach((r) => {
                writes.push({ ref, x: r.x, y: r.y, w: r.w, h: r.h, whole: !(rects && rects.length) });
                for (let y = 0; y < r.h; y++) px.copy(a.copy, (r.y + y) * a.w + r.x, off + y * r.w, off + (y + 1) * r.w);
                if (reader === 'rect' && a.n) {          // this write's own rows read at a 4-byte pitch
                    const S = Math.ceil(r.w / 4) * 4;
                    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const i = y * S + x; a.tex[(r.y + y) * a.w + r.x + x] = i < r.w * r.h ? px[off + i] : 0; }
                }
                off += r.w * r.h;
            });
            if (reader === 'whole' && a.n) {             // the whole texture re-read at a 4-byte pitch
                const S = Math.ceil(a.w / 4) * 4;
                for (let i = 0; i < a.w * a.h; i++) { const j = Math.floor(i / a.w) * S + (i % a.w); a.tex[i] = j < a.copy.length ? a.copy[j] : 0; }
            } else if (reader === 'tight' || !a.n) a.copy.copy(a.tex);
            a.n++;
            return true;
        },
    };
}

/** The engine's "gpu" text layers of a layout widget, run through `values`; -> per value what ATEXT draws and the image text's mask. */
function run(app, layoutFile, id, values, opts) {
    const E = engine(app), h = Object.create(E.HudApp.prototype), cl = client(opts.reader || 'tight'), logs = [];
    Object.assign(h, { atlases: new Map(), widgets: new Map(), target: 'panel', config: { gpuText: opts.gpuText }, sceneUsed: null,
        log: { info: (m) => logs.push(m), warn: (m) => logs.push('WARN ' + m), error: (m) => logs.push('ERROR ' + m) } });
    h._clientAt = () => cl;
    const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'hud', 'layouts', layoutFile), 'utf8'));
    const w0 = layout.widgets.find((w) => w.id === id);
    const parts = h._gpuTexts([w0]);
    const xs = parts.map((w) => {
        const a = w.type === 'atext' ? h._exactAtlas(w, 0) : null, x = { w, atlas: a, cells: w.cells, codes: null };
        h.widgets.set(w.id, x);
        return x;
    });
    const shots = [];
    values.forEach((v) => {
        const want = E.text.mask(w0.w, Math.min(w0.h, E.text.loadFont(w0.font).metrics.cellHeight), v, { font: w0.font, align: w0.align, spacing: w0.spacing });
        const img = Buffer.alloc(want.length, 0), ww = w0.w;
        let ownLayer = null;
        xs.forEach((x) => {
            if (!x.atlas) return;        // "pixels": an image text, nothing of the atlas path
            const E2 = x.w.exact, shows = E2.lengths.indexOf(v.length) >= 0;
            x.codes = h._exactCodes(x, shows ? v : '');
            if (!shows) return;
            ownLayer = x;
            const a = x.atlas, t = cl.assets.get(a.ref), off = x.w.x - w0.x;
            for (let py = 0; py < x.w.h; py++) for (let px = 0; px < x.w.w; px++) {
                const cell = Math.floor(px / a.cellW), c = x.codes[cell];
                if (c < 0) continue;
                const tx = (c % a.cols) * a.cellW + (px - cell * a.cellW), ty = Math.floor(c / a.cols) * a.cellH + py;
                img[py * ww + off + px] = t.tex[ty * t.w + tx];
            }
        });
        let diff = 0;
        for (let i = 0; i < want.length; i++) if (Math.abs(want[i] - img[i]) > 0) diff++;
        shots.push({ v, diff, layer: ownLayer && ownLayer.w.id });
    });
    return { h, cl, parts, xs, shots, logs };
}

const GEAR = ['P', 'R', 'N', 'D', 'S', 'M', '–'].concat([1, 2, 3, 4, 5, 6, 7, 8].map((g) => 'D' + g), [1, 2, 3, 4, 5, 6, 7, 8].map((g) => 'M' + g),
    [1, 2, 3, 4, 5, 6, 7, 8].map((g) => 'S' + g), ['P', 'D', 'R', 'D1', 'N', 'D2', 'P']);
const SPEED = ['0', '7', '42', '99', '100', '187', '299', '–', '5', '–', '120'];
const aligned4 = (n) => n % 4 === 0;

console.log('1. Twin Dial: the atlases and every write into them, 4-texel columns');
const tdGear = run('twin_dial', 'twin.json', 'gear', GEAR, {});
const tdSpeed = run('twin_dial', 'twin.json', 'speed', SPEED, {});
[['gear', tdGear], ['speed', tdSpeed]].forEach((e) => {
    const r = e[1], as = Array.from(r.cl.assets.values());
    ok(as.length === 1 && as.every((a) => a.fmt === 'r8' && aligned4(a.w)), e[0] + ': its atlas is R8 with rows of a multiple of 4 bytes (' + as.map((a) => a.w + 'x' + a.h).join(', ') + ')');
    const rects = r.cl.writes.filter((x) => !x.whole);
    ok(rects.every((x) => aligned4(x.x) && aligned4(x.w)), e[0] + ': every rect written in place starts and ends on 4-texel columns (' + rects.length + ' rects, widths ' +
        Array.from(new Set(rects.map((x) => x.w))).join('/') + ')');
    ok(rects.every((x) => x.x + x.w <= as[0].w && x.y + x.h <= as[0].h), e[0] + ': and stays inside the atlas');
});
ok(tdGear.cl.writes.filter((x) => !x.whole).length > 0, 'the gear writes into its atlas in place (its letters are not figures: ' + tdGear.cl.writes.filter((x) => !x.whole).length + ' writes for ' + GEAR.length + ' values)');
ok(tdSpeed.cl.writes.filter((x) => !x.whole).length === 2, 'the speed only for its dash ("–", 2 cells): the figures are the first whole upload\'s');
const tdLegacy = run('twin_dial', 'twin.json', 'gear', GEAR, { gpuText: 'legacy' });
const la = Array.from(tdLegacy.cl.assets.values())[0];
ok(la.w === 1066 && la.h === 70 && tdLegacy.cl.writes.filter((x) => !x.whole).every((x) => x.w === 41), '"legacy" is 0.1.3\'s layout: 1066x70, 41 px rects (the car test\'s other half)');
ok(tdLegacy.logs.some((m) => /rows 1066 bytes: NOT a multiple of 4 \(config\.gpuText "legacy"\)/.test(m)) && tdLegacy.logs.some((m) => /cell \d+ written in place, rect \d+,0 41x70 \(NOT a multiple of 4\), write 1\b/.test(m)),     // r1120 T2: the line goes on (asset, widget, ...)
    'its log says so: the atlas\'s rows and each write in place, numbers only');
ok(tdGear.logs.some((m) => /gpu text atlas "td_big": 10 figures in 20 cells and 8 spare cells of 41x70, 1148x70 R8 asset/.test(m)) && !tdGear.logs.some((m) => /NOT a multiple/.test(m)),
    'aligned: 20 figure cells and 8 spare (2 more than 0.1.3), 1148x70, nothing logged as unaligned');

console.log('2. what the shader draws is the image text, pixel for pixel');
[['gear', tdGear], ['gear legacy', tdLegacy], ['speed', tdSpeed]].forEach((e) => {
    const bad = e[1].shots.filter((s) => s.diff);
    ok(!bad.length, e[0] + ': ' + e[1].shots.length + ' values drawn exactly' + (bad.length ? ' - not: ' + bad.map((s) => s.v + ' (' + s.diff + ' px)').join(', ') : ''));
});

console.log('3. the car models: rows re-read at a 4-byte pitch');
['whole', 'rect'].forEach((reader) => {
    const al = run('twin_dial', 'twin.json', 'gear', GEAR, { reader }), lg = run('twin_dial', 'twin.json', 'gear', GEAR, { reader, gpuText: 'legacy' });
    const sp = run('twin_dial', 'twin.json', 'speed', SPEED, { reader });
    ok(al.shots.every((s) => !s.diff) && sp.shots.every((s) => !s.diff), reader + ': aligned, every gear value and every speed drawn exactly');
    const broken = lg.shots.filter((s) => s.diff);
    ok(broken.length > 0, reader + ': legacy, ' + broken.length + ' of ' + lg.shots.length + ' gear values drawn wrong (first: "' + (broken[0] || {}).v + '", ' + (broken[0] || {}).diff + ' px)');
});
// the speed alone in the legacy layout (written once, whole): right under the "whole" model, as on photo A
const spL = run('twin_dial', 'twin.json', 'speed', ['0', '42', '187'], { reader: 'whole', gpuText: 'legacy' });
ok(spL.shots.every((s) => !s.diff), 'whole: legacy speed figures (one write, never in place) drawn exactly - photo A\'s right "0" beside the broken gear');

console.log('4. f30_cluster: Sport\'s digital speed unchanged (wb_big was aligned)');
['wb_sport.json', 'wb_sport_dials.json'].forEach((lay) => {
    const vals = ['0', '88', '--', '188', '-', '12'];
    const now = run('f30_cluster', lay, 'speed', vals, {}), was = run('f30_cluster', lay, 'speed', vals, { gpuText: 'legacy' });
    const an = Array.from(now.cl.assets.values()), aw = Array.from(was.cl.assets.values());
    ok(an.length === aw.length && an.every((a, i) => a.w === aw[i].w && a.h === aw[i].h && a.copy.equals(aw[i].copy)), lay + ': the same atlas, byte for byte (' + an.map((a) => a.w + 'x' + a.h).join(', ') + ')');
    ok(JSON.stringify(now.cl.writes) === JSON.stringify(was.cl.writes), lay + ': the same ' + now.cl.writes.length + ' uploads, rect for rect');
    ok(now.shots.every((s) => !s.diff), lay + ': every value drawn exactly');
});

console.log('5. the plain glyph atlases of every font');
['twin_dial', 'f30_cluster'].forEach((app) => {
    const E = engine(app), fonts = fs.readdirSync(path.join(ROOT, 'apps', app, 'hud', 'fonts')).filter((f) => /\.json$/.test(f)).map((f) => f.slice(0, -5));
    const bad = [];
    let n = 0;
    fonts.forEach((f) => {
        const h = Object.create(E.HudApp.prototype), cl = client('tight');
        Object.assign(h, { atlases: new Map(), target: 'panel', config: {}, log: { info() {}, warn() {} } });
        h._clientAt = () => cl;
        try { h._atlas(f, 0); } catch (e) { return; }     // a font with no printable glyph: no atlas
        n++;
        cl.assets.forEach((a) => { if (!aligned4(a.w)) bad.push(f + ' ' + a.w); });
    });
    ok(n > 0 && !bad.length, app + ': ' + n + ' fonts, every atlas row a multiple of 4 bytes' + (bad.length ? ' - not: ' + bad.join(', ') : ''));
});

console.log('6. the Діагностика switch');
const px = run('twin_dial', 'twin.json', 'gear', ['P'], { gpuText: 'pixels' });
ok(px.parts.length === 1 && px.parts[0].type === 'text' && px.cl.assets.size === 0, '"pixels": the gear stays an image text, no atlas made');
ok(px.logs.some((m) => /"gpu" set aside \(config\.gpuText "pixels"\)/.test(m)), '"pixels": logged');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'twin_dial', 'app.json'), 'utf8'));
const st = spec.settings.find((s) => s.key === 'diagGpuText'), tbl = spec.config.diag.settings.diagGpuText;
const diagScreen = spec.screens.find((s) => s.name === 'DIAG'), setScreen = spec.screens.find((s) => s.name === 'SETTINGS');
ok(!!st && st.type === 'choice' && st.default === 'off' && st.options.map((o) => o[0]).join() === 'off,legacy,pixels', 'app.json: diagGpuText, a choice off / legacy / pixels, off by default');
ok(!!tbl && tbl.options.legacy.gpuText === 'legacy' && tbl.options.pixels.gpuText === 'pixels' && !('gpuText' in spec.config), 'config.diag: it writes config.gpuText; app.json has no gpuText of its own (off = aligned)');
ok(diagScreen.items.some((i) => i[0] === 'setting' && i[1] === 'diagGpuText') && setScreen.skip.indexOf('diagGpuText') >= 0, 'on the DIAG screen, skipped from SETTINGS');
const { Diag } = require(path.join(engine('twin_dial').dir, 'diag_settings.js'));
const vals = { diagGpuText: 'off' }, cfg = JSON.parse(JSON.stringify(spec.config));
const settings = { item: (k) => spec.settings.find((s) => s.key === k) || null, get: (k) => vals[k] };
const d = Diag.create(cfg, settings, { info() {}, warn() {} });
let rebuilds = 0;
const hud = { atlases: new Map(), config: cfg, log: { info() {}, warn() {} }, _rebuild: () => { rebuilds++; }, _status() {} };
const keyOf = () => { const h = Object.create(engine('twin_dial').HudApp.prototype); h.config = cfg; return h._exactKey({ font: 'td_big', exact: { pitch: 82, cw: 41, h: 70 } }, 1); };
const k0 = keyOf();
vals.diagGpuText = 'legacy'; d.changed(hud, 'diagGpuText');
const k1 = keyOf();
ok(cfg.gpuText === 'legacy' && rebuilds === 1 && k1 !== k0 && /:legacy$/.test(k1), 'legacy: config.gpuText "legacy", one rebuild, another atlas key (' + k0 + ' -> ' + k1 + ')');
vals.diagGpuText = 'pixels'; d.changed(hud, 'diagGpuText');
ok(cfg.gpuText === 'pixels' && rebuilds === 2, 'pixels: config.gpuText "pixels", a rebuild');
vals.diagGpuText = 'off'; d.changed(hud, 'diagGpuText');
ok(!('gpuText' in cfg) && rebuilds === 3 && keyOf() === k0, 'off: the key removed again, a rebuild, the aligned atlas\'s key');

/* ---------------- 7. on the bench: the switch live (Node 18+, fetch; --static skips it) ---------------- */
const os = require('os');
const { spawn } = require('child_process');
const PORT = Number(process.env.BENCH_PORT) || 8920;
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await req('GET', '/probe'); if (fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(150);
    }
    return p;
}
async function stop() {
    if (!server) return;
    const s = server;
    server = null;
    await new Promise((r) => { s.once('exit', r); s.kill('SIGTERM'); setTimeout(r, 5000); });
}
/** Replays the trace: the assets made (conn:ref -> w x h) and every asset dropped while a live layer still bound it. */
function replay(file) {
    const L = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.dir === 'in');
    const layers = new Map(), assets = new Map(), early = [];
    L.forEach((e) => {
        const k = e.conn + ':' + e.ref;
        if (e.op === 'asset') assets.set(k, { w: e.w, h: e.h, format: e.format });
        else if (e.op === 'layer') layers.set(k, { binds: {} });
        else if (e.op === 'bind' && layers.has(k)) layers.get(k).binds[e.sampler] = e.conn + ':' + e.asset;
        else if (e.op === 'drop') {
            if (assets.has(k)) {
                layers.forEach((l, lk) => { if (Object.keys(l.binds).some((s) => l.binds[s] === k)) early.push(k + ' (bound by ' + lk + ')'); });
                assets.delete(k);
            } else layers.delete(k);
        }
    });
    return { assets, early };
}
async function live() {
    console.log('7. on the bench: Twin Dial, the switch off -> legacy -> pixels -> off');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-rows-')), data = path.join(tmp, 'data');
    fs.mkdirSync(data);
    const trace = path.join(tmp, 'trace.jsonl');
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: data, BENCH_TRACE: trace, BENCH_LAYER_CAP: '8', SCREEN_DIR: path.join(tmp, 'screen') });
    delete env.BENCH_CONFIG;
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'twin_dial'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (d) => { logText += d; });
    server.stderr.on('data', (d) => { logText += d; });
    let p = await until((q) => q && q.ready && q.activeName, 90000);
    ok(p && p.ready, 'the app runs');
    await sleep(2500);
    const atl = () => Array.from(replay(trace).assets.values()).filter((a) => a.format === 'r8' && a.h === 70).map((a) => a.w + 'x' + a.h).sort().join(', ');
    const errs = () => (logText.match(/protocol \[[^\]]*\]: [^\n]*/g) || []);
    const e0 = errs().length;
    ok(atl() === '1148x70, 1148x70', 'off: the two td_big atlases are 1148x70 (' + atl() + ')');
    await req('POST', '/click', { id: 'BTN_DIAG' });
    await until((q) => q.stack.indexOf('DIAG') >= 0, 4000);
    const step = async (row, want, name) => {
        await req('POST', '/click', { id: 'SET_DIAGGPUTEXT', row });
        p = await until((q) => q.settings.diagGpuText === want, 4000);
        await sleep(2500);
        ok(p && p.settings.diagGpuText === want && new RegExp('diag: diagGpuText ' + want).test(logText), name + ': the setting is ' + want + ' and logged');
    };
    await step(1, 'legacy', 'legacy');
    ok(atl() === '1066x70, 1066x70', 'legacy: the atlases are 0.1.3\'s again, 1066x70 (' + atl() + ')');
    ok(/rows 1066 bytes: NOT a multiple of 4 \(config\.gpuText "legacy"\)/.test(logText), 'legacy: logged as not aligned');
    await step(2, 'pixels', 'pixels');
    ok(atl() === '', 'pixels: no td_big atlas left (' + (atl() || 'none') + ')');
    ok(/widget "gear": "gpu" set aside/.test(logText) && /widget "speed": "gpu" set aside/.test(logText), 'pixels: the gear and the speed are image texts');
    await step(0, 'off', 'off');
    ok(atl() === '1148x70, 1148x70', 'off: 1148x70 again (' + atl() + ')');
    const r = replay(trace);
    ok(!r.early.length, 'no asset was dropped while a layer still bound it' + (r.early.length ? ': ' + r.early.join(', ') : ''));
    ok(errs().length === e0, 'no protocol error in the three switches' + (errs().length > e0 ? ': ' + errs().slice(e0).join(' | ') : ''));
    p = await req('GET', '/probe');
    ok(p && p.ready, 'the app is still up');
    await stop();
}

(process.argv.indexOf('--static') >= 0 || typeof fetch !== 'function' ? Promise.resolve(console.log('7. on the bench: skipped (--static or no fetch)')) : live())
    .catch((e) => { failed++; console.log('  FAIL the bench run: ' + (e && e.message || e)); })
    .then(() => stop())
    .then(() => {
        console.log('\n' + passed + ' passed, ' + failed + ' failed');
        process.exit(failed ? 1 : 0);
    });
