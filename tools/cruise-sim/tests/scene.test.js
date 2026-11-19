'use strict';
/** SU1: ui/scene.js's display list (geometry, marks, both themes) and its PNG player. node tools/cruise-sim/tests/scene.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../ui/app.js');
const S = require('../ui/scene.js');
const F = require('../ui/fake-result.js');
const P = require('./scene-png.js');

const r = A.normalizeResult(F.makeFakeResult({ seed: 1, duration: 60, out: { dt: 0.05 } }));
const tl = A.buildTimeline(r);
const base = { width: 1000, height: 340, aheadM: S.fitRange(r), profile: S.elevationProfile(r), lanes: S.lanesOf(r) };
const build = (t, extra) => S.buildScene(A.frameAt(r, tl, t), Object.assign({}, base, extra));
const texts = (out) => out.ops.filter((o) => o.k === 'text').map((o) => o.s);
const NUM = { rect: ['x', 'y', 'w', 'h'], srect: ['x', 'y', 'w', 'h', 'lw'], line: ['x1', 'y1', 'x2', 'y2', 'lw'], circle: ['x', 'y', 'r'], text: ['x', 'y', 'size'] };

test('every frame of the run, in both themes, is a list of finite ops inside the canvas', () => {
    for (const theme of ['light', 'dark']) {
        for (let i = 0; i < r.t.length; i += 7) {
            const out = build(r.t[i], { theme });
            assert.ok(out.ops.length > 30);
            for (const o of out.ops) {
                for (const k of NUM[o.k] || []) assert.ok(Number.isFinite(o[k]), 't=' + r.t[i] + ' ' + o.k + '.' + k + '=' + o[k]);
                if (o.k === 'poly') for (const q of o.pts) assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]), 'poly at t=' + r.t[i]);
                if (o.k === 'text') assert.ok(!/NaN|undefined/.test(o.s), 'text "' + o.s + '" at t=' + r.t[i]);
                if (o.k === 'rect') assert.ok(o.x >= -1 && o.x + o.w <= base.width + 1, 'rect inside at t=' + r.t[i]);
                const c = o.fill || o.color;
                if (c) assert.match(c, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
            }
        }
    }
});

test('our car ends at X(0) and the true lead starts at X(true gap)', () => {
    const t = 8, fr = A.frameAt(r, tl, t), out = build(t, { theme: 'light' });
    const th = S.THEMES.light, X = out.layout.X;
    const ego = out.ops.find((o) => o.k === 'rect' && o.fill === th.ego);
    assert.ok(Math.abs(ego.x + ego.w - X(0)) < 0.01, 'ego front at X(0)');
    const lead = out.ops.find((o) => o.k === 'rect' && o.fill === th.lead);
    assert.ok(Math.abs(lead.x - X(fr.s['gap.true'])) < 0.6, 'lead rear ' + lead.x + ' vs ' + X(fr.s['gap.true']));
    // the measured-gap tick across our lane
    const tick = out.ops.find((o) => o.k === 'line' && o.color === th.meas && o.lw === 2 && o.x1 === o.x2);
    assert.ok(Math.abs(tick.x1 - X(fr.s['gap.meas'])) < 1e-6);
    assert.ok(texts(out).some((s) => /^true \d+\.\d m$/.test(s)));
    assert.ok(texts(out).some((s) => /^measured \d+\.\d m \(err [+-]\d+\.\d\)$/.test(s)));
});

test('marks: warning frame and chip, wrong target, no target, faults, driver, assumed plant, fake', () => {
    const w = tl.warns[0], tw = (w.t0 + w.t1) / 2;
    const ow = build(tw, { theme: 'dark' });
    assert.ok(ow.ops.some((o) => o.k === 'srect' && o.color === S.THEMES.dark.warn), 'red frame around the road');
    assert.ok(texts(ow).some((s) => s.startsWith('WARNING')));
    const o50 = build(50);
    assert.ok(texts(o50).includes('WRONG TARGET'));
    assert.ok(texts(o50).some((s) => s === 'SENSOR · wrong target #3'));
    assert.ok(texts(o50).some((s) => /^FAULT · wrongTarget · 1\.0 s$/.test(s)));
    assert.ok(texts(o50).some((s) => /^grade -5\.0 % \(downhill\)$/.test(s)));
    const o8 = build(8);
    assert.ok(!texts(o8).includes('WRONG TARGET'));
    assert.ok(!texts(o8).some((s) => s.startsWith('WARNING')));
    assert.ok(texts(o8).includes('flat road'));
    const o34 = build(34.5);
    assert.ok(texts(o34).includes('SENSOR · no target'));
    assert.ok(texts(o34).includes('sensor: no target'));
    const brake = r.events.find((e) => e.kind === 'driver.brake');
    assert.ok(texts(build(brake.t + 0.3)).some((s) => s.startsWith('DRIVER BRAKES')));
    assert.ok(texts(o8).some((s) => s.startsWith('assumed plant: ')));
    assert.ok(texts(o8).some((s) => s.startsWith('FAKE DATA')));
});

test('a vehicle beyond the range is an arrow with its distance; zoom changes the scale', () => {
    const near = build(8, { aheadM: 50 });
    assert.ok(texts(near).some((s) => /^lead \d+ m$/.test(s)));
    assert.ok(near.layout.ppm > build(8, { aheadM: 200 }).layout.ppm);
});

test('no frame: the empty road with a message; a narrow canvas drops the readout panel', () => {
    const out = S.buildScene(null, { width: 800, height: 300 });
    assert.ok(texts(out).some((s) => s.startsWith('No run yet')));
    const narrow = build(8, { width: 600 });
    assert.ok(!texts(narrow).some((s) => s === 'Speed'));
    assert.ok(texts(build(8)).includes('Speed'));
});

test('fitRange, elevationProfile and lanesOf', () => {
    const f = S.fitRange(r);
    assert.ok(f >= 40 && f <= 300 && f % 10 === 0);
    const p = S.elevationProfile(r);
    for (let i = 1; i < p.xs.length; i++) assert.ok(p.xs[i] > p.xs[i - 1]);
    assert.ok(p.any);
    // 5 % down between 900 and 1300 m: a fall of about 20 m once the run passed it
    const xa = 905, xb = Math.min(1295, p.xs[p.xs.length - 1]);
    assert.ok(Math.abs((S.zAt(p, xb) - S.zAt(p, xa)) / (xb - xa) + 0.05) < 0.002);
    assert.equal(S.zAt(p, -1e9), p.zs[0]);
    assert.equal(S.lanesOf(r), 2);
    assert.equal(S.lanesOf(null), 2);
    assert.equal(S.elevationProfile(A.normalizeResult({ t: [0], series: {} })), null);
});

test('the PNG player renders a frame', () => {
    const out = build(18.6, { width: 480, height: 300, theme: 'dark' });
    const png = P.render(out.ops, 480, 300, 1).png();
    assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(png.length > 2000);
});

// The real engine, when core/sim.js is in this checkout (SC1's branch merged): every frame of its run draws cleanly.
const fs = require('fs');
const path = require('path');
const SIM = path.join(__dirname, '..', 'core', 'sim.js');
test('the engine\'s own run (core/sim.js) draws: finite ops on every frame, the lead and the sensor', { skip: !fs.existsSync(SIM) && 'core/sim.js not in this checkout' }, () => {
    const res = A.normalizeResult(require(SIM).run({ seed: 1 }));
    const tl2 = A.buildTimeline(res);
    const o = { width: 1000, height: 340, aheadM: S.fitRange(res), profile: S.elevationProfile(res), lanes: S.lanesOf(res) };
    let leads = 0;
    for (let i = 0; i < res.t.length; i += 10) {
        const fr = A.frameAt(res, tl2, res.t[i]);
        if (fr.vehicles.some((v) => v.role === 'lead')) leads++;
        const out = S.buildScene(fr, o);
        for (const op of out.ops) for (const k of NUM[op.k] || []) assert.ok(Number.isFinite(op[k]), 't=' + res.t[i] + ' ' + op.k + '.' + k);
        assert.ok(!texts(out).some((t) => /NaN|undefined/.test(t)), 't=' + res.t[i]);
    }
    assert.ok(leads > 0, 'the true lead is found by its id');
});
