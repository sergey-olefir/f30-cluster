"""Package VR step 1: locate the dials' rings in each source image and fit ellipses.

    uv run ... python -I tools/twin-dial/vr/rings.py [ids...]

For every ring of refs.json: rays from the rough centre every 0.5 deg over the ring's angular range; along each ray the
luminance profile (linear light, bilinear, 0.1 px steps, smoothed by a Gaussian of sigma 0.6 px) in a window of
+-14 % of r; the ring is the strongest bright ridge (top-hat: value minus the window's 20th percentile), located
sub-pixel by a parabola through the three samples around the maximum. Rays whose ridge is weaker than 25 % of the
median ridge are dropped. An ellipse is fitted (OpenCV direct fit), then refitted 4 times on the points whose
geometric distance to it is under 3 MAD (min 0.4 px). The rough centre is updated from the first fit and the rays are
cast again once.

Writes bake/work/twin-dial/vr/<id>/rings.json (points, ellipse, rms, inlier share; OpenCV source px) and
rings_check.png (the source with the points and ellipses).
"""
import os
import sys

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d, map_coordinates

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def ellipse_dist(pts, e):
    """Approximate geometric distance of points to an OpenCV ellipse ((cx, cy), (w, h), angle)."""
    (cx, cy), (w, h), ang = e
    a, b = w / 2.0, h / 2.0
    t = np.deg2rad(ang)
    d = pts - np.array([cx, cy])
    x = d[:, 0] * np.cos(t) + d[:, 1] * np.sin(t)
    y = -d[:, 0] * np.sin(t) + d[:, 1] * np.cos(t)
    # Newton on the parametric angle
    phi = np.arctan2(y * a, x * b)
    for _ in range(6):
        ex, ey = a * np.cos(phi), b * np.sin(phi)
        dx, dy = -a * np.sin(phi), b * np.cos(phi)
        f = (ex - x) * dx + (ey - y) * dy
        df = dx * dx + dy * dy + (ex - x) * (-a * np.cos(phi)) + (ey - y) * (-b * np.sin(phi))
        phi = phi - f / np.where(np.abs(df) < 1e-9, 1e-9, df)
    ex, ey = a * np.cos(phi), b * np.sin(phi)
    s = np.sign((x / a) ** 2 + (y / b) ** 2 - 1)
    return s * np.hypot(ex - x, ey - y)


def robust_ellipse(pts):
    w = np.ones(len(pts), bool)
    e = None
    for _ in range(5):
        if w.sum() < 12:
            break
        e = cv2.fitEllipseDirect(pts[w].astype(np.float32))
        r = ellipse_dist(pts, e)
        s = 1.4826 * np.median(np.abs(r[w] - np.median(r[w])))
        w = np.abs(r) < max(3 * s, 0.4)
    r = ellipse_dist(pts, e)
    return e, w, r


def runs_above(q, thr):
    """Contiguous index runs where q > thr, as (start, stop) pairs."""
    m = np.r_[False, q > thr, False]
    d = np.diff(m.astype(np.int8))
    return list(zip(np.where(d == 1)[0], np.where(d == -1)[0]))


def line_centre(p, i, step):
    """Centre and FWHM (in samples) of a bright line around sample i: half-maximum crossings on each side, each
    against the lowest value within 8 px on that side."""
    pk = p[i]
    span = int(8 / step)
    lo_l = p[max(0, i - span):i + 1].min()
    lo_r = p[i:i + span + 1].min()
    hl, hr = 0.5 * (pk + lo_l), 0.5 * (pk + lo_r)
    a = i
    while a > 0 and p[a] > hl:
        a -= 1
    b = i
    while b < len(p) - 1 and p[b] > hr:
        b += 1
    if a == 0 or b == len(p) - 1:
        return None
    xa = a + (hl - p[a]) / (p[a + 1] - p[a])
    xb = b - 1 + (p[b - 1] - hr) / (p[b - 1] - p[b])
    return 0.5 * (xa + xb), xb - xa


