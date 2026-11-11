"""Fit a dial's circular features in a photo: ray sampling -> ridge points -> RANSAC circle -> ellipse.

The ellipse is turned into a photo->panel affine that maps the photo dial onto our dial (centre, R), with the camera
roll removed. Residuals are reported in PANEL px (i.e. after scaling the photo dial to our R).
"""
import math
import numpy as np
import cv2


def sample_rays(img, cx, cy, angles_cw12, r0, r1, step=0.5):
    """Bilinear samples of img along rays from (cx, cy). Returns (radii, profiles[n_angles, n_r])."""
    radii = np.arange(r0, r1, step, dtype=np.float32)
    a = np.radians(np.asarray(angles_cw12, np.float32))
    xs = cx + np.sin(a)[:, None] * radii[None, :]
    ys = cy - np.cos(a)[:, None] * radii[None, :]
    prof = cv2.remap(img.astype(np.float32), xs.astype(np.float32), ys.astype(np.float32), cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_CONSTANT, borderValue=-1.0)
    return radii, prof


def angles_from_ranges(ranges, step=1.0):
    if not ranges:
        ranges = [[0, 360]]
    out = []
    for a0, a1 in ranges:
        span = (a1 - a0) % 360.0 or 360.0
        out.extend(list((a0 + np.arange(0, span, step)) % 360.0))
    return np.array(out, np.float32)


def circle_from3(p):
    (x1, y1), (x2, y2), (x3, y3) = p
    d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
    if abs(d) < 1e-9:
        return None
    ux = ((x1 ** 2 + y1 ** 2) * (y2 - y3) + (x2 ** 2 + y2 ** 2) * (y3 - y1) + (x3 ** 2 + y3 ** 2) * (y1 - y2)) / d
    uy = ((x1 ** 2 + y1 ** 2) * (x3 - x2) + (x2 ** 2 + y2 ** 2) * (x1 - x3) + (x3 ** 2 + y3 ** 2) * (x2 - x1)) / d
    return ux, uy, math.hypot(x1 - ux, y1 - uy)


def kasa(pts):
    x, y = pts[:, 0], pts[:, 1]
    A = np.c_[2 * x, 2 * y, np.ones_like(x)]
    b = x ** 2 + y ** 2
    c, *_ = np.linalg.lstsq(A, b, rcond=None)
    return c[0], c[1], math.sqrt(c[2] + c[0] ** 2 + c[1] ** 2)


def ransac_circle(pts, tol, iters=600, seed=1):
    rng = np.random.default_rng(seed)
    best, best_in = None, None
    n = len(pts)
    if n < 5:
        return None, np.zeros(n, bool)
    for _ in range(iters):
        c = circle_from3(pts[rng.choice(n, 3, replace=False)])
        if c is None:
            continue
        d = np.abs(np.hypot(pts[:, 0] - c[0], pts[:, 1] - c[1]) - c[2])
        inl = d < tol
        if best_in is None or inl.sum() > best_in.sum():
            best, best_in = c, inl
    if best_in is not None and best_in.sum() >= 5:
        best = kasa(pts[best_in])
        d = np.abs(np.hypot(pts[:, 0] - best[0], pts[:, 1] - best[1]) - best[2])
        best_in = d < tol
    return best, best_in


def ellipse_S(ell):
    """cv2.fitEllipse result -> (centre, S) where S (2x2, symmetric) maps the unit circle onto the ellipse."""
    (cx, cy), (w, h), ang = ell
    t = math.radians(ang)
    Rm = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
    S = Rm @ np.diag([w / 2.0, h / 2.0]) @ Rm.T
    return np.array([cx, cy]), S


def ridge_points(feat, seed, ranges, band=(0.92, 1.10), smooth=1.0, min_prom=0.0, step_deg=1.0):
    cx, cy, r = seed
    angs = angles_from_ranges(ranges, step_deg)
    radii, prof = sample_rays(feat, cx, cy, angs, r * band[0], r * band[1])
    valid = (prof >= 0).all(axis=1)
    if smooth > 0:
        prof = cv2.filter2D(prof, -1, _gk(smooth / 0.5)[None, :], borderType=cv2.BORDER_REPLICATE)
    k = np.argmax(prof, axis=1)
    peak = prof[np.arange(len(k)), k]
    base = np.median(prof, axis=1)
    prom = peak - base
    ok = valid & (prom > min_prom) & (k > 1) & (k < prof.shape[1] - 2)
    # sub-sample peak position (parabola through the peak and its neighbours)
    kk = np.clip(k, 1, prof.shape[1] - 2)
    y0, y1, y2 = (prof[np.arange(len(k)), kk - 1], prof[np.arange(len(k)), kk], prof[np.arange(len(k)), kk + 1])
    den = y0 - 2 * y1 + y2
    off = np.where(np.abs(den) > 1e-6, 0.5 * (y0 - y2) / np.where(np.abs(den) > 1e-6, den, 1), 0.0)
    rr = radii[kk] + np.clip(off, -0.5, 0.5) * (radii[1] - radii[0])
    a = np.radians(angs)
    pts = np.c_[cx + np.sin(a) * rr, cy - np.cos(a) * rr]
    return pts[ok], angs[ok], prom[ok]


