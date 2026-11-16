"""Package ZC: the stock atlas of zone C (BMW's check-control panel, its symbol slot, the message text, the road
label, the standby odometer, the rail ends in the centre) measured on the 2026-11-16 photos.

Edge convention: 50 % between the local black and the element's own plateau, on the 4x zone crop, in continuous
panel coordinates. Text "ink" is thresholded at 50 % of (98th percentile - black) inside its box.
No text content is read or written: boxes, baselines, heights and colours only.

Run from the repo root:
    UV_CACHE_DIR=$F30_MAIN/bake/work/.uvcache uv run -q --no-project --with opencv-python-headless \
        --with numpy python -I tools/strip/ZC/atlas.py > bake/work/strip/zone-c/atlas_raw.txt
Writes bake/work/strip/zone-c/atlas_raw.json (git-ignored; numbers only, but kept beside the pixels).
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zc_common as Z  # noqa: E402

OUTJ = os.path.join(Z.WORK, 'zone-c', 'atlas_raw.json')
PHOTOS = ['60', '61', '62', '63', '64', '65', '66', '67', '68']
MSG = ['62', '66']
NOMSG = ['61', '63', '64', '65', '67', '68']
BLACK_BOX = (650, 600, 690, 636)      # empty in every state (left of the panel, above the rail)


def black_of(Y):
    return float(np.percentile(Z.cut(Y, *BLACK_BOX), 50))


def column(Y, x, y0=590, y1=668):
    """1-panel-px-wide column at continuous x (x .. x+1), rows y0..y1 at 4x."""
    c = Z.cut(Y, x, y0, x + 1, y1).mean(1)
    return c


def ridges(c, y0, bk, thr):
    """Bright runs in a column profile: centroid, 50% edges (continuous panel y) and peak."""
    out, i, n = [], 0, len(c)
    on = c > bk + thr
    while i < n:
        if not on[i]:
            i += 1
            continue
        j = i
        while j < n and on[j]:
            j += 1
        seg = c[i:j]
        pk = float(seg.max())
        half = bk + (pk - bk) / 2
        a = i
        while a > 0 and c[a - 1] > half:
            a -= 1
        while c[a] < half:
            a += 1
        t0 = a - 1 + (half - c[a - 1]) / (c[a] - c[a - 1]) if a > 0 else float(a)
        b = j - 1
        while c[b] < half:
            b -= 1
        t1 = b + (c[b] - half) / (c[b] - c[b + 1]) if b + 1 < n else float(b)
        w = np.clip(c[i:j] - bk, 0, None)
        cy = float((np.arange(i, j) * w).sum() / w.sum())
        f = lambda s: y0 + (s + 0.5) / Z.N   # noqa: E731
        # a 50% crossing between samples s and s+1 sits at the sample boundary + interpolation
        out.append({'c': round(f(cy), 3), 'top': round(f(t0 + 0.5) - 0.5 / Z.N, 3),
                    'bot': round(f(t1 + 0.5) - 0.5 / Z.N, 3), 'peak': round(pk, 4)})
        i = j
    return out


def trace(Y, xs, y0, y1, bk, thr):
    rows = []
    for x in xs:
        r = ridges(column(Y, x, y0, y1), y0, bk, thr)
        rows.append((x + 0.5, r))
    return rows


def fit_circle(pts):
    p = np.asarray(pts, float)
    A = np.c_[2 * p[:, 0], 2 * p[:, 1], np.ones(len(p))]
    b = (p ** 2).sum(1)
    cx, cy, c = np.linalg.lstsq(A, b, rcond=None)[0]
    r = np.sqrt(c + cx ** 2 + cy ** 2)
    res = np.hypot(p[:, 0] - cx, p[:, 1] - cy) - r
    return [round(float(cx), 2), round(float(cy), 2), round(float(r), 2), round(float(np.sqrt((res ** 2).mean())), 3)]


def ink(Y, box, bk, frac=0.5, white=None, amin=6):
    """Connected ink components inside a panel box: list of [x0, y0, x1, y1] (continuous), the white used."""
    sub = Z.cut(Y, *box)
    w = white if white is not None else float(np.percentile(sub, 99.0))
    m = (sub > bk + frac * (w - bk)).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    comps = []
    for i in range(1, n):
        x, y, ww, hh, a = st[i]
        if a < amin * Z.N:
            continue
        comps.append([round(box[0] + x / Z.N, 2), round(box[1] + y / Z.N, 2), round(box[0] + (x + ww) / Z.N, 2),
                      round(box[1] + (y + hh) / Z.N, 2), int(a)])
    return comps, w


def union(comps):
    if not comps:
        return None
    a = np.array([c[:4] for c in comps])
    return [round(float(a[:, 0].min()), 2), round(float(a[:, 1].min()), 2), round(float(a[:, 2].max()), 2),
            round(float(a[:, 3].max()), 2)]


def lines_of(comps, gap=4.0):
    """Group components into text lines by vertical overlap of their centres."""
    cs = sorted(comps, key=lambda c: (c[1] + c[3]) / 2)
    lines = []
    for c in cs:
        cy = (c[1] + c[3]) / 2
        if lines and abs(cy - lines[-1]['cy']) < gap + (c[3] - c[1]) / 2:
            lines[-1]['c'].append(c)
            lines[-1]['cy'] = np.mean([(d[1] + d[3]) / 2 for d in lines[-1]['c']])
        else:
            lines.append({'cy': cy, 'c': [c]})
    return [l['c'] for l in lines]


def line_metrics(comps):
    """Baseline = median bottom of the components whose bottom is within 1.5 px of the commonest bottom;
    x-top = the commonest top; cap-top = the 90th percentile of heights' tops (the tallest, ascenders/capitals)."""
    b = np.array([c[3] for c in comps])
    t = np.array([c[1] for c in comps])
    hist = np.round(b * 2) / 2
    vals, cnt = np.unique(hist, return_counts=True)
    mode = vals[cnt.argmax()]
    base = float(np.median(b[np.abs(b - mode) <= 1.5]))
    ht = np.round(t * 2) / 2
    tv, tc = np.unique(ht, return_counts=True)
    xtop = float(np.median(t[np.abs(t - tv[tc.argmax()]) <= 1.5]))
    cap = float(np.percentile(t, 10))
    desc = float(b.max())
    u = union(comps)
    return {'box': u, 'width': round(u[2] - u[0], 2), 'centre_x': round((u[0] + u[2]) / 2, 2),
            'baseline': round(base, 2), 'x_top': round(xtop, 2), 'cap_top': round(cap, 2),
            'x_height': round(base - xtop, 2), 'cap_height': round(base - cap, 2),
            'descender_bottom': round(desc, 2), 'components': len(comps)}


