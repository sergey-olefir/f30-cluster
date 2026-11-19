'use strict';
// SU2: ui/report-view.js — the self-contained HTML report, the metrics-against-thresholds rows, the
// worst cases, and the ranked "measure this first" list.   node tools/cruise-sim/tests/report-view.test.js
const { test, assert } = require('./stubs/su2-harness');
const R = require('../ui/report-view.js');
const B = require('../ui/batch.js');
const fx = require('./fixtures/su2-fixture.js');
const M = require('./stubs/fake-modules.js');

const result = fx.makeResult({ duration: 40 });
const batch = fx.makeBatch();

test('the report is one self-contained page: no script, no external resource, both themes', () => {
  const html = R.buildReport({ config: result.meta.config, result: result, batch: batch, modules: M, created: '2026-11-19T17:00:00Z' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.indexOf('<script') < 0, 'no script');
  assert.ok(!/\b(src|href)=["']?(https?:)?\/\//.test(html), 'no external resource');
  assert.ok(html.indexOf('@media (prefers-color-scheme: dark)') > 0);
  assert.ok(html.indexOf(':root[data-theme="dark"] .su2') > 0);
  assert.ok(html.indexOf('NaN') < 0, 'no NaN printed');
  ['Summary', 'Measure this first on the car', 'The current run', 'Scenario matrix', 'Feasibility map', 'Sensitivity', 'Tuning sweep', 'Worst cases', 'Configuration'].forEach((h) => assert.ok(html.indexOf('<h2>' + h) > 0, h));
  assert.ok(html.indexOf('lang="uk"') > 0 && html.indexOf('Підсумок') > 0, 'the Ukrainian summary');
  // balanced svg
  assert.strictEqual((html.match(/<svg/g) || []).length, (html.match(/<\/svg>/g) || []).length);
});

test('an assumed plant is said so on top and in the summary, never worded as a verdict', () => {
  const html = R.buildReport({ config: result.meta.config, result: result, batch: batch, modules: M });
  assert.ok(/Assumed plant: liftoff \(P1\)\./.test(html));
  assert.ok(/they are not a verdict/.test(html));
  assert.ok(/with an assumed plant/.test(html));
  assert.ok(/Модель круїзу припущена/.test(html));
  const ident = JSON.parse(JSON.stringify(fx.toJson(result)));
  ident.meta.plant = { name: 'G20 DCC 2026-12', assumed: false };
  const h2 = R.buildReport({ config: ident.meta.config, result: ident, modules: M });
  assert.ok(/Identified plant: G20 DCC 2026-12/.test(h2));
  assert.ok(h2.indexOf('Assumed plant') < 0);
});

test('metrics rows: value against threshold, deciding failures marked', () => {
  const rows = R.metricsRows(result, result.meta.config, M);
  const tg = rows.find((r) => r.name === 'minTimeGap_s');
  assert.strictEqual(tg.threshold, 1);
  assert.strictEqual(tg.op, '>=');
  assert.strictEqual(tg.state, 'fail');
  const col = rows.find((r) => r.name === 'collision');
  assert.strictEqual(col.op, 'false');
  assert.strictEqual(col.threshold, null);
  assert.strictEqual(col.state, 'pass');
  const rows2 = R.metricsRows(result, { thresholds: { minTimeGap_s: 0.2 } }, M);
  assert.strictEqual(rows2.find((r) => r.name === 'minTimeGap_s').threshold, 0.2);
});

test('worst cases: failed first, one per scenario', () => {
  const w = R.worstRuns(B.normalizeBatch(batch), 5, M);
  assert.strictEqual(w.length, 5);
  assert.ok(w.every((x) => x.run.verdict && !x.run.verdict.pass));
  assert.strictEqual(new Set(w.map((x) => x.run.scenario)).size, 5);
});

test('measure first: ranked by verdict changes, car parameters before tuning ones', () => {
  const t = B.tornadoModel(B.studyRuns(B.normalizeBatch(batch), 'sensitivity'), { kind: 'passShare' }, M);
  const mf = R.measureFirst(t);
  assert.strictEqual(mf[0].param, 'plant.aMin_ms2');
  assert.ok(/DCC brake/.test(mf[0].en) && /DCC гальмує/.test(mf[0].uk));
  const firstTuning = mf.findIndex((x) => /^controller\./.test(x.param));
  const lastCar = mf.map((x) => /^(plant|sensor|command)\./.test(x.param)).lastIndexOf(true);
  assert.ok(firstTuning > lastCar, 'tuning after car parameters');
  mf.forEach((x, i) => assert.strictEqual(x.rank, i + 1));
  // without a study: the parent brief's order, flagged as such
  const d = R.measureFirst(null);
  assert.deepStrictEqual(d.slice(0, 2).map((x) => x.param), ['plant.aMin_ms2', 'plant.deadTime_s']);
  assert.strictEqual(d[0].fromSensitivity, false);
  assert.ok(/^No car measurement/.test(R.measureFor('mystery.x').en));
});

test('a report with only a run, or only a batch, or nothing, still builds', () => {
  assert.ok(R.buildReport({ result: result, modules: M }).indexOf('The current run') > 0);
  const onlyBatch = R.buildReport({ batch: batch, modules: M });
  assert.ok(onlyBatch.indexOf('Scenario matrix') > 0 && onlyBatch.indexOf('The current run') < 0);
  const empty = R.buildReport({});
  assert.ok(empty.indexOf('parent brief') > 0, 'falls back to the parent brief\'s measuring order');
});

test('text from configs and batches is escaped', () => {
  const evil = fx.makeResult({ duration: 5, scenario: '<img src=x onerror=alert(1)>' });
  const html = R.buildReport({ result: evil, modules: M });
  assert.ok(html.indexOf('<img src=x') < 0);
  assert.ok(html.indexOf('&lt;img src=x') > 0);
});

test('the file name carries the date and time', () => {
  assert.strictEqual(R.reportFileName(new Date(2026, 10, 19, 7, 5)), 'cruise-sim-report-20261119-0705.html');
});
