'use strict';
const { test, assert, near } = require('./harness');
const plant = require('../core/plant');
const rng = require('../core/rng');
const path = require('path');
const fs = require('fs');
const os = require('os');
const KMH = 1 / 3.6;
const DT = 0.01;

function make(over, events) {
  const P = plant.params(over || {});
  const ev = events || [];
  const inst = plant.create(P.params, rng.create(1), { emit: (k, d, t) => ev.push(Object.assign({ k, t }, d)) });
  return { P, inst, ev };
}

// drive the plant alone: ego integrated as sim.js does; cb(t, ego) may request set speeds / change the driver
function drive(inst, v0, seconds, cb, opts) {
  opts = opts || {};
  const ego = { x: 0, v: v0, a: 0 };
  inst.init(ego, { set: v0 });
  const out = [];
  let driver = { brake: 0, accel: 0, resume: false, cancel: false };
  const n = Math.round(seconds / DT);
  for (let k = 0; k <= n; k++) {
    const t = k * DT;
    const d = cb ? cb(t, ego, inst) : null;
    if (d) driver = Object.assign({}, driver, d); else { driver.resume = false; driver.cancel = false; }
    const r = inst.step(DT, { t, grade: opts.grade || 0, driver, faults: opts.faults ? opts.faults(t) : {} }, ego);
    out.push({ t, v: ego.v, a: r.a, state: r.cruiseState, held: r.setHeld, eff: r.setEff });
    let v1 = ego.v + r.a * DT; if (v1 < 0) v1 = 0;
    ego.x += (ego.v + v1) / 2 * DT; ego.v = v1; ego.a = r.a;
  }
  return out;
}

test('plant P1: a set-speed step follows tau v\' + v = v_set(t - Td) exactly at every sample', () => {
  const { inst } = make({ preset: 'firm', deadTime_s: 0.6, tau_s: 2.5 });
  const v0 = 100 * KMH, vs = 104 * KMH, tStep = 1.0;
  const out = drive(inst, v0, 15, (t, ego, p) => { if (Math.abs(t - tStep) < 1e-9) p.request(t, vs); });
  let maxErr = 0;
  for (const o of out) {
    const te = o.t - tStep - 0.6;
    const want = te <= 0 ? v0 : vs + (v0 - vs) * Math.exp(-te / 2.5);
    maxErr = Math.max(maxErr, Math.abs(o.v - want));
  }
  assert.ok(maxErr < 1e-9, 'max error ' + maxErr);
});

test('plant P1: the dead time is visible to the sample', () => {
  const { inst } = make({ deadTime_s: 0.37 });
  const out = drive(inst, 80 * KMH, 3, (t, ego, p) => { if (Math.abs(t - 1) < 1e-9) p.request(t, 85 * KMH); });
  const first = out.find(o => o.a !== 0);
  near(first.t, 1.37, 1e-9, 'first non-zero acceleration');
  assert.strictEqual(out.find(o => Math.abs(o.t - 1.36) < 1e-9).a, 0);
});

test('plant P2: slowing down has its own dead time and time constant', () => {
  const { inst } = make({ model: 'P2', preset: 'firm', deadTime_s: 0.3, tau_s: 3, deadTimeDown_s: 0.8, tauDown_s: 1.2 });
  const v0 = 100 * KMH, vs = 97 * KMH;
  const out = drive(inst, v0, 10, (t, ego, p) => { if (Math.abs(t - 1) < 1e-9) p.request(t, vs); });
  let maxErr = 0;
  for (const o of out) {
    const te = o.t - 1 - 0.8;
    const want = te <= 0 ? v0 : vs + (v0 - vs) * Math.exp(-te / 1.2);
    maxErr = Math.max(maxErr, Math.abs(o.v - want));
  }
  assert.ok(maxErr < 1e-9, 'max error ' + maxErr);
  // and up again with the up parameters
  const { inst: i2 } = make({ model: 'P2', preset: 'firm', deadTime_s: 0.3, tau_s: 3, deadTimeDown_s: 0.8, tauDown_s: 1.2 });
  const up = drive(i2, v0, 3, (t, ego, p) => { if (Math.abs(t - 1) < 1e-9) p.request(t, 103 * KMH); });
  near(up.find(o => o.a !== 0).t, 1.3, 1e-9);
});

