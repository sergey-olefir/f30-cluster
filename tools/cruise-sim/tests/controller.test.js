'use strict';
// SC2: core/controller.js on its own, with analytic cases.
var H = require('./stubs/sc2-harness');
var C = require('../core/controller');
var assert = H.assert; var near = H.near;
var S = H.suite('controller');
var KMH = 1 / 3.6;

function est(gap, vlead, extra) {
  var e = { valid: true, stale: false, gap: gap, vlead: vlead, vrel: null, alead: 0 };
  if (extra) for (var k in extra) e[k] = extra[k];
  return e;
}
var NONE = { valid: false, stale: false };
function active(held) { return { state: 'active', setHeld: held }; }

// run the controller at 10 Hz from t0 for `secs`, with an input function of t
function drive(c, t0, secs, inputOf) {
  var out = []; var n = Math.round(secs * 10);
  for (var i = 0; i <= n; i++) { var t = t0 + i * 0.1; var r = c.step(inputOf(t)); r.t = t; out.push(r); }
  return out;
}

S.test('SCHEMA carries the parent tuning table with its start values and sweep ranges', function () {
  var by = {}; C.SCHEMA.forEach(function (s) { by[s.key] = s; assert.ok(s.label && typeof s.unit === 'string', s.key); });
  function chk(k, def, lo, hi) { assert.strictEqual(by[k].default, def, k); assert.strictEqual(by[k].min, lo, k + ' min'); assert.strictEqual(by[k].max, hi, k + ' max'); }
  chk('d0', 5, 3, 8); chk('h', 2.0, 1.5, 3.0); chk('tau', 4, 2, 8);
  chk('rateDown_kmhps', 3, 1, 5); chk('rateUp_kmhps', 1, 0.5, 2);
  assert.strictEqual(by.rateHz.default, 10);
});

S.test('d_des = d0 + h v and v_ref = v_lead + (d - d_des)/tau', function () {
  var c = C.create({});
  var r = c.step({ t: 0, est: est(60, 18), egoV: 20, egoA: 0, vDriver: 40, cruise: active(20) });
  near(r.dDes, 45, 1e-12);
  near(r.vRef, 18 + 15 / 4, 1e-12);
  assert.strictEqual(r.reason, 'follow');
});

S.test('steady following at d_des and v = v_lead commands v_lead and never changes', function () {
  var c = C.create({});
  var v = 25; var out = drive(c, 0, 30, function (t) { return { t: t, est: est(5 + 2 * v, v), egoV: v, vDriver: 40, cruise: active(90 * KMH) }; });
  out.forEach(function (r) { near(r.vSet, 90 * KMH, 1e-9); });
  assert.ok(out.every(function (r) { return !r.send; }));
});

S.test('no target: v_set rises to the driver maximum at the up rate limit (1 km/h/s)', function () {
  var c = C.create({});
  var out = drive(c, 0, 25, function (t) { return { t: t, est: NONE, egoV: 80 * KMH, vDriver: 100 * KMH, cruise: active(80 * KMH) }; });
  near(out[50].y, 85 * KMH, 1e-9, 'after 5 s');
  near(out[50].vSet, 85 * KMH, 1e-9);
  near(out[out.length - 1].vSet, 100 * KMH, 1e-9, 'reaches the maximum exactly');
  assert.strictEqual(out[10].reason, 'free');
});

S.test('down rate limit 3 km/h/s toward a slow lead', function () {
  var c = C.create({ maxBelowEgo_kmh: 100 });
  // lead 50 km/h at d_des: v_ref = 50 km/h, from 100 km/h held
  var out = drive(c, 0, 4, function (t) { return { t: t, est: est(5 + 2 * 100 * KMH, 50 * KMH), egoV: 100 * KMH, vDriver: 130 * KMH, cruise: active(100 * KMH) }; });
  near(out[10].y, 97 * KMH, 1e-9, '1 s');
  near(out[40].y, 88 * KMH, 1e-9, '4 s');
});

