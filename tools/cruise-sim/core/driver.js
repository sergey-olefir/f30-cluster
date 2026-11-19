'use strict';
// The driver of our car (SC1): sets and changes the maximum speed, overrides with the accelerator, brakes (the cruise
// suspends) and resumes, and reacts to the warning.
//
//   driver.create(params, rng, ctx) -> instance        ctx = { emit, scenario, road, dt, vMinActive }
//   instance.init(world) -> world.driver
//   instance.step(world, t, { warn }) -> world.driver = { vMax, brake, accel, reacting, resume, cancel, cause }
//
// The reaction model: on a warning's rising edge the driver reacts after a reaction time (reactionCase 'nominal': a
// lognormal draw around reactionMedian_s, clipped to [reactionMin_s, reactionMax_s]; 'late': reactionMax_s; 'none': never).
// Reacting means: if we are closing on the true lead (the driver looks out of the window, not at the sensor), brake at
// brakeLevel_ms2, reached over brakeRise_s, and hold it until we are no faster than the lead (+ releaseMargin_ms) and at
// least brakeMin_s have passed, or we stop. selfBrakeTTC_s > 0 adds braking without a warning when the true TTC falls
// below it (the attentive driver); 0 = the driver relies on the warning alone.
// After braking (or a cruise drop-out) with autoResume, the driver resumes resumeDelay_s later, once the speed is at
// least the cruise's minimum and the time gap at least resumeTimeGap_s; below the minimum the driver first accelerates
// gently by hand (manualAccel).
// Scripted events in the scenario: { t, kind: 'driverVmax', vMax_kmh } | { t, kind: 'driverBrake', level_ms2, duration_s }
//   | { t, kind: 'driverOverride', accel (0..1), duration_s } | { t, kind: 'driverResume' } | { t, kind: 'driverCancel' }.
// followLimits: the driver sets the maximum to each new speed limit of the road, limitDelay_s after passing its sign.

const KMH = 1 / 3.6;

function S(key, label, unit, def, min, max, step, help, extra) {
  return Object.assign({ key, label, unit, default: def, min, max, step, group: 'driver', help }, extra || {});
}

const SCHEMA = [
  S('reactionCase', 'Reaction case', '', 'nominal', undefined, undefined, undefined, 'nominal: drawn; late: the longest; none: never reacts', { options: ['nominal', 'late', 'none'] }),
  S('reactionMedian_s', 'Reaction time, median', 's', 1.2, 0.3, 3, 0.05, 'Of the lognormal draw'),
  S('reactionSigma', 'Reaction time, spread', '', 0.35, 0, 1, 0.05, 'Lognormal sigma'),
  S('reactionMin_s', 'Reaction time, shortest', 's', 0.8, 0.1, 3, 0.05, ''),
  S('reactionMax_s', 'Reaction time, longest', 's', 2.5, 0.5, 5, 0.05, 'Also the late case'),
  S('brakeLevel_ms2', 'Braking level', 'm/s²', 6, 2, 9, 0.5, 'The driver\'s braking after a warning'),
  S('brakeRise_s', 'Braking build-up', 's', 0.3, 0, 2, 0.05, 'Time to reach the braking level'),
  S('brakeMin_s', 'Braking, shortest', 's', 0.5, 0, 5, 0.1, ''),
  S('releaseMargin_ms', 'Release when this close to the lead\'s speed', 'm/s', 0.5, 0, 5, 0.1, ''),
  S('selfBrakeTTC_s', 'Brakes unwarned below TTC', 's', 0, 0, 5, 0.1, '0 = relies on the warning alone'),
  S('autoResume', 'Resumes after braking', '', true, undefined, undefined, undefined, ''),
  S('resumeDelay_s', 'Resume after', 's', 3, 0, 60, 0.5, ''),
  S('resumeTimeGap_s', 'Resume at a time gap of at least', 's', 1.0, 0, 5, 0.1, ''),
  S('manualAccel', 'Accelerator by hand', '0..1', 0.4, 0, 1, 0.05, 'Below the cruise\'s minimum before resuming'),
  S('followLimits', 'Follows speed limits', '', false, undefined, undefined, undefined, 'Sets the maximum to each new limit'),
  S('limitDelay_s', 'Limit taken after', 's', 2, 0, 20, 0.5, ''),
];

