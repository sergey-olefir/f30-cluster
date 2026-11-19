'use strict';
const { test, assert, near } = require('./harness');
const V = require('../core/vehicles');
const road = require('../core/road');
const rng = require('../core/rng');
const fs = require('fs'), os = require('os'), path = require('path');
const KMH = 1 / 3.6, DT = 0.01;

function world(specs, events, opts) {
  opts = opts || {};
  const r = road.create(opts.road || { lanes: 3 });
  const ego = { x: 0, v: (opts.egoV === undefined ? 100 : opts.egoV) * KMH, a: 0, lane: opts.egoLane || 0, length: 4.7, width: 1.85, y: 0 };
  ego.y = ego.lane * r.laneWidth;
  const ev = [];
  const set = V.create(specs, events || [], { road: r, rng: rng.create(1), emit: (k, d, t) => ev.push(Object.assign({ kind: k, t }, d)), ego, dt: DT });
  const w = { t: 0, road: r, ego, others: set.list };
  function run(seconds, each) {
    const n = Math.round(seconds / DT);
    for (let k = 0; k < n; k++) {
      w.t = k * DT;
      if (each) each(w);
      set.step(w, DT);
      if (opts.egoMoves !== false) ego.x += ego.v * DT;
    }
    w.t = n * DT;
  }
  return { w, set, ev, run, ego };
}

test('vehicles: x0 is the bumper-to-bumper gap, ahead and behind; trueLead / follower / leaderOf', () => {
  const { w, set } = world([
    { id: 'lead', lane: 0, x0: 40, v0_kmh: 80 },
    { id: 'far', lane: 0, x0: 90, v0_kmh: 80, kind: 'truck' },
    { id: 'side', lane: 1, x0: 10, v0_kmh: 80 },
    { id: 'back', lane: 0, x0: -15, v0_kmh: 80 },
  ]);
  near(V.gap(w.ego, set.byId('lead')), 40, 1e-12);
  near(V.gap(w.ego, set.byId('far')), 90, 1e-12);
  near(V.gap(set.byId('back'), w.ego), 15, 1e-12);
  assert.strictEqual(V.trueLead(w).id, 'lead');
  assert.strictEqual(V.follower(w).id, 'back');
  assert.strictEqual(V.leaderOf(w, set.byId('back')), w.ego);
  assert.strictEqual(V.leaderOf(w, set.byId('lead')).id, 'far');
  assert.strictEqual(set.byId('far').length, 16.5);
  near(set.byId('side').y, 3.5, 1e-12);
});

test('vehicles: constant speed and piecewise speed move exactly', () => {
  const { w, set, run } = world([
    { id: 'c', lane: 1, x0: 0, v0_kmh: 72 },
    { id: 'p', lane: 2, x0: 0, v0_kmh: 36, profile: { type: 'piecewise', points: [[0, 36], [10, 72]] } },
  ]);
  const x0c = set.byId('c').x, x0p = set.byId('p').x;
  run(20);
  near(set.byId('c').x - x0c, 20 * 20, 1e-6);
  // 0..10 s: v from 10 to 20 m/s linear -> 150 m; 10..20 s: 200 m
  near(set.byId('p').x - x0p, 350, 1e-6);
  near(set.byId('p').v, 20, 1e-12);
});

test('vehicles: steps head for each target speed at the given rate; accel profile stops at zero', () => {
  const { set, run } = world([
    { id: 's', lane: 1, x0: 0, v0_kmh: 108, profile: { type: 'steps', steps: [[2, 36, 4]], accel_ms2: 1, decel_ms2: 3 } },
    { id: 'a', lane: 2, x0: 0, v0_kmh: 72, profile: { type: 'accel', points: [[1, -3]] } },
  ]);
  const s = set.byId('s'), a = set.byId('a');
  const trace = [];
  run(12, () => trace.push([s.v, a.v]));
  // s: 30 -> 10 m/s at 4 m/s² from t = 2: reached at t = 7
  near(trace[400][0], 30 - 4 * 2, 1e-9, 'mid-way at t = 4');
  near(trace[701][0], 10, 1e-9, 'there at t = 7');
  // a: 20 m/s at -3 from t = 1 -> 0 at t = 7.667, then stays
  near(trace[400][1], 20 - 3 * 3, 1e-9);
  assert.strictEqual(a.v, 0);
});

test('vehicles: sine profile and stop-and-go', () => {
  const { set, run } = world([
    { id: 's', lane: 1, x0: 0, v0_kmh: 90, profile: { type: 'sine', amp_kmh: 10, period_s: 20, t0: 0 } },
    { id: 'g', lane: 2, x0: 0, v0_kmh: 50, profile: { type: 'stopgo', vHigh_kmh: 50, vLow_kmh: 0, decel_ms2: 2, accel_ms2: 1, holdHigh_s: 5, holdLow_s: 3 } },
  ]);
  const vs = [], vg = [];
  run(60, () => { vs.push(set.byId('s').v); vg.push(set.byId('g').v); });
  near(vs[500], (90 + 10) * KMH, 1e-9, 'a quarter period');
  near(vs[1500], (90 - 10) * KMH, 1e-9);
  assert.ok(Math.min(...vg) === 0, 'stops');
  assert.ok(Math.abs(Math.max(...vg.slice(2000)) - 50 * KMH) < 1e-9, 'goes again');
});

