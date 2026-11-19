/*
 * core/warning.js — the driver warning (parent brief, Phase 4).  Owner: SC2.
 *
 * Node 8.16 syntax and PURE: no clock, no I/O, no randomness, no global state.
 *
 *   d_needed = d0 + (v - v_lead)^2 / (2 |a_min|)   [+ v_c T_dead, optional]
 *   warn if d < d_needed or TTC < TTC_warn
 * a_min is the cruise's deceleration (the plant's configured limit), not a theoretical braking value.
 * Added for the failure-mode table: a sensor warning when the input goes stale or blind while (or shortly
 * after) following — "stale input = no target and a warning"; the camera blind = the driver is told.
 * An off-delay keeps the warning from flickering.
 *
 * step({ t, est, egoV, aMin, aCmdMax? }) -> { warn, reason, dNeeded, ttc, raw, aUsed }
 *   reason: 'distance' | 'ttc' | 'distance+ttc' | 'sensor' | null
 *   aCmdMax (m/s², optional): the deceleration the loop itself can ask for — the controller's down rate limit
 *   (3 km/h/s = 0.83 m/s²). The cruise cannot slow faster than its set speed falls, so with limitByLoop the
 *   warning uses min(|a_min|, aCmdMax). Without it a cruise that could brake at 1.8 m/s² is credited with that
 *   while the loop only ever asks for 0.83, and the warning comes too late (found on the SC1 engine, demo.approach).
 * ttc is Infinity when not closing; dNeeded is null without a valid target.
 */
