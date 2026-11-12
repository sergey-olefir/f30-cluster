#!/usr/bin/env python3
"""Package E (overlay constructor): the stock G20 Comfort element catalogue, measured on the rectified photos.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        --with pillow python tools/overlay/catalogue_g20.py

Inputs (git-ignored, from package B):
    bake/work/overlay/rect/<08..14>.png    each photo warped to panel px (1920x720)
    bake/work/overlay/rect/H.json          per-photo model, rms, usable flag
    bake/work/C9/overlays.json             C9's earlier measurements (for the deltas only)
Seeds (hand-tuned, in git):
    tools/overlay/catalogue_g20_seeds.json per element: group, name, safety, the photo and ROI it is measured on,
                                           the signal and threshold, per-photo states (read by eye), schematic, notes
Outputs:
    design/overlay/g20_comfort.json        the catalogue (relation/evidence/basis left for package F)
    design/overlay/schematic/<id>.svg      our own generic drawing per element (no photo pixels, no BMW artwork)
    bake/work/overlay/g20_catalogue.png    local sheet: rect 08 with every polygon and id, plus 14 and 09
    bake/work/overlay/g20_catalogue_metrics.json   per element: signal in its bbox in every photo, deltas vs C9

Measurement. Each element has a ROI on one rect (08 unless 08 lacks it) and a signal:
    white  min(R,G,B)        light text and outlines (rejects coloured lamps)
    v      max(R,G,B)        anything bright
    chroma max - min          coloured lamps (rejects white outlines)
    green  G - max(R,B)       green lamps
    red    R - max(G,B)       red/orange lamps and marks
    dark   255 - max(R,G,B)   the black box (dark on a lit background)
The mask is the half-max level between the ROI's background (a low percentile) and its peak (99.5th percentile),
minus 'exclude' boxes, keeping components of at least 'amin' px. bbox is the mask's extent with exclusive
right/bottom edges ('local': each component found at the low level 'frac' gets its own half-max, so dim strokes
keep their true edge); poly is the convex hull of the mask's pixel squares, simplified to <= 0.75 px.
'map' and 'black_box' have their own methods (below).
"""
import json
import math
import os
import sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RECT = os.path.join(ROOT, 'bake', 'work', 'overlay', 'rect')
SEEDS = os.path.join(ROOT, 'tools', 'overlay', 'catalogue_g20_seeds.json')
OUT_JSON = os.path.join(ROOT, 'design', 'overlay', 'g20_comfort.json')
SCHEM_DIR = os.path.join(ROOT, 'design', 'overlay', 'schematic')
SHEET = os.path.join(ROOT, 'bake', 'work', 'overlay', 'g20_catalogue.png')
METRICS = os.path.join(ROOT, 'bake', 'work', 'overlay', 'g20_catalogue_metrics.json')
C9 = os.path.join(ROOT, 'bake', 'work', 'C9', 'overlays.json')
PHOTOS = ['08', '09', '10', '11', '12', '13', '14']
W, H = 1920, 720


def rel(p):
    return os.path.relpath(p, ROOT)


_cache = {}


def rect(pid):
    if pid not in _cache:
        im = cv2.imread(os.path.join(RECT, pid + '.png'), cv2.IMREAD_COLOR)
        if im is None:
            sys.exit('missing %s: run tools/overlay/rectify.py (package B) first' % rel(os.path.join(RECT, pid + '.png')))
        _cache[pid] = im
    return _cache[pid]


def signal(im, kind):
    b, g, r = [c.astype(np.float32) for c in cv2.split(im)]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    if kind == 'white':
        return mn
    if kind == 'v':
        return mx
    if kind == 'chroma':
        return mx - mn
    if kind == 'green':
        return np.clip(g - np.maximum(r, b), 0, None)
    if kind == 'red':
        return np.clip(r - np.maximum(g, b), 0, None)
    if kind == 'dark':
        return 255 - mx
    raise ValueError(kind)


def clip_box(b):
    x0, y0, x1, y1 = [int(round(v)) for v in b]
    return max(0, x0), max(0, y0), min(W, x1), min(H, y1)


