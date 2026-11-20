'use strict';
// The simulator's parts: road geometry and sight, the world's motion, the sensor's raw encoding and faults, the
// reference driver, the metrics, the engine's invariant counters, replay of a frames scenario, determinism.
const { test, assert, near } = require('./harness');
const B = require('../../../shared/beam_logic');
const RNG = require('../core/rng');
const ROAD = require('../core/road');
const WORLD = require('../core/world');
const SENSOR = require('../core/sensor');
const DRIVER = require('../core/driver');
const MET = require('../core/metrics');
const SIM = require('../core/sim');
const SC = require('../core/scenario');

test('rng: seeded, forks independent and stable per label', () => {
  const a = RNG.create(5), b = RNG.create(5);
  for (let i = 0; i < 100; i++) assert.strictEqual(a.next(), b.next());
  const f1 = RNG.create(5).fork('x'), f2 = RNG.create(5).fork('x'), g = RNG.create(5).fork('y');
  assert.strictEqual(f1.next(), f2.next());
  assert.notStrictEqual(RNG.create(5).fork('x').next(), g.next());
  let s = 0; const r = RNG.create(1); for (let i = 0; i < 10000; i++) s += r.normal(0, 1);
  near(s / 10000, 0, 0.05);
});

test('road: a straight is straight; a curve of radius 200 turns 90 deg over 314 m; lanes; the sight around a curve and over a crest', () => {
  const r = ROAD.create({ segments: [{ len_m: 1000 }] });
  const p = r.pose(500, 2);
  near(p.x, 500, 1e-6); near(p.y, 2, 1e-6);
  const c = ROAD.create({ segments: [{ len_m: 314.159, curve_r: 200 }] });
  near(c.pose(314.159, 0).h, Math.PI / 2, 0.01);
  near(c.pose(314.159, 0).x, 200, 1); near(c.pose(314.159, 0).y, 200, 1);
  assert.ok(c.curvature(100) > 0);
  const tight = ROAD.create({ segments: [{ len_m: 100 }, { len_m: 400, curve_r: 150 }], sight_m: 3 });
  assert.strictEqual(tight.sight({ s: 100, d: -1.75, hgt: 1.3 }, { s: 140, d: 1.75, hgt: 0.7 }), true);
  assert.strictEqual(tight.sight({ s: 100, d: -1.75, hgt: 1.3 }, { s: 300, d: 1.75, hgt: 0.7 }), false);
  const hill = ROAD.create({ segments: [{ len_m: 2000 }], profile: [[0, 0], [500, 0], [700, 15], [900, 0]] });
  assert.strictEqual(hill.sight({ s: 400, d: 0, hgt: 1.3 }, { s: 1000, d: 0, hgt: 0.7 }), false);
  assert.strictEqual(hill.sight({ s: 100, d: 0, hgt: 1.3 }, { s: 450, d: 0, hgt: 0.7 }), true);
  const screen = ROAD.create({ lanes: 4, median_m: 10, screen: true, segments: [{ len_m: 2000 }] });
  assert.strictEqual(screen.sight({ s: 0, d: -8, hgt: 1.3 }, { s: 300, d: 8, hgt: 0.7 }), false);
  assert.strictEqual(screen.sight({ s: 0, d: -8, hgt: 1.3 }, { s: 300, d: -8, hgt: 0.7 }), true);
});

test('world: speeds integrate to stations; lanes by direction; an oncoming car\'s bearing is left (negative az); a truck blocks the car behind it', () => {
  const w = WORLD.create({ ego: { speed: [[0, 72]] }, users: [{ id: 'c', kind: 'car', dir: -1, s0_m: 1000, speed: [[0, 72]] },
    { id: 't', kind: 'truck', dir: 1, ahead_m: 50, speed: [[0, 72]] }, { id: 'h', kind: 'car', dir: 1, ahead_m: 150, speed: [[0, 72]] }] }, { duration_s: 30 });
  near(w.ego(10).s, 200, 0.5);
  const u = w.users(10);
  near(u.filter((x) => x.id === 'c')[0].s, 800, 0.5);
  assert.strictEqual(w.lane(1, 0), -1.75); assert.strictEqual(w.lane(-1, 0), 1.75);
  const ego = w.ego(10);
  const lk = w.look(ego, { s: 800, d: 1.75, hgt: 0.7 });
  assert.ok(lk.az < 0 && lk.az > -2, 'oncoming on the left: ' + lk.az);
  near(lk.dist, 600, 1);
  const h = u.filter((x) => x.id === 'h')[0];
  assert.strictEqual(w.sight({ s: ego.s, d: ego.d, hgt: 1.3 }, { s: h.s, d: h.d, hgt: 0.7 }, 10, 'h'), false, 'hidden by the truck');
  const env = WORLD.create({ env: { towns: [{ s0_m: 100, s1_m: 200, limit_kmh: 50 }] } }, { duration_s: 5 }).env(1, 150);
  assert.strictEqual(env.town, true); assert.strictEqual(env.limit_kmh, 50);
});

