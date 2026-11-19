'use strict';
// SU2: ui/batch.js — reading batch files of any plausible shape, metric direction and margins, the
// scenario matrix, heat-map axes and binning, preset marks, the frontier, the tornado, the tuning
// table, config patches, the in-page plan runner.   node tools/cruise-sim/tests/batch.test.js
const { test, assert, near } = require('./stubs/su2-harness');
const B = require('../ui/batch.js');
const C = require('../ui/charts.js');
const fx = require('./fixtures/su2-fixture.js');
const M = require('./stubs/fake-modules.js');

function run(o) { return Object.assign({ scenario: 'D.x', family: 'D', params: {}, metrics: {}, verdict: { pass: true, failed: [] } }, o); }

test('normalizeBatch reads SU2\'s format, results: [...], a bare array and a single result', () => {
  const b = B.normalizeBatch(fx.makeBatch());
  assert.deepStrictEqual(b.studies, { matrix: 22, map: 1408, sensitivity: 396, tuning: 792 });
  assert.strictEqual(b.plant.assumed, true);
  assert.ok(b.presets.liftoff);
  assert.strictEqual(B.normalizeBatch({ results: [run({})] }).runs.length, 1);
  assert.strictEqual(B.normalizeBatch([run({}), run({})]).runs.length, 2);
  const single = B.normalizeBatch({ meta: { config: { scenario: { id: 'A.free' } } }, metrics: { minGap_m: 3 }, verdict: { pass: true } });
  assert.strictEqual(single.runs[0].scenario, 'A.free');
  const none = B.normalizeBatch({ foo: 1 });
  assert.strictEqual(none.runs.length, 0);
  assert.ok(/no runs/.test(none.warnings[0]));
  assert.ok(/without a verdict/.test(B.normalizeBatch([{ scenario: 'A' }]).warnings[0]));
});

test('normalizeRun understands SC3\'s concrete scenarios (base, variant, reaction, configPatch)', () => {
  const r = B.normalizeRun({ id: 'D.brake#a=-3/react', scenario: { base: 'D.brake', family: 'D', variant: { 'params.a': -3 }, label: 'a=-3', reaction: 'react', decide: ['minGap_m'] },
    configPatch: { driver: { reactionCase: 'nominal' } }, metrics: { minGap_m: 1 }, verdict: { pass: false, failed: ['minGap_m'] } }, 0);
  assert.strictEqual(r.scenario, 'D.brake');
  assert.strictEqual(r.label, 'a=-3 · react');
  assert.deepStrictEqual(r.params, { 'driver.reactionCase': 'nominal' });
  assert.deepStrictEqual(r.decide, ['minGap_m']);
  assert.ok(r.concrete);
  const t = B.normalizeRun({ id: 'B.approach#dv=30', metrics: {} }, 1);
  assert.strictEqual(t.scenario, 'B.approach');
  assert.strictEqual(t.label, 'dv=30');
  assert.strictEqual(B.normalizeRun({ side: 'low', param: 'p' }, 0).study, 'sensitivity');
  assert.strictEqual(B.normalizeRun({ set: 'T1' }, 0).study, 'tuning');
});

test('studyRuns: a tagged study, or every untagged run', () => {
  const b = B.normalizeBatch([run({ study: 'map' }), run({ study: 'tuning', set: 1 }), run({})]);
  assert.strictEqual(B.studyRuns(b, 'map').length, 1);
  assert.strictEqual(B.studyRuns(b, 'matrix').length, 1);         // the untagged one
  const plain = B.normalizeBatch([run({}), run({})]);
  assert.strictEqual(B.studyRuns(plain, 'map').length, 2);
});

test('metric direction from metrics.BY_KEY / SCHEMA, else from the name', () => {
  assert.strictEqual(B.metricOp('minTimeGap_s', M), '>=');
  assert.strictEqual(B.metricOp('peakDecel_mps2', M), '<=');
  assert.strictEqual(B.metricOp('collision', M), 'false');
  assert.strictEqual(B.metricOp('minFoo', {}), '>=');
  assert.strictEqual(B.metricOp('accelRms', {}), '<=');
  assert.strictEqual(B.metricOp('followerCollision', {}), 'false');
  assert.strictEqual(B.metricOp('whatever', {}), null);
});

