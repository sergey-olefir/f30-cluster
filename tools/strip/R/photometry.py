"""Package R: photometry and sharpness of the registered photos (reads bake/work/strip/rect/<id>_strip_4x.png and
<id>_panel_2x.png; writes bake/work/strip/pub/R/photometry.json and bake/work/strip/rect/<id>_valid_4x.png).

Linear light = sRGB EOTF of the photo's 8-bit codes (the 4 x strip is stored that way). Luminance Y = Rec.709 weights.

Black level: the display's black, from 4 x 4 panel-px tiles of the strip that hold no content: a tile is empty when
its own spread is small and nothing bright lies within 8 panel px (the dilated ink mask); the level is the median of
the darkest half of the empty tiles, the spread their 10..90 % range. The glare field is a smooth surface (degree-2
polynomial in x, y over the WHOLE panel's empty tiles, robust) minus that black; `valid` is where the glare excess is
below a set fraction of white and the pixel is not clipped (any channel >= 0.98 linear).

White (exposure reference): stock white text, the clock's digits (the 99th percentile of Y in the clock box, after
black subtraction); cross-checked by the speed-limit sign's red ring (median R of the ring annulus where present).
Exposure factor = 1 / white, so that after (x - black) * factor stock white text is 1.0.

Sharpness: the rails' vertical profile (bright line on black) at several straight stretches: FWHM and 10..90 % edge
widths in panel px; photo 60 also has our grid, whose majors are exactly 2 px wide, which calibrates the bias of a 50 %
threshold (measured FWHM - 2 px).
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

N = 4
Y0 = 540
CLOCK = (330, 655, 470, 708)
SIGN = (537.3, 621.3)
# straight rail stretches (continuous panel x ranges) and the y window holding the rail
RAILS = [((610, 650), 'speedo rail right of the sign'), ((660, 700), 'speedo rail'),
         ((1300, 1340), 'tacho rail'), ((1380, 1420), 'tacho rail'), ((1460, 1500), 'tacho rail')]
RAIL_Y = (630, 660)


def load(pid):
    s = cv2.imread(os.path.join(C.OUT, '%s_strip_4x.png' % pid), cv2.IMREAD_UNCHANGED)
    return s[..., ::-1].astype(np.float32) / 65535.0   # RGB linear


def lum(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def box4(b):
    x0, y0, x1, y1 = b
    return np.s_[int((y0 - Y0) * N):int((y1 - Y0) * N), int(x0 * N):int(x1 * N)]


def black_level(Y, valid_geo):
    """Empty 4x4-panel-px tiles of the strip -> (black, p10, p90, tile centres, tile values)."""
    t = 4 * N
    ink = (Y > np.percentile(Y[valid_geo], 70) * 3).astype(np.uint8)
    near = cv2.dilate(ink, np.ones((16 * N + 1, 16 * N + 1), np.uint8)) > 0
    vals, cen = [], []
    for j in range(0, Y.shape[0] - t + 1, t):
        for i in range(0, Y.shape[1] - t + 1, t):
            sl = np.s_[j:j + t, i:i + t]
            if near[sl].any() or not valid_geo[sl].all():
                continue
            v = Y[sl]
            if v.std() > 0.002 + 0.1 * v.mean():
                continue
            vals.append(float(np.median(v)))
            cen.append(((i + t / 2) / N, Y0 + (j + t / 2) / N))
    vals = np.array(vals)
    if len(vals) < 20:
        return None
    lo = np.sort(vals)[:max(10, len(vals) // 2)]
    return float(np.median(lo)), float(np.percentile(lo, 10)), float(np.percentile(lo, 90)), np.array(cen), vals


def glare_fit(cen, vals, black):
    """Robust degree-2 surface of the empty tiles' level over the strip; returns coefficients and a function."""
    x = cen[:, 0] / 960.0 - 1
    y = (cen[:, 1] - 630) / 90.0
    A = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], 1)
    w = np.ones(len(vals), bool)
    for _ in range(5):
        c, *_ = np.linalg.lstsq(A[w], vals[w], rcond=None)
        r = vals - A @ c
        s = 1.4826 * np.median(np.abs(r[w]))
        w = np.abs(r) < 3 * max(s, 1e-5)

    def f(px, py):
        xx = px / 960.0 - 1
        yy = (py - 630) / 90.0
        return c[0] + c[1] * xx + c[2] * yy + c[3] * xx * xx + c[4] * xx * yy + c[5] * yy * yy
    return c, f, float(np.sqrt((r[w] ** 2).mean())), int(w.sum())


def white_level(Y, black):
    v = Y[box4(CLOCK)] - black
    return float(np.percentile(v, 99)), float(np.percentile(v, 99.9))


def ring_red(rgb, black):
    cx, cy = SIGN
    h, w = rgb.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    px, py = (xs + 0.5) / N, Y0 + (ys + 0.5) / N
    r = np.hypot(px - cx, py - cy)
    ann = (r > 34) & (r < 39)
    R, G = rgb[..., 0][ann], rgb[..., 1][ann]
    if not len(R) or np.median(R - G) < 0.05:
        return None
    return float(np.median(R) - black)


