'use strict';
// SC2: core/sensor.js on its own: geometry, timing, noise laws, faults, target changes.
var H = require('./stubs/sc2-harness');
var Sn = require('../core/sensor');
var assert = H.assert; var near = H.near;
var S = H.suite('sensor');
var rngMod = (function () { try { return require('../core/rng'); } catch (e) { return require('./stubs/sc2-rng'); } })();

var QUIET = { gapSd0_m: 0, gapSd100_m: 0, vrelSd0_mps: 0, vrelSd100_mps: 0, gapQuant_m: 0, vrelQuant_mps: 0, vrelLag_s: 0,
  dropProb: 0, burstProb: 0, outlierProb: 0, jitter_s: 0, latency_s: 0, acqDelay_s: 0 };
function P(extra) { var p = {}; var k; for (k in QUIET) p[k] = QUIET[k]; if (extra) for (k in extra) p[k] = extra[k]; return p; }

function car(id, gap, v, lane, extra) {
  var o = { id: id, kind: 'car', x: gap + 4.5, v: v, a: 0, lane: lane || 0, lat: 0, length: 4.5, width: 1.8 };
  if (extra) for (var k in extra) o[k] = extra[k];
  return o;
}
function world(others, kappa) {
  return { t: 0, road: { curvature: typeof kappa === 'function' ? kappa : function () { return kappa || 0; }, grade: function () { return 0; }, lanes: 3 },
    ego: { x: 0, v: 25, a: 0, lane: 0 }, others: others, faults: {}, driver: { vMax: 30 } };
}
// advance the world at 10 ms with constant speeds; collect every delivered message
function run(sn, w, secs, each) {
  var out = [];
  for (var i = 0; i <= Math.round(secs * 100); i++) {
    var t = i * 0.01;
    if (each) each(w, t);
    var m = sn.sample(w, t);
    if (m) { m.tick = t; out.push(m); }
    w.ego.x += w.ego.v * 0.01;
    w.others.forEach(function (o) { o.x += o.v * 0.01; });
  }
  return out;
}
function sd(xs) {
  var m = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
  return Math.sqrt(xs.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / xs.length);
}

S.test('SCHEMA: units, defaults, ranges or options; presets only name known keys', function () {
  var keys = {};
  Sn.SCHEMA.forEach(function (s) {
    keys[s.key] = true;
    assert.ok(s.key && s.label && typeof s.unit === 'string' && s.default !== undefined, s.key);
    assert.ok(s.options || (s.min <= s.default && s.default <= s.max), s.key + ' range');
  });
  Object.keys(Sn.PRESETS).forEach(function (n) { Object.keys(Sn.PRESETS[n]).forEach(function (k) { assert.ok(keys[k], n + '.' + k); }); });
});

S.test('geometry: gap = o.x - o.length - ego.x; the true lead is the nearest in our lane', function () {
  var w = world([car('far', 80, 25), car('near', 40, 25), car('side', 20, 25, 1)]);
  near(Sn.geom.gapTo(w.ego, w.others[1]), 40, 1e-12);
  var L = Sn.geom.trueLead(w);
  assert.strictEqual(L.id, 'near'); near(L.gap, 40, 1e-12);
  w.others[2].lat = -1.9;     // the side car is now more than half a lane over into ours
  assert.strictEqual(Sn.geom.trueLead(w).id, 'side');
});

S.test('ideal camera: the truth, at the native rate, without delay', function () {
  var sn = Sn.create(P({ rateHz: 10 }), rngMod.create(1));
  var w = world([car('L', 50, 22)]);
  var ms = run(sn, w, 10);
  assert.strictEqual(ms.length, 101);
  ms.forEach(function (m) {
    assert.strictEqual(m.valid, true); near(m.t, m.tMeas, 1e-12);
    near(m.gap, m._truth.gapTrue, 1e-9); near(m.vrel, -3, 1e-12);
  });
  for (var i = 1; i < ms.length; i++) near(ms[i].tMeas - ms[i - 1].tMeas, 0.1, 1e-9);
  // 25 Hz on a 10 ms grid: 251 messages in 10 s, intervals of 0.04 s on average
  var ms25 = run(Sn.create(P({ rateHz: 25 }), rngMod.create(1)), world([car('L', 50, 22)]), 10);
  assert.strictEqual(ms25.length, 251);
});

