'use strict';
const { test, assert, near } = require('./harness');
const sim = require('../core/sim');
const { deps, holdController, scriptController, noWarning } = require('./stubs/sc2');
const fs = require('fs'), path = require('path'), vm = require('vm');
const KMH = 1 / 3.6;

const flat = { lanes: 2 };
function scen(vehicles, events, extra) {
  return Object.assign({ id: 'test', family: 'T', name: 'test', duration: 20, road: flat, ego: { v0_kmh: 100, vMax_kmh: 100, lane: 0 },
    vehicles: vehicles || [], events: events || [] }, extra || {});
}

test('sim: TTC of two constant speeds matches gap / closing speed at every sample', () => {
  const r = sim.run({ duration: 15, scenario: { inline: scen([{ id: 'lead', x0: 200, v0_kmh: 80 }]) }, driver: { reactionCase: 'none' } },
    deps({ controller: holdController, warning: noWarning }));
  const dv = 20 * KMH;
  for (let i = 0; i < r.t.length; i++) {
    const g = 200 - dv * r.t[i];
    near(r.series['gap.true'][i], g, 1e-6, 'gap at ' + r.t[i]);
    near(r.series['ttc'][i], g / dv, 1e-6, 'ttc at ' + r.t[i]);
    near(r.series['ego.v'][i], 100 * KMH, 1e-12);
    near(r.series['timegap'][i], g / (100 * KMH), 1e-6);
  }
  near(r.meta.core.minTTC, (200 - dv * 15) / dv, 1e-6);
  near(r.t[r.t.length - 1], 15, 1e-9, 'the state at t = duration is recorded');
});

test('sim: stopping distance of a constant deceleration is v² / 2a', () => {
  const r = sim.run({ duration: 10, scenario: { inline: scen([], [{ t: 1, kind: 'driverBrake', level_ms2: 6, duration_s: 9 }]) }, driver: { autoResume: false } },
    deps({ controller: holdController, warning: noWarning }));
  const i1 = r.t.findIndex(t => Math.abs(t - 1) < 1e-9);
  const x1 = r.series['ego.x'][i1], xEnd = r.series['ego.x'][r.t.length - 1];
  const v = 100 * KMH;
  near(xEnd - x1, v * v / 12, v * 0.01, 'stopping distance');
  assert.strictEqual(r.series['ego.v'][r.t.length - 1], 0);
  assert.ok(r.events.some(e => e.kind === 'cruise.state' && e.to === 'suspended' && e.reason === 'brake'));
});

test('sim: the whole path\'s dead time (command delay + plant dead time) is visible to the sample', () => {
  const r = sim.run({ duration: 5, out: { dt: 0.01 }, scenario: { inline: scen() }, command: { delay_s: 0.2, jitter_s: 0 }, plant: { deadTime_s: 0.5 } },
    deps({ controller: scriptController(t => (t >= 2 - 1e-9 ? 105 * KMH : null)), warning: noWarning }));
  const i = r.series['ego.a'].findIndex(a => a !== 0);
  near(r.t[i], 2.7, 1e-9);
  const sent = r.events.find(e => e.kind === 'cmd.sent'), applied = r.events.find(e => e.kind === 'cmd.applied');
  near(sent.t, 2, 1e-9); near(applied.t, 2.2, 1e-9);
  near(r.series['set.cmd'][r.t.length - 1], 105 * KMH, 1e-12);
  near(r.series['set.held'][r.t.length - 1], 105 * KMH, 1e-12);
});

test('sim: a collision with a standing car ends the run with the impact speed', () => {
  const r = sim.run({ duration: 30, scenario: { inline: scen([{ id: 'wall', kind: 'static', x0: 80 }]) }, driver: { reactionCase: 'none' } },
    deps({ controller: holdController, warning: noWarning }));
  const c = r.events.find(e => e.kind === 'collision');
  assert.ok(c, 'collision event');
  assert.strictEqual(c.with, 'wall');
  near(c.impactSpeed, 100 * KMH, 1e-9);
  near(c.t, 80 / (100 * KMH), 0.011);
  assert.ok(r.meta.core.collision && r.t[r.t.length - 1] < 3);
  assert.strictEqual(r.verdict.pass, false);
});

