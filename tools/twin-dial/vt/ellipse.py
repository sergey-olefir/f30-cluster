"""VT: the local anisotropy of a reference, from a dial ring that is a circle on the panel.

Fits an ellipse to the bright pixels of a ring inside an annulus guess and prints its axes and tilt; the ratio
minor/major is how much the photo squeezes the panel along the minor axis there (a provisional stand-in for package
VR's rectification, used until VR publishes).

    python -I tools/twin-dial/vt/ellipse.py <image> cx cy r_in r_out [thr]
"""
import sys

import cv2
import numpy as np

img = cv2.imread(sys.argv[1])
cx, cy, r0, r1 = map(float, sys.argv[2:6])
thr = float(sys.argv[6]) if len(sys.argv) > 6 else 200
g = img.max(2).astype(float)
yy, xx = np.mgrid[0:g.shape[0], 0:g.shape[1]]
rr = np.hypot(xx - cx, yy - cy)
m = (rr > r0) & (rr < r1) & (g > thr)
pts = np.stack([xx[m], yy[m]], 1).astype(np.float32)
(ex, ey), (a, b), ang = cv2.fitEllipse(pts)
print('n %d  centre %.1f %.1f  axes %.1f %.1f  angle %.1f  minor/major %.4f' % (len(pts), ex, ey, a, b, ang, min(a, b) / max(a, b)))
