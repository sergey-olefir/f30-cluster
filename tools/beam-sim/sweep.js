#!/usr/bin/env node
'use strict';
// The beam simulator's sweep runner: the library over config variants, one table of totals per variant, and the
// sensitivity of glare and missed light to each parameter (one at a time, low and high around the default).
//
//   node tools/beam-sim/sweep.js                         the default sensitivity plan (below), seeds 1,2,3
//   node tools/beam-sim/sweep.js --plan plan.json        { name, seeds, base: {config}, variants: [ { label, config } ] }
//                                                        or { name, seeds, grid: { 'zone.head_m': [..], 'timing.clearHead_ms': [..] } }
//   node tools/beam-sim/sweep.js --quick                 seed 1 only
//   --out <dir>                                          default bake/work/beam-sim (git-ignored): sweep-<name>.json / .html / .md
const fs = require('fs');
const path = require('path');
const SC = require('./core/scenario');
const BATCH = require('./core/batch');
const B = require('../../shared/beam_logic');
const REPORT = require('./report');

/** The default sensitivity plan: each parameter at a low and a high value, everything else at the default. */
const SENS = [
  ['zone.head_m', 300, 500], ['zone.tail_m', 150, 260], ['zone.edge_deg', 13, 24], ['zone.returnMargin', 1, 1.6], ['zone.other_m', 120, 300],
  ['confirm.weakFrames', 0, 3], ['timing.clearHead_ms', 700, 3000], ['timing.clearTail_ms', 1200, 4500], ['timing.minLow_ms', 800, 4000],
  ['timing.flickerExtra_ms', 0, 5000], ['street.count', 2, 5], ['dark.onHold_ms', 3000, 15000], ['curve.mode', 'off', 'dip'], ['curve.yaw_dps', 3, 10], ['zone.reflector', null, 'other'],
];
// sensor variants: not the algorithm's parameters, but what the car may turn out to be
const SENSOR = [['latency_ms', 30, 250], ['miss', 0, 0.15], ['falseRate', 0, 0.5], ['reflMisclass', 0, 0.3], ['rangeScale', 0.6, 1.4]];

function setPath(o, k, v) { const ks = k.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) { c[ks[i]] = c[ks[i]] || {}; c = c[ks[i]]; } c[ks[ks.length - 1]] = v; return o; }

function planDefault(seeds) {
  const variants = [{ label: 'default', config: {} }];
  SENS.forEach((p) => { [p[1], p[2]].forEach((v, k) => { if (v !== null) variants.push({ label: p[0] + '=' + v, param: p[0], side: k ? 'high' : 'low', config: setPath({}, p[0], v) }); }); });
  SENSOR.forEach((p) => { [p[1], p[2]].forEach((v, k) => variants.push({ label: 'sensor.' + p[0] + '=' + v, param: 'sensor.' + p[0], side: k ? 'high' : 'low', sensor: setPath({}, p[0], v) })); });
  return { name: 'sensitivity', seeds: seeds, variants: variants };
}
function planGrid(p) {
  const keys = Object.keys(p.grid);
  let combos = [{}];
  keys.forEach((k) => { const n = []; combos.forEach((c) => p.grid[k].forEach((v) => n.push(Object.assign({}, c, { [k]: v })))); combos = n; });
  return { name: p.name || 'grid', seeds: p.seeds || [1], variants: combos.map((c) => {
    const cfg = B.mergePartial({}, p.base || {});
    Object.keys(c).forEach((k) => setPath(cfg, k, c[k]));
    return { label: Object.keys(c).map((k) => k + '=' + c[k]).join(' '), config: cfg };
  }) };
}

function run(plan, scenarios, log) {
  const out = [];
  plan.variants.forEach((v) => {
    const r = BATCH.runAll({ scenarios: scenarios, seeds: plan.seeds, config: B.mergePartial(plan.base || {}, v.config || {}), sensor: v.sensor });
    out.push({ label: v.label, param: v.param, side: v.side, totals: r.core, all: r.totals, failed: r.rows.filter((x) => !x.verdict.pass).map((x) => x.id + '#' + x.seed) });
    if (log) log(v.label.padEnd(36) + ' glareW ' + String(r.core.glareW).padEnd(8) + ' missed ' + String(r.core.missed_s).padEnd(8) + ' sw/km ' +
      String(r.core.switchesPerKm).padEnd(6) + ' agree ' + String(r.core.agreeRef).padEnd(6) + ' fails ' + r.totals.fails + ' inv ' + r.totals.invariants + '  (core totals; with the limit scenarios glareW ' + r.totals.glareW + ')');
  });
  return out;
}

