(function () {
'use strict';
// (wrapped in a function: the page loads core/*.js as classic scripts, which share one global scope)
// The other vehicles (SC1): scripted profiles, the Intelligent Driver Model, replayed traces, lane changes.
//
//   vehicles.create(specs, events, ctx) -> { list /* = world.others */, step(world, dt), byId(id) }
//     ctx = { road, rng, emit(kind, detail), ego, dt }
//   helpers: gap(behind, ahead), trueLead(world), follower(world), leaderOf(world, veh), loadTrace(src), parseTrace(text|obj)
//
// Geometry: every x (ego's and the others') is the FRONT bumper, m along the road; gap(behind, ahead) =
// ahead.x - ahead.length - behind.x (bumper to bumper). A scenario's x0 is that gap at t = 0: x0 > 0 puts the car's rear
// x0 m ahead of ego's front, x0 < 0 puts its front |x0| m behind ego's rear (a follower). Alongside (partly overlapping
// ego) is out of x0's reach: xFront_m (front bumper relative to ego's front bumper, + = ahead) overrides x0 for that.
// y = lane * laneWidth + lat.
//
// Profiles (vehicle.profile.type):
//   const      { } constant v0_kmh (the default; 'static' kind -> v = 0)
//   piecewise  { points: [[t, v_kmh], ...] } speed linear in time (held before the first and after the last point)
//   accel      { points: [[t, a_ms2], ...], vMin_kmh?, vMax_kmh? } acceleration held from each t to the next; v >= 0
//   steps      { steps: [[t, v_kmh, rate_ms2?], ...], accel_ms2: 1.5, decel_ms2: 3 } at t, head for v_kmh at the rate
//              (the 3rd element, or accel / decel); ramps, stops, stop-and-go
//   sine       { mean_kmh?, amp_kmh, period_s, t0: 0, phase_deg: 0 } v = mean + amp sin(2 pi (t - t0) / period + phase)
//   stopgo     { vHigh_kmh, vLow_kmh: 0, accel_ms2: 1.2, decel_ms2: 2, holdHigh_s: 10, holdLow_s: 5, t0: 0 }
//   idm        { params: { v0_kmh, T_s, s0_m, a_ms2, b_ms2, delta, noise_ms2, noiseTau_s, reaction_s, bMax_ms2, v0Points } }
//   replay     { file | data | points, t0: 0 } a recorded speed trace, linear in time (see parseTrace for the formats)
// Lane changes are scenario events { t?, kind: 'cutIn'|'cutOut'|'laneChange', vehicle: id, toLane?, duration_s: 3,
//   gap_m? (place the car this gap ahead of ego when the change starts), v_kmh? | dv_kmh? (set its speed then, for
//   const / steps / accel / idm), whenGap_m? (start only once its gap to ego is at most this) }.
//   cutIn defaults toLane to ego's lane, cutOut to the neighbouring lane. y moves on a cosine over duration_s; the lane
//   number switches at the midpoint.

const KMH = 1 / 3.6;
const EGO_DEFAULT = { length: 4.7, width: 1.85 };
const KIND = {
  car: { length: 4.6, width: 1.8 },
  truck: { length: 16.5, width: 2.55 },
  moto: { length: 2.2, width: 0.8 },
  static: { length: 4.6, width: 1.8 },
};
const IDM_DEFAULTS = { T_s: 1.5, s0_m: 2, a_ms2: 1.4, b_ms2: 2.0, delta: 4, noise_ms2: 0.15, noiseTau_s: 2, reaction_s: 0.6, bMax_ms2: 8 };

function gap(behind, ahead) { return ahead.x - ahead.length - behind.x; }

function trueLead(world) {
  const e = world.ego;
  let best = null, bg = Infinity;
  for (const o of world.others) {
    if (o.lane !== e.lane || o.x <= e.x) continue;
    const g = gap(e, o);
    if (g < bg) { bg = g; best = o; }
  }
  return best;
}

function follower(world) {
  const e = world.ego;
  let best = null, bx = -Infinity;
  for (const o of world.others) {
    if (o.lane !== e.lane || o.x >= e.x) continue;
    if (o.x > bx) { bx = o.x; best = o; }
  }
  return best;
}

function leaderOf(world, veh) {
  let best = null, bg = Infinity;
  const all = world.others.concat([world.ego]);
  for (const o of all) {
    if (o === veh || o.lane !== veh.lane || o.x <= veh.x) continue;
    const g = gap(veh, o);
    if (g < bg) { bg = g; best = o; }
  }
  return best;
}

// --- traces -------------------------------------------------------------------------------------------------------
// Accepted: { t: [...], v: [...] } (m/s) | { t: [...], v_kmh: [...] } | { points: [[t, v_kmh], ...] } | [[t, v_kmh], ...]
// or CSV text with a header naming t and v (m/s) or v_kmh; ',', ';' or tab; lines starting with '#' are comments.
// Returns { t: [...], v: [...] } in s and m/s, t increasing.
function parseTrace(src) {
  let t = [], v = [];
  if (typeof src === 'string') {
    const lines = src.split(/\r?\n/).map(s => s.trim()).filter(s => s && s[0] !== '#');
    if (!lines.length) throw new Error('trace: empty');
    const sep = lines[0].indexOf(';') >= 0 ? ';' : (lines[0].indexOf('\t') >= 0 ? '\t' : ',');
    const head = lines[0].split(sep).map(s => s.trim().toLowerCase());
    const it = head.indexOf('t') >= 0 ? head.indexOf('t') : head.indexOf('t_s');
    let iv = head.indexOf('v_kmh'), scale = KMH;
    if (iv < 0) { iv = head.indexOf('v'); scale = 1; }
    if (iv < 0) { iv = head.indexOf('v_ms'); scale = 1; }
    if (it < 0 || iv < 0) throw new Error('trace CSV: the header needs t and v (m/s) or v_kmh, got ' + lines[0]);
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(sep);
      const tt = parseFloat(c[it]), vv = parseFloat(c[iv]);
      if (isFinite(tt) && isFinite(vv)) { t.push(tt); v.push(vv * scale); }
    }
  } else if (Array.isArray(src)) {
    for (const p of src) { t.push(p[0]); v.push(p[1] * KMH); }
  } else if (src && Array.isArray(src.points)) {
    for (const p of src.points) { t.push(p[0]); v.push(p[1] * KMH); }
  } else if (src && Array.isArray(src.t) && (Array.isArray(src.v) || Array.isArray(src.v_kmh))) {
    t = src.t.slice();
    v = src.v ? src.v.slice() : src.v_kmh.map(x => x * KMH);
  } else throw new Error('trace: unknown format');
  if (t.length < 1 || t.length !== v.length) throw new Error('trace: no samples');
  for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) throw new Error('trace: t must increase (at sample ' + i + ')');
  for (const x of v) if (!(x >= 0)) throw new Error('trace: negative or bad speed');
  return { t, v };
}

