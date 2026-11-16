"""Package ZL: BMW's speed-limit sign measured to a tenth of a px (ring, face, digits) on every photo that shows it.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/strip/ZL/sign.py 61 62 63 64 66 67 68 [--hjson bake/work/strip/rect/H.json]

Method. The box (centre +-54 px) is warped out of the original photo at 8x through ZL's local model (or R's model
when --hjson is given: zoom.py's schema), sRGB-decoded to linear light. Two channels:
  redness = R - max(G, B)   (white bloom adds to R, G and B alike, so it does not move the ring's edges)
  lum     = 0.2126 R + 0.7152 G + 0.0722 B
Rays every 1 deg from the first-guess centre, r 18..54 in 1/16 px. On each ray the ring is the run where redness
is above half of (plateau + the face's / the outside's level); the outer and inner edges are the half-level
crossings, linearly interpolated (a half-max edge is unbiased for a symmetric blur). Rays that cross the bottom
rail (white, y ~647) or a digit are flagged and left out of the fits. Fits: least-squares circle (Kasa, then
geometric Gauss-Newton) and a free ellipse (cv2.fitEllipse on the edge points). Roundness = rms and max of the
radial residual, the residual's first harmonic (= the centre error) and its second (= ellipticity), by octant.
Coordinates: continuous panel px (pixel i covers [i, i+1)).
Writes bake/work/strip/zone-L/sign_<id>.json (numbers only) and prints a summary.
"""
import json
import math
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lmodel as LM  # noqa: E402

ZD = os.path.join(LM.ROOT, 'bake', 'work', 'strip', 'zone-L')
C0 = (537.8, 621.8)      # continuous; first guess
HALF = 54
N = 8


