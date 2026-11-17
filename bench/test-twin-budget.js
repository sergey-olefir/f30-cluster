'use strict';
/**
 * test-twin-budget.js - package B (docs/twin-dial/ENGINE-CONTRACT.md, SPEC 13.2): the Twin Dial's engine widgets, tdial
 * and tdback, against the layer and memory budget, and their live behaviour on a bench.
 *
 *   node bench/test-twin-budget.js [--static] [--keep]       (BENCH_PORT, default 8202)
 *
 * Without the bench (--static): the two shaders' sizes after compact() (tdial <= 8 KB, tdback L <= 6 KB), <= 32 uniforms a
 * layer, every sampler2D declared is one the engine binds, highp where lengths are px-scale, no unnormalised length() of a
 * px offset (fp16), tdback's plain parts are tiny.
 * With the bench: a throw-away tree (bench/twin-fixture.js, under bake/work/twin-dial/r2/B/) with a stand-in app that
 * carries the contract's layout (both dials, the three backdrop parts, and place-holders the size of the app's image
 * sheets), the bench's 8-layers-a-connection cap and its 16 MiB pixel memory. Checks: layers per connection <= 8, steady
 * pixel memory <= 6 MiB, the peak across layout switches <= 8 MiB, every sampler bound, no layer rect meets the gear
 * gap [1380, 660, 1460, 720], the needle laws (tachometer linear, speedometer piecewise), rest positions, the redline,
 * fuel and coolant bars and the reserve segment, band level, night multipliers, the message state (window, highlight,
 * the rules' "ours" rects) - each in place, with no layer made again. A feature that is broken makes a check fail:
 * the values come off the bench's own scene (GET /events), what the engine really sent.
 * Mac only, Node 18 or newer. Never shipped.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const F = require('./twin-fixture');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT) || 8202;
const BASE = 'http://127.0.0.1:' + PORT;
const WORK = path.join(ROOT, 'bake', 'work', 'twin-dial', 'r2', 'B', 'budget-root');
const shaders = require(path.join(ROOT, 'shared', 'shaders.js'));
const MIB = 1048576;
const GAP = [1380, 660, 1460, 720];

let passed = 0, failed = 0, server = null, logText = '';
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const near = (a, b, eps) => Array.isArray(a) && Array.isArray(b) && a.length >= b.length && b.every((v, i) => Math.abs(a[i] - v) <= (eps === undefined ? 0.06 : eps));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (a) => '[' + (a || []).map((v) => Math.round(v * 1000) / 1000).join(', ') + ']';

/* ---------------- without the bench ---------------- */

function uniformsOf(fs_) {
    const out = [], re = /^\s*uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)(\[\d+\])?\s*;/gm;
    let m;
    while ((m = re.exec(fs_))) out.push({ type: m[1], name: m[2] });
    return out;
}

function staticChecks() {
    console.log('the shaders, without the bench');
    const dial = shaders.tdial, L = shaders.tdbackFor('L'), RT = shaders.tdbackFor('RT'), RB = shaders.tdbackFor('RB');
    ok(dial.length <= 8192, 'tdial: ' + dial.length + ' bytes after compact() (target <= 8192)');
    ok(L.length <= 6144, 'tdback L: ' + L.length + ' bytes (target <= 6144)');
    ok(RT.length < 1024 && RT === RB, 'tdback RT and RB: ' + RT.length + ' bytes, one source (black and holes only)');
    ok(!/\/\//.test(dial + L + RT), 'no comment is left in what the KOMBI compiles');
    ok(/#define STYLE 0/.test(L) && /#define STYLE 1/.test(RT) && /u_tab\b/.test(L) && !/u_tab\b|u_mask/.test(RT), 'tdback: part L carries the tab bar and the mask, the others do not');
    ok(!/nightLook|u_nk\d/.test(dial + L), 'no night look of the 6WB kind in them (the night is multipliers)');
    [['tdial', dial], ['tdback L', L], ['tdback RT', RT]].forEach(([n, s]) => {
        const u = uniformsOf(s);
        ok(u.length <= 32, n + ': ' + u.length + ' uniforms (at most 32 a layer)');
        ok(/#ifdef GL_FRAGMENT_PRECISION_HIGH\s+precision highp float;/.test(s), n + ': highp where the GPU has it');
        const lens = s.match(/\blength\([^)]*\)/g) || [];
        ok(lens.every((x) => /\/ R\)/.test(x)), n + ': every length() is of an offset normalised by R (fp16 mediump overflows past 256 px): ' + (lens.join(' ') || 'none'));
    });
    const smp = (s) => uniformsOf(s).filter((u) => u.type === 'sampler2D').map((u) => u.name);
    ok(smp(dial).join() === 'u_face', 'tdial samples one asset, u_face');
    ok(smp(L).join() === 'u_mask' && smp(RT).length === 0, 'tdback L samples one asset, u_mask; RT and RB none');
}

/* ---------------- the bench ---------------- */

function req(method, url, body) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const r = http.request(BASE + url, { method, headers: Object.assign({ connection: 'close' }, data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) }, (res) => {
            let b = '';
            res.on('data', (d) => { b += d; });
            res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(b)) : res.statusCode === 204 ? resolve(null) : reject(new Error(method + ' ' + url + ': ' + res.statusCode))));
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}
const probe = () => req('GET', '/probe');
const set = (key, value) => req('POST', '/setting', { key, value });
const hook = (h) => req('POST', '/fake', { hook: h });
const signals = (v) => req('POST', '/signals', { mode: 'manual', values: v });
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(150);
    }
    return p;
}

