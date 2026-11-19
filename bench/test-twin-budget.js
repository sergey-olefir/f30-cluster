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
const WORK = path.join(ROOT, 'bake', 'work', 'twin-dial', 'r2', 'B', 'budget-root-' + PORT);       // per port: bake/work is shared between checkouts (twin_dial B1)
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
    fp16Arcs(L);
}

/* car-issues MW: the map window W3's arcs at the car's mediump (fp16), modelled op by op. The arcs are circle distances far over
 * 256 px: the shader asks for highp, and where only mediump exists it divides the offsets by the radius before squaring them. */
function half(x) {            // the nearest IEEE half (binary16) value; past 65504 it is infinite, as on the GPU
    if (!isFinite(x)) return x;
    const a = Math.abs(x);
    if (a >= 65520) return x > 0 ? Infinity : -Infinity;
    const step = a < 6.103515625e-05 ? 5.960464477539063e-08 : Math.pow(2, Math.floor(Math.log2(a)) - 10);
    return Math.round(x / step) * step;
}
const clamp01 = (v) => (v !== v ? NaN : Math.max(0, Math.min(1, v)));
/** The W3 arc factor of one disc (TDBACK's u_mapA block) for the pixel centre px, py: exact (f = Number) or at fp16 (f = half). */
function arcCov(px, py, cx, cy, R, f, naive) {
    const x = f(px), y = f(py);
    if (naive) {             // what the shader must NOT do: the length of a px offset, squared in px
        const dx = f(x - cx), dy = f(y - cy), d = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))));
        return clamp01(f(f(d - R) + 0.5));
    }
    const lx = f(f(x - cx) / R), ly = f(f(y - cy) / R);
    const s = f(Math.sqrt(f(f(lx * lx) + f(ly * ly))));
    return clamp01(f(f(f(s - 1) * R) + 0.5));
}
function fp16Arcs(L) {
    const blk = /if \(u_mapA\.w > 0\.0\) \{([^}]*)\}/.exec(L);
    ok(!!blk && /\(p - u_mapA\.xz\) \/ u_mapA\.w/.test(blk[1]) && /\(p - u_mapA\.yz\) \/ u_mapA\.w/.test(blk[1]) && !/length\(/.test(blk[1]),
        'car-issues MW: tdback L\'s W3 arcs divide both offsets by the radius before they are squared (no length() of a px offset)');
    // every pixel centre of W3's box and 4 px round it, both discs, at the car's fp16 against exact arithmetic
    const C = [[380, 400], [1540, 400]], R = 310;
    let worst = 0, bad = 0, n = 0, naiveOpen = 0, shut = 0;
    for (let y = 169; y < 592; y++) {
        for (let x = 614; x < 1306; x++) {
            const px = x + 0.5, py = y + 0.5;
            C.forEach((c) => {
                const e = arcCov(px, py, c[0], c[1], R, Number), h = arcCov(px, py, c[0], c[1], R, half);
                n++;
                if (!(h === h)) { bad++; return; }
                worst = Math.max(worst, Math.abs(e - h));
                const inside = Math.hypot(px - c[0], py - c[1]) < R - 1.5;
                if (inside && h > 0) shut++;
                if (inside && arcCov(px, py, c[0], c[1], R, half, true) > 0) naiveOpen++;
            });
        }
    }
    ok(bad === 0 && worst <= 1.0 && shut === 0, 'car-issues MW: W3\'s arcs at fp16 (' + n + ' pixel-disc pairs): no NaN, nothing more than 1.5 px inside a disc opens, ' +
        'the edge\'s coverage within ' + worst.toFixed(3) + ' of exact (<= 1.0: the x of a pixel centre past 1024 is itself a whole px at fp16)');
    // the model bites: the same circle measured in px (an unnormalised length) overflows at fp16 past 256 px, so pixels INSIDE a
    // dial's disc would open and BMW's map would show over our bezel
    ok(naiveOpen > 1000, 'car-issues MW: the fp16 model notices an unnormalised distance: in px it would open ' + naiveOpen + ' pixels inside the discs (offsets over 256 px square past 65504)');
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
    ok(near(uni(tach(), 'u_red'), [78.125, 78.125, 77.525, 143.6], 0.01), 'redline 6500: red arc from 78.1 deg, red numerals from 78.1, red ticks from 77.5, the arc to 143.6 (' + fmt(uni(tach(), 'u_red')) + ')');
    ok(near(uni(speed(), 'u_red'), [999, 999, 999, 999], 0), 'the speedometer has no red arc');
    await set('redline', 6000);
    await sleep(1200);
    ok(near(uni(tach(), 'u_red'), [62.5, 46.875, 61.9, 143.6], 0.01), 'redline 6000, in place: arc from 62.5, numerals from 46.9 (6 is red), ticks from 61.9 (' + fmt(uni(tach(), 'u_red')) + ')');
    await set('redline', 7000);
    await sleep(1200);
    ok(near(uni(tach(), 'u_red'), [93.75, 78.125, 93.15, 143.6], 0.01), 'redline 7000: arc from 93.75, numerals from 78.1 (7 and 8 are red) (' + fmt(uni(tach(), 'u_red')) + ')');
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

    // ---- the message state (SPEC-R3 3.2, 5.3: the window and the rules follow it; the tab's fill never carries the severity) ----
    const bl = () => backL(w.last), ucol = (l, n, i) => (uni(l, n) || []).slice(i * 4, i * 4 + 4);
    const FLOOR = [0.0012, 0.0009, 0.0056];
    const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const fillOf = (rgb, k) => rgb.map((c, i) => Math.max(0, (lin(c) - FLOOR[i]) / (1 - FLOOR[i])) * (k || 1));
    const TAB = { 1: [176, 10, 37], 2: [176, 10, 37], 3: [240, 150, 10], 4: [60, 155, 34], 5: [30, 150, 200] };
    const CELLS = { 1: [618, 780], 2: [780, 848], 3: [848, 1168], 4: [1168, 1237], 5: [1237, 1302] };
    const wantFill = (t, k) => fillOf(TAB[t], k).concat([1]);
    ok(uni(bl(), 'u_win')[0] === 0 && uni(bl(), 'u_hi')[2] === 1, 'no message: the window shut; the selected tab (1) is always filled');
    ok(near(uni(bl(), 'u_hi'), [CELLS[1][0], CELLS[1][1], 1, 0], 0.001) && near(uni(bl(), 'u_hiC'), wantFill(1), 0.0005), 'tab 1 selected: cell ' + fmt(uni(bl(), 'u_hi')) + ' in the red, linear light ' + fmt(uni(bl(), 'u_hiC')));
    ok(near(uni(bl(), 'u_rule'), [741, 295.2, 1180, 296.7, 629, 612.4, 1292, 614.6], 0.001), 'no message: the bottom rule is the 2.2 px one');
    await hook('twinCc:window,red');
    await sleep(800);
    ok(uni(bl(), 'u_win')[0] === 1 && uni(bl(), 'u_win')[2] === 0, 'twinCc window: the fallback window opens (the mask is bound)');
    ok(near(uni(bl(), 'u_hiC'), wantFill(1), 0.0005), 'twinCc window, red: the tab\'s fill is still the selected tab\'s colour, not the severity ' + fmt(uni(bl(), 'u_hiC')));
    ok(near(uni(bl(), 'u_rule'), [741, 295.2, 1180, 296.7, 629, 612.4, 1292, 614.6], 0.001), 'twinCc window: the rules keep their normal rects (BMW\'s panel is open, not our plate)');
    ok(keys(w.last) === before && logCount() === builds, 'the message state came in place: no layer made again');
    await hook('twinCc:ours,amber');
    await sleep(800);
    ok(uni(bl(), 'u_win')[0] === 0 && near(uni(bl(), 'u_hiC'), wantFill(1), 0.0005), 'twinCc ours, amber: the window shut, the fill still the tab\'s red');
    ok(near(uni(bl(), 'u_rule'), [741, 295.2, 1180, 296.7, 629, 611, 1291, 615], 0.001) && near(ucol(bl(), 'u_ruleC', 1), [240 / 255, 170 / 255, 10 / 255, 1], 0.002),
        'twinCc ours: the bottom rule is the 4 px one (y 611..615) in the severity colour ' + fmt(ucol(bl(), 'u_ruleC', 1)));
    await hook('twinCc:ours,green');
    await sleep(500);
    ok(near(ucol(bl(), 'u_ruleC', 1), [59 / 255, 155 / 255, 26 / 255, 1], 0.002) && near(uni(bl(), 'u_hiC'), wantFill(1), 0.0005), 'twinCc ours, green: the rule green, the fill unchanged');
    await hook('twinCc:ours,grey');
    await sleep(500);
    ok(near(ucol(bl(), 'u_ruleC', 1), [231 / 255, 231 / 255, 231 / 255, 1], 0.002), 'twinCc ours, grey: the rule light grey');
    await set('nightLook', 'on');
    await sleep(1200);
    ok(near(uni(bl(), 'u_hiC'), wantFill(1, 0.75), 0.0005) && ucol(bl(), 'u_ruleC', 1)[0] < 231 / 255 - 0.05, 'a message shown while the night comes: the fill at 0.75 (' + fmt(uni(bl(), 'u_hiC')) + '), the rule dims');
    await set('nightLook', 'off');
    await sleep(800);
    await hook('twinCc:window,');
    await sleep(500);
    ok(uni(bl(), 'u_win')[0] === 1 && near(uni(bl(), 'u_hiC'), wantFill(1), 0.0005), 'a window with no severity (B3: the blind keep-open): the window open, the fill the tab\'s');
    await hook('twinCc:none,');
    await sleep(500);
    ok(uni(bl(), 'u_win')[0] === 0 && near(uni(bl(), 'u_rule'), [741, 295.2, 1180, 296.7, 629, 612.4, 1292, 614.6], 0.001), 'the message ends: window shut, the 2.2 px rule back');

    // ---- the selected tab (B1: SPEC-R3 3.2) ----
    for (const t of [2, 3, 4, 5, 1]) {
        await hook('twinTab:' + t);
        await sleep(400);
        ok(near(uni(bl(), 'u_hi'), [CELLS[t][0], CELLS[t][1], 1, 0], 0.001) && near(uni(bl(), 'u_hiC'), wantFill(t), 0.0005), 'tab ' + t + ' selected: cell ' + fmt(CELLS[t]) + ', its colour (' + fmt(uni(bl(), 'u_hiC')) + '), in place');
    }
    await hook('twinTab:3');
    await sleep(300);
    const rr = uni(bl(), 'u_hiR'), want = fillOf(TAB[3]).map((v) => { const l = v + 0.15 * lin(230); return l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; });
    ok(near(rr, want, 0.002), 'the rule under the selected cell is its colour + 0.15 x the white rule, linear light ' + fmt(rr));
    ok(near(uni(bl(), 'u_tabR'), [170, 173, 0.002, 0.16], 0.0001) && near(uni(bl(), 'u_sep'), [780, 848, 1168, 1237], 0.001), 'the rule is 3 px (y 170..173), the separators at 780 848 1168 1237');
    ok(keys(w.last) === before && logCount() === builds, 'the tab came in place: no layer made again');
    await hook('twinTab:1');

    // ---- the limit and cruise markers, and the map window (B1) ----
    const lim = () => uni(speed(), 'u_lim'), cru = () => uni(speed(), 'u_cru');
    ok(near(lim(), [0, 0, 0, 1], 0) && near(cru(), [0, 0, 0, 0], 0) && near(uni(tach(), 'u_lim'), [0, 0, 0, 0], 0), 'no limit, no cruise: u_lim [0, 0, 0, 1], u_cru zeros, the tachometer zeros');
    await hook('twinMarks:-62.5,1,0,18.75,1,L2');
    await sleep(400);
    ok(near(lim(), [-62.5, 1, 0, 2], 0) && near(cru(), [18.75, 1, 0, 0], 0), 'a 50 km/h limit and a 110 km/h cruise: u_lim ' + fmt(lim()) + ', u_cru ' + fmt(cru()) + ', strip mode L2 from config.limit.strip');
    ok(near(uni(tach(), 'u_lim'), [0, 0, 0, 0], 0) && near(uni(tach(), 'u_cru'), [0, 0, 0, 0], 0), 'the tachometer never gets a marker');
    await hook('twinMarks:200,3,1,0,2,L3');
    await sleep(400);
    ok(near(lim(), [125, 3, 1, 3], 0) && near(cru(), [0, 0, 0, 0], 0), 'an angle past the scale clamps to 125; cruise standby (state 2) draws no marker; mode L3');
    ok(keys(w.last) === before && logCount() === builds, 'the markers came in place: no layer made again');
    await hook('twinMarks:0,0,0,0,0,L1');
    await sleep(300);
    ok(near(lim(), [0, 0, 0, 1], 0) && near(cru(), [0, 0, 0, 0], 0), 'state 0: the markers are gone');
    ok(near(uni(bl(), 'u_map'), [0, 0, 0, 0], 0), 'the map window is closed by default (u_map zeros)');
    await hook('twinMap:W1');
    await sleep(400);
    ok(near(uni(bl(), 'u_map'), [750, 180, 1170, 564], 0) && near(uni(bl(), 'u_mapF'), [120, 80, 80, 24], 0), 'twinMap W1: the zero box [750, 180, 1170, 564], fades 120 / 80 / 80, radius 24');
    await hook('twinMap:W2');
    await sleep(400);
    ok(near(uni(bl(), 'u_map'), [700, 173, 1220, 600], 0), 'twinMap W2: the open box [700, 173, 1220, 600]');
    ok(near(uni(bl(), 'u_mapA'), [0, 0, 0, 0], 0), 'car-issues MW: twinMap W2 has no arcs (u_mapA zeros)');
    // car-issues MW: W3, the free space between the dials: the box [618, 173, 1302, 588] minus the discs of 310 px round the dials
    await hook('twinMap:W3');
    await sleep(400);
    ok(near(uni(bl(), 'u_map'), [618, 173, 1302, 588], 0) && near(uni(bl(), 'u_mapF'), [1, 1, 1, 1], 0) && near(uni(bl(), 'u_mapA'), [380, 1540, 400, 310], 0),
        'car-issues MW: twinMap W3: the box [618, 173, 1302, 588], hard edges, arcs round (380, 400) and (1540, 400) at 310 px: u_mapA ' + fmt(uni(bl(), 'u_mapA')));
    await hook('twinMap:W2');
    await sleep(400);
    ok(near(uni(bl(), 'u_map'), [700, 173, 1220, 600], 0) && near(uni(bl(), 'u_mapA'), [0, 0, 0, 0], 0), 'car-issues MW: back to W2: its box again and the arcs off');
    await hook('twinMap:');
    await sleep(400);
    ok(near(uni(bl(), 'u_map'), [0, 0, 0, 0], 0) && near(uni(bl(), 'u_mapA'), [0, 0, 0, 0], 0), 'twinMap null: closed again (and no arcs)');
    ok(keys(w.last) === before && logCount() === builds, 'the map window came in place: no layer made again');

    // ---- the holes ----
    const hl = (l) => uni(l, 'u_hole');
    ok(hl(bl()).join().indexOf('497,666,586,720,586,660,688,720') >= 0, 'part L holds the belt group holes [497, 666, 586, 720] + [586, 660, 688, 720] (BMW\'s own sign stays covered) and the four left lamps');
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
