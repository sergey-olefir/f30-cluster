/* Cruise simulator — the report view (SU2).
 *
 * buildReport(data) -> one self-contained HTML page (inline CSS and SVG, no script, light and dark):
 * the configuration, the plant and whether it is assumed, the current run's metrics against the
 * thresholds and its charts, the scenario matrix, the feasibility map, the sensitivity tornado, the
 * best tuning sets, the worst cases, and the list "measure this first on the car, because the verdict
 * turns on it". The summary is in English and in Ukrainian.
 *
 * Pure and Node-loadable, so SC3's `node tools/cruise-sim/report.js` may call it with the same data;
 * mount(el, app) is the page's button: it previews the report and downloads the file (the browser
 * cannot write into bake/work/cruise-sim/reports/: the owner saves it there).
 */
(function () {
  'use strict';
  // Browser: siblings resolve when first used, so the page may load the ui files in any order.
  function lazy(n) { return new Proxy({}, { get: function (_, k) { return self.CS[n][k]; } }); }
  const charts = typeof require !== 'undefined' ? require('./charts.js') : lazy('charts');
  const batchLib = typeof require !== 'undefined' ? require('./batch.js') : lazy('batch');
  const settingsLib = typeof require !== 'undefined' ? require('./settings.js') : lazy('settings');
  function esc(s) { return charts.esc(s); }
  function fmt(v, d) { return charts.fmt(v, d); }

  // What to measure on the car for a parameter the verdict turns on (first match wins).
  const MEASURE = [
    { re: /^plant\.(aMin|brakeMax|decel)/i, en: 'The cruise\'s deceleration on a large set-speed drop, on a flat road and downhill — does DCC brake, or only lift off? (Phase 2, set-speed steps of −10 / −20 km/h)', uk: 'Сповільнення круїзу при великому зниженні заданої швидкості, на рівній дорозі й на спуску: чи DCC гальмує, чи лише скидає газ (фаза 2, кроки −10 / −20 км/год)' },
    { re: /^plant\.deadTime/i, en: 'The cruise\'s dead time: from a set-speed change to the first change of acceleration (Phase 2, set-speed steps)', uk: 'Чисте запізнення круїзу: від зміни заданої швидкості до першої зміни прискорення (фаза 2)' },
    { re: /^plant\.tau/i, en: 'The cruise\'s time constant: how fast the speed follows a new set speed (Phase 2, step fits)', uk: 'Стала часу круїзу: як швидко швидкість іде за новою заданою (фаза 2)' },
    { re: /^plant\.aMax/i, en: 'The cruise\'s strongest acceleration on a large upward step (Phase 2)', uk: 'Найбільше прискорення круїзу на великому кроці вгору (фаза 2)' },
    { re: /^plant\.(resolution|acceptInterval|vMin|vMax|dropout)/i, en: 'The cruise\'s set-speed resolution, accepted change rate and active speed range (Phase 2)', uk: 'Крок заданої швидкості, допустима частота змін і діапазон активної роботи круїзу (фаза 2)' },
    { re: /^sensor\.(rate|.*hz)/i, en: 'The native rate of the gap signal on the head unit (Phase 0 recorder)', uk: 'Власна частота сигналу дистанції на головному пристрої (рекордер, фаза 0)' },
    { re: /^sensor\.(latency|jitter)/i, en: 'The latency of the gap reading path (Phase 1: cross-correlation, a filmed brake-light event)', uk: 'Затримка шляху читання дистанції (фаза 1: крос-кореляція, знята на відео подія стоп-сигналів)' },
    { re: /^sensor\./i, en: 'The camera gap\'s noise, range and dropouts (Phase 1 calibration drive)', uk: 'Шум, дальність і пропуски дистанції з камери (калібрувальний заїзд, фаза 1)' },
    { re: /^command\./i, en: 'The command path (delay, accepted rate, drops): a paper study in this phase — nothing is written to the car', uk: 'Шлях команди (затримка, частота, втрати): у цій фазі лише кабінетне дослідження — на авто нічого не пишеться' },
    { re: /^estimator\./i, en: 'Estimator tuning against the logged gap (Phase 3), not a car measurement', uk: 'Налаштування оцінювача на записаній дистанції (фаза 3), не вимірювання на авто' },
    { re: /^(controller|warning)\./i, en: 'Controller / warning tuning, not a car measurement', uk: 'Налаштування регулятора / попередження, не вимірювання на авто' },
    { re: /^driver\./i, en: 'Driver behaviour: from the literature, not this car', uk: 'Поведінка водія: з літератури, не з цього авто' },
  ];
  // Without a sensitivity study: the parent brief's own order.
  const DEFAULT_MEASURE = ['plant.aMin_ms2', 'plant.deadTime_s', 'sensor.rateHz', 'sensor.latency_s', 'plant.tau_s', 'command.delay_s'];

  function measureFor(param) {
    for (let i = 0; i < MEASURE.length; i++) if (MEASURE[i].re.test(param)) return MEASURE[i];
    return { en: 'No car measurement mapped for this parameter', uk: 'Для цього параметра вимірювання на авто не визначено' };
  }

  /**
   * The ranked "measure first" list: parameters whose ±30 % changes most verdicts (then the largest
   * change of the score), mapped to what the drive must measure. Car-independent parameters
   * (controller, warning, estimator, driver) are listed after the car ones.
   */
  function measureFirst(tornado) {
    let list;
    if (tornado && tornado.bars && tornado.bars.length) {
      list = tornado.bars.map(function (b) { return { param: b.param, changed: (b.changedLow || 0) + (b.changedHigh || 0), delta: b.delta, low: b.low, high: b.high, base: b.base }; });
      list.sort(function (a, b) { return (b.changed - a.changed) || (b.delta - a.delta); });
    } else list = DEFAULT_MEASURE.map(function (p) { return { param: p, changed: null, delta: null }; });
    const car = function (p) { return /^(plant|sensor|command)\./.test(p); };
    list.sort(function (a, b) { return (car(b.param) - car(a.param)); });
    return list.map(function (x, i) { const m = measureFor(x.param); return Object.assign({ rank: i + 1, en: m.en, uk: m.uk, fromSensitivity: x.changed !== null }, x); });
  }

  // ---------------------------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------------------------
  function metricsModule(modules) { return (modules && modules.metrics) || null; }

  /** The current run's metrics against the thresholds: [{ name, label, value, threshold, op, pass }]. */
  function metricsRows(result, config, modules) {
    const mm = metricsModule(modules);
    const NAME = (mm && mm.NAME) || 'thresholds';
    const thr = Object.assign({}, (config && (config[NAME] || config.thresholds)) || {});
    const failed = (result && result.verdict && result.verdict.failed) || [];
    const unknown = (result && result.verdict && result.verdict.unknown) || [];
    const m = (result && result.metrics) || {};
    return Object.keys(m).map(function (k) {
      const d = mm && mm.BY_KEY ? mm.BY_KEY[k] : null;
      const op = batchLib.metricOp(k, modules);
      const th = op === 'false' || op === 'true' ? null : batchLib.thresholdOf(k, thr, modules);
      const mg = batchLib.margin(k, m[k], thr, modules);
      return {
        name: k, label: d && d.label ? d.label : k, unit: d && d.unit ? d.unit : '', value: m[k], op: op, threshold: isFinite(th) ? th : null,
        decides: failed.indexOf(k) >= 0 || unknown.indexOf(k) >= 0 || (result.meta && result.meta.decide ? result.meta.decide.indexOf(k) >= 0 : false),
        state: failed.indexOf(k) >= 0 ? 'fail' : unknown.indexOf(k) >= 0 ? 'unknown' : isFinite(mg) ? (mg >= 0 ? 'pass' : 'over') : 'info',
      };
    });
  }

  function opText(op, th) {
    if (op === 'false') return 'must be no';
    if (op === 'true') return 'must be yes';
    if (th === null || th === undefined) return '';
    return (op === '>=' ? '≥ ' : op === '<=' ? '≤ ' : '') + fmt(th);
  }

  /** The worst runs of a batch: failed first (most failed metrics), then the smallest margin. */
  function worstRuns(batch, n, modules) {
    if (!batch) return [];
    const thr = batch.thresholds;
    return batch.runs.map(function (r) {
      const dm = batchLib.decidingMetric(r, thr, modules);
      const mg = dm ? batchLib.margin(dm.name, dm.value, thr, modules) : NaN;
      return { run: r, metric: dm, margin: mg, failedN: r.verdict && r.verdict.failed ? r.verdict.failed.length : 0 };
    }).sort(function (a, b) {
      const fa = a.run.verdict && !a.run.verdict.pass ? 1 : 0, fb = b.run.verdict && !b.run.verdict.pass ? 1 : 0;
      return (fb - fa) || (b.failedN - a.failedN) || ((isFinite(a.margin) ? a.margin : 9) - (isFinite(b.margin) ? b.margin : 9));
    }).filter(function (x, i, arr) {
      // one per scenario (the worst variant), so the list is not ten copies of one family
      return arr.findIndex(function (y) { return y.run.scenario === x.run.scenario; }) === i;
    }).slice(0, n || 8);
  }

  function matrixHtml(batch, modules) {
    const mm = batchLib.matrixModel(batchLib.studyRuns(batch, 'matrix'), { thresholds: batch.thresholds, modules: modules });
    let out = '<p class="note">' + mm.pass + ' of ' + mm.total + ' runs pass. ✓ pass · ✗ fail · <span class="scope">dashed</span>: scored on the warning only / out of the envelope; each cell shows the metric that decided it.</p>';
    mm.families.forEach(function (f) {
      out += '<h4>Family ' + esc(f.family) + ' — ' + f.pass + ' / ' + f.total + ' pass</h4><table class="matrix">';
      f.rows.forEach(function (row) {
        out += '<tr><th>' + esc(row.scenario) + (row.name ? '<small>' + esc(row.name) + '</small>' : '') + '</th><td>';
        row.cells.forEach(function (c) {
          const cls = c.state.indexOf('pass') === 0 ? 'pass' : c.state === 'fail' ? 'fail' : 'na';
          const g = cls === 'pass' ? '✓' : cls === 'fail' ? '✗' : '?';
          const mt = c.metric ? batchLib.shortMetric(c.metric.name) + ' ' + fmt(c.metric.value) : '';
          out += '<span class="cell ' + cls + (c.scope && c.scope !== 'in' ? ' scope' : '') + '"><b>' + g + ' ' + esc(c.label) + '</b>' + esc(mt) + '</span>';
        });
        out += '</td></tr>';
      });
      out += '</table>';
    });
    return out;
  }

  /** Maps for the first pairs of swept parameters (pass share), each with its frontier sentence. */
  function mapsHtml(batch, modules, max) {
    const runs = batchLib.studyRuns(batch, 'map');
    const axes = batchLib.paramAxes(runs);
    if (axes.length < 2) return { html: '<p class="note">This batch varies fewer than two parameters: no feasibility map.</p>', headline: null };
    const pairs = [];
    for (let i = 0; i < axes.length && pairs.length < (max || 1); i++) for (let j = i + 1; j < axes.length && pairs.length < (max || 1); j++) pairs.push([axes[i].key, axes[j].key]);
    let html = '', headline = null;
    const presets = batchLib.presetPoints(batch, modules);
    pairs.forEach(function (p) {
      const g = batchLib.heatGrid(runs, p[0], p[1], { kind: 'passShare' }, { modules: modules });
      const marks = batchLib.presetMarks(g, presets);
      const w = 760, hh = Math.max(280, Math.min(520, 70 + g.y.n * 34));
      const lay = batchLib.layoutHeatmap(g, { box: { x: 0, y: 0, w: w, h: hh }, marks: marks, target: 1 });
      html += '<figure>' + charts.renderSvg(lay.ops, w, hh, 'Feasibility map: ' + p[0] + ' × ' + p[1]) + '<figcaption>Share of the catalogue that passes over ' + esc(p[0]) + ' × ' + esc(p[1]) + '; the thick line is the 100 % frontier; diamonds are the plant presets.</figcaption></figure>';
      // the presets' cells, in words
      const lines = marks.map(function (m) {
        const i = Math.round(Math.max(0, Math.min(g.x.n - 1, m.fx))), j = Math.round(Math.max(0, Math.min(g.y.n - 1, m.fy)));
        const c = g.cells[j] && g.cells[j][i];
        return c && c.value !== null ? m.name + ': ' + Math.round(c.value * 100) + ' %' : null;
      }).filter(Boolean);
      let best = null;
      g.cells.forEach(function (row, j) { row.forEach(function (c, i) { if (c.value !== null && (!best || c.value > best.v)) best = { v: c.value, x: g.x.labels[i], y: g.y.labels[j] }; }); });
      const h = { x: p[0], y: p[1], presets: lines, best: best };
      if (!headline) headline = h;
      html += '<p>' + (lines.length ? 'At the plant presets the catalogue passes: ' + esc(lines.join(', ')) + '. ' : '') + (best ? 'Best cell: ' + esc(p[0]) + ' = ' + esc(best.x) + ', ' + esc(p[1]) + ' = ' + esc(best.y) + ' (' + Math.round(best.v * 100) + ' %).' : '') + '</p>';
    });
    return { html: html, headline: headline };
  }

  function tuningHtml(batch, modules) {
    const runs = batchLib.studyRuns(batch, 'tuning');
    if (!runs.some(function (r) { return r.study === 'tuning' || r.set !== undefined; })) return '';
    const tt = batchLib.tuningTable(runs, { thresholds: batch.thresholds, modules: modules });
    let out = '<table class="data"><tr><th>Set</th>' + tt.varying.map(function (k) { return '<th class="num">' + esc(k) + '</th>'; }).join('') + '<th class="num">pass</th><th class="num">comfort cost</th>' + tt.comfort.map(function (c) { return '<th class="num">' + esc(c.label) + '</th>'; }).join('') + '</tr>';
    tt.rows.slice(0, 10).forEach(function (r, i) {
      out += '<tr><td>' + (r.pareto ? '★ ' : '') + (i + 1) + '. ' + esc(r.set) + '</td>' + tt.varying.map(function (k) { return '<td class="num">' + esc(fmt(r.params[k])) + '</td>'; }).join('') +
        '<td class="num">' + Math.round(r.passShare * 100) + ' %</td><td class="num">' + esc(fmt(r.cost, 2)) + '</td>' + tt.comfort.map(function (c) { return '<td class="num">' + esc(fmt(r.comfort[c.name])) + '</td>'; }).join('') + '</tr>';
    });
    return out + '</table><p class="note">Ranked by pass share, then comfort cost (each comfort metric over its threshold, averaged). ★ = no other set is better on both.' + (tt.fixed.length ? ' Fixed: ' + esc(tt.fixed.map(function (f) { return f.key + ' = ' + f.value; }).join(', ')) + '.' : '') + '</p>';
  }

  const REPORT_CSS = [
    'body { margin: 0; background: var(--su2-page); color: var(--su2-ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }',
    'main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }',
    'h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 8px; border-bottom: 1px solid var(--su2-grid); padding-bottom: 4px; } h4 { margin: 14px 0 4px; font-size: 13px; }',
    '.note, figcaption { color: var(--su2-ink2); font-size: 12px; }',
    '.banner { border: 1px solid var(--su2-s3); border-radius: 6px; padding: 8px 12px; margin: 12px 0; }',
    '.banner b::before { content: "⚠ "; color: var(--su2-s3); }',
    '.banner.ok { border-color: var(--su2-s0); } .banner.ok b::before { content: "✓ "; color: var(--su2-s0); }',
    'figure { margin: 12px 0; overflow-x: auto; background: var(--su2-surface); border: 1px solid var(--su2-border); border-radius: 6px; padding: 8px; }',
    'svg { max-width: 100%; height: auto; }',
    'table.data { border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; width: 100%; }',
    'table.data th, table.data td { padding: 3px 8px; border-bottom: 1px solid var(--su2-grid); text-align: left; vertical-align: top; }',
    'table.data .num { text-align: right; white-space: nowrap; }',
    '.st-pass { color: var(--su2-s0); } .st-fail, .st-over { color: var(--su2-s1); font-weight: 600; }',
    'table.matrix { border-collapse: collapse; width: 100%; font-size: 11px; }',
    'table.matrix th { text-align: left; font-weight: 500; width: 200px; padding: 3px 8px 3px 0; vertical-align: top; border-bottom: 1px solid var(--su2-grid); }',
    'table.matrix th small { display: block; color: var(--su2-ink2); font-weight: 400; }',
    'table.matrix td { padding: 3px 0; border-bottom: 1px solid var(--su2-grid); }',
    '.cell { display: inline-block; min-width: 66px; margin: 1px; padding: 2px 5px; border-radius: 4px; color: #fff; font-variant-numeric: tabular-nums; vertical-align: top; }',
    '.cell b { display: block; font-weight: 600; } .cell.pass { background: var(--su2-pass); } .cell.fail { background: var(--su2-fail); } .cell.na { background: var(--su2-na); color: var(--su2-ink); }',
    '.cell.scope, .scope { outline: 1px dashed var(--su2-ink2); outline-offset: -3px; }',
    'ol.measure li { margin: 0 0 8px; } ol.measure .uk { color: var(--su2-ink2); display: block; }',
    'details pre { font-size: 11px; overflow-x: auto; background: var(--su2-surface); padding: 8px; border-radius: 6px; }',
    '.uk-summary { background: var(--su2-surface); border: 1px solid var(--su2-border); border-radius: 6px; padding: 8px 12px; }',
  ].join('\n');

  /**
   * data = { config, result?, resultB?, batch? (normalised or raw), modules?, created?, title?, worst? }
   * Returns the whole HTML page as a string.
   */
  function buildReport(data) {
    data = data || {};
    const modules = data.modules || {};
    const result = data.result || null;
    const config = data.config || (result && result.meta && result.meta.config) || {};
    const batch = data.batch ? (data.batch.runs && data.batch.runs[0] && data.batch.runs[0].i !== undefined ? data.batch : batchLib.normalizeBatch(data.batch)) : null;
    const created = data.created || new Date().toISOString();
    const plant = (result && result.meta && result.meta.plant) || (batch && batch.plant) || null;
    const assumed = !plant || plant.assumed !== false;
    const plantName = plant && plant.name ? plant.name : (config.plant && (config.plant.preset || 'unnamed')) || 'unnamed';
    const parts = [];
    const ukParts = [];
    const enSummary = [];

    parts.push('<h1>' + esc(data.title || 'Cruise set-speed simulator — report') + '</h1>');
    parts.push('<p class="note">' + esc(created.slice(0, 16).replace('T', ' ')) + ' · offline simulation; nothing here was read from or written to a car.</p>');
    parts.push(assumed
      ? '<div class="banner"><b>Assumed plant: ' + esc(plantName) + '.</b> No drive has identified the stock cruise yet, so these results show which numbers the concept needs — they are not a verdict.</div>'
      : '<div class="banner ok"><b>Identified plant: ' + esc(plantName) + '.</b></div>');

    // ---- the current run
    let runHtml = '';
    if (result) {
      const scen = config.scenario && (config.scenario.id || (config.scenario.inline && config.scenario.inline.id)) || '(inline)';
      const v = result.verdict || {};
      enSummary.push('The current run (' + scen + ') ' + (v.pass ? 'passes' : 'fails' + (v.failed && v.failed.length ? ' on ' + v.failed.join(', ') : '')) + '.');
      ukParts.push('Поточний прогін (' + scen + ') ' + (v.pass ? 'проходить' : 'не проходить' + (v.failed && v.failed.length ? ' за ' + v.failed.join(', ') : '')) + '.');
      const rows = metricsRows(result, config, modules);
      runHtml += '<h2>The current run: ' + esc(scen) + '</h2><table class="data"><tr><th>Metric</th><th class="num">Value</th><th class="num">Threshold</th><th>Result</th></tr>';
      rows.forEach(function (r) {
        const st = r.state === 'fail' ? '<span class="st-fail">✗ fails</span>' : r.state === 'over' ? '<span class="st-over">✗ over (not deciding)</span>' : r.state === 'pass' ? '<span class="st-pass">✓</span>' : r.state === 'unknown' ? '? unknown' : '';
        runHtml += '<tr><td>' + esc(r.label) + (r.label !== r.name ? ' <span class="note">' + esc(r.name) + '</span>' : '') + '</td><td class="num">' + esc(fmt(r.value)) + (r.unit ? ' ' + esc(r.unit) : '') + '</td><td class="num">' + esc(opText(r.op, r.threshold)) + '</td><td>' + st + '</td></tr>';
      });
      runHtml += '</table>';
      if (result.t && result.series) {
        runHtml += '<figure>' + charts.chartsSvg(result, data.resultB || null, { config: config, modules: modules, width: 800, title: 'Time charts of ' + scen }) + '<figcaption>Speeds, gap, time gap and TTC with their thresholds, accelerations with the plant limits, events. Shaded: the warning is on.' + (data.resultB ? ' Faint: run B.' : '') + '</figcaption></figure>';
      }
    }

    // ---- batch
    let matrixPart = '', mapPart = '', sensPart = '', tunePart = '', worstPart = '';
    let tornado = null;
    if (batch && batch.runs.length) {
      const mm = batchLib.matrixModel(batchLib.studyRuns(batch, 'matrix'), { thresholds: batch.thresholds, modules: modules });
      enSummary.push('Scenario matrix: ' + mm.pass + ' of ' + mm.total + ' runs pass' + (assumed ? ' with the assumed plant' : '') + '.');
      ukParts.push('Матриця сценаріїв: проходить ' + mm.pass + ' із ' + mm.total + ' прогонів' + (assumed ? ' (з припущеною моделлю круїзу)' : '') + '.');
      matrixPart = '<h2>Scenario matrix</h2>' + matrixHtml(batch, modules);
      const maps = mapsHtml(batch, modules, data.maps || 2);
      mapPart = '<h2>Feasibility map</h2>' + maps.html;
      if (maps.headline && maps.headline.presets.length) {
        enSummary.push('Feasibility map over ' + maps.headline.x + ' × ' + maps.headline.y + ', with an assumed plant: at the presets ' + maps.headline.presets.join(', ') + ' of the catalogue passes.');
        ukParts.push('Карта здійсненності ' + maps.headline.x + ' × ' + maps.headline.y + ' (модель круїзу припущена): у пресетах проходить ' + maps.headline.presets.join(', ') + ' каталогу.');
      }
      const sensRuns = batchLib.studyRuns(batch, 'sensitivity').filter(function (r) { return r.side; });
      if (sensRuns.length) {
        tornado = batchLib.tornadoModel(sensRuns, { kind: 'passShare' }, modules);
        const lay = batchLib.layoutTornado(tornado, { box: { w: 760 } });
        sensPart = '<h2>Sensitivity (±30 %)</h2><figure>' + charts.renderSvg(lay.ops, lay.w, lay.h, 'Sensitivity tornado') + '<figcaption>Share of the catalogue that passes with each parameter at −30 % and +30 % of its base value; ⚑n = n scenario variants whose verdict changes.</figcaption></figure>';
      }
      tunePart = tuningHtml(batch, modules);
      if (tunePart) tunePart = '<h2>Tuning sweep</h2>' + tunePart;
      const worst = worstRuns(batch, data.worst || 8, modules);
      if (worst.length) {
        worstPart = '<h2>Worst cases</h2><table class="data"><tr><th>Scenario</th><th>Variant</th><th>Verdict</th><th>Deciding metric</th></tr>' + worst.map(function (w) {
          const r = w.run;
          return '<tr><td>' + esc(r.scenario) + '</td><td>' + esc(r.label) + '</td><td>' + (r.verdict ? (r.verdict.pass ? '<span class="st-pass">✓</span>' : '<span class="st-fail">✗ ' + esc((r.verdict.failed || []).join(', ')) + '</span>') : '?') + '</td><td>' + (w.metric ? esc(w.metric.name + ' = ' + fmt(w.metric.value)) : '') + '</td></tr>';
        }).join('') + '</table>';
        worst.forEach(function (w) {
          if (w.run.result && w.run.result.t) worstPart += '<figure>' + charts.chartsSvg(w.run.result, null, { config: w.run.config || config, modules: modules, width: 800, panels: ['speed', 'gap', 'ttc', 'events'], title: w.run.id }) + '<figcaption>' + esc(w.run.id) + '</figcaption></figure>';
        });
        if (!worst.some(function (w) { return w.run.result; })) worstPart += '<p class="note">The batch file carries no series, so the worst cases have no charts here: open one from the matrix in the page to see it.</p>';
      }
    }

    // ---- measure first
    const mf = measureFirst(tornado);
    const top = mf.slice(0, 3).map(function (x) { return x.param; });
    enSummary.push('Measure first on the car' + (tornado ? ' (the verdict turns on these)' : ' (no sensitivity study in this report: the parent brief\'s order)') + ': ' + top.join(', ') + '.');
    ukParts.push('Що виміряти на авто першим' + (tornado ? ' (від цього залежить вердикт)' : ' (дослідження чутливості немає: порядок із батьківського брифу)') + ': ' + top.join(', ') + '.');
    let measurePart = '<h2>Measure this first on the car, because the verdict turns on it</h2><ol class="measure">';
    mf.forEach(function (x) {
      measurePart += '<li><b>' + esc(x.param) + '</b>' + (x.fromSensitivity ? ' <span class="note">— ' + x.changed + ' variant verdict(s) change at ±30 %; pass share ' + Math.round(x.low * 100) + ' % / ' + Math.round(x.high * 100) + ' % against ' + Math.round(x.base * 100) + ' %</span>' : '') + '<br>' + esc(x.en) + '<span class="uk">' + esc(x.uk) + '</span></li>';
    });
    measurePart += '</ol>';

    // ---- configuration
    let snap = {};
    try { snap = settingsLib.snapshot(settingsLib.findModules(modules), config); } catch (e) { snap = config; }
    const changedRows = [];
    Object.keys(snap).forEach(function (k) {
      const v = snap[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach(function (kk) { changedRows.push([k + '.' + kk, v[kk]]); });
      else changedRows.push([k, v]);
    });
    const configPart = '<h2>Configuration</h2><p class="note">Settings that differ from the modules\' defaults (the plant preset and model are always listed).</p><table class="data">' +
      changedRows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(typeof r[1] === 'object' ? JSON.stringify(r[1]) : String(r[1])) + '</td></tr>'; }).join('') +
      '</table><details><summary>The whole config (JSON)</summary><pre>' + esc(JSON.stringify(config, null, 2)) + '</pre></details>';

    const summary = '<h2>Summary</h2><p>' + esc(enSummary.join(' ')) + (assumed ? ' Everything here rests on an assumed plant.' : '') + '</p>' +
      '<div class="uk-summary" lang="uk"><b>Підсумок.</b> ' + esc((assumed ? 'Модель круїзу припущена (' + plantName + '): це не вердикт, а перелік того, від чого він залежить. ' : 'Модель круїзу ідентифікована (' + plantName + '). ') + ukParts.join(' ')) + '</div>';

    const body = parts.join('\n') + summary + measurePart + runHtml + matrixPart + mapPart + sensPart + tunePart + worstPart + configPart;
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Cruise sim report</title><style>\n' + charts.themeCss('.su2') + REPORT_CSS + '\n</style></head><body class="su2"><main>' + body + '</main></body></html>\n';
  }

  function reportFileName(d) {
    d = d || new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'cruise-sim-report-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.html';
  }

  // ---------------------------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------------------------
  const CSS = '.su2-report iframe { width: 100%; height: 640px; border: 1px solid var(--su2-border); border-radius: 6px; background: var(--su2-page); }';

  function mount(el, app, opts) {
    opts = opts || {};
    const h = charts.h;
    charts.ensureStyle(el.ownerDocument, 'su2-style-report', CSS);
    el.classList.add('su2', 'su2-report');
    el.innerHTML = '';
    let html = '';
    const info = h('span', { class: 'su2-note' });
    const withB = h('input', { type: 'checkbox' });
    const frame = h('iframe', { title: 'Report preview', sandbox: '' });
    const dl = h('button', { type: 'button', class: 'su2-primary', disabled: true, onclick: function () { if (html) charts.downloadText(reportFileName(), html, 'text/html'); } }, ['Download HTML']);
    el.appendChild(h('div', { class: 'su2-toolbar' }, [
      h('button', { type: 'button', onclick: build }, ['Build report']),
      dl,
      h('label', { class: 'su2-chip', title: 'Overlay the pinned run B on the charts, when there is one' }, [withB, 'with run B']),
      info,
    ]));
    el.appendChild(h('p', { class: 'su2-note', text: 'The report is one self-contained HTML file: the current run, the loaded batch (matrix, feasibility map, sensitivity, tuning), the worst cases and what to measure first. Save it into bake/work/cruise-sim/reports/. The same file comes from Node: node tools/cruise-sim/report.js.' }));
    el.appendChild(frame);

    function modules() { return opts.modules || (typeof self !== 'undefined' && self.CS) || {}; }
    function build() {
      const t0 = Date.now();
      const b = (batchLib.current && batchLib.current()) || (app.batch ? batchLib.normalizeBatch(app.batch) : null);
      try {
        html = buildReport({ config: app.config, result: app.result, resultB: withB.checked ? (app.resultB || app.compare || null) : null, batch: b, modules: modules() });
      } catch (e) { info.textContent = 'Could not build: ' + e.message; return; }
      frame.srcdoc = html;
      dl.disabled = false;
      info.textContent = 'Built in ' + (Date.now() - t0) + ' ms, ' + Math.round(html.length / 1024) + ' KB' + (app.result ? '' : ' (no run yet)') + (b ? ', batch of ' + b.runs.length + ' runs' : ', no batch loaded');
    }
    const offs = [
      charts.listen(app, 'result', function () { info.textContent = html ? 'The run changed: build again to update.' : info.textContent; }),
    ];
    return { destroy: function () { offs.forEach(function (o) { o(); }); el.innerHTML = ''; }, build: build };
  }

  const reportView = { MEASURE: MEASURE, measureFor: measureFor, measureFirst: measureFirst, metricsRows: metricsRows, worstRuns: worstRuns, buildReport: buildReport, reportFileName: reportFileName, mount: mount };
  if (typeof module !== 'undefined') module.exports = reportView; else (self.CS = self.CS || {})['reportView'] = reportView;
})();
