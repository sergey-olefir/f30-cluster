"""Package design/g20-spec: measure a stock G20 element in panel px on a rectified reference photo.

All measurements in docs/G20-DESIGN-SPEC.md come from this tool. It warps one panel box out of a
photo at n x panel resolution (tools/g20spec/zoom.py's model), separates ink from the background and
reports, in panel px:

    glyphs   per connected ink blob: box, width, height, the gaps between blobs (advance/spacing)
    extent   the box's ink extent with sub-pixel half-max edges, and the row profile (baseline, cap
             height, x-height read off the plateau)
    stroke   the median run length of ink along rows / columns (stem and bar weight)
    colour   the ink's and the background's mean RGB over the ink core (alpha >= 0.8)
    circle   least-squares circle through the half-max edge of a red ring (the speed-limit sign)

Modes: --ink bright (light text on dark) | dark (dark glyphs on the white disc) | red (red ring).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/g20spec/measure.py --root <main> --photo 39 --box 130 660 310 706 --what glyphs
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import zoom as Z  # noqa: E402


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


def halfmax_edges(prof, lo, hi):
    """Sub-pixel first/last crossing of (lo+hi)/2 in a 1-D profile; None when it never crosses."""
    h = (lo + hi) / 2.0
    idx = np.where(prof >= h)[0]
    if not len(idx):
        return None
    def cross(i, j):
        a, b = prof[i], prof[j]
        return i + (h - a) / (b - a) if b != a else float(i)
    i0 = idx[0]
    a = cross(i0 - 1, i0) if i0 > 0 else float(i0)
    i1 = idx[-1]
    b = cross(i1 + 1, i1) + 0.0 if i1 + 1 < len(prof) else float(i1)
    if i1 + 1 < len(prof):
        p, q = prof[i1], prof[i1 + 1]
        b = i1 + (p - h) / (p - q) if p != q else float(i1)
    return a, b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.environ.get('F30_MAIN'))
    ap.add_argument('--photo', required=True)
    ap.add_argument('--hjson', default=None)
    ap.add_argument('--box', nargs=4, type=float, required=True)
    ap.add_argument('--scale', type=float, default=8.0)
    ap.add_argument('--ink', default='bright', choices=('bright', 'dark', 'red', 'lum'))
    ap.add_argument('--what', default='glyphs',
                    choices=('glyphs', 'extent', 'stroke', 'colour', 'circle', 'rows', 'cols', 'trace', 'all'))
    ap.add_argument('--step', type=float, default=5.0, help='trace: panel px between samples')
    ap.add_argument('--min-area', type=float, default=1.5, help='panel px^2 below which a blob is noise')
    ap.add_argument('--merge', type=float, default=0.0, help='merge blobs whose x ranges are closer than this')
    ap.add_argument('--thr', type=float, default=None, help='explicit ink threshold (0-255 on the chosen channel)')
    ap.add_argument('--dump', default=None, help='write the thresholded crop here')
    a = ap.parse_args()

    R, e, ph, size = Z.model_for(a.root, a.photo, a.hjson)
    n = float(a.scale)
    img = Z.warp_box(R, e, ph, size, a.box, n)
    f = cv2.GaussianBlur(channel(img, a.ink), (0, 0), max(0.8, n / 6.0))
    lo, hi, mid = levels(f)
    thr = a.thr if a.thr is not None else mid
    ink = (f >= thr).astype(np.uint8)
    x0, y0 = a.box[0], a.box[1]
    out = {'photo': a.photo, 'box': a.box, 'scale': n, 'ink': a.ink,
           'levels': {'bg': round(lo, 1), 'peak': round(hi, 1), 'threshold': round(thr, 1)},
           'px_per_panel_px_in_photo': e['photo_px_per_panel_px']}

    def px(v, axis):
        return round((x0 if axis == 'x' else y0) + v / n, 2)

    if a.what in ('glyphs', 'all'):
        ncc, lab, stats, cent = cv2.connectedComponentsWithStats(ink, 8)
        blobs = []
        for i in range(1, ncc):
            x, y, w, h, area = stats[i]
            if area / (n * n) < a.min_area:
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
            g['ink_px'] = round(b[4] / (n * n), 1)
            if i:
                g['gap_to_prev'] = round(g['x0'] - gs[-1]['x1'], 2)
                g['advance'] = round(g['x0'] - gs[-1]['x0'], 2)
            gs.append(g)
        out['glyphs'] = gs

    if a.what in ('extent', 'all'):
        col = ink.sum(0).astype(np.float32)
        row = ink.sum(1).astype(np.float32)
        cx = halfmax_edges(col, 0, col.max())
        cy = halfmax_edges(row, 0, row.max())
        ys = np.where(row > 0)[0]
        xs = np.where(col > 0)[0]
        out['extent'] = {
            'x': [px(xs[0], 'x'), px(xs[-1] + 1, 'x')] if len(xs) else None,
            'y': [px(ys[0], 'y'), px(ys[-1] + 1, 'y')] if len(ys) else None,
            'x_halfmax': [px(cx[0], 'x'), px(cx[1], 'x')] if cx else None,
            'y_halfmax': [px(cy[0], 'y'), px(cy[1], 'y')] if cy else None,
            'row_profile': [round(v / n, 2) for v in row.tolist()],
        }

    if a.what in ('stroke', 'all'):
        def runs(m):
            r = []
            for line in m:
                idx = np.where(line)[0]
                if not len(idx):
                    continue
                start = idx[0]
                prev = idx[0]
                for v in idx[1:]:
                    if v != prev + 1:
                        r.append(prev - start + 1)
                        start = v
                    prev = v
                r.append(prev - start + 1)
            return np.array(r, np.float32) / n
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
            'ink_rgb': [round(float(img[..., 2][core].mean()), 1), round(float(img[..., 1][core].mean()), 1),
                        round(float(img[..., 0][core].mean()), 1)] if core.any() else None,
            'bg_rgb': [round(float(img[..., 2][bgm].mean()), 1), round(float(img[..., 1][bgm].mean()), 1),
                       round(float(img[..., 0][bgm].mean()), 1)] if bgm.any() else None,
            'ink_core_px': int(core.sum() / (n * n)),
        }

    if a.what in ('circle', 'all'):
        ys, xs = np.where(ink > 0)
        if len(xs) > 50:
            A = np.stack([xs, ys, np.ones_like(xs)], 1).astype(np.float64)
            bb = (xs.astype(np.float64) ** 2 + ys.astype(np.float64) ** 2)
            sol = np.linalg.lstsq(A, bb, rcond=None)[0]
            cxp, cyp = sol[0] / 2, sol[1] / 2
            rad = float(np.sqrt(sol[2] + cxp ** 2 + cyp ** 2))
            d = np.hypot(xs - cxp, ys - cyp)
            out['circle'] = {'centre': [px(cxp, 'x'), px(cyp, 'y')], 'r_fit': round(rad / n, 2),
                             'r_outer': round(float(np.percentile(d, 99)) / n, 2),
                             'r_inner': round(float(np.percentile(d, 1)) / n, 2),
                             'ring_width': round(float(np.percentile(d, 99) - np.percentile(d, 1)) / n, 2)}

    if a.what in ('trace',):
        # a thin bright line through the box: per column, the ink centroid in y and the run length
        tr = []
        step = max(1, int(round(a.step * n)))
        for cx in range(0, ink.shape[1], step):
            colm = ink[:, cx]
            idx = np.where(colm > 0)[0]
            if not len(idx):
                tr.append([px(cx, 'x'), None, None])
                continue
            w = f[idx, cx] - thr
            yc = float((idx * w).sum() / w.sum()) if w.sum() > 0 else float(idx.mean())
            tr.append([px(cx, 'x'), round(y0 + yc / n, 2), round(len(idx) / n, 2)])
        out['trace'] = tr

    if a.what in ('rows',):
        row = ink.sum(1).astype(np.float32) / n
        out['rows'] = [[px(i, 'y'), round(float(v), 2)] for i, v in enumerate(row)]
    if a.what in ('cols',):
        col = ink.sum(0).astype(np.float32) / n
        out['cols'] = [[px(i, 'x'), round(float(v), 2)] for i, v in enumerate(col)]

    if a.dump:
        vis = img.copy()
        vis[ink == 0] = (vis[ink == 0] * 0.35).astype(np.uint8)
        cv2.imwrite(a.dump, vis)
    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