def _gk(sig):
    n = max(1, int(3 * sig))
    x = np.arange(-n, n + 1)
    k = np.exp(-0.5 * (x / sig) ** 2)
    return k / k.sum()


def fit_dial_ring(feat, seed, ranges=None, tol_frac=0.006, ellipse=True):
    """Two passes: wide band -> RANSAC circle -> narrow band around it -> ellipse on inliers."""
    pts, angs, prom = ridge_points(feat, seed, ranges, band=(0.93, 1.09))
    c, inl = ransac_circle(pts, tol=max(1.0, tol_frac * 2.5 * seed[2]))
    if c is None:
        return None
    pts, angs, prom = ridge_points(feat, c, ranges, band=(0.97, 1.03))
    c2, inl = ransac_circle(pts, tol=max(1.5, 0.02 * c[2]))
    if c2 is None:
        return None
    tol = max(0.8, tol_frac * c2[2])
    ctr, S, ell = np.array(c2[:2]), np.eye(2) * c2[2], None
    if ellipse:
        # perspective makes the dial an ellipse: alternate ellipse fit / inliers by ellipse distance
        for _ in range(3):
            P = pts[inl].astype(np.float32)
            if len(P) < 20:
                break
            e = cv2.fitEllipse(P)
            ctr_e, S_e = ellipse_S(e)
            ax = np.linalg.eigvalsh(S_e)
            if ax.min() / ax.max() < 0.85 or abs(ax.mean() - c2[2]) > 0.08 * c2[2]:
                break                                   # a partial arc gave a wild ellipse: keep the circle
            ctr, S, ell = ctr_e, S_e, e
            q = (pts - ctr) @ np.linalg.inv(S).T
            inl = np.abs(np.linalg.norm(q, axis=1) - 1.0) * np.sqrt(np.linalg.det(S)) < tol
    else:
        d = np.abs(np.hypot(pts[:, 0] - c2[0], pts[:, 1] - c2[1]) - c2[2])
        inl = d < tol
    Si = np.linalg.inv(S)
    q = (pts - ctr) @ Si.T
    res_unit = np.linalg.norm(q, axis=1) - 1.0                       # in ring-radius units
    return {"centre": ctr, "S": S, "ellipse": ell, "circle": c2, "pts": pts, "angs": angs, "inl": inl,
            "res_unit": res_unit, "coverage_deg": float(inl.sum() * 1.0)}


