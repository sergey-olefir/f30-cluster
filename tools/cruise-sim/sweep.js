#!/usr/bin/env node
'use strict';
/*
 * The batch runner (SC3): a plan JSON in, result files out, parallel over the CPU cores (child processes).
 *
 *   node tools/cruise-sim/sweep.js <plan.json> [--workers N] [--engine <module>] [--out <dir>] [--limit N] [--dry] [--quiet]
 *
 * Writes bake/work/cruise-sim/runs/<plan name>-<stamp>/ :
 *   plan.json    the plan as run
 *   runs.jsonl   one line per run: the scenario variant, the grid point, every metric, the verdict
 *   batch.json   the page's batch file (SU2's 'cs-batch' shape): runs (all, or only those at the preset points when there are
 *                too many) and `summary` (pass shares per point and family, maps, ranking, tornado, per-hour numbers, worst cases)
 * and bake/work/cruise-sim/runs/<plan name>.latest (the folder's name), which report.js reads.
 *
 * A plan:
 * {
 *   name, description,
 *   base:      { a config partial applied to every run (plant preset, controller settings, thresholds, seed, ...) },
 *   scenarios: ["*"] | ["B", "D.brake*", "tag:core", "J.gapFreeze.D3", ...],   exclude: [...same patterns]
 *   perScenarioMax: N            keep at most N variant groups per scenario file (evenly spread, deterministic)
 *   grid:      { "<config path>": [values], ... }      cross product, e.g. "plant.aMin_ms2": [-0.7, -1.5, -2.5]
 *   gridCases: [ { "<config path>": value, ... } ]      zipped cases crossed with the grid (e.g. aMin with its brake authority)
 *   presets:   { liftoff: { "<path>": value }, ... }  where the plant presets sit on the map (marks; and which runs to keep)
 *   map:       { x: "<path>", y: "<path>", split?: "<path>" }   the feasibility map(s) of the report
 *   tornado:   { at: { "<path>": value }, params: { "<path>": base value }, factor: 0.3, scenarios?: [...] }
 *   baseline:  true              run the ideal-ACC baseline once per variant (time lost)
 *   seed:      1
 * }
 * Paths are config paths ("plant.deadTime_s", "sensor.rateHz", "command.delay_s", "controller.h", "thresholds.minTTC_s").
 * Every run's config is: base, then the grid point, then the scenario variant's own patch (its sensor preset, its driver
 * reaction case): a scenario that needs a 2 Hz sensor keeps it at every point.
 */
var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var scenario = require('./core/scenario');
var metrics = require('./core/metrics');
var mixed = require('./core/mixed');

var ROOT = __dirname;
var OUT_ROOT = path.join(ROOT, '..', '..', 'bake', 'work', 'cruise-sim', 'runs');
var KEEP_ALL_RUNS = 20000;   // above this, batch.json keeps the preset points' runs only

// ------------------------------------------------------------------ selection
function matchPattern(pat, e) {
  if (pat === '*') return true;
  if (pat.indexOf('tag:') === 0) return e.tags.indexOf(pat.slice(4)) >= 0;
  if (pat.indexOf('scope:') === 0) return e.scope === pat.slice(6);
  if (/^[A-L]$/.test(pat)) return e.family === pat;
  if (pat.charAt(pat.length - 1) === '*') return e.id.indexOf(pat.slice(0, -1)) === 0;
  return e.id === pat;
}
function selectScenarios(plan) {
  var inc = plan.scenarios || ['*'], exc = plan.exclude || [];
  return scenario.list().filter(function (e) {
    return inc.some(function (p) { return matchPattern(p, e); }) && !exc.some(function (p) { return matchPattern(p, e); });
  }).map(function (e) { return e.id; });
}
function thin(concretes, max) {
  if (!max) return concretes;
  var keys = [];
  concretes.forEach(function (c) { if (keys.indexOf(c.groupKey) < 0) keys.push(c.groupKey); });
  if (keys.length <= max) return concretes;
  var keep = {};
  for (var i = 0; i < max; i++) keep[keys[Math.round(i * (keys.length - 1) / Math.max(1, max - 1))]] = true;
  return concretes.filter(function (c) { return keep[c.groupKey]; });
}

