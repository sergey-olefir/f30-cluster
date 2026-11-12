"""Shared helpers for the G20 stock-dial bake (package B): paths, photo loading, curve tracking on the rectified
photos, curve coordinates (arclength s, signed distance d), (s, d) profile tables, anti-aliased rasterisation.

Conventions: panel px (1920x720, x right, y down); images float32 0..1 sRGB code values, RGB(A) straight alpha.
Nothing here writes photo pixels anywhere: the photos are only read to *measure* (geometry, profiles, colours).
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
WT = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))           # the worktree root
MAIN = os.environ.get('F30_MAIN', WT)        # the checkout holding the git-ignored evidence (reference/, bake/work/); set F30_MAIN from a worktree
RECT = os.path.join(MAIN, "bake", "work", "overlay", "rect")
OUT = os.path.join(WT, "bench", "g20", "structure")                        # shipped PNGs + manifest.part.json
SCRATCH = os.path.join(WT, "bake", "work", "g20sim", "B")
PARAMS = os.path.join(HERE, "params")
OVERLAY_JSON = os.path.join(WT, "design", "overlay", "g20_comfort.json")
FONT_JSON = os.path.join(WT, "bake", "work", "g20sim", "FONT.json")
FONT_FALLBACK = os.path.join(WT, "tools", "fonts-src", "Arimo[wght].ttf")
W, H = 1920, 720

sys.path.insert(0, os.path.join(WT, "bake", "src"))


def load_rect(photo):
    """-> float32 (720, 1920, 3) RGB 0..1, or None if the git-ignored rect is not on this machine."""
    p = os.path.join(RECT, "%s.png" % photo)
    if not os.path.exists(p):
        return None
    return cv2.imread(p, cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32) / 255.0


def overlay_elements():
    with open(OVERLAY_JSON) as f:
        return {e["id"]: e for e in json.load(f)["elements"]}


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    def conv(o):
        if isinstance(o, np.generic):
            return o.item()
        if isinstance(o, np.ndarray):
            return o.tolist()
        raise TypeError(type(o))
    with open(path, "w") as f:
        json.dump(obj, f, indent=1, default=conv)
        f.write("\n")


def read_json(path):
    with open(path) as f:
        return json.load(f)


# ------------------------------------------------------------------------------------------------- sampling
def sample(img, pts):
    """Bilinear sample of a 2-D float image at float points (N, 2) [x, y]."""
    pts = np.asarray(pts, np.float32).reshape(-1, 2)
    n = len(pts)
    w = 30000
    rows = (n + w - 1) // w
    pad = np.zeros((rows * w, 2), np.float32)
    pad[:n] = pts
    mx = pad[:, 0].reshape(rows, w)
    my = pad[:, 1].reshape(rows, w)
    out = cv2.remap(np.ascontiguousarray(img, np.float32), mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return out.reshape(-1)[:n]


def unit(v):
    v = np.asarray(v, np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


def perp(t):
    return np.array([-t[1], t[0]])


def track(feat, p0, t0, step=2.0, win=4.0, min_val=0.0, max_steps=3000, inertia=0.5, max_miss=12,
          stop=None, max_turn=None):
    """Follow a ridge of `feat` (2-D float) from p0 in direction t0: each step advances `step` px, samples the
    feature across the path (+-win px), moves to the sub-pixel maximum. Steps where the ridge is weaker than
    min_val coast straight (occlusions: pointer, sign, numerals). Returns (N, 2) points and per-point strength."""
    p = np.array(p0, np.float64)
    t = unit(t0)
    f = feat if callable(feat) else (lambda P, n: sample(feat, P))
    pts, strength = [p.copy()], [float(f(p[None, :], perp(t))[0])]
    offs = np.arange(-win, win + 1e-6, 0.25)
    miss = 0
    for _ in range(max_steps):
        q = p + step * t
        n = perp(t)
        vals = f(q[None, :] + offs[:, None] * n[None, :], n)
        k = int(np.argmax(vals))
        if vals[k] < min_val or k == 0 or k == len(offs) - 1:
            miss += 1
            if miss > max_miss:
                break
            newp = q
            strength.append(float(vals[len(offs) // 2]))
        else:
            miss = 0
            a, b, c = vals[k - 1], vals[k], vals[k + 1]
            den = a - 2 * b + c
            sub = 0.5 * (a - c) / den if abs(den) > 1e-9 else 0.0
            off = offs[k] + 0.25 * float(np.clip(sub, -1, 1))
            newp = q + off * n
            strength.append(float(vals[k]))
        nt = unit(newp - p)
        t = unit(inertia * t + (1 - inertia) * nt)
        p = newp
        pts.append(p.copy())
        if stop is not None and stop(p):
            break
    return np.array(pts), np.array(strength)


def smooth_poly(pts, sigma=2.0):
    if len(pts) < 5 or sigma <= 0:
        return pts
    r = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.vstack([np.repeat(pts[:1], r, 0), pts, np.repeat(pts[-1:], r, 0)])
    out = np.stack([np.convolve(pad[:, i], k, mode="valid") for i in range(2)], 1)
    out[0], out[-1] = pts[0], pts[-1]
    return out


def resample(pts, step=1.0):
    pts = np.asarray(pts, np.float64)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] <= 0:
        return pts
    n = max(2, int(np.ceil(s[-1] / step)) + 1)
    si = np.linspace(0, s[-1], n)
    return np.stack([np.interp(si, s, pts[:, 0]), np.interp(si, s, pts[:, 1])], 1)


def arclen(pts):
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    return np.concatenate([[0], np.cumsum(seg)])


def snap(feat, pts, win=3.0, sigma=3.0, min_val=None):
    """Refine a polyline: move each vertex along its normal to the sub-pixel ridge of feat (+-win), smooth the
    offsets along the curve (robust), vertices with a weak ridge take interpolated offsets."""
    pts = resample(pts, 1.0)
    t = np.gradient(pts, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
    n = np.stack([-t[:, 1], t[:, 0]], 1)
    offs = np.arange(-win, win + 1e-6, 0.25)
    grid = pts[:, None, :] + offs[None, :, None] * n[:, None, :]
    vals = sample(feat, grid.reshape(-1, 2)).reshape(len(pts), len(offs))
    k = vals.argmax(1)
    best = vals[np.arange(len(pts)), k]
    off = offs[k]
    ok = (k > 0) & (k < len(offs) - 1)
    if min_val is not None:
        ok &= best >= min_val
    if ok.sum() < 3:
        return pts
    idx = np.arange(len(pts))
    off = np.interp(idx, idx[ok], off[ok])
    from scipy.ndimage import gaussian_filter1d, median_filter
    off = gaussian_filter1d(median_filter(off, 9, mode="nearest"), sigma, mode="nearest")
    return pts + off[:, None] * n


# ------------------------------------------------------------------------------------- curve coordinates
def curve_coords(pts, xs, ys, max_d=None):
    """Fast version: KD-tree on the polyline sampled every 0.25 px, then exact projection on the local tangent.
    Same outputs as curve_coords_exact (s, signed d, unsigned distance)."""
    from scipy.spatial import cKDTree
    pts = np.asarray(pts, np.float64)
    S0 = arclen(pts)
    n = max(2, int(np.ceil(S0[-1] / 0.25)) + 1)
    sd = np.linspace(0, S0[-1], n)
    dense = np.stack([np.interp(sd, S0, pts[:, 0]), np.interp(sd, S0, pts[:, 1])], 1)
    tang = np.gradient(dense, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-12
    P = np.stack([np.ravel(xs), np.ravel(ys)], 1).astype(np.float64)
    dist, idx = cKDTree(dense).query(P, distance_upper_bound=np.inf if max_d is None else max_d + 1)
    ok = np.isfinite(dist)
    idx = np.where(ok, idx, 0)
    diff = P - dense[idx]
    t = tang[idx]
    along = (diff * t).sum(1)
    s = sd[idx] + along
    at_end = ((idx == 0) & (along < 0)) | ((idx == n - 1) & (along > 0))
    s = np.clip(s, 0, S0[-1])
    nrm = np.stack([-t[:, 1], t[:, 0]], 1)
    d = (diff * nrm).sum(1)
    d = np.where(at_end, np.sign(d + 1e-9) * np.hypot(diff[:, 0], diff[:, 1]), d)
    dist = np.where(ok, np.hypot(diff[:, 0], diff[:, 1]), np.inf)
    shp = np.shape(xs)
    return s.reshape(shp), np.where(ok, d, np.inf).reshape(shp), dist.reshape(shp)


def curve_coords_exact(pts, xs, ys, max_d=None):
    """For pixel centres (xs, ys) (any equal shapes): arclength s of the nearest point on the polyline, signed
    distance d (positive on the LEFT of the direction of travel in image coordinates, i.e. along perp(t) =
    (-t_y, t_x)), unsigned distance. Ends are treated as segment ends (clamped)."""
    P = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)
    best = np.full(len(P), np.inf)
    s_out = np.zeros(len(P))
    d_out = np.zeros(len(P))
    S = arclen(pts)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        L2 = ab @ ab
        if L2 < 1e-12:
            continue
        u = np.clip(((P - a) @ ab) / L2, 0, 1)
        foot = a + u[:, None] * ab
        diff = P - foot
        dist = np.hypot(diff[:, 0], diff[:, 1])
        m = dist < best
        if not m.any():
            continue
        best[m] = dist[m]
        s_out[m] = S[i] + u[m] * np.sqrt(L2)
        nrm = np.array([-ab[1], ab[0]]) / np.sqrt(L2)
        d_out[m] = diff[m] @ nrm
    shp = np.shape(xs)
    return s_out.reshape(shp), d_out.reshape(shp), best.reshape(shp)


# ------------------------------------------------------------------------------------------ (s, d) tables
def table_fit(vals, s, d, s_edges, d_edges, valid, smooth_s=1.5, smooth_d=0.0, min_n=4, raw_only=False):
    """Robust (median) binned profile vals(s, d) -> (ns, nd, C) table; empty bins are filled by interpolation
    along s (then d), then smoothed with a Gaussian along s (bins) and optionally d."""
    from scipy.ndimage import gaussian_filter1d
    C = vals.shape[-1]
    ns, nd = len(s_edges) - 1, len(d_edges) - 1
    si = np.digitize(s[valid], s_edges) - 1
    di = np.digitize(d[valid], d_edges) - 1
    v = vals[valid]
    ok = (si >= 0) & (si < ns) & (di >= 0) & (di < nd)
    si, di, v = si[ok], di[ok], v[ok]
    T = np.full((ns, nd, C), np.nan, np.float64)
    key = si * nd + di
    order = np.argsort(key, kind="stable")
    key, v = key[order], v[order]
    starts = np.flatnonzero(np.r_[True, key[1:] != key[:-1]])
    ends = np.r_[starts[1:], len(key)]
    for a, b in zip(starts, ends):
        if b - a >= min_n:
            k = key[a]
            T[k // nd, k % nd] = np.median(v[a:b], axis=0)
    if raw_only:
        return T
    return table_fill(T, smooth_s, smooth_d)


def table_fill(T, smooth_s=1.5, smooth_d=0.0):
    """Fill the empty (NaN) bins of a raw table along s, then along d; smooth. -> (table, measured-bin mask)."""
    from scipy.ndimage import gaussian_filter1d
    T = np.array(T, np.float64)
    ns, nd, C = T.shape
    filled = ~np.isnan(T[..., 0])
    # fill along s per d column, then along d per s row
    for j in range(nd):
        m = filled[:, j]
        if m.sum() >= 1:
            for c in range(C):
                T[:, j, c] = np.interp(np.arange(ns), np.flatnonzero(m), T[m, j, c])
    filled2 = ~np.isnan(T[..., 0])
    for i in range(ns):
        m = filled2[i]
        if m.sum() >= 1:
            for c in range(C):
                T[i, :, c] = np.interp(np.arange(nd), np.flatnonzero(m), T[i, m, c])
    T = np.nan_to_num(T)
    if smooth_s > 0:
        T = gaussian_filter1d(T, smooth_s, axis=0, mode="nearest")
    if smooth_d > 0:
        T = gaussian_filter1d(T, smooth_d, axis=1, mode="nearest")
    return T, filled


def table_eval(T, s_edges, d_edges, s, d):
    """Bilinear lookup of a table at (s, d) using bin centres (clamped at the ends)."""
    sc = 0.5 * (np.asarray(s_edges[:-1]) + np.asarray(s_edges[1:]))
    dc = 0.5 * (np.asarray(d_edges[:-1]) + np.asarray(d_edges[1:]))
    fi = np.interp(s, sc, np.arange(len(sc)))
    fj = np.interp(d, dc, np.arange(len(dc)))
    i0 = np.clip(np.floor(fi).astype(int), 0, len(sc) - 1)
    j0 = np.clip(np.floor(fj).astype(int), 0, len(dc) - 1)
    i1 = np.minimum(i0 + 1, len(sc) - 1)
    j1 = np.minimum(j0 + 1, len(dc) - 1)
    a = (fi - i0)[..., None]
    b = (fj - j0)[..., None]
    T = np.asarray(T)
    return ((1 - a) * (1 - b) * T[i0, j0] + a * (1 - b) * T[i1, j0] + (1 - a) * b * T[i0, j1] + a * b * T[i1, j1])


# --------------------------------------------------------------------------------------------- raster
SS = 4


def poly_cov(shape, polys, ox=0.0, oy=0.0, scale=1, ss=SS):
    """Anti-aliased coverage (h, w) of filled polygon(s) given in panel px; raster pixel (i, j) covers panel
    [ox + j/scale, ox + (j+1)/scale] x [oy + i/scale, ...]."""
    h, w = shape
    big = np.zeros((h * ss, w * ss), np.uint8)
    sh = 4
    k = scale * ss * (1 << sh)
    cv2.fillPoly(big, [np.round((np.asarray(p, np.float64) - [ox, oy]) * k).astype(np.int32) for p in polys], 255,
                 lineType=cv2.LINE_8, shift=sh)
    return cv2.resize(big.astype(np.float32) / 255.0, (w, h), interpolation=cv2.INTER_AREA)


def stroke_cov(shape, polyline, width, x0=0, y0=0, ss=SS, closed=False, cap="round"):
    """Anti-aliased coverage of a stroked polyline of `width` px (round joins; caps round or butt)."""
    h, w = shape
    big = np.zeros((h * ss, w * ss), np.uint8)
    sh = 4
    p = np.round((np.asarray(polyline, np.float64) - [x0, y0]) * ss * (1 << sh)).astype(np.int32)
    th = max(1, int(round(width * ss)))
    if cap == "butt" and not closed:
        # thick round polyline, then cut the caps with half-planes at both ends
        cv2.polylines(big, [p], closed, 255, th, lineType=cv2.LINE_8, shift=sh)
        pts = np.asarray(polyline, np.float64)
        yy, xx = np.mgrid[0:h * ss, 0:w * ss]
        X = (xx + 0.5) / ss + x0
        Y = (yy + 0.5) / ss + y0
        for a, b in ((pts[0], pts[1]), (pts[-1], pts[-2])):
            t = unit(b - a)
            big[((X - a[0]) * t[0] + (Y - a[1]) * t[1]) < 0] = 0
    else:
        cv2.polylines(big, [p], closed, 255, th, lineType=cv2.LINE_8, shift=sh)
    return cv2.resize(big.astype(np.float32) / 255.0, (w, h), interpolation=cv2.INTER_AREA)


def over(dst_rgb, src_rgba):
    a = src_rgba[..., 3:4]
    return src_rgba[..., :3] * a + dst_rgb * (1 - a)


def lighter(dst_rgb, src_rgba):
    return np.clip(dst_rgb + src_rgba[..., :3] * src_rgba[..., 3:4], 0, 1)


def screen(dst_rgb, src_rgba):
    s = src_rgba[..., :3] * src_rgba[..., 3:4]
    return 1 - (1 - dst_rgb) * (1 - s)


def compose(layers, base=None):
    """layers: list of dicts {rgba (h,w,4) float straight alpha, x, y, scale, composite, opacity}; bottom to top.
    Upscaling (scale > 1) is bilinear on premultiplied colour, like a canvas drawImage."""
    out = np.zeros((H, W, 3), np.float32) if base is None else base.copy()
    for L in layers:
        img = L["rgba"]
        k = L.get("scale", 1)
        if k != 1:
            h, w = img.shape[:2]
            pm = np.concatenate([img[..., :3] * img[..., 3:4], img[..., 3:4]], -1)
            pm = cv2.resize(pm, (int(round(w * k)), int(round(h * k))), interpolation=cv2.INTER_LINEAR)
            a = pm[..., 3:4]
            img = np.concatenate([np.where(a > 1e-6, pm[..., :3] / np.maximum(a, 1e-6), 0), a], -1)
        x, y = int(round(L["x"])), int(round(L["y"]))
        h, w = img.shape[:2]
        X0, Y0, X1, Y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
        if X1 <= X0 or Y1 <= Y0:
            continue
        src = img[Y0 - y:Y1 - y, X0 - x:X1 - x].copy()
        src[..., 3] *= L.get("opacity", 1.0)
        dst = out[Y0:Y1, X0:X1]
        op = L.get("composite", "source-over")
        out[Y0:Y1, X0:X1] = {"source-over": over, "lighter": lighter, "screen": screen}[op](dst, src)
    return out
