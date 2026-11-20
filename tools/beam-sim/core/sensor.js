'use strict';
// The sensor model of the beam simulator: a front camera that sees the world's lights and hands them over as the
// contract's input frames (docs/highbeam/CONTRACT.md §2), in RAW units encoded with configurable scales (by default the
// algorithm's own assumed scales, so a run is self-consistent; set `scale` to try a wrong guess).
//
//   sen = create(world, params, rng, logicDefaults)
//   sen.advance(t, beamHigh)            camera frames up to t: measured, delayed, dropped, delivered to the "adapter"
//   sen.frame(t, { lampsHigh, stalk, rearm }) -> the input frame of the app's tick at t
//   sen.lastDetections                  the last camera frame's detections (for the page's top view), physical units
//
// Inside: field of view, detection range by source (brightness, class) x weather x a dirty windscreen, lines of sight
// (crests, curves, trucks), per-frame misses (more near the range limit), false objects, wet-road reflections,
// reflectors (signs, vests) seen only when our beam lights them and sometimes taken for headlamps, track ids 0..14 with
// switches, a new track's "weak" status for its first frames, the 15-object cap with a priority rule, latency, jitter,
// dropouts, and the faults of the scenario (blind, dirty, stale, silent, verdictSilent, freeze).
(function () {
  const PARAMS = [
    // key, default, unit, min, max, help
    ['fps', 15, 'Hz', 1, 60, 'camera light-object rate'],
    ['latency_ms', 80, 'ms', 0, 1000, 'from measurement to the app'],
    ['jitter_ms', 20, 'ms', 0, 500, 'uniform extra delay'],
    ['fov_deg', 50, 'deg', 10, 120, 'horizontal field of view'],
    ['drop', 0.01, '', 0, 0.9, 'probability a camera frame is lost'],
    ['miss', 0.03, '', 0, 0.9, 'per-frame miss probability of a visible light (grows near the range limit)'],
    ['falseRate', 0.1, '/s', 0, 10, 'false light objects per second (one frame each)'],
    ['idSwitch', 0.002, '', 0, 0.2, 'per object and frame: the track gets a new id'],
    ['noiseAz_deg', 0.15, 'deg', 0, 5, 'azimuth noise'],
    ['noiseDist', 0.06, '', 0, 0.5, 'relative distance noise'],
    ['reflMisclass', 0.08, '', 0, 1, 'a reflector track taken for headlamps'],
    ['houseAsOther', 0.5, '', 0, 1, 'a house light taken for an unclassified light (else a street light)'],
    ['wetGhost', 0.25, '', 0, 1, 'on a wet road: a headlamp\'s reflection reported as a second light'],
    ['weakFrames', 3, 'frames', 0, 30, 'a new track reports the weak status this many frames'],
    ['rangeScale', 1, '', 0.1, 3, 'all detection ranges times this'],
    ['verdict', 'silent', '', null, null, 'the camera\'s own verdict: silent (this car, likely) or present'],
    ['verdictHz', 5, 'Hz', 1, 50, 'verdict rate when present'],
    ['objects', true, '', null, null, 'the general object list (vehicles within its short night range) and its qualifier'],
    ['objRange_m', 120, 'm', 10, 300, 'the object list\'s range at night'],
    ['highReach_m', 400, 'm', 50, 1000, 'our high beam\'s reach (glare, reflector lighting)'],
    ['lowReach_m', 70, 'm', 10, 200, 'our low beam\'s reach'],
    ['highHalf_deg', 12, 'deg', 2, 40, 'our high beam\'s half spread'],
    ['aheadReach_m', 200, 'm', 20, 1000, 'a vehicle ahead counts as glared (in its mirrors) within this'],
  ];
  const DEF = {};
  PARAMS.forEach(function (p) { DEF[p[0]] = p[1]; });
  const WEATHER = { clear: 1, rain: 0.75, heavy: 0.5, fog: 0.3, snow: 0.5 };
  const PRIORITY = { head: 0, tail: 1, bike: 2, other: 3, reflector: 4, street: 5 };
  const OBJ_CODE = { car: 1, truck: 2, moto: 3, bike: 4, ped: 5, parked: 1 };

  function create(world, params, rng, logicDefaults) {
    const P = Object.assign({}, DEF, params || {});
    const LD = logicDefaults || {};
    const sc = P.scale || LD.scale;
    // kind -> raw class: the inverse of the algorithm's (assumed) class table
    const clsOf = {};
    const classes = P.classes || LD.classes || {};
    Object.keys(classes).forEach(function (raw) { if (clsOf[classes[raw]] === undefined) clsOf[classes[raw]] = Number(raw); });
    const R = { det: rng.fork('detect'), noise: rng.fork('noise'), net: rng.fork('net'), ghost: rng.fork('ghost'), cls: rng.fork('class') };
    const period = 1000 / P.fps;
    const faults = Array.isArray(world.spec.faults) ? world.spec.faults : [];
    const faultAt = function (kind, t) {
      for (let i = 0; i < faults.length; i++) {
        const f = faults[i];
        if (f.kind === kind && t >= (f.t0_s ? f.t0_s * 1000 : -Infinity) && (f.t1_s === undefined || f.t1_s === null || t < f.t1_s * 1000)) return f;
      }
      return null;
    };
    const tracks = {};          // key -> { id, n, last, az, cls }
    let frameNo = 0;
    let nextCam = -3 * period, nextVerdict = -1000 / P.verdictHz;    // the camera runs before the app's first tick
    const queue = [];           // { at, kind: 'lights'|'verdict'|'objects', v, qual }
    const adapter = { lights: null, lightsT: null, verdict: null, verdictT: null, objects: null, objectsT: null, objQual: null };
    let lastList = null;
    let lastS = null;
    let ghostN = 0;
    const api = { lastDetections: [], params: P };

    function freeId() {
      const used = {};
      Object.keys(tracks).forEach(function (k) { used[tracks[k].id] = true; });
      for (let i = 0; i < 15; i++) if (!used[i]) return i;
      return -1;
    }
    function enc(v, center, gain, lo, hi) {
      const r = Math.round(v / gain + center);
      return Math.max(lo, Math.min(hi, r));
    }

    function camera(tc, beamHigh) {
      frameNo++;
      const ego = world.ego(tc / 1000);
      const env = world.env(tc / 1000, ego.s);
      const blind = faultAt('blind', tc);
      const dirty = faultAt('dirty', tc);
      const fac = (WEATHER[env.weather] || 1) * (dirty ? 0.4 : 1) * P.rangeScale;
      const camPt = { s: ego.s, d: ego.d, hgt: world.CAM_H };
      const dets = [];
      if (!blind) {
        world.sources(tc / 1000).forEach(function (src) {
          if (src.s <= ego.s + 2) return;
          const lk = world.look(ego, src);
          if (Math.abs(lk.az) > P.fov_deg / 2) return;
          let range = src.range;
          if (src.illum) {
            const reach = beamHigh ? P.highReach_m * 0.6 : P.lowReach_m;
            range = Math.abs(lk.az) <= (beamHigh ? P.highHalf_deg : 25) ? reach : 0;
          }
          range *= fac;
          if (!(range > 0) || lk.dist > range) return;
          if (!world.sight(camPt, src, tc / 1000, src.uid)) return;
          const p = P.miss + 0.5 * Math.pow(lk.dist / range, 4);
          if (R.det.chance(Math.min(0.95, p))) return;
          let tr = tracks[src.key];
          if (!tr) {
            // a new track (its id is given after the 15-object cap); the classifier's sticky choice for it
            let k2 = src.kind;
            if (k2 === 'reflector' && R.cls.chance(P.reflMisclass)) k2 = 'head';
            if (k2 === 'house') k2 = R.cls.chance(P.houseAsOther) ? 'other' : 'street';
            if (k2 === 'station') k2 = 'street';
            tr = tracks[src.key] = { id: -1, n: 0, last: frameNo, az: lk.az, cls: k2 };
          }
          if (tr.id >= 0 && R.det.chance(P.idSwitch)) { tr.id = -1; tr.n = 0; }
          const kind = tr.cls;
          const az = lk.az + R.noise.normal(0, P.noiseAz_deg);
          const dist = Math.max(1, lk.dist * (1 + R.noise.normal(0, P.noiseDist)));
          const angW = Math.atan2(src.width || 1, lk.dist) * 180 / Math.PI;
          const rate = (lk.az - tr.az) / (period / 1000);
          tr.az = lk.az; tr.n++; tr.last = frameNo;
          dets.push({ key: src.key, uid: src.uid, kind: kind, truth: src.kind, az: az, el: lk.el, dist: dist, w: angW, rate: rate, tr: tr });
          if (kind === 'head' && env.wet && R.ghost.chance(P.wetGhost)) {
            dets.push({ key: src.key + ':wet', uid: null, kind: 'other', truth: 'wet', az: az, el: lk.el - 1.5, dist: dist, w: angW, rate: rate, tr: null, n: 1 });
          }
        });
        // false objects (one frame each)
        const nGhost = R.ghost.chance(P.falseRate * period / 1000) ? 1 : 0;
        for (let i = 0; i < nGhost; i++) {
          dets.push({ key: 'ghost' + (ghostN++), uid: null, kind: 'other', truth: 'ghost', az: R.ghost.normal(0, 8), el: R.ghost.normal(0, 1.5),
            dist: 30 + R.ghost.next() * 300, w: 0.1, rate: 0, tr: null, n: 1 });
        }
      }
      dets.sort(function (a, b) { return (PRIORITY[a.kind] - PRIORITY[b.kind]) || (a.dist - b.dist); });
      const top = dets.slice(0, 15);
      // the cap: a track that did not make the 15 is dropped (it restarts weak when it comes back); tracks unseen for
      // 4 frames are forgotten; then the new tracks of this frame take free ids
      const inTop = {};
      top.forEach(function (d) { inTop[d.key] = true; });
      dets.slice(15).forEach(function (d) { if (d.tr) delete tracks[d.key]; });
      Object.keys(tracks).forEach(function (k) { if (frameNo - tracks[k].last > 4) delete tracks[k]; });
      top.forEach(function (d) { if (d.tr && d.tr.id < 0) { d.tr.id = freeId(); if (d.tr.id < 0) { delete tracks[d.key]; d.tr = null; } } });
      api.lastDetections = top.map(function (d) { return { kind: d.kind, truth: d.truth, az: d.az, el: d.el, dist: d.dist, uid: d.uid }; });
      // raw encoding (each object its own id; ghosts take a free id for one frame)
      const usedIds = {};
      top.forEach(function (d) { if (d.tr) usedIds[d.tr.id] = true; });
      let list = top.map(function (d) {
        let id = d.tr ? d.tr.id : -1;
        if (id < 0) { for (let i = 0; i < 15; i++) if (!usedIds[i]) { id = i; usedIds[i] = true; break; } }
        const n = d.tr ? d.tr.n : 1;
        const code = clsOf[d.kind] !== undefined ? clsOf[d.kind] : (clsOf.other !== undefined ? clsOf.other : 0);
        const rawDist = Math.max(0, Math.min(126, Math.round((d.dist - sc.dist.offset) / sc.dist.gain)));
        return {
          id: id < 0 ? 14 : id, cls: code, status: n <= P.weakFrames ? 1 : 2,
          x: enc(d.az, sc.x.center, sc.x.gain, 0, 254), y: enc(d.el, sc.y.center, sc.y.gain, 0, 254),
          w: Math.max(0, Math.min(254, Math.round(d.w / sc.w.gain))), h: Math.max(0, Math.min(62, Math.round(d.w * 0.4 / sc.h.gain))),
          dist: rawDist, wl: enc(d.rate, sc.ang.center, sc.ang.gain, 0, 254), wr: enc(d.rate, sc.ang.center, sc.ang.gain, 0, 254),
        };
      });
      if (faultAt('freeze', tc) && lastList) list = lastList;
      lastList = list;
      const lost = R.net.chance(P.drop) || faultAt('stale', tc) || faultAt('silent', tc);
      const delay = P.latency_ms + R.net.next() * P.jitter_ms;
      if (!lost) queue.push({ at: tc + delay, kind: 'lights', v: list });
      // the general object list (vehicles only) and its qualifier
      if (P.objects) {
        const objs = [];
        if (!blind) {
          world.users(tc / 1000).forEach(function (u) {
            if (u.s <= ego.s + 2) return;
            const lk = world.look(ego, { s: u.s, d: u.d, hgt: 0.8 });
            if (Math.abs(lk.az) > P.fov_deg / 2 || lk.dist > P.objRange_m * fac) return;
            if (!world.sight(camPt, { s: u.s, d: u.d, hgt: 0.8 }, tc / 1000, u.id)) return;
            const vx = (u.dir * u.v_kmh - ego.v_kmh) / 3.6;
            const a = -lk.az * Math.PI / 180;
            // HR §3.2: the lists' movement status and the per-object lamp states
            const lit = u.lamps !== 'off';
            const faceUs = u.dir < 0 || (u.dir === 0 && u.faces > 0);
            objs.push({ id: objs.length, cls: OBJ_CODE[u.kind] || 1, x: Math.round(lk.horiz * Math.cos(a) * 10) / 10, y: Math.round(lk.horiz * Math.sin(a) * 10) / 10, vx: Math.round(vx * 10) / 10, lane: 0,
              move: u.dir < 0 ? 'oncoming' : u.dir > 0 ? 'same' : 'stationary', head: u.kind === 'ped' ? null : lit && faceUs ? 'on' : 'off', rear: u.kind === 'ped' ? null : lit && !faceUs ? 'on' : 'off' });
          });
        }
        const qual = blind && blind.reported !== false ? 2 : dirty && dirty.reported !== false ? 1 : 0;
        if (!lost || faultAt('silent', tc)) queue.push({ at: tc + delay, kind: 'objects', v: objs.slice(0, 8), qual: qual });
      }
    }

    function verdict(tv, beamHigh) {
      if (P.verdict !== 'present' || faultAt('verdictSilent', tv)) return;
      const blind = faultAt('blind', tv);
      let deny = false, veh = 0;
      api.lastDetections.forEach(function (d) {
        if (d.kind === 'head' && d.dist < 400 && Math.abs(d.az) < 15) { deny = true; veh++; }
        if (d.kind === 'tail' && d.dist < 150 && Math.abs(d.az) < 15) { deny = true; veh++; }
      });
      if (api.lastDetections.filter(function (d) { return d.kind === 'street'; }).length >= 3) deny = true;
      queue.push({ at: tv + P.latency_ms, kind: 'verdict', v: { allow: deny ? 0 : 1, reason: deny ? 1 : 0, vehicles: Math.min(14, veh), signs: 0, pedestrians: 0,
        calibration: 0, qualifier: blind && blind.reported !== false ? 2 : 0, qualifierExt: 0 } });
    }

    api.advance = function (t, beamHigh) {
      while (nextCam <= t) { camera(nextCam, beamHigh); nextCam += period; }
      while (nextVerdict <= t) { verdict(nextVerdict, beamHigh); nextVerdict += 1000 / P.verdictHz; }
      queue.sort(function (a, b) { return a.at - b.at; });
      while (queue.length && queue[0].at <= t) {
        const m = queue.shift();
        if (m.kind === 'lights') { adapter.lights = m.v; adapter.lightsT = m.at; }
        else if (m.kind === 'verdict') { adapter.verdict = m.v; adapter.verdictT = m.at; }
        else if (m.kind === 'objects') { adapter.objects = m.v; adapter.objectsT = m.at; adapter.objQual = m.qual; }
      }
    };

    api.frame = function (t, io) {
      const ego = world.ego(t / 1000);
      const env = world.env(t / 1000, ego.s);
      const f = { t: Math.round(t) };
      if (adapter.lights) f.lights = { v: adapter.lights, age: Math.round(t - adapter.lightsT), ok: true };
      if (adapter.verdict) f.verdict = { v: adapter.verdict, age: Math.round(t - adapter.verdictT), ok: true };
      if (adapter.objects) f.objects = { v: adapter.objects, age: Math.round(t - adapter.objectsT), ok: true, qual: adapter.objQual };
      f.car = { v: { speed_kmh: Math.round(ego.v_kmh * 10) / 10, yaw_dps: Math.round(ego.yaw_dps * 100) / 100, steer_deg: null, gear: 'D' }, age: 10, ok: true };
      f.lamps = { v: { low: env.lowBeam, high: io && typeof io.lampsHigh === 'boolean' ? io.lampsHigh : null, fog: env.fog, switch: 'auto' }, age: 50, ok: true };
      f.env = { v: { brightness: Math.round(env.lux * 10) / 10, sun: env.sun === 'day' || env.sun === 'night' ? env.sun : null, wiper: env.wiper,
        limit_kmh: env.limit_kmh, urban: null, camWeather: env.camWeather, sight_m: env.sight_m }, age: 100, ok: true };
      // the camera's town signs as the ego passes them (a sign with signIn / signOut false is missed)
      const ev = [];
      if (lastS !== null) {
        env.towns.forEach(function (tw) {
          if (tw.signIn !== false && lastS < tw.s0_m && ego.s >= tw.s0_m) ev.push({ t: Math.round(t), kind: 'town_in' });
          if (tw.signOut !== false && lastS < tw.s1_m && ego.s >= tw.s1_m) ev.push({ t: Math.round(t), kind: 'town_out' });
        });
      }
      lastS = ego.s;
      f.signs = { v: ev, age: 0, ok: true };
      f.stalk = { v: io && io.stalk ? io.stalk : [], age: 0, ok: true };
      if (io && io.rearm) f.app = { v: { rearm: true } };
      return f;
    };
    return api;
  }
  const X = { create: create, PARAMS: PARAMS, DEFAULTS: DEF, WEATHER: WEATHER };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).sensor = X;
})();