S.test('latency: delivered latency_s after the measurement, in order even with jitter', function () {
  var ms = run(Sn.create(P({ latency_s: 0.3 }), rngMod.create(2)), world([car('L', 50, 25)]), 5);
  ms.forEach(function (m) { near(m.t - m.tMeas, 0.3, 1e-9); assert.ok(m.tick >= m.t - 1e-9 && m.tick < m.t + 0.01); });
  assert.ok(ms[0].tMeas === 0 && ms[0].tick >= 0.3 - 1e-9);
  var mj = run(Sn.create(P({ latency_s: 0.1, jitter_s: 0.2 }), rngMod.create(3)), world([car('L', 50, 25)]), 30);
  var lat = mj.map(function (m) { return m.t - m.tMeas; });
  for (var i = 1; i < mj.length; i++) assert.ok(mj[i].t >= mj[i - 1].t, 'in order');
  assert.ok(Math.min.apply(null, lat) >= 0.1 - 1e-9);
  assert.ok(sd(lat) > 0.05, 'jitter visible: ' + sd(lat));
  // a latency spike from the failures module
  var sn = Sn.create(P({ latency_s: 0.1 }), rngMod.create(4)); var w = world([car('L', 50, 25)]);
  w.faults.latencyExtra = 0.5;
  var ml = run(sn, w, 2);
  near(ml[0].t - ml[0].tMeas, 0.6, 1e-9);
  // no own timestamp
  var mn = run(Sn.create(P({ useTimestamp: false }), rngMod.create(4)), world([car('L', 50, 25)]), 1);
  assert.strictEqual(mn[0].tMeas, null);
});

S.test('range noise grows with distance by the power law (white noise, many samples)', function () {
  function noiseAt(d) {
    var sn = Sn.create(P({ gapSd0_m: 0.1, gapSd100_m: 3, gapSdExp: 2, gapNoiseTau_s: 0, rateHz: 25 }), rngMod.create(5 + d));
    var ms = run(sn, world([car('L', d, 25)]), 80);
    return sd(ms.map(function (m) { return m.gap - m._truth.gapTrue; }));
  }
  var s20 = noiseAt(20); var s80 = noiseAt(80);
  near(s20, 0.1 + 3 * 0.04, 0.03, '20 m'); near(s80, 0.1 + 3 * 0.64, 0.15, '80 m');
});

S.test('correlated noise: lag-1 autocorrelation = exp(-dt / tau)', function () {
  var sn = Sn.create(P({ gapSd0_m: 1, gapNoiseTau_s: 0.3, rateHz: 10 }), rngMod.create(9));
  var e = run(sn, world([car('L', 50, 25)]), 300).map(function (m) { return m.gap - m._truth.gapTrue; });
  var num = 0, den = 0; for (var i = 1; i < e.length; i++) { num += e[i] * e[i - 1]; den += e[i - 1] * e[i - 1]; }
  near(num / den, Math.exp(-0.1 / 0.3), 0.04);
});

S.test('quantisation, scale error and the relative-speed lag', function () {
  var ms = run(Sn.create(P({ gapSd0_m: 0.3, gapQuant_m: 0.1, vrelQuant_mps: 0.1, vrelSd0_mps: 0.2 }), rngMod.create(6)), world([car('L', 50, 25)]), 5);
  ms.forEach(function (m) { near(Math.round(m.gap * 10) - m.gap * 10, 0, 1e-6); near(Math.round(m.vrel * 10) - m.vrel * 10, 0, 1e-6); });
  var mb = run(Sn.create(P({ gapBiasRel: 0.1 }), rngMod.create(6)), world([car('L', 50, 25)]), 1);
  near(mb[0].gap, 55, 1e-9);
  // a first-order lag of 0.5 s on a step of the lead speed: 63 % after 0.5 s
  var sn = Sn.create(P({ vrelLag_s: 0.5, rateHz: 25 }), rngMod.create(7)); var w = world([car('L', 50, 25)]);
  var ml = run(sn, w, 3, function (ww, t) { if (t >= 1 - 1e-9) ww.others[0].v = 20; });
  var at = ml.filter(function (m) { return Math.abs(m.tMeas - 1.52) < 0.005; })[0];
  // discrete lag, updated every frame from the step frame (1.00 s) on: 14 updates of 0.04 s by 1.52 s
  near(at.vrel, -5 * (1 - Math.exp(-14 * 0.04 / 0.5)), 1e-9);
  var mv = run(Sn.create(P({ vrelMode: 'none' }), rngMod.create(7)), world([car('L', 50, 25)]), 1);
  assert.strictEqual(mv[0].vrel, null);
});

