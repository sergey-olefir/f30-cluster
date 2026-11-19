/* Cruise simulator — batch views (SU2).
 *
 *   the scenario matrix   every scenario × its variations, pass / fail cells with the deciding metric;
 *                         a click opens that run in the scene
 *   the feasibility map   a heat map over any two swept parameters (pass share or a metric), the plant
 *                         presets marked on it — the tool's main picture while the plant is assumed
 *   sensitivity           which parameter moved by ±30 % changes the verdict (a tornado)
 *   tuning sweep          the tuning sets ranked by pass share, with their comfort cost
 *
 * Input: a batch file from `node tools/cruise-sim/sweep.js <plan.json>` (SC3), handed over by the shell
 * as app.batch / 'batch', or loaded here; short batches can also run in the page (main thread, in
 * chunks, cancellable) when the core is loaded. The reader is tolerant: see normalizeBatch().
 */
(function () {
  'use strict';
  // Browser: siblings resolve when first used, so the page may load the ui files in any order.
  function lazy(n) { return new Proxy({}, { get: function (_, k) { return self.CS[n][k]; } }); }
  const charts = typeof require !== 'undefined' ? require('./charts.js') : lazy('charts');
  function fmt(v, d) { return charts.fmt(v, d); }

  // ---------------------------------------------------------------------------------------------
  // Reading a batch
  // ---------------------------------------------------------------------------------------------
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  /** Flatten { a: { b: 1 } } -> { 'a.b': 1 } (arrays and nulls are leaves). */
  function flatten(o, prefix, out) {
    out = out || {};
    Object.keys(o || {}).forEach(function (k) {
      const v = o[k], p = prefix ? prefix + '.' + k : k;
      if (isObj(v)) flatten(v, p, out); else out[p] = v;
    });
    return out;
  }

  function variantText(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    return Object.keys(v).map(function (k) { return shortKey(k) + '=' + (typeof v[k] === 'number' ? +v[k].toFixed(3) : v[k]); }).join(', ');
  }

  function shortKey(k) {
    const parts = String(k).replace(/\[(\w+)\]/g, '.$1').split('.');
    return parts[parts.length - 1] || k;
  }

  /** One run of any plausible shape -> the shape the views use. */
  function normalizeRun(r, i) {
    const sc = r.scenario;
    const scenObj = isObj(sc) ? sc : null;
    let scenario = scenObj ? (scenObj.base || scenObj.id) : (sc || r.base || r.scenarioId || '');
    let reaction = r.reaction || (scenObj && scenObj.reaction) || null;
    let variant = r.variant || (scenObj && scenObj.variant) || null;
    if (!variant && typeof r.id === 'string' && r.id.indexOf('#') > 0) variant = r.id.split('#')[1].split('/')[0];
    if (!scenario && typeof r.id === 'string') scenario = r.id.split(/[#/]/)[0];
    let label = r.label || (scenObj && scenObj.label) || variantText(variant);
    if (reaction && reaction !== 'none' && label.indexOf(reaction) < 0) label = (label ? label + ' · ' : '') + reaction;
    const verdict = r.verdict || (r.pass !== undefined ? { pass: !!r.pass, failed: r.failed || [] } : null);
    let params = r.params || null;
    if (!params && r.configPatch) params = flatten(r.configPatch);
    if (!params && variant && isObj(variant)) params = Object.assign({}, variant);
    let study = r.study || null;
    if (!study) study = r.side ? 'sensitivity' : r.set !== undefined ? 'tuning' : null;
    return {
      i: i, id: r.id || (scenario + '#' + label), scenario: scenario, family: r.family || (scenObj && scenObj.family) || String(scenario).charAt(0),
      name: r.name || (scenObj && scenObj.name) || '', variant: variant, label: label || '(base)', reaction: reaction,
      params: params || {}, metrics: r.metrics || {}, verdict: verdict, decide: r.decide || (scenObj && scenObj.decide) || (verdict && verdict.failed) || [],
      scope: r.scope || (scenObj && scenObj.scope) || 'in', study: study, set: r.set, side: r.side, param: r.param, factor: r.factor,
      config: r.config || null, concrete: scenObj, result: r.result || null,
    };
  }

  /**
   * Any batch-like JSON -> { runs, plant, presets, base, created, studies: { name -> count }, warnings }.
   * Accepts { runs: [...] } (SU2's proposal), { results: [...] }, a bare array of runs, or a single
   * result with metrics (a batch of one).
   */
  function normalizeBatch(j) {
    const warnings = [];
    let arr = null;
    if (Array.isArray(j)) arr = j;
    else if (j && Array.isArray(j.runs)) arr = j.runs;
    else if (j && Array.isArray(j.results)) arr = j.results;
    else if (j && j.metrics) arr = [Object.assign({ scenario: j.meta && j.meta.config && j.meta.config.scenario && j.meta.config.scenario.id }, j)];
    if (!arr) return { runs: [], warnings: ['no runs in this file (expected { runs: [...] })'], studies: {} };
    const runs = arr.map(normalizeRun);
    const studies = {};
    runs.forEach(function (r) { const s = r.study || 'untagged'; studies[s] = (studies[s] || 0) + 1; });
    const noVerdict = runs.filter(function (r) { return !r.verdict; }).length;
    if (noVerdict) warnings.push(noVerdict + ' run(s) without a verdict');
    const plant = (j && (j.plant || (j.meta && j.meta.plant))) || null;
    return {
      runs: runs, plant: plant, presets: (j && j.presets) || null, base: (j && (j.base || j.config)) || null,
      created: (j && j.created) || null, plan: (j && j.plan) || null, studies: studies, warnings: warnings,
      thresholds: (j && j.thresholds) || (j && j.base && j.base.thresholds) || null,
      catalogue: (j && j.catalogue) || null,
    };
  }

  /** The runs of one study; when no run is tagged with any study, every run serves every view. */
  function studyRuns(batch, study) {
    const tagged = batch.runs.filter(function (r) { return r.study === study; });
    if (tagged.length) return tagged;
    const anyTag = batch.runs.some(function (r) { return r.study; });
    return anyTag ? batch.runs.filter(function (r) { return !r.study; }) : batch.runs.slice();
  }

  // ---------------------------------------------------------------------------------------------
  // Metrics: direction and margin
  // ---------------------------------------------------------------------------------------------
  function metricsModule(modules) { return (modules && modules.metrics) || (typeof self !== 'undefined' && self.CS && self.CS.metrics) || null; }

  /** op of a metric: '>=' (higher is better), '<=', 'false', 'true', or null when unknown. */
  function metricOp(name, modules) {
    const mm = metricsModule(modules);
    if (mm && mm.BY_KEY && mm.BY_KEY[name]) return mm.BY_KEY[name].op || null;
    if (mm && mm.SCHEMA) { const s = mm.SCHEMA.filter(function (x) { return x.key === name; })[0]; if (s && s.op) return s.op; }
    if (/^min/i.test(name) || /LeadTime/.test(name)) return '>=';
    if (/^(collision|missedWarning|followerCollision)$/.test(name)) return 'false';
    if (/^(max|peak)|Rms|Count|PerMin|PerHour|Gain|Lost|^warn/i.test(name)) return '<=';
    return null;
  }

  function thresholdOf(name, thresholds, modules) {
    if (thresholds && thresholds[name] !== undefined) return +thresholds[name];
    const mm = metricsModule(modules);
    if (mm && mm.SCHEMA) { const s = mm.SCHEMA.filter(function (x) { return x.key === name; })[0]; if (s && typeof s.default === 'number') return s.default; }
    return NaN;
  }

  /** Relative margin to the threshold: > 0 passes, < 0 fails; NaN when it cannot be told. */
  function margin(name, value, thresholds, modules) {
    const op = metricOp(name, modules);
    if (op === 'false') return value === false || value === 0 ? 1 : value === true || value === 1 ? -1 : NaN;
    if (op === 'true') return value === true || value === 1 ? 1 : value === false || value === 0 ? -1 : NaN;
    if (typeof value !== 'number' || !isFinite(value)) return NaN;
    const th = thresholdOf(name, thresholds, modules);
    if (!isFinite(th)) return NaN;
    const scale = Math.max(Math.abs(th), 1e-6);
    if (op === '>=') return (value - th) / scale;
    if (op === '<=') return (th - value) / scale;
    return NaN;
  }

  /** The metric that decided a run: its first failed metric, else the decide metric closest to failing. */
  function decidingMetric(run, thresholds, modules) {
    const failed = (run.verdict && run.verdict.failed) || [];
    if (failed.length) return { name: failed[0], value: run.metrics[failed[0]], failed: true };
    const names = (run.decide && run.decide.length ? run.decide : Object.keys(run.metrics)).filter(function (n) { return run.metrics[n] !== undefined; });
    let best = null, bestM = Infinity;
    names.forEach(function (n) {
      const m = margin(n, run.metrics[n], thresholds, modules);
      if (isFinite(m) && m < bestM) { bestM = m; best = n; }
    });
    if (!best && names.length) best = names[0];
    return best ? { name: best, value: run.metrics[best], failed: false, margin: bestM } : null;
  }

  function stateOf(run) {
    if (!run.verdict) return 'na';
    if (run.verdict.pass) return (run.verdict.unknown && run.verdict.unknown.length) ? 'pass?' : 'pass';
    return 'fail';
  }

  function sortVal(x) {
    if (typeof x === 'number') return x;
    const m = /-?\d+(\.\d+)?/.exec(String(x));
    return m ? +m[0] : NaN;
  }

  function cmpVariant(a, b) {
    const va = a.variant, vb = b.variant;
    if (isObj(va) && isObj(vb)) {
      const keys = Object.keys(va);
      for (let i = 0; i < keys.length; i++) {
        const x = sortVal(va[keys[i]]), y = sortVal(vb[keys[i]]);
        if (x !== y && isFinite(x) && isFinite(y)) return x - y;
        if (String(va[keys[i]]) !== String(vb[keys[i]])) return String(va[keys[i]]) < String(vb[keys[i]]) ? -1 : 1;
      }
    }
    return a.label < b.label ? -1 : a.label > b.label ? 1 : a.i - b.i;
  }

  /** The scenario matrix: families -> scenario rows -> variant cells (rows are as long as their variants). */
  function matrixModel(runs, opts) {
    opts = opts || {};
    const fams = {};
    runs.forEach(function (r) {
      const f = r.family || '?';
      fams[f] = fams[f] || {};
      fams[f][r.scenario] = fams[f][r.scenario] || [];
      fams[f][r.scenario].push(r);
    });
    const out = { families: [], pass: 0, fail: 0, na: 0, total: 0 };
    Object.keys(fams).sort().forEach(function (f) {
      const fam = { family: f, rows: [], pass: 0, total: 0 };
      Object.keys(fams[f]).sort().forEach(function (sid) {
        const cells = fams[f][sid].slice().sort(cmpVariant).map(function (r) {
          const st = stateOf(r);
          const dm = decidingMetric(r, opts.thresholds, opts.modules);
          if (st === 'pass' || st === 'pass?') { out.pass++; fam.pass++; } else if (st === 'fail') out.fail++; else out.na++;
          out.total++; fam.total++;
          return { run: r, label: r.label, state: st, metric: dm, scope: r.scope };
        });
        fam.rows.push({ scenario: sid, name: fams[f][sid][0].name || '', cells: cells, pass: cells.filter(function (c) { return c.state.indexOf('pass') === 0; }).length });
      });
      out.families.push(fam);
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Feasibility map
  // ---------------------------------------------------------------------------------------------
  /** Parameters that vary across the runs (candidates for the map's axes), numeric first. */
  function paramAxes(runs) {
    const vals = {};
    runs.forEach(function (r) {
      Object.keys(r.params || {}).forEach(function (k) {
        const v = r.params[k];
        if (v === null || v === undefined || typeof v === 'object') return;
        (vals[k] = vals[k] || {})[String(v)] = v;
      });
    });
    return Object.keys(vals).map(function (k) {
      const vs = Object.keys(vals[k]).map(function (s) { return vals[k][s]; });
      const numeric = vs.every(function (v) { return typeof v === 'number'; });
      vs.sort(function (a, b) { return numeric ? a - b : String(a) < String(b) ? -1 : 1; });
      return { key: k, values: vs, numeric: numeric };
    }).filter(function (a) { return a.values.length >= 2; })
      .sort(function (a, b) { return (b.numeric - a.numeric) || a.key.localeCompare(b.key); });
  }

  /**
   * One axis of the map. Few distinct values (<= maxBins): one cell per value. Many: equal-width bins.
   * pos(v) -> continuous cell coordinate (cell i spans [i - 0.5, i + 0.5]), for marking presets.
   */
  function makeAxis(key, values, maxBins) {
    maxBins = maxBins || 12;
    const numeric = values.every(function (v) { return typeof v === 'number'; });
    const uniq = values.slice().sort(function (a, b) { return numeric ? a - b : String(a) < String(b) ? -1 : 1; }).filter(function (v, i, a) { return i === 0 || v !== a[i - 1]; });
    if (!numeric || uniq.length <= maxBins) {
      return {
        key: key, binned: false, n: uniq.length, labels: uniq.map(function (v) { return typeof v === 'number' ? fmtShort(v) : String(v); }), values: uniq,
        index: function (v) { for (let i = 0; i < uniq.length; i++) if (uniq[i] === v || (numeric && Math.abs(uniq[i] - v) < 1e-9)) return i; return -1; },
        pos: function (v) {
          if (!numeric || typeof v !== 'number') { const i = uniq.indexOf(v); return i >= 0 ? i : NaN; }
          if (uniq.length === 1) return 0;
          if (v <= uniq[0]) return (v - uniq[0]) / (uniq[1] - uniq[0]);
          for (let i = 1; i < uniq.length; i++) if (v <= uniq[i]) return i - 1 + (v - uniq[i - 1]) / (uniq[i] - uniq[i - 1]);
          const n = uniq.length;
          return n - 1 + (v - uniq[n - 1]) / (uniq[n - 1] - uniq[n - 2]);
        },
      };
    }
    const lo = uniq[0], hi = uniq[uniq.length - 1];
    const w = (hi - lo) / maxBins;
    const labels = [];
    for (let i = 0; i < maxBins; i++) labels.push(fmtShort(lo + (i + 0.5) * w));
    return {
      key: key, binned: true, n: maxBins, labels: labels, lo: lo, hi: hi, width: w,
      index: function (v) { if (typeof v !== 'number' || !isFinite(v)) return -1; return Math.max(0, Math.min(maxBins - 1, Math.floor((v - lo) / w))); },
      pos: function (v) { return (v - lo) / w - 0.5; },
    };
  }

  /**
   * Bin runs into a grid over params xKey × yKey. value = { kind: 'passShare' } or
   * { kind: 'metric', name, agg: 'min'|'max'|'mean'|'worst' }. Cells: { value, n, pass, runs }.
   */
  function heatGrid(runs, xKey, yKey, value, opts) {
    opts = opts || {};
    value = value || { kind: 'passShare' };
    const use = runs.filter(function (r) { return r.params && r.params[xKey] !== undefined && r.params[yKey] !== undefined; });
    const ax = makeAxis(xKey, use.map(function (r) { return r.params[xKey]; }), opts.maxBins);
    const ay = makeAxis(yKey, use.map(function (r) { return r.params[yKey]; }), opts.maxBins);
    const cells = [];
    for (let j = 0; j < ay.n; j++) { cells.push([]); for (let i = 0; i < ax.n; i++) cells[j].push({ n: 0, pass: 0, vals: [], runs: [], value: null }); }
    use.forEach(function (r) {
      const i = ax.index(r.params[xKey]), j = ay.index(r.params[yKey]);
      if (i < 0 || j < 0) return;
      const c = cells[j][i];
      c.n++;
      c.runs.push(r);
      if (r.verdict && r.verdict.pass) c.pass++;
      if (value.kind === 'metric') { const v = r.metrics[value.name]; if (typeof v === 'number' && isFinite(v)) c.vals.push(v); else if (typeof v === 'boolean') c.vals.push(v ? 1 : 0); }
    });
    const op = value.kind === 'metric' ? metricOp(value.name, opts.modules) : '>=';
    let min = Infinity, max = -Infinity;
    cells.forEach(function (row) {
      row.forEach(function (c) {
        if (!c.n) return;
        if (value.kind === 'passShare') c.value = c.pass / c.n;
        else if (c.vals.length) {
          let agg = value.agg || 'worst';
          if (agg === 'worst') agg = op === '>=' ? 'min' : op === '<=' ? 'max' : 'mean';
          if (agg === 'min') c.value = Math.min.apply(null, c.vals);
          else if (agg === 'max') c.value = Math.max.apply(null, c.vals);
          else c.value = c.vals.reduce(function (a, b) { return a + b; }, 0) / c.vals.length;
        }
        if (c.value !== null) { min = Math.min(min, c.value); max = Math.max(max, c.value); }
      });
    });
    if (value.kind === 'passShare') { min = 0; max = 1; }
    if (!isFinite(min)) { min = 0; max = 1; }
    return { x: ax, y: ay, cells: cells, min: min, max: max, value: value, op: op, used: use.length, skipped: runs.length - use.length };
  }

  /** Cell value -> 0..1 on the ramp, where 1 is better (darker). */
  function rampT(grid, v) {
    if (v === null || v === undefined || !isFinite(v)) return NaN;
    const span = grid.max - grid.min;
    let t = span > 0 ? (v - grid.min) / span : 1;
    if (grid.value.kind === 'metric' && grid.op === '<=') t = 1 - t;
    return Math.max(0, Math.min(1, t));
  }
  function rampIndex(t) { return Math.round(t * (charts.SEQ_N - 1)); }

  /** Where each plant preset sits on the map: [{ name, fx, fy, outside }] in cell coordinates. */
  function presetMarks(grid, presets) {
    if (!presets) return [];
    return Object.keys(presets).map(function (name) {
      const p = presets[name];
      const vx = p[grid.x.key], vy = p[grid.y.key];
      if (vx === undefined || vy === undefined) return null;
      const fx = grid.x.pos(vx), fy = grid.y.pos(vy);
      if (!isFinite(fx) || !isFinite(fy)) return null;
      return { name: name, fx: fx, fy: fy, vx: vx, vy: vy, outside: fx < -0.5 || fx > grid.x.n - 0.5 || fy < -0.5 || fy > grid.y.n - 0.5 };
    }).filter(Boolean);
  }

  /**
   * The plant presets as points of parameter space: the batch's own `presets` if it has them, else
   * the plant module's PRESETS over its SCHEMA defaults (keys 'plant.<key>').
   */
  function presetPoints(batch, modules) {
    if (batch && batch.presets) return batch.presets;
    const plant = (modules && modules.plant) || (typeof self !== 'undefined' && self.CS && self.CS.plant);
    if (!plant || !plant.PRESETS) return null;
    const NAME = plant.NAME || 'plant';
    const defs = {};
    (plant.SCHEMA || []).forEach(function (s) { if (typeof s.default === 'number') defs[NAME + '.' + s.key] = s.default; });
    const out = {};
    Object.keys(plant.PRESETS).forEach(function (n) {
      out[n] = Object.assign({}, defs);
      Object.keys(plant.PRESETS[n]).forEach(function (k) { out[n][NAME + '.' + k] = plant.PRESETS[n][k]; });
    });
    return out;
  }

  /** Cell edges between cells at / above `target` and below it: the "it works here" frontier. */
  function frontier(grid, target) {
    const segs = [];
    const ok = function (i, j) { const c = grid.cells[j] && grid.cells[j][i]; return !!(c && c.value !== null && rampT(grid, c.value) >= rampT(grid, target)); };
    for (let j = 0; j < grid.y.n; j++) {
      for (let i = 0; i < grid.x.n; i++) {
        const c = grid.cells[j][i];
        if (c.value === null) continue;
        const me = ok(i, j);
        if (i + 1 < grid.x.n && grid.cells[j][i + 1].value !== null && ok(i + 1, j) !== me) segs.push({ x0: i + 0.5, y0: j - 0.5, x1: i + 0.5, y1: j + 0.5 });
        if (j + 1 < grid.y.n && grid.cells[j + 1][i].value !== null && ok(i, j + 1) !== me) segs.push({ x0: i - 0.5, y0: j + 0.5, x1: i + 0.5, y1: j + 0.5 });
      }
    }
    return segs;
  }

  /** A sentence per row of the map: where along x the pass share reaches the target (for the report). */
  function frontierText(grid, target) {
    const lines = [];
    for (let j = 0; j < grid.y.n; j++) {
      const okIdx = [];
      for (let i = 0; i < grid.x.n; i++) { const c = grid.cells[j][i]; if (c.value !== null && rampT(grid, c.value) >= rampT(grid, target) - 1e-12) okIdx.push(i); }
      lines.push({ y: grid.y.labels[j], ok: okIdx.map(function (i) { return grid.x.labels[i]; }) });
    }
    return lines;
  }

  const MAP_PAD = { l: 78, r: 96, t: 24, b: 46 };

  /** Draw ops of the heat map (box = the whole figure). Also returns geometry for hit-testing. */
  function layoutHeatmap(grid, opts) {
    opts = opts || {};
    const box = opts.box || { x: 0, y: 0, w: 640, h: 420 };
    const ops = [];
    const pb = { x: box.x + MAP_PAD.l, y: box.y + MAP_PAD.t, w: box.w - MAP_PAD.l - MAP_PAD.r, h: box.h - MAP_PAD.t - MAP_PAD.b };
    const cw = pb.w / Math.max(1, grid.x.n), ch = pb.h / Math.max(1, grid.y.n);
    const cx = function (fx) { return pb.x + (fx + 0.5) * cw; };
    const cy = function (fy) { return pb.y + pb.h - (fy + 0.5) * ch; };    // y grows upward
    ops.push({ op: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: 'surface' });
    const showText = cw >= 30 && ch >= 16;
    for (let j = 0; j < grid.y.n; j++) {
      for (let i = 0; i < grid.x.n; i++) {
        const c = grid.cells[j][i];
        const x = pb.x + i * cw, y = pb.y + pb.h - (j + 1) * ch;
        if (c.value === null) {
          ops.push({ op: 'rect', x: x + 1, y: y + 1, w: cw - 2, h: ch - 2, fill: 'na', alpha: 0.35 });
          continue;
        }
        const k = rampIndex(rampT(grid, c.value));
        ops.push({ op: 'rect', x: x + 1, y: y + 1, w: cw - 2, h: ch - 2, fill: 'seq' + k });
        if (showText) {
          const txt = grid.value.kind === 'passShare' ? Math.round(c.value * 100) + '%' : fmt(c.value);
          ops.push({ op: 'text', x: x + cw / 2, y: y + ch / 2, text: txt, fill: 'seqtxt' + k, align: 'center', baseline: 'middle', size: Math.min(12, Math.max(9, ch * 0.4)) });
        }
      }
    }
    // frontier
    if (opts.target !== undefined && isFinite(opts.target)) {
      frontier(grid, opts.target).forEach(function (s) {
        ops.push({ op: 'line', x1: cx(s.x0), y1: cy(s.y0), x2: cx(s.x1), y2: cy(s.y1), stroke: 'ink', width: 2.5 });
      });
    }
    // axes
    const xStep = Math.max(1, Math.ceil(grid.x.n / Math.max(1, Math.floor(pb.w / 44))));
    grid.x.labels.forEach(function (l, i) {
      if (i % xStep) return;
      ops.push({ op: 'text', x: cx(i), y: pb.y + pb.h + 4, text: l, fill: 'muted', align: 'center', baseline: 'top', size: 10 });
    });
    const yStep = Math.max(1, Math.ceil(grid.y.n / Math.max(1, Math.floor(pb.h / 16))));
    grid.y.labels.forEach(function (l, j) {
      if (j % yStep) return;
      ops.push({ op: 'text', x: pb.x - 5, y: cy(j), text: l, fill: 'muted', align: 'right', baseline: 'middle', size: 10 });
    });
    ops.push({ op: 'text', x: pb.x + pb.w / 2, y: pb.y + pb.h + 22, text: opts.xLabel || grid.x.key, fill: 'ink2', align: 'center', baseline: 'top', size: 11 });
    ops.push({ op: 'text', x: box.x + 4, y: pb.y - 8, text: '↑ ' + (opts.yLabel || grid.y.key), fill: 'ink2', align: 'left', baseline: 'bottom', size: 11 });
    // preset marks: a ring with a surface halo, and the name
    (opts.marks || []).forEach(function (m) {
      const x = cx(Math.max(-0.5, Math.min(grid.x.n - 0.5, m.fx))), y = cy(Math.max(-0.5, Math.min(grid.y.n - 0.5, m.fy)));
      ops.push({ op: 'marker', shape: 'circle', x: x, y: y, size: 7.5, fill: 'surface' });
      ops.push({ op: 'marker', shape: 'diamond', x: x, y: y, size: 5.5, fill: 's1' });
      ops.push({ op: 'text', x: x + 8, y: y - 6, text: m.name + (m.outside ? ' (off the map)' : ''), fill: 'ink', size: 11, weight: 600, halo: true });
    });
    // legend: the ramp
    const lx = pb.x + pb.w + 18, lw = 14, lh = Math.min(pb.h, 180);
    const n = charts.SEQ_N;
    for (let k = 0; k < n; k++) ops.push({ op: 'rect', x: lx, y: pb.y + lh - (k + 1) * lh / n, w: lw, h: lh / n + 0.5, fill: 'seq' + k });
    const lo = grid.value.kind === 'passShare' ? '0%' : fmt(grid.op === '<=' ? grid.max : grid.min);
    const hi = grid.value.kind === 'passShare' ? '100%' : fmt(grid.op === '<=' ? grid.min : grid.max);
    ops.push({ op: 'text', x: lx + lw + 4, y: pb.y + lh, text: lo + (grid.value.kind === 'metric' ? ' worse' : ''), fill: 'muted', baseline: 'bottom', size: 10 });
    ops.push({ op: 'text', x: lx + lw + 4, y: pb.y, text: hi + (grid.value.kind === 'metric' ? ' better' : ''), fill: 'muted', baseline: 'top', size: 10 });
    if (opts.marks && opts.marks.length) {
      ops.push({ op: 'marker', shape: 'diamond', x: lx + 6, y: pb.y + lh + 20, size: 5, fill: 's1' });
      ops.push({ op: 'text', x: lx + 16, y: pb.y + lh + 20, text: 'plant preset', fill: 'ink2', baseline: 'middle', size: 10 });
    }
    if (opts.target !== undefined && isFinite(opts.target)) {
      ops.push({ op: 'line', x1: lx, y1: pb.y + lh + 38, x2: lx + 14, y2: pb.y + lh + 38, stroke: 'ink', width: 2.5 });
      ops.push({ op: 'text', x: lx + 18, y: pb.y + lh + 38, text: 'target ' + (grid.value.kind === 'passShare' ? Math.round(opts.target * 100) + '%' : fmt(opts.target)), fill: 'ink2', baseline: 'middle', size: 10 });
    }
    return { ops: ops, pb: pb, cw: cw, ch: ch, cellAt: function (x, y) {
      const i = Math.floor((x - pb.x) / cw), j = Math.floor((pb.y + pb.h - y) / ch);
      return i >= 0 && i < grid.x.n && j >= 0 && j < grid.y.n ? { i: i, j: j, cell: grid.cells[j][i] } : null;
    } };
  }

  // ---------------------------------------------------------------------------------------------
  // Sensitivity (tornado)
  // ---------------------------------------------------------------------------------------------
  function scoreOf(runs, spec, modules) {
    if (!runs.length) return NaN;
    if (!spec || spec.kind === 'passShare') return runs.filter(function (r) { return r.verdict && r.verdict.pass; }).length / runs.length;
    const vals = runs.map(function (r) { const v = r.metrics[spec.name]; return typeof v === 'boolean' ? (v ? 1 : 0) : v; }).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (!vals.length) return NaN;
    const op = metricOp(spec.name, modules);
    return op === '>=' ? Math.min.apply(null, vals) : op === '<=' ? Math.max.apply(null, vals) : vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  /**
   * Tornado bars: for each parameter, the score with it at −30 % and +30 % against the base.
   * Runs carry param + side ('low'|'base'|'high'); a base shared by all parameters is allowed.
   */
  function tornadoModel(runs, spec, modules) {
    const by = {};
    const sharedBase = [];
    runs.forEach(function (r) {
      if (r.side === 'base' && !r.param) { sharedBase.push(r); return; }
      if (!r.param) return;
      const b = by[r.param] = by[r.param] || { low: [], base: [], high: [], factors: {}, values: {} };
      if (b[r.side]) b[r.side].push(r);
      if (r.factor !== undefined) b.factors[r.side] = r.factor;
      if (r.params && r.params[r.param] !== undefined) b.values[r.side] = r.params[r.param];
    });
    const allBase = sharedBase.concat([].concat.apply([], Object.keys(by).map(function (k) { return by[k].base; })));
    const base = scoreOf(allBase, spec, modules);
    const bars = Object.keys(by).map(function (p) {
      const b = by[p];
      const own = b.base.length ? scoreOf(b.base, spec, modules) : base;
      const lo = scoreOf(b.low, spec, modules), hi = scoreOf(b.high, spec, modules);
      // per run: how many scenario variants change their verdict against the same variant at base
      const baseRuns = b.base.length ? b.base : allBase;
      const baseByKey = {};
      baseRuns.forEach(function (r) { baseByKey[r.scenario + '|' + r.label] = !!(r.verdict && r.verdict.pass); });
      const changed = function (rs) { return rs.filter(function (r) { const k = r.scenario + '|' + r.label; return k in baseByKey && baseByKey[k] !== !!(r.verdict && r.verdict.pass); }).length; };
      const cLow = changed(b.low), cHigh = changed(b.high);
      return {
        param: p, base: own, low: lo, high: hi, lowValue: b.values.low, highValue: b.values.high, baseValue: b.values.base,
        lowFactor: b.factors.low, highFactor: b.factors.high,
        delta: Math.max(isFinite(lo) ? Math.abs(lo - own) : 0, isFinite(hi) ? Math.abs(hi - own) : 0),
        changedLow: cLow, changedHigh: cHigh, flipsLow: cLow > 0, flipsHigh: cHigh > 0,
        nLow: b.low.length, nHigh: b.high.length,
      };
    }).sort(function (a, b) { return b.delta - a.delta || a.param.localeCompare(b.param); });
    return { base: base, bars: bars, spec: spec || { kind: 'passShare' } };
  }

  function layoutTornado(model, opts) {
    opts = opts || {};
    const rowH = 26;
    const w = (opts.box && opts.box.w) || 640;
    const h = Math.max(80, 44 + model.bars.length * rowH);
    const ops = [];
    const pb = { x: 170, y: 22, w: w - 170 - 110, h: model.bars.length * rowH };
    ops.push({ op: 'rect', x: 0, y: 0, w: w, h: h, fill: 'surface' });
    let lo = Infinity, hi = -Infinity;
    model.bars.forEach(function (b) { [b.base, b.low, b.high].forEach(function (v) { if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const isShare = model.spec.kind === 'passShare';
    let dom = isShare ? [Math.max(0, Math.min(lo, model.base) - 0.05), Math.min(1, Math.max(hi, model.base) + 0.05)] : charts.niceDomain(Math.min(lo, model.base), Math.max(hi, model.base), 4);
    if (isShare) dom = charts.niceDomain(dom[0], dom[1], 4).map(function (v) { return Math.max(0, Math.min(1, v)); });
    const sx = charts.linear(dom[0], dom[1], pb.x, pb.x + pb.w);
    charts.ticks(dom[0], dom[1], 5).forEach(function (v) {
      ops.push({ op: 'line', x1: sx(v), y1: pb.y, x2: sx(v), y2: pb.y + pb.h, stroke: 'grid', width: 1 });
      ops.push({ op: 'text', x: sx(v), y: pb.y + pb.h + 4, text: isShare ? Math.round(v * 100) + '%' : fmt(v), fill: 'muted', align: 'center', baseline: 'top', size: 10 });
    });
    const xb = sx(model.base);
    model.bars.forEach(function (b, i) {
      const y = pb.y + i * rowH + 4, bh = rowH - 8;
      ops.push({ op: 'text', x: pb.x - 8, y: y + bh / 2, text: b.param, fill: 'ink', align: 'right', baseline: 'middle', size: 11 });
      const own = sx(b.base);
      [['low', 's0'], ['high', 's1']].forEach(function (sd, k) {
        const v = b[sd[0]];
        if (!isFinite(v)) return;
        const x = sx(v);
        const yy = y + (k ? bh / 2 + 1 : 0), hh = bh / 2 - 1;
        ops.push({ op: 'rect', x: Math.min(own, x), y: yy, w: Math.max(2, Math.abs(x - own)), h: hh, fill: sd[1] });
        const nc = b[sd[0] === 'low' ? 'changedLow' : 'changedHigh'];
        if (nc) ops.push({ op: 'text', x: Math.max(own, x) + 3, y: yy + hh / 2, text: '⚑' + nc, fill: 'ink', align: 'left', baseline: 'middle', size: 9 });
      });
      ops.push({ op: 'text', x: pb.x + pb.w + 8, y: y + bh / 2, text: (isShare ? Math.round(b.low * 100) + '% / ' + Math.round(b.high * 100) + '%' : fmt(b.low) + ' / ' + fmt(b.high)), fill: 'ink2', baseline: 'middle', size: 10 });
    });
    ops.push({ op: 'line', x1: xb, y1: pb.y - 6, x2: xb, y2: pb.y + pb.h, stroke: 'ink', width: 1.5 });
    ops.push({ op: 'text', x: xb, y: pb.y - 8, text: 'base ' + (isShare ? Math.round(model.base * 100) + '%' : fmt(model.base)), fill: 'ink', align: 'center', baseline: 'bottom', size: 10 });
    // legend
    ops.push({ op: 'rect', x: 4, y: 4, w: 10, h: 8, fill: 's0' });
    ops.push({ op: 'text', x: 18, y: 8, text: '−30 %', fill: 'ink2', baseline: 'middle', size: 10 });
    ops.push({ op: 'rect', x: 60, y: 4, w: 10, h: 8, fill: 's1' });
    ops.push({ op: 'text', x: 74, y: 8, text: '+30 %', fill: 'ink2', baseline: 'middle', size: 10 });
    ops.push({ op: 'text', x: 116, y: 8, text: '⚑n: n scenario variants change their verdict', fill: 'ink2', baseline: 'middle', size: 10 });
    return { ops: ops, w: w, h: h + 18 };
  }

  // ---------------------------------------------------------------------------------------------
  // Tuning sweep
  // ---------------------------------------------------------------------------------------------
  const COMFORT = [
    { name: 'accelRms_mps2', label: 'a RMS', ref: 0.5, agg: 'mean' },
    { name: 'peakDecel_mps2', label: 'peak decel', ref: 3.5, agg: 'max', abs: true },
    { name: 'peakJerk_mps3', label: 'peak jerk', ref: 2.5, agg: 'max', abs: true },
    { name: 'setpointChangesPerMin', label: 'set changes/min', ref: 20, agg: 'max' },
  ];

  /**
   * One row per tuning set: its parameters, pass share, comfort numbers and a comfort cost (each
   * comfort metric over its threshold, averaged; lower is better). Sorted by pass share, then cost;
   * `pareto` marks the sets no other set beats on both.
   */
  function tuningTable(runs, opts) {
    opts = opts || {};
    const sets = {};
    runs.forEach(function (r) {
      const key = r.set !== undefined ? String(r.set) : JSON.stringify(r.params);
      (sets[key] = sets[key] || []).push(r);
    });
    const comfort = COMFORT.map(function (c) {
      const th = thresholdOf(c.name, opts.thresholds, opts.modules);
      return Object.assign({}, c, { ref: isFinite(th) && th > 0 ? th : c.ref });
    });
    const rows = Object.keys(sets).map(function (key) {
      const rs = sets[key];
      const pass = rs.filter(function (r) { return r.verdict && r.verdict.pass; }).length;
      const cm = {};
      let cost = 0, nc = 0;
      comfort.forEach(function (c) {
        const vals = rs.map(function (r) { return r.metrics[c.name]; }).filter(function (v) { return typeof v === 'number' && isFinite(v); }).map(function (v) { return c.abs ? Math.abs(v) : v; });
        if (!vals.length) { cm[c.name] = null; return; }
        const v = c.agg === 'max' ? Math.max.apply(null, vals) : vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
        cm[c.name] = v;
        cost += v / c.ref; nc++;
      });
      return { set: key, params: rs[0].params, n: rs.length, pass: pass, passShare: pass / rs.length, comfort: cm, cost: nc ? cost / nc : NaN, failedScenarios: uniqueFailed(rs) };
    });
    rows.sort(function (a, b) { return (b.passShare - a.passShare) || ((isFinite(a.cost) ? a.cost : 1e9) - (isFinite(b.cost) ? b.cost : 1e9)) || (a.set < b.set ? -1 : 1); });
    rows.forEach(function (r) {
      r.pareto = !rows.some(function (o) {
        if (o === r) return false;
        const c1 = isFinite(o.cost) ? o.cost : Infinity, c2 = isFinite(r.cost) ? r.cost : Infinity;
        return o.passShare >= r.passShare && c1 <= c2 && (o.passShare > r.passShare || c1 < c2);
      });
    });
    const keys = {};
    rows.forEach(function (r) { Object.keys(r.params || {}).forEach(function (k) { (keys[k] = keys[k] || {})[String(r.params[k])] = 1; }); });
    const varying = Object.keys(keys).filter(function (k) { return Object.keys(keys[k]).length > 1; });
    const fixed = Object.keys(keys).filter(function (k) { return Object.keys(keys[k]).length === 1; }).map(function (k) { return { key: k, value: rows[0].params[k] }; });
    return { rows: rows, varying: varying, fixed: fixed, comfort: comfort };
  }

  function uniqueFailed(rs) {
    const s = {};
    rs.forEach(function (r) { if (r.verdict && !r.verdict.pass) s[r.scenario] = 1; });
    return Object.keys(s);
  }

  /** A config patch setting dotted config paths ('controller.h') — whole module objects, as settings.js writes. */
  function paramsPatch(config, params) {
    const patch = {};
    Object.keys(params || {}).forEach(function (path) {
      const parts = path.split('.');
      if (parts.length < 2) { patch[path] = params[path]; return; }
      const head = parts[0];
      if (!patch[head]) patch[head] = JSON.parse(JSON.stringify((config && config[head]) || {}));
      let o = patch[head];
      for (let i = 1; i < parts.length - 1; i++) { if (!isObj(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
      o[parts[parts.length - 1]] = params[path];
    });
    return patch;
  }

  /** The config that reproduces one run of a batch (null when the batch does not say enough). */
  function runConfig(run, batch, modules) {
    if (run.config && run.config.scenario) return run.config;
    const sc = (modules && modules.scenario) || (typeof self !== 'undefined' && self.CS && self.CS.scenario);
    const base = (batch && batch.base) || {};
    if (run.concrete && sc && typeof sc.toConfig === 'function') {
      try { return sc.toConfig(run.concrete, base); } catch (e) { /* fall through */ }
    }
    if (!run.scenario) return null;
    const cfg = JSON.parse(JSON.stringify(base));
    Object.assign(cfg, paramsPatch(cfg, Object.keys(run.params || {}).reduce(function (o, k) { if (k.indexOf('.') > 0 && !/^(params|scenario|vehicles|ego|road|events)\b/.test(k)) o[k] = run.params[k]; return o; }, {})));
    cfg.scenario = { id: run.scenario, overrides: isObj(run.variant) ? run.variant : {} };
    if (run.config) Object.assign(cfg, run.config);
    return cfg;
  }

  // ---------------------------------------------------------------------------------------------
  // Running a small batch in the page
  // ---------------------------------------------------------------------------------------------
  /** values "a:b:n" or "a, b, c" -> numbers. */
  function parseValues(text) {
    const s = String(text || '').trim();
    const N = '([-−]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))';
    const m = new RegExp('^' + N + '\\s*(?:\\.\\.|…)\\s*' + N + '\\s*(?:[:x×/]\\s*(\\d+))?$').exec(s.replace(/−/g, '-'));
    if (m) {
      const a = +m[1], b = +m[2], n = Math.max(2, Math.min(50, +(m[3] || 5)));
      const out = [];
      for (let i = 0; i < n; i++) out.push(+(a + (b - a) * i / (n - 1)).toFixed(6));
      return out;
    }
    return s.split(/[,;\s]+/).filter(Boolean).map(Number).filter(function (v) { return isFinite(v); });
  }

  /** The concrete jobs of a plan: { scenarios: [ids], grid: { path: [values] }, base: config }. */
  function planJobs(plan, sc) {
    const ids = plan.scenarios || [];
    const gridKeys = Object.keys(plan.grid || {});
    let combos = [{}];
    gridKeys.forEach(function (k) {
      const next = [];
      combos.forEach(function (c) { plan.grid[k].forEach(function (v) { const o = Object.assign({}, c); o[k] = v; next.push(o); }); });
      combos = next;
    });
    const jobs = [];
    ids.forEach(function (id) {
      let concretes = null;
      try { concretes = sc && sc.expand ? sc.expand(id) : null; } catch (e) { concretes = null; }
      if (!concretes || !concretes.length) concretes = [{ id: id, base: id, key: id, label: '', variant: {} }];
      concretes.forEach(function (c) {
        combos.forEach(function (combo) { jobs.push({ concrete: c, params: combo }); });
      });
    });
    return jobs;
  }

  /**
   * Run a plan with the page's core (CS.sim.run, CS.scenario.expand / toConfig), a few runs per
   * frame. deps = { sim, scenario }. Returns { cancel() }; onDone(batch) gets a normalised batch.
   */
  function runPlan(plan, deps, onProgress, onDone) {
    const sim = deps.sim, sc = deps.scenario;
    const jobs = planJobs(plan, sc);
    const out = [];
    let i = 0, stop = false;
    const t0 = Date.now();
    function one(job) {
      let cfg = JSON.parse(JSON.stringify(plan.base || {}));
      if (sc && sc.toConfig && job.concrete && job.concrete.base !== undefined && sc.expand) {
        try { cfg = sc.toConfig(job.concrete, cfg); } catch (e) { cfg.scenario = { id: job.concrete.base || job.concrete.id }; }
      } else cfg.scenario = { id: job.concrete.id, overrides: {} };
      Object.assign(cfg, paramsPatch(cfg, job.params));
      const params = Object.assign({}, job.params);
      let res;
      try { res = sim.run(cfg); } catch (e) { return { id: (job.concrete.id || job.concrete.key) + ' ' + JSON.stringify(job.params), scenario: job.concrete.base || job.concrete.id, family: job.concrete.family, variant: job.concrete.variant, label: job.concrete.label, params: params, metrics: {}, verdict: { pass: false, failed: ['error: ' + e.message] }, study: plan.study, config: cfg }; }
      return {
        id: (job.concrete.id || job.concrete.key) + (Object.keys(params).length ? ' ' + JSON.stringify(params) : ''),
        scenario: job.concrete.base || job.concrete.id, family: job.concrete.family, variant: job.concrete.variant, label: job.concrete.label,
        reaction: job.concrete.reaction, decide: job.concrete.decide, scope: job.concrete.scope,
        params: params, metrics: res.metrics || {}, verdict: res.verdict || null, study: plan.study, config: cfg,
        plant: res.meta && res.meta.plant,
      };
    }
    function tick() {
      if (stop) return;
      const until = Date.now() + 40;
      while (i < jobs.length && Date.now() < until) { out.push(one(jobs[i])); i++; }
      if (onProgress) onProgress(i, jobs.length, Date.now() - t0);
      if (i < jobs.length) setTimeout(tick, 0);
      else {
        const plant = out.length && out[0].plant ? out[0].plant : null;
        onDone(normalizeBatch({ kind: 'cs-batch', version: 1, created: new Date().toISOString(), base: plan.base, plant: plant, runs: out, source: 'page' }));
      }
    }
    setTimeout(tick, 0);
    return { total: jobs.length, cancel: function () { stop = true; } };
  }

  // ---------------------------------------------------------------------------------------------
  // The current batch (shared with report-view.js)
  // ---------------------------------------------------------------------------------------------
  let current = null;
  const subs = [];
  function setCurrent(b) { current = b; subs.slice().forEach(function (f) { try { f(b); } catch (e) { /* a view's error stays its own */ } }); }
  function getCurrent() { return current; }
  function onCurrent(f) { subs.push(f); return function () { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; }

  // ---------------------------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------------------------
  const CSS = [
    '.su2-batch .su2-tabs { display: inline-flex; border: 1px solid var(--su2-axis); border-radius: 6px; overflow: hidden; }',
    '.su2-batch .su2-tabs button { border: 0; border-radius: 0; border-right: 1px solid var(--su2-axis); }',
    '.su2-batch .su2-tabs button:last-child { border-right: 0; }',
    '.su2-batch .su2-view { margin-top: 10px; }',
    '.su2-batch .su2-fam { margin: 0 0 12px; }',
    '.su2-batch .su2-fam h4 { margin: 0 0 4px; font-size: 13px; }',
    '.su2-batch .su2-mrow { display: grid; grid-template-columns: minmax(150px, 220px) 1fr; gap: 8px; align-items: start; padding: 3px 0; border-bottom: 1px solid var(--su2-grid); }',
    '.su2-batch .su2-mname { font-size: 12px; }',
    '.su2-batch .su2-mname small { display: block; color: var(--su2-ink2); }',
    '.su2-batch .su2-cells { display: flex; flex-wrap: wrap; gap: 2px; }',
    '.su2-batch button.su2-cell { min-width: 64px; padding: 2px 5px; font-size: 11px; line-height: 1.25; border-radius: 4px; text-align: left; border: 0; color: #fff; font-variant-numeric: tabular-nums; }',
    '.su2-batch button.su2-cell.su2-pass { background: var(--su2-pass); }',
    '.su2-batch button.su2-cell.su2-fail { background: var(--su2-fail); }',
    '.su2-batch button.su2-cell.su2-na { background: var(--su2-na); color: var(--su2-ink); }',
    '.su2-batch button.su2-cell.su2-scope { outline: 1px dashed var(--su2-ink2); outline-offset: -3px; }',
    '.su2-batch button.su2-cell:focus-visible { outline: 2px solid var(--su2-ink); outline-offset: 1px; }',
    '.su2-batch .su2-cell b { display: block; font-weight: 600; }',
    '.su2-batch .su2-svgwrap { position: relative; overflow-x: auto; background: var(--su2-surface); border: 1px solid var(--su2-border); border-radius: 6px; padding: 6px; }',
    '.su2-batch .su2-form { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin: 0 0 8px; font-size: 12px; }',
    '.su2-batch .su2-form label { display: inline-flex; gap: 4px; align-items: center; }',
    '.su2-batch .su2-form input[type="text"] { width: 120px; }',
    '.su2-batch progress { width: 160px; }',
    '.su2-batch tr.su2-pareto td:first-child::before { content: "★ "; color: var(--su2-s3); }',
    '.su2-batch tr.su2-click { cursor: pointer; }',
    '.su2-batch tr.su2-click:hover td { background: var(--su2-brush); }',
  ].join('\n');

  function mount(el, app, opts) {
    opts = opts || {};
    const h = charts.h;
    charts.ensureStyle(el.ownerDocument, 'su2-style-batch', CSS);
    el.classList.add('su2', 'su2-batch');
    el.innerHTML = '';
    const tip = h('div', { class: 'su2-tip', hidden: true });
    document.body.appendChild(tip);
    const state = { tab: 'matrix', mapX: null, mapY: null, mapValue: 'passShare', mapAgg: 'worst', target: 1, tornado: 'passShare', job: null };
    function modules() { return opts.modules || (typeof self !== 'undefined' && self.CS) || {}; }
    function batch() { return getCurrent(); }

    const info = h('span', { class: 'su2-note' });
    const banner = h('span', { class: 'su2-banner', hidden: true });
    const prog = h('progress', { max: 1, value: 0, hidden: true });
    const cancelBtn = h('button', { type: 'button', hidden: true, onclick: function () { if (state.job) state.job.cancel(); state.job = null; prog.hidden = true; cancelBtn.hidden = true; info.textContent = 'Cancelled.'; } }, ['Cancel']);
    const runMatrixBtn = h('button', { type: 'button', title: 'Every scenario of the catalogue with the current settings, here in the page', onclick: runMatrixHere }, ['Run matrix here']);
    const tabs = h('div', { class: 'su2-tabs', role: 'tablist' });
    [['matrix', 'Scenario matrix'], ['map', 'Feasibility map'], ['sens', 'Sensitivity'], ['tune', 'Tuning sweep']].forEach(function (t) {
      const b = h('button', { type: 'button', role: 'tab', 'data-tab': t[0], 'aria-pressed': String(state.tab === t[0]) }, [t[1]]);
      b.addEventListener('click', function () { state.tab = t[0]; tabs.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); render(); });
      tabs.appendChild(b);
    });
    const toolbar = h('div', { class: 'su2-toolbar' }, [
      h('button', { type: 'button', onclick: loadFile, title: 'A result file of sweep.js (or any JSON with runs: [...])' }, ['Load batch file…']),
      runMatrixBtn, prog, cancelBtn, info,
    ]);
    const view = h('div', { class: 'su2-view' });
    el.appendChild(toolbar);
    el.appendChild(h('div', { style: { margin: '0 0 8px' } }, [banner]));
    el.appendChild(tabs);
    el.appendChild(view);

    function loadFile() {
      charts.pickFile().then(function (f) {
        if (!f) return;
        return charts.readFileJson(f).then(function (j) {
          // through the shell when it routes batches (it stores app.batch and emits 'batch'); else here
          if (typeof app.loadResultFile === 'function' && (Array.isArray(j.runs) || Array.isArray(j.results))) {
            app.loadResultFile(j);
            if (app.batch !== j) setCurrent(normalizeBatch(j));
          } else setCurrent(normalizeBatch(j));
          if (current) current.source = f.name;
          render();
        });
      }).catch(function (e) { info.textContent = 'Could not load: ' + e.message; });
    }

    function core() {
      const CS = modules();
      return { sim: CS.sim && typeof CS.sim.run === 'function' ? CS.sim : null, scenario: CS.scenario && typeof CS.scenario.list === 'function' ? CS.scenario : null };
    }

    function startPlan(plan, label) {
      const c = core();
      if (!c.sim || !c.scenario) { info.textContent = 'The core (sim.js, scenario.js) is not loaded in this page: run sweep.js under Node and load its file.'; return; }
      if (state.job) state.job.cancel();
      prog.hidden = false; cancelBtn.hidden = false;
      state.job = runPlan(plan, c, function (i, n, ms) {
        prog.max = n; prog.value = i;
        info.textContent = label + ': ' + i + ' / ' + n + ' runs, ' + (ms / 1000).toFixed(1) + ' s';
      }, function (b) {
        state.job = null; prog.hidden = true; cancelBtn.hidden = true;
        b.source = 'this page, ' + label;
        setCurrent(b);
        render();
      });
      info.textContent = label + ': ' + state.job.total + ' runs queued';
    }

    function runMatrixHere() {
      const c = core();
      const ids = c.scenario ? c.scenario.list().filter(function (s) { return s.family !== 'L'; }).map(function (s) { return s.id; }) : [];
      startPlan({ scenarios: ids, grid: {}, base: JSON.parse(JSON.stringify(app.config || {})), study: 'matrix' }, 'matrix');
    }

    function openRun(run) {
      if (run.result && typeof app.loadResultFile === 'function') { app.loadResultFile(run.result); return; }
      const cfg = runConfig(run, batch(), modules());
      if (!cfg) { info.textContent = 'This run does not carry its config: cannot open it.'; return; }
      if (typeof app.openRun === 'function') app.openRun(cfg);          // SU1: replace the config, run, show the scene
      else {
        if (typeof app.setConfig === 'function') app.setConfig(cfg, { replace: true, run: false });
        if (typeof app.run === 'function') app.run();
      }
      if (typeof app.showView === 'function') app.showView('run');
      info.textContent = 'Opened ' + run.id + ' in the scene.';
    }

    function showTip(e, html) {
      tip.innerHTML = html; tip.hidden = false;
      tip.style.left = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.min(e.clientY + 12, window.innerHeight - tip.offsetHeight - 8) + 'px';
    }
    function hideTip() { tip.hidden = true; }

    function metricText(m) {
      if (!m) return '';
      const v = m.value;
      return shortMetric(m.name) + ' ' + (typeof v === 'boolean' ? (v ? 'yes' : 'no') : fmt(v));
    }

    function renderMatrix(b) {
      const thr = b.thresholds || (app.config && app.config.thresholds);
      const mm = matrixModel(studyRuns(b, 'matrix'), { thresholds: thr, modules: modules() });
      view.appendChild(h('div', { class: 'su2-note', style: { margin: '0 0 8px' } }, [
        mm.pass + ' of ' + mm.total + ' runs pass' + (mm.na ? ', ' + mm.na + ' without a verdict' : '') + '. ✓ pass · ✗ fail · dashed: scored on the warning only / out of the envelope. Each cell shows the deciding metric; click to open the run.',
      ]));
      mm.families.forEach(function (f) {
        const fam = h('div', { class: 'su2-fam' }, [h('h4', { text: 'Family ' + f.family + ' — ' + f.pass + ' / ' + f.total + ' pass' })]);
        f.rows.forEach(function (row) {
          const cells = h('div', { class: 'su2-cells' });
          row.cells.forEach(function (c) {
            const cls = 'su2-cell ' + (c.state.indexOf('pass') === 0 ? 'su2-pass' : c.state === 'fail' ? 'su2-fail' : 'su2-na') + (c.scope && c.scope !== 'in' ? ' su2-scope' : '');
            const glyph = c.state.indexOf('pass') === 0 ? '✓' : c.state === 'fail' ? '✗' : '?';
            const btn = h('button', { type: 'button', class: cls, 'aria-label': row.scenario + ' ' + c.label + ': ' + c.state + ', ' + metricText(c.metric) }, [
              h('b', { text: glyph + ' ' + c.label }), metricText(c.metric),
            ]);
            btn.addEventListener('click', function () { openRun(c.run); });
            btn.addEventListener('mousemove', function (e) { showTip(e, runTipHtml(c.run, thr)); });
            btn.addEventListener('mouseleave', hideTip);
            cells.appendChild(btn);
          });
          fam.appendChild(h('div', { class: 'su2-mrow' }, [h('div', { class: 'su2-mname' }, [row.scenario, row.name ? h('small', { text: row.name }) : null, h('small', { text: row.pass + ' / ' + row.cells.length + ' pass' })]), cells]));
        });
        view.appendChild(fam);
      });
    }

    function runTipHtml(run, thr) {
      const rows = Object.keys(run.metrics).filter(function (k) { return run.metrics[k] !== null && run.metrics[k] !== undefined; }).slice(0, 14).map(function (k) {
        const failed = run.verdict && (run.verdict.failed || []).indexOf(k) >= 0;
        const dec = (run.decide || []).indexOf(k) >= 0;
        return '<tr><td>' + charts.esc(k) + (dec ? ' ◆' : '') + '</td><td class="su2-num">' + charts.esc(fmt(run.metrics[k])) + (failed ? ' ✗' : '') + '</td></tr>';
      }).join('');
      return '<b>' + charts.esc(run.scenario + ' · ' + run.label) + '</b><br>' + charts.esc(run.verdict ? (run.verdict.pass ? '✓ passes' : '✗ fails: ' + (run.verdict.failed || []).join(', ')) : 'no verdict') + '<table>' + rows + '</table><span style="color:var(--su2-ink2)">◆ decides · click to open</span>';
    }

    function svgInto(container, svg) { container.innerHTML = svg; return container.firstChild; }

    function renderMap(b) {
      const runs = studyRuns(b, 'map');
      const axes = paramAxes(runs);
      if (axes.length < 2) {
        view.appendChild(h('div', { class: 'su2-empty' }, ['This batch varies fewer than two parameters, so there is no map. Run a sweep over two parameters (sweep.js), or one here:']));
        view.appendChild(mapRunForm());
        return;
      }
      if (!state.mapX || !axes.some(function (a) { return a.key === state.mapX; })) state.mapX = axes[0].key;
      if (!state.mapY || state.mapY === state.mapX || !axes.some(function (a) { return a.key === state.mapY; })) state.mapY = (axes.filter(function (a) { return a.key !== state.mapX; })[0] || axes[1]).key;
      const metricNames = {};
      runs.forEach(function (r) { Object.keys(r.metrics).forEach(function (k) { if (typeof r.metrics[k] === 'number' || typeof r.metrics[k] === 'boolean') metricNames[k] = 1; }); });
      function sel(cur, list, on) {
        const s = h('select');
        list.forEach(function (o) { s.appendChild(h('option', { value: o[0], text: o[1] })); });
        s.value = cur;
        s.addEventListener('change', function () { on(s.value); render(); });
        return s;
      }
      const axisOpts = axes.map(function (a) { return [a.key, a.key + ' (' + a.values.length + ')']; });
      const valueOpts = [['passShare', 'share of runs that pass']].concat(Object.keys(metricNames).sort().map(function (k) { return [k, k]; }));
      const targetIn = h('input', { type: 'text', value: String(state.target), size: 5, title: 'Draw the frontier where the cell value reaches this' });
      targetIn.addEventListener('change', function () { const v = parseFloat(targetIn.value); state.target = isFinite(v) ? v : NaN; render(); });
      view.appendChild(h('div', { class: 'su2-form' }, [
        h('label', null, ['x ', sel(state.mapX, axisOpts, function (v) { state.mapX = v; })]),
        h('label', null, ['y ', sel(state.mapY, axisOpts, function (v) { state.mapY = v; })]),
        h('label', null, ['cell ', sel(state.mapValue, valueOpts, function (v) { state.mapValue = v; if (v === 'passShare') state.target = 1; else state.target = NaN; })]),
        state.mapValue !== 'passShare' ? h('label', null, ['over the runs ', sel(state.mapAgg, [['worst', 'worst'], ['mean', 'mean'], ['min', 'min'], ['max', 'max']], function (v) { state.mapAgg = v; })]) : null,
        h('label', null, ['frontier at ', targetIn]),
      ]));
      const value = state.mapValue === 'passShare' ? { kind: 'passShare' } : { kind: 'metric', name: state.mapValue, agg: state.mapAgg };
      const grid = heatGrid(runs, state.mapX, state.mapY, value, { modules: modules() });
      const marks = presetMarks(grid, presetPoints(b, modules()));
      const w = Math.max(420, Math.min(900, (view.clientWidth || 760) - 16));
      const hh = Math.max(260, Math.min(520, 60 + grid.y.n * 34));
      const lay = layoutHeatmap(grid, { box: { x: 0, y: 0, w: w, h: hh }, marks: marks, target: state.target });
      const wrap = h('div', { class: 'su2-svgwrap' });
      const svg = svgInto(wrap, charts.renderSvg(lay.ops, w, hh, 'Feasibility map: ' + state.mapX + ' × ' + state.mapY));
      svg.addEventListener('mousemove', function (e) {
        const rc = svg.getBoundingClientRect();
        const hit = lay.cellAt((e.clientX - rc.left) * w / rc.width, (e.clientY - rc.top) * hh / rc.height);
        if (!hit || !hit.cell.n) { hideTip(); return; }
        const c = hit.cell;
        const failing = {};
        c.runs.forEach(function (r) { if (r.verdict && !r.verdict.pass) failing[r.scenario] = (failing[r.scenario] || 0) + 1; });
        const fl = Object.keys(failing).sort(function (a, b2) { return failing[b2] - failing[a]; }).slice(0, 6);
        showTip(e, '<b>' + charts.esc(state.mapX) + ' = ' + charts.esc(grid.x.labels[hit.i]) + '<br>' + charts.esc(state.mapY) + ' = ' + charts.esc(grid.y.labels[hit.j]) + '</b><br>' +
          (value.kind === 'passShare' ? c.pass + ' of ' + c.n + ' runs pass (' + Math.round(c.value * 100) + '%)' : charts.esc(value.name) + ' ' + fmt(c.value) + ' (' + c.n + ' runs)') +
          (fl.length ? '<br>failing: ' + fl.map(function (s) { return charts.esc(s) + ' ×' + failing[s]; }).join(', ') : ''));
      });
      svg.addEventListener('mouseleave', hideTip);
      view.appendChild(wrap);
      const assumed = b.plant && b.plant.assumed !== false;
      view.appendChild(h('div', { class: 'su2-note', style: { marginTop: '6px' } }, [
        grid.used + ' runs on the map' + (grid.skipped ? ' (' + grid.skipped + ' without both parameters left out)' : '') + (grid.x.binned || grid.y.binned ? '; many values: binned' : '') +
        '. Diamonds: the plant presets. ' + (assumed ? 'With an assumed plant: this shows what the car must measure, not a verdict.' : ''),
      ]));
      view.appendChild(mapRunForm());
    }

    function mapRunForm() {
      const c = core();
      if (!c.sim || !c.scenario) return h('div', { class: 'su2-note', text: 'A small map can be computed here once the core is loaded in the page; larger ones: node tools/cruise-sim/sweep.js <plan.json>.' });
      const xk = h('input', { type: 'text', value: 'plant.aMin_ms2', title: 'A config path' });
      const xv = h('input', { type: 'text', value: '-0.5..-3:6', title: 'from..to:steps, or a list' });
      const yk = h('input', { type: 'text', value: 'plant.deadTime_s' });
      const yv = h('input', { type: 'text', value: '0.2..1.4:5' });
      const fam = h('input', { type: 'text', value: 'B C D E', title: 'Families of the catalogue to run in each cell' });
      const est = h('span', { class: 'su2-note' });
      function plan() {
        const fams = fam.value.toUpperCase().split(/[^A-L]+/).filter(Boolean);
        const ids = c.scenario.list().filter(function (s) { return fams.indexOf(s.family) >= 0; }).map(function (s) { return s.id; });
        const grid = {}; grid[xk.value.trim()] = parseValues(xv.value); grid[yk.value.trim()] = parseValues(yv.value);
        return { scenarios: ids, grid: grid, base: JSON.parse(JSON.stringify(app.config || {})), study: 'map' };
      }
      function estimate() { try { est.textContent = '≈ ' + planJobs(plan(), c.scenario).length + ' runs'; } catch (e) { est.textContent = ''; } }
      [xk, xv, yk, yv, fam].forEach(function (i) { i.addEventListener('change', estimate); });
      estimate();
      const go = h('button', { type: 'button', onclick: function () { state.mapX = xk.value.trim(); state.mapY = yk.value.trim(); startPlan(plan(), 'map'); } }, ['Run map here']);
      return h('div', { class: 'su2-form', style: { marginTop: '8px' } }, [h('label', null, ['x ', xk, xv]), h('label', null, ['y ', yk, yv]), h('label', null, ['families ', fam]), go, est]);
    }

    function renderSens(b) {
      const runs = studyRuns(b, 'sensitivity').filter(function (r) { return r.side; });
      if (!runs.length) {
        view.appendChild(h('div', { class: 'su2-empty' }, ['No sensitivity runs in this batch (runs with param and side low / base / high). sweep.js makes them; or run one here:']));
        view.appendChild(sensRunForm());
        return;
      }
      const metricNames = {};
      runs.forEach(function (r) { Object.keys(r.metrics).forEach(function (k) { if (typeof r.metrics[k] === 'number') metricNames[k] = 1; }); });
      const s = h('select');
      [['passShare', 'share of runs that pass']].concat(Object.keys(metricNames).sort().map(function (k) { return [k, k + ' (worst)']; })).forEach(function (o) { s.appendChild(h('option', { value: o[0], text: o[1] })); });
      s.value = state.tornado;
      s.addEventListener('change', function () { state.tornado = s.value; render(); });
      view.appendChild(h('div', { class: 'su2-form' }, [h('label', null, ['measure ', s])]));
      const model = tornadoModel(runs, state.tornado === 'passShare' ? { kind: 'passShare' } : { kind: 'metric', name: state.tornado }, modules());
      const w = Math.max(420, Math.min(900, (view.clientWidth || 760) - 16));
      const lay = layoutTornado(model, { box: { w: w } });
      const wrap = h('div', { class: 'su2-svgwrap' });
      svgInto(wrap, charts.renderSvg(lay.ops, lay.w, lay.h, 'Sensitivity: each parameter at −30 % and +30 %'));
      view.appendChild(wrap);
      const flips = model.bars.filter(function (x) { return x.flipsLow || x.flipsHigh; });
      view.appendChild(h('div', { class: 'su2-note', style: { marginTop: '6px' } }, [
        flips.length ? 'The verdict turns on: ' + flips.map(function (x) { return x.param + (x.flipsLow && x.flipsHigh ? ' (both ways)' : x.flipsLow ? ' (at −30 %)' : ' (at +30 %)'); }).join(', ') + '. Measure these first.' : 'No parameter changes the verdict at ±30 %.',
      ]));
      view.appendChild(sensRunForm());
    }

    function sensRunForm() {
      const c = core();
      if (!c.sim || !c.scenario) return h('div');
      const keys = h('input', { type: 'text', value: 'plant.aMin_ms2 plant.deadTime_s plant.tau_s command.delay_s', style: { width: '320px' }, title: 'Config paths, each moved ±30 % from its current value' });
      const fam = h('input', { type: 'text', value: 'B C D E' });
      const go = h('button', { type: 'button' }, ['Run ±30 % here']);
      go.addEventListener('click', function () {
        const fams = fam.value.toUpperCase().split(/[^A-L]+/).filter(Boolean);
        const ids = c.scenario.list().filter(function (s) { return fams.indexOf(s.family) >= 0; }).map(function (s) { return s.id; });
        const base = JSON.parse(JSON.stringify(app.config || {}));
        const plans = [];
        keys.value.split(/[\s,]+/).filter(Boolean).forEach(function (p) {
          const v = effectiveValue(base, p, modules());
          if (typeof v !== 'number' || !isFinite(v) || v === 0) return;
          [['low', 0.7], ['base', 1], ['high', 1.3]].forEach(function (sd) { plans.push({ param: p, side: sd[0], factor: sd[1], value: +(v * sd[1]).toFixed(6) }); });
        });
        // one plan per (param, side), chained
        const all = [];
        let k = 0;
        (function next() {
          if (k >= plans.length) { const nb = normalizeBatch({ kind: 'cs-batch', version: 1, base: base, runs: all }); nb.source = 'this page, sensitivity'; setCurrent(nb); render(); return; }
          const p = plans[k++];
          const grid = {}; grid[p.param] = [p.value];
          state.job = runPlan({ scenarios: ids, grid: grid, base: base, study: 'sensitivity' }, c, function (i, n) { prog.hidden = false; prog.max = plans.length; prog.value = k - 1 + i / n; info.textContent = 'sensitivity ' + p.param + ' ' + p.side + ': ' + i + ' / ' + n; }, function (nb) {
            nb.runs.forEach(function (r) { r.param = p.param; r.side = p.side; r.factor = p.factor; all.push(r); });
            if (k >= plans.length) { prog.hidden = true; state.job = null; }
            next();
          });
        })();
      });
      return h('div', { class: 'su2-form', style: { marginTop: '8px' } }, [h('label', null, ['parameters ', keys]), h('label', null, ['families ', fam]), go]);
    }

    function renderTune(b) {
      const runs = studyRuns(b, 'tuning');
      const tt = tuningTable(runs, { thresholds: b.thresholds, modules: modules() });
      if (!tt.rows.length) { view.appendChild(h('div', { class: 'su2-empty' }, ['No tuning runs in this batch.'])); return; }
      if (tt.fixed.length) view.appendChild(h('div', { class: 'su2-note', style: { margin: '0 0 6px' } }, ['Fixed in every set: ' + tt.fixed.map(function (f) { return f.key + ' = ' + f.value; }).join(', ')]));
      const tb = h('table', { class: 'su2-table' });
      const head = [h('th', { text: 'Set' })].concat(tt.varying.map(function (k) { return h('th', { class: 'su2-num', text: shortKey(k), title: k }); }))
        .concat([h('th', { class: 'su2-num', text: 'pass' }), h('th', { class: 'su2-num', text: 'comfort cost', title: 'Mean of each comfort metric over its threshold: lower is calmer' })])
        .concat(tt.comfort.map(function (c) { return h('th', { class: 'su2-num', text: c.label, title: c.name + ' (' + c.agg + ' over the runs), threshold ' + c.ref }); }))
        .concat([h('th', { text: 'fails in' })]);
      tb.appendChild(h('tr', null, head));
      tt.rows.forEach(function (r, i) {
        const tr = h('tr', { class: 'su2-click' + (r.pareto ? ' su2-pareto' : ''), title: 'Click: apply this set to the settings and run' }, [h('td', { text: (i + 1) + '. ' + r.set })]
          .concat(tt.varying.map(function (k) { return h('td', { class: 'su2-num', text: fmt(r.params[k]) }); }))
          .concat([h('td', { class: 'su2-num', text: Math.round(r.passShare * 100) + '% (' + r.pass + '/' + r.n + ')' }), h('td', { class: 'su2-num', text: fmt(r.cost, 2) })])
          .concat(tt.comfort.map(function (c) { return h('td', { class: 'su2-num', text: fmt(r.comfort[c.name]) }); }))
          .concat([h('td', { text: r.failedScenarios.slice(0, 4).join(', ') + (r.failedScenarios.length > 4 ? ' …' : '') })]));
        tr.addEventListener('click', function () {
          const params = {};
          tt.varying.concat(tt.fixed.map(function (f) { return f.key; })).forEach(function (k) { if (k.indexOf('.') > 0) params[k] = r.params[k]; });
          if (typeof app.setConfig === 'function') app.setConfig(paramsPatch(app.config || {}, params), { run: false });
          info.textContent = 'Applied set ' + r.set + ' to the settings.';
        });
        tb.appendChild(tr);
      });
      view.appendChild(h('div', { class: 'su2-note', style: { margin: '0 0 6px' } }, ['Ranked by pass share, then comfort cost. ★ = no other set is better on both. Click a row to apply its parameters.']));
      view.appendChild(h('div', { style: { overflowX: 'auto' } }, [tb]));
    }

    function render() {
      hideTip();
      view.innerHTML = '';
      const b = batch();
      runMatrixBtn.disabled = !(core().sim && core().scenario);
      if (!b) {
        banner.hidden = true;
        if (!state.job) info.textContent = 'No batch loaded.';
        view.appendChild(h('div', { class: 'su2-empty' }, ['Load a batch file (node tools/cruise-sim/sweep.js <plan.json> writes one into bake/work/cruise-sim/), or run the matrix here with the current settings.']));
        if (state.tab === 'map') view.appendChild(mapRunForm());
        return;
      }
      const assumed = !b.plant || b.plant.assumed !== false;
      banner.hidden = !assumed;
      banner.textContent = 'Assumed plant' + (b.plant && b.plant.name ? ': ' + b.plant.name : '') + ' — these batch results are not a verdict';
      if (!state.job) info.textContent = (b.source ? b.source + ' · ' : '') + b.runs.length + ' runs' + (b.created ? ' · ' + String(b.created).slice(0, 16).replace('T', ' ') : '') + (b.warnings.length ? ' · ' + b.warnings.join('; ') : '');
      if (state.tab === 'matrix') renderMatrix(b);
      else if (state.tab === 'map') renderMap(b);
      else if (state.tab === 'sens') renderSens(b);
      else renderTune(b);
    }

    function fromApp(arg) {
      const j = arg && (arg.runs || arg.results) ? arg : app.batch;
      if (j) { const nb = normalizeBatch(j); nb.source = nb.source || j.source || 'loaded'; setCurrent(nb); }
      render();
    }

    const offs = [
      charts.listen(app, 'batch', fromApp),
      charts.listen(app, 'view', function () { render(); }),
      onCurrent(function () { /* another mount changed it */ }),
    ];
    if (app.batch) fromApp(app.batch); else render();
    return {
      destroy: function () { offs.forEach(function (o) { o(); }); if (state.job) state.job.cancel(); tip.remove(); el.innerHTML = ''; },
      setBatch: function (j) { setCurrent(normalizeBatch(j)); render(); },
    };
  }

  /** A config value by dotted path, falling back to the module's preset / SCHEMA default. */
  function effectiveValue(config, path, modules) {
    const parts = path.split('.');
    let o = config;
    for (let i = 0; i < parts.length && o !== undefined && o !== null; i++) o = o[parts[i]];
    if (o !== undefined && o !== null) return o;
    const mod = modules && modules[parts[0] === 'thresholds' ? 'metrics' : parts[0]];
    return mod ? charts.paramValue(config, mod, [parts[parts.length - 1]]) : undefined;
  }

  /** A number with at most 3 decimals and no trailing zeros (axis labels). */
  function fmtShort(v) { return isFinite(v) ? String(+v.toFixed(3)).replace('-', '−') : fmt(v); }

  function shortMetric(n) { return String(n).replace(/_(s|m|mps2|ms2|mps3|kmh|mps)$/, ''); }

  const batch = {
    flatten: flatten, normalizeRun: normalizeRun, normalizeBatch: normalizeBatch, studyRuns: studyRuns,
    metricOp: metricOp, thresholdOf: thresholdOf, margin: margin, decidingMetric: decidingMetric, stateOf: stateOf,
    matrixModel: matrixModel, paramAxes: paramAxes, makeAxis: makeAxis, heatGrid: heatGrid, rampT: rampT, rampIndex: rampIndex,
    presetMarks: presetMarks, presetPoints: presetPoints, frontier: frontier, frontierText: frontierText, layoutHeatmap: layoutHeatmap,
    tornadoModel: tornadoModel, layoutTornado: layoutTornado, tuningTable: tuningTable, paramsPatch: paramsPatch, runConfig: runConfig,
    parseValues: parseValues, fmtShort: fmtShort, planJobs: planJobs, runPlan: runPlan, effectiveValue: effectiveValue, shortMetric: shortMetric,
    current: getCurrent, setCurrent: setCurrent, onCurrent: onCurrent, mount: mount,
  };
  if (typeof module !== 'undefined') module.exports = batch; else (self.CS = self.CS || {})['batch'] = batch;
})();
