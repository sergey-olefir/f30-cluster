'use strict';
/**
 * test-scene-tex.js - research3 MT (docs/research3/MT-REPORT.md): app.json config.sceneTex, the lighter scene textures.
 *
 *   node bench/test-scene-tex.js            (BENCH_PORT, default 8302)
 *
 * Without the bench:
 *   1. off is today's build: no config.sceneTex in app.json, and shaders.sceneTex() with nothing asked returns the 6WB
 *      shaders byte for byte; asked, it makes exactly its edits (one r8a(), the extra sampler, the tint) or throws;
 *   2. the variant files (tools/research3/mt/bake_variants.py) are what they claim: sizes, formats, ETC2 dimensions in
 *      whole blocks, and their pixels against today's RGBA8 file: the R8 coverages exact, the window within 3 / 255,
 *      value x colour and the ETC2 blocks (decoded by bench/etc2.js) within the bounds measured in the report.
 * With the bench (its own, on BENCH_PORT), once per mode (off, "etc2" through BENCH_CONFIG; car-issues: "r8" is gone):
 *   3. 6WB Comfort, then 6WB Sport, Comfort + G20 and Comfort again: each layout builds with nothing refused and no
 *      layer left unbound; the scene textures go up in the mode's formats; the service's pixel memory is the sum the
 *      report gives (off: today's 11 963 960 bytes in Comfort); "etc2" uses less, and every texture is made
 *      once per layout (none sent twice).
 *   4. car-issues TX: the Діагностика setting switched live, off -> etc2 -> off -> etc2, a theme change and back: nothing
 *      refused, nothing left behind, every sampler bound, the pixel memory each time the cold start's of that mode.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'f30_cluster');
const PORT = Number(process.env.BENCH_PORT) || 8302;
const BASE = 'http://127.0.0.1:' + PORT;
const shaders = require('../shared/shaders');
const etc2 = require('./etc2');

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scene = (n) => JSON.parse(fs.readFileSync(path.join(APP, 'hud', 'scene', n + '.json'), 'utf8'));
const DIALS = ['speedo', 'tacho', 'speedo_d', 'tacho_d', 'fuel', 'oil'];

/** today's RGBA8 file, premultiplied over black (float 0..255) */
function premul(n) {
    const j = scene(n), b = Buffer.from(j.rgba, 'base64'), out = new Float64Array(j.w * j.h * 3);
    for (let i = 0; i < j.w * j.h; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = b[i * 4 + c] * b[i * 4 + 3] / 255;
    return { w: j.w, h: j.h, pm: out, rgba: b };
}
function stats(errs) {
    let max = 0, sum = 0, n16 = 0;
    errs.forEach((e) => { if (e > max) max = e; sum += e; if (e > 16) n16++; });
    return { max: Math.round(max * 10) / 10, mean: Math.round(sum / errs.length * 1000) / 1000, over16: n16 };
}

function offline() {
    console.log('1. off is today\'s build; the shader edits are exact');
    const app = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
    ok(app.config && (app.config.sceneTex === undefined || app.config.sceneTex === null), 'app.json config.sceneTex is off (' + JSON.stringify(app.config.sceneTex) + ')');
    const fsD = shaders.wbdialFor(0, true), fsB = shaders.wbbackFor(0, true), fsM = shaders.wbdialFor(3, true);
    ok(shaders.sceneTex(fsD, {}) === fsD && shaders.sceneTex(fsB, {}) === fsB && shaders.sceneTex(fsM, { base: 'pm' }) === fsM,
        'nothing asked (or an ETC2 "pm" texture): the 6WB shaders come back byte for byte');
    const v = shaders.sceneTex(fsD, { base: 'v8', deco: 'a8' });
    ok((v.match(/float r8a\(/g) || []).length === 1 && /uniform sampler2D u_baseC;/.test(v) &&
        /bs = vec4\(r8a\(texture2D\(u_base, bu\)\) \* texture2D\(u_baseC, bu\)\.rgb, 1\.0\);/.test(v) && /r8a\(texture2D\(u_deco, du\)\)/.test(v) &&
        !/texture2D\(u_deco, du\)\.a/.test(v), 'WBDIAL v8 + a8: one r8a(), the colour sampler, value x colour, the coverage from .r');
    const t = shaders.sceneTex(fsB, { t0: 'tint', tint: [0.5, 0.25, 1] });
    ok((t.match(/float r8a\(/g) || []).length === 1 && /vec4 t = vec4\(r8a\(texture2D\(u_t0, u0\)\) \* vec3\(0\.500000, 0\.250000, 1\.000000\), 1\.0\);/.test(t),
        'WBBACK tint: the window R8 over its tint, WBBACK\'s own r8a() reused');
    console.log('  shader bytes: WBDIAL comfort ' + fsD.length + ' -> ' + v.length + ', WBBACK comfort ' + fsB.length + ' -> ' + t.length);
    let threw = false;
    try { shaders.sceneTex(shaders.wbsignFor(true), { base: 'v8' }); } catch (e) { threw = /exactly once/.test(e.message); }
    ok(threw, 'an edit whose anchor is missing throws instead of drawing something else');

    console.log('2. the variant files');
    // car-issues (the owner, 2026-11-19): "r8" is gone; no @r8 / @r8c variant is left in the package, and every R8 file there has
    // rows that are whole 4-byte rows (the car shears an R8 texture whose width is not a multiple of 4)
    const SCENE_DIR = path.join(APP, 'hud', 'scene');
    const files = fs.readdirSync(SCENE_DIR).filter((f) => /\.json$/.test(f) && !/\.regions\.json$/.test(f));
    ok(!files.some((f) => /@r8c?\.json$/.test(f)), 'no @r8 / @r8c variant file is left (' + files.filter((f) => /@r8/.test(f)).join(', ') + ')');
    const badRows = files.map((f) => { const j = JSON.parse(fs.readFileSync(path.join(SCENE_DIR, f), 'utf8')); return j && j.format === 'r8' && j.w % 4 ? f + ' ' + j.w : null; }).filter(Boolean);
    ok(!badRows.length, 'every R8 scene file of f30_cluster has a width that is a multiple of 4' + (badRows.length ? ' (not: ' + badRows.join(', ') + ')' : ''));
    DIALS.concat(['window']).forEach((n) => {
        const j = scene(n + '@etc2'), o = premul(n), d = etc2.decode(j.format, Buffer.from(j.etc2, 'base64'), j.w, j.h), e = [];
        for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) for (let k = 0; k < 3; k++) e.push(Math.abs(d[(y * j.w + x) * 4 + k] - o.pm[(y * o.w + x) * 3 + k]));
        const s = stats(e);
        ok(j.format === 'etc2rgb' && j.enc === 'pm' && j.w % 4 === 0 && j.h % 4 === 0 && j.src[0] === o.w && j.src[1] === o.h &&
            Buffer.from(j.etc2, 'base64').length === j.w * j.h / 2 && s.max <= 140 && s.mean < 2.5,
            n + '@etc2: etc2rgb ' + j.w + 'x' + j.h + ' (from ' + o.w + 'x' + o.h + '), decoded: max ' + s.max + ', mean ' + s.mean);
    });
}

// ---------------------------------------------------------------- the bench
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
const setting = (key, value) => req('POST', '/setting', { key, value });
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* app (re)starting */ }
        await sleep(150);
    }
    return p;
}
function events() {
    return new Promise((resolve) => {
        let buf = '';
        const rq = http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => {
            res.setEncoding('utf8');
            res.on('data', (d) => {
                buf += d;
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const ch = buf.slice(0, i); buf = buf.slice(i + 2);
                    const mm = /^data: (.*)$/m.exec(ch);
                    let msg = null;
                    try { msg = mm && JSON.parse(mm[1]); } catch (e) { continue; }
                    if (!msg || msg.t !== 'scene') continue;
                    res.destroy(); rq.destroy();
                    return resolve(msg);
                }
            });
        });
        rq.on('error', () => resolve(null));
        setTimeout(() => resolve(null), 10000);
    });
}
/** The scene once two reads agree on the assets and the pixel memory (the layout has settled). */
async function settled() {
    let prev = null;
    for (let i = 0; i < 20; i++) {
        const m = await events();
        const k = m && JSON.stringify([m.pixels, m.layers.filter((l) => l.kind === 'asset').map((l) => [l.format, l.iw, l.ih])]);
        if (k && k === prev) return m;
        prev = k;
        await sleep(400);
    }
    return null;
}

