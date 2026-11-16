"""Package H: ink boxes of light stock elements inside named windows of registered 1920x720 rects (claim checks).

For each rect and window: v = max(R, G, B), upsampled 4x (bicubic); the threshold is the midpoint between the
window's 20th percentile (the display's black there) and its 99.7th percentile (the ink); connected components
smaller than 6 panel px^2 are dropped; the box of what is left is printed in continuous panel px ([x0, y0, x1, y1],
pixel i covers [i, i+1)). Only numbers are printed.

The windows are what the claims need (G20-DESIGN-SPEC section 5, CC_BOX, the mode label); they are deliberately a
few px larger than the element so a registration error of 1-3 px does not cut it.

Usage: ... python -I tools/strip/H/inkbox.py <label>=<rect.png> ...
"""
import sys
import cv2
import numpy as np

UP = 4
WIN = {
    "cc_symbol": [700, 622, 790, 700],
    "marker": [1238, 578, 1300, 636],
    "rail_left_tip": [690, 596, 745, 632],
    "rail_right_tip": [1180, 596, 1240, 632],
    "rail_top": [800, 594, 1120, 616],
    "cc_text": [790, 628, 1190, 704],
    "mode_label": [1205, 650, 1380, 716],
    "gear_row": [1380, 655, 1440, 712],
    "street": [690, 664, 1230, 714],
}


def box(img, w, minarea=6):
    x0, y0, x1, y1 = w
    c = img[y0:y1, x0:x1].astype(np.float32).max(axis=2)
    c = cv2.resize(c, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
    lo, hi = np.percentile(c, 20), np.percentile(c, 99.7)
    if hi - lo < 40:
        return None
    m = (c > 0.5 * (lo + hi)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= minarea * UP * UP]
    if not keep:
        return None
    ys, xs = np.nonzero(np.isin(lab, keep))
    return [round(x0 + xs.min() / UP, 1), round(y0 + ys.min() / UP, 1), round(x0 + (xs.max() + 1) / UP, 1),
            round(y0 + (ys.max() + 1) / UP, 1), int(round(lo)), int(round(hi))]


if __name__ == "__main__":
    for a in sys.argv[1:]:
        lab, p = a.split("=", 1)
        img = cv2.imread(p, cv2.IMREAD_COLOR)
        print(lab, {k: box(img, w) for k, w in WIN.items()})
