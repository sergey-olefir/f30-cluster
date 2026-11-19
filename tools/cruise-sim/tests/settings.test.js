'use strict';
// SU2: ui/settings.js — SCHEMA -> controls model, changed marks, value parsing, the config patches
// (compact modules, presets, reset), named presets (snapshot, export / import), the short-run rule.
//   node tools/cruise-sim/tests/settings.test.js
const { test, assert } = require('./stubs/su2-harness');
const S = require('../ui/settings.js');
const M = require('./stubs/fake-modules.js');

function mods() { return S.findModules(M); }
function ctl(model, id) {
  for (const g of model.groups) {
    const all = g.list ? [].concat(...g.items) : [].concat(...g.sections.map((s) => s.controls));
    const c = all.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

test('findModules picks the model modules and the scenario catalogue', () => {
  const m = mods();
  assert.deepStrictEqual(Object.keys(m).sort(), ['command', 'controller', 'driver', 'estimator', 'failures', 'metrics', 'plant', 'scenario', 'sensor', 'warning']);
  assert.deepStrictEqual(Object.keys(S.findModules({ rng: {}, plant: M.plant })), ['plant']);
});

test('the model follows the brief\'s groups, in order', () => {
  const model = S.buildModel(mods(), {});
  assert.deepStrictEqual(model.groups.map((g) => g.id), ['scenario', 'plant', 'sensor', 'estimator', 'control', 'command', 'driver', 'failures', 'thresholds']);
  const control = model.groups.find((g) => g.id === 'control');
  assert.deepStrictEqual(control.sections.map((s) => s.title), ['Controller · Loop', 'Controller · Law', 'Controller · Limits', 'Warning']);
  const missing = S.buildModel({ plant: M.plant }, {}).groups.find((g) => g.id === 'sensor');
  assert.deepStrictEqual(missing.missing, ['sensor']);
});

test('every SCHEMA field becomes a control with its unit, range and default (hidden ones excepted)', () => {
  const model = S.buildModel(mods(), {});
  const plant = model.groups.find((g) => g.id === 'plant');
  const ids = [].concat(...plant.sections.map((s) => s.controls.map((c) => c.key)));
  assert.ok(ids.indexOf('file') < 0 && ids.indexOf('data') < 0, 'set by the file loader, not a control');
  assert.strictEqual(ids.length, M.plant.SCHEMA.length - 2);
  const amin = ctl(model, 'plant.aMin_ms2');
  assert.strictEqual(amin.unit, 'm/s²');
  assert.strictEqual(amin.min, -6);
  assert.strictEqual(amin.max, -0.1);
  assert.strictEqual(amin.default, -1.8);          // SCHEMA default 'mild' preset's value
  assert.strictEqual(amin.type, 'number');
  assert.strictEqual(amin.subgroup, 'Limits');      // 'plant.limits' without the module prefix
  assert.strictEqual(ctl(model, 'plant.model').type, 'select');
  assert.strictEqual(ctl(model, 'plant.acceptWhenSuspended').type, 'bool');
  assert.strictEqual(ctl(model, 'controller.ffEnable').type, 'bool');   // options [false, true] -> a checkbox
  assert.strictEqual(ctl(model, 'plant.tauDown_s').nullable, true);
  assert.strictEqual(S.rangeText(amin), '−6.00 … −0.100 m/s²');
});

test('control types from SCHEMA fields', () => {
  assert.strictEqual(S.typeOf({ default: 1 }), 'number');
  assert.strictEqual(S.typeOf({ default: null, min: 0 }), 'number');
  assert.strictEqual(S.typeOf({ default: 'a' }), 'text');
  assert.strictEqual(S.typeOf({ default: 'a', options: ['a', 'b'] }), 'select');
  assert.strictEqual(S.typeOf({ type: 'enum', default: 'a' }), 'select');
  assert.strictEqual(S.typeOf({ default: true }), 'bool');
  assert.strictEqual(S.typeOf({ default: {}, type: 'object' }), 'json');
  assert.strictEqual(S.typeOf({ default: [] }), 'json');
  assert.strictEqual(S.sectionTitle('plant.dynamics', 'plant', 'plant'), 'Dynamics');
  assert.strictEqual(S.sectionTitle('plant', 'plant', 'plant'), '');
  assert.strictEqual(S.sectionTitle('thresholds.catalogue', 'metrics', 'thresholds'), 'Catalogue');
});

test('changed marks compare against the selected preset, not only the SCHEMA', () => {
  let model = S.buildModel(mods(), { plant: { preset: 'liftoff' } });
  let a = ctl(model, 'plant.aMin_ms2');
  assert.strictEqual(a.default, -0.7);
  assert.strictEqual(a.value, -0.7);
  assert.strictEqual(a.changed, false);
  model = S.buildModel(mods(), { plant: { preset: 'liftoff', aMin_ms2: -1.0, tau_s: 2.0 } });
  a = ctl(model, 'plant.aMin_ms2');
  assert.strictEqual(a.changed, true);
  assert.strictEqual(ctl(model, 'plant.tau_s').changed, false);   // explicit but equal to the default
  assert.strictEqual(model.groups.find((g) => g.id === 'plant').changed, 1);
  // float noise is not a change
  model = S.buildModel(mods(), { controller: { h: 2.0000000000001 } });
  assert.strictEqual(ctl(model, 'controller.h').changed, false);
});

test('parseInput: numbers with a comma or a minus sign, ranges, nullable, choices, "worst"', () => {
  const model = S.buildModel(mods(), {});
  const amin = ctl(model, 'plant.aMin_ms2');
  assert.deepStrictEqual(S.parseInput(amin, '−1,5'), { ok: true, value: -1.5 });
  assert.strictEqual(S.parseInput(amin, '0').ok, false);
  assert.ok(/above the range/.test(S.parseInput(amin, '0').error));
  assert.strictEqual(S.parseInput(amin, 'abc').ok, false);
  assert.strictEqual(S.parseInput(amin, '').ok, false);
  assert.deepStrictEqual(S.parseInput(ctl(model, 'plant.tauDown_s'), ''), { ok: true, value: null });
  assert.deepStrictEqual(S.parseInput(ctl(model, 'plant.model'), 'P2'), { ok: true, value: 'P2' });
  assert.strictEqual(S.parseInput(ctl(model, 'plant.model'), 'P9').ok, false);
  assert.deepStrictEqual(S.parseInput(ctl(model, 'controller.ffEnable'), true), { ok: true, value: true });
  const at = { type: 'number', key: 'at', min: 0, allow: ['worst'] };
  assert.deepStrictEqual(S.parseInput(at, 'worst'), { ok: true, value: 'worst' });
});

test('patchFor writes compact module objects (only what differs from the defaults)', () => {
  const m = mods();
  const cfg = { plant: { preset: 'liftoff', model: 'P1' }, controller: { h: 2.5 } };
  const model = S.buildModel(m, cfg);
  let p = S.patchFor(m, cfg, ctl(model, 'plant.aMin_ms2'), -1.2);
  assert.deepStrictEqual(p, { plant: { preset: 'liftoff', model: 'P1', aMin_ms2: -1.2 } });
  p = S.patchFor(m, cfg, ctl(model, 'controller.h'), 2.0);             // back to the default: the key goes
  assert.deepStrictEqual(p, { controller: {} });
  p = S.patchFor(m, cfg, ctl(model, 'controller.d0'), 6);
  assert.deepStrictEqual(p, { controller: { h: 2.5, d0: 6 } });
  p = S.patchFor(m, cfg, ctl(model, 'seed'), 7);
  assert.deepStrictEqual(p, { seed: 7 });
  p = S.patchFor(m, cfg, ctl(model, 'ego.mode'), 'idealAcc');
  assert.deepStrictEqual(p, { ego: { mode: 'idealAcc' } });
});

test('a new plant preset moves every parameter to it, keeps the model and a loaded plant file', () => {
  const m = mods();
  const cfg = { plant: { preset: 'liftoff', model: 'P2', aMin_ms2: -1.2, tau_s: 3, data: { name: 'x' } } };
  const model = S.buildModel(m, cfg);
  const p = S.patchFor(m, cfg, ctl(model, 'plant.preset'), 'firm');
  assert.deepStrictEqual(p, { plant: { preset: 'firm', model: 'P2', data: { name: 'x' } } });
  const after = S.buildModel(m, S.applyPatch(cfg, p));
  assert.strictEqual(ctl(after, 'plant.aMin_ms2').value, -2.8);
  assert.strictEqual(ctl(after, 'plant.aMin_ms2').changed, false);
});

test('a module with PRESETS but no preset key (the command path) gets a selector that only writes values', () => {
  const m = mods();
  let model = S.buildModel(m, {});
  const sel = ctl(model, 'command.#preset');
  assert.ok(sel && sel.synthetic);
  assert.strictEqual(sel.value, 'nominal');                       // the SCHEMA defaults match 'nominal'
  const p = S.patchFor(m, {}, sel, 'worst');
  assert.deepStrictEqual(p, { command: { delay_s: 0.8, jitter_s: 0.5, maxRate_hz: 2, dropProb: 0.1 } });
  assert.ok(!('preset' in p.command), 'never stored: the engine would reject an unknown key');
  model = S.buildModel(m, p);
  assert.strictEqual(ctl(model, 'command.#preset').value, 'worst');
  model = S.buildModel(m, { command: { delay_s: 0.33 } });
  assert.strictEqual(ctl(model, 'command.#preset').value, '');    // custom
});

test('scenario: the catalogue grouped by family, its sweep as variations, the run fields', () => {
  const m = mods();
  let model = S.buildModel(m, { scenario: { id: 'D.brake', overrides: { 'params.a_mps2': -3 } } });
  const id = ctl(model, 'scenario.id');
  assert.strictEqual(id.value, 'D.brake');
  assert.ok(id.options.every((o) => o.family));
  const v = ctl(model, 'scenario.overrides.params.a_mps2');
  assert.strictEqual(v.value, -3);
  assert.strictEqual(v.changed, true);
  assert.strictEqual(ctl(model, 'duration').default, 60);          // the scenario's own duration
  // changing the scenario clears its variations
  assert.deepStrictEqual(S.patchFor(m, { scenario: { id: 'D.brake', overrides: { x: 1 } } }, id, 'B.approach'), { scenario: { id: 'B.approach', overrides: {} } });
  // clearing a variation deletes the key
  const p = S.patchFor(m, { scenario: { id: 'D.brake', overrides: { 'params.a_mps2': -3, 'ego.v0_kmh': 90 } } }, v, '');
  assert.deepStrictEqual(p, { scenario: { id: 'D.brake', overrides: { 'ego.v0_kmh': 90 } } });
  // an id not in the catalogue is still shown
  model = S.buildModel(m, { scenario: { id: 'Z.unknown' } });
  assert.ok(/not in the catalogue/.test(ctl(model, 'scenario.id').options[0].label));
});

test('failures: a list editor from the KINDS table when the SCHEMA is empty', () => {
  const m = mods();
  const sch = S.failureSchema(m.failures);
  assert.deepStrictEqual(sch.map((s) => s.key), ['kind', 'at', 'duration']);
  assert.deepStrictEqual(sch[0].options, ['appStop', 'huRestart', 'gapFreeze', 'sensorBlind', 'commandLost']);
  const cfg = { failures: [{ kind: 'gapFreeze', at: 'worst', duration: 5, worstBy: 'minTimeGap_s' }] };
  const model = S.buildModel(m, cfg);
  const g = model.groups.find((x) => x.id === 'failures');
  assert.strictEqual(g.items.length, 1);
  assert.deepStrictEqual(g.items[0].map((c) => c.key), ['kind', 'at', 'duration', 'worstBy']);
  const p = S.patchFor(m, cfg, g.items[0][1], 12);
  assert.deepStrictEqual(p, { failures: [{ kind: 'gapFreeze', at: 12, duration: 5, worstBy: 'minTimeGap_s' }] });
});

test('reset group: the preset stays, every override goes; scenario reset keeps the scenario', () => {
  const m = mods();
  const cfg = { plant: { preset: 'firm', model: 'P3', aMin_ms2: -1, tau_s: 4 }, controller: { h: 3 }, failures: [{ kind: 'stall', at: 3 }],
    scenario: { id: 'D.brake', overrides: { a: 1 } }, seed: 9, duration: 33, ego: { mode: 'human' }, out: { dt: 0.1 } };
  assert.deepStrictEqual(S.resetPatch(m, cfg, 'plant'), { plant: { preset: 'firm', model: 'P3' } });
  assert.deepStrictEqual(S.resetPatch(m, cfg, 'control'), { controller: {}, warning: {} });
  assert.deepStrictEqual(S.resetPatch(m, cfg, 'failures'), { failures: [] });
  const sp = S.resetPatch(m, cfg, 'scenario');
  const next = S.applyPatch(cfg, sp);
  assert.deepStrictEqual(next.scenario, { id: 'D.brake', overrides: {} });
  assert.strictEqual(next.seed, 1);
  assert.ok(!('duration' in next) && !('ego' in next) && !('out' in next));
});

test('applyPatch replaces top-level values and deletes undefined ones, without touching the input', () => {
  const cfg = { a: { x: 1, y: 2 }, b: 1 };
  const n = S.applyPatch(cfg, { a: { x: 3 }, b: undefined, c: [1] });
  assert.deepStrictEqual(n, { a: { x: 3 }, c: [1] });
  assert.deepStrictEqual(cfg, { a: { x: 1, y: 2 }, b: 1 });
});

test('snapshot keeps only what differs, and applying it reproduces the setting', () => {
  const m = mods();
  const cfg = { seed: 4, scenario: { id: 'C.follow.sine', overrides: {} }, plant: { preset: 'liftoff', aMin_ms2: -0.7, tau_s: 3 }, controller: { h: 2 }, failures: [{ kind: 'stall', at: 5 }], thresholds: { minTTC_s: 5 } };
  const snap = S.snapshot(m, cfg);
  assert.deepStrictEqual(snap, { seed: 4, scenario: { id: 'C.follow.sine', overrides: {} }, plant: { preset: 'liftoff', tau_s: 3 }, failures: [{ kind: 'stall', at: 5 }], thresholds: { minTTC_s: 5 } });
  const back = S.applyPatch({ seed: 1, plant: { preset: 'mild', aMin_ms2: -5 }, sensor: { rateHz: 3 } }, S.applySnapshotPatch(m, snap));
  const a = S.buildModel(m, back), b = S.buildModel(m, cfg);
  const vals = (model) => [].concat(...model.groups.map((g) => g.list ? [].concat(...g.items) : [].concat(...g.sections.map((s) => s.controls)))).map((c) => c.id + '=' + JSON.stringify(c.value)).sort();
  assert.deepStrictEqual(vals(a), vals(b));
});

test('presets export and import as JSON; bad keys and values are dropped with a warning', () => {
  const m = mods();
  const text = S.exportPresets({ fast: { saved: '2026-11-19', config: { controller: { h: 1.5 } } } });
  const back = S.importPresets(text, m);
  assert.deepStrictEqual(back.presets, { fast: { saved: '2026-11-19', config: { controller: { h: 1.5 } } } });
  assert.deepStrictEqual(back.warnings, []);
  const bad = S.importPresets(JSON.stringify({ kind: 'cs-settings-presets', presets: { x: { config: { controller: { h: 9, nope: 1, d0: 4 }, plant: { preset: 'turbo' }, weird: 1 } } } }), m);
  assert.deepStrictEqual(bad.presets.x.config, { controller: { d0: 4 }, plant: {} });
  assert.strictEqual(bad.warnings.length, 4);
  // a bare config file becomes one preset named after the file
  const cfgFile = S.importPresets(JSON.stringify({ version: 1, seed: 3, plant: { preset: 'firm' } }), m, 'my-run');
  assert.deepStrictEqual(Object.keys(cfgFile.presets), ['my-run']);
  assert.deepStrictEqual(cfgFile.presets['my-run'].config, { seed: 3, plant: { preset: 'firm' } });
  assert.ok(/not JSON/.test(S.importPresets('{', m).warnings[0]));
  assert.ok(/not a presets file/.test(S.importPresets('[1]', m).warnings[0]));
});

test('the preset store survives a storage that throws', () => {
  const mem = {};
  const ok = S.makeStore({ getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } });
  assert.strictEqual(ok.save('a', { seed: 2 }, 't'), true);
  assert.deepStrictEqual(ok.list(), { a: { saved: 't', config: { seed: 2 } } });
  ok.merge({ b: { config: {} } });
  ok.remove('a');
  assert.deepStrictEqual(Object.keys(ok.list()), ['b']);
  const broken = S.makeStore({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
  assert.deepStrictEqual(broken.list(), {});
  assert.strictEqual(broken.save('x', {}), false);
  assert.deepStrictEqual(S.makeStore(null).list(), {});
});

test('re-run on change only for short runs, never for family L', () => {
  assert.strictEqual(S.isShortRun({ duration: 120 }), true);
  assert.strictEqual(S.isShortRun({ duration: 301 }), false);
  assert.strictEqual(S.isShortRun({}, { duration: 3600, family: 'L' }), false);
  assert.strictEqual(S.isShortRun({ scenario: { id: 'L.mixed' }, duration: 60 }), false);
  assert.strictEqual(S.isShortRun({}, { duration: 60, family: 'D' }), true);
});

test('the DOM is rebuilt only when the set of controls changes', () => {
  const m = mods();
  const a = S.signature(S.buildModel(m, { plant: { preset: 'liftoff' } }));
  const b = S.signature(S.buildModel(m, { plant: { preset: 'firm', aMin_ms2: -2 } }));
  const c = S.signature(S.buildModel(m, { failures: [{ kind: 'stall', at: 1 }] }));
  const d = S.signature(S.buildModel(m, { scenario: { id: 'D.brake' } }));
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.notStrictEqual(a, d);
});
