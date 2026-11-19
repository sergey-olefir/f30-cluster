'use strict';
// Failure injection (SC1), at a given time or at the worst time.
//
//   failures.create(list, rng, ctx) -> { apply(world, t) -> faults, consume(kind, t), list }
//     list = config.failures plus the scenario's { t, kind: 'fault', fault: <kind>, ... } events
//     ctx = { emit, duration }
//   failures.searchWorst(config, runOnce, opts) -> { config /* concrete */, result, search: { at, score, scored, runs, by } }
//   failures.severity(result) -> number (higher = worse): the default objective of the search
//
// A failure: { kind, at /* s, or 'worst' */, duration /* s; omitted = the kind's default */, ...kind options }.
//   appStop        the app stops: no estimate, no command, no warning              default duration: to the end
//   huRestart      the head unit restarts: the same, the command path is emptied, and the app comes back fresh after
//                  `duration` (default: drawn uniformly in [restartMin_s 30, restartMax_s 60])
//   gapFreeze      the sensor repeats its last sample (sim.js enforces it on whatever the sensor delivers)   default 10 s
//   sensorBlind    no target: { mode: 'invalid' (valid: false samples, the default) | 'silent' (no samples) }   default 10 s
//   commandLost    { mode: 'nextDecrease' (the default: the first decrease sent after `at` is lost) | 'all' (every
//                  command in the window) }                                         default: until used / to the end
//   setStuck       the cruise ignores every new set speed, silently                 default: to the end
//   cruiseDropout  the cruise switches itself off (once, at `at`; the driver may resume it)
//   stall          the head unit pauses (the app does not run, nothing is delivered) default 1 s
// world.faults = { appDead, restart, sensorBlind, blindMode, gapFrozen, commandsLost, setStuck, cruiseDropout, stalled,
//                  active: [kinds] }; fault.on / fault.off events carry { fault, id, ... }.
//
// 'worst': a search over the injection time for the worst outcome, not one hand-picked moment. A coarse pass over
// [window[0], window[1]] (default [1, duration - 1]) every searchStep_s (default 1 s), then a fine pass of searchStep_s / 5
// around the worst coarse point. The objective is opts.score(result) or the failure's worstBy (a metric name of
// result.metrics or result.meta.core, lower = worse, e.g. 'minTimeGap'), else severity(): a collision first (by impact
// speed), then the smallest true gap, then the smallest TTC. One failure per run may be 'worst'.

const KINDS = {
  appStop: { duration: Infinity },
  huRestart: { duration: null },
  gapFreeze: { duration: 10 },
  sensorBlind: { duration: 10 },
  commandLost: { duration: Infinity },
  setStuck: { duration: Infinity },
  cruiseDropout: { duration: 0 },
  stall: { duration: 1 },
};

function normalize(list, scenEvents) {
  const out = [];
  (list || []).forEach(f => out.push(Object.assign({}, f)));
  (scenEvents || []).filter(e => e.kind === 'fault').forEach(e => {
    const f = Object.assign({}, e);
    f.kind = e.fault || e.type;
    if (f.at === undefined) f.at = e.t;
    delete f.fault; delete f.type; delete f.t;
    out.push(f);
  });
  for (const f of out) {
    if (!KINDS[f.kind]) throw new Error('failure: unknown kind ' + JSON.stringify(f.kind) + ' (one of ' + Object.keys(KINDS).join(', ') + ')');
    if (f.at === undefined || f.at === null) throw new Error('failure ' + f.kind + ': needs at (s or "worst")');
    if (f.at !== 'worst' && typeof f.at !== 'number') throw new Error('failure ' + f.kind + ': at must be a number or "worst"');
  }
  return out;
}