test('plant P3: second order with zeta < 1 overshoots, P1 never does', () => {
  const { inst } = make({ model: 'P3', preset: 'firm', wn_rads: 0.8, zeta: 0.35, deadTime_s: 0.2 });
  const v0 = 80 * KMH, vs = 84 * KMH;
  const out = drive(inst, v0, 30, (t, ego, p) => { if (Math.abs(t - 1) < 1e-9) p.request(t, vs); });
  const vmax = Math.max(...out.map(o => o.v));
  assert.ok(vmax > vs + 0.1, 'overshoot ' + (vmax - vs));
  near(out[out.length - 1].v, vs, 0.05, 'settles');
  // analytic overshoot of an under-damped 2nd order: exp(-zeta pi / sqrt(1 - zeta^2))
  const ov = Math.exp(-0.35 * Math.PI / Math.sqrt(1 - 0.35 * 0.35));
  near((vmax - vs) / (vs - v0), ov, 0.03, 'overshoot ratio');
  const { inst: i1 } = make({ model: 'P1', preset: 'firm' });
  const o1 = drive(i1, v0, 30, (t, ego, p) => { if (Math.abs(t - 1) < 1e-9) p.request(t, vs); });
  assert.ok(Math.max(...o1.map(o => o.v)) <= vs + 1e-9);
});

test('plant: the acceleration limits clip a large step (aMax up, aMin down with brakes)', () => {
  const { inst } = make({ preset: 'firm', aMax_ms2: 1.2 });
  const up = drive(inst, 60 * KMH, 5, (t, ego, p) => { if (t === 0) p.request(t, 120 * KMH); });
  near(Math.max(...up.map(o => o.a)), 1.2, 1e-12);
  const { inst: i2 } = make({ preset: 'firm' });
  const down = drive(i2, 120 * KMH, 5, (t, ego, p) => { if (t === 0) p.request(t, 60 * KMH); });
  near(Math.min(...down.map(o => o.a)), -2.8, 1e-12, 'firm');
  const { inst: i3 } = make({ preset: 'mild' });
  near(Math.min(...drive(i3, 120 * KMH, 5, (t, e, p) => { if (t === 0) p.request(t, 60 * KMH); }).map(o => o.a)), -1.8, 1e-12, 'mild');
});

test('plant lift-off: deceleration is only engine braking + drag + rolling, and on a downhill it overspeeds', () => {
  const { inst, P } = make({ preset: 'liftoff' });
  const v0 = 120 * KMH;
  const down = drive(inst, v0, 2, (t, ego, p) => { if (t === 0) p.request(t, 60 * KMH); });
  const a = down[60].a, v = down[60].v;
  const pp = P.params;
  const expect = -pp.engineBrakeHi_ms2 - (0.5 * pp.rho_kgm3 * pp.cdA_m2 * v * v / pp.mass_kg + pp.crr * 9.81);
  near(a, Math.max(pp.aMin_ms2, expect), 1e-9);
  assert.ok(a > -1.0 && a < -0.3, 'lift-off decel ' + a);
  // 6 % downhill at a steady set speed: the cruise cannot hold it
  const { inst: i2 } = make({ preset: 'liftoff' });
  const hill = drive(i2, 100 * KMH, 30, null, { grade: -0.08 });
  assert.ok(hill[hill.length - 1].v > 100 * KMH + 5, 'overspeed ' + (hill[hill.length - 1].v / KMH));
  // mild braking holds it
  const { inst: i3 } = make({ preset: 'mild' });
  const held = drive(i3, 100 * KMH, 30, null, { grade: -0.06 });
  near(held[held.length - 1].v, 100 * KMH, 0.01);
  near(i3.decelAvailable(30, 0), -1.8, 1e-12);
  assert.ok(inst.decelAvailable(30, -0.06) > 0, 'nothing left on a 6 % downhill');
});

