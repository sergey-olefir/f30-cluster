/*
 * core/sensor.js — the front camera (KAFAS) as the simulator sees it.  Owner: SC2.
 *
 * A camera, not a radar: the range error grows with distance (a power law, a setting), the relative speed is
 * lagged and noisy or absent, the camera runs at its own native rate and its messages arrive late with jitter,
 * they drop out singly and in bursts, a few are outliers, a frozen transport repeats the last message, the
 * target id changes on cut-in / cut-out after an acquisition delay (jump or blend), the target is lost on a
 * curve (geometry: the camera predicts our lane from the yaw rate, imperfectly), the car in the next lane is
 * taken for the lead on a curve (the same geometry), a ghost target appears now and then, weather shortens the
 * range and adds dropouts, and "no target" has its own representation (null, or the car's 4093-like sentinel).
 *
 * Pipeline step 3 (CONTRACT): sensor.sample(world, t) -> meas | null (null = nothing delivered this tick).
 * meas = { t (delivery), tMeas, seq, valid, id, gap, vrel, lat, kind, qual ('ok'|'none'|'blind'),
 *          _truth: { ... } (for series and events only: the estimator never reads it) }
 *
 * Geometry conventions (announced in pub/NOTES.md): x = the front bumper; gap = o.x - o.length - ego.x;
 * lane index + = left; lat + = left; road.curvature + = a left turn.
 *
 * Node 8 syntax (no ?. ?? object spread, class fields), so it can share the head unit's code style.
 */
