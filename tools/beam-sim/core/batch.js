'use strict';
// Runs a set of scenarios over seeds and sums the metrics (sweep.js, report.js and the page's batch view).
//
//   runAll({ scenarios /* [objects] */, seeds: [1], config, sensor, driver }) -> { rows: [ { id, family, seed, limit, metrics, verdict } ], totals, core }
//   totals: glareW, glare_s, missed_s, allowed_s, highFrac (time-weighted), switches, dist_km, switchesPerKm,
//           agreeRef (mean), maxReaction_ms (max), worstEventW (max), fails, invariants (sum of the five counters)
(function () {
  const SIM = typeof require !== 'undefined' ? require('./sim') : self.BS.sim;

  function totalsOf(rows) {
    const T = { runs: rows.length, glareW: 0, glare_s: 0, missed_s: 0, allowed_s: 0, high_s: 0, switches: 0, dist_km: 0, agreeRef: 0, agreeN: 0,
      maxReaction_ms: 0, worstEventW: 0, fails: 0, invariants: 0 };
    rows.forEach((r) => {
      const m = r.metrics;
      T.glareW += m.glareW; T.glare_s += m.glare_s; T.missed_s += m.missed_s; T.allowed_s += m.allowed_s || 0;
      T.high_s += (m.highFrac || 0) * (m.allowed_s || 0);
      T.switches += m.switches; T.dist_km += m.dist_km;
      if (m.agreeRef !== null) { T.agreeRef += m.agreeRef; T.agreeN++; }
      if (m.maxReaction_ms !== null) T.maxReaction_ms = Math.max(T.maxReaction_ms, m.maxReaction_ms);
      T.worstEventW = Math.max(T.worstEventW, m.worstEventW);
      if (!r.verdict.pass) T.fails++;
      T.invariants += m.highStale + m.highSlow + m.highFog + m.highNoLow + m.exception;
    });
    const r3 = (x) => Math.round(x * 1000) / 1000;
    return { runs: T.runs, glareW: r3(T.glareW), glare_s: r3(T.glare_s), missed_s: r3(T.missed_s), allowed_s: r3(T.allowed_s),
      highFrac: T.allowed_s ? r3(T.high_s / T.allowed_s) : null, switches: T.switches, dist_km: r3(T.dist_km),
      switchesPerKm: T.dist_km ? r3(T.switches / T.dist_km) : null, agreeRef: T.agreeN ? r3(T.agreeRef / T.agreeN) : null,
      maxReaction_ms: T.maxReaction_ms, worstEventW: r3(T.worstEventW), fails: T.fails, invariants: T.invariants };
  }

  function runAll(o) {
    const opts = o || {};
    const seeds = opts.seeds || [1];
    const rows = [];
    (opts.scenarios || []).forEach((s) => {
      seeds.forEach((seed) => {
        const r = SIM.run(s, { seed: seed, config: opts.config, sensor: opts.sensor, driver: opts.driver });
        rows.push({ id: s.id, family: s.family, seed: seed, limit: !!s.limit, metrics: r.metrics, verdict: r.verdict, result: opts.keep ? r : undefined });
      });
    });
    // core = without the scenarios that document a known limit of a light camera (scenario.limit)
    return { rows: rows, totals: totalsOf(rows), core: totalsOf(rows.filter((r) => !r.limit)) };
  }

  const X = { runAll: runAll, totalsOf: totalsOf };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).batch = X;
})();