test('sensor: raw encoding round-trips through the algorithm\'s scales; the 15-object cap keeps headlamps first', () => {
  const lamps = []; for (let s = 300; s < 1000; s += 30) lamps.push({ s0_m: s, s1_m: s, spacing_m: 30, side: 1, height_m: 8 });
  const w = WORLD.create({ ego: { speed: [[0, 50]] }, users: [{ id: 'c', kind: 'car', dir: -1, s0_m: 300, speed: [[0, 0.001]] }], lit: lamps }, { duration_s: 5 });
  const sen = SENSOR.create(w, { miss: 0, falseRate: 0, noiseAz_deg: 0, noiseDist: 0, drop: 0, idSwitch: 0, jitter_ms: 0 }, RNG.create(1), B.DEFAULTS);
  sen.advance(1000, false);
  const f = sen.frame(1000, {});
  assert.ok(f.lights.v.length === 15, 'capped at 15: ' + f.lights.v.length);
  const head = f.lights.v.filter((o) => o.cls === 1)[0];
  assert.ok(head, 'the headlamps are kept');
  near(head.dist * 4, 300 - w.ego(1 - 0.08).s, 8);
  assert.ok(f.lights.age >= 0 && f.lights.age < 100);
  assert.ok(f.lights.v.every((o) => o.x >= 0 && o.x <= 254 && o.dist >= 0 && o.dist <= 126 && o.id >= 0 && o.id <= 14));
  const ids = f.lights.v.map((o) => o.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'ids unique within a frame');
  const L = B.create({}).step(f);
  assert.ok(L.details.lights.some((x) => x.kind === 'head' && Math.abs(x.dist_m - head.dist * 4) < 0.01));
});

test('sensor: a new track is weak for its first frames, then strong; faults: stale stops the stream, silent never sends, blind reports through the object list', () => {
  const w = WORLD.create({ users: [{ id: 'c', kind: 'car', dir: -1, s0_m: 600, speed: [[0, 50]] }],
    faults: [{ kind: 'stale', t0_s: 2, t1_s: 3 }, { kind: 'blind', t0_s: 4, t1_s: 5, reported: true }] }, { duration_s: 8 });
  const sen = SENSOR.create(w, { miss: 0, falseRate: 0, drop: 0 }, RNG.create(1), B.DEFAULTS);
  sen.advance(100, false);
  assert.strictEqual(sen.frame(100, {}).lights.v[0].status, 1);
  sen.advance(1000, false);
  assert.strictEqual(sen.frame(1000, {}).lights.v[0].status, 2);
  sen.advance(2900, false);
  assert.ok(sen.frame(2900, {}).lights.age > 800, 'stale');
  sen.advance(4500, false);
  const f = sen.frame(4500, {});
  assert.strictEqual(f.lights.v.length, 0); assert.strictEqual(f.objects.qual, 2);
  const w2 = WORLD.create({ faults: [{ kind: 'silent', t0_s: 0 }] }, { duration_s: 3 });
  const s2 = SENSOR.create(w2, {}, RNG.create(1), B.DEFAULTS);
  s2.advance(2000, false);
  assert.strictEqual(s2.frame(2000, {}).lights, undefined);
});

test('reference driver: dips after a human reaction, returns after the clear time', () => {
  const d = DRIVER.create({ reaction_ms: 1000, reactionSd: 0 }, RNG.create(1));
  let t = 0, last;
  for (; t <= 5000; t += 100) last = d.step(t, { ok: true, seen: [] });
  assert.strictEqual(last.high, true);
  let dipAt = null;
  for (; t <= 9000; t += 100) { const r = d.step(t, { ok: true, seen: [{ kind: 'head', dist: 200 }] }); if (r.changed === 'high_off') dipAt = t; }
  assert.strictEqual(dipAt, 6100);
});

test('metrics: glare, missed light, switches, dwell and agreement from a hand-made series', () => {
  const n = 100;
  const S = { t: [], want: [], ref: [], glareN: [], glareW: [], glareRefN: [], glareRefW: [], allowed: [], s: [] };
  for (let i = 0; i < n; i++) {
    S.t.push(i * 0.1); S.want.push(i < 30 || i >= 60 ? 1 : 0); S.ref.push(i < 35 || i >= 65 ? 1 : 0);
    S.glareN.push(i >= 25 && i < 35 ? 1 : 0); S.glareW.push(i >= 25 && i < 35 ? 2 : 0); S.glareRefN.push(S.glareN[i]); S.glareRefW.push(S.glareW[i]);
    S.allowed.push(i < 20 || i >= 50 ? 1 : 0); S.s.push(i * 2.5);
  }
  const m = MET.compute(S, { exposures: [{ uid: 'a', wInt: 1, highAtStart: true, reaction_ms: 500 }], inv: { highSlow: 1 } });
  near(m.glare_s, 0.5, 1e-9); near(m.glareW, 1.0, 1e-9);
  near(m.missed_s, 1.0, 1e-9); near(m.highFrac, 6 / 7, 1e-3);
  assert.strictEqual(m.switches, 2); assert.strictEqual(m.minDwell_ms, 3000);
  near(m.agreeRef, 0.9, 1e-9); assert.strictEqual(m.maxReaction_ms, 500); assert.strictEqual(m.highSlow, 1);
  const v = MET.judge(m, { maxGlareW: 0.5, minHighFrac: 0.9, mustState: ['OVERRIDE'] }, {}, null);
  assert.strictEqual(v.pass, false);
  assert.deepStrictEqual(v.failed, ['highSlow', 'glareW>0.5', 'highFrac<0.9', 'never OVERRIDE']);
  assert.strictEqual(MET.weight(200), 1); assert.strictEqual(MET.weight(400), 0.25); assert.strictEqual(MET.weight(10), 4);
});

