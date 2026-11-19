'use strict';
const { test, assert, near } = require('./harness');
const sim = require('../core/sim');
const failures = require('../core/failures');
const { deps, scriptController, noWarning, scriptWarning } = require('./stubs/sc2');
const KMH = 1 / 3.6;

// a lead that oscillates, so the stub controller keeps sending set speeds up and down
function scen(extra) {
  return Object.assign({ id: 'fail', family: 'J', name: 'failure test', duration: 120, road: { lanes: 2 },
    ego: { v0_kmh: 90, vMax_kmh: 110, lane: 0 },
    vehicles: [{ id: 'lead', x0: 50, v0_kmh: 90, profile: { type: 'sine', amp_kmh: 10, period_s: 20 } }], events: [] }, extra || {});
}
function run(fl, over, d) { return sim.run(Object.assign({ duration: 120, scenario: { inline: scen() }, failures: fl }, over || {}), deps(d)); }
const ev = (r, kind) => r.events.filter(e => e.kind === kind);
const within = (r, a, b) => Array.from(r.t).map((t, i) => [t, i]).filter(p => p[0] >= a && p[0] < b).map(p => p[1]);

test('failures: appStop really stops the commands and the warning; fault.on / fault.off are logged', () => {
  const base = run([]);
  assert.ok(ev(base, 'cmd.sent').some(e => e.t >= 40 && e.t < 70), 'the baseline does command in the window');
  const r = run([{ kind: 'appStop', at: 40, duration: 30 }], {}, { warning: scriptWarning(t => t > 30) });
  assert.strictEqual(ev(r, 'cmd.sent').filter(e => e.t >= 40 && e.t < 70).length, 0);
  assert.ok(ev(r, 'cmd.sent').some(e => e.t >= 70), 'back after the window');
  for (const i of within(r, 40, 70)) { assert.strictEqual(r.series['app.alive'][i], 0); assert.strictEqual(r.series.warn[i], 0); }
  assert.ok(ev(r, 'warn.off').some(e => Math.abs(e.t - 40) < 1e-9 && e.reason === 'appDead'));
  assert.deepStrictEqual(ev(r, 'fault.on').map(e => [e.t, e.fault]), [[40, 'appStop']]);
  near(ev(r, 'fault.off')[0].t, 70, 1e-9);
  const forever = run([{ kind: 'appStop', at: 40 }]);
  assert.strictEqual(ev(forever, 'cmd.sent').filter(e => e.t >= 40).length, 0);
});

test('failures: huRestart lasts 30-60 s, empties the command path and brings a fresh app back', () => {
  const r = run([{ kind: 'huRestart', at: 20 }], { command: { delay_s: 1.5, jitter_s: 0 } });
  const on = ev(r, 'fault.on')[0], off = ev(r, 'fault.off')[0];
  const d = off.t - on.t;
  assert.ok(d >= 30 && d <= 60, 'duration ' + d);
  assert.ok(ev(r, 'cmd.sent').some(e => e.t >= off.t), 'commands again');
  assert.strictEqual(ev(r, 'cmd.sent').filter(e => e.t >= 20 && e.t < off.t).length, 0);
  const lost = ev(r, 'cmd.dropped').filter(e => e.reason === 'restart');
  const inFlight = ev(r, 'cmd.sent').filter(e => e.t > 18.5 && e.t < 20).length;
  assert.strictEqual(lost.length, inFlight, 'what was in flight is lost');
});

test('failures: gapFreeze repeats the last sample while the true gap moves', () => {
  const r = run([{ kind: 'gapFreeze', at: 30, duration: 8 }]);
  const idx = within(r, 30.2, 38);
  const g = idx.map(i => r.series['gap.meas'][i]);
  assert.ok(g.every(x => x === g[0]), 'frozen');
  const tg = idx.map(i => r.series['gap.true'][i]);
  assert.ok(Math.max(...tg) - Math.min(...tg) > 2, 'while the truth moves');
  const after = within(r, 39, 41).map(i => r.series['gap.meas'][i]);
  near(after[after.length - 1], r.series['gap.true'][within(r, 39, 41).pop()], 0.6, 'live again');
});

test('failures: sensorBlind gives invalid samples (or none) and the target is lost', () => {
  const r = run([{ kind: 'sensorBlind', at: 30, duration: 5 }]);
  for (const i of within(r, 30.2, 35)) assert.strictEqual(r.series['meas.valid'][i], 0);
  assert.ok(ev(r, 'target.lost').some(e => e.t >= 30 && e.t < 31));
  assert.ok(ev(r, 'target.acquired').some(e => e.t >= 35 && e.t < 36));
  const s = run([{ kind: 'sensorBlind', at: 30, duration: 5, mode: 'silent' }]);
  const kept = within(s, 30.2, 31).map(i => s.series['meas.valid'][i]);
  assert.ok(kept.every(x => x === 1), 'silence: the last sample stays (the estimator sees it go stale)');
});

test('failures: commandLost loses exactly the next decrease', () => {
  const r = run([{ kind: 'commandLost', at: 30 }]);
  const lost = ev(r, 'cmd.dropped').filter(e => e.reason === 'fault');
  assert.strictEqual(lost.length, 1);
  const sent = ev(r, 'cmd.sent');
  const j = sent.findIndex(e => e.id === lost[0].id);
  assert.ok(sent[j].vSet < sent[j - 1].vSet, 'it was a decrease');
  assert.ok(sent.slice(0, j).filter(e => e.t >= 30).every((e, n, a) => n === 0 || e.vSet >= a[n - 1].vSet), 'no earlier decrease after at');
  assert.ok(ev(r, 'fault.off').some(e => e.fault === 'commandLost'), 'the fault ends once used');
  const all = run([{ kind: 'commandLost', at: 30, duration: 10, mode: 'all' }]);
  const inWin = ev(all, 'cmd.sent').filter(e => e.t >= 30 && e.t < 40);
  assert.ok(inWin.length > 0);
  const droppedIds = new Set(ev(all, 'cmd.dropped').map(e => e.id));
  assert.ok(inWin.every(e => droppedIds.has(e.id)));
});