def rail_profiles(Y):
    out = []
    for (x0, x1), name in RAILS:
        sub = Y[box4((x0, RAIL_Y[0], x1, RAIL_Y[1]))]
        prof = np.median(sub, 1)
        base = np.percentile(prof, 10)
        p = prof - base
        if p.max() < 0.02:
            continue
        i = int(np.argmax(p))
        pk = p[i]
        ys = RAIL_Y[0] + (np.arange(len(p)) + 0.5) / N

        def cross(level, a, b, step):
            k = i
            while 0 < k < len(p) - 1 and p[k] > level:
                k += step
            j = k - step
            return ys[k] + (level - p[k]) / (p[j] - p[k]) * (ys[j] - ys[k])
        up50, dn50 = cross(0.5 * pk, 0, 0, -1), cross(0.5 * pk, 0, 0, 1)
        up10, up90 = cross(0.1 * pk, 0, 0, -1), cross(0.9 * pk, 0, 0, -1)
        dn10, dn90 = cross(0.1 * pk, 0, 0, 1), cross(0.9 * pk, 0, 0, 1)
        out.append({'x': [x0, x1], 'what': name, 'peak_lin': round(float(pk), 4), 'centre_y': round((up50 + dn50) / 2, 3),
                    'fwhm': round(dn50 - up50, 3), 'edge_10_90_top': round(up90 - up10, 3),
                    'edge_10_90_bottom': round(dn10 - dn90, 3)})
    return out


def grid_fwhm60():
    """Photo 60: FWHM of our 2-px majors (green, linear) in the strip, horizontal line y = 600 and 700."""
    rgb = load('60')
    g = rgb[..., 1] - rgb[..., 0]
    out = []
    for yl in (600, 700):
        for x0 in range(820, 1180, 60):
            sub = g[box4((x0, yl - 6, x0 + 30, yl + 8))]
            p = np.median(sub, 1)
            p = p - np.percentile(p, 10)
            pk = p.max()
            idx = np.where(p >= pk / 2)[0]
            ys = yl - 6 + (np.arange(len(p)) + 0.5) / N
            a, b = idx[0], idx[-1]
            top = ys[a - 1] + (pk / 2 - p[a - 1]) / (p[a] - p[a - 1]) * (ys[a] - ys[a - 1])
            bot = ys[b] + (pk / 2 - p[b]) / (p[b + 1] - p[b]) * (ys[b + 1] - ys[b])
            out.append({'line_y': yl, 'x': [x0, x0 + 30], 'fwhm': round(bot - top, 3),
                        'centre_minus_true': round((top + bot) / 2 - (yl + 1.0), 3)})
    return out


def run(pids):
    res = {}
    for pid in pids:
        rgb = load(pid)
        Y = lum(rgb)
        geo = rgb.sum(2) > 0      # inside the photo
        bl = black_level(Y, geo)
        e = {}
        if bl is None:
            res[pid] = {'error': 'too few empty tiles'}
            continue
        black, p10, p90, cen, vals = bl
        c, f, grms, gn = glare_fit(cen, vals, black)
        wl = white_level(Y, black)
        rr = ring_red(rgb, black)
        e['black_level_lin_Y'] = round(black, 5)
        e['black_level_p10_p90'] = [round(p10, 5), round(p90, 5)]
        e['empty_tiles'] = int(len(vals))
        e['black_level_srgb8'] = round(float(C.lin_to_srgb(np.float32(black)) * 255), 1)
        e['white_text_lin_Y_minus_black'] = round(wl[0], 4)
        e['white_text_p999'] = round(wl[1], 4)
        e['exposure_factor'] = round(1.0 / wl[0], 3) if wl[0] > 0 else None
        e['black_rel_white'] = round(black / wl[0], 4) if wl[0] > 0 else None
        e['sign_ring_red_lin_minus_black'] = None if rr is None else round(rr, 4)
        e['sign_ring_red_rel_white'] = None if rr is None else round(rr / wl[0], 3)
        # glare field over the strip, relative to white
        xs = np.arange(0, 1920, 8) + 4.0
        ys = np.arange(540, 720, 8) + 4.0
        X, YY = np.meshgrid(xs, ys)
        G = (f(X, YY) - black) / wl[0]
        e['glare_excess_rel_white'] = {'max': round(float(G.max()), 4), 'p95': round(float(np.percentile(G, 95)), 4),
                                       'fit_rms_lin': round(grms, 5), 'tiles_used': gn}
        # valid mask: glare excess under 2 % of white and no clipped channel
        hh, ww = Y.shape
        yy, xx = np.mgrid[0:hh, 0:ww]
        Gf = (f((xx + 0.5) / N, Y0 + (yy + 0.5) / N) - black) / wl[0]
        clip = (rgb >= 0.98).any(2)
        valid = (Gf < 0.02) & ~cv2.dilate(clip.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & geo
        e['valid_fraction'] = round(float(valid.mean()), 4)
        e['clipped_px_4x'] = int(clip.sum())
        cv2.imwrite(os.path.join(C.OUT, '%s_valid_4x.png' % pid), (valid * 255).astype(np.uint8))
        rp = rail_profiles(Y)
        e['rails'] = rp
        if rp:
            e['rail_fwhm_median'] = round(float(np.median([r['fwhm'] for r in rp])), 3)
            e['edge_10_90_median'] = round(float(np.median([r['edge_10_90_top'] for r in rp] +
                                                           [r['edge_10_90_bottom'] for r in rp])), 3)
        res[pid] = e
        print(pid, {k: v for k, v in e.items() if k not in ('rails',)})
    if '60' in pids:
        g = grid_fwhm60()
        res['60']['grid_2px_lines'] = g
        res['60']['grid_fwhm_median'] = round(float(np.median([x['fwhm'] for x in g])), 3)
        res['60']['grid_centre_bias_median'] = round(float(np.median([x['centre_minus_true'] for x in g])), 3)
        print('60 grid', res['60']['grid_fwhm_median'], res['60']['grid_centre_bias_median'])
    return res


if __name__ == '__main__':
    pids = sys.argv[1:] or ['60', '61', '62', '63', '64', '65', '66', '67', '68']
    res = run(pids)
    path = os.path.join(C.PUB, 'photometry.json')
    old = C.jload(path, {})
    old.update(res)
    old['_about'] = __doc__
    C.jdump(old, path)