// ------------------------------------------------------------------ grid
function crossObj(grid) {
  var out = [{}];
  Object.keys(grid || {}).forEach(function (k) {
    var next = [];
    out.forEach(function (o) { grid[k].forEach(function (v) { var c = Object.assign({}, o); c[k] = v; next.push(c); }); });
    out = next;
  });
  return out;
}
function buildPoints(plan) {
  var pts = [];
  var cases = plan.gridCases && plan.gridCases.length ? plan.gridCases : [{}];
  crossObj(plan.grid).forEach(function (g) {
    cases.forEach(function (cs) { pts.push({ point: Object.assign({}, g, cs), study: plan.map ? 'map' : 'matrix' }); });
  });
  if (plan.tornado) {
    var T = plan.tornado, f = T.factor === undefined ? 0.3 : T.factor, at = T.at || {};
    pts.push({ point: Object.assign({}, at, T.params), study: 'tornado', side: 'base' });
    Object.keys(T.params).forEach(function (p) {
      [['low', 1 - f], ['high', 1 + f]].forEach(function (sd) {
        var o = Object.assign({}, at, T.params);
        o[p] = round6(T.params[p] * sd[1]);
        pts.push({ point: o, study: 'tornado', side: sd[0], param: p });
      });
    });
  }
  pts.forEach(function (p, i) { p.gi = i; p.label = pointLabel(p.point); p.preset = presetOf(plan, p.point); });
  return pts;
}
function round6(x) { return Math.round(x * 1e6) / 1e6; }
function pointLabel(pt) { return Object.keys(pt).map(function (k) { return k + '=' + pt[k]; }).join(', ') || 'base'; }
function presetOf(plan, pt) {
  var P = plan.presets || {};
  for (var name in P) {
    var ok = Object.keys(P[name]).every(function (k) { return pt[k] === P[name][k]; });
    if (ok && Object.keys(P[name]).length) return name;
  }
  if (pt['plant.preset'] !== undefined && Object.keys(pt).length === 1) return pt['plant.preset'];
  return null;
}

// ------------------------------------------------------------------ jobs
function configFor(plan, point, concrete) {
  var cfg = scenario.deepMerge({ seed: plan.seed || 1 }, plan.base || {});
  Object.keys(point).forEach(function (k) { scenario.setPath(cfg, k, point[k]); });
  return scenario.toConfig(concrete, cfg);
}
function buildJobs(plan) {
  var ids = selectScenarios(plan), points = buildPoints(plan), concretes = [];
  ids.forEach(function (id) { thin(scenario.expand(id), plan.perScenarioMax).forEach(function (c) { concretes.push(c); }); });
  var tornadoIds = plan.tornado && plan.tornado.scenarios ? (function () {
    var sel = selectScenarios({ scenarios: plan.tornado.scenarios });
    return concretes.map(function (c, i) { return sel.indexOf(c.base) >= 0 || (c.mixed && sel.indexOf(c.mixed.L) >= 0) ? i : -1; }).filter(function (i) { return i >= 0; });
  })() : null;
  var jobs = [];
  points.forEach(function (p) {
    var list = p.study === 'tornado' && tornadoIds ? tornadoIds : concretes.map(function (_, i) { return i; });
    list.forEach(function (ci) { jobs.push({ k: jobs.length, kind: 'run', gi: p.gi, ci: ci }); });
  });
  if (plan.baseline) concretes.forEach(function (c, ci) { jobs.push({ k: jobs.length, kind: 'baseline', gi: -1, ci: ci }); });
  return { ids: ids, points: points, concretes: concretes, jobs: jobs };
}
function jobConfig(plan, B, job) {
  var c = B.concretes[job.ci];
  if (job.kind === 'baseline') {
    var cfg = configFor(plan, {}, c);
    cfg.ego = Object.assign({}, cfg.ego, { mode: 'idealAcc' });
    return cfg;
  }
  return configFor(plan, B.points[job.gi].point, c);
}

// ------------------------------------------------------------------ running
function runOne(engine, cfg) {
  var t0 = Date.now(), r = engine.run(cfg), m = r.metrics;
  if (!m || !Object.keys(m).length || m.collision === undefined) m = metrics.compute(r, cfg);
  var out = {};
  Object.keys(m).forEach(function (k) { if (m[k] !== null && m[k] !== undefined) out[k] = m[k]; });
  return { metrics: out, plant: r.meta && r.meta.plant ? { name: r.meta.plant.name, assumed: r.meta.plant.assumed !== false } : null, ms: Date.now() - t0 };
}