S.test('dropouts and bursts: the delivered share and the seq gaps', function () {
  var ms = run(Sn.create(P({ dropProb: 0.2, rateHz: 10 }), rngMod.create(8)), world([car('L', 50, 25)]), 300);
  near(ms.length / 3001, 0.8, 0.03);
  var mb = run(Sn.create(P({ burstProb: 0.01, burstMean_s: 1.0, rateHz: 10 }), rngMod.create(8)), world([car('L', 50, 25)]), 600);
  var gaps = []; for (var i = 1; i < mb.length; i++) { var g = mb[i].seq - mb[i - 1].seq - 1; if (g > 0) gaps.push(g); }
  var meanLen = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
  assert.ok(gaps.length > 20, 'bursts happen: ' + gaps.length);
  near(meanLen / 10, 1.0 + 0.05, 0.35, 'mean burst ~1 s (+ the quantisation to frames)');
  var sn = Sn.create(P({}), rngMod.create(8)); var w = world([car('L', 50, 25)]); w.faults.dropBurst = true;
  assert.strictEqual(run(sn, w, 2).length, 0, 'forced burst: nothing');
});

S.test('outliers: share and size', function () {
  var ms = run(Sn.create(P({ outlierProb: 0.05, outlierRel: 0.3, rateHz: 25 }), rngMod.create(10)), world([car('L', 50, 25)]), 100);
  var out = ms.filter(function (m) { return m._truth.outlier; });
  near(out.length / ms.length, 0.05, 0.012);
  out.forEach(function (m) { assert.ok(Math.abs(m.gap / m._truth.gapTrue - 1) <= 0.3 + 1e-9); });
});

S.test('frozen gap: repeat (same seq and time), repeatNewSeq, silent', function () {
  var sn = Sn.create(P({}), rngMod.create(11)); var w = world([car('L', 50, 20)]);
  var ms = run(sn, w, 3, function (ww, t) { ww.faults.gapFrozen = t >= 1 - 1e-9; });
  var frozen = ms.filter(function (m) { return m._truth.frozen; });
  assert.ok(frozen.length >= 19);
  frozen.forEach(function (m) { assert.strictEqual(m.seq, frozen[0].seq); assert.strictEqual(m.gap, frozen[0].gap); assert.strictEqual(m.tMeas, frozen[0].tMeas); });
  assert.ok(frozen[frozen.length - 1]._truth.gapTrue < frozen[0].gap - 5, 'the truth moved on');
  var sn2 = Sn.create(P({ frozenMode: 'repeatNewSeq' }), rngMod.create(11)); var w2 = world([car('L', 50, 20)]);
  var f2 = run(sn2, w2, 3, function (ww, t) { ww.faults.gapFrozen = t >= 1 - 1e-9; }).filter(function (m) { return m._truth.frozen; });
  assert.ok(f2[1].seq > f2[0].seq && f2[1].gap === f2[0].gap);
  var sn3 = Sn.create(P({ frozenMode: 'silent' }), rngMod.create(11)); var w3 = world([car('L', 50, 20)]);
  var f3 = run(sn3, w3, 3, function (ww, t) { ww.faults.gapFrozen = t >= 1 - 1e-9; });
  assert.strictEqual(f3.length, 10);
});

