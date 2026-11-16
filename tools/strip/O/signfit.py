"""Package O: where BMW's speed-limit sign sits in a bench backdrop (a rectified photo bake/work/overlay/rect/<id>.png),
so the bench's sign window can be compared with what shows through it.

For each photo: sample the red ring's redness (R - max(G, B), photo pixel values) on rays round a start centre every
2 degrees, 0.1 px steps, find on each ray the inner edge (white face -> red) and the outer edge (red -> dark) at the
half-way crossing of a smoothed profile, and fit a circle to each edge set by linear least squares (Kasa fit).
Prints the two circles in continuous panel px (pixel (i, j) covers [i, i+1) x [j, j+1), so a sample at array
index i is at i + 0.5) and the rms residual.

    uv run ... python -I tools/strip/O/signfit.py 08 09 14 17 39
No photo pixel is written anywhere; only numbers are printed.
"""
import sys
import os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
RECT = os.path.join(ROOT, 'bake', 'work', 'overlay', 'rect')


def bilinear(img, x, y):
    # x, y continuous panel coords; array index = coord - 0.5
    xi = x - 0.5
    yi = y - 0.5
    x0 = np.floor(xi).astype(int)
    y0 = np.floor(yi).astype(int)
    fx = xi - x0
    fy = yi - y0
    h, w = img.shape[:2]
    x0c = np.clip(x0, 0, w - 2)
    y0c = np.clip(y0, 0, h - 2)
    a = img[y0c, x0c]
    b = img[y0c, x0c + 1]
    c = img[y0c + 1, x0c]
    d = img[y0c + 1, x0c + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def kasa(pts):
    x = pts[:, 0]
    y = pts[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    b = x * x + y * y
    s = np.linalg.lstsq(A, b, rcond=None)[0]
    cx, cy = s[0], s[1]
    r = np.sqrt(s[2] + cx * cx + cy * cy)
    res = np.hypot(x - cx, y - cy) - r
    return cx, cy, r, float(np.sqrt(np.mean(res ** 2))), res


def fit(img, c0=(537.3, 621.3), rmin=20.0, rmax=56.0, skip=None):
    rgb = img[..., :3].astype(np.float64)
    red = rgb[..., 0] - np.maximum(rgb[..., 1], rgb[..., 2])
    lum = rgb.mean(axis=2)
    cx, cy = c0
    for it in range(3):
        inner, outer = [], []
        for deg in np.arange(0, 360, 2.0):
            if skip and skip(deg):
                continue
            t = np.radians(deg)
            rs = np.arange(rmin, rmax, 0.1)
            xs = cx + rs * np.cos(t)
            ys = cy + rs * np.sin(t)
            pr = bilinear(red, xs, ys)
            pl = bilinear(lum, xs, ys)
            k = np.ones(5) / 5
            pr = np.convolve(pr, k, mode='same')
            i_pk = int(np.argmax(pr))
            peak = pr[i_pk]
            if peak < 40:
                continue
            # inner edge: going inward from the peak, where redness falls to half the peak (the face is white: low red)
            half = peak / 2.0
            j = i_pk
            while j > 0 and pr[j] > half:
                j -= 1
            k2 = i_pk
            while k2 < len(pr) - 1 and pr[k2] > half:
                k2 += 1
            if j <= 0 or k2 >= len(pr) - 1:
                continue
            ri = rs[j] + (half - pr[j]) / (pr[j + 1] - pr[j]) * 0.1
            ro = rs[k2 - 1] + (pr[k2 - 1] - half) / (pr[k2 - 1] - pr[k2]) * 0.1
            inner.append((cx + ri * np.cos(t), cy + ri * np.sin(t)))
            outer.append((cx + ro * np.cos(t), cy + ro * np.sin(t)))
        fi = kasa(np.array(inner))
        fo = kasa(np.array(outer))
        cx, cy = (fi[0] + fo[0]) / 2, (fi[1] + fo[1]) / 2
    return fi, fo, len(inner)


if __name__ == '__main__':
    for pid in sys.argv[1:]:
        img = np.asarray(Image.open(os.path.join(RECT, pid + '.png')).convert('RGB'))
        fi, fo, n = fit(img)
        print('%s: rays %d  inner (face edge) c (%.2f, %.2f) r %.2f rms %.2f | outer (ring edge) c (%.2f, %.2f) r %.2f rms %.2f'
              % (pid, n, fi[0], fi[1], fi[2], fi[3], fo[0], fo[1], fo[2], fo[3]))