function runJobs(plan, B, opts) {
  opts = opts || {};
  var jobs = opts.limit ? B.jobs.slice(0, opts.limit) : B.jobs;
  var nW = Math.max(1, Math.min(opts.workers || Math.max(1, os.cpus().length - 1), jobs.length));
  var results = new Array(jobs.length), done = 0, nextIdx = 0, chunk = Math.max(1, Math.min(25, Math.ceil(jobs.length / (nW * 8))));
  var lastPct = -1, started = Date.now();
  return new Promise(function (resolve, reject) {
    if (!jobs.length) { resolve([]); return; }
    var alive = 0;
    function feed(w) {
      if (nextIdx >= jobs.length) { w.send({ type: 'stop' }); return; }
      var batch = [];
      for (var i = 0; i < chunk && nextIdx < jobs.length; i++, nextIdx++) {
        batch.push({ k: nextIdx, config: jobConfig(plan, B, jobs[nextIdx]) });
      }
      w.send({ type: 'jobs', jobs: batch });
    }
    for (var i = 0; i < nW; i++) {
      var w = cp.fork(__filename, ['--worker'], { env: Object.assign({}, process.env, { CS_ENGINE: opts.engine || '' }) });
      alive++;
      (function (w) {
        w.on('message', function (msg) {
          if (msg.type === 'ready') { feed(w); return; }
          if (msg.type === 'done') {
            msg.results.forEach(function (r) { results[r.k] = r; done++; });
            var pct = Math.floor(100 * done / jobs.length);
            if (!opts.quiet && pct >= lastPct + 5) {
              lastPct = pct;
              var el = (Date.now() - started) / 1000;
              process.stderr.write('  ' + pct + ' %  ' + done + ' / ' + jobs.length + '  ' + el.toFixed(0) + ' s\n');
            }
            feed(w);
          }
        });
        w.on('exit', function (code) {
          alive--;
          if (code && done < jobs.length) { reject(new Error('worker exited with ' + code)); return; }
          if (alive === 0) resolve(results.map(function (r, i) { return Object.assign({ job: jobs[i] }, r); }));
        });
      })(w);
    }
  });
}

function workerMain() {
  var enginePath = process.env.CS_ENGINE || path.join(ROOT, 'core', 'sim.js');
  var engine = require(path.resolve(enginePath));
  process.on('message', function (msg) {
    if (msg.type === 'stop') { process.disconnect(); return; }
    if (msg.type !== 'jobs') return;
    var out = msg.jobs.map(function (j) {
      try { return Object.assign({ k: j.k, ok: true }, runOne(engine, j.config)); }
      catch (e) { return { k: j.k, ok: false, err: String(e && e.message || e).slice(0, 300) }; }
    });
    process.send({ type: 'done', results: out });
  });
  process.send({ type: 'ready' });
}

// ------------------------------------------------------------------ records and the summary
function makeRecords(plan, B, raw) {
  var base = {};
  raw.forEach(function (r) { if (r.job.kind === 'baseline' && r.ok) base[r.job.ci] = r.metrics; });
  var recs = [];
  raw.forEach(function (r) {
    if (r.job.kind !== 'run') return;
    var c = B.concretes[r.job.ci], p = B.points[r.job.gi], m = r.ok ? r.metrics : {};
    if (r.ok && base[r.job.ci]) Object.assign(m, nonNull(metrics.timeLost(m, base[r.job.ci])));
    var th = metrics.thresholdsOf(scenario.deepMerge(plan.base || {}, pathObj(p.point)));
    var v = r.ok ? metrics.verdict(m, th, c.decide) : { pass: false, failed: ['error'], unknown: [] };
    var rec = {
      id: c.id, scenario: c.base, family: c.family, scope: c.scope, reaction: c.reaction, groupKey: c.groupKey,
      label: c.label, variant: c.variant, decide: c.decide, gi: p.gi, params: p.point, study: p.study,
      metrics: m, verdict: v, ms: r.ms, plant: r.plant
    };
    if (p.side) { rec.side = p.side; if (p.param) rec.param = p.param; }
    if (c.mixed) rec.mixed = { L: c.mixed.L, road: c.mixed.road, kind: c.mixed.kind, weight: c.mixed.weight, source: c.mixed.source, hoursTotal: c.mixed.hoursTotal, duration: c.duration };
    if (!r.ok) rec.error = r.err;
    recs.push(rec);
  });
  return recs;
}
function nonNull(o) { var r = {}; Object.keys(o).forEach(function (k) { if (o[k] !== null && o[k] !== undefined) r[k] = o[k]; }); return r; }
function pathObj(point) { var o = {}; Object.keys(point).forEach(function (k) { scenario.setPath(o, k, point[k]); }); return o; }

