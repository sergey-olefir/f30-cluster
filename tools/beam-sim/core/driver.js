'use strict';
// The reference driver of the beam simulator: a careful human who switches the high beam by hand from what they see
// (the world's truth, not the camera's), with a human reaction time. It is the "agreement" yardstick and the baseline
// for glare and missed light; it never feeds the algorithm (in advise mode its beam is the lamps.high label).
//
//   drv = create(params, rng)
//   drv.step(t_ms, view) -> { high: bool, changed: 'high_on' | 'high_off' | null }
//   view = { ok: bool (dark, fast enough, outside towns, no fog), seen: [ { kind, dist, dir } ], street: n }
(function () {
  const PARAMS = [
    ['reaction_ms', 1000, 'ms', 'median reaction time (lognormal)'],
    ['reactionSd', 0.3, '', 'lognormal spread'],
    ['reactionMin_ms', 500, 'ms', ''],
    ['reactionMax_ms', 2500, 'ms', ''],
    ['oncoming_m', 350, 'm', 'dips for oncoming lights within this'],
    ['ahead_m', 150, 'm', 'dips for a vehicle ahead within this'],
    ['bike_m', 100, 'm', 'dips for a cyclist\'s lamp within this'],
    ['street', 3, '', 'dips for this many street lights in view'],
    ['return_ms', 2000, 'ms', 'waits this long after the road is clear'],
    ['minKmh', 50, 'km/h', 'uses high beam only from this speed'],
  ];
  const DEF = {};
  PARAMS.forEach(function (p) { DEF[p[0]] = p[1]; });

  function create(params, rng) {
    const P = Object.assign({}, DEF, params || {});
    const r = rng.fork('driver');
    let high = false;
    let pendingAt = null, pendingTo = null;
    let clearSince = null;
    function reaction() {
      const v = P.reaction_ms * Math.exp(r.normal(0, P.reactionSd));
      return Math.max(P.reactionMin_ms, Math.min(P.reactionMax_ms, v));
    }
    function step(t, view) {
      let need = false;
      (view.seen || []).forEach(function (s) {
        if (s.kind === 'head' && s.dist <= P.oncoming_m) need = true;
        if (s.kind === 'tail' && s.dist <= P.ahead_m) need = true;
        if (s.kind === 'bike' && s.dist <= P.bike_m) need = true;
      });
      if ((view.street || 0) >= P.street) need = true;
      const wantHigh = !!view.ok && !need;
      if (!wantHigh) clearSince = null; else if (clearSince === null) clearSince = t;
      let target = high;
      if (high && !wantHigh) target = false;
      if (!high && wantHigh && t - clearSince >= P.return_ms) target = true;
      if (target !== high) {
        if (pendingTo !== target) { pendingTo = target; pendingAt = t + reaction(); }
      } else { pendingTo = null; pendingAt = null; }
      let changed = null;
      if (pendingTo !== null && t >= pendingAt) {
        high = pendingTo; changed = high ? 'high_on' : 'high_off'; pendingTo = null; pendingAt = null;
      }
      return { high: high, changed: changed };
    }
    return { step: step, params: P };
  }
  const X = { create: create, PARAMS: PARAMS, DEFAULTS: DEF };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).driver = X;
})();