S.test('quantisation: whole km/h steps, hysteresis of one step suppresses chatter', function () {
  var c = C.create({});
  var base = 80.3 * KMH; var v = 80 * KMH;
  // v_ref wobbles +/- 0.6 km/h around 80.3: the commanded step never moves
  var out = drive(c, 0, 20, function (t) { return { t: t, est: est(5 + 2 * v, base + 0.6 * KMH * Math.sin(t * 3)), egoV: v, vDriver: 40, cruise: active(80 * KMH) }; });
  out.forEach(function (r) { near(r.vSet / KMH, 80, 1e-9); });
  // plain rounding (hystSteps 0.5) does chatter on the same input
  var c2 = C.create({ hystSteps: 0.5, maxChangeHz: 10 });
  var out2 = drive(c2, 0, 20, function (t) { return { t: t, est: est(5 + 2 * v, base + 0.6 * KMH * Math.sin(t * 3)), egoV: v, vDriver: 40, cruise: active(80 * KMH) }; });
  var changes = out2.filter(function (r) { return r.send; }).length;
  assert.ok(changes > 5, 'plain rounding chatters: ' + changes);
  out2.forEach(function (r) { near(Math.round(r.vSet / KMH * 1e6) / 1e6 % 1, 0, 1e-6, 'integer km/h'); });
});

S.test('5 km/h cruise step: multiples of 5', function () {
  var c = C.create({ step_kmh: 5 });
  var out = drive(c, 0, 30, function (t) { return { t: t, est: NONE, egoV: 80 * KMH, vDriver: 97 * KMH, cruise: active(80 * KMH) }; });
  out.forEach(function (r) { near((r.vSet / KMH) % 5, 0, 1e-6); });
  near(out[out.length - 1].vSet / KMH, 95, 1e-6, 'never above the maximum: 95 under 97');
});

S.test('at most maxChangeHz setpoint changes per second', function () {
  var c = C.create({ maxChangeHz: 2, rateDown_kmhps: 5, maxBelowEgo_kmh: 100 });
  var out = drive(c, 0, 10, function (t) { return { t: t, est: est(30, 10), egoV: 30, vDriver: 40, cruise: active(30) }; });
  var times = out.filter(function (r) { return r.send; }).map(function (r) { return r.t; });
  assert.ok(times.length >= 10, 'changes happen: ' + times.length);
  for (var i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 0.5 - 1e-9, 'interval ' + (times[i] - times[i - 1]));
});

S.test('the driver lowering the maximum acts at once; v_set never exceeds it', function () {
  var c = C.create({});
  drive(c, 0, 2, function (t) { return { t: t, est: NONE, egoV: 33, vDriver: 120 * KMH, cruise: active(120 * KMH) }; });
  var r = c.step({ t: 2.1, est: NONE, egoV: 33, vDriver: 100 * KMH, cruise: active(120 * KMH) });
  near(r.vSet / KMH, 100, 1e-9); assert.strictEqual(r.send, true);
});

S.test('a lead slower than the cruise minimum: v_set = v_cc,min', function () {
  var c = C.create({ maxBelowEgo_kmh: 100 });
  var out = drive(c, 0, 30, function (t) { return { t: t, est: est(20, 15 * KMH), egoV: 40 * KMH, vDriver: 100 * KMH, cruise: active(40 * KMH) }; });
  var last = out[out.length - 1];
  near(last.vSet / KMH, 30, 1e-9); assert.strictEqual(last.reason, 'cruiseMin');
});

S.test('a lead faster than the driver maximum: v_set = v_driver', function () {
  var c = C.create({});
  var out = drive(c, 0, 30, function (t) { return { t: t, est: est(80, 40), egoV: 30, vDriver: 110 * KMH, cruise: active(110 * KMH) }; });
  near(out[out.length - 1].vSet / KMH, 110, 1e-9); assert.strictEqual(out[5].reason, 'driverMax');
});

S.test('maxBelowEgo: the set speed is kept at most 30 km/h below our speed', function () {
  var c = C.create({ rateDown_kmhps: 5 });
  var out = drive(c, 0, 20, function (t) { return { t: t, est: est(30, 10 * KMH), egoV: 100 * KMH, vDriver: 130 * KMH, cruise: active(100 * KMH) }; });
  near(out[out.length - 1].y / KMH, 70, 1e-9);
});

