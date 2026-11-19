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
  var w = W.create({ sensorWarnWindow_s: 5 });
  w.step({ t: 0, est: est(60, 30), egoV: 30, aMin: -1 });
  var r = w.step({ t: 1, est: { valid: false, stale: true, sensorFault: true }, egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, true); assert.strictEqual(r.reason, 'sensor');
  var w2 = W.create({ sensorWarnWindow_s: 5, offDelay_s: 0 });
  w2.step({ t: 0, est: est(60, 30), egoV: 30, aMin: -1 });
  r = w2.step({ t: 6, est: { valid: false, stale: true, sensorFault: true }, egoV: 30, aMin: -1 });
  assert.strictEqual(r.warn, false, 'outside the window');
  var w3 = W.create({ warnOnSensorFault: false });
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

S.test('pure: the same inputs give the same outputs in two instances', function () {
  var a = W.create({}); var b = W.create({});
  for (var i = 0; i < 50; i++) {
    var inp = { t: i * 0.1, est: est(80 - i, 20 + (i % 7)), egoV: 28, aMin: -1.2 };
    assert.deepStrictEqual(a.step(inp), b.step(inp));
  }
});

S.run();