(function () {
  'use strict';

  var SCHEMA = [
    { key: 'd0', label: 'Standstill gap d0', unit: 'm', default: 5, min: 3, max: 8, step: 0.5, group: 'warning', help: 'The gap the warning protects (same start value as the controller).' },
    { key: 'ttcWarn_s', label: 'TTC_warn', unit: 's', default: 3, min: 2, max: 4, step: 0.1, group: 'warning', help: 'Tuning table: 3 s, sweep 2–4.' },
    { key: 'tDead_s', label: 'Dead time in d_needed', unit: 's', default: 0, min: 0, max: 3, step: 0.1, group: 'warning', help: 'Not in the parent formula: adds v_closing x T_dead (the cruise reacts late). 0 = the parent formula.' },
    { key: 'limitByLoop', label: 'Limit a_min by the loop', unit: '', default: true, options: [true, false], group: 'warning', help: 'd_needed uses min(|a_min|, aCmdMax) when the engine passes aCmdMax (the controller\'s down rate limit). false = the parent formula.' },
    { key: 'leadBraking', label: 'Lead braking in d_needed', unit: '', default: 'ignore', options: ['ignore', 'estimate'], group: 'warning', help: '"ignore": the parent formula (the lead holds its speed). "estimate": the lead keeps braking at the estimated a_lead to a stop; d_needed = d0 + the largest closing distance. Under sustained lead braking the parent formula warns late.' },
    { key: 'aLeadMin_mps2', label: 'Lead braking threshold', unit: 'm/s²', default: 0.5, min: 0, max: 3, step: 0.1, group: 'warning', help: '"estimate" uses a_lead only when it is below minus this (noise).' },
    { key: 'margin', label: 'Distance margin', unit: '', default: 1.0, min: 0.5, max: 2, step: 0.05, group: 'warning', help: 'warn if d < margin x d_needed.' },
    { key: 'aMinFloor_mps2', label: 'Smallest a_min used', unit: 'm/s²', default: 0.1, min: 0.01, max: 1, step: 0.01, group: 'warning', help: 'Guards the division when a plant has (almost) no braking.' },
    { key: 'onDelay_s', label: 'On delay', unit: 's', default: 0, min: 0, max: 1, step: 0.05, group: 'warning', help: 'The condition must hold this long before the warning comes on.' },
    { key: 'offDelay_s', label: 'Off delay', unit: 's', default: 1.0, min: 0, max: 5, step: 0.1, group: 'warning', help: 'The warning stays on this long after the condition clears.' },
    { key: 'vMinWarn_kmh', label: 'No warning below', unit: 'km/h', default: 10, min: 0, max: 40, step: 1, group: 'warning', help: '' },
    { key: 'warnOnSensorFault', label: 'Warn on a sensor fault', unit: '', default: true, options: [true, false], group: 'warning', help: 'Stale or blind input while following = a warning.' },
    { key: 'sensorWarnAfter_s', label: 'Sensor fault persists', unit: 's', default: 1.0, min: 0, max: 5, step: 0.1, group: 'warning', help: 'A sensor fault warns only after lasting this long: the controller already holds the set speed at once, and short dropouts would otherwise be nuisance warnings.' },
    { key: 'sensorWarnWindow_s', label: 'Sensor warning window', unit: 's', default: 5, min: 0, max: 30, step: 0.5, group: 'warning', help: 'A sensor fault warns if a target was held within this time (the driver must know the following is off).' }
  ];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function fill(params) {
    var p = {};
    var i, k;
    for (i = 0; i < SCHEMA.length; i++) p[SCHEMA[i].key] = SCHEMA[i].default;
    if (params) for (k in params) if (has(params, k) && params[k] !== undefined) p[k] = params[k];
    return p;
  }

  // The two kinematic quantities, exported for tests and for metrics.
  function needed(d0, vc, aMin, tDead) {
    var a = Math.abs(aMin);
    return d0 + (vc > 0 ? vc * vc / (2 * a) + vc * (tDead || 0) : 0);
  }

  // The largest closing distance (how much the gap shrinks at most) when we hold v for tDead and then slow at aE
  // (> 0) to a stop, while the lead slows from vL at bL (> 0) to a stop. Closed form: the relative speed
  // v_e(t) - v_l(t) is piecewise linear, and the gap is smallest where it first reaches zero (or when we stop).
  // With bL = 0 it is the parent's vc tDead + vc^2 / (2 aE).
  function maxClosing(v, vL, aE, bL, tDead) {
    var td = tDead || 0;
    function ve(t) { return t <= td ? v : Math.max(0, v - aE * (t - td)); }
    function vl(t) { return bL > 0 ? Math.max(0, vL - bL * t) : vL; }
    function xe(t) {
      if (t <= td) return v * t;
      var tb = Math.min(t - td, v / aE);
      return v * td + v * tb - aE * tb * tb / 2;
    }
    function xl(t) {
      if (!(bL > 0)) return vL * t;
      var tb = Math.min(t, vL / bL);
      return vL * tb - bL * tb * tb / 2;
    }
    // breakpoints of the relative speed; the zero crossing lies in one of the linear pieces between them
    var tStopE = td + v / aE;
    var pts = [0, td, tStopE];
    if (bL > 0) pts.push(vL / bL);
    pts = pts.filter(function (x) { return x >= 0; }).sort(function (a, b) { return a - b; });
    var best = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i]; var b = i + 1 < pts.length ? pts[i + 1] : a;
      var ra = ve(a) - vl(a); var rb = ve(b) - vl(b);
      best = Math.max(best, xe(a) - xl(a));
      if (ra > 0 && rb <= 0 && b > a) {
        var tz = a + ra / (ra - rb) * (b - a);
        best = Math.max(best, xe(tz) - xl(tz));
      }
      best = Math.max(best, xe(b) - xl(b));
    }
    // after both stop (or we stop and the lead goes on) nothing closes further
    return best;
  }
  function ttcOf(gap, vc) { return vc > 1e-6 ? gap / vc : Infinity; }

  function create(params) {
    var p = fill(params);
    var S = { warn: false, condSince: null, clearSince: null, reason: null, lastTargetT: null, faultSince: null };

    function step(inp) {
      var t = inp.t;
      var est = inp.est;
      var egoV = inp.egoV;
      var aMin = Math.abs(inp.aMin === undefined || inp.aMin === null ? 0 : inp.aMin);
      if (p.limitByLoop && inp.aCmdMax > 0 && inp.aCmdMax < aMin) aMin = inp.aCmdMax;
      aMin = Math.max(aMin, p.aMinFloor_mps2);
      var valid = !!(est && est.valid && !est.stale);
      var dNeeded = null; var ttc = Infinity;
      var condD = false; var condT = false; var condS = false;
      var moving = egoV * 3.6 >= p.vMinWarn_kmh;
      if (valid) {
        S.lastTargetT = t;
        var vlead = est.vlead !== null && est.vlead !== undefined ? est.vlead : egoV + est.vrel;
        var vc = egoV - vlead;
        var aL = est.alead !== null && est.alead !== undefined ? est.alead : 0;
        if (p.leadBraking === 'estimate' && aL < -p.aLeadMin_mps2) {
          dNeeded = p.d0 + maxClosing(egoV, Math.max(0, vlead), aMin, -aL, p.tDead_s);
        } else {
          dNeeded = needed(p.d0, vc, aMin, p.tDead_s);
        }
        ttc = ttcOf(est.gap, vc);
        condD = moving && est.gap < p.margin * dNeeded;
        condT = moving && ttc < p.ttcWarn_s;
      }
      var fault = !valid && !!(est && (est.stale || est.sensorFault));
      if (!fault) S.faultSince = null; else if (S.faultSince === null) S.faultSince = t;
      if (fault && p.warnOnSensorFault && S.lastTargetT !== null && S.faultSince - S.lastTargetT <= p.sensorWarnWindow_s &&
          t - S.faultSince >= p.sensorWarnAfter_s - 1e-9) {
        condS = moving;
      }
      var raw = condD || condT || condS;
      var reason = condD && condT ? 'distance+ttc' : (condD ? 'distance' : (condT ? 'ttc' : (condS ? 'sensor' : null)));

      if (raw) {
        S.clearSince = null;
        if (S.condSince === null) S.condSince = t;
        if (!S.warn && t - S.condSince >= p.onDelay_s - 1e-9) S.warn = true;
        if (S.warn) S.reason = reason;
      } else {
        S.condSince = null;
        if (S.warn) {
          if (S.clearSince === null) S.clearSince = t;
          if (t - S.clearSince >= p.offDelay_s - 1e-9) { S.warn = false; S.reason = null; S.clearSince = null; }
        }
      }
      return { warn: S.warn, reason: S.warn ? S.reason : null, dNeeded: dNeeded, ttc: ttc, raw: raw, aUsed: aMin };
    }

    return { params: p, step: step };
  }

  var X = { NAME: 'warning', SCHEMA: SCHEMA, defaults: function () { return fill(null); }, fill: fill, create: create, needed: needed, ttc: ttcOf, maxClosing: maxClosing };
  if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {})['warning'] = X;
})();
