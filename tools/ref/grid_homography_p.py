"""Parametrised copy of grid_homography.py (same algorithm, no session paths).

Detects the green calibration grid (lines every 100 panel px) in the G20 grid photo and fits the panel->photo
homography by DLT over the line crossings.

  UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow \
      python tools/ref/grid_homography_p.py reference/g20/10_grid_over-stock.jpg bake/work/p0/H10_refit.json

The strip positions / line spacing seeds below are specific to photo 10 (2048x1536).
"""
import json
import sys
import numpy as np
from PIL import Image


def peaks(a, thr, sep=40):
    out = []
    for i in range(1, len(a) - 1):
        if a[i] >= thr and a[i] >= a[i - 1] and a[i] >= a[i + 1]:
            if out and i - out[-1][0] < sep:
                if a[i] > out[-1][1]:
                    out[-1] = (i, int(a[i]))
            else:
                out.append((i, int(a[i])))
    return [p[0] for p in out]


def dlt(src, dst):
    A = []
    for (X, Y), (x, y) in zip(src, dst):
        A.append([X, Y, 1, 0, 0, 0, -x * X, -x * Y, -x])
        A.append([0, 0, 0, X, Y, 1, -y * X, -y * Y, -y])
    _, _, V = np.linalg.svd(np.array(A))
    return V[-1].reshape(3, 3) / V[-1][-1]


def ap(H, p):
    v = H @ np.array([p[0], p[1], 1.0])
    return v[:2] / v[2]


def main(photo, out):
    im = np.asarray(Image.open(photo).convert('RGB')).astype(int)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    m = (g > 110) & (g - r > 45) & (g - b > 10)
    vs, hs = {}, {}
    for y0 in (560, 700, 880, 1130):
        for x in peaks(m[y0:y0 + 16].sum(0), 8):
            vs.setdefault(round((x - 211) / 98.3) + 1, []).append((y0 + 8, x))
    for x0 in (130, 420, 1000, 1650, 1930):
        for y in peaks(m[:, x0:x0 + 16].sum(1), 8):
            hs.setdefault(round((y - 598) / 96.2) + 1, []).append((x0 + 8, y))
    pts = []
    for k, v in vs.items():
        if len(v) < 2 or not 1 <= k <= 19:
            continue
        A = np.polyfit([p[0] for p in v], [p[1] for p in v], 1)
        for j, h in hs.items():
            if len(h) < 3 or not 1 <= j <= 7:
                continue
            B = np.polyfit([p[0] for p in h], [p[1] for p in h], 1)
            x = (A[0] * B[1] + A[1]) / (1 - A[0] * B[0])
            pts.append((100 * k, 100 * j, x, B[0] * x + B[1]))
    P = np.array(pts)
    Hm = dlt(P[:, :2], P[:, 2:])
    err = [np.linalg.norm(ap(Hm, p[:2]) - p[2:]) for p in P]
    res = {'Hm': Hm.tolist(), 'Hi': np.linalg.inv(Hm).tolist(), 'crossings': len(P),
           'residual_mean_px': float(np.mean(err)), 'residual_max_px': float(np.max(err))}
    json.dump(res, open(out, 'w'), indent=1)
    print('crossings %d, residual mean %.2f max %.2f px (photo)' % (len(P), np.mean(err), np.max(err)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
