"""Package T: calibrate the ink dilation of photo 60 on OUR text, whose geometry is known exactly.

Photo 60 is our calibration grid theme (apps/f30_cluster/hud/layouts/grid.json) over the stock cluster, shot the same
day and with the same phone as 61-67. Its yellow grid labels ("<x>/<y>", font "head" = Barlow Condensed SemiBold 24,
apps/f30_cluster/hud/fonts/head.json) are, in the red channel, as saturated as BMW's white text (flat-topped stroke
profile, plateau 0.92 linear), and its white "L<n>" labels are not (plateau ~0.6). Each digit's measured height,
ink width and stem against the atlas's (coverage 0.5, and also the light a gamma-space blend emits, coverage^2.2)
gives the dilation per edge b = (measured - true) / 2.

Writes bake/work/strip/T/calib60.json: b for saturated ink (the median over height, width and stem of the yellow
labels' digits) and for unsaturated ink (the L labels' cap and digits), with their spread.

    uv run ... python -I tools/strip/T/calib60.py
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import glyphs as G  # noqa: E402
import ours as O  # noqa: E402

# label boxes over black panel (strip row y 600: "800/600" .. "1100/600"), and the white L-label row
YELLOW = [('800/600', [797, 600, 880, 628]), ('900/600', [897, 600, 980, 628]),
          ('1000/600', [997, 600, 1092, 628]), ('1100/600', [1097, 600, 1192, 628])]
WHITE = [('L%d' % i, [700 + 64 * (i - 1) + 2, 252, 700 + 64 * (i - 1) + 58, 290]) for i in range(1, 17)]


def meas(text, box, ink):
    r = G.field('60', box, 8, ink)
    gl = [g for g in r['glyphs'] if not ((g['x1'] - g['x0']) < 3.2 and (g['y1'] - g['y0']) > 20)]   # grid lines
    gl = [g for g in gl if (g['y1'] - g['y0']) > 6]
    cs = [c for c in text]
    if len(gl) != len(cs):
        return None, r['model'], r['plateau']
    return list(zip(cs, gl)), r['model'], r['plateau']


def main():
    out = {'photo': '60'}
    for gamma in (1.0, 2.2):
        truth = O.atlas('head', gamma)['glyphs']
        for kind, labels, ink in (('saturated', YELLOW, 'red'), ('unsaturated', WHITE, 'white')):
            bs = {'h': [], 'w': [], 'stem': []}
            plats = []
            used = 0
            for text, box in labels:
                pr, model, plat = meas(text, box, ink)
                if not pr:
                    continue
                used += 1
                plats.append(plat)
                for c, g in pr:
                    t = truth.get(c)
                    if not t or 'top' not in t or c == '/':
                        continue
                    bs['h'].append(((g['y1'] - g['y0']) - (t['bottom'] - t['top'])) / 2)
                    bs['w'].append(((g['x1'] - g['x0']) - (t['ink_r'] - t['ink_l'])) / 2)
                    if g['stem_h'] and t.get('stem_h') and c in '1L':
                        bs['stem'].append((g['stem_h'] - t['stem_h']) / 2)
            allb = bs['h'] + bs['w'] + bs['stem']
            key = '%s_g%.1f' % (kind, gamma)
            out[key] = {'labels_used': used, 'plateau': float(np.median(plats)) if plats else None,
                        'b_h': float(np.median(bs['h'])) if bs['h'] else None,
                        'b_w': float(np.median(bs['w'])) if bs['w'] else None,
                        'b_stem': float(np.median(bs['stem'])) if bs['stem'] else None,
                        'b': float(np.median(allb)) if allb else None,
                        'spread': float(np.std(allb)) if allb else None, 'n': len(allb), 'model': model}
            print(key, out[key])
    out['b_saturated'] = out['saturated_g1.0']['b']
    out['b_unsaturated'] = out['unsaturated_g1.0']['b']
    out['note'] = ('b in panel px per edge, measured minus true over 2; truth = our atlas at coverage 0.5 (g1.0) or '
                   'the emitted light of a gamma-space blend (g2.2). Use g1.0 to compare with our atlases measured at '
                   'coverage 0.5 (tools/strip/T/ours.py, gamma 1).')
    p = os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'calib60.json')
    json.dump(out, open(p, 'w'), indent=1)
    print('->', p)


if __name__ == '__main__':
    main()
