"""Package ZR: the absolute error of a registration of photo 60 inside the right zone, from our grid's own lines.

Our grid shader lights panel columns [100k, 100k+2) and rows [100k, 100k+2), so in continuous panel coordinates a
major line's centre is at 100k + 1.0. This reads the green-minus-red profile across each major line visible in the
right zone of the strip in a 4x crop (crop index j <-> continuous x = x0 + j/4 + 0.5, the warp samples the OpenCV
panel point x0 + j/4) and reports where the line actually landed.

Usage: python -I gridcheck.py <crop_4x.png> <x0> <y0>      (prints JSON; no pixels are written)
"""
import json
import sys

import cv2
import numpy as np


def centre(profile, j0, half=10):
    j0 = int(round(j0))
    seg = profile[j0 - half:j0 + half + 1].astype(np.float64)
    seg = seg - np.median(profile)
    seg[seg < 0] = 0
    # keep the strongest connected run only
    k = int(np.argmax(seg))
    lo = k
    while lo > 0 and seg[lo - 1] > 0.25 * seg[k]:
        lo -= 1
    hi = k
    while hi < len(seg) - 1 and seg[hi + 1] > 0.25 * seg[k]:
        hi += 1
    w = seg[lo:hi + 1]
    idx = np.arange(lo, hi + 1)
    return j0 - half + float((w * idx).sum() / w.sum()), float(seg[k])


def main():
    path, x0, y0 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    im = cv2.imread(path).astype(np.float32)
    g = np.clip(im[..., 1] - im[..., 2], 0, 255)
    h, w = g.shape
    n = 4.0
    out = {'verticals': [], 'horizontals': []}
    # vertical lines: column profile over row bands clear of the yellow labels (labels sit just under each major row)
    rows = [(y0 + 0.5 + j / n) for j in range(h)]
    band = np.array([(615 <= r <= 640) or (655 <= r <= 690) for r in rows])
    prof = g[band].mean(0)
    for X in range(1200, 1901, 100):
        jexp = (X + 1.0 - x0 - 0.5) * n
        if 15 < jexp < w - 15:
            j, pk = centre(prof, jexp)
            out['verticals'].append({'line': X, 'expect_x': X + 1.0, 'measured_x': round(x0 + j / n + 0.5, 3),
                                     'peak': round(pk, 1)})
    cols = [(x0 + 0.5 + j / n) for j in range(w)]
    for Y in range(600, 701, 100):
        jexp = (Y + 1.0 - y0 - 0.5) * n
        if not (15 < jexp < h - 15):
            continue
        # per 50-px column band between verticals, to see a tilt
        for cx in range(1225, 1900, 50):
            sel = np.array([(cx - 15 <= c <= cx + 15) for c in cols])
            p = g[:, sel].mean(1)
            j, pk = centre(p, jexp)
            out['horizontals'].append({'line': Y, 'at_x': cx, 'expect_y': Y + 1.0,
                                       'measured_y': round(y0 + j / n + 0.5, 3), 'peak': round(pk, 1)})
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
