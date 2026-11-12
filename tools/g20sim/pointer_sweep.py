"""Diff the shots of tools/g20sim/pointer_sweep.sh: the pixels where wb_dials over the stock gauges differs from
wb_dials over black are stock pointer / glow pixels the driver would see. Reports per (speed, rpm) the count, the
max y, the count at y >= 656 (the cut), and the count outside the collar (design/overlay/collar.dials.png).

  python tools/g20sim/pointer_sweep.py   (uv with opencv/numpy, as tools/g20sim/qc.py)
Note: the demo values ease in the app and in G20Live; each shot waits 20 s of virtual time.
"""
import glob
import os
import re

import cv2
import numpy as np

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
D = os.path.join(WT, "bake", "work", "g20sim", "E", "sweep")
collar = cv2.imread(os.path.join(WT, "design", "overlay", "collar.dials.png"), cv2.IMREAD_GRAYSCALE)
if collar.shape != (720, 1920):
    collar = cv2.resize(collar, (1920, 720), interpolation=cv2.INTER_NEAREST)
rows = []
for g in glob.glob(os.path.join(D, "g_*.png")):
    sp, rpm = map(int, re.findall(r"g_(\d+)_(\d+)", g)[0])
    a = cv2.imread(g).astype(int)
    b = cv2.imread(g.replace("/g_", "/n_")).astype(int)
    vis = np.abs(a - b).max(2) > 12
    vis[:, :] &= True
    ys, xs = np.nonzero(vis)
    rows.append((sp, rpm, int(vis.sum()), int(ys.max()) if len(ys) else None, int(vis[656:].sum()),
                 int((vis & (collar < 128)).sum()), int((vis[:, :960]).sum()), int((vis[:, 960:]).sum())))
    out = cv2.imread(g.replace("/g_", "/n_"))
    out[vis] = (0, 255, 0)
    cv2.line(out, (0, 656), (1919, 656), (0, 0, 255), 1)
    cv2.imwrite(os.path.join(D, "vis_%d_%d.png" % (sp, rpm)), out)
rows.sort()
print("| speed km/h | rpm | visible px (speedo side / tacho side) | max y | px at y >= 656 |")
print("|---|---|---|---|---|")
for sp, rpm, n, my, n656, nout, nl, nr in rows:
    print("| %d | %d | %d (%d / %d) | %s | %d |" % (sp, rpm, n, nl, nr, my, n656))
