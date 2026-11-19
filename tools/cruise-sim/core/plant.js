'use strict';
// The stock cruise as a plant (SC1): BMW's Dynamic Cruise Control is a black box; these are assumed models of it
// until Phase 2 identifies one from the car's logs (then it is loaded from a JSON file and marked assumed: false).
//
//   plant.create(params, rng, ctx) -> instance        (params = plant.params(config.plant))
//   plant.params(configPlant) -> { params, name, assumed, modified }   presets, an identified file, overrides
//   instance.init(ego, opts)            -> world.cruise   (opts: { state: 'active'|'off', set: m/s })
//   instance.request(t, vSet, faults)   -> { status: 'applied'|'rejected', reason?, silent?, held }
//                                          a set speed arriving from the command path
//   instance.step(dt, { t, grade, driver, faults }, ego) -> { a, cruiseState, setHeld, setEff, aDemand }
//   instance.decelAvailable(v, grade)   -> the strongest deceleration it can give now (m/s², negative)
//   instance.aMinConfigured             -> params.aMin_ms2 (what the warning is told)
//
// Models (params.model):
//   P1  tau v' + v = v_set(t - Td), a_min <= v' <= a_max (the parent brief's starting model), exact discretisation
//   P2  P1 with separate time constant and dead time for slowing down (tauDown_s, deadTimeDown_s)
//   P3  second order: a' = wn^2 (v_set(t - Td) - v) - 2 zeta wn a, same limits (can overshoot)
// Around all of them: the demand is clipped to [aMin_ms2, aMax_ms2] (and to a jerk limit if set), then realised through
// the powertrain: the force it needs (demand + drag + rolling + g * grade) is clipped between engine braking plus the
// brake authority the cruise may use (brakeMax_ms2; 0 = lift-off only) and the engine's power / traction. So a lift-off
// cruise overspeeds on a steep downhill, and a weak one cannot hold speed up a steep hill.
// The set speed: quantised to resolution_kmh, clipped to [vMinActive_kmh, vMaxActive_kmh], at most one accepted change
// per acceptInterval_s, rejected unless active (acceptWhenSuspended); a decrease takes effect after deadTimeDown_s,
// an increase after deadTime_s; a newer change that takes effect supersedes any older one still pending.
// States: off | active | suspended (driver braked or cancelled; memory kept) | override (accelerator above the cruise's
// own demand) | dropout (the cruise switched itself off: below dropoutBelow_kmh, a fault, or farBelowMode 'cancel').
// Resume (driver.resume) re-engages from suspended / dropout at v >= vMinActive_kmh, holding the current speed for the
// dead time, then the remembered set speed.

const KMH = 1 / 3.6;
const G = 9.81;
const STATES = ['off', 'active', 'suspended', 'override', 'dropout'];

function S(key, label, unit, def, min, max, step, group, help, extra) {
  return Object.assign({ key, label, unit, default: def, min, max, step, group: 'plant' + (group ? '.' + group : ''), help }, extra || {});
}