def halfmax_mask(im, roi, kind, frac=0.5, bg_pct=20, peak_pct=99.5, exclude=(), amin=4, thr=None, keep='all',
                 local=False, tophat=0, remove_vlines=0):
    """Full-panel boolean mask of the element (inside roi)."""
    x0, y0, x1, y1 = clip_box(roi)
    s = signal(im[y0:y1, x0:x1], kind)
    if tophat:      # thin bright strokes only (needles over their glow)
        s = cv2.morphologyEx(s, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (tophat, tophat)))
    bg = float(np.percentile(s, bg_pct))
    pk = float(np.percentile(s, peak_pct))
    t = thr if thr is not None else bg + frac * (pk - bg)
    m = (s >= t).astype(np.uint8)
    if remove_vlines:   # map roads running vertically through a label: long vertical runs in a strip 40 px taller
        ey0, ey1 = max(0, y0 - 40), min(H, y1 + 40)
        tall = (signal(im[ey0:ey1, x0:x1], kind) >= t).astype(np.uint8)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (1, remove_vlines))
        roads = cv2.morphologyEx(tall, cv2.MORPH_OPEN, k)[y0 - ey0:y0 - ey0 + (y1 - y0)]
        m[cv2.dilate(roads, np.ones((1, 3), np.uint8)) > 0] = 0
    for e in exclude:
        ex0, ey0, ex1, ey1 = clip_box(e)
        m[max(0, ey0 - y0):max(0, ey1 - y0), max(0, ex0 - x0):max(0, ex1 - x0)] = 0
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if local:
        # per-stroke half-max: each component found at the low level gets its own level, half-way between the
        # ROI background and the component's own 95th percentile (dim brackets keep their true edge)
        m2 = np.zeros_like(m)
        for i in range(1, n):
            sel = lab == i
            if sel.sum() < amin:
                continue
            p95 = float(np.percentile(s[sel], 95))
            if p95 - bg < 0.5 * (pk - bg):      # halo / glow, not a stroke
                continue
            ti = bg + 0.5 * (p95 - bg)
            m2[sel & (s >= ti)] = 1
        m = m2
        n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    keepm = np.zeros_like(m)
    comps = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= amin]
    if keep == 'largest' and comps:
        comps = [max(comps, key=lambda i: st[i, cv2.CC_STAT_AREA])]
    for i in comps:
        keepm[lab == i] = 1
    full = np.zeros((H, W), np.uint8)
    full[y0:y1, x0:x1] = keepm
    return full.astype(bool), {'bg': round(bg, 1), 'peak': round(pk, 1), 'thr': round(t, 1)}


def mask_geom(mask, eps=0.75):
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None, None
    bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    pts = np.concatenate([np.stack([xs, ys], 1), np.stack([xs + 1, ys], 1),
                          np.stack([xs, ys + 1], 1), np.stack([xs + 1, ys + 1], 1)]).astype(np.int32)
    hull = cv2.convexHull(pts)
    poly = cv2.approxPolyDP(hull, eps, True).reshape(-1, 2)
    return bbox, [[int(x), int(y)] for x, y in poly]


def hull_poly(points, eps=1.0):
    pts = np.array(points, np.float32).reshape(-1, 1, 2)
    hull = cv2.convexHull(pts)
    poly = cv2.approxPolyDP(hull, eps, True).reshape(-1, 2)
    return [[round(float(x), 1), round(float(y), 1)] for x, y in poly]


