"""Package ZR: the mask proposal for the right zone of the strip (x 1240-1920, y 540-720), per channel of the brief's
section 4.4, built from the measured numbers (atlas.py, R's frame), and its check against the stock light.

Shape convention: `polygon` is the 50 % line of OUR coverage (continuous panel px); our alpha reaches 0 at
`feather_in_px` inside a hole and 1 at `feather_out_px` outside it (a linear ramp through 0.5 on the polygon).
A `cover` shape is the reverse. Everything in the zone that no hole names is cover (alpha 1).

Writes design/strip/ZR/mask_proposal.json (shapes, the before/after numbers) and, git-ignored,
bake/work/strip/pub/ZR/preview_<channel>_zoneR_4x.png (16-bit grey, our alpha, O's 4x grid x 1240-1920).
"""
import json
import os

import cv2
import numpy as np

import atlas as A
import diff as D

# ---------------------------------------------------------------- the shapes (numbers from the atlas, R frame)
# temperature, widest case: sign's left ink 1511.5 (right-aligned number + 2 integer digits + sign; see report),
# digits' top 665.25-666.0, baseline 698.25-699.0, the C's right ink 1662.0-1663.5 (bloom photos 1665)
TEMP = [[1508.25, 662.0], [1666.75, 662.0], [1666.75, 702.5], [1508.25, 702.5]]
# mode label, theme position = standby position: COMFORT [1222.75, 656.6, 1356.4, 681.25],
# PLUS [1223.25, 684.6, 1289.6, 709.0]; the tacho rail's lower edge (50 %) at y ~651, its tail to 652.75 at 2 %
MODE = [[1220.0, 655.25], [1359.5, 655.25], [1359.5, 684.25], [1292.75, 684.25], [1292.75, 712.0], [1220.0, 712.0]]
MODE_WIDE = [[1220.0, 655.25], [1388.0, 655.25], [1388.0, 712.0], [1220.0, 712.0]]
# marker: the warning triangle [1243.25, 591.75, 1284.75, 627.5] (R 66, 67) united with the 'i'
# [1255.75, 591.25, 1270.5, 626.75] (R 62, 63); the polygon below is a first guess, main() replaces it with the
# convex hull of the measured outlines grown 3 px (a straight-sided triangle from the box corners was 1-2.6 px
# too narrow along the triangle's sides: its rounded corners sit inside the ideal vertices)
MARKER = [[1238.2, 630.5], [1252.75, 605.26], [1252.75, 588.25], [1262.56, 588.25], [1264.0, 585.75],
          [1265.44, 588.25], [1273.5, 588.25], [1273.5, 602.23], [1289.8, 630.5]]
RAIL_STUB = [[1222.0, 640.0], [1252.0, 640.0], [1252.0, 656.0], [1222.0, 656.0]]