def srgb_lin(im8):
    c = im8.astype(np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def load(photo, hjson=None):
    if hjson:
        import json as _j
        e = _j.load(open(hjson))[photo]
        m = e['model']
        ph = LM.R.imread(e['source'])
        base = LM.R.Model(np.array(m['H_panel_to_undistorted_photo']), (ph.shape[1], ph.shape[0]), m['k1'])
        return LM.LModel(base, m.get('poly_cx'), m.get('poly_cy')), ph, e
    if photo == '60':
        return LM.load('60L')
    return LM.load(photo, os.path.join(ZD, 'HL.json'))


def bilinear(img, xs, ys):
    return cv2.remap(img.astype(np.float32), xs.astype(np.float32), ys.astype(np.float32), cv2.INTER_LINEAR)


def crossings(prof, level, rs):
    """indices where prof crosses level, sub-sample by linear interpolation: list of (r, rising)"""
    out = []
    s = prof - level
    for i in range(len(s) - 1):
        if s[i] == 0 or s[i] * s[i + 1] < 0:
            t = s[i] / (s[i] - s[i + 1]) if s[i] != s[i + 1] else 0
            out.append((rs[i] + t * (rs[i + 1] - rs[i]), s[i + 1] > s[i]))
    return out


def fit_circle(pts):
    x, y = pts[:, 0], pts[:, 1]
    A = np.stack([x, y, np.ones_like(x)], 1)
    b = x * x + y * y
    c = np.linalg.lstsq(A, b, rcond=None)[0]
    cx, cy = c[0] / 2, c[1] / 2
    r = math.sqrt(c[2] + cx * cx + cy * cy)
    for _ in range(20):          # geometric refinement
        d = np.hypot(x - cx, y - cy)
        J = np.stack([-(x - cx) / d, -(y - cy) / d, -np.ones_like(d)], 1)
        res = d - r
        step = np.linalg.lstsq(J, -res, rcond=None)[0]
        cx, cy, r = cx + step[0], cy + step[1], r + step[2]
        if np.abs(step).max() < 1e-6:
            break
    d = np.hypot(x - cx, y - cy) - r
    return cx, cy, r, d


def harmonics(th, res):
    A = np.stack([np.ones_like(th), np.cos(th), np.sin(th), np.cos(2 * th), np.sin(2 * th)], 1)
    c = np.linalg.lstsq(A, res, rcond=None)[0]
    return {'h1_amp': round(float(np.hypot(c[1], c[2])), 3),
            'h2_amp': round(float(np.hypot(c[3], c[4])), 3),
            'h2_axis_deg': round(float(math.degrees(0.5 * math.atan2(c[4], c[3]))) % 180, 1)}


def measure(photo, hjson=None):
    lm, ph, e = load(photo, hjson)
    box = (C0[0] - HALF, C0[1] - HALF, C0[0] + HALF, C0[1] + HALF)
    im = lm.warp(ph, box, N, cv2.INTER_CUBIC)
    lin = srgb_lin(im[..., ::-1])                   # RGB
    red = lin[..., 0] - np.maximum(lin[..., 1], lin[..., 2])
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])

    def to_img(px, py):           # continuous panel -> warp pixel index (centre convention for remap)
        return (px - box[0]) * N - 0.5, (py - box[1]) * N - 0.5

    # first guess of the centre: the centroid of strong redness
    m = red > 0.5 * np.percentile(red, 99.5)
    ys, xs = np.nonzero(m)
    cx, cy = box[0] + (xs.mean() + 0.5) / N, box[1] + (ys.mean() + 0.5) / N
    rs = np.arange(18, 54, 1 / 16)
    out = {}
    for it in range(2):
        th = np.radians(np.arange(0, 360, 1.0))
        PX = cx + np.outer(np.cos(th), rs)
        PY = cy + np.outer(np.sin(th), rs)
        ix, iy = to_img(PX, PY)
        R_ = bilinear(red, ix, iy)
        L_ = bilinear(lum, ix, iy)
        # photo 60 (our grid over the sign): rays that cross a green line or a yellow label are not used
        f8 = im.astype(np.float32)
        gm = np.clip(f8[..., 1] - f8[..., 2], 0, None) + np.clip(np.minimum(f8[..., 1], f8[..., 2]) - f8[..., 0] - 60, 0, None)
        GM_ = bilinear(gm, ix, iy)
        grid_ray = (GM_[:, (rs > 26) & (rs < 50)].max(1) > 30) if str(photo).startswith('60') else np.zeros(len(th), bool)
        plate = np.median(R_[:, (rs > 34) & (rs < 39)])
        face = np.median(R_[:, (rs > 20) & (rs < 26)])
        outside = np.median(R_[:, (rs > 47) & (rs < 52)])
        lo_in, lo_out = 0.5 * (plate + face), 0.5 * (plate + outside)
        ro, ri, ok, flag = [], [], [], []
        rail_y = 647.0
        for k in range(len(th)):
            p = R_[k]
            # outer edge: the last falling crossing of lo_out beyond the plateau
            co = [r for r, up in crossings(p, lo_out, rs) if not up and r > 34]
            ci = [r for r, up in crossings(p, lo_in, rs) if up and r < 39]
            yk = cy + math.sin(th[k]) * 42
            near_rail = abs(yk - rail_y) < 6
            if not co or not ci:
                ro.append(np.nan); ri.append(np.nan); ok.append(False); flag.append('none'); continue
            ro.append(co[0]); ri.append(ci[-1]); ok.append(not near_rail and not grid_ray[k]); flag.append('rail' if near_rail else '')
        ro, ri, ok = np.array(ro), np.array(ri), np.array(ok)
        po = np.stack([cx + np.cos(th) * ro, cy + np.sin(th) * ro], 1)
        pi_ = np.stack([cx + np.cos(th) * ri, cy + np.sin(th) * ri], 1)
        g = ok & np.isfinite(ro) & np.isfinite(ri)
        ocx, ocy, orr, od = fit_circle(po[g])
        icx, icy, irr, idd = fit_circle(pi_[g])
        for _ in range(3):        # trim rays more than 4 MAD off (a label, a reflection)
            ro_r = np.hypot(po[:, 0] - ocx, po[:, 1] - ocy) - orr
            ri_r = np.hypot(pi_[:, 0] - icx, pi_[:, 1] - icy) - irr
            mo, mi = np.nanmedian(np.abs(ro_r[g])), np.nanmedian(np.abs(ri_r[g]))
            g = g & (np.abs(ro_r) < max(4 * 1.4826 * mo, 0.3)) & (np.abs(ri_r) < max(4 * 1.4826 * mi, 0.3))
            ocx, ocy, orr, od = fit_circle(po[g])
            icx, icy, irr, idd = fit_circle(pi_[g])
        # iterate the ray centre to the outer circle's centre
        cx, cy = ocx, ocy
    tho = np.arctan2(po[g, 1] - ocy, po[g, 0] - ocx)
    thi = np.arctan2(pi_[g, 1] - icy, pi_[g, 0] - icx)
    ell = cv2.fitEllipse(po[g].astype(np.float32))
    oct_ = {}
    for name, a0 in (('E', 0), ('SE', 45), ('S', 90), ('SW', 135), ('W', 180), ('NW', 225), ('N', 270), ('NE', 315)):
        sel = np.abs(((np.degrees(tho) - a0 + 180) % 360) - 180) < 22.5
        oct_[name] = round(float(np.mean(od[sel])), 3) if sel.any() else None
    # luminance outer edge: where lum falls to half of (ring lum + black) - for the black surround
    lring = np.median(L_[:, (rs > 34) & (rs < 39)])
    lout = np.median(L_[:, (rs > 47) & (rs < 52)])
    lo_l = []
    for k in range(len(th)):
        cc = [r for r, up in crossings(L_[k], 0.5 * (lring + lout), rs) if not up and r > 34]
        lo_l.append(cc[0] if cc and ok[k] else np.nan)
    lo_l = np.array(lo_l)
    out = {
        'photo': photo, 'model': 'R' if hjson else 'ZL-local (provisional)',
        'centre_outer': [round(ocx, 2), round(ocy, 2)], 'r_outer': round(orr, 2),
        'centre_inner': [round(icx, 2), round(icy, 2)], 'r_inner': round(irr, 2),
        'ring_width': round(orr - irr, 2),
        'outer_resid_rms': round(float(np.sqrt((od ** 2).mean())), 3), 'outer_resid_max': round(float(np.abs(od).max()), 3),
        'inner_resid_rms': round(float(np.sqrt((idd ** 2).mean())), 3),
        'outer_harmonics': harmonics(tho, od), 'inner_harmonics': harmonics(thi, idd),
        'outer_by_octant': oct_,
        'ellipse_outer': {'centre': [round(ell[0][0] + 0.0, 2), round(ell[0][1], 2)],
                          'axes': [round(ell[1][0] / 2, 2), round(ell[1][1] / 2, 2)], 'angle': round(ell[2], 1)},
        'r_outer_lum': round(float(np.nanmedian(np.hypot(*(np.stack([cx + np.cos(th) * lo_l, cy + np.sin(th) * lo_l], 1)[np.isfinite(lo_l)] - [ocx, ocy]).T))), 2),
        'rays_used': int(g.sum()), 'rays_rail': int(sum(f == 'rail' for f in flag)),
        'levels_linear': {'plateau_red': round(float(plate), 4), 'face_red': round(float(face), 4),
                          'outside_red': round(float(outside), 4), 'ring_lum': round(float(lring), 4),
                          'outside_lum': round(float(lout), 4)},
        'photo_px_per_panel_px': round(lm.scale(537, 621), 3),
    }
    # the ring's colour (linear and sRGB) and the face's
    rr = np.hypot(*np.meshgrid((np.arange(im.shape[1]) + 0.5) / N + box[0] - ocx, (np.arange(im.shape[0]) + 0.5) / N + box[1] - ocy))
    for nm, sel in (('ring', (rr > irr + 2) & (rr < orr - 2)), ('face_rim', (rr > irr - 6) & (rr < irr - 2)),
                    ('outside', (rr > orr + 4) & (rr < orr + 9))):
        v = lin[sel]
        med = np.median(v, 0)
        s8 = np.where(med <= 0.0031308, 12.92 * med, 1.055 * med ** (1 / 2.4) - 0.055) * 255
        out['colour_' + nm] = {'linear': [round(float(x), 4) for x in med], 'srgb8': [int(round(x)) for x in s8]}
    # radial profile of luminance and redness, azimuthal median over the good rays, r 26..54, 0.25 px
    rp = np.arange(26, 54.01, 0.25)
    PX = ocx + np.outer(np.cos(th[ok]), rp)
    PY = ocy + np.outer(np.sin(th[ok]), rp)
    ix, iy = to_img(PX, PY)
    out['radial_profile'] = {'r': rp.round(2).tolist(),
                             'lum': np.median(bilinear(lum, ix, iy), 0).round(4).tolist(),
                             'red': np.median(bilinear(red, ix, iy), 0).round(4).tolist()}
    out['outer_edge_by_deg'] = [round(float(x), 3) if np.isfinite(x) else None for x in ro]
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    hj = None
    if '--hjson' in sys.argv:
        hj = sys.argv[sys.argv.index('--hjson') + 1]
        args = [a for a in args if a != hj]
    for p in args:
        o = measure(p, hj)
        json.dump(o, open(os.path.join(ZD, 'sign_%s%s.json' % (p, '_R' if hj else '')), 'w'))
        print(p, {k: o[k] for k in ('centre_outer', 'r_outer', 'centre_inner', 'r_inner', 'ring_width',
                                    'outer_resid_rms', 'outer_resid_max', 'outer_harmonics', 'inner_harmonics',
                                    'ellipse_outer', 'r_outer_lum', 'rays_used')}, flush=True)
        print('   octants', o['outer_by_octant'], 'colours', o['colour_ring']['srgb8'], o['colour_face_rim']['srgb8'],
              o['colour_outside']['srgb8'])


if __name__ == '__main__':
    main()