def poly_bbox(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return [math.floor(min(xs)), math.floor(min(ys)), math.ceil(max(xs)), math.ceil(max(ys))]


def median_rgb(im, mask, top=0.5, kind='v'):
    """Median colour of the brightest part of the mask (sRGB as photographed)."""
    if not mask.any():
        return None
    s = signal(im, kind)[mask]
    cut = np.quantile(s, 1 - top)
    sel = mask.copy()
    sel[mask] = s >= cut
    bgr = np.median(im[sel].reshape(-1, 3), 0)
    return [int(bgr[2]), int(bgr[1]), int(bgr[0])]


def hue_deg(rgb):
    hsv = cv2.cvtColor(np.uint8([[rgb[::-1]]]), cv2.COLOR_BGR2HSV)[0, 0]
    return int(hsv[0]) * 2, int(hsv[1]), int(hsv[2])


# --------------------------------------------------------------------------- special methods

def measure_map(seed):
    """Map region: hull of road pixels (thin light lines, white top-hat) in 08, 09 and 14 (14 adds what our
    transparent-text-only 0.7.2 revealed), minus the boxes of every non-map element, plus C9's 08/09 hull."""
    ms = seed['measure']
    pts = []
    per = {}
    for pid in ms['photos']:
        im = rect(pid)
        g = signal(im, 'white')
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        th = cv2.morphologyEx(g, cv2.MORPH_TOPHAT, k)
        roi = np.zeros((H, W), np.uint8)
        cv2.fillPoly(roi, [np.int32(ms['roi_poly'])], 1)
        for e in ms['exclude'] + ms.get('exclude_' + pid, []):
            x0, y0, x1, y1 = clip_box(e)
            roi[y0:y1, x0:x1] = 0
        m = ((th >= ms['tophat_thr']) & (roi > 0)).astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        keep = np.zeros_like(m)
        for i in range(1, n):
            w_, h_ = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
            if st[i, cv2.CC_STAT_AREA] >= ms['amin'] and max(w_, h_) >= ms['min_len']:
                keep[lab == i] = 1
        ys, xs = np.nonzero(keep)
        per[pid] = {'road_px': int(len(xs))}
        if len(xs):
            P = np.stack([xs, ys], 1)
            hp = hull_poly(P, 1.0)
            per[pid]['hull_bbox'] = poly_bbox(hp)
            pts += hp
    c9 = json.load(open(C9))['map']['hull_08_09'] if os.path.exists(C9) else []
    poly = hull_poly(pts + c9, 1.5)
    return poly_bbox(poly), poly, {'per_photo': per, 'c9_hull_points': len(c9)}


def measure_needle(seed):
    """A straight needle: half-max of a top-hat signal in the ROI, then a robust line fit (pixels within 3 px of
    the line, refit twice); the polygon is the band around the line between the extreme projections, as wide as
    the 90th percentile of the inliers' distance on each side."""
    ms = seed['measure']
    im = rect(ms['photo'])
    mask, st = halfmax_mask(im, ms['roi'], ms['signal'], frac=ms.get('frac', 0.5), tophat=ms.get('tophat', 11),
                            amin=ms.get('amin', 15))
    ys, xs = np.nonzero(mask)
    P = np.stack([xs + 0.5, ys + 0.5], 1).astype(np.float32)
    keep = np.ones(len(P), bool)
    for _ in range(3):
        vx, vy, x0, y0 = cv2.fitLine(P[keep], cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        n = np.array([-vy, vx])
        d = (P - [x0, y0]) @ n
        keep = np.abs(d) <= 3.0
    t = (P[keep] - [x0, y0]) @ np.array([vx, vy])
    dk = d[keep]
    lo, hi = np.percentile(dk, 3) - 0.5, np.percentile(dk, 97) + 0.5
    a, b = t.min() - 0.5, t.max() + 0.5
    v = np.array([vx, vy])
    o = np.array([x0, y0])
    poly = [o + v * a + n * lo, o + v * b + n * lo, o + v * b + n * hi, o + v * a + n * hi]
    poly = [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in poly]
    st['rgb'] = median_rgb(im, mask, kind='v')
    st['line'] = {'angle_deg_from_x': round(math.degrees(math.atan2(vy, vx)), 2), 'width_px': round(float(hi - lo), 1),
                  'inliers': int(keep.sum()), 'mask_px': int(len(P))}
    return poly_bbox(poly), poly, st


def measure_black_box(seed):
    """Black box: dark rectangle on a lit background. Edges are the median half-max crossing of the rows/cols
    through its middle 60%. Measured on every listed photo; the first is adopted."""
    ms = seed['measure']
    res = {}
    for pid in ms['photos']:
        im = rect(pid)
        roi = ms['roi']
        mask, st = halfmax_mask(im, roi, 'dark', bg_pct=ms.get('bg_pct', 20), peak_pct=ms.get('peak_pct', 99.5),
                                keep='largest', amin=500)
        ys, xs = np.nonzero(mask)
        if not len(xs):
            continue
        bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        # rough edges: run from the box centre outward on the mask, median over the middle rows / cols
        cx, cy = int(np.median(xs)), int(np.median(ys))

        def run(line, c, step):
            k = c
            while 0 <= k + step < len(line) and line[k + step]:
                k += step
            return k
        mr = range(int(cy - 0.3 * (by1 - by0)), int(cy + 0.3 * (by1 - by0)))
        mc = range(int(cx - 0.3 * (bx1 - bx0)), int(cx + 0.3 * (bx1 - bx0)))
        bx0 = int(np.median([run(mask[y], cx, -1) for y in mr]))
        bx1 = int(np.median([run(mask[y], cx, 1) for y in mr])) + 1
        by0 = int(np.median([run(mask[:, x], cy, -1) for x in mc]))
        by1 = int(np.median([run(mask[:, x], cy, 1) for x in mc])) + 1
        v = signal(im, 'v').astype(np.float64)

        def edge(profile, e0):
            """profile runs from inside (dark) to outside; e0 = rough edge index. Local half-max crossing
            between the inside level (8-14 px inside) and the outside level (8-14 px outside)."""
            if e0 - 14 < 0 or e0 + 14 >= len(profile):
                return None
            lin = np.median(profile[e0 - 14:e0 - 7])
            lout = np.median(profile[e0 + 8:e0 + 15])
            if lout - lin < 20:
                return None                      # no contrast on this line
            t = (lin + lout) / 2
            for k in range(e0 - 7, e0 + 8):
                if profile[k] < t <= profile[k + 1]:
                    return k + (t - profile[k]) / (profile[k + 1] - profile[k])
            return None

        ry = range(int(by0 + 0.2 * (by1 - by0)), int(by1 - 0.2 * (by1 - by0)))
        rx = range(int(bx0 + 0.2 * (bx1 - bx0)), int(bx1 - 0.2 * (bx1 - bx0)))
        L, R, T, B = [], [], [], []
        for y in ry:
            row = v[y]
            e = edge(row[::-1], W - bx0)         # reversed: inside first
            if e is not None:
                L.append(W - e - 0.5)            # back to x; pixel centres at i + 0.5
            e = edge(row, bx1 - 1)
            if e is not None:
                R.append(e + 0.5)
        for x in rx:
            col = v[:, x]
            e = edge(col[::-1], H - by0)
            if e is not None:
                T.append(H - e - 0.5)
            e = edge(col, by1 - 1)
            if e is not None:
                B.append(e + 0.5)
        med = lambda a: round(float(np.median(a)), 1) if a else None
        res[pid] = {'bbox': [med(L), med(T), med(R), med(B)],
                    'spread': [round(float(np.percentile(a, 90) - np.percentile(a, 10)), 1) if a else None
                               for a in (L, T, R, B)],
                    'thr': st}
    first = ms['photos'][0]
    b = res[first]['bbox']
    poly = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]
    return b, poly, res


# --------------------------------------------------------------------------- schematics (our own generic drawings)

COL = {'red': '#e23b2e', 'amber': '#f2a312', 'green': '#3ccf3c', 'white': '#f2f2f2', 'grey': '#9a9a9a',
       'blue': '#3a7bd5', 'black': '#000000', 'multi': '#bdbdbd', 'cyan': '#3cc8d8', 'unknown': '#bdbdbd'}


def svg_wrap(w, h, body, title):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%g" height="%g">\n'
            '  <title>%s (generic schematic, our own drawing)</title>\n%s\n</svg>\n' % (w, h, w, h, title, body))


