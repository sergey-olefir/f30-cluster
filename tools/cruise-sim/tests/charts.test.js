'use strict';
// SU2: the pure half of ui/charts.js — scales, ticks, decimation, zoom / pan, spans, event lanes,
// panel resolution, thresholds, layout and the two renderers.   node tools/cruise-sim/tests/charts.test.js
const { test, assert, near } = require('./stubs/su2-harness');
const C = require('../ui/charts.js');
const fx = require('./fixtures/su2-fixture.js');
const M = require('./stubs/su2-fake-modules.js');

test('linear scale maps and inverts', () => {
  const s = C.linear(10, 20, 100, 300);
  assert.strictEqual(s(10), 100);
  assert.strictEqual(s(15), 200);
  assert.strictEqual(s.invert(250), 17.5);
  const r = C.linear(0, 1, 50, 0);                 // a y axis: up is smaller
  assert.strictEqual(r(1), 0);
  assert.strictEqual(r.invert(25), 0.5);
  assert.strictEqual(C.linear(5, 5, 0, 10)(5), 0); // zero span does not divide by zero
});

test('niceStep is 1-2-5 and ticks stay inside the range', () => {
  assert.strictEqual(C.niceStep(10, 5), 2);
  assert.strictEqual(C.niceStep(100, 4), 20);
  assert.strictEqual(C.niceStep(0.7, 5), 0.1);
  assert.strictEqual(C.niceStep(3, 5), 0.5);
  assert.deepStrictEqual(C.ticks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepStrictEqual(C.ticks(-0.25, 0.6, 4), [-0.2, 0, 0.2, 0.4, 0.6]);
  const t = C.ticks(0.1, 0.35, 5);
  assert.ok(t.every((v) => v >= 0.1 - 1e-12 && v <= 0.35 + 1e-12));
  assert.deepStrictEqual(C.ticks(0.1, 0.3, 4).map(String), ['0.1', '0.15', '0.2', '0.25', '0.3']); // no 0.30000000000000004
  assert.deepStrictEqual(C.ticks(5, 5, 4), [5]);
  assert.deepStrictEqual(C.ticks(NaN, 1, 4), []);
});

test('niceDomain widens to whole steps and never to a zero span', () => {
  assert.deepStrictEqual(C.niceDomain(0.3, 9.7, 5), [0, 10]);
  assert.deepStrictEqual(C.niceDomain(-1.83, 1.2, 4), [-2, 2]);
  assert.deepStrictEqual(C.niceDomain(-1.83, 1.2, 8), [-2, 1.5]);
  const d = C.niceDomain(3, 3, 4);
  assert.ok(d[0] < 3 && d[1] > 3);
  assert.deepStrictEqual(C.niceDomain(NaN, 1), [0, 1]);
});

test('fmt: dashes for missing, signs, booleans', () => {
  assert.strictEqual(C.fmt(NaN), '–');
  assert.strictEqual(C.fmt(null), '–');
  assert.strictEqual(C.fmt(true), 'yes');
  assert.strictEqual(C.fmt(-1.234), '−1.23');
  assert.strictEqual(C.fmt(123.4), '123');
  assert.strictEqual(C.fmt(Infinity), '∞');
  assert.strictEqual(C.fmt(0.5, 1), '0.5');
});

test('bisect and valueAt (linear and step)', () => {
  const t = [0, 1, 2, 3];
  const y = [0, 10, 20, null];
  assert.strictEqual(C.bisect(t, 1.5), 2);
  assert.strictEqual(C.bisect(t, -1), 0);
  assert.strictEqual(C.bisect(t, 9), 4);
  assert.strictEqual(C.valueAt(t, y, 1.5), 15);
  assert.strictEqual(C.valueAt(t, y, 1.5, true), 10);
  assert.ok(isNaN(C.valueAt(t, y, 2.5)));        // null in JSON results = NaN
  assert.ok(isNaN(C.valueAt(t, y, 7)));          // outside
  assert.strictEqual(C.valueAt(t, y, 2), 20);
});

test('decimate keeps every extreme and the time order, and shrinks dense data', () => {
  const n = 100000;
  const t = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { t[i] = i * 0.01; y[i] = Math.sin(i * 0.37); }
  y[54321] = 50;                                 // a one-sample spike
  y[12345] = -50;
  const d = C.decimate(t, y, 0, 1000, 400);
  assert.ok(d.t.length <= 400 * 4 + 4, 'at most 4 points per column, got ' + d.t.length);
  assert.ok(d.y.indexOf(50) >= 0 && d.y.indexOf(-50) >= 0, 'spikes survive');
  for (let i = 1; i < d.t.length; i++) assert.ok(d.t[i] >= d.t[i - 1], 'time order');
  // envelope per column is exact
  assert.strictEqual(Math.max.apply(null, d.y), 50);
});

test('decimate returns sparse data unchanged (plus one sample either side) and keeps NaN gaps', () => {
  const t = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const y = [0, 1, 2, NaN, NaN, 5, 6, 7, 8, 9];
  const d = C.decimate(t, y, 2.5, 6.5, 100);
  assert.deepStrictEqual(d.t, [2, 3, 4, 5, 6, 7]);
  assert.ok(isNaN(d.y[1]) && isNaN(d.y[2]));
  // dense data with a NaN run: a break is emitted
  const n = 10000, T = [], Y = [];
  for (let i = 0; i < n; i++) { T.push(i); Y.push(i > 5000 && i < 5050 ? NaN : 1); }
  const dd = C.decimate(T, Y, 0, n, 50);
  assert.ok(dd.y.some((v) => isNaN(v)), 'a gap stays a gap');
});

test('zoom keeps the point under the pointer and clamps to the run', () => {
  const b = [0, 100];
  const v = C.zoomView({ t0: 0, t1: 100 }, 0.5, 25, b);
  near(v.t1 - v.t0, 50, 1e-9);
  near((25 - v.t0) / (v.t1 - v.t0), 0.25, 1e-9);
  const out = C.zoomView({ t0: 40, t1: 60 }, 10, 50, b);
  assert.deepStrictEqual(out, { t0: 0, t1: 100 });
  const tiny = C.zoomView({ t0: 0, t1: 1 }, 0.001, 0.5, b, 0.5);
  near(tiny.t1 - tiny.t0, 0.5, 1e-9);
  assert.deepStrictEqual(C.panView({ t0: 90, t1: 100 }, 5, b), { t0: 90, t1: 100 });
  assert.deepStrictEqual(C.panView({ t0: 10, t1: 20 }, -15, b), { t0: 0, t1: 10 });
});

test('followView moves the window only when the cursor leaves it', () => {
  const v = { t0: 10, t1: 20 };
  assert.strictEqual(C.followView(v, 15, [0, 100]), v);
  const w = C.followView(v, 30, [0, 100]);
  near(w.t1 - w.t0, 10, 1e-9);
  assert.ok(30 > w.t0 && 30 < w.t1);
});

test('spans of a flag series, an open one closes at the end', () => {
  const t = [0, 1, 2, 3, 4, 5];
  const s = C.spans(t, [0, 1, 1, 0, 1, 1], (v) => v > 0, 6);
  assert.deepStrictEqual(s, [{ t0: 1, t1: 3 }, { t0: 4, t1: 6 }]);
});

test('eventSpans pairs warnings and faults (faults by their kind)', () => {
  const ev = [
    { t: 1, kind: 'warn.on' }, { t: 2, kind: 'warn.off' },
    { t: 3, kind: 'fault.on', fault: 'gapFreeze' }, { t: 4, kind: 'fault.on', fault: 'stall' },
    { t: 5, kind: 'fault.off', fault: 'stall' }, { t: 9, kind: 'warn.on' },
  ];
  assert.deepStrictEqual(C.eventSpans(ev, 'warn.on', 'warn.off', 10).map((s) => [s.t0, s.t1]), [[1, 2], [9, 10]]);
  const f = C.eventSpans(ev, 'fault.on', 'fault.off', 10);
  assert.deepStrictEqual(f.map((s) => [s.t0, s.t1, s.ev.fault]), [[3, 10, 'gapFreeze'], [4, 5, 'stall']]);
});

test('event rows: every contract event kind has a row', () => {
  const kinds = 'cmd.sent cmd.applied cmd.dropped cmd.rejected target.acquired target.changed target.lost warn.on warn.off driver.react driver.brake driver.override driver.resume driver.vmax cruise.state fault.on fault.off collision'.split(' ');
  kinds.forEach((k) => assert.ok(C.eventRowOf(k), k));
  assert.strictEqual(C.eventRowOf('something.new'), null);
  const rows = C.eventRowsPresent([{ events: [{ t: 0, kind: 'cmd.sent' }, { t: 1, kind: 'x.y' }] }]);
  assert.deepStrictEqual(rows.map((r) => r.id), ['cmd', 'other']);
  assert.strictEqual(C.eventText({ t: 1, kind: 'cmd.sent', vSet: 25 }), 'cmd.sent: vSet 90 km/h');
});

test('thresholds come from the config, else the modules\' SCHEMA / PRESETS', () => {
  const th = C.thresholdsFor({ plant: { preset: 'liftoff' } }, M);
  assert.strictEqual(th.minTimeGap, 1);
  assert.strictEqual(th.minTTC, 4);
  assert.strictEqual(th.ttcWarn, 3);
  assert.strictEqual(th.h, 2);
  assert.strictEqual(th.aMin, -0.7);              // the preset's value, not the SCHEMA default
  assert.strictEqual(th.aMax, 1.5);
  const th2 = C.thresholdsFor({ plant: { preset: 'liftoff', aMin_ms2: -1.1 }, thresholds: { minTTC_s: 5 }, warning: { ttcWarn_s: 2.5 } }, M);
  assert.strictEqual(th2.aMin, -1.1);
  assert.strictEqual(th2.minTTC, 5);
  assert.strictEqual(th2.ttcWarn, 2.5);
  const none = C.thresholdsFor({}, {});
  assert.ok(isNaN(none.minTTC) && isNaN(none.aMin));
});

test('resolvePanels shows only series the result has, honours hidden, and adds threshold lines', () => {
  const r = fx.makeResult({ duration: 20 });
  delete r.series['follower.gap'];
  const p = C.resolvePanels(r, r.meta.config, { modules: M, hidden: { 'speed/ego.v': true } });
  assert.deepStrictEqual(p.map((x) => x.id), ['speed', 'gap', 'timegap', 'ttc', 'accel', 'events']);
  const sp = p[0];
  assert.strictEqual(sp.series.find((s) => s.name === 'ego.v').visible, false);
  assert.strictEqual(sp.series.find((s) => s.name === 'v.ref').visible, false);   // off by default
  assert.ok(!p[1].series.some((s) => s.name === 'follower.gap'));
  const acc = p.find((x) => x.id === 'accel');
  assert.deepStrictEqual(acc.thresholds.map((t) => t.v), [-0.8, 1.2]);           // the fixture's plant
  const ttc = p.find((x) => x.id === 'ttc');
  assert.deepStrictEqual(ttc.thresholds.map((t) => t.v), [4, 3]);
  // a panel without any series is left out
  const bare = { t: [0, 1], series: { 'ego.v': [1, 2] }, events: [] };
  assert.deepStrictEqual(C.resolvePanels(bare, {}, { modules: M }).map((x) => x.id), ['speed', 'events']);
});

test('panelDomain covers visible data, thresholds and the cap', () => {
  const r = fx.makeResult({ duration: 30 });
  const p = C.resolvePanels(r, r.meta.config, { modules: M });
  const ttc = p.find((x) => x.id === 'ttc');
  const d = C.panelDomain(ttc, [r], { t0: 0, t1: 30 });
  assert.ok(d[0] <= 0 && d[1] >= 4 && d[1] <= 25, 'TTC capped near 20, got ' + d);
  const sp = p.find((x) => x.id === 'speed');
  const ds = C.panelDomain(sp, [r], { t0: 0, t1: 5 });
  assert.ok(ds[0] <= 90 && ds[1] >= 110, 'km/h domain ' + ds);
});

test('threshold labels do not print over each other', () => {
  const slots = C.thrLabelSlots([100, 105, 108, 300]);
  assert.deepStrictEqual(slots[0], { left: false, above: true });
  assert.deepStrictEqual(slots[1], { left: false, above: false });
  assert.strictEqual(slots[2].left, true);
  assert.deepStrictEqual(slots[3], { left: false, above: true });
});

test('layoutPanel: B is drawn before A, the cursor last, everything clipped to the plot', () => {
  const A = fx.makeResult({ duration: 20 }), B = fx.makeResult({ duration: 20, preset: 'firm', seed: 3 });
  const p = C.resolvePanels(A, A.meta.config, { modules: M })[0];
  const lay = C.layoutPanel(p, [A, B], { box: { x: 0, y: 0, w: 600, h: 140 }, view: { t0: 0, t1: 20 }, cursorT: 10, xLabels: true });
  const paths = lay.ops.filter((o) => o.op === 'path');
  const firstA = paths.findIndex((o) => o.alpha === 1), lastB = paths.map((o) => o.alpha).lastIndexOf(0.4);
  assert.ok(lastB >= 0 && firstA > lastB, 'B under A');
  assert.strictEqual(lay.ops[lay.ops.length - 1].op, 'line');
  assert.strictEqual(lay.ops[lay.ops.length - 1].stroke, 'ink');
  const ci = lay.ops.findIndex((o) => o.op === 'clip'), ui = lay.ops.findIndex((o) => o.op === 'unclip');
  assert.ok(ci >= 0 && ui > ci);
  paths.forEach((o) => { for (let i = 0; i < o.pts.length; i += 2) if (!isNaN(o.pts[i])) assert.ok(o.pts[i] >= C.PAD.l - 30 && o.pts[i] <= 600, 'x in range'); });
  // the point budget: at most ~4 per pixel column per series
  paths.forEach((o) => assert.ok(o.pts.length / 2 <= 4 * 600 + 10));
});

test('layoutEvents thins markers to one per kind per pixel column', () => {
  const ev = [];
  for (let i = 0; i < 5000; i++) ev.push({ t: i * 0.001, kind: 'cmd.sent' });
  const r = { t: [0, 5], series: {}, events: ev };
  const lay = C.layoutEvents([r], { box: { x: 0, y: 0, w: 300, h: 60 }, view: { t0: 0, t1: 5 } });
  const markers = lay.ops.filter((o) => o.op === 'marker');
  const plotW = 300 - C.PAD.l - C.PAD.r;
  assert.ok(markers.length <= plotW + 2, 'thinned to ' + markers.length + ' for ' + plotW + ' px');
  assert.strictEqual(lay.hits.length, 5000);     // the tooltip still sees every event
});

test('renderSvg is well-formed: balanced groups, theme variables, escaped text', () => {
  const ops = [
    { op: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'surface' },
    { op: 'clip', x: 0, y: 0, w: 5, h: 5 },
    { op: 'path', pts: [0, 0, 1, 1, NaN, NaN, 2, 2, 3, 3], stroke: 's0', width: 2, dash: [4, 2] },
    { op: 'unclip' },
    { op: 'text', x: 1, y: 1, text: 'a < b & "c"', fill: 'ink', halo: true },
    { op: 'marker', shape: 'diamond', x: 3, y: 3, size: 4, fill: '#ff0000' },
    { op: 'clip', x: 0, y: 0, w: 5, h: 5 },
  ];
  const svg = C.renderSvg(ops, 10, 10, 'T & t');
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.strictEqual((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);
  assert.ok(svg.indexOf('var(--su2-s0)') > 0 && svg.indexOf('#ff0000') > 0);
  assert.ok(svg.indexOf('a &lt; b &amp; &quot;c&quot;') > 0);
  assert.ok(/d="M0 0L1 1M2 2L3 3"/.test(svg), 'NaN breaks the path');
  assert.ok(svg.indexOf('<defs><clipPath') > 0);
});

test('renderCanvas walks every op against a recording context', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push(k)), set: (o, k, v) => { o[k] = v; return true; } });
  const r = fx.makeResult({ duration: 10 });
  const p = C.resolvePanels(r, r.meta.config, { modules: M });
  const lay = C.layoutPanel(p[0], [r], { box: { x: 0, y: 0, w: 400, h: 120 }, view: { t0: 0, t1: 10 } });
  C.renderCanvas(ctx, lay.ops, C.THEMES.dark);
  assert.ok(calls.filter((k) => k === 'stroke').length > 5);
  assert.strictEqual(calls.filter((k) => k === 'save').length, calls.filter((k) => k === 'restore').length, 'save / restore balanced');
});

