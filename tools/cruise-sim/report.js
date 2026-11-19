#!/usr/bin/env node
'use strict';
/*
 * The report (SC3): one self-contained HTML file (inline CSS and SVG, no script, nothing from the network) from the batch
 * results of sweep.js.
 *
 *   node tools/cruise-sim/report.js [<run dir> | <plan name>] ... [--out <file.html>] [--worst N] [--no-rerun]
 *
 * With no argument it takes the latest run of every plan in bake/work/cruise-sim/runs/ (the *.latest pointers). The worst
 * cases are re-run through core/sim.js (deterministic: the same config gives the same run) to draw their charts.
 * Output: bake/work/cruise-sim/reports/report-<stamp>.html (and report-latest.html).
 *
 * Wording rule (brief §0): while the plant is assumed nothing here is a verdict; every headline says "with an assumed plant".
 */
var fs = require('fs'), path = require('path');
var scenario = require('./core/scenario');
var metrics = require('./core/metrics');
var sweep = require('./sweep');

var RUNS = sweep.OUT_ROOT;
var REPORTS = path.join(__dirname, '..', '..', 'bake', 'work', 'cruise-sim', 'reports');

// What each swept number is on the car, and how the first drive measures it (parent brief phases).
var MEASURE = {
  'plant.aMin_ms2': { what: 'How hard the stock cruise (DCC) slows down on a set-speed drop', how: 'Phase 2: large downward set-speed steps (−10, −20 km/h) on a flat road and downhill; ego acceleration from the three sources', uk: 'Наскільки сильно штатний круїз гальмує при зниженні уставки' },
  'plant.brakeMax_ms2': { what: 'Whether the cruise uses the friction brakes at all, or only lifts off', how: 'Phase 2: the same steps; brake lamp / brake-pressure signal if one is found; deceleration beyond engine braking', uk: 'Чи круїз узагалі гальмує колодками, чи лише скидає газ' },
  'plant.deadTime_s': { what: 'Dead time from a set-speed change to the first change of acceleration', how: 'Phase 2: ±5 km/h steps by the stalk; the time from the cluster\'s set speed to the acceleration response', uk: 'Мертвий час від зміни уставки до зміни прискорення' },
  'plant.tau_s': { what: 'Time constant of the cruise\'s speed response', how: 'Phase 2: fit of the step responses', uk: 'Стала часу відповіді круїзу' },
  'plant.aMax_ms2': { what: 'How hard the cruise accelerates back up', how: 'Phase 2: large upward steps', uk: 'Наскільки сильно круїз розганяється' },
  'sensor.rateHz': { what: 'Native rate of GapVehicleAhead.DataFrontVehicle on the head unit', how: 'Phase 0 recorder: unthrottled, per-field sequence numbers; the measured rate and its jitter', uk: 'Власна частота DataFrontVehicle на головному пристрої' },
  'sensor.latency_s': { what: 'Latency of the gap from the camera to the app', how: 'Phase 1: cross-correlation of the gap derivative with the lead\'s brake lamps on video; ego speed vs acceleration sources', uk: 'Затримка дистанції від камери до застосунку' },
  'sensor.gapSd100_m': { what: 'Gap noise at long range (camera: grows with distance squared)', how: 'Phase 1: steady following at several gaps; the spread of gapX against the calibrated distance', uk: 'Шум дистанції на великій відстані' },
  'sensor.range_m': { what: 'The camera\'s working range for the lead', how: 'Phase 1: approaches from far; the gap at the first valid sample', uk: 'Робоча дальність камери' },
  'sensor.acqDelay_s': { what: 'Acquisition delay of a new target (cut-in)', how: 'Phase 1 scenario 5: cut-ins on video against the first change of the object id', uk: 'Затримка захоплення нової цілі (врізання)' },
  'command.delay_s': { what: 'Delay of the command path (a set speed written to the cruise)', how: 'Paper only in this phase: cannot be measured without writing to the car (separate decision)', uk: 'Затримка командного шляху (лише на папері в цій фазі)' },
  'command.jitter_s': { what: 'Jitter of the command path', how: 'Paper only in this phase', uk: 'Джитер командного шляху' },
  'controller.h': { what: 'Our time gap (a tuning choice, not a car number)', how: 'Simulation', uk: 'Наш часовий інтервал (налаштування)' },
  'controller.tau': { what: 'Our gap-closing time (tuning)', how: 'Simulation', uk: 'Наш час закриття розриву (налаштування)' },
  'controller.rateDown_kmhps': { what: 'Our downward rate limit (tuning)', how: 'Simulation', uk: 'Наш ліміт швидкості зниження уставки (налаштування)' },
  'warning.ttcWarn_s': { what: 'The warning\'s TTC threshold (tuning)', how: 'Simulation', uk: 'Поріг TTC попередження (налаштування)' }
};

// ------------------------------------------------------------------ loading
function resolveRunDir(arg) {
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) return arg;
  var p = path.join(RUNS, arg + '.latest');
  if (fs.existsSync(p)) return path.join(RUNS, fs.readFileSync(p, 'utf8').trim());
  if (fs.existsSync(path.join(RUNS, arg))) return path.join(RUNS, arg);
  throw new Error('no run folder or plan named ' + arg);
}
function latestAll() {
  if (!fs.existsSync(RUNS)) return [];
  return fs.readdirSync(RUNS).filter(function (f) { return /\.latest$/.test(f) && !/^smoke|^test/.test(f); }).sort()
    .map(function (f) { return path.join(RUNS, fs.readFileSync(path.join(RUNS, f), 'utf8').trim()); })
    .filter(function (d) { return fs.existsSync(path.join(d, 'batch.json')); });
}
function loadRun(dir) {
  var batch = JSON.parse(fs.readFileSync(path.join(dir, 'batch.json'), 'utf8'));
  var runs = [];
  var jl = path.join(dir, 'runs.jsonl');
  if (fs.existsSync(jl)) fs.readFileSync(jl, 'utf8').split('\n').forEach(function (l) { if (l) runs.push(JSON.parse(l)); });
  else runs = batch.runs || [];
  return { dir: dir, name: batch.plan.name, plan: batch.plan, summary: batch.summary, runs: runs, created: batch.created, plant: batch.plant };
}