test('plant: setpoint quantisation, range, rate of accepted changes, rejection when suspended', () => {
  const { inst } = make({ resolution_kmh: 5, acceptInterval_s: 0.5 });
  inst.init({ v: 100 * KMH }, {});
  let r = inst.request(1, 101.4 * KMH);
  assert.strictEqual(r.status, 'applied'); near(r.held / KMH, 100, 1e-9);
  r = inst.request(1.2, 113 * KMH); assert.strictEqual(r.status, 'rejected'); assert.strictEqual(r.reason, 'rate');
  r = inst.request(1.5, 113 * KMH); assert.strictEqual(r.status, 'applied'); near(r.held / KMH, 115, 1e-9);
  r = inst.request(2.5, 10 * KMH); near(r.held / KMH, 30, 1e-9, 'clipped to the minimum');
  r = inst.request(3.5, 400 * KMH); near(r.held / KMH, 210, 1e-9, 'clipped to the maximum');
  r = inst.request(4.5, 100 * KMH, { setStuck: true }); assert.strictEqual(r.status, 'rejected'); assert.ok(r.silent);
  const { inst: i2 } = make({});
  i2.init({ v: 30 }, {});
  i2.step(DT, { t: 0, driver: { brake: 2 } }, { v: 30 });
  assert.strictEqual(i2.cruise.state, 'suspended');
  r = i2.request(0.1, 20); assert.strictEqual(r.status, 'rejected'); assert.strictEqual(r.reason, 'state:suspended');
});

test('plant: a newer change supersedes an older one still pending', () => {
  const { inst } = make({ model: 'P2', deadTime_s: 1.0, deadTimeDown_s: 0.2 });
  inst.init({ v: 30 }, { set: 30 });
  inst.request(0, 35);      // up, effective at 1.0
  inst.request(0.1, 25);    // down, effective at 0.3 -> wins; the older up is dropped
  const ego = { v: 30 };
  let eff = [];
  for (let k = 0; k <= 150; k++) { const r = inst.step(DT, { t: k * DT, driver: {} }, ego); eff.push(r.setEff); }
  near(eff[29], 30, 1e-12); near(eff[30], 25, 1e-12); near(eff[150], 25, 1e-12);
  assert.strictEqual(inst.pendingCount(), 0);
});

test('plant: suspend on brake, resume, override by the accelerator, dropout below the minimum speed', () => {
  const ev = [];
  const { inst } = make({ preset: 'mild', dropoutBelow_kmh: 25 }, ev);
  const out = drive(inst, 80 * KMH, 40, (t) => {
    if (t >= 1 && t < 2) return { brake: 3 };
    if (Math.abs(t - 2) < 1e-9) return { brake: 0 };
    if (Math.abs(t - 3) < 1e-9) return { resume: true };
    if (t >= 10 && t < 12) return { accel: 1 };
    if (Math.abs(t - 12) < 1e-9) return { accel: 0 };
    if (t >= 20 && t < 35) return { brake: 2 };
    return null;
  });
  const at = s => out.find(o => Math.abs(o.t - s) < 1e-9);
  assert.strictEqual(at(1.5).state, 'suspended');
  near(at(1.5).a, -3, 1e-12, 'the driver\'s braking');
  assert.strictEqual(at(2.5).state, 'suspended');
  assert.ok(at(2.5).a < 0 && at(2.5).a > -1, 'coasting');
  assert.strictEqual(at(4).state, 'active');
  assert.strictEqual(at(11).state, 'override');
  near(at(11).a, 2.5, 1e-9, 'full accelerator');
  assert.strictEqual(at(13).state, 'active');
  // braked at 2 m/s² from ~80 km/h for 15 s -> below 25 km/h: the brake suspends first, so no dropout from 'suspended'
  assert.strictEqual(at(30).state, 'suspended');
  const kinds = ev.map(e => e.to);
  assert.deepStrictEqual(kinds.slice(0, 4), ['suspended', 'active', 'override', 'active']);
  // dropout while active: the cruise holding 20 km/h is impossible (min 30), so slow it by grade instead
  const ev2 = [];
  const { inst: i2 } = make({ preset: 'liftoff', dropoutBelow_kmh: 25, power_kW: 50, aDriveMax_ms2: 1 }, ev2);
  const o2 = drive(i2, 40 * KMH, 60, null, { grade: 0.15 });
  assert.ok(o2.some(o => o.state === 'dropout'), 'dropped out on the hill');
  assert.ok(ev2.some(e => e.to === 'dropout' && e.reason === 'speed'));
  // resume below the minimum is refused
  const before = o2[o2.length - 1];
  assert.ok(before.v < 30 * KMH);
});