/** The event stream: every 'scene' message as it comes (the last one is the scene now), and the peak of pixel memory. */
function watch() {
    const w = { last: null, peak: 0, layersPeak: 0, n: 0, close: () => {} };
    const rq = http.get({ host: '127.0.0.1', port: PORT, path: '/events' }, (res) => {
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', (d) => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const ch = buf.slice(0, i); buf = buf.slice(i + 2);
                const mm = /^data: (.*)$/m.exec(ch);
                let msg = null;
                try { msg = mm && JSON.parse(mm[1]); } catch (e) { continue; }
                if (!msg || msg.t !== 'scene') continue;
                w.last = msg; w.n++;
                if (msg.pixels > w.peak) w.peak = msg.pixels;
                const live = msg.layers.filter((l) => l.kind !== 'asset').length;
                if (live > w.layersPeak) w.layersPeak = live;
            }
        });
    });
    rq.on('error', () => {});
    w.close = () => { try { rq.destroy(); } catch (e) { /* closed */ } };
    return w;
}

const eff = (msg) => msg.layers.filter((l) => l.kind === 'effect');
const byW = (msg, test) => eff(msg).filter(test);
const uni = (l, name) => (l && l.uniforms && l.uniforms[name] ? l.uniforms[name].v : null);
const isDial = (l) => /uniform sampler2D u_face/.test(l.fs || '');
const isBack = (l) => /uniform vec4 u_hole\[8\]/.test(l.fs || '');
const backL = (msg) => byW(msg, (l) => isBack(l) && /u_tab\b/.test(l.fs))[0];
const dialAt = (msg, x) => byW(msg, (l) => isDial(l) && l.x === x)[0];

