'use strict';
/**
 * test-strip-mask.js - package M (docs/strip/M-REPORT.md): the STRIP mask, its bake and the lanes the engine picks.
 *
 *   node bench/test-strip-mask.js            (BENCH_PORT, default 8146)
 *
 * Without the bench: the baked atlas (hud/scene/strip_mask.json) and its lane table are well formed; the R8 collar is
 * the RGBA collar's alpha byte for byte; WBBACK carries the mask's code within the uniform cap; and the synthetic lanes
 * equal, to 1/255, what today's rectangles draw - the collar, the cover, the four patches and u_cc, re-computed here
 * in JS as shared/shaders.js does (this catches a bake that drifted from the rects, or a lane table pointing at the
 * wrong tile).
 * With the bench (its own, on BENCH_PORT, its own data folder): WBBACK's u_mk / u_mh / u_mo in every state of the row
 * - BMW's row, its message, standby, ours, and a row half ours (BMW's lane then) - read off GET /events.
 * Mac only, Node 18 or newer (fetch). Never shipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'apps', 'f30_cluster');
const PORT = Number(process.env.BENCH_PORT) || 8146;
const BASE = 'http://127.0.0.1:' + PORT;
const spec = JSON.parse(fs.readFileSync(path.join(APP, 'app.json'), 'utf8'));
const shaders = require(path.join(ROOT, 'shared', 'shaders.js'));

let passed = 0, failed = 0, server = null, logText = '';
const ok = (cond, what) => { if (cond) { passed++; console.log('  ok   ' + what); } else { failed++; console.log('  FAIL ' + what); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scene = (n) => JSON.parse(fs.readFileSync(path.join(APP, 'hud', 'scene', n + '.json'), 'utf8'));
const layout = (n) => JSON.parse(fs.readFileSync(path.join(APP, 'hud', 'layouts', n + '.json'), 'utf8'));

// ---- shaders.js's WBBACK maths, for the rects (patch, boxOut, smoothstep, the textures' bilinear) ----
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
function boxOut(px, py, b, r) {
    const qx = Math.max(b[0] - px, px - b[2]) + r, qy = Math.max(b[1] - py, py - b[3]) + r;
    return Math.hypot(Math.min(Math.max(qx, 0), 64), Math.min(Math.max(qy, 0), 64)) + Math.min(Math.max(qx, qy), 0) - r;
}
function patch(px, py, b, soft) {
    if (soft <= 0) return 1 - smooth(0, 2, boxOut(px, py, b, 6));
    return (1 - smooth(0, 2, boxOut(px, py, [b[0], b[1], b[2], b[3] + 8], 6))) * (1 - smooth(b[3] - soft, b[3], py));
}
function alphaOf(t) {
    const b = Buffer.from(t.format === 'r8' ? t.r8 : t.rgba, 'base64'), n = t.format === 'r8' ? 1 : 4;
    const a = new Float64Array(t.w * t.h);
    for (let i = 0; i < a.length; i++) a[i] = b[i * n + n - 1] / 255;
    return { w: t.w, h: t.h, a };
}
function bilinear(t, u, v) {
    const x = u * t.w - 0.5, y = v * t.h - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (i, j) => t.a[Math.min(Math.max(j, 0), t.h - 1) * t.w + Math.min(Math.max(i, 0), t.w - 1)];
    return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
}
const sampled = (t, r, px, py) => {
    const u = (px - r.x) / r.w, v = (py - r.y) / r.h;
    return u >= 0 && v >= 0 && u <= 1 && v <= 1 ? bilinear(t, u, v) : 0;
};

function staticChecks() {
    console.log('the baked mask, without the bench');
    const m = scene('strip_mask'), T = m.mask || {};
    const bytes = Buffer.from(m.r8 || '', 'base64');
    ok(m.format === 'r8' && bytes.length === m.w * m.h, 'strip_mask is R8, ' + m.w + ' x ' + m.h + ', ' + bytes.length + ' bytes');
    ok(m.w % 4 === 0 && m.w <= 2048 && m.h <= 2048, 'its rows sit on 4 bytes and it fits an asset (' + m.w + ' x ' + m.h + ')');
    ok(Array.isArray(T.atlas) && T.atlas[0] === m.w && T.atlas[1] === m.h, 'its lane table names its own size');
    const inStrip = (b) => b[0] >= 0 && b[1] >= 540 && b[2] <= 1920 && b[3] <= 720 && b[2] > b[0] && b[3] > b[1];
    ok(inStrip(T.cover) && (T.hole[2] <= T.hole[0] || inStrip(T.hole)), 'the cover box ' + JSON.stringify(T.cover) + ' and the hole box ' + JSON.stringify(T.hole) + ' lie in the STRIP');
    const tileOk = (k, b) => { const o = T.lanes[k]; return o && o[0] >= 0 && o[1] >= 0 && o[0] + b[2] - b[0] <= m.w && o[1] + b[3] - b[1] <= m.h; };
    ok(['ours', 'bmw', 'standby'].every((k) => tileOk(k, T.cover)) && tileOk('msg', T.hole), 'every lane\'s tile lies in the atlas ' + JSON.stringify(T.lanes));
    const mb = m.w * m.h * 2 / 1048576;
    ok(mb < 1.5, 'the atlas costs ' + mb.toFixed(3) + ' MiB of pixel memory (counted twice), under 1.5');

    const c8 = scene('collar_r8'), c = scene('collar');
    const a8 = Buffer.from(c8.r8, 'base64'), a4 = Buffer.from(c.rgba, 'base64');
    let same = c8.w === c.w && c8.h === c.h;
    for (let i = 0; same && i < a8.length; i++) same = a8[i] === a4[i * 4 + 3];
    ok(same, 'collar_r8 is collar\'s alpha byte for byte (' + c8.w + ' x ' + c8.h + ' R8, ' + (c8.w * c8.h * 2 / 1048576).toFixed(2) + ' MiB, was ' + (c.w * c.h * 8 / 1048576).toFixed(2) + ')');

    for (const st of [0, 1]) {
        const src = shaders.wbbackFor(st), us = src.match(/^uniform /mg).length;
        ok(/uniform vec4 u_mk;/.test(src) && /laneAt\(p, u_mk, u_mo\.xy\)/.test(src) && /r8a\(texture2D\(u_t0/.test(src),
            'WBBACK style ' + st + ' samples the lanes and the R8 collar (' + src.length + ' bytes, ' + us + ' uniforms)');
        ok(us <= 32, 'WBBACK style ' + st + ': ' + us + ' uniforms, within the 32 a quad holds');
    }

    const lane = (k, px, py, box) => { const o = T.lanes[k]; return bytes[(Math.floor(py - box[1]) + o[1]) * m.w + Math.floor(px - box[0]) + o[0]] / 255; };
    const bg = layout('wb_dials').widgets.find((w) => w.type === 'wbback');
    ok(bg.mask && bg.mask.tex === 'strip_mask' && !bg.patches && !bg.cover && !bg.cc, 'wb_dials\' bg names the mask and no rect (no patches, cover or cc)');

    // safety, whatever the bake: no cover lane puts any black on BMW's belt and airbag telltales (the catalogue's
    // boxes, design/overlay/g20_comfort.json), and "ours" covers BMW's range, clock and temperature whole
    const cat = {};
    JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'overlay', 'g20_comfort.json'), 'utf8')).elements.forEach((e) => { cat[e.id] = e; });
    const over = (k, id, f) => {
        const b = cat[id].bbox, box = T.cover;
        let v = f === Math.max ? 0 : 1;
        for (let y = Math.max(b[1], box[1]); y < Math.min(b[3], box[3]); y++) {
            for (let x = Math.max(b[0], box[0]); x < Math.min(b[2], box[2]); x++) v = f(v, lane(k, x + 0.5, y + 0.5, box));
        }
        return v;
    };
    ['bottom.belt_rear', 'bottom.belt_driver', 'bottom.airbag'].forEach((id) => {
        const w = Math.max(...['ours', 'bmw', 'standby'].map((k) => over(k, id, Math.max)));
        ok(w === 0, 'no lane covers BMW\'s ' + id + ' ' + JSON.stringify(cat[id].bbox) + ' (most black ' + w.toFixed(3) + ')');
    });
    ['bottom.range', 'bottom.clock', 'bottom.temperature'].forEach((id) => {
        const w = over('ours', id, Math.min);
        ok(w >= 254 / 255, '"ours" covers BMW\'s ' + id + ' ' + JSON.stringify(cat[id].bbox) + ' whole (least ' + w.toFixed(3) + ')');
    });
    // strip integration: the road bar (nav_bg) is gone, so "ours" itself must be solid over BMW's road label and message
    // panel (package ZC's zone, x 690-1250 from y 596), and over BMW's mode label in every lane (decision 2) and its
    // marker (decision 7)
    // (WBBACK's black at a px: inside the cover box the lane, outside it the collar, as the shader samples it)
    const colA = alphaOf(scene(bg.collar.tex));
    const blackAt = (k, px, py) => (px >= T.cover[0] && px < T.cover[2] && py >= T.cover[1] && py < T.cover[3]) ? lane(k, px, py, T.cover) : sampled(colA, bg.collar, px, py);
    const solid = (k, b) => { let v = 1; for (let y = b[1]; y < b[3]; y++) for (let x = b[0]; x < b[2]; x++) v = Math.min(v, blackAt(k, x + 0.5, y + 0.5)); return v; };
    if (T.cover[0] <= 690 && T.cover[2] >= 1250 && T.cover[1] <= 596 && T.cover[3] >= 720) {
        const v = solid('ours', [690, 596, 1250, 720]);
        ok(v >= 254 / 255, '"ours" is solid over BMW\'s road label and message panel [690, 596, 1250, 720] (least ' + v.toFixed(3) + ')');
        ['ours', 'bmw', 'standby'].forEach((k) => {
            const ml = solid(k, [1223, 657, 1356, 709]), mk = solid(k, [1243, 596, 1285, 628]);
            ok(ml >= 254 / 255 && mk >= 254 / 255, '"' + k + '" covers BMW\'s mode label (decision 2) and its marker from y 596 (decision 7) (least ' + ml.toFixed(3) + ', ' + mk.toFixed(3) + ')');
        });
        // the marker's top rows (y 591-596, above the box) lie inside our tacho's disc, opaque above its cut: every px of
        // ZR's slot there that the disc (centre, radius from the layout) does not hold must be under the collar
        const tac = layout('wb_dials').widgets.find((w) => w.id === 'tacho'), tc = [tac.x + tac.w / 2, tac.y + tac.h / 2], tr = tac.w / 2;
        let outDisc = 0, worstC = 1;
        for (let y = 591; y < 596; y++) for (let x = 1243; x < 1285; x++) {
            if (Math.hypot(x + 0.5 - tc[0], y + 0.5 - tc[1]) < tr - 1.5) continue;     // inside the disc (its bezel to R), 1.5 px in from its anti-aliased edge
            outDisc++; worstC = Math.min(worstC, blackAt('bmw', x + 0.5, y + 0.5));
        }
        ok(worstC >= 0.98, 'above y 596 the marker is under our tacho\'s disc, or the collar at >= 0.98: its bilinear quarter-size edge (' + outDisc + ' px outside the disc, least ' + worstC.toFixed(3) + ')');
    } else ok(false, 'the cover box ' + JSON.stringify(T.cover) + ' holds zone C from y 596');
    // decision 1: ONE centre for BMW's sign - the "bmw" lane's round hole sits on the speedo's own window (WBDIAL u_cut)
    const spd = layout('wb_dials').widgets.find((w) => w.id === 'speedo'), sw = spd.cut.round;
    // (the box starts at y 596, so the hole is read row by row from there: each row's two 0.5 crossings give the
    // centre's x as their middle, and the half chords c fit c^2 + y^2 = (r^2 - cy^2) + 2 cy y for cy and r)
    const rows = [];
    for (let y = Math.max(T.cover[1], Math.ceil(sw[1] - 38)); y < Math.floor(sw[1] + 38); y++) {
        const yc = y + 0.5, at = (x) => lane('bmw', x + 0.5, yc, T.cover);
        let xl = null, xr = null;
        for (let x = Math.floor(sw[0] - 46); x < sw[0] && xl === null; x++) if (at(x) >= 0.5 && at(x + 1) < 0.5) xl = x + 0.5 + (at(x) - 0.5) / (at(x) - at(x + 1));
        for (let x = Math.ceil(sw[0] + 46); x > sw[0] && xr === null; x--) if (at(x) >= 0.5 && at(x - 1) < 0.5) xr = x + 0.5 - (at(x) - 0.5) / (at(x) - at(x - 1));
        if (xl !== null && xr !== null) rows.push([yc, (xl + xr) / 2, (xr - xl) / 2]);
    }
    const mx = rows.reduce((a, r) => a + r[1], 0) / rows.length;
    let s1 = 0, sy1 = 0, syy = 0, sz = 0, syz = 0;
    rows.forEach(([y, , c]) => { const z = c * c + y * y; s1++; sy1 += y; syy += y * y; sz += z; syz += y * z; });
    const bq = (s1 * syz - sy1 * sz) / (s1 * syy - sy1 * sy1), aq = (sz - bq * sy1) / s1, cy = bq / 2, rq = Math.sqrt(aq + cy * cy);
    ok(rows.length > 40 && Math.abs(mx - sw[0]) < 0.05 && Math.abs(cy - sw[1]) < 0.05 && Math.abs(rq - 41.8) < 0.05,
        'the "bmw" lane\'s sign hole sits on the speedo\'s window: centre (' + mx.toFixed(3) + ', ' + cy.toFixed(3) + ') against (' + sw[0] + ', ' + sw[1] + '), edge r ' + rq.toFixed(3) + ' (41.8), ' + rows.length + ' rows');
    // ... and the speedo's own black ring round that window (WBDIAL: smoothstep(w + a, w + b, d - r)) ends above the rear
    // belts' safety footprint (package ZL's photo footprint, ink + blur + 3 px, from y 674.25): no black of the DIAL there
    const rm = /smoothstep\(u_cut\.w \+ ([\d.]+), u_cut\.w \+ ([\d.]+), cutSd\)/.exec(shaders.wbdialFor(0));
    const ringEnd = rm ? sw[1] + sw[2] + spd.cut.soft + Number(rm[2]) : Infinity;
    ok(ringEnd < 674.25, 'the speedo\'s black ring and closed disc end at y ' + ringEnd.toFixed(2) + ', above the rear belts\' footprint (674.25)');

    // the synthetic bake (bake_mask.py --today) against the rects it replaced, re-computed here as shared/shaders.js drew
    // them at 3c8ef46 (bake_mask.py TODAY): only while the shipped mask is that one; a bake from shapes skips it
    if (!/synthetic lanes/.test(m._about || '')) { console.log('  (a mask baked from shapes: the rects comparison is skipped)'); return; }
    const TODAY = {
        cover: { tex: 'cover', x: 588, y: 598, w: 736, h: 64 }, cc: [709, 598, 1243, 694],
        patches: [{ rect: [132, 662, 334, 703], when: 'own:range' }, { rect: [340, 662, 455, 704], when: 'own:clock' },
            { rect: [1498, 662, 1667, 705], when: 'own:temp' }, { rect: [590, 594, 1250, 665], soft: 13 }],
    };
    const col = alphaOf(scene(bg.collar.tex)), cov = alphaOf(scene(TODAY.cover.tex));
    let worst = { ours: 0, bmw: 0, standby: 0, msg: 0 }, n = 0;
    for (let y = T.cover[1]; y < T.cover[3]; y++) {
        for (let x = T.cover[0]; x < T.cover[2]; x++) {
            const px = x + 0.5, py = y + 0.5;
            let base = Math.max(sampled(col, bg.collar, px, py), sampled(cov, TODAY.cover, px, py)), ours = base, bmw = base;
            TODAY.patches.forEach((p) => { const a = patch(px, py, p.rect, p.soft || 0); ours = Math.max(ours, a); if (!p.when) bmw = Math.max(bmw, a); });
            // bake_mask.py's safety guard: 0 over the belt and airbag boxes (the rects left the collar's 2/255 tail there)
            if (['bottom.belt_rear', 'bottom.belt_driver', 'bottom.airbag'].some((id) => { const b = cat[id].bbox; return px >= b[0] && px < b[2] && py >= b[1] && py < b[3]; })) { ours = 0; bmw = 0; }
            worst.ours = Math.max(worst.ours, Math.abs(lane('ours', px, py, T.cover) - ours));
            worst.bmw = Math.max(worst.bmw, Math.abs(lane('bmw', px, py, T.cover) - bmw));
            worst.standby = Math.max(worst.standby, Math.abs(lane('standby', px, py, T.cover) - bmw));
            n++;
        }
    }
    for (let y = T.hole[1]; y < T.hole[3]; y++) {
        for (let x = T.hole[0]; x < T.hole[2]; x++) {
            const want = smooth(-0.5, 3.0, boxOut(x + 0.5, y + 0.5, TODAY.cc, 8));
            worst.msg = Math.max(worst.msg, Math.abs(lane('msg', x + 0.5, y + 0.5, T.hole) - want));
        }
    }
    Object.keys(worst).forEach((k) => ok(worst[k] <= 0.5 / 255 + 1e-9, 'lane "' + k + '" = today\'s rects to ' + (worst[k] * 255).toFixed(3) + '/255 (' + n + ' px of the cover box)'));
}

// ---- the bench ----
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
const click = (id, row) => req('POST', '/click', row === undefined ? { id } : { id, row });
const fake = (s) => req('POST', '/fake', { scene: s });
const drive = (stage, rpm, condition) => req('POST', '/signals', { mode: 'manual', values: Object.assign({ stage, rpm, speed: stage === 'D' ? 50 : 0 }, condition === undefined ? {} : { condition }) });
const set = (k, v) => click('SET_' + k.toUpperCase(), spec.settings.find((s) => s.key === k).options.map((o) => o[0]).indexOf(v));
async function until(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let p = null;
    while (Date.now() < end) {
        try { p = await probe(); if (fn(p)) return p; } catch (e) { /* (re)starting */ }
        await sleep(150);
    }
    return p;
}
/** WBBACK's lane uniforms off the scene stream (GET /events) */
function lanes() {
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
                    const l = msg.layers.find((x) => x.fs && x.fs.indexOf('u_mk') >= 0 && x.binds && x.binds.u_t2);
                    const v = (k) => (l && l.uniforms[k] ? (l.uniforms[k].v || l.uniforms[k]) : null);
                    return resolve({ mk: v('u_mk'), mh: v('u_mh'), mo: v('u_mo'), cc: v('u_cc'), pixels: msg.pixels });
                }
            });
        });
        rq.on('error', () => resolve({}));
        setTimeout(() => resolve({}), 10000);
    });
}
async function laneUntil(fn, ms) {
    const end = Date.now() + (ms || 8000);
    let L = {};
    while (Date.now() < end) { L = await lanes(); if (L.mo && fn(L)) return L; await sleep(250); }
    return L;
}

