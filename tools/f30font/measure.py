"""Package design/f30-font: measure a text run on an F30 6WB reference image.

The F30 references (reference/6wb/) are third-party photos and renders of someone else's car at
their own scales -- unlike reference/g20/ there is no rectification to panel px, because there is no
common panel frame to rectify to. So this tool measures in the IMAGE's own pixels and the document
turns the numbers into ratios (x/cap, stem/cap, advance/figure), which are scale-free and are what
identifies a typeface. Where an absolute size is wanted, the document states the image's own scale
(e.g. "cap 27.4 px on a 1000 px-wide crop of the tacho") and never pretends it is a panel px.

Method is tools/g20spec/measure.py's, minus the warp: crop a box, upsample n x (Lanczos), blur by
n/6, threshold at the midpoint between the 5th and 99.5th percentile of the ink channel, then
8-connected components.

    glyphs   per connected ink blob: box, width, height, gap and advance to the previous blob
    extent   the box's ink extent with sub-pixel half-max edges, plus the row profile
    stroke   the median run length of ink along rows / columns (stem and bar weight)
    colour   the ink's and the background's mean RGB
    rows/cols  the ink profile, for reading a baseline, a cap line or an x-height plateau off it

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/f30font/measure.py --img reference/6wb/05_comfort_tach-closeup.png \
        --box 230 490 320 530 --what glyphs
"""
import argparse
import json
import os

import cv2
import numpy as np


def channel(img, mode):
    b, g, r = [c.astype(np.float32) for c in cv2.split(img)]
    if mode == 'bright':
        return np.maximum(np.maximum(b, g), r)
    if mode == 'dark':
        return 255.0 - np.minimum(np.minimum(b, g), r)
    if mode == 'red':
        return np.clip(r - np.maximum(g, b), 0, 255)
    if mode == 'lum':
        return 0.299 * r + 0.587 * g + 0.114 * b
    raise SystemExit('unknown --ink ' + mode)


def levels(f, lo_pct=5, hi_pct=99.5):
    lo = float(np.percentile(f, lo_pct))
    hi = float(np.percentile(f, hi_pct))
    return lo, hi, (lo + hi) / 2.0


def halfmax_edges(prof):
    """Sub-pixel first/last crossing of half the profile's max; None when it never crosses."""
    h = float(prof.max()) / 2.0
    idx = np.where(prof >= h)[0]
    if not len(idx):
        return None
    i0, i1 = idx[0], idx[-1]
    a = float(i0)
    if i0 > 0:
        p, q = prof[i0 - 1], prof[i0]
        a = i0 - 1 + (h - p) / (q - p) if q != p else float(i0)
    b = float(i1)
    if i1 + 1 < len(prof):
        p, q = prof[i1], prof[i1 + 1]
        b = i1 + (p - h) / (p - q) if p != q else float(i1)
    return a, b


