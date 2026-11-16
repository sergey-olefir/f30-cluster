'use strict';
/**
 * bench_matte.js - the bench proof of the diagnostic mattes (strip package D; design/gen_matte.py).
 *
 *   node tools/strip/D/bench_matte.js [outDir]          (BENCH_PORT, default 8165)
 *
 * Starts bench/server.js for f30_cluster with the car's limits on (BENCH_LAYER_CAP=8, 16 MiB of pixel memory), its own
 * data folder, and stops it again at the end (a bounded child of this script, never left running). For each matte:
 * Theme = the matte with 'Change with the drive mode' off, then, from the engine's own output only (no browser):
 *   - the scene (GET /events): every layer of ours on the panel, its kind, state, shader source and uniforms;
 *   - the image layers' pixels (GET /px);
 *   - a re-implementation of the two effect shaders it uses (FILL and GRID of shared/shaders.js, matched by source)
 *     composited in the service's order (class, z, then the newer layer on top) into the 1920 x 720 panel;
 * and checks: the layer count and kinds, nothing waiting or refused, no sampler, the pixel memory and its peak while
 * switching from and back to 6WB Comfort, every panel pixel opaque, every pixel off the ruler exactly the matte
 * colour, every ruler tick where gen_matte.py says, and the matte colour unchanged under the night colours.
 * Writes matte_<colour>_panel.png (the composite) and matte_bench.json to outDir (default bake/work/strip/pub/D).
 * Exit code 0 when every check passes. Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const PORT = Number(process.env.BENCH_PORT) || 8165;
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'bake', 'work', 'strip', 'pub', 'D'));
const shaders = require(path.join(ROOT, 'shared', 'shaders.js'));
const PW = 1920, PH = 720;
const MATTES = { matte_magenta: [255, 0, 255], matte_green: [0, 255, 0], matte_black: [0, 0, 0] };
const WHITE = [255, 255, 255], YELLOW = [255, 230, 0];
const CLASSES = ['ambient', 'content', 'overlay', 'alert'];

let server = null, logText = '', passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, url, body) {
    const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 200) return url === '/px' || url.indexOf('/px?') === 0 ? Buffer.from(await r.arrayBuffer()) : r.json();
    if (r.status !== 204) throw new Error(method + ' ' + url + ': ' + r.status);
    return null;
}
const probe = () => req('GET', '/probe');
async function until(fn, ms) {
    const end = Date.now() + (ms || 10000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(150);
    }
    return p;
}

/** The event stream, kept open for the whole run: the last scene, the peak pixel memory seen, the log lines. */
const ev = { scene: null, peak: 0, logs: [], req: null };
function listen() {
    return new Promise((resolve) => {
        let buf = '';
        ev.req = http.get(BASE + '/events', (res) => {
            res.setEncoding('utf8');
            res.on('data', (d) => {
                buf += d;
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const line = buf.slice(0, i); buf = buf.slice(i + 2);
                    if (line.indexOf('data: ') !== 0) continue;
                    let m; try { m = JSON.parse(line.slice(6)); } catch (e) { continue; }
                    if (m.t === 'scene') { ev.scene = m; ev.peak = Math.max(ev.peak, m.pixels || 0); }
                    else if (m.t === 'log') ev.logs.push(m.text);
                }
            });
            resolve();
        });
        ev.req.on('error', () => resolve());
    });
}

/* ---------- the two shaders, as GLSL computes them at a pixel centre (p = layer px + 0.5) ---------- */
const mod = (a, b) => a - b * Math.floor(a / b);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function fillAt(u, px, py) {
    const c = u.u_color.v; let a = c[3];
    const h = u.u_hole ? u.u_hole.v : [0, 0, 0, 0], r = u.u_holeR ? u.u_holeR.v[0] : 0;
    if (h[2] > 0) {
        const hx = h[2] / 2, hy = h[3] / 2;
        const qx = Math.abs(px - (h[0] + hx)) - (hx - r), qy = Math.abs(py - (h[1] + hy)) - (hy - r);
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
        a *= clamp(d + 0.5, 0, 1);
    }
    return [c[0], c[1], c[2], a];
}
function gridAt(u, px, py) {
    const [sx, sy] = u.u_size.v, step = u.u_step.v[0], major = u.u_major.v[0];
    const mx = mod(px, step), my = mod(py, step), bx = mod(px, step * major), by = mod(py, step * major);
    const edge = px < 2 || py < 2 || px > sx - 2 || py > sy - 2;
    if (edge || bx < 2 || by < 2) return u.u_majorC.v.slice();
    if (mx < 1 || my < 1) return u.u_minor.v.slice();
    return [0, 0, 0, 0];
}
const SHADE = [[shaders.fill, fillAt, 'FILL'], [shaders.grid, gridAt, 'GRID']];

