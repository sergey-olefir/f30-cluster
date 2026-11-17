"""Fit a dial's bezel ring and inner-disc rim as ellipses, then unroll the dial to a polar image in dial units.

Usage: dialfit.py            (all dials in DIALS)
Writes, under bake/work/twin-dial/vd/ (photo pixels, never tracked):
  polar_<key>.png   rows = radius rho 0..1.20 R (step R/600), cols = angle 0..360 deg clockwise from 12 o'clock (step 0.25)
  fit_<key>.json    the ellipse models (image px) and residuals
Angles: degrees clockwise from 12 o'clock.  Radii: fractions of the bezel-ring radius R (centre line of the white ring).

Method: start from a hand guess (centre, radius); for every 0.5 deg ray take the outermost bright, low-saturation run in
[0.85, 1.12] r as the bezel; fit an ellipse (cv2.fitEllipse) to those run centres; reject > 2.5 MAD residuals; repeat.
The inner-disc rim is found the same way as the brightest thin ring in [0.45, 0.75] R.  The image is then mapped with
the bezel ellipse's affine (ellipse -> circle), which removes tilt to first order; VR's homographies supersede it.
"""
import json, os, sys
import numpy as np, cv2

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
REF = os.path.join(ROOT, 'reference', 'vc')
OUT = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'vd')
os.makedirs(OUT, exist_ok=True)

# key: (file, cx, cy, r)  hand guesses in image px
DIALS = {
    '02L': ('02_facelift_hybrid_powermeter_trip.png', 685, 785, 214),
    '02R': ('02_facelift_hybrid_powermeter_trip.png', 1500, 795, 204),
    '04L': ('04_facelift_bench_red-wedge_car.png', 334, 289, 108),
    '04R': ('04_facelift_bench_red-wedge_car.png', 737, 294, 104),
    '05L': ('05_facelift_render_settings.png', 297, 224, 106),
    '05R': ('05_facelift_render_settings.png', 689, 224, 108),
}
# VR's rectified frames (bake/work/twin-dial/pub/VR): keys like '02Lv'; the model is fixed (centre, R from VR's
# index.json, R = 400 px for the left dial, right dial scaled by its fitted bezel radius) and is not re-fitted.
VR = os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'pub', 'VR')
if os.path.exists(os.path.join(VR, 'index.json')):
    for _id, _v in json.load(open(os.path.join(VR, 'index.json')))['refs'].items():
        for _s, _c, _r in (('L', 'left_centre', 'left_bezel'), ('R', 'right_centre', 'right_bezel')):
            DIALS[_id + _s + 'v'] = (os.path.join(VR, _v['file']), _v['canvas'][_c][0], _v['canvas'][_c][1],
                                     400.0 * _v['radii_R'][_r])

# extra angle ranges to leave out of the bezel fit (a red arc drawn over the ring in 05L)
SKIP = {'05L': [(55, 150)]}
NA, NR, RMAX = 1440, 721, 1.20


def load(fn):
    im = cv2.imread(os.path.join(REF, fn), cv2.IMREAD_COLOR).astype(np.float32) / 255.0
    return im


def model_map(c, A, th_deg, rho):
    th = np.radians(th_deg)[None, :]
    rho = rho[:, None]
    u = rho * np.sin(th); v = -rho * np.cos(th)
    x = c[0] + A[0, 0] * u + A[0, 1] * v
    y = c[1] + A[1, 0] * u + A[1, 1] * v
    return x.astype(np.float32), y.astype(np.float32)


def ell_to_A(e):
    (cx, cy), (w, h), ang = e
    a, b = w / 2, h / 2
    t = np.radians(ang)
    Rm = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
    return np.array([cx, cy]), Rm @ np.diag([a, b]) @ Rm.T  # symmetric: no rotation of the angle origin


def polar(im, c, A, na=NA, nr=NR, rmax=RMAX):
    th = np.arange(na) * 360.0 / na
    rho = np.linspace(0, rmax, nr)
    x, y = model_map(c, A, th, rho)
    return cv2.remap(im, x, y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT), th, rho


def whiteness(p):
    # bright and grey: min channel, penalise saturation
    mx = p.max(axis=2); mn = p.min(axis=2)
    return mn - 0.5 * (mx - mn)


