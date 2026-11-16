"""Package ZR: unattributed light in the right zone of the strip (x 1240-1920, y 540-720).

For each stock photo: the catalogued elements' 50 % masks (atlas.py) are dilated by 3 px (blur + bloom) and
removed (a blob within 5 px of one and dimmer than 0.25 white counts as its halo); what is still lit is split into
  sharp ink : luminance minus a 15-px grey opening, above max(6 x the display noise, 3 % of white), at least 2 px^2, and
  diffuse   : the opening itself above the display's black level + 6 x noise (glows, the dial face),
and every connected blob of sharp ink is given an id by where it sits and what colour it is, or listed as
'unexplained' with its box. The diffuse light is reported as the boxes of its 2 % / 10 % / 50 % levels
relative to stock white text (the temperature's core in the same photo).

Usage: python -I unattributed.py [--src lreg|R]   -> design/strip/ZR/unattributed.json (numbers only)
"""
import argparse
import json
import os

import cv2
import numpy as np

import atlas as A

ZONE = (1240, 540, 1920, 720)


def classify(b, rgb, area):
    x0, y0, x1, y1 = b
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    r, g, bl = rgb
    red = r > 2.2 * max(g, bl, 1e-6)
    blue = bl > 1.6 * max(r, g, 1e-6)
    w, h = x1 - x0, y1 - y0
    if cx >= 1690:
        if blue:
            return 'structure.oil_mini.cold_band'
        if red:
            return 'structure.oil_mini.needle_or_hot_band'
        return 'structure.oil_mini.rail_ticks'
    if red and (h > 25 or w > 25) and not (600 <= cy <= 612):
        return 'structure.tacho_needle'
    if red and 598 <= cy <= 614:
        return 'structure.tacho.rev_band'
    if red:
        return 'structure.tacho_needle'
    if w > 60 and y1 >= 640:
        return 'rail.right'
    if 1536 <= cx <= 1556 and 620 <= cy <= 646:
        return 'structure.tacho.ticks'          # the major tick at 0 rpm, 13 x 19 px
    if x1 <= 1360 and y1 <= 594:
        return 'map.region'                      # roads of the map window's lower right corner (dynamic; ZC's)
    for sx, sy in ((1294.2, 694.0), (1486.0, 677.6), (1838.3, 682.4), (1834.0, 681.0)):
        if x0 - 2 <= sx <= x1 + 2 and y0 - 2 <= sy <= y1 + 2:
            return 'glass.speck'                 # fixed, bluish, scales with ambient light: not display content
    if 1580 <= cx <= 1630 and cy < 580:
        return 'structure.tacho.num1'
    if 1490 <= cx <= 1700 and 540 <= cy <= 646 and area < 120:
        return 'structure.tacho.ticks'
    if x0 >= 1580 and y1 <= 640 and w > 20:
        return 'structure.tacho.rim'
    return None