async function benchChecks(keep) {
    console.log('the engine on a bench of its own (' + BASE + ')');
    const t = F.makeRoot(WORK);
    console.log('  faces: ' + t.faces);
    fs.writeFileSync(path.join(t.data, 'settings.json'), JSON.stringify({ byMode: false, hudLayout: 'twin_test', nightLook: 'off', redline: 6500 }));
    server = spawn(process.execPath, [path.join(t.root, 'bench', 'server.js'), t.appId], { cwd: t.root, env: F.serverEnv(t, PORT), stdio: ['ignore', 'pipe', 'pipe'] });
    const keepLog = (d) => { logText += d; };
    server.stdout.on('data', keepLog); server.stderr.on('data', keepLog);
    let p = await until((q) => q && q.ready && q.activeName, 150000);
    ok(p && p.ready && p.activeName === 'twin_test', 'the stand-in app builds with the kit and reaches the fake cluster-render, layout twin_test');
    if (!p || !p.ready) { console.log(logText.split('\n').slice(-25).join('\n')); return; }
    const w = watch();
    await signals({ stage: 'D', rpm: 4000, speed: 100, coolant: 85, fuelL: 30, condition: 10, spare: 3 });
    await sleep(3000);
    let S = w.last;
    ok(!!S, 'the scene arrives');
    const layersIn = (m) => m.layers.filter((l) => l.kind !== 'asset');

    // ---- the budget ----
    const live = layersIn(S), conns = {};
    live.forEach((l) => { conns[l.conn] = (conns[l.conn] || 0) + 1; });
    ok(Object.keys(conns).every((c) => conns[c] <= 8), 'layers per connection: ' + JSON.stringify(conns) + ' (at most 8 each)');
    ok(live.length <= 32, live.length + ' layers in all (at most 32)');
    ok(S.pixels <= 6 * MIB, 'steady pixel memory ' + (S.pixels / MIB).toFixed(2) + ' MiB (at most 6; the bench refuses past 16)');
    ok(eff(S).length === 5 && live.filter((l) => isDial(l)).length === 2 && live.filter((l) => isBack(l)).length === 3, 'five effect layers: two dials and three backdrop parts');
    const hit = (l) => l.x < GAP[2] && GAP[0] < l.x + l.w && l.y < GAP[3] && GAP[1] < l.y + l.h;
    ok(live.every((l) => !hit(l)), 'no layer rect meets the gear gap [1380, 660, 1460, 720]: ' + live.filter(hit).map((l) => l.x + ',' + l.y + ' ' + l.w + 'x' + l.h).join(' ') || 'none');
    const belt = F.BELT;
    ok(live.every((l) => !(l.x < belt[2] && belt[0] < l.x + l.w && l.y < belt[3] && belt[1] < l.y + l.h) || (isBack(l) && l.x === 0)), "nothing but the backdrop's own hole covers BMW's belt group [497, 660, 688, 720]");
    ok(live.filter(isDial).every((l) => l.y + l.h <= 660), 'both dial layers end at y 660 (the furniture rule)');
    // every sampler bound, uniforms and binds within 32
    let sampOk = true, uOk = true;
    eff(S).forEach((l) => {
        const re = /uniform\s+sampler2D\s+(\w+)\s*;/g;
        let m;
        while ((m = re.exec(l.fs))) if (!(l.binds && l.binds[m[1]])) { sampOk = false; console.log('       unbound: ' + m[1] + ' on layer at ' + l.x + ',' + l.y); }
        if (Object.keys(l.uniforms || {}).length + Object.keys(l.binds || {}).length > 32) uOk = false;
    });
    ok(sampOk, 'every sampler2D of every effect layer has an asset bound');
    ok(uOk, 'no effect layer holds more than 32 uniforms and binds together');
    ok(eff(S).every((l) => l.state !== 'waiting' && !/refus|over the/.test(l.reason || '')), 'no layer is waiting or refused');
    const shaderSizes = eff(S).map((l) => l.fs.length);
    ok(eff(S).filter(isDial).every((l) => l.fs.length <= 8192) && eff(S).filter(isBack).every((l) => l.fs.length <= 6144), 'the shaders the car would get: ' + shaderSizes.join(', ') + ' bytes');

    // ---- the dials: needle laws ----
    const tach = () => dialAt(w.last, 70), speed = () => dialAt(w.last, 1230);
    const d0 = (l) => (uni(l, 'u_dyn') || [])[0];
    ok(Math.abs(d0(tach()) - 0) < 0.8 && Math.abs(d0(speed()) - 0) < 0.8, 'rpm 4000 and 100 km/h: both needles at 12 o\'clock (' + fmt([d0(tach()), d0(speed())]) + ')');
    const run = async (v, what, wantT, wantS) => {
        await signals(Object.assign({ stage: 'D', coolant: 85, fuelL: 30, condition: 10, spare: 3 }, v));
        await sleep(2600);
        const a = d0(tach()), b = d0(speed());
        ok((wantT === null || Math.abs(a - wantT) < 0.8) && (wantS === null || Math.abs(b - wantS) < 0.8), what + ': needles at ' + fmt([a, b]) + ', want ' + fmt([wantT, wantS]));
    };
    await run({ rpm: 8000, speed: 20 }, 'rpm 8000, 20 km/h', 125, -100);
    await run({ rpm: 1000, speed: 200 }, 'rpm 1000, 200 km/h', -93.75, 62.5);
    await run({ rpm: 9000, speed: 300 }, 'rpm 9000 (past the scale), 300 km/h', 125, 125);
    await run({ rpm: 6500, speed: 340 }, 'rpm 6500, 340 km/h (past the scale clamps)', 78.125, 125);
    await run({ rpm: 0, speed: 0, condition: 10, engine: 0 }, 'engine off but ready to drive: the needles at 0', -125, -125);
    await run({ rpm: 0, speed: 0, condition: 3, engine: 0 }, 'ignition off: the tachometer on its OFF mark (-135)', -135, -125);

    // ---- the bars ----
    await signals({ stage: 'D', rpm: 3000, speed: 80, coolant: 85, fuelL: 30, condition: 10, spare: 3 });
    await sleep(2600);
    let dy = uni(tach(), 'u_dyn'), dys = uni(speed(), 'u_dyn');
    ok(Math.abs(dy[1] - 30 / 59) < 0.01 && dy[2] === -1, 'fuel 30 of 59 L: the bar at ' + dy[1] + ', no red segment');
    ok(Math.abs(dys[1] - 35 / 80) < 0.01 && dys[2] === -1, 'coolant 85 C: the bar at ' + dys[1] + ' (50 C empty, 130 C full), no red segment');
    ok(near(uni(tach(), 'u_bar'), [619 - 90, 254 - 70, 506 - 70, 7.5], 0.01) && near(uni(speed(), 'u_bar'), [619 - 90, 1414 - 1230, 1666 - 1230, 7.5], 0.01), 'the bars sit at y 619, x 254..506 and 1414..1666 (layer px)');
    await signals({ stage: 'D', rpm: 3000, speed: 80, coolant: 125, fuelL: 3, condition: 10, spare: 1 });
    await sleep(2600);
    dy = uni(tach(), 'u_dyn'); dys = uni(speed(), 'u_dyn');
    ok(dy[2] === 0, 'the reserve warning on: the tachometer\'s first segment is the red one (' + dy[2] + ')');
    ok(dys[2] === 4, 'coolant 125 C: the speedometer\'s last segment is the red one (' + dys[2] + ')');
    await signals({ stage: 'D', rpm: 3000, speed: 80, coolant: 85, fuelL: 30, condition: 10, spare: 0 });
    await sleep(2600);
    ok(uni(tach(), 'u_dyn')[2] === -1 && uni(speed(), 'u_dyn')[2] === -1, 'the reserve warning off, coolant back down: no red segment');

    // ---- the settings and the night, in place ----
    const keys = (m) => layersIn(m).map((l) => l.key).sort().join(' ');
    const logCount = () => (logText.match(/layout "twin_test": /g) || []).length;
    const before = keys(w.last), builds = logCount();
    ok(near(uni(tach(), 'u_red'), [78.125, 78.125, 77.525, 125], 0.01), 'redline 6500: wedge from 78.1 deg, red numerals from 78.1, red ticks from 77.5, to 125 (' + fmt(uni(tach(), 'u_red')) + ')');
    ok(near(uni(speed(), 'u_red'), [999, 999, 999, 999], 0), 'the speedometer has no wedge');
    await set('redline', 6000);
    await sleep(1200);
    ok(near(uni(tach(), 'u_red'), [62.5, 46.875, 61.9, 125], 0.01), 'redline 6000, in place: wedge from 62.5, numerals from 46.9 (6 is red), ticks from 61.9 (' + fmt(uni(tach(), 'u_red')) + ')');
    await set('redline', 7000);
    await sleep(1200);
    ok(near(uni(tach(), 'u_red'), [93.75, 78.125, 93.15, 125], 0.01), 'redline 7000: wedge from 93.75, numerals from 78.1 (7 and 8 are red) (' + fmt(uni(tach(), 'u_red')) + ')');
    await set('redline', 6500);
    await set('bandGain', 1.4);
    await sleep(1200);
    ok(Math.abs(uni(tach(), 'u_dim')[2] - 1.4) < 0.001 && Math.abs(uni(speed(), 'u_dim')[2] - 1.4) < 0.001, 'bandGain 1.4: both dials, in place (' + fmt(uni(tach(), 'u_dim')) + ')');
    await set('bandGain', 1);
    await sleep(800);
    ok(near(uni(tach(), 'u_n0'), [1, 1, 1, 1], 0) && near(uni(tach(), 'u_n1'), [1, 1, 1, 1], 0) && near(uni(tach(), 'u_n2'), [1, 1, 1, 1], 0), 'by day every night multiplier is 1');
    const rampDay = uni(backL(w.last), 'u_tabR');
    await set('nightLook', 'on');
    await sleep(1500);
    ok(near(uni(tach(), 'u_n0'), [0.8, 0.7, 0.75, 0.55], 0.001) && near(uni(speed(), 'u_n1'), [0.6, 0.55, 0.5, 0.85], 0.001) && near(uni(tach(), 'u_n2'), [0.8, 0.75, 0.55, 0.7], 0.001),
        'nightLook on: the material multipliers of SPEC 7.2 on both dials');
    const rampNight = uni(backL(w.last), 'u_tabR');
    ok(Math.abs(rampNight[2] - rampDay[2] * 0.55) < 1e-6 && Math.abs(rampNight[3] - rampDay[3] * 0.55) < 1e-6, 'the tab ramp at 0.55 of its linear light (' + fmt(rampDay.slice(2)) + ' -> ' + fmt(rampNight.slice(2)) + ')');
    const ruleDay = 231, ruleNight = uni(backL(w.last), 'u_ruleC').slice(0, 3);
    ok(ruleNight[0] < ruleDay / 255 - 0.05 && ruleNight[0] > 0.7 * 0.75, 'the rules dimmed by night (' + fmt(ruleNight) + ')');
    ok(keys(w.last) === before && logCount() === builds, 'the night came in place: the same layers (' + layersIn(w.last).length + '), no rebuild');
    await set('nightLook', 'off');
    await sleep(1500);
    ok(near(uni(tach(), 'u_n0'), [1, 1, 1, 1], 0) && near(uni(backL(w.last), 'u_tabR'), rampDay, 1e-9), 'nightLook off: back to day, in place');

    // ---- the message state ----
    const bl = () => backL(w.last), ucol = (l, n, i) => (uni(l, n) || []).slice(i * 4, i * 4 + 4);
    ok(uni(bl(), 'u_win')[0] === 0 && uni(bl(), 'u_hi')[2] === 0, 'no message: the window shut, the warning cell not lit');
    ok(near(uni(bl(), 'u_rule'), [741, 295.2, 1180, 296.7, 629, 612.4, 1292, 614.6], 0.001), 'no message: the bottom rule is the 2.2 px one');
    await hook('twinCc:window,red');
    await sleep(800);
    ok(uni(bl(), 'u_win')[0] === 1 && uni(bl(), 'u_win')[2] === 0, 'twinCc window: the fallback window opens (the mask is bound)');
    ok(uni(bl(), 'u_hi')[2] === 1 && near(uni(bl(), 'u_hiC'), [176 / 255, 7 / 255, 30 / 255, 1], 0.002), 'twinCc window, red: the warning cell lit in the severity red ' + fmt(uni(bl(), 'u_hiC')));
    ok(near(uni(bl(), 'u_rule'), [741, 295.2, 1180, 296.7, 629, 612.4, 1292, 614.6], 0.001), 'twinCc window: the rules keep their normal rects (BMW\'s panel is open, not our plate)');
    ok(keys(w.last) === before && logCount() === builds, 'the message state came in place: no layer made again');
    await hook('twinCc:ours,amber');
    await sleep(800);
    ok(uni(bl(), 'u_win')[0] === 0 && uni(bl(), 'u_hi')[2] === 1 && near(uni(bl(), 'u_hiC'), [240 / 255, 170 / 255, 10 / 255, 1], 0.002), 'twinCc ours, amber: the window shut, the cell amber');
    ok(near(uni(bl(), 'u_rule'), [741, 295.2, 1180, 296.7, 629, 611, 1291, 615], 0.001) && near(ucol(bl(), 'u_ruleC', 1), [240 / 255, 170 / 255, 10 / 255, 1], 0.002),
        'twinCc ours: the bottom rule is the 4 px one (y 611..615) in the severity colour ' + fmt(ucol(bl(), 'u_ruleC', 1)));
    await hook('twinCc:ours,green');
    await sleep(500);
    ok(near(uni(bl(), 'u_hiC'), [59 / 255, 155 / 255, 26 / 255, 1], 0.002), 'twinCc ours, green: the cell green');
    await hook('twinCc:ours,grey');
    await sleep(500);
    ok(near(uni(bl(), 'u_hiC'), [231 / 255, 231 / 255, 231 / 255, 1], 0.002), 'twinCc ours, grey: the cell light grey');
    await set('nightLook', 'on');
    await sleep(1200);
    ok(uni(bl(), 'u_hi')[2] === 1 && uni(bl(), 'u_hiC')[0] < 231 / 255 - 0.05, 'a message shown while the night comes: the cell dims, still lit');
    await set('nightLook', 'off');
    await sleep(800);
    await hook('twinCc:window,');
    await sleep(500);
    ok(uni(bl(), 'u_win')[0] === 1 && uni(bl(), 'u_hi')[2] === 1 && near(uni(bl(), 'u_hiC'), [231 / 255, 231 / 255, 231 / 255, 1], 0.002), 'a window with no severity: lit in grey, the window open');
    await hook('twinCc:none,');
    await sleep(500);
    ok(uni(bl(), 'u_win')[0] === 0 && uni(bl(), 'u_hi')[2] === 0 && near(uni(bl(), 'u_rule'), [741, 295.2, 1180, 296.7, 629, 612.4, 1292, 614.6], 0.001), 'the message ends: window shut, cell dark, the 2.2 px rule back');

    // ---- the holes ----
    const hl = (l) => uni(l, 'u_hole');
    ok(hl(bl()).join().indexOf('497,660,688,720') >= 0, 'part L holds the belt group hole [497, 660, 688, 720] and the four left lamps');
    const rt = byW(w.last, (l) => isBack(l) && l.x === 1380)[0], rb = byW(w.last, (l) => isBack(l) && l.x === 1460)[0];
    ok(hl(rt).join().indexOf('394,176,493,208') >= 0, 'part RT holds the right-hand lamps (layer px): ' + fmt(hl(rt).slice(0, 12)));
    ok(hl(rb).every((v) => v === 0), 'part RB: no hole');

    // ---- layout switches: the peak ----
    const base = w.peak;
    await set('hudLayout', 'twin_alt');
    await until((q) => q.activeName === 'twin_alt', 30000); await sleep(2500);
    await set('hudLayout', 'twin_test');
    await until((q) => q.activeName === 'twin_test', 30000); await sleep(2500);
    await set('hudLayout', 'twin_alt');
    await until((q) => q.activeName === 'twin_alt', 30000); await sleep(2500);
    await set('hudLayout', 'twin_test');
    await until((q) => q.activeName === 'twin_test', 30000); await sleep(3000);
    ok(w.peak <= 8 * MIB, 'the peak of pixel memory across layout switches: ' + (w.peak / MIB).toFixed(2) + ' MiB (at most 8; steady ' + (S.pixels / MIB).toFixed(2) + ', before the switches ' + (base / MIB).toFixed(2) + ')');
    ok(w.layersPeak <= 12, 'at most ' + w.layersPeak + ' layers at once, even mid-switch (SPEC: 12 of 24)');
    ok(w.last.pixels <= 6 * MIB, 'back on twin_test: ' + (w.last.pixels / MIB).toFixed(2) + ' MiB');
    ok(!/the service's pixel memory is full|too many layers|too many assets|over the layer cap|\bERROR\b.*(shader|uniform|twin|dial|backdrop)|does not compile/i.test(logText), 'no refusal, no shader or uniform error in the log');
    ok(!/WARN[^\n]*(backdrop|dial) "/.test(logText), 'no warning from the twin widgets in the log');
    w.close();
    if (!keep) try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) { /* left */ }
}

(async () => {
    staticChecks();
    if (process.argv.indexOf('--static') < 0) await benchChecks(process.argv.indexOf('--keep') >= 0);
})().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    if (failed && logText) console.log('--- bench log (tail) ---\n' + logText.split('\n').slice(-30).join('\n'));
    console.log(passed + ' passed, ' + failed + ' failed');
    setTimeout(() => process.exit(failed ? 1 : 0), 300);
});