S.test('feed-forward a_lead T_lag (clamped) and the optional kinematic limit', function () {
  var c = C.create({ ffEnable: true, tLag_s: 1.0, ffMax_mps: 3 });
  var r = c.step({ t: 0, est: est(45, 20, { alead: -2 }), egoV: 20, vDriver: 40, cruise: active(20) });
  near(r.vRef, 20 - 2, 1e-12);
  r = C.create({ ffEnable: true, tLag_s: 1.0, ffMax_mps: 3 }).step({ t: 0, est: est(45, 20, { alead: -6 }), egoV: 20, vDriver: 40, cruise: active(20) });
  near(r.vRef, 20 - 3, 1e-12, 'clamped');
  r = C.create({ ffEnable: false }).step({ t: 0, est: est(45, 20, { alead: -6 }), egoV: 20, vDriver: 40, cruise: active(20) });
  near(r.vRef, 20, 1e-12, 'off by default');
  // kinematic: gap error 32 m, tau 4: linear term +8; sqrt(2*1*32) = 8 -> equal; gap error 50: linear 12.5, sqrt(100)=10
  r = C.create({ kinLimit: true, aPlan_mps2: 1 }).step({ t: 0, est: est(95, 20), egoV: 20, vDriver: 60, cruise: active(20) });
  near(r.vRef, 30, 1e-12);
});

S.test('target lost: hold the set speed for holdAfterLoss_s, then release at the up rate', function () {
  var c = C.create({ holdAfterLoss_s: 3 });
  var v = 80 * KMH;
  drive(c, 0, 5, function (t) { return { t: t, est: est(5 + 2 * v, v), egoV: v, vDriver: 120 * KMH, cruise: active(80 * KMH) }; });
  var out = drive(c, 5.1, 10, function (t) { return { t: t, est: NONE, egoV: v, vDriver: 120 * KMH, cruise: active(80 * KMH) }; });
  out.forEach(function (r) { if (r.t < 5 + 3 - 1e-9) { near(r.y / KMH, 80, 1e-9, 'held at ' + r.t); assert.strictEqual(r.reason, 'hold'); } });
  var last = out[out.length - 1];
  assert.strictEqual(last.reason, 'free');
  near(last.y / KMH, 80 + (15.1 - 8.0), 0.11, 'released at 1 km/h/s after 8.0 s');
});

S.test('stale input holds like a loss (reason "stale")', function () {
  var c = C.create({});
  var v = 80 * KMH;
  drive(c, 0, 2, function (t) { return { t: t, est: est(5 + 2 * v, v), egoV: v, vDriver: 120 * KMH, cruise: active(80 * KMH) }; });
  var r = c.step({ t: 2.1, est: { valid: false, stale: true }, egoV: v, vDriver: 120 * KMH, cruise: active(80 * KMH) });
  assert.strictEqual(r.reason, 'stale'); near(r.y / KMH, 80, 1e-9);
});

S.test('never accelerate into a curve on a lost target: the hold lasts the curve + holdAfterCurve_s', function () {
  var c = C.create({ holdAfterLoss_s: 3, aLatHold_mps2: 0.7, holdAfterCurve_s: 1 });
  var v = 100 * KMH;                       // 27.8 m/s; kappa 1/500 -> a_lat 1.54 m/s^2
  function kap(t) { return t >= 4 && t < 15 ? 1 / 500 : 0; }
  drive(c, 0, 5, function (t) { return { t: t, est: est(5 + 2 * v, v), egoV: v, vDriver: 130 * KMH, cruise: active(100 * KMH), curvature: kap(t) }; });
  var out = drive(c, 5.1, 15, function (t) { return { t: t, est: NONE, egoV: v, vDriver: 130 * KMH, cruise: active(100 * KMH), curvature: kap(t) }; });
  out.forEach(function (r) {
    // the last curved tick is 14.9 s: the hold lasts to 15.9 s
    if (r.t < 15.9 - 1e-9) near(r.y / KMH, 100, 1e-9, 'held at ' + r.t.toFixed(1));
  });
  var at = out.filter(function (r) { return Math.abs(r.t - 12) < 1e-6; })[0];
  assert.strictEqual(at.reason, 'curveHold');
  var last = out[out.length - 1];
  assert.ok(last.y / KMH > 103, 'released after the curve: ' + (last.y / KMH));
  // the yaw rate gives the same: yawRate = v kappa
  var c2 = C.create({});
  drive(c2, 0, 2, function (t) { return { t: t, est: est(5 + 2 * v, v), egoV: v, vDriver: 130 * KMH, cruise: active(100 * KMH), yawRate: v / 500 }; });
  var r2 = drive(c2, 2.1, 6, function (t) { return { t: t, est: NONE, egoV: v, vDriver: 130 * KMH, cruise: active(100 * KMH), yawRate: v / 500 }; });
  near(r2[r2.length - 1].y / KMH, 100, 1e-9); assert.strictEqual(r2[r2.length - 1].reason, 'curveHold');
});