test('sim: the controller runs at its own rate', () => {
  let calls = 0;
  const counting = { NAME: 'controller', SCHEMA: [], LENIENT: true, create: () => ({ step: () => { calls++; return { vSet: null }; } }) };
  sim.run({ duration: 10, controller: { rateHz: 5 }, scenario: { inline: scen() } }, deps({ controller: counting }));
  assert.strictEqual(calls, 51, 't = 0, 0.2, ..., 10');
  calls = 0;
  sim.run({ duration: 10, controller: { rateHz: 8 }, scenario: { inline: scen() } }, deps({ controller: counting }));
  assert.strictEqual(calls, 81, '8 Hz on the 10 ms grid keeps its mean rate');
});

const busy = {
  duration: 60, seed: 11,
  scenario: { inline: scen([
    { id: 'lead', x0: 60, v0_kmh: 90, profile: { type: 'idm', params: { v0_kmh: 95, noise_ms2: 0.3 } } },
    { id: 'head', x0: 120, v0_kmh: 90, profile: { type: 'sine', amp_kmh: 8, period_s: 15 } },
    { id: 'back', x0: -20, v0_kmh: 100, profile: { type: 'idm', params: { v0_kmh: 130, T_s: 0.9 } } },
    { id: 'cut', lane: 1, x0: 30, v0_kmh: 95 },
  ], [{ t: 20, kind: 'cutIn', vehicle: 'cut', duration_s: 3 }], { duration: 60 }) },
  command: { jitter_s: 0.3, dropProb: 0.05, stallRate_perMin: 3 },
};

test('sim: deterministic — the same config gives the same bytes; another seed does not', () => {
  const a = sim.run(busy, deps()), b = sim.run(JSON.parse(JSON.stringify(busy)), deps());
  assert.strictEqual(sim.hashResult(a), sim.hashResult(b));
  const c = sim.run(Object.assign({}, busy, { seed: 12 }), deps());
  assert.notStrictEqual(sim.hashResult(a), sim.hashResult(c));
  // the exported config reproduces the run
  const again = sim.run(JSON.parse(JSON.stringify(a.meta.config)), deps());
  assert.strictEqual(sim.hashResult(again), sim.hashResult(a));
});

test('sim: createSim stepped in chunks equals run()', () => {
  const s = sim.createSim(busy, deps());
  s.advance(7.33); s.advance(0.01); s.step();
  while (!s.done) s.advance(5);
  assert.strictEqual(sim.hashResult(s.result()), sim.hashResult(sim.run(busy, deps())));
  const st = s.state();
  assert.ok(st.world && st.world.ego && 'est' in st && 'w' in st);
});

test('sim: every series of the contract is present, typed, on the out.dt grid', () => {
  const contract = 'ego.x ego.v ego.a ego.jerk lead.x lead.v lead.a lead.id gap.true vrel.true gap.meas vrel.meas meas.valid est.gap est.vrel est.vlead est.alead est.valid set.cmd set.held v.driverMax d.des d.needed v.ref timegap ttc warn cruise.state driver.brake driver.accel grade follower.gap follower.a'.split(' ');
  const r = sim.run(busy, deps());
  for (const n of contract) { assert.ok(r.series[n] instanceof Float64Array, n); assert.strictEqual(r.series[n].length, r.t.length, n); }
  for (const id of ['lead', 'head', 'back', 'cut']) for (const f of ['x', 'v', 'a', 'lane', 'lat', 'y']) assert.ok(r.series['veh.' + id + '.' + f], id + f);
  near(r.t[1] - r.t[0], 0.05, 1e-12);
  assert.strictEqual(r.t.length, 1201);
  assert.deepStrictEqual(r.meta.enums['cruise.state'], ['off', 'active', 'suspended', 'override', 'dropout']);
  assert.ok(r.meta.enums.id.indexOf('lead') >= 0);
  assert.deepStrictEqual(r.meta.vehicles.map(v => v.id), ['lead', 'head', 'back', 'cut']);
  assert.ok(isFinite(r.series['follower.gap'][10]));
  assert.strictEqual(r.meta.plant.assumed, true);
  const kinds = new Set(r.events.map(e => e.kind));
  for (const k of ['cmd.sent', 'cmd.applied', 'target.acquired', 'vehicle.lane']) assert.ok(kinds.has(k), k);
  for (let i = 1; i < r.events.length; i++) assert.ok(r.events[i].t >= r.events[i - 1].t - 1e-9, 'events in time order');
});