// ------------------------------------------------------------------ html helpers
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function pct(x) { return x === null || x === undefined ? '–' : Math.round(100 * x) + ' %'; }
function num(x, d) { return x === null || x === undefined || typeof x !== 'number' ? (x === true ? 'yes' : x === false ? 'no' : '–') : (Math.round(x * Math.pow(10, d === undefined ? 2 : d)) / Math.pow(10, d === undefined ? 2 : d)).toString(); }
function shade(x) {
  // pass share -> a sequential blue (light = low); text colour flips on dark cells
  if (x === null || x === undefined) return { bg: 'var(--cell-na)', fg: 'var(--fg-muted)' };
  var l = 92 - 62 * x;
  return { bg: 'hsl(212, 70%, ' + l.toFixed(0) + '%)', fg: l < 55 ? '#fff' : '#0b1b33' };
}

function heatmap(map, title) {
  var cw = 64, ch = 34, left = 78, top = 26, W = left + cw * map.xs.length + 12, H = top + ch * map.ys.length + 44;
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" role="img" aria-label="' + esc(title) + '">';
  map.ys.forEach(function (y, j) {
    var yy = top + ch * (map.ys.length - 1 - j);
    s += '<text x="' + (left - 8) + '" y="' + (yy + ch / 2 + 4) + '" text-anchor="end" class="ax">' + esc(y) + '</text>';
    map.xs.forEach(function (x, i) {
      var v = map.cells[j][i], c = shade(v), xx = left + cw * i;
      s += '<rect x="' + xx + '" y="' + yy + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" rx="3" fill="' + c.bg + '"><title>' +
        esc(map.x + '=' + x + ', ' + map.y + '=' + y + ': ' + pct(v)) + '</title></rect>';
      s += '<text x="' + (xx + cw / 2 - 1) + '" y="' + (yy + ch / 2 + 4) + '" text-anchor="middle" class="cell" fill="' + c.fg + '">' + (v === null ? '' : Math.round(100 * v)) + '</text>';
    });
  });
  map.xs.forEach(function (x, i) {
    s += '<text x="' + (left + cw * i + cw / 2 - 1) + '" y="' + (top + ch * map.ys.length + 16) + '" text-anchor="middle" class="ax">' + esc(x) + '</text>';
  });
  Object.keys(map.presets || {}).forEach(function (n) {
    var m = map.presets[n], i = map.xs.indexOf(m.x), j = map.ys.indexOf(m.y);
    if (i < 0 || j < 0) return;
    var xx = left + cw * i, yy = top + ch * (map.ys.length - 1 - j);
    s += '<rect x="' + (xx - 1) + '" y="' + (yy - 1) + '" width="' + cw + '" height="' + ch + '" rx="4" fill="none" class="mark"/>';
    s += '<text x="' + (xx + cw / 2 - 1) + '" y="' + (yy - 4) + '" text-anchor="middle" class="marklbl">' + esc(n) + '</text>';
  });
  s += '<text x="' + (left + cw * map.xs.length / 2) + '" y="' + (H - 6) + '" text-anchor="middle" class="axt">' + esc(map.x) + '</text>';
  s += '<text x="12" y="' + (top - 10) + '" class="axt">' + esc(map.y) + '</text>';
  return s + '</svg>';
}

function tornadoSvg(rows) {
  var w = 640, rh = 26, left = 210, mid = left + (w - left - 20) / 2, scale = (w - left - 20) / 2, H = 30 + rh * rows.length;
  var s = '<svg class="chart" viewBox="0 0 ' + w + ' ' + H + '" width="' + w + '" role="img" aria-label="tornado">';
  s += '<line x1="' + mid + '" y1="14" x2="' + mid + '" y2="' + (H - 4) + '" class="grid"/>';
  s += '<text x="' + mid + '" y="11" text-anchor="middle" class="ax">base ' + pct(rows.length ? rows[0].base : null) + '</text>';
  rows.forEach(function (r, k) {
    var y = 18 + rh * k;
    s += '<text x="' + (left - 8) + '" y="' + (y + 13) + '" text-anchor="end" class="ax">' + esc(r.param) + '</text>';
    [['low', 'bar-lo'], ['high', 'bar-hi']].forEach(function (sd, q) {
      if (r[sd[0]] === undefined) return;
      var d = r[sd[0]] - r.base, x0 = mid + Math.min(0, d) * scale, bw = Math.max(1.5, Math.abs(d) * scale);
      s += '<rect x="' + x0 + '" y="' + (y + 2 + q * 10) + '" width="' + bw + '" height="9" class="' + sd[1] + '"><title>' + esc(r.param + ' ' + sd[0] + ' (' + r[sd[0] + 'Value'] + '): ' + pct(r[sd[0]])) + '</title></rect>';
    });
  });
  return s + '</svg>';
}

