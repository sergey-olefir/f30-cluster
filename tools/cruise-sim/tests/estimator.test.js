'use strict';
// SC2: core/estimator.js on its own: analytic cases, then a characterisation against the camera model
// (Phase 3 exit criterion: v_rel noise < ~0.3 m/s at steady following, added delay < ~0.3 s).
var H = require('./stubs/sc2-harness');
var E = require('../core/estimator');
var assert = H.assert; var near = H.near;
var S = H.suite('estimator');

var seq = 0;
function msg(t, gap, vrel, id, extra) {
  var m = { t: t, tMeas: t, seq: ++seq, valid: true, id: id === undefined ? 1 : id, gap: gap, vrel: vrel === undefined ? null : vrel, qual: 'ok' };
  if (extra) for (var k in extra) m[k] = extra[k];
  return m;
}
var MODES = ['kalman', 'kalmanCA', 'alphaBeta'];

// a lead at constant relative speed, sampled at 10 Hz, no noise; returns the last estimate
function constVrel(mode, vrel, useVrel, secs, egoA) {
  var e = E.create({ mode: mode, useVrel: useVrel });
  var r; var gap = 80; var vr = vrel;
  for (var i = 0; i <= secs * 10; i++) {
    var t = i * 0.1;
    r = e.update(msg(t, gap, useVrel ? vr : null), t, { egoV: 25, egoA: egoA || 0 });
    gap += vr * 0.1 - (egoA || 0) * 0.005; vr -= (egoA || 0) * 0.1;
  }
  return { r: r, vr: vr - (egoA || 0) * 0 };
}

S.test('SCHEMA entries have units, defaults and ranges or options', function () {
  E.SCHEMA.forEach(function (s) {
    assert.ok(s.key && s.label && typeof s.unit === 'string' && s.default !== undefined, s.key);
    assert.ok(s.options || (s.min <= s.default && s.default <= s.max), s.key + ' range');
  });
});

S.test('constant relative speed, gap only: every filter converges to the true v_rel', function () {
  MODES.forEach(function (m) {
    var o = constVrel(m, -2, false, 20);
    near(o.r.vrel, -2, 0.02, m);
    assert.strictEqual(o.r.valid, true); assert.strictEqual(o.r.settled, true);
  });
  var raw = constVrel('raw', -2, false, 3);
  near(raw.r.vrel, -2, 1e-9, 'raw = two-point difference');
});

S.test('alpha-beta warm-up: exact two-point v_rel on the second sample', function () {
  var e = E.create({ mode: 'alphaBeta', useVrel: false });
  e.update(msg(0, 50), 0, { egoV: 20 });
  var r = e.update(msg(0.1, 49.7), 0.1, { egoV: 20 });
  near(r.vrel, -3, 1e-9); near(r.gap, 49.7, 1e-9); assert.strictEqual(r.settled, false);
});

S.test('our acceleration is an input: the lead at constant speed while we accelerate at 1 m/s^2', function () {
  MODES.forEach(function (m) {
    var e = E.create({ mode: m, useVrel: false });
    var r; var gap = 60; var vrel = 0;
    for (var i = 0; i <= 200; i++) {
      var t = i * 0.1;
      r = e.update(msg(t, gap, null), t, { egoV: 20 + t, egoA: 1 });
      gap += vrel * 0.1 - 0.5 * 0.01; vrel -= 0.1;
    }
    near(r.vrel, vrel + 0.1, 0.05, m);    // the estimate is at the last sample time (vrel was decremented after it)
    near(r.vlead, 20 + 20 + r.vrel, 1e-9, m + ' v_lead = v + v_rel');
  });
});

S.test('the lead decelerating: a_lead estimate approaches the true -2 m/s^2', function () {
  ['kalman', 'kalmanCA', 'alphaBeta'].forEach(function (m) {
    // kalmanCA's Singer model pulls a_lead toward 0 with aleadTau_s: a steady bias under constant braking
    // (-1.62 at the default 2 s after 6 s of braking); with a long time constant it converges.
    var e = E.create({ mode: m, useVrel: true, aleadTau_s: m === 'kalmanCA' ? 20 : 2 });
    var r; var gap = 60; var vl = 30;
    for (var i = 0; i <= 80; i++) {
      var t = i * 0.1;
      r = e.update(msg(t, gap, vl - 30), t, { egoV: 30, egoA: 0 });
      gap += (vl - 30) * 0.1 - 0.01; vl -= 0.2;
    }
    near(r.alead, -2, 0.35, m);
  });
});

