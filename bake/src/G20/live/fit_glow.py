"""Package D, step 4: the orange glow that follows the stock pointer, isolated from the tacho at 0 (08) and idle (09).

  tools/g20sim/D/py bake/src/G20/live/fit_glow.py      (after fit_scales.py)  -> bake/work/g20sim/D/fit_glow.json

Model (additive, canvas 'lighter'), in the pointer's polar frame about the virtual centre C:
    g(x) = c * A(phi) * W(q)
    phi = angle of x about C minus the bar's angle (deg, + toward higher values);  A = exp(-phi^2 / 2 s^2), with
          s = s_hi for phi > 0 and s_lo for phi < 0;
    q   = depth of x inside the tick ring along the ray from C (px);  W = 1 for q <= q0, then a smooth fall to 0 at q1.
The face under the glow is unknown, so both photos are used together: per channel
    o09 = a * (o08 - c08 * S(pose08)) + b + c09 * S(pose09)
which is linear in (a, b, a*c08, c09) for a given shape (s_hi, s_lo, q0, q1); the shape is grid-searched. a, b are
the exposure / look change from night (08) to day (09); c08 and c09 the glow colour at full strength per look.
Pixels: the tacho face between the tick ring and the face's inner edge, minus the bars, ticks, numerals and texts
(white or locally contrasty pixels), clipped pixels and the pink rev band of 09.
"""
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common_live import SCRATCH, rect  # noqa: E402


def smoothw(q, q0, q1):
    t = np.clip((q - q0) / max(q1 - q0, 1e-3), 0, 1)
    return 1 - t * t * (3 - 2 * t)