function create(p, rng, ctx) {
  ctx = ctx || {};
  const emit = ctx.emit || function () {};
  const V = typeof require !== 'undefined' ? require('./vehicles') : self.CS.vehicles;
  const scen = ctx.scenario || {};
  const vMinActive = ctx.vMinActive || 30 * KMH;
  const scripted = (scen.events || []).filter(e => /^driver/.test(e.kind)).map(e => Object.assign({ fired: false }, e))
    .sort((a, b) => (a.t || 0) - (b.t || 0));
  const st = {
    vMax: (scen.ego && scen.ego.vMax_kmh !== undefined ? scen.ego.vMax_kmh : (scen.ego && scen.ego.v0_kmh !== undefined ? scen.ego.v0_kmh : 120)) * KMH,
    brake: 0, accel: 0, reacting: false, resume: false, cancel: false, cause: null,
  };
  let warnPrev = false;
  let reactAt = null, reactCause = null, reactRt = null;
  let braking = null;            // { t0, level, cause }
  let scriptBrake = null, scriptAccel = null;   // { t1, level } / { t1, accel }
  let resumeAt = null, manual = false;
  let limitPrev = null, limitAt = null, limitVal = null;
  let cruisePrev = null;

  function drawReaction() {
    if (p.reactionCase === 'none') return null;
    if (p.reactionCase === 'late') return p.reactionMax_s;
    const x = rng.lognormal(p.reactionMedian_s, p.reactionSigma);
    return Math.max(p.reactionMin_s, Math.min(p.reactionMax_s, x));
  }

  function init(world) {
    if (ctx.road && p.followLimits) limitPrev = ctx.road.speedLimit(world.ego.x);
    return Object.assign({}, st);
  }

  function step(world, t, info) {
    const ego = world.ego;
    const w = info && info.warn;
    const warn = !!(w && w.warn);
    st.resume = false; st.cancel = false;

    // scripted events
    for (const e of scripted) {
      if (e.fired || (e.t || 0) > t + 1e-9) continue;
      e.fired = true;
      if (e.kind === 'driverVmax') { st.vMax = e.vMax_kmh * KMH; emit('driver.vmax', { vMax: st.vMax, scripted: true }, t); }
      else if (e.kind === 'driverBrake') { scriptBrake = { t1: t + (e.duration_s || 1), level: e.level_ms2 || 2 }; emit('driver.brake', { level: scriptBrake.level, cause: 'scripted' }, t); }
      else if (e.kind === 'driverOverride') { scriptAccel = { t1: t + (e.duration_s || 3), accel: e.accel === undefined ? 0.5 : e.accel }; emit('driver.override', { accel: scriptAccel.accel, scripted: true }, t); }
      else if (e.kind === 'driverResume') { st.resume = true; emit('driver.resume', { scripted: true }, t); }
      else if (e.kind === 'driverCancel') { st.cancel = true; emit('driver.cancel', { scripted: true }, t); }
    }

    // speed limits
    if (p.followLimits && ctx.road) {
      const lim = ctx.road.speedLimit(ego.x);
      if (lim !== limitPrev) { limitPrev = lim; if (lim !== null) { limitAt = t + p.limitDelay_s; limitVal = lim; } }
      if (limitAt !== null && t >= limitAt - 1e-9) { st.vMax = limitVal; limitAt = null; emit('driver.vmax', { vMax: st.vMax, cause: 'limit' }, t); }
    }

    const lead = V.trueLead(world);
    const closing = lead && lead.v < ego.v;

    // the warning, and (optionally) seeing the danger without one
    if (warn && !warnPrev && !braking && reactAt === null) {
      const rt = drawReaction();
      if (rt !== null) { reactAt = t + rt; reactCause = 'warning'; reactRt = rt; }
    }
    warnPrev = warn;
    if (p.selfBrakeTTC_s > 0 && !braking && reactAt === null && closing) {
      const ttc = V.gap(ego, lead) / (ego.v - lead.v);
      if (ttc < p.selfBrakeTTC_s) {
        const rt = p.reactionCase === 'none' ? p.reactionMedian_s : drawReaction();
        reactAt = t + rt; reactCause = 'seen'; reactRt = rt;
      }
    }
    if (reactAt !== null && t >= reactAt - 1e-9) {
      const doBrake = !!closing;
      emit('driver.react', { cause: reactCause, rt: reactRt, brakes: doBrake }, t);
      if (doBrake) {
        braking = { t0: t, level: p.brakeLevel_ms2, cause: reactCause };
        emit('driver.brake', { level: p.brakeLevel_ms2, cause: reactCause }, t);
      }
      reactAt = null;
      st.reacting = doBrake;
    }

    // braking and its release
    let brake = 0;
    if (braking) {
      const ramp = p.brakeRise_s > 0 ? Math.min(1, (t - braking.t0) / p.brakeRise_s) : 1;
      brake = braking.level * ramp;
      const held = t - braking.t0 >= p.brakeMin_s - 1e-9;
      const safe = !lead || ego.v <= lead.v + p.releaseMargin_ms;
      if ((held && safe) || ego.v <= 0.05) {
        emit('driver.brake', { level: 0, cause: 'release' }, t);
        braking = null; brake = 0; st.reacting = false;
        if (p.autoResume) resumeAt = t + p.resumeDelay_s;
      }
    }
    if (scriptBrake) {
      if (t < scriptBrake.t1 - 1e-9) brake = Math.max(brake, scriptBrake.level);
      else { scriptBrake = null; if (p.autoResume && resumeAt === null) resumeAt = t + p.resumeDelay_s; }
    }

    // the cruise dropped out by itself: the driver notices and resumes later
    const cs = world.cruise ? world.cruise.state : null;
    if (cs === 'dropout' && cruisePrev !== 'dropout' && p.autoResume && resumeAt === null) resumeAt = t + p.resumeDelay_s;
    cruisePrev = cs;

    // resume (by hand up to the minimum first)
    let accel = 0;
    if (resumeAt !== null && brake === 0 && t >= resumeAt - 1e-9) {
      if (cs !== 'suspended' && cs !== 'dropout') { resumeAt = null; manual = false; }
      else {
        const tg = lead ? V.gap(ego, lead) / Math.max(ego.v, 0.1) : Infinity;
        if (ego.v >= vMinActive && tg >= p.resumeTimeGap_s) {
          st.resume = true; resumeAt = null; manual = false;
          emit('driver.resume', { cause: 'auto' }, t);
        } else if (ego.v < vMinActive + 0.5 && tg >= p.resumeTimeGap_s * 1.5 && (!lead || lead.v > ego.v - 0.5)) {
          manual = true;
        } else manual = false;
      }
    }
    if (manual) accel = p.manualAccel;
    if (scriptAccel) {
      if (t < scriptAccel.t1 - 1e-9) accel = Math.max(accel, scriptAccel.accel);
      else scriptAccel = null;
    }
    if (brake > 0) accel = 0;

    st.brake = brake;
    st.accel = accel;
    st.cause = braking ? braking.cause : (scriptBrake ? 'scripted' : null);
    return Object.assign({}, st);
  }

  return { params: p, init, step };
}

const driver = { NAME: 'driver', SCHEMA, create };
if (typeof module !== 'undefined') module.exports = driver; else (self.CS = self.CS || {})['driver'] = driver;
