#!/usr/bin/env node
'use strict';
// The beam simulator's HTML report: every scenario's metrics, pass / fail and timeline, with the totals.
// A recorded drive (a frames scenario from the capture tool) is replayed and shown against the driver and the camera.
//
//   node tools/beam-sim/report.js                       the library, seed 1 -> bake/work/beam-sim/report.html
//   node tools/beam-sim/report.js --seeds 1,2,3         totals over three seeds (timelines of the first)
//   node tools/beam-sim/report.js --scenario <id|path>  one scenario or a recorded drive (replay) -> report-<id>.html
//   node tools/beam-sim/report.js --config cfg.json     a partial beam_logic config over the defaults
//   --out <dir>                                         another output folder (default bake/work/beam-sim, git-ignored)
const fs = require('fs');
const path = require('path');
const SC = require('./core/scenario');
const SIM = require('./core/sim');
const BATCH = require('./core/batch');
const TL = require('./ui/timeline');
const B = require('../../shared/beam_logic');

function args(argv) {
  const a = { seeds: [1], scenario: null, out: path.join(__dirname, '..', '..', 'bake', 'work', 'beam-sim'), config: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seeds') a.seeds = argv[++i].split(',').map(Number);
    else if (argv[i] === '--scenario') a.scenario = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--config') a.config = JSON.parse(fs.readFileSync(argv[++i], 'utf8'));
  }
  return a;
}

const COLS = [['glareW', 'glare (w·s)'], ['glare_s', 'glare s'], ['maxReaction_ms', 'reaction ms'], ['missed_s', 'missed s'], ['highFrac', 'high / allowed'],
  ['switches', 'switches'], ['switchesPerKm', '/km'], ['minDwell_ms', 'min dwell ms'], ['agreeRef', 'agree ref'], ['refGlareW', 'ref glare'], ['refMissed_s', 'ref missed']];
const fmt = (v) => (v === null || v === undefined ? '–' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

function page(title, body) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + TL.esc(title) + '</title><style>' +
    ':root{--bg:#fff;--fg:#1d2330;--mut:#6b7380;--line:#dfe3e8;--pass:#2e7d4f;--fail:#b3261e}' +
    '@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e6e9ee;--mut:#9aa3ae;--line:#2c323b}}' +
    'body{font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:16px;max-width:1200px}' +
    'table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{border-bottom:1px solid var(--line);padding:3px 6px;text-align:right}' +
    'td:first-child,th:first-child{text-align:left}.pass{color:var(--pass)}.fail{color:var(--fail);font-weight:600}.mut{color:var(--mut)}' +
    '.tl-label,.tl-axis{font-size:10px;fill:var(--mut)}.tl-bg{fill:none;stroke:var(--line)}.tl-cursor{stroke:var(--fg)}section{margin:18px 0}' +
    '.wrap{overflow-x:auto}</style></head><body>' + body + '</body></html>';
}

function table(rows) {
  let h = '<div class="wrap"><table><tr><th>scenario</th><th>seed</th>' + COLS.map((c) => '<th>' + c[1] + '</th>').join('') + '<th>verdict</th></tr>';
  rows.forEach((r) => {
    h += '<tr><td><a href="#' + r.id + '">' + r.id + '</a></td><td>' + r.seed + '</td>' + COLS.map((c) => '<td>' + fmt(r.metrics[c[0]]) + '</td>').join('') +
      '<td class="' + (r.verdict.pass ? 'pass">pass' : 'fail">' + TL.esc(r.verdict.failed.join(', '))) + '</td></tr>';
  });
  return h + '</table></div>';
}

function main() {
  const a = args(process.argv.slice(2));
  fs.mkdirSync(a.out, { recursive: true });
  if (a.scenario) {
    const s = SC.load(a.scenario);
    const r = SIM.run(s, { seed: a.seeds[0], config: a.config });
    const isRec = !!r.meta.replay;
    const m = r.metrics;
    let body = '<h1>' + TL.esc(s.name || s.id) + '</h1><p class="mut">' + TL.esc(s.purpose || '') + ' · ' + (isRec ? 'replay of ' + s.frames.length + ' frames' : 'seed ' + r.meta.seed) +
      ' · mode ' + r.meta.mode + '</p>';
    body += TL.svg(r, { width: 1100, driverLabel: isRec ? 'recorded driver: high' : 'reference driver: high' });
    body += '<section><table>' + Object.keys(m).map((k) => '<tr><td>' + k + '</td><td>' + fmt(m[k]) + '</td></tr>').join('') + '</table></section>';
    body += '<section><h2>Switches</h2><table><tr><th>t (s)</th><th>advice</th><th>state</th><th>reason</th><th>cause id</th></tr>' +
      r.events.filter((e) => e.kind === 'switch').map((e) => '<tr><td>' + e.t.toFixed(1) + '</td><td>' + e.want + '</td><td>' + e.state + '</td><td>' + e.reason + '</td><td>' + fmt(e.cause) + '</td></tr>').join('') + '</table></section>';
    const file = path.join(a.out, 'report-' + String(s.id).replace(/[^\w.-]/g, '_') + '.html');
    fs.writeFileSync(file, page('Beam run ' + s.id, body));
    console.log('wrote ' + file + '  ' + (r.verdict.pass ? 'pass' : 'FAIL ' + r.verdict.failed.join(', ')));
    return;
  }
  const scenarios = SC.list().map((l) => SC.load(l.id));
  const t0 = Date.now();
  const res = BATCH.runAll({ scenarios: scenarios, seeds: a.seeds, config: a.config });
  const T = res.totals;
  let body = '<h1>Beam simulator — the scenario library</h1><p class="mut">' + scenarios.length + ' scenarios × seeds ' + a.seeds.join(', ') +
    ' · beam_logic v' + B.VERSION + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s</p>';
  const C = res.core;
  body += '<section><h2>Totals</h2><p class="mut">core = without the scenarios that document a known limit of a light camera (' +
    scenarios.filter((s) => s.limit).map((s) => s.id).join(', ') + ')</p><table><tr><th></th><th>core</th><th>all</th></tr>' +
    Object.keys(T).map((k) => '<tr><td>' + k + '</td><td>' + fmt(C[k]) + '</td><td>' + fmt(T[k]) + '</td></tr>').join('') + '</table></section>';
  body += '<section><h2>Per scenario</h2>' + table(res.rows) + '</section>';
  scenarios.forEach((s) => {
    const r = SIM.run(s, { seed: a.seeds[0], config: a.config });
    body += '<section id="' + s.id + '"><h3>' + s.id + ' — ' + TL.esc(s.name) + '</h3><p class="mut">' + TL.esc(s.purpose) + '</p>' + TL.svg(r, { width: 1100 }) + '</section>';
  });
  const file = path.join(a.out, 'report.html');
  fs.writeFileSync(file, page('Beam simulator report', body));
  fs.writeFileSync(path.join(a.out, 'report.json'), JSON.stringify({ seeds: a.seeds, totals: T, core: C, rows: res.rows.map((r) => ({ id: r.id, seed: r.seed, metrics: r.metrics, verdict: r.verdict })) }, null, 1));
  console.log('wrote ' + file);
  console.log('core totals: ' + JSON.stringify(C));
  console.log('all totals:  ' + JSON.stringify(T));
  process.exitCode = T.fails || T.invariants ? 1 : 0;
}

if (require.main === module) main();
module.exports = { page: page, table: table };
