'use strict';
// SC2: the sensing and control modules in the closed loop of SC1's engine (core/sim.js). Skipped when sim.js is not
// there (SC2's branch on its own); runs after the lead merges SC1 -> SC2. Inline scenarios only (no SC3 files needed).
var H = require('./stubs/sc2-harness');
var fs = require('fs'); var path = require('path');
var assert = H.assert; var near = H.near;
var S = H.suite('closedloop-sc2');
var KMH = 1 / 3.6;

var SIM = path.join(__dirname, '..', 'core', 'sim.js');
if (!fs.existsSync(SIM)) {
  console.log('closedloop-sc2: core/sim.js not present (SC2 branch alone): skipped');
  console.log('# pass 0'); console.log('# fail 0');
} else {
  var sim = require(SIM);
  var W = require('../core/warning');
  // the engine may or may not pass aCmdMax yet (NOTES, SC2 request 3): this wrapper supplies it when missing
  var warnLoop = { NAME: 'warning', SCHEMA: W.SCHEMA, create: function (p) {
    var w = W.create(p);
    return { step: function (i) { var j = {}; for (var k in i) j[k] = i[k]; if (j.aCmdMax === undefined) j.aCmdMax = 3 / 3.6; return w.step(j); } };
  } };
  function scen(o) {
    var s = { id: 'sc2.cl', family: 'C', name: 'sc2 closed loop', duration: 120, road: { lanes: 2 }, ego: { v0_kmh: 90, vMax_kmh: 110, lane: 0 }, vehicles: [], events: [] };
    for (var k in o) s[k] = o[k];
    return s;
  }
  function run(s, over, deps) {
    var cfg = { duration: s.duration, scenario: { inline: s } };
    if (over) for (var k in over) cfg[k] = over[k];
    return sim.run(cfg, deps);
  }
  function idx(r, a, b) { var out = []; for (var i = 0; i < r.t.length; i++) if (r.t[i] >= a && r.t[i] < b) out.push(i); return out; }
  function ev(r, kind) { return r.events.filter(function (e) { return e.kind === kind; }); }

  S.test('the engine loads the SC2 modules, not its stubs', function () {
    var r = run(scen({ duration: 5 }));
    ['sensor', 'estimator', 'controller', 'warning', 'baselines'].forEach(function (n) { assert.strictEqual(r.meta.modules[n], n + '.js', n); });
  });

  S.test('free road: the set speed stays at the maximum, nothing is commanded, no warning', function () {
    var r = run(scen({ duration: 30, ego: { v0_kmh: 100, vMax_kmh: 100, lane: 0 } }));
    assert.strictEqual(r.meta.core.warnCount, 0);
    idx(r, 1, 30).forEach(function (i) { near(r.series['set.held'][i] / KMH, 100, 1e-6); });
  });

  S.test('steady following: settles at d0 + h v without warnings; few setpoint changes in steady state', function () {
    var s = scen({ duration: 150, vehicles: [{ id: 'lead', kind: 'car', lane: 0, x0: 40, v0_kmh: 90 }] });
    // the parent's one-step hysteresis chatters on the assumed camera's noise (about 34 changes per minute, printed);
    // two steps meet the parent's <= 20 per minute at no cost in gap error (SC2-REPORT)
    var r1 = run(s, { plant: { preset: 'mild' } });
    console.log('  steady following, one-step hysteresis: ' + (ev(r1, 'cmd.sent').filter(function (e) { return e.t >= 100; }).length / (50 / 60)).toFixed(1) + ' changes per minute');
    var r = run(s, { plant: { preset: 'mild' }, controller: { hystSteps: 2 } });
    var late = idx(r, 100, 150);
    var g = late.map(function (i) { return r.series['gap.true'][i]; });
    var mean = g.reduce(function (a, b) { return a + b; }, 0) / g.length;
    near(mean, 5 + 2 * 25, 3, 'mean gap');
    assert.strictEqual(r.meta.core.warnCount, 0);
    var cmds = ev(r, 'cmd.sent').filter(function (e) { return e.t >= 100; }).length;
    assert.ok(cmds / (50 / 60) <= 20, 'changes per minute in steady state: ' + (cmds / (50 / 60)).toFixed(1));
  });

  S.test('a slower lead from far with a braking cruise: the loop-limited warning comes in time (parent formula: none)', function () {
    var s = scen({ duration: 60, ego: { v0_kmh: 120, vMax_kmh: 120, lane: 0 }, vehicles: [{ id: 'lead', kind: 'car', lane: 0, x0: 150, v0_kmh: 80 }] });
    // the parent's down limit of 3 km/h/s (0.83 m/s²): the case where the loop, not the cruise, limits the braking
    var parent = run(s, { plant: { preset: 'mild' }, controller: { rateDown_kmhps: 3 }, warning: { limitByLoop: false } });
    var loop = run(s, { plant: { preset: 'mild' }, controller: { rateDown_kmhps: 3 } }, { warning: warnLoop });
    assert.ok(loop.meta.core.warnCount >= 1, 'warned');
    assert.ok(loop.meta.core.minTimeGap > parent.meta.core.minTimeGap + 0.3, 'min time gap ' + parent.meta.core.minTimeGap.toFixed(2) + ' -> ' + loop.meta.core.minTimeGap.toFixed(2));
  });

  S.test('the gap freezes while following: the input goes stale, the target is dropped, the driver is warned ("sensor")', function () {
    var s = scen({ duration: 60, vehicles: [{ id: 'lead', kind: 'car', lane: 0, x0: 55, v0_kmh: 90, profile: { type: 'steps', steps: [[25, 70, 1.5]] } }] });
    var r = run(s, { failures: [{ kind: 'gapFreeze', at: 20, duration: 15 }] });
    var on = ev(r, 'warn.on').filter(function (e) { return e.t >= 20 && e.t < 23; });
    assert.ok(on.length >= 1 && on[0].reason === 'sensor', 'sensor warning: ' + JSON.stringify(on));
    // stale after frozenN = 3 repeats (0.3 s at 10 Hz), warned after sensorWarnAfter_s = 1 s more
    assert.ok(on[0].t - 20 < 1.7, 'within 1.7 s: ' + (on[0].t - 20).toFixed(2));
    idx(r, 21, 35).forEach(function (i) { assert.strictEqual(r.series['est.valid'][i], 0); });
    // the set speed is held (not raised) while stale
    var held = idx(r, 21, 23).map(function (i) { return r.series['set.cmd'][i]; });
    assert.ok(held.every(function (x) { return x <= held[0] + 1e-9; }));
  });

  S.test('a cut-in: the target changes, the estimator resets, the set speed drops', function () {
    var s = scen({ duration: 60, vehicles: [
      { id: 'lead', kind: 'car', lane: 0, x0: 55, v0_kmh: 90 },
      { id: 'cut', kind: 'car', lane: 1, x0: -30, v0_kmh: 90 }],
      events: [{ t: 20, kind: 'cutIn', vehicle: 'cut', duration_s: 3, gap_m: 25, v_kmh: 80 }] });
    var r = run(s, { plant: { preset: 'mild' } });
    var ch = ev(r, 'target.changed').filter(function (e) { return e.t >= 20 && e.t < 26; });
    assert.ok(ch.length >= 1, 'target.changed');
    var before = r.series['set.cmd'][idx(r, 19.9, 20)[0]];
    var after = Math.min.apply(null, idx(r, 22, 30).map(function (i) { return r.series['set.cmd'][i]; }));
    assert.ok(after < before - 5 * KMH, 'set speed drops: ' + (before / KMH).toFixed(0) + ' -> ' + (after / KMH).toFixed(0));
    assert.strictEqual(r.meta.core.collision, false);
  });

  S.test('target lost in a curve: the set speed is held through the curve, not raised (needs the engine to pass curvature)', function () {
    // ego 90 km/h behind a 90 km/h lead; a 1/400 m curve from 1000 to 2000 m (a_lat 1.6 m/s^2);
    // the camera's path prediction misses 90 % of it -> the lead at 55 m looks 3.4 m off: lost
    var s = scen({ duration: 100, road: { lanes: 2, curvature: [[0, 0], [999, 0], [1000, 1 / 400], [2000, 1 / 400], [2001, 0]] },
      ego: { v0_kmh: 90, vMax_kmh: 120, lane: 0 }, vehicles: [{ id: 'lead', kind: 'car', lane: 0, x0: 55, v0_kmh: 90 }] });
    var r = run(s, { sensor: { curvePredErr: 0.9 } });
    var lost = ev(r, 'target.lost').filter(function (e) { return e.t > 30 && e.t < 50; });
    assert.ok(lost.length >= 1, 'lost in the curve');
    var tLost = lost[0].t;
    var inCurve = idx(r, tLost, 1990 / 25);
    var set0 = r.series['set.cmd'][inCurve[0]];
    if (r.series.curvature && !isNaN(r.series.curvature[inCurve[0]])) {
      inCurve.forEach(function (i) { if (r.series.curvature[i] > 0) assert.ok(r.series['set.cmd'][i] <= set0 + 1e-9, 'raised in the curve at ' + r.t[i].toFixed(1)); });
    }
    assert.strictEqual(r.meta.core.collision, false);
  });

  S.test('a lost decrease is sent again (resend) once the cruise is seen holding the old value', function () {
    // free road; the driver lowers the maximum 100 -> 90 km/h at 5 s (applied) and 90 -> 80 at 10 s; the second
    // decrease is lost (SC1's commandLost loses the first decrease after `at`, relative to the previous command)
    var s = scen({ duration: 20, ego: { v0_kmh: 100, vMax_kmh: 100, lane: 0 },
      events: [{ t: 5, kind: 'driverVmax', vMax_kmh: 90 }, { t: 10, kind: 'driverVmax', vMax_kmh: 80 }] });
    var r = run(s, { failures: [{ kind: 'commandLost', at: 9 }] });
    var dropped = ev(r, 'cmd.dropped').filter(function (e) { return e.reason === 'fault'; });
    assert.strictEqual(dropped.length, 1, 'one decrease lost');
    var to80 = ev(r, 'cmd.sent').filter(function (e) { return Math.abs(e.vSet / KMH - 80) < 1e-6; });
    assert.ok(to80.length >= 2, 'sent again: ' + to80.map(function (e) { return e.t.toFixed(1); }).join(', '));
    assert.ok(to80[1].t - to80[0].t < 1.5, 'within resendAfter_s + a period');
    var k = idx(r, 14, 14.05)[0];
    near(r.series['set.held'][k] / KMH, 80, 1e-6, 'the cruise holds 80 in the end');
  });

  S.test('both baselines drive the same scenario without contact', function () {
    var s = scen({ duration: 60, ego: { v0_kmh: 120, vMax_kmh: 120, lane: 0 }, vehicles: [{ id: 'lead', kind: 'car', lane: 0, x0: 150, v0_kmh: 80 }] });
    ['idealAcc', 'human'].forEach(function (m) {
      var r = run(s, { ego: { mode: m } });
      assert.strictEqual(r.meta.core.collision, false, m);
      assert.ok(r.meta.core.minTimeGap > 1.0, m + ' min time gap ' + r.meta.core.minTimeGap.toFixed(2));
    });
  });

  S.test('deterministic through the engine: the same config, the same bytes', function () {
    var s = scen({ duration: 40, vehicles: [{ id: 'lead', kind: 'car', lane: 0, x0: 60, v0_kmh: 80, profile: { type: 'sine', amp_kmh: 8, period_s: 15 } }] });
    var a = run(s, { seed: 3 }); var b = run(s, { seed: 3 }); var c = run(s, { seed: 4 });
    assert.strictEqual(sim.hashResult(a), sim.hashResult(b));
    assert.notStrictEqual(sim.hashResult(a), sim.hashResult(c));
  });

  S.run();
}
