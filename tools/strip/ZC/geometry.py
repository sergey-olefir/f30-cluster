"""Package ZC: the panel's outline (arc rail, tips, fill), the centre hooks and notches, the rail ends, from the
ridges in bake/work/strip/zone-c/atlas_raw.json and the 4x zone crops. Writes bake/work/strip/zone-c/geometry.json.
Run after atlas.py (same uv line).
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402
from atlas import fit_circle, black_of  # noqa: E402

RAW = json.load(open(os.path.join(Z.WORK, 'zone-c', 'atlas_raw.json')))
MSG = ['62', '66']
NOMSG = ['61', '63', '64', '65', '67', '68']


def arc_points(pid, lo=696, hi=1226, ymax=630):
    pts = []
    for x, rs in RAW[pid]['ridges']:
        if lo <= x <= hi:
            r = [a for a in rs if a['c'] < ymax and a['bot'] - a['top'] < 8]
            if r:
                a = min(r, key=lambda a: a['c'])
                pts.append((x, a['c'], a['top'], a['bot'], a['peak']))
    return np.array(pts)


def hook_points(pid, lo, hi):
    pts = []
    for x, rs in RAW[pid]['ridges']:
        if lo <= x <= hi:
            r = [a for a in rs if 606 < a['c'] < 652 and a['bot'] - a['top'] < 12]
            if r:
                a = max(r, key=lambda a: a['peak'])
                pts.append((x, a['c'], a['top'], a['bot'], a['peak']))
    return np.array(pts)


def tips(p, plateau, frac=0.5):
    """First/last x whose peak exceeds frac * plateau (the tip is where the tapered rail is half as bright)."""
    ok = p[:, 4] - BK >= frac * (plateau - BK)
    xs = p[ok, 0]
    return float(xs.min()), float(xs.max())


def row_profile(Y, y0, y1, x0, x1):
    return Z.cut(Y, x0, y0, x1, y1).mean(0), x0 + (np.arange(int((x1 - x0) * Z.N)) + 0.5) / Z.N


def crossings(prof, xs, half):
    out = []
    s = prof > half
    for i in range(1, len(prof)):
        if s[i] != s[i - 1]:
            t = xs[i - 1] + (half - prof[i - 1]) / (prof[i] - prof[i - 1]) * (xs[i] - xs[i - 1])
            out.append((round(float(t), 2), 'up' if s[i] else 'down'))
    return out


res = {}
for pid in MSG + NOMSG:
    rgb, tag = Z.load(pid)
    Y = Z.lum(rgb)
    BK = black_of(Y)
    e = {'source': tag, 'black_Y': round(BK, 5)}
    # white reference: the stock white text of this photo (message text, road label or odometer), 99.5th pct
    if pid in MSG:
        wbox = (815, 615, 1125, 695)
    else:
        wbox = (790, 662, 1132, 712)
    W = float(np.percentile(Z.cut(Y, *wbox), 99.5))
    e['white_text_Y'] = round(W, 4)
    # rows on the main rail line: where do the speedo rail and the tacho rail end?
    rows = {}
    for yy in (643.5, 644.5, 645.5, 646.5, 647.5, 648.5, 649.5):
        pl, xl = row_profile(Y, yy, yy + 1, 670, 712)
        pr, xr = row_profile(Y, yy, yy + 1, 1210, 1250)
        pk = float(np.percentile(np.r_[pl[:40], pr[-40:]], 90))
        half = BK + (pk - BK) / 2
        rows[str(yy + 0.5)] = {'left': crossings(pl, xl, half), 'right': crossings(pr, xr, half), 'plateau': round(pk, 4)}
    e['rail_rows'] = rows
    if pid in MSG:
        p = arc_points(pid)
        flat = p[(p[:, 0] >= 770) & (p[:, 0] <= 1150)]
        plateau = float(np.median(flat[:, 4]))
        u = flat[:, 0] - 960
        c2, c1, c0 = np.polyfit(u, flat[:, 1], 2)
        e['arc'] = {
            'centre_y_at_960': round(float(c0), 3), 'tilt_px_per_100px': round(float(c1 * 100), 3),
            'sag_coeff': float(c2), 'sag_over_380px': round(float(c2 * 190 ** 2), 3),
            'fwhm_flat': round(float(np.median(flat[:, 3] - flat[:, 2])), 3),
            'top50_flat': round(float(np.median(flat[:, 2])), 3), 'bot50_flat': round(float(np.median(flat[:, 3])), 3),
            'plateau_Y': round(plateau, 4), 'plateau_rel_white': round((plateau - BK) / (W - BK), 3),
        }
        lt, rt = tips(p, plateau, 0.5)
        lt2, rt2 = tips(p, plateau, 0.1)
        e['arc']['tips_x_50pct'] = [lt, rt]
        e['arc']['tips_x_10pct'] = [lt2, rt2]
        yat = lambda x: float(np.interp(x, p[:, 0], p[:, 1]))  # noqa: E731
        e['arc']['tip_y'] = [round(yat(lt), 2), round(yat(rt), 2)]
        L = p[(p[:, 0] >= 714) & (p[:, 0] <= 752)]
        R = p[(p[:, 0] >= 1168) & (p[:, 0] <= 1208)]
        e['arc']['shoulder_circle_left_cx_cy_r_rms'] = fit_circle(L[:, :2])
        e['arc']['shoulder_circle_right_cx_cy_r_rms'] = fit_circle(R[:, :2])
        # where the flat part ends: centre-y deviates from the flat fit by > 0.25 px
        dev = p[:, 1] - np.polyval([c2, c1, c0], p[:, 0] - 960)
        inner = p[(dev < 0.25) & (p[:, 0] > 740) & (p[:, 0] < 1180), 0]
        e['arc']['flat_x'] = [float(inner.min()), float(inner.max())]
        e['arc']['polyline_every_2px'] = [[float(a), round(float(b), 2), round(float(c), 2), round(float(d), 2),
                                           round(float((pk - BK) / (plateau - BK)), 2)]
                                          for a, b, c, d, pk in p if (a * 2) % 4 == 1]
        # fill: in units of white text, clean columns
        cols = {}
        for x in (712, 720, 730, 745, 765, 790, 1140, 1160, 1180, 1195, 1205, 1212):
            c = Z.cut(Y, x, 596, x + 2, 720).mean(1).reshape(-1, Z.N).mean(1)
            cols[str(x + 1)] = [round(float((v - BK) / (W - BK)), 4) for v in c]
        e['fill_columns_rel_white_y596_719'] = cols
        # fill rows (x 690..1240 each px)
        rws = {}
        for yy in (610, 613, 616, 620, 625, 630, 640, 650, 660, 670, 680, 690, 700, 710):
            r = Z.cut(Y, 690, yy, 1240, yy + 1).mean(0).reshape(-1, Z.N).mean(1)
            rws[str(yy + 0.5)] = [round(float((v - BK) / (W - BK)), 4) for v in r]
        e['fill_rows_rel_white_x690_1239'] = rws
    else:
        e['hook_l'] = hook_points(pid, 697, 762).round(3).tolist()
        e['hook_r'] = hook_points(pid, 1158, 1224).round(3).tolist()
    res[pid] = e
    print(pid, tag, 'black %.4f white %.3f' % (BK, W))
    if 'arc' in e:
        print('   arc', {k: v for k, v in e['arc'].items() if k != 'polyline_every_2px'})
    print('   rail rows', {k: (v['left'], v['right']) for k, v in rows.items()})
json.dump(res, open(os.path.join(Z.WORK, 'zone-c', 'geometry.json'), 'w'))