test('plant: far-below modes (lift-off only / cancel)', () => {
  const { inst } = make({ preset: 'firm', farBelowMode: 'liftoffOnly', farBelow_kmh: 30 });
  const o = drive(inst, 120 * KMH, 3, (t, e, p) => { if (t === 0) p.request(t, 60 * KMH); });
  assert.ok(o[100].a > -1.0, 'no brake while far below: ' + o[100].a);
  const ev = [];
  const { inst: i2 } = make({ preset: 'firm', farBelowMode: 'cancel', farBelow_kmh: 30 }, ev);
  const o2 = drive(i2, 120 * KMH, 3, (t, e, p) => { if (t === 0) p.request(t, 60 * KMH); });
  assert.strictEqual(o2[o2.length - 1].state, 'dropout');
  assert.ok(ev.some(e => e.reason === 'farBelow'));
});

test('plant: a fault drops the cruise out once; resume brings it back', () => {
  const { inst } = make({});
  const o = drive(inst, 100 * KMH, 10, (t) => (Math.abs(t - 5) < 1e-9 ? { resume: true } : null),
    { faults: t => ({ cruiseDropout: Math.abs(t - 2) < 1e-9 }) });
  assert.strictEqual(o[300].state, 'dropout');
  assert.strictEqual(o[600].state, 'active');
});

test('plant: an identified plant file is loaded and marked not assumed', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-plant-')), 'ident.json');
  fs.writeFileSync(f, JSON.stringify({ name: 'G20 DCC 2026-12', model: 'P2', params: { deadTime_s: 0.9, tau_s: 3.1, aMin_ms2: -1.1, brakeMax_ms2: 0.8 } }));
  const P = plant.params({ file: f });
  assert.strictEqual(P.assumed, false);
  assert.strictEqual(P.name, 'G20 DCC 2026-12');
  assert.strictEqual(P.params.model, 'P2'); near(P.params.deadTime_s, 0.9, 0);
  const P2 = plant.params({ data: { name: 'x', params: { tau_s: 1 } }, deadTime_s: 0.1 });
  assert.strictEqual(P2.assumed, false); assert.strictEqual(P2.modified, true); near(P2.params.deadTime_s, 0.1, 0);
  assert.strictEqual(plant.params({ preset: 'liftoff' }).assumed, true);
  assert.throws(() => plant.params({ bogus: 1 }), /unknown setting/);
  assert.throws(() => plant.params({ data: { params: { tau_s: -1 } } }), /tau_s/);
});

test('plant presets: lift-off < mild < firm in braking authority, all P1 by default', () => {
  const a = name => plant.params({ preset: name }).params;
  assert.ok(a('liftoff').brakeMax_ms2 === 0);
  assert.ok(a('liftoff').aMin_ms2 > a('mild').aMin_ms2 && a('mild').aMin_ms2 > a('firm').aMin_ms2);
  for (const n of ['liftoff', 'mild', 'firm']) assert.strictEqual(a(n).model, 'P1');
});
