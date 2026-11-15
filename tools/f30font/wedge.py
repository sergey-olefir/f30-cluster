"""Package design/f30-font: measure the F30 6WB's red over-speed marking on the speed scale.

Reference: reference/6wb/12_speedo_signs_overspeed-wedge.png (a photograph of an F30 6WB speedo with
a 60 km/h limit sign up and the needle past the limit).

Steps, all on the image's own pixels:

  ticks   find the long major ticks of the speed scale as bright blobs in an annulus, fit a circle
          through their centroids -> the dial centre, and list their angles (one per 20 km/h)
  cal     fit angle = a0 + k * speed through those ticks (least squares) -> the scale's calibration
  red     mask the red marking as R - max(G, B) over a threshold, map every masked pixel to
          (angle, radius) about the fitted centre, and report the extent in both, plus the radial
          profile per angle bin and the angular profile per radius bin, so the shape (wedge / arc /
          band) and any gradient can be read off

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/f30font/wedge.py --img reference/6wb/12_speedo_signs_overspeed-wedge.png \
        --centre 185 170 --what all
"""
import argparse
import json
import math
import os

import cv2
import numpy as np


def red_mask(img, thr):
    b, g, r = [c.astype(np.float32) for c in cv2.split(img)]
    return np.clip(r - np.maximum(g, b), 0, 255), (np.clip(r - np.maximum(g, b), 0, 255) >= thr)


def bright(img):
    b, g, r = [c.astype(np.float32) for c in cv2.split(img)]
    return np.minimum(np.minimum(b, g), r)      # white ticks: bright in all three


def fit_circle(pts):
    x = pts[:, 0].astype(np.float64)
    y = pts[:, 1].astype(np.float64)
    A = np.stack([x, y, np.ones_like(x)], 1)
    bb = x ** 2 + y ** 2
    sol = np.linalg.lstsq(A, bb, rcond=None)[0]
    cx, cy = sol[0] / 2, sol[1] / 2
    r = math.sqrt(sol[2] + cx ** 2 + cy ** 2)
    return cx, cy, r


