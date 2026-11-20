'use strict';
// shared/beam_logic.js, rule by rule: every precondition and its hysteresis, every dip trigger, every timer, the
// override, every fail-safe input, the config, the output's shape (docs/highbeam/CONTRACT.md).
const path = require('path');
const fs = require('fs');
const { test, assert } = require('./harness');
const B = require('../../../shared/beam_logic');
const RNG = require('../core/rng');

// a good frame: dark, 80 km/h, low beam on, an empty light list
function fr(t, o) {
  const x = o || {};
  const f = {
    t: t,
    lights: { v: x.lights || [], age: x.lightsAge === undefined ? 20 : x.lightsAge, ok: true },
    car: { v: { speed_kmh: x.speed === undefined ? 80 : x.speed, yaw_dps: x.yaw || 0, steer_deg: null, gear: x.gear || 'D' }, age: 10, ok: true },
    lamps: { v: { low: x.low === undefined ? true : x.low, high: x.high === undefined ? null : x.high, fog: !!x.fog, switch: 'auto' }, age: 50, ok: true },
    env: { v: { brightness: x.lux === undefined ? 1 : x.lux, sun: x.sun === undefined ? 'night' : x.sun, wiper: x.wiper || 0, limit_kmh: x.limit === undefined ? null : x.limit, urban: x.urban === undefined ? null : x.urban }, age: 100, ok: true },
  };
  if (x.verdict) f.verdict = { v: x.verdict, age: 100, ok: true };
  if (x.objects) f.objects = { v: x.objects, age: 20, ok: true, qual: x.qual === undefined ? 0 : x.qual };
  else if (x.qual !== undefined) f.objects = { v: [], age: 20, ok: true, qual: x.qual };
  if (x.stalk) f.stalk = { v: x.stalk, age: 0, ok: true };
  if (x.rearm) f.app = { v: { rearm: true } };
  ['lights', 'car', 'lamps', 'env', 'verdict', 'objects'].forEach((k) => { if (x['no_' + k]) delete f[k]; });
  return f;
}
// a light: kind via the default class table (1 head, 2 tail, 3 street, 4 reflector, 5 bike, 0 other); dist in metres
function L(id, cls, dist_m, az_deg, o) {
  const x = o || {};
  return { id: id, cls: cls, status: x.status === undefined ? 2 : x.status, x: Math.round(127 + (az_deg || 0) / 0.2),
    y: x.y === undefined ? 120 : x.y, w: 10, h: 4, dist: x.rawDist !== undefined ? x.rawDist : Math.round(dist_m / 4), wl: 127, wr: 127, age: x.age };
}
// run ticks every 100 ms from t0 to t1 with a frame builder; returns the last output and all outputs
function run(inst, t0, t1, build) {
  const outs = [];
  for (let t = t0; t <= t1; t += 100) outs.push(inst.step(build(t)));
  return { last: outs[outs.length - 1], outs: outs };
}
// an instance already in HIGH (after the darkness hold and the settle), at t = 10 s
function high(cfg) {
  const i = B.create(cfg || {});
  const r = run(i, 0, 10000, (t) => fr(t));
  assert.strictEqual(r.last.state, 'HIGH', 'warm-up reaches HIGH: ' + r.last.state + ' ' + r.last.reason);
  return i;
}
const firstAt = (outs, pred) => { const o = outs.filter(pred)[0]; return o ? o.t : null; };

// ---------------------------------------------------------------- module and contract
test('exports: states, reasons in precedence order, keys, version', () => {
  assert.deepStrictEqual(B.STATES, ['UNAVAILABLE', 'STANDBY', 'HIGH', 'DIPPED', 'OVERRIDE']);
  assert.strictEqual(B.VERSION, 1);
  assert.strictEqual(B.REASON_ORDER[0], 'error');
  assert.strictEqual(B.REASON_ORDER[B.REASON_ORDER.length - 1], 'clear');
  B.REASON_ORDER.forEach((r) => { assert.strictEqual(B.REASONS[r].key, 'beam.reason.' + r); assert.ok(B.STATES.indexOf(B.REASONS[r].state) >= 0); });
  B.STATES.forEach((s) => assert.strictEqual(B.STATE_KEYS[s], 'beam.state.' + s.toLowerCase()));
});

