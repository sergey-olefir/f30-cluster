"""Package ZL: the stock atlas of zone L (x 0-700 of the STRIP, y 540-720) - every lit thing, per photo.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy --with scipy \
        python -I tools/strip/ZL/atlas.py 61 62 63 64 65 66 67 68

Per photo: the zone (panel [0, 536, 704, 720], continuous coords) is warped at 4x through ZL's local model (or R's
when --hjson is given), sRGB-decoded to linear light. The display's black is the 20th percentile of luminance in
dark corridors of the zone (rows y 708-718 between the items, and x 0-120 below the fuel mini); the ink threshold
is local: half-way between that black and the 98th percentile of the element's own box ("half level after local
black subtraction"). Channels: white ink = luminance with low chroma; red ink = R - max(G, B).

Elements (ids of design/overlay/g20_comfort.json, new ones per the brief 4.3), each from its search box:
  bottom.range (icon / digits / unit split by x gaps), bottom.clock, assist.speed_limit (ring, face, digits),
  assist.speed_foot (the "0 km/h" readout at the speedo's foot), bottom.belt_rear, bottom.belt_driver,
  bottom.airbag, rail.left (the speedo's bottom line in the zone), and the neighbours structure.speedo (ticks,
  numerals, needle at rest) and structure.fuel_mini.
For each: the ink bbox (sub-px: the 4x mask's extent / 4), the outer contour as a polygon in panel px (OpenCV
contour of the 4x mask, Douglas-Peucker at 0.25 panel px), the ink's colour (median linear RGB and sRGB of the
core: alpha > 0.8), the halo (mean luminance above black vs distance from the ink edge, 0-10 px, in units of
the ink's own level), and the 4x alpha (clip((v - black) / (ink - black))) saved to
bake/work/strip/zone-L/alpha/<id>_<photo>.png (photo-derived: never tracked).
Then the clear gaps between elements (min distance between their alpha > 0.5 pixels, in panel px) and the blobs
left over when every element (dilated by 2 px) is masked out: "unattributed light".
Writes bake/work/strip/zone-L/atlas_<photo>.json (numbers only).
"""
import json
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sign as S  # noqa: E402

ZD = S.ZD
N = 4
ZB = (0.0, 536.0, 704.0, 720.0)

# search boxes, continuous panel px; kind: 'w' white ink, 'r' red ink, 'ring' the sign
BOXES = {
    'bottom.range': ((126, 659, 342, 707), 'w'),
    'bottom.clock': ((338, 659, 462, 707), 'w'),
    'assist.speed_foot': ((362, 568, 488, 624), 'w'),
    'assist.speed_limit': ((493, 577, 585, 667), 'ring'),
    'bottom.belt_rear': ((496, 668, 584, 720), 'r'),
    'bottom.belt_driver': ((586, 660, 630, 720), 'r'),
    'bottom.airbag': ((630, 658, 690, 720), 'r'),
}


def lin_of(photo, hjson=None):
    lm, ph, e = S.load(photo, hjson)
    im = lm.warp(ph, ZB, N, cv2.INTER_CUBIC)
    return S.srgb_lin(im[..., ::-1]), lm


def P2I(x, y):
    return int(round((x - ZB[0]) * N)), int(round((y - ZB[1]) * N))


def sub(a, box):
    i0, j0 = P2I(box[0], box[1])
    i1, j1 = P2I(box[2], box[3])
    return a[j0:j1, i0:i1], (i0, j0)


def to_srgb8(v):
    v = np.clip(v, 0, 1)
    return [int(round(x)) for x in np.where(v <= 0.0031308, 12.92 * v, 1.055 * v ** (1 / 2.4) - 0.055) * 255]


def black_level(lum):
    vals = []
    for box in ((128, 708, 336, 718), (452, 708, 496, 718), (0, 660, 120, 718), (300, 655, 480, 662)):
        s, _ = sub(lum, box)
        vals.append(s.ravel())
    v = np.concatenate(vals)
    return float(np.percentile(v, 20)), float(np.percentile(v, 50)), float(np.percentile(v, 80))


