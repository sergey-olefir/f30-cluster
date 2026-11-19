/* SU2 fixtures: a contract-shaped run result and a contract-shaped batch file, made by a tiny
 * deterministic stand-in simulation (NOT the engine: SC1 / SC2 own that). Only SU2's tests and dev
 * page use it, so the charts and batch views have realistic input before the core exists.
 *
 *   makeResult(opts) -> { meta, t, series, events, metrics, verdict }   (CONTRACT.md "The result")
 *   makeBatch(opts)  -> { kind: 'cs-batch', version: 1, runs: [...], presets }  (SU2's proposal in NOTES.md)
 *   toJson(result)   -> the result as a JSON file would carry it (Float64Array -> arrays, NaN -> null)
 */
(function () {
  'use strict';

  function lcg(seed) {
    let s = (seed >>> 0) || 1;
    function next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }
    return {
      next: next,
      normal: function (m, sd) { const u = Math.max(1e-12, next()), v = next(); return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
    };
  }

  const PRESET_AMIN = { liftoff: 0.8, mild: 1.8, firm: 2.8 };

  function makeResult(opts) {
    opts = opts || {};
    const seed = opts.seed || 1;
    const rng = lcg(seed);
    const dt = 0.01, outDt = opts.outDt || 0.05, T = opts.duration || 60;
    const preset = opts.preset || 'liftoff';
    const aMin = opts.aMin || PRESET_AMIN[preset] || 0.8, aMax = 1.2, Td = opts.Td || 0.6, tauC = 2.5;
    const d0 = 5, hGap = opts.h || 2, tauG = 4, rateDown = 3 / 3.6, rateUp = 1 / 3.6, vMin = 30 / 3.6;
    const vMax = 110 / 3.6;
    const leadBrake = opts.leadBrake || -2;
    const ttcWarn = 3;
    // state
    let ex = 0, ev = 100 / 3.6, ea = 0, eaPrev = 0;
    let lx = 70, lv = 90 / 3.6, la = 0;
    let setHeld = ev, setCmd = ev, vInt = ev;
    const heldHist = [];        // [t, value] for the dead time
    const pendingCmd = [];      // [tApply, value, tSent]
    const meas = [];            // delivered measurements
    let estGap = NaN, estVrel = 0, estValid = false, lastMeasT = -1;
    let warn = false;
    const events = [{ t: 0, kind: 'cruise.state', state: 'active' }];
    const names = ['ego.x', 'ego.v', 'ego.a', 'ego.jerk', 'lead.x', 'lead.v', 'lead.a', 'lead.id', 'gap.true', 'vrel.true', 'gap.meas', 'vrel.meas', 'meas.valid',
      'est.gap', 'est.vrel', 'est.vlead', 'est.alead', 'est.valid', 'set.cmd', 'set.held', 'v.driverMax', 'd.des', 'd.needed', 'v.ref', 'timegap', 'ttc', 'warn',
      'cruise.state', 'driver.brake', 'driver.accel', 'grade', 'follower.gap', 'follower.a'];
    const nOut = Math.floor(T / outDt) + 1;
    const series = {};
    names.forEach(function (n) { series[n] = new Float64Array(nOut).fill(NaN); });
    const tOut = new Float64Array(nOut);
    let lastMeas = null, vRef = NaN, dDes = NaN, dNeeded = NaN, ttc = Infinity;
    let nextSensor = 0, nextCtl = 0, outI = 0;
    let fx = -40, fv = ev, fa = 0; // follower (IDM-ish)
    const frozenFrom = 45, frozenTo = 48;
    events.push({ t: frozenFrom, kind: 'fault.on', fault: 'gapFrozen' });
    events.push({ t: frozenTo, kind: 'fault.off', fault: 'gapFrozen' });
    let minGap = Infinity, minTG = Infinity, minTTC = Infinity, peakDecel = 0, aSq = 0, nA = 0, errSq = 0, nErr = 0, nCmd = 0, nWarn = 0;
    let frozenVal = null;
    for (let k = 0; k * dt <= T + 1e-9; k++) {
      const t = k * dt;
      // lead profile
      if (t < 15) la = 0;
      else if (t < 35 && lv > 60 / 3.6) la = leadBrake;
      else if (t >= 40 && lv < 80 / 3.6) la = 1;
      else la = 0;
      lv = Math.max(0, lv + la * dt);
      lx += lv * dt;
      const gapTrue = lx - ex - 4.5;
      const vrelTrue = lv - ev;
      // sensor at 10 Hz, latency 0.15
      if (t >= nextSensor - 1e-9) {
        nextSensor += 0.1;
        const drop = rng.next() < 0.02;
        let g = gapTrue + rng.normal(0, 0.0004 * gapTrue * gapTrue + 0.05);
        if (t >= frozenFrom && t < frozenTo) { if (frozenVal === null) frozenVal = g; g = frozenVal; }
        if (!drop && gapTrue < 150) meas.push({ t: t + 0.15 + rng.next() * 0.03, tMeas: t, valid: true, gap: g, vrel: vrelTrue + rng.normal(0, 0.15) });
      }
      while (meas.length && meas[0].t <= t) { lastMeas = meas.shift(); }
      // controller at 10 Hz
      if (t >= nextCtl - 1e-9) {
        nextCtl += 0.1;
        if (lastMeas && lastMeas.tMeas !== lastMeasT) {
          if (!estValid) { estGap = lastMeas.gap; estVrel = lastMeas.vrel; estValid = true; events.push({ t: t, kind: 'target.acquired', id: 1 }); }
          else {
            const dtm = lastMeas.tMeas - lastMeasT;
            const pred = estGap + estVrel * dtm;
            const r = lastMeas.gap - pred;
            estGap = pred + 0.5 * r;
            estVrel = estVrel + 0.1 * r / Math.max(0.05, dtm);
          }
          lastMeasT = lastMeas.tMeas;
        }
        if (estValid) {
          const vlead = ev + estVrel;
          dDes = d0 + hGap * ev;
          vRef = vlead + (estGap - dDes) / tauG;
          let target = Math.min(vMax, Math.max(vRef, vMin));
          vInt = target < vInt ? Math.max(target, vInt - rateDown * 0.1) : Math.min(target, vInt + rateUp * 0.1);
          const q = Math.round(vInt * 3.6) / 3.6;
          if (Math.abs(q - setCmd) > 0.5 / 3.6) {
            setCmd = q;
            nCmd++;
            events.push({ t: t, kind: 'cmd.sent', vSet: q });
            if (rng.next() < 0.03) events.push({ t: t + 0.3, kind: 'cmd.dropped', vSet: q });
            else pendingCmd.push([t + 0.3 + rng.next() * 0.1, q, t]);
          }
          const closing = -estVrel;
          dNeeded = d0 + (closing > 0 ? closing * closing / (2 * aMin) : 0);
          ttc = closing > 0.05 ? estGap / closing : Infinity;
          const w = estGap < dNeeded || ttc < ttcWarn;
          if (w !== warn) { warn = w; events.push({ t: t, kind: w ? 'warn.on' : 'warn.off', reason: estGap < dNeeded ? 'needed' : 'ttc' }); if (w) nWarn++; }
        }
      }
      while (pendingCmd.length && pendingCmd[0][0] <= t) {
        const c = pendingCmd.shift();
        setHeld = c[1];
        events.push({ t: t, kind: 'cmd.applied', vSet: c[1], tSent: c[2] });
      }
      heldHist.push([t, setHeld]);
      while (heldHist.length > 1 && heldHist[1][0] <= t - Td) heldHist.shift();
      const setDelayed = heldHist[0][1];
      ea = Math.max(-aMin, Math.min(aMax, (setDelayed - ev) / tauC));
      ev += ea * dt;
      ex += ev * dt;
      // follower
      const fgap = ex - fx - 4.5;
      const sStar = 2 + fv * 1.2 + fv * (fv - ev) / (2 * Math.sqrt(1.5 * 2));
      fa = 1.5 * (1 - Math.pow(fv / (110 / 3.6), 4) - Math.pow(sStar / Math.max(0.5, fgap), 2));
      fa = Math.max(-6, fa);
      fv = Math.max(0, fv + fa * dt);
      fx += fv * dt;
      // metrics
      const tg = ev > 0.5 ? gapTrue / ev : NaN;
      const ttcTrue = vrelTrue < -0.05 ? gapTrue / -vrelTrue : Infinity;
      minGap = Math.min(minGap, gapTrue);
      if (isFinite(tg)) minTG = Math.min(minTG, tg);
      minTTC = Math.min(minTTC, ttcTrue);
      peakDecel = Math.min(peakDecel, ea);
      aSq += ea * ea; nA++;
      if (t > 5 && t < 15 && isFinite(dDes)) { errSq += Math.pow(gapTrue - dDes, 2); nErr++; }
      // record
      if (outI < nOut && t >= outI * outDt - 1e-9) {
        const i = outI++;
        tOut[i] = +(i * outDt).toFixed(6);
        const S = series;
        S['ego.x'][i] = ex; S['ego.v'][i] = ev; S['ego.a'][i] = ea; S['ego.jerk'][i] = (ea - eaPrev) / outDt;
        S['lead.x'][i] = lx; S['lead.v'][i] = lv; S['lead.a'][i] = la; S['lead.id'][i] = 1;
        S['gap.true'][i] = gapTrue; S['vrel.true'][i] = vrelTrue;
        if (lastMeas && Math.abs(lastMeas.t - t) < outDt) { S['gap.meas'][i] = lastMeas.gap; S['vrel.meas'][i] = lastMeas.vrel; }
        S['meas.valid'][i] = lastMeas ? 1 : 0;
        S['est.gap'][i] = estValid ? estGap : NaN; S['est.vrel'][i] = estValid ? estVrel : NaN;
        S['est.vlead'][i] = estValid ? ev + estVrel : NaN; S['est.alead'][i] = estValid ? la + rng.normal(0, 0.2) : NaN;
        S['est.valid'][i] = estValid ? 1 : 0;
        S['set.cmd'][i] = setCmd; S['set.held'][i] = setHeld; S['v.driverMax'][i] = vMax;
        S['d.des'][i] = dDes; S['d.needed'][i] = dNeeded; S['v.ref'][i] = vRef;
        S['timegap'][i] = tg; S['ttc'][i] = isFinite(ttcTrue) ? ttcTrue : NaN; S['warn'][i] = warn ? 1 : 0;
        S['cruise.state'][i] = 1; S['driver.brake'][i] = 0; S['driver.accel'][i] = 0; S['grade'][i] = 0;
        S['follower.gap'][i] = fgap; S['follower.a'][i] = fa;
        eaPrev = ea;
      }
    }
    events.sort(function (a, b) { return a.t - b.t; });
    // metric names as SC3's metrics.js (2026-11-19)
    const metrics = {
      collision: minGap <= 0, minGap_m: minGap, minTimeGap_s: minTG, minTTC_s: Math.min(99, minTTC), warnCount: nWarn,
      setpointChangesPerMin: nCmd / (T / 60), gapErrRmsRel: Math.sqrt(errSq / Math.max(1, nErr)) / (hGap * 25), peakDecel_mps2: -peakDecel, accelRms_mps2: Math.sqrt(aSq / nA),
    };
    const failed = [];
    if (metrics.minTimeGap_s < 1) failed.push('minTimeGap_s');
    if (metrics.minTTC_s < 4) failed.push('minTTC_s');
    if (metrics.collision) failed.push('collision');
    if (metrics.setpointChangesPerMin > 20) failed.push('setpointChangesPerMin');
    const config = {
      version: 1, seed: seed, dt: dt, duration: T, out: { dt: outDt },
      scenario: { id: opts.scenario || 'D.brake', overrides: {} },
      plant: { preset: preset, model: 'P1', aMin_ms2: -aMin, aMax_ms2: aMax, deadTime_s: Td }, sensor: {}, estimator: {}, controller: { rateHz: 10 }, warning: {}, command: {}, driver: {},
      failures: [{ kind: 'gapFrozen', at: frozenFrom, duration: frozenTo - frozenFrom }], ego: { mode: 'ours' }, thresholds: {},
    };
    return {
      meta: { config: config, seed: seed, plant: { name: preset + ' (P1)', assumed: true }, version: 'su2-fixture', ms: 0, enums: { 'cruise.state': ['off', 'active', 'suspended', 'override', 'dropout'] } },
      t: tOut, series: series, events: events, metrics: metrics, verdict: { pass: failed.length === 0, failed: failed },
    };
  }

  function toJson(result) {
    return JSON.parse(JSON.stringify(result, function (k, v) {
      if (v instanceof Float64Array) return Array.prototype.map.call(v, function (x) { return isFinite(x) ? +x.toFixed(4) : null; });
      if (typeof v === 'number' && !isFinite(v)) return null;
      return v;
    }));
  }

  /**
   * A synthetic batch: a scenario matrix, a feasibility map over plant aMin × Td, a ±30 % sensitivity
   * study and a tuning sweep. Metrics come from closed-form stand-ins, so the views have shape, not truth.
   */
  function makeBatch(opts) {
    opts = opts || {};
    const rng = lcg(opts.seed || 7);
    const runs = [];
    const scen = [
      { id: 'B.approach', family: 'B', key: 'dv_kmh', vals: [10, 30, 50, 80] },
      { id: 'C.follow.sine', family: 'C', key: 'amp_kmh', vals: [2, 5, 10, 15] },
      { id: 'D.brake', family: 'D', key: 'a_mps2', vals: [-0.5, -1, -1.5, -2, -3, -4, -6] },
      { id: 'E.cutin', family: 'E', key: 'gap_m', vals: [5, 15, 30, 60] },
      { id: 'F.cutout.standing', family: 'F', key: 'v0_kmh', vals: [60, 90, 120], scope: 'warnOnly' },
    ];
    function score(sc, val, p) {
      // how hard the case is, in m/s² of deceleration needed, against what the plant can do
      let need;
      if (sc.id === 'B.approach') need = 0.3 + val / 80;
      else if (sc.id === 'C.follow.sine') need = 0.2 + val / 25;
      else if (sc.id === 'D.brake') need = Math.abs(val) * 0.85;
      else if (sc.id === 'E.cutin') need = 3.2 - val / 25;
      else need = 4 + val / 60;
      const can = p.aMin * (1 - 0.25 * (p.Td - 0.5)) * (1 + 0.04 * (p.cmdDelay !== undefined ? -p.cmdDelay * 5 : 0));
      const margin = can - need;
      return {
        minTimeGap_s: Math.max(0, 1.0 + margin * 0.6 + rng.normal(0, 0.05)),
        minTTC_s: Math.max(0.2, 4 + margin * 2 + rng.normal(0, 0.2)),
        collision: margin < -1.6,
        warnCount: margin < 0 ? 1 + Math.floor(-margin * 2) : 0,
        accelRms_mps2: 0.25 + Math.min(1.2, Math.abs(margin) * 0.1) + (p.h ? (2 - p.h) * 0.05 : 0),
        peakDecel_mps2: Math.min(p.aMin, need),
        peakJerk_mps3: 0.8 + Math.min(p.aMin, need) * 0.4,
        setpointChangesPerMin: 6 + (p.tauG ? 20 / p.tauG : 4) + rng.next() * 2,
      };
    }
    function verdict(m, scope) {
      const failed = [];
      if (scope === 'warnOnly') { if (m.collision) failed.push('collision'); return { pass: !failed.length, failed: failed }; }
      if (m.minTimeGap_s < 1) failed.push('minTimeGap_s');
      if (m.minTTC_s < 4) failed.push('minTTC_s');
      if (m.collision) failed.push('collision');
      return { pass: !failed.length, failed: failed };
    }
    const base = { aMin: 0.8, Td: 0.6 };
    // matrix (the current parameter set)
    scen.forEach(function (sc) {
      sc.vals.forEach(function (v) {
        const m = score(sc, v, base);
        const variant = {}; variant[sc.key] = v;
        runs.push({ id: sc.id + '#' + sc.key + '=' + v, study: 'matrix', scenario: sc.id, family: sc.family, variant: variant,
          params: { 'plant.aMin_ms2': -base.aMin, 'plant.deadTime_s': base.Td }, metrics: m, verdict: verdict(m, sc.scope), decide: ['minTimeGap_s', 'minTTC_s', 'collision'], scope: sc.scope || 'in',
          config: { scenario: { id: sc.id, overrides: variant }, plant: { preset: 'liftoff', aMin_ms2: -base.aMin, deadTime_s: base.Td } } });
      });
    });
    // feasibility map: aMin x Td, each cell runs the whole catalogue
    const aMins = [0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.2]; // |a_min|; stored negative as SC1's aMin_ms2
    const Tds = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6];
    aMins.forEach(function (a) {
      Tds.forEach(function (td) {
        scen.forEach(function (sc) {
          sc.vals.forEach(function (v) {
            const p = { aMin: a, Td: td };
            const m = score(sc, v, p);
            const variant = {}; variant[sc.key] = v;
            runs.push({ id: 'map/' + a + '/' + td + '/' + sc.id + '/' + v, study: 'map', scenario: sc.id, family: sc.family, variant: variant,
              params: { 'plant.aMin_ms2': -a, 'plant.deadTime_s': td }, metrics: m, verdict: verdict(m, sc.scope), scope: sc.scope || 'in' });
          });
        });
      });
    });
    // sensitivity: ±30 % on each parameter, the catalogue each time
    const sens = { 'plant.aMin_ms2': -0.8, 'plant.deadTime_s': 0.6, 'plant.tau_s': 2.5, 'command.delay_s': 0.3, 'sensor.rateHz': 10, 'controller.h': 2 };
    Object.keys(sens).forEach(function (param) {
      ['low', 'base', 'high'].forEach(function (side) {
        const f = side === 'low' ? 0.7 : side === 'high' ? 1.3 : 1;
        const p = { aMin: 0.8, Td: 0.6, cmdDelay: 0.3, h: 2 };
        const val = sens[param] * f;
        if (param === 'plant.aMin_ms2') p.aMin = -val;
        if (param === 'plant.deadTime_s') p.Td = val;
        if (param === 'command.delay_s') p.cmdDelay = val;
        if (param === 'controller.h') p.h = val;
        if (param === 'plant.tau_s') p.aMin *= 1 - (f - 1) * 0.1;
        if (param === 'sensor.rateHz') p.Td += (1 / val - 0.1) * 0.5;
        scen.forEach(function (sc) {
          sc.vals.forEach(function (v) {
            const m = score(sc, v, p);
            const params = {}; params[param] = val;
            runs.push({ id: 'sens/' + param + '/' + side + '/' + sc.id + '/' + v, study: 'sensitivity', param: param, side: side, factor: f,
              scenario: sc.id, family: sc.family, variant: { v: v }, params: params, metrics: m, verdict: verdict(m, sc.scope), scope: sc.scope || 'in' });
          });
        });
      });
    });
    // tuning sweep: d0 × h × τ (rate limits fixed), on the catalogue
    let setN = 0;
    [3, 5, 8].forEach(function (d0) {
      [1.5, 2, 2.5, 3].forEach(function (hh) {
        [2, 4, 8].forEach(function (tauG) {
          const set = 'T' + (++setN);
          scen.forEach(function (sc) {
            sc.vals.forEach(function (v) {
              const p = { aMin: 0.8 + (hh - 2) * 0.35 + (d0 - 5) * 0.03 - Math.abs(tauG - 4) * 0.04, Td: 0.6, h: hh, tauG: tauG };
              const m = score(sc, v, p);
              runs.push({ id: 'tune/' + set + '/' + sc.id + '/' + v, study: 'tuning', set: set, scenario: sc.id, family: sc.family, variant: { v: v },
                params: { 'controller.d0': d0, 'controller.h': hh, 'controller.tau': tauG, 'controller.rateDown_kmhps': 3, 'controller.rateUp_kmhps': 1 },
                metrics: m, verdict: verdict(m, sc.scope), scope: sc.scope || 'in' });
            });
          });
        });
      });
    });
    return {
      kind: 'cs-batch', version: 1, created: '2026-11-19T00:00:00Z',
      plant: { name: 'liftoff (P1)', assumed: true },
      base: { plant: { preset: 'liftoff' } },
      presets: { liftoff: { 'plant.aMin_ms2': -0.7, 'plant.deadTime_s': 0.5 }, mild: { 'plant.aMin_ms2': -1.8, 'plant.deadTime_s': 0.5 }, firm: { 'plant.aMin_ms2': -2.8, 'plant.deadTime_s': 0.5 } },
      runs: runs,
    };
  }

  const fx = { makeResult: makeResult, makeBatch: makeBatch, toJson: toJson, lcg: lcg };
  if (typeof module !== 'undefined') module.exports = fx; else (self.CS = self.CS || {})['su2fixture'] = fx;
})();
