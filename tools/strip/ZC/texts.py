"""Package ZC: text fields of zone C (message lines, symbol, road label, standby odometer and its ghost in 63).
Boxes, baselines, heights, word groups and anchors only; no text content is read or written.
Writes bake/work/strip/zone-c/texts.json. Run after atlas.py (same uv line).
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402
from atlas import ink, lines_of, union, black_of  # noqa: E402


def words(comps, gap):
    cs = sorted(comps, key=lambda c: c[0])
    out = []
    for c in cs:
        if out and c[0] - out[-1][-1][2] < gap:
            out[-1].append(c)
        else:
            out.append([c])
    return out


def metrics(comps, dot_h=8.0):
    """Baseline = median bottom of the components within 1.5 px of the commonest bottom; x-top likewise for tops;
    tall-top = median top of the components that start > 2 px above x-top and are taller than dot_h (no dots)."""
    b = np.array([c[3] for c in comps])
    t = np.array([c[1] for c in comps])
    h = b - t
    big = h > dot_h
    vals, cnt = np.unique(np.round(b[big] * 2) / 2, return_counts=True)
    mode = vals[cnt.argmax()]
    base = float(np.median(b[big][np.abs(b[big] - mode) <= 1.5]))
    tv, tc = np.unique(np.round(t[big] * 2) / 2, return_counts=True)
    xt = float(np.median(t[big][np.abs(t[big] - tv[tc.argmax()]) <= 1.5]))
    tall = big & (t < xt - 2)
    u = union(comps)
    m = {'box': u, 'width': round(u[2] - u[0], 2), 'centre_x': round((u[0] + u[2]) / 2, 2),
         'left_x': u[0], 'right_x': u[2], 'baseline': round(base, 2), 'x_top': round(xt, 2),
         'x_height': round(base - xt, 2), 'glyph_components': int(big.sum()), 'dot_components': int((~big).sum()),
         'bottom_max': round(float(b.max()), 2)}
    if tall.any():
        m['tall_top'] = round(float(np.median(t[tall])), 2)
        m['tall_height'] = round(base - m['tall_top'], 2)
        m['tall_count'] = int(tall.sum())
    return m


res = {}
for pid in ['62', '66', '61', '64', '67', '68', '65', '63']:   # 60: our grid lines cross the label
    rgb, tag = Z.load(pid)
    Y = Z.lum(rgb)
    bk = black_of(Y)
    e = {'source': tag, 'black_Y': round(bk, 5)}
    if pid in ('62', '66'):
        sym, w = ink(Y, (712, 622, 764, 692), bk)
        u = union(sym)
        e['symbol'] = {'box': u, 'centre': [round((u[0] + u[2]) / 2, 2), round((u[1] + u[3]) / 2, 2)],
                       'size': [round(u[2] - u[0], 2), round(u[3] - u[1], 2)], 'parts': len(sym)}
        txt, wt = ink(Y, (765, 612, 1200, 712), bk)
        txt = [c for c in txt if c[3] - c[1] > 1.5 or c[2] - c[0] > 1.5]
        lines = lines_of(txt, gap=8.0)
        lines = [l for l in lines if len(l) > 3]
        e['lines'] = [metrics(l) for l in lines]
        e['white_Y'] = round(wt, 4)
    elif pid in ('61', '64', '67', '68'):
        box = (700, 664, 1222, 716)
        comps, wt = ink(Y, box, bk)
        e['road'] = metrics(comps)
        e['white_Y'] = round(wt, 4)
    elif pid == '65':
        comps, wt = ink(Y, (760, 655, 1215, 716), bk)
        e['odometer'] = metrics(comps)
        e['odometer_words'] = [metrics(wd) | {'n': len(wd)} for wd in words(comps, 9.0)]
        e['white_Y'] = round(wt, 4)
    elif pid == '63':
        # the ghost: threshold against its own peak, report its peak relative to the photo's stock white
        # (the marker "i" right of the panel and the rails: 99.5th pct of the rail line rows)
        white = float(np.percentile(Z.cut(Y, 600, 643, 690, 650), 99.5))
        sub = Z.cut(Y, 780, 655, 1100, 712)
        comps, wt = ink(Y, (780, 655, 1100, 712), bk, frac=0.5)
        e['ghost'] = metrics(comps)
        e['ghost_words'] = [metrics(wd) | {'n': len(wd)} for wd in words(comps, 9.0)]
        e['ghost_peak_Y'] = round(float(np.percentile(sub, 99.8)), 5)
        e['white_ref_Y_rails'] = round(white, 4)
        e['ghost_peak_rel_white'] = round((e['ghost_peak_Y'] - bk) / (white - bk), 4)
    res[pid] = e
    print(pid, tag, json.dumps({k: v for k, v in e.items() if k not in ('source',)}))
json.dump(res, open(os.path.join(Z.WORK, 'zone-c', 'texts.json'), 'w'), indent=1)