test('engine: an exception in the algorithm is counted, the advice is low, the run goes on', () => {
  let n = 0;
  const evil = { create: (c) => { const i = B.create(c); return { config: i.config, configErrors: [], step: (f) => { if (++n % 50 === 0) throw new Error('x'); return i.step(f); } }; } };
  const r = SIM.run(SC.load('A01.empty'), { logic: evil });
  assert.ok(r.metrics.exception > 5);
  assert.strictEqual(r.verdict.pass, false);
  assert.ok(r.verdict.failed.indexOf('exception') >= 0);
});

test('engine: the invariant counters catch an algorithm that says high when it must not', () => {
  const liar = { create: (c) => { const i = B.create(c); return { config: i.config, configErrors: [], step: (f) => Object.assign({}, i.step(f), { want: 'high', state: 'HIGH', reason: 'clear' }) }; } };
  const r = SIM.run(SC.load('J04.stop.start'), { logic: liar });
  assert.ok(r.metrics.highSlow > 0);
  const r2 = SIM.run(SC.load('H07.stale.2s'), { logic: liar });
  assert.ok(r2.metrics.highStale > 0);
  const r3 = SIM.run(SC.load('H03.fog'), { logic: liar });
  assert.ok(r3.metrics.highFog > 0);
  const r4 = SIM.run(SC.load('J05.lowbeam.off'), { logic: liar });
  assert.ok(r4.metrics.highNoLow > 0);
});

test('replay: a world run exported as frames replays to the same advice, tick for tick; the driver label scores agreement', () => {
  const scn = SC.load('B02.oncoming.stream');
  const live = SIM.run(scn, { seed: 3 });
  const rec = SIM.exportFrames(scn, { seed: 3 });
  assert.deepStrictEqual(SC.validate(rec), []);
  assert.strictEqual(rec.source, 'generated');
  const rep = SIM.run(rec);
  assert.ok(rep.meta.replay);
  assert.deepStrictEqual(rep.series.want, live.series.want);
  assert.deepStrictEqual(rep.series.reason, live.series.reason);
  assert.ok(rep.metrics.agreeDriver > 0.7, 'agreement with the exported driver: ' + rep.metrics.agreeDriver);
  assert.ok(rep.metrics.lagN >= 1);
  // through JSON (as a file would be) it is the same
  const rep2 = SIM.run(JSON.parse(JSON.stringify(rec)));
  assert.deepStrictEqual(rep2.series.want, live.series.want);
});

test('replay: recorded lamps.high is the driver label; the camera\'s verdict is compared when present', () => {
  const frames = [];
  for (let t = 0; t < 30000; t += 100) {
    frames.push({ t: 1000000 + t, lights: { v: [], age: 30, ok: true }, verdict: { v: { allow: t < 20000 ? 1 : 0 }, age: 50, ok: true },
      car: { v: { speed_kmh: 70 }, age: 10, ok: true }, lamps: { v: { low: true, high: t > 9500 && t < 20000, fog: false }, age: 10, ok: true },
      env: { v: { brightness: 2, sun: 'night' }, age: 10, ok: true } });
  }
  const r = SIM.run({ format: 'beam-scenario', version: 1, id: 'rec', source: 'recorded', frames: frames });
  assert.ok(r.metrics.agreeDriver > 0.6, String(r.metrics.agreeDriver));
  assert.ok(r.metrics.agreeVerdict !== null);
  near(r.series.t[r.series.t.length - 1], 29.9, 1e-9);
});

test('determinism: the same seed gives the same result byte for byte; another seed differs', () => {
  const scn = SC.load('K03.oncoming.platoon');
  assert.strictEqual(SIM.hashResult(SIM.run(scn, { seed: 11 })), SIM.hashResult(SIM.run(scn, { seed: 11 })));
  assert.notStrictEqual(SIM.hashResult(SIM.run(scn, { seed: 11 })), SIM.hashResult(SIM.run(scn, { seed: 12 })));
  const a = JSON.stringify(SIM.exportFrames(scn, { seed: 4 })), b = JSON.stringify(SIM.exportFrames(scn, { seed: 4 }));
  assert.strictEqual(a, b);
});

test('createRun steps the same run as run()', () => {
  const scn = SC.load('E02.lit.junction');
  const r = SIM.createRun(scn, {});
  let n = 0;
  while (!r.done) { r.step(); n++; }
  assert.strictEqual(n, r.nTicks);
  assert.strictEqual(SIM.hashResult(r.result()), SIM.hashResult(SIM.run(scn, {})));
});