def crop(img, box, n):
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    sub = img[max(0, y0):y1, max(0, x0):x1]
    if sub.size == 0:
        raise SystemExit('empty crop %s' % (box,))
    return cv2.resize(sub, (sub.shape[1] * int(n), sub.shape[0] * int(n)), interpolation=cv2.INTER_LANCZOS4)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--img', required=True)
    ap.add_argument('--box', nargs=4, type=float, required=True)
    ap.add_argument('--scale', type=int, default=8)
    ap.add_argument('--ink', default='bright', choices=('bright', 'dark', 'red', 'lum'))
    ap.add_argument('--what', default='glyphs',
                    choices=('glyphs', 'extent', 'stroke', 'colour', 'rows', 'cols', 'all'))
    ap.add_argument('--min-area', type=float, default=1.5, help='image px^2 below which a blob is noise')
    ap.add_argument('--merge', type=float, default=0.0, help='merge blobs whose x ranges are closer than this')
    ap.add_argument('--thr', type=float, default=None, help='explicit ink threshold on the chosen channel')
    ap.add_argument('--invert', action='store_true',
                    help='find the COUNTERS instead of the ink: flip the mask after thresholding, so '
                         'connected components return the holes inside a 0/4/6/8/P/R. A counter shrinks '
                         'by the same bloom that grows the ink, so measuring one breaks the '
                         'weight-against-bloom degeneracy in tools/f30font/fontfit.py.')
    ap.add_argument('--dump', default=None, help='write the thresholded crop here')
    a = ap.parse_args()

    img = cv2.imread(a.img, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit('cannot read ' + a.img)
    n = a.scale
    c = crop(img, a.box, n)
    f = cv2.GaussianBlur(channel(c, a.ink), (0, 0), max(0.8, n / 6.0))
    lo, hi, mid = levels(f)
    thr = a.thr if a.thr is not None else mid
    ink = (f >= thr).astype(np.uint8)
    if a.invert:
        ink = 1 - ink
    x0, y0 = a.box[0], a.box[1]
    out = {'img': os.path.basename(a.img), 'box': a.box, 'scale': n, 'ink': a.ink,
           'levels': {'bg': round(lo, 1), 'peak': round(hi, 1), 'threshold': round(thr, 1)}}

    def px(v, axis):
        return round((x0 if axis == 'x' else y0) + v / n, 2)

    if a.what in ('glyphs', 'all'):
        ncc, lab, stats, cent = cv2.connectedComponentsWithStats(ink, 8)
        blobs = []
        for i in range(1, ncc):
            x, y, w, h, area = stats[i]
            if area / float(n * n) < a.min_area:
                continue
            blobs.append([x, y, x + w, y + h, area])
        blobs.sort(key=lambda b: b[0])
        if a.merge:
            merged = []
            for b in blobs:
                if merged and b[0] - merged[-1][2] < a.merge * n:
                    m = merged[-1]
                    merged[-1] = [min(m[0], b[0]), min(m[1], b[1]), max(m[2], b[2]), max(m[3], b[3]), m[4] + b[4]]
                else:
                    merged.append(list(b))
            blobs = merged
        gs = []
        for i, b in enumerate(blobs):
            g = {'x0': px(b[0], 'x'), 'y0': px(b[1], 'y'), 'x1': px(b[2], 'x'), 'y1': px(b[3], 'y')}
            g['w'] = round(g['x1'] - g['x0'], 2)
            g['h'] = round(g['y1'] - g['y0'], 2)
            g['ink_px'] = round(b[4] / float(n * n), 1)
            if i:
                g['gap_to_prev'] = round(g['x0'] - gs[-1]['x1'], 2)
                g['advance'] = round(g['x0'] - gs[-1]['x0'], 2)
            gs.append(g)
        out['glyphs'] = gs

    if a.what in ('extent', 'all'):
        col = ink.sum(0).astype(np.float32)
        row = ink.sum(1).astype(np.float32)
        cx = halfmax_edges(col)
        cy = halfmax_edges(row)
        ys = np.where(row > 0)[0]
        xs = np.where(col > 0)[0]
        out['extent'] = {
            'x': [px(xs[0], 'x'), px(xs[-1] + 1, 'x')] if len(xs) else None,
            'y': [px(ys[0], 'y'), px(ys[-1] + 1, 'y')] if len(ys) else None,
            'x_halfmax': [px(cx[0], 'x'), px(cx[1], 'x')] if cx else None,
            'y_halfmax': [px(cy[0], 'y'), px(cy[1], 'y')] if cy else None,
        }

    if a.what in ('stroke', 'all'):
        def runs(m):
            r = []
            for line in m:
                idx = np.where(line)[0]
                if not len(idx):
                    continue
                s = p = idx[0]
                for v in idx[1:]:
                    if v != p + 1:
                        r.append(p - s + 1)
                        s = v
                    p = v
                r.append(p - s + 1)
            return np.array(r, np.float32) / float(n)
        rh, rv = runs(ink), runs(ink.T)
        out['stroke'] = {
            'horizontal_runs_median': round(float(np.median(rh)), 2) if len(rh) else None,
            'horizontal_runs_p25_p75': [round(float(np.percentile(rh, 25)), 2),
                                        round(float(np.percentile(rh, 75)), 2)] if len(rh) else None,
            'vertical_runs_median': round(float(np.median(rv)), 2) if len(rv) else None,
        }

    if a.what in ('colour', 'all'):
        core = f >= (lo + 0.85 * (hi - lo))
        bgm = f <= (lo + 0.15 * (hi - lo))
        out['colour'] = {
            'ink_rgb': [round(float(c[..., 2][core].mean()), 1), round(float(c[..., 1][core].mean()), 1),
                        round(float(c[..., 0][core].mean()), 1)] if core.any() else None,
            'bg_rgb': [round(float(c[..., 2][bgm].mean()), 1), round(float(c[..., 1][bgm].mean()), 1),
                       round(float(c[..., 0][bgm].mean()), 1)] if bgm.any() else None,
            'ink_core_px': int(core.sum() / float(n * n)),
        }

    if a.what in ('rows',):
        row = ink.sum(1).astype(np.float32) / float(n)
        out['rows'] = [[px(i, 'y'), round(float(v), 2)] for i, v in enumerate(row)]
    if a.what in ('cols',):
        col = ink.sum(0).astype(np.float32) / float(n)
        out['cols'] = [[px(i, 'x'), round(float(v), 2)] for i, v in enumerate(col)]

    if a.dump:
        vis = c.copy()
        vis[ink == 0] = (vis[ink == 0] * 0.35).astype(np.uint8)
        os.makedirs(os.path.dirname(os.path.abspath(a.dump)) or '.', exist_ok=True)
        cv2.imwrite(a.dump, vis)
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
