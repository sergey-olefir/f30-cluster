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
 * With the bench (its own, on BENCH_PORT), once per mode (off, "r8", "etc2" through BENCH_CONFIG):
 *   3. 6WB Comfort, then 6WB Sport, Comfort + G20 and Comfort again: each layout builds with nothing refused and no
 *      layer left unbound; the scene textures go up in the mode's formats; the service's pixel memory is the sum the
 *      report gives (off: today's 11 963 960 bytes in Comfort); "r8" and "etc2" use less, and every texture is made
 *      once per layout (none sent twice).
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
    ['range_seg', 'ed_seg'].forEach((n) => {
        const j = scene(n + '@r8'), o = premul(n), a = Buffer.from(j.r8, 'base64');
        let same = a.length === o.w * o.h;
        for (let i = 0; same && i < a.length; i++) same = a[i] === o.rgba[i * 4 + 3];
        ok(j.format === 'r8' && j.enc === 'a8' && j.w === o.w && j.h === o.h && same, n + '@r8: R8, its alpha byte for byte');
    });
    {
        const j = scene('window@r8'), o = premul('window'), a = Buffer.from(j.r8, 'base64'), e = [];
        for (let i = 0; i < o.w * o.h; i++) for (let c = 0; c < 3; c++) e.push(Math.abs(a[i] / 255 * j.tint[c] * 255 - o.pm[i * 3 + c]));
        const s = stats(e);
        ok(j.format === 'r8' && j.enc === 'tint' && j.tint.length === 3 && s.max <= 3, 'window@r8: R8 x tint, max error ' + s.max + ' / 255 (<= 3)');
    }
    DIALS.forEach((n) => {
        const j = scene(n + '@r8'), c = scene(j.chroma), o = premul(n), V = Buffer.from(j.r8, 'base64'), C = Buffer.from(c.rgba, 'base64'), e = [];
        // the GPU's bilinear lookup of the colour map at this texel's uv (clamp to edge)
        for (let y = 0; y < o.h; y++) {
            for (let x = 0; x < o.w; x++) {
                const u = (x + 0.5) / o.w * c.w - 0.5, vv = (y + 0.5) / o.h * c.h - 0.5;
                const x0 = Math.max(0, Math.min(c.w - 1, Math.floor(u))), y0 = Math.max(0, Math.min(c.h - 1, Math.floor(vv)));
                const x1 = Math.min(c.w - 1, x0 + 1), y1 = Math.min(c.h - 1, y0 + 1);
                const fx = Math.max(0, Math.min(1, u - x0)), fy = Math.max(0, Math.min(1, vv - y0));
                for (let k = 0; k < 3; k++) {
                    const s = (xx, yy) => C[(yy * c.w + xx) * 4 + k];
                    const col = (s(x0, y0) * (1 - fx) + s(x1, y0) * fx) * (1 - fy) + (s(x0, y1) * (1 - fx) + s(x1, y1) * fx) * fy;
                    e.push(Math.abs(V[y * o.w + x] * col / 255 - o.pm[(y * o.w + x) * 3 + k]));
                }
            }
        }
        const s = stats(e);
        const bound = n.indexOf('tacho') === 0 ? 120 : 70;
        ok(j.format === 'r8' && j.enc === 'v8' && c.w === Math.ceil(o.w / 4) && s.max <= bound && s.mean < 1.0,
            n + '@r8: R8 value x colour at 1/4 (' + c.w + 'x' + c.h + '): max ' + s.max + ', mean ' + s.mean + ', ' + s.over16 + ' texel channels over 16');
    });
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
    r8: { formats: { '670x670': 'r8', '168x168': 'rgba8', '320x286': 'r8', '346x68': 'r8', '144x144': 'r8', '36x36': 'rgba8' } },
    etc2: { formats: { '672x672': 'etc2rgb', '320x288': 'etc2rgb', '346x68': 'r8', '144x144': 'etc2rgb' } },
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
        if (mode !== 'off') ok(new RegExp('scene texture "speedo": 6[67][02]x6[67][02] ' + (mode === 'r8' ? 'R8' : 'etc2rgb') + ' asset \\(speedo@' + mode + '\\)').test(logText),
            mode + ': the log names the variant file ("scene texture "speedo": ... (speedo@' + mode + ')")');
    } finally {
        server.kill('SIGTERM');
        await sleep(800);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    }
    return res;
}

async function main() {
    offline();
    const r = {};
    for (const mode of ['off', 'r8', 'etc2']) r[mode] = await bench(mode);
    const pc = (m) => r[m] && r[m].wb_comfort && r[m].wb_comfort.pixels;
    if (pc('off') && pc('r8') && pc('etc2')) {
        ok(pc('r8') < pc('off') && pc('etc2') < pc('r8'), 'Comfort pixel memory: off ' + pc('off') + ' > r8 ' + pc('r8') + ' > etc2 ' + pc('etc2'));
        ok(r.r8['wb_comfort#2'] && r.r8['wb_comfort#2'].pixels === pc('r8') && r.etc2['wb_comfort#2'] && r.etc2['wb_comfort#2'].pixels === pc('etc2'),
            'Comfort again after Sport and the G20 toggle: the same pixel memory in both modes (nothing left behind)');
    }
    console.log('  RESULT ' + JSON.stringify(r));
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
});