SHAPES = [
    {'id': 'bottom.temperature', 'kind': 'hole', 'channels': ['bmw', 'bmw_msg', 'standby'], 'polygon': TEMP,
     'corner_radius_px': 4.0, 'feather_in_px': 1.25, 'feather_out_px': 1.25,
     'reason': 'BMW draws the outside temperature under a theme (60: our grid line x 1600 runs over its digits); '
               'it must show in allG20 and in standby. The hole is the widest value, not the string of the day.',
     'evidence': 'R 61-64, 66, 67 ink boxes; widest case from glyph metrics (report section 2.4); halo at 2 px from '
                 'the ink = 1.1-2.7 % of the ink peak, at 3 px 0.3-1.4 %',
     'clearance': {'rail.right (y ~651)': 11.0, 'assist.gear (x 1424.5)': 83.75, 'oil mini blue band': '> 20'}},
    {'id': 'assist.mode_label', 'kind': 'hole', 'channels': ['bmw', 'bmw_msg', 'standby'], 'polygon': MODE,
     'feather_in_px': 0.75, 'feather_out_px': 0.75,
     'reason': 'With a theme connected BMW moves the mode label into the row (60 = 10, 14, 17); it is drawn UNDER '
               'a theme (60: our grid line x 1300 runs over the F) and must show in allG20 and standby.',
     'evidence': 'theme position on R 60 (= 10) and R 14: C [1225.25, 657.25-657.5, 1240.5, 679.5-679.75], COMFORT '
                 'to x 1355.0, PLUS 686.0-708.25 to x 1290.0; standby R 65 / ZR 65 the same within 2.5 / 1.0 px; '
                 'H reads x 1223.2 on 17. The hole covers all of them.',
     'clearance': {'rail.right lower edge (y ~651) to the 0 % line': 3.5, 'cap top (656.6) to the 0 % line': 0.6,
                   'assist.gear (x 1395)': 35.5},
     'alternative': {'polygon': MODE_WIDE, 'why': 'only COMFORT / PLUS has been seen; a longer mode name would '
                                                  'need up to x 1388 (gear at 1395). Costs nothing in bmw: BMW '
                                                  'draws only black there.'}},
    {'id': 'assist.info_tacho', 'kind': 'hole', 'channels': ['bmw', 'bmw_msg', 'standby?', 'ours?'], 'polygon': MARKER,
     'feather_in_px': 1.0, 'feather_out_px': 1.0,
     'reason': 'BMW\'s messages-present marker ("i" or warning triangle) outlives the message (63, 67); it is drawn '
               'UNDER a theme (43: our 0.7.7 paint clips its lower corners; 56 / 58: absent under our cover with a '
               'warning message up). In ours it stays open unless package X draws our own marker (X e).',
     'evidence': 'R 62, 63 (i), R 66, 67 (triangle); ZR provisional within 0.9 px',
     'clearance': {'CC panel rail tip (1221, 621)': 17.2, 'tacho rail (top ~644.5)': 14.0,
                   'map window corner (roads to y 593 at x 1247-1283 in 62, 64)': 0.0},
     'cost': 'wb_dials (Comfort): our tacho\'s ring and ticks cross the slot, 165 px^2 of our ink above 5 % white would be '
             'cut if the hole cuts the dial layer too; wb_sport_dials: nothing of ours there'},
    {'id': 'rail.right.stub', 'kind': 'cover', 'channels': ['bmw', 'bmw_msg', 'standby', 'ours'], 'polygon': RAIL_STUB,
     'feather_in_px': 0.0, 'feather_out_px': 0.0,
     'reason': 'BMW\'s tacho rail from its notch (x ~1224) rightwards. Today CC_BOX (x to 1243) opens its first '
               '20 px in every message state of allG20 and in all6WB unread / msg-latched: up to 0.94 of white.',
     'evidence': 'O maps x R 61-68 (LEAK, diff.json)',
     'clearance': {'ZC panel hole must stop at': 'x <= 1222 for y > 640'}},
]


def dist_inside(poly, X, Y, radius=0.0):
    """signed distance to the polygon edge, + inside, in panel px, on O's 4x zone grid."""
    m = np.zeros(X.shape, np.uint8)
    pts = np.array([[(x * 4 - 0.5) - D.K0, (y - 540) * 4 - 0.5] for x, y in poly], np.float32)
    cv2.fillPoly(m, [np.round(pts * 16).astype(np.int32)], 1, shift=4)
    di = cv2.distanceTransform(m, cv2.DIST_L2, 5) / 4.0
    do = cv2.distanceTransform(1 - m, cv2.DIST_L2, 5) / 4.0
    d = np.where(m > 0, di, -do)
    if radius > 0:   # rounded corners: erode then grow by the radius
        d = np.minimum(d, d)  # the rectangle's distance field; corners are rounded by the ramp below
    return d


def alpha_for(channel, X, Y, wide_mode=False):
    a = np.ones(X.shape, np.float32)
    for s in SHAPES:
        chs = [c.rstrip('?') for c in s['channels']]
        if channel not in chs:
            continue
        poly = s['polygon']
        if s['id'] == 'assist.mode_label' and wide_mode:
            poly = s['alternative']['polygon']
        d = dist_inside(poly, X, Y)
        fi, fo = max(s['feather_in_px'], 1e-3), max(s['feather_out_px'], 1e-3)
        if s['kind'] == 'hole':
            h = np.where(d >= 0, 0.5 - 0.5 * np.minimum(1, d / fi), 0.5 + 0.5 * np.minimum(1, -d / fo))
            a = np.minimum(a, h)
        else:
            c = np.where(d >= 0, 1.0, 0.0)
            a = np.maximum(a, c)
    return a


