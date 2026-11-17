"""Package VR step 2: rectify each reference to a frontal "dial frame" from its ring points (rings.py's output).

    uv run ... python -I tools/twin-dial/vr/rectify.py [ids...]

Model. The dials' rings are circles on one flat plane (the display). A homography maps the source to a frame where
they are circles again; circles fix it up to a similarity (Hartley-Zisserman 2.7). So the free part is
H_A H_P with H_P = [[1,0,0],[0,1,0],[l1,l2,1]] and H_A = [[1/b,-a/b,0],[0,1,0],[0,0,1]] (4 parameters), applied to
source coordinates normalised by the image width about its centre. Per dial: a centre and two radii (bezel, inner
disc rim), the two rings CONCENTRIC (one centre per dial). Residual per point: (|p' - c| - r) / R_left (dial units).
Robust (soft-L1) least squares, inliers from rings.py only.
Optional k1 (one radial lens term about the image centre, u = c + (q - c)(1 + k1 |q - c|^2 / s^2), s = half the
diagonal) is fitted as a second model; the published model is the plain homography unless k1 lowers the rms by
more than 25 %.

Gauge (the similarity): x along the left->right centre line, y down, scale R_left_bezel = 400 px, the left dial
centre at (CX0, CY0) of the published canvas. Canvas: x from left centre - 1.9 R to right centre + 1.9 R, y from
centre - 1.75 R to centre + 1.55 R.

Checks: concentric fit residual per ring; the display's straight edges (refs.json "edges"), located as the strongest
vertical gradient per column, robust line fit, transformed: tilt vs the centre line and rms straightness.
Blur: ring line FWHM (rings.py) in source px; source px per R (the resolution).

Writes bake/work/twin-dial/vr/<id>/rect.json and bake/work/twin-dial/pub/VR/<id>_rect.png (+ model JSON there).
"""
import os
import sys

import cv2
import numpy as np
from scipy.optimize import least_squares

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

L_LEFT, L_RIGHT, T_UP, T_DOWN = 1.9, 1.9, 1.75, 1.55


def load_rings(rid):
    import json
    with open(os.path.join(C.VRW, rid, 'rings.json')) as f:
        return json.load(f)


def norm_T(w, h):
    s = 1.0 / w
    return np.array([[s, 0, -0.5 * w * s], [0, s, -0.5 * h * s], [0, 0, 1]])


def undist(q, k1, size):
    c = np.array([(size[0] - 1) / 2.0, (size[1] - 1) / 2.0])
    s = 0.5 * np.hypot(*size)
    d = q - c
    return c + d * (1 + k1 * (d ** 2).sum(1, keepdims=True) / s ** 2)


def Hfree(p):
    l1, l2, a, b = p
    HP = np.array([[1, 0, 0], [0, 1, 0], [l1, l2, 1.0]])
    HA = np.array([[1 / b, -a / b, 0], [0, 1, 0], [0, 0, 1.0]])
    return HA @ HP


def fit(groups, size, use_k1):
    """groups: list of (dial index 0/1, ring index 0 bezel / 1 inner, points Nx2 source px)."""
    T = norm_T(*size)
    # initial circle parameters from the normalised points
    def unpack(x):
        p = x[:4]
        k1 = x[4] if use_k1 else 0.0
        o = 5 if use_k1 else 4
        cen = x[o:o + 4].reshape(2, 2)
        rad = x[o + 4:o + 8].reshape(2, 2)
        return p, k1, cen, rad

    def res(x):
        p, k1, cen, rad = unpack(x)
        H = Hfree(p) @ T
        out = []
        for d, k, pts in groups:
            q = C.tf(H, undist(pts, k1, size))
            out.append((np.hypot(*(q - cen[d]).T) - rad[d, k]) / rad[0, 0])
        return np.concatenate(out)

    x0 = [0, 0, 0, 1.0] + ([0.0] if use_k1 else [])
    cen0 = np.zeros((2, 2))
    rad0 = np.zeros((2, 2))
    for d, k, pts in groups:
        q = C.tf(T, pts)
        cen0[d] = q.mean(0) if k == 0 else cen0[d]
    for d, k, pts in groups:
        q = C.tf(T, pts)
        rad0[d, k] = np.hypot(*(q - cen0[d]).T).mean()
    x0 = np.r_[x0, cen0.ravel(), rad0.ravel()]
    r = least_squares(res, x0, loss='soft_l1', f_scale=2e-3, x_scale='jac')
    p, k1, cen, rad = unpack(r.x)
    return Hfree(p) @ T, k1, cen, rad, res(r.x)


