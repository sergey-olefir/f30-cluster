"""Package VR step 3: sharpness and photometry of the rectified references (reads pub/VR/<id>_rect.png and
vr/<id>/rect.json; writes vr/<id>/photometry.json and pub/VR/<id>_valid.png).

Linear light = sRGB EOTF of the 8-bit codes; Y = Rec.709 weights.

Sharpness: the median radial luminance profile of each dial's bezel ring (the thin outer white line; the circle is
known exactly in the dial frame) over the clockwise angles -120..120 deg, sampled every 0.1 dial px: its FWHM and
the 10-90 % width of its OUTER flank (line on black, so the outer flank is a clean step), in dial px and in source
px. The true line is the same design in every facelift reference, so the smallest FWHM bounds its real width.

Black level: 8 x 8 dial-px tiles inside the screen box (x: left centre - 1.3 R .. right centre + 1.3 R,
y: centre - 1.05 R .. centre + 1.15 R) with a small spread and nothing bright within 24 dial px; the level is the
median of the darkest half. Glare: a robust degree-2 surface of those tiles' level minus black, relative to white.
White: the 99th percentile of Y on the bezel rings (within 0.6 x FWHM of the line centre) minus black.
Clipped: any channel code >= 250. valid.png: 255 where glare excess < 2 % of white, not within 3 dial px of a
clipped pixel, and inside the source.
"""
import json
import os
import sys

import cv2
import numpy as np
from scipy.ndimage import map_coordinates

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def ring_profile(Y, c, r, a0=-120, a1=120):
    rr = np.arange(r - 0.08 * C.R_PX, r + 0.08 * C.R_PX, 0.1)
    profs = []
    for a in np.arange(a0, a1, 0.5):
        t = np.deg2rad(a)
        xs, ys = c[0] + rr * np.sin(t), c[1] - rr * np.cos(t)
        profs.append(map_coordinates(Y, [ys, xs], order=1))
    return rr, np.median(np.array(profs), 0)


def widths(rr, p):
    i = int(np.argmax(p))
    base_out = np.percentile(p[i:], 5)
    base_in = p[max(0, i - 120):i].min()
    pk = p[i]
    def cross(level, step):
        k = i
        while 0 < k < len(p) - 1 and p[k] > level:
            k += step
        j = k - step
        return rr[k] + (level - p[k]) / (p[j] - p[k]) * (rr[j] - rr[k])
    lo = cross(0.5 * (pk + base_in), -1)
    hi = cross(0.5 * (pk + base_out), 1)
    o10 = cross(base_out + 0.1 * (pk - base_out), 1)
    o90 = cross(base_out + 0.9 * (pk - base_out), 1)
    return {'centre_R': (lo + hi) / 2 / C.R_PX, 'fwhm': hi - lo, 'outer_edge_10_90': o10 - o90, 'peak_lin': float(pk),
            'outside_lin': float(base_out)}


