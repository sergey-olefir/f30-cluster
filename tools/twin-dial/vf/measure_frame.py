"""Package VF: measure the frame (tab bar, centre window, bottom row, telltale strip) of each reference and express it
in dial units.

Each element is a rough box (read off zoomed crops by eye, original px) plus a method; the method finds the edge
inside the box, so the box only has to contain the element and some background:

  rows    : the box's row-mean luminance profile; top / bottom 50 % edges of the bright plateau (bar heights)
  cols    : the column-mean profile; left / right 50 % edges of the plateau (bar ends)
  gaps    : the column-mean profile; every dark dip below 50 % between the plateau and the dip floor: separators
  hrule   : the brightest thin row: centre (sub-px centroid), FWHM, and its run along that row at 50 % (rule ends)
  vrule   : the same, transposed
  ink     : bounding box of the pixels above bg + 50 % (p99.5 - bg) in the box (texts and icons; bg = 10th pct)
  words   : ink as above, split into groups at column gaps of at least spec[2] px (number | unit, label | value)
  red/green/cyan : bounding box of the pixels of that hue (a highlighted tab or a coloured rule)

Edges are at 50 % between the local background and the element's plateau, in continuous px (pixel i covers
[i, i+1)). Every result is then expressed in the frame of the two fitted bezels (fit_dials.py):
  origin M = midpoint of the two dial centres, u axis along tacho -> speedo, v axis perpendicular (down),
  u, v in units of D (the centre distance) and also in units of R (the mean bezel radius).
On the ORIGINAL (unrectified) references this is a similarity frame only: perspective is NOT removed (PROVISIONAL).

With VF_VR=<package VR's pub dir> the same boxes are mapped through VR's model (k1 radial term, then
H_src_to_dial; the box is the bounding box of 16 mapped points on its outline, padded 3 dial px) and every method
runs on VR's rectified image <id>_rect.png (left bezel R = 400 px, centre line horizontal). The dial frame is then
VR's canvas: tacho centre left_centre, speedo centre right_centre, R = 400 px (the LEFT bezel), D = their distance.
Those are the numbers the report uses.

Run from the repo root:
    .../python -I tools/twin-dial/vf/measure_frame.py [dials.json] [out.json] [overlay_dir]
    VF_VR=bake/work/twin-dial/pub/VR .../python -I tools/twin-dial/vf/measure_frame.py - out.json overlay_dir
"""
import json
import math
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DIALS = sys.argv[1] if len(sys.argv) > 1 else 'bake/work/twin-dial/vf/dials_orig.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'bake/work/twin-dial/vf/frame_orig.json'
OVL = sys.argv[3] if len(sys.argv) > 3 else 'bake/work/twin-dial/vf/overlay'
SRC = os.environ.get('VF_SRC', 'reference/vc')
CONF = json.load(open(os.path.join(HERE, 'frame_boxes.json')))
VR = os.environ.get('VF_VR')


def vr_model(ref):
    """package VR's model for reference <ref> -> (map(x, y) source px -> dial px, dials dict in measure units)"""
    m = json.load(open(os.path.join(VR, ref[:2] + '_model.json')))
    H = np.array(m['H_src_to_dial'], float)
    k1, (kcx, kcy), ks = m['k1'], m['k1_centre'], m['k1_scale']
    cv = m['canvas']

    def f(x, y):
        # OpenCV index = pixel centre; our continuous px put a pixel's centre at i + 0.5
        qx, qy = x - 0.5, y - 0.5
        r2 = ((qx - kcx) ** 2 + (qy - kcy) ** 2) / ks ** 2
        ux, uy = kcx + (qx - kcx) * (1 + k1 * r2), kcy + (qy - kcy) * (1 + k1 * r2)
        p = H @ np.array([ux, uy, 1.0])
        return p[0] / p[2] + 0.5, p[1] / p[2] + 0.5

    (lx, ly), (rx, ry) = cv['left_centre'], cv['right_centre']
    lx, ly, rx, ry = lx + 0.5, ly + 0.5, rx + 0.5, ry + 0.5
    d = {'tacho': {'cx': lx, 'cy': ly}, 'speedo': {'cx': rx, 'cy': ry}, 'D_px': math.hypot(rx - lx, ry - ly),
         'R_mean_px': cv['R_px']}
    return f, d


