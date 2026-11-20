'use strict';
// The batch, the sweep, the report and the timeline: they run, they write where they are told (never into git), and
// their numbers agree with single runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { test, assert } = require('./harness');
const SC = require('../core/scenario');
const SIM = require('../core/sim');
const BATCH = require('../core/batch');
const SWEEP = require('../sweep');
const TL = require('../ui/timeline');

const two = [SC.load('B01.oncoming.single'), SC.load('G04.cyclist.unlit')];

test('batch: totals add up the single runs; core leaves out the limit scenarios', () => {
  const r = BATCH.runAll({ scenarios: two, seeds: [1, 2] });
  assert.strictEqual(r.rows.length, 4);
  const sum = r.rows.reduce((a, x) => a + x.metrics.glareW, 0);
  assert.ok(Math.abs(sum - r.totals.glareW) < 0.01);
  assert.strictEqual(r.core.runs, 2);
  assert.ok(r.core.glareW < r.totals.glareW);
  assert.strictEqual(r.rows[0].metrics.glareW, SIM.run(two[0], { seed: 1 }).metrics.glareW);
});

test('sweep: a grid plan expands to every combination; the sensitivity ranks parameters; markdown has a row per variant', () => {
  const plan = SWEEP.planGrid({ name: 't', seeds: [1], grid: { 'zone.head_m': [300, 400], 'timing.clearHead_ms': [1000, 2000] } });
  assert.strictEqual(plan.variants.length, 4);
  assert.strictEqual(plan.variants[3].config.zone.head_m, 400);
  const def = SWEEP.planDefault([1]);
  assert.ok(def.variants.length > 20 && def.variants[0].label === 'default');
  const rows = SWEEP.run({ seeds: [1], variants: def.variants.filter((v) => v.label === 'default' || v.param === 'zone.head_m') }, [two[0]]);
  const sens = SWEEP.sensitivity(rows);
  assert.strictEqual(sens.glare[0].param, 'zone.head_m');
  assert.ok(sens.glare[0].dGlare > 0, 'a shorter oncoming zone costs glare');
  const md = SWEEP.markdown({ name: 't', seeds: [1] }, rows, sens);
  assert.strictEqual(md.split('\n').filter((l) => /^\| zone\.head_m=|^\| default/.test(l)).length, 3);
});

test('report: writes one scenario\'s page and a replay page into the folder it is given', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-report-'));
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'report.js'), '--scenario', 'E02.lit.junction', '--out', dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, 'report-E02.lit.junction.html'), 'utf8');
  assert.ok(html.indexOf('<svg') > 0 && html.indexOf('streetlights') > 0);
  const rec = SIM.exportFrames(SC.load('B01.oncoming.single'), { seed: 2 });
  const f = path.join(dir, 'rec.json');
  fs.writeFileSync(f, JSON.stringify(rec));
  const r2 = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'report.js'), '--scenario', f, '--out', dir], { encoding: 'utf8' });
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.ok(fs.readFileSync(path.join(dir, 'report-B01.oncoming.single.frames.html'), 'utf8').indexOf('replay of') > 0);
});

test('report: a recorded drive in JSON Lines (framesFile) loads and replays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-jsonl-'));
  const rec = SIM.exportFrames(SC.load('E02.lit.junction'), { seed: 1 });
  fs.writeFileSync(path.join(dir, 'drive.jsonl'), rec.frames.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const meta = Object.assign({}, rec, { frames: undefined, framesFile: 'drive.jsonl', source: 'recorded' });
  delete meta.frames;
  fs.writeFileSync(path.join(dir, 'drive.json'), JSON.stringify(meta));
  const s = SC.load(path.join(dir, 'drive.json'));
  assert.strictEqual(s.frames.length, rec.frames.length);
  assert.deepStrictEqual(SC.validate(s), []);
  assert.strictEqual(SIM.run(s).series.want.join(''), SIM.run(rec).series.want.join(''));
});

test('timeline: one svg with a row per signal and a coloured run per state', () => {
  const r = SIM.run(two[0], { seed: 1 });
  const s = TL.svg(r, { cursor: 20 });
  assert.ok(/^<svg/.test(s) && /<\/svg>$/.test(s));
  assert.ok(s.indexOf('DIPPED / oncoming') > 0 && s.indexOf('HIGH / clear') > 0);
  assert.ok(s.indexOf('tl-cursor') > 0);
});

test('outputs go to bake/work/beam-sim, which git ignores', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const r = cp.spawnSync('git', ['check-ignore', '-q', 'bake/work/beam-sim/report.html'], { cwd: root });
  assert.strictEqual(r.status, 0, 'bake/work is ignored');
  ['report.js', 'sweep.js'].forEach((f) => assert.ok(fs.readFileSync(path.join(__dirname, '..', f), 'utf8').indexOf("'bake', 'work', 'beam-sim'") > 0, f));
});