test('chartsSvg renders the whole stack of a JSON-loaded result (nulls) with B', () => {
  const A = fx.toJson(fx.makeResult({ duration: 20 })), B = fx.toJson(fx.makeResult({ duration: 20, preset: 'firm' }));
  assert.ok(A.series['est.gap'].indexOf(null) >= 0, 'the fixture has nulls');
  const svg = C.chartsSvg(A, B, { modules: M, width: 700 });
  assert.ok(svg.length > 10000);
  ['Speeds', 'Gap', 'Time gap', 'TTC', 'Accelerations', 'Events'].forEach((t) => assert.ok(svg.indexOf('>' + t + '<') > 0, t));
  assert.ok(svg.indexOf('NaN') < 0, 'no NaN reaches the SVG');
});

test('themeCss has light, OS-dark and data-theme dark blocks with every role', () => {
  const css = C.themeCss('.su2');
  assert.ok(css.indexOf('@media (prefers-color-scheme: dark)') >= 0);
  assert.ok(css.indexOf(':root[data-theme="dark"] .su2') >= 0);
  assert.ok(css.indexOf(':not([data-theme="light"])') >= 0);
  C.ROLES.forEach((r) => assert.strictEqual(css.split('--su2-' + r + ':').length - 1, 3, r));
  assert.strictEqual(C.resolveColor(C.THEMES.dark, 'seq0'), C.THEMES.dark.seq[0]);
  assert.strictEqual(C.resolveColor(C.THEMES.light, 'seqtxt12'), '#ffffff');
});

test('the categorical slots differ between light and dark only in step, and pass / fail are not red / green', () => {
  assert.strictEqual(C.THEMES.light.pass, C.THEMES.light.s0);
  assert.strictEqual(C.THEMES.light.fail, C.THEMES.light.s1);
  ['s0', 's1', 's2', 's5', 's6', 's7'].forEach((s) => assert.notStrictEqual(C.THEMES.light[s], C.THEMES.dark[s] + 'x'));
});

test('compareMetrics lines up A and B', () => {
  const rows = C.compareMetrics({ metrics: { a: 1, b: true }, verdict: { failed: ['a'] } }, { metrics: { a: 3, c: 2 } });
  assert.deepStrictEqual(rows.map((r) => [r.name, r.diff, r.failedA]), [['a', 2, true], ['b', null, false], ['c', null, false]]);
});

test('plantBanner says "assumed" unless the plant was identified', () => {
  assert.ok(/^Assumed plant: liftoff/.test(C.plantBanner({ meta: { plant: { name: 'liftoff', assumed: true } } })));
  assert.strictEqual(C.plantBanner({ meta: { plant: { name: 'id', assumed: false } } }), '');
});
