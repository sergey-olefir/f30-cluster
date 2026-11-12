"""Geometry of the stock G20 Comfort dials, measured on the rectified photos (08 night, 09 day).

Every curve is *measured*: a ridge/edge tracker or hand anchors refined by snapping to the photo's own ridge or
edge (sub-pixel), smoothed. Where a part is never visible (under the gear letter, under '260') the mirror image
of the other dial fills it: the two dials are mirror images about x = AXIS (measured: frames, bands and inner
edges agree within ~1 px), and such parts are flagged weak.

Output: params/geometry.json (panel px).
"""
import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d, median_filter

import lib

# Hand anchors (panel px, read off fine-grid zooms of rect 08), refined by snapping below.
SP_BAND = [(703, 95), (650, 97.5), (600, 100.5), (560, 103), (520, 107.5), (475, 112.5), (432, 118), (390, 127),
           (351, 141), (319, 159), (282, 185), (244, 214), (203, 253), (175, 285), (159, 313), (151, 342),
           (158, 376), (175, 417), (200, 464), (232, 509), (256, 540), (275, 566), (292, 585), (312, 596),
           (340, 600.5), (400, 601.5), (460, 602), (503, 602)]
TC_BAND = [(1246, 91), (1270, 92), (1300, 93.5), (1330, 96), (1349, 99), (1374, 102), (1390, 104), (1421, 108),
           (1443, 111), (1458, 114), (1488, 119), (1505, 122), (1528, 127), (1548, 132), (1563, 138), (1582, 146),
           (1596, 154), (1618, 171), (1636, 183), (1656, 198), (1675, 214), (1688, 226), (1703, 241), (1718, 256),
           (1732, 272), (1746, 290), (1754, 303), (1761, 319), (1765, 337), (1763, 363), (1759, 380), (1750, 403),
           (1741, 422), (1733, 436), (1723, 455), (1710, 476), (1699, 493), (1684, 515), (1673, 530), (1661, 546),
           (1650, 558), (1638, 572), (1622, 585), (1600, 595), (1578, 600), (1550, 601.5), (1500, 602),
           (1450, 602.5), (1418, 603)]


# The tacho's wing strip end next to '7' (visible; the speedo's twin is under '260'), in tacho px, top-left first.
TC_STRIP_E = [(1243.5, 91.5), (1244.5, 97), (1247, 101.5), (1252, 104.5), (1262, 106.5), (1280, 108.5)]


