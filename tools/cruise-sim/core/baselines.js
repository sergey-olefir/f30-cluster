/*
 * core/baselines.js — what our set-speed loop is compared against.  Owner: SC2.
 *
 * Drop-in replacements of pipeline steps 4–7 for ego (CONTRACT): create(params, rng) -> { step(world, t, meas) -> { a } }.
 * They command our acceleration directly; sim.js integrates it (no cruise plant in between).
 *
 *  idealAcc  An adaptive cruise that commands acceleration: constant-time-gap law
 *            a = kGap (d - d0 - h v) + kVrel vrel + kAlead a_lead, capped by a free-speed law towards the driver's
 *            maximum, limited to [aMin, aMax] with a jerk limit and a first-order actuator lag. By default it
 *            sees the truth (the best a real ACC could do); with acc_useTruth = false it reads the same camera
 *            messages through its own estimator.
 *  human     The Intelligent Driver Model as our car's driver: perception noise on gap and closing speed
 *            (AR(1), correlated), a reaction delay, a braking limit.
 *
 * Config key `baselines` (flat; prefixes acc_ / hum_ keep the keys unique for schema.merge).
 */
(function () {
  'use strict';

  // siblings resolved when first used: in the page the files load in any order
  function sib(name) { return typeof require !== 'undefined' ? require('./' + name) : self.CS[name]; }
  var geom = {
    trueLead: function (world) { return sib('sensor').geom.trueLead(world); }
  };

  var SCHEMA = [
    // ideal ACC
    { key: 'acc_d0', label: 'Standstill gap', unit: 'm', default: 5, min: 2, max: 10, step: 0.5, group: 'idealAcc', help: 'Same start value as our controller, for a fair comparison.' },
    { key: 'acc_h', label: 'Time gap', unit: 's', default: 2.0, min: 0.8, max: 3, step: 0.1, group: 'idealAcc', help: '' },
    { key: 'acc_kGap', label: 'Gap gain', unit: '1/s²', default: 0.2, min: 0.02, max: 1, step: 0.01, group: 'idealAcc', help: '' },
    { key: 'acc_kVrel', label: 'Relative-speed gain', unit: '1/s', default: 0.7, min: 0.1, max: 2, step: 0.05, group: 'idealAcc', help: '' },
    { key: 'acc_kAlead', label: 'Lead-acceleration gain', unit: '', default: 0.5, min: 0, max: 1, step: 0.05, group: 'idealAcc', help: 'Feed-forward of the lead\'s acceleration.' },
    { key: 'acc_kFree', label: 'Free-speed gain', unit: '1/s', default: 0.3, min: 0.05, max: 2, step: 0.05, group: 'idealAcc', help: 'Towards the driver\'s maximum when nothing is ahead.' },
    { key: 'acc_aMin', label: 'Deceleration limit', unit: 'm/s²', default: -3.5, min: -6, max: -0.5, step: 0.1, group: 'idealAcc', help: 'Production ACC: about -3 to -4.' },
    { key: 'acc_aMax', label: 'Acceleration limit', unit: 'm/s²', default: 2.0, min: 0.5, max: 3, step: 0.1, group: 'idealAcc', help: '' },
    { key: 'acc_jerkMax', label: 'Jerk limit', unit: 'm/s³', default: 2.5, min: 0.5, max: 10, step: 0.5, group: 'idealAcc', help: '' },
    { key: 'acc_tauAct_s', label: 'Actuator lag', unit: 's', default: 0.3, min: 0, max: 1.5, step: 0.05, group: 'idealAcc', help: 'Engine and brake response.' },
    { key: 'acc_rateHz', label: 'Control rate', unit: 'Hz', default: 20, min: 5, max: 100, step: 1, group: 'idealAcc', help: '' },
    { key: 'acc_useTruth', label: 'Sees the truth', unit: '', default: true, options: [true, false], group: 'idealAcc', help: 'false: reads the simulated camera through the default estimator.' },
    // human driver (IDM)
    { key: 'hum_T', label: 'Time headway', unit: 's', default: 1.5, min: 0.5, max: 3, step: 0.1, group: 'human', help: 'IDM T.' },
    { key: 'hum_s0', label: 'Jam distance', unit: 'm', default: 2, min: 1, max: 6, step: 0.5, group: 'human', help: 'IDM s0.' },
    { key: 'hum_a', label: 'Comfortable acceleration', unit: 'm/s²', default: 1.4, min: 0.3, max: 3, step: 0.1, group: 'human', help: 'IDM a.' },
    { key: 'hum_b', label: 'Comfortable deceleration', unit: 'm/s²', default: 2.0, min: 0.5, max: 4, step: 0.1, group: 'human', help: 'IDM b.' },
    { key: 'hum_delta', label: 'Acceleration exponent', unit: '', default: 4, min: 1, max: 8, step: 1, group: 'human', help: 'IDM delta.' },
    { key: 'hum_aBrakeMax', label: 'Braking limit', unit: 'm/s²', default: 8, min: 3, max: 10, step: 0.5, group: 'human', help: '' },
    { key: 'hum_reaction_s', label: 'Reaction delay', unit: 's', default: 1.0, min: 0, max: 2.5, step: 0.1, group: 'human', help: '' },
    { key: 'hum_gapNoiseRel', label: 'Gap perception error', unit: '', default: 0.05, min: 0, max: 0.3, step: 0.01, group: 'human', help: 'Relative standard deviation of the perceived gap.' },
    { key: 'hum_vrelNoise_mps', label: 'Closing-speed perception error', unit: 'm/s', default: 0.3, min: 0, max: 2, step: 0.05, group: 'human', help: 'Standard deviation.' },
    { key: 'hum_noiseTau_s', label: 'Perception error time constant', unit: 's', default: 3, min: 0.1, max: 20, step: 0.1, group: 'human', help: 'The errors drift slowly (AR(1)).' },
    { key: 'hum_v0Factor', label: 'Desired speed / maximum', unit: '', default: 1.0, min: 0.8, max: 1.2, step: 0.01, group: 'human', help: 'The driver\'s desired speed relative to the scenario\'s maximum.' },
    { key: 'hum_rateHz', label: 'Update rate', unit: 'Hz', default: 10, min: 2, max: 100, step: 1, group: 'human', help: '' }
  ];

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function fill(params) {
    var p = {};
    var i, k;
    for (i = 0; i < SCHEMA.length; i++) p[SCHEMA[i].key] = SCHEMA[i].default;
    if (params) for (k in params) if (has(params, k) && params[k] !== undefined) p[k] = params[k];
    return p;
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function vMaxOf(world) { return world.driver && world.driver.vMax > 0 ? world.driver.vMax : 36; }

  // ---------------- ideal ACC ----------------
  function createIdealAcc(params) {
    var p = fill(params);
    var est = p.acc_useTruth ? null : sib('estimator').create({});
    var S = { aCmd: 0, aAct: 0, lastT: null, nextCtl: null, dDes: null, reason: 'free', lastMeas: null };

    function control(world, t, meas) {
      var ego = world.ego;
      var lead = null;
      if (p.acc_useTruth) {
        var L = geom.trueLead(world);
        if (L) lead = { gap: L.gap, vrel: L.vrel, alead: L.alead };
      } else {
        // the engine hands over the last delivered message on every tick: pass each one once
        var fresh = meas && meas !== S.lastMeas ? meas : null;
        if (meas) S.lastMeas = meas;
        var e = est.update(fresh, t, { egoV: ego.v, egoA: ego.a || 0 });
        if (e.valid) lead = { gap: e.gap, vrel: e.vrel, alead: e.alead || 0 };
      }
      var aFree = p.acc_kFree * (vMaxOf(world) - ego.v);
      var a = aFree;
      S.reason = 'free'; S.dDes = null;
      if (lead) {
        S.dDes = p.acc_d0 + p.acc_h * ego.v;
        var aF = p.acc_kGap * (lead.gap - S.dDes) + p.acc_kVrel * lead.vrel + p.acc_kAlead * lead.alead;
        if (aF < a) { a = aF; S.reason = 'follow'; }
      }
      S.aCmd = clamp(a, p.acc_aMin, p.acc_aMax);
    }

    function step(world, t, meas) {
      var dt = S.lastT === null ? 0 : Math.max(0, t - S.lastT);
      S.lastT = t;
      if (S.nextCtl === null) S.nextCtl = t;
      if (t >= S.nextCtl - 1e-9) { control(world, t, meas); S.nextCtl += 1 / p.acc_rateHz; if (S.nextCtl <= t) S.nextCtl = t + 1 / p.acc_rateHz; }
      var want = p.acc_tauAct_s > 0 ? S.aAct + (S.aCmd - S.aAct) * (1 - Math.exp(-dt / p.acc_tauAct_s)) : S.aCmd;
      var j = p.acc_jerkMax * dt;
      S.aAct = dt > 0 ? S.aAct + clamp(want - S.aAct, -j, j) : S.aAct;
      return { a: S.aAct, aCmd: S.aCmd, dDes: S.dDes, reason: S.reason };
    }
    return { params: p, step: step };
  }

  // ---------------- human driver (IDM) ----------------
  function idm(v, v0, s, dv, q) {
    var free = 1 - Math.pow(Math.max(0, v) / Math.max(0.1, v0), q.delta);
    if (s === null) return q.a * free;
    var sStar = q.s0 + Math.max(0, v * q.T + v * dv / (2 * Math.sqrt(q.a * q.b)));
    return q.a * (free - Math.pow(sStar / Math.max(0.1, s), 2));
  }

  function createHuman(params, rng) {
    var p = fill(params);
    var R = sib('sensor')._stream(rng, 'baseline.human', 606);
    var q = { a: p.hum_a, b: p.hum_b, T: p.hum_T, s0: p.hum_s0, delta: p.hum_delta };
    var S = { es: R.n(), ev: R.n(), buf: [], nextT: null, lastT: null, a: 0, dDes: null };

    function decide(world, t) {
      var ego = world.ego;
      var h = 1 / p.hum_rateHz;
      var rho = Math.exp(-h / p.hum_noiseTau_s);
      var k = Math.sqrt(1 - rho * rho);
      S.es = rho * S.es + k * R.n();
      S.ev = rho * S.ev + k * R.n();
      var L = geom.trueLead(world);
      var v0 = vMaxOf(world) * p.hum_v0Factor;
      var a;
      if (L) {
        var s = Math.max(0.1, L.gap * (1 + p.hum_gapNoiseRel * S.es));
        var dv = -L.vrel + p.hum_vrelNoise_mps * S.ev;      // closing speed, + = we are faster
        a = idm(ego.v, v0, s, dv, q);
        S.dDes = q.s0 + ego.v * q.T;
      } else { a = idm(ego.v, v0, null, 0, q); S.dDes = null; }
      return clamp(a, -p.hum_aBrakeMax, p.hum_a);
    }

    function step(world, t) {
      if (S.nextT === null) S.nextT = t;
      while (t >= S.nextT - 1e-9) { S.buf.push({ t: S.nextT, a: decide(world, t) }); S.nextT += 1 / p.hum_rateHz; }
      // act on the newest decision that is at least the reaction time old
      var tAct = t - p.hum_reaction_s + 1e-9;
      while (S.buf.length > 1 && S.buf[1].t <= tAct) S.buf.shift();
      if (S.buf.length && S.buf[0].t <= tAct) S.a = S.buf[0].a;
      return { a: S.a, dDes: S.dDes, reason: 'human' };
    }
    return { params: p, step: step };
  }

  var X = {
    NAME: 'baselines',
    SCHEMA: SCHEMA,
    defaults: function () { return fill(null); },
    fill: fill,
    idealAcc: { create: createIdealAcc },
    human: { create: createHuman },
    // create(params, rng) with params.mode = 'idealAcc' | 'human' (the config's ego.mode)
    create: function (params, rng) { return params && params.mode === 'human' ? createHuman(params, rng) : createIdealAcc(params); },
    idm: idm
  };
  if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {})['baselines'] = X;
})();
