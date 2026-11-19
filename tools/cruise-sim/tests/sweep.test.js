'use strict';
// SC3: sweep.js (selection, grid, jobs, the worker pool, records and the summary) and report.js.
const fs = require('fs'), path = require('path'), os = require('os');
const { test, assert, near } = require('./harness');
const sweep = require('../sweep');
const report = require('../report');
const sc = require('../core/scenario');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-sc3-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
// a fake engine: no physics; its metrics depend on the plant's aMin and the scenario so the summary has something to do
const FAKE = path.join(TMP, 'fake-engine.js');
fs.writeFileSync(FAKE, `
module.exports = { run: function (cfg) {
  var a = (cfg.plant && cfg.plant.aMin_ms2) || -1, sid = cfg.scenario.inline.base, bad = Math.abs(a) < 1 && /^D\\./.test(sid);
  var ideal = cfg.ego && cfg.ego.mode === 'idealAcc';
  return { meta: { plant: { name: 'fake', assumed: true } }, t: [], series: {}, events: [],
    metrics: { collision: bad, minTimeGap_s: bad ? 0.2 : 1.5, minTTC_s: 8, warnCount: 0, nuisanceWarnings: 0, missedWarning: false,
      setpointChangesPerMin: 5, egoXEnd_m: ideal ? 1010 : 1000, egoVEnd_mps: 25, duration_s: 60, impactSpeed_kmh: bad ? 20 : 0 } };
} };`);

test('selection patterns: *, family letter, prefix*, tag:, scope:, exact id, exclude', () => {
  const all = sweep.selectScenarios({ scenarios: ['*'] });
  assert.strictEqual(all.length, sc.list().length);
  assert.ok(sweep.selectScenarios({ scenarios: ['D'] }).every(id => id[0] === 'D'));
  assert.deepStrictEqual(sweep.selectScenarios({ scenarios: ['D.brake*'] }).sort(), sc.list().map(e => e.id).filter(id => id.indexOf('D.brake') === 0).sort());
  assert.ok(sweep.selectScenarios({ scenarios: ['tag:core'] }).indexOf('D.brake') >= 0);
  assert.ok(sweep.selectScenarios({ scenarios: ['scope:warnOnly'] }).indexOf('D.brake') < 0);
  assert.deepStrictEqual(sweep.selectScenarios({ scenarios: ['A', 'B.queue'], exclude: ['A.dip'] }).filter(id => id === 'A.dip' || id === 'B.queue'), ['B.queue']);
});

test('grid: cross product times zipped cases; tornado = base and each parameter at -30 % and +30 %', () => {
  const pts = sweep.buildPoints({ grid: { 'plant.deadTime_s': [0.5, 1] }, gridCases: [{ 'plant.aMin_ms2': -1 }, { 'plant.aMin_ms2': -2, 'plant.brakeMax_ms2': 2 }],
    tornado: { params: { 'plant.tau_s': 2, 'sensor.rateHz': 10 }, factor: 0.3 } });
  assert.strictEqual(pts.length, 4 + 1 + 4);
  assert.deepStrictEqual(pts[3].point, { 'plant.deadTime_s': 1, 'plant.aMin_ms2': -2, 'plant.brakeMax_ms2': 2 });
  const lo = pts.find(p => p.side === 'low' && p.param === 'sensor.rateHz');
  assert.strictEqual(lo.point['sensor.rateHz'], 7);
  assert.strictEqual(lo.point['plant.tau_s'], 2);
  assert.strictEqual(pts.find(p => p.side === 'high' && p.param === 'plant.tau_s').point['plant.tau_s'], 2.6);
});

test('thin keeps whole groups, evenly spread', () => {
  const cs = sc.expand('J.gapFreeze.D3');
  const t = sweep.thin(cs, 1);
  assert.strictEqual(new Set(t.map(c => c.groupKey)).size, 1);
  assert.strictEqual(t.length, cs.length / 2);
  const d = sweep.thin(sc.expand('D.brake'), 5);
  assert.strictEqual(new Set(d.map(c => c.groupKey)).size, 5);
});

test('a run\'s config: base, then the grid point, then the variant\'s own patch', () => {
  const c = sc.expand('G.lowrate.brake').find(x => x.variant['config.sensor.rateHz'] === 2);
  const cfg = sweep.configFor({ base: { plant: { preset: 'mild' }, sensor: { rateHz: 10, latency_s: 0.1 } }, seed: 7 }, { 'sensor.rateHz': 25, 'plant.deadTime_s': 1 }, c);
  assert.strictEqual(cfg.sensor.rateHz, 2, 'the scenario keeps its 2 Hz sensor');
  assert.strictEqual(cfg.sensor.latency_s, 0.1);
  assert.strictEqual(cfg.plant.deadTime_s, 1);
  assert.strictEqual(cfg.plant.preset, 'mild');
  assert.strictEqual(cfg.seed, 7);
  assert.strictEqual(cfg.driver.reactionCase, 'none');
});