/** Sensitivity: for each parameter, the spread (high - low) of glare and of missed light, ranked. */
function sensitivity(rows) {
  const by = {};
  rows.forEach((r) => { if (!r.param) return; by[r.param] = by[r.param] || {}; by[r.param][r.side] = r.totals; });
  const def = rows.filter((r) => r.label === 'default')[0].totals;
  const list = Object.keys(by).map((p) => {
    const lo = by[p].low || def, hi = by[p].high || def;
    return { param: p, dGlare: Math.round((Math.max(lo.glareW, hi.glareW, def.glareW) - Math.min(lo.glareW, hi.glareW, def.glareW)) * 1000) / 1000,
      dMissed: Math.round((Math.max(lo.missed_s, hi.missed_s, def.missed_s) - Math.min(lo.missed_s, hi.missed_s, def.missed_s)) * 1000) / 1000,
      dSwitch: Math.round((Math.max(lo.switchesPerKm, hi.switchesPerKm, def.switchesPerKm) - Math.min(lo.switchesPerKm, hi.switchesPerKm, def.switchesPerKm)) * 1000) / 1000,
      low: lo, high: hi };
  });
  return { glare: list.slice().sort((a, b) => b.dGlare - a.dGlare), missed: list.slice().sort((a, b) => b.dMissed - a.dMissed), def: def };
}

function markdown(plan, rows, sens) {
  let md = '# Sweep "' + plan.name + '" (seeds ' + plan.seeds.join(', ') + '; totals over the core scenarios, without the documented limits)\n\n| variant | glare (w·s) | glare s | missed s | high/allowed | switches/km | agree ref | max reaction ms | fails | invariants |\n|---|---|---|---|---|---|---|---|---|---|\n';
  rows.forEach((r) => { const t = r.totals; md += '| ' + r.label + ' | ' + t.glareW + ' | ' + t.glare_s + ' | ' + t.missed_s + ' | ' + t.highFrac + ' | ' + t.switchesPerKm + ' | ' + t.agreeRef + ' | ' + t.maxReaction_ms + ' | ' + t.fails + ' | ' + t.invariants + ' |\n'; });
  if (sens) {
    md += '\n## Sensitivity: spread of the total over low / default / high\n\n| rank | glare: parameter | Δ glare | missed light: parameter | Δ missed s |\n|---|---|---|---|---|\n';
    for (let i = 0; i < sens.glare.length; i++) md += '| ' + (i + 1) + ' | ' + sens.glare[i].param + ' | ' + sens.glare[i].dGlare + ' | ' + sens.missed[i].param + ' | ' + sens.missed[i].dMissed + ' |\n';
  }
  return md;
}

function main() {
  const argv = process.argv.slice(2);
  let out = path.join(__dirname, '..', '..', 'bake', 'work', 'beam-sim');
  let plan = null;
  let seeds = [1, 2, 3];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan') { const p = JSON.parse(fs.readFileSync(argv[++i], 'utf8')); plan = p.grid ? planGrid(p) : p; }
    else if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--quick') seeds = [1];
  }
  if (!plan) plan = planDefault(seeds);
  if (!plan.seeds) plan.seeds = seeds;
  const scenarios = SC.list().map((l) => SC.load(l.id)).filter((s) => !!s.world);
  const t0 = Date.now();
  const rows = run(plan, scenarios, console.log);
  const sens = rows.some((r) => r.param) ? sensitivity(rows) : null;
  const md = markdown(plan, rows, sens);
  fs.mkdirSync(out, { recursive: true });
  const base = path.join(out, 'sweep-' + plan.name);
  fs.writeFileSync(base + '.json', JSON.stringify({ plan: plan, rows: rows, sensitivity: sens }, null, 1));
  fs.writeFileSync(base + '.md', md);
  const html = '<h1>Sweep ' + plan.name + '</h1><pre style="white-space:pre-wrap">' + md.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
  fs.writeFileSync(base + '.html', REPORT.page('Beam sweep ' + plan.name, html));
  if (sens) {
    console.log('\nglare, most sensitive: ' + sens.glare.slice(0, 3).map((x) => x.param + ' (' + x.dGlare + ')').join(', '));
    console.log('missed light, most sensitive: ' + sens.missed.slice(0, 3).map((x) => x.param + ' (' + x.dMissed + ' s)').join(', '));
  }
  console.log('wrote ' + base + '.{json,md,html}  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
}

if (require.main === module) main();
module.exports = { planDefault: planDefault, planGrid: planGrid, run: run, sensitivity: sensitivity, markdown: markdown, SENS: SENS };
