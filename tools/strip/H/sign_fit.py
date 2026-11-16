"""Package H: a quick, independent check of BMW's sign centre and red-ring radii on registered 1920x720 rects.

Not the zone package's measurement (ZL owns the sign); this is the cross-check that ranks SIGN_WIN in the
genealogy. For each rect: redness = R - max(G, B) in a 140 px box round (537, 621), upsampled 8x (bicubic);
the ring's pixels are those above half of the 99th-percentile redness; a least-squares (Kasa) circle is fitted to
the ring's outer and inner edges separately (edge pixels = ring pixels with a non-ring 4-neighbour, split by
distance from a first centre). Reports the centre, r_outer, r_inner in continuous panel px (pixel centre
= i + 0.5), and the left/right and top/bottom ring widths (a lopsided rect or a lopsided ring shows here).

Prints numbers only. Usage (repo's uv convention): ... python -I tools/strip/H/sign_fit.py <rect.png> ...
"""
import sys
import cv2
import numpy as np

UP = 8


def kasa(x, y):
    A = np.c_[2 * x, 2 * y, np.ones_like(x)]
    b = x * x + y * y
    c, *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy = c[0], c[1]
    return cx, cy, float(np.sqrt(c[2] + cx * cx + cy * cy))


def fit(path):
    im = cv2.imread(path, cv2.IMREAD_COLOR).astype(np.float32)
    x0, y0, x1, y1 = 467, 551, 607, 691
    crop = im[y0:y1, x0:x1]
    b, g, r = crop[..., 0], crop[..., 1], crop[..., 2]
    red = r - np.maximum(g, b)
    red = cv2.resize(red, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
    thr = 0.5 * np.percentile(red, 99)
    m = (red > thr).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n < 2:
        return None
    k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    m = (lab == k).astype(np.uint8)
    er = cv2.erode(m, np.ones((3, 3), np.uint8))
    edge = (m - er) > 0
    ys, xs = np.nonzero(edge)
    px = x0 + (xs + 0.5) / UP          # continuous panel px
    py = y0 + (ys + 0.5) / UP
    cx, cy, r = kasa(px, py)
    d = np.hypot(px - cx, py - cy)
    mid = np.median(d)
    out, inn = d > mid, d <= mid
    cxo, cyo, ro = kasa(px[out], py[out])
    cxi, cyi, ri = kasa(px[inn], py[inn])
    # ring widths along the four axes (outer minus inner distance, from the outer centre)
    res = dict(centre_outer=(round(cxo, 2), round(cyo, 2)), r_outer=round(ro, 2), centre_inner=(round(cxi, 2), round(cyi, 2)),
               r_inner=round(ri, 2), ring_px=int(m.sum()) / UP / UP, thr=round(float(thr), 1))
    widths = {}
    for name, (dx, dy) in dict(left=(-1, 0), right=(1, 0), top=(0, -1), bottom=(0, 1)).items():
        t = np.arange(0, 60, 1.0 / UP)
        sx = ((cxo + dx * t) - x0) * UP - 0.5
        sy = ((cyo + dy * t) - y0) * UP - 0.5
        ok = (sx >= 0) & (sy >= 0) & (sx < m.shape[1] - 1) & (sy < m.shape[0] - 1)
        v = m[np.round(sy[ok]).astype(int), np.round(sx[ok]).astype(int)]
        on = t[ok][v > 0]
        widths[name] = (round(float(on.min()), 2), round(float(on.max()), 2)) if on.size else None
    res["ring_extent_along_axes"] = widths
    return res


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(p.rsplit("/", 1)[-1], fit(p))