(function () {
  'use strict';

  var LANE_W_DEFAULT = 3.5;

  var SCHEMA = [
    // timing
    { key: 'rateHz', label: 'Native sample rate', unit: 'Hz', default: 10, min: 2, max: 25, step: 1, group: 'timing', help: 'How often the camera sends the front-vehicle message. Unknown on the car; TrafficSignRecognition arrives at about 2 Hz.' },
    { key: 'latency_s', label: 'Latency', unit: 's', default: 0.15, min: 0, max: 1.0, step: 0.01, group: 'timing', help: 'From the camera frame to the app receiving the value (camera processing + gateway + SOME/IP).' },
    { key: 'jitter_s', label: 'Latency jitter', unit: 's', default: 0.03, min: 0, max: 0.5, step: 0.01, group: 'timing', help: 'Standard deviation of a half-normal added to the latency. Delivery stays in order.' },
    { key: 'useTimestamp', label: 'Message carries its own time', unit: '', default: true, options: [true, false], group: 'timing', help: 'If false the estimator only sees the receive time (tMeas = null).' },
    // range noise
    { key: 'range_m', label: 'Range', unit: 'm', default: 120, min: 20, max: 250, step: 5, group: 'range', help: 'Beyond it nothing is seen.' },
    { key: 'fovHalf_deg', label: 'Half field of view', unit: 'deg', default: 25, min: 10, max: 60, step: 1, group: 'range', help: 'A vehicle whose bearing exceeds it is not seen.' },
    { key: 'gapSd0_m', label: 'Gap noise floor', unit: 'm', default: 0.1, min: 0, max: 2, step: 0.05, group: 'range', help: 'Standard deviation at zero distance.' },
    { key: 'gapSd100_m', label: 'Gap noise at 100 m', unit: 'm', default: 3.0, min: 0, max: 15, step: 0.1, group: 'range', help: 'Added standard deviation at 100 m; scales as (d/100)^exponent. Mono cameras: about 5 % at 45 m, 10 % at 90 m.' },
    { key: 'gapSdExp', label: 'Gap noise exponent', unit: '', default: 2, min: 1, max: 3, step: 0.1, group: 'range', help: '2 = error proportional to distance squared (a camera); 1 = proportional.' },
    { key: 'gapNoiseTau_s', label: 'Gap noise correlation time', unit: 's', default: 0.3, min: 0, max: 3, step: 0.05, group: 'range', help: 'AR(1) correlation of the range error (the camera filters internally). 0 = white.' },
    { key: 'gapBiasRel', label: 'Gap scale error', unit: '', default: 0, min: -0.2, max: 0.2, step: 0.01, group: 'range', help: 'A calibration error: measured = true x (1 + this).' },
    { key: 'gapQuant_m', label: 'Gap resolution', unit: 'm', default: 0.1, min: 0, max: 1, step: 0.05, group: 'range', help: 'Quantisation of the delivered gap. 0 = none.' },
    // relative speed
    { key: 'vrelMode', label: 'Relative speed', unit: '', default: 'measured', options: ['measured', 'none'], group: 'speed', help: '"none": the camera gives no usable speed; the estimator must derive it from the gap.' },
    { key: 'vrelSd0_mps', label: 'Relative-speed noise floor', unit: 'm/s', default: 0.2, min: 0, max: 2, step: 0.05, group: 'speed', help: 'Standard deviation at zero distance (white).' },
    { key: 'vrelSd100_mps', label: 'Relative-speed noise at 100 m', unit: 'm/s', default: 1.5, min: 0, max: 5, step: 0.1, group: 'speed', help: 'Added standard deviation at 100 m, scales as (d/100)^exponent.' },
    { key: 'vrelSdExp', label: 'Relative-speed noise exponent', unit: '', default: 1.5, min: 1, max: 3, step: 0.1, group: 'speed', help: '' },
    { key: 'vrelLag_s', label: 'Relative-speed lag', unit: 's', default: 0.5, min: 0, max: 2, step: 0.05, group: 'speed', help: 'First-order lag of the camera\'s own speed estimate (from scale change).' },
    { key: 'vrelQuant_mps', label: 'Relative-speed resolution', unit: 'm/s', default: 0.1, min: 0, max: 1, step: 0.05, group: 'speed', help: '0 = none.' },
    // faults
    { key: 'dropProb', label: 'Dropout probability', unit: '1/sample', default: 0.02, min: 0, max: 0.5, step: 0.01, group: 'faults', help: 'A single message lost.' },
    { key: 'burstProb', label: 'Burst start probability', unit: '1/sample', default: 0.0005, min: 0, max: 0.05, step: 0.001, group: 'faults', help: 'A run of lost messages starts.' },
    { key: 'burstMean_s', label: 'Burst mean length', unit: 's', default: 0.5, min: 0.1, max: 10, step: 0.1, group: 'faults', help: 'Exponentially distributed.' },
    { key: 'outlierProb', label: 'Outlier probability', unit: '1/sample', default: 0.005, min: 0, max: 0.1, step: 0.001, group: 'faults', help: 'A gap value off by up to the outlier size.' },
    { key: 'outlierRel', label: 'Outlier size', unit: '', default: 0.3, min: 0, max: 1, step: 0.05, group: 'faults', help: 'Uniform relative error, +/- this fraction of the gap.' },
    { key: 'ghostRatePerMin', label: 'Ghost targets', unit: '1/min', default: 0, min: 0, max: 10, step: 0.1, group: 'faults', help: 'Random ghosts (bridges, shadows). The fault flag world.faults.ghost forces one.' },
    { key: 'ghostDur_s', label: 'Ghost duration', unit: 's', default: 1.0, min: 0.2, max: 5, step: 0.1, group: 'faults', help: '' },
    { key: 'ghostStatic', label: 'Ghost is standing', unit: '', default: true, options: [true, false], group: 'faults', help: 'A standing ghost closes at our own speed (the worst case); otherwise it moves about our speed.' },
    { key: 'frozenMode', label: 'Frozen gap', unit: '', default: 'repeat', options: ['repeat', 'repeatNewSeq', 'silent'], group: 'faults', help: 'When world.faults.gapFrozen: repeat the last message (same seq and time), repeat its values under a new seq and time (only the identical-values check catches it), or send nothing.' },
    { key: 'blindMode', label: 'Blind camera', unit: '', default: 'invalid', options: ['invalid', 'silent'], group: 'faults', help: 'When world.faults.sensorBlind: messages marked invalid (qual = blind) or silence.' },
    // tracking
    { key: 'acqDelay_s', label: 'Acquisition delay', unit: 's', default: 0.5, min: 0, max: 3, step: 0.05, group: 'tracking', help: 'How long a vehicle must be in our path before it becomes the target.' },
    { key: 'acqMotoFactor', label: 'Motorcycle acquisition factor', unit: '', default: 2.0, min: 0.5, max: 5, step: 0.1, group: 'tracking', help: 'Narrow: acquired late.' },
    { key: 'acqTruckFactor', label: 'Truck acquisition factor', unit: '', default: 0.6, min: 0.2, max: 2, step: 0.1, group: 'tracking', help: 'Large: acquired early.' },
    { key: 'releaseDelay_s', label: 'Release delay', unit: 's', default: 0.3, min: 0, max: 2, step: 0.05, group: 'tracking', help: 'How long the target may be out of the path before it is dropped.' },
    { key: 'forget_s', label: 'Track memory', unit: 's', default: 0.5, min: 0, max: 5, step: 0.1, group: 'tracking', help: 'An object unseen for longer gets a new id when it comes back.' },
    { key: 'transition', label: 'Target change', unit: '', default: 'jump', options: ['jump', 'blend'], group: 'tracking', help: 'On a target change the gap jumps, or blends from the old to the new target.' },
    { key: 'blend_s', label: 'Blend time', unit: 's', default: 0.5, min: 0.05, max: 2, step: 0.05, group: 'tracking', help: '' },
    { key: 'idTiming', label: 'Id changes', unit: '', default: 'start', options: ['start', 'end'], group: 'tracking', help: '"end": during a blend the old id is still reported (the hard case for the estimator).' },
    { key: 'inPathHalf_m', label: 'Path half-width', unit: 'm', default: 1.0, min: 0.3, max: 2, step: 0.05, group: 'tracking', help: 'A vehicle is in our path when its near edge is closer than this to the predicted path.' },
    { key: 'inPathHyst_m', label: 'Path hysteresis', unit: 'm', default: 0.3, min: 0, max: 1, step: 0.05, group: 'tracking', help: '' },
    { key: 'curvePredErr', label: 'Curve prediction error', unit: '', default: 0.3, min: 0, max: 1, step: 0.05, group: 'tracking', help: 'The fraction of the curve the camera\'s path prediction misses. Drives loss on curves and the next-lane car taken for the lead.' },
    { key: 'laneWidth_m', label: 'Lane width', unit: 'm', default: LANE_W_DEFAULT, min: 2.5, max: 4.5, step: 0.05, group: 'tracking', help: 'Used when the road does not give one.' },
    // weather and output
    { key: 'weather', label: 'Conditions', unit: '', default: 'clear', options: ['clear', 'rain', 'lowSun', 'fog', 'night'], group: 'weather', help: 'Degraded modes: shorter range, more noise and dropouts, later acquisition. world.faults.sensorDegraded overrides.' },
    { key: 'noTarget', label: '"No target" value', unit: '', default: 'null', options: ['null', 'sentinel', 'sentinelValid'], group: 'output', help: '"sentinel": the gap carries the no-target number (the car sends 4093); "sentinelValid": and the valid flag is not cleared.' },
    { key: 'noTargetGap_m', label: 'No-target number', unit: 'm', default: 409.3, min: 100, max: 1000, step: 0.1, group: 'output', help: 'The gap value meaning no target (raw 4093 at an assumed 0.1 m).' }
  ];

  var WEATHER = {
    clear: { range: 1.0, sd: 1.0, drop: 0, burst: 1, acq: 1.0 },
    rain: { range: 0.6, sd: 1.5, drop: 0.08, burst: 3, acq: 1.5 },
    lowSun: { range: 0.5, sd: 1.3, drop: 0.15, burst: 6, acq: 2.0 },
    fog: { range: 0.4, sd: 2.0, drop: 0.05, burst: 2, acq: 1.5 },
    night: { range: 0.8, sd: 1.3, drop: 0.03, burst: 1.5, acq: 1.3 }
  };

  var PRESETS = {
    ideal: { rateHz: 25, latency_s: 0, jitter_s: 0, gapSd0_m: 0, gapSd100_m: 0, gapQuant_m: 0, gapNoiseTau_s: 0, vrelSd0_mps: 0, vrelSd100_mps: 0, vrelLag_s: 0, vrelQuant_mps: 0,
      dropProb: 0, burstProb: 0, outlierProb: 0, ghostRatePerMin: 0, acqDelay_s: 0, releaseDelay_s: 0, curvePredErr: 0, range_m: 250, fovHalf_deg: 60 },
    clear: {},
    rain: { weather: 'rain' },
    lowSun: { weather: 'lowSun' },
    fog: { weather: 'fog' },
    night: { weather: 'night' },
    slow2Hz: { rateHz: 2, latency_s: 0.3 },
    poor: { rateHz: 5, latency_s: 0.3, jitter_s: 0.1, gapSd100_m: 6, vrelMode: 'none', dropProb: 0.05, burstProb: 0.005, outlierProb: 0.01, curvePredErr: 0.5 }
  };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // defaults <- PRESETS[params.preset] <- params. (The engine applies the preset itself through schema.withPreset
  // and passes merged params; `preset` is therefore not a SCHEMA key.)
  function fill(params) {
    var p = {};
    var i, k;
    for (i = 0; i < SCHEMA.length; i++) p[SCHEMA[i].key] = SCHEMA[i].default;
    var pre = params && params.preset && has(PRESETS, params.preset) ? PRESETS[params.preset] : null;
    if (pre) for (k in pre) if (has(pre, k)) p[k] = pre[k];
    if (params) for (k in params) if (has(params, k) && params[k] !== undefined) p[k] = params[k];
    return p;
  }

  // A deterministic fallback stream when no rng is given (tests, the page's previews). Never Math.random.
  function mulberry(seed) {
    var a = seed >>> 0;
    return { next: function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    } };
  }

  function stream(rng, label, fallbackSeed) {
    var r = rng ? (typeof rng.fork === 'function' ? rng.fork(label) : rng) : mulberry(fallbackSeed);
    var spare = null;
    return {
      u: function () { return r.next(); },
      n: function () {
        if (typeof r.normal === 'function') return r.normal(0, 1);
        if (spare !== null) { var s = spare; spare = null; return s; }
        var u1 = r.next(); var u2 = r.next();
        if (u1 < 1e-12) u1 = 1e-12;
        var m = Math.sqrt(-2 * Math.log(u1));
        spare = m * Math.sin(2 * Math.PI * u2);
        return m * Math.cos(2 * Math.PI * u2);
      }
    };
  }

  // ---- geometry, shared with baselines.js (and offered to sim / metrics) ----

  function laneWidth(world, fallback) {
    return (world.road && world.road.laneWidth > 0) ? world.road.laneWidth : (fallback || LANE_W_DEFAULT);
  }
  function curvatureAt(world, x) {
    return (world.road && typeof world.road.curvature === 'function') ? (world.road.curvature(x) || 0) : 0;
  }
  // lateral offset of o from our lane centre, in road coordinates (m, + = left)
  function yRel(world, o, lw) {
    var e = world.ego;
    return ((o.lane || 0) - (e.lane || 0)) * (lw || laneWidth(world)) + (o.lat || 0) - (e.lat || 0);
  }
  function gapTo(ego, o) { return o.x - (o.length > 0 ? o.length : 0) - ego.x; }

  // The true lead: the nearest vehicle ahead whose centre is inside our lane.
  function trueLead(world, lw) {
    var w = lw || laneWidth(world);
    var best = null; var bestGap = Infinity;
    var others = world.others || [];
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      var g = gapTo(world.ego, o);
      if (!(g > -0.5) || g >= bestGap) continue;
      if (Math.abs(yRel(world, o, w)) < w / 2) { best = o; bestGap = g; }
    }
    return best ? { o: best, id: best.id, gap: bestGap, vrel: best.v - world.ego.v, alead: best.a || 0 } : null;
  }

  function quant(x, q) { return q > 0 ? Math.round(x / q) * q : x; }

  function create(params, rng) {
    var p = fill(params);
    var R = {
      noise: stream(rng, 'sensor.noise', 101),
      drop: stream(rng, 'sensor.drop', 202),
      out: stream(rng, 'sensor.outlier', 303),
      ghost: stream(rng, 'sensor.ghost', 404),
      lat: stream(rng, 'sensor.latency', 505)
    };
    var tracks = {};          // vehicle id -> { oid, inPath, inSince, outSince, seenT, z, vl, g, app, o }
    var nextOid = 1;
    var targetVid = null;     // vehicle id the camera reports
    var blend = null;         // { fromVid, fromOid, t0 }
    var ghost = null;         // { oid, gap, vrel, until, forced }
    var ghostFault = false;
    var burstUntil = -Infinity;
    var frame = 0;
    var nextT = null;
    var queue = [];
    var lastDeliver = -Infinity;
    var lastCap = null;
    var dtF = 1 / p.rateHz;

    function weatherOf(f) {
      var key = p.weather;
      if (f.sensorDegraded) key = typeof f.sensorDegraded === 'string' ? f.sensorDegraded : 'rain';
      return WEATHER[key] || WEATHER.clear;
    }

    function acqDelay(o, W) {
      var k = o.kind === 'moto' ? p.acqMotoFactor : (o.kind === 'truck' ? p.acqTruckFactor : 1);
      return p.acqDelay_s * k * W.acq;
    }

    function updateTracks(world, t, W, f) {
      var ego = world.ego;
      var lw = laneWidth(world, p.laneWidth_m);
      var kE = curvatureAt(world, ego.x);
      var rangeEff = p.range_m * W.range;
      if (f.sensorRangeCut > 0) rangeEff = Math.min(rangeEff, f.sensorRangeCut);
      var tanFov = Math.tan(p.fovHalf_deg * Math.PI / 180);
      var rho = p.gapNoiseTau_s > 0 ? Math.exp(-dtF / p.gapNoiseTau_s) : 0;
      var kv = p.vrelLag_s > 0 ? 1 - Math.exp(-dtF / p.vrelLag_s) : 1;
      var others = world.others || [];
      var seen = {};
      for (var i = 0; i < others.length; i++) {
        var o = others[i];
        if (o.kind === 'static' && o.visible === false) continue;
        var g = gapTo(ego, o);
        if (!(g > 0.5) || g > rangeEff) continue;
        var y = yRel(world, o, lw);
        var kMid = curvatureAt(world, ego.x + g / 2);
        var yPath = kMid * g * g / 2;                       // where the lane centre really is at that distance
        var yPred = (1 - p.curvePredErr) * kE * g * g / 2;  // where the camera thinks it is
        if (Math.abs(y + yPath) / g > tanFov) continue;    // outside the field of view
        var app = y + yPath - yPred;
        var edge = Math.abs(app) - (o.width > 0 ? o.width : 1.8) / 2;
        var tr = tracks[o.id];
        if (!tr || t - tr.seenT > p.forget_s + 1e-9) {
          tr = tracks[o.id] = { oid: nextOid++, inPath: false, inSince: t, outSince: t, seenT: t, z: R.noise.n(), vl: o.v - ego.v };
        } else {
          tr.z = rho * tr.z + Math.sqrt(1 - rho * rho) * R.noise.n();
          tr.vl += ((o.v - ego.v) - tr.vl) * kv;
        }
        var inNow = tr.inPath ? edge < p.inPathHalf_m + p.inPathHyst_m : edge < p.inPathHalf_m;
        if (inNow && !tr.inPath) { tr.inPath = true; tr.inSince = t; }
        if (!inNow && tr.inPath) { tr.inPath = false; tr.outSince = t; }
        tr.seenT = t; tr.g = g; tr.app = app; tr.o = o;
        seen[o.id] = true;
      }
      // forget old tracks
      for (var vid in tracks) if (has(tracks, vid) && !seen[vid] && t - tracks[vid].seenT > p.forget_s + 1e-9) delete tracks[vid];

      // keep the current target?
      var cur = targetVid !== null ? tracks[targetVid] : null;
      var keep = cur && seen[targetVid] && (cur.inPath || t - cur.outSince < p.releaseDelay_s);
      // nearest confirmed candidate
      var best = null; var bestG = Infinity;
      for (vid in tracks) {
        if (!has(tracks, vid) || !seen[vid]) continue;
        var c = tracks[vid];
        if (c.inPath && t - c.inSince >= acqDelay(c.o, W) - 1e-9 && c.g < bestG) { best = vid; bestG = c.g; }
      }
      var prev = targetVid;
      if (keep) {
        if (best !== null && String(best) !== String(targetVid) && bestG < cur.g) targetVid = tracks[best].o.id;
      } else {
        targetVid = best !== null ? tracks[best].o.id : null;
      }
      if (prev !== null && targetVid !== null && String(prev) !== String(targetVid) && p.transition === 'blend' && seen[prev]) {
        blend = { fromVid: prev, fromOid: tracks[prev].oid, t0: t };
      }
      if (targetVid === null || (blend && (t - blend.t0 >= p.blend_s || !seen[blend.fromVid]))) blend = null;
    }

    function noTargetMeas(qual) {
      var sentinel = qual === 'none' && p.noTarget !== 'null';
      return { valid: sentinel && p.noTarget === 'sentinelValid', id: null, gap: sentinel ? p.noTargetGap_m : null, vrel: null, lat: null, kind: null, qual: qual };
    }

    function capture(world, t) {
      var f = world.faults || {};
      var W = weatherOf(f);
      var ego = world.ego;
      frame++;
      var lead = trueLead(world, laneWidth(world, p.laneWidth_m));
      var truth = { leadId: lead ? lead.id : null, gapTrue: lead ? lead.gap : null, vrelTrue: lead ? lead.vrel : null };

      if (f.gapFrozen && lastCap) {
        if (p.frozenMode === 'silent') return null;
        var c = {};
        for (var k in lastCap) if (has(lastCap, k)) c[k] = lastCap[k];
        c._truth = { leadId: truth.leadId, gapTrue: truth.gapTrue, vrelTrue: truth.vrelTrue, vehId: lastCap._truth.vehId, frozen: true };
        if (p.frozenMode === 'repeatNewSeq') { c.seq = frame; c.tMeas = p.useTimestamp ? t : null; }
        return c;
      }
      if (f.sensorBlind) {
        targetVid = null; blend = null; ghost = null;
        tracks = {};
        if (p.blindMode === 'silent') return null;
        var b = noTargetMeas('blind');
        b.seq = frame; b.tMeas = p.useTimestamp ? t : null; b._truth = truth;
        return b;
      }

      updateTracks(world, t, W, f);

      // ghost targets
      if (f.ghost && !ghostFault && !ghost) ghost = newGhost(t, ego, true);
      ghostFault = !!f.ghost;
      if (!ghost && p.ghostRatePerMin > 0 && R.ghost.u() < p.ghostRatePerMin / 60 * dtF) ghost = newGhost(t, ego, false);
      if (ghost) {
        if (p.ghostStatic) ghost.vrel = -ego.v;
        ghost.gap += ghost.vrel * dtF;
        if ((ghost.forced ? !f.ghost : t >= ghost.until) || ghost.gap < 1) ghost = null;
      }

      var m;
      var outlier = false;
      if (ghost) {
        m = { valid: true, id: ghost.oid, gap: ghost.gap, vrel: ghost.vrel, lat: 0, kind: 'car', qual: 'ok' };
        truth.vehId = null; truth.ghost = true;
      } else if (targetVid === null) {
        m = noTargetMeas('none');
        truth.vehId = null;
      } else {
        var tr = tracks[targetVid];
        var d = tr.g;
        var sd = (p.gapSd0_m + p.gapSd100_m * Math.pow(d / 100, p.gapSdExp)) * W.sd;
        var gap = d * (1 + p.gapBiasRel) + sd * tr.z;
        var sdv = (p.vrelSd0_mps + p.vrelSd100_mps * Math.pow(d / 100, p.vrelSdExp)) * W.sd;
        var vr = tr.vl + sdv * R.noise.n();
        var id = tr.oid;
        var lat = tr.app;
        if (blend) {
          var fr = tracks[blend.fromVid];
          var w = Math.min(1, (t - blend.t0) / p.blend_s);
          gap = (1 - w) * (fr.g * (1 + p.gapBiasRel) + sd * fr.z) + w * gap;
          vr = (1 - w) * fr.vl + w * vr;
          lat = (1 - w) * fr.app + w * lat;
          if (p.idTiming === 'end' && w < 1) id = blend.fromOid;
        }
        if (p.outlierProb > 0 && R.out.u() < p.outlierProb) {
          gap *= 1 + (2 * R.out.u() - 1) * p.outlierRel;
          outlier = true;
        }
        m = { valid: true, id: id, gap: Math.max(0, quant(gap, p.gapQuant_m)), vrel: p.vrelMode === 'none' ? null : quant(vr, p.vrelQuant_mps),
          lat: lat, kind: tr.o.kind || 'car', qual: 'ok' };
        truth.vehId = targetVid;
        truth.wrong = lead === null || String(lead.id) !== String(targetVid);
        truth.blend = !!blend;
      }
      truth.outlier = outlier;
      m.seq = frame;
      m.tMeas = p.useTimestamp ? t : null;
      m._truth = truth;

      // transport: single drops and bursts (decided after the measurement so the noise streams stay aligned)
      var dropP = Math.min(1, p.dropProb + W.drop);
      var burstP = Math.min(1, p.burstProb * W.burst);
      var dropped = false;
      if (t < burstUntil || f.dropBurst) dropped = true;
      else if (burstP > 0 && R.drop.u() < burstP) {
        burstUntil = t - Math.log(1 - R.drop.u() + 1e-12) * p.burstMean_s;
        dropped = true;
      } else if (dropP > 0 && R.drop.u() < dropP) dropped = true;
      lastCap = m;
      return dropped ? null : m;
    }

    function newGhost(t, ego, forced) {
      var g = 15 + 35 * R.ghost.u();
      return { oid: nextOid++, gap: g, vrel: p.ghostStatic ? -ego.v : 3 * R.ghost.n(), until: t + p.ghostDur_s, forced: forced };
    }

    function sample(world, t) {
      if (nextT === null) nextT = t;
      var f = world.faults || {};
      while (nextT <= t + 1e-9) {
        var m = capture(world, t);
        if (m) {
          var late = p.latency_s + Math.abs(R.lat.n()) * p.jitter_s + (f.latencyExtra > 0 ? f.latencyExtra : 0);
          var c = {};
          for (var k in m) if (has(m, k)) c[k] = m[k];
          c.t = Math.max(lastDeliver, t + late);
          lastDeliver = c.t;
          queue.push(c);
        }
        nextT += dtF;
      }
      var out = null;
      while (queue.length && queue[0].t <= t + 1e-9) out = queue.shift();
      return out;
    }

    return {
      params: p,
      sample: sample,
      state: function () {
        return { targetVid: targetVid, targetOid: targetVid !== null && tracks[targetVid] ? tracks[targetVid].oid : null,
          ghost: ghost ? { oid: ghost.oid, gap: ghost.gap } : null, burst: burstUntil, pending: queue.length, frame: frame };
      }
    };
  }

  var X = {
    NAME: 'sensor',
    SCHEMA: SCHEMA,
    PRESETS: PRESETS,
    WEATHER: WEATHER,
    defaults: function () { return fill(null); },
    fill: fill,
    create: create,
    geom: { laneWidth: laneWidth, curvatureAt: curvatureAt, yRel: yRel, gapTo: gapTo, trueLead: trueLead },
    _stream: stream
  };
  if (typeof module !== 'undefined') module.exports = X; else (self.CS = self.CS || {})['sensor'] = X;
})();
