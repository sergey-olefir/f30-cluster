"""P10: the window's levels (C5 / C6) re-fitted across references.

P4 fitted the window model's absolute levels to 17 (P0-normalised), whose glass haze (LCD floor ~ 50-60 code) sits at
the window sky's own level, so 17 alone cannot say how far the sky is above the display black. Here each comfort
reference's window is measured in its own light, above its own window-side floor (floors.json), relative to its white:
  sky   = window upper middle (panel-frame C5 crop rows 100-300, x 150-410), median
  floor = the lit floor band, rows 430-560, the 90th percentile (the bright bars)
and 17's P0-normalised codes for the same boxes are what P4's model drew. The C5 / C6 curve then maps 17-code to the
median target over the references (BAKE-P10-levels.md 4.2).
    ./P10/py.sh -m P10.window
"""
import json, os
import cv2
import numpy as np
from P10 import levels as LV

ROOT = LV.ROOT
RECT = os.path.join(ROOT, 'bake', 'work', 'rect')
OUT = os.path.join(ROOT, 'bake', 'work', 'P10')
REFS = ['17_physical-cluster_full', '04_comfort_whole-cluster_mph', '03_three-modes_photo_bimmerstop',
        '07_physical-cluster_all-lamps-lit', '06_comfort_wide_with-wheel']
BOXES = {'sky': (150, 100, 410, 300, 50), 'floor': (150, 430, 410, 560, 90)}


def measure(stem, raw=True):
    a = cv2.imread(os.path.join(RECT, '%s.comfort.C5.%spng' % (stem, 'raw.' if raw else '')))[..., ::-1].astype(np.float64)
    bits = cv2.imread(os.path.join(RECT, '%s.comfort.C5.maskbits.png' % stem), cv2.IMREAD_UNCHANGED)
    out = {}
    for k, (x0, y0, x1, y1, q) in BOXES.items():
        m = bits[y0:y1, x0:x1] == 0
        v = a[y0:y1, x0:x1][m]
        lum = v @ np.array([0.2126, 0.7152, 0.0722])
        sel = v[lum >= np.percentile(lum, q - 5)] if q > 50 else v
        sel = sel[(sel @ np.array([0.2126, 0.7152, 0.0722])) <= np.percentile(lum, min(q + 5, 100))] if q > 50 else sel
        out[k] = np.median(sel, 0)
    return out


def main():
    res = {}
    for st in REFS:
        F = LV.floor_of(st, 'window')
        b, g, wb = LV.p0(st)
        W = LV.WHITE_TARGET / (g * wb) + b
        m = measure(st)
        d = {'floor_rgb_code': F.tolist()}
        for k, v in m.items():
            L = (LV.s2l(v) - LV.s2l(F)) / (LV.s2l(W) - LV.s2l(F))
            d[k] = {'raw_rgb': v.round(1).tolist(), 'L_rel': L.round(5).tolist(),
                    'panel_code': LV.l2s(np.maximum(L, 0) * LV.s2l(LV.WHITE_TARGET)).round(1).tolist()}
        res[st] = d
    m17 = measure(REFS[0], raw=False)
    tgt = {k: np.median(np.array([res[s][k]['L_rel'] for s in REFS[1:]]), 0) for k in BOXES}
    res['target_median_L_rel_04_03_07_06'] = {k: v.round(5).tolist() for k, v in tgt.items()}
    res['target_panel_code'] = {k: LV.l2s(np.maximum(v, 0) * LV.s2l(LV.WHITE_TARGET)).round(1).tolist() for k, v in tgt.items()}
    res['p4_17_code'] = {k: v.round(1).tolist() for k, v in m17.items()}
    json.dump(res, open(os.path.join(OUT, 'window_levels.json'), 'w'), indent=1)
    for s in REFS:
        print('%-34s floor %s  sky raw %s -> panel %s | floor-band raw %s -> panel %s' % (s, np.round(res[s]['floor_rgb_code']), res[s]['sky']['raw_rgb'], res[s]['sky']['panel_code'], res[s]['floor']['raw_rgb'], res[s]['floor']['panel_code']))
    print('target panel code (median 04/03/07/06):', res['target_panel_code'])
    print('17 P0-normalised (what P4 fitted):', res['p4_17_code'])


if __name__ == '__main__':
    main()
