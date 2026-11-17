"""VT: glyph boxes, stems and squareness of the reference text samples (design/twin-dial/vt/samples.json).

Per sample: crop the search window from package VR's rectified reference, take max(R, G, B) (red and green text
count), linearise sRGB, upsample 4x, threshold at half way between the local background (30th percentile) and the
stroke plateau (99.5th percentile), drop components that touch the window's edge (ticks, rings, rules) or are
specks, merge components that overlap in x (the dots of ":" and "i", the parts of "%"), and expect one group per
inked character. Writes the numbers (no pixels) to <out>/meas.json and a review sheet to <out>/glyphs_sheet.png.

    python -I tools/twin-dial/vt/glyphs.py --rect bake/work/twin-dial/pub/VR --out bake/work/twin-dial/vt
"""
import argparse
import json
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
UP = 4


def lin(a):
    a = a / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def runs_median(m):
    runs = []
    for line in m:
        idx = np.flatnonzero(line)
        if not len(idx):
            continue
        br = np.flatnonzero(np.diff(idx) > 1)
        starts = np.r_[idx[0], idx[br + 1]]
        ends = np.r_[idx[br], idx[-1]]
        runs += list(ends - starts + 1)
    return float(np.median(runs)) if runs else 0.0


def fill_ratio(m):
    """area inside the outer contour over the box area: 1 = a square, 0.785 = an ellipse"""
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(c)
    filled = np.zeros_like(m, np.uint8)
    cv2.drawContours(filled, [c], -1, 1, -1)
    return float(filled.sum()) / float(w * h)


def segment(mask, nchar, drop_edge=True):
    """mask: bool image. Returns groups [x0, x1, y0, y1, area] (pixel units of mask), left to right."""
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    H, W = mask.shape
    comps = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if drop_edge and (x == 0 or y == 0 or x + w >= W or y + h >= H):
            continue
        comps.append([x, x + w, y, y + h, a, [i]])
    if not comps:
        return [], lab
    amax = max(c[4] for c in comps)
    comps = [c for c in comps if c[4] >= 0.012 * amax]
    comps.sort(key=lambda c: (c[0] + c[1]) / 2)
    groups = []
    for c in comps:
        if groups:
            g = groups[-1]
            ov = min(g[1], c[1]) - max(g[0], c[0])
            if ov > 0.5 * min(g[1] - g[0], c[1] - c[0]):
                groups[-1] = [min(g[0], c[0]), max(g[1], c[1]), min(g[2], c[2]), max(g[3], c[3]), g[4] + c[4], g[5] + c[5]]
                continue
        groups.append(c)
    return groups, lab


def measure_mask(mask, text, scale):
    """Shared by the photo and the candidates: boxes in units of `scale` px, stem, fill of 0/O."""
    chars = text.replace(' ', '')
    groups, lab = segment(mask, len(chars))
    out = {'n_found': len(groups), 'n_expected': len(chars), 'glyphs': []}
    if len(groups) != len(chars):
        return out
    for ch, g in zip(chars, groups):
        gm = np.isin(lab[g[2]:g[3], g[0]:g[1]], g[5])
        rec = {'ch': ch, 'box': [g[0] / scale, g[1] / scale, g[2] / scale, g[3] / scale]}
        if ch in '0OoDQ':
            rec['fill'] = fill_ratio(gm)
        out['glyphs'].append(rec)
    out['stem'] = runs_median(mask) / scale
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rect', default=os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'pub', 'VR'))
    ap.add_argument('--samples', default=os.path.join(ROOT, 'design', 'twin-dial', 'vt', 'samples.json'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'vt'))
    a = ap.parse_args()
    S = json.load(open(a.samples))['samples']
    imgs, res, tiles = {}, {}, []
    for s in S:
        if s.get('skip'):
            print('%-6s skip: %s' % (s['id'], s['skip']))
            continue
        if s['ref'] not in imgs:
            imgs[s['ref']] = cv2.imread(os.path.join(a.rect, s['ref'] + '_rect.png'))
        x0, y0, x1, y1 = s['box']
        crop = imgs[s['ref']][y0:y1, x0:x1]
        g = lin(crop.max(2).astype(float))
        g = cv2.resize(g, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
        # local background: a grey opening wider than any stroke (the scale band is a gradient, the glyphs cast a
        # shadow), so the threshold is half way between the ground under each stroke and the stroke plateau
        k = s.get('k', 61)
        bgl = cv2.morphologyEx(g.astype(np.float32), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
        bgl = cv2.GaussianBlur(bgl, (0, 0), k / 4)
        bg, top = float(np.median(bgl)), np.percentile(g, 99.5)
        m = (g - bgl) > 0.5 * (top - bgl)
        r = measure_mask(m, s['text'], UP)
        r.update({'ref': s['ref'], 'role': s['role'], 'text': s['text'], 'origin': [x0, y0], 'fit_skip': s.get('fit_skip', ''),
                  'bg_lin': round(float(bg), 4), 'top_lin': round(float(top), 4)})
        for gl in r['glyphs']:
            gl['box'] = [round(v, 3) for v in gl['box']]
            if gl.get('fill') is not None:
                gl['fill'] = round(gl['fill'], 4)
        res[s['id']] = r
        ok = 'ok ' if r['n_found'] == r['n_expected'] else 'BAD'
        print('%-6s %s %-22s found %d/%d  stem %.2f  h %s' % (s['id'], ok, s['text'], r['n_found'], r['n_expected'],
              r.get('stem', 0), ' '.join('%.1f' % (gl['box'][3] - gl['box'][2]) for gl in r['glyphs'])))
        vis = cv2.cvtColor((m * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
        for gl in r['glyphs']:
            b = [int(v * UP) for v in gl['box']]
            cv2.rectangle(vis, (b[0], b[2]), (b[1], b[3]), (0, 0, 255), 1)
        tiles.append((s['id'], np.hstack([cv2.resize(crop, (vis.shape[1], vis.shape[0]), interpolation=cv2.INTER_NEAREST), vis])))
    os.makedirs(a.out, exist_ok=True)
    json.dump({'_about': 'VT glyph measurements on VR rectified references, rectified px (R = 400)', 'samples': res},
              open(os.path.join(a.out, 'meas.json'), 'w'), indent=1)
    W = max(t.shape[1] for _, t in tiles)
    sheet = np.zeros((sum(t.shape[0] + 24 for _, t in tiles), W + 10, 3), np.uint8)
    y = 0
    for name, t in tiles:
        cv2.putText(sheet, name, (4, y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
        sheet[y + 24:y + 24 + t.shape[0], :t.shape[1]] = t
        y += t.shape[0] + 24
    cv2.imwrite(os.path.join(a.out, 'glyphs_sheet.png'), sheet)


if __name__ == '__main__':
    main()