function loadTrace(src) {
  if (src && typeof src === 'object') return parseTrace(src);
  if (typeof require === 'undefined') throw new Error('trace file ' + src + ': files load only under Node; pass profile.data in the browser');
  const fs = require('fs'), path = require('path');
  const p = path.isAbsolute(src) ? src : path.join(__dirname, '..', src);
  const text = fs.readFileSync(p, 'utf8');
  return parseTrace(/\.json$/i.test(p) ? JSON.parse(text) : text);
}

function interp(ts, vs, t) {
  if (t <= ts[0]) return vs[0];
  const n = ts.length;
  if (t >= ts[n - 1]) return vs[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; }
  return vs[lo] + (vs[hi] - vs[lo]) * (t - ts[lo]) / (ts[hi] - ts[lo]);
}

// --- profiles -----------------------------------------------------------------------------------------------------
// A profile is { kind: 'kin', speed(t) } (the speed is a function of time) or { kind: 'dyn', accel(veh, world, t, dt) }.

function makeProfile(spec, veh, ctx) {
  const p = spec.profile || { type: veh.kind === 'static' ? 'static' : 'const' };
  const v0 = veh.v;
  switch (p.type) {
    case 'static':
      return { type: 'static', kind: 'kin', speed: () => 0 };
    case 'const':
      return { type: 'const', kind: 'dyn', accel: (vh, w, t, dt) => (vh.vTarget === undefined ? 0 : approach(vh.v, vh.vTarget, 3, 3, dt)) };
    case 'piecewise': {
      const pts = (p.points || []).slice();
      if (!pts.length) throw new Error('vehicle ' + veh.id + ': piecewise profile without points');
      if (pts[0][0] > 0) pts.unshift([0, spec.v0_kmh !== undefined ? spec.v0_kmh : pts[0][1]]);
      const ts = pts.map(q => q[0]), vs = pts.map(q => q[1] * KMH);
      return { type: 'piecewise', kind: 'kin', speed: t => Math.max(0, interp(ts, vs, t)) };
    }
    case 'sine': {
      const mean = (p.mean_kmh !== undefined ? p.mean_kmh * KMH : v0);
      const amp = (p.amp_kmh || 0) * KMH, T = p.period_s || 20, t0 = p.t0 || 0, ph = (p.phase_deg || 0) * Math.PI / 180;
      return { type: 'sine', kind: 'kin', speed: t => Math.max(0, t < t0 ? mean + amp * Math.sin(ph) : mean + amp * Math.sin(2 * Math.PI * (t - t0) / T + ph)) };
    }
    case 'replay': {
      const tr = loadTrace(p.data || p.points || p.file);
      const t0 = p.t0 || 0;
      return { type: 'replay', kind: 'kin', speed: t => interp(tr.t, tr.v, t + t0), trace: tr };
    }
    case 'accel': {
      const pts = (p.points || []).slice().sort((a, b) => a[0] - b[0]);
      const vMin = p.vMin_kmh !== undefined ? p.vMin_kmh * KMH : 0, vMax = p.vMax_kmh !== undefined ? p.vMax_kmh * KMH : Infinity;
      return {
        type: 'accel', kind: 'dyn',
        accel(vh, w, t, dt) {
          let a = 0;
          for (const q of pts) if (q[0] <= t + 1e-9) a = q[1];
          if (vh.v + a * dt < vMin) a = (vMin - vh.v) / dt;
          if (vh.v + a * dt > vMax) a = (vMax - vh.v) / dt;
          return a;
        },
      };
    }
    case 'steps':
    case 'stopgo': {
      let steps;
      const up = p.accel_ms2 || (p.type === 'stopgo' ? 1.2 : 1.5), down = p.decel_ms2 || (p.type === 'stopgo' ? 2 : 3);
      if (p.type === 'steps') steps = (p.steps || []).slice().sort((a, b) => a[0] - b[0]);
      else {
        steps = [];
        const hi = (p.vHigh_kmh !== undefined ? p.vHigh_kmh : v0 / KMH), lo = p.vLow_kmh || 0;
        const tUp = (hi - lo) * KMH / up, tDown = (hi - lo) * KMH / down;
        let t = p.t0 || 0;
        const horizon = p.until_s || 3600;
        while (t < horizon) {
          t += p.holdHigh_s === undefined ? 10 : p.holdHigh_s; steps.push([t, lo, down]);
          t += tDown + (p.holdLow_s === undefined ? 5 : p.holdLow_s); steps.push([t, hi, up]);
          t += tUp;
        }
      }
      return {
        type: p.type, kind: 'dyn',
        accel(vh, w, t, dt) {
          let cur = null;
          for (const q of steps) if (q[0] <= t + 1e-9) cur = q;
          const target = vh.vTarget !== undefined && (cur === null || vh.vTargetT > cur[0]) ? vh.vTarget : (cur ? cur[1] * KMH : v0);
          const r = cur && cur[2] ? cur[2] : null;
          return approach(vh.v, target, r || up, r || down, dt);
        },
      };
    }
    case 'idm':
      return idmProfile(p.params || {}, veh, spec, ctx);
    default:
      throw new Error('vehicle ' + veh.id + ': unknown profile type ' + JSON.stringify(p.type));
  }
}

