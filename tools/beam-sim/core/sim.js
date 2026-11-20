'use strict';
// The beam simulator's engine: a scenario (docs/highbeam/CONTRACT.md §5) in, a run out. A "world" scenario goes through
// the world, the sensor and the algorithm (shared/beam_logic.js, the same file the app runs); a "frames" scenario
// (a recorded drive) is replayed through the algorithm alone.
//
//   run(scenario, opts) -> { meta, series, events, metrics, verdict, frames? }
//   createRun(scenario, opts) -> { step() /* one tick */, done, now, result(), view() /* for the page */ }
//   opts: { seed, config /* partial beam_logic config over the scenario's */, sensor /* partial */, driver /* partial */,
//           tick_ms (100), mode ('auto' | 'advise'; default: the scenario's config, else 'auto'), keepFrames, logic }
//
// In the simulator "the beam" is a model variable: in auto mode it follows the advice (want), so glare and missed light
// measure what the advice would do. Nothing here, or anywhere in this round, switches a lamp.
(function () {
  const req = (n, g) => (typeof require !== 'undefined' ? require(n) : g());
  const B = req('../../../shared/beam_logic', () => self.BeamLogic);
  const RNG = req('./rng', () => self.BS.rng);
  const WORLD = req('./world', () => self.BS.world);
  const SENSOR = req('./sensor', () => self.BS.sensor);
  const DRIVER = req('./driver', () => self.BS.driver);
  const MET = req('./metrics', () => self.BS.metrics);

  const TRUTH_DARK_LUX = 20;        // the oracle's darkness (the same as the algorithm's default dark.on_lux)
  const TRUTH_MIN_KMH = 40;         // the oracle's speed (the algorithm's default speed.on_kmh)
  const TRUTH_GRACE_MS = 1000;      // the oracle allows high only this long after the last exposure

  function configOf(scn, opts) {
    let c = B.mergePartial({}, scn.config || {});
    if (opts && opts.config) c = B.mergePartial(c, opts.config);
    if (opts && opts.mode) c.mode = opts.mode;
    if (!c.mode) c.mode = 'auto';
    return c;
  }

  function shapeOk(o) {
    return o && (o.want === 'high' || o.want === 'low') && B.STATES.indexOf(o.state) >= 0 && B.REASONS[o.reason] &&
      (o.cause === null || typeof o.cause === 'object') && typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1 &&
      typeof o.details === 'object';
  }

  /** The safety invariants of one tick, judged from the frame and the config, independently of the algorithm. */
  function invariants(inv, out, frame, cfg) {
    if (!out || out.state !== 'HIGH') return;
    const stale = (g, lim) => !g || g.ok === false || (lim > 0 && (typeof g.age !== 'number' || g.age > lim));
    const lightsBad = stale(frame.lights, cfg.stale.lights_ms) && (cfg.objects.use === 'off' || stale(frame.objects, cfg.stale.objects_ms));
    if (lightsBad || stale(frame.car, cfg.stale.car_ms) || stale(frame.lamps, cfg.stale.lamps_ms)) inv.highStale++;
    const car = frame.car && frame.car.v || {};
    const lamps = frame.lamps && frame.lamps.v || {};
    if (!(typeof car.speed_kmh === 'number' && car.speed_kmh >= cfg.speed.off_kmh)) inv.highSlow++;
    if (cfg.weather.fog && lamps.fog === true) inv.highFog++;
    if (lamps.low !== true) inv.highNoLow++;
  }

  function newSeries() {
    const S = {};
    ['t', 'want', 'state', 'reason', 'cause', 'hold', 'ref', 'glareN', 'glareW', 'glareRefN', 'glareRefW', 'allowed', 's', 'speed',
      'nLights', 'verdict', 'driver', 'conf'].forEach((k) => { S[k] = []; });
    return S;
  }

  function createRun(scn, opts) {
    const o = opts || {};
    const seed = typeof o.seed === 'number' ? o.seed : (typeof scn.seed === 'number' ? scn.seed : 1);
    const cfgPartial = configOf(scn, o);
    const logic = (o.logic || B).create(cfgPartial);
    const cfg = logic.config;
    const tick = o.tick_ms || (scn.sim && scn.sim.tick_ms) || 100;
    const warmup = typeof o.warmup_s === 'number' ? o.warmup_s : (scn.sim && typeof scn.sim.warmup_s === 'number' ? scn.sim.warmup_s : 10);
    const S = newSeries();
    const events = [];
    const inv = { highStale: 0, highSlow: 0, highFog: 0, highNoLow: 0, exception: 0 };
    const visited = {};
    const frames = o.keepFrames ? [] : null;
    let last = null;
    let i = 0;
    const replay = Array.isArray(scn.frames);
    const duration = replay ? (scn.frames.length ? (scn.frames[scn.frames.length - 1].t - scn.frames[0].t) / 1000 : 0) : (scn.duration_s || 60);
    const nTicks = replay ? scn.frames.length : Math.floor(duration * 1000 / tick) + 1;
    let world = null, sensor = null, driver = null, rng = null;
    const scripted = [];
    let beamHigh = false;
    const expo = {};            // uid -> open exposure
    const exposures = [];
    let lastExposed = -1e9;
    let drvState = null;        // replay: the recorded driver's beam from events
    const drvEvents = Array.isArray(scn.driver) ? scn.driver.slice().sort((a, b) => a.t - b.t) : [];
    let drvIdx = 0;
    if (!replay) {
      rng = RNG.create(seed);
      world = WORLD.create(scn.world || {}, { duration_s: duration });
      const sp = B.mergePartial((scn.sim && scn.sim.sensor) || {}, o.sensor || {});
      sensor = SENSOR.create(world, sp, rng.fork('sensor'), B.DEFAULTS);
      driver = DRIVER.create(B.mergePartial((scn.sim && scn.sim.driver) || {}, o.driver || {}), rng);
      ((scn.world && scn.world.driver) || []).forEach((e) => scripted.push({ t: Math.round(e.t_s * 1000), kind: e.kind }));
      scripted.sort((a, b) => a.t - b.t);
    }
    let si = 0;
    const SP = sensor ? sensor.params : null;

    function truthTick(t) {
      const ts = t / 1000;
      const ego = world.ego(ts);
      const env = world.env(ts, ego.s);
      const lampPt = { s: ego.s, d: ego.d, hgt: world.LAMP_H };
      const camPt = { s: ego.s, d: ego.d, hgt: world.CAM_H };
      const users = world.users(ts);
      const exposed = [];
      const seen = [];
      users.forEach((u) => {
        if (u.s <= ego.s + 1) return;
        const lk = world.look(ego, { s: u.s, d: u.d, hgt: u.eye });
        if (u.glare && Math.abs(lk.az) <= SP.highHalf_deg && lk.dist <= (u.dir > 0 ? SP.aheadReach_m : SP.highReach_m) && world.sight(lampPt, { s: u.s, d: u.d, hgt: u.eye }, ts, u.id)) {
          exposed.push({ uid: u.id, dist: lk.dist, w: MET.weight(lk.dist) });
        }
        if (u.lamps !== 'off' && u.kind !== 'ped' && Math.abs(lk.az) <= 30 && world.sight(camPt, { s: u.s, d: u.d, hgt: 0.7 }, ts, u.id)) {
          const head = u.dir < 0 || (u.dir === 0 && u.faces > 0);
          seen.push({ kind: u.kind === 'bike' ? 'bike' : head ? 'head' : 'tail', dist: lk.dist, dir: u.dir });
        }
      });
      let street = 0;
      let lit = false;
      world.sources(ts).forEach((src) => {
        if (src.kind !== 'street' || src.s < ego.s - 20 || src.s > ego.s + 150) return;
        lit = true;
        if (src.s > ego.s) street++;
      });
      const ok = env.lux < TRUTH_DARK_LUX && env.sun !== 'day' && ego.v_kmh >= TRUTH_MIN_KMH && !env.town && !env.fog && env.wiper < 3 && env.lowBeam;
      if (exposed.length) lastExposed = t;
      const allowed = ok && !exposed.length && !lit && t - lastExposed >= TRUTH_GRACE_MS;
      return { ego: ego, env: env, exposed: exposed, seen: seen, street: street, ok: ok, allowed: allowed };
    }

    function trackExposures(t, exposed, high) {
      const now = {};
      exposed.forEach((e) => {
        now[e.uid] = true;
        let x = expo[e.uid];
        if (!x) { x = expo[e.uid] = { uid: e.uid, t0: t, t1: t, wInt: 0, highAtStart: high, reaction_ms: null, dist0: Math.round(e.dist) }; exposures.push(x); }
        x.t1 = t;
        if (high) x.wInt += e.w * tick / 1000;
        if (x.highAtStart && x.reaction_ms === null && !high) x.reaction_ms = t - x.t0;
      });
      Object.keys(expo).forEach((k) => {
        if (!now[k]) { const x = expo[k]; if (x.highAtStart && x.reaction_ms === null) x.reaction_ms = x.t1 - x.t0 + tick; delete expo[k]; }
      });
    }

    function stepOnce() {
      if (i >= nTicks) return null;
      let frame, t, truth = null, refHigh = NaN;
      if (replay) {
        frame = scn.frames[i];
        t = frame.t;
      } else {
        t = i * tick;
        sensor.advance(t, beamHigh);
        truth = truthTick(t);
        const stalk = [];
        let rearm = false;
        while (si < scripted.length && scripted[si].t <= t) {
          const e = scripted[si++];
          if (e.kind === 'rearm') rearm = true; else stalk.push({ t: e.t, kind: e.kind });
          events.push({ t: e.t / 1000, kind: 'driver.' + e.kind });
        }
        const d = driver.step(t, { ok: truth.ok, seen: truth.seen, street: truth.street });
        refHigh = d.high ? 1 : 0;
        if (d.changed) events.push({ t: t / 1000, kind: 'ref.' + d.changed });
        const advise = cfg.mode === 'advise';
        if (advise && d.changed) stalk.push({ t: t, kind: d.changed });
        frame = sensor.frame(t, { lampsHigh: advise ? d.high : beamHigh, stalk: stalk, rearm: rearm });
      }
      let out = null;
      try {
        out = logic.step(frame);
        if (!shapeOk(out)) { inv.exception++; out = B.failOutput(t, 'error'); }
      } catch (e) {
        inv.exception++;
        out = B.failOutput(t, 'error');
      }
      invariants(inv, out, frame, cfg);
      visited[out.state] = true;
      visited['r:' + out.reason] = true;
      if (last && out.want !== last.want) events.push({ t: t / 1000, kind: 'switch', want: out.want, state: out.state, reason: out.reason, cause: out.cause ? out.cause.id : null });
      if (last && out.state !== last.state) events.push({ t: t / 1000, kind: 'state', state: out.state, reason: out.reason });
      beamHigh = out.want === 'high';
      // the series
      const t0 = replay && scn.frames.length ? scn.frames[0].t : 0;
      S.t.push((t - t0) / 1000);
      S.want.push(beamHigh ? 1 : 0);
      S.state.push(B.STATES.indexOf(out.state));
      S.reason.push(B.REASON_ORDER.indexOf(out.reason));
      S.cause.push(out.cause && typeof out.cause.id === 'number' ? out.cause.id : -1);
      S.hold.push(out.holdUntil !== null ? (out.holdUntil - t) / 1000 : NaN);
      S.conf.push(out.confidence);
      S.nLights.push(frame && frame.lights && Array.isArray(frame.lights.v) ? frame.lights.v.length : NaN);
      const va = frame && frame.verdict && frame.verdict.v ? frame.verdict.v.allow : null;
      S.verdict.push(typeof va === 'number' ? (cfg.verdict.allow.indexOf(va) >= 0 ? 1 : cfg.verdict.deny.indexOf(va) >= 0 ? 0 : NaN) : NaN);
      if (replay) {
        const lh = frame && frame.lamps && frame.lamps.v ? frame.lamps.v.high : null;
        while (drvIdx < drvEvents.length && drvEvents[drvIdx].t <= t - t0) {
          const e = drvEvents[drvIdx++];
          if (e.kind === 'high_on') drvState = 1; else if (e.kind === 'high_off') drvState = 0;
        }
        S.driver.push(typeof lh === 'boolean' ? (lh ? 1 : 0) : drvState === null ? NaN : drvState);
        S.ref.push(NaN); S.glareN.push(0); S.glareW.push(0); S.glareRefN.push(0); S.glareRefW.push(0);
        S.allowed.push(NaN);
        S.s.push(0);
        S.speed.push(frame && frame.car && frame.car.v && typeof frame.car.v.speed_kmh === 'number' ? frame.car.v.speed_kmh : NaN);
      } else {
        trackExposures(t, truth.exposed, beamHigh);
        let gw = 0;
        truth.exposed.forEach((e) => { gw += e.w; });
        const warm = t < warmup * 1000;            // the darkness hold at the start: not counted as missed light or disagreement
        S.ref.push(warm ? NaN : refHigh);
        S.glareN.push(truth.exposed.length);
        S.glareW.push(gw);
        S.glareRefN.push(truth.exposed.length);
        S.glareRefW.push(gw);
        S.allowed.push(warm ? NaN : truth.allowed ? 1 : 0);
        S.s.push(truth.ego.s);
        S.speed.push(truth.ego.v_kmh);
        S.driver.push(NaN);
      }
      if (frames) frames.push(frame);
      last = out;
      i++;
      return { t: t, out: out, frame: frame, truth: truth };
    }

    function result() {
      const ctx = { exposures: exposures, inv: inv, driver: replay ? S.driver : null };
      const metrics = MET.compute(S, ctx);
      // lead / lag against the recorded driver (replay) or the reference driver: each driver switch matched with the
      // nearest switch of the advice in the same direction within 10 s; + = the advice was later
      const drv = replay ? S.driver : S.ref;
      const lags = [];
      const aSw = [];
      for (let k = 1; k < S.t.length; k++) if (S.want[k] !== S.want[k - 1]) aSw.push({ t: S.t[k], v: S.want[k] });
      for (let k = 1; k < drv.length; k++) {
        if (isNaN(drv[k]) || isNaN(drv[k - 1]) || drv[k] === drv[k - 1]) continue;
        let bestLag = null;
        aSw.forEach((a) => { if (a.v === drv[k] && Math.abs(a.t - S.t[k]) <= 10 && (bestLag === null || Math.abs(a.t - S.t[k]) < Math.abs(bestLag))) bestLag = a.t - S.t[k]; });
        if (bestLag !== null) lags.push(bestLag);
      }
      metrics.lagN = lags.length;
      metrics.meanLag_s = lags.length ? Math.round(lags.reduce((a, b) => a + b, 0) / lags.length * 1000) / 1000 : null;
      let vAgree = 0, vN = 0;
      for (let k = 0; k < S.t.length; k++) if (!isNaN(S.verdict[k])) { vN++; if (S.verdict[k] === S.want[k]) vAgree++; }
      metrics.agreeVerdict = vN ? Math.round(vAgree / vN * 1000) / 1000 : null;
      const verdict = MET.judge(metrics, scn.expect, visited, last);
      return {
        meta: { id: scn.id, name: scn.name, family: scn.family, purpose: scn.purpose, source: scn.source || (replay ? 'recorded' : 'hand'),
          seed: seed, tick_ms: replay ? null : tick, mode: cfg.mode, replay: replay, configErrors: logic.configErrors.slice(),
          enums: { state: B.STATES, reason: B.REASON_ORDER } },
        series: S, events: events, exposures: exposures.map((x) => ({ uid: x.uid, t0: x.t0 / 1000, t1: x.t1 / 1000, wInt: Math.round(x.wInt * 1000) / 1000,
          highAtStart: x.highAtStart, reaction_ms: x.reaction_ms, dist0: x.dist0 })),
        metrics: metrics, verdict: verdict, visited: Object.keys(visited).sort(), frames: frames || undefined,
      };
    }

    return {
      step: stepOnce, result: result,
      get done() { return i >= nTicks; },
      get now() { return replay ? (scn.frames[Math.min(i, nTicks - 1)] || { t: 0 }).t : i * tick; },
      world: world, sensor: sensor, logic: logic, nTicks: nTicks, tick: tick,
    };
  }

  function run(scn, opts) {
    const r = createRun(scn, opts);
    while (!r.done) r.step();
    return r.result();
  }

  /**
   * A world scenario run once and written as a "generated" frames scenario (the contract's recorded-drive shape): the
   * frames the algorithm saw, the reference driver's switches as `driver`, the glare truth as `truth`. The app's demo
   * and the replay tests play these back; a recorded drive from the capture tool has the same shape.
   */
  function exportFrames(scn, opts) {
    const o = Object.assign({}, opts || {}, { keepFrames: true });
    const r = run(scn, o);
    const driver = [];
    for (let k = 1; k < r.series.ref.length; k++) {
      const a = r.series.ref[k - 1], b = r.series.ref[k];
      if (!isNaN(a) && !isNaN(b) && a !== b) driver.push({ t: Math.round(r.series.t[k] * 1000), kind: b ? 'high_on' : 'high_off' });
    }
    const truth = r.series.t.map((t, k) => ({ t: Math.round(t * 1000), glare: r.series.glareN[k], allowHigh: r.series.allowed[k] === 1 }));
    return {
      format: 'beam-scenario', version: 1, id: scn.id + '.frames', family: 'R', name: (scn.name || scn.id) + ' (generated frames)',
      purpose: 'the frames of ' + scn.id + ' as the algorithm saw them (seed ' + r.meta.seed + ')', source: 'generated',
      meta: { from: scn.id, seed: r.meta.seed, tool: 'beam-sim' }, config: scn.config, frames: r.frames, driver: driver, truth: truth,
    };
  }

  /** A stable hash of a result (determinism tests): the JSON of everything but the frames. */
  function hashResult(res) {
    const s = JSON.stringify({ meta: res.meta, series: res.series, events: res.events, metrics: res.metrics, exposures: res.exposures });
    return RNG.hash(s).toString(16) + ':' + s.length;
  }

  const X = { run: run, createRun: createRun, hashResult: hashResult, exportFrames: exportFrames, configOf: configOf, TRUTH: { darkLux: TRUTH_DARK_LUX, minKmh: TRUTH_MIN_KMH, grace_ms: TRUTH_GRACE_MS } };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).sim = X;
})();
