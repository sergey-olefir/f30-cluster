"""Package ZL: the sign in its seat - the rail behind it, the gap BMW leaves round it, the speed readout beside it,
the face and the digits.

Per photo (8x warp through ZL's model, linear light):
  rail      the bottom line's centre y and thickness (half-max of luminance, columns x 455-490 and 590-640), and where
            it stops on each side of the sign (the half-level crossing of the rail's own luminance along its centre
            line, x 480-600), as a distance from the ring's outer edge measured on the same photo (sign_<id>.json);
  readout   the "0 km/h" ink box (assist.speed_foot, from atlas_<id>.json) relative to the sign's centre;
  face      the white disc: inner edge in the green channel (face bright, ring dark), so a white-bloom bias moves it
            the same way as the outer red edge; its circle and its offset from the outer circle;
  digits    dark ink on the face (lum < half of face level), components: ink box, height, stem, advance;
  empty     ("---"): the dashes' boxes.
Writes bake/work/strip/zone-L/signctx_<id>.json.
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sign as S  # noqa: E402

N = 8


def halfmax_centre(p):
    lo, hi = np.percentile(p, 5), p.max()
    lev = 0.5 * (lo + hi)
    i = int(p.argmax())
    a, b = i, i
    while a > 0 and p[a - 1] > lev:
        a -= 1
    while b < len(p) - 1 and p[b + 1] > lev:
        b += 1
    if a == 0 or b == len(p) - 1:
        return None
    l = a - 1 + (lev - p[a - 1]) / (p[a] - p[a - 1])
    r = b + (p[b] - lev) / (p[b] - p[b + 1])
    return (l + r) / 2, r - l


def run(photo):
    lm, ph, e = S.load(photo)
    sg = json.load(open(os.path.join(S.ZD, 'sign_%s.json' % photo)))
    at = json.load(open(os.path.join(S.ZD, 'atlas_%s.json' % photo)))
    cx, cy = sg['centre_outer']
    ro = sg['r_outer']
    out = {'photo': photo, 'sign_centre': [cx, cy], 'r_outer': ro}
    # rail centre line and thickness
    ys = []
    for x0, x1 in ((455, 490), (590, 640)):
        box = (x0, 636, x1, 660)
        im = S.srgb_lin(lm.warp(ph, box, N, cv2.INTER_CUBIC)[..., ::-1])
        lum = im @ np.array([0.2126, 0.7152, 0.0722])
        for c in range(0, lum.shape[1], 8):
            h = halfmax_centre(lum[:, c])
            if h:
                ys.append((x0 + (c + 0.5) / N, box[1] + (h[0] + 0.5) / N, h[1] / N))
    ys = np.array(ys)
    L, Rr = ys[ys[:, 0] < 500], ys[ys[:, 0] > 500]
    out['rail'] = {'y_left_x455_490': round(float(L[:, 1].mean()), 2), 'y_right_x590_640': round(float(Rr[:, 1].mean()), 2),
                   'thickness_halfmax': round(float(np.median(ys[:, 2])), 2),
                   'slope_px_per_100px': round(float(np.polyfit(ys[:, 0], ys[:, 1], 1)[0] * 100), 3)}
    ry = float(np.polyval(np.polyfit(ys[:, 0], ys[:, 1], 1), cx))
    out['rail']['y_at_sign_x'] = round(ry, 2)
    out['sign_cy_minus_rail_y'] = round(cy - ry, 2)
    # where the rail stops beside the sign: luminance along the rail's centre line
    box = (470, ry - 0.5 / N, 610, ry + 0.5 / N)
    xs = 470 + (np.arange(int(140 * N)) + 0.5) / N
    q = lm.to_photo(np.stack([xs - 0.5, np.full_like(xs, ry - 0.5)], 1)).astype(np.float32)
    row = cv2.remap(ph, q[:, 0].reshape(1, -1), q[:, 1].reshape(1, -1), cv2.INTER_CUBIC)[0]
    lin = S.srgb_lin(row[:, ::-1])
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    red = lin[:, 0] - np.maximum(lin[:, 1], lin[:, 2])
    rail_l = float(np.median(lum[(xs > 470) & (xs < 490)]))
    # on the rail centre line the sequence is: rail (white) | gap? (dark) | ring (red) | face | ring | gap? | rail
    dmin = []
    for side in (-1, 1):
        if side < 0:
            sel = (xs > 480) & (xs < cx)
            xx, ll, rr_ = xs[sel], lum[sel], red[sel]
        else:
            sel = (xs > cx) & (xs < 600)
            xx, ll, rr_ = xs[sel][::-1], lum[sel][::-1], red[sel][::-1]
        lev = 0.5 * rail_l
        # first fall of luminance below half the rail's level, going from the rail toward the sign
        k = next((i for i in range(1, len(ll)) if ll[i] < lev <= ll[i - 1]), None)
        end = None if k is None else float(xx[k - 1] + (xx[k] - xx[k - 1]) * (ll[k - 1] - lev) / (ll[k - 1] - ll[k]))
        # darkest point between the rail's end and the ring: how dark the gap gets (relative to rail level)
        j = next((i for i in range(len(rr_)) if rr_[i] > 0.5 * red.max()), None)
        gapmin = float(ll[k:j].min() / rail_l) if (k is not None and j is not None and j > k) else None
        ring_edge = cx + side * math.sqrt(max(ro ** 2 - (ry - cy) ** 2, 0))
        dmin.append({'side': 'left' if side < 0 else 'right', 'rail_end_x': None if end is None else round(end, 2),
                     'ring_outer_x_on_rail_line': round(ring_edge, 2),
                     'gap_px': None if end is None else round(abs(ring_edge - end), 2),
                     'gap_darkest_rel_rail': None if gapmin is None else round(gapmin, 3),
                     'rail_end_radius_from_centre': None if end is None else round(math.hypot(end - cx, ry - cy), 2)})
    out['rail_vs_ring'] = dmin
    # readout
    sf = at['elements'].get('assist.speed_foot')
    if sf:
        b = sf['bbox']
        out['readout_bbox'] = b
        out['readout_right_to_sign_centre_dx'] = round(cx - b[2], 2)
        out['readout_left_to_sign_centre_dx'] = round(cx - b[0], 2)
        out['readout_clear_gap_to_ring_px'] = at['gaps_px'].get('assist.speed_foot | assist.speed_limit')
    # face edge in green + digits
    H = 46
    box = (cx - H, cy - H, cx + H, cy + H)
    im = S.srgb_lin(lm.warp(ph, box, N, cv2.INTER_CUBIC)[..., ::-1])
    G = im[..., 1]
    th = np.radians(np.arange(0, 360, 1.0))
    rs = np.arange(24, 40, 1 / 16)
    PX = H * N + np.outer(np.cos(th), rs) * N - 0.5
    PY = H * N + np.outer(np.sin(th), rs) * N - 0.5
    prof = cv2.remap(G.astype(np.float32), PX.astype(np.float32), PY.astype(np.float32), cv2.INTER_LINEAR)
    face = np.median(prof[:, rs < 27])
    ringg = np.median(prof[:, (rs > 34) & (rs < 38)])
    lev = 0.5 * (face + ringg)
    pts = []
    for k in range(len(th)):
        p = prof[k]
        cr = [i for i in range(len(p) - 1) if p[i] >= lev > p[i + 1]]
        if cr:
            i = cr[-1]
            r = rs[i] + (rs[i + 1] - rs[i]) * (p[i] - lev) / (p[i] - p[i + 1])
            yk = cy + math.sin(th[k]) * 42
            if abs(yk - ry) > 6:
                pts.append([cx + math.cos(th[k]) * r, cy + math.sin(th[k]) * r])
    pts = np.array(pts)
    fx, fy, fr, fd = S.fit_circle(pts)
    out['face_green'] = {'centre': [round(fx, 2), round(fy, 2)], 'r': round(fr, 2),
                         'offset_from_outer_centre': [round(fx - cx, 2), round(fy - cy, 2)],
                         'resid_rms': round(float(np.sqrt((fd ** 2).mean())), 3),
                         'ring_width_outer_red_minus_face_green': round(ro - fr, 2)}
    # digits / dashes: dark ink inside r < fr - 2
    lum = im @ np.array([0.2126, 0.7152, 0.0722])
    yy, xx = np.mgrid[0:lum.shape[0], 0:lum.shape[1]]
    rr = np.hypot((xx + 0.5) / N - H - (fx - cx), (yy + 0.5) / N - H - (fy - cy))
    inside = rr < fr - 2.5
    fl = float(np.median(lum[inside]))
    ink = inside & (lum < 0.5 * fl)
    lab, n = ndi.label(ink, np.ones((3, 3)))
    comps = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        a = (lab[sl] == i + 1).sum() / N / N
        if a < 3:
            continue
        comps.append([round(box[0] + sl[1].start / N, 2), round(box[1] + sl[0].start / N, 2),
                      round(box[0] + sl[1].stop / N, 2), round(box[1] + sl[0].stop / N, 2), round(float(a), 1)])
    comps.sort()
    out['face_ink_components'] = comps
    if comps:
        x0 = min(c[0] for c in comps); x1 = max(c[2] for c in comps)
        y0 = min(c[1] for c in comps); y1 = max(c[3] for c in comps)
        out['face_ink_box'] = [x0, y0, x1, y1]
        out['face_ink_centre_minus_face_centre'] = [round((x0 + x1) / 2 - fx, 2), round((y0 + y1) / 2 - fy, 2)]
        # stems: median horizontal dark run length on rows through the middle of the ink
        runs = []
        for r in range(int((y0 - box[1]) * N + 0.3 * (y1 - y0) * N), int((y0 - box[1]) * N + 0.7 * (y1 - y0) * N), 2):
            row = ink[r]
            i = 0
            while i < len(row):
                if row[i]:
                    j = i
                    while j < len(row) and row[j]:
                        j += 1
                    runs.append((j - i) / N)
                    i = j
                i += 1
        out['face_ink_stem_px_median'] = round(float(np.median(runs)), 2) if runs else None
    col = np.median(im[ink], 0) if ink.any() else None
    out['face_ink_colour_srgb8'] = None if col is None else S.to_srgb8(col) if hasattr(S, 'to_srgb8') else None
    out['face_colour_linear'] = [round(float(v), 4) for v in np.median(im[inside & ~ink], 0)]
    return out


if __name__ == '__main__':
    for p in sys.argv[1:]:
        o = run(p)
        json.dump(o, open(os.path.join(S.ZD, 'signctx_%s.json' % p), 'w'), indent=1)
        print(json.dumps(o))