S.test('prediction to now compensates the message latency', function () {
  var e = E.create({ mode: 'alphaBeta', useVrel: true });
  var r;
  for (var i = 0; i <= 30; i++) {
    var tm = i * 0.1;   // measured at tm, delivered and used at tm + 0.25
    var m = msg(tm + 0.25, 50 - 2 * tm, -2); m.tMeas = tm;
    r = e.update(m, tm + 0.25, { egoV: 20 });
  }
  near(r.gap, 50 - 2 * 3.25, 1e-6); near(r.age, 0.25, 1e-9);
  var e2 = E.create({ mode: 'alphaBeta', useVrel: true, predictToNow: false });
  for (i = 0; i <= 30; i++) { tm = i * 0.1; m = msg(tm + 0.25, 50 - 2 * tm, -2); m.tMeas = tm; r = e2.update(m, tm + 0.25, { egoV: 20 }); }
  near(r.gap, 50 - 2 * 3.0, 1e-6, 'without prediction the estimate lags by the latency');
  // no own timestamp: the assumed latency is used
  var e3 = E.create({ mode: 'alphaBeta', useVrel: true, latencyComp_s: 0.25 });
  for (i = 0; i <= 30; i++) { tm = i * 0.1; m = msg(tm + 0.25, 50 - 2 * tm, -2); m.tMeas = null; r = e3.update(m, tm + 0.25, { egoV: 20 }); }
  near(r.gap, 50 - 2 * 3.25, 1e-6);
});

S.test('a target id change re-initialises at once', function () {
  MODES.concat(['raw']).forEach(function (mode) {
    var e = E.create({ mode: mode });
    for (var i = 0; i < 20; i++) e.update(msg(i * 0.1, 60, 0, 7), i * 0.1, { egoV: 25 });
    var r = e.update(msg(2.0, 25, -5, 8), 2.0, { egoV: 25 });
    assert.strictEqual(r.reset, true, mode); assert.strictEqual(r.resetReason, 'id', mode);
    near(r.gap, 25, 1e-9, mode); near(r.vrel, -5, 1e-9, mode); assert.strictEqual(r.id, 8);
  });
});

S.test('one outlier is skipped; two consistent jumps are a target change (hysteresis)', function () {
  MODES.forEach(function (mode) {
    var e = E.create({ mode: mode, useId: false });
    for (var i = 0; i < 30; i++) e.update(msg(i * 0.1, 60, 0), i * 0.1, { egoV: 25 });
    var r = e.update(msg(3.0, 90, 0), 3.0, { egoV: 25 });
    assert.strictEqual(r.reset, false, mode + ' outlier'); near(r.gap, 60, 0.01, mode + ' outlier ignored');
    r = e.update(msg(3.1, 60, 0), 3.1, { egoV: 25 });
    near(r.gap, 60, 0.01);
    // a cut-in: the gap jumps to 30 m and stays
    r = e.update(msg(3.2, 30, 0), 3.2, { egoV: 25 });
    assert.strictEqual(r.reset, false, 'first jump only gated');
    r = e.update(msg(3.3, 30, 0), 3.3, { egoV: 25 });
    assert.strictEqual(r.reset, true, mode + ' confirmed'); assert.strictEqual(r.resetReason, 'jump'); near(r.gap, 30, 1e-9);
    // two inconsistent jumps (outliers at 90 and 20) do not reset
    var e2 = E.create({ mode: mode, useId: false });
    for (i = 0; i < 30; i++) e2.update(msg(i * 0.1, 60, 0), i * 0.1, { egoV: 25 });
    e2.update(msg(3.0, 90, 0), 3.0, { egoV: 25 });
    r = e2.update(msg(3.1, 20, 0), 3.1, { egoV: 25 });
    assert.strictEqual(r.reset, false); near(r.gap, 60, 0.05);
  });
});

S.test('coasting through invalid messages, then loss after coast_s', function () {
  var e = E.create({ coast_s: 0.6 });
  for (var i = 0; i <= 20; i++) e.update(msg(i * 0.1, 50 - 0.1 * i, -1), i * 0.1, { egoV: 25 });
  var r;
  for (i = 1; i <= 6; i++) {
    var t = 2 + i * 0.1;
    r = e.update({ t: t, tMeas: t, seq: ++seq, valid: false, id: null, gap: null, vrel: null, qual: 'none' }, t, { egoV: 25 });
    assert.strictEqual(r.valid, true, 'coasting at ' + t); assert.strictEqual(r.stale, false);
    if (i >= 2) assert.strictEqual(r.coasting, true);
  }
  near(r.gap, 48 - 0.6, 1e-6, 'predicted while coasting');
  r = e.update({ t: 2.7, tMeas: 2.7, seq: ++seq, valid: false, gap: null, qual: 'none' }, 2.7, { egoV: 25 });
  assert.strictEqual(r.valid, false); assert.strictEqual(r.reason, 'none'); assert.strictEqual(r.sensorFault, false);
});