def rail_end(Y, ya, yb, xa, xb, bk, side):
    """x where a horizontal rail's brightness (rows ya..yb mean) crosses 50% of its plateau, searching xa..xb."""
    prof = Z.cut(Y, xa, ya, xb, yb).mean(0)
    pk = np.percentile(prof, 95)
    half = bk + (pk - bk) / 2
    xs = Z.ZX0 + 0 + (np.arange(len(prof)) + 0.5) / Z.N + (xa - Z.ZX0)
    xs = xa + (np.arange(len(prof)) + 0.5) / Z.N
    idx = np.nonzero(prof > half)[0]
    if not len(idx):
        return None
    if side == 'end':      # last bright sample, interpolate to the right
        i = idx.max()
        if i + 1 >= len(prof):
            return None
        return round(float(xs[i] + (prof[i] - half) / (prof[i] - prof[i + 1]) / Z.N), 2)
    i = idx.min()
    if i == 0:
        return None
    return round(float(xs[i - 1] + (half - prof[i - 1]) / (prof[i] - prof[i - 1]) / Z.N), 2)


def colour(rgb, mask):
    v = rgb[mask].mean(0)
    s = Z.lin_to_srgb(v)
    return {'linear_rgb': [round(float(a), 5) for a in v], 'srgb8': [int(round(255 * float(a))) for a in s]}


