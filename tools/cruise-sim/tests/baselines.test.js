'use strict';
// SC2: core/baselines.js on its own: the ideal ACC and the IDM driver in a minimal closed loop.
var H = require('./stubs/sc2-harness');
var B = require('../core/baselines');
var assert = H.assert; var near = H.near;
var S = H.suite('baselines');
var rngMod = (function () { try { return require('../core/rng'); } catch (e) { return require('./stubs/sc2-rng'); } })();

function world(gap, vEgo, vLead, vMax) {
  return { t: 0, road: { curvature: function () { return 0; } }, ego: { x: 0, v: vEgo, a: 0, lane: 0 },
    others: gap === null ? [] : [{ id: 'L', kind: 'car', x: gap + 4.5, v: vLead, a: 0, lane: 0, lat: 0, length: 4.5, width: 1.8 }],
    driver: { vMax: vMax }, faults: {} };
}
// integrate ego with the baseline's acceleration; the lead follows leadAcc(t)
function loop(ctl, w, secs, leadAcc) {
  var rows = [];
  for (var i = 0; i <= Math.round(secs * 100); i++) {
    var t = i * 0.01;
    var r = ctl.step(w, t, null);
    var L = w.others[0];
    if (L) { L.a = leadAcc ? leadAcc(t, L) : 0; L.v = Math.max(0, L.v + L.a * 0.01); L.x += L.v * 0.01; }
    w.ego.a = r.a; w.ego.v = Math.max(0, w.ego.v + r.a * 0.01); w.ego.x += w.ego.v * 0.01;
    rows.push({ t: t, a: r.a, v: w.ego.v, gap: L ? L.x - L.length - w.ego.x : null, vl: L ? L.v : null });
  }
  return rows;
}

S.test('SCHEMA: units, defaults, ranges or options; unique keys', function () {
  var seen = {};
  B.SCHEMA.forEach(function (s) {
    assert.ok(!seen[s.key], 'unique ' + s.key); seen[s.key] = true;
    assert.ok(s.key && s.label && typeof s.unit === 'string' && s.default !== undefined, s.key);
    assert.ok(s.options || (s.min <= s.default && s.default <= s.max), s.key + ' range');
  });
});

S.test('IDM: zero acceleration at the desired speed on a free road and at the equilibrium gap', function () {
  var q = { a: 1.4, b: 2, T: 1.5, s0: 2, delta: 4 };
  near(B.idm(30, 30, null, 0, q), 0, 1e-12);
  near(B.idm(0, 30, null, 0, q), 1.4, 1e-12);
  var v = 20; var se = (q.s0 + v * q.T) / Math.sqrt(1 - Math.pow(v / 30, 4));
  near(B.idm(v, 30, se, 0, q), 0, 1e-12);
});

S.test('ideal ACC: settles at d0 + h v behind a constant-speed lead, within its limits and jerk', function () {
  var acc = B.idealAcc.create({});
  var w = world(100, 30, 22, 36);
  var rows = loop(acc, w, 90);
  var last = rows[rows.length - 1];
  near(last.v, 22, 0.05); near(last.gap, 5 + 2 * 22, 0.5);
  var minA = Math.min.apply(null, rows.map(function (r) { return r.a; }));
  assert.ok(minA >= -3.5 - 1e-9);
  for (var i = 1; i < rows.length; i++) assert.ok(Math.abs(rows[i].a - rows[i - 1].a) <= 2.5 * 0.01 + 1e-9, 'jerk at ' + rows[i].t);
});

S.test('ideal ACC: free road accelerates to the driver maximum; the lead braking at -3 is followed without contact', function () {
  var acc = B.idealAcc.create({});
  var rows = loop(acc, world(null, 20, 0, 30), 60);
  near(rows[rows.length - 1].v, 30, 0.05);
  var acc2 = B.idealAcc.create({});
  var w = world(5 + 2 * 25, 25, 25, 36);
  var r2 = loop(acc2, w, 30, function (t, L) { return t >= 2 && L.v > 10 ? -3 : 0; });
  var minGap = Math.min.apply(null, r2.map(function (r) { return r.gap; }));
  assert.ok(minGap > 5, 'min gap ' + minGap.toFixed(2));
  near(r2[r2.length - 1].v, 10, 0.3);
});

S.test('ideal ACC through the camera (acc_useTruth false) also settles', function () {
  var sensor = require('../core/sensor');
  var acc = B.idealAcc.create({ acc_useTruth: false });
  var sn = sensor.create({ preset: 'ideal' }, rngMod.create(3));
  var w = world(80, 28, 22, 36);
  for (var i = 0; i <= 9000; i++) {
    var t = i * 0.01; var m = sn.sample(w, t);
    var r = acc.step(w, t, m);
    var L = w.others[0]; L.x += L.v * 0.01;
    w.ego.a = r.a; w.ego.v += r.a * 0.01; w.ego.x += w.ego.v * 0.01;
  }
  near(w.ego.v, 22, 0.1); near(L.x - 4.5 - w.ego.x, 49, 1.0);
});

S.test('human (IDM): the reaction delay is visible to the sample; perception noise off = noise-free', function () {
  var hum = B.human.create({ hum_reaction_s: 1.0, hum_gapNoiseRel: 0, hum_vrelNoise_mps: 0 }, rngMod.create(4));
  // a standing car appears 60 m ahead at 20 m/s at t = 2: braking starts at t = 3
  var w = world(null, 20, 0, 20);
  var first = null;
  for (var i = 0; i <= 400; i++) {
    var t = i * 0.01;
    if (Math.abs(t - 2) < 1e-9) w.others.push({ id: 'S', kind: 'static', x: w.ego.x + 64.5, v: 0, a: 0, lane: 0, lat: 0, length: 4.5, width: 1.8 });
    var r = hum.step(w, t, null);
    if (first === null && r.a < -0.5) first = t;
    w.ego.v = Math.max(0, w.ego.v + r.a * 0.01); w.ego.x += w.ego.v * 0.01;
  }
  near(first, 3.0, 1e-9);
});

S.test('human (IDM): follows a lead at about the IDM equilibrium gap; noisy perception is deterministic per seed', function () {
  function go(seed) {
    var hum = B.human.create({}, rngMod.create(seed));
    return loop(hum, world(60, 25, 25, 33), 120);
  }
  var a = go(5); var b = go(5);
  assert.deepStrictEqual(a.map(function (r) { return r.a; }), b.map(function (r) { return r.a; }));
  var last = a.slice(-2000);
  var meanGap = last.reduce(function (s, r) { return s + r.gap; }, 0) / last.length;
  var se = (2 + 25 * 1.5) / Math.sqrt(1 - Math.pow(25 / 33, 4));
  near(meanGap, se, 6, 'mean gap vs equilibrium ' + se.toFixed(1));
  assert.ok(Math.min.apply(null, a.map(function (r) { return r.gap; })) > 10);
});

S.test('create(params) picks the variant by params.mode', function () {
  var w = world(null, 20, 0, 30);
  assert.strictEqual(B.create({ mode: 'human' }, rngMod.create(1)).step(w, 0).reason, 'human');
  assert.strictEqual(B.create({ mode: 'idealAcc' }).step(w, 0).reason, 'free');
});

S.run();