def outer_edge_ratio(gray, fit, frac=0.5):
    """Median ratio (outer half-max edge radius) / (ridge radius) along the inlier rays."""
    ctr, S = fit["centre"], fit["S"]
    r = float(np.sqrt(np.linalg.det(S)))
    ratios = []
    angs = fit["angs"][fit["inl"]]
    radii, prof = sample_rays(gray, ctr[0], ctr[1], angs, r * 0.97, r * 1.10, step=0.25)
    for p in prof:
        if (p < 0).any():
            continue
        k = int(np.argmax(p[: len(p) // 3]))
        pk = p[k]
        bg = np.median(p[int(len(p) * 0.75):])
        thr = bg + (pk - bg) * frac
        j = k
        while j < len(p) - 1 and p[j] > thr:
            j += 1
        if j < len(p) - 1:
            ratios.append(radii[j] / radii[k] if radii[k] > 0 else np.nan)
    ratios = np.array(ratios)
    return float(np.nanmedian(ratios)) if len(ratios) else float("nan"), int(len(ratios))


def harmonic_light(gray, fit, band=(0.985, 1.015)):
    """Bezel brightness vs angle -> first-harmonic direction (math degrees, y up) and relative strength."""
    ctr, S = fit["centre"], fit["S"]
    angs = fit["angs"][fit["inl"]]
    if len(angs) < 30:
        return None
    r = float(np.sqrt(np.linalg.det(S)))
    radii, prof = sample_rays(gray, ctr[0], ctr[1], angs, r * band[0], r * band[1], step=0.5)
    v = prof.max(axis=1)
    a = np.radians(angs)
    # cw12 -> math (ccw from +x, y up): math = 90 - cw12
    m = np.radians(90.0) - a
    A = np.c_[np.ones_like(m), np.cos(m), np.sin(m), np.cos(2 * m), np.sin(2 * m)]
    coef, *_ = np.linalg.lstsq(A, v, rcond=None)
    amp = math.hypot(coef[1], coef[2])
    return {"dir_deg_math": round((math.degrees(math.atan2(coef[2], coef[1])) + 360) % 360, 1),
            "rel_amplitude": round(amp / max(coef[0], 1e-6), 3), "mean": round(float(coef[0]), 1),
            "angular_coverage_deg": int(len(angs))}


def affine_photo_to_panel(ctr, S_outer, roll_deg, panel_c, panel_R):
    """2x3 matrix: panel = panel_c + panel_R * Rot(-roll) * S_outer^-1 (photo - ctr). roll: photo angle of the
    panel's +x axis (deg, image coords y down, positive = clockwise on screen)."""
    t = math.radians(-roll_deg)
    Rm = np.array([[math.cos(t), -math.sin(t)], [math.sin(t), math.cos(t)]])
    L = panel_R * Rm @ np.linalg.inv(S_outer)
    b = np.asarray(panel_c) - L @ ctr
    return np.c_[L, b]


def floor_line_angle(L, cx, cy, R, dy_range=(0.12, 0.42), r_max=0.48, angles=np.arange(-5.0, 5.01, 0.1)):
    """The inner disc's floor edge is horizontal by design: find the tilt (deg, + = clockwise on screen) and the
    offset (R units below the centre) of the strongest straight horizontal edge inside the disc. Returns
    (angle, dy, sharpness) or None."""
    h, w = L.shape
    gy = cv2.Sobel(cv2.GaussianBlur(L.astype(np.float32), (0, 0), 1.0), cv2.CV_32F, 0, 1, ksize=3)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dyv = (xx + 0.5 - cx) / R, (yy + 0.5 - cy) / R
    sel = (np.hypot(dx, dyv) < r_max) & (dyv > dy_range[0] - 0.08) & (dyv < dy_range[1] + 0.08) & (np.abs(dx) < 0.4)
    best = None
    for a in angles:
        t = math.radians(a)
        v = (-dx * math.sin(t) + dyv * math.cos(t))[sel]            # distance below the centre across a tilted line
        bins = np.round(v * R).astype(int)
        lo = bins.min()
        s = np.bincount(bins - lo, weights=gy[sel])
        c = np.bincount(bins - lo)
        prof = np.abs(s) / np.maximum(c, 1) * np.minimum(c / max(c.max(), 1), 1)
        k = int(np.argmax(prof))
        dyk = (k + lo) / R
        if not (dy_range[0] <= dyk <= dy_range[1]):
            continue
        if best is None or prof[k] > best[2]:
            best = (float(a), float(dyk), float(prof[k]))
    return best


def fit_centre_fixed_r(pts, c0, r, iters=30):
    """Least-squares centre of a circle of known radius r through pts (Gauss-Newton from c0)."""
    c = np.array(c0, np.float64)
    for _ in range(iters):
        d = pts - c
        n = np.linalg.norm(d, axis=1)
        res = n - r
        J = -d / n[:, None]
        step, *_ = np.linalg.lstsq(J, -res, rcond=None)
        c += step
        if np.linalg.norm(step) < 1e-4:
            break
    return c


def tick_peaks(L, ctr, r, angs_range, step=0.05, pct=70):
    """Angles (cw12) of tick peaks on the circle (ctr, r) inside angs_range [a0, a1]."""
    a = np.arange(angs_range[0], angs_range[1], step, dtype=np.float32)
    radii, prof = sample_rays(L, ctr[0], ctr[1], a, r, r + 1.0, step=1.0)
    s = prof[:, 0]
    ok = s >= 0
    a, s = a[ok], s[ok]
    thr = np.percentile(s, pct)
    pk = [i for i in range(1, len(s) - 1) if s[i] >= s[i - 1] and s[i] > s[i + 1] and s[i] > thr]
    m = []
    for i in pk:
        if m and a[i] - a[m[-1]] < 1.2:
            if s[i] > s[m[-1]]:
                m[-1] = i
            continue
        m.append(i)
    return a[m], s[m]