def run(rid):
    with open(os.path.join(C.VRW, rid, 'rect.json')) as f:
        R = json.load(f)
    im = cv2.imread(os.path.join(C.PUB, '%s_rect.png' % rid))
    inside = ~((im[..., 0] == 255) & (im[..., 1] == 0) & (im[..., 2] == 255))
    inside = cv2.erode(inside.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    Y = C.luma(im)
    cl, cr = R['canvas']['left_centre'], R['canvas']['right_centre']
    radii = R['radii_R']
    sp = R['src_px_per_R']
    out = {'id': rid, 'sharpness': {}}
    ringmask = np.zeros(Y.shape, bool)
    yy, xx = np.mgrid[0:Y.shape[0], 0:Y.shape[1]]
    for side, c, rb in (('left', cl, radii['left_bezel']), ('right', cr, radii['right_bezel'])):
        rr, p = ring_profile(Y, c, rb * C.R_PX)
        w = widths(rr, p)
        k = sp[side] / C.R_PX
        out['sharpness'][side + '_bezel'] = {
            'line_centre_R': round(w['centre_R'], 5), 'fwhm_dial_px': round(w['fwhm'], 2), 'fwhm_R': round(w['fwhm'] / C.R_PX, 5),
            'outer_edge_10_90_dial_px': round(w['outer_edge_10_90'], 2), 'outer_edge_10_90_src_px': round(w['outer_edge_10_90'] * k, 2),
            'fwhm_src_px': round(w['fwhm'] * k, 2)}
        d = np.hypot(xx - c[0], yy - c[1])
        ringmask |= np.abs(d - w['centre_R'] * C.R_PX) < 0.3 * w['fwhm']
    # black level and glare
    x0, x1 = int(cl[0] - 1.3 * C.R_PX), int(cr[0] + 1.3 * C.R_PX)
    y0, y1 = int(cl[1] - 1.05 * C.R_PX), int(cl[1] + 1.15 * C.R_PX)
    t = 8
    ink = (Y > 0.05).astype(np.uint8)
    near = cv2.dilate(ink, np.ones((49, 49), np.uint8)) > 0
    vals, cen = [], []
    for j in range(max(0, y0), min(Y.shape[0], y1) - t, t):
        for i in range(max(0, x0), min(Y.shape[1], x1) - t, t):
            sl = np.s_[j:j + t, i:i + t]
            if near[sl].any() or not inside[sl].all():
                continue
            v = Y[sl]
            if v.std() > 0.002 + 0.1 * v.mean():
                continue
            vals.append(float(np.median(v)))
            cen.append((i + t / 2, j + t / 2))
    vals, cen = np.array(vals), np.array(cen)
    ph = {}
    if len(vals) > 30:
        lo = np.sort(vals)[:len(vals) // 2]
        black = float(np.median(lo))
        white = float(np.percentile(Y[ringmask & inside], 99)) - black
        X = (cen[:, 0] - (cl[0] + cr[0]) / 2) / C.R_PX
        Yc = (cen[:, 1] - cl[1]) / C.R_PX
        A = np.stack([np.ones_like(X), X, Yc, X * X, X * Yc, Yc * Yc], 1)
        w = np.ones(len(vals), bool)
        for _ in range(5):
            cf, *_ = np.linalg.lstsq(A[w], vals[w], rcond=None)
            r = vals - A @ cf
            s = 1.4826 * np.median(np.abs(r[w]))
            w = np.abs(r) < 3 * max(s, 1e-5)
        Xf = (xx - (cl[0] + cr[0]) / 2) / C.R_PX
        Yf = (yy - cl[1]) / C.R_PX
        G = (cf[0] + cf[1] * Xf + cf[2] * Yf + cf[3] * Xf * Xf + cf[4] * Xf * Yf + cf[5] * Yf * Yf - black) / max(white, 1e-6)
        box = np.zeros(Y.shape, bool)
        box[max(0, y0):y1, max(0, x0):x1] = True
        clip = (im >= 250).any(2) & inside
        valid = (G < 0.02) & inside & ~(cv2.dilate(clip.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0)
        ph = {'black_lin_Y': round(black, 5), 'black_srgb8': round(float(C.lin_to_srgb(np.float32(black)) * 255), 1),
              'black_tiles_p10_p90': [round(float(np.percentile(lo, 10)), 5), round(float(np.percentile(lo, 90)), 5)],
              'tiles': int(len(vals)), 'white_bezel_lin_Y_minus_black': round(white, 4),
              'black_rel_white': round(black / white, 4) if white > 0 else None,
              'glare_excess_rel_white_in_screen_box': {'max': round(float(G[box].max()), 4), 'p95': round(float(np.percentile(G[box], 95)), 4)},
              'clipped_share_in_screen_box': round(float(clip[box].mean()), 5),
              'bezel_clipped_share': round(float(clip[ringmask].mean()), 4),
              'valid_share_in_screen_box': round(float(valid[box].mean()), 4)}
        cv2.imwrite(os.path.join(C.PUB, '%s_valid.png' % rid), valid.astype(np.uint8) * 255)
    else:
        ph = {'error': 'too few empty tiles (%d)' % len(vals)}
    out['photometry'] = ph
    C.dump(os.path.join(C.VRW, rid, 'photometry.json'), out)
    print(rid, json.dumps(out['sharpness']), json.dumps(ph))
    return out


if __name__ == '__main__':
    for rid in (sys.argv[1:] or list(C.cfg()['refs'])):
        run(rid)