S.test('a curve long after a loss does not hold (free driving into a bend is normal cruise)', function () {
  var c = C.create({ holdAfterLoss_s: 3 });
  var v = 80 * KMH;
  drive(c, 0, 2, function (t) { return { t: t, est: est(5 + 2 * v, v), egoV: v, vDriver: 120 * KMH, cruise: active(80 * KMH) }; });
  drive(c, 2.1, 10, function (t) { return { t: t, est: NONE, egoV: v, vDriver: 120 * KMH, cruise: active(80 * KMH) }; });
  var r = c.step({ t: 12.2, est: NONE, egoV: v, vDriver: 120 * KMH, cruise: active(80 * KMH), curvature: 1 / 300 });
  assert.strictEqual(r.reason, 'free');
});

S.test('cruise not active: command nothing; on resume re-sync from the held set speed', function () {
  var c = C.create({});
  drive(c, 0, 3, function (t) { return { t: t, est: NONE, egoV: 25, vDriver: 120 * KMH, cruise: active(90 * KMH) }; });
  var r = c.step({ t: 3.1, est: NONE, egoV: 25, vDriver: 120 * KMH, cruise: { state: 'suspended', setHeld: 90 * KMH } });
  assert.strictEqual(r.vSet, null); assert.strictEqual(r.send, false); assert.strictEqual(r.reason, 'suspended');
  r = c.step({ t: 10, est: NONE, egoV: 20, vDriver: 120 * KMH, cruise: active(70 * KMH) });
  near(r.y / KMH, 70, 1e-9, 'restarts from what the cruise holds'); near(r.vSet / KMH, 70, 1e-9);
  r = C.create({ commandDuringOverride: false }).step({ t: 0, est: NONE, egoV: 20, vDriver: 40, cruise: { state: 'override', setHeld: 20 } });
  assert.strictEqual(r.vSet, null);
  r = C.create({}).step({ t: 0, est: NONE, egoV: 20, vDriver: 40, cruise: { state: 'override', setHeld: 20 } });
  assert.ok(r.vSet !== null, 'commands during override by default');
});

S.test('resume with an old, high held set speed behind a slower lead: lowered at once to our speed, then rate-limited', function () {
  var c = C.create({});
  var v = 66 * KMH;
  // resumed at 66 km/h; the cruise still holds 90; the lead 50 km/h at d_des of 66 km/h
  var r = c.step({ t: 0, est: est(5 + 2 * v, 50 * KMH), egoV: v, vDriver: 120 * KMH, cruise: active(90 * KMH) });
  near(r.y / KMH, 68, 1e-9, 'capped at our speed + 2 km/h'); near(r.vSet / KMH, 68, 1e-9); assert.strictEqual(r.send, true);
  r = c.step({ t: 1, est: est(5 + 2 * v, 50 * KMH), egoV: v, vDriver: 120 * KMH, cruise: active(68 * KMH) });
  near(r.y / KMH, 65, 1e-9, 'then down at 3 km/h/s');
  // free road: no cap (the target is above our speed)
  var f = C.create({});
  r = f.step({ t: 0, est: NONE, egoV: v, vDriver: 120 * KMH, cruise: active(90 * KMH) });
  near(r.y / KMH, 90, 1e-9);
});

S.test('resend when the cruise keeps holding another set speed (a lost command)', function () {
  var c = C.create({ resendAfter_s: 1 });
  var v = 25;
  // our command is 90 km/h but the cruise still holds 95
  c.step({ t: 0, est: NONE, egoV: v, vDriver: 90 * KMH, cruise: active(95 * KMH) });
  var out = drive(c, 0.1, 3, function (t) { return { t: t, est: NONE, egoV: v, vDriver: 90 * KMH, cruise: active(95 * KMH) }; });
  var sends = out.filter(function (r) { return r.send; }).map(function (r) { return Math.round(r.t * 10) / 10; });
  assert.deepStrictEqual(sends, [1.1, 2.2], 'once a second while the mismatch lasts');
});

S.test('pure: two instances, same inputs, same outputs', function () {
  var a = C.create({}); var b = C.create({});
  for (var i = 0; i < 200; i++) {
    var t = i * 0.1;
    var inp = { t: t, est: i % 17 < 12 ? est(40 + 10 * Math.sin(t), 20 + Math.cos(t / 3)) : NONE, egoV: 22, vDriver: 30, cruise: active(22), curvature: i > 100 ? 0.003 : 0 };
    assert.deepStrictEqual(a.step(inp), b.step(inp));
  }
});

S.run();