def txt(x, y, s, size, col, weight='bold', anchor='middle'):
    s = s.replace('&', '&amp;').replace('<', '&lt;')
    return ('  <text x="%.1f" y="%.1f" font-family="Arial, Helvetica, sans-serif" font-size="%.1f" '
            'font-weight="%s" fill="%s" text-anchor="%s" dominant-baseline="central">%s</text>'
            % (x, y, size, weight, col, anchor, s))


def schematic_svg(e, sch):
    x0, y0, x1, y1 = e['bbox']
    w, h = round(x1 - x0, 1), round(y1 - y0, 1)
    c = COL.get(e['colour']['name'], '#bdbdbd')
    kind = sch['kind']
    cx, cy, r = w / 2, h / 2, min(w, h) / 2
    sw = max(1.5, min(w, h) * 0.07)
    b = []
    if kind == 'ring':           # circle with a label, optional side brackets
        rr = r * (0.62 if sch.get('brackets') else 0.9)
        b.append('  <circle cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke="%s" stroke-width="%.1f"/>' % (cx, cy, rr, c, sw))
        if sch.get('brackets'):
            for sgn in (-1, 1):
                ax = cx + sgn * rr * 1.35
                b.append('  <path d="M %.1f %.1f Q %.1f %.1f %.1f %.1f" fill="none" stroke="%s" stroke-width="%.1f" stroke-linecap="round"/>'
                         % (ax, cy - rr * 0.9, ax + sgn * rr * 0.35, cy, ax, cy + rr * 0.9, c, sw))
        b.append(txt(cx, cy, sch.get('label', ''), rr * (1.1 if len(sch.get('label', '')) < 2 else 0.62), c))
    elif kind == 'tyre':         # a U-shaped tyre section with '!'
        b.append('  <path d="M %.1f %.1f L %.1f %.1f Q %.1f %.1f %.1f %.1f L %.1f %.1f" fill="none" stroke="%s" stroke-width="%.1f" stroke-linecap="round"/>'
                 % (w * 0.15, h * 0.1, w * 0.15, h * 0.7, cx, h * 0.98, w * 0.85, h * 0.7, w * 0.85, h * 0.1, c, sw))
        b.append(txt(cx, h * 0.45, '!', h * 0.55, c))
    elif kind == 'car_skid':     # a box car above two wavy lines
        b.append('  <rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="none" stroke="%s" stroke-width="%.1f"/>'
                 % (w * 0.15, h * 0.08, w * 0.7, h * 0.38, h * 0.08, c, sw))
        for k in (0.62, 0.84):
            b.append('  <path d="M %.1f %.1f q %.1f %.1f %.1f 0 t %.1f 0" fill="none" stroke="%s" stroke-width="%.1f"/>'
                     % (w * 0.12, h * k, w * 0.19, -h * 0.12, w * 0.38, w * 0.38, c, sw))
    elif kind == 'steering':     # wheel + '!'
        rr = min(w * 0.32, h * 0.42)
        b.append('  <circle cx="%.1f" cy="%.1f" r="%.1f" fill="none" stroke="%s" stroke-width="%.1f"/>' % (rr + sw, cy, rr, c, sw))
        b.append('  <line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%.1f"/>' % (sw, cy, 2 * rr + sw, cy, c, sw))
        b.append('  <line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%.1f"/>' % (rr + sw, cy, rr + sw, cy + rr, c, sw))
        b.append(txt(w * 0.9, cy, '!', h * 0.55, c))
    elif kind == 'seats':        # n seated figures, optional belt diagonal, optional airbag disc
        n = sch.get('n', 1)
        fw = w / n
        for i in range(n):
            ox = i * fw
            if sch.get('airbag'):
                b.append('  <circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>' % (ox + fw * 0.3, h * 0.35, min(fw, h) * 0.2, c))
                ox += fw * 0.25
            hx = ox + fw * 0.5
            b.append('  <circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>' % (hx, h * 0.14, min(fw, h) * 0.12, c))
            b.append('  <path d="M %.1f %.1f L %.1f %.1f L %.1f %.1f L %.1f %.1f" fill="none" stroke="%s" stroke-width="%.1f" stroke-linejoin="round"/>'
                     % (hx, h * 0.28, hx, h * 0.66, hx + fw * 0.28, h * 0.66, hx + fw * 0.28, h * 0.95, c, sw))
            if sch.get('belt', True):
                b.append('  <line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%.1f"/>'
                         % (hx - fw * 0.25, h * 0.6, hx + fw * 0.25, h * 0.3, c, sw * 0.8))
    elif kind == 'sign':         # round speed-limit sign: red ring, white disc, number
        b.append('  <circle cx="%.1f" cy="%.1f" r="%.1f" fill="#ffffff" stroke="%s" stroke-width="%.1f"/>' % (cx, cy, r * 0.88, COL['red'], r * 0.2))
        b.append(txt(cx, cy, sch.get('label', '50'), r * 0.8, '#222222'))
    elif kind == 'arrow':        # position arrow: a plain triangle
        b.append('  <polygon points="%.1f,%.1f %.1f,%.1f %.1f,%.1f" fill="%s"/>' % (cx, 0, w, h, 0, h, c))
    elif kind == 'text':
        lines = sch['label'].split('\n')
        longest = max(len(ln) for ln in lines)
        size = sch.get('size', min(h / len(lines) * 0.85, 0.95 * w / (longest * 0.62)))
        for i, ln in enumerate(lines):
            yy = h * (i + 0.5) / len(lines)
            anchor = sch.get('anchor', 'middle')
            xx = {'middle': cx, 'start': 0, 'end': w}[anchor]
            b.append(txt(xx, yy, ln, size, c, sch.get('weight', 'bold'), anchor))
    elif kind == 'panel':        # check-control panel: rounded box, 'i', two text bars
        b.append('  <rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="%.1f" fill="#1b1b1b" stroke="#cfcfcf" stroke-width="2"/>' % (2, 2, w - 4, h - 4, h * 0.25))
        b.append(txt(w * 0.07, h * 0.55, 'i', h * 0.45, '#f2f2f2', 'bold'))
        for k in (0.38, 0.72):
            b.append('  <rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="2" fill="#cfcfcf"/>' % (w * 0.2, h * k - 4, w * 0.6, 8))
    elif kind == 'poly':         # the element's own measured outline (geometry, not artwork)
        pts = ' '.join('%.1f,%.1f' % (p[0] - x0, p[1] - y0) for p in e['poly'])
        fill = sch.get('fill', 'none')
        b.append('  <polygon points="%s" fill="%s" fill-opacity="%s" stroke="%s" stroke-width="%s"/>'
                 % (pts, fill, sch.get('fill_opacity', 0.25), c if fill == 'none' else fill, sch.get('stroke', 2)))
        if sch.get('label'):
            b.append(txt(w / 2, h / 2, sch['label'], min(h * 0.12, 28), c, 'normal'))
    elif kind == 'line':
        b.append('  <line x1="0" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%.1f"/>' % (h / 2, w, h / 2, c, max(1.5, h * 0.5)))
    elif kind == 'needle':       # straight needle along the bbox diagonal given by 'from' -> 'to' corners
        a = sch['from']
        z = sch['to']
        b.append('  <line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%.1f" stroke-linecap="round"/>'
                 % (a[0] * w, a[1] * h, z[0] * w, z[1] * h, c, sch.get('width', 4)))
    elif kind == 'rect':
        b.append('  <rect x="0" y="0" width="%.1f" height="%.1f" fill="%s"/>' % (w, h, c))
        if sch.get('label'):
            b.append(txt(w / 2, h / 2, sch['label'], min(h * 0.15, 18), '#555555', 'normal'))
    elif kind == 'bars':         # segmented band (rev band)
        n = sch.get('n', 4)
        for i in range(n):
            b.append('  <rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s"/>' % (i * w / n + 1, h * 0.2, w / n - 2, h * 0.6, c))
    else:
        raise ValueError(kind)
    return svg_wrap(w, h, '\n'.join(b), e['name'])


