'use strict';
/**
 * test-night.js - 2026-11-16, the owner: "the night themes in Sport and Eco must go".
 *
 *   node bench/test-night.js            (BENCH_PORT, default 8163)
 *
 * Without the bench: shared/shaders.js made with night false (NIGHT 0) has no night look in it (no u_nk0..2, no
 * nightLook()) and is smaller; made with night on it is the source it always was.
 * With the bench (its own, on BENCH_PORT, its own data folder): 6WB Sport, 6WB Eco Pro and the menu-less 6WB Sport + G20
 * (wb_sport_dials, through the bench's layout override) draw the SAME by night as by day - every layer, its shader, its
 * binds and every uniform but the live ones off GET /events, with "nightDim" Always and each "nightLook" - and their
 * shaders carry no night look; 6WB Comfort and Comfort + G20 still change at night.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'f30_cluster');
const PORT = Number(process.env.BENCH_PORT) || 8163;
const BASE = 'http://127.0.0.1:' + PORT;
const spec = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const shaders = require(path.join(ROOT, 'shared', 'shaders.js'));

let passed = 0, failed = 0, server = null, logText = '';
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NIGHTY = /\bu_nk\d|\bnightLook\b/;

function staticChecks() {
    console.log('the shaders, without the bench');
    for (let st = 0; st <= 4; st++) {
        const on = shaders.wbdialFor(st), off = shaders.wbdialFor(st, false);
        ok(NIGHTY.test(on) && !NIGHTY.test(off) && off.length < on.length && on === shaders.wbdialFor(st, true),
            'WBDIAL style ' + st + ': ' + on.length + ' bytes with the night look, ' + off.length + ' without (no u_nk, no nightLook)');
    }
    for (let st = 0; st <= 2; st++) {
        const on = shaders.wbbackFor(st), off = shaders.wbbackFor(st, false);
        ok(NIGHTY.test(on) && !NIGHTY.test(off) && off.length < on.length, 'WBBACK style ' + st + ': ' + on.length + ' -> ' + off.length + ' bytes without the night look');
    }
    ok(shaders.wbsignFor() === shaders.wbsign && !NIGHTY.test(shaders.wbsignFor(false)) && shaders.wbsignFor(false).length < shaders.wbsign.length,
        'WBSIGN: ' + shaders.wbsign.length + ' -> ' + shaders.wbsignFor(false).length + ' bytes without the night look');
    const lbl = (k) => spec.settings.find((s) => s.key === k).label;
    ok(/\(Comfort\)/.test(lbl('nightDim')) && /\(Comfort\)/.test(lbl('nightLook')), 'the night settings name their scope: "' + lbl('nightDim') + '", "' + lbl('nightLook') + '"');
}

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
const set = (key, value) => req('POST', '/setting', { key, value });
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(150);
    }
    return p;
}
/** The engine's scene off GET /events: every layer (assets too) with its shader, binds and uniforms. */
function scene() {
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
// the live values that move by themselves between two reads (the needles, the texts, the signs shown)
const LIVE = /^(u_dyn|u_text|u_time|u_show|u_msa|u_fill)$/;
/** A scene as one string: each layer by what it is (not its ref), its shader, its binds (by the asset they name) and
 *  its uniforms but the live ones. Two equal strings: the engine draws the same thing. */
function sig(msg) {
    const byRef = {};
    msg.layers.forEach((l) => { byRef[l.conn + ':' + l.ref] = l.kind + ' ' + (l.iw || l.w) + 'x' + (l.ih || l.h) + ' ' + (l.format || ''); });
    return msg.layers.map((l) => {
        const u = {}, b = {};
        Object.keys(l.uniforms || {}).sort().forEach((k) => { if (!LIVE.test(k)) u[k] = l.uniforms[k]; });
        Object.keys(l.binds || {}).sort().forEach((k) => { b[k] = byRef[l.binds[k]] || l.binds[k]; });
        return [l.conn, l.kind, l.class, l.z, l.x, l.y, l.w, l.h, l.iw, l.ih, l.format, l.visible, l.opacity, l.state, l.fs || '', JSON.stringify(b), JSON.stringify(u)].join('|');
    }).sort().join('\n');
}
const nightyLayers = (msg) => msg.layers.filter((l) => (l.fs && NIGHTY.test(l.fs)) || Object.keys(l.uniforms || {}).some((k) => /^u_nk\d$/.test(k))).length;

async function benchChecks() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'night-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    // wb_sport_dials has no menu entry (hud.js setting() refuses it): it is drawn as "wb_sport" through the bench's layout
    // override (data/layouts/<name>.json), removed after its checks
    fs.mkdirSync(path.join(dataDir, 'layouts'));
    const over = path.join(dataDir, 'layouts', 'wb_sport.json');
    fs.copyFileSync(path.join(APP, 'hud', 'layouts', 'wb_sport_dials.json'), over);
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ byMode: false, hudLayout: 'wb_sport', nightDim: 'off' }));
    console.log('day and night on the engine, a bench of its own (' + BASE + ')');
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d) => { logText += d; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);
    let p = await until((q) => q && q.ready && q.activeName, 120000);
    ok(p && p.ready, 'the app reaches the fake cluster-render');
    if (!p || !p.ready) return;
    await req('POST', '/signals', { mode: 'manual', values: { stage: 'D', rpm: 1500, speed: 50 } });
    const looks = spec.settings.find((s) => s.key === 'nightLook').options.map((o) => o[0]);
    const plan = [['wb_sport_dials', null], ['wb_sport', 'wb_sport'], ['wb_eco', 'wb_eco'], ['wb_comfort', 'wb_comfort'], ['wb_dials', 'g20']];
    for (const [name, how] of plan) {
        if (name === 'wb_sport') { fs.unlinkSync(over); await sleep(4000); }
        if (how === 'g20') await set('g20', true); else if (how) await set('hudLayout', how);
        const want = name === 'wb_sport_dials' ? 'wb_sport' : name;
        p = await until((q) => q.activeName === want, 30000);
        ok(p && p.activeName === want && (name !== 'wb_sport_dials' || /layout "6WB Sport \+ G20"/.test(logText)), name + ' is up');
        await set('nightLook', 'plain'); await set('nightDim', 'off');
        await sleep(2500);
        const day = await scene(), dsig = sig(day);
        const dayOnly = name !== 'wb_comfort' && name !== 'wb_dials';
        if (dayOnly) ok(nightyLayers(day) === 0, name + ': no layer has a night look in its shader or a u_nk uniform');
        else ok(nightyLayers(day) > 0, name + ': its 6WB layers still carry the night look');
        await set('nightDim', 'always');
        for (const look of looks) {
            await set('nightLook', look);
            await sleep(2500);
            const night = await scene(), st = await probe();
            const same = sig(night) === dsig;
            if (dayOnly) ok(same && night.pixels === day.pixels, name + ', night forced, look "' + look + '": the same layers, shaders, binds and uniforms as by day');
            else ok(!same, name + ', night forced, look "' + look + '": the night colours change it (Comfort keeps them)');
            if (look === looks[0] && st && typeof st.status === 'string') ok(dayOnly ? !/night colours/.test(st.status) : /night colours/.test(st.status), name + ': the status line ' + (dayOnly ? 'names no' : 'names the') + ' night colours');
        }
        await set('nightDim', 'off'); await set('nightLook', 'plain');
    }
    ok(!/the service's pixel memory is full|too many layers|refused/.test(logText), 'no layer, asset or pixel-memory refusal');
    ok(!/\bERROR\b.*(shader|uniform|night)/i.test(logText), 'no shader, uniform or night error in the log');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left in tmp */ }
}

(async () => {
    staticChecks();
    if (process.argv.indexOf('--static') < 0) await benchChecks();
})().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
});
