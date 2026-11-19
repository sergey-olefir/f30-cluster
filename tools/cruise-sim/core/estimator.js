/*
 * core/estimator.js — the lead-vehicle estimator (parent brief, Phase 3).  Owner: SC2.
 *
 * Node 8.16 syntax and PURE: no clock (time comes in as `t`), no I/O, no randomness, no global state.
 * This is the code that would one day run on the head unit, so it reads only what the car gives:
 * the camera message (gap, relative speed if any, target id, valid flag, sequence number, its own time
 * if it has one) and our own speed and acceleration.
 *
 * Variants (params.mode):
 *   kalman    state [d, vrel], our acceleration as a known input (vrel' = a_lead - a_ego), a_lead as noise;
 *             a_lead from a filtered derivative of the lead-speed estimate.
 *   kalmanCA  state [d, vrel, a_lead], a_lead a first-order Gauss-Markov process (Singer).
 *   alphaBeta fixed alpha / beta with growing-memory warm-up after a reset; the camera's vrel blended in.
 *   raw       no filter: the last message as it is (a comparison baseline).
 * All share: re-initialisation on a target change (id change, or a confirmed distance jump: two consistent
 * jumps in a row = hysteresis, one = an outlier, skipped), coasting through short dropouts, a staleness check
 * on every input (silence, a repeated sequence number / time, identical values), and prediction to "now"
 * (the message is late by the sensor latency).
 *
 * update(meas | null, t, { egoV, egoA }) ->
 *   { valid, id, gap, vrel, vlead, alead, stale, reset, resetReason, coasting, settled, sensorFault, reason, age, n }
 */