def element(lin, lum, red, k, box, kind, black):
    chan = red if kind in ('r', 'ring') else lum
    s, (i0, j0) = sub(chan, box)
    if kind == 'w':
        # white ink: suppress red (the needle and glow) by requiring low chroma
        rgb, _ = sub(lin, box)
        chroma = rgb.max(2) - rgb.min(2)
        s = np.where(chroma < 0.5 * rgb.max(2) + 0.02, s, 0)
    b0 = black if kind == 'w' else float(np.percentile(s, 30))
    top = float(np.percentile(s, 99.0))
    if top - b0 < 0.02:
        return None
    alpha = np.clip((s - b0) / (top - b0), 0, 1)
    m = alpha > 0.5
    lab, n = ndi.label(m, np.ones((3, 3)))
    if n == 0:
        return None
    sizes = ndi.sum(m, lab, range(1, n + 1))
    keep = np.isin(lab, 1 + np.nonzero(sizes >= 6 * N * N / 4)[0])
    if not keep.any():
        return None
    if kind == 'ring':            # the sign: the red ring plus everything it encloses (face, digits)
        filled = ndi.binary_fill_holes(keep)
        alpha = np.where(filled & ~keep, 1.0, alpha)
        keep = filled
    ys, xs = np.nonzero(keep)
    bb = [ZB[0] + (i0 + xs.min()) / N, ZB[1] + (j0 + ys.min()) / N, ZB[0] + (i0 + xs.max() + 1) / N,
          ZB[1] + (j0 + ys.max() + 1) / N]
    cs, _ = cv2.findContours(keep.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    polys = []
    for c in cs:
        if cv2.contourArea(c) < 4 * N * N:
            continue
        a = cv2.approxPolyDP(c, 0.25 * N, True)[:, 0, :].astype(float)
        polys.append([[round(ZB[0] + (i0 + x + 0.5) / N, 2), round(ZB[1] + (j0 + y + 0.5) / N, 2)] for x, y in a])
    rgb, _ = sub(lin, box)
    core = keep & (alpha > 0.8)
    col = np.median(rgb[core], 0) if core.any() else np.median(rgb[keep], 0)
    # halo: distance from the ink edge (outside), mean (lum - black) / (ink lum - black)
    dist = ndi.distance_transform_edt(~keep) / N
    lsub, _ = sub(lum, box)
    ink_l = float(np.median(lsub[core])) if core.any() else float(np.median(lsub[keep]))
    halo = []
    for d0 in np.arange(0, 10, 0.5):
        sel = (dist > d0) & (dist <= d0 + 0.5)
        halo.append(round(float((np.mean(lsub[sel]) - black) / max(ink_l - black, 1e-4)), 4) if sel.any() else None)
    comps = []
    lab2, n2 = ndi.label(keep, np.ones((3, 3)))
    for sl in ndi.find_objects(lab2):
        comps.append([round(ZB[0] + (i0 + sl[1].start) / N, 2), round(ZB[1] + (j0 + sl[0].start) / N, 2),
                      round(ZB[0] + (i0 + sl[1].stop) / N, 2), round(ZB[1] + (j0 + sl[0].stop) / N, 2)])
    comps.sort()
    full = np.zeros(lum.shape, np.float32)
    full[j0:j0 + s.shape[0], i0:i0 + s.shape[1]] = alpha * keep_dil(keep)
    return {'bbox': [round(v, 2) for v in bb], 'polygons': polys, 'components': comps,
            'colour_linear': [round(float(v), 4) for v in col], 'colour_srgb8': to_srgb8(col),
            'ink_lum_linear': round(ink_l, 4), 'threshold': 'half level, black %.4f, ink p99 %.4f' % (b0, top),
            'halo_rel_by_halfpx': halo, 'ink_px_panel': round(float(keep.sum()) / N / N, 1)}, full


def keep_dil(keep):
    return cv2.dilate(keep.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)


def gaps(alphas):
    out = {}
    ks = sorted(alphas)
    for a in range(len(ks)):
        for b in range(a + 1, len(ks)):
            A, B = alphas[ks[a]] > 0.5, alphas[ks[b]] > 0.5
            if not A.any() or not B.any():
                continue
            d = ndi.distance_transform_edt(~A) / N
            g = float(d[B].min()) - 1.0 / N
            if g < 40:
                out[ks[a] + ' | ' + ks[b]] = round(g, 2)
    return out


REGIONS = [   # where an unattributed blob is given a neighbour's id (by its centroid), first match wins
    ('rail.left', (360, 638, 704, 657)),
    ('structure.fuel_mini', (0, 536, 222, 658)),
    ('structure.speedo', (150, 536, 520, 640)),
    ('rail.centre (zone C)', (690, 560, 704, 720)),
]


def region_of(cx, cy):
    for k, (x0, y0, x1, y1) in REGIONS:
        if x0 <= cx < x1 and y0 <= cy < y1:
            return k
    return 'UNEXPLAINED'


def leftovers(lin, lum, red, alphas, black, lo):
    m = np.zeros(lum.shape, bool)
    for a in alphas.values():
        m |= a > 0.02
    m = cv2.dilate(m.astype(np.uint8), np.ones((2 * N + 1, 2 * N + 1), np.uint8)) > 0
    lit = ((lum - black) > lo) | (red > lo)
    lit &= ~m
    lab, n = ndi.label(lit, np.ones((3, 3)))
    out = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        area = float((lab[sl] == i + 1).sum()) / N / N
        if area < 1.0:
            continue
        sel = lab[sl] == i + 1
        rgb = lin[sl][sel]
        yy, xx = np.nonzero(sel)
        cx, cy = ZB[0] + (sl[1].start + xx.mean() + 0.5) / N, ZB[1] + (sl[0].start + yy.mean() + 0.5) / N
        rid = region_of(cx, cy)
        near = [k for k, a in alphas.items() if (a[max(sl[0].start - 4 * N, 0):sl[0].stop + 4 * N,
                                                   max(sl[1].start - 4 * N, 0):sl[1].stop + 4 * N] > 0.02).any()]
        if rid == 'UNEXPLAINED' and near:
            rid = near[0] + ' (halo / anti-aliased rim, within 4 px)'
        out.append({'id': rid, 'centroid': [round(cx, 1), round(cy, 1)], 'box': [round(ZB[0] + sl[1].start / N, 1), round(ZB[1] + sl[0].start / N, 1),
                            round(ZB[0] + sl[1].stop / N, 1), round(ZB[1] + sl[0].stop / N, 1)],
                    'area_px': round(area, 1), 'peak_lum_above_black': round(float((lum[sl][sel] - black).max()), 4),
                    'colour_srgb8': to_srgb8(np.median(rgb, 0))})
    out.sort(key=lambda b: -b['area_px'])
    return out


def run(photo, hjson=None):
    lin, lm = lin_of(photo, hjson)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    red = lin[..., 0] - np.maximum(lin[..., 1], lin[..., 2])
    bl = black_level(lum)
    black = bl[0]
    res = {'photo': photo, 'model': 'R' if hjson else 'ZL-local (provisional)', 'zone_box': list(ZB), 'scale': N,
           'black_lum_linear_p20_p50_p80': [round(v, 5) for v in bl], 'elements': {}}
    alphas = {}
    os.makedirs(os.path.join(ZD, 'alpha'), exist_ok=True)
    for k, (box, kind) in BOXES.items():
        r = element(lin, lum, red, k, box, kind, black)
        if r is None:
            res['elements'][k] = None
            continue
        res['elements'][k], alphas[k] = r
        cv2.imwrite(os.path.join(ZD, 'alpha', '%s_%s.png' % (k, photo)), (alphas[k] * 255).astype(np.uint8))
    res['gaps_px'] = gaps(alphas)
    # stock white text level (for the seam unit): the range digits' ink
    wt = res['elements'].get('bottom.range')
    res['white_text_lum_linear'] = wt['ink_lum_linear'] if wt else None
    lo = 0.04 * (res['white_text_lum_linear'] or 0.5)
    res['unattributed'] = leftovers(lin, lum, red, alphas, black, lo)[:60]
    res['unattributed_threshold'] = 'lum - black > %.4f or redness > %.4f (4%% of white text), 2 px dilation' % (lo, lo)
    return res


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    hj = None
    if '--hjson' in sys.argv:
        hj = sys.argv[sys.argv.index('--hjson') + 1]
        args = [a for a in args if a != hj]
    for p in args:
        r = run(p, hj)
        json.dump(r, open(os.path.join(ZD, 'atlas_%s%s.json' % (p, '_R' if hj else '')), 'w'), indent=1)
        print(p, 'black', r['black_lum_linear_p20_p50_p80'], 'white', r['white_text_lum_linear'])
        for k, v in r['elements'].items():
            print('  ', k, None if v is None else (v['bbox'], v['colour_srgb8'], len(v['components'])))
        print('   gaps', r['gaps_px'])
        for u in r['unattributed'][:25]:
            print('     ', u['id'], u['box'], u['area_px'], u['peak_lum_above_black'], u['colour_srgb8'])