def ang(cx, cy, x, y):
    """Degrees clockwise from 12 o'clock, which is how a dial scale is normally quoted."""
    return (math.degrees(math.atan2(x - cx, cy - y)) + 360.0) % 360.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--img', required=True)
    ap.add_argument('--centre', nargs=2, type=float, default=None, help='starting guess cx cy')
    ap.add_argument('--tick-r', nargs=2, type=float, default=None, help='annulus r0 r1 holding the major ticks')
    ap.add_argument('--tick-thr', type=float, default=150)
    ap.add_argument('--min-area', type=float, default=6)
    ap.add_argument('--red-thr', type=float, default=25)
    ap.add_argument('--red-ang', nargs=2, type=float, default=None,
                    help='keep only red pixels in this angle window (deg clockwise from 12)')
    ap.add_argument('--red-r', nargs=2, type=float, default=None,
                    help='keep only red pixels in this radius window')
    ap.add_argument('--max-g', type=float, default=None,
                    help='drop pixels whose G exceeds this: the needle is orange, the marking is red')
    ap.add_argument('--what', default='all', choices=('ticks', 'red', 'cal', 'polar', 'profile', 'ascan', 'all'))
    ap.add_argument('--polar-out', default=None, help='polar: write the unwrapped image here')
    ap.add_argument('--polar-ang', nargs=2, type=float, default=[275.0, 330.0])
    ap.add_argument('--polar-r', nargs=2, type=float, default=[40.0, 150.0])
    ap.add_argument('--polar-scale', nargs=2, type=float, default=[8.0, 4.0],
                    help='px per degree, px per radius px')
    ap.add_argument('--bins', type=int, default=48)
    ap.add_argument('--major-area', type=float, default=25,
                    help='cal: blob area above which a tick counts as a major (numbered) tick')
    ap.add_argument('--major-r', nargs=2, type=float, default=None,
                    help='cal: radius window the major ticks live in, to drop the numerals')
    ap.add_argument('--speeds', default=None,
                    help='cal: comma list of the scale values on the major ticks, in angle order '
                         'starting at --speed-start (e.g. 0,20,...,260)')
    a = ap.parse_args()

    img = cv2.imread(a.img, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit('cannot read ' + a.img)
    h, w = img.shape[:2]
    out = {'img': a.img, 'size': [w, h]}
    cx, cy = a.centre if a.centre else (w / 2.0, h / 2.0)

    if a.what in ('ticks', 'cal', 'all'):
        bm = bright(img)
        mask = (bm >= a.tick_thr).astype(np.uint8)
        yy, xx = np.mgrid[0:h, 0:w]
        rr = np.hypot(xx - cx, yy - cy)
        if a.tick_r:
            mask[(rr < a.tick_r[0]) | (rr > a.tick_r[1])] = 0
        ncc, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
        ticks = []
        for i in range(1, ncc):
            if stats[i][4] < a.min_area:
                continue
            x, y = cent[i]
            ticks.append({'x': round(float(x), 2), 'y': round(float(y), 2),
                          'area': int(stats[i][4]),
                          'r': round(float(math.hypot(x - cx, y - cy)), 2),
                          'ang': round(ang(cx, cy, x, y), 2)})
        ticks.sort(key=lambda t: t['ang'])
        out['ticks'] = ticks
        if len(ticks) >= 3:
            fcx, fcy, fr = fit_circle(np.array([[t['x'], t['y']] for t in ticks]))
            out['tick_circle'] = {'centre': [round(fcx, 2), round(fcy, 2)], 'r': round(fr, 2)}
            for t in ticks:
                t['ang_fit'] = round(ang(fcx, fcy, t['x'], t['y']), 2)
                t['r_fit'] = round(float(math.hypot(t['x'] - fcx, t['y'] - fcy)), 2)

    if a.what in ('cal', 'all') and a.speeds:
        # Solve centre (cx, cy) and the linear scale angle = a0 + k * speed together, by least
        # squares on the major ticks. Fitting the centre from the ticks alone leaves a drift in the
        # tick-to-tick spacing (the scale is not centred on the circle through the tick centroids,
        # because a tick's centroid sits at its own mid-radius); solving both at once removes it.
        cand = [t for t in out.get('ticks', []) if t['area'] >= a.major_area]
        if a.major_r:
            cand = [t for t in cand if a.major_r[0] <= t['r'] <= a.major_r[1]]
        speeds = [float(v) for v in a.speeds.split(',')]
        if len(cand) != len(speeds):
            out['cal_error'] = 'found %d major ticks, --speeds lists %d' % (len(cand), len(speeds))
            out['cal_candidates'] = cand
        else:
            P = np.array([[t['x'], t['y']] for t in cand], float)
            S = np.array(speeds, float)

            def wrap(d):
                return (d + 180.0) % 360.0 - 180.0

            def resid(p):
                ccx, ccy, a0, k = p
                th = (np.degrees(np.arctan2(P[:, 0] - ccx, ccy - P[:, 1])) + 360.0) % 360.0
                return wrap(th - (a0 + k * S))

            from scipy.optimize import least_squares          # noqa: PLC0415
            # seed a0/k from the starting centre, so the wrap never has to jump more than half a turn
            th0 = (np.degrees(np.arctan2(P[:, 0] - cx, cy - P[:, 1])) + 360.0) % 360.0
            i0 = int(np.argmin(S))
            k0 = 1.0
            a00 = (th0[i0] - k0 * S[i0]) % 360.0
            r = least_squares(resid, [cx, cy, a00, k0], xtol=1e-14, ftol=1e-14)
            res = resid(r.x)
            cx, cy = float(r.x[0]), float(r.x[1])
            a0, k = float(r.x[2]), float(r.x[3])
            out['cal'] = {
                'centre': [round(cx, 2), round(cy, 2)],
                'angle_at_zero_deg': round(a0 % 360.0, 3),
                'deg_per_unit': round(k, 5),
                'deg_per_major': round(k * (speeds[1] - speeds[0]), 3),
                'rms_deg': round(float(np.sqrt((res ** 2).mean())), 3),
                'max_resid_deg': round(float(np.abs(res).max()), 3),
                'ticks': sorted([{'speed': s, 'ang': round(ang(cx, cy, t['x'], t['y']), 2),
                                  'resid_deg': round(float(e), 3),
                                  'r': round(float(math.hypot(t['x'] - cx, t['y'] - cy)), 2)}
                                 for s, t, e in zip(speeds, cand, res)], key=lambda d: d['speed']),
            }

    if a.what in ('ascan',):
        # mean redness and brightness per angle bin inside a radius window: pins the marking's
        # leading and trailing edges, and the needle's angle, against the scale calibration
        yy, xx = np.mgrid[0:h, 0:w]
        rr = np.hypot(xx - cx, yy - cy)
        aa = (np.degrees(np.arctan2(xx - cx, cy - yy)) + 360.0) % 360.0
        r_lo, r_hi = a.polar_r
        sel = (rr >= r_lo) & (rr < r_hi)
        bm = bright(img)
        rd, _ = red_mask(img, 0)
        lo_a, hi_a = a.polar_ang
        rows = []
        nb = int(round((hi_a - lo_a) * a.polar_scale[0]))
        for i in range(nb):
            b0 = lo_a + (hi_a - lo_a) * i / nb
            b1 = lo_a + (hi_a - lo_a) * (i + 1) / nb
            s = sel & (aa >= b0) & (aa < b1)
            if s.sum() < 2:
                rows.append([round((b0 + b1) / 2, 2), 0, None, None])
                continue
            rows.append([round((b0 + b1) / 2, 2), int(s.sum()),
                         round(float(rd[s].mean()), 1), round(float(bm[s].mean()), 1)])
        out['ascan'] = {'radius_window': [r_lo, r_hi],
                        'rows': [['ang', 'n', 'mean_red', 'mean_bright']] + rows}

    if a.what in ('profile',):
        # mean brightness and redness per radius bin inside an angle window: finds the radial
        # landmarks of the dial (tick inner/outer end, the numeral band, the marking's edges)
        yy, xx = np.mgrid[0:h, 0:w]
        rr = np.hypot(xx - cx, yy - cy)
        aa = (np.degrees(np.arctan2(xx - cx, cy - yy)) + 360.0) % 360.0
        lo_a, hi_a = a.polar_ang
        sel = ((aa >= lo_a) & (aa <= hi_a)) if lo_a <= hi_a else ((aa >= lo_a) | (aa <= hi_a))
        bm = bright(img)
        rd, _ = red_mask(img, 0)
        r_lo, r_hi = a.polar_r
        rows = []
        nb = int(round((r_hi - r_lo) * 2))
        for i in range(nb):
            b0 = r_lo + (r_hi - r_lo) * i / nb
            b1 = r_lo + (r_hi - r_lo) * (i + 1) / nb
            s = sel & (rr >= b0) & (rr < b1)
            if s.sum() < 3:
                rows.append([round((b0 + b1) / 2, 1), 0, None, None, None])
                continue
            rows.append([round((b0 + b1) / 2, 1), int(s.sum()),
                         round(float(bm[s].mean()), 1), round(float(bm[s].max()), 1),
                         round(float(rd[s].mean()), 1)])
        out['profile'] = {'angle_window': [lo_a, hi_a],
                          'rows': [['r', 'n', 'mean_bright', 'max_bright', 'mean_red']] + rows}

    if a.what in ('polar',):
        # Unwrap an annulus to (angle, radius). A sector reads as a rectangle here, an arc band as a
        # horizontal stripe and a radial edge as a vertical one, so the marking's shape is visible
        # instead of inferred.
        a_lo, a_hi = a.polar_ang
        r_lo, r_hi = a.polar_r
        na = int(round((a_hi - a_lo) * a.polar_scale[0]))
        nr = int(round((r_hi - r_lo) * a.polar_scale[1]))
        angs = np.linspace(a_lo, a_hi, na)
        rads = np.linspace(r_lo, r_hi, nr)
        A, R = np.meshgrid(np.radians(angs), rads)
        X = (cx + R * np.sin(A)).astype(np.float32)
        Y = (cy - R * np.cos(A)).astype(np.float32)
        warp = cv2.remap(img, X, Y, cv2.INTER_LANCZOS4)
        if not a.polar_out:
            raise SystemExit('--polar-out is required with --what polar')
        os.makedirs(os.path.dirname(os.path.abspath(a.polar_out)) or '.', exist_ok=True)
        cv2.imwrite(a.polar_out, warp)
        out['polar'] = {'file': a.polar_out, 'centre': [round(cx, 2), round(cy, 2)],
                        'x_is_angle_deg': [a_lo, a_hi], 'px_per_deg': round(na / (a_hi - a_lo), 3),
                        'y_is_radius_px': [r_lo, r_hi], 'px_per_radius_px': round(nr / (r_hi - r_lo), 3),
                        'note': 'x grows clockwise, y grows outward from the centre (row 0 = r_lo)'}

    if a.what in ('red', 'all'):
        f, m = red_mask(img, a.red_thr)
        yy, xx = np.mgrid[0:h, 0:w]
        rr = np.hypot(xx - cx, yy - cy)
        aa = (np.degrees(np.arctan2(xx - cx, cy - yy)) + 360.0) % 360.0
        if a.red_r:
            m &= (rr >= a.red_r[0]) & (rr <= a.red_r[1])
        if a.red_ang:
            lo_a, hi_a = a.red_ang
            m &= (aa >= lo_a) & (aa <= hi_a) if lo_a <= hi_a else ((aa >= lo_a) | (aa <= hi_a))
        if a.max_g is not None:
            m &= img[..., 1].astype(np.float32) <= a.max_g
        ys, xs = np.where(m)
        if len(xs):
            A = aa[ys, xs]
            Rr = rr[ys, xs]
            V = f[ys, xs]
            out['red'] = {
                'n_px': int(len(xs)),
                'ang_range': [round(float(A.min()), 2), round(float(A.max()), 2)],
                'r_range': [round(float(Rr.min()), 2), round(float(Rr.max()), 2)],
                'ang_p2_p98': [round(float(np.percentile(A, 2)), 2), round(float(np.percentile(A, 98)), 2)],
                'r_p2_p98': [round(float(np.percentile(Rr, 2)), 2), round(float(np.percentile(Rr, 98)), 2)],
            }
            lo, hi = A.min(), A.max()
            nb = a.bins
            rows = []
            for i in range(nb):
                a0 = lo + (hi - lo) * i / nb
                a1 = lo + (hi - lo) * (i + 1) / nb
                sel = (A >= a0) & (A < a1)
                if sel.sum() < 3:
                    rows.append([round(a0, 2), 0, None, None, None])
                    continue
                rows.append([round((a0 + a1) / 2, 2), int(sel.sum()),
                             round(float(Rr[sel].min()), 1), round(float(Rr[sel].max()), 1),
                             round(float(V[sel].mean()), 1)])
            out['red']['by_angle'] = [['ang', 'n', 'r_min', 'r_max', 'mean_redness']] + rows
            rlo, rhi = Rr.min(), Rr.max()
            rrows = []
            for i in range(24):
                r0 = rlo + (rhi - rlo) * i / 24
                r1 = rlo + (rhi - rlo) * (i + 1) / 24
                sel = (Rr >= r0) & (Rr < r1)
                if sel.sum() < 3:
                    rrows.append([round(r0, 1), 0, None, None, None])
                    continue
                rrows.append([round((r0 + r1) / 2, 1), int(sel.sum()),
                              round(float(A[sel].min()), 1), round(float(A[sel].max()), 1),
                              round(float(V[sel].mean()), 1)])
            out['red']['by_radius'] = [['r', 'n', 'ang_min', 'ang_max', 'mean_redness']] + rrows

    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