test('vehicles: IDM follower settles at the analytic equilibrium gap', () => {
  const T = 1.5, s0 = 2, v0 = 120 * KMH, vl = 20;
  const { set, run } = world([
    { id: 'lead', lane: 1, x0: 200, v0_kmh: 72 },
    { id: 'f', lane: 1, x0: 120, v0_kmh: 72, profile: { type: 'idm', params: { v0_kmh: 120, T_s: T, s0_m: s0, noise_ms2: 0, reaction_s: 0 } } },
  ], [], { egoLane: 0, egoV: 0, egoMoves: false });
  run(300);
  const se = (s0 + vl * T) / Math.sqrt(1 - Math.pow(vl / v0, 4));
  near(V.gap(set.byId('f'), set.byId('lead')), se, 0.05);
  near(set.byId('f').v, vl, 1e-3);
});

test('vehicles: an IDM car stops behind a standing obstacle without touching it; reaction delay and noise run', () => {
  const { set, run } = world([
    { id: 'wall', lane: 1, x0: 300, kind: 'static' },
    { id: 'f', lane: 1, x0: 0, v0_kmh: 100, profile: { type: 'idm', params: { v0_kmh: 100, reaction_s: 0.5, noise_ms2: 0.1 } } },
  ], [], { egoLane: 0, egoV: 0, egoMoves: false });
  let minGap = Infinity;
  run(60, () => { minGap = Math.min(minGap, V.gap(set.byId('f'), set.byId('wall'))); });
  assert.ok(minGap > 0.5, 'min gap ' + minGap);
  assert.ok(set.byId('f').v < 0.2);
  assert.strictEqual(set.byId('wall').v, 0);
});

test('vehicles: a cut-in moves y on a cosine, switches lane at the midpoint, places the car at gap_m', () => {
  const { set, run, ev, w } = world([{ id: 'c', lane: 1, x0: 5, v0_kmh: 90 }],
    [{ t: 2, kind: 'cutIn', vehicle: 'c', duration_s: 3, gap_m: 25, v_kmh: 80 }]);
  const c = set.byId('c');
  const lanes = [];
  run(6, ww => { lanes.push([ww.t, c.lane, c.y]); if (Math.abs(ww.t - 2.01) < 1e-9) near(V.gap(ww.ego, c), 25 - 20 * KMH * 0.01, 1e-9); });
  const at = t => lanes.find(l => Math.abs(l[0] - t) < 1e-9);
  assert.strictEqual(at(3.4)[1], 1); assert.strictEqual(at(3.6)[1], 0);
  for (const t of [2.5, 3.49, 4.2]) near(at(t)[2], 3.5 - 3.5 * (1 - Math.cos(Math.PI * (t - 2) / 3)) / 2, 1e-9, 'y at ' + t);
  assert.strictEqual(c.lane, 0); assert.strictEqual(c.lat, 0);
  near(c.v, 80 * KMH, 1e-9);
  assert.deepStrictEqual(ev.map(e => e.phase), ['start', 'end']);
  near(ev[1].t, 5, 1e-9);
  assert.strictEqual(V.trueLead(w).id, 'c');
});

test('vehicles: whenGap_m starts the change only when the gap has shrunk; cutOut goes to the neighbouring lane', () => {
  const { set, run, ev } = world([
    { id: 'slow', lane: 1, x0: 60, v0_kmh: 60 },
    { id: 'lead', lane: 0, x0: 50, v0_kmh: 100 },
  ], [{ kind: 'cutIn', vehicle: 'slow', whenGap_m: 20, duration_s: 2 }, { t: 1, kind: 'cutOut', vehicle: 'lead', duration_s: 2 }]);
  let gapAtStart = null;
  run(10, w => { if (gapAtStart === null && set.byId('slow').lc) gapAtStart = V.gap(w.ego, set.byId('slow')); });
  assert.ok(gapAtStart <= 20 && gapAtStart > 19, 'gap at start ' + gapAtStart);
  assert.strictEqual(set.byId('lead').lane, 1);
  assert.strictEqual(ev.filter(e => e.phase === 'start').length, 2);
});

test('vehicles: replay traces from JSON and CSV, linear in time, t0 offset', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-trace-'));
  fs.writeFileSync(path.join(dir, 'a.csv'), '# a trace\nt,v_kmh\n0,72\n10,36\n20,36\n');
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ t: [0, 5], v: [10, 20] }));
  const a = V.loadTrace(path.join(dir, 'a.csv')), b = V.loadTrace(path.join(dir, 'b.json'));
  near(a.v[0], 20, 1e-12); near(a.v[1], 10, 1e-12); assert.deepStrictEqual(b.v, [10, 20]);
  assert.deepStrictEqual(V.parseTrace({ points: [[0, 36], [1, 72]] }).v, [10, 20]);
  assert.deepStrictEqual(V.parseTrace('t;v\n0;1\n1;2').v, [1, 2]);
  assert.throws(() => V.parseTrace('t,v\n1,1\n0,1'), /increase/);
  assert.throws(() => V.parseTrace('x,y\n1,1'), /header/);
  const { set, run } = world([{ id: 'r', lane: 1, x0: 0, profile: { type: 'replay', file: path.join(dir, 'a.csv'), t0: 5 } }]);
  near(set.byId('r').v, 15, 1e-12, 'starts at trace time 5');
  run(5);
  near(set.byId('r').v, 10, 1e-12);
  const { set: s2 } = world([{ id: 'r', lane: 1, x0: 0, profile: { type: 'replay', data: { t: [0, 1], v_kmh: [36, 36] } } }]);
  near(s2.byId('r').v, 10, 1e-12);
});

test('vehicles: errors are explicit (unknown profile, duplicate id, missing vehicle of an event)', () => {
  assert.throws(() => world([{ id: 'a', profile: { type: 'warp' } }]), /unknown profile/);
  assert.throws(() => world([{ id: 'a' }, { id: 'a' }]), /twice/);
  assert.throws(() => world([{ id: 'a' }], [{ t: 1, kind: 'cutIn', vehicle: 'b' }]), /no vehicle b/);
});