def src_R(ref):
    """source px per R of reference <ref> (mean of VR's left and right), to scale px-sized parameters"""
    s = json.load(open(os.path.join(VR, 'index.json')))['refs'][ref[:2]]['src_px_per_R']
    return (s['left'] + s['right']) / 2


def map_box(f, b, pad=3):
    x0, y0, x1, y1 = b
    pts = [f(x0 + (x1 - x0) * t, y) for t in np.linspace(0, 1, 5) for y in (y0, y1)]
    pts += [f(x, y0 + (y1 - y0) * t) for t in np.linspace(0, 1, 5)[1:-1] for x in (x0, x1)]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [int(math.floor(min(xs))) - pad, int(math.floor(min(ys))) - pad,
            int(math.ceil(max(xs))) + pad, int(math.ceil(max(ys))) + pad]


def lum(img):
    f = img.astype(np.float32) / 255.0
    f = np.where(f <= 0.04045, f / 12.92, ((f + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f[..., 2] + 0.7152 * f[..., 1] + 0.0722 * f[..., 0]


def plateau_edges(p, o):
    """first / last 50 % crossings of the bright plateau of profile p (offset o)"""
    bg = float(np.percentile(p, 5))
    pk = float(np.percentile(p, 95))
    lv = bg + 0.5 * (pk - bg)
    on = np.where(p >= lv)[0]
    if len(on) == 0:
        return None
    i0, i1 = on[0], on[-1]
    a = o + (i0 + 0.5 - (p[i0] - lv) / (p[i0] - p[i0 - 1]) if i0 > 0 and p[i0] != p[i0 - 1] else i0)
    b = o + (i1 + 0.5 + (p[i1] - lv) / (p[i1] - p[i1 + 1]) if i1 + 1 < len(p) and p[i1] != p[i1 + 1] else i1 + 1)
    return a, b, bg, pk


def m_rows(Y, b):
    x0, y0, x1, y1 = b
    p = Y[y0:y1, x0:x1].mean(1)
    a, c, bg, pk = plateau_edges(p, y0)
    return {'y0': a, 'y1': c, 'bg': bg, 'plateau': pk}


def m_cols(Y, b):
    x0, y0, x1, y1 = b
    p = Y[y0:y1, x0:x1].mean(0)
    a, c, bg, pk = plateau_edges(p, x0)
    return {'x0': a, 'x1': c, 'bg': bg, 'plateau': pk}


def m_gaps(Y, b, min_depth=0.25):
    x0, y0, x1, y1 = b
    p = cv2.GaussianBlur(Y[y0:y1, x0:x1].mean(0).reshape(1, -1), (3, 1), 0).ravel()
    out = []
    for i in range(2, len(p) - 2):
        if p[i] <= p[i - 1] and p[i] < p[i + 1]:
            l = p[max(0, i - 12):i].max()
            r = p[i + 1:i + 13].max()
            top = min(l, r)
            if top - p[i] < min_depth * top:
                continue
            lv = p[i] + 0.5 * (top - p[i])
            a = i
            while a > 0 and p[a] < lv:
                a -= 1
            c = i
            while c < len(p) - 1 and p[c] < lv:
                c += 1
            out.append({'x': x0 + i + 0.5, 'w50': float(c - a - 1), 'depth': float((top - p[i]) / top)})
    return {'gaps': out}


def m_hrule(Y, b, T=False):
    x0, y0, x1, y1 = b
    S = Y[y0:y1, x0:x1]
    if T:
        S = S.T
    p = S.mean(1)
    bg = float(np.median(p))
    i = int(np.argmax(p))
    w = np.clip(p[max(0, i - 3):i + 4] - bg, 0, None)
    c = (np.arange(max(0, i - 3), i + 4)[:len(w)] + 0.5) @ w / w.sum()
    hm = bg + 0.5 * (p[i] - bg)
    a = i
    while a > 0 and p[a - 1] > hm:
        a -= 1
    d = i
    while d < len(p) - 1 and p[d + 1] > hm:
        d += 1
    # the run: per column, the rule's contrast (max within +-4 rows of a line fitted to the per-column peaks, minus
    # the median of the column), traced out from the box's middle until it stays under 50 % of the median contrast
    # of the middle third for more than 2 px (so a tilted rule, a gap of a pixel or text above it do not end it)
    n = S.shape[1]
    lo, hi = max(0, i - 6), min(S.shape[0], i + 7)
    band = S[lo:hi]
    pkr = band.argmax(0) + lo
    xs = np.arange(n)
    mid = slice(n // 3, 2 * n // 3)
    A = np.polyfit(xs[mid], pkr[mid], 1)
    line = np.polyval(A, xs)
    con = np.zeros(n)
    for x in range(n):
        r0 = int(round(line[x]))
        seg = S[max(0, r0 - 2):r0 + 3, x]
        con[x] = seg.max() - np.median(S[:, x])
    ref = float(np.median(con[mid]))
    def trace(start, step):
        x, miss, last = start, 0, start
        while 0 <= x < n:
            if con[x] >= 0.5 * ref:
                last, miss = x, 0
            else:
                miss += 1
                if miss > 2:
                    break
            x += step
        return last
    a_, b_ = trace(n // 2, -1), trace(n // 2, 1)
    o = (y0, x0) if not T else (x0, y0)
    r = {'c': o[0] + float(c), 'fwhm': float(d - a + 1), 'from': o[1] + float(a_), 'to': o[1] + float(b_ + 1),
         'peak': float(p[i]), 'bg': bg, 'slope': float(A[0]), 'contrast': ref}
    return r


def m_ink(Y, b, frac=0.5):
    x0, y0, x1, y1 = b
    S = Y[y0:y1, x0:x1]
    bg = float(np.percentile(S, 10))
    pk = float(np.percentile(S, 99.5))
    m = S > bg + frac * (pk - bg)
    ys, xs = np.where(m)
    if len(xs) == 0:
        return None
    return {'x0': x0 + float(xs.min()), 'y0': y0 + float(ys.min()), 'x1': x0 + float(xs.max() + 1),
            'y1': y0 + float(ys.max() + 1), 'bg': bg, 'peak': pk}


def m_words(Y, b, gap=4, frac=0.5):
    x0, y0, x1, y1 = b
    S = Y[y0:y1, x0:x1]
    bg = float(np.percentile(S, 10))
    pk = float(np.percentile(S, 99.5))
    m = S > bg + frac * (pk - bg)
    col = m.any(0)
    groups, i, n = [], 0, len(col)
    while i < n:
        if not col[i]:
            i += 1
            continue
        j = i
        while j < n:
            k = j
            while k < n and col[k]:
                k += 1
            g = k
            while g < n and not col[g]:
                g += 1
            if g - k >= gap or g >= n:
                j = k
                break
            j = g
        rows = np.where(m[:, i:j].any(1))[0]
        groups.append({'x0': x0 + float(i), 'x1': x0 + float(j), 'y0': y0 + float(rows.min()),
                       'y1': y0 + float(rows.max() + 1)})
        i = j
    return {'words': groups, 'bg': bg, 'peak': pk}


def m_hue(img, b, which):
    x0, y0, x1, y1 = b
    hsv = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1], hsv[..., 2]
    if which == 'red':
        m = ((h < 8) | (h > 170)) & (s > 110) & (v > 80)
    elif which == 'green':
        m = (h > 40) & (h < 85) & (s > 110) & (v > 80)
    else:
        m = (h > 85) & (h < 105) & (s > 90) & (v > 80)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        return None
    k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    X, Y_, W, H, A = st[k]
    return {'x0': x0 + float(X), 'y0': y0 + float(Y_), 'x1': x0 + float(X + W), 'y1': y0 + float(Y_ + H),
            'area': int(A)}


def m_dip(Y, b, T=False):
    """the darkest column (T: row) of the box, parabola-refined: a separator's dark gap"""
    x0, y0, x1, y1 = b
    S = Y[y0:y1, x0:x1]
    p = S.mean(0) if not T else S.mean(1)
    i = int(np.argmin(p[1:-1])) + 1
    d = p[i - 1] - 2 * p[i] + p[i + 1]
    off = 0.5 * (p[i - 1] - p[i + 1]) / d if d > 0 else 0.0
    o = x0 if not T else y0
    return {'c': o + i + 0.5 + float(off), 'floor': float(p[i]), 'around': float(np.percentile(p, 75))}


def m_edge(Y, b, sense, T=False):
    """50 % crossing between the box's dark and bright level, along x (T: y). sense 'rise': dark before bright
    (a left / top end), 'fall': bright before dark (a right / bottom end); the crossing nearest that end is taken"""
    x0, y0, x1, y1 = b
    S = Y[y0:y1, x0:x1]
    p = S.mean(0) if not T else S.mean(1)
    lo, hi = float(np.percentile(p, 5)), float(np.percentile(p, 90))
    lv = lo + 0.5 * (hi - lo)
    o = x0 if not T else y0
    idx = range(len(p) - 1) if sense == 'rise' else range(len(p) - 2, -1, -1)
    for i in idx:
        a, c = (p[i], p[i + 1])
        if (sense == 'rise' and a < lv <= c) or (sense == 'fall' and a >= lv > c):
            return {'c': o + i + 0.5 + (lv - a) / (c - a), 'lo': lo, 'hi': hi}
    return None


def to_dial(d, x, y):
    t, s = d['tacho'], d['speedo']
    mx, my = (t['cx'] + s['cx']) / 2, (t['cy'] + s['cy']) / 2
    D = d['D_px']
    ux, uy = (s['cx'] - t['cx']) / D, (s['cy'] - t['cy']) / D
    dx, dy = x - mx, y - my
    u = dx * ux + dy * uy
    v = -dx * uy + dy * ux
    return u / D, v / D, u / d['R_mean_px'], v / d['R_mean_px']


def main():
    dials = json.load(open(DIALS)) if not VR else None
    out = {}
    os.makedirs(OVL, exist_ok=True)
    for ref, els in CONF.items():
        if ref.startswith('_'):
            continue
        if VR:
            img = cv2.imread(os.path.join(VR, ref[:2] + '_rect.png'))
            fmap, d = vr_model(ref)
        else:
            img = cv2.imread(os.path.join(SRC, ref))
            fmap, d = None, dials[ref]
        Y = lum(img)
        ov = img.copy()
        res = {}
        for name, spec in els.items():
            if name.startswith('_'):
                continue
            m, b = spec[0], spec[1]
            if fmap:
                b = map_box(fmap, b)
                if m == 'words':   # gaps scale with the image: VR's canvas is about 400 / R_src larger
                    spec = [m, b, max(2, int(round(spec[2] * 400 / src_R(ref))))]
            if m == 'rows':
                r = m_rows(Y, b)
            elif m == 'cols':
                r = m_cols(Y, b)
            elif m == 'gaps':
                r = m_gaps(Y, b)
            elif m == 'hrule':
                r = m_hrule(Y, b)
            elif m == 'vrule':
                r = m_hrule(Y, b, T=True)
            elif m == 'ink':
                r = m_ink(Y, b, spec[2] if len(spec) > 2 else 0.5)
            elif m == 'words':
                r = m_words(Y, b, spec[2] if len(spec) > 2 else 4)
            elif m in ('vdip', 'hdip'):
                r = m_dip(Y, b, T=(m == 'hdip'))
            elif m in ('xedge', 'yedge'):
                r = m_edge(Y, b, spec[2], T=(m == 'yedge'))
            else:
                r = m_hue(img, b, m)
            if r is None:
                res[name] = None
                continue
            r['method'] = m
            r['box'] = b
            # dial units for the characteristic points
            pts = {}
            if m in ('ink', 'red', 'green', 'cyan'):
                pts = {'tl': (r['x0'], r['y0']), 'br': (r['x1'], r['y1']),
                       'c': ((r['x0'] + r['x1']) / 2, (r['y0'] + r['y1']) / 2)}
                cv2.rectangle(ov, (int(r['x0']), int(r['y0'])), (int(r['x1']), int(r['y1'])), (0, 255, 255), 1)
            elif m == 'words':
                for k, w in enumerate(r['words']):
                    pts['w%d.tl' % k] = (w['x0'], w['y0'])
                    pts['w%d.br' % k] = (w['x1'], w['y1'])
                    cv2.rectangle(ov, (int(w['x0']), int(w['y0'])), (int(w['x1']), int(w['y1'])), (0, 255, 255), 1)
            elif m == 'rows':
                cx = (b[0] + b[2]) / 2
                pts = {'top': (cx, r['y0']), 'bottom': (cx, r['y1'])}
                for yy in (r['y0'], r['y1']):
                    cv2.line(ov, (b[0], int(yy)), (b[2], int(yy)), (255, 0, 255), 1)
            elif m == 'cols':
                cy = (b[1] + b[3]) / 2
                pts = {'left': (r['x0'], cy), 'right': (r['x1'], cy)}
                for xx in (r['x0'], r['x1']):
                    cv2.line(ov, (int(xx), b[1]), (int(xx), b[3]), (255, 0, 255), 1)
            elif m == 'gaps':
                cy = (b[1] + b[3]) / 2
                for k, g in enumerate(r['gaps']):
                    pts['gap%d' % k] = (g['x'], cy)
                    cv2.line(ov, (int(g['x']), b[1]), (int(g['x']), b[3]), (0, 128, 255), 1)
            elif m == 'hrule':
                pts = {'from': (r['from'], r['c']), 'to': (r['to'], r['c'])}
                cv2.line(ov, (int(r['from']), int(r['c'])), (int(r['to']), int(r['c'])), (0, 255, 0), 1)
            elif m == 'vrule':
                pts = {'from': (r['c'], r['from']), 'to': (r['c'], r['to'])}
                cv2.line(ov, (int(r['c']), int(r['from'])), (int(r['c']), int(r['to'])), (0, 255, 0), 1)
            elif m in ('vdip', 'xedge'):
                pts = {'at': (r['c'], (b[1] + b[3]) / 2)}
                cv2.line(ov, (int(r['c']), b[1]), (int(r['c']), b[3]), (0, 128, 255), 1)
            elif m in ('hdip', 'yedge'):
                pts = {'at': ((b[0] + b[2]) / 2, r['c'])}
                cv2.line(ov, (b[0], int(r['c'])), (b[2], int(r['c'])), (0, 128, 255), 1)
            r['px'] = {k: [round(p[0], 2), round(p[1], 2)] for k, p in pts.items()}
            r['dial'] = {k: dict(zip(('u_D', 'v_D', 'u_R', 'v_R'), [round(z, 4) for z in to_dial(d, *p)]))
                         for k, p in pts.items()}
            res[name] = r
        out[ref] = res
        cv2.imwrite(os.path.join(OVL, ref), ov)
        print('==', ref, 'R %.1f px, D %.1f px' % (d['R_mean_px'], d['D_px']))
        for k, r in res.items():
            if r is None:
                print('  %-20s none' % k)
                continue
            s = ' '.join('%s(%.1f,%.1f|%.3f,%.3f)' % (n, r['px'][n][0], r['px'][n][1], q['u_R'], q['v_R'])
                         for n, q in r['dial'].items())
            extra = ''
            if r['method'] == 'hrule' or r['method'] == 'vrule':
                extra = ' fwhm %.1f' % r['fwhm']
            print('  %-20s %s%s' % (k, s, extra))
    json.dump(out, open(OUT, 'w'), indent=1, default=float)


if __name__ == '__main__':
    main()