def run(src, photos):
    aj = os.path.join(A.MAIN, 'bake/work/strip/zone-R/atlas/atlas_%s.json' % src)
    atlas = json.load(open(aj))
    out = {}
    for k in photos:
        if src == 'R':
            c = A.Crop(os.path.join(A.MAIN, 'bake/work/strip/rect/%s_strip_4x.png' % k), 0, 540, half=0.125)
        else:
            c = A.Crop(os.path.join(A.MAIN, 'bake/work/strip/zone-R/%s/%s_R4.png' % (src, k)), 1180, 520)
        j0, i0, j1, i1 = c.j(ZONE[0]), c.i(ZONE[1]), c.j(ZONE[2]) - 1, c.i(ZONE[3]) - 1
        j0, i0 = max(j0, 0), max(i0, 0)
        lum = c.lum[i0:i1, j0:j1].astype(np.float32)
        rgb = c.lin[i0:i1, j0:j1]
        op = cv2.morphologyEx(lum, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
        op = cv2.GaussianBlur(op, (0, 0), 4)
        sharp = lum - op
        # black level and noise: the display below the strip's texts, far from everything (y 708-718)
        ys = c.y0 + (np.arange(i0, i1)) / A.N + c.half
        xs = c.x0 + (np.arange(j0, j1)) / A.N + c.half
        quiet = lum[(ys > 708) & (ys < 718)][:, (xs > 1680) & (xs < 1840)]
        black = float(np.median(quiet))
        noise = float(1.4826 * np.median(np.abs(quiet - black)))
        white = atlas['elements']['bottom.temperature'].get(k, {}).get('core_lum_lin')
        known = np.zeros(lum.shape, np.uint8)
        for name, per in atlas['elements'].items():
            m = per.get(k)
            if not m or 'polygon' not in m:
                continue
            for poly in m['polygon']:
                pts = np.array([[(x - c.x0 - c.half) * A.N - j0, (y - c.y0 - c.half) * A.N - i0] for x, y in poly],
                               np.int32)
                cv2.fillPoly(known, [pts], 1)
        known = cv2.dilate(known, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
        lit = (sharp > max(6 * noise, 0.03 * (white or 1))) & (known == 0)
        near = cv2.dilate(known, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)))
        n, lab, st, _ = cv2.connectedComponentsWithStats(lit.astype(np.uint8), 8)
        blobs = {}
        unexplained = []
        for q in range(1, n):
            x, y, w, h, a = st[q]
            area = a / A.N / A.N
            if area < 2.0:
                continue
            b = [round(c.cx(j0 + x) - 0.125, 2), round(c.cy(i0 + y) - 0.125, 2),
                 round(c.cx(j0 + x + w - 1) + 0.125, 2), round(c.cy(i0 + y + h - 1) + 0.125, 2)]
            col = rgb[lab == q].mean(0)
            pk = float(sharp[lab == q].max())
            idn = classify(b, col, area)
            if idn is None and pk < 0.25 * (white or 1) and near[lab == q].mean() > 0.5:
                idn = 'halo.of_catalogued_element'     # bloom / glare round a catalogued element, past 3 px
            rec = {'box': b, 'area_px': round(area, 1), 'peak_rel_white': round(pk / white, 3) if white else None}
            if idn is None:
                unexplained.append(rec)
            else:
                e = blobs.setdefault(idn, {'n': 0, 'area_px': 0.0, 'box': list(b)})
                e['n'] += 1
                e['area_px'] = round(e['area_px'] + area, 1)
                e['box'] = [min(e['box'][0], b[0]), min(e['box'][1], b[1]), max(e['box'][2], b[2]),
                            max(e['box'][3], b[3])]
        diffuse = {}
        for lvl in (0.02, 0.10, 0.50):
            m = (op - black) > lvl * (white or 1)
            if m.any():
                yy, xx = np.nonzero(m)
                diffuse['%g' % lvl] = [round(c.cx(j0 + xx.min()) - 0.125, 1), round(c.cy(i0 + yy.min()) - 0.125, 1),
                                       round(c.cx(j0 + xx.max()) + 0.125, 1), round(c.cy(i0 + yy.max()) + 0.125, 1)]
        out[k] = {'black_lin': round(black, 5), 'noise_lin': round(noise, 5), 'white_core_lin': white,
                  'black_rel_white': round(black / white, 4) if white else None,
                  'attributed': blobs, 'unexplained': unexplained, 'diffuse_boxes_rel_white': diffuse}
        print(k, 'black', round(black, 5), 'unexplained', len(unexplained), sorted(blobs), flush=True)
        for u in unexplained:
            print('   ?', u)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default='lreg')
    ap.add_argument('--photos', nargs='*', default=['61', '62', '63', '64', '65', '66', '67', '68'])
    ap.add_argument('--out', default=os.path.join(A.REPO, 'design', 'strip', 'ZR', 'unattributed.json'))
    a = ap.parse_args()
    res = run(a.src, a.photos)
    json.dump({'source': a.src, 'zone': ZONE, 'photos': res}, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