# --------------------------------------------------------------------------- main

def colour_name_from_rgb(rgb):
    hdeg, sat, val = hue_deg(rgb)
    if sat < 60:
        return 'white' if val > 120 else 'grey'
    if hdeg < 22 or hdeg >= 330:
        return 'red'
    if hdeg < 50:
        return 'amber'
    if hdeg < 160:
        return 'green'
    if hdeg < 200:
        return 'cyan'
    if hdeg < 260:
        return 'blue'
    return 'unknown'


def expand_states(st):
    """Seeds keep states compact: {"08": [lit, colour or null, note], ...}."""
    out = []
    for pid in PHOTOS:
        if pid not in st:
            continue
        lit, col, note = (st[pid] + [None, None])[:3]
        s = {'photo': pid, 'lit': lit}
        if col:
            s['colour'] = col
        if note:
            s['note'] = note
        out.append(s)
    return out


def photos_block(seeds):
    hj = json.load(open(os.path.join(RECT, 'H.json')))
    out = {}
    for pid in PHOTOS:
        d = hj[pid]
        meta = seeds['photos'][pid]
        out[pid] = {'file': d['source'], 'rect': 'bake/work/overlay/rect/%s.png' % pid, 'shows': meta['shows'],
                    'theme_version': meta.get('theme_version'), 'rms_px': d['rms_panel_px'],
                    'usable_for_geometry': bool(d['usable_for_geometry']),
                    'note': meta['note'] + (' B: ' + d['reason'] if d.get('reason') else '')}
    return out