(function () {
  'use strict';

  var SCHEMA = [
    { key: 'mode', label: 'Filter', unit: '', default: 'kalman', options: ['kalman', 'kalmanCA', 'alphaBeta', 'raw'], group: 'filter', help: 'kalman: [d, vrel]; kalmanCA: [d, vrel, a_lead]; alphaBeta: fixed gains; raw: no filter.' },
    { key: 'useVrel', label: 'Use the camera relative speed', unit: '', default: true, options: [true, false], group: 'filter', help: 'If false the relative speed is estimated from the gap alone.' },
    { key: 'useEgoAccel', label: 'Our acceleration as input', unit: '', default: true, options: [true, false], group: 'filter', help: 'vrel changes by -a_ego when the lead holds its speed.' },
    { key: 'useMeasTime', label: 'Use the message time', unit: '', default: true, options: [true, false], group: 'timing', help: 'Use the message\'s own time (tMeas) when it has one; otherwise the receive time minus the assumed latency.' },
    { key: 'latencyComp_s', label: 'Assumed latency', unit: 's', default: 0.15, min: 0, max: 1, step: 0.01, group: 'timing', help: 'Used only when the message has no time of its own.' },
    { key: 'predictToNow', label: 'Predict to now', unit: '', default: true, options: [true, false], group: 'timing', help: 'Extrapolate the estimate from the measurement time to the controller tick.' },
    // Kalman
    { key: 'qAccel_mps2', label: 'Lead acceleration noise', unit: 'm/s²', default: 1.0, min: 0.05, max: 5, step: 0.05, group: 'kalman', help: 'Process noise: how hard the lead may accelerate unannounced. Larger = faster, noisier.' },
    { key: 'rGap0_m', label: 'Assumed gap noise floor', unit: 'm', default: 0.1, min: 0.01, max: 2, step: 0.01, group: 'kalman', help: 'The estimator\'s model of the camera (sd at 0 m).' },
    { key: 'rGap100_m', label: 'Assumed gap noise at 100 m', unit: 'm', default: 3.0, min: 0, max: 15, step: 0.1, group: 'kalman', help: '' },
    { key: 'rGapExp', label: 'Assumed gap noise exponent', unit: '', default: 2, min: 1, max: 3, step: 0.1, group: 'kalman', help: '' },
    { key: 'rVrel0_mps', label: 'Assumed vrel noise floor', unit: 'm/s', default: 0.3, min: 0.01, max: 3, step: 0.01, group: 'kalman', help: '' },
    { key: 'rVrel100_mps', label: 'Assumed vrel noise at 100 m', unit: 'm/s', default: 1.5, min: 0, max: 5, step: 0.1, group: 'kalman', help: '' },
    { key: 'rVrelExp', label: 'Assumed vrel noise exponent', unit: '', default: 1.5, min: 1, max: 3, step: 0.1, group: 'kalman', help: '' },
    { key: 'p0Vrel_mps', label: 'Initial vrel uncertainty', unit: 'm/s', default: 4, min: 0.5, max: 15, step: 0.5, group: 'kalman', help: 'After a reset with no measured relative speed.' },
    { key: 'aleadTau_s', label: 'Lead acceleration time constant', unit: 's', default: 2, min: 0.2, max: 10, step: 0.1, group: 'kalman', help: 'kalmanCA: how long a lead acceleration persists.' },
    { key: 'aleadSd_mps2', label: 'Lead acceleration spread', unit: 'm/s²', default: 1.0, min: 0.1, max: 4, step: 0.1, group: 'kalman', help: 'kalmanCA: steady standard deviation of the lead\'s acceleration.' },
    // alpha-beta
    { key: 'alpha', label: 'Alpha', unit: '', default: 0.5, min: 0.05, max: 1, step: 0.01, group: 'alphaBeta', help: 'Position gain (steady state).' },
    { key: 'beta', label: 'Beta', unit: '', default: 0.1, min: 0.005, max: 1, step: 0.005, group: 'alphaBeta', help: 'Velocity gain (steady state).' },
    { key: 'alphaV', label: 'Camera vrel weight', unit: '', default: 0.2, min: 0, max: 1, step: 0.01, group: 'alphaBeta', help: 'Blend of the measured relative speed into the estimate per sample.' },
    { key: 'aleadFilt_s', label: 'Lead acceleration filter', unit: 's', default: 0.8, min: 0.1, max: 3, step: 0.05, group: 'filter', help: 'kalman / alphaBeta: low-pass of the derivative of the lead-speed estimate.' },
    // target changes and gating
    { key: 'useId', label: 'Reset on id change', unit: '', default: true, options: [true, false], group: 'reset', help: 'A new target id re-initialises the filter.' },
    { key: 'jumpAbs_m', label: 'Jump threshold', unit: 'm', default: 4, min: 0.5, max: 20, step: 0.5, group: 'reset', help: 'A residual larger than this + the relative part is a jump.' },
    { key: 'jumpRel', label: 'Jump threshold, relative', unit: '', default: 0.2, min: 0, max: 1, step: 0.01, group: 'reset', help: 'Fraction of the predicted gap.' },
    { key: 'jumpN', label: 'Jumps to confirm', unit: 'samples', default: 2, min: 1, max: 5, step: 1, group: 'reset', help: 'Consistent jumps in a row that make a target change; fewer = an outlier, skipped.' },
    { key: 'noTargetGap_m', label: 'No-target gap', unit: 'm', default: 400, min: 0, max: 1000, step: 1, group: 'reset', help: 'A gap at or above it means no target (the car\'s 4093). 0 = off.' },
    // loss and staleness
    { key: 'coast_s', label: 'Coast time', unit: 's', default: 0.6, min: 0, max: 3, step: 0.05, group: 'loss', help: 'The track is held (predicted) through a dropout or an invalid message this long.' },
    { key: 'staleAfter_s', label: 'Stale after', unit: 's', default: 0.5, min: 0.1, max: 3, step: 0.05, group: 'loss', help: 'No message for this long = the sensor is stale.' },
    { key: 'frozenN', label: 'Repeated messages', unit: 'samples', default: 3, min: 1, max: 20, step: 1, group: 'loss', help: 'The same sequence number / time this many times in a row = frozen.' },
    { key: 'frozenSameN', label: 'Identical values', unit: 'samples', default: 0, min: 0, max: 50, step: 1, group: 'loss', help: 'Gap and vrel exactly identical this many times in a row = frozen. Catches a frozen payload whose counter still advances, but a smooth, quantised camera output can repeat honestly: off (0) until the car\'s logs show which. Try 10.' },
    { key: 'settleN', label: 'Samples to settle', unit: 'samples', default: 3, min: 1, max: 20, step: 1, group: 'loss', help: 'After a reset the estimate is flagged unsettled for this many samples.' },
    { key: 'vrelMax_mps', label: 'Relative-speed clamp', unit: 'm/s', default: 70, min: 10, max: 100, step: 1, group: 'filter', help: '' }
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
  function sq(x) { return x * x; }

  // ---- small dense linear algebra, n <= 3 ----
  function zeros(n) { var M = []; for (var i = 0; i < n; i++) { M.push([]); for (var j = 0; j < n; j++) M[i].push(0); } return M; }
  function predictCov(P, F, Q) {
    var n = P.length; var FP = zeros(n); var R = zeros(n); var i, j, k;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) { var s = 0; for (k = 0; k < n; k++) s += F[i][k] * P[k][j]; FP[i][j] = s; }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) { var s2 = 0; for (k = 0; k < n; k++) s2 += FP[i][k] * F[j][k]; R[i][j] = s2 + Q[i][j]; }
    return R;
  }
  // scalar measurement z = H x + noise(r2); returns the residual
  function scalarUpdate(x, P, H, z, r2) {
    var n = x.length; var PH = []; var S = r2; var i, j; var hx = 0;
    for (i = 0; i < n; i++) { var s = 0; for (j = 0; j < n; j++) s += P[i][j] * H[j]; PH.push(s); hx += H[i] * x[i]; }
    for (i = 0; i < n; i++) S += H[i] * PH[i];
    var y = z - hx;
    for (i = 0; i < n; i++) x[i] += PH[i] / S * y;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) P[i][j] -= PH[i] * PH[j] / S;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) { var m = (P[i][j] + P[j][i]) / 2; P[i][j] = m; P[j][i] = m; }
    return y;
  }

  function create(params) {
    var p = fill(params);
    var CA = p.mode === 'kalmanCA';
    var S = {
      x: null, P: null, tTrack: null, id: null, n: 0,
      tCorr: null,          // receive time of the last correction
      period: null,         // running mean of the interval between corrections (for the coasting flag)
      aL: 0, lastVl: null, lastVlT: null,
      jumpCount: 0, jumpZ: null, jumpT: null,
      lastSeq: null, lastTMeas: null, repeat: 0, same: 0, lastGap: null, lastVrel: null,
      tLastMsg: null, tFirst: null, blind: false, lastValidT: null
    };

    function rGap(d) { return p.rGap0_m + p.rGap100_m * Math.pow(Math.max(0, d) / 100, p.rGapExp); }
    function rVrel(d) { return p.rVrel0_mps + p.rVrel100_mps * Math.pow(Math.max(0, d) / 100, p.rVrelExp); }

    function drop() { S.x = null; S.P = null; S.id = null; S.n = 0; S.jumpCount = 0; S.jumpZ = null; S.aL = 0; S.lastVl = null; }

    function init(meas, tm, t) {
      var hasV = p.useVrel && meas.vrel !== null && meas.vrel !== undefined;
      var v0 = hasV ? meas.vrel : 0;
      S.x = CA ? [meas.gap, v0, 0] : [meas.gap, v0];
      var pd = sq(rGap(meas.gap)); var pv = hasV ? sq(rVrel(meas.gap)) : sq(p.p0Vrel_mps);
      S.P = CA ? [[pd, 0, 0], [0, pv, 0], [0, 0, sq(p.aleadSd_mps2)]] : [[pd, 0], [0, pv]];
      S.tTrack = tm; S.tCorr = t; S.id = meas.id; S.n = 1;
      S.jumpCount = 0; S.jumpZ = null; S.aL = 0; S.lastVl = null; S.lastVlT = null;
    }

    // propagate the state to time tm with our acceleration as input u = -a_ego
    function propagate(x, P, dt, u) {
      if (!(dt > 0)) return { x: x.slice(), P: P };
      var nx;
      if (CA) {
        var rho = Math.exp(-dt / p.aleadTau_s);
        nx = [x[0] + x[1] * dt + (x[2] + u) * dt * dt / 2, x[1] + (x[2] + u) * dt, x[2] * rho];
        if (!P) return { x: nx, P: null };
        var F = [[1, dt, dt * dt / 2], [0, 1, dt], [0, 0, rho]];
        var w2 = sq(p.aleadSd_mps2) * (1 - rho * rho);
        var G = [dt * dt / 2, dt, 1];
        var Q = zeros(3);
        for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) Q[i][j] = w2 * G[i] * G[j];
        return { x: nx, P: predictCov(P, F, Q) };
      }
      nx = [x[0] + x[1] * dt + u * dt * dt / 2, x[1] + u * dt];
      if (!P) return { x: nx, P: null };
      var q2 = sq(p.qAccel_mps2);
      var Q2 = [[q2 * dt * dt * dt * dt / 4, q2 * dt * dt * dt / 2], [q2 * dt * dt * dt / 2, q2 * dt * dt]];
      return { x: nx, P: predictCov(P, [[1, dt], [0, 1]], Q2) };
    }

    function correct(meas, tm, t, u, egoV) {
      var dt = tm - S.tTrack;
      var pr = propagate(S.x, S.P, dt, u);
      var dPred = pr.x[0];
      var r = meas.gap - dPred;
      var thr = p.jumpAbs_m + p.jumpRel * Math.max(0, dPred);
      if (Math.abs(r) > thr) {
        // a jump: an outlier, or a new target. Confirm by consistent jumps in a row.
        var consistent = S.jumpZ !== null && Math.abs(meas.gap - (S.jumpZ + pr.x[1] * (tm - S.jumpT))) <= thr;
        S.jumpCount = consistent ? S.jumpCount + 1 : 1;
        S.jumpZ = meas.gap; S.jumpT = tm;
        if (S.jumpCount >= p.jumpN) { init(meas, tm, t); return 'jump'; }
        return 'gated';
      }
      S.jumpCount = 0; S.jumpZ = null;
      S.n++;
      var hasV = p.useVrel && meas.vrel !== null && meas.vrel !== undefined;
      if (p.mode === 'alphaBeta') {
        var k = S.n;
        var a = Math.max(p.alpha, 2 * (2 * k - 1) / (k * (k + 1)));
        var b = Math.max(p.beta, 6 / (k * (k + 1)));
        var x = pr.x;
        x[0] = dPred + a * r;
        if (dt > 1e-6) x[1] += b / dt * r;
        if (hasV) x[1] += p.alphaV * (meas.vrel - x[1]);
        S.x = x; S.P = null;
      } else {
        var H = CA ? [1, 0, 0] : [1, 0];
        scalarUpdate(pr.x, pr.P, H, meas.gap, sq(rGap(meas.gap)));
        if (hasV) scalarUpdate(pr.x, pr.P, CA ? [0, 1, 0] : [0, 1], meas.vrel, sq(rVrel(meas.gap)));
        S.x = pr.x; S.P = pr.P;
      }
      S.x[1] = clamp(S.x[1], -p.vrelMax_mps, p.vrelMax_mps);
      S.tTrack = tm;
      if (t > S.tCorr) S.period = S.period === null ? t - S.tCorr : S.period + 0.2 * ((t - S.tCorr) - S.period);
      S.tCorr = t;
      // a_lead from the derivative of the lead-speed estimate (kalman / alphaBeta)
      if (!CA) {
        var vl = egoV + S.x[1];
        if (S.lastVl !== null && tm - S.lastVlT > 1e-6) {
          var h = tm - S.lastVlT;
          S.aL += ((vl - S.lastVl) / h - S.aL) * (1 - Math.exp(-h / p.aleadFilt_s));
        }
        S.lastVl = vl; S.lastVlT = tm;
      }
      return 'ok';
    }

    function update(meas, t, ego) {
      var egoV = ego && ego.egoV !== undefined ? ego.egoV : 0;
      var egoA = ego && ego.egoA !== undefined && p.useEgoAccel ? ego.egoA : 0;
      var u = -egoA;
      if (S.tFirst === null) S.tFirst = t;
      var reset = false; var resetReason = null;

      if (meas) {
        var seqKnown = meas.seq !== undefined && meas.seq !== null;
        var tmKnown = meas.tMeas !== undefined && meas.tMeas !== null;
        var repeated = (seqKnown || tmKnown) && (!seqKnown || meas.seq === S.lastSeq) && (!tmKnown || meas.tMeas === S.lastTMeas);
        if (repeated) S.repeat++;
        else { S.repeat = 0; S.tLastMsg = t; }
        S.lastSeq = seqKnown ? meas.seq : null; S.lastTMeas = tmKnown ? meas.tMeas : null;
        S.blind = meas.qual === 'blind';
        var target = meas.valid && meas.gap !== null && meas.gap !== undefined && !(p.noTargetGap_m > 0 && meas.gap >= p.noTargetGap_m);
        if (!repeated && target) {
          if (meas.gap === S.lastGap && meas.vrel === S.lastVrel) S.same++; else S.same = 0;
          S.lastGap = meas.gap; S.lastVrel = meas.vrel;
        } else if (!repeated) { S.same = 0; S.lastGap = null; S.lastVrel = null; }

        if (!repeated && target && !(p.frozenSameN > 0 && S.same >= p.frozenSameN)) {
          var tm = (p.useMeasTime && tmKnown) ? meas.tMeas : (meas.t !== undefined ? meas.t : t) - p.latencyComp_s;
          S.lastValidT = t;
          if (p.mode === 'raw') {
            var vr = (meas.vrel !== null && meas.vrel !== undefined && p.useVrel) ? meas.vrel
              : (S.x && S.id === meas.id && tm > S.tTrack ? (meas.gap - S.x[0]) / (tm - S.tTrack) : 0);
            if (!S.x || S.id !== meas.id) { reset = true; resetReason = S.x ? 'id' : 'acquire'; S.n = 0; }
            S.x = [meas.gap, clamp(vr, -p.vrelMax_mps, p.vrelMax_mps)]; S.id = meas.id; S.tTrack = tm; S.tCorr = t; S.n++;
          } else if (!S.x) {
            init(meas, tm, t); reset = true; resetReason = 'acquire';
          } else if (p.useId && meas.id !== null && meas.id !== undefined && S.id !== null && S.id !== undefined && meas.id !== S.id) {
            init(meas, tm, t); reset = true; resetReason = 'id';
          } else {
            var res = correct(meas, tm, t, u, egoV);
            if (res === 'jump') { reset = true; resetReason = 'jump'; }
            if (meas.id !== null && meas.id !== undefined) S.id = meas.id;
          }
        }
      }

      // staleness on the input
      var silent = (S.tLastMsg === null ? t - S.tFirst : t - S.tLastMsg) > p.staleAfter_s + 1e-9;
      var frozen = S.repeat >= p.frozenN || (p.frozenSameN > 0 && S.same >= p.frozenSameN);
      var stale = silent || frozen;
      if (stale && S.x) drop();
      if (S.blind && S.x) drop();
      // coasting / loss
      if (S.x && t - S.tCorr > p.coast_s + 1e-9) drop();

      var sensorFault = stale || S.blind;
      if (!S.x) {
        return { valid: false, id: null, gap: null, vrel: null, vlead: null, alead: null, stale: stale, reset: reset, resetReason: resetReason,
          coasting: false, settled: false, sensorFault: sensorFault,
          reason: silent ? 'silent' : (frozen ? 'frozen' : (S.blind ? 'blind' : 'none')), age: null, n: 0 };
      }
      var out = S.x;
      var dtNow = t - S.tTrack;
      if (p.predictToNow && dtNow > 0 && p.mode !== 'raw') out = propagate(S.x, null, dtNow, u).x;
      else if (p.predictToNow && dtNow > 0) out = [S.x[0] + S.x[1] * dtNow, S.x[1]];
      var vrel = clamp(out[1], -p.vrelMax_mps, p.vrelMax_mps);
      var alead = CA ? out[2] : S.aL;
      return {
        valid: true, id: S.id, gap: Math.max(0, out[0]), vrel: vrel, vlead: Math.max(0, egoV + vrel), alead: alead,
        stale: false, reset: reset, resetReason: resetReason,
        coasting: t - S.tCorr > 1.5 * (S.period === null ? 0.1 : S.period) + 1e-9, settled: S.n >= p.settleN, sensorFault: false,
        reason: 'track', age: dtNow, sinceCorr: t - S.tCorr, n: S.n
      };
    }

    return {
      params: p,
      update: update,
      state: function () { return { x: S.x ? S.x.slice() : null, P: S.P ? S.P.map(function (r) { return r.slice(); }) : null, id: S.id, n: S.n }; }
    };
  }

  var X = { NAME: 'estimator', SCHEMA: SCHEMA, defaults: function () { return fill(null); }, fill: fill, create: create };
  if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {})['estimator'] = X;
})();
