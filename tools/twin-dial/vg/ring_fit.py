"""VG provisional dial reading: fit the two white bezel rings of a reference by least squares.

Usage: ring_fit.py <image> <out_png> <cxL,cyL,rL> <cxR,cyR,rR> [band_px]
Seeds are eyeballed guesses (image px). The fit takes the bright, low-saturation pixels within band_px of the
seed circle, keeps the brightest ridge along each ray (one point per degree, the bezel ring's crest), and fits a
circle (Kasa, then 2 rounds of 2-sigma rejection). Prints centre, radius, residual and how many rays fitted.
Writes an overlay to out_png (photo pixels: the caller must put it under bake/work/, never in a tracked path).
Run with: uv run --with opencv-python-headless --with numpy python -I ring_fit.py ...
"""
import sys
import math
import numpy as np
import cv2


def fit_circle(pts):
    x, y = pts[:, 0], pts[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    b = x * x + y * y
    c, *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy = c[0], c[1]
    r = math.sqrt(c[2] + cx * cx + cy * cy)
    return cx, cy, r


def ridge(gray, sat, cx, cy, r, band, a0, a1):
    pts = []
    h, w = gray.shape
    for deg in range(a0, a1):
        t = math.radians(deg)            # clockwise from 12 o'clock
        best, bp = -1, None
        for k in np.arange(-band, band, 0.5):
            rr = r + k
            x = cx + rr * math.sin(t)
            y = cy - rr * math.cos(t)
            xi, yi = int(round(x)), int(round(y))
            if not (0 <= xi < w and 0 <= yi < h):
                continue
            v = gray[yi, xi] if sat[yi, xi] < 70 else 0
            if v > best:
                best, bp = v, (x, y)
        if bp is not None and best > 150:
            pts.append(bp)
    return np.array(pts)


def main():
    img = cv2.imread(sys.argv[1])
    out = sys.argv[2]
    seeds = [list(map(float, s.split(','))) for s in sys.argv[3:5]]
    band = float(sys.argv[5]) if len(sys.argv) > 5 else 12
    gray = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (3, 3), 0)
    sat = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)[:, :, 1]
    vis = img.copy()
    for name, (cx, cy, r) in zip(('L', 'R'), seeds):
        pts = ridge(gray, sat, cx, cy, r, band, -150, 151)
        if len(pts) < 20:
            print(name, 'too few points', len(pts))
            continue
        keep = pts
        for _ in range(3):
            c = fit_circle(keep)
            d = np.hypot(keep[:, 0] - c[0], keep[:, 1] - c[1]) - c[2]
            s = d.std()
            keep = keep[np.abs(d) < 2 * s + 0.5]
        cx, cy, r = fit_circle(keep)
        d = np.hypot(keep[:, 0] - cx, keep[:, 1] - cy) - r
        print('%s centre (%.1f, %.1f) R %.1f  rms %.2f px  rays %d/%d' % (name, cx, cy, r, d.std(), len(keep), len(pts)))
        cv2.circle(vis, (int(round(cx)), int(round(cy))), int(round(r)), (0, 255, 0), 1)
        cv2.drawMarker(vis, (int(round(cx)), int(round(cy))), (0, 255, 0), cv2.MARKER_CROSS, 12, 1)
        for p in keep:
            vis[int(p[1]), int(p[0])] = (255, 0, 255)
    cv2.imwrite(out, vis)


if __name__ == '__main__':
    main()
