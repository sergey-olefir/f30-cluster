'use strict';
// SC3: core/metrics.js on synthetic results whose answers are known in closed form.
const { test, assert, near } = require('./harness');
const M = require('../core/metrics');

// a result on a 0.05 s grid; f(t) -> { 'ego.v': ..., ... } (missing = NaN)
function result(T, f, events, enums, extra) {
  const dt = 0.05, n = Math.round(T / dt) + 1, t = new Float64Array(n), series = {};
  for (let i = 0; i < n; i++) {
    t[i] = i * dt;
    const row = f(t[i], i);
    Object.keys(row).forEach(k => { (series[k] = series[k] || new Float64Array(n).fill(NaN))[i] = row[k]; });
  }
  return Object.assign({ meta: { enums: enums || { 'cruise.state': ['off', 'active', 'suspended', 'override', 'dropout'] } }, t, series, events: events || [] }, extra || {});
}
function cfg(inline, extra) { return Object.assign({ scenario: { inline: Object.assign({ events: [], vehicles: [] }, inline || {}) } }, extra || {}); }

test('SCHEMA: every entry has the settings fields; thresholds carry their op; defaults() covers them', () => {
  M.SCHEMA.forEach(e => {
    ['key', 'label', 'unit', 'default', 'min', 'max', 'step', 'group', 'help'].forEach(k => assert.ok(k in e, e.key + ' lacks ' + k));
    if (/^thresholds/.test(e.group)) assert.ok(['>=', '<=', 'false', 'true'].indexOf(e.op) >= 0 || e.op === undefined, e.key);
  });
  const d = M.defaults();
  assert.strictEqual(d.minTimeGap_s, 1.0);
  assert.strictEqual(d.minTTC_s, 4.0);
  assert.strictEqual(d.setpointChangesPerMin, 20);
  assert.strictEqual(d.gapErrRmsRel, 0.3);
  assert.strictEqual(d.leadBrakeHandled_mps2, 1.5);
  assert.strictEqual(M.thresholdsOf({ thresholds: { minTTC_s: 3 } }).minTTC_s, 3);
});

test('steady following: time gap = gap / v exactly, never closing (TTC capped at 99), no collision', () => {
  const r = result(60, () => ({ 'ego.v': 25, 'lead.v': 25, 'gap.true': 55, 'vrel.true': 0, 'lead.id': 1, 'ego.a': 0, 'd.des': 55, 'lead.a': 0 }));
  const m = M.compute(r, cfg());
  assert.strictEqual(m.collision, false);
  near(m.minTimeGap_s, 55 / 25, 1e-9);
  assert.strictEqual(m.minTTC_s, 99);
  assert.strictEqual(m.minGap_m, 55);
  assert.strictEqual(m.missedWarning, false);
  assert.strictEqual(m.warnLeadTime_s, null);
  near(m.gapErrRms_m, 0, 1e-12);
  assert.strictEqual(m.peakDecel_mps2, 0);
});

test('two constant speeds: TTC = gap / closing speed; contact found with its impact speed', () => {
  const g0 = 100, vc = 5;
  const r = result(30, t => ({ 'ego.v': 30, 'lead.v': 25, 'gap.true': g0 - vc * t, 'vrel.true': -vc, 'lead.id': 1 }));
  const m = M.compute(r, cfg());
  assert.strictEqual(m.collision, true);
  near(m.impactSpeed_kmh, 18, 1e-9);
  near(m.minTTC_s, 0, 0.011);
  const r2 = result(10, t => ({ 'ego.v': 30, 'lead.v': 25, 'gap.true': g0 - vc * t, 'vrel.true': -vc, 'lead.id': 1 }));
  near(M.compute(r2, cfg()).minTTC_s, (g0 - vc * 10) / vc, 1e-9);
  // a collision event wins over the series
  const r3 = result(5, () => ({ 'ego.v': 20, 'gap.true': 10, 'vrel.true': 0 }), [{ t: 2, kind: 'collision', impactSpeed: 3 }]);
  const m3 = M.compute(r3, cfg());
  assert.strictEqual(m3.collision, true);
  near(m3.impactSpeed_kmh, 10.8, 1e-9);
});

