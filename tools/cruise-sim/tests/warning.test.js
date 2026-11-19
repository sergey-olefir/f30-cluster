'use strict';
// SC2: core/warning.js on its own, with analytic cases.
var H = require('./stubs/sc2-harness');
var W = require('../core/warning');
var assert = H.assert; var near = H.near;
var S = H.suite('warning');

function est(gap, vlead) { return { valid: true, stale: false, gap: gap, vlead: vlead, vrel: null }; }

S.test('every SCHEMA entry has key, label, unit, default and a range or options', function () {
  W.SCHEMA.forEach(function (s) {
    assert.ok(s.key && s.label && typeof s.unit === 'string' && s.default !== undefined, s.key);
    assert.ok(s.options || (s.min <= s.default && s.default <= s.max), s.key + ' range');
  });
  var d = W.defaults();
  assert.strictEqual(d.ttcWarn_s, 3); assert.strictEqual(d.d0, 5);
});

S.test('d_needed = d0 + vc^2 / (2|a_min|)', function () {
  near(W.needed(5, 10, -1), 55, 1e-12);
  near(W.needed(5, 10, 1), 55, 1e-12, 'sign of a_min does not matter');
  near(W.needed(5, -3, -1), 5, 1e-12, 'opening: d0');
  near(W.needed(5, 10, -2, 1.0), 5 + 25 + 10, 1e-12, 'with dead time');
});

S.test('d_needed is the closing distance of a car braking at a_min from vc (integrated)', function () {
  var vc = 12, a = 1.5, d0 = 5;
  var gap = W.needed(d0, vc, -a);
  var dt = 1e-4; var v = vc;
  while (v > 0) { gap -= v * dt + 0.5 * -a * dt * dt; v -= a * dt; }   // exact per step for constant decel
  near(gap, d0, 1e-2);
});

S.test('TTC of two constant speeds', function () {
  near(W.ttc(30, 10), 3, 1e-12);
  assert.strictEqual(W.ttc(30, 0), Infinity);
  assert.strictEqual(W.ttc(30, -5), Infinity);
  // integrate two constant speeds: contact after exactly gap / vc
  var gap = 42, vc = 7, t = 0, dt = 1e-3;
  while (gap > 0) { gap -= vc * dt; t += dt; }
  near(t, W.ttc(42, 7), 2e-3);
});

