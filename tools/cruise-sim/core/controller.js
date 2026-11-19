/*
 * core/controller.js — the set-speed law (parent brief, Phase 4).  Owner: SC2.
 *
 * Node 8.16 syntax and PURE: no clock, no I/O, no randomness, no global state.
 *
 *   d_des = d0 + h v
 *   v_ref = v_lead + (d - d_des) / tau  [+ a_lead T_lag, optional]   [<= v_lead + sqrt(2 a_plan (d - d_des)), optional]
 *   v_set = quantize( ratelimit( min(v_driver, max(v_ref, v_cc_min)) ) )
 *
 * Rules (parent brief and its failure-mode table):
 *  - no valid target: v_set = v_driver (raised at the up rate);
 *  - target lost or input stale: HOLD the set speed (never raise it) for holdAfterLoss_s, then release;
 *  - never accelerate into a curve on a lost target: while the lateral acceleration v^2 |kappa| is above
 *    aLatHold (or was, within holdAfterCurve_s), a lost target keeps the hold;
 *  - rate limits, faster down than up; the driver lowering the maximum acts at once;
 *  - quantised to the cruise step with hysteresis (change only when the unquantised value is a full
 *    hysteresis away), and at most maxChangeHz changes per second;
 *  - the cruise not active (suspended, off, dropped out): command nothing (vSet = null) and re-sync from the
 *    cruise's held set speed when it is active again (the driver's resume).
 *
 * step({ t, est, egoV, egoA, vDriver, cruise, yawRate?, curvature? }) ->
 *   { vSet (m/s, or null = command nothing), send (true = send vSet now (a change or a resend)),
 *     vRef, dDes, reason, y (the rate-limited value before quantisation), target }
 */