/** The panel as the service would composite our layers: Float32 RGBA 0..1, straight alpha over transparent. */
async function composite(layers) {
    const out = new Float32Array(PW * PH * 4);
    const order = layers.map((l, i) => ({ l, i })).sort((a, b) =>
        (CLASSES.indexOf(a.l.class) - CLASSES.indexOf(b.l.class)) || (a.l.z - b.l.z) || (a.i - b.i)).map((e) => e.l);
    for (const l of order) {
        if (!l.visible || l.state !== 'shown') continue;
        let at;
        if (l.kind === 'effect') {
            const s = SHADE.find((x) => x[0] === l.fs);
            if (!s) throw new Error('layer ' + l.key + ': an effect source this proof does not model');
            at = (i, j) => s[1](l.uniforms, i + 0.5, j + 0.5);
        } else if (l.kind === 'image') {
            const px = await req('GET', '/px?key=' + encodeURIComponent(l.key) + '&x=0&y=0&w=' + l.iw + '&h=' + l.ih);
            at = (i, j) => { const o = (j * l.iw + i) * 4; return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, px[o + 3] / 255]; };
        } else continue;
        for (let j = 0; j < l.h; j++) {
            for (let i = 0; i < l.w; i++) {
                const X = l.x + i, Y = l.y + j;
                if (X < 0 || Y < 0 || X >= PW || Y >= PH) continue;
                const c = at(i, j), a = c[3] * (l.opacity === undefined ? 1 : l.opacity);
                if (a <= 0) continue;
                const o = (Y * PW + X) * 4, ua = out[o + 3], na = a + ua * (1 - a);
                for (let k = 0; k < 3; k++) out[o + k] = (c[k] * a + out[o + k] * ua * (1 - a)) / na;
                out[o + 3] = na;
            }
        }
    }
    return out;
}

