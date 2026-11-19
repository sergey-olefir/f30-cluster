'use strict';
// The road (SC1): grade, curvature, lanes and speed limits along the path x (m, ego's start = 0).
//
//   road.create(spec) -> { grade(x) fraction (+ uphill), curvature(x) 1/m, lanes, laneWidth, speedLimit(x) m/s|null,
//                          elevation(x) m, laneY(lane) m }
//   spec = { grade: [[x, frac], ...] | number, curvature: [[x, 1/m], ...] | number, lanes: 2, laneWidth: 3.5,
//            speedLimit: [[x, kmh|null], ...] }
// grade and curvature are piecewise linear between their points and constant beyond the ends (a crest is
// [[0,0.04],[300,-0.04]]); speedLimit is a step function (the value of the last point at or before x).
// elevation(x) is the exact integral of the piecewise-linear grade (small-angle: dz = grade dx), for the scene.

const KMH = 1 / 3.6;

function table(spec, name) {
  if (spec === undefined || spec === null) return [[0, 0]];
  if (typeof spec === 'number') return [[0, spec]];
  if (!Array.isArray(spec) || !spec.length) throw new Error('road.' + name + ': expected a number or [[x, value], ...]');
  const pts = spec.map(p => {
    if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number') throw new Error('road.' + name + ': bad point ' + JSON.stringify(p));
    return [p[0], p[1]];
  });
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[i - 1][0]) throw new Error('road.' + name + ': x must not decrease');
  return pts;
}

// index of the last point with x_i <= x (or -1), binary search
function seg(pts, x) {
  let lo = 0, hi = pts.length - 1;
  if (x < pts[0][0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= x) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function linear(pts) {
  return function (x) {
    const i = seg(pts, x);
    if (i < 0) return pts[0][1];
    if (i >= pts.length - 1) return pts[pts.length - 1][1];
    const a = pts[i], b = pts[i + 1];
    const span = b[0] - a[0];
    if (span <= 0) return b[1];
    return a[1] + (b[1] - a[1]) * (x - a[0]) / span;
  };
}

function create(spec) {
  spec = spec || {};
  const g = table(spec.grade, 'grade');
  const c = table(spec.curvature, 'curvature');
  const lim = spec.speedLimit ? table(spec.speedLimit, 'speedLimit') : null;
  const lanes = spec.lanes === undefined ? 2 : spec.lanes;
  const laneWidth = spec.laneWidth === undefined ? 3.5 : spec.laneWidth;
  const grade = linear(g);
  const curvature = linear(c);

  // elevation: cumulative integral at the knots, then the exact quadratic inside a segment
  const zk = [0];
  for (let i = 1; i < g.length; i++) zk.push(zk[i - 1] + (g[i][0] - g[i - 1][0]) * (g[i][1] + g[i - 1][1]) / 2);
  function elevation(x) {
    const i = seg(g, x);
    if (i < 0) return (x - g[0][0]) * g[0][1];
    const gx = grade(x);
    return zk[i] + (x - g[i][0]) * (g[i][1] + gx) / 2;
  }

  function speedLimit(x) {
    if (!lim) return null;
    const i = seg(lim, x);
    if (i < 0) return null;
    const v = lim[i][1];
    return (v === null || v === undefined) ? null : v * KMH;
  }

  return {
    grade, curvature, speedLimit, elevation, lanes, laneWidth,
    laneY(lane) { return lane * laneWidth; },
    spec: { grade: g, curvature: c, speedLimit: lim, lanes, laneWidth },
  };
}

const road = { NAME: 'road', SCHEMA: [], create };
if (typeof module !== 'undefined') module.exports = road; else (self.CS = self.CS || {})['road'] = road;
