"""VT: a review image, each reference text sample over the chosen face's render at the fitted scale (output stays
under bake/work/: it holds photo pixels).

    python -I tools/twin-dial/vt/compare.py <out.png>
"""
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
import fit as F  # noqa: E402

FONTS = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'refs', 'vt-fonts')
SAIRA = os.path.join(FONTS, 'saira', 'Saira[wdth,wght].ttf')
NOTO = os.path.join(FONTS, 'notosans', 'NotoSans[wdth,wght].ttf')
CASES = [((2262, 368, 2366, 418), '100', SAIRA, 500, 125, 40),
         ((2032, 486, 2122, 538), '60', SAIRA, 500, 125, 40),
         ((680, 800, 820, 890), 'D1', SAIRA, 550, 125, 88),
         ((706, 892, 818, 938), 'AUTO', SAIRA, 550, 125, 30),
         ((1278, 488, 1794, 562), 'Short-term memory', NOTO, 400, 100, 54),
         ((1328, 876, 1740, 932), 'Reset values with OK', NOTO, 400, 100, 41),
         ((1240, 1052, 1392, 1118), '14:43', NOTO, 400, 100, 54)]
img = cv2.imread(os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'pub', 'VR', '02_rect.png'))
rows = []
for (x0, y0, x1, y1), txt, path, w, d, size in CASES:
    c = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    a = (F.render_mask(F.font(path, size, w, d), txt, 6) * 255).astype(np.uint8)
    ys, xs = np.where(a > 20)
    a = a[ys.min() - 4:ys.max() + 4, xs.min() - 4:xs.max() + 4]
    rows += [c, a, np.zeros((6, 4), np.uint8)]
W = max(r.shape[1] for r in rows)
out = np.vstack([np.pad(r, ((0, 0), (0, W - r.shape[1]))) for r in rows])
cv2.imwrite(sys.argv[1], cv2.resize(out, None, fx=2, fy=2))
