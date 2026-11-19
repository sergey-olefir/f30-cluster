'use strict';
const { test, assert, near } = require('./harness');
const sim = require('../core/sim');
const { deps, holdController, scriptController, scriptWarning, noWarning } = require('./stubs/sc2');
const KMH = 1 / 3.6;

function scen(vehicles, events, extra) {
  return Object.assign({ id: 'drv', family: 'T', name: 'driver test', duration: 30, road: { lanes: 2 },
    ego: { v0_kmh: 100, vMax_kmh: 100, lane: 0 }, vehicles: vehicles || [], events: events || [] }, extra || {});
}
// a standing car 250 m ahead, the controller holds 100 km/h, the warning comes on at 3 s
function warned(driver, seed) {
  return sim.run({ seed: seed || 1, duration: 30, scenario: { inline: scen([{ id: 'wall', kind: 'static', x0: 250 }]) }, driver },
    deps({ controller: holdController, warning: scriptWarning(t => t >= 3) }));
}
const ev = (r, kind) => r.events.filter(e => e.kind === kind);

test('driver: late reaction brakes exactly reactionMax_s after the warning; braking builds up over brakeRise_s', () => {
  const r = warned({ reactionCase: 'late', reactionMax_s: 2.5, brakeLevel_ms2: 7, brakeRise_s: 0.3, autoResume: false });
  const react = ev(r, 'driver.react')[0];
  near(react.t, 5.5, 1e-9); assert.strictEqual(react.rt, 2.5); assert.strictEqual(react.brakes, true);
  const i = r.t.findIndex(t => Math.abs(t - 5.65) < 1e-9);
  near(r.series['driver.brake'][i], 3.5, 1e-9, 'half-way up the ramp');
  near(r.series['ego.a'][i], -3.5, 1e-9);
  assert.ok(!ev(r, 'collision').length, 'stopped in time: 250 m - 5.5 s * 27.8 m/s leaves 97 m');
  near(r.series['ego.v'][r.t.length - 1], 0, 1e-9);
});

test('driver: no reaction means the collision happens', () => {
  const r = warned({ reactionCase: 'none' });
  assert.strictEqual(ev(r, 'driver.react').length, 0);
  assert.strictEqual(ev(r, 'collision').length, 1);
  near(ev(r, 'collision')[0].impactSpeed, 100 * KMH, 1e-9);
});

test('driver: the nominal reaction time is drawn per seed within [reactionMin_s, reactionMax_s] around the median', () => {
  const rts = [];
  for (let s = 1; s <= 40; s++) rts.push(ev(warned({ reactionCase: 'nominal', autoResume: false }, s), 'driver.react')[0].rt);
  for (const x of rts) assert.ok(x >= 0.8 && x <= 2.5, 'rt ' + x);
  const sorted = rts.slice().sort((a, b) => a - b);
  near(sorted[20], 1.2, 0.25, 'median');
  assert.ok(new Set(rts).size > 30, 'drawn, not fixed');
  assert.strictEqual(ev(warned({ reactionCase: 'nominal' }, 7), 'driver.react')[0].rt, ev(warned({ reactionCase: 'nominal' }, 7), 'driver.react')[0].rt);
  assert.strictEqual(ev(warned({ reactionCase: 'normal' }, 7), 'driver.react')[0].rt, ev(warned({ reactionCase: 'nominal' }, 7), 'driver.react')[0].rt, "'normal' = 'nominal'");
});

test('driver: brakes only when closing; releases at the lead\'s speed; resumes after resumeDelay_s', () => {
  // the lead slows from 100 to 60 at 3 m/s² at t = 5; the warning is on while the true gap is under 25 m... use time instead
  const r = sim.run({ duration: 40, scenario: { inline: scen([{ id: 'lead', x0: 40, v0_kmh: 100, profile: { type: 'steps', steps: [[5, 60, 3]] } }]) },
    driver: { reactionCase: 'late', reactionMax_s: 1, brakeLevel_ms2: 5, resumeDelay_s: 3, resumeTimeGap_s: 0.5 } },
  deps({ controller: holdController, warning: scriptWarning(t => t >= 5 && t < 6) }));
  const br = ev(r, 'driver.brake');
  near(br[0].t, 6, 1e-9);
  const rel = br.find(e => e.cause === 'release');
  assert.ok(rel, 'released');
  const iRel = r.t.findIndex(t => t >= rel.t - 1e-9);
  assert.ok(r.series['ego.v'][iRel] <= r.series['lead.v'][iRel] + 0.5 + 0.06, 'released near the lead\'s speed');
  const res = ev(r, 'driver.resume')[0];
  assert.ok(res && res.t >= rel.t + 3 - 1e-9, 'resumed after the delay');
  assert.ok(ev(r, 'cruise.state').some(e => e.to === 'active' && e.reason === 'resume'));
  // not closing at the reaction moment: looks, does not brake
  const r2 = sim.run({ duration: 10, scenario: { inline: scen([{ id: 'lead', x0: 40, v0_kmh: 120 }]) }, driver: { reactionCase: 'late' } },
    deps({ controller: holdController, warning: scriptWarning(t => t >= 1) }));
  assert.strictEqual(ev(r2, 'driver.react')[0].brakes, false);
  assert.strictEqual(ev(r2, 'driver.brake').length, 0);
});