test('failures: setStuck keeps the held set speed while commands keep coming (silently rejected)', () => {
  const r = run([{ kind: 'setStuck', at: 30, duration: 20 }]);
  const idx = within(r, 30.5, 50);
  const h = idx.map(i => r.series['set.held'][i]);
  assert.ok(h.every(x => x === h[0]));
  assert.ok(ev(r, 'cmd.rejected').filter(e => e.reason === 'stuck' && e.silent).length > 3);
  assert.ok(ev(r, 'cmd.applied').some(e => e.t > 50));
});

test('failures: cruiseDropout switches the cruise off at that moment; the driver resumes it later', () => {
  const r = run([{ kind: 'cruiseDropout', at: 30 }], { driver: { resumeDelay_s: 4 } });
  const e = ev(r, 'cruise.state');
  const d = e.find(x => x.to === 'dropout');
  near(d.t, 30, 1e-9); assert.strictEqual(d.reason, 'fault');
  const back = e.find(x => x.to === 'active' && x.t > 30);
  near(back.t, 34, 0.02);
});

test('failures: a head-unit stall holds the app and the path', () => {
  const r = run([{ kind: 'stall', at: 30, duration: 2 }], { command: { delay_s: 0.1, jitter_s: 0 } });
  assert.strictEqual(ev(r, 'cmd.sent').filter(e => e.t >= 30 && e.t < 32).length, 0);
  assert.strictEqual(ev(r, 'cmd.applied').filter(e => e.t >= 30 && e.t < 32).length, 0);
});

test('failures: sensor fault kinds set the keys SC2\'s sensor reads', () => {
  const f = failures.create([{ kind: 'ghost', at: 1 }, { kind: 'rangeCut', at: 1, range_m: 30 }, { kind: 'latencySpike', at: 1, extra_s: 0.7 },
    { kind: 'dropBurst', at: 1 }, { kind: 'degraded', at: 1, mode: 'fog' }], null, {});
  const x = f.apply({}, 1.5);
  assert.deepStrictEqual([x.ghost, x.sensorRangeCut, x.latencyExtra, x.dropBurst, x.sensorDegraded], [true, 30, 0.7, true, 'fog']);
  const y = f.apply({}, 12);
  assert.deepStrictEqual([y.ghost, y.sensorRangeCut, y.latencyExtra, y.dropBurst, y.sensorDegraded], [false, null, 0, false, 'fog']);
  assert.throws(() => failures.create([{ kind: 'meteor', at: 1 }], null, {}), /unknown kind/);
  assert.throws(() => failures.create([{ kind: 'appStop' }], null, {}), /needs at/);
});

test('failures: at "worst" searches the injection time and returns the worst run', () => {
  // the lead brakes hard at 40 s (100 -> 40 km/h at 4 m/s²); the app stops for 6 s at the worst time
  const s = { id: 'worst', family: 'J', name: 'worst', duration: 60, road: { lanes: 2 }, ego: { v0_kmh: 100, vMax_kmh: 100, lane: 0 },
    vehicles: [{ id: 'lead', x0: 55, v0_kmh: 100, profile: { type: 'steps', steps: [[40, 40, 4]] } }], events: [] };
  const cfg = { duration: 60, scenario: { inline: s }, failures: [{ kind: 'appStop', at: 'worst', duration: 6, window: [20, 50] }], driver: { reactionCase: 'none' } };
  const r = sim.run(cfg, deps());
  const w = r.meta.worst;
  assert.ok(w && w.fault === 'appStop' && w.by === 'severity');
  assert.strictEqual(w.runs, 31 + 8, 'coarse every 1 s over [20, 50], then 0.2 s steps within ±1 s of the worst (3 of 11 already run)');
  assert.ok(w.scored.every(p => p[1] <= w.score + 1e-9), 'the worst is the maximum');
  assert.ok(w.at > 34 && w.at <= 41, 'just before or at the braking: ' + w.at);
  assert.strictEqual(r.meta.config.failures[0].at, w.at, 'the returned run is the concrete worst one');
  assert.ok(w.score > w.baseline, 'worse than without the failure');
  // the same through a scenario fault event, and with a metric objective
  const s2 = Object.assign({}, s, { events: [{ kind: 'fault', fault: 'appStop', at: 'worst', duration: 6, window: [30, 45], worstBy: 'minTimeGap' }] });
  const r2 = sim.run({ duration: 60, scenario: { inline: s2 }, driver: { reactionCase: 'none' } }, deps());
  assert.strictEqual(r2.meta.worst.by, 'minTimeGap');
  assert.ok(r2.meta.worst.scored.length > 10);
  assert.throws(() => sim.run(Object.assign({}, cfg, { failures: [cfg.failures[0], cfg.failures[0]] }), deps()), /only one/);
  // the page's step API resolves the search the same way and then plays the worst run
  const st = sim.createSim(cfg, deps());
  while (!st.done) st.advance(10);
  assert.strictEqual(sim.hashResult(st.result()), sim.hashResult(r));
  assert.strictEqual(st.meta.worst.at, w.at);
});
