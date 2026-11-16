"""Package ZR: the pixel diff of the right zone (x 1240-1920, y 540-720) -- our coverage (package O's maps) against
the stock atlas (atlas.py) and the stock light (package R's rects, or ZR's provisional crops where R has not
published yet).

All work is on O's 4x grid: sample (row r, col k) is centred at continuous panel (x, y) = ((k + .5)/4, 540 + (r + .5)/4).
Counts are reported in panel px^2 (= samples / 16), sums of alpha likewise.

Classes (brief, package Z, item 3):
  SHOW ok : stock ink that must show and does (alpha < 0.02 over the element's footprint)
  CLIP    : must show, we cover it  -> count of footprint samples with alpha >= 0.02, and the summed alpha
  LEAK    : must be hidden, shows   -> samples where (1 - alpha) * stock light >= 0.02 of stock white
  DOUBLE  : our ink (premultiplied linear luminance >= 0.10) within 3 px of visible stock ink doing the same job
  SAFETY  : any alpha of ours over an element BMW draws OVER a theme (footprint dilated 3 px)
  SEAM    : each edge of our coverage: the step in what the eye sees across it (3 px each side, along the normal),
            in units of stock white text, and dE2000 between the two sides.
What must show / be hidden per mode is brief 1.2 / 1.3; standby is BMW's row in both modes (1.6).

Writes design/strip/ZR/diff.json (numbers only) and, git-ignored, bake/work/strip/zone-R/diff/<layout>_<mode>_<state>.png
(a 4x class map: green = SHOW ok, red = CLIP, yellow = LEAK, magenta = SAFETY, cyan = seam samples).
"""
import argparse
import json
import os

import cv2
import numpy as np

import atlas as A

OPUB = os.path.join(A.MAIN, 'bake/work/strip/pub/O')
ZX0, ZX1 = 1240, 1920
K0, K1 = ZX0 * 4, ZX1 * 4
NON_STANDBY_PHOTOS = ['61', '62', '63', '64', '66', '67', '68']
STANDBY_PHOTOS = ['65']


def grid():
    xs = (np.arange(K0, K1) + 0.5) / 4.0
    ys = 540 + (np.arange(720) + 0.5) / 4.0
    return np.meshgrid(xs, ys)


def poly_mask(polys, dil_px=0.0):
    m = np.zeros((720, K1 - K0), np.uint8)
    for poly in polys:
        pts = np.array([[(x * 4 - 0.5) - K0, (y - 540) * 4 - 0.5] for x, y in poly], np.float32)
        cv2.fillPoly(m, [np.round(pts * 16).astype(np.int32)], 1, shift=4)
    if dil_px > 0:
        r = int(round(dil_px * 4))
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
    return m.astype(bool)


def rect_poly(b):
    x0, y0, x1, y1 = b
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def stock_light(k):
    """Stock light relative to stock white text (the temperature's core), on O's 4x grid, zone R only."""
    if os.path.exists(os.path.join(A.MAIN, 'bake/work/strip/rect/%s.READY' % k)):
        c = A.Crop(os.path.join(A.MAIN, 'bake/work/strip/rect/%s_strip_4x.png' % k), 0, 540, half=0.125)
        lum = c.lum[:, K0:K1]
        rgb = c.lin[:, K0:K1]
        src = 'R'
    else:
        c = A.Crop(os.path.join(A.MAIN, 'bake/work/strip/zone-R/lreg/%s_R4.png' % k), 1180, 520)
        X, Y = grid()
        mx = ((X - 1180 - 0.5) * 4).astype(np.float32)
        my = ((Y - 520 - 0.5) * 4).astype(np.float32)
        lum = cv2.remap(c.lum.astype(np.float32), mx, my, cv2.INTER_LINEAR)
        rgb = cv2.remap(c.lin.astype(np.float32), mx, my, cv2.INTER_LINEAR)
        src = 'ZR-provisional'
    X, Y = grid()
    quiet = (Y > 708) & (Y < 718) & (X > 1680) & (X < 1840)
    black = float(np.median(lum[quiet]))
    return lum, rgb, black, src