test('the last moment and the warning lead time against a standing obstacle', () => {
  // ego at 20 m/s toward a standing car 120 m ahead, never slowing. Braking at 6 m/s^2 needs 20^2/12 = 33.33 m, plus the
  // 2 m margin: the last moment is when the gap is 35.33 m, t = (120 - 35.33) / 20 = 4.233 s
  const tLast = (120 - (400 / 12 + 2)) / 20;
  const f = (tw) => t => ({ 'ego.v': 20, 'lead.v': 0, 'gap.true': 120 - 20 * t, 'vrel.true': -20, 'lead.id': 1, warn: tw !== null && t >= tw ? 1 : 0 });
  const m = M.compute(result(8, f(2.0)), cfg({ reaction: 'none' }));
  assert.strictEqual(m.missedWarning, false);
  near(m.warnLeadTime_s, tLast - 2.0, 0.051);
  const late = M.compute(result(8, f(5.0)), cfg({ reaction: 'none' }));
  assert.strictEqual(late.missedWarning, true, 'a warning after the last moment is a missed one');
  const none = M.compute(result(8, f(null)), cfg({ reaction: 'none' }));
  assert.strictEqual(none.missedWarning, true);
  assert.strictEqual(none.warnLeadTime_s, null);
});

test('the last moment uses what the lead really does (a lead braking at 3 m/s^2 from 25 m/s)', () => {
  // ego 25 m/s, lead 25 m/s braking at 3 from t = 0, gap 30 m. Driver braking at 6 from time s: gap(s) = 30 - 1.5 s^2,
  // closing at 3 s, which falls at 3 m/s^2 (6 - 3) to zero after another s; the gap is smallest then: 30 - 3 s^2.
  // Keeping 2 m: s = sqrt(28 / 3) = 3.055 s (the ego stops at s + 4.17 s, before the lead does)
  const s = Math.sqrt(28 / 3);
  const r = result(12, t => {
    const vl = Math.max(0, 25 - 3 * t), xl = t < 25 / 3 ? 25 * t - 1.5 * t * t : 625 / 6;
    return { 'ego.v': 25, 'lead.v': vl, 'gap.true': 30 + xl - 25 * t, 'vrel.true': vl - 25, 'lead.id': 1, warn: t >= 1 ? 1 : 0 };
  });
  const m = M.compute(r, cfg({ reaction: 'none' }));
  near(m.warnLeadTime_s, s - 1, 0.06);
});

test('nuisance warnings: judged only when the driver does not react; sensor warnings never count', () => {
  const quiet = (t) => ({ 'ego.v': 25, 'lead.v': 25, 'gap.true': 50, 'vrel.true': 0, 'lead.id': 1, warn: t > 10 && t < 12 ? 1 : 0 });
  const ev = [{ t: 10.05, kind: 'warn.on', reason: 'ttc' }];
  assert.strictEqual(M.compute(result(30, quiet, ev), cfg({ reaction: 'none' })).nuisanceWarnings, 1);
  assert.strictEqual(M.compute(result(30, quiet, ev), cfg({ reaction: 'react' })).nuisanceWarnings, null);
  assert.strictEqual(M.compute(result(30, quiet, [{ t: 10.05, kind: 'warn.on', reason: 'sensor' }]), cfg({ reaction: 'none' })).nuisanceWarnings, 0);
  // the reaction case may also come from the config (SC1's driver.reactionCase)
  assert.strictEqual(M.compute(result(30, quiet, ev), cfg({}, { driver: { reactionCase: 'none' } })).nuisanceWarnings, 1);
});

test('a near miss at speed (time gap below 0.3 s) is critical, so its warning is not a nuisance', () => {
  const r = result(30, t => ({ 'ego.v': 25, 'lead.v': 25, 'gap.true': t > 15 && t < 17 ? 5 : 40, 'vrel.true': 0, 'lead.id': 1, warn: t > 12 && t < 17 ? 1 : 0 }),
    [{ t: 12.05, kind: 'warn.on', reason: 'distance' }]);
  const m = M.compute(r, cfg({ reaction: 'none' }));
  assert.strictEqual(m.nuisanceWarnings, 0);
  assert.strictEqual(m.missedWarning, false);
});

test('oscillation gain: our speed amplitude over the lead\'s at the lead\'s period', () => {
  const P = 20, w = 2 * Math.PI / P;
  const r = result(300, t => ({ 'ego.v': 25 + 0.6 * 2 * Math.sin(w * (t - 10) - 0.7), 'lead.v': 25 + 2 * Math.sin(w * (t - 10)), 'gap.true': 55, 'vrel.true': 0, 'lead.id': 1 }));
  const inline = { vehicles: [{ id: 'lead', profile: { type: 'sine', period_s: P, t0: 10, amp_kmh: 7.2 } }] };
  near(M.compute(r, cfg(inline)).oscGain, 0.6, 0.01);
});

