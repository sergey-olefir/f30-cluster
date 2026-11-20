'use strict';
// The world of the beam simulator: our car, the other road users, the street lights and the things that fool cameras,
// the weather and the surroundings, all as functions of time (positions are integrated once at 10 ms when the world is
// made, so any module can ask "where is everything at t" without stepping).
//
//   w = create(worldSpec, { duration_s })
//   w.ego(t)        -> { s, d, v_kmh, pose: { x, y, z, h }, yaw_dps }
//   w.users(t)      -> [ { id, kind, dir, s, d, v_kmh, lamps, eye, height, width, glare } ]   (only those that exist at t)
//   w.sources(t)    -> [ { key, uid, kind, s, d, hgt, width, range, user } ]   every light a camera could see
//   w.look(ego, p)  -> { az, el, dist }   bearing of a point { s, d, hgt } from our camera (az + right, el + up; deg, m)
//   w.sight(a, b)   -> bool               ground, curve and trucks between two points { s, d, hgt }
//   w.env(t, egoS)  -> { lux, sun, wiper, fog, limit_kmh, town, weather, wet, lowBeam }
//   w.lane(dir, k)  -> d                  the lateral offset of lane k (0 = the right lane) of a direction
(function () {
  const ROAD = typeof require !== 'undefined' ? require('./road') : self.BS.road;
  const DT = 0.01;
  const CAM_H = 1.3;              // our camera's height (m)
  const LAMP_H = 0.7;             // our headlamps' height (m)

  /** A piecewise-linear profile [[t, v], ...] read at t (held outside). A number is a constant. */
  function prof(p, t, def) {
    if (typeof p === 'number' || typeof p === 'string' || typeof p === 'boolean') return p;
    if (!Array.isArray(p) || !p.length) return def;
    if (t <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (t < p[i][0]) {
        const a = p[i - 1], b = p[i];
        if (typeof a[1] !== 'number' || typeof b[1] !== 'number') return a[1];
        return a[1] + (b[1] - a[1]) * (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
      }
    }
    return p[p.length - 1][1];
  }
  /** A step profile [[x, v], ...]: the last entry at or before x. */
  function stepAt(p, x, def) {
    if (!Array.isArray(p)) return def;
    let v = def;
    for (let i = 0; i < p.length; i++) if (p[i][0] <= x) v = p[i][1];
    return v;
  }

  const KIND = {
    car: { eye: 1.2, height: 1.5, width: 1.8, head: 900, tail: 450, glare: true },
    truck: { eye: 2.5, height: 3.8, width: 2.5, head: 1000, tail: 500, glare: true, roof: true },
    moto: { eye: 1.3, height: 1.4, width: 0.3, head: 700, tail: 300, glare: true },
    bike: { eye: 1.5, height: 1.7, width: 0.2, head: 180, tail: 120, glare: true },
    ped: { eye: 1.6, height: 1.7, width: 0.5, head: 0, tail: 0, glare: false },
    parked: { eye: 1.2, height: 1.5, width: 1.8, head: 700, tail: 350, glare: false },
  };

  function create(spec, opts) {
    const W = spec || {};
    const duration = (opts && opts.duration_s) || 60;
    const road = ROAD.create(W.road || {});
    const nPer = Math.max(1, Math.ceil(road.lanes / 2));
    function lane(dir, k) {
      const kk = Math.min(nPer - 1, Math.max(0, k || 0));
      const v = road.median / 2 + road.laneWidth * (nPer - kk) - road.laneWidth / 2;
      return dir < 0 ? v : -v;
    }
    const N = Math.ceil((duration + 2) / DT) + 1;
    // integrate the stations
    function integrate(s0, dir, speed) {
      const S = new Float64Array(N);
      let s = s0;
      for (let i = 0; i < N; i++) {
        S[i] = s;
        const v = Math.max(0, prof(speed, i * DT, 0)) / 3.6;
        s += dir * v * DT;
      }
      return S;
    }
    const egoSpec = W.ego || {};
    const egoSpeed = egoSpec.speed || [[0, 80]];
    const egoS = integrate(egoSpec.s0_m || 0, 1, egoSpeed);
    const at = (S, t) => { const f = Math.max(0, t / DT); const i = Math.min(N - 2, Math.floor(f)); return S[i] + (S[i + 1] - S[i]) * (f - i); };

    const users = (Array.isArray(W.users) ? W.users : []).map(function (u, i) {
      const k = KIND[u.kind] || KIND.car;
      const dir = typeof u.dir === 'number' ? u.dir : (u.kind === 'parked' ? 0 : -1);
      // a user that appears later (t0_s) starts there at its t0; ahead_m is measured from our car at that moment
      const t0 = u.t0_s || 0;
      const s0 = typeof u.ahead_m === 'number' ? at(egoS, t0) + u.ahead_m : (u.s0_m || 0);
      const speed = dir === 0 ? [[0, 0]] : (u.speed || [[0, 80]]);
      const S = new Float64Array(N);
      let s = s0;
      for (let j = 0; j < N; j++) {
        S[j] = s;
        if (dir !== 0 && j * DT >= t0) s += dir * Math.max(0, prof(speed, j * DT, 0)) / 3.6 * DT;
      }
      return {
        id: u.id || ('u' + i), kind: u.kind || 'car', dir: dir, S: S, speed: speed, lane: u.lane || 0, lat: u.lat || null,
        d0: typeof u.d_m === 'number' ? u.d_m : null,
        t0: t0, t1: typeof u.t1_s === 'number' ? u.t1_s : null, lamps: u.lamps || 'on', faces: u.faces || 1, k: k,
      };
    });

    function egoAt(t) {
      const s = at(egoS, t);
      const d = egoSpec.lat ? prof(egoSpec.lat, t, lane(1, egoSpec.lane || 0)) : lane(1, egoSpec.lane || 0);
      const v = prof(egoSpeed, t, 0);
      const p = road.pose(s, d);
      return { s: s, d: d, v_kmh: v, pose: p, yaw_dps: v / 3.6 * road.curvature(s) * 180 / Math.PI };
    }
    function usersAt(t) {
      const out = [];
      users.forEach(function (u) {
        if (t < u.t0 || (u.t1 !== null && t > u.t1)) return;
        const s = at(u.S, t);
        let d;
        if (u.lat) d = prof(u.lat, t, 0);
        else if (u.d0 !== null) d = u.d0;
        else if (u.dir === 0) d = -(road.halfWidth + 1.2);
        else d = lane(u.dir, u.lane);
        out.push({ id: u.id, kind: u.kind, dir: u.dir, s: s, d: d, v_kmh: u.dir === 0 ? 0 : prof(u.speed, t, 0), lamps: u.lamps,
          faces: u.faces, eye: u.k.eye, height: u.k.height, width: u.k.width, glare: u.k.glare && u.dir !== 0, k: u.k });
      });
      return out;
    }
    // street lights and statics are fixed
    const fixed = [];
    (Array.isArray(W.lit) ? W.lit : []).forEach(function (L, i) {
      const sp = L.spacing_m || 35;
      for (let s = L.s0_m; s <= L.s1_m; s += sp) {
        const side = L.side || 1;
        fixed.push({ key: 'lit' + i + '_' + Math.round(s), uid: null, kind: 'street', s: s, d: side * (road.halfWidth + 1.5), hgt: L.height_m || 8, width: 0.5, range: 900 });
      }
    });
    (Array.isArray(W.statics) ? W.statics : []).forEach(function (o, i) {
      const kind = o.kind === 'sign' ? 'reflector' : o.kind === 'house' ? 'house' : o.kind === 'station' ? 'station' : 'reflector';
      const n = o.kind === 'station' ? 6 : 1;
      for (let j = 0; j < n; j++) {
        fixed.push({ key: 'st' + i + '_' + j, uid: null, kind: kind, s: o.s_m + j * 8, d: (typeof o.d_m === 'number' ? o.d_m : road.halfWidth + 2) + (j % 2) * 6,
          hgt: typeof o.height_m === 'number' ? o.height_m : (o.kind === 'sign' ? 2 : 3), width: o.kind === 'station' ? 3 : 1,
          range: o.kind === 'sign' ? 0 : 700, illum: o.kind === 'sign' });
      }
    });

    function sourcesAt(t) {
      const out = fixed.slice();
      usersAt(t).forEach(function (u) {
        if (u.kind === 'ped') {
          out.push({ key: u.id + ':vest', uid: u.id, kind: 'reflector', s: u.s, d: u.d, hgt: 1.2, width: 0.4, range: 0, illum: true, user: u });
          return;
        }
        if (u.lamps === 'off') return;
        const weak = u.lamps === 'weak' ? 0.5 : 1;
        // which of its lamps face our camera: an oncoming user (or a parked one facing us) shows its headlamps
        const showsHead = u.dir < 0 || (u.dir === 0 && u.faces > 0);
        if (u.kind === 'bike') {
          out.push({ key: u.id + ':lamp', uid: u.id, kind: 'bike', s: u.s, d: u.d, hgt: 1.0, width: 0.1, range: (showsHead ? u.k.head : u.k.tail) * weak, user: u });
          return;
        }
        out.push({ key: u.id + (showsHead ? ':head' : ':tail'), uid: u.id, kind: showsHead ? 'head' : 'tail', s: u.s, d: u.d, hgt: 0.7,
          width: u.width * 0.85, range: (showsHead ? u.k.head : u.k.tail) * weak, user: u });
        if (u.k.roof) out.push({ key: u.id + ':roof', uid: u.id, kind: showsHead ? 'head' : 'tail', s: u.s, d: u.d, hgt: 3.6, width: u.width, range: (showsHead ? u.k.head : u.k.tail) * 0.8 * weak, user: u });
      });
      return out;
    }

    function look(ego, p) {
      const q = road.pose(p.s, p.d);
      const dx = q.x - ego.pose.x, dy = q.y - ego.pose.y;
      const horiz = Math.sqrt(dx * dx + dy * dy);
      let rel = Math.atan2(dy, dx) - ego.pose.h;
      while (rel > Math.PI) rel -= 2 * Math.PI;
      while (rel < -Math.PI) rel += 2 * Math.PI;
      const dz = (q.z + (p.hgt || 0)) - (ego.pose.z + CAM_H);
      return { az: -rel * 180 / Math.PI, el: Math.atan2(dz, horiz) * 180 / Math.PI, dist: Math.sqrt(horiz * horiz + dz * dz), horiz: horiz };
    }

    /** Line of sight: the road (crest, curve, glare screen) and the trucks and cars standing between. */
    function sight(a, b, t, skipUid) {
      if (!road.sight(a, b)) return false;
      const lo = Math.min(a.s, b.s), hi = Math.max(a.s, b.s);
      const us = usersAt(t);
      for (let i = 0; i < us.length; i++) {
        const u = us[i];
        if (u.id === skipUid || u.kind === 'ped' || u.kind === 'bike') continue;
        if (u.s <= lo + 3 || u.s >= hi - 3) continue;
        const f = (u.s - a.s) / (b.s - a.s);
        const dLine = a.d + (b.d - a.d) * f;
        if (Math.abs(dLine - u.d) > u.width / 2 + 0.2) continue;
        const hLine = a.hgt + (b.hgt - a.hgt) * f;
        if (hLine < u.height) return false;
      }
      return true;
    }

    const env = W.env || {};
    const towns = Array.isArray(env.towns) ? env.towns : [];
    function weatherAt(t) { return stepAt(W.weather, t, 'clear'); }
    function envAt(t, s) {
      const weather = weatherAt(t);
      let town = false, limit = stepAt(env.limits, s, null);
      // a town: { s0_m, s1_m, limit_kmh (null = the sign recognition shows none), signIn / signOut (false = the camera
      // misses that sign), limitAfter_kmh (the limit after the exit, posted limitAfterAt_m past it; null = none posted:
      // the sign recognition keeps showing the town's limit) }
      towns.forEach(function (tw) {
        const tl = tw.limit_kmh === null ? null : (tw.limit_kmh || 50);
        if (s >= tw.s0_m && s <= tw.s1_m) { town = true; if (tl !== null) limit = tl; }
        else if (s > tw.s1_m && s < tw.s1_m + 3000) {
          const after = tw.limitAfter_kmh === undefined ? (env.openLimit_kmh || 90) : tw.limitAfter_kmh;
          if (after !== null && s >= tw.s1_m + (tw.limitAfterAt_m || 0)) limit = after;
          else if (tl !== null) limit = tl;
        }
      });
      const wiperDef = weather === 'rain' ? 1 : weather === 'heavy' ? 3 : weather === 'snow' ? 2 : 0;
      return {
        lux: prof(env.brightness_lux, t, 1),
        sun: prof(env.sun, t, 'night'),
        wiper: env.wiper !== undefined ? prof(env.wiper, t, 0) : wiperDef,
        fog: env.fog !== undefined ? !!prof(env.fog, t, false) : weather === 'fog',
        limit_kmh: limit, town: town, weather: weather, towns: towns,
        camWeather: weather === 'fog' ? 'FOG' : weather === 'snow' ? 'SNOW' : weather === 'rain' || weather === 'heavy' ? 'RAIN' : 'CLEAR',
        sight_m: weather === 'fog' ? 50 : weather === 'heavy' || weather === 'snow' ? 100 : weather === 'rain' ? 150 : 300, wet: !!env.wet || weather === 'rain' || weather === 'heavy',
        lowBeam: env.lowBeam === undefined ? true : !!prof(env.lowBeam, t, true),
      };
    }

    return {
      road: road, duration: duration, ego: egoAt, users: usersAt, sources: sourcesAt, look: look, sight: sight, env: envAt,
      lane: lane, CAM_H: CAM_H, LAMP_H: LAMP_H, weatherAt: weatherAt, spec: W,
    };
  }
  const X = { create: create, prof: prof, stepAt: stepAt, KIND: KIND };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).world = X;
})();
