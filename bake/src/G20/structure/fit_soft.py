"""Fit the soft layers (background, band glow, wing faces, map veil) to one rectified photo.

  python fit_soft.py 08 night      -> params/soft_night.npz
  python fit_soft.py 09 day        -> params/soft_day.npz

Absolute code values of the photo are the target (no exposure normalisation). Masked from every fit: crisp
content (top-hat of luminance: ticks, numerals, lines, roads, text), every non-structure element's bbox from
g20_comfort.json, the needles and the pointer-glow zones (distance < ZONE_R px to the needle, y > ZONE_Y),
glare areas listed in GLARE. Masked bins of the (s, d) tables are filled from their neighbours along the curve,
so the static model continues under the pointer glow.
"""
import sys

import cv2
import numpy as np

import lib
import model

ZONE_R, ZONE_Y = 100.0, 415.0
GLARE = {"09": [(760, 95, 1180, 215)], "14": [(560, 120, 960, 600)], "08": []}   # x0, y0, x1, y1 (panel px)
# needle segments [(x_top, y_top), (x_bottom, y_bottom)] per photo (08 from g20_comfort.json; idle measured)
NEEDLES = {
    "08": {"speedo": [(417.7, 468.0), (370.1, 643.4)], "tacho": [(1503.8, 470.8), (1551.9, 645.4)]},
    "09": {"speedo": [(417.7, 468.0), (370.1, 643.4)], "tacho": None},
    "14": {"speedo": [(417.7, 468.0), (370.1, 643.4)], "tacho": None},
}
BG_EXCLUDE_GROUPS = ("telltale", "bottom-row", "assist-message", "map-nav", "overlay")


