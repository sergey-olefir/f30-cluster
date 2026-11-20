'use strict';
// The metrics of the beam simulator, from a run's series (sim.js) — per scenario; totals are summed by sweep / report.
//
// Glare: seconds during which (outside OVERRIDE: the driver's own choice is overrideGlareW) another road user (a driver: car, truck, motorbike, bicycle) was inside our high beam
//   (its cone and reach, with a line of sight), and the same weighted by distance: w = min(4, (200 m / d)^2), so a
//   second at 200 m counts 1, at 400 m 0.25, at 100 m and closer 4. The worst single event (one user, one exposure).
//   Reaction: per exposure that began with the beam high, the time from the user's first exposure (it could be glared
//   from then: in the cone, within reach, in sight) to our dip.
// Missed light: seconds of road on which high beam was allowed (the oracle: dark, fast enough, outside towns, no fog
//   or heavy rain, nobody exposed now or in the last second, no lit stretch ahead) driven on low; highFrac = the share
//   of that allowed time driven on high.
// Comfort: switches, per km, the most in any minute, the shortest dwell.
// Agreement: share of time our advice equals the reference driver's beam (and the recorded driver's in a replay).
// Invariants (must be zero): highStale, highSlow, highFog, highNoLow, exception.
(function () {
  const W_REF = 200, W_MAX = 4;
  function weight(d) { return Math.min(W_MAX, Math.pow(W_REF / Math.max(1, d), 2)); }
  const r3 = (x) => (x === null || x === undefined || !isFinite(x) ? null : Math.round(x * 1000) / 1000);

  /**
   * S: series of equal length: t (s), want (0/1), ref (0/1 or NaN), allowed (0/1 or NaN), s (m), plus exposures:
   * ctx.exposures: [ { uid, t0, t1, wInt, highAtStart, reaction_ms } ] (built by sim.js), ctx.inv: { name: count },
   * ctx.driver: series of 0/1/NaN (recorded driver) or null.
   */
  function compute(S, ctx) {
    const n = S.t.length;
    const m = {};
    const dt = n > 1 ? S.t[1] - S.t[0] : 0.1;
    let glare = 0, glareW = 0, missed = 0, allowed = 0, allowedHigh = 0, highT = 0;
    let agreeRef = 0, refN = 0, agreeDrv = 0, drvN = 0, refGlare = 0, refGlareW = 0, refMissed = 0, drvGlareW = 0;
    const sw = [];
    for (let i = 0; i < n; i++) {
      const high = S.want[i] === 1;
      if (high) highT += dt;
      const manual = S.state && S.state[i] === ctx.overrideState;          // the driver's own choice (auto mode): not the advice's glare
      if (high && S.glareN[i] > 0) { if (manual) drvGlareW += S.glareW[i] * dt; else { glare += dt; glareW += S.glareW[i] * dt; } }
      if (S.allowed[i] === 1) { allowed += dt; if (high) allowedHigh += dt; else missed += dt; }
      if (S.ref && !isNaN(S.ref[i])) {
        refN++; if ((S.ref[i] === 1) === high) agreeRef++;
        if (S.ref[i] === 1 && S.glareRefN[i] > 0) { refGlare += dt; refGlareW += S.glareRefW[i] * dt; }
        if (S.allowed[i] === 1 && S.ref[i] !== 1) refMissed += dt;
      }
      if (ctx.driver && !isNaN(ctx.driver[i])) { drvN++; if ((ctx.driver[i] === 1) === high) agreeDrv++; }
      if (i > 0 && S.want[i] !== S.want[i - 1]) sw.push(S.t[i]);
    }
    const dist_km = n ? Math.max(0, (S.s[n - 1] - S.s[0]) / 1000) : 0;
    let maxPerMin = 0, j = 0;
    for (let i = 0; i < sw.length; i++) { while (sw[i] - sw[j] > 60) j++; maxPerMin = Math.max(maxPerMin, i - j + 1); }
    let minDwell = null;
    for (let i = 1; i < sw.length; i++) { const d = (sw[i] - sw[i - 1]) * 1000; if (minDwell === null || d < minDwell) minDwell = d; }
    const ex = ctx.exposures || [];
    const reactions = ex.filter((e) => e.highAtStart).map((e) => e.reaction_ms).sort((a, b) => a - b);
    let worst = 0, worstId = null;
    ex.forEach((e) => { if (e.wInt > worst) { worst = e.wInt; worstId = e.uid; } });
    m.duration_s = r3(n * dt);
    m.dist_km = r3(dist_km);
    m.high_s = r3(highT);
    m.glare_s = r3(glare);
    m.glareW = r3(glareW);
    m.overrideGlareW = r3(drvGlareW);
    m.worstEventW = r3(worst);
    m.worstEventUser = worstId;
    m.exposures = ex.length;
    m.reactions = reactions.length;
    m.maxReaction_ms = reactions.length ? Math.round(reactions[reactions.length - 1]) : null;
    m.medianReaction_ms = reactions.length ? Math.round(reactions[Math.floor(reactions.length / 2)]) : null;
    m.allowed_s = r3(allowed);
    m.missed_s = r3(missed);
    m.highFrac = allowed > 0 ? r3(allowedHigh / allowed) : null;
    m.switches = sw.length;
    m.switchesPerKm = dist_km > 0.05 ? r3(sw.length / dist_km) : null;
    m.switchesPerMin = n ? r3(sw.length / Math.max(1 / 60, n * dt / 60)) : 0;
    m.maxPerMin = maxPerMin;
    m.minDwell_ms = minDwell === null ? null : Math.round(minDwell);
    m.agreeRef = refN ? r3(agreeRef / refN) : null;
    m.refGlare_s = refN ? r3(refGlare) : null;
    m.refGlareW = refN ? r3(refGlareW) : null;
    m.refMissed_s = refN ? r3(refMissed) : null;
    m.agreeDriver = drvN ? r3(agreeDrv / drvN) : null;
    const inv = ctx.inv || {};
    ['highStale', 'highSlow', 'highFog', 'highNoLow', 'exception'].forEach((k) => { m[k] = inv[k] || 0; });
    return m;
  }

  /** Pass / fail of one run against the invariants and the scenario's expectations. */
  function judge(m, expect, visited, last) {
    const failed = [];
    ['highStale', 'highSlow', 'highFog', 'highNoLow', 'exception'].forEach((k) => { if (m[k] > 0) failed.push(k); });
    const e = expect || {};
    const over = (key, lim) => { if (typeof lim === 'number' && m[key] !== null && m[key] > lim) failed.push(key + '>' + lim); };
    over('glareW', e.maxGlareW); over('glare_s', e.maxGlare_s); over('maxReaction_ms', e.maxReaction_ms);
    over('switchesPerKm', e.maxSwitchesPerKm); over('switches', e.maxSwitches); over('missed_s', e.maxMissed_s);
    if (typeof e.minHighFrac === 'number' && (m.highFrac === null || m.highFrac < e.minHighFrac)) failed.push('highFrac<' + e.minHighFrac);
    if (typeof e.minAgreeRef === 'number' && (m.agreeRef === null || m.agreeRef < e.minAgreeRef)) failed.push('agreeRef<' + e.minAgreeRef);
    (e.mustState || []).forEach((s) => { if (!visited[s]) failed.push('never ' + s); });
    (e.mustReason || []).forEach((s) => { if (!visited['r:' + s]) failed.push('never reason ' + s); });
    (e.neverState || []).forEach((s) => { if (visited[s]) failed.push('was ' + s); });
    (e.neverReason || []).forEach((s) => { if (visited['r:' + s]) failed.push('reason ' + s); });
    if (e.finalState && last && last.state !== e.finalState) failed.push('final ' + (last && last.state));
    if (e.finalWant && last && last.want !== e.finalWant) failed.push('final want ' + (last && last.want));
    return { pass: failed.length === 0, failed: failed };
  }

  const X = { compute: compute, judge: judge, weight: weight, W_REF: W_REF, W_MAX: W_MAX };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).metrics = X;
})();