function severity(m) {
  // higher = worse: a collision (by impact speed) first, then a missed warning, then the smallest time gap
  if (m.collision) return 1000 + (m.impactSpeed_kmh || 0);
  if (m.missedWarning) return 500;
  if (typeof m.minTimeGap_s === 'number') return 100 - 10 * Math.min(10, m.minTimeGap_s);
  return 0;
}

function summarizePoint(recs) {
  var groups = {}, order = [];
  recs.forEach(function (r) {
    if (r.family === 'L') return;
    var g = groups[r.groupKey];
    if (!g) { g = groups[r.groupKey] = { groupKey: r.groupKey, scenario: r.scenario, family: r.family, scope: r.scope, runs: [] }; order.push(r.groupKey); }
    g.runs.push(r);
  });
  var fam = {}, scopes = {}, failing = [], nPass = 0;
  order.forEach(function (k) {
    var g = groups[k], failed = {}, worst = null, worstSev = -1, cases = {};
    g.runs.forEach(function (r) {
      r.verdict.failed.forEach(function (f) { failed[f] = true; });
      var s = severity(r.metrics);
      if (s > worstSev) { worstSev = s; worst = r; }
      var cs = cases[r.reaction] || (cases[r.reaction] = { collision: false, impactSpeed_kmh: 0, runs: 0 });
      cs.runs++;
      if (r.metrics.collision) { cs.collision = true; cs.impactSpeed_kmh = Math.max(cs.impactSpeed_kmh, r.metrics.impactSpeed_kmh || 0); }
    });
    var pass = g.runs.every(function (r) { return r.verdict.pass; });
    if (pass) nPass++;
    var F = fam[g.family] || (fam[g.family] = { groups: 0, pass: 0 });
    F.groups++; if (pass) F.pass++;
    var Sc = scopes[g.scope] || (scopes[g.scope] = { groups: 0, pass: 0 });
    Sc.groups++; if (pass) Sc.pass++;
    if (!pass) failing.push({ groupKey: k, scenario: g.scenario, family: g.family, scope: g.scope, failed: Object.keys(failed),
      worstRun: worst.id, severity: worstSev, cases: cases, worst: pick(worst.metrics) });
  });
  Object.keys(fam).forEach(function (f) { fam[f].share = fam[f].pass / fam[f].groups; });
  Object.keys(scopes).forEach(function (f) { scopes[f].share = scopes[f].pass / scopes[f].groups; });
  failing.sort(function (a, b) { return b.severity - a.severity; });
  // family L
  var perHour = {}, byL = {};
  recs.forEach(function (r) { if (r.mixed) (byL[r.mixed.L] = byL[r.mixed.L] || []).push(r); });
  Object.keys(byL).forEach(function (L) {
    perHour[L] = mixed.aggregate(byL[L].map(function (r) {
      return { concrete: { id: r.id, reaction: r.reaction, duration: r.mixed.duration, mixed: r.mixed }, metrics: r.metrics };
    }));
  });
  // what it costs: means over the in-scope runs (comfort, chatter, time lost)
  var cost = {};
  ['accelRms_mps2', 'peakJerk_mps3', 'peakDecel_mps2', 'setpointChangesAvgPerMin', 'timeLostPct', 'warnCount'].forEach(function (k) {
    var v = recs.filter(function (r) { return r.scope === 'in' && r.family !== 'L' && typeof r.metrics[k] === 'number'; }).map(function (r) { return r.metrics[k]; });
    cost[k] = v.length ? Math.round(1000 * v.reduce(function (a, b) { return a + b; }, 0) / v.length) / 1000 : null;
  });
  return {
    cost: cost,
    runs: recs.length, runsPass: recs.filter(function (r) { return r.verdict.pass; }).length,
    groups: order.length, groupsPass: nPass, passShare: order.length ? nPass / order.length : null,
    families: fam, scopes: scopes, failing: failing.slice(0, 40), failingCount: failing.length,
    leadBrakeHandled_mps2: leadBrakeHandled(recs), perHour: perHour,
    errors: recs.filter(function (r) { return r.error; }).slice(0, 5).map(function (r) { return r.id + ': ' + r.error; })
  };
}
function pick(m) {
  var keys = ['collision', 'impactSpeed_kmh', 'minGap_m', 'minTimeGap_s', 'minTTC_s', 'warnCount', 'warnLeadTime_s', 'missedWarning',
    'nuisanceWarnings', 'peakDecel_mps2', 'setpointChangesPerMin', 'oscGain', 'faultDetectDelay_s', 'envelopeExitAnnounced'];
  var o = {};
  keys.forEach(function (k) { if (m[k] !== undefined) o[k] = m[k]; });
  return o;
}
// the hardest lead deceleration such that every D.brake / D.brake.hard variant at it and below passes its no-reaction run
// with no collision and no warning
function leadBrakeHandled(recs) {
  var byA = {};
  recs.forEach(function (r) {
    if ((r.scenario !== 'D.brake' && r.scenario !== 'D.brake.hard') || r.reaction !== 'none') return;
    var a = Math.abs(r.variant.a !== undefined ? r.variant.a : r.variant['params.a']);
    if (!(a > 0)) return;
    var ok = !r.metrics.collision && !(r.metrics.warnCount > 0);
    byA[a] = (byA[a] === undefined ? true : byA[a]) && ok;
  });
  var as = Object.keys(byA).map(Number).sort(function (a, b) { return a - b; }), best = 0;
  for (var i = 0; i < as.length; i++) { if (!byA[as[i]]) break; best = as[i]; }
  return as.length ? best : null;
}