test('sim: the baselines replace the app and the plant', () => {
  for (const mode of ['idealAcc', 'human']) {
    const r = sim.run(Object.assign({}, busy, { ego: { mode } }), deps());
    assert.ok(!r.events.some(e => e.kind === 'cmd.sent'), mode);
    assert.ok(r.series['cruise.state'].every(x => x === 0), mode + ' cruise off');
    assert.ok(r.t.length > 100);
  }
});

test('sim: scenario overrides merge deeply; the built-ins run with whatever modules exist', () => {
  const r = sim.run({ scenario: { id: 'demo.approach', overrides: { ego: { v0_kmh: 90 }, duration: 10 } } }, deps());
  near(r.series['ego.v'][0], 90 * KMH, 1e-12);
  assert.strictEqual(r.meta.duration, 10);
  assert.strictEqual(r.series['v.driverMax'][0], 120 * KMH);
  const d = sim.run({ duration: 5 });
  assert.ok(d.t.length === 101 && d.meta.scenario.id === 'demo.approach');
  assert.throws(() => sim.run({ scenario: { id: 'no.such' } }, deps()), /no.such/);
  assert.throws(() => sim.run({ scenario: { inline: scen() }, plant: { nope: 1 } }, deps()), /unknown setting/);
  assert.throws(() => sim.run({ scenario: { inline: scen() }, command: { nope: 1 } }, deps()), /unknown setting/);
});

test('sim: defaultConfig() and schemas() describe every SC1 module', () => {
  const c = sim.defaultConfig();
  assert.ok(c.plant && c.command && c.driver && c.seed === 1 && c.dt === 0.01);
  const s = sim.schemas();
  for (const n of ['plant', 'command', 'driver']) {
    assert.ok(Array.isArray(s[n]) && s[n].length, n);
    for (const f of s[n]) { assert.ok(f.key && f.label !== undefined && 'unit' in f && 'default' in f && f.group, n + '.' + f.key); }
  }
  sim.run(Object.assign(c, { duration: 3 }));
});

test('sim: the browser path (no require, files loaded as scripts into self.CS) gives the same bytes', () => {
  const dir = path.join(__dirname, '..', 'core');
  // the page loads every core file; here: SC1's files plus whatever SC2 / SC3 files exist
  const ctx = vm.createContext({ self: {}, console, Float64Array, Uint8Array, Math, JSON, Date, Object, Array, String, Number, Error, Set, Map, Infinity, NaN, isFinite });
  // in sim.LOAD_ORDER (what the page uses), then any other core file
  const present = fs.readdirSync(dir).filter(f => /\.js$/.test(f)).map(f => f.replace(/\.js$/, ''));
  const order = sim.LOAD_ORDER.filter(n => present.indexOf(n) >= 0).concat(present.filter(n => sim.LOAD_ORDER.indexOf(n) < 0).sort());
  for (const n of order) vm.runInContext(fs.readFileSync(path.join(dir, n + '.js'), 'utf8'), ctx, { filename: n + '.js' });
  const CS = ctx.self.CS;
  assert.ok(CS.sim && CS.plant && CS.vehicles && CS.rng);
  const cfg = JSON.parse(JSON.stringify(busy));
  const browserRes = CS.sim.run(cfg, Object.assign({}, require('./stubs/sc2').pinned));
  const nodeRes = sim.run(cfg, deps());
  assert.strictEqual(CS.sim.hashResult(browserRes), sim.hashResult(nodeRes));
  // and with whatever real modules exist (SC2's, SC3's once merged), no injection
  const b2 = CS.sim.run(cfg), n2 = sim.run(cfg);
  assert.strictEqual(JSON.stringify(b2.meta.modules), JSON.stringify(n2.meta.modules));
  assert.strictEqual(CS.sim.hashResult(b2), sim.hashResult(n2), 'modules: ' + JSON.stringify(n2.meta.modules));
});

test('sim: speed — an hour of driving runs in seconds', () => {
  const t0 = Date.now();
  const r = sim.run({ duration: 3600, scenario: { inline: Object.assign(scen([{ id: 'lead', x0: 60, v0_kmh: 90, profile: { type: 'sine', amp_kmh: 10, period_s: 30 } }]), { duration: 3600 }) }, out: { dt: 0.5 } }, deps());
  const ms = Date.now() - t0;
  assert.ok(ms < 10000, ms + ' ms');
  assert.strictEqual(r.t.length, 7201);
});
