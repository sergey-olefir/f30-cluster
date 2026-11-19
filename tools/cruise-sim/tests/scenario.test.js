'use strict';
// SC3: core/scenario.js and the catalogue (tools/cruise-sim/scenarios), the trace fixtures.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { test, assert, near } = require('./harness');
const sc = require('../core/scenario');
const ROOT = path.join(__dirname, '..');
function opt(name) { try { return require('../core/' + name); } catch (e) { return null; } }

test('expressions: arithmetic, precedence, comparisons, ternary, functions', () => {
  const env = { v: 90, dv: 30, a: -1.5 };
  near(sc.evalExpr('v-dv', env), 60, 1e-12);
  near(sc.evalExpr('5+2*v/3.6', env), 55, 1e-12);
  near(sc.evalExpr('-(2+3)*2', env), -10, 1e-12);
  near(sc.evalExpr('dv/3.6/abs(a)', env), 30 / 3.6 / 1.5, 1e-12);
  assert.strictEqual(sc.evalExpr('v-dv >= 30 && a < 0', env), 1);
  assert.strictEqual(sc.evalExpr('v < 30 || !1', env), 0);
  assert.strictEqual(sc.evalExpr('a < 0 ? 7 : 9', env), 7);
  near(sc.evalExpr('clamp(max(1, 2, 3) * 10, 0, 25) + min(4, 5) + round(2.6) + floor(-1.5) + sqrt(16) + pow(2, 3)', env), 25 + 4 + 3 - 2 + 4 + 8, 1e-12);
  assert.throws(() => sc.evalExpr('v + nope', env), /unknown name/);
  assert.throws(() => sc.evalExpr('v +* 2', env), /unexpected/);
  assert.throws(() => sc.evalExpr('foo(1)', env), /unknown function/);
});

test('resolveValue: "=expr", "{expr}" in strings, $repeat in arrays', () => {
  const r = sc.resolveValue({ a: '=v*2', id: 'p{k+1}', list: [0, { $repeat: '=n', $as: 'k', items: ['=k', 'x{k}'] }, 9] }, { v: 3, k: 4, n: 2 });
  assert.deepStrictEqual(r, { a: 6, id: 'p5', list: [0, 0, 'x0', 1, 'x1', 9] });
});

test('paths: get / set by index and by [id]', () => {
  const o = { vehicles: [{ id: 'lead', profile: { points: [[0, 90], [10, 60]] } }] };
  sc.setPath(o, 'vehicles[lead].profile.points[1][1]', 50);
  assert.strictEqual(sc.getPath(o, 'vehicles[0].profile.points[1][1]'), 50);
  sc.setPath(o, 'sensor.rateHz', 2);
  assert.strictEqual(o.sensor.rateHz, 2);
  assert.throws(() => sc.setPath(o, 'vehicles[nobody].x0', 1), /no element/);
});

const LIST = sc.list();
test('the catalogue: 12 families, every file valid, every family well populated', () => {
  const fams = {};
  LIST.forEach(e => { fams[e.family] = (fams[e.family] || 0) + 1; });
  assert.deepStrictEqual(Object.keys(fams).sort(), 'ABCDEFGHIJKL'.split(''));
  const min = { A: 5, B: 6, C: 8, D: 6, E: 6, F: 4, G: 10, H: 6, I: 5, J: 20, K: 2, L: 1 };   // the brief's table, at least
  Object.keys(min).forEach(f => assert.ok(fams[f] >= min[f], f + ' has ' + fams[f]));
  const bad = [];
  LIST.forEach(e => { const v = sc.validate(sc.raw(e.id)); if (!v.ok) bad.push(v.errors[0]); });
  assert.deepStrictEqual(bad, []);
});

test('the catalogue: every file says its scope, what decides it, has a name and a description', () => {
  LIST.forEach(e => {
    const t = sc.template(e.id);
    assert.ok(sc.SCOPES.indexOf(t.scope) >= 0, e.id);
    assert.ok(Array.isArray(t.decide) && (t.decide.length || t.family === 'L'), e.id + ' decide');
    assert.ok(t.name && t.description && t.description.length > 20, e.id);
    assert.strictEqual(path.basename(e.file, '.json'), e.id, 'file name = id');
  });
});

test('expansion: every variant is concrete, valid and uniquely named; ids round-trip through load()', () => {
  const seen = {};
  let n = 0;
  LIST.forEach(e => {
    const cs = sc.expand(e.id);
    assert.ok(cs.length > 0, e.id);
    cs.forEach((c, i) => {
      n++;
      assert.ok(!seen[c.id], 'duplicate id ' + c.id);
      seen[c.id] = true;
      if (i % 7 === 0) {
        const v = sc.validate(c);
        assert.ok(v.ok, c.id + ': ' + v.errors.join('; '));
        assert.ok(JSON.stringify(c).indexOf('"=') < 0, c.id + ' has an unresolved expression');
        if (e.family !== 'L') assert.strictEqual(sc.load(c.id).id, c.id);
      }
    });
  });
  assert.ok(n > 3000, 'runs: ' + n);
});