test('margins: positive passes, negative fails, relative to the threshold', () => {
  near(B.margin('minTimeGap_s', 1.5, null, M), 0.5, 1e-9);
  near(B.margin('minTimeGap_s', 0.5, { minTimeGap_s: 1 }, M), -0.5, 1e-9);
  near(B.margin('peakDecel_mps2', 3.5 * 1.1, null, M), -0.1, 1e-9);
  assert.strictEqual(B.margin('collision', false, null, M), 1);
  assert.strictEqual(B.margin('collision', true, null, M), -1);
  assert.ok(isNaN(B.margin('minTimeGap_s', null, null, M)));
  assert.ok(isNaN(B.margin('mystery', 3, null, {})));
});

test('the deciding metric: the first failed one, else the one closest to failing', () => {
  const failed = run({ metrics: { minTimeGap_s: 0.4, minTTC_s: 2 }, verdict: { pass: false, failed: ['minTTC_s', 'minTimeGap_s'] } });
  assert.strictEqual(B.decidingMetric(failed, null, M).name, 'minTTC_s');
  const ok = run({ decide: ['minTimeGap_s', 'minTTC_s', 'collision'], metrics: { minTimeGap_s: 1.1, minTTC_s: 8, collision: false } });
  const d = B.decidingMetric(ok, null, M);
  assert.strictEqual(d.name, 'minTimeGap_s');
  near(d.margin, 0.1, 1e-9);
});

test('matrix: families, scenario rows, variant cells in numeric order, counts', () => {
  const runs = [-6, -0.5, -2, -1].map((a) => run({ scenario: 'D.brake', variant: { a: a }, label: 'a=' + a, verdict: { pass: a > -1.5, failed: a > -1.5 ? [] : ['minGap_m'] }, metrics: { minGap_m: 3 + a } }))
    .concat([run({ scenario: 'B.app', family: 'B', label: 'x', verdict: null }), run({ scenario: 'F.out', family: 'F', scope: 'warnOnly' })]);
  const mm = B.matrixModel(B.normalizeBatch(runs).runs, { modules: M });
  assert.deepStrictEqual(mm.families.map((f) => f.family), ['B', 'D', 'F']);
  const d = mm.families[1].rows[0];
  assert.deepStrictEqual(d.cells.map((c) => c.label), ['a=-6', 'a=-2', 'a=-1', 'a=-0.5']);
  assert.deepStrictEqual(d.cells.map((c) => c.state), ['fail', 'fail', 'pass', 'pass']);
  assert.strictEqual(d.cells[0].metric.name, 'minGap_m');
  assert.strictEqual(mm.families[0].rows[0].cells[0].state, 'na');
  assert.strictEqual(mm.families[2].rows[0].cells[0].scope, 'warnOnly');
  assert.deepStrictEqual([mm.pass, mm.fail, mm.na, mm.total], [3, 2, 1, 6]);
});

test('paramAxes lists varying parameters, numeric first', () => {
  const runs = B.normalizeBatch([run({ params: { a: 1, b: 'x', c: 5 } }), run({ params: { a: 2, b: 'y', c: 5 } })]).runs;
  assert.deepStrictEqual(B.paramAxes(runs).map((x) => [x.key, x.values]), [['a', [1, 2]], ['b', ['x', 'y']]]);
});

test('axes: one cell per value, or equal bins; pos() interpolates for preset marks', () => {
  const a = B.makeAxis('k', [0.2, 0.6, 0.4, 0.2, 1.0]);
  assert.strictEqual(a.binned, false);
  assert.deepStrictEqual(a.labels, ['0.2', '0.4', '0.6', '1']);
  assert.strictEqual(a.index(0.4), 1);
  assert.strictEqual(a.index(0.5), -1);
  near(a.pos(0.5), 1.5, 1e-9);
  near(a.pos(0.8), 2.5, 1e-9);
  near(a.pos(0.0), -1, 1e-9);                                     // outside, below
  const many = []; for (let i = 0; i <= 100; i++) many.push(i);
  const b = B.makeAxis('k', many, 10);
  assert.strictEqual(b.binned, true);
  assert.strictEqual(b.n, 10);
  assert.strictEqual(b.index(0), 0);
  assert.strictEqual(b.index(100), 9);                              // the top edge falls in the last bin
  assert.strictEqual(b.index(55), 5);
  near(b.pos(5), 0, 1e-9);                                          // centre of the first bin
  const cat = B.makeAxis('m', ['P2', 'P1']);
  assert.deepStrictEqual(cat.labels, ['P1', 'P2']);
  assert.strictEqual(cat.pos('P2'), 1);
});