const EXPECT = {      // per mode: the formats of Comfort's scene textures (by size) and Comfort's pixel memory
    off: { comfort: 11963960, formats: { '670x670': 'rgba8', '320x286': 'rgba8', '346x68': 'rgba8', '144x144': 'rgba8' } },
    etc2: { formats: { '672x672': 'etc2rgb', '320x288': 'etc2rgb', '346x68': 'rgba8', '144x144': 'etc2rgb' } },     // car-issues: the arcs as off, no @r8
};

async function bench(mode) {
    console.log('3. the bench, config.sceneTex ' + (mode === 'off' ? 'off' : '"' + mode + '"'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scenetex-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir });
    if (mode !== 'off') env.BENCH_CONFIG = JSON.stringify({ sceneTex: mode });
    else delete env.BENCH_CONFIG;
    let logText = '', exited = false;
    const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d) => { logText += d; if (/app exited/.test(String(d))) exited = true; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);
    const res = {};
    try {
        let p = await until((q) => q && q.ready && q.activeName, 90000);
        ok(p && p.ready, mode + ': the app runs');
        if (!p || !p.ready) return res;
        await setting('byMode', false);
        await setting('g20', false);
        const steps = [['wb_comfort', false], ['wb_sport', false], ['wb_comfort', true], ['wb_comfort', false]];
        for (const [lay, g20] of steps) {
            await setting('hudLayout', lay);
            await setting('g20', g20);
            const want = g20 ? 'wb_dials' : lay;
            p = await until((q) => q.activeName === want, 20000);
            await sleep(1200);
            const m = await settled();
            const name = want + (res[want] ? '#2' : '');
            if (!m) { ok(false, mode + ' ' + name + ': no scene'); continue; }
            const assets = m.layers.filter((l) => l.kind === 'asset');
            const bad = m.layers.filter((l) => l.state === 'error' || l.state === 'waiting');
            const effects = m.layers.filter((l) => l.kind === 'effect' && l.visible);
            const unbound = effects.filter((l) => ((l.fs || '').match(/uniform\s+sampler2D\s+(\w+)\s*;/g) || []).some((d) => !(l.binds || {})[d.replace(/uniform\s+sampler2D\s+|\s*;/g, '')]));
            ok(p.activeName === want && !bad.length && !unbound.length, mode + ' ' + name + ': ' + m.layers.length + ' layers and assets, none in error or waiting, every sampler bound' +
                (bad.length ? ' (' + bad.map((l) => l.key + ' ' + l.state + ' ' + l.reason).join('; ') + ')' : '') + (unbound.length ? ' (unbound in ' + unbound.map((l) => l.key).join(', ') + ')' : ''));
            res[name] = { pixels: m.pixels, assets: assets.map((l) => l.format + ' ' + l.iw + 'x' + l.ih) };
            console.log('  ' + name + ': pixel memory ' + m.pixels + ' bytes; assets ' + res[name].assets.join(', '));
            if (want === 'wb_comfort' && !res[name + '-checked']) {
                res[name + '-checked'] = true;
                const ex = EXPECT[mode];
                const wrong = assets.filter((l) => ex.formats[l.iw + 'x' + l.ih] && ex.formats[l.iw + 'x' + l.ih] !== l.format);
                const missing = Object.keys(ex.formats).filter((k) => !assets.some((l) => l.iw + 'x' + l.ih === k));
                ok(!wrong.length && !missing.length, mode + ' Comfort: the scene textures in ' + JSON.stringify(ex.formats) +
                    (wrong.length ? ' (wrong: ' + wrong.map((l) => l.iw + 'x' + l.ih + ' ' + l.format).join(', ') + ')' : '') + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
                if (ex.comfort) ok(m.pixels === ex.comfort, mode + ' Comfort: pixel memory ' + m.pixels + ' = today\'s ' + ex.comfort);
            }
        }
        const refused = /refus|pixel memory is full|too many assets|is sent once|takes no rects|scene texture .* (missing|does not match)/i.exec(logText);
        ok(!refused, mode + ': nothing refused by the service or the engine' + (refused ? ' (' + refused[0] + ')' : ''));
        ok(!exited && !/uncaught|app exited/.test(logText), mode + ': the app never exited');
        if (mode !== 'off') ok(new RegExp('scene texture "speedo": 6[67][02]x6[67][02] ' + 'etc2rgb' + ' asset \\(speedo@' + mode + '\\)').test(logText),
            mode + ': the log names the variant file ("scene texture "speedo": ... (speedo@' + mode + ')")');
    } finally {
        server.kill('SIGTERM');
        await sleep(800);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    }
    return res;
}

