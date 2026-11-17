"""Package VC: provisional bezel ellipses on the ORIGINAL references (before VR's rectification is published).

For each dial: rays from a hand start centre; along each ray the outer edge of the outermost bright, unsaturated
feature between 0.80 and 1.25 x the start radius (the white bezel ring) at half of its peak above the local black;
an ellipse (cv2.fitEllipse) through those points, trimmed twice at 2.5 x the median residual. Rays that hit the tab
bar, the hood or a text block are dropped by the trim.

Writes bake/work/twin-dial/VC/ellipses.json and a check overlay per reference (photo-derived, git-ignored).
"""
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

# hand start values: (cx, cy, r) in original photo px
START = {
    '01': {'tacho': (343, 400, 165), 'speedo': (990, 388, 168)},
    '02': {'tacho': (680, 762, 228), 'speedo': (1497, 772, 212)},
    '03': {'tacho': (385, 530, 300), 'speedo': (1535, 525, 300)},
    '04': {'tacho': (335, 290, 112), 'speedo': (736, 290, 108)},
    '05': {'tacho': (297, 218, 108), 'speedo': (688, 218, 108)},
}


# rays only within this many degrees of 12 o'clock (05's housing and open bottom confuse the lower rays)
ARC = {'05': 120, '03': 125, '01': 130}
# a ray range (deg cw from 12, lo..hi through 0) where a dial's bezel is not white (05's tacho turns red past 6)
ARC_RANGE = {('05', 'tacho'): (-125, 35)}


def edge_points(lin, cx, cy, r0, n=720, arc=180, rng=None):
    Y = C.lum(lin)
    mx, mn = lin.max(axis=2), lin.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    pts = []
    rs = np.arange(0.80 * r0, 1.25 * r0, 0.25)
    for k in range(n):
        deg = k * 360.0 / n
        if min(deg, 360 - deg) > arc:
            continue
        if rng is not None:
            sd = deg if deg <= 180 else deg - 360
            if not (rng[0] <= sd <= rng[1]):
                continue
        t = np.radians(deg)
        dx, dy = np.sin(t), -np.cos(t)
        xs, ys = cx + rs * dx, cy + rs * dy
        ok = (xs >= 0) & (xs < lin.shape[1] - 1) & (ys >= 0) & (ys < lin.shape[0] - 1)
        if ok.sum() < len(rs) * 0.9:
            continue
        prof = cv2.remap(Y.astype(np.float32), xs.astype(np.float32)[None], ys.astype(np.float32)[None],
                         cv2.INTER_LINEAR)[0]
        sp = cv2.remap(sat.astype(np.float32), xs.astype(np.float32)[None], ys.astype(np.float32)[None],
                       cv2.INTER_LINEAR)[0]
        bright = (prof > 0.25) & (sp < 0.35)
        if not bright.any():
            continue
        last = np.nonzero(bright)[0][-1]
        # peak within 6 px inwards, black = min within 12 px outwards
        lo = max(0, last - int(6 / 0.25))
        pk = prof[lo:last + 1].max()
        hi = min(len(prof), last + int(12 / 0.25))
        bk = prof[last:hi].min()
        half = bk + 0.5 * (pk - bk)
        j = last
        while j + 1 < len(prof) and prof[j + 1] > half:
            j += 1
        if j + 1 >= len(prof):
            continue
        f = (prof[j] - half) / max(prof[j] - prof[j + 1], 1e-6)
        r = rs[j] + f * 0.25
        pts.append((cx + r * dx, cy + r * dy))
    return np.array(pts, dtype=np.float64)


def ell_resid(el, pts):
    (cx, cy), (A, B), ang = el
    a, b = A / 2, B / 2
    c, s = np.cos(np.radians(ang)), np.sin(np.radians(ang))
    dx, dy = pts[:, 0] - cx, pts[:, 1] - cy
    u = (dx * c + dy * s) / a
    v = (-dx * s + dy * c) / b
    rho = np.hypot(u, v)
    return (rho - 1.0) * (a + b) / 2


def fit_circle(p):
    A = np.c_[2 * p[:, 0], 2 * p[:, 1], np.ones(len(p))]
    b = (p ** 2).sum(1)
    cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
    r = np.sqrt(c + cx * cx + cy * cy)
    return ((cx, cy), (2 * r, 2 * r), 0.0)


def fit(pts, circle=False):
    keep = np.ones(len(pts), bool)
    el = None
    for _ in range(4):
        el = fit_circle(pts[keep]) if circle else cv2.fitEllipse(pts[keep].astype(np.float32))
        r = np.abs(ell_resid(el, pts))
        thr = max(2.5 * np.median(r[keep]), 0.6)
        keep = r < thr
    r = ell_resid(el, pts[keep])
    return el, keep, float(np.sqrt(np.mean(r ** 2)))


def main():
    out = {}
    for rid, dials in START.items():
        rgb = C.imread(rid)
        lin = C.s2l(rgb)
        vis = rgb[:, :, ::-1].copy()
        out[rid] = {}
        for name, (cx, cy, r0) in dials.items():
            pts = edge_points(lin, cx, cy, r0, arc=ARC.get(rid, 180), rng=ARC_RANGE.get((rid, name)))
            if len(pts) < 40:
                print(rid, name, 'too few points', len(pts))
                continue
            el, keep, rms = fit(pts, circle=(rid, name) in ARC_RANGE)
            (ex, ey), (A, B), ang = el
            a, b = A / 2, B / 2
            out[rid][name] = {'cx': ex, 'cy': ey, 'a': a, 'b': b, 'phi': ang,
                              'R_mean': (a + b) / 2, 'axis_ratio': min(a, b) / max(a, b),
                              'rays': int(len(pts)), 'inliers': int(keep.sum()), 'rms_px': rms}
            print(rid, name, 'c=(%.1f, %.1f) a=%.1f b=%.1f phi=%.1f  inl %d/%d rms %.2f' %
                  (ex, ey, a, b, ang, keep.sum(), len(pts), rms))
            for (x, y), k in zip(pts, keep):
                cv2.circle(vis, (int(x), int(y)), 1, (0, 255, 0) if k else (0, 0, 255), -1)
            cv2.ellipse(vis, ((ex, ey), (A, B), ang), (255, 0, 255), 1)
        cv2.imwrite(os.path.join(C.WORK, 'ellipses_%s.png' % rid), vis)
    C.jdump(out, os.path.join(C.WORK, 'ellipses.json'))


if __name__ == '__main__':
    main()