def similarity(Hn, cen, rad):
    """Gauge: left centre -> (CX0, CY0), centre line along +x, R_left_bezel = 400."""
    v = cen[1] - cen[0]
    ang = np.arctan2(v[1], v[0])
    s = C.R_PX / rad[0, 0]
    c, si = np.cos(-ang) * s, np.sin(-ang) * s
    Rm = np.array([[c, -si, 0], [si, c, 0], [0, 0, 1]])
    D = np.hypot(*v) * s
    CX0, CY0 = L_LEFT * C.R_PX, T_UP * C.R_PX
    Tm = np.array([[1, 0, CX0], [0, 1, CY0], [0, 0, 1]])
    q = Rm @ np.array([cen[0, 0], cen[0, 1], 1.0])
    T0 = np.array([[1, 0, -q[0]], [0, 1, -q[1]], [0, 0, 1]])
    S = Tm @ T0 @ Rm
    Wc = int(round(CX0 + D + L_RIGHT * C.R_PX))
    Hc = int(round((T_UP + T_DOWN) * C.R_PX))
    return S, (CX0, CY0), D, (Wc, Hc)


def edge_points(Y, box, polarity_any=True):
    x0, y0, x1, y1 = box
    sub = cv2.GaussianBlur(Y[y0:y1, x0:x1], (0, 0), 1.0)
    g = np.abs(np.diff(sub, axis=0))
    pts = []
    for i in range(0, x1 - x0, 2):
        col = g[:, i]
        j = int(np.argmax(col))
        if 0 < j < len(col) - 1 and col[j] > 0.02:
            a, b, c = col[j - 1], col[j], col[j + 1]
            den = a - 2 * b + c
            off = 0.5 * (a - c) / den if den < 0 else 0
            pts.append((x0 + i, y0 + j + 0.5 + off))
    return np.array(pts)


def line_check(pts_rect):
    """Robust line fit in the rectified frame: tilt (deg, vs +x) and rms straightness (px)."""
    w = np.ones(len(pts_rect), bool)
    for _ in range(5):
        A = np.c_[pts_rect[w, 0], np.ones(w.sum())]
        m, c = np.linalg.lstsq(A, pts_rect[w, 1], rcond=None)[0]
        r = pts_rect[:, 1] - (m * pts_rect[:, 0] + c)
        s = 1.4826 * np.median(np.abs(r[w]))
        w = np.abs(r) < max(3 * s, 0.5)
    return float(np.degrees(np.arctan(m))), float(np.sqrt((r[w] ** 2).mean())), float(w.mean()), float(c)