test('heatGrid: pass share and metric aggregates per cell, empty cells null', () => {
  const runs = B.normalizeBatch([
    run({ params: { x: 1, y: 1 }, verdict: { pass: true }, metrics: { minGap_m: 4 } }),
    run({ params: { x: 1, y: 1 }, verdict: { pass: false, failed: ['minGap_m'] }, metrics: { minGap_m: 1 } }),
    run({ params: { x: 2, y: 1 }, verdict: { pass: true }, metrics: { minGap_m: 6 } }),
    run({ params: { x: 2, y: 2 }, verdict: { pass: true }, metrics: { minGap_m: 9 } }),
    run({ params: { x: 3 }, verdict: { pass: true } }),
  ]).runs;
  const g = B.heatGrid(runs, 'x', 'y', { kind: 'passShare' });
  assert.strictEqual(g.cells[0][0].value, 0.5);
  assert.strictEqual(g.cells[0][1].value, 1);
  assert.strictEqual(g.cells[1][0].value, null);
  assert.strictEqual(g.skipped, 1);
  const w = B.heatGrid(runs, 'x', 'y', { kind: 'metric', name: 'minGap_m', agg: 'worst' }, { modules: M });
  assert.strictEqual(w.cells[0][0].value, 1);                       // worst of '>=' = the minimum
  assert.strictEqual(w.op, '>=');
  const mean = B.heatGrid(runs, 'x', 'y', { kind: 'metric', name: 'minGap_m', agg: 'mean' });
  assert.strictEqual(mean.cells[0][0].value, 2.5);
  assert.deepStrictEqual([w.min, w.max], [1, 9]);
  // the ramp: for a '<=' metric a lower value is better (darker)
  const g2 = { min: 0, max: 10, value: { kind: 'metric' }, op: '<=' };
  assert.strictEqual(B.rampT(g2, 0), 1);
  assert.strictEqual(B.rampIndex(1), C.SEQ_N - 1);
});

test('the fixture map: presets land on their cells, and the presets come from the plant module when the batch has none', () => {
  const b = B.normalizeBatch(fx.makeBatch());
  const g = B.heatGrid(B.studyRuns(b, 'map'), 'plant.aMin_ms2', 'plant.deadTime_s', { kind: 'passShare' });
  assert.strictEqual(g.x.n, 8);
  assert.strictEqual(g.y.n, 8);
  const marks = B.presetMarks(g, b.presets);
  assert.deepStrictEqual(marks.map((m) => m.name), ['liftoff', 'mild', 'firm']);
  near(marks.find((m) => m.name === 'firm').fx, 1, 1e-9);           // -2.8 is the second value of the x axis
  near(marks[0].fy, 1.5, 1e-9);                                     // Td 0.5 between 0.4 and 0.6
  const fromModule = B.presetPoints({}, M);
  assert.strictEqual(fromModule.firm['plant.aMin_ms2'], -2.8);
  assert.strictEqual(fromModule.firm['plant.deadTime_s'], 0.5);     // the SCHEMA default where the preset says nothing
  assert.strictEqual(B.presetPoints({}, {}), null);
  // a preset off the map is flagged
  assert.strictEqual(B.presetMarks(g, { far: { 'plant.aMin_ms2': -9, 'plant.deadTime_s': 0.5 } })[0].outside, true);
});

test('frontier: edges between cells at the target and below it', () => {
  const g = { x: { n: 2, labels: ['a', 'b'] }, y: { n: 2, labels: ['c', 'd'] }, min: 0, max: 1, value: { kind: 'passShare' }, op: '>=',
    cells: [[{ value: 1 }, { value: 0.5 }], [{ value: 1 }, { value: null }]] };
  const segs = B.frontier(g, 1);
  assert.deepStrictEqual(segs, [{ x0: 0.5, y0: -0.5, x1: 0.5, y1: 0.5 }]);
  assert.deepStrictEqual(B.frontierText(g, 1), [{ y: 'c', ok: ['a'] }, { y: 'd', ok: ['a'] }]);
});