function approach(v, target, up, down, dt) {
  const d = target - v;
  if (Math.abs(d) < 1e-12) return 0;
  if (d > 0) return Math.min(up, d / dt);
  return Math.max(-down, d / dt);
}

function idmProfile(params, veh, spec, ctx) {
  const P = Object.assign({}, IDM_DEFAULTS, params);
  const vDes0 = (P.v0_kmh !== undefined ? P.v0_kmh : (spec.v0_kmh !== undefined ? spec.v0_kmh : veh.v / KMH)) * KMH;
  const v0pts = P.v0Points ? P.v0Points.slice().sort((a, b) => a[0] - b[0]) : null;
  const r = ctx.rng.fork('idm:' + veh.id);
  const nBuf = Math.max(1, Math.round((P.reaction_s || 0) / ctx.dt) + 1);
  const buf = new Array(nBuf);   // perceived (s, dv, has leader) of past ticks
  let head = 0, filled = 0, noise = 0;
  return {
    type: 'idm', kind: 'dyn', params: P,
    accel(vh, w, t, dt) {
      let vDes = vDes0;
      if (v0pts) for (const q of v0pts) if (q[0] <= t + 1e-9) vDes = q[1] * KMH;
      if (vh.vTarget !== undefined) vDes = vh.vTarget;
      const L = leaderOf(w, vh);
      buf[head] = L ? [gap(vh, L), vh.v - L.v, L.v] : null;
      if (filled < nBuf) filled++;
      const seen = buf[filled < nBuf ? 0 : (head + 1) % nBuf];   // reaction_s ago (the first sample until then)
      head = (head + 1) % nBuf;
      const free = vDes > 0 ? 1 - Math.pow(vh.v / vDes, P.delta) : -1;
      let a;
      if (seen) {
        const s = Math.max(seen[0], 0.1);
        const dv = vh.v - (seen[2]);
        const sStar = P.s0_m + Math.max(0, vh.v * P.T_s + vh.v * dv / (2 * Math.sqrt(P.a_ms2 * P.b_ms2)));
        a = P.a_ms2 * (free - (sStar / s) * (sStar / s));
      } else a = P.a_ms2 * free;
      if (P.noise_ms2 > 0) {
        const tau = P.noiseTau_s || 2;
        noise += -noise / tau * dt + P.noise_ms2 * Math.sqrt(2 * dt / tau) * r.normal(0, 1);
        a += noise;
      }
      return Math.max(-P.bMax_ms2, Math.min(a, P.a_ms2 * 1.5));
    },
  };
}