S.test('blind camera: invalid with qual "blind", or silence; then reacquired with a new id', function () {
  var sn = Sn.create(P({ acqDelay_s: 0.5 }), rngMod.create(12)); var w = world([car('L', 50, 25)]);
  var ms = run(sn, w, 4, function (ww, t) { ww.faults.sensorBlind = t >= 1 - 1e-9 && t < 2 - 1e-9; });
  var blind = ms.filter(function (m) { return m.qual === 'blind'; });
  assert.strictEqual(blind.length, 10); blind.forEach(function (m) { assert.strictEqual(m.valid, false); assert.strictEqual(m.gap, null); });
  var before = ms.filter(function (m) { return m.tMeas < 1 && m.valid; }).pop();
  var after = ms.filter(function (m) { return m.tMeas >= 2 && m.valid; });
  near(after[0].tMeas, 2.5, 1e-9, 'acquisition delay after blindness');
  assert.notStrictEqual(after[0].id, before.id);
  var sn2 = Sn.create(P({ blindMode: 'silent' }), rngMod.create(12)); var w2 = world([car('L', 50, 25)]);
  var m2 = run(sn2, w2, 2, function (ww, t) { ww.faults.sensorBlind = t >= 1 - 1e-9; });
  assert.strictEqual(m2.filter(function (m) { return m.tMeas >= 1; }).length, 0);
});

S.test('"no target": null, the sentinel, and the sentinel flagged valid', function () {
  var m = run(Sn.create(P({}), rngMod.create(13)), world([]), 0.5);
  assert.strictEqual(m.length, 6); assert.strictEqual(m[0].valid, false); assert.strictEqual(m[0].gap, null); assert.strictEqual(m[0].qual, 'none');
  m = run(Sn.create(P({ noTarget: 'sentinel' }), rngMod.create(13)), world([]), 0.1);
  assert.strictEqual(m[0].valid, false); near(m[0].gap, 409.3, 1e-9);
  m = run(Sn.create(P({ noTarget: 'sentinelValid' }), rngMod.create(13)), world([]), 0.1);
  assert.strictEqual(m[0].valid, true); near(m[0].gap, 409.3, 1e-9);
});

S.test('range, field of view, sensorRangeCut and weather', function () {
  assert.strictEqual(run(Sn.create(P({ range_m: 120 }), rngMod.create(14)), world([car('L', 130, 25)]), 0.5)[0].valid, false);
  assert.strictEqual(run(Sn.create(P({ range_m: 120 }), rngMod.create(14)), world([car('L', 110, 25)]), 0.5)[0].valid, true);
  var w = world([car('L', 60, 25)]); w.faults.sensorRangeCut = 40;
  assert.strictEqual(run(Sn.create(P({}), rngMod.create(14)), w, 0.2)[0].valid, false);
  // rain: range x 0.6 = 72 m
  assert.strictEqual(run(Sn.create(P({ weather: 'rain', dropProb: 0 }), rngMod.create(14)), world([car('L', 80, 25)]), 0.2).filter(function (m) { return m.valid; }).length, 0);
  var wr = world([car('L', 80, 25)]); wr.faults.sensorDegraded = 'fog';
  assert.strictEqual(run(Sn.create(P({}), rngMod.create(14)), wr, 0.5).filter(function (m) { return m.valid; }).length, 0, 'fog via the fault');
  // a car 3 m to the side at 4 m is outside a 25 deg half field of view
  var wf = world([car('L', 4, 25, 0, { lat: 2.2 })]);
  assert.ok(Math.atan(2.2 / 4) > 25 * Math.PI / 180);
  assert.strictEqual(run(Sn.create(P({ inPathHalf_m: 2 }), rngMod.create(14)), wf, 0.1)[0].valid, false);
});

