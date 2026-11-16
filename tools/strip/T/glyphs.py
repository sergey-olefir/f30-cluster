"""Package T: per-glyph ink geometry of one text field in one photo, in continuous panel coordinates.

The field's panel box is warped out of the original photo at n x (default 8, Lanczos, tools/strip/T/common.py).
Ink channel: max(R, G, B) for light text on the dark panel; 1 - min(R, G, B) for the sign's dark digits on its
light face. Local black b = the 3rd percentile of the channel over the box, plateau p = the median of the
channel over the cores of the strokes (pixels above b + 0.75 (p0 - b), p0 the 99.5th percentile), so a thin stroke
that never reaches full brightness does not drag the plateau down. Ink = channel >= b + 0.5 (p - b): the half-max
edge, unbiased for a stroke wider than the blur. 8-connected components, then components whose x ranges overlap
by more than 60 % of the narrower are merged into one glyph (dots of i, colon, degree ring kept apart when they
do not overlap).

Per glyph: [x0, x1, y0, y1] of the ink in continuous panel coordinates (half-open, pixel (i, j) covers
[i, i+1) x [j, j+1)), its area, and its stem: the median length of the horizontal ink runs in the middle 50 % of
its rows (a vertical stroke's width), and the vertical stem: the median vertical run over the middle 50 % of its
columns (a horizontal stroke's thickness). Run lengths are in panel px.

Output JSON (numbers only, no photo pixels) to stdout or --out (outside the repo for photo-derived files).
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def runs_1d(row):
    idx = np.flatnonzero(row)
    if not len(idx):
        return []
    br = np.flatnonzero(np.diff(idx) > 1)
    starts = np.r_[idx[0], idx[br + 1]]
    ends = np.r_[idx[br], idx[-1]] + 1
    return list(ends - starts)


def analyse(chan, n, box, merge=0.6, min_area_px=3.0, thr=0.5):
    import cv2
    b = float(np.percentile(chan, 3))
    p0 = float(np.percentile(chan, 99.5))
    core = chan >= b + 0.75 * (p0 - b)
    p = float(np.median(chan[core])) if core.any() else p0
    t = b + thr * (p - b)
    m = (chan >= t).astype(np.uint8)
    k, lab, st, cen = cv2.connectedComponentsWithStats(m, connectivity=8)
    comps = []
    for i in range(1, k):
        x, y, w, h, a = st[i]
        if a < min_area_px * n * n:
            continue
        comps.append([x, x + w, y, y + h, [i]])
    comps.sort(key=lambda c: c[0])
    glyphs = []
    for c in comps:
        if glyphs:
            g = glyphs[-1]
            ov = min(g[1], c[1]) - max(g[0], c[0])
            if ov > merge * min(g[1] - g[0], c[1] - c[0]):
                g[0], g[1], g[2], g[3] = min(g[0], c[0]), max(g[1], c[1]), min(g[2], c[2]), max(g[3], c[3])
                g[4] += c[4]
                continue
        glyphs.append(list(c))
    out = []
    for x0, x1, y0, y1, ids in glyphs:
        gm = np.isin(lab[y0:y1, x0:x1], ids)
        h, w = gm.shape
        rows = gm[int(h * 0.25):max(int(h * 0.75), int(h * 0.25) + 1)]
        hr = [r for row in rows for r in runs_1d(row)]
        cols = gm[:, int(w * 0.25):max(int(w * 0.75), int(w * 0.25) + 1)].T
        vr = [r for col in cols for r in runs_1d(col)]
        # sub-pixel edges: the column / row profile of the channel at the box's outer edges is not needed at 8x
        # (quantisation 1/n); report the box as is
        out.append({'x0': box[0] + x0 / n, 'x1': box[0] + x1 / n, 'y0': box[1] + y0 / n, 'y1': box[1] + y1 / n,
                    'area': float(gm.sum()) / n / n,
                    'stem_h': float(np.median(hr)) / n if hr else None,
                    'stem_v': float(np.median(vr)) / n if vr else None,
                    'parts': len(ids)})
    return {'black': b, 'plateau': p, 'threshold': t, 'glyphs': out}


def srgb_to_linear(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def field(photo, box, n=8, ink='light', prefer=None, thr=0.5, linear=True):
    img, label, scale = C.warp(photo, box, n, prefer=prefer)
    # the camera integrates light linearly, so a blurred edge's true position is the half-max in LINEAR light;
    # thresholding the sRGB-encoded value at 50 % (21 % linear) puts every edge of light ink outward
    lin = srgb_to_linear(img) if linear else img
    if ink == 'light':
        chan = lin.max(2)
    elif ink == 'white':                       # white text only: min(R, G, B) drops the grid's green and yellow
        chan = lin.min(2)
    elif ink in ('red', 'green', 'blue'):      # one channel (the grid's yellow labels: red; their truth is known)
        chan = lin[:, :, ('red', 'green', 'blue').index(ink)]
    elif ink == 'dark':
        chan = 1.0 - lin.min(2)
    else:
        raise ValueError(ink)
    res = analyse(chan, n, box, thr=thr)
    res.update({'photo': photo, 'box': list(box), 'n': n, 'ink': ink, 'model': label, 'linear': linear,
                'thr': thr, 'photo_px_per_panel_px': scale})
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--photo', required=True)
    ap.add_argument('--box', nargs=4, type=float, required=True)
    ap.add_argument('--scale', type=float, default=8)
    ap.add_argument('--ink', default='light')
    ap.add_argument('--thr', type=float, default=0.5)
    ap.add_argument('--prefer', default=None)
    ap.add_argument('--encoded', action='store_true', help='threshold the sRGB-encoded value (the old method)')
    a = ap.parse_args()
    r = field(a.photo, a.box, a.scale, a.ink, a.prefer, a.thr, not a.encoded)
    print('photo %s model %s  black %.3f plateau %.3f' % (r['photo'], r['model'], r['black'], r['plateau']))
    for g in r['glyphs']:
        print('  x %7.2f-%7.2f  y %6.2f-%6.2f  w %5.2f h %5.2f  stem h %s v %s  parts %d'
              % (g['x0'], g['x1'], g['y0'], g['y1'], g['x1'] - g['x0'], g['y1'] - g['y0'],
                 '%.2f' % g['stem_h'] if g['stem_h'] else '-', '%.2f' % g['stem_v'] if g['stem_v'] else '-', g['parts']))


if __name__ == '__main__':
    main()