(function () {
  'use strict';

  var KMH = 1 / 3.6;

  var SCHEMA = [
    { key: 'rateHz', label: 'Controller rate', unit: 'Hz', default: 10, min: 2, max: 20, step: 1, group: 'loop', help: 'How often the set-speed logic runs (5–10 Hz in the parent brief).' },
    { key: 'd0', label: 'Standstill gap d0', unit: 'm', default: 5, min: 3, max: 8, step: 0.5, group: 'law', help: 'Tuning table: 5 m, sweep 3–8.' },
    { key: 'h', label: 'Time gap h', unit: 's', default: 2.0, min: 1.5, max: 3.0, step: 0.1, group: 'law', help: 'Tuning table: 2.0 s, sweep 1.5–3.0.' },
    { key: 'tau', label: 'Gap-closing time tau', unit: 's', default: 4, min: 2, max: 8, step: 0.5, group: 'law', help: 'Tuning table: 4 s, sweep 2–8; must exceed the cruise tau_c + T_d.' },
    { key: 'rateDown_kmhps', label: 'Rate limit down', unit: 'km/h/s', default: 3, min: 1, max: 5, step: 0.5, group: 'limits', help: 'Tuning table: 3, sweep 1–5.' },
    { key: 'rateUp_kmhps', label: 'Rate limit up', unit: 'km/h/s', default: 1, min: 0.5, max: 2, step: 0.1, group: 'limits', help: 'Tuning table: 1, sweep 0.5–2.' },
    { key: 'step_kmh', label: 'Cruise step', unit: 'km/h', default: 1, min: 1, max: 10, step: 1, group: 'quantisation', help: 'The set-speed resolution the cruise accepts (1, maybe 5 or 10).' },
    { key: 'hystSteps', label: 'Hysteresis', unit: 'steps', default: 1, min: 0.5, max: 3, step: 0.1, group: 'quantisation', help: 'A new step is commanded only when the unquantised value is this many steps from the current one (0.5 = plain rounding).' },
    { key: 'maxChangeHz', label: 'Max setpoint changes', unit: '1/s', default: 2, min: 0.2, max: 10, step: 0.1, group: 'quantisation', help: 'Bounded by what the cruise accepts (unknown).' },
    { key: 'resendAfter_s', label: 'Resend after', unit: 's', default: 1.0, min: 0, max: 5, step: 0.1, group: 'quantisation', help: 'If the cruise\'s held set speed differs from ours this long (a lost command), send again. 0 = never.' },
    { key: 'vMinCruise_kmh', label: 'Cruise minimum', unit: 'km/h', default: 30, min: 20, max: 60, step: 1, group: 'limits', help: 'v_cc,min: the set speed is never below it.' },
    { key: 'vMaxCruise_kmh', label: 'Cruise maximum', unit: 'km/h', default: 210, min: 120, max: 250, step: 5, group: 'limits', help: '' },
    { key: 'maxBelowEgo_kmh', label: 'Max below our speed', unit: 'km/h', default: 30, min: 5, max: 100, step: 1, group: 'limits', help: 'The set speed is kept at most this far below our current speed (the cruise brakes no harder for a lower one; limits the rebound).' },
    { key: 'ffEnable', label: 'Lead-acceleration feed-forward', unit: '', default: false, options: [false, true], group: 'law', help: 'a_lead x T_lag; only if a_lead is clean enough.' },
    { key: 'tLag_s', label: 'T_lag', unit: 's', default: 1.0, min: 0, max: 3, step: 0.1, group: 'law', help: 'Identified dead time + estimator delay.' },
    { key: 'ffMax_mps', label: 'Feed-forward limit', unit: 'm/s', default: 3, min: 0, max: 10, step: 0.5, group: 'law', help: '' },
    { key: 'kinLimit', label: 'Kinematic limit', unit: '', default: false, options: [false, true], group: 'law', help: 'Not in the parent law: cap v_ref at v_lead + sqrt(2 a_plan (d - d_des)), so a large closing speed is shed early by a weak cruise.' },
    { key: 'aPlan_mps2', label: 'Planned deceleration', unit: 'm/s²', default: 1.0, min: 0.2, max: 3, step: 0.1, group: 'law', help: 'For the kinematic limit: what the cruise is assumed to deliver.' },
    { key: 'holdAfterLoss_s', label: 'Hold after loss', unit: 's', default: 3, min: 0, max: 10, step: 0.5, group: 'loss', help: 'Hold the set speed this long after the target is lost or the input goes stale, then release to the maximum.' },
    { key: 'aLatHold_mps2', label: 'Curve hold threshold', unit: 'm/s²', default: 0.7, min: 0.2, max: 3, step: 0.1, group: 'loss', help: 'A lost target while v² |kappa| is above this keeps the hold until the curve ends.' },
    { key: 'holdAfterCurve_s', label: 'Hold after the curve', unit: 's', default: 1.0, min: 0, max: 5, step: 0.5, group: 'loss', help: '' },
    { key: 'commandDuringOverride', label: 'Command during override', unit: '', default: true, options: [true, false], group: 'loop', help: 'Keep tracking while the driver overrides with the accelerator, so the set speed is right when released.' }
  ];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function fill(params) {
    var p = {};
    var i, k;
    for (i = 0; i < SCHEMA.length; i++) p[SCHEMA[i].key] = SCHEMA[i].default;
    if (params) for (k in params) if (has(params, k) && params[k] !== undefined) p[k] = params[k];
    return p;
  }

  function create(params) {
    var p = fill(params);
    var stepMs = p.step_kmh * KMH;
    var vMin = Math.ceil(p.vMinCruise_kmh / p.step_kmh - 1e-9) * stepMs;
    var vMaxC = Math.floor(p.vMaxCruise_kmh / p.step_kmh + 1e-9) * stepMs;
    var S = {
      y: null, Q: null, lastT: null, lastChangeT: -Infinity, lastSendT: -Infinity, mismatchSince: null,
      hadTarget: false, lastTargetT: null, lossInCurve: false, lastCurveT: -Infinity
    };

    function qRound(v) { return Math.round(v / stepMs + 1e-9) * stepMs; }
    function qDown(v) { return Math.floor(v / stepMs + 1e-9) * stepMs; }

    function inactive(reason) {
      S.y = null; S.Q = null; S.lastT = null; S.mismatchSince = null;
      return { vSet: null, send: false, vRef: null, dDes: null, reason: reason, y: null, target: null };
    }

    function step(inp) {
      var t = inp.t;
      var egoV = inp.egoV;
      var cruise = inp.cruise || { state: 'active', setHeld: null };
      var st = cruise.state;
      var active = st === 'active' || (st === 'override' && p.commandDuringOverride);
      if (!active) return inactive(st || 'inactive');

      var vDriver = Math.min(Math.max(inp.vDriver, vMin), vMaxC);
      if (S.y === null) {
        // (re)activation: start from what the cruise holds (the driver's set / resume), else our speed
        var start = cruise.setHeld !== null && cruise.setHeld !== undefined && cruise.setHeld > 0 ? cruise.setHeld : egoV;
        S.y = start; S.Q = qRound(start); S.lastT = t;
      }
      var dt = Math.max(0, t - S.lastT);
      S.lastT = t;

      var dDes = p.d0 + p.h * egoV;
      var kappa = inp.curvature !== undefined && inp.curvature !== null ? inp.curvature
        : (inp.yawRate !== undefined && inp.yawRate !== null && egoV > 1 ? inp.yawRate / egoV : 0);
      var inCurve = egoV * egoV * Math.abs(kappa) >= p.aLatHold_mps2;
      if (inCurve) S.lastCurveT = t;
      var curveNow = inCurve || t - S.lastCurveT < p.holdAfterCurve_s;

      var est = inp.est;
      var valid = !!(est && est.valid && !est.stale);
      var vRef = null; var target; var reason;
      if (valid) {
        S.hadTarget = true; S.lastTargetT = t; S.lossInCurve = false;
        var vlead = est.vlead !== null && est.vlead !== undefined ? est.vlead : egoV + est.vrel;
        vRef = vlead + (est.gap - dDes) / p.tau;
        if (p.ffEnable && est.alead !== null && est.alead !== undefined) {
          vRef += Math.max(-p.ffMax_mps, Math.min(p.ffMax_mps, est.alead * p.tLag_s));
        }
        if (p.kinLimit) vRef = Math.min(vRef, vlead + Math.sqrt(2 * p.aPlan_mps2 * Math.max(0, est.gap - dDes)));
        target = Math.max(vRef, vMin);
        reason = vRef < vMin ? 'cruiseMin' : 'follow';
        if (target >= vDriver) { target = vDriver; reason = 'driverMax'; }
      } else {
        var since = S.hadTarget ? t - S.lastTargetT : Infinity;
        if (S.hadTarget && since < p.holdAfterLoss_s && curveNow) S.lossInCurve = true;
        if (S.lossInCurve && !curveNow) S.lossInCurve = false;
        var holding = S.hadTarget && (since < p.holdAfterLoss_s || S.lossInCurve);
        if (holding) {
          target = Math.min(S.y, vDriver);
          reason = est && est.stale ? 'stale' : (S.lossInCurve ? 'curveHold' : 'hold');
        } else {
          S.hadTarget = false;
          target = vDriver;
          reason = 'free';
        }
      }

      // rate limit; the driver lowering the maximum acts at once
      var up = p.rateUp_kmhps * KMH * dt; var down = p.rateDown_kmhps * KMH * dt;
      var d = target - S.y;
      S.y += d > up ? up : (d < -down ? -down : d);
      S.y = Math.max(S.y, egoV - p.maxBelowEgo_kmh * KMH, vMin);
      S.y = Math.min(S.y, vDriver);

      // quantise with hysteresis, at most maxChangeHz changes per second
      var prevQ = S.Q;
      var thr = Math.max(0.5, p.hystSteps) * stepMs;
      var rateOk = t - S.lastChangeT >= 1 / p.maxChangeHz - 1e-9;
      // settled on the driver's maximum (free, or the lead faster than it): no reason to stay a step off it
      var atMax = (reason === 'free' || reason === 'driverMax') && Math.abs(S.y - target) < 1e-6;
      if (rateOk && (Math.abs(S.y - S.Q) >= thr - 1e-9 || atMax)) S.Q = qRound(S.y);
      var cap = qDown(vDriver);
      if (S.Q > cap) S.Q = cap;            // never above the driver's maximum, immediately
      if (S.Q < vMin) S.Q = vMin;
      var changed = Math.abs(S.Q - prevQ) > 1e-9;
      if (changed) S.lastChangeT = t;

      // resend when the cruise holds something else for too long (a lost or rejected command)
      var send = changed;
      var held = cruise.setHeld;
      if (!changed && p.resendAfter_s > 0 && held !== null && held !== undefined && Math.abs(held - S.Q) > stepMs / 2) {
        if (S.mismatchSince === null) S.mismatchSince = t;
        if (t - S.mismatchSince >= p.resendAfter_s - 1e-9 && t - S.lastSendT >= p.resendAfter_s - 1e-9) send = true;
      } else if (!changed) S.mismatchSince = null;
      if (send) { S.lastSendT = t; S.mismatchSince = null; }

      return { vSet: S.Q, send: send, vRef: vRef, dDes: dDes, reason: reason, y: S.y, target: target };
    }

    return { params: p, step: step, state: function () { return { y: S.y, Q: S.Q, hadTarget: S.hadTarget, lossInCurve: S.lossInCurve }; } };
  }

  var X = { NAME: 'controller', SCHEMA: SCHEMA, defaults: function () { return fill(null); }, fill: fill, create: create };
  if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {})['controller'] = X;
})();
