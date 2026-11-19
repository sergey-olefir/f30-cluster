'use strict';
// Synthetic "recorded-like" lead-speed traces for family K (SC3). Deterministic: `node fixtures/traces/make.js` rewrites
// them byte for byte. They stand in for the car's logs until a drive is recorded; every file says synthetic: true.
//
// Format (JSON, as SC1's vehicles.parseTrace reads it): { name, synthetic, description, t: [s], v: [m/s] } (the lead's speed).
// Format (CSV): a header line `t,v` (s, m/s), then one sample per line.
// A logged drive converts to the same shape: lead speed = ego speed + relative speed (parent brief, Phase 5).
var fs = require('fs'), path = require('path');

function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(r) { return Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r()); }

// target speed (km/h) as a function of t from a list of [t, kmh] knots (linear), followed by a driver-like tracker:
// acceleration toward the target, limited, with an Ornstein-Uhlenbeck wobble on top (a human foot).
function synth(opts) {
  var r = rng(opts.seed), dt = 0.2, n = Math.round(opts.duration / dt), out = [];
  var v = opts.knots[0][1] / 3.6, a = 0, wob = 0;
  for (var i = 0; i < n; i++) {
    var t = i * dt, tgt = knot(opts.knots, t) / 3.6;
    var want = Math.max(-opts.dMax, Math.min(opts.aMax, (tgt - v) / opts.tau));
    a += (want - a) * Math.min(1, dt / 0.6);                 // the foot is not instant
    wob += -wob * dt / 4 + opts.wobble * Math.sqrt(dt) * normal(r);
    v = Math.max(0, v + (a + wob * 0.15) * dt);
    if (tgt === 0 && v < 0.3) { v = 0; a = 0; }
    var x = Math.round((v + 0.03 * normal(r)) * 100) / 100;     // reconstruction noise (v + v_rel), 0.03 m/s
    out.push(x > 0 ? x : 0);                                       // (never -0: JSON would not keep it)
  }
  return { dt: dt, v: out };
}
function knot(k, t) {
  if (t <= k[0][0]) return k[0][1];
  for (var i = 1; i < k.length; i++) if (t <= k[i][0]) return k[i - 1][1] + (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]) * (k[i][1] - k[i - 1][1]);
  return k[k.length - 1][1];
}

var TRACES = [
  { name: 'motorway-dense', seed: 11, duration: 300, aMax: 1.2, dMax: 2.5, tau: 3, wobble: 0.35, csv: false,
    description: 'Dense motorway: waves between 95 and 55 km/h every minute or so, one firm slow-down (-2.5 m/s²).',
    knots: [[0, 95], [30, 95], [42, 60], [55, 62], [75, 98], [100, 100], [108, 70], [120, 72], [140, 95], [170, 92], [176, 55], [190, 58], [215, 96], [260, 100], [270, 80], [285, 95], [300, 95]] },
  { name: 'motorway-flow', seed: 23, duration: 300, aMax: 1.0, dMax: 2.0, tau: 4, wobble: 0.25, csv: true,
    description: 'Free-flowing motorway around 125 km/h, one slow-down to 100 km/h behind a truck, a later speed-up to 135.',
    knots: [[0, 125], [60, 127], [80, 120], [95, 100], [130, 102], [150, 128], [200, 130], [230, 135], [300, 133]] },
  { name: 'rural', seed: 37, duration: 300, aMax: 1.5, dMax: 2.5, tau: 3, wobble: 0.4, csv: false,
    description: 'Rural road: 85-100 km/h, slow-downs for curves (70), a village at 50 km/h, a turn behind a slow car.',
    knots: [[0, 85], [20, 95], [40, 95], [48, 70], [60, 72], [70, 92], [110, 95], [125, 50], [170, 50], [185, 90], [220, 95], [228, 60], [240, 62], [255, 90], [300, 92]] },
  { name: 'town', seed: 41, duration: 300, aMax: 1.8, dMax: 3.0, tau: 2.5, wobble: 0.5, csv: false,
    description: 'Town: 30-55 km/h with three stops at lights (below the cruise minimum: out of the envelope by design).',
    knots: [[0, 45], [20, 50], [35, 0], [55, 0], [70, 45], [100, 52], [115, 30], [125, 32], [140, 50], [160, 0], [185, 0], [200, 48], [240, 50], [255, 0], [270, 0], [285, 40], [300, 45]] }
];

if (require.main === module) {
  TRACES.forEach(function (tr) {
    var s = synth(tr);
    if (tr.csv) {
      var lines = ['# ' + tr.name + ' (synthetic): ' + tr.description, 't,v'];
      s.v.forEach(function (v, i) { lines.push((Math.round(i * s.dt * 10) / 10) + ',' + v); });
      fs.writeFileSync(path.join(__dirname, tr.name + '.csv'), lines.join('\n') + '\n');
    } else {
      fs.writeFileSync(path.join(__dirname, tr.name + '.json'), JSON.stringify({
        name: tr.name, synthetic: true, description: tr.description,
        t: s.v.map(function (_, i) { return Math.round(i * s.dt * 10) / 10; }), v: s.v
      }) + '\n');
    }
  });
  console.log('wrote', TRACES.length, 'traces');
}
module.exports = { TRACES: TRACES, synth: synth };
