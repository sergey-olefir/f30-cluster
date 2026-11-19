'use strict';
// SU2: the four views mounted on a minimal DOM (tests/stubs/mini-dom.js) with SU2's fake shell: they
// build, follow app events, and call the app the way CONTRACT.md / SU1's shell expect.
// Not a browser: what it cannot show (pixels, real events) is described for the owner in SU2-REPORT.md.
//   node tools/cruise-sim/tests/su2-dom.test.js
const { test, assert } = require('./stubs/su2-harness');
const dom = require('./stubs/mini-dom').makeDom();
require('./stubs/mini-dom').install(dom);
const M = require('./stubs/fake-modules.js');
const fx = require('./fixtures/su2-fixture.js');
global.self = { CS: Object.assign({ su2fixture: fx }, M) };
const C = require('../ui/charts.js');
const S = require('../ui/settings.js');
const B = require('../ui/batch.js');
const R = require('../ui/report-view.js');
const { createApp } = require('./stubs/fake-app.js');

const document = dom.document;
function host(id) { const e = document.createElement('div'); e.setAttribute('id', id); document.body.appendChild(e); return e; }
function q(el, sel) { return el.querySelector(sel); }
function qa(el, sel) { return el.querySelectorAll(sel); }
function byText(el, tag, text) { return qa(el, tag).find((n) => n.textContent.indexOf(text) >= 0); }

const app = createApp({ CS: self.CS, config: { version: 1, seed: 1, scenario: { id: 'D.brake', overrides: {} }, plant: { preset: 'liftoff' } } });
const calls = [];
const realSet = app.setConfig;
app.setConfig = function (p, o) { calls.push([p, o]); return realSet(p, o); };

test('styles are injected once, with both themes', () => {
  C.ensureStyle(document);
  C.ensureStyle(document);
  const st = qa(document.head, 'style');
  assert.strictEqual(st.length, 1);
  assert.ok(/prefers-color-scheme: dark/.test(st[0].textContent));
});

test('charts: empty state, then panels with canvases after a run; legend toggles; B overlay through setCompare', () => {
  const el = host('charts');
  const v = C.mount(el, app);
  assert.ok(/No run yet/.test(el.textContent));
  app.run();
  dom.flush();
  const panels = qa(el, '.su2-panel');
  assert.deepStrictEqual(panels.map((p) => p.getAttribute('data-panel')), ['speed', 'gap', 'timegap', 'ttc', 'accel', 'events']);
  assert.ok(dom.ctxCalls.count > 1000, 'drawn on the canvases (' + dom.ctxCalls.count + ' calls)');
  assert.ok(/Assumed plant: liftoff/.test(el.textContent));
  // legend: hide 'Ego' in the speed panel
  const leg = qa(panels[0], '.su2-leg').find((b) => b.textContent.indexOf('Ego') >= 0);
  leg.click();
  assert.strictEqual(leg.getAttribute('aria-pressed'), 'false');
  // pin B: goes through the shell's setCompare and comes back as 'compare'
  byText(el, 'button', 'Pin as B').click();
  assert.strictEqual(app.resultB, app.result);
  assert.ok(/B = D\.brake/.test(el.textContent));
  assert.ok(byText(el, 'summary', 'Metrics, A against B'));
  byText(el, 'button', 'Clear B').click();
  assert.strictEqual(app.resultB, null);
  v.destroy();
  assert.strictEqual(el.children.length, 0);
});

test('charts: cursor, scrub, wheel zoom, double-click fit, follow during playback', () => {
  const el = host('charts2');
  const v = C.mount(el, app);
  dom.flush();
  const over = q(el, '.su2-overlay');
  over.dispatch('pointerdown', { clientX: 400 });
  assert.ok(app.cursorT > 0, 'click moved the shell\'s cursor to ' + app.cursorT);
  const full = v.getView();
  over.dispatch('wheel', { deltaY: -300, clientX: 400 });
  dom.flush();
  const z = v.getView();
  assert.ok(z.t1 - z.t0 < full.t1 - full.t0, 'zoomed in');
  over.dispatch('wheel', { deltaX: 200, deltaY: 0 });
  assert.ok(v.getView().t0 > z.t0 - 1e-9, 'panned');
  app.setCursor(59);
  dom.flush();
  assert.ok(v.getView().t1 >= 59, 'followed the cursor');
  over.dispatch('dblclick');
  assert.deepStrictEqual(v.getView(), { t0: 0, t1: 60 });
  over.dispatch('pointermove', { clientX: 300, clientY: 60 });
  const tip = qa(document.body, '.su2-tip').find((t) => !t.hidden);
  assert.ok(tip && /t = /.test(tip.innerHTML), 'tooltip');
  v.destroy();
});

