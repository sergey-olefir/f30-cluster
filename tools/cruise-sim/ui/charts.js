/* Cruise simulator — time charts (SU2).
 *
 * Linked to the shell's scrubber (app.cursorT), zoomable along time, one canvas per panel:
 * speeds · gap · time gap · TTC · accelerations · the event lane. A second run can be pinned or
 * loaded as "B" and drawn under the current run "A".
 *
 * The file has two halves:
 *   1. pure helpers (scales, ticks, decimation, panel resolution, event lanes, draw-op layout,
 *      draw-op renderers to canvas and to an SVG string) — tested under Node, reused by
 *      batch.js and report-view.js;
 *   2. mount(el, app) — the DOM view, used only in the browser.
 *
 * Draw ops carry colour ROLES ('s0', 'ink', 'grid', ...), not hex: the canvas resolves them from
 * the CSS custom properties --su2-<role> (so light / dark follow the page), the SVG renderer
 * writes var(--su2-<role>) so the report's own CSS themes it.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Palette (dataviz reference palette; categorical order validated for CVD on adjacent pairs).
  // Colour follows the entity, never its rank:
  //   s0 blue    our car (ego)                 s1 orange  the lead, true and measured
  //   s2 aqua    the controller (cmd, v_ref, d_des)  s5 green   the cruise (set speed held)
  //   s6 violet  the estimator                 s7 red     the warning (needed gap, thresholds)
  //   s4 magenta the car behind us             muted      the driver's maximum, plant limits
  // Pass / fail cells use blue / orange plus a glyph (never colour alone, never red / green).
  // ---------------------------------------------------------------------------------------------
  const THEMES = {
    light: {
      surface: '#fcfcfb', page: '#f9f9f7', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781',
      grid: '#e1e0d9', axis: '#c3c2b7', border: 'rgba(11,11,11,0.10)',
      s0: '#2a78d6', s1: '#eb6834', s2: '#1baf7a', s3: '#eda100', s4: '#e87ba4', s5: '#008300', s6: '#6250d6', s7: '#e34948',
      pass: '#2a78d6', fail: '#eb6834', na: '#c3c2b7', onfill: '#ffffff',
      warnband: 'rgba(227,73,72,0.10)', faultband: 'rgba(232,123,164,0.16)', brush: 'rgba(42,120,214,0.15)',
      changed: '#eda100',
      seq: ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'],
      // text on each ramp step (ink on the light steps, white on the dark ones)
      seqtxt: ['#0b0b0b', '#0b0b0b', '#0b0b0b', '#0b0b0b', '#0b0b0b', '#0b0b0b', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'],
    },
    dark: {
      surface: '#1a1a19', page: '#0d0d0d', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781',
      grid: '#2c2c2a', axis: '#383835', border: 'rgba(255,255,255,0.10)',
      s0: '#3987e5', s1: '#d95926', s2: '#199e70', s3: '#c98500', s4: '#d55181', s5: '#0ca30c', s6: '#9085e9', s7: '#e66767',
      pass: '#3987e5', fail: '#d95926', na: '#383835', onfill: '#ffffff',
      warnband: 'rgba(230,103,103,0.16)', faultband: 'rgba(213,81,129,0.20)', brush: 'rgba(57,135,229,0.22)',
      changed: '#c98500',
      // dark: the ramp runs the other way (near zero recedes into the dark surface)
      seq: ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'],
      seqtxt: ['#f0efec', '#f0efec', '#f0efec', '#f0efec', '#f0efec', '#ffffff', '#0b0b0b', '#0b0b0b', '#0b0b0b', '#0b0b0b', '#0b0b0b', '#0b0b0b', '#0b0b0b'],
    },
  };
  const ROLES = Object.keys(THEMES.light).filter(function (k) { return k !== 'seq' && k !== 'seqtxt'; });
  const SEQ_N = THEMES.light.seq.length;

  /** The CSS block every SU2 view (and the report) uses: tokens for light, dark by OS and by data-theme. */
  function themeCss(scope) {
    scope = scope || '.su2';
    function block(th) {
      const lines = ROLES.map(function (r) { return '  --su2-' + r + ': ' + th[r] + ';'; });
      th.seq.forEach(function (c, i) { lines.push('  --su2-seq' + i + ': ' + c + ';'); });
      th.seqtxt.forEach(function (c, i) { lines.push('  --su2-seqtxt' + i + ': ' + c + ';'); });
      return lines.join('\n');
    }
    return scope + ' {\n  color-scheme: light;\n' + block(THEMES.light) + '\n}\n' +
      '@media (prefers-color-scheme: dark) {\n  :root:where(:not([data-theme="light"])) ' + scope + ' {\n  color-scheme: dark;\n' + block(THEMES.dark) + '\n  }\n}\n' +
      ':root[data-theme="dark"] ' + scope + ' {\n  color-scheme: dark;\n' + block(THEMES.dark) + '\n}\n';
  }

  // ---------------------------------------------------------------------------------------------
  // Numbers and scales
  // ---------------------------------------------------------------------------------------------
  function num(v) { return v === null || v === undefined || v === '' ? NaN : +v; }

  /** A linear map [d0, d1] -> [r0, r1] with .invert. */
  function linear(d0, d1, r0, r1) {
    const span = d1 - d0;
    const k = span ? (r1 - r0) / span : 0;
    const f = function (v) { return r0 + (v - d0) * k; };
    f.invert = function (p) { return k ? d0 + (p - r0) / k : d0; };
    f.domain = [d0, d1];
    f.range = [r0, r1];
    return f;
  }

  /** The 1-2-5 step that splits `span` into about `n` parts. */
  function niceStep(span, n) {
    if (!(span > 0) || !isFinite(span)) return 1;
    const raw = span / Math.max(1, n || 5);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const m = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return m * mag;
  }

  function decimalsOf(step) {
    if (!(step > 0) || step >= 1) return 0;
    return Math.min(10, Math.ceil(-Math.log10(step) - 1e-9));
  }

  /** Tick values inside [lo, hi] on a 1-2-5 step; never more than ~2n of them. */
  function ticks(lo, hi, n) {
    if (!isFinite(lo) || !isFinite(hi)) return [];
    if (hi < lo) { const s = lo; lo = hi; hi = s; }
    if (hi === lo) return [lo];
    const step = niceStep(hi - lo, n);
    const dec = decimalsOf(step);
    const out = [];
    const first = Math.ceil(lo / step - 1e-9);
    for (let i = first; i * step <= hi + step * 1e-9; i++) {
      out.push(+(i * step).toFixed(dec));
      if (out.length > 100) break;
    }
    return out;
  }

  /** [lo, hi] widened to whole steps (and to a non-zero span). */
  function niceDomain(lo, hi, n) {
    if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
    if (hi < lo) { const s = lo; lo = hi; hi = s; }
    if (hi === lo) {
      const d = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
      lo -= d; hi += d;
    }
    const step = niceStep(hi - lo, n);
    return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step];
  }

  function fmt(v, dec) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '–';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v !== 'number') return String(v);
    if (!isFinite(v)) return v > 0 ? '∞' : '−∞';
    if (dec === undefined) {
      const a = Math.abs(v);
      dec = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a === 0 ? 0 : 3;
    }
    return v.toFixed(dec).replace('-', '−');
  }

  /** First index i in sorted `t` with t[i] >= x (t.length when none). */
  function bisect(t, x) {
    let lo = 0, hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (t[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** The value of a sampled series at time x: linear between samples, or the previous sample (`step`). */
  function valueAt(t, y, x, step) {
    const n = t.length;
    if (!n || !(x >= t[0] - 1e-9) || !(x <= t[n - 1] + 1e-9)) return NaN;
    let i = bisect(t, x);
    if (i < n && Math.abs(t[i] - x) < 1e-9) return num(y[i]);
    if (i >= n) return num(y[n - 1]);
    if (i === 0) return num(y[0]);
    const a = num(y[i - 1]), b = num(y[i]);
    if (step) return a;
    if (isNaN(a) || isNaN(b)) return NaN;
    return a + (b - a) * (x - t[i - 1]) / (t[i] - t[i - 1]);
  }

  /**
   * Min/max ("M4") decimation of the samples of [x0, x1] into `px` columns. Returns the data points
   * to draw, in time order: for a dense column its first, minimum, maximum and last sample, so the
   * envelope (and every spike) survives; a NaN inside a column is kept as a break. Sparse ranges
   * come back unchanged (plus one sample either side, so the line reaches the edges).
   */
  function decimate(t, y, x0, x1, px) {
    const n = t.length;
    const outT = [], outY = [];
    if (!n || !(x1 > x0)) return { t: outT, y: outY };
    const i0 = Math.max(0, bisect(t, x0) - 1);
    const i1 = Math.min(n, bisect(t, x1) + 1);
    px = Math.max(1, Math.floor(px));
    if (i1 - i0 <= 4 * px) {
      for (let i = i0; i < i1; i++) { outT.push(t[i]); outY.push(num(y[i])); }
      return { t: outT, y: outY };
    }
    const w = (x1 - x0) / px;
    let i = i0;
    // the sample before x0 keeps the line attached to the left edge
    if (t[i] < x0) { outT.push(t[i]); outY.push(num(y[i])); i++; }
    while (i < i1) {
      const b = Math.floor((t[i] - x0) / w);
      const bEnd = x0 + (b + 1) * w;
      let first = -1, last = -1, iMin = -1, iMax = -1, gap = false;
      let vMin = Infinity, vMax = -Infinity;
      for (; i < i1 && (t[i] < bEnd || b >= px); i++) {
        const v = num(y[i]);
        if (isNaN(v)) { gap = true; continue; }
        if (first < 0) first = i;
        last = i;
        if (v < vMin) { vMin = v; iMin = i; }
        if (v > vMax) { vMax = v; iMax = i; }
      }
      if (first >= 0) {
        const idx = [first, iMin, iMax, last].sort(function (a, c) { return a - c; });
        let prev = -1;
        for (let k = 0; k < idx.length; k++) {
          if (idx[k] === prev) continue;
          prev = idx[k];
          outT.push(t[idx[k]]); outY.push(num(y[idx[k]]));
        }
      }
      if (gap) { outT.push(outT.length ? outT[outT.length - 1] : x0); outY.push(NaN); }
    }
    return { t: outT, y: outY };
  }

  /** Zoom the time window [t0, t1] by `factor` (< 1 = in) about `centre`, inside `bounds`. */
  function zoomView(view, factor, centre, bounds, minSpan) {
    const full = bounds[1] - bounds[0];
    if (!(full > 0)) return { t0: bounds[0], t1: bounds[1] };
    minSpan = minSpan || Math.min(full, 0.5);
    const span = view.t1 - view.t0;
    const ns = Math.min(full, Math.max(minSpan, span * factor));
    if (centre === undefined || isNaN(centre)) centre = (view.t0 + view.t1) / 2;
    const f = span > 0 ? (centre - view.t0) / span : 0.5;
    let t0 = centre - f * ns;
    return clampView({ t0: t0, t1: t0 + ns }, bounds);
  }

  function panView(view, dt, bounds) {
    return clampView({ t0: view.t0 + dt, t1: view.t1 + dt }, bounds);
  }

  function clampView(v, bounds) {
    let span = Math.min(v.t1 - v.t0, bounds[1] - bounds[0]);
    let t0 = Math.max(bounds[0], Math.min(v.t0, bounds[1] - span));
    return { t0: t0, t1: t0 + span };
  }

  /** Keep `cursor` visible: if it left the window, move the window so it sits at 3/4 (playback). */
  function followView(view, cursor, bounds) {
    if (!(cursor >= view.t0 && cursor <= view.t1)) {
      const span = view.t1 - view.t0;
      return clampView({ t0: cursor - span * 0.75, t1: cursor + span * 0.25 }, bounds);
    }
    return view;
  }

  /** Intervals where pred(y[i]) holds, as [{ t0, t1 }] (a run still on at the end closes at tEnd). */
  function spans(t, y, pred, tEnd) {
    const out = [];
    let start = null;
    for (let i = 0; i < t.length; i++) {
      const on = pred(num(y[i]));
      if (on && start === null) start = t[i];
      else if (!on && start !== null) { out.push({ t0: start, t1: t[i] }); start = null; }
    }
    if (start !== null) out.push({ t0: start, t1: tEnd !== undefined ? tEnd : t[t.length - 1] });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Result access (a result may come from run() with Float64Arrays, or from a JSON file with nulls)
  // ---------------------------------------------------------------------------------------------
  const seriesCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function toF64(arr) {
    if (!arr) return null;
    if (arr instanceof Float64Array) return arr;
    if (seriesCache && seriesCache.has(arr)) return seriesCache.get(arr);
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = num(arr[i]);
    if (seriesCache) seriesCache.set(arr, out);
    return out;
  }
  function getT(result) { return result ? toF64(result.t) : null; }
  function getSeries(result, name) {
    if (!result || !result.series || !result.series[name]) return null;
    return toF64(result.series[name]);
  }
  function hasData(arr) {
    if (!arr) return false;
    for (let i = 0; i < arr.length; i++) if (!isNaN(arr[i])) return true;
    return false;
  }
  function timeBounds(result) {
    const t = getT(result);
    if (!t || !t.length) return [0, 1];
    return [t[0], t[t.length - 1] > t[0] ? t[t.length - 1] : t[0] + 1];
  }

  // ---------------------------------------------------------------------------------------------
  // Parameter lookup across the config and the modules' SCHEMAs (names are SC1/SC2/SC3's; we look
  // for the first of several plausible keys so a renamed key costs a fallback, not a crash).
  // ---------------------------------------------------------------------------------------------
  function moduleOf(name) {
    const CS = typeof self !== 'undefined' && self.CS ? self.CS : null;
    return CS && CS[name] ? CS[name] : null;
  }

  /** The effective value of a module parameter: config value, else preset value, else SCHEMA default. */
  function paramValue(config, mod, keys, modules) {
    if (!mod) return undefined;
    const NAME = mod.NAME || mod.name;
    const part = (config && NAME && config[NAME]) || {};
    const preset = mod.PRESETS && part.preset && mod.PRESETS[part.preset];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (part[k] !== undefined) return part[k];
      if (preset && preset[k] !== undefined) return preset[k];
      if (mod.SCHEMA) {
        for (let j = 0; j < mod.SCHEMA.length; j++) if (mod.SCHEMA[j].key === k) return mod.SCHEMA[j].default;
      }
    }
    return undefined;
  }

  function lookup(config, name, keys, modules) {
    const mod = (modules && modules[name]) || moduleOf(name);
    let v = paramValue(config, mod || { NAME: name }, keys, modules);
    if (v === undefined && config && config[name]) {
      for (let i = 0; i < keys.length; i++) if (config[name][keys[i]] !== undefined) { v = config[name][keys[i]]; break; }
    }
    return v;
  }

  // Candidate keys, most likely first. Edit here when SC1 / SC2 / SC3 settle their names.
  const KEYS = {
    plantAMin: ['aMin_ms2', 'aMin', 'aMin_mps2', 'a_min'],
    plantAMax: ['aMax_ms2', 'aMax', 'aMax_mps2', 'a_max'],
    ttcWarn: ['ttcWarn_s', 'ttcWarn'],
    timeGapH: ['h', 'h_s'],
    thrMinTimeGap: ['minTimeGap_s', 'minTimeGap'],
    thrMinTTC: ['minTTC_s', 'minTTC'],
  };

  function thresholdsFor(config, modules) {
    const mt = (modules && modules.metrics) || moduleOf('metrics');
    const NAME = mt && mt.NAME ? mt.NAME : 'thresholds';
    const tcfg = (config && (config[NAME] || config.thresholds)) || {};
    function thr(keys) {
      for (let i = 0; i < keys.length; i++) if (tcfg[keys[i]] !== undefined) return num(tcfg[keys[i]]);
      if (mt && mt.SCHEMA) for (let j = 0; j < mt.SCHEMA.length; j++) if (keys.indexOf(mt.SCHEMA[j].key) >= 0) return num(mt.SCHEMA[j].default);
      return NaN;
    }
    return {
      minTimeGap: thr(KEYS.thrMinTimeGap),
      minTTC: thr(KEYS.thrMinTTC),
      ttcWarn: num(lookup(config, 'warning', KEYS.ttcWarn, modules)),
      h: num(lookup(config, 'controller', KEYS.timeGapH, modules)),
      aMin: num(lookup(config, 'plant', KEYS.plantAMin, modules)),
      aMax: num(lookup(config, 'plant', KEYS.plantAMax, modules)),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Panels
  // ---------------------------------------------------------------------------------------------
  const PANELS = [
    {
      id: 'speed', title: 'Speeds', unit: 'km/h', k: 3.6, series: [
        { name: 'ego.v', label: 'Ego', color: 's0', w: 2 },
        { name: 'lead.v', label: 'Lead (true)', color: 's1', w: 2 },
        { name: 'est.vlead', label: 'Lead (estimated)', color: 's6', w: 1.5, dash: [5, 3] },
        { name: 'set.cmd', label: 'Set speed commanded', color: 's2', w: 1.5, dash: [6, 3], step: true },
        { name: 'set.held', label: 'Set speed held', color: 's5', w: 1.5, step: true },
        { name: 'v.driverMax', label: 'Driver maximum', color: 'muted', w: 1, dash: [8, 4], step: true },
        { name: 'v.ref', label: 'v_ref', color: 's2', w: 1, dash: [1, 3], off: true },
      ],
    },
    {
      id: 'gap', title: 'Gap', unit: 'm', k: 1, yMin: 0, series: [
        { name: 'gap.true', label: 'True', color: 's1', w: 2 },
        { name: 'gap.meas', label: 'Measured', color: 's1', dots: true },
        { name: 'est.gap', label: 'Estimated', color: 's6', w: 1.5, dash: [5, 3] },
        { name: 'd.des', label: 'Desired', color: 's2', w: 1.5, dash: [6, 3] },
        { name: 'd.needed', label: 'Needed (warning)', color: 's7', w: 1.5, dash: [3, 3] },
        { name: 'follower.gap', label: 'Car behind: its gap', color: 's4', w: 1, off: true },
      ],
    },
    {
      id: 'timegap', title: 'Time gap', unit: 's', k: 1, yMin: 0, yCap: 6, series: [
        { name: 'timegap', label: 'Time gap', color: 's0', w: 2 },
      ],
      thresholds: function (th) {
        const out = [];
        if (isFinite(th.minTimeGap)) out.push({ v: th.minTimeGap, label: 'pass ≥ ' + fmt(th.minTimeGap, 1) + ' s', color: 's7', dash: [4, 3] });
        if (isFinite(th.h)) out.push({ v: th.h, label: 'target h ' + fmt(th.h, 1) + ' s', color: 's2', dash: [6, 3] });
        return out;
      },
    },
    {
      id: 'ttc', title: 'TTC', unit: 's', k: 1, yMin: 0, yCap: 20, series: [
        { name: 'ttc', label: 'TTC', color: 's0', w: 2, positive: true },
      ],
      thresholds: function (th) {
        const out = [];
        if (isFinite(th.minTTC)) out.push({ v: th.minTTC, label: 'pass ≥ ' + fmt(th.minTTC, 1) + ' s', color: 's7', dash: [4, 3] });
        if (isFinite(th.ttcWarn)) out.push({ v: th.ttcWarn, label: 'warn < ' + fmt(th.ttcWarn, 1) + ' s', color: 's7', dash: [1, 3] });
        return out;
      },
    },
    {
      id: 'accel', title: 'Accelerations', unit: 'm/s²', k: 1, series: [
        { name: 'ego.a', label: 'Ego', color: 's0', w: 2 },
        { name: 'lead.a', label: 'Lead (true)', color: 's1', w: 1.5 },
        { name: 'est.alead', label: 'Lead (estimated)', color: 's6', w: 1, dash: [5, 3], off: true },
        { name: 'follower.a', label: 'Car behind', color: 's4', w: 1, off: true },
      ],
      thresholds: function (th) {
        const out = [];
        if (isFinite(th.aMin)) out.push({ v: -Math.abs(th.aMin), label: 'plant a_min ' + fmt(-Math.abs(th.aMin), 1), color: 'muted', dash: [8, 3, 2, 3] });
        if (isFinite(th.aMax)) out.push({ v: th.aMax, label: 'plant a_max ' + fmt(th.aMax, 1), color: 'muted', dash: [8, 3, 2, 3] });
        return out;
      },
    },
    { id: 'events', title: 'Events', events: true },
  ];

  // Event lane rows. Shapes: tick, circle, cross, tri, tridown, diamond, square. Spans pair on/off kinds.
  const EVENT_ROWS = [
    { id: 'cmd', label: 'Commands', kinds: {
      'cmd.sent': { shape: 'tick', color: 's2', label: 'sent' },
      'cmd.applied': { shape: 'circle', color: 's5', label: 'applied' },
      'cmd.dropped': { shape: 'cross', color: 's1', label: 'dropped' },
      'cmd.rejected': { shape: 'cross', color: 's7', label: 'rejected' },
    } },
    { id: 'target', label: 'Target', kinds: {
      'target.acquired': { shape: 'tri', color: 's0', label: 'acquired' },
      'target.changed': { shape: 'diamond', color: 's6', label: 'changed' },
      'target.lost': { shape: 'tridown', color: 's1', label: 'lost' },
    } },
    { id: 'warn', label: 'Warning', span: { on: 'warn.on', off: 'warn.off', color: 's7', band: 'warnband' } },
    { id: 'driver', label: 'Driver', kinds: {
      'driver.react': { shape: 'circle', color: 's7', label: 'reacts' },
      'driver.brake': { shape: 'square', color: 's1', label: 'brakes' },
      'driver.override': { shape: 'tri', color: 's0', label: 'override' },
      'driver.resume': { shape: 'tri', color: 's5', label: 'resume' },
      'driver.vmax': { shape: 'diamond', color: 'muted', label: 'maximum' },
    } },
    { id: 'cruise', label: 'Cruise', kinds: { 'cruise.state': { shape: 'diamond', color: 's5', label: 'state' } } },
    { id: 'fault', label: 'Faults', span: { on: 'fault.on', off: 'fault.off', color: 's4', band: 'faultband' } },
    { id: 'collision', label: 'Collision', kinds: { 'collision': { shape: 'cross', color: 's7', label: 'collision', size: 7 } } },
  ];

  function eventRowOf(kind) {
    for (let i = 0; i < EVENT_ROWS.length; i++) {
      const r = EVENT_ROWS[i];
      if (r.kinds && r.kinds[kind]) return r;
      if (r.span && (r.span.on === kind || r.span.off === kind)) return r;
    }
    return null;
  }

  /** The key that pairs an on event with its off event (a fault's kind, a warning's reason is not one). */
  function spanKey(e) {
    if (e.kind && e.kind.indexOf('fault.') === 0) return e.fault || e.name || e.what || e.id || e.type || '';
    return '';
  }

  /** Pair on / off events into spans: [{ t0, t1, ev }]; an unclosed span ends at tEnd. */
  function eventSpans(events, onKind, offKind, tEnd) {
    const open = {};
    const out = [];
    const sorted = (events || []).slice().sort(function (a, b) { return a.t - b.t; });
    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const key = spanKey(e);
      if (e.kind === onKind) {
        if (!open[key]) open[key] = e;
      } else if (e.kind === offKind) {
        if (open[key]) { out.push({ t0: open[key].t, t1: e.t, ev: open[key] }); delete open[key]; }
        else if (key === '' ) {
          // an off without its on: close the oldest open span of any key
          const ks = Object.keys(open);
          if (ks.length) { out.push({ t0: open[ks[0]].t, t1: e.t, ev: open[ks[0]] }); delete open[ks[0]]; }
        }
      }
    }
    Object.keys(open).forEach(function (k) { out.push({ t0: open[k].t, t1: tEnd, ev: open[k] }); });
    return out.sort(function (a, b) { return a.t0 - b.t0; });
  }

  /** Short human text for an event (tooltips, report). */
  function eventText(e, enums) {
    const parts = [];
    Object.keys(e).forEach(function (k) {
      if (k === 't' || k === 'kind') return;
      let v = e[k];
      if (typeof v === 'number') {
        if (/vSet|^v$|speed/i.test(k) && !/_kmh$/.test(k)) v = fmt(v * 3.6, 0) + ' km/h';
        else v = fmt(v);
      } else if (v && typeof v === 'object') v = JSON.stringify(v);
      parts.push(k + ' ' + v);
    });
    return e.kind + (parts.length ? ': ' + parts.join(', ') : '');
  }

  /** Which panels / series exist in this result, with their visibility (`hidden` = { 'panel/series': bool }). */
  function resolvePanels(result, config, opts) {
    opts = opts || {};
    const th = thresholdsFor(config, opts.modules);
    const hidden = opts.hidden || {};
    const out = [];
    PANELS.forEach(function (p) {
      if (opts.panels && opts.panels.indexOf(p.id) < 0) return;
      if (p.events) {
        out.push({ id: p.id, title: p.title, events: true, rows: EVENT_ROWS });
        return;
      }
      const series = [];
      p.series.forEach(function (s) {
        const arr = getSeries(result, s.name);
        if (!hasData(arr)) return;
        const key = p.id + '/' + s.name;
        const vis = hidden[key] !== undefined ? !hidden[key] : !s.off;
        series.push(Object.assign({}, s, { key: key, visible: vis }));
      });
      if (!series.length) return;
      out.push({
        id: p.id, title: p.title, unit: p.unit, k: p.k, yMin: p.yMin, yCap: p.yCap,
        series: series, thresholds: p.thresholds ? p.thresholds(th) : [],
      });
    });
    return out;
  }

  /** The y domain of a panel over the visible window: every visible series of A (and B), thresholds, padding. */
  function panelDomain(panel, results, view) {
    let lo = Infinity, hi = -Infinity;
    results.forEach(function (r) {
      if (!r) return;
      const t = getT(r);
      if (!t) return;
      const i0 = Math.max(0, bisect(t, view.t0) - 1), i1 = Math.min(t.length, bisect(t, view.t1) + 1);
      panel.series.forEach(function (s) {
        if (!s.visible) return;
        const y = getSeries(r, s.name);
        if (!y) return;
        for (let i = i0; i < i1; i++) {
          let v = y[i] * panel.k;
          if (isNaN(v) || !isFinite(v)) continue;
          if (s.positive && v < 0) continue;
          if (panel.yCap !== undefined && v > panel.yCap) v = panel.yCap;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      });
    });
    (panel.thresholds || []).forEach(function (th) {
      if (isFinite(th.v)) { lo = Math.min(lo, th.v); hi = Math.max(hi, th.v); }
    });
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (panel.yMin !== undefined) lo = Math.min(panel.yMin, lo);
    const pad = (hi - lo) * 0.06;
    return niceDomain(lo - (panel.yMin !== undefined && lo === panel.yMin ? 0 : pad), hi + pad, 4);
  }

  // ---------------------------------------------------------------------------------------------
  // Layout: a panel -> draw ops (pure). box = { x, y, w, h } of the whole panel canvas.
  // ---------------------------------------------------------------------------------------------
  const PAD = { l: 64, r: 12, t: 8, b: 18 };

  function plotBox(box) {
    return { x: box.x + PAD.l, y: box.y + PAD.t, w: Math.max(10, box.w - PAD.l - PAD.r), h: Math.max(10, box.h - PAD.t - PAD.b) };
  }

  function xTicksOps(ops, pb, sx, view, withLabels) {
    const tk = ticks(view.t0, view.t1, Math.max(2, Math.floor(pb.w / 90)));
    const dec = decimalsOf(tk.length > 1 ? tk[1] - tk[0] : 1);
    tk.forEach(function (v) {
      const x = sx(v);
      ops.push({ op: 'line', x1: x, y1: pb.y, x2: x, y2: pb.y + pb.h, stroke: 'grid', width: 1 });
      if (withLabels) ops.push({ op: 'text', x: x, y: pb.y + pb.h + 3, text: fmt(v, dec) + (v === tk[tk.length - 1] ? ' s' : ''), fill: 'muted', align: 'center', baseline: 'top', size: 10 });
    });
  }

  function seriesPath(t, y, k, sx, sy, view, pb, s, cap) {
    const d = decimate(t, y, view.t0, view.t1, pb.w);
    const pts = [];
    const dense = d.t.length > pb.w * 1.5;
    for (let i = 0; i < d.t.length; i++) {
      let v = d.y[i] * k;
      if (s.positive && v < 0) v = NaN;
      if (cap !== undefined && v > cap) v = cap;
      if (!isFinite(v)) { pts.push(NaN, NaN); continue; }
      const x = sx(d.t[i]), yy = sy(v);
      if (s.step && !dense && pts.length >= 2 && !isNaN(pts[pts.length - 1])) pts.push(x, pts[pts.length - 1]);
      pts.push(x, yy);
    }
    return pts;
  }

  /**
   * Draw ops for one value panel. `results` = [A, B?]; B is drawn first, thin and translucent.
   * opts: { config, view, box, warnSpans, collisions, xLabels, cursorT }
   */
  function layoutPanel(panel, results, opts) {
    const ops = [];
    const box = opts.box;
    const pb = plotBox(box);
    const view = opts.view;
    const sx = linear(view.t0, view.t1, pb.x, pb.x + pb.w);
    const dom = opts.yDomain || panelDomain(panel, results, view);
    const sy = linear(dom[0], dom[1], pb.y + pb.h, pb.y);
    ops.push({ op: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: 'surface' });
    // bands first: warnings (A), then grid
    (opts.warnSpans || []).forEach(function (s) {
      const x0 = Math.max(pb.x, sx(s.t0)), x1 = Math.min(pb.x + pb.w, sx(s.t1));
      if (x1 > x0) ops.push({ op: 'rect', x: x0, y: pb.y, w: Math.max(1, x1 - x0), h: pb.h, fill: 'warnband' });
    });
    const yt = ticks(dom[0], dom[1], Math.max(2, Math.floor(pb.h / 28)));
    const ydec = decimalsOf(yt.length > 1 ? yt[1] - yt[0] : 1);
    yt.forEach(function (v) {
      const y = sy(v);
      ops.push({ op: 'line', x1: pb.x, y1: y, x2: pb.x + pb.w, y2: y, stroke: v === 0 ? 'axis' : 'grid', width: 1 });
      ops.push({ op: 'text', x: pb.x - 5, y: y, text: fmt(v, ydec), fill: 'muted', align: 'right', baseline: 'middle', size: 10 });
    });
    xTicksOps(ops, pb, sx, view, opts.xLabels);
    ops.push({ op: 'text', x: box.x + 4, y: pb.y, text: panel.unit, fill: 'muted', align: 'left', baseline: 'top', size: 10 });
    ops.push({ op: 'clip', x: pb.x, y: pb.y, w: pb.w, h: pb.h });
    // thresholds
    const thr = (panel.thresholds || []).slice().sort(function (a, b) { return b.v - a.v; });
    thrLabelSlots(thr.map(function (th) { return sy(th.v); })).forEach(function (slot, i) {
      const th = thr[i], y = sy(th.v);
      ops.push({ op: 'line', x1: pb.x, y1: y, x2: pb.x + pb.w, y2: y, stroke: th.color, width: 1.25, dash: th.dash });
      ops.push({ op: 'text', x: slot.left ? pb.x + 4 : pb.x + pb.w - 4, y: slot.above ? y - 2 : y + 2, text: th.label, fill: 'ink2', align: slot.left ? 'left' : 'right', baseline: slot.above ? 'bottom' : 'top', size: 10, halo: true });
    });
    // series: B under A
    for (let ri = results.length - 1; ri >= 0; ri--) {
      const r = results[ri];
      if (!r) continue;
      const t = getT(r);
      if (!t) continue;
      const isB = ri > 0;
      panel.series.forEach(function (s) {
        if (!s.visible) return;
        const y = getSeries(r, s.name);
        if (!y) return;
        if (s.dots) {
          const d = decimate(t, y, view.t0, view.t1, pb.w);
          const pts = [];
          for (let i = 0; i < d.t.length; i++) {
            const v = d.y[i] * panel.k;
            if (isFinite(v)) pts.push(sx(d.t[i]), sy(v));
          }
          ops.push({ op: 'dots', pts: pts, r: isB ? 1.2 : 1.6, fill: s.color, alpha: isB ? 0.4 : 0.85 });
          return;
        }
        const pts = seriesPath(t, y, panel.k, sx, sy, view, pb, s, panel.yCap);
        ops.push({ op: 'path', pts: pts, stroke: s.color, width: isB ? Math.max(1, s.w - 0.5) : s.w, dash: s.dash, alpha: isB ? 0.4 : 1 });
      });
    }
    (opts.collisions || []).forEach(function (tc) {
      const x = sx(tc);
      ops.push({ op: 'line', x1: x, y1: pb.y, x2: x, y2: pb.y + pb.h, stroke: 's7', width: 2 });
    });
    ops.push({ op: 'unclip' });
    ops.push({ op: 'rect', x: pb.x, y: pb.y, w: pb.w, h: pb.h, stroke: 'axis', width: 1 });
    if (opts.cursorT !== undefined && opts.cursorT >= view.t0 && opts.cursorT <= view.t1) {
      const x = sx(opts.cursorT);
      ops.push({ op: 'line', x1: x, y1: pb.y, x2: x, y2: pb.y + pb.h, stroke: 'ink', width: 1.5 });
    }
    return { ops: ops, sx: sx, sy: sy, pb: pb, dom: dom };
  }

  /**
   * Where to put threshold labels so close lines do not print over each other: ys are the lines'
   * pixel rows, top first. Each label goes above its line at the right; a label too close to the
   * previous one moves below its line, and if that collides too, to the left end.
   */
  function thrLabelSlots(ys, minGap) {
    minGap = minGap || 12;
    const out = [];
    let lastRight = -Infinity, lastLeft = -Infinity;
    ys.forEach(function (y) {
      if (y - minGap >= lastRight) { out.push({ left: false, above: true }); lastRight = y; }
      else if (y + minGap - lastRight >= minGap) { out.push({ left: false, above: false }); lastRight = y + minGap; }
      else if (y - minGap >= lastLeft) { out.push({ left: true, above: true }); lastLeft = y; }
      else { out.push({ left: true, above: false }); lastLeft = y + minGap; }
    });
    return out;
  }

  const EVENT_ROW_H = 16;

  /** Visible rows of the event lane: rows that have at least one event in A or B. */
  function eventRowsPresent(results) {
    const present = {};
    results.forEach(function (r) {
      (r && r.events || []).forEach(function (e) { const row = eventRowOf(e.kind); present[row ? row.id : 'other'] = true; });
    });
    const rows = EVENT_ROWS.filter(function (r) { return present[r.id]; });
    if (present.other) rows.push({ id: 'other', label: 'Other', kinds: {} });
    return rows;
  }

  function eventLaneHeight(results) {
    return PAD.t + PAD.b + Math.max(1, eventRowsPresent(results).length) * EVENT_ROW_H;
  }

  /** Draw ops of the event lane; markers thinned to one per kind per pixel column. */
  function layoutEvents(results, opts) {
    const ops = [];
    const box = opts.box;
    const pb = plotBox(box);
    const view = opts.view;
    const sx = linear(view.t0, view.t1, pb.x, pb.x + pb.w);
    const rows = eventRowsPresent(results);
    ops.push({ op: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: 'surface' });
    xTicksOps(ops, pb, sx, view, opts.xLabels !== false);
    const hits = [];
    rows.forEach(function (row, ri) {
      const yc = pb.y + ri * EVENT_ROW_H + EVENT_ROW_H / 2;
      if (ri > 0) ops.push({ op: 'line', x1: pb.x, y1: pb.y + ri * EVENT_ROW_H, x2: pb.x + pb.w, y2: pb.y + ri * EVENT_ROW_H, stroke: 'grid', width: 1 });
      ops.push({ op: 'text', x: pb.x - 5, y: yc, text: row.label, fill: 'ink2', align: 'right', baseline: 'middle', size: 10 });
    });
    ops.push({ op: 'clip', x: pb.x, y: pb.y, w: pb.w, h: pb.h });
    for (let ri = results.length - 1; ri >= 0; ri--) {
      const r = results[ri];
      if (!r) continue;
      const isB = ri > 0;
      const tEnd = timeBounds(r)[1];
      const evs = r.events || [];
      rows.forEach(function (row, rowi) {
        const yc = pb.y + rowi * EVENT_ROW_H + EVENT_ROW_H / 2 + (isB ? 3 : 0);
        if (row.span) {
          eventSpans(evs, row.span.on, row.span.off, tEnd).forEach(function (s) {
            const x0 = Math.max(pb.x, sx(s.t0)), x1 = Math.min(pb.x + pb.w, sx(s.t1));
            if (x1 < pb.x || x0 > pb.x + pb.w) return;
            ops.push({ op: 'rect', x: x0, y: yc - (isB ? 2 : 4), w: Math.max(2, x1 - x0), h: isB ? 3 : 8, fill: row.span.color, alpha: isB ? 0.4 : 0.85 });
            if (!isB) hits.push({ x0: x0, x1: Math.max(x0 + 2, x1), row: row.id, ev: s.ev, t0: s.t0, t1: s.t1 });
          });
          return;
        }
        const seen = {};
        evs.forEach(function (e) {
          const rr = eventRowOf(e.kind);
          if ((rr ? rr.id : 'other') !== row.id) return;
          if (e.t < view.t0 || e.t > view.t1) return;
          const x = sx(e.t);
          const col = Math.round(x) + '|' + e.kind;
          if (!isB) hits.push({ x0: x - 3, x1: x + 3, row: row.id, ev: e });
          if (seen[col]) return;
          seen[col] = true;
          const k = (row.kinds && row.kinds[e.kind]) || { shape: 'circle', color: 'muted' };
          ops.push({ op: 'marker', x: x, y: yc, shape: k.shape, size: (k.size || 4) * (isB ? 0.7 : 1), fill: k.color, alpha: isB ? 0.4 : 1 });
        });
      });
    }
    ops.push({ op: 'unclip' });
    ops.push({ op: 'rect', x: pb.x, y: pb.y, w: pb.w, h: pb.h, stroke: 'axis', width: 1 });
    if (opts.cursorT !== undefined && opts.cursorT >= view.t0 && opts.cursorT <= view.t1) {
      const x = sx(opts.cursorT);
      ops.push({ op: 'line', x1: x, y1: pb.y, x2: x, y2: pb.y + pb.h, stroke: 'ink', width: 1.5 });
    }
    return { ops: ops, sx: sx, pb: pb, rows: rows, hits: hits };
  }

  // ---------------------------------------------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------------------------------------------
  function resolveColor(theme, role) {
    if (!role) return 'transparent';
    if (role.charAt(0) === '#' || role.indexOf('rgb') === 0) return role;
    const m = /^(seq|seqtxt)(\d+)$/.exec(role);
    if (m) return (theme[m[1]] || THEMES.light[m[1]])[+m[2]];
    return theme[role] || role;
  }

  function markerPath(ctx, shape, x, y, s) {
    ctx.beginPath();
    switch (shape) {
      case 'tick': ctx.moveTo(x, y - s - 1); ctx.lineTo(x, y + s + 1); break;
      case 'cross': ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); break;
      case 'tri': ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath(); break;
      case 'tridown': ctx.moveTo(x, y + s); ctx.lineTo(x + s, y - s); ctx.lineTo(x - s, y - s); ctx.closePath(); break;
      case 'diamond': ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); break;
      case 'square': ctx.rect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6); break;
      default: ctx.arc(x, y, s * 0.9, 0, Math.PI * 2);
    }
  }

  function renderCanvas(ctx, ops, theme) {
    ctx.save();
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      ctx.globalAlpha = o.alpha !== undefined ? o.alpha : 1;
      switch (o.op) {
        case 'rect':
          if (o.fill) { ctx.fillStyle = resolveColor(theme, o.fill); ctx.fillRect(o.x, o.y, o.w, o.h); }
          if (o.stroke) { ctx.strokeStyle = resolveColor(theme, o.stroke); ctx.lineWidth = o.width || 1; ctx.setLineDash([]); ctx.strokeRect(Math.round(o.x) + 0.5, Math.round(o.y) + 0.5, Math.round(o.w) - 1, Math.round(o.h) - 1); }
          break;
        case 'line':
          ctx.strokeStyle = resolveColor(theme, o.stroke); ctx.lineWidth = o.width || 1; ctx.setLineDash(o.dash || []);
          ctx.beginPath();
          if (o.x1 === o.x2) { ctx.moveTo(Math.round(o.x1) + 0.5, o.y1); ctx.lineTo(Math.round(o.x2) + 0.5, o.y2); }
          else if (o.y1 === o.y2) { ctx.moveTo(o.x1, Math.round(o.y1) + 0.5); ctx.lineTo(o.x2, Math.round(o.y2) + 0.5); }
          else { ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); }
          ctx.stroke();
          break;
        case 'path': {
          ctx.strokeStyle = resolveColor(theme, o.stroke); ctx.lineWidth = o.width || 1; ctx.setLineDash(o.dash || []);
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.beginPath();
          let pen = false;
          for (let k = 0; k < o.pts.length; k += 2) {
            const x = o.pts[k], y = o.pts[k + 1];
            if (isNaN(x) || isNaN(y)) { pen = false; continue; }
            if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
          }
          ctx.stroke();
          break;
        }
        case 'dots':
          ctx.fillStyle = resolveColor(theme, o.fill);
          for (let k = 0; k < o.pts.length; k += 2) { ctx.beginPath(); ctx.arc(o.pts[k], o.pts[k + 1], o.r, 0, Math.PI * 2); ctx.fill(); }
          break;
        case 'marker':
          markerPath(ctx, o.shape, o.x, o.y, o.size);
          ctx.setLineDash([]);
          if (o.shape === 'tick' || o.shape === 'cross') { ctx.strokeStyle = resolveColor(theme, o.fill); ctx.lineWidth = 1.75; ctx.stroke(); }
          else { ctx.fillStyle = resolveColor(theme, o.fill); ctx.fill(); ctx.strokeStyle = resolveColor(theme, 'surface'); ctx.lineWidth = 1; ctx.stroke(); }
          break;
        case 'text':
          ctx.font = (o.weight || 400) + ' ' + (o.size || 11) + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
          ctx.textAlign = o.align || 'left';
          ctx.textBaseline = o.baseline || 'alphabetic';
          if (o.halo) { ctx.strokeStyle = resolveColor(theme, 'surface'); ctx.lineWidth = 3; ctx.setLineDash([]); ctx.strokeText(o.text, o.x, o.y); }
          ctx.fillStyle = resolveColor(theme, o.fill || 'ink');
          ctx.fillText(o.text, o.x, o.y);
          break;
        case 'clip':
          ctx.save(); ctx.beginPath(); ctx.rect(o.x, o.y, o.w, o.h); ctx.clip();
          break;
        case 'unclip':
          ctx.restore();
          break;
      }
    }
    ctx.restore();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function svgColor(role) {
    if (!role) return 'none';
    if (role.charAt(0) === '#' || role.indexOf('rgb') === 0) return role;
    return 'var(--su2-' + role + ')';
  }
  function r1(v) { return Math.round(v * 10) / 10; }

  function svgMarker(o) {
    const x = o.x, y = o.y, s = o.size;
    const c = svgColor(o.fill);
    const a = o.alpha !== undefined ? ' opacity="' + o.alpha + '"' : '';
    switch (o.shape) {
      case 'tick': return '<line x1="' + r1(x) + '" y1="' + r1(y - s - 1) + '" x2="' + r1(x) + '" y2="' + r1(y + s + 1) + '" style="stroke:' + c + '" stroke-width="1.75"' + a + '/>';
      case 'cross': return '<path d="M' + r1(x - s) + ' ' + r1(y - s) + 'L' + r1(x + s) + ' ' + r1(y + s) + 'M' + r1(x + s) + ' ' + r1(y - s) + 'L' + r1(x - s) + ' ' + r1(y + s) + '" style="stroke:' + c + '" stroke-width="1.75" fill="none"' + a + '/>';
      case 'tri': return '<path d="M' + r1(x) + ' ' + r1(y - s) + 'L' + r1(x + s) + ' ' + r1(y + s) + 'L' + r1(x - s) + ' ' + r1(y + s) + 'Z" style="fill:' + c + '"' + a + '/>';
      case 'tridown': return '<path d="M' + r1(x) + ' ' + r1(y + s) + 'L' + r1(x + s) + ' ' + r1(y - s) + 'L' + r1(x - s) + ' ' + r1(y - s) + 'Z" style="fill:' + c + '"' + a + '/>';
      case 'diamond': return '<path d="M' + r1(x) + ' ' + r1(y - s) + 'L' + r1(x + s) + ' ' + r1(y) + 'L' + r1(x) + ' ' + r1(y + s) + 'L' + r1(x - s) + ' ' + r1(y) + 'Z" style="fill:' + c + '"' + a + '/>';
      case 'square': return '<rect x="' + r1(x - s * 0.8) + '" y="' + r1(y - s * 0.8) + '" width="' + r1(s * 1.6) + '" height="' + r1(s * 1.6) + '" style="fill:' + c + '"' + a + '/>';
      default: return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(s * 0.9) + '" style="fill:' + c + '"' + a + '/>';
    }
  }

  let clipSeq = 0;
  /** Draw ops -> an SVG element string (colours as var(--su2-*), so the host page's CSS themes it). */
  function renderSvg(ops, width, height, title) {
    const out = [];
    const clips = [];
    let depth = 0;
    out.push('<svg xmlns="http://www.w3.org/2000/svg" class="su2-svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img"' + (title ? ' aria-label="' + esc(title) + '"' : '') + ' font-family="system-ui, -apple-system, Segoe UI, sans-serif">');
    if (title) out.push('<title>' + esc(title) + '</title>');
    ops.forEach(function (o) {
      const a = o.alpha !== undefined && o.alpha !== 1 ? ' opacity="' + o.alpha + '"' : '';
      const dash = o.dash && o.dash.length ? ' stroke-dasharray="' + o.dash.join(' ') + '"' : '';
      switch (o.op) {
        case 'rect':
          out.push('<rect x="' + r1(o.x) + '" y="' + r1(o.y) + '" width="' + r1(o.w) + '" height="' + r1(o.h) + '" style="fill:' + (o.fill ? svgColor(o.fill) : 'none') + (o.stroke ? ';stroke:' + svgColor(o.stroke) : '') + '"' + (o.stroke ? ' stroke-width="' + (o.width || 1) + '"' : '') + a + '/>');
          break;
        case 'line':
          out.push('<line x1="' + r1(o.x1) + '" y1="' + r1(o.y1) + '" x2="' + r1(o.x2) + '" y2="' + r1(o.y2) + '" style="stroke:' + svgColor(o.stroke) + '" stroke-width="' + (o.width || 1) + '"' + dash + a + '/>');
          break;
        case 'path': {
          let d = '', pen = false;
          for (let k = 0; k < o.pts.length; k += 2) {
            const x = o.pts[k], y = o.pts[k + 1];
            if (isNaN(x) || isNaN(y)) { pen = false; continue; }
            d += (pen ? 'L' : 'M') + r1(x) + ' ' + r1(y);
            pen = true;
          }
          if (d) out.push('<path d="' + d + '" fill="none" style="stroke:' + svgColor(o.stroke) + '" stroke-width="' + (o.width || 1) + '" stroke-linejoin="round" stroke-linecap="round"' + dash + a + '/>');
          break;
        }
        case 'dots': {
          const parts = [];
          for (let k = 0; k < o.pts.length; k += 2) parts.push('<circle cx="' + r1(o.pts[k]) + '" cy="' + r1(o.pts[k + 1]) + '" r="' + o.r + '"/>');
          if (parts.length) out.push('<g style="fill:' + svgColor(o.fill) + '"' + a + '>' + parts.join('') + '</g>');
          break;
        }
        case 'marker': out.push(svgMarker(o)); break;
        case 'text': {
          const anchor = o.align === 'right' ? 'end' : o.align === 'center' ? 'middle' : 'start';
          const base = o.baseline === 'top' ? 'hanging' : o.baseline === 'middle' ? 'central' : o.baseline === 'bottom' ? 'text-after-edge' : 'auto';
          const halo = o.halo ? ' paint-order="stroke" style="fill:' + svgColor(o.fill || 'ink') + ';stroke:' + svgColor('surface') + '" stroke-width="3"' : ' style="fill:' + svgColor(o.fill || 'ink') + '"';
          out.push('<text x="' + r1(o.x) + '" y="' + r1(o.y) + '" font-size="' + (o.size || 11) + '"' + (o.weight ? ' font-weight="' + o.weight + '"' : '') + ' text-anchor="' + anchor + '" dominant-baseline="' + base + '"' + halo + '>' + esc(o.text) + '</text>');
          break;
        }
        case 'clip': {
          const id = 'su2c' + (++clipSeq);
          clips.push('<clipPath id="' + id + '"><rect x="' + r1(o.x) + '" y="' + r1(o.y) + '" width="' + r1(o.w) + '" height="' + r1(o.h) + '"/></clipPath>');
          out.push('<g clip-path="url(#' + id + ')">');
          depth++;
          break;
        }
        case 'unclip':
          if (depth > 0) { out.push('</g>'); depth--; }
          break;
      }
    });
    while (depth-- > 0) out.push('</g>');
    if (clips.length) out.splice(title ? 2 : 1, 0, '<defs>' + clips.join('') + '</defs>');
    out.push('</svg>');
    return out.join('');
  }

  /** The whole chart stack of a result as one SVG string (the report's static charts). */
  function chartsSvg(resultA, resultB, opts) {
    opts = opts || {};
    const width = opts.width || 760;
    const ph = opts.panelHeight || 130;
    const config = opts.config || (resultA && resultA.meta && resultA.meta.config) || {};
    const results = [resultA, resultB || null];
    const panels = resolvePanels(resultA, config, { panels: opts.panels, modules: opts.modules });
    const bounds = timeBounds(resultA);
    const view = opts.view || { t0: bounds[0], t1: bounds[1] };
    const tA = getT(resultA);
    const warnArr = getSeries(resultA, 'warn');
    const warnSpans = warnArr ? spans(tA, warnArr, function (v) { return v > 0; }, bounds[1]) : [];
    const collisions = (resultA && resultA.events || []).filter(function (e) { return e.kind === 'collision'; }).map(function (e) { return e.t; });
    const ops = [];
    let y = 0;
    const legends = [];
    panels.forEach(function (p, i) {
      const last = i === panels.length - 1;
      const titleH = 18;
      ops.push({ op: 'text', x: 4, y: y + 13, text: p.title, fill: 'ink', size: 12, weight: 600 });
      if (!p.events) {
        let lx = 4 + p.title.length * 7 + 14;
        p.series.forEach(function (s) {
          if (!s.visible) return;
          ops.push({ op: 'line', x1: lx, y1: y + 9, x2: lx + 14, y2: y + 9, stroke: s.color, width: s.dots ? 3 : s.w, dash: s.dash });
          ops.push({ op: 'text', x: lx + 18, y: y + 13, text: s.label, fill: 'ink2', size: 10 });
          lx += 18 + s.label.length * 5.6 + 12;
        });
      }
      y += titleH;
      const h = p.events ? eventLaneHeight(results) : ph;
      const box = { x: 0, y: y, w: width, h: h };
      const lay = p.events
        ? layoutEvents(results, { box: box, view: view, xLabels: true })
        : layoutPanel(p, results, { box: box, view: view, warnSpans: warnSpans, collisions: collisions, xLabels: last || opts.xLabelsAll });
      Array.prototype.push.apply(ops, lay.ops);
      y += h + 6;
    });
    return renderSvg(ops, width, Math.ceil(y), opts.title || 'Time charts');
  }

  // ---------------------------------------------------------------------------------------------
  // The DOM view
  // ---------------------------------------------------------------------------------------------
  const STYLE_ID = 'su2-style';
  const VIEW_CSS = [
    '.su2 { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--su2-ink); }',
    '.su2 *, .su2 *::before, .su2 *::after { box-sizing: border-box; }',
    '.su2-toolbar { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin: 0 0 8px; }',
    '.su2-toolbar .su2-sep { width: 1px; align-self: stretch; background: var(--su2-grid); }',
    '.su2 button, .su2 select, .su2 input { font: inherit; color: var(--su2-ink); }',
    '.su2 button { background: var(--su2-surface); border: 1px solid var(--su2-axis); border-radius: 6px; padding: 2px 9px; cursor: pointer; min-height: 26px; }',
    '.su2 button:hover { border-color: var(--su2-muted); }',
    '.su2 button:disabled { opacity: .5; cursor: default; }',
    '.su2 button.su2-primary { background: var(--su2-s0); color: #fff; border-color: var(--su2-s0); }',
    '.su2 button[aria-pressed="true"] { background: var(--su2-brush); border-color: var(--su2-s0); }',
    '.su2 select, .su2 input[type="number"], .su2 input[type="text"] { background: var(--su2-surface); border: 1px solid var(--su2-axis); border-radius: 5px; padding: 2px 5px; min-height: 26px; }',
    '.su2-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--su2-ink2); cursor: pointer; user-select: none; }',
    '.su2-note { font-size: 12px; color: var(--su2-ink2); }',
    '.su2-banner { display: inline-block; font-size: 12px; padding: 2px 8px; border-radius: 4px; border: 1px solid var(--su2-s3); color: var(--su2-ink); background: transparent; }',
    '.su2-banner::before { content: "⚠ "; color: var(--su2-s3); }',
    '.su2-panel { position: relative; margin: 0 0 6px; background: var(--su2-surface); border: 1px solid var(--su2-border); border-radius: 6px; padding: 4px 4px 0; }',
    '.su2-panel-head { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; padding: 0 4px 2px; }',
    '.su2-panel-title { font-weight: 600; font-size: 12px; }',
    '.su2-leg { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--su2-ink2); cursor: pointer; border: 0; background: none; padding: 0; min-height: 0; }',
    '.su2-leg[aria-pressed="false"] { opacity: .45; text-decoration: line-through; }',
    '.su2-leg svg { flex: none; }',
    '.su2-canvas-wrap { position: relative; }',
    '.su2-canvas-wrap canvas { display: block; width: 100%; }',
    '.su2-canvas-wrap canvas.su2-overlay { position: absolute; left: 0; top: 0; cursor: crosshair; touch-action: none; }',
    '.su2-tip { position: fixed; z-index: 50; pointer-events: none; background: var(--su2-surface); color: var(--su2-ink); border: 1px solid var(--su2-axis); border-radius: 6px; padding: 6px 8px; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.18); max-width: 360px; }',
    '.su2-tip table { border-collapse: collapse; }',
    '.su2-tip td { padding: 0 6px 0 0; white-space: nowrap; font-variant-numeric: tabular-nums; }',
    '.su2-tip td.su2-num { text-align: right; }',
    '.su2-sw { display: inline-block; width: 10px; height: 3px; border-radius: 2px; vertical-align: middle; }',
    '.su2-empty { padding: 24px; text-align: center; color: var(--su2-ink2); border: 1px dashed var(--su2-axis); border-radius: 6px; }',
    '.su2 table.su2-table { border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }',
    '.su2 table.su2-table th, .su2 table.su2-table td { padding: 3px 8px; border-bottom: 1px solid var(--su2-grid); text-align: left; white-space: nowrap; }',
    '.su2 table.su2-table td.su2-num, .su2 table.su2-table th.su2-num { text-align: right; }',
    '.su2 details > summary { cursor: pointer; color: var(--su2-ink2); font-size: 12px; margin: 6px 0; }',
    '.su2 .su2-better { color: var(--su2-s0); } .su2 .su2-worse { color: var(--su2-s1); }',
  ].join('\n');

  /** Inject the shared CSS once (each SU2 view calls it; later views append their own rules). */
  function ensureStyle(doc, extraId, extraCss) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    if (!doc.getElementById(STYLE_ID)) {
      const st = doc.createElement('style');
      st.id = STYLE_ID;
      st.textContent = themeCss('.su2') + VIEW_CSS;
      doc.head.appendChild(st);
    }
    if (extraId && !doc.getElementById(extraId)) {
      const st2 = doc.createElement('style');
      st2.id = extraId;
      st2.textContent = extraCss;
      doc.head.appendChild(st2);
    }
  }

  /** The live theme of an element: --su2-* custom properties resolved to colours. */
  function readTheme(el) {
    const cs = getComputedStyle(el);
    const th = {};
    ROLES.forEach(function (r) { th[r] = cs.getPropertyValue('--su2-' + r).trim() || THEMES.light[r]; });
    th.seq = THEMES.light.seq.map(function (c, i) { return cs.getPropertyValue('--su2-seq' + i).trim() || c; });
    th.seqtxt = THEMES.light.seqtxt.map(function (c, i) { return cs.getPropertyValue('--su2-seqtxt' + i).trim() || c; });
    return th;
  }

  /** Call fn when the light / dark theme changes (OS or data-theme). Returns an unsubscribe. */
  function onThemeChange(fn) {
    const offs = [];
    if (typeof matchMedia !== 'undefined') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const h = function () { fn(); };
      if (mq.addEventListener) { mq.addEventListener('change', h); offs.push(function () { mq.removeEventListener('change', h); }); }
    }
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      const mo = new MutationObserver(function () { fn(); });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
      offs.push(function () { mo.disconnect(); });
    }
    return function () { offs.forEach(function (o) { o(); }); };
  }

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  /** Subscribe to app events; returns an unsubscribe (uses app.off when the shell offers it). */
  function listen(app, evt, fn) {
    if (!app || typeof app.on !== 'function') return function () {};
    const ret = app.on(evt, fn);
    let alive = true;
    return function () {
      if (!alive) return;
      alive = false;
      if (typeof ret === 'function') ret();
      else if (typeof app.off === 'function') app.off(evt, fn);
    };
  }

  /** Move the shell's scrubber. */
  function setCursor(app, t) {
    if (typeof app.setCursor === 'function') app.setCursor(t);
    else if (typeof app.seek === 'function') app.seek(t);
    else app.cursorT = t;
  }

  /** "assumed plant: <preset>" text of a result, or '' when the plant was identified. */
  function plantBanner(result) {
    const p = result && result.meta && result.meta.plant;
    if (!p) return '';
    if (p.assumed === false) return '';
    return 'Assumed plant: ' + (p.name || 'unnamed') + ' — results are not a verdict';
  }

  function legendSwatch(s) {
    const w = 18, hh = 8;
    const dash = s.dots ? '1 3' : (s.dash ? s.dash.join(' ') : '');
    return '<svg width="' + w + '" height="' + hh + '" aria-hidden="true"><line x1="1" y1="4" x2="' + (w - 1) + '" y2="4" style="stroke:' + svgColor(s.color) + '" stroke-width="' + (s.dots ? 3 : Math.max(1.5, s.w || 1.5)) + '" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/></svg>';
  }

  function readFileJson(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { try { resolve(JSON.parse(fr.result)); } catch (e) { reject(e); } };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file);
    });
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept || '.json,application/json';
      inp.onchange = function () { resolve(inp.files && inp.files[0] ? inp.files[0] : null); };
      inp.click();
    });
  }

  function downloadText(name, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /** Metrics of A and B side by side (B - A), for the A/B table. */
  function compareMetrics(a, b) {
    const ma = (a && a.metrics) || {}, mb = (b && b.metrics) || {};
    const names = Object.keys(ma).concat(Object.keys(mb).filter(function (k) { return !(k in ma); }));
    return names.map(function (n) {
      const va = ma[n], vb = mb[n];
      const d = typeof va === 'number' && typeof vb === 'number' && isFinite(va) && isFinite(vb) ? vb - va : null;
      return { name: n, a: va, b: vb, diff: d, failedA: !!(a && a.verdict && (a.verdict.failed || []).indexOf(n) >= 0), failedB: !!(b && b.verdict && (b.verdict.failed || []).indexOf(n) >= 0) };
    });
  }

  function mount(el, app) {
    ensureStyle(el.ownerDocument);
    el.classList.add('su2', 'su2-charts');
    el.innerHTML = '';
    const state = {
      view: null,          // { t0, t1 }
      bounds: [0, 1],
      hidden: {},          // 'panel/series' -> true
      panelsOn: { speed: true, gap: true, timegap: true, ttc: true, accel: true, events: true },
      follow: true,
      B: null,
      bLabel: '',
      hover: null,         // { panelId, x, y }
      brush: null,         // { panelId, x0, x1 }
      lastResult: null,
    };
    let theme = THEMES.light;
    const panelEls = {};  // id -> { wrap, base, over, layout, panel }
    const tip = h('div', { class: 'su2-tip', hidden: true });
    document.body.appendChild(tip);

    // toolbar
    const panelChips = h('span', { class: 'su2-chips' });
    PANELS.forEach(function (p) {
      const cb = h('input', { type: 'checkbox', checked: true, onchange: function () { state.panelsOn[p.id] = cb.checked; rebuild(); } });
      panelChips.appendChild(h('label', { class: 'su2-chip' }, [cb, p.title]));
      panelChips.appendChild(document.createTextNode(' '));
    });
    const followBtn = h('button', { type: 'button', 'aria-pressed': 'true', title: 'Keep the cursor in view during playback', onclick: function () { state.follow = !state.follow; followBtn.setAttribute('aria-pressed', String(state.follow)); } }, ['Follow cursor']);
    const bInfo = h('span', { class: 'su2-note' });
    const clearB = h('button', { type: 'button', disabled: true, onclick: function () { state.B = null; state.bLabel = ''; refreshB(); rebuild(); } }, ['Clear B']);
    const toolbar = h('div', { class: 'su2-toolbar' }, [
      panelChips,
      h('span', { class: 'su2-sep' }),
      h('button', { type: 'button', title: 'Zoom in (or wheel over a chart)', onclick: function () { zoomBy(0.5); } }, ['+']),
      h('button', { type: 'button', title: 'Zoom out', onclick: function () { zoomBy(2); } }, ['−']),
      h('button', { type: 'button', title: 'Whole run (or double-click a chart)', onclick: function () { fit(); } }, ['Fit']),
      followBtn,
      h('span', { class: 'su2-sep' }),
      h('button', { type: 'button', title: 'Keep the current run as B and overlay it under the next runs', onclick: pinB }, ['Pin as B']),
      h('button', { type: 'button', title: 'Load a result JSON as B', onclick: loadB }, ['Load B…']),
      clearB,
      bInfo,
    ]);
    const banner = h('div', { class: 'su2-note', style: { margin: '0 0 6px' } });
    const help = h('div', { class: 'su2-note', style: { margin: '0 0 6px' } }, ['Click or drag: move the cursor · wheel: zoom · shift-wheel or horizontal scroll: pan · shift-drag: zoom to a range · double-click: whole run · click a legend item to hide it.']);
    const stack = h('div', { class: 'su2-stack' });
    const abBox = h('details', { class: 'su2-ab' });
    el.appendChild(toolbar);
    el.appendChild(banner);
    el.appendChild(help);
    el.appendChild(stack);
    el.appendChild(abBox);

    function results() { return [app.result || null, state.B]; }

    function pinB() {
      if (!app.result) return;
      state.B = app.result;
      const m = app.result.meta || {};
      state.bLabel = 'B = ' + ((m.config && m.config.scenario && (m.config.scenario.id || (m.config.scenario.inline && m.config.scenario.inline.id))) || 'run') + (m.config && m.config.ego && m.config.ego.mode && m.config.ego.mode !== 'ours' ? ' (' + m.config.ego.mode + ')' : '') + ', pinned';
      refreshB();
      rebuild();
    }
    function loadB() {
      pickFile().then(function (f) {
        if (!f) return;
        return readFileJson(f).then(function (j) {
          if (!j || !j.t || !j.series) throw new Error('not a run result (needs t and series)');
          state.B = j;
          state.bLabel = 'B = ' + f.name;
          refreshB();
          rebuild();
        });
      }).catch(function (e) { bInfo.textContent = 'Could not load B: ' + e.message; });
    }
    function refreshB() {
      bInfo.textContent = state.B ? state.bLabel + ' (drawn faint under A)' : 'A only';
      clearB.disabled = !state.B;
      renderAB();
    }

    function renderAB() {
      abBox.innerHTML = '';
      if (!state.B || !app.result) { abBox.hidden = true; return; }
      abBox.hidden = false;
      abBox.appendChild(h('summary', null, ['Metrics, A against B']));
      const rows = compareMetrics(app.result, state.B);
      const tb = h('table', { class: 'su2-table' });
      tb.appendChild(h('tr', null, [h('th', { text: 'Metric' }), h('th', { class: 'su2-num', text: 'A' }), h('th', { class: 'su2-num', text: 'B' }), h('th', { class: 'su2-num', text: 'B − A' })]));
      rows.forEach(function (r) {
        tb.appendChild(h('tr', null, [
          h('td', { text: r.name }),
          h('td', { class: 'su2-num', text: fmt(r.a) + (r.failedA ? ' ✗' : '') }),
          h('td', { class: 'su2-num', text: fmt(r.b) + (r.failedB ? ' ✗' : '') }),
          h('td', { class: 'su2-num', text: r.diff === null ? '' : (r.diff > 0 ? '+' : '') + fmt(r.diff) }),
        ]));
      });
      abBox.appendChild(tb);
    }

    function zoomBy(f, centre) {
      if (!state.view) return;
      state.view = zoomView(state.view, f, centre, state.bounds);
      drawAll();
    }
    function fit() {
      state.view = { t0: state.bounds[0], t1: state.bounds[1] };
      drawAll();
    }

    function rebuild() {
      stack.innerHTML = '';
      Object.keys(panelEls).forEach(function (k) { delete panelEls[k]; });
      const r = app.result;
      banner.innerHTML = '';
      if (!r) {
        stack.appendChild(h('div', { class: 'su2-empty' }, ['No run yet. Run a scenario and its time charts appear here.']));
        return;
      }
      const bt = plantBanner(r);
      if (bt) banner.appendChild(h('span', { class: 'su2-banner', text: bt }));
      const panels = resolvePanels(r, app.config || (r.meta && r.meta.config), { hidden: state.hidden, panels: Object.keys(state.panelsOn).filter(function (k) { return state.panelsOn[k]; }) });
      panels.forEach(function (p) {
        const head = h('div', { class: 'su2-panel-head' }, [h('span', { class: 'su2-panel-title', text: p.title })]);
        if (!p.events) {
          p.series.forEach(function (s) {
            const b = h('button', { type: 'button', class: 'su2-leg', 'aria-pressed': String(s.visible), title: s.name, html: legendSwatch(s) + esc(s.label) });
            b.addEventListener('click', function () { state.hidden[s.key] = s.visible; s.visible = !s.visible; b.setAttribute('aria-pressed', String(s.visible)); drawAll(); });
            head.appendChild(b);
          });
        } else {
          head.appendChild(h('span', { class: 'su2-note', text: 'markers: ▲ acquired/override/resume · ◆ change · ● applied/react · ✕ dropped/rejected/collision · bars: warning, fault' }));
        }
        const base = h('canvas');
        const over = h('canvas', { class: 'su2-overlay' });
        const wrap = h('div', { class: 'su2-canvas-wrap' }, [base, over]);
        const pe = h('div', { class: 'su2-panel', 'data-panel': p.id }, [head, wrap]);
        stack.appendChild(pe);
        panelEls[p.id] = { el: pe, wrap: wrap, base: base, over: over, panel: p, layout: null };
        attachPointer(p.id, over);
      });
      drawAll();
    }

    function sizeCanvas(cv, w, hh) {
      const dpr = (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(hh * dpr);
        cv.style.height = hh + 'px';
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }

    let rafBase = 0, rafOver = 0;
    function drawAll() {
      if (rafBase) return;
      rafBase = requestAnimationFrame(function () { rafBase = 0; drawBase(); drawOver(); });
    }
    function drawOverSoon() {
      if (rafOver || rafBase) return;
      rafOver = requestAnimationFrame(function () { rafOver = 0; drawOver(); });
    }

    function drawBase() {
      const r = app.result;
      if (!r || !state.view) return;
      theme = readTheme(el);
      const rs = results();
      const tA = getT(r);
      const warnArr = getSeries(r, 'warn');
      const warnSpans = warnArr ? spans(tA, warnArr, function (v) { return v > 0; }, state.bounds[1]) : [];
      const collisions = (r.events || []).filter(function (e) { return e.kind === 'collision'; }).map(function (e) { return e.t; });
      const ids = Object.keys(panelEls);
      ids.forEach(function (id, i) {
        const pe = panelEls[id];
        const w = Math.max(200, pe.wrap.clientWidth || el.clientWidth || 800);
        const hh = pe.panel.events ? eventLaneHeight(rs) : 140;
        const ctx = sizeCanvas(pe.base, w, hh);
        sizeCanvas(pe.over, w, hh);
        const box = { x: 0, y: 0, w: w, h: hh };
        const lay = pe.panel.events
          ? layoutEvents(rs, { box: box, view: state.view, xLabels: true })
          : layoutPanel(pe.panel, rs, { box: box, view: state.view, warnSpans: warnSpans, collisions: collisions, xLabels: i === ids.length - 1 });
        pe.layout = lay;
        ctx.clearRect(0, 0, w, hh);
        renderCanvas(ctx, lay.ops, theme);
      });
    }

    function drawOver() {
      const t = app.cursorT;
      Object.keys(panelEls).forEach(function (id) {
        const pe = panelEls[id];
        const lay = pe.layout;
        if (!lay) return;
        const ctx = pe.over.getContext('2d');
        const dpr = (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, pe.over.width / dpr, pe.over.height / dpr);
        const pb = lay.pb;
        const ops = [];
        if (state.brush && state.brush.panelId === id) {
          const x0 = Math.min(state.brush.x0, state.brush.x1), x1 = Math.max(state.brush.x0, state.brush.x1);
          ops.push({ op: 'rect', x: x0, y: pb.y, w: x1 - x0, h: pb.h, fill: 'brush' });
        }
        if (state.hover) {
          const x = state.hover.x;
          if (x >= pb.x && x <= pb.x + pb.w) ops.push({ op: 'line', x1: x, y1: pb.y, x2: x, y2: pb.y + pb.h, stroke: 'muted', width: 1, dash: [2, 3] });
        }
        if (t !== undefined && t !== null && t >= state.view.t0 && t <= state.view.t1) {
          const x = lay.sx(t);
          ops.push({ op: 'line', x1: x, y1: pb.y, x2: x, y2: pb.y + pb.h, stroke: 'ink', width: 1.5 });
          // value dots of A at the cursor
          if (!pe.panel.events && app.result) {
            const tA = getT(app.result);
            pe.panel.series.forEach(function (s) {
              if (!s.visible || s.dots) return;
              const v = valueAt(tA, getSeries(app.result, s.name), t, s.step) * pe.panel.k;
              if (isFinite(v) && v >= lay.dom[0] && v <= lay.dom[1]) ops.push({ op: 'marker', shape: 'circle', x: x, y: lay.sy(v), size: 3.5, fill: s.color });
            });
          }
        }
        renderCanvas(ctx, ops, theme);
      });
    }

    function tipHtml(id, x, y) {
      const pe = panelEls[id];
      const lay = pe.layout;
      const tt = lay.sx.invert(x);
      let rowsHtml = '';
      if (pe.panel.events) {
        const near = lay.hits.filter(function (hh) { return x >= hh.x0 - 2 && x <= hh.x1 + 2; });
        const rowIdx = Math.floor((y - lay.pb.y) / EVENT_ROW_H);
        const row = lay.rows[rowIdx];
        const list = near.filter(function (hh) { return !row || hh.row === row.id; }).slice(0, 8);
        if (!list.length) return '<b>t = ' + fmt(tt, 2) + ' s</b>';
        const enums = app.result && app.result.meta && app.result.meta.enums;
        rowsHtml = list.map(function (hh) {
          return '<tr><td class="su2-num">' + fmt(hh.ev.t, 2) + ' s' + (hh.t1 !== undefined ? '–' + fmt(hh.t1, 2) : '') + '</td><td>' + esc(eventText(hh.ev, enums)) + '</td></tr>';
        }).join('') + (near.length > list.length ? '<tr><td></td><td>… ' + (near.length - list.length) + ' more</td></tr>' : '');
        return '<b>Events</b><table>' + rowsHtml + '</table>';
      }
      const rA = app.result, rB = state.B;
      const tA = getT(rA), tB = rB ? getT(rB) : null;
      pe.panel.series.forEach(function (s) {
        if (!s.visible) return;
        const va = valueAt(tA, getSeries(rA, s.name), tt, s.step) * pe.panel.k;
        const vb = rB && getSeries(rB, s.name) ? valueAt(tB, getSeries(rB, s.name), tt, s.step) * pe.panel.k : NaN;
        rowsHtml += '<tr><td><span class="su2-sw" style="background:' + resolveColor(theme, s.color) + '"></span> ' + esc(s.label) + '</td><td class="su2-num">' + fmt(va) + '</td>' + (rB ? '<td class="su2-num" style="opacity:.7">B ' + fmt(vb) + '</td>' : '') + '</tr>';
      });
      return '<b>t = ' + fmt(tt, 2) + ' s</b> <span style="color:var(--su2-ink2)">(' + esc(pe.panel.unit) + ')</span><table>' + rowsHtml + '</table>';
    }

    function attachPointer(id, cv) {
      let drag = null;
      function local(e) { const rc = cv.getBoundingClientRect(); return { x: e.clientX - rc.left, y: e.clientY - rc.top }; }
      function tAt(x) { const lay = panelEls[id] && panelEls[id].layout; if (!lay) return NaN; const pb = lay.pb; return lay.sx.invert(Math.max(pb.x, Math.min(pb.x + pb.w, x))); }
      cv.addEventListener('pointerdown', function (e) {
        const p = local(e);
        cv.setPointerCapture(e.pointerId);
        if (e.shiftKey) { drag = 'brush'; state.brush = { panelId: id, x0: p.x, x1: p.x }; }
        else { drag = 'scrub'; setCursor(app, tAt(p.x)); }
        drawOverSoon();
      });
      cv.addEventListener('pointermove', function (e) {
        const p = local(e);
        state.hover = { panelId: id, x: p.x, y: p.y };
        if (drag === 'scrub') setCursor(app, tAt(p.x));
        else if (drag === 'brush') state.brush.x1 = p.x;
        if (panelEls[id] && panelEls[id].layout) {
          tip.innerHTML = tipHtml(id, p.x, p.y);
          tip.hidden = false;
          const tx = e.clientX + 14, ty = e.clientY + 12;
          tip.style.left = Math.min(tx, window.innerWidth - tip.offsetWidth - 8) + 'px';
          tip.style.top = Math.min(ty, window.innerHeight - tip.offsetHeight - 8) + 'px';
        }
        drawOverSoon();
      });
      cv.addEventListener('pointerup', function (e) {
        if (drag === 'brush' && state.brush) {
          const a = tAt(Math.min(state.brush.x0, state.brush.x1)), b = tAt(Math.max(state.brush.x0, state.brush.x1));
          state.brush = null;
          if (b - a > 0.05) { state.view = clampView({ t0: a, t1: b }, state.bounds); drawAll(); }
        }
        drag = null;
        drawOverSoon();
      });
      cv.addEventListener('pointerleave', function () { state.hover = null; tip.hidden = true; drawOverSoon(); });
      cv.addEventListener('dblclick', function () { fit(); });
      cv.addEventListener('wheel', function (e) {
        if (!state.view) return;
        e.preventDefault();
        const lay = panelEls[id].layout;
        const span = state.view.t1 - state.view.t0;
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / lay.pb.w * span;
          state.view = panView(state.view, d, state.bounds);
        } else {
          state.view = zoomView(state.view, Math.exp(e.deltaY * 0.002), tAt(local(e).x), state.bounds);
        }
        drawAll();
      }, { passive: false });
    }

    function onResult() {
      const r = app.result;
      const nb = timeBounds(r);
      const sameLen = state.view && Math.abs(nb[1] - state.bounds[1]) < 1e-6 && Math.abs(nb[0] - state.bounds[0]) < 1e-6;
      state.bounds = nb;
      if (!sameLen || !state.view) state.view = { t0: nb[0], t1: nb[1] };
      state.lastResult = r;
      rebuild();
      renderAB();
    }
    function onCursor() {
      const t = app.cursorT;
      if (state.follow && state.view && t !== undefined && t !== null && isFinite(t)) {
        const nv = followView(state.view, t, state.bounds);
        if (nv !== state.view) { state.view = nv; drawAll(); return; }
      }
      drawOverSoon();
    }
    function onConfig() { if (app.result) rebuild(); }

    const offs = [
      listen(app, 'result', onResult),
      listen(app, 'cursor', onCursor),
      listen(app, 'config', onConfig),
      onThemeChange(function () { drawAll(); }),
    ];
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      ro = new ResizeObserver(function () { const w = el.clientWidth; if (w !== lastW) { lastW = w; drawAll(); } });
      ro.observe(el);
    }
    refreshB();
    if (app.result) onResult(); else rebuild();

    return {
      destroy: function () {
        offs.forEach(function (o) { o(); });
        if (ro) ro.disconnect();
        tip.remove();
        el.innerHTML = '';
      },
      setB: function (r, label) { state.B = r; state.bLabel = label || 'B'; refreshB(); rebuild(); },
      getView: function () { return state.view; },
      setView: function (v) { state.view = clampView(v, state.bounds); drawAll(); },
    };
  }

  const charts = {
    THEMES: THEMES, ROLES: ROLES, SEQ_N: SEQ_N, resolveColor: resolveColor, PANELS: PANELS, EVENT_ROWS: EVENT_ROWS, KEYS: KEYS, PAD: PAD,
    themeCss: themeCss, num: num, linear: linear, niceStep: niceStep, ticks: ticks, niceDomain: niceDomain, fmt: fmt,
    decimalsOf: decimalsOf, thrLabelSlots: thrLabelSlots, bisect: bisect, valueAt: valueAt, decimate: decimate,
    zoomView: zoomView, panView: panView, clampView: clampView, followView: followView, spans: spans,
    toF64: toF64, getT: getT, getSeries: getSeries, timeBounds: timeBounds,
    paramValue: paramValue, lookup: lookup, thresholdsFor: thresholdsFor,
    resolvePanels: resolvePanels, panelDomain: panelDomain, layoutPanel: layoutPanel, layoutEvents: layoutEvents,
    eventRowOf: eventRowOf, eventSpans: eventSpans, eventText: eventText, eventRowsPresent: eventRowsPresent,
    renderCanvas: renderCanvas, renderSvg: renderSvg, chartsSvg: chartsSvg, svgColor: svgColor, esc: esc,
    compareMetrics: compareMetrics, plantBanner: plantBanner,
    // DOM helpers shared with settings.js, batch.js, report-view.js
    ensureStyle: ensureStyle, readTheme: readTheme, onThemeChange: onThemeChange, h: h, listen: listen,
    setCursor: setCursor, readFileJson: readFileJson, pickFile: pickFile, downloadText: downloadText,
    mount: mount,
  };

  if (typeof module !== 'undefined') module.exports = charts; else (self.CS = self.CS || {})['charts'] = charts;
})();
