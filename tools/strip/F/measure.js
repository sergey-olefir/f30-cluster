'use strict';
// Package F (strip, 2026-11-16): the pixel-memory cost of a font / layout change, measured on the bench.
//   node tools/strip/F/measure.js <out.json>      (from the repo root; BENCH_PORT, default 8163; LATIN=1: Latin scenes)
// Starts its own bench (BENCH_LAYER_CAP=8, the 16 MiB rule) with peak.js preloaded, walks the 6WB layouts and the
// bottom-row states, and records per step the engine's own rebuild line (layers, sheets, MiB) and the image layers;
// then python3 tools/strip/F/peaks.py <out.json> <its peak.txt> gives each step's start / end / switch peak in the
// bench's own accounting. Kills its own bench at the end. Bench only, never shipped. Node 18 or newer (fetch).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = process.cwd();
const HERE = __dirname;
const PORT = Number(process.env.BENCH_PORT) || 8163;
const BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f-measure-'));
console.log('peak file ' + path.join(tmp, 'peak.txt'));
const dataDir = path.join(tmp, 'data'); fs.mkdirSync(dataDir);
const peakFile = path.join(tmp, 'peak.txt'); fs.writeFileSync(peakFile, '');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'f30_cluster', 'app.json'), 'utf8'));
const opts = (k) => spec.settings.find((s) => s.key === k).options.map((o) => o[0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let logText = '';
async function req(method, url, body) {
    for (let i = 0; i < 8; i++) {
        try {
            const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', connection: 'close' }, body: body ? JSON.stringify(body) : undefined });
            if (r.status === 200) return r.json();
            if (r.status === 204) return null;
            throw new Error(method + ' ' + url + ': ' + r.status);
        } catch (e) { if (i === 7) throw e; await sleep(400); }
    }
}
const probe = () => req('GET', '/probe');
const click = (id, row) => req('POST', '/click', row === undefined ? { id } : { id, row });
const fake = (v) => req('POST', '/fake', v);
const set = (key, value) => click('SET_' + key.toUpperCase(), opts(key).indexOf(value));
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) { try { p = await probe(); if (fn(p)) return p; } catch (e) { /* restarting */ } await sleep(150); }
    return p;
}
const W = (q) => (q && q.signs && q.signs.widgets) || [];
const steps = [];
async function sceneNow() {
    const ac = new AbortController();
    const r = await fetch(BASE + '/events', { signal: ac.signal });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); if (c.indexOf('data: ') !== 0) continue; const m = JSON.parse(c.slice(6)); if (m.t === 'scene') { ac.abort(); return m.layers; } } }
    } catch (e) { if (e.name !== 'AbortError') throw e; }
    return [];
}
const LAT = !!process.env.LATIN;
const ROAD = LAT ? 'road-street' : 'road-cyrillic', MSG = LAT ? 'cc-yellow' : 'cc-cyrillic';
async function step(name, act, cond) {
    const t0 = Date.now(), at = logText.length;
    await act();
    const p = await until(cond, 25000);
    await sleep(3000);
    steps.push({ name, t0, t1: Date.now(), ok: !!(p && cond(p)), active: p && p.activeName, status: p && p.status,
        widgets: W(p), images: (await sceneNow()).filter((l) => l.image !== false && (l.kind === 'image' || l.kind === 'asset')).map((l) => [l.kind, l.conn, l.x, l.y, l.iw, l.ih, l.state]), rebuild: (logText.slice(at).match(/layout "[^"]+": \d+ widgets[^\n]*/g) || []).slice(-1)[0] || '' });
    console.log(name, steps[steps.length - 1].ok, steps[steps.length - 1].rebuild);
}
async function main() {
    const server = spawn(process.execPath, ['-r', path.join(HERE, 'peak.js'), path.join(ROOT, 'bench', 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: path.join(tmp, 'screen'), BENCH_LAYER_CAP: '8', PEAK_OUT: peakFile }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    fs.mkdirSync(path.join(tmp, 'screen'));
    server.stdout.on('data', (d) => { logText += d; }); server.stderr.on('data', (d) => { logText += d; });
    try {
        await until((q) => q && q.ready && q.activeName, 120000);
        await click('SET_BYMODE');
        const act = (n) => (q) => q && q.activeName === n;
        await step('comfort', () => set('hudLayout', 'wb_comfort'), act('wb_comfort'));
        await step('dials allG20', () => click('SET_G20'), act('wb_dials'));
        await step('dials all6WB road+sign+clock', async () => {
            await fake({ scene: ROAD }); await fake({ scene: 'limit-50' }); await fake({ scene: 'clock-plus2' });
            await set('bottomRow', 'all6WB');
        }, (q) => act('wb_dials')(q) && W(q).indexOf('nav') >= 0 && W(q).indexOf('signs') >= 0);
        await step('dials all6WB message', () => fake({ scene: MSG }), (q) => W(q).indexOf('cc_name') >= 0);
        await step('dials all6WB -> comfort', () => click('SET_G20'), act('wb_comfort'));
        await step('comfort -> dials all6WB message', () => click('SET_G20'), (q) => act('wb_dials')(q) && W(q).indexOf('cc_name') >= 0);
        await step('dials all6WB road (message cleared)', () => fake({ scene: 'cc-clear' }), (q) => W(q).indexOf('nav') >= 0 && W(q).indexOf('cc_name') < 0);
        await step('dials -> allG20', () => set('bottomRow', 'allG20'), (q) => W(q).indexOf('nav') < 0);
        await step('dials allG20 -> comfort', () => click('SET_G20'), act('wb_comfort'));
        await step('comfort -> sport', () => set('hudLayout', 'wb_sport'), act('wb_sport'));
        await step('sport -> eco', () => set('hudLayout', 'wb_eco'), act('wb_eco'));
        await step('eco -> comfort', () => set('hudLayout', 'wb_comfort'), act('wb_comfort'));
        await step('comfort -> dials allG20', () => click('SET_G20'), act('wb_dials'));
        await step('dials allG20 -> comfort (2)', () => click('SET_G20'), act('wb_comfort'));
        await step('comfort -> eco', () => set('hudLayout', 'wb_eco'), act('wb_eco'));
        await step('eco -> sport', () => set('hudLayout', 'wb_sport'), act('wb_sport'));
        await step('sport -> comfort', () => set('hudLayout', 'wb_comfort'), act('wb_comfort'));
    } finally {
        server.kill('SIGTERM');
    }
    const pk = fs.readFileSync(peakFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(' ').map(Number));
    steps.forEach((s) => {
        let peak = 0, last = 0;
        pk.forEach(([t, b]) => { if (t <= s.t1) last = b; if (t >= s.t0 && t <= s.t1 && b > peak) peak = b; });
        s.peakMiB = +(Math.max(peak, last) / 1048576).toFixed(3); s.steadyMiB = +(last / 1048576).toFixed(3);
    });
    const refusals = (logText.match(/pixel memory is full|too many layers|over the layer cap[^\n]*/g) || []);
    fs.writeFileSync(process.argv[2], JSON.stringify({ steps, refusals, errors: (logText.match(/[^\n]*ERROR[^\n]*/g) || []).slice(0, 10) }, null, 1));
    fs.writeFileSync(process.argv[2] + '.log', logText);
    steps.forEach((s) => console.log(s.name.padEnd(36), 'steady', s.steadyMiB, 'peak', s.peakMiB, s.ok ? '' : 'NOT REACHED'));
    console.log('refusals', refusals.length);
}
main().catch((e) => { console.log('FAIL', e && e.stack || e); process.exitCode = 1; });