def measure(seed):
    ms = seed['measure']
    if ms['method'] == 'map':
        return measure_map(seed)
    if ms['method'] == 'black_box':
        return measure_black_box(seed)
    if ms['method'] == 'needle':
        return measure_needle(seed)
    if ms['method'] == 'fixed':          # adopted from elsewhere (stated in measured_by)
        b = ms['bbox']
        return b, ms.get('poly'), {}
    im = rect(ms['photo'])
    mask, st = halfmax_mask(im, ms['roi'], ms['signal'], frac=ms.get('frac', 0.5), bg_pct=ms.get('bg_pct', 20),
                            peak_pct=ms.get('peak_pct', 99.5), exclude=ms.get('exclude', []),
                            amin=ms.get('amin', 4), thr=ms.get('thr'), keep=ms.get('keep', 'all'),
                            local=ms.get('local', False), tophat=ms.get('tophat', 0),
                            remove_vlines=ms.get('remove_vlines', 0))
    bbox, poly = mask_geom(mask, ms.get('eps', 0.75))
    if bbox is None:
        raise SystemExit('%s: nothing found in roi %s on %s' % (seed['id'], ms['roi'], ms['photo']))
    st['rgb'] = median_rgb(im, mask, kind=ms['signal'] if ms['signal'] != 'white' else 'v')
    st['mask_px'] = int(mask.sum())
    st['_mask'] = mask
    return bbox, poly, st


def c9_deltas(els):
    if not os.path.exists(C9):
        return []
    c9 = json.load(open(C9))
    t = c9['telltales']
    br = c9['bottom_row']
    pairs = [
        ('tt.brake', t['08_left'][0]['x0y0x1y1'], 'telltales.08_left[0]'),
        ('tt.tpms', t['08_left'][1]['x0y0x1y1'], 'telltales.08_left[1]'),
        ('tt.abs', t['08_left'][2]['x0y0x1y1'], 'telltales.08_left[2]'),
        ('tt.dsc', t['08_left'][3]['x0y0x1y1'], 'telltales.08_left[3]'),
        ('tt.auto_h', [t['08_right'][0]['x0y0x1y1'][0], min(t['08_right'][0]['x0y0x1y1'][1], t['08_right'][1]['x0y0x1y1'][1]),
                       t['08_right'][1]['x0y0x1y1'][2], max(t['08_right'][0]['x0y0x1y1'][3], t['08_right'][1]['x0y0x1y1'][3])],
         'telltales.08_right[0]+[1]'),
        ('tt.parking_brake', t['08_right'][2]['x0y0x1y1'], 'telltales.08_right[2]'),
        ('tt.steering', t['08_right'][3]['x0y0x1y1'], 'telltales.08_right[3]'),
        ('bottom.belt_rear', t['08_bottom'][0], 'telltales.08_bottom[0]'),
        ('bottom.belt_driver', t['08_bottom'][1], 'telltales.08_bottom[1] (08)'),
        ('bottom.belt_driver', c9['belt_lamp']['adopted'], 'belt_lamp.adopted (10)'),
        ('bottom.airbag', t['08_bottom'][3], 'telltales.08_bottom[3]'),
        ('bottom.range', br['08'][0], 'bottom_row.08[0]'),
        ('bottom.clock', br['08'][1], 'bottom_row.08[1]'),
        ('bottom.cc_info', br['08'][2], 'bottom_row.08[2] ("i")'),
        ('bottom.street', br['09'][2], 'bottom_row.09[2]'),
        ('bottom.temperature', br['08'][4], 'bottom_row.08[4]'),
        ('assist.cc_panel', br['08_check_control_panel'], 'bottom_row.08_check_control_panel'),
        ('assist.gear', c9['gear_letter']['adopted'], 'gear_letter.adopted (10)'),
        ('assist.gear_centre', c9['gear_letter']['stock_position_08_09'], 'gear_letter.stock_position_08_09'),
        ('overlay.black_box', c9['black_box']['adopted'], 'black_box.adopted (10)'),
        ('map.region', c9['map']['bbox_08_09'], 'map.bbox_08_09'),
    ]
    byid = {e['id']: e for e in els}
    rows = []
    for i, cb, src in pairs:
        if i not in byid:
            continue
        b = byid[i]['bbox']
        d = [round(b[k] - cb[k], 1) for k in range(4)]
        dc = [round((b[0] + b[2] - cb[0] - cb[2]) / 2, 1), round((b[1] + b[3] - cb[1] - cb[3]) / 2, 1)]
        rows.append({'id': i, 'c9_source': src, 'c9': cb, 'e': b, 'd_edges': d, 'd_centre': dc,
                     'within_3px': max(abs(v) for v in d) <= 3})
    return rows