def find_idle_needle(im):
    """The tacho needle at idle (09, 14): orange-red thin line in the lower right of the tacho."""
    x0, y0, x1, y1 = 1515, 455, 1690, 640
    c = im[y0:y1, x0:x1]
    m = (c[..., 0] > 0.8) & (c[..., 1] > 0.25) & (c[..., 1] < 0.62) & (c[..., 2] < 0.55)
    ys, xs = np.nonzero(m)
    if len(xs) < 40:
        return [(1545.0, 480.0), (1648.0, 628.0)]
    pts = np.stack([xs + x0, ys + y0], 1).astype(np.float32)
    vx, vy, cx, cy = cv2.fitLine(pts, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    t = (pts - [cx, cy]) @ np.array([vx, vy])
    a = np.array([cx, cy]) + t.min() * np.array([vx, vy])
    b = np.array([cx, cy]) + t.max() * np.array([vx, vy])
    top, bot = (a, b) if a[1] < b[1] else (b, a)
    return [tuple(map(float, top)), tuple(map(float, bot))]


def seg_dist(X, Y, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    u = np.clip(((X - a[0]) * ab[0] + (Y - a[1]) * ab[1]) / (ab @ ab), 0, 1)
    return np.hypot(X - a[0] - u * ab[0], Y - a[1] - u * ab[1])


def needles(photo, im):
    n = dict(NEEDLES.get(photo, NEEDLES["09"]))
    if n.get("tacho") is None:
        n["tacho"] = find_idle_needle(im)
    return n


def zone_mask(photo, im, shape=(lib.H, lib.W)):
    Y, X = np.mgrid[0:shape[0], 0:shape[1]] + 0.5
    z = np.zeros(shape, bool)
    corridor = np.zeros(shape, bool)
    for dial, seg in needles(photo, im).items():
        d = seg_dist(X, Y, *seg)
        z |= (d < ZONE_R) & (Y > ZONE_Y)
        corridor |= d < 7
    return z, corridor


def crisp_mask(im, white_only=False):
    L = im.mean(2)
    op = cv2.morphologyEx(L, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    th = (L - op) > 0.06
    if white_only:      # keep the band's own bright red line in the fit: mask only whitish crisp content
        th &= (im.max(2) - im.min(2)) < 0.22
    cl = cv2.morphologyEx(L, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    bh = (cl - L) > 0.08                     # thin dark lines (e.g. the minis' tick lines)
    return cv2.dilate((th | bh).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0


def element_mask(groups=BG_EXCLUDE_GROUPS, pad=5, ids=None):
    m = np.zeros((lib.H, lib.W), bool)
    for e in lib.overlay_elements().values():
        if (ids is None and e["group"] in groups) or (ids is not None and e["id"] in ids):
            x0, y0, x1, y1 = e["bbox"]
            m[max(0, int(y0) - pad):int(y1) + pad, max(0, int(x0) - pad):int(x1) + pad] = True
    return m


def glare_mask(photo):
    m = np.zeros((lib.H, lib.W), bool)
    for x0, y0, x1, y1 in GLARE.get(photo, []):
        m[y0:y1, x0:x1] = True
    return m


def poly_terms(X, Y, deg=3):
    x = (X - 960) / 960.0
    y = (Y - 360) / 360.0
    return np.stack([x ** i * y ** j for i in range(deg + 1) for j in range(deg + 1 - i)], -1)


def fit_bg(im, valid, deg=3):
    Y, X = np.mgrid[0:lib.H, 0:lib.W] + 0.5
    sub = valid.copy()
    sub[::2, :] = False                    # thin the sample
    sub[:, ::2] = False
    A = poly_terms(X[sub], Y[sub], deg)
    coefs = []
    for c in range(3):
        v = im[..., c][sub]
        keep = np.ones(len(v), bool)
        for _ in range(3):
            co = np.linalg.lstsq(A[keep], v[keep], rcond=None)[0]
            r = v - A @ co
            sd = np.std(r[keep])
            keep = np.abs(r) < 2.5 * sd + 1e-4
        coefs.append(co)
    return np.array(coefs)


def eval_bg(coefs, X, Y, deg=3):
    """coefs: (3, ny, nx) node grid (spacing BG_STEP px, node (0,0) at panel (0,0)), bilinear."""
    G = np.asarray(coefs)
    ny, nx = G.shape[1:]
    fx = np.clip(np.asarray(X) / BG_STEP, 0, nx - 1 - 1e-6)
    fy = np.clip(np.asarray(Y) / BG_STEP, 0, ny - 1 - 1e-6)
    i0, j0 = np.floor(fy).astype(int), np.floor(fx).astype(int)
    a, b = fy - i0, fx - j0
    out = [(1 - a) * (1 - b) * G[c][i0, j0] + (1 - a) * b * G[c][i0, j0 + 1] + a * (1 - b) * G[c][i0 + 1, j0]
           + a * b * G[c][i0 + 1, j0 + 1] for c in range(3)]
    return np.stack(out, -1)


BG_STEP = 40.0


def fit_bg(im, valid, deg=None, lam=0.5):
    """Background as a bilinear node grid (every BG_STEP px) fitted by regularised least squares (membrane
    smoothness), robust to outliers (two passes); masked areas are filled smoothly by the regulariser."""
    import scipy.sparse as sp
    from scipy.sparse.linalg import lsqr
    nx, ny = int(np.ceil(lib.W / BG_STEP)) + 1, int(np.ceil(lib.H / BG_STEP)) + 1
    Y, X = np.mgrid[0:lib.H, 0:lib.W] + 0.5
    sub = valid.copy()
    sub[1::2, :] = False
    sub[:, 1::2] = False
    xs, ys = X[sub], Y[sub]
    fx, fy = xs / BG_STEP, ys / BG_STEP
    i0, j0 = np.floor(fy).astype(int), np.floor(fx).astype(int)
    a, b = fy - i0, fx - j0
    n = len(xs)
    rows = np.repeat(np.arange(n), 4)
    cols = np.stack([i0 * nx + j0, i0 * nx + j0 + 1, (i0 + 1) * nx + j0, (i0 + 1) * nx + j0 + 1], 1).ravel()
    vals = np.stack([(1 - a) * (1 - b), (1 - a) * b, a * (1 - b), a * b], 1).ravel()
    A = sp.csr_matrix((vals, (rows, cols)), shape=(n, nx * ny))
    # membrane regulariser (first differences) between neighbouring nodes
    R = []
    for i in range(ny):
        for j in range(nx):
            k = i * nx + j
            if j + 1 < nx:
                R.append((k, k + 1))
            if i + 1 < ny:
                R.append((k, k + nx))
    R = np.array(R)
    D = sp.csr_matrix((np.r_[np.ones(len(R)), -np.ones(len(R))], (np.r_[np.arange(len(R)), np.arange(len(R))],
                                                                    np.r_[R[:, 0], R[:, 1]])), shape=(len(R), nx * ny))
    w_reg = lam * np.sqrt(n / (nx * ny))
    out = []
    for c in range(3):
        v = im[..., c][sub]
        w = np.ones(n)
        for _ in range(2):
            Aw = sp.diags(w) @ A
            M = sp.vstack([Aw, w_reg * D])
            g = lsqr(M, np.r_[w * v, np.zeros(len(R))], atol=1e-7, btol=1e-7, iter_lim=4000)[0]
            r = v - A @ g
            sd = 1.4826 * np.median(np.abs(r)) + 1e-4
            w = 1.0 / np.maximum(1.0, np.abs(r) / (2.5 * sd))
        out.append(g.reshape(ny, nx))
    return np.array(out)


def structure_regions(geo):
    """Full-panel masks: dial interiors (frame polygons), minis."""
    m = np.zeros((lib.H, lib.W), np.float32)
    for dial in ("speedo", "tacho"):
        f = np.array(geo["%s_frame" % dial], float)
        cv2.fillPoly(m, [np.round(f).astype(np.int32)], 1.0)
        cv2.polylines(m, [np.round(f).astype(np.int32)], False, 1.0, 26)
    els = lib.overlay_elements()
    for k in ("structure.fuel_mini", "structure.oil_mini"):
        x0, y0, x1, y1 = els[k]["bbox"]
        m[max(0, int(y0) - 10):int(y1) + 10, max(0, int(x0) - 10):int(x1) + 10] = 1
    return m > 0.5


def fit(photo, look):
    im = lib.load_rect(photo)
    geo = model.geometry()
    crisp = crisp_mask(im)
    zone, corridor = zone_mask(photo, im)
    elems = element_mask()
    glare = glare_mask(photo)
    struct = structure_regions(geo)
    mapr = element_mask(ids=("map.region",), pad=12)
    dials = {d: model.Dial(geo, d) for d in ("speedo", "tacho")}

    # ---- background: outside the dials/minis/elements/map, plus each dial's inner face away from the map
    bgvalid = ~(struct | elems | crisp | glare | mapr | corridor)
    for d, D in dials.items():
        x0, y0, x1, y1 = D.box
        inner = (D.inside > 0.99) & (D.wing < 0.01) & (D.dE < -8) & (D.dB < -8)
        sl = (slice(y0, y1), slice(x0, x1))
        bgvalid[sl] |= inner & ~(crisp | elems | glare | mapr | zone | corridor)[sl]
    coefs = fit_bg(im, bgvalid)
    Y, X = np.mgrid[0:lib.H, 0:lib.W] + 0.5
    bg = eval_bg(coefs, X, Y)

    out = {"bg_coefs": coefs, "bg_deg": 3}
    report = {"photo": photo, "look": look, "bg_valid_px": int(bgvalid.sum()),
              "bg_resid_rms": float(np.sqrt(((im - bg)[bgvalid] ** 2).mean()) * 255)}
    excl = crisp_mask(im, white_only=True) | elems | glare | corridor
    raw = {}
    for d, D in dials.items():
        x0, y0, x1, y1 = D.box
        sl = (slice(y0, y1), slice(x0, x1))
        img, bgd, ex, zn = im[sl], bg[sl], excl[sl], zone[sl]
        sE_B = model.s_edges(D.band)
        sE_E = model.s_edges(D.E)
        gdom = (D.inside > 0.99) & (D.wing < 0.5) & (D.dB > -3) & (D.dB < 72) & (D.distF > 7)
        raw["glow", d] = lib.table_fit(img - bgd, D.sB, D.dB, sE_B, model.GLOW_D, gdom & ~ex & ~zn, raw_only=True)
        wdom = (D.wing > 0.99) & (D.distE > 3)
        raw["wing", d] = lib.table_fit(img, D.sB, -D.dB, sE_B, model.WING_D, wdom & ~ex & ~zn, raw_only=True)
        edom = (D.distE < 16.5) & (D.dE > -4.5) & (D.distB > 3)
        raw["wingE", d] = lib.table_fit(img, D.sE, D.dE, sE_E, model.WINGE_D, edom & ~ex & ~zn, raw_only=True)
    # the dials are mirror images and their tables share the speedo-space curves: a face bin the tacho never shows
    # (its apex under the gear letter) is taken from the speedo, scaled by the per-channel median ratio of the bins
    # both see. (The other way round, and for the glow, it made the fit worse: the glow differs at the top.)
    smooth = {"glow": 1.5, "wing": 2.0, "wingE": 2.0}
    for kind in ("glow", "wing", "wingE"):
        A, B = raw[kind, "speedo"], raw[kind, "tacho"]
        both = ~np.isnan(A[..., 0]) & ~np.isnan(B[..., 0])
        for d, own, other in (("speedo", A, B), ("tacho", B, A)):
            T = own.copy()
            take = np.isnan(T[..., 0]) & ~np.isnan(other[..., 0])
            if not (kind in ("wing", "wingE") and d == "tacho"):
                take[:] = False     # tried both ways: only the tacho faces (apex under the gear letter) gain
            if both.sum() > 20:
                g = np.median(own[both] + 1e-3, 0) / np.median(other[both] + 1e-3, 0)
                T[take] = other[take] * g
            report["%s_%s_from_other_dial" % (kind, d)] = float(take.mean())
            Tf, filled = lib.table_fill(T, smooth[kind])
            out["%s_%s" % (kind, d)] = np.clip(Tf, 0, 1)
            report["%s_%s_filled" % (kind, d)] = float(filled.mean())
    # ---- map veil: attenuation of the map's roads at the left/right ends of map.region (road contrast)
    out["veil"] = fit_veil(im, crisp)
    report["veil"] = out["veil"].tolist()
    report["needles"] = needles(photo, im)
    np.savez_compressed(lib.os.path.join(lib.PARAMS, "soft_%s.npz" % look), **out)
    lib.write_json(lib.os.path.join(lib.PARAMS, "soft_%s.report.json" % look), report)
    return out, report


def fit_veil(im, crisp):
    """Road contrast (95th pct of the luminance top-hat on road pixels) vs x, rows clear of texts; the veil's
    alpha = 1 - contrast(x) / plateau, modelled as two logistic ramps: a(x) = A_l*sig((xl - x)/wl) +
    A_r*sig((x - xr)/wr). Returns [A_l, xl, wl, A_r, xr, wr]."""
    L = im.min(2)
    op = cv2.morphologyEx(L, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    th = L - op
    xs, cs = [], []
    for x in range(540, 1400, 10):
        v = np.concatenate([th[430:590, x:x + 10].ravel(), th[160:300, x:x + 10].ravel()])
        v = v[v > 0.06]
        if len(v) > 15:
            xs.append(x + 5)
            cs.append(np.percentile(v, 95))
    xs, cs = np.array(xs, float), np.array(cs, float)
    plateau = np.median(cs[(xs > 800) & (xs < 1150)])
    r = np.clip(cs / plateau, 0, 1.2)

    axis = lib.read_json(lib.os.path.join(lib.PARAMS, "geometry.json"))["mirror_axis_x"]

    def model_a(p, x):         # symmetric about the dials' mirror axis: one amplitude, centre, width
        A, xl, wl = p
        xr = 2 * axis - xl
        return A / (1 + np.exp(-(xl - x) / wl)) + A / (1 + np.exp(-(x - xr) / wl))
    from scipy.optimize import least_squares
    res = least_squares(lambda p: (1 - model_a(p, xs)) - r, [0.8, 590, 20],
                        bounds=([0, 520, 3], [1, 720, 80]), loss="soft_l1", f_scale=0.1)
    A, xl, wl = res.x
    res.x = np.array([A, xl, wl, A, 2 * axis - xl, wl])
    return np.array(res.x)


if __name__ == "__main__":
    photo, look = sys.argv[1], sys.argv[2]
    _, rep = fit(photo, look)
    print({k: v for k, v in rep.items() if k not in ("needles",)})