function summarize(plan, B, recs) {
  var byPt = B.points.map(function () { return []; });
  recs.forEach(function (r) { byPt[r.gi].push(r); });
  var byPoint = B.points.map(function (p, i) {
    var s = summarizePoint(byPt[i]);
    s.gi = i; s.point = p.point; s.label = p.label; s.study = p.study; s.preset = p.preset;
    if (p.side) { s.side = p.side; s.param = p.param; }
    return s;
  });
  var mainPts = byPoint.filter(function (s) { return s.study !== 'tornado'; });
  var out = { byPoint: byPoint, maps: maps(plan, mainPts), ranking: ranking(plan, mainPts), tornado: tornado(byPoint) };
  var plants = recs.map(function (r) { return r.plant; }).filter(Boolean);
  out.plant = plants.length ? { name: plants[0].name, assumed: plants.some(function (p) { return p.assumed; }) } : { name: 'unknown', assumed: true };
  out.totals = { runs: recs.length, errors: recs.filter(function (r) { return r.error; }).length, points: B.points.length, scenarios: B.ids.length,
    variants: B.concretes.length, ms: recs.reduce(function (a, r) { return a + (r.ms || 0); }, 0) };
  return out;
}
function axes(plan) {
  var ax = Object.keys(plan.grid || {});
  (plan.gridCases || []).forEach(function (c) { Object.keys(c).forEach(function (k) { if (ax.indexOf(k) < 0) ax.push(k); }); });
  return ax;
}
function uniq(vals) {
  var out = [];
  vals.forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); });
  return out.sort(function (a, b) { return typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : 1; });
}
function maps(plan, pts) {
  if (!plan.map || !pts.length) return [];
  var X = plan.map.x, Y = plan.map.y, Sp = plan.map.split;
  var splits = Sp ? uniq(pts.map(function (p) { return p.point[Sp]; })) : [null];
  return splits.map(function (sv) {
    var sel = pts.filter(function (p) { return !Sp || p.point[Sp] === sv; });
    var xs = uniq(sel.map(function (p) { return p.point[X]; })), ys = uniq(sel.map(function (p) { return p.point[Y]; }));
    var cells = ys.map(function (y) {
      return xs.map(function (x) {
        var c = sel.filter(function (p) { return p.point[X] === x && p.point[Y] === y; });
        if (!c.length) return null;
        return c.reduce(function (a, p) { return a + p.passShare; }, 0) / c.length;
      });
    });
    var fams = {};
    sel.forEach(function (p) {
      Object.keys(p.families).forEach(function (f) {
        fams[f] = fams[f] || ys.map(function () { return xs.map(function () { return []; }); });
        fams[f][ys.indexOf(p.point[Y])][xs.indexOf(p.point[X])].push(p.families[f].share);
      });
    });
    Object.keys(fams).forEach(function (f) {
      fams[f] = fams[f].map(function (row) { return row.map(function (l) { return l.length ? l.reduce(function (a, b) { return a + b; }, 0) / l.length : null; }); });
    });
    var marks = {};
    Object.keys(plan.presets || {}).forEach(function (n) {
      var pp = plan.presets[n];
      if (pp[X] !== undefined && pp[Y] !== undefined) marks[n] = { x: pp[X], y: pp[Y] };
    });
    return { x: X, y: Y, split: Sp || null, splitValue: sv, xs: xs, ys: ys, cells: cells, families: fams, presets: marks };
  });
}
function ranking(plan, pts) {
  return axes(plan).map(function (ax) {
    var vals = uniq(pts.map(function (p) { return p.point[ax]; })).filter(function (v) { return v !== undefined; });
    var means = vals.map(function (v) {
      var sel = pts.filter(function (p) { return p.point[ax] === v; });
      return { value: v, share: sel.reduce(function (a, p) { return a + p.passShare; }, 0) / sel.length };
    });
    var sh = means.map(function (m) { return m.share; });
    return { param: ax, spread: sh.length ? Math.max.apply(null, sh) - Math.min.apply(null, sh) : 0, byValue: means };
  }).filter(function (r) { return r.byValue.length > 1; }).sort(function (a, b) { return b.spread - a.spread; });
}
function tornado(byPoint) {
  var base = byPoint.filter(function (p) { return p.study === 'tornado' && p.side === 'base'; })[0];
  if (!base) return [];
  var rows = {};
  byPoint.forEach(function (p) {
    if (p.study !== 'tornado' || p.side === 'base') return;
    var r = rows[p.param] || (rows[p.param] = { param: p.param, base: base.passShare });
    r[p.side] = p.passShare;
    r[p.side + 'Value'] = p.point[p.param];
    r[p.side + 'Failing'] = p.failing.slice(0, 5).map(function (f) { return f.groupKey; });
  });
  return Object.keys(rows).map(function (k) {
    var r = rows[k];
    r.swing = Math.max(Math.abs((r.low || 0) - r.base), Math.abs((r.high || 0) - r.base));
    r.flips = (r.low !== undefined && r.low !== r.base) || (r.high !== undefined && r.high !== r.base);
    return r;
  }).sort(function (a, b) { return b.swing - a.swing; });
}

