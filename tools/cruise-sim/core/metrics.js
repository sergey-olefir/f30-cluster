(function () {
'use strict';
// (wrapped in a function: the page loads core/*.js as classic scripts, which share one global scope)
/*
 * Metrics of one run and the pass thresholds (SC3).
 *
 *   METRICS                         every metric: key, label, unit, op (how it passes), default threshold, level, help
 *   SCHEMA                          the settings of the thresholds and of the metric definitions (the CONTRACT's SCHEMA shape)
 *   defaults()                      { key: default } of SCHEMA
 *   compute(result, config)         -> { key: number | boolean | null }     result = { meta, t, series, events } (CONTRACT)
 *   verdict(metrics, thresholds, decide) -> { pass, failed: [keys], unknown: [keys] }   null = not applicable, never a fail
 *   worst(list)                     -> one metrics object, each key at its worst over the list (for "at the worst time")
 *   timeLost(ours, baseline)        -> { timeLost_s, timeLostPct } from two runs' egoXEnd_m / egoVEnd_mps / duration_s
 *
 * Definitions worth knowing (all from the TRUE series, never the measured ones):
 *  - a CRITICAL moment: the true gap below nearMissGap_m, the true TTC below ttcCritical_s, the true time gap below
 *    timeGapCritical_s while not opening (a faster car cutting in close is not one), or contact;
 *  - its LAST MOMENT: the latest time at which a driver who starts braking at driverBrake_mps2 (no reaction time) still keeps
 *    nearMissGap_m to the same lead, the lead doing what it really did;
 *  - warnLeadTime_s: last moment minus the warning's onset (min over the critical moments); missedWarning: a critical moment
 *    with no warning in the 20 s before its last moment;
 *  - nuisanceWarnings: on a run where the driver does NOT react, a warning not followed by a critical moment within
 *    nuisanceWindow_s (the cruise handled it alone); null on runs where the driver reacts (they cannot tell);
 *  - comfort metrics use only the samples where the driver touches no pedal.
 */

function T(key, label, unit, op, def, min, max, step, help, level) {
  return { key: key, label: label, unit: unit, op: op, default: def, min: min, max: max, step: step, help: help, level: level || 'run' };
}
var METRICS = [
  T('collision', 'Collision', '', 'false', null, null, null, null, 'Contact with the true lead (or any vehicle in our lane)'),
  T('impactSpeed_kmh', 'Impact speed', 'km/h', '<=', 0, 0, 50, 1, 'Closing speed at the first contact'),
  T('minGap_m', 'Minimum gap', 'm', '>=', 2, 0, 20, 0.5, 'Smallest true bumper-to-bumper gap'),
  T('minTimeGap_s', 'Minimum time gap', 's', '>=', 1.0, 0.3, 3, 0.1, 'Smallest true gap / ego speed (parent brief: ≥ 1.0 s in S1, S2, S8)'),
  T('minTTC_s', 'Minimum TTC', 's', '>=', 4.0, 1, 10, 0.5, 'Smallest true time to collision while closing (capped at 99 s; parent: ≥ 4 s)'),
  T('warnCount', 'Warnings', '', '<=', 0, 0, 10, 1, 'Warning onsets in the run (decides only where a scenario says no warning is acceptable)'),
  T('warnSeconds', 'Time warned', 's', null, null),
  T('warnLeadTime_s', 'Warning lead time', 's', '>=', 1.5, 0, 5, 0.1, 'Last moment a braking driver avoids contact minus the warning onset; must cover the reaction time'),
  T('missedWarning', 'Missed warning', '', 'false', null, null, null, null, 'A contact or near miss with no warning before its last moment'),
  T('nuisanceWarnings', 'Nuisance warnings', '', '<=', 0, 0, 5, 1, 'Warnings the cruise would have handled alone (judged on the no-reaction run)'),
  T('unavoidable', 'Unavoidable at onset', '', null, null, null, null, null, 'A critical moment that no braking driver could avoid even at the first sample of its window'),
  T('driverInterventions', 'Driver interventions', '', '<=', 0, 0, 10, 1, 'Driver reactions to warnings and unscripted brakings'),
  T('gapErrRms_m', 'Gap error RMS', 'm', null, null),
  T('gapErrRmsRel', 'Gap error RMS / (h·v)', '', '<=', 0.3, 0.05, 1, 0.05, 'In steady following (parent: ≤ 0.3·h·v)'),
  T('oscGain', 'Oscillation gain', '', '<=', 1.0, 0.5, 2, 0.05, 'Our speed amplitude over the lead\'s at the lead\'s period (family C): above 1 amplifies waves'),
  T('followerOscGain', 'Follower oscillation gain', '', '<=', 1.2, 0.5, 3, 0.05, 'The car behind: its speed amplitude over the lead\'s'),
  T('peakDecel_mps2', 'Peak deceleration', 'm/s²', '<=', 3.5, 1, 8, 0.1, 'Ours, while the driver touches no pedal (ISO 15622 ACC limit 3.5)'),
  T('peakAccel_mps2', 'Peak acceleration', 'm/s²', '<=', 2.0, 0.5, 4, 0.1, 'Ours, while the driver touches no pedal (eagerness)'),
  T('peakJerk_mps3', 'Peak jerk (1 s mean)', 'm/s³', '<=', 2.5, 0.5, 10, 0.1, 'Change of acceleration over 1 s (ISO 15622: 2.5)'),
  T('accelRms_mps2', 'Acceleration RMS', 'm/s²', '<=', 0.5, 0.1, 2, 0.05, 'Comfort over the run'),
  T('followerMinTimeGap_s', 'Follower min time gap', 's', '>=', 0.5, 0.2, 2, 0.1, 'What we do to the car behind'),
  T('followerPeakDecel_mps2', 'Follower peak deceleration', 'm/s²', '<=', 4.0, 1, 9, 0.1, 'What we do to the car behind'),
  T('followerCollision', 'Follower collision', '', 'false', null, null, null, null, 'The car behind hits us'),
  T('setpointChangesPerMin', 'Setpoint changes per minute (peak)', '/min', '<=', 20, 5, 60, 1, 'Max over any 60 s window (parent: ≤ 20)'),
  T('setpointChangesAvgPerMin', 'Setpoint changes per minute (mean)', '/min', null, null),
  T('cmdRateLimitHits', 'Command rate-limit hits', '', '<=', 0, 0, 50, 1, 'Commands rejected or dropped by the command path'),
  T('cmdWhileInactive', 'Commands while the cruise is off/suspended', '', '<=', 0, 0, 10, 1, 'The loop must stop commanding when the driver brakes or cancels'),
  T('timeLost_s', 'Time lost vs ideal ACC', 's', '<=', 5, 0, 60, 1, 'Distance behind the ideal-ACC baseline over our end speed (sweep fills it)'),
  T('timeLostPct', 'Time lost vs ideal ACC', '%', '<=', 3, 0, 20, 0.5, 'timeLost_s over the run duration'),
  T('outOfEnvelope_s', 'Time outside the envelope', 's', null, null),
  T('envelopeExitAnnounced', 'Envelope exit announced', '', 'true', null, null, null, null, 'Leaving the envelope (cruise drop-out, lead below the cruise minimum) comes with a warning'),
  T('overspeed_kmh', 'Overspeed', 'km/h', '<=', 3, 0, 20, 0.5, 'Above the driver\'s maximum (trailing 20 s), pedals untouched'),
  T('underspeed_kmh', 'Underspeed (free)', 'km/h', null, null),
  T('settleTime_s', 'Settle time after a max change', 's', null, null),
  T('lostTargetSpeedGain_kmh', 'Speed gain after target loss', 'km/h', '<=', 2, 0, 20, 0.5, 'In the first holdCheck_s after the target is lost (hold, then release)'),
  T('curveLostSpeedGain_kmh', 'Speed gain into a curve on a lost target', 'km/h', '<=', 2, 0, 20, 0.5, 'Never accelerate into a curve on a lost target'),
  T('faultDetectDelay_s', 'Fault detection delay', 's', '<=', 2, 0, 10, 0.1, 'Frozen gap / blind sensor until a warning or the estimate goes invalid (99 = never)'),
  T('estGapErrRms_m', 'Estimated gap error RMS', 'm', null, null),
  T('estVrelErrRms_mps', 'Estimated relative speed error RMS', 'm/s', '<=', 0.3, 0.05, 2, 0.05, 'Parent Phase 3: ≤ 0.3 m/s at steady following'),
  T('egoXEnd_m', 'Ego position at the end', 'm', null, null, null, null, null, '', 'aux'),
  T('egoVEnd_mps', 'Ego speed at the end', 'm/s', null, null, null, null, null, '', 'aux'),
  T('duration_s', 'Duration', 's', null, null, null, null, null, '', 'aux'),
  // catalogue level (sweep / mixed fill these)
  T('warningsPerHour', 'Warnings per hour (mixed driving)', '/h', '<=', 1, 0, 20, 0.5, 'Family L (parent: ≤ 1 in real traffic)', 'catalogue'),
  T('interventionsPerHour', 'Driver interventions per hour', '/h', '<=', 1, 0, 20, 0.5, 'Family L', 'catalogue'),
  T('nuisancePerHour', 'Nuisance warnings per hour', '/h', '<=', 0.5, 0, 20, 0.5, 'Family L', 'catalogue'),
  T('leadBrakeHandled_mps2', 'Lead braking handled without a warning', 'm/s²', '>=', 1.5, 0.5, 6, 0.5, 'Family D: the hardest lead deceleration every variant of which passes with no warning (parent: ≥ 1.5)', 'catalogue'),
  T('passShare', 'Share of the catalogue that passes', '', '>=', 1, 0, 1, 0.05, 'Groups (variants with all their reaction cases and worst times)', 'catalogue')
];

var DEFINITIONS = [
  { key: 'nearMissGap_m', label: 'Near-miss gap', unit: 'm', default: 2, min: 0.5, max: 10, step: 0.5, group: 'definitions', help: 'A true gap below this is a critical moment; the last moment keeps this much' },
  { key: 'ttcCritical_s', label: 'Critical TTC', unit: 's', default: 1.0, min: 0.3, max: 3, step: 0.1, group: 'definitions', help: 'A true TTC below this is a critical moment' },
  { key: 'timeGapCritical_s', label: 'Critical time gap', unit: 's', default: 0.3, min: 0.1, max: 1, step: 0.05, group: 'definitions', help: 'A true time gap below this is a critical moment (a near miss at speed)' },
  { key: 'driverBrake_mps2', label: 'Driver braking for the last moment', unit: 'm/s²', default: 6, min: 3, max: 9, step: 0.5, group: 'definitions', help: 'Braking assumed when the last moment is computed' },
  { key: 'nuisanceWindow_s', label: 'Nuisance window', unit: 's', default: 10, min: 2, max: 30, step: 1, group: 'definitions', help: 'A warning not followed by a critical moment within this is a nuisance (no-reaction runs)' },
  { key: 'holdCheck_s', label: 'Hold check after target loss', unit: 's', default: 3, min: 0.5, max: 10, step: 0.5, group: 'definitions', help: 'Window of lostTargetSpeedGain_kmh' },
  { key: 'steadyMin_s', label: 'Steady following minimum', unit: 's', default: 20, min: 5, max: 120, step: 5, group: 'definitions', help: 'Same lead for this long before gap error counts' },
  { key: 'vMinActive_kmh', label: 'Cruise minimum (if the config has none)', unit: 'km/h', default: 30, min: 0, max: 60, step: 5, group: 'definitions', help: 'Used for the envelope metrics when the plant config does not say' },
  { key: 'd0_m', label: 'Standstill gap (if the controller config has none)', unit: 'm', default: 5, min: 0, max: 10, step: 0.5, group: 'definitions', help: 'To turn d.des into h·v' }
];

var SCHEMA = METRICS.filter(function (m) { return m.op && m.default !== null; }).map(function (m) {
  return { key: m.key, label: m.label, unit: m.unit, default: m.default, min: m.min, max: m.max, step: m.step,
    group: m.level === 'catalogue' ? 'thresholds.catalogue' : 'thresholds', help: m.help, op: m.op };
}).concat(DEFINITIONS);

var BY_KEY = {};
METRICS.forEach(function (m) { BY_KEY[m.key] = m; });

function defaults() {
  var o = {};
  SCHEMA.forEach(function (e) { o[e.key] = e.default; });
  return o;
}
function thresholdsOf(cfg) {
  var o = defaults(), t = (cfg && cfg.thresholds) || {};
  Object.keys(t).forEach(function (k) { o[k] = t[k]; });
  return o;
}

// ---------------------------------------------------------------- helpers
function arr(S, name) { var a = S && S[name]; return a && a.length ? a : null; }
function fin(x) { return typeof x === 'number' && isFinite(x); }
function r3(x) { return fin(x) ? Math.round(x * 1000) / 1000 : x; }

function enumName(meta, series, value) {
  var e = meta && meta.enums && meta.enums[series];
  if (!e || !fin(value)) return null;
  if (Array.isArray(e)) return e[value] === undefined ? null : e[value];
  // { name: number }
  for (var k in e) if (e[k] === value) return k;
  return null;
}
function interpTable(tb, x) {
  if (!tb || !tb.length) return 0;
  if (x <= tb[0][0]) return tb[0][1];
  for (var i = 1; i < tb.length; i++) {
    if (x <= tb[i][0]) {
      var a = tb[i - 1], b = tb[i], f = b[0] === a[0] ? 1 : (x - a[0]) / (b[0] - a[0]);
      return a[1] + f * (b[1] - a[1]);
    }
  }
  return tb[tb.length - 1][1];
}
function amplitudeAt(t, x, i0, i1, period) {
  var w = 2 * Math.PI / period, s = 0, c = 0, m = 0, n = 0, i;
  for (i = i0; i < i1; i++) if (fin(x[i])) { m += x[i]; n++; }
  if (n < 4) return null;
  m /= n;
  for (i = i0; i < i1; i++) if (fin(x[i])) { s += (x[i] - m) * Math.sin(w * t[i]); c += (x[i] - m) * Math.cos(w * t[i]); }
  return 2 * Math.sqrt(s * s + c * c) / n;
}
function edges(flag, t) {
  // rising and falling edges of a 0/1 (NaN = 0) series -> [{ i0, i1 }] (i1 exclusive)
  var out = [], on = -1;
  for (var i = 0; i < t.length; i++) {
    var f = fin(flag[i]) && flag[i] > 0;
    if (f && on < 0) on = i;
    if (!f && on >= 0) { out.push({ i0: on, i1: i }); on = -1; }
  }
  if (on >= 0) out.push({ i0: on, i1: t.length });
  return out;
}
function idxAt(t, time) {
  // first index with t[i] >= time (binary search)
  var lo = 0, hi = t.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (t[mid] < time) lo = mid + 1; else hi = mid; }
  return Math.min(lo, t.length - 1);
}

// ---------------------------------------------------------------- compute
function compute(result, config) {
  var meta = result.meta || {}, cfg = config || meta.config || {}, th = thresholdsOf(cfg);
  var sc = (cfg.scenario && cfg.scenario.inline) || {};
  var t = result.t, S = result.series || {}, ev = result.events || [];
  var n = t ? t.length : 0, m = {};
  METRICS.forEach(function (d) { if (d.level !== 'catalogue') m[d.key] = null; });
  if (n < 2) return m;
  var dt = (t[n - 1] - t[0]) / (n - 1), duration = t[n - 1] - t[0] + dt;
  var egoV = arr(S, 'ego.v'), egoA = arr(S, 'ego.a'), egoX = arr(S, 'ego.x'), gap = arr(S, 'gap.true'), vrel = arr(S, 'vrel.true');
  var leadV = arr(S, 'lead.v'), leadA = arr(S, 'lead.a'), leadId = arr(S, 'lead.id'), warn = arr(S, 'warn');
  var vMaxS = arr(S, 'v.driverMax'), dDes = arr(S, 'd.des'), estValid = arr(S, 'est.valid'), estGap = arr(S, 'est.gap');
  var estVrel = arr(S, 'est.vrel'), cstate = arr(S, 'cruise.state'), dBrake = arr(S, 'driver.brake'), dAccel = arr(S, 'driver.accel');
  var fGap = arr(S, 'follower.gap'), fA = arr(S, 'follower.a'), ttcS = arr(S, 'ttc');
  var rc = cfg.driver && (cfg.driver.reactionCase || cfg.driver.reaction);
  var reaction = sc.reaction || (rc === 'none' ? 'none' : rc === 'late' ? 'late' : rc ? 'react' : null);
  var i, j;
  m.duration_s = r3(duration);
  if (egoX) m.egoXEnd_m = r3(egoX[n - 1]);
  if (egoV) m.egoVEnd_mps = r3(egoV[n - 1]);
  function stateAt(i) { return cstate ? enumName(meta, 'cruise.state', cstate[i]) : null; }
  function pedalFree(i) { return !(dBrake && dBrake[i] > 0) && !(dAccel && dAccel[i] > 0); }

  // ---- safety
  var collided = false, impact = null;
  ev.forEach(function (e) {
    if (e.kind === 'collision' && !collided && !(e.who && e.who !== 'ego')) {
      collided = true;
      var s = e.impactSpeed !== undefined ? e.impactSpeed : (e.vrel !== undefined ? -e.vrel : null);
      impact = fin(s) ? Math.abs(s) * 3.6 : null;
    }
  });
  var minGap = Infinity, minTG = Infinity, minTTC = Infinity;
  if (gap) {
    for (i = 0; i < n; i++) {
      if (!fin(gap[i])) continue;
      if (gap[i] < minGap) minGap = gap[i];
      if (gap[i] <= 0 && !collided) { collided = true; impact = vrel && fin(vrel[i]) ? Math.abs(Math.min(0, vrel[i])) * 3.6 : null; }
      if (egoV && egoV[i] > 1 && gap[i] / egoV[i] < minTG) minTG = gap[i] / egoV[i];
      var ttc = ttcOf(i);
      if (ttc < minTTC) minTTC = ttc;
    }
  }
  function ttcOf(i) {
    if (vrel && fin(vrel[i]) && fin(gap[i])) return vrel[i] < -0.05 ? Math.max(0, gap[i]) / -vrel[i] : 99;
    if (ttcS && fin(ttcS[i])) return ttcS[i];
    return 99;
  }
  m.collision = collided;
  m.impactSpeed_kmh = collided ? r3(impact === null ? 0 : impact) : 0;
  m.minGap_m = minGap === Infinity ? null : r3(minGap);
  m.minTimeGap_s = minTG === Infinity ? null : r3(minTG);
  m.minTTC_s = minTTC === Infinity ? (gap ? 99 : null) : r3(Math.min(99, minTTC));

  // ---- warnings: onsets with their reasons
  var onsets = [];
  ev.forEach(function (e) { if (e.kind === 'warn.on') onsets.push({ t: e.t, reason: e.reason || '' }); });
  if (!onsets.length && warn) edges(warn, t).forEach(function (s) { onsets.push({ t: t[s.i0], reason: '' }); });
  m.warnCount = onsets.length;
  var warnSec = 0;
  if (warn) for (i = 0; i < n; i++) if (warn[i] > 0) warnSec += dt;
  m.warnSeconds = r3(warnSec);
  function warnedIn(t0, t1) {
    // first warning time in [t0, t1]: from the series when present, else from the onsets
    if (warn) { for (var k = idxAt(t, t0); k < n && t[k] <= t1; k++) if (warn[k] > 0) return t[k]; return null; }
    for (var q = 0; q < onsets.length; q++) if (onsets[q].t >= t0 && onsets[q].t <= t1) return onsets[q].t;
    return null;
  }

  // ---- critical moments, last moments, lead time
  var crit = [];
  if (gap) {
    var cur = null;
    for (i = 0; i < n; i++) {
      var c = fin(gap[i]) && (gap[i] < th.nearMissGap_m || ttcOf(i) < th.ttcCritical_s ||
        (egoV && egoV[i] > 1 && gap[i] / egoV[i] < th.timeGapCritical_s && !(vrel && vrel[i] > 0)));   // not while opening
      if (c) { if (cur && t[i] - t[cur.i1 - 1] <= 1.0) cur.i1 = i + 1; else { cur = { i0: i, i1: i + 1 }; crit.push(cur); } }
    }
  }
  var aDrv = th.driverBrake_mps2, margin = th.nearMissGap_m;
  function avoidable(i) {
    if (!fin(gap[i]) || !egoV) return true;
    var id = leadId ? leadId[i] : null, v0 = egoV[i], tStop = v0 / aDrv, ld = 0;
    for (var k = i; k < n; k++) {
      if (k > i) {
        if (leadId && leadId[k] !== id) return true;   // the lead changed: a new episode
        var lv0 = leadV ? leadV[k - 1] : v0 + (vrel ? vrel[k - 1] : 0), lv1 = leadV ? leadV[k] : v0 + (vrel ? vrel[k] : 0);
        if (fin(lv0) && fin(lv1)) ld += 0.5 * (lv0 + lv1) * (t[k] - t[k - 1]);
      }
      var tau = t[k] - t[i];
      var ed = tau < tStop ? v0 * tau - 0.5 * aDrv * tau * tau : v0 * v0 / (2 * aDrv);
      if (gap[i] + ld - ed < margin) return false;
      if (tau >= tStop) return true;
    }
    // data ended while still braking: the lead keeps its last speed
    var tau2 = t[n - 1] - t[i], ve = Math.max(0, v0 - aDrv * tau2), lvEnd = leadV ? leadV[n - 1] : 0;
    var gEnd = gap[i] + ld - (tau2 < tStop ? v0 * tau2 - 0.5 * aDrv * tau2 * tau2 : v0 * v0 / (2 * aDrv));
    if (ve > lvEnd) gEnd -= (ve * ve - lvEnd * lvEnd) / (2 * aDrv) - lvEnd * (ve - lvEnd) / aDrv;
    return gEnd >= margin;
  }
  var leadTimes = [], missed = false, unavoidable = false;
  crit.forEach(function (seg) {
    var iEnd = seg.i1 - 1, iFloor = idxAt(t, t[seg.i0] - 15), tLast = null;
    for (var k = iEnd; k >= iFloor; k--) if (avoidable(k)) { tLast = t[k]; break; }
    if (tLast === null) { unavoidable = true; tLast = t[iFloor]; }
    seg.tLast = tLast;
    var tw = warnedIn(tLast - 20, tLast);
    if (tw === null) missed = true; else leadTimes.push(tLast - tw);
  });
  m.missedWarning = gap ? missed : null;
  m.unavoidable = gap ? unavoidable : null;
  m.warnLeadTime_s = leadTimes.length ? r3(Math.min.apply(null, leadTimes)) : null;
  // nuisance: only where the driver does not react
  if (reaction === 'none') {
    var nz = 0;
    onsets.forEach(function (o) {
      if (/sensor|stale|lost|fault|envelope|min|blind|frozen|off/i.test(o.reason)) return;   // not a collision warning
      var followed = crit.some(function (seg) { return t[seg.i0] >= o.t - 1 && t[seg.i0] <= o.t + th.nuisanceWindow_s; });
      if (!followed) nz++;
    });
    m.nuisanceWarnings = nz;
  }

  // ---- driver
  var scripted = (sc.events || []).filter(function (e) { return e.kind === 'driverBrake'; }).map(function (e) { return e.t; });
  // one intervention = the driver starts braking on his own (after a warning, or unwarned): a driver.brake with a level,
  // not scripted by the scenario (SC1 also emits driver.react, and a level-0 driver.brake on release: neither counts)
  var interventions = 0;
  ev.forEach(function (e) {
    if (e.kind !== 'driver.brake' || e.scripted || e.cause === 'scripted' || e.cause === 'release') return;
    if (e.level !== undefined && !(e.level > 0)) return;
    if (scripted.some(function (ts) { return Math.abs(ts - e.t) < 0.25; })) return;
    interventions++;
  });
  m.driverInterventions = interventions;

  // ---- steady following: gap error
  if (gap && dDes && vrel) {
    var d0 = (cfg.controller && (cfg.controller.d0_m !== undefined ? cfg.controller.d0_m : cfg.controller.d0)) ;
    if (!fin(d0)) d0 = th.d0_m;
    var sinceChange = 0, se = 0, sh = 0, cnt = 0;
    for (i = 0; i < n; i++) {
      if (i > 0 && leadId && leadId[i] !== leadId[i - 1]) sinceChange = 0; else if (i > 0) sinceChange += t[i] - t[i - 1];
      if (!fin(gap[i]) || !fin(dDes[i]) || sinceChange < th.steadyMin_s) continue;
      if (Math.abs(vrel[i]) > 1.0 || (leadA && Math.abs(leadA[i]) > 0.3)) continue;
      var e2 = gap[i] - dDes[i]; se += e2 * e2; sh += Math.max(1, dDes[i] - d0); cnt++;
    }
    if (cnt * dt >= 5) { m.gapErrRms_m = r3(Math.sqrt(se / cnt)); m.gapErrRmsRel = r3(Math.sqrt(se / cnt) / (sh / cnt)); }
  }

  // ---- oscillation gain (family C: the lead's sine period)
  var sine = null;
  (sc.vehicles || []).forEach(function (v) { if (!sine && v.profile && v.profile.type === 'sine' && (v.id === 'lead' || !sine)) sine = v.profile; });
  if (sine && egoV && leadV) {
    var P = sine.period_s, tStart = (sine.t0 || sine.t0_s || 0) + Math.max(2 * P, 30), tEndAvail = t[n - 1];
    var nPer = Math.floor((tEndAvail - tStart) / P);
    if (nPer >= 1) {
      var i0 = idxAt(t, tStart), i1 = idxAt(t, tStart + nPer * P);
      var aL = amplitudeAt(t, leadV, i0, i1, P), aE = amplitudeAt(t, egoV, i0, i1, P);
      if (aL > 0.05) m.oscGain = r3(aE / aL);
      if (fGap && aL > 0.05) {
        var fV = followerSpeed(t, egoV, fGap);
        var aF = amplitudeAt(t, fV, i0, i1, P);
        if (aF !== null) m.followerOscGain = r3(aF / aL);
      }
    }
  }

  // ---- comfort
  if (egoA) {
    var pd = 0, pa = 0, ss = 0, sc2 = 0, pj = 0, w = Math.max(1, Math.round(1 / dt));
    for (i = 0; i < n; i++) {
      if (!pedalFree(i) || !fin(egoA[i])) continue;
      if (-egoA[i] > pd) pd = -egoA[i];
      if (egoA[i] > pa) pa = egoA[i];
      ss += egoA[i] * egoA[i]; sc2++;
      j = i + w;
      if (j < n && pedalFree(j) && fin(egoA[j])) { var jk = Math.abs(egoA[j] - egoA[i]) / (t[j] - t[i]); if (jk > pj) pj = jk; }
    }
    m.peakDecel_mps2 = r3(pd); m.peakAccel_mps2 = r3(pa); m.peakJerk_mps3 = r3(pj);
    m.accelRms_mps2 = sc2 ? r3(Math.sqrt(ss / sc2)) : null;
  }

  // ---- the car behind
  var fAny = false;
  if (fGap) for (i = 0; i < n && !fAny; i++) if (fin(fGap[i])) fAny = true;
  if (fGap && egoV && fAny) {
    var fv = followerSpeed(t, egoV, fGap), fmin = Infinity, fcol = false;
    for (i = 0; i < n; i++) {
      if (!fin(fGap[i])) continue;
      if (fGap[i] <= 0) fcol = true;
      if (fv[i] > 1 && fGap[i] / fv[i] < fmin) fmin = fGap[i] / fv[i];
    }
    m.followerMinTimeGap_s = fmin === Infinity ? null : r3(fmin);
    m.followerCollision = fcol;
    if (fA) { var fpd = 0; for (i = 0; i < n; i++) if (fin(fA[i]) && -fA[i] > fpd) fpd = -fA[i]; m.followerPeakDecel_mps2 = r3(fpd); }
  }

  // ---- commands
  var sent = ev.filter(function (e) { return e.kind === 'cmd.sent'; }).map(function (e) { return e.t; });
  m.setpointChangesAvgPerMin = r3(sent.length / (duration / 60));
  var peak = 0;   // the most commands in any 60 s window (a run shorter than 60 s: all of them)
  for (i = 0, j = 0; i < sent.length; i++) { while (sent[i] - sent[j] >= 60) j++; if (i - j + 1 > peak) peak = i - j + 1; }
  m.setpointChangesPerMin = r3(peak);
  m.cmdRateLimitHits = ev.filter(function (e) { return e.kind === 'cmd.rejected' || (e.kind === 'cmd.dropped' && /rate/.test(e.reason || '')); }).length;
  if (cstate) {
    var inact = 0;
    sent.forEach(function (ts) { var nm = stateAt(idxAt(t, ts)); if (nm === 'off' || nm === 'suspended' || nm === 'dropout') inact++; });
    m.cmdWhileInactive = inact;
  }

  // ---- envelope
  var vMin = ((cfg.plant && (cfg.plant.vMinActive_kmh || cfg.plant.vMin_kmh)) || th.vMinActive_kmh) / 3.6;
  var cancelT = (sc.events || []).filter(function (e) { return e.kind === 'driverCancel'; }).map(function (e) { return e.t; });
  var tExit = null, outSec = 0, wasActive = false;
  for (i = 0; i < n; i++) {
    var nm2 = stateAt(i);
    if (nm2 === 'active') wasActive = true;
    var dropped = wasActive && (nm2 === 'dropout' || (nm2 === 'off' && !cancelT.some(function (c) { return c <= t[i]; })));
    var leadSlow = gap && leadV && fin(gap[i]) && gap[i] < 100 && leadV[i] < vMin - 0.5;
    if (dropped || leadSlow) { outSec += dt; if (tExit === null) tExit = t[i]; }
  }
  m.outOfEnvelope_s = r3(outSec);
  if (tExit !== null) m.envelopeExitAnnounced = warnedIn(tExit - 15, tExit + 1) !== null;

  // ---- speed vs the driver's maximum
  if (egoV && vMaxS) {
    var over = 0, win = Math.round(20 / dt), dq = [];
    for (i = 0; i < n; i++) {
      // trailing max of the maximum over 20 s (a monotonic deque)
      while (dq.length && vMaxS[dq[dq.length - 1]] <= vMaxS[i]) dq.pop();
      dq.push(i);
      if (dq[0] <= i - win) dq.shift();
      if (!pedalFree(i) || !fin(vMaxS[i])) continue;
      var ov = egoV[i] - vMaxS[dq[0]];
      if (ov > over) over = ov;
    }
    m.overspeed_kmh = r3(over * 3.6);
    var vmaxT = (sc.events || []).filter(function (e) { return e.kind === 'driverVmax'; }).map(function (e) { return e.t; });
    ev.forEach(function (e) { if (e.kind === 'driver.vmax') vmaxT.push(e.t); });
    var lastV = vmaxT.length ? Math.max.apply(null, vmaxT) : null;
    if (lastV !== null) {
      var settled = null;
      for (i = n - 1; i >= 0 && t[i] >= lastV; i--) { if (Math.abs(egoV[i] - vMaxS[i]) > 1 / 3.6) break; settled = t[i]; }
      m.settleTime_s = settled === null ? null : r3(settled - lastV);
    }
    var under = 0;
    for (i = 0; i < n; i++) {
      if (t[i] < 10 || (gap && fin(gap[i])) || !pedalFree(i)) continue;
      if (vmaxT.some(function (tv) { return t[i] >= tv && t[i] < tv + 15; })) continue;
      if (vMaxS[i] - egoV[i] > under) under = vMaxS[i] - egoV[i];
    }
    m.underspeed_kmh = r3(under * 3.6);
  }

  // ---- target loss: hold, then release; never into a curve
  var validS = estValid || arr(S, 'meas.valid');
  if (validS && egoV) {
    var gain = 0, cgain = 0, curv = (sc.road && sc.road.curvature) || null;
    var segs = edges(validS, t);
    for (var q = 0; q < segs.length; q++) {
      var iL = segs[q].i1;                     // the first invalid sample after a valid stretch
      if (iL >= n) continue;
      var iNext = q + 1 < segs.length ? segs[q + 1].i0 : n;
      var vL = egoV[iL], tH = t[iL] + th.holdCheck_s;
      for (i = iL; i < iNext && t[i] <= tH; i++) if (egoV[i] - vL > gain && pedalFree(i)) gain = egoV[i] - vL;
      if (curv && egoX) {
        for (i = iL; i < iNext; i++) {
          if (Math.abs(interpTable(curv, egoX[i])) < 1 / 1500 || !pedalFree(i)) continue;
          if (egoV[i] - vL > cgain) cgain = egoV[i] - vL;
        }
      }
    }
    m.lostTargetSpeedGain_kmh = r3(gain * 3.6);
    m.curveLostSpeedGain_kmh = curv ? r3(cgain * 3.6) : null;
  }

  // ---- fault detection
  var faults = [];
  ev.forEach(function (e) { if (e.kind === 'fault.on') faults.push({ t: e.t, kind: e.fault || e.what || e.name || '' }); });
  if (!faults.length) (sc.events || []).forEach(function (e) { if (e.kind === 'fault') faults.push({ t: e.t, kind: e.fault }); });
  var det = faults.filter(function (f) { return /gapFreeze|gapFrozen|sensorBlind|latencySpike|huRestart/.test(f.kind); });
  if (det.length) {
    var worstDelay = 0;
    det.forEach(function (f) {
      var tw = warnedIn(f.t, f.t + 60), ti = null;
      if (validS) for (i = idxAt(t, f.t); i < n; i++) if (!(validS[i] > 0)) { ti = t[i]; break; }
      var cands = [tw, ti].filter(function (x) { return x !== null; });
      var d = cands.length ? Math.min.apply(null, cands) - f.t : 99;
      if (d > worstDelay) worstDelay = d;
    });
    m.faultDetectDelay_s = r3(worstDelay);
  }

  // ---- estimator quality
  if (estValid && gap && leadId) {
    var eg = 0, evr = 0, ce = 0, since = 0;
    for (i = 0; i < n; i++) {
      if (i > 0 && leadId[i] !== leadId[i - 1]) since = 0; else if (i > 0) since += t[i] - t[i - 1];
      if (!(estValid[i] > 0) || !fin(gap[i]) || since < 2) continue;
      if (estGap && fin(estGap[i])) eg += (estGap[i] - gap[i]) * (estGap[i] - gap[i]);
      if (estVrel && fin(estVrel[i]) && vrel) evr += (estVrel[i] - vrel[i]) * (estVrel[i] - vrel[i]);
      ce++;
    }
    if (ce) { m.estGapErrRms_m = estGap ? r3(Math.sqrt(eg / ce)) : null; m.estVrelErrRms_mps = estVrel ? r3(Math.sqrt(evr / ce)) : null; }
  }
  return m;
}

function followerSpeed(t, egoV, fGap) {
  // the follower's speed from ours and the gap's derivative (central difference over ~0.5 s)
  var n = t.length, out = new Float64Array(n), dt = (t[n - 1] - t[0]) / (n - 1), h = Math.max(1, Math.round(0.25 / dt));
  for (var i = 0; i < n; i++) {
    var a = Math.max(0, i - h), b = Math.min(n - 1, i + h);
    out[i] = fin(fGap[a]) && fin(fGap[b]) && b > a ? egoV[i] - (fGap[b] - fGap[a]) / (t[b] - t[a]) : NaN;
  }
  return out;
}

// ---------------------------------------------------------------- verdict
function verdict(metrics, thresholds, decide) {
  var th = Object.assign(defaults(), thresholds || {}), failed = [], unknown = [];
  (decide || []).forEach(function (k) {
    var d = BY_KEY[k], v = metrics ? metrics[k] : undefined;
    if (!d || !d.op) { unknown.push(k); return; }
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) { unknown.push(k); return; }
    var ok;
    if (d.op === 'false') ok = v === false || v === 0;
    else if (d.op === 'true') ok = v === true || v === 1;
    else if (d.op === '>=') ok = v >= th[k];
    else ok = v <= th[k];
    if (!ok) failed.push(k);
  });
  return { pass: failed.length === 0, failed: failed, unknown: unknown };
}