function create(list, rng, ctx) {
  ctx = ctx || {};
  const emit = ctx.emit || function () {};
  const fs = normalize(list, ctx.scenarioEvents).map((f, i) => {
    if (f.at === 'worst') throw new Error('failure ' + f.kind + ' at "worst": resolve it with failures.searchWorst (sim.run does)');
    let d = f.duration !== undefined && f.duration !== null ? f.duration : KINDS[f.kind].duration;
    if (f.kind === 'huRestart' && (d === null || d === undefined)) d = rng.uniform(f.restartMin_s || 30, f.restartMax_s || 60);
    return Object.assign({}, f, { id: i, t0: f.at, t1: f.at + d, on: false, used: false, dur: d });
  });

  function consume(kind, t) {
    for (const f of fs) if (f.kind === kind && f.on && !f.used) { f.used = true; return true; }
    return false;
  }

  function apply(world, t) {
    const faults = { appDead: false, restart: false, sensorBlind: false, blindMode: null, gapFrozen: false, commandsLost: null,
      setStuck: false, cruiseDropout: false, stalled: false, active: [] };
    for (const f of fs) {
      let on = t >= f.t0 - 1e-9 && (t < f.t1 - 1e-9 || (f.dur === 0 && !f.pulsed));
      if (f.kind === 'commandLost' && (f.mode || 'nextDecrease') === 'nextDecrease' && f.used) on = false;
      if (on && f.dur === 0) f.pulsed = true;
      if (on !== f.on) {
        f.on = on;
        if (on) emit('fault.on', { fault: f.kind, id: f.id, duration: isFinite(f.dur) ? f.dur : null, mode: f.mode }, t);
        else emit('fault.off', { fault: f.kind, id: f.id }, t);
      }
      if (!on) continue;
      faults.active.push(f.kind);
      switch (f.kind) {
        case 'appStop': faults.appDead = true; break;
        case 'huRestart': faults.appDead = true; faults.restart = true; break;
        case 'gapFreeze': faults.gapFrozen = true; break;
        case 'sensorBlind': faults.sensorBlind = true; faults.blindMode = f.mode || 'invalid'; break;
        case 'commandLost': faults.commandsLost = f.mode || 'nextDecrease'; break;
        case 'setStuck': faults.setStuck = true; break;
        case 'cruiseDropout': faults.cruiseDropout = true; break;
        case 'stall': faults.stalled = true; break;
      }
    }
    return faults;
  }

  return { list: fs, apply, consume };
}

function severity(res) {
  const c = (res.meta && res.meta.core) || res.metrics || {};
  if (c.collision) return 1e6 + 1e3 * (c.impactSpeed || 0);
  const fin = v => typeof v === 'number' && isFinite(v);
  const g = fin(c.minGap) ? c.minGap : 1e4;
  const ttc = fin(c.minTTC) ? Math.min(c.minTTC, 100) : 100;
  return 1e4 - g - 0.01 * ttc;
}

function metricOf(res, name) {
  if (res.metrics && typeof res.metrics[name] === 'number') return res.metrics[name];
  if (res.meta && res.meta.core && typeof res.meta.core[name] === 'number') return res.meta.core[name];
  return NaN;
}

function searchWorst(config, runOnce, opts) {
  opts = opts || {};
  const fl = config.failures || [];
  const idx = [];
  fl.forEach((f, i) => { if (f.at === 'worst') idx.push(i); });
  if (!idx.length) { const r = runOnce(config); return { config, result: r, search: null }; }
  if (idx.length > 1) throw new Error('failures: only one failure per run may be at "worst"');
  const i = idx[0], f = fl[i];
  const score = opts.score || (f.worstBy ? (r => { const v = metricOf(r, f.worstBy); return isFinite(v) ? -v : -1e9; }) : severity);
  const without = Object.assign({}, config, { failures: fl.filter((_, j) => j !== i) });
  const base = runOnce(without);
  const duration = base.meta.duration;
  const win = f.window || [1, Math.max(1, duration - 1)];
  const step = f.searchStep_s || 1;
  const scored = [];
  let best = null;
  function at(tInj) {
    tInj = Math.round(tInj * 1000) / 1000;
    for (const s of scored) if (s[0] === tInj) return s;
    const c = Object.assign({}, config, { failures: fl.map((g, j) => j === i ? Object.assign({}, g, { at: tInj }) : g) });
    const r = runOnce(c);
    const s = [tInj, score(r), r, c];
    scored.push(s);
    if (!best || s[1] > best[1]) best = s;
    return s;
  }
  for (let t = win[0]; t <= win[1] + 1e-9; t += step) at(t);
  const centre = best[0];
  for (let t = Math.max(win[0], centre - step); t <= Math.min(win[1], centre + step) + 1e-9; t += step / 5) at(t);
  return {
    config: best[3], result: best[2],
    search: { fault: f.kind, at: best[0], score: best[1], by: opts.score ? 'custom' : (f.worstBy || 'severity'),
      runs: scored.length, window: win, scored: scored.map(s => [s[0], s[1]]).sort((a, b) => a[0] - b[0]), baseline: severity(base) },
  };
}

const failures = { NAME: 'failures', SCHEMA: [], KINDS, create, normalize, searchWorst, severity };
if (typeof module !== 'undefined') module.exports = failures; else (self.CS = self.CS || {})['failures'] = failures;