// ------------------------------------------------------------------ files
function stamp() {
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function writeOutputs(plan, B, recs, summary, outRoot) {
  var dir = path.join(outRoot, plan.name + '-' + stamp());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 1) + '\n');
  var fd = fs.openSync(path.join(dir, 'runs.jsonl'), 'w');
  recs.forEach(function (r) { fs.writeSync(fd, JSON.stringify(r) + '\n'); });
  fs.closeSync(fd);
  var presetGi = B.points.filter(function (p) { return p.preset; }).map(function (p) { return p.gi; });
  var keep = recs.length <= KEEP_ALL_RUNS ? recs : recs.filter(function (r) { return presetGi.indexOf(r.gi) >= 0; });
  var presets = {};
  B.points.forEach(function (p) { if (p.preset) presets[p.preset] = p.point; });
  Object.keys(plan.presets || {}).forEach(function (n) { if (!presets[n]) presets[n] = plan.presets[n]; });
  var batch = {
    kind: 'cs-batch', version: 1, created: new Date().toISOString(), base: plan.base || {}, plant: summary.plant, plan: plan,
    presets: presets, runsKept: keep.length === recs.length ? 'all' : 'presets', runs: keep, summary: summary
  };
  fs.writeFileSync(path.join(dir, 'batch.json'), JSON.stringify(batch));
  fs.writeFileSync(path.join(outRoot, plan.name + '.latest'), path.basename(dir) + '\n');
  return dir;
}

