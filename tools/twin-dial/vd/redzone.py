"""Measure the red zone of a tachometer in dial units: angular and radial extent of red pixels, and its colour.

Usage: redzone.py KEY [sat]     red = R - max(G, B) > sat (default 0.18) on sRGB 0..1
Prints, per radius band, the angular extent of red, and per angle band the radial extent; the median sRGB colour of
the solid area (pixels whose 5x5 neighbourhood is all red), and of the edge line (brightest red).
"""
import sys, os, numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
from radial import sample

key = sys.argv[1]
sat = float(sys.argv[2]) if len(sys.argv) > 2 else 0.18
th = np.arange(0, 360, 0.25)
rho = np.arange(0.40, 1.15, 0.0025)
p = sample(key, th, rho)  # BGR
b, g, r = p[..., 0], p[..., 1], p[..., 2]
red = (r - np.maximum(g, b)) > sat
print('rho band   theta extent (deg, clockwise)   red fraction')
for r0 in np.arange(0.45, 1.12, 0.025):
    m = red[(rho >= r0) & (rho < r0 + 0.025)].any(axis=0)
    if m.sum() < 8:
        continue
    t = th[m]
    t = (t - 200) % 360 + 200
    print('%.3f-%.3f  %6.1f .. %6.1f   n=%d' % (r0, r0 + 0.025, np.percentile(t, 2) % 360, np.percentile(t, 98) % 360, m.sum()))
print('theta band  rho extent')
for t0 in np.arange(0, 360, 5):
    m = red[:, (th >= t0) & (th < t0 + 5)].any(axis=1)
    if m.sum() < 4:
        continue
    rr = rho[m]
    print('%5.0f-%3.0f  %.3f .. %.3f  n=%d' % (t0, t0 + 5, rr.min(), rr.max(), m.sum()))
solid = cv2.erode(red.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
if solid.any():
    rgb = np.stack([r[solid], g[solid], b[solid]], 1)
    print('solid area sRGB median', np.round(np.median(rgb, 0) * 255).astype(int), 'p10', np.round(np.percentile(rgb, 10, 0) * 255).astype(int),
          'p90', np.round(np.percentile(rgb, 90, 0) * 255).astype(int), 'n', solid.sum())
br = red & (r > np.percentile(r[red], 90))
rgb = np.stack([r[br], g[br], b[br]], 1)
print('brightest red sRGB median', np.round(np.median(rgb, 0) * 255).astype(int))