def photo_metrics(e, kind):
    """Signal in the element's bbox in each photo (to support the by-eye states)."""
    out = {}
    x0, y0, x1, y1 = clip_box(e['bbox'])
    for pid in PHOTOS:
        im = rect(pid)[y0:y1, x0:x1]
        s = signal(im, kind)
        p = np.percentile(s, 98)
        sel = s >= p
        bgr = np.median(im[sel].reshape(-1, 3), 0)
        out[pid] = {'p98': round(float(p), 1), 'p50': round(float(np.percentile(s, 50)), 1),
                    'rgb_top': [int(bgr[2]), int(bgr[1]), int(bgr[0])]}
    return out


GROUP_COL = {'telltale': (0, 200, 255), 'bottom-row': (255, 160, 60), 'map-nav': (80, 255, 80),
             'assist-message': (255, 80, 255), 'structure': (180, 180, 180), 'overlay': (60, 60, 255)}


def draw_sheet(els):
    base = rect('08').astype(np.float32) * 0.55
    sheet = np.zeros((720 + 380, 1920, 3), np.uint8)
    top = base.astype(np.uint8).copy()
    # structure first (thin), then the rest
    order = sorted(els, key=lambda e: (e['group'] != 'structure', e['group'] != 'map-nav'))
    labels = []
    for e in order:
        col = GROUP_COL[e['group']]
        poly = np.array(e['poly'] if e.get('poly') else [[e['bbox'][0], e['bbox'][1]], [e['bbox'][2], e['bbox'][1]],
                                                        [e['bbox'][2], e['bbox'][3]], [e['bbox'][0], e['bbox'][3]]], np.float32)
        cv2.polylines(top, [np.round(poly * 4).astype(np.int32)], True, col, 1, cv2.LINE_AA, shift=2)
        labels.append((e, col))
    # labels: placed above/below the bbox, avoiding overlaps greedily
    placed = []
    for e, col in labels:
        x0, y0, x1, y1 = e['bbox']
        s = e['id']
        fs = 0.36
        (tw, th), _ = cv2.getTextSize(s, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
        cands = []
        for dy in [-4, 0, 14, 28, -18, -32, 42, -46, 56, -60]:
            for xx in [x0, x1 - tw, x0 - tw - 4, x1 + 4]:
                yy = (y0 + dy) if dy <= 0 else (y1 + dy - 4)
                cands.append((int(xx), int(yy)))
        if e['group'] == 'structure' or e['id'] == 'map.region':
            cx = int(np.mean([p[0] for p in e['poly']])) if e.get('poly') else int((x0 + x1) / 2)
            cands = [(cx - tw // 2, int(y0) + 14 + k) for k in range(0, 200, 12)] + cands
        for (xx, yy) in cands:
            xx = min(max(xx, 1), 1919 - tw)
            yy = min(max(yy, th + 1), 718)
            r = (xx - 1, yy - th - 1, xx + tw + 1, yy + 2)
            if all(r[2] < q[0] or r[0] > q[2] or r[3] < q[1] or r[1] > q[3] for q in placed):
                break
        placed.append(r)
        cv2.rectangle(top, (r[0], r[1]), (r[2], r[3]), (0, 0, 0), -1)
        cv2.putText(top, s, (xx, yy), cv2.FONT_HERSHEY_SIMPLEX, fs, col, 1, cv2.LINE_AA)
    sheet[:720] = top
    for k, pid in enumerate(['14', '09']):
        im = (rect(pid).astype(np.float32) * 0.6).astype(np.uint8)
        for e in els:
            col = GROUP_COL[e['group']]
            if e.get('poly'):
                cv2.polylines(im, [np.round(np.array(e['poly'], np.float32) * 4).astype(np.int32)], True, col, 2, cv2.LINE_AA, shift=2)
        small = cv2.resize(im, (948, 356), interpolation=cv2.INTER_AREA)
        ox = 8 + k * 964
        sheet[730:730 + 356, ox:ox + 948] = small
        cv2.putText(sheet, 'rect %s with the catalogue polygons' % pid, (ox + 6, 1080 + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (220, 220, 220), 1, cv2.LINE_AA)
    lx = 1220
    for g, col in GROUP_COL.items():
        cv2.putText(sheet, g, (lx, 1094), cv2.FONT_HERSHEY_SIMPLEX, 0.42, col, 1, cv2.LINE_AA)
        lx += 12 + cv2.getTextSize(g, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)[0][0]
    cv2.imwrite(SHEET, sheet)


def main():
    seeds = json.load(open(SEEDS))
    os.makedirs(SCHEM_DIR, exist_ok=True)
    els = []
    metrics = {}
    for sd in seeds['elements']:
        bbox, poly, st = measure(sd)
        ms = sd['measure']
        e = {'id': sd['id'], 'group': sd['group'], 'name': sd['name'], 'safety': sd['safety'],
             'bbox': [round(float(v), 1) for v in bbox], 'poly': poly}
        rgb = sd.get('rgb') or (st.get('rgb') if isinstance(st, dict) else None)
        cname = sd.get('colour') or (colour_name_from_rgb(rgb) if rgb else 'unknown')
        e['colour'] = {'name': cname}
        if rgb:
            e['colour']['rgb'] = rgb
        e['states'] = expand_states(sd['states'])
        e['relation'] = 'unknown'
        e['evidence'] = 'none'
        e['relation_basis'] = []
        e['schematic'] = None
        e['measured_by'] = sd['measured_by']
        e['notes'] = sd.get('notes', '')
        if sd.get('schematic'):
            path = os.path.join(SCHEM_DIR, sd['id'] + '.svg')
            with open(path, 'w') as f:
                f.write(schematic_svg(e, sd['schematic']))
            e['schematic'] = rel(path)
        els.append(e)
        m = {k: v for k, v in (st.items() if isinstance(st, dict) else []) if not k.startswith('_')}
        if ms['method'] == 'halfmax':
            m['hue_sat_val'] = hue_deg(m['rgb']) if m.get('rgb') else None
            m['per_photo'] = photo_metrics(e, ms['signal'])
            checks = {}
            for pid in ms.get('check_photos', []):      # the same ROI and signal on other rects
                mk, _ = halfmax_mask(rect(pid), ms['roi'], ms['signal'], frac=ms.get('frac', 0.5),
                                     bg_pct=ms.get('bg_pct', 20), peak_pct=ms.get('peak_pct', 99.5),
                                     exclude=ms.get('exclude', []), amin=ms.get('amin', 4), keep=ms.get('keep', 'all'),
                                     local=ms.get('local', False), tophat=ms.get('tophat', 0),
                                     remove_vlines=ms.get('remove_vlines', 0))
                bb, _ = mask_geom(mk)
                if bb:
                    checks[pid] = {'bbox': bb, 'centre': [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2],
                                   'd_centre_vs_adopted': [round((bb[0] + bb[2] - e['bbox'][0] - e['bbox'][2]) / 2, 1),
                                                           round((bb[1] + bb[3] - e['bbox'][1] - e['bbox'][3]) / 2, 1)]}
            if checks:
                m['checks'] = checks
        metrics[sd['id']] = m
    # stale schematics
    keep = {e['id'] + '.svg' for e in els if e['schematic']}
    for f in os.listdir(SCHEM_DIR):
        if f.endswith('.svg') and f not in keep:
            os.remove(os.path.join(SCHEM_DIR, f))
    doc = {
        '$comment': 'The stock G20 Comfort elements on the panel target. Geometry, colour, per-photo states, safety '
                    'proposal and schematic by package E (tools/overlay/catalogue_g20.py from '
                    'tools/overlay/catalogue_g20_seeds.json, measured on the package-B rects); relation, evidence and '
                    'relation_basis are filled by package F. See README.md.',
        'kind': 'g20-elements', 'schema_version': 1, 'mode': 'comfort', 'target': 'panel',
        'panel': {'w': 1920, 'h': 720},
        'photos': photos_block(seeds),
        'excluded': seeds['excluded'],
        'elements': els,
    }
    with open(OUT_JSON, 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    deltas = c9_deltas(els)
    with open(METRICS, 'w') as f:
        json.dump({'elements': metrics, 'c9_deltas': deltas}, f, indent=1)
    draw_sheet(els)
    # report
    from collections import Counter
    print('elements:', len(els), dict(Counter(e['group'] for e in els)))
    for e in els:
        m = metrics[e['id']]
        print('%-26s %-14s %-8s bbox %-30s %-6s rgb %s %s' % (e['id'], e['group'], e['safety'], e['bbox'], e['colour']['name'],
                                                           e['colour'].get('rgb'), m.get('hue_sat_val', '')))
    print('\ndeltas vs C9 (E - C9), edges x0 y0 x1 y1 | centre')
    for r in deltas:
        print('%-20s %-36s %-26s %s %s' % (r['id'], r['c9_source'], r['d_edges'], r['d_centre'], 'ok' if r['within_3px'] else '>3'))
    print('\nwrote', rel(OUT_JSON), rel(SHEET), rel(METRICS), '+', len(keep), 'schematics')


if __name__ == '__main__':
    main()