def footprints(atlas_r, atlas_p):
    """SHOW footprints (the widest case) from the atlas polygons, package R's frame.
    Exceptions, from ZR's cross-check: R's 65 and 68 put the bottom row 2-4 px off the other six photos (the
    static degree sign moves; in ZR's independent frame it stays within 0.5 px), so the temperature comes from
    61-64, 66, 67, and the mode label (lit only in 65 among the sharp photos) is the union of R's and ZR's 65."""
    def polys(atl, name, photos):
        out = []
        for k in photos:
            m = atl['elements'].get(name, {}).get(k)
            if m and 'polygon' in m:
                out += [p for p in m['polygon'] if (max(q[1] for q in p) - min(q[1] for q in p)) > 2.0]
        return out
    fp = {}
    # temperature: every string seen, plus the widest value: right-aligned number (the unit stays, the sign
    # moves with the digits' widths), two integer digits and a sign put the sign's left ink at x ~1511.5
    fp['bottom.temperature'] = polys(atlas_r, 'bottom.temperature', ['61', '62', '63', '64', '66', '67']) + \
        [rect_poly([1511.5, 670.5, 1541.0, 699.0])]
    fp['assist.mode_label'] = polys(atlas_r, 'assist.mode_label', ['65']) + polys(atlas_p, 'assist.mode_label', ['65'])
    fp['assist.info_tacho'] = polys(atlas_r, 'assist.info_tacho#info', ['62', '63']) + \
        polys(atlas_r, 'assist.info_tacho#warn', ['66', '67'])
    fp['assist.gear'] = [rect_poly([1395.0, 666.0, 1424.5, 703.0])]     # P on 60 (= 10), 14, 17; D on 41
    return fp


# fixed bright specks that scale with the ambient light (bluish-white, strong in 64-67, faint in 61-63 / 68):
# dust or flaws on the cover glass, not display content (unattributed.json); kept out of LEAK
SPECKS = [(1294.2, 694.0), (1486.0, 677.6), (1838.3, 682.4), (1834.0, 681.0)]


def ciede2000(lab1, lab2):
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - np.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, np.where(dh < -180, dh + 360, dh))
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    hbp = np.where(np.abs(h1p - h2p) > 180, (h1p + h2p + 360) / 2, (h1p + h2p) / 2)
    T = 1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp)) + \
        0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63))
    SL = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    SC, SH = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    RT = -2 * np.sin(np.radians(60 * np.exp(-((hbp - 275) / 25) ** 2))) * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    return float(np.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH)))


def lab(rgb_rel):
    """linear RGB relative to stock white (1.0) -> CIELAB with that white as the reference."""
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = M @ np.clip(np.asarray(rgb_rel, float), 0, None)
    wn = M @ np.ones(3)
    t = xyz / wn
    f = np.where(t > (6 / 29) ** 3, np.cbrt(t), t / (3 * (6 / 29) ** 2) + 4 / 29)
    return 116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])