/**
 * 4. car-issues TX: the Діагностика setting switched LIVE (off -> r8 -> etc2 -> off -> r8, then a theme change and back), as the
 * owner does on the car. Before the fix every switch dropped the scene textures while the old layers still bound them: the service
 * refused ("asset in use"), the client kept them, connection 1 reached its 16 assets and the new set was refused ("too many
 * assets"), layers were left with an unbound sampler. Now: nothing refused, no asset that nothing samples, every sampler bound,
 * and after each switch the pixel memory is the cold start's of that mode (`cold`: Comfort from 3., by mode).
 */
async function live(cold) {
    console.log('4. the setting switched live (diagSceneTex), Comfort');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scenetex-live-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir });
    delete env.BENCH_CONFIG;
    let logText = '';
    const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (d) => { logText += d; }); server.stderr.on('data', (d) => { logText += d; });
    try {
        let p = await until((q) => q && q.ready && q.activeName, 90000);
        ok(p && p.ready, 'live: the app runs');
        if (!p || !p.ready) return;
        await setting('byMode', false); await setting('g20', false); await setting('hudLayout', 'wb_comfort');
        await until((q) => q.activeName === 'wb_comfort', 20000);
        const steps = [['off'], ['etc2'], ['off'], ['etc2'], ['etc2', 'wb_sport'], ['etc2', 'wb_comfort'], ['off']];
        let mode = 'off';
        for (let i = 0; i < steps.length; i++) {
            const [m, lay] = steps[i];
            if (lay) { await setting('hudLayout', lay); await until((q) => q.activeName === lay, 20000); }
            else if (i > 0) { await setting('diagSceneTex', m); await until((q) => q.settings && q.settings.diagSceneTex === m, 4000); }
            mode = m;
            await sleep(1500);
            const s = await settled();
            const name = 'live #' + i + ' ' + m + (lay ? ' ' + lay : '');
            if (!s) { ok(false, name + ': no scene'); continue; }
            const assets = s.layers.filter((l) => l.kind === 'asset');
            const bound = new Set();
            s.layers.forEach((l) => Object.keys(l.binds || {}).forEach((k) => bound.add(l.binds[k])));
            // the 1x1 blank stays while the connection lives (hud.js _blank); every other asset is sampled by a layer
            const orphans = assets.filter((a) => !bound.has(a.key) && !(a.iw === 1 && a.ih === 1));
            const effects = s.layers.filter((l) => l.kind === 'effect' && l.visible);
            const unbound = effects.filter((l) => ((l.fs || '').match(/uniform\s+sampler2D\s+(\w+)\s*;/g) || []).some((d) => !(l.binds || {})[d.replace(/uniform\s+sampler2D\s+|\s*;/g, '')]));
            ok(!orphans.length && !unbound.length, name + ': ' + assets.length + ' assets, none left behind, every sampler bound' +
                (orphans.length ? ' (left behind: ' + orphans.map((a) => a.format + ' ' + a.iw + 'x' + a.ih).join(', ') + ')' : '') + (unbound.length ? ' (unbound in ' + unbound.map((l) => l.key).join(', ') + ')' : ''));
            if (!lay || lay === 'wb_comfort') {
                const want = cold[mode];
                if (want) ok(s.pixels === want, name + ': pixel memory ' + s.pixels + ' = the cold start\'s in "' + mode + '" (' + want + ')');
            }
        }
        const refused = logText.match(/refused [^\n]*|pixel memory is full|too many assets/g) || [];
        ok(!refused.length, 'live: the service refused nothing (' + (refused.length ? refused.length + ', first: ' + refused[0] : 'no "refused" line') + ')');
        ok(!/uncaught|app exited/.test(logText), 'live: the app never exited');
    } finally {
        server.kill('SIGTERM');
        await sleep(800);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    }
}

async function main() {
    offline();
    const r = {};
    for (const mode of ['off', 'etc2']) r[mode] = await bench(mode);
    const cold = {};
    ['off', 'etc2'].forEach((m) => { if (r[m] && r[m].wb_comfort) cold[m] = r[m].wb_comfort.pixels; });
    await live(cold);
    const pc = (m) => r[m] && r[m].wb_comfort && r[m].wb_comfort.pixels;
    if (pc('off') && pc('etc2')) {
        ok(pc('etc2') < pc('off'), 'Comfort pixel memory: off ' + pc('off') + ' > etc2 ' + pc('etc2'));
        ok(r.etc2['wb_comfort#2'] && r.etc2['wb_comfort#2'].pixels === pc('etc2'),
            'Comfort again after Sport and the G20 toggle: the same pixel memory in etc2 (nothing left behind)');
    }
    console.log('  RESULT ' + JSON.stringify(r));
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
});