def ring_points(im, c, A, lo, hi, outermost=True, thr=0.55, skip=None):
    th = np.arange(0, 360, 0.5)
    rho = np.linspace(lo, hi, 400)
    x, y = model_map(c, A, th, rho)
    p = cv2.remap(im, x, y, cv2.INTER_LINEAR)
    w = whiteness(p)
    pts = []
    for j, t in enumerate(th):
        if skip and skip(t):
            continue
        col = w[:, j]
        on = col > thr
        if not on.any():
            continue
        idx = np.where(on)[0]
        # runs
        runs = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
        run = runs[-1] if outermost else max(runs, key=lambda r: col[r].sum())
        if (hi - lo) * len(run) / 399 > 0.06:  # thicker than 0.06 R: not a thin ring
            continue
        wts = col[run] - thr
        i = float((run * wts).sum() / wts.sum())
        rr = lo + (hi - lo) * i / 399
        u = rr * np.sin(np.radians(t)); v = -rr * np.cos(np.radians(t))
        pts.append((c[0] + A[0, 0] * u + A[0, 1] * v, c[1] + A[1, 0] * u + A[1, 1] * v, t))
    return np.array(pts)


def robust_ellipse(pts):
    P = pts[:, :2].astype(np.float32)
    keep = np.ones(len(P), bool)
    for _ in range(5):
        e = cv2.fitEllipse(P[keep])
        c, A = ell_to_A(e)
        Ai = np.linalg.inv(A)
        d = (P - c) @ Ai.T
        res = np.hypot(d[:, 0], d[:, 1]) - 1
        mad = np.median(np.abs(res[keep] - np.median(res[keep]))) + 1e-6
        keep = np.abs(res - np.median(res[keep])) < 3.0 * 1.4826 * mad
    return e, res, keep


def main():
    keys = sys.argv[1:] or list(DIALS)
    for key in keys:
        fn, cx, cy, r = DIALS[key]
        im = load(fn)
        c = np.array([cx, cy], float); A = np.eye(2) * r
        if key.endswith('v'):
            P, th, rho = polar(im, c, A)
            cv2.imwrite(os.path.join(OUT, f'polar_{key}.png'), np.clip(P[::-1] * 255, 0, 255).astype(np.uint8))
            json.dump(dict(file=fn, source='VR', R_px=r, A=A.tolist(), c=c.tolist()), open(os.path.join(OUT, f'fit_{key}.json'), 'w'), indent=1)
            print(key, 'VR model R_px %.2f' % r)
            continue
        # bezel: open at the bottom; skip the bottom gap 150..210 deg
        skipb = SKIP.get(key, [])
        bottom = lambda t: 145 < t < 215 or any(a < t < b for a, b in skipb)
        for it in range(3):
            pts = ring_points(im, c, A, 0.85, 1.15, outermost=True, skip=bottom)
            e, res, keep = robust_ellipse(pts)
            c, A = ell_to_A(e)
        bez = e
        # inner disc rim (full circle except where the hub content crosses it)
        pts2 = ring_points(im, c, A, 0.45, 0.65, outermost=False, thr=0.45, skip=bottom)
        e2, res2, keep2 = robust_ellipse(pts2)
        c2, A2 = ell_to_A(e2)
        P, th, rho = polar(im, c, A)
        cv2.imwrite(os.path.join(OUT, f'polar_{key}.png'), np.clip(P[::-1] * 255, 0, 255).astype(np.uint8))
        Ai = np.linalg.inv(A)
        dc = Ai @ (c2 - c)
        rim_r = float(np.sqrt(abs(np.linalg.det(A2)) / abs(np.linalg.det(A))))
        out = dict(file=fn, bezel=dict(center=list(map(float, bez[0])), axes=list(map(float, bez[1])), angle=float(bez[2]),
                                       n=int(keep.sum()), rms_resid_R=float(np.sqrt(np.mean(res[keep] ** 2)))),
                   rim=dict(center=list(map(float, e2[0])), axes=list(map(float, e2[1])), angle=float(e2[2]),
                            n=int(keep2.sum()), rms_resid_R=float(np.sqrt(np.mean(res2[keep2] ** 2)))),
                   rim_radius_R=rim_r, rim_offset_R=list(map(float, dc)),
                   R_px=float(np.sqrt(abs(np.linalg.det(A)))), axis_ratio=float(min(bez[1]) / max(bez[1])),
                   A=A.tolist(), c=c.tolist())
        json.dump(out, open(os.path.join(OUT, f'fit_{key}.json'), 'w'), indent=1)
        print(key, 'R_px %.1f ratio %.3f bezel rms %.4f n %d | rim r %.4f off (%.4f,%.4f) rms %.4f n %d' % (
            out['R_px'], out['axis_ratio'], out['bezel']['rms_resid_R'], out['bezel']['n'], rim_r, dc[0], dc[1],
            out['rim']['rms_resid_R'], out['rim']['n']))


if __name__ == '__main__':
    main()