const SCHEMA = [
  S('preset', 'Preset', '', 'mild', undefined, undefined, undefined, '', 'Braking authority of the assumed cruise: lift-off only, mild braking, firm braking', { options: ['liftoff', 'mild', 'firm'] }),
  S('model', 'Model', '', 'P1', undefined, undefined, undefined, '', 'P1 first-order + dead time; P2 separate up / down; P3 second-order', { options: ['P1', 'P2', 'P3'] }),
  S('file', 'Identified plant file', '', null, undefined, undefined, undefined, '', 'A JSON file of an identified plant (Node: path relative to tools/cruise-sim); makes the plant not assumed', { type: 'string', nullable: true }),
  S('data', 'Identified plant (inline)', '', null, undefined, undefined, undefined, '', 'The identified plant object itself (what the page loads from a file)', { type: 'object', nullable: true }),
  S('deadTime_s', 'Dead time', 's', 0.5, 0, 3, 0.05, 'dynamics', 'Setpoint change to the first change of acceleration (Td)'),
  S('tau_s', 'Time constant', 's', 2.0, 0.2, 10, 0.1, 'dynamics', 'First-order lag tau_c (P1, P2 speeding up)'),
  S('deadTimeDown_s', 'Dead time, slowing down', 's', null, 0, 3, 0.05, 'dynamics', 'P2 only; empty = the dead time'),
  S('tauDown_s', 'Time constant, slowing down', 's', null, 0.2, 10, 0.1, 'dynamics', 'P2 only; empty = the time constant'),
  S('wn_rads', 'Natural frequency', 'rad/s', 0.8, 0.1, 5, 0.05, 'dynamics', 'P3 only'),
  S('zeta', 'Damping ratio', '', 0.6, 0.1, 2, 0.05, 'dynamics', 'P3 only (< 1 overshoots)'),
  S('aMax_ms2', 'Max acceleration', 'm/s²', 1.5, 0.2, 4, 0.1, 'limits', 'The most the cruise asks for when speeding up'),
  S('aMin_ms2', 'Max deceleration', 'm/s²', -1.8, -6, -0.1, 0.1, 'limits', 'The most the cruise asks for when slowing down (negative); also what the warning is told'),
  S('brakeMax_ms2', 'Brake authority', 'm/s²', 2.0, 0, 8, 0.1, 'limits', 'Friction braking the cruise may add to engine braking; 0 = lift-off only'),
  S('jerkMax_ms3', 'Jerk limit', 'm/s³', 0, 0, 20, 0.5, 'limits', '0 = none'),
  S('largeStep_kmh', 'Large step from', 'km/h', 10, 1, 60, 1, 'limits', 'Error above which the step-size nonlinearity applies'),
  S('largeStepGain', 'Large-step gain', '×', 1, 0.5, 3, 0.1, 'limits', 'Demand multiplied by this for large errors; 1 = linear'),
  S('farBelow_kmh', 'Far below from', 'km/h', 30, 5, 100, 1, 'limits', 'Set speed this far below the current speed counts as far below'),
  S('farBelowMode', 'When set is far below', '', 'normal', undefined, undefined, undefined, 'limits', 'normal; liftoffOnly = no brake then; cancel = the cruise drops out', { options: ['normal', 'liftoffOnly', 'cancel'] }),
  S('resolution_kmh', 'Setpoint resolution', 'km/h', 1, 0.1, 10, 0.1, 'setpoint', 'A set speed is rounded to a multiple of this'),
  S('acceptInterval_s', 'Min interval between changes', 's', 0, 0, 5, 0.05, 'setpoint', 'A change sooner than this after the last accepted one is rejected; 0 = any rate'),
  S('vMinActive_kmh', 'Min active speed', 'km/h', 30, 0, 80, 1, 'setpoint', 'Lowest set speed; resume needs at least this speed'),
  S('vMaxActive_kmh', 'Max active speed', 'km/h', 210, 100, 260, 1, 'setpoint', 'Highest set speed'),
  S('dropoutBelow_kmh', 'Drops out below', 'km/h', 25, 0, 80, 1, 'setpoint', 'The cruise switches off below this speed; 0 = never'),
  S('acceptWhenSuspended', 'Accept set speed when suspended', '', false, undefined, undefined, undefined, 'setpoint', 'Whether a set speed arriving while suspended / dropped out is taken'),
  S('mass_kg', 'Mass', 'kg', 1600, 800, 3000, 10, 'vehicle', 'With driver'),
  S('cdA_m2', 'Drag area Cd·A', 'm²', 0.62, 0.3, 1.5, 0.01, 'vehicle', ''),
  S('crr', 'Rolling resistance', '', 0.011, 0.005, 0.03, 0.001, 'vehicle', ''),
  S('rho_kgm3', 'Air density', 'kg/m³', 1.2, 1.0, 1.4, 0.01, 'vehicle', ''),
  S('power_kW', 'Engine power', 'kW', 140, 50, 400, 5, 'vehicle', 'Caps acceleration at speed'),
  S('aDriveMax_ms2', 'Traction / low-gear limit', 'm/s²', 3.5, 1, 8, 0.1, 'vehicle', ''),
  S('engineBrakeHi_ms2', 'Engine braking, high speed', 'm/s²', 0.25, 0, 1.5, 0.05, 'vehicle', 'Drag-free engine braking at 30 m/s and above (high gear)'),
  S('engineBrakeLo_ms2', 'Engine braking, low speed', 'm/s²', 0.6, 0, 2, 0.05, 'vehicle', 'At 10 m/s and below (low gear); linear between'),
  S('brakeFriction_ms2', 'Driver braking limit', 'm/s²', 9, 3, 11, 0.5, 'vehicle', 'Tyre limit of the driver\'s braking'),
  S('overrideAccel_ms2', 'Accelerator, full', 'm/s²', 2.5, 0.5, 5, 0.1, 'vehicle', 'Acceleration the driver asks for at accelerator = 1'),
];

const PRESETS = {
  liftoff: { brakeMax_ms2: 0, aMin_ms2: -0.7 },
  mild: { brakeMax_ms2: 2.0, aMin_ms2: -1.8 },
  firm: { brakeMax_ms2: 3.5, aMin_ms2: -2.8 },
};