S.test('warns by distance at d < d_needed and not at d > d_needed', function () {
  var w = W.create({});
  // ego 30 m/s, lead 20 m/s, a_min -1: d_needed = 5 + 50 = 55, TTC at 54 m = 5.4 s (> 3)
  var r = w.step({ t: 0, est: est(56, 20), egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, false); near(r.dNeeded, 55, 1e-12); near(r.ttc, 5.6, 1e-12);
  r = w.step({ t: 0.1, est: est(54, 20), egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, true); assert.strictEqual(r.reason, 'distance');
});

S.test('warns by TTC when the cruise could brake hard enough', function () {
  var w = W.create({});
  // a_min -10: d_needed = 5 + 100/20 = 10; TTC at 25 m = 2.5 s < 3
  var r = w.step({ t: 0, est: est(25, 20), egoV: 30, aMin: -10 });
  assert.strictEqual(r.warn, true); assert.strictEqual(r.reason, 'ttc');
  r = W.create({}).step({ t: 0, est: est(31, 20), egoV: 30, aMin: -10 });
  assert.strictEqual(r.warn, false, 'TTC 3.1 s');
  r = W.create({}).step({ t: 0, est: est(20, 10), egoV: 30, aMin: -1 });
  assert.strictEqual(r.reason, 'distance+ttc');
});

S.test('no warning when opening, unless inside d0', function () {
  var w = W.create({});
  var r = w.step({ t: 0, est: est(10, 25), egoV: 20, aMin: -1 });
  assert.strictEqual(r.warn, false); assert.strictEqual(r.ttc, Infinity); near(r.dNeeded, 5, 1e-12);
  r = W.create({}).step({ t: 0, est: est(4, 25), egoV: 20, aMin: -1 });
  assert.strictEqual(r.warn, true); assert.strictEqual(r.reason, 'distance');
});

S.test('off-delay holds the warning for offDelay_s, on-delay waits', function () {
  var w = W.create({ offDelay_s: 1.0 });
  w.step({ t: 0, est: est(20, 10), egoV: 30, aMin: -1 });
  var r = w.step({ t: 0.5, est: est(500, 40), egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, true, 'still on at 0.0 s clear');
  r = w.step({ t: 1.4, est: est(500, 40), egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, true, '0.9 s clear');
  r = w.step({ t: 1.5, est: est(500, 40), egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, false, '1.0 s clear');
  var w2 = W.create({ onDelay_s: 0.3 });
  assert.strictEqual(w2.step({ t: 0, est: est(20, 10), egoV: 30, aMin: -1 }).warn, false);
  assert.strictEqual(w2.step({ t: 0.2, est: est(20, 10), egoV: 30, aMin: -1 }).warn, false);
  assert.strictEqual(w2.step({ t: 0.3, est: est(20, 10), egoV: 30, aMin: -1 }).warn, true);
});

S.test('a stale or blind input while following warns "sensor"; long after the target, it does not', function () {
  var w = W.create({ sensorWarnWindow_s: 5, sensorWarnAfter_s: 1.0 });
  w.step({ t: 0, est: est(60, 30), egoV: 30, aMin: -1 });
  var r = w.step({ t: 1, est: { valid: false, stale: true, sensorFault: true }, egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, false, 'a fault shorter than sensorWarnAfter_s is not a warning');
  r = w.step({ t: 1.9, est: { valid: false, stale: true, sensorFault: true }, egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, false);
  r = w.step({ t: 2.0, est: { valid: false, stale: true, sensorFault: true }, egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, true); assert.strictEqual(r.reason, 'sensor');
  // a fault that clears before sensorWarnAfter_s never warns
  var wq = W.create({ sensorWarnAfter_s: 1.0 });
  wq.step({ t: 0, est: est(60, 30), egoV: 30, aMin: -1 });
  wq.step({ t: 0.1, est: { valid: false, stale: true, sensorFault: true }, egoV: 30, aMin: -1 });
  assert.strictEqual(wq.step({ t: 0.9, est: est(60, 30), egoV: 30, aMin: -1 }).warn, false);
  var w2 = W.create({ sensorWarnWindow_s: 5, offDelay_s: 0, sensorWarnAfter_s: 0 });
  w2.step({ t: 0, est: est(60, 30), egoV: 30, aMin: -1 });
  r = w2.step({ t: 6, est: { valid: false, stale: true, sensorFault: true }, egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, false, 'outside the window');
  var w3 = W.create({ warnOnSensorFault: false, sensorWarnAfter_s: 0 });
  w3.step({ t: 0, est: est(60, 30), egoV: 30, aMin: -1 });
  assert.strictEqual(w3.step({ t: 1, est: { valid: false, stale: true }, egoV: 30, aMin: -1 }).warn, false);
  // a plain "no target" is not a sensor fault
  var w4 = W.create({});
  w4.step({ t: 0, est: est(60, 30), egoV: 30, aMin: -1 });
  assert.strictEqual(w4.step({ t: 1, est: { valid: false, stale: false, sensorFault: false }, egoV: 30, aMin: -1 }).warn, false);
});

S.test('below vMinWarn nothing warns; a_min of zero is floored', function () {
  var r = W.create({}).step({ t: 0, est: est(4, 0), egoV: 2, aMin: -1 });
  assert.strictEqual(r.warn, false);
  r = W.create({}).step({ t: 0, est: est(100, 20), egoV: 21, aMin: 0 });
  near(r.dNeeded, 5 + 1 / (2 * 0.1), 1e-9);
});

S.test('the loop limit: d_needed uses min(|a_min|, aCmdMax) when given', function () {
  // a cruise that brakes at 1.8 m/s^2, a loop whose set speed falls at 3 km/h/s = 0.833 m/s^2
  var r = W.create({}).step({ t: 0, est: est(60, 20), egoV: 30, aMin: -1.8, aCmdMax: 3 / 3.6 });
  near(r.aUsed, 3 / 3.6, 1e-12); near(r.dNeeded, 5 + 100 / (2 * 3 / 3.6), 1e-9); assert.strictEqual(r.warn, true);
  r = W.create({ limitByLoop: false }).step({ t: 0, est: est(60, 20), egoV: 30, aMin: -1.8, aCmdMax: 3 / 3.6 });
  near(r.dNeeded, 5 + 100 / 3.6, 1e-9); assert.strictEqual(r.warn, false);
  r = W.create({}).step({ t: 0, est: est(60, 20), egoV: 30, aMin: -0.7, aCmdMax: 3 / 3.6 });
  near(r.aUsed, 0.7, 1e-12, 'a weaker cruise stays the limit');
  r = W.create({}).step({ t: 0, est: est(60, 20), egoV: 30, aMin: -1.8 });
  near(r.aUsed, 1.8, 1e-12, 'no aCmdMax: the parent formula');
});

S.test('maxClosing: the parent formula without lead braking; the integrated two-car stop with it', function () {
  near(W.maxClosing(30, 20, 1, 0, 0), 50, 1e-9, 'vc^2 / (2 a)');
  near(W.maxClosing(30, 20, 2, 0, 1.5), 15 + 25, 1e-9, 'vc tDead + vc^2 / (2 a)');
  near(W.maxClosing(20, 25, 1, 0, 0), 0, 1e-12, 'opening');
  // integrate: ego 30 m/s slowing at 0.83 after 0.5 s, lead 25 m/s braking at 2 to a stop
  function brute(v, vL, aE, bL, td) {
    var dt = 1e-4, xe = 0, xl = 0, best = 0, ve = v, vl = vL;
    for (var t = 0; t < 80; t += dt) {
      var ae = t < td ? 0 : (ve > 0 ? aE : 0); var al = vl > 0 ? bL : 0;
      xe += ve * dt - ae * dt * dt / 2; xl += vl * dt - al * dt * dt / 2;
      ve = Math.max(0, ve - ae * dt); vl = Math.max(0, vl - al * dt);
      best = Math.max(best, xe - xl);
    }
    return best;
  }
  [[30, 25, 0.83, 2, 0.5], [30, 30, 1.5, 3, 0], [25, 20, 2.8, 1, 1], [33, 15, 1, 4, 0.3], [20, 22, 0.8, 1.5, 0]].forEach(function (c) {
    near(W.maxClosing(c[0], c[1], c[2], c[3], c[4]), brute(c[0], c[1], c[2], c[3], c[4]), 0.02, JSON.stringify(c));
  });
});

S.test('leadBraking "estimate": a braking lead raises d_needed; "ignore" keeps the parent formula', function () {
  var e = { valid: true, stale: false, gap: 60, vlead: 25, vrel: -5, alead: -2 };
  var ign = W.create({}).step({ t: 0, est: e, egoV: 30, aMin: -0.83 });
  near(ign.dNeeded, W.needed(5, 5, 0.83), 1e-9);
  var est2 = W.create({ leadBraking: 'estimate' }).step({ t: 0, est: e, egoV: 30, aMin: -0.83 });
  near(est2.dNeeded, 5 + W.maxClosing(30, 25, 0.83, 2, 0), 1e-9);
  assert.ok(est2.dNeeded > ign.dNeeded + 100, 'much more: ' + est2.dNeeded.toFixed(0) + ' vs ' + ign.dNeeded.toFixed(0));
  assert.strictEqual(est2.warn, true); assert.strictEqual(ign.warn, false);
  var small = W.create({ leadBraking: 'estimate' }).step({ t: 0, est: { valid: true, stale: false, gap: 60, vlead: 25, alead: -0.3 }, egoV: 30, aMin: -0.83 });
  near(small.dNeeded, ign.dNeeded, 1e-9, 'below the threshold a_lead is noise');
});

S.test('pure: the same inputs give the same outputs in two instances', function () {
  var a = W.create({}); var b = W.create({});
  for (var i = 0; i < 50; i++) {
    var inp = { t: i * 0.1, est: est(80 - i, 20 + (i % 7)), egoV: 28, aMin: -1.2 };
    assert.deepStrictEqual(a.step(inp), b.step(inp));
  }
});

S.run();