test('where: variants below the cruise minimum are dropped', () => {
  sc.expand('D.brake').forEach(c => assert.ok(c.params.v - c.params.dv >= 30, c.id));
  sc.expand('B.approach').forEach(c => assert.ok(c.params.v - c.params.dv >= 30, c.id));
});

test('$repeat: the platoon has n cars, each placed further ahead', () => {
  const c = sc.expand('C.platoon').find(x => x.params.n === 8 && x.params.v === 90);
  assert.deepStrictEqual(c.vehicles.map(v => v.id), ['lead', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  for (let i = 1; i < 8; i++) assert.ok(c.vehicles[i].x0 > c.vehicles[i - 1].x0);
  assert.strictEqual(c.vehicles[7].profile.type, 'piecewise');
});

test('extends: a J file keeps its host, overrides the params, appends the fault, and reduces over the worst time', () => {
  const t = sc.template('J.gapFreeze.D3');
  assert.deepStrictEqual(t.extendsChain, ['D.brake.hard']);
  const cs = sc.expand('J.gapFreeze.D3');
  const keys = {};
  cs.forEach(c => {
    assert.strictEqual(c.vehicles[0].id, 'lead');
    const f = c.events.filter(e => e.kind === 'fault');
    assert.strictEqual(f.length, 1);
    assert.strictEqual(f[0].fault, 'gapFreeze');
    assert.strictEqual(f[0].t, c.params.tf);
    assert.strictEqual(c.params.a, -3);
    keys[c.groupKey] = (keys[c.groupKey] || 0) + 1;
  });
  assert.deepStrictEqual(Object.keys(keys).sort(), ['J.gapFreeze.D3#v=120', 'J.gapFreeze.D3#v=90']);
  assert.strictEqual(keys['J.gapFreeze.D3#v=90'], 8 * 3, '8 injection times x 3 reaction cases');
});

test('reaction cases: warn-only scenarios run three ways and split their decision', () => {
  const cs = sc.expand('D.brake.hard').filter(c => c.key === 'D.brake.hard#v=120,dv=40,a=-4');
  assert.deepStrictEqual(cs.map(c => c.reaction).sort(), ['late', 'none', 'react']);
  const by = {};
  cs.forEach(c => { by[c.reaction] = c; });
  assert.deepStrictEqual(by.none.decide.sort(), ['missedWarning', 'warnLeadTime_s']);
  assert.deepStrictEqual(by.react.decide, ['collision']);
  assert.deepStrictEqual(by.late.decide, []);
  assert.strictEqual(by.react.configPatch.driver.reactionCase, 'nominal');
  assert.strictEqual(by.none.configPatch.driver.reactionCase, 'none');
  assert.ok(sc.expand('C.steady').every(c => c.reaction === 'none' && c.decide.indexOf('gapErrRmsRel') >= 0));
});

test('toConfig: scenario inline, duration, and the variant patch on top of the base', () => {
  const c = sc.expand('B.approach.rain')[0];
  const cfg = sc.toConfig(c, { plant: { preset: 'mild' }, sensor: { preset: 'clear', rateHz: 10 } });
  assert.strictEqual(cfg.sensor.preset, 'rain');
  assert.strictEqual(cfg.sensor.rateHz, 10);
  assert.strictEqual(cfg.plant.preset, 'mild');
  assert.strictEqual(cfg.scenario.inline.id, c.id);
  assert.strictEqual(cfg.duration, c.duration);
  assert.ok(!cfg.scenario.inline.configPatch);
  const g = sc.load('G.outliers');
  assert.ok(g.configPatch.sensor.outlierProb > 0, 'scenario-level config block resolved');
  const i = sc.expand('I.reaction.sweep').find(x => x.variant['config.driver.reactionMedian_s'] === 2.0 && x.variant['config.driver.brakeLevel_ms2'] === 4);
  assert.strictEqual(i.configPatch.driver.reactionMedian_s, 2.0);
  assert.strictEqual(i.configPatch.driver.reactionSigma, 0);
});

test('load(): a file id gives its runnable default variant', () => {
  const c = sc.load('D.brake');
  assert.strictEqual(c.base, 'D.brake');
  assert.strictEqual(c.vehicles[0].profile.points[2][1], 120 - 20);
  assert.ok(sc.validate(c).ok);
  assert.throws(() => sc.load('D.brake#v=1'), /unknown scenario variant/);
});

test('names agree with SC1 / SC2: fault kinds, driver reaction cases, swept config keys, sensor presets', () => {
  const failures = opt('failures'), driver = opt('driver'), sensor = opt('sensor'), plant = opt('plant'), controller = opt('controller'), command = opt('command'), warning = opt('warning');
  if (failures) sc.FAULT_KINDS.forEach(k => assert.ok(failures.KINDS[k], 'fault kind ' + k));
  if (driver) {
    const opts = driver.SCHEMA.find(s => s.key === 'reactionCase').options;
    ['react', 'late', 'none'].forEach(r => assert.ok(opts.indexOf(sc.PATCHES['reaction.' + r].driver.reactionCase) >= 0, r));
  }
  if (sensor) {
    const pres = Object.keys(sensor.PRESETS || {});
    Object.keys(sc.PATCHES).filter(k => /^sensing\./.test(k)).forEach(k => { const p = sc.PATCHES[k].sensor; if (p) assert.ok(pres.indexOf(p.preset) >= 0, k); });
  }
  if (command) assert.ok(command.PRESETS.worst, 'command preset worst');
  const mods = { sensor, plant, controller, command, warning, driver };
  const keys = {};
  LIST.forEach(e => {
    const t = sc.template(e.id);
    Object.keys(t.sweep || {}).filter(k => /^config\./.test(k)).forEach(k => { keys[k.slice(7)] = 1; });
    Object.keys(t.config || {}).forEach(m => Object.keys(t.config[m]).forEach(k => { keys[m + '.' + k] = 1; }));
  });
  Object.keys(keys).forEach(k => {
    const [m, key] = k.split('.');
    if (mods[m]) assert.ok(mods[m].SCHEMA.find(s => s.key === key), 'config key ' + k + ' is not in ' + m + '.SCHEMA');
  });
});

test('every fault in the catalogue is a known kind; every replay file exists and parses', () => {
  const vehicles = opt('vehicles');
  LIST.forEach(e => {
    if (e.family === 'L') return;
    const c = sc.load(e.id);
    c.events.filter(x => x.kind === 'fault').forEach(f => assert.ok(sc.FAULT_KINDS.indexOf(f.fault) >= 0, e.id + ' ' + f.fault));
    c.vehicles.filter(v => v.profile.type === 'replay').forEach(v => {
      const p = path.join(ROOT, v.profile.file);
      assert.ok(fs.existsSync(p), p);
      if (vehicles) { const tr = vehicles.loadTrace(v.profile.file); assert.ok(tr.t.length > 1000 && tr.v.every(x => x >= 0 && x < 60)); }
    });
  });
});

test('trace fixtures are reproducible byte for byte from make.js, small, and marked synthetic', () => {
  const make = require('../fixtures/traces/make.js');
  make.TRACES.forEach(tr => {
    const s1 = make.synth(tr), s2 = make.synth(tr);
    assert.deepStrictEqual(s1.v, s2.v);
    const f = path.join(ROOT, 'fixtures', 'traces', tr.name + (tr.csv ? '.csv' : '.json'));
    const size = fs.statSync(f).size;
    assert.ok(size < 40000, f + ' is ' + size + ' bytes');
    if (!tr.csv) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      assert.strictEqual(j.synthetic, true);
      assert.deepStrictEqual(j.v, s1.v);
    } else {
      const lines = fs.readFileSync(f, 'utf8').trim().split('\n').filter(l => l[0] !== '#');
      assert.strictEqual(lines[0], 't,v');
      assert.strictEqual(+lines[lines.length - 1].split(',')[1], s1.v[s1.v.length - 1]);
    }
  });
});

test('family L expands into weighted episodes of the other families', () => {
  const eps = sc.expand('L.commute');
  assert.ok(eps.length > 50);
  const roads = {};
  eps.forEach(c => { assert.ok(c.mixed && c.mixed.weight > 0); roads[c.mixed.road] = 1; assert.strictEqual(c.family, 'L'); });
  assert.deepStrictEqual(Object.keys(roads).sort(), ['motorway', 'rural', 'town']);
});

test('browser path: scenario.js, metrics.js and mixed.js load as classic scripts in one context, with the bundle', () => {
  const ctx = { self: {}, console };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(sc.bundleJs(), ctx);
  ['metrics', 'scenario', 'mixed'].forEach(n => vm.runInContext(fs.readFileSync(path.join(ROOT, 'core', n + '.js'), 'utf8'), ctx, { filename: n + '.js' }));
  const S = ctx.CS.scenario;
  assert.strictEqual(S.list().length, LIST.length);
  const c = S.load('D.brake#v=90,dv=20,a=-1');
  assert.strictEqual(c.vehicles[0].profile.points[2][1], 70);
  assert.strictEqual(S.expand('L.town').length, sc.expand('L.town').length);
  assert.ok(ctx.CS.metrics.SCHEMA.length > 20);
});