function loadFile(file) {
  if (typeof require === 'undefined') throw new Error('plant file ' + file + ': files load only under Node; pass plant.data in the browser');
  const fs = require('fs'), path = require('path');
  const p = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// config.plant -> { params, name, assumed, modified }
// An identified plant file: { name, model?, params: { <SCHEMA keys> }, source?, notes? }
function params(cfg) {
  const schema = typeof require !== 'undefined' ? require('./schema') : self.CS.schema;
  cfg = Object.assign({}, cfg || {});
  let data = cfg.data || null;
  if (!data && cfg.file) data = loadFile(cfg.file);
  if (data) {
    const base = Object.assign({}, data.params || {});
    if (data.model) base.model = data.model;
    const over = Object.assign({}, cfg);
    delete over.file; delete over.data; delete over.preset;
    const modified = Object.keys(over).length > 0;
    const p = schema.merge(SCHEMA, Object.assign({}, base, over, { file: cfg.file || null, data: null, preset: 'mild' }));
    schema.check(SCHEMA, p, 'plant');
    return { params: p, name: data.name || cfg.file || 'identified', assumed: false, modified };
  }
  const preset = cfg.preset || 'mild';
  const p = schema.withPreset(SCHEMA, PRESETS, preset, cfg);
  schema.check(SCHEMA, p, 'plant');
  return { params: p, name: preset + ' / ' + p.model, assumed: true, modified: false };
}

function create(p, rng, ctx) {
  if (p && p.params && p.assumed !== undefined) p = p.params;   // accept the output of params() too
  ctx = ctx || {};
  const emit = ctx.emit || function () {};
  const tdUp = p.deadTime_s;
  const tdDown = (p.model === 'P2' && p.deadTimeDown_s !== null) ? p.deadTimeDown_s : p.deadTime_s;
  const tauUp = p.tau_s;
  const tauDown = (p.model === 'P2' && p.tauDown_s !== null) ? p.tauDown_s : p.tau_s;
  const vMin = p.vMinActive_kmh * KMH, vMax = p.vMaxActive_kmh * KMH;
  const res = p.resolution_kmh;

  const cruise = { state: 'active', setHeld: null, setEff: null, vMinActive: vMin, vMaxActive: vMax };
  let pending = [];               // [{ tSent, tEff, value }] in tSent order
  let lastAcceptT = -Infinity;
  let aPrev = 0, aCmd3 = 0;       // the last demand (jerk limit), P3's state
  let faultDropPrev = false;

  function setState(to, reason, t) {
    if (cruise.state === to) return;
    const from = cruise.state;
    cruise.state = to;
    emit('cruise.state', { from, to, reason }, t);
  }

  function engineBrake(v) {
    if (v >= 30) return p.engineBrakeHi_ms2;
    if (v <= 10) return p.engineBrakeLo_ms2;
    return p.engineBrakeLo_ms2 + (p.engineBrakeHi_ms2 - p.engineBrakeLo_ms2) * (v - 10) / 20;
  }
  function resist(v) { return 0.5 * p.rho_kgm3 * p.cdA_m2 * v * v / p.mass_kg + p.crr * G; }
  function uMax(v) { return Math.min(p.aDriveMax_ms2, p.power_kW * 1000 / (p.mass_kg * Math.max(v, 1))); }
  function coast(v, grade) { return -engineBrake(v) - resist(v) - G * grade; }
  function decelAvailable(v, grade, noBrake) {
    const uMin = -engineBrake(v) - (noBrake ? 0 : p.brakeMax_ms2);
    return Math.max(p.aMin_ms2, uMin - resist(v) - G * grade);
  }

  function quantize(vs) {
    let k = Math.round(vs / KMH / res) * res;
    k = Math.min(p.vMaxActive_kmh, Math.max(p.vMinActive_kmh, k));
    return k * KMH;
  }

  function init(ego, opts) {
    opts = opts || {};
    const set = opts.set !== undefined && opts.set !== null ? opts.set : ego.v;
    cruise.setHeld = set;
    cruise.setEff = set;
    cruise.state = opts.state === 'off' ? 'off' : 'active';
    pending = [];
    return cruise;
  }

  function request(t, vSet, faults) {
    faults = faults || {};
    if (vSet === null || vSet === undefined || !isFinite(vSet)) return { status: 'rejected', reason: 'invalid', held: cruise.setHeld };
    if (faults.setStuck) return { status: 'rejected', reason: 'stuck', silent: true, held: cruise.setHeld };
    const on = cruise.state === 'active' || cruise.state === 'override';
    if (!on && !p.acceptWhenSuspended) return { status: 'rejected', reason: 'state:' + cruise.state, held: cruise.setHeld };
    if (t - lastAcceptT < p.acceptInterval_s - 1e-9) return { status: 'rejected', reason: 'rate', held: cruise.setHeld };
    const q = quantize(vSet);
    lastAcceptT = t;
    if (cruise.setHeld !== null && Math.abs(q - cruise.setHeld) < 1e-9) return { status: 'applied', reason: 'same', held: cruise.setHeld };
    const down = cruise.setHeld !== null && q < cruise.setHeld;
    cruise.setHeld = q;
    pending.push({ tSent: t, tEff: t + (down ? tdDown : tdUp), value: q });
    return { status: 'applied', held: q };
  }

  function step(dt, inp, ego) {
    const t = inp.t, grade = inp.grade || 0, drv = inp.driver || {}, faults = inp.faults || {};
    const v = ego.v;

    // the pending setpoint changes that take effect now
    let last = -1;
    for (let i = 0; i < pending.length; i++) if (pending[i].tEff <= t + 1e-9) last = i;
    if (last >= 0) { cruise.setEff = pending[last].value; pending.splice(0, last + 1); }

    // state transitions
    if (faults.cruiseDropout && !faultDropPrev && (cruise.state === 'active' || cruise.state === 'override')) setState('dropout', 'fault', t);
    faultDropPrev = !!faults.cruiseDropout;
    const brake = drv.brake > 0 ? drv.brake : 0;
    const accel = drv.accel > 0 ? Math.min(1, drv.accel) : 0;
    if (cruise.state === 'active' || cruise.state === 'override') {
      if (brake > 0) setState('suspended', 'brake', t);
      else if (drv.cancel) setState('suspended', 'cancel', t);
      else if (p.dropoutBelow_kmh > 0 && v < p.dropoutBelow_kmh * KMH) setState('dropout', 'speed', t);
    }
    if ((cruise.state === 'suspended' || cruise.state === 'dropout') && drv.resume && brake === 0 && v >= vMin - 1e-9 && !faults.cruiseDropout) {
      setState('active', 'resume', t);
      if (cruise.setHeld === null) cruise.setHeld = quantize(v);
      cruise.setEff = v;
      pending = [{ tSent: t, tEff: t + (cruise.setHeld < v ? tdDown : tdUp), value: cruise.setHeld }];
      aCmd3 = 0;
    }

    let a, aDemand = null;
    if ((cruise.state === 'active' || cruise.state === 'override') && p.farBelowMode === 'cancel' &&
        cruise.setEff - v < -p.farBelow_kmh * KMH) setState('dropout', 'farBelow', t);
    if (cruise.state === 'active' || cruise.state === 'override') {
      const s = cruise.setEff;
      const e = s - v;
      const farBelow = e < -p.farBelow_kmh * KMH;
      let dem;
      if (p.model === 'P3') {
        aCmd3 += dt * (p.wn_rads * p.wn_rads * e - 2 * p.zeta * p.wn_rads * aCmd3);
        dem = aCmd3;
      } else {
        const tau = e < 0 ? tauDown : tauUp;
        dem = e * (1 - Math.exp(-dt / tau)) / dt;
      }
      if (p.largeStepGain !== 1 && Math.abs(e) > p.largeStep_kmh * KMH) dem *= p.largeStepGain;
      dem = Math.max(p.aMin_ms2, Math.min(p.aMax_ms2, dem));
      if (p.jerkMax_ms3 > 0) dem = Math.max(aPrev - p.jerkMax_ms3 * dt, Math.min(aPrev + p.jerkMax_ms3 * dt, dem));
      if (p.model === 'P3') aCmd3 = dem;     // no wind-up past the limits
      aDemand = dem;
      // through the powertrain
      const r = resist(v) + G * grade;
      const noBrake = farBelow && p.farBelowMode === 'liftoffOnly';
      const uLo = -engineBrake(v) - (noBrake ? 0 : p.brakeMax_ms2);
      const u = Math.max(uLo, Math.min(uMax(v), dem + r));
      a = u - r;
      aPrev = dem;
      if (accel > 0) {
        const aDrv = Math.min(accel * p.overrideAccel_ms2, uMax(v) - r);   // the driver asks for a total acceleration
        if (aDrv > a) { a = aDrv; setState('override', 'accelerator', t); }
        else if (cruise.state === 'override') setState('active', 'accelerator released', t);
      } else if (cruise.state === 'override') setState('active', 'accelerator released', t);
    } else {
      aPrev = 0; aCmd3 = 0;
      a = coast(v, grade);
      if (accel > 0) a = Math.max(a, Math.min(accel * p.overrideAccel_ms2, uMax(v) - resist(v) - G * grade));
    }
    if (brake > 0) a = Math.min(a, -Math.min(brake, p.brakeFriction_ms2));
    return { a, cruiseState: cruise.state, setHeld: cruise.setHeld, setEff: cruise.setEff, aDemand };
  }

  return {
    name: ctx.name || (p.preset + ' / ' + p.model), params: p, cruise, aMinConfigured: p.aMin_ms2,
    init, request, step, decelAvailable, coast, resist, engineBrake, quantize,
    pendingCount: () => pending.length,
  };
}

const plant = { NAME: 'plant', SCHEMA, PRESETS, STATES, create, params };
if (typeof module !== 'undefined') module.exports = plant; else (self.CS = self.CS || {})['plant'] = plant;
