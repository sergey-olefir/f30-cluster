'use strict';
/** SU1: the pure half of ui/app.js (config, URL state, result files, sampling, timeline, playback). node tools/cruise-sim/tests/app.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../ui/app.js');
const F = require('../ui/fake-result.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'su1-fake-result.json');
const CONTRACT_SERIES = ('ego.x ego.v ego.a ego.jerk lead.x lead.v lead.a lead.id gap.true vrel.true gap.meas vrel.meas meas.valid ' +
    'est.gap est.vrel est.vlead est.alead est.valid set.cmd set.held v.driverMax d.des d.needed v.ref timegap ttc warn cruise.state ' +
    'driver.brake driver.accel grade follower.gap follower.a').split(' ');
const fake = () => A.normalizeResult(F.makeFakeResult({ seed: 1, duration: 60, out: { dt: 0.05 } }));

test('deepMerge: nested objects merge, arrays and scalars replace, inputs untouched', () => {
    const a = { x: 1, o: { p: 1, q: [1, 2] }, f: [{ k: 1 }] };
    const b = { o: { q: [3] }, f: [], n: null };
    const m = A.deepMerge(a, b);
    assert.deepEqual(m, { x: 1, o: { p: 1, q: [3] }, f: [], n: null });
    assert.deepEqual(a, { x: 1, o: { p: 1, q: [1, 2] }, f: [{ k: 1 }] });
    m.o.p = 9;
    assert.equal(a.o.p, 1);
    assert.deepEqual(A.deepMerge(a, { o: { r: undefined } }).o, { p: 1, q: [1, 2] });
});

test('diffConfig is the minimal partial and deepMerge(base, diff) restores the config', () => {
    const base = A.BASE_CONFIG;
    assert.equal(A.diffConfig(base, A.clone(base)), undefined);
    const cfg = A.deepMerge(base, { seed: 7, plant: { preset: 'firm', aMin: -2.5 }, failures: [{ kind: 'appDead', at: 'worst' }], sensor: {} });
    const d = A.diffConfig(base, cfg);
    assert.deepEqual(d, { seed: 7, plant: { preset: 'firm', aMin: -2.5 }, failures: [{ kind: 'appDead', at: 'worst' }], sensor: {} });
    assert.deepEqual(A.diffConfig({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3 } }), { a: { c: 3 } });
    assert.equal(A.diffConfig({ a: { b: 1 } }, { a: { b: 1 } }), undefined);
    assert.deepEqual(A.BASE_CONFIG, { version: 1, seed: 1 }, 'sparse: the engine fills its own defaults');
    assert.deepEqual(A.deepMerge(base, d), cfg);
});

test('URL state: round trip of config, cursor and view; the base config gives an empty hash', () => {
    assert.equal(A.encodeState({ config: A.clone(A.BASE_CONFIG), t: 0, view: 'run' }), '');
    const cfg = A.deepMerge(A.BASE_CONFIG, { scenario: { id: 'E.cutin.15m', overrides: { note: 'зріз — ü ✓' } }, controller: { h: 1.6, tau: 5 }, duration: 240 });
    const h = A.encodeState({ config: cfg, t: 12.345, view: 'batch' });
    assert.match(h, /^c=[A-Za-z0-9_-]+&t=12\.35&v=batch$/);       // URL-safe, no padding
    const st = A.decodeState('#' + h);
    assert.equal(st.error, null);
    assert.deepEqual(st.config, cfg);
    assert.equal(st.t, 12.35);
    assert.equal(st.view, 'batch');
});

test('URL state: a broken config in the link is reported, not thrown; the rest still applies', () => {
    const st = A.decodeState('#c=%%%not-base64&t=3&v=report');
    assert.ok(st.error);
    assert.deepEqual(st.config, A.BASE_CONFIG);
    assert.equal(st.t, 3);
    assert.equal(st.view, 'report');
    assert.ok(A.decodeState('#c=' + A.b64urlEncode('[1,2]')).error, 'an array is not a config');
    assert.deepEqual(A.decodeState('').config, A.BASE_CONFIG);
});

test('normalizeResult: plain arrays to Float64Array, null to NaN, events sorted, defaults for meta', () => {
    const r = A.normalizeResult(JSON.stringify({ t: [0, 0.1, 0.2], series: { 'ego.v': [1, null, 3] }, events: [{ t: 0.2, kind: 'b' }, { t: 0.1, kind: 'a' }] }));
    assert.ok(r.t instanceof Float64Array);
    assert.ok(Number.isNaN(r.series['ego.v'][1]));
    assert.deepEqual(r.events.map((e) => e.kind), ['a', 'b']);
    assert.equal(r.meta.plant.assumed, true);
    assert.deepEqual(r.meta.enums['cruise.state'].slice(0, 2), ['off', 'active']);
    assert.throws(() => A.normalizeResult({ t: [0, 1], series: { x: [1] } }), /samples/);
    assert.throws(() => A.normalizeResult({ series: {} }), /not a run result/);
});

test('serializeResult -> JSON -> normalizeResult keeps every value (to the rounding) and every NaN', () => {
    const r = fake();
    const back = A.normalizeResult(JSON.parse(JSON.stringify(A.serializeResult(r, 4))));
    assert.equal(back.t.length, r.t.length);
    assert.deepEqual(Object.keys(back.series).sort(), Object.keys(r.series).sort());
    for (const n of Object.keys(r.series)) {
        const a = r.series[n], b = back.series[n];
        for (let i = 0; i < a.length; i++) {
            if (Number.isNaN(a[i])) assert.ok(Number.isNaN(b[i]), n + '[' + i + ']');
            else assert.ok(Math.abs(a[i] - b[i]) <= 5e-5 + 1e-12, n + '[' + i + '] ' + a[i] + ' vs ' + b[i]);
        }
    }
    assert.deepEqual(back.events, r.events);
    assert.deepEqual(back.verdict, r.verdict);
});

test('classifyFile tells results, batches, configs and presets apart', () => {
    assert.equal(A.classifyFile({ t: [], series: {} }), 'result');
    assert.equal(A.classifyFile({ kind: 'cs-batch', runs: [] }), 'batch');
    assert.equal(A.classifyFile({ runs: [{}] }), 'batch');
    assert.equal(A.classifyFile({ kind: 'cs-config', config: { seed: 2 } }), 'config');
    assert.equal(A.classifyFile({ seed: 3, plant: {} }), 'config');
    assert.equal(A.classifyFile({ kind: 'cs-presets', presets: { a: {} } }), 'presets');
    assert.equal(A.classifyFile({ kind: 'cs-settings-presets', version: 1, presets: { a: { saved: 'x', config: {} } } }), 'presets');
    assert.equal(A.classifyFile({ hello: 1 }), 'unknown');
    assert.equal(A.classifyFile(null), 'unknown');
});

test('indexAt: the last sample at or before t, clamped at both ends', () => {
    const t = Float64Array.from([0, 0.5, 1, 1.5]);
    assert.equal(A.indexAt(t, -1), 0);
    assert.equal(A.indexAt(t, 0), 0);
    assert.equal(A.indexAt(t, 0.49), 0);
    assert.equal(A.indexAt(t, 0.5), 1);
    assert.equal(A.indexAt(t, 1.2), 2);
    assert.equal(A.indexAt(t, 9), 3);
    assert.equal(A.indexAt(new Float64Array(0), 1), -1);
});

test('sampleAt: continuous series interpolate, discrete ones hold, NaN neighbours hold', () => {
    const r = A.normalizeResult({ t: [0, 1, 2], series: { 'ego.v': [10, 20, null], warn: [0, 1, 1], 'cruise.state': [1, 2, 2], 'gap.meas': [30, 40, 50] } });
    const s = A.sampleAt(r, 0.25).s;
    assert.equal(s['ego.v'], 12.5);
    assert.equal(s.warn, 0);
    assert.equal(s['cruise.state'], 1);
    assert.equal(s['gap.meas'], 30, 'the measured gap is a sensor sample: held');
    assert.equal(A.sampleAt(r, 1.5).s['ego.v'], 20, 'next sample NaN: hold the last value');
    assert.equal(A.sampleAt(r, 1).s.warn, 1);
    assert.equal(A.sampleAt(r, 5).s['gap.meas'], 50);
});

test('buildTimeline on the fake run: faults, warnings and targets in time order', () => {
    const r = fake(), tl = A.buildTimeline(r);
    assert.deepEqual(tl.faults.map((f) => [f.name, f.t0, f.t1]), [['curveLoss', 33, 36], ['gapFrozen', 40, 43], ['wrongTarget', 49, 51.5]]);
    assert.ok(tl.warns.length >= 1 && tl.warns[0].t0 > 15 && tl.warns[0].t1 > tl.warns[0].t0);
    assert.deepEqual(tl.faultsAt(41).map((f) => f.name), ['gapFrozen']);
    assert.deepEqual(tl.faultsAt(43), [], 'fault.off ends it');
    assert.equal(tl.targetAt(5), 1);
    assert.equal(tl.targetAt(34), null, 'lost on the curve');
    assert.equal(tl.targetAt(-1), undefined);
    assert.equal(tl.collision, null);
    // an open fault runs to the end of the run
    const r2 = A.normalizeResult({ t: [0, 1, 2], series: {}, events: [{ t: 1, kind: 'fault.on', fault: 'appDead' }, { t: 1.5, kind: 'warn.on', reason: 'ttc' }] });
    const tl2 = A.buildTimeline(r2);
    assert.deepEqual([tl2.faults[0].t0, tl2.faults[0].t1, tl2.warns[0].t1, tl2.warns[0].reason], [1, 2, 2, 'ttc']);
});

test('frameAt: vehicles, the lead, the sensor target (right / wrong / none), warning, faults', () => {
    const r = fake(), tl = A.buildTimeline(r);
    const f8 = A.frameAt(r, tl, 8);
    assert.equal(f8.vehicles.length, 4);
    assert.deepEqual(f8.vehicles.filter((v) => v.role === 'lead').map((v) => v.id), [1]);
    assert.equal(f8.sensor.valid, true);
    assert.equal(f8.sensor.targetId, 1);
    assert.equal(f8.sensor.wrong, false);
    assert.equal(f8.cruiseState, 'active');
    const f50 = A.frameAt(r, tl, 50);
    assert.equal(f50.sensor.wrong, true);
    assert.equal(f50.sensor.targetId, 3);
    assert.deepEqual(f50.faults.map((f) => f.name), ['wrongTarget']);
    const f34 = A.frameAt(r, tl, 34.5);
    assert.equal(f34.sensor.none, true);
    assert.equal(f34.sensor.targetId, null);
    const w = tl.warns[0], fw = A.frameAt(r, tl, (w.t0 + w.t1) / 2);
    assert.equal(fw.warn, true);
    assert.ok(fw.warnReason);
    assert.ok(fw.recent.every((e) => e.t <= fw.t && e.t > fw.t - 3));
    assert.equal(fw.fake, true);
    assert.equal(fw.plant.assumed, true);
});

test('frameAt without veh.* series: the lead from gap.true, the follower from follower.gap; target from events', () => {
    const r = A.normalizeResult({
        t: [0, 1], series: { 'ego.x': [100, 120], 'gap.true': [30, 28], 'lead.id': [5, 5], 'lead.v': [20, 20], 'follower.gap': [12, 12], 'gap.meas': [31, 29], 'meas.valid': [1, 1] },
        events: [{ t: 0, kind: 'target.acquired', id: 7 }],
    });
    const fr = A.frameAt(r, A.buildTimeline(r), 0);
    const lead = fr.vehicles.find((v) => v.role === 'lead'), fol = fr.vehicles.find((v) => v.id === 'follower');
    assert.equal(lead.x - lead.length - fr.ego.x, 30, 'rear of the lead = ego front + true gap');
    assert.equal(fr.ego.x - fr.ego.length - fol.x, 12);
    assert.equal(fr.sensor.targetId, 7);
    assert.equal(fr.sensor.wrong, true, 'the sensor holds #7, the true lead is #5');
});

test('Playback: speed, end of run, loop, frame-gap cap, sample steps', () => {
    const p = new A.Playback(0, 10);
    assert.equal(p.speed, 1);
    assert.equal(p.advance(1), 0, 'paused: no movement');
    p.play();
    p.setSpeed(4);
    assert.equal(p.speed, 4);
    assert.equal(p.advance(0.2), 0.8);
    assert.equal(p.advance(5), 0.8 + 0.25 * 4, 'a long frame gap counts as 0.25 s');
    p.setSpeed(16);
    for (let i = 0; i < 10; i++) p.advance(0.1);
    assert.equal(p.t, 10);
    assert.equal(p.playing, false, 'stops at the end');
    assert.equal(p.play(), true);
    assert.equal(p.t, 0, 'play at the end restarts');
    p.loop = true; p.seek(9.5); p.setSpeed(1);
    p.advance(0.2); p.advance(0.2); p.advance(0.2);
    assert.ok(p.playing && Math.abs(p.t - 0.1) < 1e-9, 'loop wraps: ' + p.t);
    p.setSpeed(0.3); assert.equal(p.speed, 0.25);
    p.setSpeed(100); assert.equal(p.speed, 16);
    assert.equal(p.faster(), 16);
    p.setSpeed(0.25); assert.equal(p.slower(), 0.25);
    const t = Float64Array.from([0, 0.05, 0.1, 0.15, 0.2]);
    const q = new A.Playback(0, 0.2);
    q.seek(0.07);
    assert.equal(q.step(t, 1), 0.1);
    q.seek(0.07);
    assert.equal(q.step(t, -1), 0.05, 'between samples one back = the sample before... ');
    assert.equal(q.step(t, -1), 0);
    assert.equal(q.step(t, -1), 0, 'clamped at the start');
    assert.equal(q.step(t, 10), 0.2, 'clamped at the end');
    assert.equal(q.playing, false);
    assert.deepEqual(A.SPEEDS, [0.25, 0.5, 1, 2, 4, 8, 16]);
});

test('estimateMs and sensorSamples (the cluster-preview hook)', () => {
    assert.equal(A.estimateMs({ duration: 100 }, 3), 300);
    assert.equal(A.estimateMs({ duration: 100 }, 0), 200, 'no measurement yet: 2 ms per simulated second');
    const r = fake(), ss = A.sensorSamples(r);
    assert.equal(ss.length, r.t.length);
    const lost = ss.find((x) => x.t > 34 && x.t < 35);
    assert.equal(lost.valid, false);
    assert.equal(lost.gap, null);
    assert.ok(ss[0].valid && ss[0].gap > 100 && ss[0].id === 1);
});

test('the fake stand-in is deterministic per seed and carries every contract series', () => {
    const a = F.makeFakeResult({ seed: 3, duration: 20 }), b = F.makeFakeResult({ seed: 3, duration: 20 }), c = F.makeFakeResult({ seed: 4, duration: 20 });
    const h = (r) => JSON.stringify(A.serializeResult(r, 6).series);
    assert.equal(h(a), h(b));
    assert.notEqual(h(a), h(c));
    for (const n of CONTRACT_SERIES) assert.ok(a.series[n], 'series ' + n);
    assert.equal(a.meta.fake, true);
    assert.equal(a.meta.plant.assumed, true);
});

test('the tracked fixture loads as a result and matches what the generator writes', () => {
    const txt = fs.readFileSync(FIXTURE, 'utf8');
    const r = A.normalizeResult(txt);
    assert.equal(A.classifyFile(JSON.parse(txt)), 'result');
    for (const n of CONTRACT_SERIES) assert.ok(r.series[n], 'series ' + n);
    assert.equal(r.t.length, 301);
    const gen = F.makeFakeResult({ seed: 1, duration: 60, out: { dt: 0.2 } });
    gen.meta.ms = 0;
    assert.equal(JSON.stringify(A.serializeResult(gen, 2)) + '\n', txt, 'regenerate: node tools/cruise-sim/ui/fake-result.js 60 0.2 > tools/cruise-sim/tests/fixtures/su1-fake-result.json');
});

test('SC1-shaped result: ids as indices into meta.enums.id, y for the lane, warn.reason as an enum, app.alive', () => {
    const r = A.normalizeResult({
        meta: { enums: { id: ['lead', 'cutter'], 'warn.reason': ['distance', 'ttc'] }, vehicles: [{ id: 'lead', kind: 'car', length: 4.5, width: 1.8 }, { id: 'cutter', kind: 'truck', length: 12, width: 2.5 }] },
        t: [0, 1],
        series: {
            'ego.x': [0, 20], 'lead.id': [0, 1], 'meas.id': [0, 0], 'meas.valid': [1, 1], 'gap.meas': [40, 30], 'warn': [0, 1], 'warn.reason': [null, 1], 'app.alive': [1, 0],
            'veh.lead.x': [50, 70], 'veh.lead.y': [0, 0], 'veh.cutter.x': [30, 45], 'veh.cutter.y': [3.5, 1.75], 'curvature': [0, 0.002],
        },
    });
    const tl = A.buildTimeline(r);
    const f0 = A.frameAt(r, tl, 0), f1 = A.frameAt(r, tl, 1);
    assert.equal(f0.leadId, 'lead');
    assert.equal(f0.sensor.targetId, 'lead');
    assert.equal(f0.sensor.wrong, false);
    assert.deepEqual(f0.vehicles.map((v) => [v.id, v.role, v.lane]), [['lead', 'lead', 0], ['cutter', 'other', 1]]);
    assert.equal(f0.appAlive, true);
    assert.equal(f1.leadId, 'cutter');
    assert.equal(f1.sensor.wrong, true, 'the sensor still holds the old lead');
    assert.equal(f1.vehicles[1].lane, 0.5, 'half way through the lane change');
    assert.equal(f1.warnReason, 'ttc');
    assert.equal(f1.appAlive, false);
    assert.equal(f1.curvature, 0.002);
});

test('script order: core files as sim.LOAD_ORDER, the scenario bundle just before core/scenario.js', () => {
    const l = A.scriptList();
    assert.equal(l[0], '../core/rng.js');
    assert.equal(l[l.length - 1], '../core/sim.js');
    assert.equal(l.indexOf('scenarios.bundle.js') + 1, l.indexOf('../core/scenario.js'));
    const SIM = path.join(__dirname, '..', 'core', 'sim.js');
    if (fs.existsSync(SIM) && require(SIM).LOAD_ORDER) assert.deepEqual(A.CORE_FILES, require(SIM).LOAD_ORDER, 'the page loads what the engine lists');
});

// The page opened from the disk cannot fetch the scenario JSON files: it reads ui/scenarios.bundle.js. Keep it in step.
const SCN = path.join(__dirname, '..', 'core', 'scenario.js');
test('ui/scenarios.bundle.js matches the scenario files', { skip: !fs.existsSync(SCN) && 'core/scenario.js not in this checkout' }, () => {
    const want = require(SCN).bundleJs();
    const file = path.join(__dirname, '..', 'ui', 'scenarios.bundle.js');
    const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    assert.ok(have === want, 'regenerate: node tools/cruise-sim/core/scenario.js --bundle > tools/cruise-sim/ui/scenarios.bundle.js');
});