def run(rid, ref):
    J = load_rings(rid)
    im = C.imread(ref)
    size = (im.shape[1], im.shape[0])
    groups, names = [], []
    for name, rg in J['rings'].items():
        d = 0 if name.startswith('L') else 1
        k = 0 if name.endswith('bezel') else 1
        pts = np.array(rg['points_ang_x_y_strength_fwhm'])[:, 1:3]
        pts = pts[np.array(rg['inlier'])]
        groups.append((d, k, pts))
        names.append(name)
    fits = {}
    for use_k1 in (False, True):
        Hn, k1, cen, rad, r = fit(groups, size, use_k1)
        fits[use_k1] = (Hn, k1, cen, rad, r)
    rms0 = np.sqrt(np.mean(fits[False][4] ** 2))
    rms1 = np.sqrt(np.mean(fits[True][4] ** 2))
    use = rms1 < 0.75 * rms0
    Hn, k1, cen, rad, r = fits[use]
    S, (CX0, CY0), D, (Wc, Hc) = similarity(Hn, cen, rad)
    H = S @ Hn      # undistorted source px -> dial-frame px
    H = H / H[2, 2]
    # rectified image: dial frame px -> source px (with distortion)
    Hi = np.linalg.inv(H)
    ys, xs = np.mgrid[0:Hc, 0:Wc].astype(np.float64)
    q = C.tf(Hi, np.c_[xs.ravel(), ys.ravel()])
    if use:
        # invert the radial term by fixed-point iteration
        u = q.copy()
        for _ in range(8):
            u = u - (undist(u, k1, size) - q)
        q = u
    mx = q[:, 0].reshape(Hc, Wc).astype(np.float32)
    my = q[:, 1].reshape(Hc, Wc).astype(np.float32)
    out = cv2.remap(im, mx, my, cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 0, 255))
    # per-ring residuals in dial px
    per = {}
    i0 = 0
    for (d, k, pts), name in zip(groups, names):
        rr = r[i0:i0 + len(pts)] * C.R_PX
        i0 += len(pts)
        per[name] = {'rms_px': round(float(np.sqrt(np.mean(rr ** 2))), 3), 'p95_abs_px': round(float(np.percentile(np.abs(rr), 95)), 3),
                     'radius_R': round(float(rad[d, k] / rad[0, 0]), 5), 'n': int(len(pts)),
                     'line_fwhm_src_px': round(J['rings'][name]['fwhm_px_median'], 2)}
    # source px per R (local scale at the left centre)
    lc = np.array([[CX0, CY0], [CX0 + 1, CY0], [CX0, CY0 + 1]])
    sp = C.tf(Hi, lc)
    src_per_dial_px = 0.5 * (np.hypot(*(sp[1] - sp[0])) + np.hypot(*(sp[2] - sp[0])))
    rc = np.array([[CX0 + D, CY0], [CX0 + D + 1, CY0]])
    sr = C.tf(Hi, rc)
    src_per_R = {'left': round(float(src_per_dial_px * C.R_PX), 1), 'right': round(float(np.hypot(*(sr[1] - sr[0])) * C.R_PX), 1)}
    # edges check
    # straight horizontal design lines located in the RECTIFIED image (boxes in dial px, refs.json "lines")
    Yr = C.luma(out)
    edges = {}
    for en, box in ref.get('lines', {}).items():
        epr = edge_points(Yr, box)
        if len(epr) < 10:
            edges[en] = {'error': 'too few edge points'}
            continue
        tilt, rms, share, c = line_check(epr)
        edges[en] = {'tilt_deg_vs_centre_line': round(tilt, 3), 'straightness_rms_px': round(rms, 3), 'inlier_share': round(share, 2),
                     'y_at_left_centre_R': round((np.tan(np.radians(tilt)) * CX0 + c - CY0) / C.R_PX, 4), 'n': int(len(epr))}
    # concentricity check: separate circle fits per ring after rectification
    conc = {}
    for (d, k, pts), name in zip(groups, names):
        q = C.tf(H, undist(pts, k1, size) if use else pts)
        A = np.c_[2 * q, np.ones(len(q))]
        sol = np.linalg.lstsq(A, (q ** 2).sum(1), rcond=None)[0]
        conc[name] = [round(float(sol[0] - (CX0 + d * D)), 3), round(float(sol[1] - CY0), 3)]
    res = {
        'id': rid, 'source': ref['path'], 'gen': ref['gen'], 'kind': ref['kind'], 'state': ref['state'],
        'source_size': list(size),
        'model': {'H_src_to_dial': H.tolist(), 'k1': float(k1) if use else 0.0, 'k1_centre': [(size[0] - 1) / 2.0, (size[1] - 1) / 2.0],
                  'k1_scale': 0.5 * float(np.hypot(*size)),
                  'src_coords': 'OpenCV source px (index = centre); dial px also OpenCV (index = centre)',
                  'k1_tried': {'rms_px_plain': round(float(rms0 * C.R_PX), 3), 'rms_px_with_k1': round(float(rms1 * C.R_PX), 3),
                               'k1': float(fits[True][1]), 'used': bool(use)}},
        'canvas': {'size': [Wc, Hc], 'R_px': C.R_PX, 'left_centre': [CX0, CY0], 'right_centre': [CX0 + D, CY0],
                   'centre_distance_R': round(float(D / C.R_PX), 5)},
        'radii_R': {'left_bezel': 1.0, 'left_inner': round(float(rad[0, 1] / rad[0, 0]), 5),
                    'right_bezel': round(float(rad[1, 0] / rad[0, 0]), 5), 'right_inner': round(float(rad[1, 1] / rad[0, 0]), 5)},
        'residual': {'rms_px_all': round(float(np.sqrt(np.mean(r ** 2)) * C.R_PX), 3), 'per_ring': per,
                     'free_centre_offset_px': conc},
        'src_px_per_R': src_per_R,
        'edges_check': edges,
    }
    C.dump(os.path.join(C.VRW, rid, 'rect.json'), res)
    os.makedirs(C.PUB, exist_ok=True)
    cv2.imwrite(os.path.join(C.PUB, '%s_rect.png' % rid), out)
    print(rid, 'rms %.3f px (k1 %s)' % (res['residual']['rms_px_all'], use), 'D %.4f R' % (D / C.R_PX), res['radii_R'],
          'srcpx/R', src_per_R, 'edges', {k: (v.get('tilt_deg_vs_centre_line'), v.get('straightness_rms_px')) for k, v in edges.items()},
          'conc', conc)
    return res


if __name__ == '__main__':
    refs = C.cfg()['refs']
    for rid in (sys.argv[1:] or list(refs)):
        run(rid, refs[rid])
