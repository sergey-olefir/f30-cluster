"""Acceptance 1 (package D): do the rendered stock pointers hit the scale marks at their values?

  tools/g20sim/D/py tools/g20sim/D/qc_ticks.py   (after shot.sh png/dom of the harness 'ticks' mode)

Fits each rendered bar on the headless-Chrome screenshot (bars only, over black), then for each value compares the
rendered bar axis with the tick measured on the photos (fit_scales.json, outer end of the tick):
  perp  = distance from the measured tick point to the rendered bar axis (px)
  along = distance along the tick ring between the measured tick and where the rendered axis crosses the ring (px)
"""
import html
import json
import os
import re
import sys

import cv2
import numpy as np

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, os.path.join(WT, 'bake', 'src', 'G20', 'live'))
from common_live import SCRATCH, bar_fit  # noqa: E402

H = os.path.join(SCRATCH, 'harness')


def main():
    dom = open(os.path.join(H, 'ticks.html')).read()
    res = json.loads(html.unescape(re.search(r'<pre id="out"[^>]*>(.*?)</pre>', dom, re.S).group(1)))
    img = cv2.imread(os.path.join(H, 'ticks.png'))[..., ::-1].astype(np.float32)
    fs = json.load(open(os.path.join(SCRATCH, 'fit_scales.json')))
    rows = []
    for which, key, scale in (('speed', 'speedo', 1.0), ('rpm', 'tacho', 1000.0)):
        T = fs['ticks'][key]
        ring = [np.array(T[k]['outer']) for k in T]
        for v, g in res[which]:
            r = bar_fit(img, g['tip'], g['tail'], half=8)
            o, d = np.array(r['outer']), np.array(r['dir'])
            n = np.array([-d[1], d[0]])
            tv = v / scale
            k = None
            for kk in T:
                if abs(float(kk) - tv) < 1e-6:
                    k = kk
            t = T[k]
            P = np.array(t['outer'])
            perp = float(abs(np.dot(P - o, n)))
            # crossing of the rendered axis with the ring polyline
            best = None
            for i in range(len(ring) - 1):
                a, c = ring[i], ring[i + 1]
                M = np.array([d, a - c]).T
                try:
                    s, u = np.linalg.solve(M, a - o)
                except np.linalg.LinAlgError:
                    continue
                lo_u = -0.6 if i == 0 else -0.01
                hi_u = 1.6 if i == len(ring) - 2 else 1.01
                if lo_u <= u <= hi_u:
                    X = a + (c - a) * u
                    if best is None or np.linalg.norm(X - P) < np.linalg.norm(best - P):
                        best = X
            along = float(np.linalg.norm(best - P)) if best is not None else None
            tip_err = float(np.linalg.norm(np.array(r['outer']) - np.array(g['tip'])))
            rows.append(dict(dial=which, value=v, tick=[round(float(P[0]), 1), round(float(P[1]), 1)], tick_src=t['src'],
                             tick_photos=t.get('photos'), rendered_cross=[round(float(best[0]), 1), round(float(best[1]), 1)] if best is not None else None,
                             perp=round(perp, 2), along=round(along, 2) if along is not None else None,
                             rendered_tip=[round(x, 1) for x in r['outer']], model_tip=[round(x, 1) for x in g['tip']],
                             tip_model_vs_render=round(tip_err, 2), width=round(r['fwhm'], 2)))
    print('%-6s %6s  %-16s %-12s %-16s %6s %6s' % ('dial', 'value', 'tick (photo)', 'src', 'rendered x ring', 'perp', 'along'))
    for r in rows:
        print('%-6s %6g  %-16s %-12s %-16s %6.2f %6.2f' % (r['dial'], r['value'], r['tick'], r['tick_src'], r['rendered_cross'], r['perp'], r['along']))
    print('max perp %.2f px, max along %.2f px' % (max(r['perp'] for r in rows), max(r['along'] for r in rows)))
    json.dump(rows, open(os.path.join(SCRATCH, 'qc_ticks.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