test('setpoint changes: the busiest 60 s window, and the mean', () => {
  const ev = [];
  for (let k = 0; k < 30; k++) ev.push({ t: 100 + k * 0.5, kind: 'cmd.sent' });   // 30 in 15 s
  for (let k = 0; k < 10; k++) ev.push({ t: 10 + k * 5, kind: 'cmd.sent' });
  ev.sort((a, b) => a.t - b.t);
  const m2 = M.compute(result(240, () => ({ 'ego.v': 20 }), ev), cfg({}));
  assert.strictEqual(m2.setpointChangesPerMin, 31, 'the 30 in 100..114.5 s and the one at 55 s fit one 60 s window');
  near(m2.setpointChangesAvgPerMin, 40 / (240.05 / 60), 1e-3);
});

test('commands while the cruise is off or suspended are counted', () => {
  const ev = [{ t: 5, kind: 'cmd.sent' }, { t: 15, kind: 'cmd.sent' }, { t: 16, kind: 'cmd.sent' }];
  const r = result(30, t => ({ 'ego.v': 20, 'cruise.state': t < 10 ? 1 : 2 }), ev);
  assert.strictEqual(M.compute(r, cfg()).cmdWhileInactive, 2);
});

test('comfort: peaks and RMS over the samples where the driver touches no pedal; jerk over 1 s', () => {
  const r = result(20, t => ({ 'ego.v': 20, 'ego.a': t < 10 ? -1.5 : 0, 'driver.brake': t > 15 ? 6 : 0 }));
  r.series['ego.a'].forEach((_, i) => { if (r.t[i] > 15) r.series['ego.a'][i] = -6; });
  const m = M.compute(r, cfg());
  near(m.peakDecel_mps2, 1.5, 1e-9);
  near(m.peakJerk_mps3, 1.5, 1e-9);
  assert.ok(m.accelRms_mps2 > 1 && m.accelRms_mps2 < 1.5);
});

test('the car behind: its speed from the gap\'s derivative; min time gap and peak deceleration; null without one', () => {
  const r = result(30, t => ({ 'ego.v': 20, 'follower.gap': 20 - 0.5 * t, 'follower.a': t > 10 ? -2 : 0 }));
  const m = M.compute(r, cfg());
  near(m.followerMinTimeGap_s, 5 / 20.5, 0.01);
  near(m.followerPeakDecel_mps2, 2, 1e-9);
  assert.strictEqual(m.followerCollision, false);
  const none = M.compute(result(30, () => ({ 'ego.v': 20, 'follower.gap': NaN })), cfg());
  assert.strictEqual(none.followerPeakDecel_mps2, null);
});

test('envelope exit: a cruise drop-out with and without a warning before it', () => {
  const st = t => (t < 20 ? 1 : 4);
  const said = M.compute(result(40, t => ({ 'ego.v': 10, 'cruise.state': st(t), warn: t > 15 && t < 22 ? 1 : 0 })), cfg());
  assert.strictEqual(said.envelopeExitAnnounced, true);
  near(said.outOfEnvelope_s, 20, 0.06);
  const silent = M.compute(result(40, t => ({ 'ego.v': 10, 'cruise.state': st(t), warn: 0 })), cfg());
  assert.strictEqual(silent.envelopeExitAnnounced, false);
  const cancelled = M.compute(result(40, t => ({ 'ego.v': 10, 'cruise.state': t < 20 ? 1 : 0, warn: 0 })), cfg({ events: [{ t: 19.9, kind: 'driverCancel' }] }));
  assert.strictEqual(cancelled.envelopeExitAnnounced, null, 'the driver\'s cancel is not leaving the envelope');
});

test('target loss: speed gain in the hold window, and into a curve', () => {
  const r = result(40, t => ({ 'ego.v': 20 + (t > 10 ? Math.min(2, 0.5 * (t - 10)) : 0), 'est.valid': t < 10 ? 1 : 0, 'ego.x': 20 * t }));
  const m = M.compute(r, cfg({ road: { curvature: [[0, 0], [150, 0], [151, 1 / 300], [1000, 1 / 300]] } }));
  near(m.lostTargetSpeedGain_kmh, 1.5 * 3.6, 0.2);
  near(m.curveLostSpeedGain_kmh, 2 * 3.6, 0.01);
});

test('fault detection delay: from the fault to the first warning or invalid estimate; 99 when never', () => {
  const r = result(40, t => ({ 'ego.v': 20, 'est.valid': t < 21.5 ? 1 : 0 }), [{ t: 20, kind: 'fault.on', fault: 'gapFreeze' }]);
  near(M.compute(r, cfg()).faultDetectDelay_s, 1.5, 0.051);
  const never = result(40, () => ({ 'ego.v': 20, 'est.valid': 1 }), [{ t: 20, kind: 'fault.on', fault: 'sensorBlind' }]);
  assert.strictEqual(M.compute(never, cfg()).faultDetectDelay_s, 99);
  const other = result(40, () => ({ 'ego.v': 20, 'est.valid': 1 }), [{ t: 20, kind: 'fault.on', fault: 'appStop' }]);
  assert.strictEqual(M.compute(other, cfg()).faultDetectDelay_s, null);
});