// each metric at its worst over a list (null where no member has a value)
function worst(list) {
  var out = {};
  METRICS.forEach(function (d) {
    var vals = list.map(function (m) { return m ? m[d.key] : null; }).filter(function (v) { return v !== null && v !== undefined; });
    if (!vals.length) { out[d.key] = null; return; }
    if (typeof vals[0] === 'boolean') {
      out[d.key] = d.op === 'true' ? vals.every(Boolean) : vals.some(Boolean);
    } else if (d.op === '>=') out[d.key] = Math.min.apply(null, vals);
    else out[d.key] = Math.max.apply(null, vals);
  });
  return out;
}

function timeLost(ours, base) {
  if (!ours || !base || !fin(ours.egoXEnd_m) || !fin(base.egoXEnd_m)) return { timeLost_s: null, timeLostPct: null };
  var dx = base.egoXEnd_m - ours.egoXEnd_m, v = Math.max(1, ours.egoVEnd_mps || 0);
  var tl = dx / v;
  return { timeLost_s: r3(tl), timeLostPct: ours.duration_s ? r3(100 * tl / ours.duration_s) : null };
}

var X = {
  NAME: 'thresholds', METRICS: METRICS, SCHEMA: SCHEMA, DEFINITIONS: DEFINITIONS, BY_KEY: BY_KEY,
  defaults: defaults, thresholdsOf: thresholdsOf, compute: compute, verdict: verdict, worst: worst, timeLost: timeLost,
  _amplitudeAt: amplitudeAt, _interpTable: interpTable
};
if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {}).metrics = X;
})();