test('layoutHeatmap: one rect per cell, readable text, a working hit test', () => {
  const b = B.normalizeBatch(fx.makeBatch());
  const g = B.heatGrid(B.studyRuns(b, 'map'), 'plant.aMin_ms2', 'plant.deadTime_s', { kind: 'passShare' });
  const lay = B.layoutHeatmap(g, { box: { x: 0, y: 0, w: 700, h: 360 }, marks: B.presetMarks(g, b.presets), target: 1 });
  const cells = lay.ops.filter((o) => o.op === 'rect' && /^seq\d+$/.test(o.fill) && o.w < 100);
  assert.ok(cells.length >= 64, 'cells ' + cells.length);
  lay.ops.filter((o) => o.op === 'text' && /^seqtxt/.test(o.fill)).forEach((o) => assert.ok(/%$/.test(o.text)));
  const hit = lay.cellAt(lay.pb.x + 1, lay.pb.y + lay.pb.h - 1);
  assert.deepStrictEqual([hit.i, hit.j], [0, 0]);
  assert.strictEqual(lay.cellAt(0, 0), null);
  const svg = C.renderSvg(lay.ops, 700, 360);
  assert.ok(svg.indexOf('liftoff') > 0 && svg.indexOf('var(--su2-seqtxt') > 0);
});

test('tornado: bars sorted by effect, verdict changes counted per scenario variant', () => {
  const mk = (param, side, pass, label) => run({ param: param, side: side, label: label, verdict: { pass: pass, failed: pass ? [] : ['x'] }, params: { [param]: side === 'low' ? 0.7 : side === 'high' ? 1.3 : 1 } });
  const runs = B.normalizeBatch([
    mk('a', 'base', true, 'v1'), mk('a', 'base', false, 'v2'),
    mk('a', 'low', false, 'v1'), mk('a', 'low', false, 'v2'),
    mk('a', 'high', true, 'v1'), mk('a', 'high', true, 'v2'),
    mk('b', 'base', true, 'v1'), mk('b', 'base', false, 'v2'),
    mk('b', 'low', true, 'v1'), mk('b', 'low', false, 'v2'),
    mk('b', 'high', true, 'v1'), mk('b', 'high', false, 'v2'),
  ]).runs;
  const t = B.tornadoModel(runs, { kind: 'passShare' }, M);
  assert.deepStrictEqual(t.bars.map((x) => x.param), ['a', 'b']);
  const a = t.bars[0];
  assert.deepStrictEqual([a.low, a.base, a.high, a.delta], [0, 0.5, 1, 0.5]);
  assert.deepStrictEqual([a.changedLow, a.changedHigh, a.flipsLow, a.flipsHigh], [1, 1, true, true]);
  assert.deepStrictEqual([t.bars[1].changedLow, t.bars[1].changedHigh], [0, 0]);
  assert.strictEqual(a.lowValue, 0.7);
  const lay = B.layoutTornado(t, { box: { w: 600 } });
  assert.ok(lay.ops.some((o) => o.op === 'text' && o.text === '⚑1'));
});

test('tornado on the fixture: a metric measure uses its worst value', () => {
  const b = B.normalizeBatch(fx.makeBatch());
  const t = B.tornadoModel(B.studyRuns(b, 'sensitivity'), { kind: 'metric', name: 'minTimeGap_s' }, M);
  assert.strictEqual(t.bars.length, 6);
  assert.ok(t.bars.every((x) => x.delta >= 0));
  for (let i = 1; i < t.bars.length; i++) assert.ok(t.bars[i - 1].delta >= t.bars[i].delta);
});