S.test('cut-in: acquired after acqDelay_s once in the path; id changes; moto late, truck early', function () {
  function cutIn(kind) {
    var sn = Sn.create(P({ acqDelay_s: 0.5 }), rngMod.create(15));
    var w = world([car('far', 60, 25), car('cut', 25, 25, 1, { kind: kind, width: kind === 'moto' ? 0.8 : (kind === 'truck' ? 2.5 : 1.8) })]);
    // the cutting car moves from lane 1 to lane 0 laterally over 2 s starting at t = 1 (lat in lane-1 coordinates)
    var ms = run(sn, w, 6, function (ww, t) {
      var o = ww.others[1]; var f = Math.max(0, Math.min(1, (t - 1) / 2));
      o.lane = 1; o.lat = -3.5 * f;
    });
    var first = ms.filter(function (m) { return m.valid && m._truth.vehId === 'cut'; })[0];
    return { ms: ms, first: first };
  }
  var c = cutIn('car');
  // in the path when its near edge is < 1.0 m from our centre: 3.5 (1 - f) - 0.9 < 1.0 -> f > 0.457 -> t > 1.914; + 0.5 s
  near(c.first.tMeas, 2.5, 0.06);
  var before = c.ms.filter(function (m) { return m.tMeas < 2 && m.valid; }).pop();
  assert.strictEqual(before._truth.vehId, 'far'); assert.notStrictEqual(before.id, c.first.id);
  near(c.first.gap, 25, 1e-9, 'jump to the new target');
  var moto = cutIn('moto'); var truck = cutIn('truck');
  assert.ok(moto.first.tMeas > c.first.tMeas + 0.5, 'moto later: ' + moto.first.tMeas);
  assert.ok(truck.first.tMeas < c.first.tMeas, 'truck earlier: ' + truck.first.tMeas);
});

S.test('cut-out: the lead leaves, the hidden car becomes the target after the release and acquisition delays', function () {
  var sn = Sn.create(P({ acqDelay_s: 0.5, releaseDelay_s: 0.3 }), rngMod.create(16));
  var w = world([car('lead', 30, 25), car('hidden', 70, 15)]);
  var ms = run(sn, w, 5, function (ww, t) { var f = Math.max(0, Math.min(1, (t - 1) / 2)); ww.others[0].lat = 3.5 * f; });
  var hidden = ms.filter(function (m) { return m.valid && m._truth.vehId === 'hidden'; })[0];
  assert.ok(hidden, 'hidden car acquired');
  // the hidden car was in the path all along (confirmed long ago): it takes over as soon as the lead is released
  var lastLead = ms.filter(function (m) { return m.valid && m._truth.vehId === 'lead'; }).pop();
  assert.ok(hidden.tMeas > lastLead.tMeas && hidden.tMeas - lastLead.tMeas < 0.15);
  near(hidden.vrel, -10, 1e-9);
});

S.test('blend transition: the gap slides from the old to the new target; idTiming "end" keeps the old id', function () {
  var sn = Sn.create(P({ acqDelay_s: 0, transition: 'blend', blend_s: 0.5, idTiming: 'end' }), rngMod.create(17));
  var w = world([car('far', 60, 25), car('cut', 20, 25, 1)]);
  var ms = run(sn, w, 4, function (ww, t) { if (t >= 1 - 1e-9) ww.others[1].lane = 0; });
  var during = ms.filter(function (m) { return m.tMeas > 1.05 && m.tMeas < 1.45; });
  assert.ok(during.length >= 3);
  during.forEach(function (m) { assert.ok(m.gap > 20.5 && m.gap < 59.5, 'blended ' + m.gap); assert.strictEqual(m.id, ms[0].id, 'old id kept'); });
  var after = ms.filter(function (m) { return m.tMeas > 1.55; })[0];
  near(after.gap, 20, 1e-9); assert.notStrictEqual(after.id, ms[0].id);
});

S.test('curves: the in-lane lead is lost at range when the path prediction misses; kept when it does not', function () {
  // steady left curve kappa = 1/500, curvePredErr 0.3: apparent offset 0.3 kappa d^2 / 2 -> edge = that - 0.9
  // at 80 m: 1.92 - 0.9 = 1.02 > 1.0 (lost); at 40 m: 0.48 - 0.9 < 1.0 (kept)
  var k = 1 / 500;
  var at80 = run(Sn.create(P({ curvePredErr: 0.3 }), rngMod.create(18)), world([car('L', 80, 25)], k), 0.5);
  var at40 = run(Sn.create(P({ curvePredErr: 0.3 }), rngMod.create(18)), world([car('L', 40, 25)], k), 0.5);
  assert.strictEqual(at80.filter(function (m) { return m.valid; }).length, 0);
  assert.strictEqual(at40.filter(function (m) { return m.valid; }).length, at40.length);
  var perfect = run(Sn.create(P({ curvePredErr: 0 }), rngMod.create(18)), world([car('L', 80, 25)], k), 0.5);
  assert.strictEqual(perfect.filter(function (m) { return m.valid; }).length, perfect.length);
  // curve entry: straight at ego, the curve starts 30 m ahead -> the camera's prediction is straight
  var entry = function (x) { return x > 30 ? 1 / 300 : 0; };
  var me = run(Sn.create(P({ curvePredErr: 0 }), rngMod.create(18)), world([car('L', 90, 25)], entry), 0.2);
  assert.strictEqual(me[0].valid, false, 'lost on curve entry even with a perfect yaw-rate prediction');
});