test('settings: generated groups, an edit writes a compact module and lets the shell re-run', () => {
  const el = host('settings');
  const v = S.mount(el, app, { modules: M, storage: null });
  const groups = qa(el, 'details.su2-group').map((d) => d.getAttribute('data-group'));
  assert.deepStrictEqual(groups, ['scenario', 'plant', 'sensor', 'estimator', 'control', 'command', 'driver', 'failures', 'thresholds']);
  const row = q(el, '[data-id="plant.aMin_ms2"]');
  assert.ok(/default −0\.700/.test(row.textContent) || /default -0.7/.test(row.textContent), row.textContent);
  const input = qa(row, 'input').find((i) => i.attrs.type === 'text');
  calls.length = 0;
  input.value = '-1.25';
  input.dispatch('change');
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0][0].plant, { preset: 'liftoff', aMin_ms2: -1.25 });
  assert.deepStrictEqual(calls[0][1], { replace: true, run: 'auto' });
  assert.ok(q(el, '[data-id="plant.aMin_ms2"]').classList.contains('su2-changed'), 'marked changed');
  // an invalid value is refused with a message, nothing written
  input.value = '7';
  input.dispatch('change');
  assert.strictEqual(calls.length, 1);
  assert.ok(row.classList.contains('su2-bad') && /above the range/.test(row.textContent));
  // reset the plant group
  const reset = q(q(el, '[data-group="plant"]'), '.su2-reset');
  reset.dispatch('click');
  assert.deepStrictEqual(app.config.plant, { preset: 'liftoff' });
  // the search box hides rows that do not match
  const search = q(el, 'input[type="search"]');
  search.value = 'dead time';
  search.dispatch('input');
  assert.ok(!q(el, '[data-id="plant.deadTime_s"]').classList.contains('su2-hidden'));
  assert.ok(q(el, '[data-id="plant.aMin_ms2"]').classList.contains('su2-hidden'));
  v.destroy();
});

test('settings: failures are added and removed as a list', () => {
  const el = host('settings2');
  const v = S.mount(el, app, { modules: M, storage: null });
  byText(el, 'button', '+ Add a failure').click();
  assert.deepStrictEqual(app.config.failures, [{ kind: 'appStop', at: 20, duration: null }]);
  assert.ok(q(el, '[data-id="failures.0.kind"]'), 'rebuilt with the new item');
  byText(el, 'button', 'Remove failure 1').click();
  assert.deepStrictEqual(app.config.failures, []);
  v.destroy();
});

test('settings: named presets save, apply and survive a throwing storage', () => {
  const mem = {};
  const el = host('settings3');
  global.prompt = () => 'my set';
  const v = S.mount(el, app, { modules: M, storage: { getItem: (k) => mem[k] || null, setItem: (k, val) => { mem[k] = val; } } });
  app.setConfig(Object.assign({}, app.config, { controller: { h: 2.6 } }), { replace: true, run: false });
  byText(el, 'button', 'Save as…').click();
  assert.ok(JSON.parse(mem[S.STORE_KEY])['my set'].config.controller.h === 2.6);
  app.setConfig(Object.assign({}, app.config, { controller: {} }), { replace: true, run: false });
  byText(el, 'button', 'Apply').click();
  assert.strictEqual(app.config.controller.h, 2.6);
  v.destroy();
  const el2 = host('settings4');
  const v2 = S.mount(el2, app, { modules: M, storage: { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } } });
  byText(el2, 'button', 'Save as…').click();
  assert.ok(/does not keep data/.test(el2.textContent));
  v2.destroy();
});

test('batch: a batch from the shell fills the matrix; a cell opens its run; tabs switch views', () => {
  const el = host('batch');
  const v = B.mount(el, app, { modules: M });
  assert.ok(/No batch loaded/.test(el.textContent));
  app.loadResultFile(fx.makeBatch());
  assert.ok(/2618 runs/.test(el.textContent), el.textContent.slice(0, 200));
  assert.ok(/Assumed plant/.test(el.textContent));
  const cells = qa(el, 'button.su2-cell');
  assert.strictEqual(cells.length, 22);
  assert.ok(cells.some((c) => c.classList.contains('su2-fail')) && cells.some((c) => c.classList.contains('su2-pass')));
  let opened = null, shown = null;
  app.openRun = (cfg) => { opened = cfg; };
  app.showView = (vv) => { shown = vv; };
  cells[0].click();
  assert.ok(opened && opened.scenario && opened.scenario.id === 'B.approach');
  assert.strictEqual(shown, 'run');
  // map
  q(el, '[data-tab="map"]').click();
  const svg = q(el, 'svg');
  assert.ok(svg && /Feasibility map/.test(svg._html) && /liftoff/.test(svg._html));
  // sensitivity
  q(el, '[data-tab="sens"]').click();
  assert.ok(/Sensitivity/.test(q(el, 'svg')._html));
  assert.ok(/The verdict turns on: plant\.aMin_ms2/.test(el.textContent));
  // tuning: a row click applies its parameters
  q(el, '[data-tab="tune"]').click();
  const rows = qa(el, 'tr.su2-click');
  assert.strictEqual(rows.length, 36);
  calls.length = 0;
  rows[0].click();
  assert.ok(calls[0][0].controller && typeof calls[0][0].controller.h === 'number');
  assert.deepStrictEqual(calls[0][1], { run: false });
  v.destroy();
});

test('report: builds from the current run and batch, and offers the download', () => {
  const el = host('report');
  const v = R.mount(el, app, { modules: M });
  const dl = byText(el, 'button', 'Download HTML');
  assert.strictEqual(dl.disabled, true);
  byText(el, 'button', 'Build report').click();
  const frame = q(el, 'iframe');
  assert.ok(/<!doctype html>/.test(frame.srcdoc));
  assert.ok(/Scenario matrix/.test(frame.srcdoc), 'the batch from the batch view is in the report');
  assert.strictEqual(dl.disabled, false);
  assert.ok(/Built in \d+ ms/.test(el.textContent));
  v.destroy();
});
