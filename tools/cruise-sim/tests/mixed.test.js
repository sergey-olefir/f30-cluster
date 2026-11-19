'use strict';
// SC3: core/mixed.js (family L).
const { test, assert, near } = require('./harness');
const mixed = require('../core/mixed');
const sc = require('../core/scenario');

test('every source scenario of the rate tables exists; every road type has following and free filler', () => {
  const ids = sc.list().map(e => e.id);
  Object.keys(mixed.RATES).forEach(road => {
    const R = mixed.RATES[road];
    assert.ok(ids.indexOf(R.follow) >= 0 && ids.indexOf(R.free) >= 0, road);
    R.events.forEach(e => { assert.ok(ids.indexOf(e.id) >= 0, road + ': ' + e.id); assert.ok(e.perHour > 0); });
  });
});

test('generation is deterministic for a seed and changes with it', () => {
  const s = sc.template('L.motorway');
  const a = mixed.generate(s), b = mixed.generate(s);
  assert.deepStrictEqual(a.map(c => c.id + ':' + c.mixed.weight), b.map(c => c.id + ':' + c.mixed.weight));
  const s2 = JSON.parse(JSON.stringify(s)); s2.generator.seed = 2;
  const c = mixed.generate(s2);
  assert.notDeepStrictEqual(a.map(x => x.mixed.weight), c.map(x => x.mixed.weight));
});

test('filler weights fill exactly the time the events leave; events scale with density', () => {
  const base = sc.template('L.rural');
  function gen(d) { const s = JSON.parse(JSON.stringify(base)); s.generator.density = d; return mixed.generate(s); }
  const eps = gen('mid');
  const evSec = eps.filter(c => c.mixed.kind === 'event').reduce((a, c) => a + c.mixed.weight * c.duration, 0);
  const fill = eps.filter(c => c.mixed.kind !== 'event').reduce((a, c) => a + c.mixed.weight * c.duration, 0);
  near(fill, Math.max(0, 10 * 3600 - evSec), 1e-6);
  const nEv = d => gen(d).filter(c => c.mixed.kind === 'event').reduce((a, c) => a + c.mixed.weight, 0);
  const lo = nEv('low'), mid = nEv('mid'), hi = nEv('high');
  assert.ok(lo < mid && mid < hi, lo + ' ' + mid + ' ' + hi);
  near(hi / lo, 1.8 / 0.5, 1.2);
});

test('episodes stay in their road\'s speed band and use the react case when the scenario has one', () => {
  const eps = sc.expand('L.motorway');
  eps.filter(c => c.mixed.kind === 'event' && c.mixed.source === 'D.brake.hard').forEach(c => assert.strictEqual(c.reaction, 'react'));
  eps.filter(c => c.mixed.source === 'D.brake').forEach(c => { assert.strictEqual(c.reaction, 'none'); assert.ok(c.params.v >= 100 && c.params.v <= 150, c.id); });
  eps.forEach(c => assert.ok(!c.variant['cond.sensing'] || c.variant['cond.sensing'] === 'clear', c.id));
});

test('aggregate: per hour of the configured drive; a warning on a no-reaction run is one intervention', () => {
  const mk = (id, kind, w, dur, reaction, m) => ({ concrete: { id, reaction, duration: dur, mixed: { L: 'L.x', road: 'motorway', kind, weight: w, source: id, hoursTotal: 2 } }, metrics: m });
  const a = mixed.aggregate([
    mk('ev1', 'event', 3, 60, 'none', { warnCount: 1, nuisanceWarnings: 1, setpointChangesAvgPerMin: 10 }),
    mk('ev2', 'event', 1, 60, 'react', { warnCount: 2, driverInterventions: 1, collision: false, setpointChangesAvgPerMin: 10 }),
    mk('fill', 'follow', 23, 300, 'none', { warnCount: 0, setpointChangesAvgPerMin: 10 })
  ]);
  assert.strictEqual(a.hours, 2);
  near(a.warningsPerHour, (3 + 2) / 2, 1e-12);
  near(a.interventionsPerHour, (3 + 1) / 2, 1e-12);
  near(a.nuisancePerHour, 3 / 2, 1e-12);
  assert.strictEqual(a.topContributors[0].id, 'ev1');
  assert.ok(a.byRoad.motorway.hours > 0);
});

test('poisson draws have the right mean', () => {
  const r = mixed._rng(5);
  [0.3, 4, 60].forEach(l => {
    let s = 0; const n = 4000;
    for (let i = 0; i < n; i++) s += mixed._poisson(r, l);
    near(s / n, l, Math.max(0.05, 0.05 * l));
  });
});