def occlusion_mask(im):
    """1 where something that is not the dial's soft structure sits on rect 08: bright text/ticks (dilated),
    the two needles, the gear letter, the digital speed, info lines, labels."""
    mn = im.min(2)
    M = cv2.dilate((mn > 0.45).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    els = lib.overlay_elements()
    for k in ("structure.speedo_needle", "structure.tacho_needle"):
        p = np.round(np.array(els[k]["poly"], float)).astype(np.int32)
        cv2.fillPoly(M, [p], 1.0)
        cv2.polylines(M, [p], True, 1.0, 9)
    for k in ("assist.gear_centre", "assist.digital_speed", "assist.mode_label_centre", "assist.rpm_label",
              "assist.off", "structure.speedo_info_line", "structure.tacho_info_line"):
        x0, y0, x1, y1 = els[k]["bbox"]
        M[int(y0) - 4:int(y1) + 4, int(x0) - 4:int(x1) + 4] = 1
    M[408:422, 360:700] = 1
    M[408:422, 1215:1560] = 1
    return cv2.GaussianBlur(M, (0, 0), 1.0)


def snap_sym(img, M, pts, axis, mode, win=3.0, h=1.5, sigma=3.0):
    """Snap a speedo-space polyline to the ridge ('ridge') or edge ('edge', brighter on one consistent side) of
    img, summing the evidence of the speedo (at P) and of the tacho (at mirror(P)); masked samples count 0.
    Returns the refined polyline and the per-vertex support (0, 1 or 2 dials)."""
    pts = lib.resample(pts, 1.0)
    t = np.gradient(pts, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
    n = np.stack([-t[:, 1], t[:, 0]], 1)
    offs = np.arange(-win, win + 1e-6, 0.25)
    G = pts[:, None, :] + offs[None, :, None] * n[:, None, :]
    N = np.repeat(n[:, None, :], len(offs), 1)

    def val(P, Nn):
        P2, N2 = P.reshape(-1, 2), Nn.reshape(-1, 2)
        if mode == "ridge":
            v = lib.sample(img, P2)
        else:
            v = lib.sample(img, P2 + h * N2) - lib.sample(img, P2 - h * N2)
        w = 1 - np.clip(3 * lib.sample(M, P2), 0, 1)
        return (v * w).reshape(P.shape[:2]), w.reshape(P.shape[:2])
    vs, ws = val(G, N)
    Gm = G.copy()
    Gm[..., 0] = 2 * axis - Gm[..., 0]
    Nm = N.copy()
    Nm[..., 0] = -Nm[..., 0]
    vt, wt = val(Gm, Nm)
    v = vs + vt
    if mode == "edge":
        c = len(offs) // 2
        if v[:, c - 4:c + 5].sum() < 0:
            v = -v
    k = v.argmax(1)
    sup = (ws[:, len(offs) // 2] > 0.5).astype(int) + (wt[:, len(offs) // 2] > 0.5).astype(int)
    ok = (k > 0) & (k < len(offs) - 1) & (sup > 0)
    off = offs[k].astype(float)
    idx = np.arange(len(pts))
    off = np.interp(idx, idx[ok], off[ok]) if ok.sum() > 3 else np.zeros(len(pts))
    off = gaussian_filter1d(median_filter(off, 9, mode="nearest"), sigma, mode="nearest")
    return pts + off[:, None] * n, sup


def features(im):
    L = im.mean(2)
    mn = im.min(2)
    white = cv2.GaussianBlur(mn, (0, 0), 1.0)
    wm = cv2.dilate((mn > 0.45).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    wmf = cv2.GaussianBlur(wm.astype(np.float32), (0, 0), 1.0)
    Rg = cv2.GaussianBlur(im[..., 0], (0, 0), 1.0)
    Lg = cv2.GaussianBlur(L, (0, 0), 1.2)
    return dict(L=L, white=white, wmf=wmf, Rg=Rg, Lg=Lg)


def edge_fn(img, sign, mask=None, h=1.5):
    def f(P, n):
        v = sign * (lib.sample(img, P - h * n) - lib.sample(img, P + h * n))
        if mask is not None:
            v = v * (1 - np.clip(3 * lib.sample(mask, P), 0, 1))
        return v
    return f


def edge_sign(img, p, t):
    n = lib.perp(lib.unit(t))
    a = lib.sample(img, [np.array(p) + 4 * n])[0]
    b = lib.sample(img, [np.array(p) - 4 * n])[0]
    return 1.0 if b > a else -1.0      # +1: brighter on the -n side


def trace2(fa, fb, p0, t0, stopA, stopB, **kw):
    a, _ = lib.track(fa, p0, t0, stop=stopA, **kw)
    b, _ = lib.track(fb, p0, -np.array(t0, float), stop=stopB, **kw)
    return np.vstack([b[::-1], a[1:]])


def snap_dir(img, pts, win=3.0, h=1.5, mask=None, sigma=3.0, min_val=0.03):
    """Snap a polyline to the edge where img drops from the +n side (n = perp of travel) to the -n side."""
    pts = lib.resample(pts, 1.0)
    t = np.gradient(pts, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
    n = np.stack([-t[:, 1], t[:, 0]], 1)
    offs = np.arange(-win, win + 1e-6, 0.25)
    G = pts[:, None, :] + offs[None, :, None] * n[:, None, :]
    nn = np.repeat(n[:, None, :], len(offs), 1)
    a = lib.sample(img, (G + h * nn).reshape(-1, 2))
    b = lib.sample(img, (G - h * nn).reshape(-1, 2))
    v = (a - b).reshape(len(pts), len(offs))
    if mask is not None:
        v *= (1 - np.clip(3 * lib.sample(mask, G.reshape(-1, 2)), 0, 1)).reshape(v.shape)
    k = v.argmax(1)
    best = v[np.arange(len(pts)), k]
    ok = (best > min_val) & (k > 0) & (k < len(offs) - 1)
    off = offs[k].astype(float)
    idx = np.arange(len(pts))
    if ok.sum() > 3:
        off = np.interp(idx, idx[ok], off[ok])
    else:
        off[:] = 0
    off = gaussian_filter1d(median_filter(off, 11, mode="nearest"), sigma, mode="nearest")
    return pts + off[:, None] * n, ok


def catmull(anchors, step=1.0):
    P = np.asarray(anchors, float)
    P = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(2, int(np.linalg.norm(p2 - p1) / step))
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-2])
    return np.array(out)


def mirror(pts, axis):
    p = np.array(pts, float).copy()
    p[:, 0] = 2 * axis - p[:, 0]
    return p


def frame_bottom_y(F, x_ranges):
    """Fit y = a + b x to the white ridge of the bottom frame line over the given x ranges."""
    xs, ys = [], []
    for x0, x1 in x_ranges:
        for x in range(x0, x1):
            col = F["white"][630:660, x]
            k = int(np.argmax(col))
            if col[k] > 0.5 and 0 < k < 29:
                a, b, c = col[k - 1], col[k], col[k + 1]
                den = a - 2 * b + c
                ys.append(630 + k + (0.5 * (a - c) / den if abs(den) > 1e-9 else 0))
                xs.append(x)
    xs, ys = np.array(xs, float), np.array(ys, float)
    A = np.stack([np.ones_like(xs), xs], 1)
    coef = np.linalg.lstsq(A, ys, rcond=None)[0]
    r = ys - A @ coef
    keep = np.abs(r) < 3 * (np.std(r) + 1e-6)
    coef = np.linalg.lstsq(A[keep], ys[keep], rcond=None)[0]
    return coef, float(np.std(ys[keep] - A[keep] @ coef))


def line_extent(F, y_line, x_from, direction, x_stop, thr=0.5):
    """Walk along a horizontal line from x_from in `direction` while the white ridge persists."""
    x = x_from
    last = x
    gap = 0
    while (x - x_stop) * direction < 0:
        y = y_line(x)
        v = lib.sample(F["white"], [(x, y)])[0]
        if v > thr:
            last = x
            gap = 0
        else:
            gap += 1
            if gap > 4:
                break
        x += direction
    return last


def measure():
    im08, im09 = lib.load_rect("08"), lib.load_rect("09")
    F8, F9 = features(im08), features(im09)
    geo = {"about": "Panel px. Measured on rect 08 (night) unless noted; 09 used for parts hidden in 08.",
           "evidence": {}}

    # --- frames (white ridge tracker) ----------------------------------------------------------------------
    def seed_col(F, x, y0, y1):
        c = F["white"][y0:y1, x]
        return (x, y0 + float(np.argmax(c)))
    spF = trace2(F8["white"], F8["white"], seed_col(F8, 470, 40, 80), (1, -0.08), lambda p: p[0] > 703.5,
                 lambda p: p[1] > 643 and p[0] > 330, win=3, min_val=0.4)
    tcF = trace2(F8["white"], F8["white"], seed_col(F8, 1470, 40, 80), (-1, -0.08), lambda p: p[0] < 1214.5,
                 lambda p: p[1] > 643 and p[0] < 1640, win=3, min_val=0.4)
    spF = lib.smooth_poly(lib.resample(spF, 1.0), 1.5)
    tcF = lib.smooth_poly(lib.resample(tcF, 1.0), 1.5)
    # mirror axis from the frames: fit x_m so that the tacho frame mirrored lands on the speedo frame
    from scipy.spatial import cKDTree
    kd = cKDTree(spF)
    best = None
    for xm in np.arange(955, 963, 0.05):
        d, _ = kd.query(mirror(tcF, xm))
        v = np.median(d)
        if best is None or v < best[1]:
            best = (xm, v)
    axis = float(best[0])
    # bottom straight lines (08 and 09 agree; use 09 where 08 has the cc panel / sign)
    sp_coef, sp_sd = frame_bottom_y(F9, [(340, 362), (385, 492), (590, 690)])
    tc_coef, tc_sd = frame_bottom_y(F9, [(1225, 1420), (1440, 1530), (1560, 1600)])
    spy = lambda x: sp_coef[0] + sp_coef[1] * x  # noqa: E731
    tcy = lambda x: tc_coef[0] + tc_coef[1] * x  # noqa: E731
    sp_end = line_extent(F9, spy, 600, +1, 760)
    tc_start_walk = line_extent(F9, tcy, 1300, -1, 1150)
    tc_start = round(2 * axis - sp_end, 1)      # mirror of the speedo end (the walk runs into the curved end)
    # join: frame trace (ends on the bottom line) + straight line to the end
    i = np.flatnonzero(spF[:, 1] > spy(spF[:, 0]) - 1.0)
    j0 = i[0] if len(i) else len(spF) - 1
    sp_frame = np.vstack([[[sp_end, spy(sp_end)], [spF[j0, 0] + 25, spy(spF[j0, 0] + 25)]], spF[j0:][::-1][::-1][:0]])
    # order: start at the bottom-right end of the bottom line, go left, up the side, right along the top
    sp_frame = np.vstack([[[sp_end, spy(sp_end)]], [[x, spy(x)] for x in np.arange(sp_end - 1, spF[0, 0], -1.0)],
                          spF])
    tc_frame = np.vstack([[[tc_start, tcy(tc_start)]], [[x, tcy(x)] for x in np.arange(tc_start + 1, tcF[0, 0], 1.0)],
                          tcF])
    sp_frame = lib.smooth_poly(lib.resample(sp_frame, 1.0), 1.0)
    tc_frame = lib.smooth_poly(lib.resample(tc_frame, 1.0), 1.0)
    geo["speedo_frame"] = sp_frame.round(2).tolist()
    geo["tacho_frame"] = tc_frame.round(2).tolist()
    geo["bottom_line"] = {"speedo": {"a": sp_coef[0], "b": sp_coef[1], "x_end": float(sp_end), "sd": sp_sd},
                          "tacho": {"a": tc_coef[0], "b": tc_coef[1], "x_start": float(tc_start), "sd": tc_sd}}
    geo["evidence"]["frames"] = "strong: ridge-tracked on 08; bottom lines fitted on 09 (08 has the sign and cc panel)"

    geo["mirror_axis_x"] = axis
    geo["mirror_residual_px"] = float(best[1])

    # --- bands and inner edges: ONE curve in speedo space snapped to both dials at once -----------------------
    # (the tacho sample points are the mirror images); occlusions (numerals, needles, gear letter, texts,
    # info lines) are masked per side, so a part hidden on one dial is measured on the other.
    M = occlusion_mask(im08)
    R = F8["Rg"]
    Rhp = R - cv2.GaussianBlur(R, (0, 0), 3.0)
    band, cb = snap_sym(Rhp, M, catmull(SP_BAND), axis, "ridge", win=3.5)
    band = lib.smooth_poly(band, 1.0)
    spE0 = trace2(edge_fn(F8["Lg"], edge_sign(F8["Lg"], (413.0, 330.0), (0, -1))),
                  edge_fn(F8["Lg"], -edge_sign(F8["Lg"], (413.0, 330.0), (0, -1))), (413.0, 330.0), (0, -1),
                  lambda p: p[0] > 655 or p[1] < 95, lambda p: p[1] > 603, win=2, min_val=0.02, inertia=0.7)
    spE0 = spE0[::-1] if spE0[0, 1] > spE0[-1, 1] else spE0          # from the top strip down to the bottom
    tc_strip = mirror(np.array(TC_STRIP_E, float), axis)               # the strip end, seen on the tacho only
    spE0 = np.vstack([tc_strip, spE0[spE0[:, 0] < tc_strip[-1, 0] - 2]])
    E, ce = snap_sym(F8["Lg"], M, lib.smooth_poly(lib.resample(spE0, 1.0), 2.0), axis, "edge", win=2.5)
    E = lib.smooth_poly(E, 1.5)
    geo["speedo_band"] = band.round(2).tolist()
    geo["tacho_band"] = mirror(band, axis).round(2).tolist()
    geo["speedo_E"] = E.round(2).tolist()
    geo["tacho_E"] = mirror(E, axis).round(2).tolist()
    geo["snap_support"] = {"band_both": float((cb == 2).mean()), "band_one": float((cb == 1).mean()),
                           "band_none": float((cb == 0).mean()), "E_both": float((ce == 2).mean()),
                           "E_one": float((ce == 1).mean()), "E_none": float((ce == 0).mean())}
    geo["evidence"]["band_E"] = ("strong: one curve per kind snapped to both dials (mirror axis x = %.2f, frame "
                                 "mirror residual %.2f px); parts hidden on both dials (none for the band; for E "
                                 "the apex under the gear letter is seen on the speedo, the strip end under '260' "
                                 "on the tacho) are interpolated" % (axis, best[1]))
    return geo, (im08, im09, F8, F9)


def wing_polygon(band, E):
    """Closed wing polygon: band (outer edge) + E reversed; the two ends are joined by straight segments."""
    band = np.asarray(band)
    E = np.asarray(E)
    # orient E so that its start is near the band's start
    if np.linalg.norm(E[0] - band[0]) > np.linalg.norm(E[-1] - band[0]):
        E = E[::-1]
    return np.vstack([band, E[::-1]])


if __name__ == "__main__":
    geo, (im08, im09, F8, F9) = measure()
    lib.write_json(lib.os.path.join(lib.PARAMS, "geometry.json"), geo)
    vis = (np.clip(im08, 0, 1) ** 0.6 * 255).astype(np.uint8)[..., ::-1].copy()
    for k, c in [("speedo_frame", (0, 255, 0)), ("tacho_frame", (0, 255, 0)), ("speedo_band", (255, 255, 0)),
                 ("tacho_band", (255, 255, 0)), ("speedo_E", (255, 0, 255)), ("tacho_E", (255, 0, 255))]:
        p = np.array(geo[k])
        cv2.polylines(vis, [np.round(p * 4).astype(np.int32)], False, c, 1, cv2.LINE_AA, shift=2)
    cv2.imwrite(lib.os.path.join(lib.SCRATCH, "geom_08.png"), vis)
    print("axis", geo["mirror_axis_x"], geo["mirror_residual_px"], geo["bottom_line"], geo["snap_support"])