test('driver: selfBrakeTTC_s brakes without any warning', () => {
  const r = sim.run({ duration: 20, scenario: { inline: scen([{ id: 'wall', kind: 'static', x0: 150 }]) }, driver: { selfBrakeTTC_s: 5, reactionCase: 'late', reactionMax_s: 1, autoResume: false } },
    deps({ controller: holdController, warning: noWarning }));
  const b = ev(r, 'driver.brake')[0];
  assert.ok(b && b.cause === 'seen');
  assert.ok(!ev(r, 'collision').length);
});

test('driver: scripted maximum, override, cancel and resume reach the cruise', () => {
  const r = sim.run({ duration: 20, scenario: { inline: scen([], [
    { t: 2, kind: 'driverVmax', vMax_kmh: 80 },
    { t: 4, kind: 'driverOverride', accel: 1, duration_s: 2 },
    { t: 8, kind: 'driverCancel' },
    { t: 12, kind: 'driverResume' },
  ]) } }, deps({ controller: scriptController((t, inp) => inp.vDriver), warning: noWarning }));
  const at = (name, t) => r.series[name][r.t.findIndex(x => Math.abs(x - t) < 1e-9)];
  near(at('v.driverMax', 1), 100 * KMH, 1e-12); near(at('v.driverMax', 3), 80 * KMH, 1e-12);
  const st = r.meta.enums['cruise.state'];
  assert.strictEqual(st[at('cruise.state', 5)], 'override');
  assert.strictEqual(st[at('cruise.state', 7)], 'active');
  assert.strictEqual(st[at('cruise.state', 10)], 'suspended');
  assert.strictEqual(st[at('cruise.state', 13)], 'active');
  for (const k of ['driver.vmax', 'driver.override', 'driver.cancel', 'driver.resume']) assert.ok(ev(r, k).length === 1, k);
  near(at('set.held', 19), 80 * KMH, 1e-12);
});

test('driver: follows speed limits when asked, limitDelay_s after the sign', () => {
  const s = scen([], [], { road: { lanes: 2, speedLimit: [[0, 100], [500, 80]] } });
  const r = sim.run({ duration: 30, scenario: { inline: s }, driver: { followLimits: true, limitDelay_s: 2 } }, deps({ controller: holdController, warning: noWarning }));
  const e = ev(r, 'driver.vmax');
  assert.strictEqual(e.length, 1, 'the limit at the start is not a new sign: ' + JSON.stringify(e));
  near(e[0].vMax, 80 * KMH, 1e-12);
  near(e[0].t, 500 / (100 * KMH) + 2, 0.02);
  const r2 = sim.run({ duration: 30, scenario: { inline: s } }, deps({ controller: holdController, warning: noWarning }));
  assert.strictEqual(ev(r2, 'driver.vmax').length, 0);
});

test('driver: below the cruise minimum after braking, the driver accelerates by hand, then resumes', () => {
  const r = sim.run({ duration: 60, scenario: { inline: scen([], [{ t: 1, kind: 'driverBrake', level_ms2: 4, duration_s: 6 }], { ego: { v0_kmh: 60, vMax_kmh: 60 } }) },
    driver: { resumeDelay_s: 2 } }, deps({ controller: holdController, warning: noWarning }));
  assert.ok(Math.min(...r.series['ego.v']) < 30 * KMH, 'went below the minimum');
  assert.ok(Math.max(...r.series['driver.accel']) > 0, 'accelerator by hand');
  const res = ev(r, 'driver.resume')[0];
  assert.ok(res, 'resumed');
  near(r.series['ego.v'][r.t.length - 1], 60 * KMH, 0.5, 'back at the set speed');
});
