"""P10 step 4: the level correction, one shared transform for every package.

Every package fitted its colours to P0's exposure-normalised crops: out = (in - black_P0) * gain * wb (sRGB CODE values,
black_P0 = the 5th percentile of 1.0-1.08 R, white -> 235). This module maps such a P0-normalised code value c back to
the reference's own light and re-expresses it as LINEAR light above that reference's own LCD floor, relative to its
white numerals, so that the panel's linear value equals it (white stays at 235):

    raw_c  = c / (gain * wb_c) + black_P0                                   (undo P0; sRGB code of the photo)
    L_c    = (lin(raw_c) - lin(F_c)) / (lin(W_c) - lin(F_c)),  clipped at 0    (F: LCD floor, W: P0's white)
    c'_c   = 255 * srgb(L_c * lin(235 / 255))

F (floors.json, P10.floors): the darkest display content of that photo (min of the groove floor between the ticks
and the face's 10th percentile, per channel) plus the local veiling-glare offset of the region the element sits in
(groove samples on the window side, the outer side or the dial itself).

A package's levels came from one or a few references (their params / reports). SOURCES says which; with several, the
curves are averaged in code value (05 / 04 / 03 for the faces). The curve is applied to the colour of every albedo /
glow / highlight layer; shadow layers (black + alpha) and coverage masks are left alone (alpha is a ratio, not a level).
"""
import json, os
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
FLOORS = os.path.join(ROOT, 'bake', 'work', 'P10', 'floors.json')
WHITE_TARGET = 235.0

# where each package's levels came from: (floors.json key, region)
SOURCES = {
    'C1': [('05_comfort_tach-closeup', 'C2'), ('04_comfort_whole-cluster_mph', 'C1'), ('03_three-modes_photo_bimmerstop', 'C1')],
    'C2': [('05_comfort_tach-closeup', 'C2'), ('04_comfort_whole-cluster_mph', 'C2'), ('03_three-modes_photo_bimmerstop', 'C2')],
    'C3': [('04_comfort_whole-cluster_mph', 'outer')],
    'C4': [('04_comfort_whole-cluster_mph', 'outer')],
    # C5 / C6 are built in FINAL panel values (C5.target / C5.fit: light above each reference's own local floor,
    # numerals at the theme's text white), so their curve is the identity: P10.apply must not re-curve them.
    # (The earlier 'window-fit' curve, window_fit() below, is kept for the record; nothing uses it.)
    'C5': 'identity',
    'C6': 'identity',
    'C7': [('04_comfort_whole-cluster_mph', 'outer')],
    'C8-sport': [('03_three-modes_photo_bimmerstop@sport', 'C1'), ('03_three-modes_photo_bimmerstop@sport', 'C2')],
    'C8-eco': [('03_three-modes_photo_bimmerstop@eco', 'C1'), ('03_three-modes_photo_bimmerstop@eco', 'C2')],
    'C10': [('02_three-modes_clean-render', 'render')],
}