function headline(plan, summary) {
  var lines = [];
  var asm = summary.plant.assumed ? 'with an assumed plant' : 'with the identified plant ' + summary.plant.name;
  lines.push(plan.name + ' (' + asm + '): ' + summary.totals.runs + ' runs, ' + summary.totals.points + ' points, ' + summary.totals.errors + ' errors');
  summary.byPoint.forEach(function (p) {
    if (p.study === 'tornado' && p.side !== 'base') return;
    lines.push('  ' + (p.preset ? '[' + p.preset + '] ' : '') + p.label + ': ' + p.groupsPass + ' / ' + p.groups + ' groups pass (' +
      (p.passShare === null ? '-' : (100 * p.passShare).toFixed(0)) + ' %)' +
      (p.leadBrakeHandled_mps2 !== null ? ', lead braking handled without a warning up to ' + p.leadBrakeHandled_mps2 + ' m/s²' : ''));
  });
  if (summary.ranking.length) lines.push('  the verdict moves most with: ' + summary.ranking.slice(0, 5).map(function (r) { return r.param + ' (±' + (100 * r.spread).toFixed(0) + ' pts)'; }).join(', '));
  return lines.join('\n');
}

// ------------------------------------------------------------------ main
function parseArgs(argv) {
  var o = { _: [] };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--workers') o.workers = parseInt(argv[++i], 10);
    else if (a === '--engine') o.engine = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--limit') o.limit = parseInt(argv[++i], 10);
    else if (a === '--dry') o.dry = true;
    else if (a === '--quiet') o.quiet = true;
    else o._.push(a);
  }
  return o;
}
function main() {
  var args = parseArgs(process.argv.slice(2));
  if (!args._[0]) { console.error('usage: node tools/cruise-sim/sweep.js <plan.json> [--workers N] [--engine <module>] [--out <dir>] [--limit N] [--dry]'); process.exit(2); }
  var plan = JSON.parse(fs.readFileSync(args._[0], 'utf8'));
  plan.name = plan.name || path.basename(args._[0], '.json');
  var B = buildJobs(plan);
  var byFam = {};
  B.concretes.forEach(function (c) { byFam[c.family] = (byFam[c.family] || 0) + 1; });
  console.error(plan.name + ': ' + B.ids.length + ' scenarios, ' + B.concretes.length + ' variants ' + JSON.stringify(byFam) + ', ' +
    B.points.length + ' points, ' + B.jobs.length + ' runs');
  if (args.dry) return;
  if (!args.engine && !fs.existsSync(path.join(ROOT, 'core', 'sim.js'))) {
    console.error('core/sim.js (SC1) is missing on this branch: merge cruise-sim/sc1 or pass --engine <module with run(config)>');
    process.exit(2);
  }
  var t0 = Date.now();
  runJobs(plan, B, { workers: args.workers, engine: args.engine, limit: args.limit, quiet: args.quiet }).then(function (raw) {
    if (args.limit) B.jobs = B.jobs.slice(0, args.limit);
    var recs = makeRecords(plan, B, raw);
    var summary = summarize(plan, B, recs);
    summary.totals.wall_s = (Date.now() - t0) / 1000;
    var dir = writeOutputs(plan, B, recs, summary, args.out || OUT_ROOT);
    console.log(headline(plan, summary));
    console.log('  wrote ' + dir + ' (' + summary.totals.wall_s.toFixed(0) + ' s)');
  }).catch(function (e) { console.error(e.stack || e); process.exit(1); });
}

module.exports = {
  selectScenarios: selectScenarios, buildPoints: buildPoints, buildJobs: buildJobs, jobConfig: jobConfig, configFor: configFor,
  runJobs: runJobs, runOne: runOne, makeRecords: makeRecords, summarize: summarize, summarizePoint: summarizePoint,
  leadBrakeHandled: leadBrakeHandled, writeOutputs: writeOutputs, headline: headline, severity: severity, thin: thin, OUT_ROOT: OUT_ROOT
};
if (require.main === module) {
  if (process.argv[2] === '--worker') workerMain(); else main();
}