def seams(alpha, seen, seen_rgb, X, Y, min_len_px=3.0):
    """Edges of our coverage: samples where alpha crosses 0.5; grouped into runs; per run the step of `seen`
    (what the eye gets, white = 1) between 3 px outside (alpha < .5 side) and 3 px inside, along the normal."""
    a = alpha.astype(np.float32)
    gx = cv2.Sobel(cv2.GaussianBlur(a, (0, 0), 2), cv2.CV_32F, 1, 0) / 8
    gy = cv2.Sobel(cv2.GaussianBlur(a, (0, 0), 2), cv2.CV_32F, 0, 1) / 8
    edge = ((a > 0.5) != (cv2.erode(a, np.ones((3, 3))) > 0.5)) & (np.hypot(gx, gy) > 0.004)
    n, lab_, st, _ = cv2.connectedComponentsWithStats(edge.astype(np.uint8), 8)
    out = []
    H, W = a.shape
    for q in range(1, n):
        ys, xs = np.nonzero(lab_ == q)
        if len(ys) < min_len_px * 4:
            continue
        g = np.stack([gx[ys, xs], gy[ys, xs]], 1)
        nrm = g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-9)       # points toward higher alpha (ours)
        pi = np.stack([ys + 12 * nrm[:, 1], xs + 12 * nrm[:, 0]], 1)
        po = np.stack([ys - 12 * nrm[:, 1], xs - 12 * nrm[:, 0]], 1)
        pi = np.clip(np.round(pi).astype(int), 0, [H - 1, W - 1])
        po = np.clip(np.round(po).astype(int), 0, [H - 1, W - 1])
        cin, cout = seen[pi[:, 0], pi[:, 1]], seen[po[:, 0], po[:, 1]]
        step = np.abs(cout - cin)
        rin = seen_rgb[pi[:, 0], pi[:, 1]].mean(0)
        rout = seen_rgb[po[:, 0], po[:, 1]].mean(0)
        x0, y0 = float(X[ys, xs].min()), float(Y[ys, xs].min())
        x1, y1 = float(X[ys, xs].max()), float(Y[ys, xs].max())
        soft = float(np.mean(1.0 / (np.hypot(gx[ys, xs], gy[ys, xs]) * 4 + 1e-6)))   # px per unit alpha
        out.append({'box': [round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)],
                    'length_px': round(len(ys) / 4.0, 1),
                    'step_mean_white': round(float(step.mean()), 4), 'step_p95_white': round(float(np.percentile(step, 95)), 4),
                    'outside_white': round(float(cout.mean()), 4), 'inside_white': round(float(cin.mean()), 4),
                    'dE2000': round(ciede2000(lab(rin), lab(rout)), 2),
                    'edge_width_px': round(soft, 1),
                    'visibility': round(float(step.mean()) * len(ys) / 4.0, 3)})
    out.sort(key=lambda s: -s['visibility'])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(A.REPO, 'design', 'strip', 'ZR', 'diff.json'))
    ap.add_argument('--layouts', nargs='*', default=None)
    a = ap.parse_args()
    atlas_r = json.load(open(os.path.join(A.MAIN, 'bake/work/strip/zone-R/atlas/atlas_R.json')))
    atlas_p = json.load(open(os.path.join(A.MAIN, 'bake/work/strip/zone-R/atlas/atlas_lreg.json')))
    fp = footprints(atlas_r, atlas_p)
    fpm = {k: poly_mask(v, 0.0) for k, v in fp.items()}
    # an element's open counters (the C of degrees C, the triangle's inside) belong to it: close each footprint
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41))
    closed = {k: cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, ker).astype(bool) for k, m in fpm.items()}
    def dil(m, px):
        r = int(round(px * 4))
        return cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))).astype(bool)
    fpm_d2 = {k: dil(m, 2.0) for k, m in closed.items()}       # + blur (2 px: R's / ZR's edge spread)
    fpm_d3 = {k: dil(m, 3.0) for k, m in closed.items()}
    fpm_d6 = {k: dil(m, 6.0) for k, m in closed.items()}       # what a SHOW element's own halo may reach (65-67 bloom)
    X, Y = grid()
    # stock light: max over the photos of a state class, white-relative, black subtracted
    light = {}
    rgbs = {}
    srcs = {}
    whites = {}
    for k in NON_STANDBY_PHOTOS + STANDBY_PHOTOS:
        lum, rgb, black, src = stock_light(k)
        w = (atlas_r['elements']['bottom.temperature'].get(k) or atlas_p['elements']['bottom.temperature'][k])['core_lum_lin']
        light[k] = np.clip(lum - black, 0, None) / w
        rgbs[k] = np.clip(rgb - black, 0, None) / w
        srcs[k], whites[k] = src, w
    L_ns = np.max([light[k] for k in NON_STANDBY_PHOTOS], 0)
    L_sb = light['65']
    T_ns = np.median([light[k] for k in ['61', '62', '63', '64', '68']], 0)          # a typical frame, for seams
    T_ns_rgb = np.median([rgbs[k] for k in ['61', '62', '63', '64', '68']], 0)
    res = {'grid': '4x of O, zone x 1240-1920 y 540-720', 'stock_sources': srcs, 'white_core_lin': whites,
           'footprints': {k: {'polys': len(v)} for k, v in fp.items()}, 'cases': {}}
    os.makedirs(os.path.join(A.MAIN, 'bake/work/strip/zone-R/diff'), exist_ok=True)
    for e in json.load(open(os.path.join(OPUB, 'index.json'))):
        lay, mode, state = e['layout'], e['mode'], e['state']
        if a.layouts and lay not in a.layouts:
            continue
        d = os.path.join(OPUB, 'maps', lay, mode, state)
        if not os.path.exists(os.path.join(d, 'alpha_4x.png')):
            continue
        alpha = cv2.imread(os.path.join(d, 'alpha_4x.png'), cv2.IMREAD_UNCHANGED)[:, K0:K1].astype(np.float32) / 65535
        rgba = cv2.imread(os.path.join(d, 'rgba_4x.png'), cv2.IMREAD_UNCHANGED)[:, K0:K1].astype(np.float32) / 65535
        ours_lin = A.srgb_to_lin(rgba[..., 2::-1][..., :3] * 255.0)[..., ::-1] if False else \
            A.srgb_to_lin(np.stack([rgba[..., 2], rgba[..., 1], rgba[..., 0]], -1) * 255.0)
        ours_prem = ours_lin * alpha[..., None]
        ours_lum = ours_prem @ np.array([0.2126, 0.7152, 0.0722])
        standby = state == 'standby'
        if standby:
            show = ['bottom.temperature', 'assist.mode_label']
        elif mode == 'allG20':
            show = ['bottom.temperature', 'assist.mode_label', 'assist.info_tacho']
        else:
            show = ['assist.info_tacho']          # conditional on package X (e): BMW's marker stays unless we draw ours
        over = ['assist.gear'] if not standby else []
        L = L_sb if standby else L_ns
        Lt, Lt_rgb = (L_sb, rgbs['65']) if standby else (T_ns, T_ns_rgb)
        keep = np.zeros_like(alpha, bool)
        for s in show + over:
            keep |= fpm_d6[s]
        for sx, sy in SPECKS:
            keep |= np.hypot(X - sx, Y - sy) < 4.0
        case = {'show': show, 'over': over, 'CLIP': {}, 'SHOW_ok_px': {}, 'SAFETY': {}}
        cls = np.zeros(alpha.shape + (3,), np.uint8)
        for s in show:
            m = fpm_d2[s]
            clip = m & (alpha >= 0.02)
            case['CLIP'][s] = {'px': round(clip.sum() / 16, 1), 'sum_alpha_px': round(float(alpha[clip].sum()) / 16, 1),
                               'footprint_px': round(m.sum() / 16, 1),
                               'ink_clipped_px': round(float((fpm[s] & (alpha >= 0.02)).sum()) / 16, 1)}
            case['SHOW_ok_px'][s] = round(float((m & (alpha < 0.02)).sum()) / 16, 1)
            cls[m & (alpha < 0.02)] = (0, 160, 0)
            cls[clip] = (0, 0, 255)
        for s in over:
            m = fpm_d3[s]
            sa = m & (alpha > 0.0)
            case['SAFETY'][s] = {'px': round(sa.sum() / 16, 1), 'sum_alpha_px': round(float(alpha[sa].sum()) / 16, 1),
                                 'note': 'BMW draws it over a theme; our alpha under it hides nothing (it is not a '
                                         'telltale), listed because the brief counts any alpha over an over-element'}
            cls[sa] = (255, 0, 255)
        vis = (1 - alpha) * L
        leak = (vis >= 0.02) & ~keep
        n, lab_, st, _ = cv2.connectedComponentsWithStats(leak.astype(np.uint8), 8)
        blobs = []
        for q in range(1, n):
            x, y, w, h, ar = st[q]
            if ar < 4:
                continue
            sel = lab_ == q
            blobs.append({'box': [round((K0 + x) / 4, 2), round(540 + y / 4, 2), round((K0 + x + w) / 4, 2), round(540 + (y + h) / 4, 2)],
                          'px': round(ar / 16, 1), 'sum_visible_white_px': round(float(vis[sel].sum()) / 16, 2),
                          'max_visible_white': round(float(vis[sel].max()), 3)})
        blobs.sort(key=lambda b: -b['sum_visible_white_px'])
        case['LEAK'] = {'px': round(leak.sum() / 16, 1), 'sum_visible_white_px': round(float(vis[leak].sum()) / 16, 2),
                        'blobs': blobs[:12]}
        cls[leak] = (0, 255, 255)
        # DOUBLE: our ink near visible stock ink of the same job
        dbl = {}
        pairs = {'bottom.temperature': (1490, 1680, 655, 712)}
        for s, (x0, x1, y0, y1) in pairs.items():
            near = fpm_d3[s] & ((1 - alpha) > 0.5)
            ours_here = (ours_lum >= 0.10) & (X >= x0) & (X < x1) & (Y >= y0) & (Y < y1)
            dbl[s] = round(float((ours_here & cv2.dilate(near.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool)).sum()) / 16, 1)
        case['DOUBLE_px'] = dbl
        seen = (1 - alpha) * Lt + ours_lum
        seen_rgb = (1 - alpha)[..., None] * Lt_rgb + ours_prem
        case['SEAM'] = seams(alpha, seen, seen_rgb, X, Y)[:10]
        res['cases']['%s/%s/%s' % (lay, mode, state)] = case
        cv2.imwrite(os.path.join(A.MAIN, 'bake/work/strip/zone-R/diff/%s_%s_%s.png' % (lay, mode, state)), cls)
        print(lay, mode, state, 'CLIP', {k: v['px'] for k, v in case['CLIP'].items()}, 'LEAK', case['LEAK']['px'],
              case['LEAK']['sum_visible_white_px'], 'SAFETY', {k: v['px'] for k, v in case['SAFETY'].items()},
              'DOUBLE', dbl, 'seam1', (case['SEAM'][0]['box'], case['SEAM'][0]['step_mean_white']) if case['SEAM'] else None,
              flush=True)
    json.dump(res, open(a.out, 'w'), indent=1)


if __name__ == '__main__':
    main()