S.test('silence: stale after staleAfter_s, with the reason "silent"', function () {
  var e = E.create({ staleAfter_s: 0.5, coast_s: 2 });
  for (var i = 0; i <= 10; i++) e.update(msg(i * 0.1, 50, 0), i * 0.1, { egoV: 25 });
  var r = e.update(null, 1.4, { egoV: 25 });
  assert.strictEqual(r.valid, true); assert.strictEqual(r.stale, false);
  r = e.update(null, 1.6, { egoV: 25 });
  assert.strictEqual(r.valid, false); assert.strictEqual(r.stale, true); assert.strictEqual(r.reason, 'silent'); assert.strictEqual(r.sensorFault, true);
  // before any message at all
  r = E.create({}).update(null, 0.6, { egoV: 25 });
  assert.strictEqual(r.stale, false, 'first call starts the clock');
});

S.test('frozen: a repeated sequence number, or identical values, make the input stale', function () {
  var e = E.create({ frozenN: 3 });
  for (var i = 0; i <= 10; i++) e.update(msg(i * 0.1, 50 + 0.13 * Math.sin(i), 0.02 * i), i * 0.1, { egoV: 25 });
  var last = msg(1.1, 51, 0.3);
  e.update(last, 1.1, { egoV: 25 });
  var r;
  for (i = 1; i <= 3; i++) { var rep = {}; for (var k in last) rep[k] = last[k]; rep.t = 1.1 + 0.1 * i; r = e.update(rep, rep.t, { egoV: 25 }); }
  assert.strictEqual(r.stale, true); assert.strictEqual(r.reason, 'frozen'); assert.strictEqual(r.valid, false);
  // new sequence numbers but identical values (a frozen payload)
  var e2 = E.create({ frozenSameN: 10 });
  for (i = 0; i <= 10; i++) e2.update(msg(i * 0.1, 50 + 0.13 * Math.sin(i), 0.1), i * 0.1, { egoV: 25 });
  for (i = 11; i <= 21; i++) r = e2.update(msg(i * 0.1, 47.3, -0.4), i * 0.1, { egoV: 25 });
  assert.strictEqual(r.stale, true); assert.strictEqual(r.reason, 'frozen');
  // fresh, varying values again: recovers
  for (i = 22; i <= 25; i++) r = e2.update(msg(i * 0.1, 47 + 0.1 * Math.sin(i), -0.4 + 0.01 * i), i * 0.1, { egoV: 25 });
  assert.strictEqual(r.stale, false); assert.strictEqual(r.valid, true);
});

S.test('"no target" representations: null, invalid, and the 4093-like sentinel even when flagged valid', function () {
  var e = E.create({ noTargetGap_m: 400 });
  var r = e.update(msg(0, 409.3, null, null), 0, { egoV: 25 });
  assert.strictEqual(r.valid, false);
  r = e.update({ t: 0.1, tMeas: 0.1, seq: ++seq, valid: false, gap: 409.3, qual: 'none' }, 0.1, { egoV: 25 });
  assert.strictEqual(r.valid, false);
  r = e.update(msg(0.2, 80, 0, 3), 0.2, { egoV: 25 });
  assert.strictEqual(r.valid, true); assert.strictEqual(r.reset, true); assert.strictEqual(r.resetReason, 'acquire');
});

S.test('a blind camera (qual "blind") drops the track and flags a sensor fault', function () {
  var e = E.create({});
  for (var i = 0; i <= 5; i++) e.update(msg(i * 0.1, 50, 0), i * 0.1, { egoV: 25 });
  var r = e.update({ t: 0.6, tMeas: 0.6, seq: ++seq, valid: false, gap: null, qual: 'blind' }, 0.6, { egoV: 25 });
  assert.strictEqual(r.valid, false); assert.strictEqual(r.sensorFault, true); assert.strictEqual(r.reason, 'blind');
});