S.test('curves: the car in the next lane is taken for the lead (a wrong target)', function () {
  // kappa 1/700, curvePredErr 0.5: apparent shift 0.5 kappa d^2 / 2 = 3.43 m at 98 m -> the right-lane car looks centred,
  // the true lead at 100 m looks 3.57 m to the left
  var w = world([car('lead', 100, 25), car('right', 98, 25, -1)], 1 / 700);
  var ms = run(Sn.create(P({ curvePredErr: 0.5, range_m: 150 }), rngMod.create(19)), w, 0.5);
  assert.ok(ms.every(function (m) { return m.valid && m._truth.vehId === 'right' && m._truth.wrong === true && m._truth.leadId === 'lead'; }));
});

S.test('ghost target: forced by the fault, standing (closes at our speed), new id; random ghosts at their rate', function () {
  var sn = Sn.create(P({}), rngMod.create(20)); var w = world([car('L', 80, 10)]); w.ego.v = 10;
  var ms = run(sn, w, 3, function (ww, t) { ww.faults.ghost = t >= 1 - 1e-9 && t < 2 - 1e-9; });
  var g = ms.filter(function (m) { return m._truth.ghost; });
  assert.strictEqual(g.length, 10, 'starts at 15..50 m, closes 1 m per frame: lasts the whole fault');
  g.forEach(function (m) { near(m.vrel, -10, 1e-9); assert.ok(m.gap >= 1 && m.gap <= 50); });
  assert.notStrictEqual(g[0].id, ms[0].id);
  near(g[0].gap - g[1].gap, 1.0, 1e-9, 'standing ghost closes 1 m per 0.1 s at 10 m/s');
  assert.strictEqual(ms[ms.length - 1]._truth.vehId, 'L', 'back to the real lead');
  var sr = Sn.create(P({ ghostRatePerMin: 6, ghostDur_s: 1 }), rngMod.create(21));
  var mr = run(sr, world([car('L', 80, 25)]), 600);
  var starts = 0; for (var i = 1; i < mr.length; i++) if (mr[i]._truth.ghost && !mr[i - 1]._truth.ghost) starts++;
  near(starts / 10, 6, 2.5, 'ghosts per minute');
});

S.test('deterministic: the same seed gives the same messages; an independent stream per effect', function () {
  function go(seed, extra) { return run(Sn.create(Sn.fill(extra || {}), rngMod.create(seed)), world([car('L', 50, 24)]), 20).map(function (m) { return [m.t, m.gap, m.vrel, m.seq]; }); }
  assert.deepStrictEqual(go(7), go(7));
  assert.notDeepStrictEqual(go(7), go(8));
  // turning outliers on does not reshuffle the noise of the samples that are not outliers (forked streams)
  var a = run(Sn.create(Sn.fill({ dropProb: 0, burstProb: 0, outlierProb: 0 }), rngMod.create(7)), world([car('L', 50, 24)]), 10);
  var b = run(Sn.create(Sn.fill({ dropProb: 0, burstProb: 0, outlierProb: 0.2 }), rngMod.create(7)), world([car('L', 50, 24)]), 10);
  var same = 0; for (var i = 0; i < a.length; i++) if (!b[i]._truth.outlier && a[i].gap === b[i].gap) same++;
  assert.strictEqual(same, b.filter(function (m) { return !m._truth.outlier; }).length);
});

S.run();