/* ---------- a PNG writer (RGB, 8 bit) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function png(rgb, w, h) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- what gen_matte.py promises, pixel by pixel ---------- */
function expected(matte, X, Y) {
    for (const y0 of [540, 708]) {
        if (Y < y0 || Y >= y0 + 12) continue;
        const r = Y - y0;
        if (r < 2 || r >= 10 || X < 2 || X >= 1918 || X % 100 < 2) return YELLOW;
        if (X % 10 === 0) return WHITE;
        return matte;
    }
    return matte;
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

async function oneMatte(name, report) {
    console.log(name);
    const matte = MATTES[name];
    await req('POST', '/setting', { key: 'hudLayout', value: name });
    const p = await until((q) => q.activeName === name && /^Cluster on/.test(q.status || ''), 15000);
    ok(p && p.activeName === name, name + ': built (' + ((p && p.status) || '').slice(0, 120) + ')');
    await sleep(1200);                       // the scene message is debounced; let the last one land
    const all = (ev.scene && ev.scene.layers) || [];
    const ours = all.filter((l) => l.target === 'panel' && l.kind !== 'asset');
    const eff = ours.filter((l) => l.kind === 'effect'), img = ours.filter((l) => l.kind === 'image');
    ok(ours.length === 4 && eff.length === 3 && img.length === 1, name + ': 4 layers on the panel, 3 effects + 1 image (' +
        ours.map((l) => l.kind + ' ' + l.x + ',' + l.y + ' ' + l.w + 'x' + l.h).join('; ') + ')');
    ok(new Set(ours.map((l) => l.conn)).size === 1, name + ': all on one connection (' + Array.from(new Set(ours.map((l) => l.conn))).join(', ') + ')');
    ok(ours.every((l) => l.state === 'shown'), name + ': every layer shown under the layer cap of 8');
    // an asset left from an earlier layout (6WB Comfort's 1x1 blank, hud.js _blank, kept for reuse) is not ours to count:
    // what matters is that no matte layer samples anything
    const assets = all.filter((l) => l.kind === 'asset'), assetBytes = assets.reduce((n, a) => n + a.iw * a.ih * (a.format === 'r8' ? 1 : 4) * 2, 0);
    ok(eff.every((l) => !/sampler2D/.test(l.fs) && !Object.keys(l.binds || {}).length),
        name + ': no sampler2D in any matte layer, nothing bound (assets left from the layout before: ' +
        (assets.map((a) => a.format + ' ' + a.iw + 'x' + a.ih).join(', ') || 'none') + ')');
    const srcs = eff.map((l) => (SHADE.find((s) => s[0] === l.fs) || [0, 0, '?'])[2]);
    ok(srcs.every((s) => s !== '?'), name + ': the effects are FILL and GRID of shared/shaders.js unchanged (' + srcs.join(', ') + ')');
    const bytes = {}; eff.forEach((l, i) => { bytes[srcs[i]] = Buffer.byteLength(l.fs, 'utf8'); });
    const pix = ev.scene.pixels;
    ok(pix - assetBytes === 1900 * 17 * 4 * 2, name + ': pixel memory ' + (pix - assetBytes) + ' bytes = the label sheet 1900 x 17 x 4, counted twice (' +
        ((pix - assetBytes) / 1048576).toFixed(3) + ' MiB; + ' + assetBytes + ' bytes of leftover assets)');

    const t0 = Date.now();
    const comp = await composite(ours);
    let notOpaque = 0, wrong = 0, offRuler = 0, ink = 0, firstWrong = null, inkBox = [PW, PH, 0, 0];
    const rgb = Buffer.alloc(PW * PH * 3), labelBand = (Y) => Y >= 552 && Y < 569;
    for (let Y = 0; Y < PH; Y++) {
        for (let X = 0; X < PW; X++) {
            const o = (Y * PW + X) * 4;
            const c = [Math.round(comp[o] * 255), Math.round(comp[o + 1] * 255), Math.round(comp[o + 2] * 255)];
            rgb[(Y * PW + X) * 3] = c[0]; rgb[(Y * PW + X) * 3 + 1] = c[1]; rgb[(Y * PW + X) * 3 + 2] = c[2];
            if (comp[o + 3] < 1 - 1e-6) notOpaque++;
            if (labelBand(Y) && X < 1900) {                  // the labels: anti-aliased yellow, anywhere in the band
                if (!same(c, matte)) { ink++; inkBox = [Math.min(inkBox[0], X), Math.min(inkBox[1], Y), Math.max(inkBox[2], X + 1), Math.max(inkBox[3], Y + 1)]; }
                continue;
            }
            const e = expected(matte, X, Y);
            if (!same(c, e)) { wrong++; if (!firstWrong) firstWrong = [X, Y, c, e]; }
            if (same(e, matte)) offRuler++;
        }
    }
    ok(notOpaque === 0, name + ': all ' + PW * PH + ' panel pixels opaque (' + notOpaque + ' not)');
    ok(wrong === 0, name + ': every pixel off the label band is exactly the matte or a ruler tick where gen_matte.py puts it (' + wrong +
        ' wrong' + (firstWrong ? ', first ' + JSON.stringify(firstWrong) : '') + ')');
    // the labels: one per 100 px, x 0..1800, each starting 2 px right of its major tick
    const labStarts = [];
    for (let k = 0; k <= 18; k++) {
        let first = -1;
        for (let X = k * 100; X < k * 100 + 99 && first < 0; X++) {
            for (let Y = 552; Y < 569; Y++) { const o = (Y * PW + X) * 3; if (!same([rgb[o], rgb[o + 1], rgb[o + 2]], matte)) { first = X; break; } }
        }
        labStarts.push(first - k * 100);
    }
    ok(labStarts.every((d) => d >= 2 && d <= 4), name + ': 19 labels, x 0..1800, ink starting ' + Math.min(...labStarts) + '..' + Math.max(...labStarts) +
        ' px right of each major tick (ink box ' + inkBox.join(',') + ')');
    const strip = Buffer.alloc(PW * 180 * 3); rgb.copy(strip, 0, 540 * PW * 3, 720 * PW * 3);
    fs.writeFileSync(path.join(OUT, name + '_panel.png'), png(rgb, PW, PH));
    fs.writeFileSync(path.join(OUT, name + '_strip.png'), png(strip, PW, 180));
    report[name] = {
        colour: matte, status: p && p.status, layers: ours.map((l) => ({ kind: l.kind, conn: l.conn, class: l.class, z: l.z, rect: [l.x, l.y, l.w, l.h], state: l.state })),
        shaderBytes: bytes, pixelBytes: pix - assetBytes, leftoverAssetBytes: assetBytes, opaque: notOpaque === 0, wrongPixels: wrong, matteOffRuler: offRuler, labelInkPixels: ink, labelInkBox: inkBox,
        labelOffsets: labStarts, composeMs: Date.now() - t0,
    };
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matte-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    console.log('bench on ' + BASE + ' (layer cap 8, 16 MiB), data in ' + tmp + ', out ' + OUT);
    server = spawn(process.execPath, [path.join(ROOT, 'bench', 'server.js'), 'f30_cluster'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir, BENCH_LAYER_CAP: '8', BENCH_PIXEL_MIB: '16' }),
    });
    server.stdout.on('data', (d) => { logText += d; }); server.stderr.on('data', (d) => { logText += d; });
    let p = await until((q) => q && q.ready && q.activeName, 60000);
    ok(p && p.ready, 'the app runs and reaches the fake cluster-render');
    if (!p || !p.ready) return;
    await listen();
    await req('POST', '/setting', { key: 'byMode', value: false });
    await req('POST', '/setting', { key: 'hudLayout', value: 'wb_comfort' });
    p = await until((q) => q.activeName === 'wb_comfort' && /^Cluster on/.test(q.status || ''), 15000);
    await sleep(1500);
    const comfortPx = ev.scene.pixels;
    ev.peak = comfortPx;
    const report = { port: PORT, layerCap: 8, pixelCapMiB: 16, wbComfortPixelBytes: comfortPx };
    for (const name of Object.keys(MATTES)) await oneMatte(name, report);
    // the switch back to the heaviest theme: its peak is what breaks on the car (memory: scene-texture peak)
    await req('POST', '/setting', { key: 'hudLayout', value: 'wb_comfort' });
    p = await until((q) => q.activeName === 'wb_comfort' && /^Cluster on/.test(q.status || ''), 15000);
    await sleep(1500);
    report.peakPixelBytes = ev.peak;
    ok(ev.peak <= 16 * 1048576 && ev.peak === Math.max(comfortPx, ev.scene.pixels), 'switching 6WB Comfort -> the three mattes -> 6WB Comfort: peak ' +
        (ev.peak / 1048576).toFixed(2) + ' MiB, no more than 6WB Comfort alone (' + (comfortPx / 1048576).toFixed(2) + ' MiB)');
    // the night colours never touch a literal colour: the matte stays the matte
    await req('POST', '/setting', { key: 'nightDim', value: 'always' });
    await req('POST', '/setting', { key: 'hudLayout', value: 'matte_magenta' });
    p = await until((q) => q.activeName === 'matte_magenta' && /night/.test(q.status || ''), 15000);
    await sleep(1200);
    const fill = ((ev.scene && ev.scene.layers) || []).find((l) => l.target === 'panel' && l.fs === shaders.fill);
    const uc = fill && fill.uniforms.u_color.v.map((v) => Math.round(v * 255));
    ok(p && /night/.test(p.status) && uc && same(uc, MATTES.matte_magenta) && fill.uniforms.u_color.v[3] === 1,
        'with the night colours on (' + ((p && p.status) || '').slice(0, 60) + '...) the matte is still ' + JSON.stringify(uc));
    report.nightColour = uc;
    // the calibration grid names no colours: it keeps its own (white at 90 and green), as before the layout keys
    await req('POST', '/setting', { key: 'hudLayout', value: 'grid' });
    p = await until((q) => q.activeName === 'grid' && /^Cluster on/.test(q.status || ''), 15000);
    await sleep(1200);
    const g = ((ev.scene && ev.scene.layers) || []).find((l) => l.target === 'panel' && l.fs === shaders.grid);
    const gc = g && [g.uniforms.u_minor.v, g.uniforms.u_majorC.v].map((c) => c.map((v) => Math.round(v * 255)));
    ok(gc && JSON.stringify(gc) === JSON.stringify([[255, 255, 255, 90], [0, 255, 140, 255]]), 'the calibration grid keeps its own colours ' + JSON.stringify(gc));
    const bad = ev.logs.filter((l) => /refused|pixel memory is full|over the layer cap|unusable/.test(l) && /matte/i.test(l));
    ok(bad.length === 0, 'no refusal, cap or memory warning for a matte in the log' + (bad.length ? ': ' + bad[0] : ''));
    const warns = Array.from(new Set(ev.logs.filter((l) => /layout "matte_/.test(l) && /hood|gear box|belt|park|hidden|under/i.test(l)).map((l) => l.replace(/^\S+\s+/, ''))));
    report.visibilityWarnings = warns;
    console.log('  (visibility warnings, expected for a full-panel matte: ' + warns.length + ')');
    fs.writeFileSync(path.join(OUT, 'matte_bench.json'), JSON.stringify(report, null, 2) + '\n');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    try { if (ev.req) ev.req.destroy(); } catch (e) { /* gone */ }
    if (server) server.kill('SIGTERM');
    console.log(passed + ' passed, ' + failed + ' failed');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