def s2l(c):
    c = np.asarray(c, np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    c = np.clip(np.asarray(c, np.float64), 0, 1)
    return 255.0 * np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


_F = None


def floors():
    global _F
    if _F is None:
        _F = json.load(open(FLOORS))
    return _F


def floor_of(ref, region):
    """Per-channel LCD floor (sRGB code of the photo) for a reference and region (see module doc)."""
    if region == 'render':
        return np.zeros(3)
    r = floors()[ref]
    reg = r['floor_by_region_rgb_code']
    groove_all = np.array(r['lcd_floor_rgb_code'])
    face = [d['face_upper_p10_rgb'] for k, d in r['dials'].items() if k in ('C1', 'C2') and 'face_upper_p10_rgb' in d]
    base = np.minimum(groove_all, np.min(np.array(face), 0)) if face else groove_all
    glare = np.array(reg.get(region) or r['lcd_floor_rgb_code']) - groove_all     # the region's veiling-glare offset
    return np.maximum(base + glare, 0.0)


def p0(ref):
    r = floors()[ref]
    return r['p0_black_luma'], r['p0_gain'], np.array(r['p0_wb'], np.float64)


def curve_one(ref, region, c):
    """c: (..., 3) P0-normalised code values -> corrected panel code values (float)."""
    c = np.asarray(c, np.float64)
    if region == 'render':
        b, g, wb = p0(ref)
        F = np.zeros(3)
    else:
        b, g, wb = p0(ref)
        F = floor_of(ref, region)
    raw = c / (g * wb) + b
    W = WHITE_TARGET / (g * wb) + b
    L = (s2l(raw) - s2l(F)) / np.maximum(s2l(W) - s2l(F), 1e-6)
    return l2s(np.maximum(L, 0.0) * s2l(WHITE_TARGET))


WINDOW_LEVELS = os.path.join(ROOT, 'bake', 'work', 'P10', 'window_levels.json')
Y = np.array([0.2126, 0.7152, 0.0722])


def window_fit(c):
    """C5 / C6: one luminance curve (hue kept), piecewise linear in linear light through
    (0, 0), (17's sky -> the median sky of 04/03/07/06), (17's lit floor band -> their median), (235 -> 235)."""
    w = json.load(open(WINDOW_LEVELS))
    a = [(0.0, 0.0)]
    for k in ('sky', 'floor'):
        a.append((float(s2l(np.array(w['p4_17_code'][k])) @ Y), float(s2l(np.array(w['target_panel_code'][k])) @ Y)))
    a.append((float(s2l(WHITE_TARGET)), float(s2l(WHITE_TARGET))))
    a.append((1.0, 1.0))
    xs, ys = zip(*a)
    c = np.asarray(c, np.float64)
    lin = s2l(c)
    yl = lin @ Y
    k = np.interp(yl, xs, ys) / np.maximum(yl, 1e-9)
    return l2s(lin * k[..., None])


def curve(cluster, c):
    srcs = SOURCES[cluster]
    if srcs == 'identity':
        return np.asarray(c, np.float64).copy()
    if srcs == 'window-fit':
        return window_fit(c)
    return np.mean([curve_one(ref, reg, c) for ref, reg in srcs], axis=0)


def lut(cluster, n=256):
    """(n, 3) table over code values 0..255 (float output)."""
    x = np.repeat(np.linspace(0, 255, n)[:, None], 3, 1)
    return curve(cluster, x)


def describe():
    out = {}
    for cl, srcs in SOURCES.items():
        if srcs == 'identity':
            out[cl] = {'sources': 'identity: built in final panel values by C5.fit (BAKE-P10-levels.md 4)', 'map_code': {}}
            continue
        if srcs == 'window-fit':
            d = {'sources': 'window-fit: luminance curve through 17 sky / floor band -> median of 04, 03, 07, 06 (window_levels.json)'}
            pts = [2, 5, 8, 12, 17, 25, 35, 50, 75, 110, 150, 200, 235, 255]
            L = curve(cl, np.repeat(np.array(pts, np.float64)[:, None], 3, 1))
            d['map_code'] = {str(p): [round(float(v), 1) for v in L[i]] for i, p in enumerate(pts)}
            out[cl] = d
            continue
        d = {'sources': [{'ref': r, 'region': g, 'floor_rgb_code': (floor_of(r, g).round(1).tolist() if g != 'render' else [0, 0, 0]),
                          'p0_black_luma': p0(r)[0], 'p0_gain': p0(r)[1]} for r, g in srcs]}
        pts = [2, 5, 8, 12, 17, 25, 35, 50, 75, 110, 150, 200, 235, 255]
        L = curve(cl, np.repeat(np.array(pts, np.float64)[:, None], 3, 1))
        d['map_code'] = {str(p): [round(float(v), 1) for v in L[i]] for i, p in enumerate(pts)}
        out[cl] = d
    return out


if __name__ == '__main__':
    d = describe()
    json.dump(d, open(os.path.join(ROOT, 'bake', 'work', 'P10', 'levels_curves.json'), 'w'), indent=1)
    for cl, v in d.items():
        print(cl, v['sources'] if isinstance(v['sources'], str) else [(s['ref'][:2] + ('@' + s['ref'].split('@')[1] if '@' in s['ref'] else ''), s['region'], s['floor_rgb_code']) for s in v['sources']])
        print('   ', {k: v['map_code'][k] for k in ('5', '8', '12', '17', '25', '50', '110', '235')})
