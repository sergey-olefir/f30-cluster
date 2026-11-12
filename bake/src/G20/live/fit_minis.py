"""Package D, step 3: the fuel and oil-temperature mini needles (rect 08, 09, 14).

  tools/g20sim/D/py bake/src/G20/live/fit_minis.py   -> bake/work/g20sim/D/fit_minis.json

The mini needles are tapered red bars anchored on the mini's outer frame. Guided ridge fits on the 'redness' R - G
(the needle is red, the lit fill under it is pinkish-white, the face is dark). The scale lines inside the fuel mini
(hand-picked on the 4x crops, +-1.5 px) and the needles give each mini's virtual centre (the needles are rays from it,
like the big pointers). The oil mini is the fuel mini mirrored about x = 960 (frame ticks, zones and the needle at its
cold end in 14 all sit at the mirrored spots, +-3 px).
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common_live import SCRATCH, bar_fit, lsq_point, rect  # noqa: E402

GUESS = {
    ('08', 'fuel'): ((24, 486), (106, 473)), ('09', 'fuel'): ((24, 480), (106, 470)), ('14', 'fuel'): ((24, 484), (106, 474)),
    ('08', 'oil'): ((1866, 577), (1785, 552)), ('09', 'oil'): ((1866, 577), (1785, 552)), ('14', 'oil'): ((1800, 637), (1735, 612)),
}
# fuel mini: frame ticks (outer frame, white) and the dark scale lines inside the lit fill, from the 4x crops of 08/09
FUEL_TICKS = {'0.75': (18, 505), '0.5': (45, 576), '0.25': (90, 626)}
FUEL_LINES = {'0.75': ((30, 502), (75, 495)), '0.5': ((37, 571), (75, 567)), '0.25': ((100, 620), (175, 604)),
              'bottom': ((130, 635), (200, 620))}


def main():
    out = {'needles': {}}
    for (ph, m), (po, pi) in GUESS.items():
        rgb = rect(ph)
        red = rgb[..., 0] - rgb[..., 1]
        r = bar_fit(rgb, po, pi, half=10, chan=red)
        # width at the anchor end vs the tip end: FWHM over the first / last 25 %
        out['needles'][ph + '.' + m] = r
        print('%s %-4s outer (%.1f, %.1f) inner (%.1f, %.1f) len %.1f fwhm %.1f ang %.1f resid %.2f' % (
            ph, m, *r['outer'], *r['inner'], r['length'], r['fwhm'], r['angle_from_vertical'], r['resid_px']))
        # colour of the needle core: mean over the middle of the bar
        o, i = np.array(r['outer']), np.array(r['inner'])
        cols, wids = [], []
        for f in np.linspace(0.1, 0.9, 9):
            p = o + (i - o) * f
            x, y = int(round(p[0])), int(round(p[1]))
            cols.append(rgb[y - 1:y + 2, x - 1:x + 2].reshape(-1, 3).max(0))
        r['core_rgb_along'] = np.array(cols).round(0).tolist()
    lines = [(np.array(v['outer']), np.array(v['dir'])) for k, v in out['needles'].items() if k.endswith('fuel')]
    lines += [(np.array(a, float), np.array(b, float) - np.array(a, float)) for a, b in FUEL_LINES.values()]
    X, res = lsq_point(lines)
    print('fuel virtual centre (%.1f, %.1f), dists %s' % (X[0], X[1], ['%.1f' % v for v in res]))
    out['fuel_centre'] = X.tolist()
    out['fuel_centre_dists'] = res
    ol = [(np.array(v['outer']), np.array(v['dir'])) for k, v in out['needles'].items() if k.endswith('oil')]
    Xo, reso = lsq_point(ol)
    print('oil needles 08/09/14 meet at (%.1f, %.1f) dists %s; mirror of the fuel centre (%.1f, %.1f)' % (
        Xo[0], Xo[1], ['%.1f' % v for v in reso], 1920 - X[0], X[1]))
    out['oil_centre_direct'] = Xo.tolist()
    json.dump(out, open(os.path.join(SCRATCH, 'fit_minis.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