def ridge_points(Y, cx, cy, r, a0, a1, win=0.14, mode='max', step_deg=0.5):
    """mode: 'max' strongest ridge in the window; 'outer' the outermost ridge above 35 % of the window's strongest;
    'second' the next one inwards after 'outer'."""
    out = []
    step = 0.1
    rr = np.arange(r * (1 - win), r * (1 + win), step)
    for adeg in np.arange(a0, a1 + 1e-9, step_deg):
        t = np.deg2rad(adeg)
        ux, uy = np.sin(t), -np.cos(t)            # clockwise from 12 o'clock, y down
        xs, ys = cx + rr * ux, cy + rr * uy
        if xs.min() < 1 or ys.min() < 1 or xs.max() > Y.shape[1] - 2 or ys.max() > Y.shape[0] - 2:
            continue
        p = map_coordinates(Y, [ys, xs], order=1)
        p = gaussian_filter1d(p, 6)               # 0.6 px
        q = p - np.percentile(p, 20)
        if mode == 'max':
            i = int(np.argmax(q))
        else:
            rs = runs_above(q, 0.35 * q.max())
            k = len(rs) - 1 if mode == 'outer' else len(rs) - 2
            if k < 0:
                continue
            s0, s1 = rs[k]
            i = s0 + int(np.argmax(q[s0:s1]))
        if i == 0 or i == len(q) - 1:
            continue
        lc = line_centre(p, i, step)
        if lc is None:
            continue
        c, fw = lc
        rad = rr[0] + c * step
        out.append((adeg, cx + rad * ux, cy + rad * uy, float(q[i]), fw * step))
    return np.array(out)


def fit_ring(Y, guess):
    cx, cy, r, (a0, a1) = guess[:4]
    mode = guess[4] if len(guess) > 4 else 'max'
    win = guess[5] if len(guess) > 5 else 0.14
    res = None
    for it in range(2):
        pts = ridge_points(Y, cx, cy, r, a0, a1, win=win if it == 0 else min(win, 0.06), mode=mode)
        if len(pts) < 20:
            return None
        strong = pts[:, 3] > 0.25 * np.median(pts[:, 3])
        pts = pts[strong]
        e, w, d = robust_ellipse(pts[:, 1:3])
        (cx, cy), (ww, hh), _ = e
        r = (ww + hh) / 4.0
        res = (pts, e, w, d)
    pts, e, w, d = res
    (ecx, ecy), (ew, eh), ea = e
    return {'points_ang_x_y_strength_fwhm': [[round(float(v), 4) for v in row] for row in pts],
            'inlier': [bool(v) for v in w],
            'ellipse': {'cx': float(ecx), 'cy': float(ecy), 'w': float(ew), 'h': float(eh), 'angle_deg': float(ea)},
            'fwhm_px_median': float(np.median(pts[w, 4])), 'mode': mode,
            'rms_px': float(np.sqrt(np.mean(d[w] ** 2))), 'inlier_share': float(w.mean()), 'n': int(len(w))}


def run(rid, ref):
    im = C.imread(ref)
    Y = C.luma(im)
    out = {'id': rid, 'source': ref['path'], 'size': [im.shape[1], im.shape[0]], 'coords': 'OpenCV source px', 'rings': {}}
    vis = im.copy()
    for name, g in ref['rings'].items():
        f = fit_ring(Y, g)
        if f is None:
            print(rid, name, 'FAILED')
            continue
        out['rings'][name] = f
        e = f['ellipse']
        cv2.ellipse(vis, ((e['cx'], e['cy']), (e['w'], e['h']), e['angle_deg']), (255, 0, 255), 1, cv2.LINE_AA)
        for (a, x, y, s, fw), ok in zip(f['points_ang_x_y_strength_fwhm'], f['inlier']):
            cv2.circle(vis, (int(round(x)), int(round(y))), 1, (0, 255, 0) if ok else (0, 0, 255), -1)
        print('%s %-8s centre (%.1f, %.1f) axes %.1f x %.1f ang %.1f  rms %.2f px  inliers %.0f %% of %d' % (
            rid, name, e['cx'], e['cy'], e['w'] / 2, e['h'] / 2, e['angle_deg'], f['rms_px'], 100 * f['inlier_share'], f['n']))
    d = os.path.join(C.VRW, rid)
    C.dump(os.path.join(d, 'rings.json'), out)
    cv2.imwrite(os.path.join(d, 'rings_check.png'), vis)


if __name__ == '__main__':
    refs = C.cfg()['refs']
    for rid in (sys.argv[1:] or list(refs)):
        run(rid, refs[rid])