// --- the set --------------------------------------------------------------------------------------------------------

function create(specs, events, ctx) {
  const road = ctx.road, ego = ctx.ego;
  const laneW = road.laneWidth;
  const list = [];
  const byIdMap = {};
  (specs || []).forEach((s, i) => {
    const kind = s.kind || 'car';
    const dims = KIND[kind] || KIND.car;
    const id = s.id !== undefined ? String(s.id) : 'v' + i;
    if (byIdMap[id]) throw new Error('vehicle id ' + id + ' used twice');
    const length = s.length || dims.length, width = s.width || dims.width;
    const x0 = s.x0 === undefined ? 50 : s.x0;
    const x = s.xFront_m !== undefined ? ego.x + s.xFront_m : (x0 >= 0 ? ego.x + x0 + length : ego.x - ego.length + x0);
    const lane = s.lane === undefined ? ego.lane : s.lane;
    let v = kind === 'static' ? 0 : (s.v0_kmh !== undefined ? s.v0_kmh * KMH : ego.v);
    if (s.profile && s.profile.type === 'piecewise' && s.v0_kmh === undefined && s.profile.points && s.profile.points.length) v = s.profile.points[0][1] * KMH;
    const veh = { id, kind, x, v, a: 0, lane, lat: 0, y: lane * laneW, length, width, lc: null };
    veh.profile = makeProfile(s, veh, ctx);
    if (veh.profile.kind === 'kin') veh.v = veh.profile.speed(0);
    list.push(veh);
    byIdMap[id] = veh;
  });

  const lcEvents = (events || []).filter(e => e.kind === 'cutIn' || e.kind === 'cutOut' || e.kind === 'laneChange')
    .map(e => {
      const id = String(e.vehicle !== undefined ? e.vehicle : e.id);
      if (!byIdMap[id]) throw new Error(e.kind + ' event: no vehicle ' + id);
      return Object.assign({ fired: false }, e, { vehicle: id });
    });

  function startLaneChange(e, world, t) {
    const veh = byIdMap[e.vehicle];
    let to = e.toLane !== undefined ? e.toLane : e.lane;
    if (to === undefined) {
      if (e.kind === 'cutIn') to = world.ego.lane;
      else to = veh.lane + 1 < road.lanes ? veh.lane + 1 : veh.lane - 1;
    }
    if (e.gap_m !== undefined) veh.x = world.ego.x + e.gap_m + veh.length;
    if (e.v_kmh !== undefined) { veh.vTarget = e.v_kmh * KMH; veh.vTargetT = t; veh.v = veh.vTarget; }
    else if (e.dv_kmh !== undefined) { veh.vTarget = Math.max(0, world.ego.v + e.dv_kmh * KMH); veh.vTargetT = t; veh.v = veh.vTarget; }
    const dur = e.duration_s !== undefined ? e.duration_s : 3;
    veh.lc = { t0: t, dur: Math.max(dur, 1e-6), y0: veh.y, y1: to * laneW, from: veh.lane, to, kind: e.kind };
    ctx.emit('vehicle.lane', { id: veh.id, phase: 'start', change: e.kind, from: veh.lane, to, duration: dur });
  }

  function step(world, dt) {
    const t = world.t;
    for (const e of lcEvents) {
      if (e.fired) continue;
      if (e.t !== undefined && t + 1e-9 < e.t) continue;
      if (e.whenGap_m !== undefined) {
        const g = gap(world.ego, byIdMap[e.vehicle]);
        if (!(g <= e.whenGap_m)) continue;
      }
      e.fired = true;
      startLaneChange(e, world, t);
    }
    // accelerations from the state at t for everyone, then integrate (simultaneous update)
    const acc = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const vh = list[i];
      if (vh.profile.kind === 'kin') {
        const v1 = vh.profile.speed(t + dt);
        acc[i] = (v1 - vh.v) / dt;
      } else acc[i] = vh.profile.accel(vh, world, t, dt);
    }
    for (let i = 0; i < list.length; i++) {
      const vh = list[i];
      let a = acc[i];
      let v1 = vh.v + a * dt;
      if (v1 < 0) { v1 = 0; a = -vh.v / dt; }
      if (vh.profile.kind === 'kin') v1 = vh.profile.speed(t + dt);
      vh.x += (vh.v + v1) / 2 * dt;
      vh.a = a;
      vh.v = v1;
      if (vh.lc) {
        const p = Math.min(1, (t + dt - vh.lc.t0) / vh.lc.dur);
        vh.y = vh.lc.y0 + (vh.lc.y1 - vh.lc.y0) * (1 - Math.cos(Math.PI * p)) / 2;
        vh.lane = Math.round(vh.y / laneW);
        vh.lat = vh.y - vh.lane * laneW;
        if (p >= 1) {
          vh.lane = vh.lc.to; vh.y = vh.lc.y1; vh.lat = 0;
          ctx.emit('vehicle.lane', { id: vh.id, phase: 'end', change: vh.lc.kind, lane: vh.lane }, t + dt);
          vh.lc = null;
        }
      }
    }
  }

  return { list, step, byId: id => byIdMap[String(id)] };
}

const vehicles = { NAME: 'vehicles', SCHEMA: [], KIND, EGO_DEFAULT, IDM_DEFAULTS, create, gap, trueLead, follower, leaderOf, parseTrace, loadTrace };
if (typeof module !== 'undefined') module.exports = vehicles; else (self.CS = self.CS || {})['vehicles'] = vehicles;
})();