test('tuning table: pass share first, comfort cost second, Pareto marks, varying vs fixed columns', () => {
  const runs = B.normalizeBatch([
    run({ set: 'A', params: { 'c.h': 2, 'c.d0': 5 }, verdict: { pass: true }, metrics: { accelRms_mps2: 0.5, peakDecel_mps2: 2 } }),
    run({ set: 'A', params: { 'c.h': 2, 'c.d0': 5 }, verdict: { pass: false, failed: ['x'] }, scenario: 'E.y', metrics: { accelRms_mps2: 0.3, peakDecel_mps2: 3 } }),
    run({ set: 'B', params: { 'c.h': 3, 'c.d0': 5 }, verdict: { pass: true }, metrics: { accelRms_mps2: 0.2, peakDecel_mps2: 1 } }),
    run({ set: 'B', params: { 'c.h': 3, 'c.d0': 5 }, verdict: { pass: true }, metrics: { accelRms_mps2: 0.2, peakDecel_mps2: 1 } }),
    run({ set: 'C', params: { 'c.h': 1.5, 'c.d0': 5 }, verdict: { pass: true }, metrics: { accelRms_mps2: 0.9, peakDecel_mps2: 3 } }),
  ]).runs;
  const tt = B.tuningTable(runs, { modules: M });
  assert.deepStrictEqual(tt.rows.map((r) => r.set), ['B', 'C', 'A']);
  assert.deepStrictEqual(tt.varying, ['c.h']);
  assert.deepStrictEqual(tt.fixed, [{ key: 'c.d0', value: 5 }]);
  assert.deepStrictEqual(tt.rows.map((r) => r.pareto), [true, false, false]);
  near(tt.rows[0].comfort.accelRms_mps2, 0.2, 1e-9);
  near(tt.rows[2].comfort.peakDecel_mps2, 3, 1e-9);                // max over the set
  near(tt.rows[0].cost, (0.2 / 0.5 + 1 / 3.5) / 2, 1e-9);           // thresholds from the metrics SCHEMA
  assert.deepStrictEqual(tt.rows[2].failedScenarios, ['E.y']);
});

test('paramsPatch writes dotted paths into whole module objects, keeping their other keys', () => {
  const p = B.paramsPatch({ controller: { h: 2, d0: 5 }, plant: { preset: 'mild' } }, { 'controller.h': 2.5, 'plant.aMin_ms2': -1, seed: 3, 'a.b.c': 1 });
  assert.deepStrictEqual(p, { controller: { h: 2.5, d0: 5 }, plant: { preset: 'mild', aMin_ms2: -1 }, seed: 3, a: { b: { c: 1 } } });
});

test('runConfig: the run\'s own config, else base + grid point + the variant\'s patch with the concrete id', () => {
  const b = B.normalizeBatch({ base: { seed: 5, plant: { preset: 'firm' }, driver: { brakeLevel_ms2: 7 } }, runs: [
    run({ id: 'r1', config: { scenario: { id: 'D.brake' }, seed: 2 } }),
    run({ id: 'D.brake#a=-2,v0=90/react', scenario: 'D.brake', params: { 'plant.aMin_ms2': -1.5 } }),
    run({ id: 'X.custom#k=1', scenario: 'X.custom', params: { 'plant.aMin_ms2': -1 } }),
  ] });
  assert.deepStrictEqual(B.runConfig(b.runs[0], b, M), { scenario: { id: 'D.brake' }, seed: 2 });
  assert.deepStrictEqual(B.runConfig(b.runs[1], b, M), { seed: 5, plant: { preset: 'firm', aMin_ms2: -1.5 }, driver: { brakeLevel_ms2: 7, reactionCase: 'nominal' }, scenario: { id: 'D.brake#a=-2,v0=90/react' } });
  // a scenario the catalogue cannot load: its id as given, over base + grid point
  assert.deepStrictEqual(B.runConfig(b.runs[2], b, M), { seed: 5, plant: { preset: 'firm', aMin_ms2: -1 }, driver: { brakeLevel_ms2: 7 }, scenario: { id: 'X.custom#k=1' } });
  const viaToConfig = B.runConfig(B.normalizeRun({ scenario: { base: 'E.cut', variant: {} } }, 0), b, { scenario: { toConfig: (sc, base) => ({ scenario: { inline: sc }, seed: base.seed }) } });
  assert.strictEqual(viaToConfig.seed, 5);
  assert.strictEqual(viaToConfig.scenario.inline.base, 'E.cut');
});