test('the contract copy lists exactly the module\'s reason codes, in the same precedence', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'CONTRACT.md'), 'utf8');
  const sec = md.split('## 6.')[1].split('## 7.')[0];
  const codes = [];
  sec.split('\n').forEach((l) => { const m = /^\| `([a-z_]+)` \| [A-Z]+ \|/.exec(l); if (m) codes.push(m[1]); });
  assert.deepStrictEqual(codes.slice().sort(), B.REASON_ORDER.slice().sort());
  const prec = /precedence[^:]*: ([^\n]+(\n[^\n]+)*?)\n\n/.exec(sec)[1].replace(/\n/g, ' ');
  const order = prec.split('›').map((s) => s.replace(/[`\s.]/g, ''));
  assert.deepStrictEqual(order, B.REASON_ORDER);
});

test('SCHEMA: every key has a unit or options, a default, a source and an assumed flag; DEFAULTS are built from it', () => {
  B.SCHEMA.forEach((r) => {
    assert.ok(typeof r.key === 'string' && r.key, 'key');
    assert.ok(typeof r.assumed === 'boolean', r.key + ' assumed');
    assert.ok(['catalogue', 'research', 'assumption', 'tuning', 'brief', 'owner'].indexOf(r.source) >= 0, r.key + ' source ' + r.source);
    assert.deepStrictEqual(B.getPath(B.DEFAULTS, r.key), r.def, r.key);
    if (r.type === 'num') { assert.ok(r.def >= r.min && r.def <= r.max, r.key + ' default within limits'); assert.ok(typeof r.unit === 'string'); }
    if (r.type === 'enum') assert.ok(r.options.indexOf(r.def) >= 0, r.key);
  });
  const keys = B.SCHEMA.map((r) => r.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate keys');
});

test('config: bad values fall back to defaults and are listed; unknown keys are kept; good values are taken', () => {
  const i = B.create({ zone: { head_m: NaN, tail_m: 150 }, speed: { on_kmh: -5 }, mode: 'drive', classes: { '1': 'spaceship' }, status: { strong: ['a'] }, extra: 7 });
  assert.strictEqual(i.config.zone.head_m, 400);
  assert.strictEqual(i.config.zone.tail_m, 150);
  assert.strictEqual(i.config.speed.on_kmh, 50);
  assert.strictEqual(i.config.mode, 'advise');
  assert.strictEqual(i.config.classes['1'], 'head');
  assert.deepStrictEqual(i.config.status.strong, [2, 3]);
  assert.strictEqual(i.config.extra, 7);
  assert.strictEqual(i.configErrors.length, 5, i.configErrors.join('; '));
  assert.ok(B.create(null).config && B.create('x').configErrors.length === 0);
});

test('presets: early dips farther, late nearer; mergePartial merges group by group', () => {
  const m = B.mergePartial({ zone: { head_m: 380, tail_m: 190 } }, B.PRESETS.late);
  assert.strictEqual(m.zone.head_m, 300); assert.strictEqual(m.zone.tail_m, 150);
  assert.ok(B.PRESETS.early.zone.head_m > B.DEFAULTS.zone.head_m && B.PRESETS.late.zone.head_m < B.DEFAULTS.zone.head_m);
  const dist = (p) => { const i = high(B.mergePartial({}, p)); let d = null; for (let m2 = 600; m2 >= 100; m2 -= 20) { const o = i.step(fr(10100 + (600 - m2) * 10, { lights: [L(1, 1, m2, 0)] })); if (o.want === 'low') { d = m2; break; } } return d; };
  assert.ok(dist(B.PRESETS.early) > dist(B.PRESETS.normal) && dist(B.PRESETS.normal) > dist(B.PRESETS.late));
});

// ---------------------------------------------------------------- fail-safe inputs
test('fail-safe: no frame, a frame without t, a NaN t: low, nodata, never a throw', () => {
  const i = B.create({});
  [undefined, null, 5, 'x', {}, { t: NaN }, { t: Infinity }, []].forEach((f) => {
    const o = i.step(f);
    assert.strictEqual(o.want, 'low'); assert.strictEqual(o.state, 'UNAVAILABLE'); assert.strictEqual(o.reason, 'nodata');
  });
});

test('fail-safe: an exception inside step gives want low, reason error; guard() catches a throwing instance', () => {
  const i = high();
  const evil = fr(10100);
  Object.defineProperty(evil, 'lights', { get() { throw new Error('boom'); } });
  const o = i.step(evil);
  assert.strictEqual(o.want, 'low'); assert.strictEqual(o.reason, 'error');
  const g = B.guard({ step() { throw new Error('x'); } }, { t: 5 });
  assert.strictEqual(g.want, 'low'); assert.strictEqual(g.reason, 'error'); assert.strictEqual(g.t, 5);
  assert.strictEqual(B.guard({ step() { return { want: 'maybe' }; } }, { t: 5 }).reason, 'error');
  assert.strictEqual(B.failOutput(1, 'nonsense').reason, 'error');
});

test('fail-safe fuzz: 5000 random frames never throw, always answer high or low, and high only with fresh lights, speed, low beam, no fog', () => {
  const r = RNG.create(7);
  const i = B.create({});
  const pick = (a) => a[Math.floor(r.next() * a.length)];
  const vals = [undefined, null, NaN, -1, 0, 1, 2, 3, 7, 15, 126, 127, 255, 1e9, 'x', true, {}, []];
  let t = 0;
  for (let k = 0; k < 5000; k++) {
    t += pick([50, 100, 100, 100, 1000, -2000]);
    const f = fr(t, { speed: pick([80, 80, 25, NaN, 'x', 45]), lux: pick([1, 1, 500, NaN]), fog: r.next() < 0.05, low: r.next() < 0.97 });
    if (r.next() < 0.1) f.lights.age = pick([5000, undefined, -1]);
    if (r.next() < 0.05) delete f.car;
    f.lights.v = [];
    const n = Math.floor(r.next() * 18);
    for (let j = 0; j < n; j++) f.lights.v.push({ id: pick(vals), cls: pick(vals), status: pick(vals), x: pick(vals), y: pick(vals), dist: pick(vals) });
    if (r.next() < 0.05) f.lights.v = pick([null, 'x', {}]);
    const o = i.step(f);
    assert.ok(o.want === 'high' || o.want === 'low');
    if (o.state === 'HIGH') {
      assert.ok(typeof f.car.v.speed_kmh === 'number' && f.car.v.speed_kmh >= 30, 'speed');
      assert.ok(f.lamps.v.low === true && f.lamps.v.fog === false, 'lamps');
      assert.ok(typeof f.lights.age === 'number' && f.lights.age <= 600 && f.lights.age >= 0, 'fresh lights');
    }
  }
});

// ---------------------------------------------------------------- reaching high, preconditions
test('from the start: STANDBY daylight during the darkness hold, DIPPED settle, HIGH at about 9 s', () => {
  const i = B.create({});
  const r = run(i, 0, 10000, (t) => fr(t));
  assert.strictEqual(r.outs[0].state, 'STANDBY'); assert.strictEqual(r.outs[0].reason, 'daylight');
  assert.strictEqual(firstAt(r.outs, (o) => o.reason === 'settle'), 8000);
  assert.strictEqual(firstAt(r.outs, (o) => o.state === 'HIGH'), 9000);
  assert.strictEqual(r.outs.filter((o) => o.switched).length, 1);
});

test('low beam off, or the switch at park: lights_off', () => {
  const i = high();
  assert.strictEqual(i.step(fr(10100, { low: false })).reason, 'lights_off');
  const j = high();
  const f = fr(10100); f.lamps.v.switch = 'park';
  assert.strictEqual(j.step(f).reason, 'lights_off');
});

test('speed hysteresis (HR: BMW 50 on / 38 off): on at 50, kept at 45, off below 38; gear R is slow', () => {
  const i = B.create({});
  assert.strictEqual(run(i, 0, 10000, (t) => fr(t, { speed: 48 })).last.reason, 'slow');
  const j = high();
  assert.strictEqual(run(j, 10100, 12000, (t) => fr(t, { speed: 39 })).last.state, 'HIGH');
  const o = j.step(fr(12100, { speed: 37 }));
  assert.strictEqual(o.state, 'STANDBY'); assert.strictEqual(o.reason, 'slow'); assert.strictEqual(o.want, 'low');
  assert.strictEqual(run(j, 12200, 13000, (t) => fr(t, { speed: 49 })).last.reason, 'slow');
  assert.strictEqual(high().step(fr(10100, { gear: 'R' })).reason, 'slow');
});

test('darkness: light within 2 s, dark again only after 8 s; thresholds 20 / 60 lux with a band between', () => {
  const i = high();
  let r = run(i, 10100, 11900, (t) => fr(t, { lux: 100 }));
  assert.strictEqual(r.last.state, 'HIGH', 'still high before the light hold');
  assert.strictEqual(i.step(fr(12100, { lux: 100 })).reason, 'daylight');
  r = run(i, 12200, 21000, (t) => fr(t, { lux: 40 }));            // in the band: stays light
  assert.strictEqual(r.last.reason, 'daylight');
  r = run(i, 21100, 31000, (t) => fr(t, { lux: 10 }));
  assert.strictEqual(firstAt(r.outs, (o) => o.reason !== 'daylight'), 29100);
});

test('darkness: the sun says day -> never dark (a tunnel by day); without brightness the sun decides; nothing known = light', () => {
  assert.strictEqual(run(B.create({}), 0, 20000, (t) => fr(t, { sun: 'day', lux: 3 })).last.reason, 'daylight');
  assert.strictEqual(run(B.create({}), 0, 10000, (t) => fr(t, { lux: null, sun: 'night' })).last.state, 'HIGH');
  assert.strictEqual(run(B.create({}), 0, 20000, (t) => fr(t, { lux: null, sun: null })).last.reason, 'daylight');
  assert.strictEqual(run(B.create({ dark: { useSun: 'off' } }), 0, 20000, (t) => fr(t, { lux: null, sun: 'night' })).last.reason, 'daylight');
  assert.strictEqual(run(B.create({ dark: { useSun: 'off' } }), 0, 10000, (t) => fr(t, { lux: 2, sun: 'day' })).last.state, 'HIGH');
});

test('town by limit: a limit at or below 60 standing 3 s, or the urban flag at once; it ends 3 s after its evidence', () => {
  const i = high();
  const r0 = run(i, 10100, 14000, (t) => fr(t, { limit: 50 }));
  assert.strictEqual(firstAt(r0.outs, (o) => o.reason === 'town'), 13100);
  assert.strictEqual(r0.last.details.urban.src, 'limit');
  const r = run(i, 14100, 18000, (t) => fr(t, { limit: 90 }));
  assert.strictEqual(firstAt(r.outs, (o) => o.reason !== 'town'), 17000, 'last evidence 14.0 s + 3 s');
  assert.strictEqual(run(high(), 10100, 12000, (t) => fr(t, { limit: t < 11000 ? 50 : 90 })).outs.every((o) => o.reason !== 'town'), true, 'a 1 s misread');
  assert.strictEqual(high().step(fr(10100, { urban: true })).reason, 'town');
  assert.strictEqual(high().step(fr(10100, { limit: 70 })).state, 'HIGH');
});

test('weather: fog lamps at once; wipers at level 3 at once and 20 s after; level 1 and 2 keep high', () => {
  assert.strictEqual(high().step(fr(10100, { fog: true })).reason, 'weather');
  assert.strictEqual(high({ weather: { fog: false } }).step(fr(10100, { fog: true })).state, 'HIGH');
  assert.strictEqual(run(high(), 10100, 12000, (t) => fr(t, { wiper: 2 })).last.state, 'HIGH');
  const i = high();
  assert.strictEqual(i.step(fr(10100, { wiper: 3 })).reason, 'weather');
  const r = run(i, 10200, 32000, (t) => fr(t, { wiper: 1 }));
  assert.strictEqual(firstAt(r.outs, (o) => o.reason !== 'weather'), 30100);
});

// ---------------------------------------------------------------- unavailable
test('stale data: lights older than 600 ms, missing lights, stale car, missing lamps: low at once, nodata', () => {
  [{ lightsAge: 700 }, { no_lights: true }, { no_car: true }, { no_lamps: true }, { speed: NaN }].forEach((x) => {
    const o = high().step(fr(10100, x));
    assert.strictEqual(o.state, 'UNAVAILABLE', JSON.stringify(x)); assert.strictEqual(o.reason, 'nodata'); assert.strictEqual(o.want, 'low');
  });
  const f = fr(10100); f.lights.ok = false;
  assert.strictEqual(high().step(f).reason, 'nodata');
  const g = fr(10100); g.car.age = 5000;
  assert.strictEqual(high().step(g).reason, 'nodata');
  const h = fr(10100); h.lights.age = undefined;
  assert.strictEqual(high().step(h).reason, 'nodata');
});

test('after bad data: 2 s of good data before high again', () => {
  const i = high();
  run(i, 10100, 11000, (t) => fr(t, { lightsAge: 900 }));
  const r = run(i, 11100, 14000, (t) => fr(t));
  assert.strictEqual(r.outs[0].reason, 'settle');
  assert.strictEqual(firstAt(r.outs, (o) => o.state === 'HIGH'), 13100);
});

test('the camera\'s health: verdict qualifier or calibration bad, object list qualifier reduced or unknown -> camera', () => {
  assert.strictEqual(high().step(fr(10100, { verdict: { allow: 1, qualifier: 2, calibration: 0 } })).reason, 'camera');
  assert.strictEqual(high().step(fr(10100, { verdict: { allow: 1, qualifier: 0, calibration: 1 } })).reason, 'camera');
  assert.strictEqual(high().step(fr(10100, { verdict: { allow: 3, qualifier: 15, calibration: 3 } })).state, 'HIGH', 'catalogue defaults alone are not "blind"');
  assert.strictEqual(high().step(fr(10100, { qual: 1 })).reason, 'camera');
  assert.strictEqual(high().step(fr(10100, { qual: 9 })).reason, 'camera');
  assert.strictEqual(high().step(fr(10100, { qual: 0 })).state, 'HIGH');
  const ok = high({ objects: { reducedMeans: 'ok' } }).step(fr(10100, { qual: 1 }));
  assert.strictEqual(ok.state, 'HIGH'); assert.ok(ok.confidence < 0.75);
});

// ---------------------------------------------------------------- dip triggers
test('a strong oncoming light in the zone dips in the same tick, with its id as the cause', () => {
  const o = high().step(fr(10100, { lights: [L(4, 1, 300, -1)] }));
  assert.strictEqual(o.want, 'low'); assert.strictEqual(o.state, 'DIPPED'); assert.strictEqual(o.reason, 'oncoming');
  assert.strictEqual(o.cause.id, 4); assert.strictEqual(o.cause.kind, 'head'); assert.strictEqual(o.cause.src, 'light');
  assert.strictEqual(o.cause.dist_m, 300); assert.ok(Math.abs(o.cause.az_deg + 1) < 0.21);
  assert.strictEqual(o.holdUntil, null); assert.strictEqual(o.switched, true); assert.strictEqual(o.confidence, 1);
});

test('a weak light needs one more consecutive tick; a one-tick ghost never dips', () => {
  const i = high();
  assert.strictEqual(i.step(fr(10100, { lights: [L(4, 1, 300, 0, { status: 1 })] })).want, 'high');
  assert.strictEqual(i.step(fr(10200, { lights: [L(4, 1, 300, 0, { status: 1 })] })).want, 'low');
  const j = high();
  assert.strictEqual(j.step(fr(10100, { lights: [L(9, 0, 100, 3, { status: 1 })] })).want, 'high');
  assert.strictEqual(j.step(fr(10200)).want, 'high');
  const k = high({ confirm: { weakFrames: 0 } });
  assert.strictEqual(k.step(fr(10100, { lights: [L(4, 1, 300, 0, { status: 1 })] })).want, 'low');
  assert.strictEqual(high().step(fr(10100, { lights: [L(4, 1, 300, 0, { status: 5 })] })).want, 'high', 'an unknown status is weak');
});

test('the zone: full length straight ahead, shorter to the sides, nothing beyond 18 deg', () => {
  const dips = (cls, d, az) => high().step(fr(10100, { lights: [L(1, cls, d, az)] })).want === 'low';
  assert.ok(dips(1, 396, 0)); assert.ok(!dips(1, 440, 0));
  assert.ok(dips(1, 200, 10)); assert.ok(!dips(1, 300, 10));
  assert.ok(!dips(1, 20, 20));
  assert.ok(dips(2, 196, 0)); assert.ok(!dips(2, 220, 0));
  assert.ok(dips(5, 96, 0)); assert.ok(!dips(5, 120, 0));
  assert.ok(dips(0, 196, 0)); assert.ok(!dips(0, 240, 0));
});

test('kinds: tail -> preceding, bike -> cyclist, unknown class -> light, reflector ignored (or a light), street lights alone no dip', () => {
  const r = (lights, cfg) => high(cfg).step(fr(10100, { lights: lights })).reason;
  assert.strictEqual(r([L(1, 2, 100, 0)]), 'preceding');
  assert.strictEqual(r([L(1, 5, 50, 0)]), 'cyclist');
  assert.strictEqual(r([L(1, 12, 50, 0)]), 'light');
  assert.strictEqual(r([L(1, 4, 50, 0)]), 'clear');
  assert.strictEqual(r([L(1, 4, 50, 0)], { zone: { reflector: 'other' } }), 'light');
  assert.strictEqual(r([L(1, 3, 50, 0, { y: 80 })]), 'clear');
  assert.strictEqual(r([L(1, 2, 100, 0), L(2, 1, 300, 2)]), 'oncoming', 'precedence: oncoming before preceding');
  const o = high().step(fr(10100, { lights: [L(1, 1, 300, 0), L(2, 1, 150, 2)] }));
  assert.strictEqual(o.cause.id, 2, 'the nearest of the same reason');
});

test('distance: the default 127 means unknown (in the zone unless noDist is out); the top of the scale is far (outside)', () => {
  assert.strictEqual(high().step(fr(10100, { lights: [L(1, 1, 0, 0, { rawDist: 127 })] })).want, 'low');
  assert.strictEqual(high({ zone: { noDist: 'out' } }).step(fr(10100, { lights: [L(1, 1, 0, 0, { rawDist: 127 })] })).want, 'high');
  assert.strictEqual(high({ zone: { head_m: 1000 } }).step(fr(10100, { lights: [L(1, 1, 0, 0, { rawDist: 126 })] })).want, 'high');
});

test('no object: status none, the catalogue default slot, an old slot; garbage objects are skipped', () => {
  const r = (lights) => high().step(fr(10100, { lights: lights })).want;
  assert.strictEqual(r([L(1, 1, 100, 0, { status: 7 })]), 'high');
  assert.strictEqual(r([L(1, 1, 100, 0, { status: 0 })]), 'high');
  assert.strictEqual(r([{ id: 15, cls: 15, status: 2, x: 255, y: 255, dist: 127 }]), 'high');
  assert.strictEqual(r([L(1, 1, 100, 0, { age: 900 })]), 'high');
  assert.strictEqual(r([null, 3, 'x', []]), 'high');
});

test('street lights: three distinct in the window dip; two do not; low lamps are not street lights; the dip ends after the window and 1 s', () => {
  const st = (n, y) => { const a = []; for (let k = 0; k < n; k++) a.push(L(k + 1, 3, 80 + k * 30, 5, { y: y === undefined ? 90 : y })); return a; };
  assert.strictEqual(high().step(fr(10100, { lights: st(2) })).want, 'high');
  assert.strictEqual(high().step(fr(10100, { lights: st(3) })).reason, 'streetlights');
  assert.strictEqual(high().step(fr(10100, { lights: st(3, 140) })).want, 'high');
  const i = high();
  run(i, 10100, 12000, (t) => fr(t, { lights: st(3) }));
  const r = run(i, 12100, 20000, (t) => fr(t));
  // the last sighting (12.0 s) is in the 4 s window up to 16.0 s; then 1 s clear (the minimum dwell has passed)
  assert.strictEqual(firstAt(r.outs, (o) => o.state === 'HIGH'), 17000);
  assert.strictEqual(r.outs[0].reason, 'streetlights'); assert.strictEqual(r.outs[0].confidence, 0.5);
});

// ---------------------------------------------------------------- timers
test('return after an oncoming car: its last sight + 1.5 s, never sooner than 2 s after the dip; holdUntil counts down', () => {
  const i = high();
  run(i, 10100, 15000, (t) => fr(t, { lights: [L(1, 1, 300, 0)] }));
  const r = run(i, 15100, 20000, (t) => fr(t));
  assert.strictEqual(r.outs[0].holdUntil, 16500);
  assert.strictEqual(r.outs[0].reason, 'oncoming'); assert.strictEqual(r.outs[0].cause.id, 1);
  assert.strictEqual(firstAt(r.outs, (o) => o.state === 'HIGH'), 16500);
  const j = high();
  j.step(fr(10100, { lights: [L(1, 1, 300, 0)] }));
  const r2 = run(j, 10200, 14000, (t) => fr(t));
  assert.strictEqual(firstAt(r2.outs, (o) => o.state === 'HIGH'), 12100, 'the minimum dwell after a short sighting');
});

test('return after a vehicle ahead is longer (2.5 s) than after an oncoming one (1.5 s)', () => {
  const back = (cls) => { const i = high(); run(i, 10100, 15000, (t) => fr(t, { lights: [L(1, cls, 100, 0)] })); return firstAt(run(i, 15100, 25000, (t) => fr(t)).outs, (o) => o.state === 'HIGH'); };
  assert.strictEqual(back(1), 16500); assert.strictEqual(back(2), 17500);
});

test('distance hysteresis: a light at 450 m holds a dip but does not start one', () => {
  const i = high();
  assert.strictEqual(i.step(fr(10100, { lights: [L(1, 1, 452, 0)] })).want, 'high');
  i.step(fr(10200, { lights: [L(1, 1, 300, 0)] }));
  const r = run(i, 10300, 15000, (t) => fr(t, { lights: [L(1, 1, 452, 0)] }));
  assert.ok(r.outs.every((o) => o.want === 'low'));
  assert.strictEqual(high({ zone: { returnMargin: 1 } }).step(fr(10100, { lights: [L(1, 1, 452, 0)] })).want, 'high');
});

test('anti-flicker: the second dip within 20 s adds 2 s to the clear time', () => {
  const i = high();
  i.step(fr(10100, { lights: [L(1, 1, 300, 0)] }));
  let r = run(i, 10200, 14000, (t) => fr(t));
  assert.strictEqual(firstAt(r.outs, (o) => o.state === 'HIGH'), 12100);
  i.step(fr(14100, { lights: [L(2, 1, 300, 0)] }));
  r = run(i, 14200, 20000, (t) => fr(t));
  assert.strictEqual(firstAt(r.outs, (o) => o.state === 'HIGH'), 17600, '14.1 + 1.5 + 2.0');
});

test('switching rate: at 10 changes a minute the logic pauses in low for 30 s (reason flicker)', () => {
  const i = high({ timing: { flickerExtra_ms: 0, minLow_ms: 0, clearHead_ms: 0 } });
  let t = 10100;
  for (let k = 0; k < 6; k++) {
    i.step(fr(t, { lights: [L(1, 1, 300, 0)] })); t += 100;
    for (let m = 0; m < 3; m++) { i.step(fr(t)); t += 100; }
  }
  const r = run(i, t, t + 40000, (tt) => fr(tt));
  assert.ok(r.outs.some((o) => o.reason === 'flicker'), 'flicker shown');
  const back = firstAt(r.outs, (o) => o.state === 'HIGH');
  assert.ok(back !== null && back - t >= 29000, 'paused about 30 s: ' + (back - t));
  assert.ok(r.outs.filter((o) => o.switched).length === 1);
});

test('curves: delay mode holds the return for 1.5 s after the curve, never dips; dip mode dips; off ignores', () => {
  const i = high();
  assert.strictEqual(run(i, 10100, 12000, (t) => fr(t, { yaw: 9 })).last.state, 'HIGH');
  i.step(fr(12100, { lights: [L(1, 1, 300, 0)], yaw: 9 }));
  const r = run(i, 12200, 20000, (t) => fr(t, { yaw: t < 16000 ? 9 : 0 }));
  assert.ok(r.outs.some((o) => o.reason === 'curve'));
  assert.strictEqual(firstAt(r.outs, (o) => o.state === 'HIGH'), 17400, 'the last curve tick 15.9 + 1.5');
  assert.strictEqual(high({ curve: { mode: 'dip' } }).step(fr(10100, { yaw: 9 })).reason, 'curve');
  const k = high({ curve: { mode: 'dip' } });
  k.step(fr(10100, { steer: 0, yaw: 0 }));
  const f = fr(10200); f.car.v.steer_deg = 90;
  assert.strictEqual(k.step(f).reason, 'curve', 'the steering angle is a curve too');
  const j = high({ curve: { mode: 'off' } });
  j.step(fr(10100, { lights: [L(1, 1, 300, 0)] }));
  assert.strictEqual(firstAt(run(j, 10200, 14000, (t) => fr(t, { yaw: 20 })).outs, (o) => o.state === 'HIGH'), 12100);
});

// ---------------------------------------------------------------- the camera's verdict
test('the camera\'s verdict: log compares only; follow dips on "no" and on an unknown value; silent changes nothing', () => {
  const o = high().step(fr(10100, { verdict: { allow: 0 } }));
  assert.strictEqual(o.state, 'HIGH'); assert.strictEqual(o.details.verdict.allow, false); assert.strictEqual(o.details.verdict.agrees, false);
  const f = { verdict: { use: 'follow' } };
  assert.strictEqual(high(f).step(fr(10100, { verdict: { allow: 0 } })).reason, 'camera_verdict');
  assert.strictEqual(high(f).step(fr(10100, { verdict: { allow: 3 } })).reason, 'camera_verdict');
  const a = high(f).step(fr(10100, { verdict: { allow: 1 } }));
  assert.strictEqual(a.state, 'HIGH'); assert.strictEqual(a.details.verdict.agrees, true);
  assert.strictEqual(high(f).step(fr(10100)).state, 'HIGH');
  assert.strictEqual(high({ verdict: { use: 'ignore' } }).step(fr(10100, { verdict: { allow: 0 } })).state, 'HIGH');
  const st = fr(10100, { verdict: { allow: 0 } }); st.verdict.age = 5000;
  assert.strictEqual(high(f).step(st).state, 'HIGH', 'a stale verdict is ignored');
});

// ---------------------------------------------------------------- fallback objects
test('fallback object list: used only when the lights are silent; oncoming by relative speed; pedestrians ignored', () => {
  const cfg = { objects: { use: 'fallback' } };
  const i = B.create(cfg);
  const r = run(i, 0, 10000, (t) => fr(t, { no_lights: true, objects: [] }));
  assert.strictEqual(r.last.state, 'HIGH');
  const on = i.step(fr(10100, { no_lights: true, objects: [{ id: 3, cls: 1, x: 100, y: 3, vx: -45 }] }));
  assert.strictEqual(on.reason, 'oncoming'); assert.strictEqual(on.cause.src, 'object');
  const j = B.create(cfg); run(j, 0, 10000, (t) => fr(t, { no_lights: true, objects: [] }));
  assert.strictEqual(j.step(fr(10100, { no_lights: true, objects: [{ id: 3, cls: 1, x: 100, y: -1, vx: -3 }] })).reason, 'preceding');
  const k = B.create(cfg); run(k, 0, 10000, (t) => fr(t, { no_lights: true, objects: [] }));
  assert.strictEqual(k.step(fr(10100, { no_lights: true, objects: [{ id: 3, cls: 5, x: 30, y: 0, vx: -20 }] })).state, 'HIGH');
  assert.strictEqual(run(B.create({}), 0, 10000, (t) => fr(t, { no_lights: true, objects: [] })).last.reason, 'nodata', 'off by default');
});

// ---------------------------------------------------------------- the driver
const auto = () => high({ mode: 'auto' });
const ev = (t, kind) => ({ stalk: [{ t: t, kind: kind }] });

test('override to high: the driver pushes while dipped; OVERRIDE wants high; the driver\'s dip hands control back', () => {
  const i = auto();
  i.step(fr(10100, { lights: [L(1, 1, 300, 0)] }));
  const o = i.step(fr(10200, Object.assign({ lights: [L(1, 1, 300, 0)] }, ev(10200, 'high_on'))));
  assert.strictEqual(o.state, 'OVERRIDE'); assert.strictEqual(o.want, 'high'); assert.strictEqual(o.reason, 'driver'); assert.strictEqual(o.details.override, 'high');
  assert.strictEqual(run(i, 10300, 15000, (t) => fr(t, { lights: [L(1, 1, 300, 0)], speed: 20 })).last.want, 'high', 'the stalk wins, even slow');
  const back = i.step(fr(15100, Object.assign({ lights: [L(1, 1, 300, 0)] }, ev(15100, 'high_off'))));
  assert.strictEqual(back.state, 'DIPPED'); assert.strictEqual(back.reason, 'oncoming');
  const r = run(i, 15200, 20000, (t) => fr(t));
  assert.strictEqual(firstAt(r.outs, (x) => x.state === 'HIGH'), 17100, 'the minimum dwell after the hand-back');
});

test('override to low: the driver dips while high; low until re-armed, the next push, or a context change', () => {
  const i = auto();
  const o = i.step(fr(10100, ev(10100, 'high_off')));
  assert.strictEqual(o.state, 'OVERRIDE'); assert.strictEqual(o.want, 'low');
  assert.strictEqual(run(i, 10200, 60000, (t) => fr(t)).last.state, 'OVERRIDE');
  const r = run(i, 60100, 62000, (t) => fr(t, { rearm: t === 60100 }));
  assert.strictEqual(r.outs[0].reason, 'settle'); assert.strictEqual(r.last.state, 'HIGH');
  const j = auto(); j.step(fr(10100, ev(10100, 'high_off')));
  j.step(fr(10200, { urban: true }));
  assert.strictEqual(run(j, 10300, 30000, (t) => fr(t)).last.state, 'HIGH', 'a town ended the manual low');
  const k = auto(); k.step(fr(10100, ev(10100, 'high_off')));
  assert.strictEqual(k.step(fr(12000, ev(12000, 'high_on'))).details.override, 'high');
  const h = high({ mode: 'auto', override: { lowHold_ms: 5000 } }); h.step(fr(10100, ev(10100, 'high_off')));
  assert.strictEqual(run(h, 10200, 17000, (t) => fr(t)).last.state, 'HIGH');
});

test('a flash is never an override; nor a push and pull within 700 ms; a dip that agrees with the logic is no override', () => {
  const i = auto();
  assert.strictEqual(i.step(fr(10100, ev(10100, 'flash'))).state, 'HIGH');
  i.step(fr(10200, ev(10200, 'high_on')));
  const o = i.step(fr(10500, ev(10500, 'high_off')));
  assert.strictEqual(o.state, 'HIGH', 'push + quick pull = a flash: ' + o.state);
  const j = auto();
  j.step(fr(10100, { lights: [L(1, 1, 300, 0)] }));
  assert.strictEqual(j.step(fr(10200, Object.assign({ lights: [L(1, 1, 300, 0)] }, ev(10200, 'high_off')))).state, 'DIPPED');
});

test('override.resume = rearm: the driver\'s dip after a manual high becomes a manual low', () => {
  const i = high({ mode: 'auto', override: { resume: 'rearm' } });
  i.step(fr(10100, ev(10100, 'high_on')));
  const o = i.step(fr(12000, ev(12000, 'high_off')));
  assert.strictEqual(o.state, 'OVERRIDE'); assert.strictEqual(o.want, 'low');
});

test('stalk events already seen are not applied twice; events without t count once', () => {
  const i = auto();
  i.step(fr(10100, ev(10100, 'high_off')));
  i.step(fr(10200, { rearm: true }));
  assert.notStrictEqual(i.step(fr(10300, ev(10100, 'high_off'))).state, 'OVERRIDE', 'the same event again');
});

test('advise mode: the stalk is a label, never an override; details.driver follows lamps.high', () => {
  const i = high();
  const o = i.step(fr(10100, Object.assign({ high: false }, ev(10100, 'high_off'))));
  assert.strictEqual(o.state, 'HIGH'); assert.strictEqual(o.details.driver, 'low'); assert.strictEqual(o.details.mode, 'advise');
  assert.strictEqual(i.step(fr(10200, { high: true })).details.driver, 'high');
});

// ---------------------------------------------------------------- the output
test('output shape: since holds while state and reason hold; details carry the lights sorted, at most 15', () => {
  const i = high();
  const many = []; for (let k = 0; k < 20; k++) many.push(L(k % 15, 4, 400 - k * 10, 3));
  const a = i.step(fr(10100, { lights: many }));
  const b = i.step(fr(10200, { lights: many }));
  assert.strictEqual(a.since, b.since);
  assert.ok(b.details.lights.length <= 15);
  for (let k = 1; k < b.details.lights.length; k++) assert.ok(b.details.lights[k].dist_m >= b.details.lights[k - 1].dist_m);
  ['t', 'want', 'state', 'reason', 'cause', 'since', 'holdUntil', 'confidence', 'switched', 'details'].forEach((k) => assert.ok(k in b, k));
  ['mode', 'dark', 'speedOk', 'town', 'weather', 'lowBeam', 'curve', 'stale', 'lights', 'counts', 'street', 'switchesPerMin', 'dips', 'override', 'verdict', 'driver']
    .forEach((k) => assert.ok(k in b.details, 'details.' + k));
  assert.strictEqual(b.details.counts.reflector, 20);
});

test('reset(): back to the start; a clock that jumps back more than 1 s starts a new drive', () => {
  const i = high();
  i.reset();
  assert.strictEqual(i.step(fr(10100)).state, 'STANDBY');
  const j = high();
  assert.strictEqual(j.step(fr(500)).state, 'STANDBY');
});

test('pure and deterministic: two instances fed the same frames give the same outputs', () => {
  const make = () => { const i = B.create({ mode: 'auto' }); const out = []; for (let t = 0; t < 30000; t += 100) out.push(i.step(fr(t, { lights: t > 15000 && t < 18000 ? [L(1, 1, 300 - (t - 15000) / 20, -2)] : [] }))); return JSON.stringify(out); };
  assert.strictEqual(make(), make());
});

test('a reused id that jumps in azimuth or distance starts its confirmation over', () => {
  const i = high();
  assert.strictEqual(i.step(fr(10100, { lights: [L(1, 0, 600, -1, { status: 1, rawDist: 126 })] })).want, 'high');
  assert.strictEqual(i.step(fr(10200, { lights: [L(1, 0, 84, 0, { status: 1 })] })).want, 'high', 'a new object under an old id');
  assert.strictEqual(i.step(fr(10300, { lights: [L(1, 0, 84, 0.4, { status: 1 })] })).want, 'low', 'confirmed on the next tick');
  const j = high();
  j.step(fr(10100, { lights: [L(1, 0, 100, -8, { status: 1 })] }));
  assert.strictEqual(j.step(fr(10200, { lights: [L(1, 0, 100, 2, { status: 1 })] })).want, 'high', 'an azimuth jump');
});


// ---------------------------------------------------------------- the built-up area from signs (owner 2026-11-20)
const sign = (t, kind) => ({ t: t, kind: kind });
function frS(t, o, signs) { const f = fr(t, o); if (signs) f.signs = { v: signs, age: 0, ok: true }; return f; }

test('town signs: entry dips at once (source sign); exit ends it at once; town.signs = false ignores them', () => {
  const i = high();
  const o = i.step(frS(10100, {}, [sign(10100, 'town_in')]));
  assert.strictEqual(o.reason, 'town'); assert.strictEqual(o.details.urban.src, 'sign');
  assert.strictEqual(run(i, 10200, 60000, (t) => fr(t, { speed: 50 })).last.reason, 'town', 'no evidence needed while signed in');
  const x = i.step(frS(60100, { speed: 55 }, [sign(60100, 'town_out')]));
  assert.strictEqual(x.details.urban.on, false);
  assert.strictEqual(run(i, 60200, 63000, (t) => fr(t, { speed: 60 })).last.state, 'HIGH');
  assert.strictEqual(high({ town: { signs: false } }).step(frS(10100, {}, [sign(10100, 'town_in')])).state, 'HIGH');
  const j = high(); j.step(frS(10100, {}, [sign(10100, 'town_in')]));
  assert.strictEqual(j.step(frS(10200, {}, [sign(10100, 'town_out')])).reason, 'town', 'an event already seen (same t) is not applied again');
});

test('a missed exit sign: a country limit after the entry ends the town; so does 20 s at 70+ km/h without street lights', () => {
  const i = high(); i.step(frS(10100, { limit: 50 }, [sign(10100, 'town_in')]));
  run(i, 10200, 40000, (t) => fr(t, { limit: 50, speed: 50 }));
  const r = run(i, 40100, 44000, (t) => fr(t, { limit: 90, speed: 60 }));
  assert.strictEqual(r.last.state, 'HIGH');
  const j = high(); j.step(frS(10100, { limit: 50 }, [sign(10100, 'town_in')]));
  run(j, 10200, 40000, (t) => fr(t, { limit: 50, speed: 50 }));
  const r2 = run(j, 40100, 65000, (t) => fr(t, { limit: 50, speed: 85 }));
  const back = firstAt(r2.outs, (o) => o.reason !== 'town');
  assert.strictEqual(back, 60100, 'the speed rule: 20 s at 70+');
  assert.strictEqual(r2.last.state, 'HIGH', 'the stale 50 of the sign recognition does not bring the town back');
  const k = high(); k.step(frS(10100, {}, [sign(10100, 'town_in')]));
  const st = []; for (let n = 0; n < 4; n++) st.push(L(n + 1, 3, 60 + n * 20, 4, { y: 90 }));
  assert.strictEqual(run(k, 10200, 40000, (t) => fr(t, { speed: 85, lights: st })).last.reason, 'town', 'street lights keep a fast town');
});

test('the backstop: a signed-in town with no evidence at all ends after 5 minutes', () => {
  const i = high(); i.step(frS(10100, { speed: 50 }, [sign(10100, 'town_in')]));
  const r = run(i, 10200, 320000, (t) => fr(t, { speed: 50 }));
  assert.strictEqual(firstAt(r.outs, (o) => o.reason !== 'town'), 310100);
});

test('a lit road for 15 s becomes a town (source lights), and ends with the lights', () => {
  const i = high();
  const st = []; for (let n = 0; n < 4; n++) st.push(L(n + 1, 3, 60 + n * 20, 4, { y: 90 }));
  const r = run(i, 10100, 30000, (t) => fr(t, { lights: st }));
  assert.strictEqual(r.outs[0].reason, 'streetlights');
  const tt = firstAt(r.outs, (o) => o.reason === 'town');
  assert.ok(tt >= 25000 && tt <= 25300, 'town after 15 s of lights: ' + tt);
  assert.strictEqual(r.last.details.urban.src, 'lights');
  const r2 = run(i, 30100, 45000, (t) => fr(t));
  assert.strictEqual(r2.last.state, 'HIGH');
});

test('fallback objects: movement status and lamp states (HR §3.2)', () => {
  const cfg = { objects: { use: 'fallback' } };
  const go = (obj) => { const i = B.create(cfg); run(i, 0, 10000, (t) => fr(t, { no_lights: true, objects: [] })); return i.step(fr(10100, { no_lights: true, objects: [obj] })); };
  assert.strictEqual(go({ id: 1, cls: 1, x: 100, y: 3, move: 'oncoming' }).reason, 'oncoming');
  assert.strictEqual(go({ id: 1, cls: 1, x: 100, y: 3, move: 'stopped_oncoming', head: 'on' }).reason, 'oncoming');
  assert.strictEqual(go({ id: 1, cls: 1, x: 100, y: 0, move: 'same' }).reason, 'preceding');
  assert.strictEqual(go({ id: 1, cls: 1, x: 80, y: 5, move: 'stationary' }).state, 'HIGH', 'a parked unlit car');
  assert.strictEqual(go({ id: 1, cls: 1, x: 80, y: 5, move: 'stationary', head: 'on' }).reason, 'oncoming');
  assert.strictEqual(go({ id: 1, cls: 1, x: 80, y: 1, head: 'on' }).reason, 'oncoming');
  assert.strictEqual(go({ id: 1, cls: 9, x: 80, y: 1 }).reason, 'light', 'unknown and unmoving: still a dip');
});

test('the camera\'s weather and range of sight; the car\'s day / night', () => {
  const f = fr(10100); f.env.v.camWeather = 'FOG';
  assert.strictEqual(high().step(f).reason, 'weather');
  const g = fr(10100); g.env.v.sight_m = 50;
  assert.strictEqual(high().step(g).reason, 'weather');
  const h = fr(10100); h.env.v.camWeather = 'RAIN'; h.env.v.sight_m = 150;
  assert.strictEqual(high().step(h).state, 'HIGH');
  assert.strictEqual(run(B.create({}), 0, 20000, (t) => { const x = fr(t, { lux: 3, sun: null }); x.env.v.dayNight = 'day'; return x; }).last.reason, 'daylight');
  assert.strictEqual(run(B.create({}), 0, 10000, (t) => { const x = fr(t, { lux: null, sun: null }); x.env.v.dayNight = 'night'; return x; }).last.state, 'HIGH');
});