function lineChart(t, lines, opts) {
  var w = 640, h = 150, l = 44, r = 10, tp = 10, b = 22, W = w - l - r, Hh = h - tp - b;
  var ys = [];
  lines.forEach(function (ln) { for (var i = 0; i < ln.y.length; i++) if (isFinite(ln.y[i])) ys.push(ln.y[i]); });
  var lo = opts.min !== undefined ? opts.min : Math.min.apply(null, ys.length ? ys : [0]);
  var hi = opts.max !== undefined ? opts.max : Math.max.apply(null, ys.length ? ys : [1]);
  if (hi - lo < 1e-6) hi = lo + 1;
  var t0 = t[0], t1 = t[t.length - 1], step = Math.max(1, Math.floor(t.length / 500));
  function X(x) { return l + W * (x - t0) / (t1 - t0 || 1); }
  function Y(y) { return tp + Hh * (1 - (y - lo) / (hi - lo)); }
  var s = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '">';
  if (opts.bands) opts.bands.forEach(function (bd) { s += '<rect x="' + X(bd[0]) + '" y="' + tp + '" width="' + Math.max(1, X(bd[1]) - X(bd[0])) + '" height="' + Hh + '" class="band"/>'; });
  [lo, (lo + hi) / 2, hi].forEach(function (g) { s += '<line x1="' + l + '" x2="' + (w - r) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" class="grid"/><text x="' + (l - 4) + '" y="' + (Y(g) + 4) + '" text-anchor="end" class="ax">' + num(g, 1) + '</text>'; });
  for (var k = 0; k <= 4; k++) { var tx = t0 + (t1 - t0) * k / 4; s += '<text x="' + X(tx) + '" y="' + (h - 6) + '" text-anchor="middle" class="ax">' + num(tx, 0) + ' s</text>'; }
  lines.forEach(function (ln) {
    var d = '', pen = false;
    for (var i = 0; i < t.length; i += step) {
      var y = ln.y[i];
      if (!isFinite(y)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + X(t[i]).toFixed(1) + ' ' + Y(Math.max(lo, Math.min(hi, y))).toFixed(1);
      pen = true;
    }
    s += '<path d="' + d + '" class="ln ' + ln.cls + '"/>';
  });
  s += '<text x="' + (l + 4) + '" y="' + (tp + 10) + '" class="axt">' + esc(opts.title) + '</text>';
  var lx = l + 4;
  lines.forEach(function (ln) { lx += 0; });
  return s + '</svg><div class="legend">' + lines.map(function (ln) { return '<span class="sw ' + ln.cls + '"></span>' + esc(ln.name); }).join(' ') + '</div>';
}

// ------------------------------------------------------------------ sections
function matrixTable(run) {
  // scenario file x grid point (non-tornado): groups passing / groups, with the metric failing most
  var pts = run.summary.byPoint.filter(function (p) { return p.study !== 'tornado'; });
  if (pts.length > 8) pts = pts.filter(function (p) { return p.preset; }).slice(0, 8);
  if (!pts.length) return '';
  var gis = pts.map(function (p) { return p.gi; });
  var cell = {}, failCount = {};
  var groups = {};
  run.runs.forEach(function (r) {
    if (gis.indexOf(r.gi) < 0 || r.family === 'L') return;
    var gk = r.gi + '|' + r.groupKey;
    var g = groups[gk] || (groups[gk] = { scenario: r.scenario, gi: r.gi, pass: true, failed: {} });
    if (!r.verdict.pass) { g.pass = false; r.verdict.failed.forEach(function (f) { g.failed[f] = true; }); }
  });
  Object.keys(groups).forEach(function (k) {
    var g = groups[k], ck = g.scenario + '|' + g.gi;
    var c = cell[ck] || (cell[ck] = { n: 0, pass: 0 });
    c.n++; if (g.pass) c.pass++;
    var fc = failCount[ck] || (failCount[ck] = {});
    Object.keys(g.failed).forEach(function (f) { fc[f] = (fc[f] || 0) + 1; });
  });
  var scen = scenario.list().filter(function (e) { return e.family !== 'L'; });
  var h = '<table class="matrix"><thead><tr><th>Scenario</th><th>Scope</th>' + pts.map(function (p) {
    return '<th title="' + esc(p.label) + '">' + esc(p.preset || '') + '<br><span class="muted">' + esc(shortPoint(p.point)) + '</span></th>';
  }).join('') + '</tr></thead><tbody>';
  var fam = null;
  scen.forEach(function (e) {
    if (!pts.some(function (p) { return cell[e.id + '|' + p.gi]; })) return;
    if (e.family !== fam) { fam = e.family; h += '<tr class="fam"><td colspan="' + (2 + pts.length) + '">' + fam + '. ' + esc(scenario.FAMILIES[fam]) + '</td></tr>'; }
    h += '<tr><td><span class="sid">' + esc(e.id) + '</span> <span class="muted">' + esc(e.name) + '</span></td><td class="muted">' + esc(e.scope) + '</td>';
    pts.forEach(function (p) {
      var c = cell[e.id + '|' + p.gi];
      if (!c) { h += '<td></td>'; return; }
      var sh = shade(c.pass / c.n), fc = failCount[e.id + '|' + p.gi] || {};
      var top = Object.keys(fc).sort(function (a, b) { return fc[b] - fc[a]; })[0];
      h += '<td style="background:' + sh.bg + ';color:' + sh.fg + '" title="' + esc(Object.keys(fc).map(function (k) { return k + ' ×' + fc[k]; }).join(', ')) + '">' +
        c.pass + '/' + c.n + (top ? '<br><span class="why">' + esc(top) + '</span>' : '') + '</td>';
    });
    h += '</tr>';
  });
  return h + '</tbody></table>';
}
function shortPoint(pt) {
  return Object.keys(pt).map(function (k) { return k.replace(/^(plant|sensor|command|controller|warning)\./, '') + '=' + pt[k]; }).join(' ');
}

function familyTable(run) {
  var pts = run.summary.byPoint.filter(function (p) { return p.study !== 'tornado'; });
  if (pts.length > 10) pts = pts.filter(function (p) { return p.preset; });
  var fams = Object.keys(scenario.FAMILIES).filter(function (f) { return pts.some(function (p) { return p.families[f]; }); });
  var h = '<table><thead><tr><th>Point</th><th>All</th>' + fams.map(function (f) { return '<th title="' + esc(scenario.FAMILIES[f]) + '">' + f + '</th>'; }).join('') +
    '<th>in scope</th><th>warn only</th><th>out of envelope</th><th>lead braking handled, no warning</th></tr></thead><tbody>';
  pts.forEach(function (p) {
    h += '<tr><td>' + (p.preset ? '<b>' + esc(p.preset) + '</b> ' : '') + '<span class="muted">' + esc(shortPoint(p.point)) + '</span></td>' + tdShare(p.passShare);
    fams.forEach(function (f) { h += tdShare(p.families[f] ? p.families[f].share : null); });
    ['in', 'warnOnly', 'outOfEnvelope'].forEach(function (s) { h += tdShare(p.scopes[s] ? p.scopes[s].share : null); });
    h += '<td>' + (p.leadBrakeHandled_mps2 === null ? '–' : p.leadBrakeHandled_mps2 + ' m/s²') + '</td></tr>';
  });
  return h + '</tbody></table>';
}
function tdShare(x) { var c = shade(x); return '<td style="background:' + c.bg + ';color:' + c.fg + '">' + pct(x) + '</td>'; }

function reactionTable(run) {
  // warn-only groups: how often contact happens with the driver reacting, late, not reacting
  var pts = run.summary.byPoint.filter(function (p) { return p.preset && p.study !== 'tornado'; });
  if (!pts.length) return '';
  var h = '<table><thead><tr><th>Point</th><th>warn-only variants</th><th>contact, driver reacts</th><th>contact, reacts late (2.5 s)</th><th>contact, does not react</th><th>missed warnings</th><th>median lead time</th></tr></thead><tbody>';
  pts.forEach(function (p) {
    var rs = run.runs.filter(function (r) { return r.gi === p.gi && r.scope !== 'in' && r.family !== 'L'; });
    var byG = {};
    rs.forEach(function (r) { (byG[r.groupKey] = byG[r.groupKey] || []).push(r); });
    var n = Object.keys(byG).length, c = { react: 0, late: 0, none: 0 }, missed = 0, lts = [];
    Object.keys(byG).forEach(function (k) {
      var seen = {};
      byG[k].forEach(function (r) {
        if (r.metrics.collision) seen[r.reaction] = true;
        if (r.reaction === 'none' && r.metrics.missedWarning) seen.missed = true;
        if (r.reaction === 'none' && typeof r.metrics.warnLeadTime_s === 'number') lts.push(r.metrics.warnLeadTime_s);
      });
      ['react', 'late', 'none'].forEach(function (q) { if (seen[q]) c[q]++; });
      if (seen.missed) missed++;
    });
    lts.sort(function (a, b) { return a - b; });
    h += '<tr><td>' + esc(p.preset) + ' <span class="muted">' + esc(shortPoint(p.point)) + '</span></td><td>' + n + '</td><td>' + c.react + '</td><td>' + c.late + '</td><td>' + c.none + '</td><td>' + missed + '</td><td>' + (lts.length ? num(lts[Math.floor(lts.length / 2)], 1) + ' s' : '–') + '</td></tr>';
  });
  return h + '</tbody></table>';
}

function perHourTable(run) {
  var pts = run.summary.byPoint.filter(function (p) { return p.perHour && Object.keys(p.perHour).length; });
  if (!pts.length) return '';
  var h = '<table><thead><tr><th>Point</th><th>Mix</th><th>warnings / h</th><th>interventions / h</th><th>nuisance / h</th><th>missed / h</th><th>contacts / h</th><th>set changes / min</th><th>most warnings from</th></tr></thead><tbody>';
  pts.forEach(function (p) {
    Object.keys(p.perHour).sort().forEach(function (L) {
      var a = p.perHour[L];
      h += '<tr><td>' + esc(p.preset || '') + ' <span class="muted">' + esc(shortPoint(p.point)) + '</span></td><td>' + esc(L) + '</td><td>' + num(a.warningsPerHour, 2) + '</td><td>' + num(a.interventionsPerHour, 2) + '</td><td>' + num(a.nuisancePerHour, 2) +
        '</td><td>' + num(a.missedWarningsPerHour, 2) + '</td><td>' + num(a.collisionsPerHour, 3) + '</td><td>' + num(a.setpointChangesPerMin, 1) + '</td><td class="muted">' +
        esc((a.topContributors || []).slice(0, 3).map(function (c) { return c.source; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).join(', ')) + '</td></tr>';
    });
  });
  return h + '</tbody></table>';
}

function thresholdsTable(run) {
  var pts = run.summary.byPoint.filter(function (p) { return p.preset && p.study !== 'tornado'; }).slice(0, 6);
  var keys = metrics.METRICS.filter(function (m) { return m.op && m.level === 'run'; }).map(function (m) { return m.key; });
  var th = metrics.thresholdsOf(run.plan.base || {});
  var h = '<table><thead><tr><th>Metric</th><th>Pass if</th>' + pts.map(function (p) { return '<th>' + esc(p.preset) + '<br><span class="muted">' + esc(shortPoint(p.point)) + '</span></th>'; }).join('') + '</tr></thead><tbody>';
  keys.forEach(function (k) {
    var d = metrics.BY_KEY[k];
    var cells = pts.map(function (p) {
      var rs = run.runs.filter(function (r) { return r.gi === p.gi && r.decide && r.decide.indexOf(k) >= 0 && r.metrics[k] !== undefined; });
      if (!rs.length) return null;
      var fails = rs.filter(function (r) { return r.verdict.failed.indexOf(k) >= 0; }).length;
      var vals = rs.map(function (r) { return r.metrics[k]; });
      var worst = typeof vals[0] === 'boolean' ? (d.op === 'true' ? vals.some(function (v) { return !v; }) ? 'no' : 'yes' : vals.some(Boolean) ? 'yes' : 'no')
        : (d.op === '>=' ? Math.min.apply(null, vals) : Math.max.apply(null, vals));
      return { n: rs.length, fails: fails, worst: worst };
    });
    if (cells.every(function (c) { return !c; })) return;
    var rule = d.op === 'false' ? 'never' : d.op === 'true' ? 'always' : d.op + ' ' + th[k] + ' ' + d.unit;
    h += '<tr><td>' + esc(d.label) + ' <span class="muted">' + esc(k) + '</span></td><td>' + esc(rule) + '</td>' + cells.map(function (c) {
      if (!c) return '<td class="muted">–</td>';
      var sh = shade(1 - c.fails / c.n);
      return '<td style="background:' + sh.bg + ';color:' + sh.fg + '">' + (c.n - c.fails) + '/' + c.n + '<br><span class="why">worst ' + esc(typeof c.worst === 'number' ? num(c.worst, 2) : c.worst) + '</span></td>';
    }).join('') + '</tr>';
  });
  return h + '</tbody></table>';
}

function tuningTable(run) {
  var pts = run.summary.byPoint.filter(function (p) { return p.study !== 'tornado'; }).slice();
  pts.sort(function (a, b) { return (b.passShare - a.passShare) || ((a.cost.accelRms_mps2 || 0) - (b.cost.accelRms_mps2 || 0)); });
  var h = '<table><thead><tr><th>#</th><th>Set</th><th>Pass</th><th>accel RMS</th><th>peak jerk</th><th>set changes / min</th><th>time lost</th><th>warnings / run</th></tr></thead><tbody>';
  pts.slice(0, 12).forEach(function (p, i) {
    h += '<tr><td>' + (i + 1) + '</td><td>' + (p.preset ? '<b>' + esc(p.preset) + '</b> ' : '') + esc(shortPoint(p.point)) + '</td>' + tdShare(p.passShare) + '<td>' + num(p.cost.accelRms_mps2, 3) + '</td><td>' + num(p.cost.peakJerk_mps3, 2) +
      '</td><td>' + num(p.cost.setpointChangesAvgPerMin, 1) + '</td><td>' + num(p.cost.timeLostPct, 2) + ' %</td><td>' + num(p.cost.warnCount, 2) + '</td></tr>';
  });
  var start = run.summary.byPoint.filter(function (p) { return p.preset === 'start'; })[0];
  if (start) h += '<tr class="fam"><td></td><td>the parent brief\'s start values: ' + esc(shortPoint(start.point)) + '</td>' + tdShare(start.passShare) + '<td colspan="5" class="muted">rank ' + (pts.indexOf(start) + 1) + ' of ' + pts.length + '</td></tr>';
  return h + '</tbody></table>';
}

function catalogueTable() {
  var h = '<table class="cat"><thead><tr><th>Id</th><th>Name</th><th>Scope</th><th>Decided by</th><th>Variants</th><th>Runs</th></tr></thead><tbody>';
  var fam = null;
  scenario.list().forEach(function (e) {
    if (e.family !== fam) { fam = e.family; h += '<tr class="fam"><td colspan="6">' + fam + '. ' + esc(scenario.FAMILIES[fam]) + '</td></tr>'; }
    var t = scenario.template(e.id), cs = scenario.expand(e.id);
    var groups = {}; cs.forEach(function (c) { groups[c.groupKey] = 1; });
    h += '<tr><td class="sid">' + esc(e.id) + '</td><td>' + esc(e.name) + '</td><td>' + esc(t.scope) + '</td><td class="muted">' + esc((t.decide || []).join(', ') || 'per hour (catalogue level)') + '</td><td>' + Object.keys(groups).length + '</td><td>' + cs.length + '</td></tr>';
  });
  return h + '</tbody></table>';
}

// re-run a worst case and draw it
function worstCharts(run, gi, n, engine) {
  var p = run.summary.byPoint[gi];
  if (!p || !engine) return '';
  var out = '';
  p.failing.filter(function (f) { return f.family !== 'L'; }).slice(0, n).forEach(function (f) {
    var c;
    try { c = scenario.load(f.worstRun); } catch (e) { return; }
    var cfg = sweep.configFor(run.plan, p.point, c), r;
    try { r = engine.run(cfg); } catch (e) { out += '<p class="muted">' + esc(f.worstRun) + ': ' + esc(e.message) + '</p>'; return; }
    var S = r.series, t = Array.prototype.slice.call(r.t), K = function (a) { return a ? Array.prototype.map.call(a, function (v) { return v * 3.6; }) : []; };
    var bands = [], on = null, w = S.warn;
    if (w) for (var i = 0; i < t.length; i++) { if (w[i] > 0 && on === null) on = t[i]; if (!(w[i] > 0) && on !== null) { bands.push([on, t[i]]); on = null; } }
    if (on !== null) bands.push([on, t[t.length - 1]]);
    out += '<div class="case"><h4><span class="sid">' + esc(f.worstRun) + '</span></h4><p class="muted">' + esc(p.label) + ' · fails ' + esc(f.failed.join(', ')) +
      ' · ' + esc(Object.keys(f.worst).map(function (k) { return k + ' ' + (typeof f.worst[k] === 'number' ? num(f.worst[k], 2) : f.worst[k]); }).join(', ')) + '</p>';
    out += lineChart(t, [
      { name: 'ego', y: K(S['ego.v']), cls: 'c1' }, { name: 'lead', y: K(S['lead.v']), cls: 'c2' },
      { name: 'set commanded', y: K(S['set.cmd']), cls: 'c3' }, { name: 'set held', y: K(S['set.held']), cls: 'c4' }
    ], { title: 'speed, km/h (shaded: warning)', bands: bands, min: 0 });
    out += lineChart(t, [
      { name: 'true gap', y: Array.prototype.slice.call(S['gap.true'] || []), cls: 'c1' }, { name: 'estimated', y: Array.prototype.slice.call(S['est.gap'] || []), cls: 'c3' },
      { name: 'desired', y: Array.prototype.slice.call(S['d.des'] || []), cls: 'c5' }
    ], { title: 'gap, m', bands: bands, min: 0 });
    out += lineChart(t, [
      { name: 'ego accel', y: Array.prototype.slice.call(S['ego.a'] || []), cls: 'c1' }, { name: 'lead accel', y: Array.prototype.slice.call(S['lead.a'] || []), cls: 'c2' }
    ], { title: 'acceleration, m/s²', bands: bands });
    out += '</div>';
  });
  return out;
}

// ------------------------------------------------------------------ headline and the measure-first list
function mapHeadline(map) {
  // per row (y), the weakest x where the share reaches 80 % of the best cell
  var best = 0;
  map.cells.forEach(function (row) { row.forEach(function (v) { if (v !== null && v > best) best = v; }); });
  var target = Math.max(0.5, best - 0.02), rows = [];   // within 2 points of the best cell
  map.ys.forEach(function (y, j) {
    var xsOk = map.xs.filter(function (x, i) { return map.cells[j][i] !== null && map.cells[j][i] >= target; });
    rows.push({ y: y, x: xsOk.length ? xsOk.reduce(function (a, b) { return Math.abs(b) < Math.abs(a) ? b : a; }) : null });
  });
  return { best: best, target: target, rows: rows };
}
function mean(a) { var v = a.filter(function (x) { return x !== null && x !== undefined; }); return v.length ? v.reduce(function (p, q) { return p + q; }, 0) / v.length : null; }
function spread(a) { var v = a.filter(function (x) { return x !== null; }); return v.length ? Math.max.apply(null, v) - Math.min.apply(null, v) : 0; }
function measureList(runs) {
  var score = {}, fromMaps = {};
  runs.forEach(function (run) {
    // a map's axes: the spread of the column / row means of the safety share, within each split; the best split counts
    (run.summary.maps || []).forEach(function (m) {
      var c = m.safeCells || m.cells;
      var sx = spread(m.xs.map(function (_, i) { return mean(c.map(function (row) { return row[i]; })); }));
      var sy = spread(m.ys.map(function (_, j) { return mean(c[j]); }));
      score[m.x] = Math.max(score[m.x] || 0, sx); score[m.y] = Math.max(score[m.y] || 0, sy);
      fromMaps[m.x] = fromMaps[m.y] = true;
      if (m.split) fromMaps[m.split] = true;
    });
  });
  runs.forEach(function (run) {
    (run.summary.tornado || []).forEach(function (r) { score[r.param] = Math.max(score[r.param] || 0, r.swing, r.safeSwing || 0); });
    (run.summary.ranking || []).forEach(function (r) {
      if (/preset/.test(r.param) || fromMaps[r.param] || r.param === 'plant.brakeMax_ms2') return;   // brake authority moves with aMin on the map
      score[r.param] = Math.max(score[r.param] || 0, r.spread, r.safeSpread || 0);
    });
  });
  return Object.keys(score).filter(function (k) { return !/^(controller|warning|thresholds)\./.test(k); })
    .sort(function (a, b) { return score[b] - score[a]; })
    .map(function (k) { return { param: k, swing: score[k], m: MEASURE[k] || { what: k, how: '', uk: k } }; });
}

// ------------------------------------------------------------------ the page
var CSS = [
  ':root{--bg:#fbfbfa;--fg:#1d2430;--fg-muted:#5d6878;--line:#d9dde3;--card:#fff;--cell-na:#eef0f3;--accent:#1f5fae;--warn:#a35a00;',
  '--c1:#1f5fae;--c2:#c2410c;--c3:#0f766e;--c4:#7c3aed;--c5:#6b7280;--band:rgba(234,88,12,.12)}',
  '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#14171c;--fg:#e6e9ee;--fg-muted:#9aa4b2;--line:#2c323b;--card:#1b1f26;--cell-na:#232831;--accent:#7fb0ff;--warn:#f0a35a;',
  '--c1:#7fb0ff;--c2:#ff9b6a;--c3:#4fd1c5;--c4:#b794f4;--c5:#a0aec0;--band:rgba(251,146,60,.16)}}',
  ':root[data-theme="dark"]{--bg:#14171c;--fg:#e6e9ee;--fg-muted:#9aa4b2;--line:#2c323b;--card:#1b1f26;--cell-na:#232831;--accent:#7fb0ff;--warn:#f0a35a}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
  'main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 10px;border-bottom:1px solid var(--line);padding-bottom:4px}',
  'h3{font-size:15px;margin:22px 0 8px}h4{margin:6px 0 2px;font-size:13px}.muted{color:var(--fg-muted)}.sid{font-family:ui-monospace,Menlo,monospace;font-size:12px}',
  '.banner{border:1px solid var(--warn);color:var(--warn);border-radius:8px;padding:10px 14px;margin:14px 0;background:var(--card)}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:12px 0}',
  'table{border-collapse:collapse;margin:8px 0;font-size:12.5px;width:100%}th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}th{background:var(--card);font-weight:600}',
  'tr.fam td{background:var(--cell-na);font-weight:600}.matrix td{text-align:center;min-width:64px}.matrix td:first-child{text-align:left}.why{font-size:10.5px;opacity:.85}',
  '.scroll{overflow-x:auto}.chart{max-width:100%;height:auto;display:block}.ax{font-size:10.5px;fill:var(--fg-muted)}.axt{font-size:11px;fill:var(--fg)}.cell{font-size:11px;font-weight:600}',
  '.mark{stroke:var(--fg);stroke-width:2}.marklbl{font-size:10px;fill:var(--fg);font-weight:600}.grid{stroke:var(--line);stroke-width:1}.band{fill:var(--band)}',
  '.ln{fill:none;stroke-width:1.6}.ln.c1{stroke:var(--c1)}.ln.c2{stroke:var(--c2)}.ln.c3{stroke:var(--c3);stroke-dasharray:4 2}.ln.c4{stroke:var(--c4)}.ln.c5{stroke:var(--c5);stroke-dasharray:2 3}',
  '.legend{font-size:11px;color:var(--fg-muted);margin:0 0 8px 44px}.sw{display:inline-block;width:14px;height:3px;margin:0 4px 3px 8px;vertical-align:middle}.sw.c1{background:var(--c1)}.sw.c2{background:var(--c2)}.sw.c3{background:var(--c3)}.sw.c4{background:var(--c4)}.sw.c5{background:var(--c5)}',
  '.bar-lo{fill:var(--c2)}.bar-hi{fill:var(--c1)}.case{border-top:1px dashed var(--line);padding-top:8px;margin-top:10px}ol li{margin:4px 0}details summary{cursor:pointer;color:var(--accent)}',
  '@media (max-width:640px){main{padding:16px}table{font-size:11.5px}}'
].join('\n');

function build(runs, opts) {
  var engine = null;
  if (!opts.noRerun) { try { engine = require('./core/sim'); } catch (e) { engine = null; } }
  var assumed = runs.some(function (r) { return !r.summary.plant || r.summary.plant.assumed; });
  var plantWord = assumed ? 'with an assumed plant' : 'with the identified plant';
  var modules = null;
  if (engine) { try { modules = engine.run({ duration: 1 }).meta.modules; } catch (e) { modules = null; } }
  var stubs = modules ? Object.keys(modules).filter(function (k) { return modules[k] === 'stub'; }) : [];

  var byName = {};
  runs.forEach(function (r) { byName[r.name] = r; });
  var presetsRun = byName.presets || runs.filter(function (r) { return r.summary.byPoint.some(function (p) { return p.preset; }); })[0] || runs[0];
  var mapRuns = runs.filter(function (r) { return r.summary.maps && r.summary.maps.length; });
  var measure = measureList(runs);

  // ---------- numbers for the summaries
  var sumEn = [], sumUk = [];
  var pp = presetsRun ? presetsRun.summary.byPoint.filter(function (p) { return p.preset && p.study !== 'tornado'; }) : [];
  var nominal = pp.filter(function (p) { return Object.keys(p.point).length === 1; });
  if (nominal.length) {
    sumEn.push('Catalogue at the three assumed presets (' + presetsRun.summary.totals.runs + ' runs): ' + nominal.map(function (p) {
      return p.preset + ' ' + pct(p.passShare) + ' of the variant groups pass' + (p.leadBrakeHandled_mps2 !== null ? ', lead braking handled without a warning up to ' + p.leadBrakeHandled_mps2 + ' m/s²' : '');
    }).join('; ') + '.');
    sumUk.push('Каталог при трьох припущених моделях круїзу (' + presetsRun.summary.totals.runs + ' прогонів): ' + nominal.map(function (p) {
      return p.preset + ' — проходить ' + pct(p.passShare) + ' груп варіантів' + (p.leadBrakeHandled_mps2 !== null ? ', гальмування лідера без попередження витримується до ' + p.leadBrakeHandled_mps2 + ' м/с²' : '');
    }).join('; ') + '.');
    var ph = nominal.map(function (p) { return p.perHour && p.perHour['L.commute'] ? p.preset + ' ' + num(p.perHour['L.commute'].warningsPerHour, 1) + ' warnings/h, ' + num(p.perHour['L.commute'].interventionsPerHour, 1) + ' interventions/h' : null; }).filter(Boolean);
    if (ph.length) {
      sumEn.push('Mixed commute (family L, assumed traffic rates): ' + ph.join('; ') + ' (parent threshold: ≤ 1 warning per hour).');
      sumUk.push('Змішана поїздка (сімейство L, припущені частоти подій): ' + ph.join('; ').replace(/warnings\/h/g, 'попереджень/год').replace(/interventions\/h/g, 'втручань/год') + ' (поріг батьківського брифу: ≤ 1 попередження на годину).');
    }
  }
  mapRuns.forEach(function (r) {
    r.summary.maps.forEach(function (m) {
      var hl = mapHeadline(m.safeCells ? { xs: m.xs, ys: m.ys, cells: m.safeCells } : m);
      var rowTxt = hl.rows.map(function (row) { return m.y + ' ' + row.y + ': ' + (row.x === null ? 'never' : m.x + ' ' + row.x); }).join('; ');
      sumEn.push('Map ' + r.name + (m.split ? ' (' + m.split + ' = ' + m.splitValue + ')' : '') + ', ' + plantWord + ': the best cell is safe in ' + pct(hl.best) + ' of the groups; reaching ' + pct(hl.target) + ' needs — ' + rowTxt + '.');
      sumUk.push('Карта ' + r.name + (m.split ? ' (' + m.split + ' = ' + m.splitValue + ')' : '') + ', з припущеною моделлю круїзу: найкраща клітинка безпечна в ' + pct(hl.best) + ' груп' + '; щоб досягти ' + pct(hl.target) + ', потрібно — ' + rowTxt.replace(/never/g, 'недосяжно') + '.');
    });
  });
  if (measure.length) {
    sumEn.push('Measure first on the car: ' + measure.slice(0, 5).map(function (m, i) { return (i + 1) + ') ' + m.m.what; }).join('; ') + '.');
    sumUk.push('Що виміряти першим на авто: ' + measure.slice(0, 5).map(function (m, i) { return (i + 1) + ') ' + m.m.uk; }).join('; ') + '.');
  }
  if (stubs.length) {
    sumEn.push('Modules still stubbed in this build: ' + stubs.join(', ') + '.');
    sumUk.push('Модулі-заглушки в цій збірці: ' + stubs.join(', ') + '.');
  }

  // ---------- the page
  var h = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Cruise Feasibility Report</title><style>' + CSS + '</style></head><body><main>';
  h += '<h1>Cruise set-speed simulator — feasibility report</h1><p class="muted">' + esc(new Date().toISOString().slice(0, 16).replace('T', ' ')) + ' · ' +
    runs.map(function (r) { return esc(r.name) + ' (' + r.summary.totals.runs + ' runs, ' + esc(path.basename(r.dir)) + ')'; }).join(' · ') + '</p>';
  if (assumed) h += '<div class="banner"><b>Assumed plant.</b> No drive has been recorded: every number here comes from assumed cruise models (presets liftoff / mild / firm and the grids around them). Nothing on this page is a go / no-go verdict; it says which car numbers the verdict will turn on.</div>';
  h += '<div class="card"><h3>Summary</h3><ul>' + sumEn.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
  h += '<h3>Підсумок українською</h3><ul lang="uk">' + sumUk.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';

  h += '<h2>Measure this first on the car</h2><p class="muted">Ranked by how far the share of the catalogue that passes moves when the number moves (±30 % tornado, or across the map\'s range).</p><ol>';
  measure.forEach(function (m) { h += '<li><b>' + esc(m.m.what) + '</b> <span class="muted">(' + esc(m.param) + ', moves the pass share by up to ' + Math.round(100 * m.swing) + ' points)</span><br>' + esc(m.m.how) + '</li>'; });
  h += '<li><b>Whether the command path exists at all</b> <span class="muted">(acceptance, delay, rate of MultimodalControlDriverAssistance)</span><br>Paper study only in this phase: it decides feasibility as much as the deceleration does.</li></ol>';

  mapRuns.forEach(function (r) {
    h += '<h2>Feasibility map: ' + esc(r.name) + '</h2><p class="muted">' + esc(r.plan.description || '') + ' Each cell: the share of the variant groups that pass (all reaction cases and worst times of a group must pass). Framed: the presets.</p>';
    r.summary.maps.forEach(function (m) {
      h += '<div class="scroll">' + (m.split ? '<h3>' + esc(m.split + ' = ' + m.splitValue) + '</h3>' : '') +
        '<div style="display:flex;flex-wrap:wrap;gap:16px"><div><h4>pass share</h4>' + heatmap(m, r.name) + '</div>' +
        (m.safeCells ? '<div><h4>safety share (failures only in comfort, chatter, nuisance count as safe)</h4>' + heatmap({ x: m.x, y: m.y, xs: m.xs, ys: m.ys, cells: m.safeCells, presets: m.presets }, r.name + ' safety') + '</div>' : '') +
        '</div></div>';
      var fams = Object.keys(m.families || {}).filter(function (f) { return 'BCDEFG'.indexOf(f) >= 0; });
      if (fams.length) {
        h += '<details><summary>per family</summary><div class="scroll" style="display:flex;flex-wrap:wrap;gap:12px">';
        fams.forEach(function (f) { h += '<div><h4>' + f + '. ' + esc(scenario.FAMILIES[f]) + '</h4>' + heatmap({ x: m.x, y: m.y, xs: m.xs, ys: m.ys, cells: m.families[f], presets: m.presets }, f) + '</div>'; });
        h += '</div></details>';
      }
    });
  });

  runs.forEach(function (r) {
    if (r.summary.tornado && r.summary.tornado.length) {
      h += '<h2>Sensitivity: ' + esc(r.name) + '</h2><p class="muted">' + esc(r.plan.description || '') + ' Orange: −30 %, blue: +30 %; bar = change of the pass share.</p><div class="scroll">' + tornadoSvg(r.summary.tornado) + '</div>';
    }
  });

  if (presetsRun) {
    h += '<h2>Pass share by family</h2><div class="scroll">' + familyTable(presetsRun) + '</div>';
    h += '<h2>The scenario matrix</h2><p class="muted">Variant groups passing / groups, per scenario file and preset; the small line is the metric failing most often (hover for all).</p><div class="scroll">' + matrixTable(presetsRun) + '</div>';
    h += '<h2>Metrics against the thresholds</h2><p class="muted">Runs where the metric decides: passing / decided, and the worst value. The thresholds are the parent brief\'s proposals (core/metrics.js SCHEMA).</p><div class="scroll">' + thresholdsTable(presetsRun) + '</div>';
    h += '<h2>The warning and the driver</h2><p class="muted">Warn-only and out-of-envelope variants, each run three ways: the driver reacts (median 1.2 s, 6 m/s²), reacts late (2.5 s), does not react. Lead time = the last moment a braking driver can avoid contact minus the warning\'s onset.</p><div class="scroll">' + reactionTable(presetsRun) + '</div>';
    var phT = perHourTable(presetsRun);
    if (phT) h += '<h2>Per hour of mixed driving (family L)</h2><p class="muted">Event rates are assumptions (core/mixed.js RATES), not measurements.</p><div class="scroll">' + phT + '</div>';
  }
  if (byName.tuning) h += '<h2>Tuning sweep</h2><p class="muted">' + esc(byName.tuning.plan.description || '') + ' Ranked by pass share, then comfort.</p><div class="scroll">' + tuningTable(byName.tuning) + '</div>';

  if (presetsRun && engine) {
    var focus = presetsRun.summary.byPoint.filter(function (p) { return p.preset === 'mild' && Object.keys(p.point).length === 1; })[0] || presetsRun.summary.byPoint[0];
    h += '<h2>Worst cases (' + esc(focus.label) + ')</h2><p class="muted">Re-run from their configs; collisions first, then missed warnings, then the smallest time gap.</p>' + worstCharts(presetsRun, focus.gi, opts.worst || 8, engine);
  }
  h += '<h2>The catalogue</h2><p class="muted">Every scenario file (tools/cruise-sim/scenarios), its scope, what decides it, its variant groups and runs (reaction cases × worst times).</p><details><summary>show the ' + scenario.list().length + ' scenarios</summary><div class="scroll">' + catalogueTable() + '</div></details>';
  h += '<h2>Configuration</h2>';
  runs.forEach(function (r) { h += '<details><summary>' + esc(r.name) + ' plan</summary><pre>' + esc(JSON.stringify(r.plan, null, 1)) + '</pre></details>'; });
  if (modules) h += '<p class="muted">Engine modules: ' + esc(Object.keys(modules).map(function (k) { return k + ': ' + modules[k]; }).join(', ')) + '</p>';
  h += '<details><summary>thresholds and metric definitions</summary><table><thead><tr><th>Key</th><th>Label</th><th>Default</th><th>Help</th></tr></thead><tbody>' +
    metrics.SCHEMA.map(function (e) { return '<tr><td class="sid">' + esc(e.key) + '</td><td>' + esc(e.label) + '</td><td>' + esc((e.op ? e.op + ' ' : '') + e.default + ' ' + (e.unit || '')) + '</td><td class="muted">' + esc(e.help) + '</td></tr>'; }).join('') + '</tbody></table></details>';
  h += '</main></body></html>';
  return { html: h, summaryEn: sumEn, summaryUk: sumUk, measure: measure };
}

function main() {
  var args = process.argv.slice(2), dirs = [], out = null, worst = 8, noRerun = false;
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i];
    else if (args[i] === '--worst') worst = parseInt(args[++i], 10);
    else if (args[i] === '--no-rerun') noRerun = true;
    else dirs.push(resolveRunDir(args[i]));
  }
  if (!dirs.length) dirs = latestAll();
  if (!dirs.length) { console.error('no runs: run sweep.js first'); process.exit(2); }
  var runs = dirs.map(loadRun);
  var r = build(runs, { worst: worst, noRerun: noRerun });
  fs.mkdirSync(REPORTS, { recursive: true });
  var stampStr = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  var file = out || path.join(REPORTS, 'report-' + stampStr + '.html');
  fs.writeFileSync(file, r.html);
  if (!out) fs.writeFileSync(path.join(REPORTS, 'report-latest.html'), r.html);
  console.log(r.summaryEn.join('\n'));
  console.log('wrote ' + file + ' (' + Math.round(r.html.length / 1024) + ' KB)');
}

module.exports = { build: build, loadRun: loadRun, measureList: measureList, mapHeadline: mapHeadline, heatmap: heatmap, MEASURE: MEASURE };
if (require.main === module) main();