test('parseValues: ranges with steps, and lists', () => {
  assert.deepStrictEqual(B.parseValues('0..1:5'), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepStrictEqual(B.parseValues('-0.5..-3:6'), [-0.5, -1, -1.5, -2, -2.5, -3]);
  assert.deepStrictEqual(B.parseValues('1, 2,3 4'), [1, 2, 3, 4]);
  assert.deepStrictEqual(B.parseValues('2..4'), [2, 2.5, 3, 3.5, 4]);
  assert.deepStrictEqual(B.parseValues(''), []);
});

test('planJobs: scenarios expanded by the catalogue, crossed with the grid', () => {
  const sc = { expand: (id) => id === 'D' ? [{ id: 'D#1', base: 'D' }, { id: 'D#2', base: 'D' }] : [] };
  const jobs = B.planJobs({ scenarios: ['D', 'X'], grid: { a: [1, 2], b: [3] } }, sc);
  assert.strictEqual(jobs.length, 2 * 2 + 1 * 2);
  assert.deepStrictEqual(jobs[0].params, { a: 1, b: 3 });
  assert.strictEqual(jobs[5].concrete.id, 'X');
});

test('runPlan runs every job with the page\'s core and returns a normalised batch', (done) => {
  return new Promise((resolve, reject) => {
    const seen = [];
    const sim = { run: (cfg) => { seen.push(cfg); return { meta: { plant: { name: 'mild / P1', assumed: true } }, metrics: { minGap_m: cfg.plant.aMin_ms2 }, verdict: { pass: cfg.plant.aMin_ms2 < -1, failed: [] } }; } };
    const sc = { expand: (id) => [{ id: id + '#v', base: id, family: id.charAt(0), variant: { v: 1 }, label: 'v=1' }], toConfig: (c, base) => Object.assign({}, base, { scenario: { inline: c.id } }) };
    let progress = 0;
    B.runPlan({ scenarios: ['D.a', 'B.b'], grid: { 'plant.aMin_ms2': [-0.5, -2] }, base: { plant: { preset: 'mild' } }, study: 'map' }, { sim: sim, scenario: sc },
      (i) => { progress = i; },
      (b) => {
        try {
          assert.strictEqual(b.runs.length, 4);
          assert.strictEqual(progress, 4);
          assert.strictEqual(seen[1].plant.aMin_ms2, -2);
          assert.strictEqual(seen[1].plant.preset, 'mild');
          assert.strictEqual(b.runs[1].verdict.pass, true);
          assert.strictEqual(b.runs[0].study, 'map');
          assert.strictEqual(b.plant.name, 'mild / P1');
          assert.deepStrictEqual(B.paramAxes(b.runs).map((x) => x.key), ['plant.aMin_ms2']);
          resolve();
        } catch (e) { reject(e); }
      });
  });
});

test('runPlan records a run that throws as a failure and keeps going', () => {
  return new Promise((resolve, reject) => {
    const sim = { run: () => { throw new Error('boom'); } };
    B.runPlan({ scenarios: ['A'], grid: {} }, { sim: sim, scenario: { expand: () => [] } }, null, (b) => {
      try { assert.strictEqual(b.runs[0].verdict.pass, false); assert.ok(/boom/.test(b.runs[0].verdict.failed[0])); resolve(); } catch (e) { reject(e); }
    });
  });
});

test('effectiveValue reads the config, else the preset / SCHEMA default', () => {
  assert.strictEqual(B.effectiveValue({ plant: { aMin_ms2: -1 } }, 'plant.aMin_ms2', M), -1);
  assert.strictEqual(B.effectiveValue({ plant: { preset: 'firm' } }, 'plant.aMin_ms2', M), -2.8);
  assert.strictEqual(B.effectiveValue({}, 'controller.h', M), 2);
  assert.strictEqual(B.effectiveValue({}, 'nothing.here', M), undefined);
});

test('the shared current batch notifies its subscribers', () => {
  let got = null;
  const off = B.onCurrent((b) => { got = b; });
  B.setCurrent({ runs: [] });
  assert.deepStrictEqual(got, { runs: [] });
  off();
  B.setCurrent(null);
  assert.deepStrictEqual(got, { runs: [] });
  assert.strictEqual(B.current(), null);
});
