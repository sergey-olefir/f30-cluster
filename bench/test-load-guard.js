'use strict';
/**
 * test-load-guard.js - car-issues (the owner, 2026-11-19): when cluster-render refuses something a theme needs (a layer, an
 * asset, a bind), the theme goes off at once and BMW's own cluster shows, with one log line, instead of a half-built theme.
 *
 *   node bench/test-load-guard.js            (BENCH_PORT, default 8303)
 *
 * With the bench (its own, on BENCH_PORT):
 *   1. f30_cluster with the service's pixel memory far too small (BENCH_PIXEL_MIB=2): Comfort is refused, the load guard turns
 *      the theme off ("load guard: theme turned off"), nothing of ours is left on the panel, the status line says why, the app
 *      stays up;
 *   2. a theme picked (the owner tries again): the guard lets it try, it is refused again, off again - one line each time;
 *   3. the normal memory (16 MiB): Comfort builds and the load guard never speaks.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8303;
const BASE = 'http://127.0.0.1:' + PORT;

let passed = 0, failed = 0;
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
/** The next message of type t ('scene', 'status') the bench pushes to its page. */
function next(t) {
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
                    if (!msg || msg.t !== t) continue;
                    res.destroy(); rq.destroy();
                    return resolve(msg);
                }
            });
        });
        rq.on('error', () => resolve(null));
        setTimeout(() => resolve(null), 10000);
    });
}
const scene = () => next('scene');

async function run(mib, body) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loadguard-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    const env = Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir, BENCH_PIXEL_MIB: String(mib) });
    delete env.BENCH_CONFIG;
    const st = { log: '', exited: false };
    const server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (d) => { st.log += d; if (/app exited/.test(String(d))) st.exited = true; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);
    try { await body(st); } finally {
        server.kill('SIGTERM');
        await sleep(800);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
    }
}

const trips = (log) => (log.match(/load guard: theme turned off[^\n]*/g) || []);

async function main() {
    console.log('1. the pixel memory far too small (2 MiB): the theme goes off');
    await run(2, async (st) => {
        let p = await until((q) => q && q.ready, 90000);
        ok(p && p.ready, 'the app runs');
        if (!p || !p.ready) return;
        // the start-up build is refused at once; the three settings below are theme picks too (each lets it try again)
        await setting('byMode', false); await setting('g20', false); await setting('hudLayout', 'wb_comfort');
        await sleep(3000);
        const t = trips(st.log);
        ok(t.length >= 1 && t.every((x) => /pixel memory is full/.test(x)), 'load guard lines, each with the service\'s refusal, never a bind to an asset the service refused (' + t.length + ': ' + (t[t.length - 1] || 'none').slice(0, 160) + ')');
        const n0 = t.length;
        p = await until((q) => q.activeName === 'off', 8000);
        ok(p && p.activeName === 'off', 'the theme is off (activeName ' + (p && p.activeName) + ')');
        await sleep(1500);
        const m = await scene();
        const ours = m ? m.layers.filter((l) => l.kind !== 'asset') : null;
        ok(ours && ours.length === 0, 'nothing of ours is left on the panel: BMW\'s own cluster shows (' + (ours ? ours.length : '?') + ' layers)');
        const s = await next('status');
        const text = s && s.s;
        ok(/could not take/.test(String(text)), 'the status line says why (' + String(text).slice(0, 140) + ')');

        console.log('2. a theme picked: it tries again, is refused again, off again');
        await setting('hudLayout', 'wb_sport');
        const end2 = Date.now() + 20000;
        while (Date.now() < end2 && trips(st.log).length < n0 + 1) await sleep(200);
        ok(/load guard: a theme was picked/.test(st.log), 'the pick lets the theme try again (logged)');
        ok(trips(st.log).length === n0 + 1, 'refused again, one more load guard line (' + (trips(st.log).length - n0) + ')');
        p = await until((q) => q.activeName === 'off', 8000);
        ok(p && p.activeName === 'off', 'off again');
        await sleep(3000);
        ok(trips(st.log).length === n0 + 1, 'no loop: the guard waits for the next pick (' + (trips(st.log).length - n0) + ' line since the pick)');
        if (process.env.LG_DEBUG) console.log(st.log.split('\n').filter((l) => /load guard|setting|hudLayout|rebuild|activeName|layout/i.test(l)).join('\n'));
        ok(!st.exited && !/uncaught|app exited/.test(st.log), 'the app never exited');
    });

    console.log('3. the normal memory (16 MiB): Comfort builds, the guard never speaks');
    await run(16, async (st) => {
        let p = await until((q) => q && q.ready, 90000);
        ok(p && p.ready, 'the app runs');
        if (!p || !p.ready) return;
        await setting('byMode', false); await setting('g20', false); await setting('hudLayout', 'wb_comfort');
        p = await until((q) => q.activeName === 'wb_comfort', 20000);
        await sleep(3000);
        ok(p && p.activeName === 'wb_comfort', 'Comfort is drawn');
        ok(!/load guard/.test(st.log), 'no load guard line');
    });
}

main().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
});