def main():
    fs = json.load(open(os.path.join(SCRATCH, 'fit_scales.json')))
    C = np.array(fs['models']['A']['tacho_centre'])
    T = fs['ticks']['tacho']
    ring = np.array([T[k]['outer'] for k in T])
    th_r = np.arctan2(ring[:, 1] - C[1], ring[:, 0] - C[0])
    r_r = np.hypot(ring[:, 0] - C[0], ring[:, 1] - C[1])
    order = np.argsort(th_r)
    th_r, r_r = th_r[order], r_r[order]

    def bar_theta(k):
        d = -np.array(fs['bars'][k]['dir'])
        return math.atan2(d[1], d[0])
    t08, t09 = bar_theta('08.tacho'), bar_theta('09.tacho')

    o8, o9 = rect('08'), rect('09')
    H, W = o8.shape[:2]
    x0, y0, x1, y1 = 1400, 250, 1830, 660
    ys, xs = np.mgrid[y0:y1, x0:x1]
    th = np.arctan2(ys - C[1], xs - C[0])
    r = np.hypot(xs - C[0], ys - C[1])
    q = np.interp(th, th_r, r_r) - r
    phi8 = np.degrees(t08 - th)          # tacho: higher values at smaller image angles
    phi9 = np.degrees(t09 - th)
    A8, A9 = o8[y0:y1, x0:x1], o9[y0:y1, x0:x1]
    # face inner edge (tacho), measured on 09 rows (fit_scales / report): left of it is the map
    edge_y = np.array([100, 160, 220, 339, 440, 520, 580, 650])
    edge_x = np.array([1358, 1399, 1442, 1525, 1485, 1452, 1429, 1425])
    inside = xs > np.interp(ys, edge_y, edge_x) + 3
    m = inside & (q > 6) & (q < 300)

    def busy(img):
        L = img.mean(2)
        hp = np.abs(L - cv2.GaussianBlur(L, (0, 0), 2.5))
        white = img.min(2) > 110
        clip = img.max(2) > 248
        return (cv2.dilate((hp > 9).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0) | cv2.dilate(white.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) | clip
    m &= ~busy(A8) & ~busy(A9)
    # bar corridors
    for k in ('08.tacho', '09.tacho'):
        b = fs['bars'][k]
        p, d = np.array(b['outer']), np.array(b['dir'])
        rel = np.stack([xs - p[0], ys - p[1]], -1)
        t = rel @ d
        perp = np.abs(rel @ np.array([-d[1], d[0]]))
        m &= ~((perp < 9) & (t > -12) & (t < b['length'] + 12))
    m &= ~((xs > 1530) & (xs < 1650) & (ys > 608) & (ys < 632))     # 09's pink rev band
    print('pixels used: %d' % m.sum())

    best = None
    for s_hi in (12, 16, 20, 24, 28, 34):
        for s_lo in (8, 12, 16, 20, 26):
            A8w = np.where(phi8 > 0, np.exp(-phi8 ** 2 / (2 * s_hi ** 2)), np.exp(-phi8 ** 2 / (2 * s_lo ** 2)))
            A9w = np.where(phi9 > 0, np.exp(-phi9 ** 2 / (2 * s_hi ** 2)), np.exp(-phi9 ** 2 / (2 * s_lo ** 2)))
            for q0 in (20, 50, 80, 110):
                for q1 in (140, 180, 220, 270):
                    Wq = smoothw(q, q0, q1)
                    S8, S9 = (A8w * Wq)[m], (A9w * Wq)[m]
                    sse, coefs = 0, []
                    for c in range(3):
                        X = np.stack([A8[..., c][m], np.ones(m.sum()), -S8, S9], 1)
                        y = A9[..., c][m]
                        k, res, *_ = np.linalg.lstsq(X, y, rcond=None)
                        sse += float(((X @ k - y) ** 2).sum())
                        coefs.append(k)
                    if best is None or sse < best[0]:
                        best = (sse, dict(s_hi=s_hi, s_lo=s_lo, q0=q0, q1=q1), coefs)
    sse, shape, coefs = best
    a = [float(k[0]) for k in coefs]
    b = [float(k[1]) for k in coefs]
    c08 = [float(k[2] / k[0]) for k in coefs]
    c09 = [float(k[3]) for k in coefs]
    # baseline without the glow terms (for an R^2 of the glow model on the difference)
    sse0 = 0
    for c in range(3):
        X = np.stack([A8[..., c][m], np.ones(m.sum())], 1)
        y = A9[..., c][m]
        k = np.linalg.lstsq(X, y, rcond=None)[0]
        sse0 += float(((X @ k - y) ** 2).sum())
    print('shape', shape)
    print('exposure 08 -> 09: a %s b %s' % (np.round(a, 3), np.round(b, 1)))
    print('glow colour at full strength: night (08) %s  day (09) %s' % (np.round(c08, 1), np.round(c09, 1)))
    print('rms residual %.2f (no-glow model %.2f); glow explains %.1f %% of the variance left by exposure alone' % (
        math.sqrt(sse / (3 * m.sum())), math.sqrt(sse0 / (3 * m.sum())), 100 * (1 - sse / sse0)))
    out = dict(centre=C.tolist(), shape=shape, exposure_a=a, exposure_b=b, colour_night=c08, colour_day=c09,
               rms=math.sqrt(sse / (3 * m.sum())), rms_noglow=math.sqrt(sse0 / (3 * m.sum())), n=int(m.sum()))
    json.dump(out, open(os.path.join(SCRATCH, 'fit_glow.json'), 'w'), indent=1)
    # review: 08 / 09 / diff (09 - a*08 - b) / model diff
    s_hi, s_lo, q0, q1 = shape['s_hi'], shape['s_lo'], shape['q0'], shape['q1']
    A8w = np.where(phi8 > 0, np.exp(-phi8 ** 2 / (2 * s_hi ** 2)), np.exp(-phi8 ** 2 / (2 * s_lo ** 2)))
    A9w = np.where(phi9 > 0, np.exp(-phi9 ** 2 / (2 * s_hi ** 2)), np.exp(-phi9 ** 2 / (2 * s_lo ** 2)))
    Wq = smoothw(q, q0, q1) * inside * (q > 0)
    D = np.stack([A9[..., c] - a[c] * A8[..., c] - b[c] for c in range(3)], -1)
    M = np.stack([c09[c] * A9w * Wq - a[c] * c08[c] * A8w * Wq for c in range(3)], -1)
    vis = np.concatenate([A8, A9, np.clip(D + 128, 0, 255), np.clip(M + 128, 0, 255), np.where(m[..., None], 255, 0) * np.ones(3)], 1)
    cv2.imwrite(os.path.join(SCRATCH, 'glow_fit.png'), vis[..., ::-1].astype(np.uint8))


if __name__ == '__main__':
    main()