test('overspeed against the trailing maximum; settle time after a change of the maximum', () => {
  const r = result(60, t => ({ 'ego.v': t < 10 ? 25 : Math.min(30.5, 25 + (t - 10)), 'v.driverMax': t < 10 ? 25 : 30 }),
    [], null);
  const m = M.compute(r, cfg({ events: [{ t: 10, kind: 'driverVmax', vMax_kmh: 108 }] }));
  near(m.overspeed_kmh, 0.5 * 3.6, 1e-9);
  assert.strictEqual(m.settleTime_s, null, 'never within 1 km/h of the maximum');
});

test('verdict: >=, <=, false, true; null is not applicable, never a failure', () => {
  const m = { minTimeGap_s: 0.8, minTTC_s: 5, collision: false, envelopeExitAnnounced: false, warnLeadTime_s: null };
  const v = M.verdict(m, { minTimeGap_s: 1.0 }, ['minTimeGap_s', 'minTTC_s', 'collision', 'envelopeExitAnnounced', 'warnLeadTime_s', 'noSuchMetric']);
  assert.deepStrictEqual(v.failed, ['minTimeGap_s', 'envelopeExitAnnounced']);
  assert.deepStrictEqual(v.unknown, ['warnLeadTime_s', 'noSuchMetric']);
  assert.strictEqual(v.pass, false);
  assert.strictEqual(M.verdict(m, { minTimeGap_s: 0.5 }, ['minTimeGap_s']).pass, true);
});

test('worst() takes each metric at its worst; timeLost() from two runs', () => {
  const w = M.worst([{ minTimeGap_s: 1.2, collision: false, peakDecel_mps2: 1, envelopeExitAnnounced: true }, { minTimeGap_s: 0.7, collision: true, peakDecel_mps2: 2, envelopeExitAnnounced: false }, null]);
  assert.strictEqual(w.minTimeGap_s, 0.7);
  assert.strictEqual(w.collision, true);
  assert.strictEqual(w.peakDecel_mps2, 2);
  assert.strictEqual(w.envelopeExitAnnounced, false);
  const tl = M.timeLost({ egoXEnd_m: 1900, egoVEnd_mps: 25, duration_s: 100 }, { egoXEnd_m: 2000 });
  near(tl.timeLost_s, 4, 1e-9);
  near(tl.timeLostPct, 4, 1e-9);
  assert.strictEqual(M.timeLost({}, {}).timeLost_s, null);
});

test('an empty or missing result gives nulls, not a crash', () => {
  const m = M.compute({ t: new Float64Array(0), series: {}, events: [] }, {});
  assert.strictEqual(m.minTimeGap_s, null);
  const m2 = M.compute(result(5, () => ({ 'ego.v': 20 })), {});
  assert.strictEqual(m2.collision, false);
  assert.strictEqual(m2.minTimeGap_s, null);
});

test('driver interventions: one per braking the driver starts himself; reactions without braking, releases and scripted brakes do not count', () => {
  const ev = [
    { t: 5, kind: 'driver.brake', level: 2, cause: 'scripted' },
    { t: 10, kind: 'driver.react', cause: 'warning', brakes: true }, { t: 10, kind: 'driver.brake', level: 6, cause: 'warning' },
    { t: 14, kind: 'driver.brake', level: 0, cause: 'release' },
    { t: 20, kind: 'driver.react', cause: 'warning', brakes: false },
    { t: 30, kind: 'driver.brake', level: 6, cause: 'ttc' }
  ];
  const m = M.compute(result(40, () => ({ 'ego.v': 20 }), ev), cfg({ events: [{ t: 5, kind: 'driverBrake', level_ms2: 2 }] }));
  assert.strictEqual(m.driverInterventions, 2);
});

test('a short time gap to a car that pulls away (a faster cut-in) is not critical', () => {
  const r = result(20, t => ({ 'ego.v': 30, 'lead.v': 33, 'gap.true': 5 + 3 * t, 'vrel.true': 3, 'lead.id': 1, warn: 0 }));
  const m = M.compute(r, cfg({ reaction: 'none' }));
  assert.strictEqual(m.missedWarning, false);
  const closing = result(20, t => ({ 'ego.v': 30, 'lead.v': 29, 'gap.true': 8 - 0.2 * t, 'vrel.true': -1, 'lead.id': 1, warn: 0 }));
  assert.strictEqual(M.compute(closing, cfg({ reaction: 'none' })).missedWarning, true);
});