async function benchChecks() {
    const T = scene('strip_mask').mask, eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-mask-'));
    const dataDir = path.join(tmp, 'data'), screenDir = path.join(tmp, 'screen');
    fs.mkdirSync(dataDir); fs.mkdirSync(screenDir);
    console.log('the lanes the engine picks, on a bench of its own (' + BASE + ')');
    server = spawn(process.execPath, [path.join(__dirname, 'server.js'), 'f30_cluster'], {
        cwd: ROOT, env: Object.assign({}, process.env, { BENCH_PORT: String(PORT), BENCH_DATA_DIR: dataDir, SCREEN_DIR: screenDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d) => { logText += d; };
    server.stdout.on('data', keep); server.stderr.on('data', keep);
    let p = await until((q) => q && q.ready && q.activeName, 90000);
    ok(p && p.ready, 'the app reaches the fake cluster-render');
    if (!p || !p.ready) return;
    await fake('clock-none');        // fix/opaque-cc: no demo time zone (bench/run-app.js); "half ours" below needs none
    await click('SET_BYMODE');
    await set('hudLayout', 'wb_comfort');
    await click('SET_G20');
    p = await until((q) => q.activeName === 'wb_dials', 20000);
    ok(p.activeName === 'wb_dials', '6WB Comfort + G20 is up');
    await drive('D', 1500);
    const cov = [T.cover[0], T.cover[1], T.cover[2], T.cover[3]], hole = T.hole;

    // nothing read out of the car's message yet: in a see-through layout BMW's panel is left open (hud.js _ccOpen)
    let L = await laneUntil((x) => eq(x.mo.slice(0, 2), T.lanes.bmw), 8000);
    ok(eq(L.mk, cov) && eq(L.mo.slice(0, 2), T.lanes.bmw) && eq(L.mh, hole), 'allG20, no message read yet: the "bmw" lane, BMW\'s panel left open (' + JSON.stringify(L) + ')');
    ok(/strip_mask": \d+x\d+ R8 asset/.test(logText) && /collar_r8": 480x180 R8 asset/.test(logText), 'the mask and the collar go up as R8 assets');
    await fake('cc-red');
    L = await laneUntil((x) => x.mh && x.mh[2] > x.mh[0], 8000);
    ok(eq(L.mh, hole) && eq(L.mo.slice(2), T.lanes.msg), 'allG20 with a message: the "msg" hole lane opens BMW\'s panel');
    // strip integration: standby is VehicleCondition COND_STANDBY (5) held 1 s (package X), NOT "P with the engine off":
    // photos 62 and 63 are P with the engine off (condition 7) and BMW draws its NORMAL row, sign included
    await drive('P', 0, 7);
    await sleep(1800);
    L = await laneUntil((x) => x.mh[2] > x.mh[0], 8000);
    ok(eq(L.mo.slice(0, 2), T.lanes.bmw) && eq(L.mh, hole), 'P with the engine off, condition 7 (photo 63): still the "bmw" lane, not standby, the message open');
    await drive('P', 0, 5);
    L = await laneUntil((x) => eq(x.mo.slice(0, 2), T.lanes.standby) && x.mh[2] > x.mh[0], 8000);
    ok(eq(L.mo.slice(0, 2), T.lanes.standby) && eq(L.mh, hole), 'condition 5 (standby) held 1 s: the "standby" lane, and the message still open (a warning is never covered)');
    await fake('cc-clear');
    L = await laneUntil((x) => x.mh[2] <= x.mh[0], 8000);
    ok(eq(L.mo.slice(0, 2), T.lanes.standby) && L.mh[2] <= L.mh[0], 'standby, the message gone: its hole closes');
    await drive('D', 1500, 10);
    L = await laneUntil((x) => eq(x.mo.slice(0, 2), T.lanes.bmw), 8000);
    ok(eq(L.mo.slice(0, 2), T.lanes.bmw) && L.mh[2] <= L.mh[0], 'driving again, no message: the "bmw" lane and no hole');

    await set('bottomRow', 'all6WB');
    await sleep(1500);
    // the message was read above, so the info field is ours; the clock is not (no time zone yet): half ours
    L = await laneUntil((x) => eq(x.mo.slice(0, 2), T.lanes.bmw), 8000);
    ok(eq(L.mk, cov) && eq(L.mo.slice(0, 2), T.lanes.bmw) && L.mh[2] <= L.mh[0],
        'all6WB with the clock BMW\'s (no time zone): a row half ours falls back whole to "bmw" (' + JSON.stringify(L) + ')');
    await fake('clock-plus2'); await fake('cc-red'); await sleep(300); await fake('cc-clear');
    L = await laneUntil((x) => eq(x.mo.slice(0, 2), T.lanes.ours), 12000);
    ok(eq(L.mk, cov) && eq(L.mo.slice(0, 2), T.lanes.ours) && L.mh[2] <= L.mh[0], 'all6WB, every item ours: the "ours" lane');
    await fake('cc-red');
    await sleep(800);
    L = await laneUntil((x) => eq(x.mo.slice(0, 2), T.lanes.ours), 8000);
    ok(eq(L.mo.slice(0, 2), T.lanes.ours) && L.mh[2] <= L.mh[0], 'all6WB with a message of ours: "ours", BMW\'s panel stays covered (no symbol window, brief 1.7)');
    ok(L.pixels < 16 * 1048576, 'pixel memory ' + (L.pixels / 1048576).toFixed(2) + ' MiB of 16');
    ok(!/the service's pixel memory is full|too many layers|refused/.test(logText), 'no layer, asset or pixel-memory refusal');
    ok(!/strip mask ".*": no lane table/.test(logText), 'the lane table fits the texture');
    // r1120 F1: every lane change is one log line, lane names only, with the row's builder and day / night
    ok(/strip mask: cover ours, hole none \(row built ours, (day|night)\)/.test(logText) && /strip mask: cover bmw, hole msg \(row built BMW's, (day|night)\)/.test(logText),
        'each lane change is logged once, names only ("strip mask: cover ours, hole none (row built ours, ...)")');
}

(async () => {
    staticChecks();
    if (process.argv.indexOf('--static') < 0) await benchChecks();
})().catch((e) => { failed++; console.log('  FAIL ' + (e && e.stack || e)); }).then(() => {
    if (server) server.kill('SIGTERM');
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
});
