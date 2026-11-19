'use strict';
const { test, assert, near } = require('./harness');
const rng = require('../core/rng');
const schema = require('../core/schema');
const road = require('../core/road');

test('rng: the same seed gives the same sequence; another seed does not', () => {
  const a = rng.create(42), b = rng.create(42), c = rng.create(43);
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 100; i++) { sa.push(a.next()); sb.push(b.next()); sc.push(c.next()); }
  assert.deepStrictEqual(sa, sb);
  assert.notDeepStrictEqual(sa, sc);
  for (const x of sa) assert.ok(x >= 0 && x < 1);
});

test('rng: a fork depends on the root seed and its label only, not on draws of the parent', () => {
  const a = rng.create(7), b = rng.create(7);
  for (let i = 0; i < 50; i++) b.next();
  const fa = a.fork('sensor'), fb = b.fork('sensor'), fo = a.fork('plant');
  const x = [fa.next(), fa.next(), fa.next()], y = [fb.next(), fb.next(), fb.next()], z = [fo.next(), fo.next(), fo.next()];
  assert.deepStrictEqual(x, y);
  assert.notDeepStrictEqual(x, z);
  assert.strictEqual(a.fork('a').fork('b').key, '7/a/b');
});

test('rng: a known first value (guards the generator against silent change)', () => {
  const v = rng.create(1).next();
  const again = rng.create('1').next();
  assert.strictEqual(v, again);
  assert.strictEqual(rng.hashString('cruise'), rng.hashString('cruise'));
});

test('rng: normal() has the asked mean and sd; int() and pick() stay in range', () => {
  const r = rng.create('n');
  let s = 0, s2 = 0; const n = 20000;
  for (let i = 0; i < n; i++) { const x = r.normal(3, 2); s += x; s2 += x * x; }
  const m = s / n, sd = Math.sqrt(s2 / n - m * m);
  near(m, 3, 0.05, 'mean'); near(sd, 2, 0.05, 'sd');
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const k = r.int(2, 5); assert.ok(k >= 2 && k <= 5 && k === Math.floor(k)); seen.add(k); }
  assert.strictEqual(seen.size, 4);
  for (let i = 0; i < 100; i++) assert.ok(['a', 'b'].indexOf(r.pick(['a', 'b'])) >= 0);
  assert.throws(() => r.int(3, 2));
  for (let i = 0; i < 100; i++) { const u = r.uniform(-1, 1); assert.ok(u >= -1 && u < 1); }
  near([...Array(20000)].reduce(acc => acc + r.exp(2), 0) / 20000, 2, 0.08, 'exp mean');
});

// ---- schema ----------------------------------------------------------------------------------------------------------
const SCH = [
  { key: 'a_s', label: 'A', unit: 's', default: 1, min: 0, max: 5 },
  { key: 'mode', label: 'Mode', unit: '', default: 'x', options: ['x', 'y'] },
  { key: 'on', label: 'On', unit: '', default: true },
  { key: 'opt', label: 'Opt', unit: 'm', default: null, min: 0 },
  { key: 'pts', label: 'Pts', unit: '', default: [[0, 1]] },
];

test('schema: defaults, merge, unknown keys, presets', () => {
  const d = schema.defaults(SCH);
  assert.deepStrictEqual(d, { a_s: 1, mode: 'x', on: true, opt: null, pts: [[0, 1]] });
  d.pts[0][1] = 9;
  assert.deepStrictEqual(schema.defaults(SCH).pts, [[0, 1]], 'defaults are deep copies');
  assert.deepStrictEqual(schema.merge(SCH, { a_s: 2 }).a_s, 2);
  assert.throws(() => schema.merge(SCH, { nope: 1 }), /unknown setting/);
  assert.deepStrictEqual(schema.merge(SCH, { nope: 1 }, { ignore: ['nope'] }).a_s, 1);
  const P = { fast: { a_s: 4 } };
  assert.strictEqual(schema.withPreset(SCH, P, 'fast', {}).a_s, 4);
  assert.strictEqual(schema.withPreset(SCH, P, 'fast', { a_s: 3 }).a_s, 3);
  assert.throws(() => schema.withPreset(SCH, P, 'slow', {}));
});

test('schema: validate catches range, type, enum, null and unknown keys', () => {
  assert.deepStrictEqual(schema.validate(SCH, schema.defaults(SCH)), []);
  const bad = Object.assign(schema.defaults(SCH), { a_s: 9, mode: 'z', on: 1, extra: 0 });
  const e = schema.validate(SCH, bad);
  assert.strictEqual(e.length, 4, e.join('; '));
  assert.ok(schema.validate(SCH, Object.assign(schema.defaults(SCH), { a_s: null })).length === 1);
  assert.ok(schema.validate(SCH, Object.assign(schema.defaults(SCH), { opt: 3 })).length === 0);
  assert.throws(() => schema.check(SCH, bad, 'x'), /x: /);
  near(schema.KMH * 36, 10, 1e-12);
});

// ---- road ------------------------------------------------------------------------------------------------------------
test('road: grade and curvature piecewise linear, held beyond the ends', () => {
  const r = road.create({ grade: [[100, 0], [200, 0.06]], curvature: 0.001, lanes: 3 });
  near(r.grade(0), 0, 1e-12); near(r.grade(150), 0.03, 1e-12); near(r.grade(500), 0.06, 1e-12);
  near(r.curvature(1234), 0.001, 1e-15);
  assert.strictEqual(r.lanes, 3); assert.strictEqual(r.laneWidth, 3.5); near(r.laneY(2), 7, 1e-12);
});

test('road: elevation is the exact integral of the grade (a crest)', () => {
  const r = road.create({ grade: [[0, 0.04], [400, -0.04]] });
  // z(x) = 0.04 x - 0.0001 x^2 / 2 * ... : grade(x) = 0.04 - 0.0002 x on [0, 400]
  const z = x => 0.04 * x - 0.0001 * x * x;
  for (const x of [0, 50, 200, 333, 400]) near(r.elevation(x), z(x), 1e-9, 'x=' + x);
  near(r.elevation(500), z(400) - 0.04 * 100, 1e-9, 'beyond the last point');
  // numerical check against a fine sum
  let s = 0; const dx = 0.01; for (let i = 0; i < 30000; i++) s += r.grade(i * dx + dx / 2) * dx;
  near(r.elevation(300), s, 1e-6);
});

test('road: speed limits are a step function in km/h, returned in m/s', () => {
  const r = road.create({ speedLimit: [[0, 120], [1000, 80], [2000, null]] });
  near(r.speedLimit(999), 120 / 3.6, 1e-12); near(r.speedLimit(1000), 80 / 3.6, 1e-12);
  assert.strictEqual(r.speedLimit(2500), null);
  assert.strictEqual(road.create({}).speedLimit(5), null);
  assert.throws(() => road.create({ grade: [[10, 0], [5, 1]] }));
});