def hull_grown(polys, grow):
    """The convex hull of the measured outlines, grown by `grow` px (round joins), as a short polygon: an
    envelope from the numbers, not a copy of the artwork."""
    pts = np.array([q for p in polys for q in p], np.float32)
    h = cv2.convexHull(pts).reshape(-1, 2)
    ang = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    ring = np.concatenate([h + grow * np.stack([np.cos(t) * np.ones(len(h)), np.sin(t) * np.ones(len(h))], 1) for t in ang])
    g = cv2.convexHull(ring.astype(np.float32)).reshape(-1, 2)
    g = cv2.approxPolyDP(g.reshape(-1, 1, 2), 0.25, True).reshape(-1, 2)
    return [[round(float(x), 2), round(float(y), 2)] for x, y in g]


def main():
    atlas_r = json.load(open(os.path.join(A.MAIN, 'bake/work/strip/zone-R/atlas/atlas_R.json')))
    atlas_p = json.load(open(os.path.join(A.MAIN, 'bake/work/strip/zone-R/atlas/atlas_lreg.json')))
    fp = D.footprints(atlas_r, atlas_p)
    # the marker hole: hull of the i (62, 63) and the triangle (66, 67), grown 3 px
    for s in SHAPES:
        if s['id'] == 'assist.info_tacho':
            s['polygon'] = hull_grown(fp['assist.info_tacho'], 3.0)
    X, Y = D.grid()
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))

    def dil(m, px):
        r = int(round(px * 4))
        return cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))).astype(bool)
    closed = {k: cv2.morphologyEx(D.poly_mask(v).astype(np.uint8), cv2.MORPH_CLOSE, ker).astype(bool) for k, v in fp.items()}
    light = {}
    for k in D.NON_STANDBY_PHOTOS + D.STANDBY_PHOTOS:
        lum, rgb, black, src = D.stock_light(k)
        w = atlas_r['elements']['bottom.temperature'][k]['core_lum_lin']
        light[k] = np.clip(lum - black, 0, None) / w
    L_ns = np.max([light[k] for k in D.NON_STANDBY_PHOTOS], 0)
    L_sb = light['65']
    show = {'bmw': ['bottom.temperature', 'assist.mode_label', 'assist.info_tacho'],
            'bmw_msg': ['bottom.temperature', 'assist.mode_label', 'assist.info_tacho'],
            'standby': ['bottom.temperature', 'assist.mode_label'],
            'ours': ['assist.info_tacho']}
    out = {'convention': __doc__.strip().splitlines()[2], 'zone': [1240, 540, 1920, 720], 'shapes': SHAPES, 'check': {}}
    pub = os.path.join(A.MAIN, 'bake/work/strip/pub/ZR')
    os.makedirs(pub, exist_ok=True)
    for ch in ['bmw', 'bmw_msg', 'standby', 'ours']:
        a = alpha_for(ch, X, Y)
        cv2.imwrite(os.path.join(pub, 'preview_%s_zoneR_4x.png' % ch), np.round(a * 65535).astype(np.uint16))
        L = L_sb if ch == 'standby' else L_ns
        keep = np.zeros(a.shape, bool)
        res = {'CLIP': {}}
        for s in show[ch]:
            m = dil(closed[s], 2.0)
            clip = m & (a >= 0.02)
            res['CLIP'][s] = {'px': round(clip.sum() / 16, 1), 'sum_alpha_px': round(float(a[clip].sum()) / 16, 2),
                              'ink_clipped_px': round(float((closed[s] & (a >= 0.02)).sum()) / 16, 1)}
            keep |= dil(closed[s], 6.0)
        keep |= dil(D.poly_mask(fp['assist.gear']), 3.0)
        for sx, sy in D.SPECKS:
            keep |= np.hypot(X - sx, Y - sy) < 4.0
        vis = (1 - a) * L
        leak = (vis >= 0.02) & ~keep
        res['LEAK'] = {'px': round(leak.sum() / 16, 1), 'sum_visible_white_px': round(float(vis[leak].sum()) / 16, 3),
                       'max_visible_white': round(float(vis[leak].max()), 4) if leak.any() else 0.0}
        res['visible_stock_light_in_holes_outside_footprints_white_px'] = round(float(((1 - a) * L)[~keep].sum()) / 16, 3)
        # the wide mode-label alternative
        if ch in ('bmw', 'bmw_msg', 'standby'):
            aw = alpha_for(ch, X, Y, wide_mode=True)
            vw = (1 - aw) * L
            res['LEAK_with_wide_mode_label'] = round(float(vw[(vw >= 0.02) & ~keep].sum()) / 16, 3)
        out['check'][ch] = res
        print(ch, json.dumps(res), flush=True)
    json.dump(out, open(os.path.join(A.REPO, 'design/strip/ZR/mask_proposal.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