test('the summary: groups pass only when every member (reaction cases, worst times) passes; safety share; lead braking', () => {
  const r = (id, group, scen, fam, reaction, a, pass, failed, m) => ({ id, groupKey: group, scenario: scen, family: fam, scope: 'in', reaction, variant: { a }, gi: 0,
    metrics: m || {}, verdict: { pass, failed: failed || [] } });
  const recs = [
    r('D.brake#a=-0.5', 'D.brake#a=-0.5', 'D.brake', 'D', 'none', -0.5, true),
    r('D.brake#a=-1', 'D.brake#a=-1', 'D.brake', 'D', 'none', -1, false, ['setpointChangesPerMin'], { warnCount: 0 }),
    r('D.brake#a=-1.5', 'D.brake#a=-1.5', 'D.brake', 'D', 'none', -1.5, false, ['warnCount'], { warnCount: 1 }),
    r('J.x#tf=1/react', 'J.x#', 'J.x', 'J', 'react', undefined, true),
    r('J.x#tf=2/react', 'J.x#', 'J.x', 'J', 'react', undefined, false, ['collision'], { collision: true, impactSpeed_kmh: 30 })
  ];
  const s = sweep.summarizePoint(recs);
  assert.strictEqual(s.groups, 4);
  assert.strictEqual(s.groupsPass, 1);
  assert.strictEqual(s.groupsSafe, 3, 'chatter and a warning are not safety failures; the collision is');
  near(s.families.D.share, 1 / 3, 1e-12);
  assert.strictEqual(s.failing[0].groupKey, 'J.x#', 'the collision is the worst');
  assert.strictEqual(s.leadBrakeHandled_mps2, 1);
});

test('end to end with a fake engine on 2 workers: records, time lost, files, the page\'s batch shape', async () => {
  const plan = { name: 'test-e2e', scenarios: ['D.brake', 'B.approach'], perScenarioMax: 3, grid: { 'plant.aMin_ms2': [-0.7, -1.8] },
    presets: { weak: { 'plant.aMin_ms2': -0.7 } }, map: { x: 'plant.aMin_ms2', y: 'plant.aMin_ms2' }, baseline: true };
  const B = sweep.buildJobs(plan);
  assert.strictEqual(B.jobs.length, B.concretes.length * 3);
  const raw = await sweep.runJobs(plan, B, { workers: 2, engine: FAKE, quiet: true });
  assert.ok(raw.every(x => x.ok), raw.filter(x => !x.ok).map(x => x.err).join('; '));
  const recs = sweep.makeRecords(plan, B, raw);
  assert.strictEqual(recs.length, B.concretes.length * 2);
  near(recs[0].metrics.timeLost_s, 10 / 25, 1e-9);
  const S = sweep.summarize(plan, B, recs);
  const weak = S.byPoint.find(p => p.preset === 'weak'), strong = S.byPoint.find(p => !p.preset);
  assert.ok(weak.families.D.share < strong.families.D.share);
  assert.strictEqual(S.plant.assumed, true);
  assert.strictEqual(S.ranking[0].param, 'plant.aMin_ms2');
  const dir = sweep.writeOutputs(plan, B, recs, S, TMP);
  const batch = JSON.parse(fs.readFileSync(path.join(dir, 'batch.json'), 'utf8'));
  assert.strictEqual(batch.kind, 'cs-batch');
  assert.strictEqual(batch.version, 1);
  assert.strictEqual(batch.runs.length, recs.length);
  ['id', 'scenario', 'family', 'variant', 'params', 'metrics', 'verdict', 'decide', 'scope'].forEach(k => assert.ok(k in batch.runs[0], k));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').length, recs.length);
  assert.ok(sweep.headline(plan, S).indexOf('with an assumed plant') >= 0);

  // the report from that run: self-contained, says "assumed", has the Ukrainian summary and the map
  const run = report.loadRun(dir);
  const out = report.build([run], { noRerun: true });
  assert.ok(/Assumed plant/.test(out.html));
  assert.ok(/Підсумок українською/.test(out.html));
  assert.ok(/<svg/.test(out.html));
  assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(out.html), 'nothing from the network');
  assert.ok(!/<script/i.test(out.html));
  assert.ok(out.summaryUk.length >= 1 && out.summaryEn.length >= 1);
  assert.ok(out.measure[0].param === 'plant.aMin_ms2');
});

test('the map headline finds, per row, the weakest value within 2 points of the best cell', () => {
  const hl = report.mapHeadline({ xs: [-0.7, -1.8, -2.8], ys: [0.5, 1.5], cells: [[0.4, 0.94, 0.95], [0.3, 0.6, 0.92]] });
  near(hl.best, 0.95, 1e-12);
  near(hl.target, 0.93, 1e-12);
  assert.deepStrictEqual(hl.rows.map(r => r.x), [-1.8, null]);
});

test('a real batch on the engine, if core/sim.js is present (6 runs)', async () => {
  if (!fs.existsSync(path.join(__dirname, '..', 'core', 'sim.js'))) return;
  const plan = { name: 'test-real', scenarios: ['D.brake'], perScenarioMax: 3, grid: { 'plant.preset': ['liftoff', 'firm'] }, base: { controller: { rateDown_kmhps: 12 } } };
  const B = sweep.buildJobs(plan);
  const raw = await sweep.runJobs(plan, B, { workers: 2, quiet: true });
  assert.ok(raw.every(x => x.ok), raw.filter(x => !x.ok).map(x => x.err).join('; '));
  const recs = sweep.makeRecords(plan, B, raw);
  recs.forEach(r => { assert.strictEqual(typeof r.metrics.minTimeGap_s, 'number'); assert.strictEqual(typeof r.metrics.collision, 'boolean'); });
  const S = sweep.summarize(plan, B, recs);
  assert.ok(S.byPoint[1].passShare >= S.byPoint[0].passShare, 'firm braking is no worse than lift-off');
});
