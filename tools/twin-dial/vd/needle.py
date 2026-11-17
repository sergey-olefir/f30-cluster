"""Measure a needle at rest in dial units: its axis angle, and per radius its width (FWHM across) and peak colour.

Usage: needle.py KEY th0 th1 [mode]   search window th0..th1 deg; mode 'white' (default) or 'red'
For each rho step 0.02 the cross profile (0.05 deg steps) of the needle signal minus the local background (median
over the window) gives the centre angle and FWHM; width_R = rho * FWHM(rad).  The needle's root and tip are where
the signal falls below 30 % of its median along the shaft.
"""
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from radial import sample
from dialfit import whiteness

key, t0, t1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
mode = sys.argv[4] if len(sys.argv) > 4 else 'white'
th = np.arange(t0, t1, 0.05)
rho = np.arange(0.30, 1.05, 0.01)
p = sample(key, th, rho)
b, g, r = p[..., 0], p[..., 1], p[..., 2]
s = whiteness(p) if mode == 'white' else r - np.maximum(g, b)
bg = np.median(s, axis=1, keepdims=True)
d = s - bg
peak = d.max(axis=1)
med = np.median(peak[peak > 0.15]) if (peak > 0.15).any() else 0
for i, rr in enumerate(rho):
    row = d[i]
    k = row.argmax(); h = row[k]
    if h < 0.3 * med:
        print('%.2f  -' % rr); continue
    on = row > h / 2
    a = k
    while a > 0 and on[a - 1]: a -= 1
    z = k
    while z < len(row) - 1 and on[z + 1]: z += 1
    fw = (z - a + 1) * 0.05
    w = np.clip(row[a:z + 1], 0, None)
    c = (th[a:z + 1] * w).sum() / w.sum()
    rgb = (r[i, k], g[i, k], b[i, k])
    print('%.2f  axis %.2f  fwhm %.2f deg  width %.4f R  peak %.2f  sRGB %s' % (rr, c, fw, rr * np.radians(fw), h,
          tuple(int(v * 255) for v in rgb)))
