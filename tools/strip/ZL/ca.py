"""Package ZL: lateral chromatic aberration at the sign, per photo: where the R, G and B channels put the same edges.

Edges used: the white rail line's top and bottom edges (y) at x 455-490 and 590-640, and the left and right edges
of the sign digits' strokes (x) on rows through the digits' middle (dark ink on the white face: every channel
steps). Each edge is the half-level crossing of that channel's linear profile in an 8x warp. Reports the mean
R - G and B - G offset in panel px, in x and in y.
    ... python -I tools/strip/ZL/ca.py 61 62 ...
"""
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sign as S  # noqa: E402

N = 8


def edges(p):
    """half-level crossings of a 1-D profile against its own min/max: positions (in samples)"""
    lo, hi = np.percentile(p, 3), np.percentile(p, 97)
    lev = 0.5 * (lo + hi)
    s = p - lev
    out = []
    for i in range(len(s) - 1):
        if s[i] * s[i + 1] < 0:
            out.append(i + s[i] / (s[i] - s[i + 1]))
    return out


def run(photo):
    lm, ph, e = S.load(photo)
    res = {'x': [], 'y': []}
    # rail: vertical profiles, y 636..660
    for x0, x1 in ((455, 490), (592, 640)):
        im = S.srgb_lin(lm.warp(ph, (x0, 636, x1, 660), N, cv2.INTER_CUBIC)[..., ::-1])
        for c in range(0, im.shape[1], 4):
            es = [edges(im[:, c, k]) for k in range(3)]
            if all(len(v) == 2 for v in es):
                res['y'].append([(es[k][j] - es[1][j]) / N for k in (0, 2) for j in (0, 1)])
    # digits: horizontal profiles inside the face, y 612..630
    im = S.srgb_lin(lm.warp(ph, (514, 612, 562, 630), N, cv2.INTER_CUBIC)[..., ::-1])
    for r in range(0, im.shape[0], 4):
        es = [edges(im[r, :, k]) for k in range(3)]
        if len(es[0]) == len(es[1]) == len(es[2]) and len(es[1]) >= 2:
            d = [[(es[k][j] - es[1][j]) / N for j in range(len(es[1]))] for k in (0, 2)]
            res['x'].append([np.mean(d[0]), np.mean(d[1])])
    out = {}
    for ax in ('x', 'y'):
        a = np.array(res[ax])
        if len(a) == 0:
            continue
        if ax == 'y':
            a = np.stack([a[:, :2].mean(1), a[:, 2:].mean(1)], 1)
        out[ax] = {'R-G': round(float(np.median(a[:, 0])), 3), 'B-G': round(float(np.median(a[:, 1])), 3), 'n': len(a)}
    return out


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p, run(p), flush=True)