def main():
    res = {'_about': 'zone C atlas, raw. Continuous panel coordinates. Y = linear luminance (Rec.709) of the photo '
                     'after sRGB decoding; NOT display-linear until package R photometry is used.'}
    for pid in PHOTOS:
        rgb, tag = Z.load(pid)
        Y = Z.lum(rgb)
        bk = black_of(Y)
        e = {'source': tag, 'black_Y': round(bk, 5)}
        # ---- the rail(s) in the zone: every 0.5 px from 684 to 1252
        xs = np.arange(684, 1252, 0.5)
        tr = trace(Y, xs, 590, 668, bk, 0.10)
        e['ridges'] = [[float(x), r] for x, r in tr]
        # ---- rail ends on the main rail line (rows 644..650)
        e['speedo_rail_end_x'] = rail_end(Y, 644.5, 648.5, 670, 702, bk, 'end')
        e['tacho_rail_start_x'] = rail_end(Y, 644.5, 648.5, 1218, 1250, bk, 'start')
        # ---- texts
        if pid in MSG:
            sym, wsym = ink(Y, (712, 622, 762, 692), bk)
            e['symbol'] = {'box': union(sym), 'white_Y': round(wsym, 4), 'components': [c[:4] for c in sym]}
            txt, wt = ink(Y, (765, 612, 1200, 712), bk)
            e['text_white_Y'] = round(wt, 4)
            e['text_lines'] = [line_metrics(l) for l in lines_of(txt)]
            # fill: clean columns away from the text (left of the text, right of the text)
            tx0 = min(l['box'][0] for l in e['text_lines'])
            tx1 = max(l['box'][2] for l in e['text_lines'])
            e['fill_columns'] = {}
            for x in (712, 720, 730, 765, 790, tx0 - 8, tx1 + 8, 1150, 1170, 1190, 1205, 1212):
                c = Z.cut(Y, x, 596, x + 2, 720).mean(1)
                e['fill_columns'][str(round(x, 1))] = [round(float(v), 5) for v in c.reshape(-1, Z.N).mean(1)]
            e['fill_rows'] = {}
            for y in (610, 614, 620, 630, 640, 660, 680, 700, 712):
                r = Z.cut(Y, 690, y, 1240, y + 2).mean(0)
                e['fill_rows'][str(y)] = [round(float(v), 5) for v in r.reshape(-1, Z.N).mean(1)]
            # fill colour: just under the arc, clear of the text (x 765..tx0-6, y 609..616)
            m = np.zeros(Y.shape, bool)
            Z.cut(m, 765, 609, tx0 - 6, 616)[...] = True
            e['fill_colour_top'] = colour(rgb, m)
            m[:] = False
            Z.cut(m, 780, 676, 1160, 690)[...] = True
            e['fill_colour_low'] = colour(rgb, m)
            # rail colour on the flat part
            m[:] = False
            Z.cut(m, 780, 603.2, 1150, 605.4)[...] = True
            e['arc_colour'] = colour(rgb, m)
            # text colour: the brightest 30% of ink pixels in the text box
            sub = Z.cut(Y, 765, 612, 1200, 712)
            thr = np.percentile(sub, 99.3)
            mm = np.zeros(Y.shape, bool)
            Z.cut(mm, 765, 612, 1200, 712)[...] = sub >= thr
            e['text_colour'] = colour(rgb, mm)
        else:
            rl, wr = ink(Y, (700, 664, 1240, 716), bk)
            # keep only the components of the centre label (drop the mode label beyond x 1222 and grid)
            rl = [c for c in rl if c[0] > 700 and c[2] < 1222]
            if rl:
                e['road_or_odo_white_Y'] = round(wr, 4)
                e['road_or_odo_lines'] = [line_metrics(l) for l in lines_of(rl)]
                e['road_or_odo_components'] = [c[:4] for c in sorted(rl)]
        res[pid] = e
        print(pid, tag, 'black', round(bk, 5), 'rail end', e['speedo_rail_end_x'], 'start', e['tacho_rail_start_x'])
        for k in ('symbol', 'text_lines', 'road_or_odo_lines', 'fill_colour_top', 'fill_colour_low', 'arc_colour',
                  'text_colour'):
            if k in e:
                v = e[k]
                if k == 'symbol':
                    v = v['box']
                print('  ', k, json.dumps(v))
    json.dump(res, open(OUTJ, 'w'))


if __name__ == '__main__':
    main()