S.test('pure: two instances, same inputs, same outputs', function () {
  MODES.forEach(function (mode) {
    var a = E.create({ mode: mode }); var b = E.create({ mode: mode });
    for (var i = 0; i < 300; i++) {
      var t = i * 0.05;
      var m = i % 11 === 5 ? null : msg(t, 60 + 5 * Math.sin(t) + (i % 3) * 0.2, Math.cos(t), i < 150 ? 1 : 2);
      assert.deepStrictEqual(a.update(m, t, { egoV: 25, egoA: 0.1 }), b.update(m, t, { egoV: 25, egoA: 0.1 }));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Characterisation against the camera model (core/sensor.js) — numbers for the report, loose asserts.
var sensor = require('../core/sensor');
var rngMod = (function () { try { return require('../core/rng'); } catch (e) { return require('./stubs/sc2-rng'); } })();

function world(gap, vEgo, vLead) {
  return { t: 0, road: { curvature: function () { return 0; }, grade: function () { return 0; }, lanes: 2 },
    ego: { x: 0, v: vEgo, a: 0, lane: 0 }, others: [{ id: 'L', kind: 'car', x: gap + 4.5, v: vLead, a: 0, lane: 0, lat: 0, length: 4.5, width: 1.8 }], faults: {} };
}

// steady following at `gap`: the standard deviation of the v_rel estimate (true v_rel = 0)
function steadyNoise(estParams, sensParams, gap, seed) {
  var sn = sensor.create(sensParams, rngMod.create(seed));
  var e = E.create(estParams);
  var w = world(gap, 25, 25);
  var xs = []; var pend = null;
  for (var i = 0; i < 6000; i++) {
    var t = i * 0.01;
    var m = sn.sample(w, t); if (m) pend = m;
    if (i % 10 === 0) { var r = e.update(pend, t, { egoV: 25, egoA: 0 }); pend = null; if (t > 5 && r.valid) xs.push(r.vrel); }
  }
  var mean = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
  return Math.sqrt(xs.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / xs.length);
}

// the lead brakes at -2 m/s^2 from 25 m/s at 50 m; added delay = mean lag of the v_rel estimate behind the truth
// during the ramp, (vrel_est - vrel_true) / slope (noise-free camera, so only the filter's lag counts)
function rampDelay(estParams, sensParams) {
  var sn = sensor.create(sensParams, rngMod.create(5));
  var e = E.create(estParams);
  var w = world(50, 25, 25);
  var lags = []; var pend = null;
  for (var i = 0; i < 1000; i++) {
    var t = i * 0.01;
    var L = w.others[0];
    if (t >= 2 && L.v > 15) { L.a = -2; } else L.a = 0;
    L.v += L.a * 0.01; L.x += L.v * 0.01; w.ego.x += 25 * 0.01; w.t = t;
    var m = sn.sample(w, t); if (m) pend = m;
    if (i % 10 === 0) {
      var r = e.update(pend, t, { egoV: 25, egoA: 0 }); pend = null;
      if (t > 3.5 && L.a < 0 && r.valid) lags.push((r.vrel - (L.v - 25)) / 2);
    }
  }
  return lags.reduce(function (a, b) { return a + b; }, 0) / lags.length;
}

S.test('characterisation: v_rel noise at steady following and added delay on a braking lead (printed)', function () {
  var quiet = { preset: 'clear', gapSd0_m: 0, gapSd100_m: 0, vrelSd0_mps: 0, vrelSd100_mps: 0, gapQuant_m: 0, vrelQuant_mps: 0, dropProb: 0, burstProb: 0, outlierProb: 0, jitter_s: 0 };
  var rows = [];
  [['kalman', true], ['kalman', false], ['kalmanCA', true], ['alphaBeta', true], ['alphaBeta', false]].forEach(function (c) {
    var ep = { mode: c[0], useVrel: c[1] };
    var sp = c[1] ? {} : { vrelMode: 'none' };
    var n30 = steadyNoise(ep, sp, 30, 11); var n60 = steadyNoise(ep, sp, 60, 12);
    var qp = {}; for (var k in quiet) qp[k] = quiet[k]; if (!c[1]) qp.vrelMode = 'none';
    var lag = rampDelay(ep, qp);
    rows.push(c[0] + (c[1] ? ' + camera vrel' : ', gap only') + ': vrel sd ' + n30.toFixed(2) + ' m/s at 30 m, ' + n60.toFixed(2) + ' at 60 m; added delay ' + lag.toFixed(2) + ' s');
    assert.ok(n30 < 3 && lag < 3, 'sane: ' + rows[rows.length - 1]);
  });
  console.log('  [estimator characterisation, default camera: 10 Hz, latency 0.15 s, sd 0.1 + 3 (d/100)^2 m, vrel lag 0.5 s]\n    ' + rows.join('\n    '));
});

S.run();
