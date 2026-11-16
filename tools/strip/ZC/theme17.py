"""Package ZC: does a connected theme change BMW's panel? Photo 17 (theme connected, low resolution, the rect of
tools/overlay/rectify_more.py at 1x) against 66 (no theme, the same message). Arc centreline, tips, fill profile,
text box and baseline, symbol box. Prints only numbers. Run as atlas.py.
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402
from atlas import ink, union  # noqa: E402

im = cv2.imread(os.path.join(Z.ROOT, 'bake', 'work', 'overlay', 'rect', '17.png'))
# rectify.py's rects are OpenCV-index frames: pixel k centres at continuous k + 0.5, i.e. covers [k, k+1) -> as Z.
z = im[Z.ZY0:Z.ZY1, Z.ZX0:Z.ZX1, ::-1].astype(np.float64) / 255
z = cv2.resize(z, None, fx=Z.N, fy=Z.N, interpolation=cv2.INTER_CUBIC)
rgb = Z.srgb_to_lin(np.clip(z, 0, 1))
Y = Z.lum(rgb)
bk = float(np.median(Z.cut(Y, 650, 600, 690, 636)))
out = {'black_Y': round(bk, 4)}
pts = []
for x in np.arange(700, 1226, 1.0):
    c = Z.cut(Y, x, 592, x + 1, 630).mean(1)
    i = int(c.argmax())
    pk = c[i]
    if pk - bk < 0.08:
        continue
    w = np.clip(c[max(0, i - 12):i + 13] - bk - 0.5 * (pk - bk), 0, None)
    cy = (np.arange(max(0, i - 12), max(0, i - 12) + len(w)) * w).sum() / w.sum()
    pts.append((x + 0.5, 592 + (cy + 0.5) / Z.N, pk))
p = np.array(pts)
flat = p[(p[:, 0] > 770) & (p[:, 0] < 1150)]
plateau = float(np.median(flat[:, 2]))
ok = p[:, 2] - bk > 0.5 * (plateau - bk)
out['arc_flat_y'] = round(float(np.median(flat[:, 1])), 2)
out['arc_tips_x_50pct'] = [float(p[ok, 0].min()), float(p[ok, 0].max())]
ok10 = p[:, 2] - bk > 0.1 * (plateau - bk)
out['arc_tips_x_10pct'] = [float(p[ok10, 0].min()), float(p[ok10, 0].max())]
for xs in (720, 730, 740, 1180, 1190, 1200):
    out['arc_y_at_%d' % xs] = round(float(np.interp(xs + 0.5, p[:, 0], p[:, 1])), 2)
sym, _ = ink(Y, (712, 622, 764, 692), bk)
out['symbol_box'] = union(sym)
txt, _ = ink(Y, (765, 625, 1200, 700), bk)
txt = [c for c in txt if c[3] - c[1] > 8]
u = union(txt)
out['text_box'] = u
out['text_centre_x'] = round((u[0] + u[2]) / 2, 2)
out['text_bottom_median'] = round(float(np.median([c[3] for c in txt])), 2)
W = float(np.percentile(Z.cut(Y, 815, 640, 1125, 680), 99.5))
col = Z.cut(Y, 790, 596, 792, 700).mean(1).reshape(-1, Z.N).mean(1)
out['fill_col_791_rel_white_y596_699_every4'] = [round(float((v - bk) / (W - bk)), 3) for v in col[::4]]
print(json.dumps(out, indent=1))
