"""Package ZR: BMW's tacho bottom rail (rail.right) on package R's strips: its centre line and half-max thickness
every 10 px along x where it runs flat, and the notch where it begins (x ~1224).

Usage: python -I rail.py [ids...]   -> prints JSON (numbers only)
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas as A  # noqa: E402


def main(ids):
    out = {}
    for k in ids:
        c = A.Crop(os.path.join(A.MAIN, 'bake/work/strip/rect/%s_strip_4x.png' % k), 0, 540, half=0.125)
        lum = c.lum
        rows = []
        for x in range(1230, 1601, 10):
            j = c.j(x)
            col = lum[c.i(632):c.i(664), j - 4:j + 4].mean(1)
            bg = np.median(col)
            col = col - bg
            pk = col.max()
            if pk <= 0:
                continue
            ii = np.arange(len(col))
            k0 = int(np.argmax(col))
            lo = k0
            while lo > 0 and col[lo - 1] > 0.5 * pk:
                lo -= 1
            hi = k0
            while hi < len(col) - 1 and col[hi + 1] > 0.5 * pk:
                hi += 1
            # sub-sample half-max crossings
            def cross(a, b):
                return a + (0.5 * pk - col[a]) / (col[b] - col[a]) if col[b] != col[a] else a
            top = cross(lo - 1, lo) if lo > 0 else lo
            bot = cross(hi, hi + 1) if hi < len(col) - 1 else hi
            y_top = c.cy(c.i(632) + top) - 0.125
            y_bot = c.cy(c.i(632) + bot) + 0.125
            sel = (ii >= lo) & (ii <= hi)
            yc = c.cy(c.i(632) + (col[sel] * ii[sel]).sum() / col[sel].sum())
            rows.append({'x': x, 'y_centre': round(float(yc), 2), 'y_top_50': round(float(y_top), 2),
                         'y_bottom_50': round(float(y_bot), 2), 'peak_rel_white': None})
        # the notch: along the rail's centre row, the dip between x 1210 and 1240
        yc = np.median([r['y_centre'] for r in rows[:6]])
        row = lum[c.i(yc) - 2:c.i(yc) + 3, c.j(1205):c.j(1245)].mean(0)
        jn = int(np.argmin(row))
        out[k] = {'samples': rows, 'notch_x': round(float(c.cx(c.j(1205) + jn)), 2),
                  'notch_depth_rel': round(float(row.min() / np.percentile(row, 90)), 3)}
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:] or ['61', '62', '63', '64', '66', '67', '68'])
