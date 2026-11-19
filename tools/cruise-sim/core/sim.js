(function () {
'use strict';
// (wrapped in a function: the page loads core/*.js as classic scripts, which share one global scope)
// The simulation engine (SC1): one config in, one result out; the same model stepped in real time for the page.
//
//   run(config[, deps])       -> { meta, t, series, events, metrics, verdict }      (CONTRACT.md "The result")
//   createSim(config[, deps]) -> { step(), advance(seconds), state(), done, result() }
//   defaultConfig()           -> a complete config with every module's defaults
//   schemas()                 -> { plant: SCHEMA, command: ..., driver: ..., sensor?: ..., ... } for the settings page
//   hashResult(result)        -> hex string over t, series, events and metrics (the determinism check)
//   BUILTIN                   -> the built-in scenarios (used when scenario.js cannot load an id, and in tests)
//
// deps: { <module name>: module } replaces a module (tests, the page's worker). A module of another owner that does not
// exist yet (sensor, estimator, controller, warning, baselines, metrics) is replaced by a small stub below and
// meta.modules says so; scenario.js is optional (inline scenarios and the built-ins work without it).
//
// One tick (dt = 0.01 s) at time t, the state of everything being at t:
//   failures.apply -> sensor.sample (then the gapFreeze / sensorBlind faults are enforced on its sample) ->
//   on the controller's clock, if the app is alive and the head unit not stalled: estimator.update, controller.step,
//   warning.step, command.send when vSet changed -> command.deliver -> plant.request for each arrival ->
//   driver.step -> plant.step (or a baseline) -> record -> vehicles.step and ego integrated to t + dt -> collision.
// (The others move after the plant, not first as CONTRACT.md's first draft listed, so the sensor, the driver and the
// plant all see one consistent instant.)

const VERSION = '0.1.0';
const KMH = 1 / 3.6;
const HAS_REQUIRE = typeof require !== 'undefined' && typeof module !== 'undefined';

function load(name) {
  if (HAS_REQUIRE) {
    try { return require('./' + name); } catch (e) {
      if (e && e.code === 'MODULE_NOT_FOUND' && String(e.message).indexOf("'./" + name + "'") >= 0) return null;
      throw e;
    }
  }
  return (typeof self !== 'undefined' && self.CS && self.CS[name]) || null;
}

const OWN = ['rng', 'schema', 'road', 'vehicles', 'plant', 'driver', 'command', 'failures'];
// The order the page loads core/*.js in (a file may resolve a sibling at load time, so siblings it needs come first)
const LOAD_ORDER = ['rng', 'schema', 'road', 'vehicles', 'plant', 'driver', 'command', 'failures',
  'sensor', 'estimator', 'controller', 'warning', 'baselines', 'metrics', 'scenario', 'mixed', 'sim'];
const OTHERS = ['sensor', 'estimator', 'controller', 'warning', 'baselines', 'metrics', 'scenario'];

// ---- stubs for the modules of SC2 / SC3 until they exist ------------------------------------------------------------
// Deliberately simple: an ideal sensor, a pass-through estimator, the parent brief's set-speed law, its warning rule.

function trueLeadOf(world) {
  const V = load('vehicles');
  return V.trueLead(world);
}

const STUBS = {
  sensor: {
    NAME: 'sensor', SCHEMA: [], LENIENT: true, STUB: true,
    create(p) {
      const rate = p.rateHz || 10, range = p.range_m || 150;
      let next = 0;
      return {
        sample(world, t) {
          if (t + 1e-9 < next) return null;
          next += 1 / rate;
          const L = trueLeadOf(world);
          const V = load('vehicles');
          if (!L || V.gap(world.ego, L) > range) return { t, tMeas: t, valid: false, id: null, gap: null, vrel: null, lat: null, kind: null };
          return { t, tMeas: t, valid: true, id: L.id, gap: V.gap(world.ego, L), vrel: L.v - world.ego.v, lat: L.y - world.ego.lane * world.road.laneWidth, kind: L.kind };
        },
      };
    },
  },
  estimator: {
    NAME: 'estimator', SCHEMA: [], LENIENT: true, STUB: true,
    create() {
      let last = null, lastT = -Infinity, prevId = null, vleadPrev = null, alead = 0;
      return {
        update(meas, t, ego) {
          if (meas) { last = meas; lastT = t; }
          const stale = t - lastT > 1.0;
          const valid = !!(last && last.valid && !stale);
          const id = valid ? last.id : null;
          const reset = id !== prevId;
          prevId = id;
          if (!valid) { vleadPrev = null; alead = 0; return { valid: false, id: null, gap: null, vrel: null, vlead: null, alead: null, stale, reset }; }
          const vlead = ego.egoV + last.vrel;
          if (meas && vleadPrev !== null && !reset) alead = 0.8 * alead + 0.2 * (vlead - vleadPrev) * 10;
          if (meas) vleadPrev = vlead;
          return { valid: true, id, gap: last.gap, vrel: last.vrel, vlead, alead, stale: false, reset };
        },
      };
    },
  },
  controller: {
    NAME: 'controller', SCHEMA: [], LENIENT: true, STUB: true,
    create(p) {
      const d0 = p.d0_m || 5, h = p.h_s || 2, tau = p.tau_s || 4, rate = p.rateHz || 10;
      const down = (p.rateDown_kmhs || 3) * KMH, up = (p.rateUp_kmhs || 1) * KMH, q = (p.step_kmh || 1) * KMH;
      const vMin = (p.vMin_kmh || 30) * KMH;
      let vInt = null, held = null;
      return {
        step(inp) {
          const est = inp.est, egoV = inp.egoV;
          const dDes = d0 + h * egoV;
          let vRef = inp.vDriver;
          if (est && est.valid) vRef = est.vlead + (est.gap - dDes) / tau;
          let target = Math.min(inp.vDriver, Math.max(vRef, vMin));
          if (vInt === null) vInt = inp.cruise && inp.cruise.setHeld !== null ? inp.cruise.setHeld : egoV;
          const dtc = 1 / rate;
          vInt = Math.max(vInt - down * dtc, Math.min(vInt + up * dtc, target));
          if (held === null || Math.abs(vInt - held) >= q) held = Math.round(vInt / q) * q;
          return { vSet: held, vRef, dDes, reason: est && est.valid ? 'follow' : 'free' };
        },
      };
    },
  },
  warning: {
    NAME: 'warning', SCHEMA: [], LENIENT: true, STUB: true,
    create(p) {
      const d0 = p.d0_m || 5, ttcWarn = p.ttcWarn_s || 3;
      return {
        step(inp) {
          const est = inp.est;
          if (!est || !est.valid) return { warn: false, reason: null, dNeeded: null, ttc: null };
          const closing = Math.max(0, -est.vrel);
          const dNeeded = d0 + closing * closing / (2 * Math.abs(inp.aMin));
          const ttc = closing > 0 ? est.gap / closing : null;
          if (est.gap < dNeeded) return { warn: true, reason: 'distance', dNeeded, ttc };
          if (ttc !== null && ttc < ttcWarn) return { warn: true, reason: 'ttc', dNeeded, ttc };
          return { warn: false, reason: null, dNeeded, ttc };
        },
      };
    },
  },
  baselines: {
    NAME: 'baselines', STUB: true,
    // an ideal ACC (constant time gap, commands acceleration directly) and a human (IDM)
    idealAcc: { SCHEMA: [], create(p) {
      const h = p.h_s || 1.8, d0 = p.d0_m || 5, k1 = 0.25, k2 = 0.6;
      return { step(world, t) {
        const V = load('vehicles'); const e = world.ego; const L = V.trueLead(world);
        let a = 0.4 * (world.driver.vMax - e.v);
        if (L) a = Math.min(a, k1 * (V.gap(e, L) - d0 - h * e.v) + k2 * (L.v - e.v));
        return { a: Math.max(-6, Math.min(2, a)) };
      } };
    } },
    human: { SCHEMA: [], create(p) {
      const T = p.T_s || 1.5, s0 = p.s0_m || 2, am = p.a_ms2 || 1.4, b = p.b_ms2 || 2;
      return { step(world, t) {
        const V = load('vehicles'); const e = world.ego; const L = V.trueLead(world);
        const v0 = world.driver.vMax;
        let a = am * (1 - Math.pow(e.v / Math.max(v0, 0.1), 4));
        if (L) {
          const s = Math.max(0.1, V.gap(e, L));
          const ss = s0 + Math.max(0, e.v * T + e.v * (e.v - L.v) / (2 * Math.sqrt(am * b)));
          a -= am * (ss / s) * (ss / s);
        }
        return { a: Math.max(-9, a) };
      } };
    } },
  },
  metrics: {
    NAME: 'metrics', STUB: true,
    // SC3's names for the three it judges (the parent brief's thresholds: time gap >= 1 s, TTC >= 4 s, no collision)
    compute(result) {
      const c = result.meta.core;
      const m = Object.assign({}, c, { minTimeGap_s: c.minTimeGap, minTTC_s: c.minTTC, minGap_m: c.minGap });
      const decide = (result.meta.scenario && result.meta.scenario.decide) || ['collision', 'minTimeGap_s', 'minTTC_s'];
      const failed = [], unknown = [];
      for (const k of decide) {
        if (k === 'collision') { if (c.collision) failed.push(k); }
        else if (k === 'minTimeGap_s') { if (c.minTimeGap !== null && c.minTimeGap < 1.0) failed.push(k); }
        else if (k === 'minTTC_s') { if (c.minTTC !== null && c.minTTC < 4) failed.push(k); }
        else unknown.push(k);
      }
      return { metrics: m, verdict: { pass: failed.length === 0, failed, unknown } };
    },
  },
};

// ---- built-in scenarios --------------------------------------------------------------------------------------------

const BUILTIN = {
  'demo.approach': {
    id: 'demo.approach', family: 'B', name: 'Approach a slower lead, which then slows further (built-in demo)',
    description: 'Ego at 120 km/h, a lead 150 m ahead at 80 km/h; at 40 s the lead slows to 60 km/h at about 1.1 m/s².',
    duration: 90,
    road: { grade: [[0, 0]], curvature: [[0, 0]], lanes: 2 },
    ego: { v0_kmh: 120, vMax_kmh: 120, lane: 0 },
    vehicles: [{ id: 'lead', kind: 'car', lane: 0, x0: 150, v0_kmh: 80, profile: { type: 'piecewise', points: [[0, 80], [40, 80], [45, 60], [90, 60]] } }],
    events: [],
    decide: ['collision', 'minTimeGap_s', 'minTTC_s'], scope: 'in',
  },
  'demo.free': {
    id: 'demo.free', family: 'A', name: 'No target, steady speed (built-in)', duration: 30,
    road: { lanes: 2 }, ego: { v0_kmh: 100, vMax_kmh: 100, lane: 0 }, vehicles: [], events: [],
    decide: ['collision'], scope: 'in',
  },
};

// ---- helpers --------------------------------------------------------------------------------------------------------

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function deepMerge(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return clone(over);
  const out = (base && typeof base === 'object' && !Array.isArray(base)) ? Object.assign({}, base) : {};
  for (const k of Object.keys(over)) out[k] = deepMerge(out[k], over[k]);
  return out;
}

function modules(deps) {
  const M = {}, src = {};
  for (const n of OWN.concat(OTHERS)) {
    if (deps && deps[n]) { M[n] = deps[n]; src[n] = 'injected'; continue; }
    const m = load(n);
    if (m) { M[n] = m; src[n] = n + '.js'; continue; }
    if (STUBS[n]) { M[n] = STUBS[n]; src[n] = 'stub'; continue; }
    if (n === 'scenario') { M[n] = null; src[n] = 'none'; continue; }
    throw new Error('cruise-sim: core/' + n + '.js is missing');
  }
  return { M, src };
}

function normalize(config) {
  const c = clone(config || {});
  if (c.version === undefined) c.version = 1;
  if (c.seed === undefined) c.seed = 1;
  if (c.dt === undefined) c.dt = 0.01;
  c.out = Object.assign({ dt: 0.05 }, c.out || {});
  c.controller = Object.assign({ rateHz: 10 }, c.controller || {});
  c.ego = Object.assign({ mode: 'ours' }, c.ego || {});
  c.failures = c.failures || [];
  c.scenario = c.scenario || { id: 'demo.approach' };
  if (c.stopOnCollision === undefined) c.stopOnCollision = true;
  return c;
}

// config[name] -> the module's params
function modParams(M, name, obj, schema) {
  const mod = M[name];
  obj = obj || {};
  if (typeof mod.params === 'function') return mod.params(obj);
  if (mod.LENIENT || !mod.SCHEMA) return Object.assign({}, obj);
  const has = k => !!schema.field(mod.SCHEMA, k);
  const ignore = ['rateHz', 'preset'].filter(k => !has(k));
  if (obj.preset && !has('preset') && mod.PRESETS) return schema.withPreset(mod.SCHEMA, mod.PRESETS, obj.preset, obj, { ignore, where: name });
  return schema.merge(mod.SCHEMA, obj, { ignore, where: name });
}

function resolveScenario(cfg, M) {
  const sc = cfg.scenario || {};
  let base;
  if (sc.inline) base = sc.inline;
  else if (M.scenario && typeof M.scenario.load === 'function' && !(sc.id in BUILTIN)) base = M.scenario.load(sc.id);
  else if (BUILTIN[sc.id]) base = BUILTIN[sc.id];
  else throw new Error('scenario ' + JSON.stringify(sc.id) + ': not built in and core/scenario.js is ' + (M.scenario ? 'unable to load it' : 'missing'));
  base = clone(base);
  if (sc.overrides) base = deepMerge(base, sc.overrides);
  return base;
}

function instance(mod, params, rng, ctx) {
  return mod.create(params, rng, ctx);
}

// ---- the engine -----------------------------------------------------------------------------------------------------

const SERIES = ['ego.x', 'ego.v', 'ego.a', 'ego.jerk', 'lead.x', 'lead.v', 'lead.a', 'lead.id', 'gap.true', 'vrel.true',
  'gap.meas', 'vrel.meas', 'meas.valid', 'est.gap', 'est.vrel', 'est.vlead', 'est.alead', 'est.valid', 'set.cmd', 'set.held',
  'v.driverMax', 'd.des', 'd.needed', 'v.ref', 'timegap', 'ttc', 'warn', 'cruise.state', 'driver.brake', 'driver.accel',
  'grade', 'follower.gap', 'follower.a',
  // additions (CONTRACT.md lists them as SC1's extras)
  'set.eff', 'meas.id', 'meas.wrong', 'est.id', 'warn.reason', 'warn.ttc', 'app.alive', 'curvature', 'elevation', 'follower.v', 'a.demand', 'ego.lane', 'ego.y'];

function createSim(config, deps) {
  const t0wall = Date.now();
  const { M, src } = modules(deps);
  const schema = M.schema;
  const cfg = normalize(config);
  const scen = resolveScenario(cfg, M);
  const dt = cfg.dt;
  const duration = cfg.duration !== undefined ? cfg.duration : (scen.duration !== undefined ? scen.duration : 120);
  const nTicks = Math.round(duration / dt);
  const outEvery = Math.max(1, Math.round(cfg.out.dt / dt));
  const ctrlPeriod = 1 / cfg.controller.rateHz;   // the app's clock: due at 0, P, 2P, ... on the first tick at or after
  const root = M.rng.create(cfg.seed);
  const events = [];
  const mode = cfg.ego.mode || 'ours';

  const world = { t: 0, road: null, ego: null, others: [], cruise: null, driver: null, app: { alive: true }, faults: {} };
  function emit(kind, detail, t) { events.push(Object.assign({ t: t !== undefined ? t : world.t, kind }, detail || {})); }

  // the world
  const road = M.road.create(scen.road || {});
  world.road = road;
  const sEgo = scen.ego || {};
  const egoLane = sEgo.lane || 0;
  world.ego = { x: 0, v: (sEgo.v0_kmh !== undefined ? sEgo.v0_kmh : 100) * KMH, a: 0, lane: egoLane, jerk: 0,
    length: M.vehicles.EGO_DEFAULT.length, width: M.vehicles.EGO_DEFAULT.width, y: road.laneY(egoLane), lat: 0, id: 'ego', kind: 'car' };
  const vehs = M.vehicles.create(scen.vehicles || [], scen.events || [], { road, rng: root.fork('vehicles'), emit, ego: world.ego, dt });
  world.others = vehs.list;

  // the models
  const params = {};
  const plantP = M.plant.params(cfg.plant || {});
  params.plant = plantP.params;
  const plant = M.plant.create(plantP.params, root.fork('plant'), { emit, name: plantP.name });
  world.cruise = plant.init(world.ego, { state: sEgo.cruise, set: sEgo.set_kmh !== undefined ? sEgo.set_kmh * KMH : null });
  params.driver = modParams(M, 'driver', cfg.driver, schema);
  const driver = M.driver.create(params.driver, root.fork('driver'), { emit, scenario: scen, road, dt, vMinActive: world.cruise.vMinActive });
  world.driver = driver.init(world);
  params.command = modParams(M, 'command', cfg.command, schema);
  const command = M.command.create(params.command, root.fork('command'), { emit });
  const failures = M.failures.create(cfg.failures, root.fork('failures'), { emit, duration, scenarioEvents: scen.events || [] });
  params.sensor = modParams(M, 'sensor', cfg.sensor, schema);
  const sensor = instance(M.sensor, params.sensor, root.fork('sensor'), { emit, road, dt });
  params.estimator = modParams(M, 'estimator', cfg.estimator, schema);
  params.controller = modParams(M, 'controller', cfg.controller, schema);
  params.warning = modParams(M, 'warning', cfg.warning, schema);
  let appGen = 0;
  function makeApp() {
    const g = appGen++;
    return {
      estimator: instance(M.estimator, params.estimator, root.fork('estimator#' + g), {}),
      controller: instance(M.controller, params.controller, root.fork('controller#' + g), {}),
      warning: instance(M.warning, params.warning, root.fork('warning#' + g), {}),
    };
  }
  let app = mode === 'ours' ? makeApp() : null;
  // the fastest the loop lets its set speed fall (SC2's controller key), for the warning; undefined when not configured
  const aCmdMax = typeof params.controller.rateDown_kmhps === 'number' ? params.controller.rateDown_kmhps * KMH : undefined;
  let baseline = null;
  if (mode !== 'ours') {
    const B = M.baselines[mode];
    const bp = (cfg.ego.params) || {};
    if (B && typeof B.create === 'function') baseline = B.create(bp, root.fork('baseline'));
    else if (typeof M.baselines.create === 'function') baseline = M.baselines.create(mode, bp, root.fork('baseline'));
    else throw new Error('ego.mode ' + JSON.stringify(mode) + ': no such baseline');
    world.cruise.state = 'off';
  }

  // recording
  const nRows = Math.floor(nTicks / outEvery) + 1;
  const tArr = new Float64Array(nRows);
  const series = {};
  for (const n of SERIES) series[n] = new Float64Array(nRows).fill(NaN);
  const vehSeries = {};
  for (const o of world.others) for (const f of ['x', 'v', 'a', 'lane', 'lat', 'y']) {
    const n = 'veh.' + o.id + '.' + f;
    vehSeries[n] = [o, f];
    series[n] = new Float64Array(nRows).fill(NaN);
  }
  const enums = { 'cruise.state': M.plant.STATES.slice(), id: [], 'warn.reason': [] };
  function enumIdx(name, v) {
    if (v === null || v === undefined) return NaN;
    const list = enums[name];
    let i = list.indexOf(v);
    if (i < 0) { list.push(v); i = list.length - 1; }
    return i;
  }
  let row = 0;

  // run state
  let k = 0, done = false, ctrlNext = 0, lastT = 0;
  let lastMeas = null, pendingMeas = null, frozenMeas = null, lastEst = null, lastOut = null, lastW = null;
  let lastSent = null, prevTarget = null, warnOn = false, lastJerkA = 0;
  let lead = null, fol = null;
  const core = { minGap: Infinity, minTimeGap: Infinity, minTTC: Infinity, collision: false, collisionWith: null, collisionT: null, collisionFrom: null,
    impactSpeed: 0, peakDecel: 0, peakAccel: 0, peakJerk: 0, accelRms: 0, cmdSent: 0, cmdApplied: 0, cmdDropped: 0, cmdRejected: 0,
    cmdPerMin: 0, warnCount: 0, warnTime: 0, driverBrakes: 0, followerMinTimeGap: Infinity, followerPeakDecel: 0,
    timeNotActive: 0, minSpeed: Infinity, duration: 0 };
  let sumA2 = 0, nA = 0;

  function sensorWithFaults(meas, faults) {
    if (faults.sensorBlind) {
      if (faults.blindMode === 'silent') return null;
      if (!meas) return null;
      return Object.assign({}, meas, { valid: false, id: null, gap: null, vrel: null, lat: null, kind: null });
    }
    if (faults.gapFrozen) {
      if (!meas) return null;
      if (!frozenMeas) frozenMeas = lastMeas ? Object.assign({}, lastMeas) : Object.assign({}, meas);
      return Object.assign({}, frozenMeas, { t: meas.t, tMeas: meas.tMeas });
    }
    frozenMeas = null;
    return meas;
  }

  function onDelivered(d) {
    if (d.status === 'applied') {
      const r = plant.request(world.t, d.vSet, world.faults);
      if (r.status === 'applied') { core.cmdApplied++; emit('cmd.applied', { id: d.id, tSent: d.tSent, vSet: d.vSet, held: r.held, dup: d.dup || undefined }); }
      else { core.cmdRejected++; emit('cmd.rejected', { id: d.id, tSent: d.tSent, vSet: d.vSet, reason: r.reason, silent: r.silent || undefined }); }
    } else if (d.status === 'dropped') { core.cmdDropped++; emit('cmd.dropped', { id: d.id, tSent: d.tSent, vSet: d.vSet, reason: d.reason }); }
    else { core.cmdRejected++; emit('cmd.rejected', { id: d.id, tSent: d.tSent, vSet: d.vSet, reason: d.reason, silent: d.silent || undefined }); }
  }

  function step() {
    if (done) return;
    const t = k * dt;
    world.t = t;
    const ego = world.ego;

    // 2. failures
    const faults = failures.apply(world, t);
    world.faults = faults;
    const alive = !faults.appDead;
    if (alive !== world.app.alive) {
      world.app.alive = alive;
      if (!alive) {
        if (faults.restart) for (const d of command.reset(t)) onDelivered(d);
        if (warnOn) { warnOn = false; emit('warn.off', { reason: 'appDead' }); }
        lastW = null; lastEst = null; lastOut = null;
        if (prevTarget !== null) { emit('target.lost', { id: prevTarget, reason: 'appDead' }); prevTarget = null; }
      } else if (mode === 'ours') { app = makeApp(); lastSent = null; pendingMeas = null; }
    }

    // 3. sensor
    let meas = sensor.sample(world, t);
    meas = sensorWithFaults(meas, faults);
    if (meas) { lastMeas = meas; pendingMeas = meas; }

    // 4. the app, on its clock
    const stalled = faults.stalled || command.stalled(t);
    const due = t >= ctrlNext - 1e-9;
    if (due) while (ctrlNext <= t + 1e-9) ctrlNext += ctrlPeriod;
    if (mode === 'ours' && world.app.alive && !stalled && due) {
      const egoIn = { egoV: ego.v, egoA: ego.a };
      lastEst = app.estimator.update(pendingMeas, t, egoIn);
      pendingMeas = null;
      const curv = road.curvature(ego.x);
      lastOut = app.controller.step({ t, est: lastEst, egoV: ego.v, egoA: ego.a, vDriver: world.driver.vMax, cruise: world.cruise,
        curvature: curv, yawRate: ego.v * curv });
      lastW = app.warning.step({ t, est: lastEst, egoV: ego.v, aMin: plant.aMinConfigured, aCmdMax });
      // send when the controller says so (out.send: a change or a resend), else when vSet changed
      const wantSend = lastOut && lastOut.vSet !== null && lastOut.vSet !== undefined &&
        (lastOut.send === true || (lastOut.send === undefined && lastOut.vSet !== lastSent));
      if (wantSend) {
        const s = command.send(t, lastOut.vSet, faults);
        lastSent = lastOut.vSet;
        core.cmdSent++;
        emit('cmd.sent', { id: s.id, vSet: lastOut.vSet });
        if (s.lost === 'nextDecrease') failures.consume('commandLost', t);
      }
      const tid = lastEst && lastEst.valid ? (lastEst.id === undefined ? null : lastEst.id) : null;
      if (tid !== prevTarget) {
        if (prevTarget === null) emit('target.acquired', { id: tid });
        else if (tid === null) emit('target.lost', { id: prevTarget });
        else emit('target.changed', { from: prevTarget, id: tid });
        prevTarget = tid;
      }
      const wn = !!(lastW && lastW.warn);
      if (wn !== warnOn) {
        warnOn = wn;
        core.warnCount += wn ? 1 : 0;
        emit(wn ? 'warn.on' : 'warn.off', wn ? { reason: lastW.reason, ttc: lastW.ttc, dNeeded: lastW.dNeeded } : {});
      }
    }

    // 5. the command path
    if (!faults.stalled) for (const d of command.deliver(t)) onDelivered(d);   // command.deliver knows its own random stalls

    // 6. the driver
    world.driver = driver.step(world, t, { warn: lastW });

    // 7. the plant (or a baseline)
    const grade = road.grade(ego.x);
    let a, aDem = NaN;
    if (mode === 'ours') {
      const csPrev = world.cruise.state;
      const r = plant.step(dt, { t, grade, driver: world.driver, faults }, ego);
      a = r.a;
      aDem = r.aDemand === null ? NaN : r.aDemand;
      if (csPrev !== world.cruise.state && world.cruise.state !== 'active' && warnOn === false) { /* state events come from the plant */ }
    } else {
      a = baseline.step(world, t, lastMeas).a;
      if (world.driver.brake > 0) a = Math.min(a, -world.driver.brake);
    }
    if (ego.v <= 0 && a < 0) a = 0;
    ego.jerk = (a - lastJerkA) / dt;
    lastJerkA = a;
    ego.a = a;

    // truth and core metrics at t
    lead = M.vehicles.trueLead(world);
    fol = M.vehicles.follower(world);
    const gTrue = lead ? M.vehicles.gap(ego, lead) : NaN;
    const vrel = lead ? lead.v - ego.v : NaN;
    const tg = lead && ego.v > 0.5 ? gTrue / ego.v : NaN;
    const ttc = lead && vrel < 0 ? gTrue / -vrel : NaN;
    if (lead) {
      if (gTrue < core.minGap) core.minGap = gTrue;
      if (tg < core.minTimeGap) core.minTimeGap = tg;
      if (ttc < core.minTTC) core.minTTC = ttc;
    }
    if (fol) {
      const fg = M.vehicles.gap(fol, ego);
      if (fol.v > 0.5 && fg / fol.v < core.followerMinTimeGap) core.followerMinTimeGap = fg / fol.v;
      if (fol.a < core.followerPeakDecel) core.followerPeakDecel = fol.a;
    }
    if (a < core.peakDecel) core.peakDecel = a;
    if (a > core.peakAccel) core.peakAccel = a;
    if (k > 0 && Math.abs(ego.jerk) > core.peakJerk) core.peakJerk = Math.abs(ego.jerk);
    sumA2 += a * a; nA++;
    if (warnOn) core.warnTime += dt;
    if (world.cruise.state !== 'active' && mode === 'ours') core.timeNotActive += dt;
    if (ego.v < core.minSpeed) core.minSpeed = ego.v;

    // 8. record
    if (k % outEvery === 0 && row < nRows) {
      const i = row++;
      tArr[i] = t;
      const S = series;
      S['ego.lane'][i] = ego.lane; S['ego.y'][i] = ego.y;
      S['ego.x'][i] = ego.x; S['ego.v'][i] = ego.v; S['ego.a'][i] = a; S['ego.jerk'][i] = k > 0 ? ego.jerk : 0;
      if (lead) {
        S['lead.x'][i] = lead.x; S['lead.v'][i] = lead.v; S['lead.a'][i] = lead.a; S['lead.id'][i] = enumIdx('id', lead.id);
        S['gap.true'][i] = gTrue; S['vrel.true'][i] = vrel;
      }
      if (lastMeas) {
        S['meas.valid'][i] = lastMeas.valid ? 1 : 0;
        S['gap.meas'][i] = lastMeas.gap === null || lastMeas.gap === undefined ? NaN : lastMeas.gap;
        S['vrel.meas'][i] = lastMeas.vrel === null || lastMeas.vrel === undefined ? NaN : lastMeas.vrel;
        S['meas.id'][i] = enumIdx('id', lastMeas.id);
        const tr = lastMeas._truth;   // SC2's debug truth of a sample: a wrong or ghost target
        if (tr) S['meas.wrong'][i] = (tr.wrong || tr.ghost) ? 1 : 0;
      }
      if (lastEst) {
        S['est.valid'][i] = lastEst.valid ? 1 : 0;
        if (lastEst.valid) {
          S['est.gap'][i] = num(lastEst.gap); S['est.vrel'][i] = num(lastEst.vrel); S['est.vlead'][i] = num(lastEst.vlead); S['est.alead'][i] = num(lastEst.alead);
          S['est.id'][i] = enumIdx('id', lastEst.id);
        }
      }
      S['set.cmd'][i] = lastSent === null ? NaN : lastSent;
      S['set.held'][i] = num(world.cruise.setHeld);
      S['set.eff'][i] = num(world.cruise.setEff);
      S['v.driverMax'][i] = world.driver.vMax;
      if (lastOut) { S['d.des'][i] = num(lastOut.dDes); S['v.ref'][i] = num(lastOut.vRef); }
      if (lastW) { S['d.needed'][i] = num(lastW.dNeeded); S['warn.ttc'][i] = num(lastW.ttc); S['warn.reason'][i] = lastW.warn ? enumIdx('warn.reason', lastW.reason) : NaN; }
      S['timegap'][i] = tg; S['ttc'][i] = ttc;
      S['warn'][i] = warnOn ? 1 : 0;
      S['cruise.state'][i] = enumIdx('cruise.state', world.cruise.state);
      S['driver.brake'][i] = world.driver.brake; S['driver.accel'][i] = world.driver.accel;
      S['grade'][i] = grade; S['curvature'][i] = road.curvature(ego.x); S['elevation'][i] = road.elevation(ego.x);
      S['app.alive'][i] = world.app.alive ? 1 : 0;
      S['a.demand'][i] = aDem;
      if (fol) { S['follower.gap'][i] = M.vehicles.gap(fol, ego); S['follower.a'][i] = fol.a; S['follower.v'][i] = fol.v; }
      for (const n in vehSeries) { const [o, f] = vehSeries[n]; S[n][i] = f === 'lane' ? o.lane : o[f]; }
    }

    lastT = t;
    // which others overlap us longitudinally now (a collision that begins with a lateral move is a side impact)
    const longiBefore = world.others.map(o => o.x - o.length < ego.x && ego.x - ego.length < o.x);
    if (k >= nTicks) { done = true; return; }   // the state at t = duration is recorded; nothing moves past it

    // 9. advance to t + dt
    vehs.step(world, dt);
    let v1 = ego.v + a * dt;
    if (v1 < 0) v1 = 0;
    ego.x += (ego.v + v1) / 2 * dt;
    ego.v = v1;
    k++;
    world.t = k * dt;

    // collisions at t + dt: longitudinal and lateral overlap with anyone. from: 'ahead' (we ran into it), 'behind' (it ran
    // into us), 'side' (it moved sideways into us while alongside: a lane change into an occupied space); impactSpeed is
    // the longitudinal closing speed (for 'side', the absolute speed difference)
    for (let oi = 0; oi < world.others.length; oi++) {
      const o = world.others[oi];
      const longi = o.x - o.length < ego.x && ego.x - ego.length < o.x;
      const lat = Math.abs(o.y - ego.y) < (o.width + ego.width) / 2;
      if (longi && lat) {
        const behind = o.x < ego.x;
        const side = longiBefore[oi];
        const impact = side ? Math.abs(o.v - ego.v) : Math.max(0, behind ? o.v - ego.v : ego.v - o.v);
        core.collision = true; core.collisionWith = o.id; core.collisionT = world.t; core.impactSpeed = impact;
        core.collisionFrom = side ? 'side' : (behind ? 'behind' : 'ahead');
        emit('collision', { with: o.id, from: core.collisionFrom, impactSpeed: impact });
        if (cfg.stopOnCollision) done = true;
        break;
      }
    }
  }

  function num(v) { return v === null || v === undefined ? NaN : v; }
  function finiteOrNull(o) { const r = {}; for (const kk in o) r[kk] = (typeof o[kk] === 'number' && !isFinite(o[kk])) ? null : o[kk]; return r; }

  function result() {
    const n = row;
    const out = {};
    for (const name in series) out[name] = series[name].subarray(0, n);
    core.accelRms = nA ? Math.sqrt(sumA2 / nA) : 0;
    core.driverBrakes = events.filter(e => e.kind === 'driver.brake' && e.level > 0).length;
    core.driverReactions = events.filter(e => e.kind === 'driver.react').length;
    core.duration = lastT;
    core.cmdPerMin = core.duration > 0 ? core.cmdSent / (core.duration / 60) : 0;
    const res = {
      meta: {
        config: cfg, seed: cfg.seed, version: VERSION, contract: 1,
        plant: { name: plantP.name, assumed: plantP.assumed, modified: plantP.modified || false },
        scenario: { id: scen.id, family: scen.family, name: scen.name, scope: scen.scope, decide: scen.decide },
        duration, dt, outDt: outEvery * dt, modules: src, params, enums: clone(enums), core: finiteOrNull(core),
        ego: { length: world.ego.length, width: world.ego.width, lane: world.ego.lane },
        vehicles: world.others.map(o => ({ id: o.id, kind: o.kind, length: o.length, width: o.width })),
        road: { lanes: road.lanes, laneWidth: road.laneWidth },
        ms: Date.now() - t0wall,
      },
      t: tArr.subarray(0, n), series: out, events: events.slice(), metrics: {}, verdict: { pass: false, failed: [] },
    };
    // SC3's metrics.js: compute(result, config) -> { name: value }, verdict(metrics, thresholds, decide) -> { pass, failed, unknown }
    // (the stub returns { metrics, verdict } at once)
    const mr = M.metrics.compute(res, cfg);
    if (mr && mr.metrics && mr.verdict) { res.metrics = mr.metrics; res.verdict = mr.verdict; }
    else if (mr) {
      res.metrics = mr;
      if (typeof M.metrics.verdict === 'function') res.verdict = M.metrics.verdict(mr, cfg.thresholds || {}, scen.decide || []);
    }
    return res;
  }

  return {
    step,
    advance(seconds) { const end = k + Math.round(seconds / dt); while (!done && k < end) step(); return world.t; },
    state() { return { t: world.t, world, meas: lastMeas, est: lastEst, out: lastOut, w: lastW, lead, follower: fol, k }; },
    get done() { return done; },
    result,
    meta: { duration, dt, scenario: scen, plant: plantP },
  };
}

function runOnce(config, deps) {
  const s = createSim(config, deps);
  while (!s.done) s.step();
  return s.result();
}

// With a failure at 'worst' (in config.failures or a scenario 'fault' event) this searches the injection time.
function run(config, deps) {
  const cfg = normalize(config);
  const { M } = modules(deps);
  const scen = resolveScenario(cfg, M);
  const scenWorst = (scen.events || []).filter(e => e.kind === 'fault' && e.at === 'worst');
  const anyWorst = cfg.failures.some(f => f.at === 'worst') || scenWorst.length > 0;
  if (!anyWorst) return runOnce(cfg, deps);
  let c = cfg;
  if (scenWorst.length) {
    const moved = M.failures.normalize([], scenWorst);
    const inline = Object.assign({}, scen, { events: (scen.events || []).filter(e => scenWorst.indexOf(e) < 0) });
    c = Object.assign({}, cfg, { scenario: { id: scen.id, inline }, failures: cfg.failures.concat(moved) });
  }
  const t0 = Date.now();
  const r = M.failures.searchWorst(c, cc => runOnce(cc, deps));
  r.result.meta.worst = r.search;
  r.result.meta.ms = Date.now() - t0;
  return r.result;
}

function defaultConfig() {
  const { M } = modules();
  const s = M.schema;
  const c = normalize({});
  c.duration = undefined;
  c.plant = { preset: 'mild', model: 'P1' };
  for (const n of ['command', 'driver', 'sensor', 'estimator', 'controller', 'warning']) {
    const mod = M[n];
    if (mod && mod.SCHEMA && !mod.STUB) c[n] = Object.assign(s.defaults(mod.SCHEMA), n === 'controller' ? { rateHz: c.controller.rateHz } : {});
  }
  delete c.duration;
  return c;
}

function schemas() {
  const { M } = modules();
  const out = {};
  for (const n of ['plant', 'command', 'driver', 'sensor', 'estimator', 'controller', 'warning', 'metrics']) {
    if (M[n] && M[n].SCHEMA && !M[n].STUB) out[n] = M[n].SCHEMA;
  }
  return out;
}

function hashResult(res) {
  let h = 0x811c9dc5;
  function bytes(u8) { for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); } }
  function f64(a) { const c = Float64Array.from(a); bytes(new Uint8Array(c.buffer)); }
  function str(s) { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) & 0xff; h = Math.imul(h, 0x01000193); h ^= s.charCodeAt(i) >>> 8; h = Math.imul(h, 0x01000193); } }
  f64(res.t);
  for (const n of Object.keys(res.series).sort()) { str(n); f64(res.series[n]); }
  str(JSON.stringify(res.events));
  str(JSON.stringify(res.metrics, (k, v) => (typeof v === 'number' && !isFinite(v)) ? String(v) : v));
  return (h >>> 0).toString(16).padStart(8, '0');
}

const sim = { VERSION, SERIES, LOAD_ORDER, BUILTIN, STUBS, run, runOnce, createSim, defaultConfig, schemas, hashResult, normalize, resolveScenario, deepMerge };
if (typeof module !== 'undefined') module.exports = sim; else (self.CS = self.CS || {})['sim'] = sim;
})();
