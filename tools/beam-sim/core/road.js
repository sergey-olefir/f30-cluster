'use strict';
// The road of the beam simulator: a centreline built from segments (straight, or a curve of radius r, + left), an
// elevation profile (crests and dips), the carriageways, and the lines of sight they allow.
//
//   road = create(spec)
//   road.pose(s, d)            -> { x, y, z, h }   the point at station s (m along the centreline), offset d (m, + left);
//                                                  h = the centreline's heading there (rad)
//   road.z(s)                  elevation (m)
//   road.curvature(s)          1/m, + left
//   road.sight(a, b)           true when the straight line between two points { s, d, hgt } is not blocked by the ground
//                              (crest) or by the curve's inside (beyond the clear corridor `sight_m`) or a glare screen
//   road.halfWidth             m, the centreline to the outer edge
(function () {
  const STEP = 1;                                   // m between the centreline's points

  function create(spec) {
    const sp = spec || {};
    const lanes = sp.lanes || 2;
    const laneWidth = sp.laneWidth_m || 3.5;
    const median = sp.median_m || 0;
    const halfWidth = lanes * laneWidth / 2 + median / 2;
    const sightW = typeof sp.sight_m === 'number' ? sp.sight_m : 8;
    const segs = Array.isArray(sp.segments) && sp.segments.length ? sp.segments : [{ len_m: 5000, curve_r: 0 }];
    // the centreline at STEP m
    const X = [0], Y = [0], H = [0], K = [];
    let x = 0, y = 0, h = 0;
    segs.forEach(function (g) {
      const len = Math.max(1, g.len_m || 0);
      const k = g.curve_r ? 1 / g.curve_r : 0;
      const n = Math.round(len / STEP);
      for (let i = 0; i < n; i++) {
        K.push(k);
        const hm = h + k * STEP / 2;
        x += Math.cos(hm) * STEP; y += Math.sin(hm) * STEP; h += k * STEP;
        X.push(x); Y.push(y); H.push(h);
      }
    });
    K.push(0);
    const length = (X.length - 1) * STEP;
    const prof = Array.isArray(sp.profile) && sp.profile.length ? sp.profile.slice().sort(function (a, b) { return a[0] - b[0]; }) : [[0, 0]];

    function z(s) {
      if (s <= prof[0][0]) return prof[0][1];
      for (let i = 1; i < prof.length; i++) {
        if (s <= prof[i][0]) {
          const a = prof[i - 1], b = prof[i];
          const f = (s - a[0]) / Math.max(1e-9, b[0] - a[0]);
          // a smooth step between the points (crests look round, not kinked)
          const g = f * f * (3 - 2 * f);
          return a[1] + (b[1] - a[1]) * g;
        }
      }
      return prof[prof.length - 1][1];
    }
    function centre(s) {
      if (s <= 0) return { x: X[0] + Math.cos(H[0]) * s, y: Y[0] + Math.sin(H[0]) * s, h: H[0] };
      if (s >= length) { const i = X.length - 1; const e = s - length; return { x: X[i] + Math.cos(H[i]) * e, y: Y[i] + Math.sin(H[i]) * e, h: H[i] }; }
      const i = Math.floor(s / STEP), f = s / STEP - i;
      return { x: X[i] + (X[i + 1] - X[i]) * f, y: Y[i] + (Y[i + 1] - Y[i]) * f, h: H[i] + (H[i + 1] - H[i]) * f };
    }
    function pose(s, d) {
      const c = centre(s);
      return { x: c.x - Math.sin(c.h) * d, y: c.y + Math.cos(c.h) * d, z: z(s), h: c.h };
    }
    function curvature(s) {
      if (s < 0 || s >= length) return 0;
      return K[Math.min(K.length - 1, Math.floor(s / STEP))];
    }
    /** a, b: { s, d, hgt } (hgt = height above the road). */
    function sight(a, b) {
      if (sp.screen && median > 0 && a.d * b.d < 0 && Math.abs(a.d) > median / 2 - 0.01 && Math.abs(b.d) > median / 2 - 0.01) return false;
      const pa = pose(a.s, a.d), pb = pose(b.s, b.d);
      const za = pa.z + a.hgt, zb = pb.z + b.hgt;
      const ds = b.s - a.s;
      const n = Math.min(40, Math.max(6, Math.ceil(Math.abs(ds) / 15)));
      const cx = pb.x - pa.x, cy = pb.y - pa.y;
      const clen = Math.sqrt(cx * cx + cy * cy) || 1e-9;
      for (let i = 1; i < n; i++) {
        const f = i / n;
        const s = a.s + ds * f;
        // the ground (a crest) between the two
        const lineZ = za + (zb - za) * f;
        if (z(s) + 0.05 > lineZ) return false;
        // the curve's inside: the centreline point's distance from the chord
        const c = centre(s);
        const px = c.x - pa.x, py = c.y - pa.y;
        const off = Math.abs(px * cy - py * cx) / clen;
        if (off > halfWidth + sightW) return false;
      }
      return true;
    }
    return { pose: pose, z: z, curvature: curvature, sight: sight, length: length, halfWidth: halfWidth, lanes: lanes,
      laneWidth: laneWidth, median: median, spec: sp };
  }
  const X = { create: create };
  if (typeof module !== 'undefined') module.exports = X; else (self.BS = self.BS || {}).road = X;
})();
