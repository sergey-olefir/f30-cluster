"""Render every layer of package B from the measured parameters (params/*.json, *.npz) -- no photo is read here.

layers(look) -> list of layer dicts (rgba float straight alpha + placement + manifest fields).
"""
import numpy as np
from scipy.special import erf

import lib
import model
import numerals as nm
import render_soft as rs

SIGMA_CAM = 0.9      # blur of crisp shapes (px), matched to the frame/numeral edges of rect 08

COMMON = {"layer": "under", "lamp": None, "lit": None, "opacity": 1.0}


def P_crisp():
    return lib.read_json(lib.os.path.join(lib.PARAMS, "crisp.json"))


def box_profile(d, w, s):
    """Gaussian-blurred box of width w (alpha vs distance d from its centre line)."""
    k = 1.0 / (np.sqrt(2) * s)
    return 0.5 * (erf((w / 2 - d) * k) + erf((w / 2 + d) * k))


def canvas(x0, y0, x1, y1):
    ys, xs = np.mgrid[y0:y1, x0:x1]
    return xs + 0.5, ys + 0.5


def rgba(col, a):
    out = np.empty(a.shape + (4,), np.float32)
    out[..., :3] = np.asarray(col, np.float32)
    out[..., 3] = np.clip(a, 0, 1)
    return out


def crop(img, x, y, thr=1.5 / 255):
    a = img[..., 3]
    ys, xs = np.nonzero(a > thr)
    if len(xs) == 0:
        return img[:1, :1], x, y
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return img[y0:y1, x0:x1], x + x0, y + y0


# ----------------------------------------------------------------------------------------------- frame + ticks
def frame_alpha(geo, C, dial, look, X, Y):
    T = C["frame_table"][look][dial]
    F = np.array(geo["%s_frame" % dial], float)
    s, d, dist = lib.curve_coords(F, X, Y, max_d=14)
    if dial == "tacho":
        d = -d             # the tacho polyline runs the other way round: its left normal points outwards
    ok = np.isfinite(d) & (np.abs(d) < 12)
    a = np.zeros(X.shape, np.float32)
    a[ok] = lib.table_eval(np.array(T["alpha"])[..., None], np.array(T["s_edges"]), np.array(T["d"]), s[ok], d[ok])[..., 0]
    return a


def ticks_alpha(C, dial, X, Y):
    T = C["ticks"][dial]
    lens = np.array([t["len"] for t in T])
    major = lens > 13
    s = SIGMA_CAM
    # class sizes (medians), de-blurred: measured var = true^2/12 + sigma^2
    def true(v):
        return float(np.sqrt(max(v ** 2 - 12 * s * s, 1.0)))
    Lmaj, Lmin = true(np.median(lens[major])), true(np.median(lens[~major]))
    ws = np.array([t["w"] for t in T])
    Wmaj, Wmin = true(np.median(ws[major])), true(np.median(ws[~major]))
    a = np.zeros(X.shape, np.float32)
    for t, mj in zip(T, major):
        c, v = np.array(t["c"]), np.array(t["v"])
        L, Wd = (Lmaj, Wmaj) if mj else (Lmin, Wmin)
        dx, dy = X - c[0], Y - c[1]
        along = dx * v[0] + dy * v[1]
        perp = -dx * v[1] + dy * v[0]
        near = (np.abs(along) < L) & (np.abs(perp) < L)
        if not near.any():
            continue
        aa = box_profile(along[near], L, s) * box_profile(perp[near], Wd, s)
        a[near] = np.maximum(a[near], aa)
    return a, {"major": [Lmaj, Wmaj], "minor": [Lmin, Wmin], "n": [int(major.sum()), int((~major).sum())]}


# The slanted gap between the bottom frame line and the curved end next to the check-control area (polish C, from
# package B's seam list): 09 and 14 show a dark gap ~2.5 px wide, its centre line through (695.8, 646) leaning
# 0.6 px right per px down on the speedo (the tacho: mirrored, measured 1223.5 at y 646); the hook sits ~2 px higher.
GAP = {"p": (695.8, 646.0), "dxdy": 0.6, "half": 1.5}


def bottom_gap(geo, dial, X, Y, keep):
    """Alpha factor at the bottom line's gap by its hook: keep = 'line' keeps the frame line's side (towards the
    dial), 'hook' the curved end's side; each is cut at its edge of the gap. 1 away from the gap."""
    Xs = 2 * geo["mirror_axis_x"] - X if dial == "tacho" else X
    px, py = GAP["p"]
    n = np.array([1.0, -GAP["dxdy"]]) / np.hypot(1.0, GAP["dxdy"])      # normal of the gap's centre line
    sd = (Xs - px) * n[0] + (Y - py) * n[1]                             # > 0 on the hook's side (speedo space)
    if keep == "line":
        sd = -sd
    near = (np.abs(Y - py) < 14) & (np.abs(Xs - px) < 14)
    k = 1.0 / (np.sqrt(2) * SIGMA_CAM)
    cut = 0.5 * (1 + erf((sd - GAP["half"]) * k))
    return np.where(near, cut, 1.0).astype(np.float32)


def hook_path(P, run=5.0, ext=8.0):
    """The traced curved end, its first few px (the photo's rounded tip, where the trace bends) replaced by a
    straight run back along the tangent, so that the gap's slanted cut makes the end, as on the car."""
    P = np.asarray(P, float)
    i = int(np.argmax(np.abs(P[:, 0] - P[0, 0]) >= run))
    t = lib.unit(P[min(i + 4, len(P) - 1)] - P[i])
    return np.vstack([P[i] - ext * t, P[i:]])


def frame_layer(geo, C, dial, look):
    x0, y0, x1, y1 = model.BOX[dial]
    X, Y = canvas(x0, y0, x1, y1)
    a = frame_alpha(geo, C, dial, look, X, Y) * bottom_gap(geo, dial, X, Y, "line")
    t, info = ticks_alpha(C, dial, X, Y)
    a = np.maximum(a, t)
    col = C["frame_profile"][look]["colour"]
    img, x, y = crop(rgba(col, a), x0, y0)
    return img, x, y, info


# ----------------------------------------------------------------------------------------------- info lines
def para_poly(seg, yt, yb):
    return np.array([[seg["x0_top"], yt], [seg["x1_top"], yt], [seg["x1_bot"], yb], [seg["x0_bot"], yb]], float)


def soft_polys(polys, pad=6, blur=SIGMA_CAM):
    P = np.vstack(polys)
    x0, y0 = int(np.floor(P[:, 0].min())) - pad, int(np.floor(P[:, 1].min())) - pad
    x1, y1 = int(np.ceil(P[:, 0].max())) + pad, int(np.ceil(P[:, 1].max())) + pad
    a = lib.poly_cov((y1 - y0, x1 - x0), polys, ox=x0, oy=y0)
    if blur > 0:
        import cv2
        a = cv2.GaussianBlur(a, (0, 0), blur)
    return a, x0, y0


def info_line_layer(C, dial, look):
    L = C["info_lines" if look == "night" else "info_lines_09"][dial]
    # the measured segment ends are taken at the half-max rows; extend them to the half-max edges y_top/y_bot
    yt, yb = L["y_top"], L["y_bot"]
    r0, r1 = L["rows"]
    polys = []
    for sg in L["segments"]:
        kx0 = (sg["x0_bot"] - sg["x0_top"]) / max(r1 - r0, 1)
        kx1 = (sg["x1_bot"] - sg["x1_top"]) / max(r1 - r0, 1)
        q = {"x0_top": sg["x0_top"] - kx0 * (r0 + 0.5 - yt), "x0_bot": sg["x0_bot"] + kx0 * (yb - r1 - 0.5),
             "x1_top": sg["x1_top"] - kx1 * (r0 + 0.5 - yt), "x1_bot": sg["x1_bot"] + kx1 * (yb - r1 - 0.5)}
        polys.append(para_poly(q, yt + 0.5, yb - 0.5))
    a, x, y = soft_polys(polys)
    return rgba(L["colour"], a), x, y


# ----------------------------------------------------------------------------------------------- curved ends
def curved_end_layer(geo, C, dial, look, width=6.2):
    P = hook_path(C["curved_ends"][dial])
    x0, y0 = int(P[:, 0].min()) - 8, int(P[:, 1].min()) - 8
    x1, y1 = int(P[:, 0].max()) + 9, int(P[:, 1].max()) + 9
    X, Y = canvas(x0, y0, x1, y1)
    s, d, dist = lib.curve_coords(P, X, Y)
    a = box_profile(dist, width, SIGMA_CAM) * bottom_gap(geo, dial, X, Y, "hook")
    col = C["frame_profile"][look]["colour"]
    return crop(rgba(col, a), x0, y0)


# ----------------------------------------------------------------------------------------------- rev band
def rev_band_layer(C, look, rim=2.0):
    """Red segments: a lighter rim (~2 px, measured G 65-80 at the segment's top/bottom rows) round a deeper red
    core; edges fitted per column on the photo, separators at the red profile's minima (08)."""
    R = C["rev_band" if look == "night" else "rev_band_09"]
    ct, cb = R["top"], R["bot"]
    segs = [[1222.0, 1303.5], [1310.5, 1339.0], [1341.0, 1366.5], [1368.5, 1396.5]]

    def quads(inset):
        out = []
        for xa, xb in segs:
            xa, xb = xa + inset, xb - inset
            out.append(np.array([[xa, ct[0] + ct[1] * xa + inset], [xb, ct[0] + ct[1] * xb + inset],
                                 [xb, cb[0] + cb[1] * xb - inset], [xa, cb[0] + cb[1] * xa - inset]]))
        return out
    a_all, x, y = soft_polys(quads(0.0), blur=SIGMA_CAM)
    a_core, x2, y2 = soft_polys(quads(rim), blur=SIGMA_CAM, pad=6)
    core = np.zeros_like(a_all)
    core[y2 - y:y2 - y + a_core.shape[0], x2 - x:x2 - x + a_core.shape[1]] = a_core[:a_all.shape[0] - (y2 - y), :a_all.shape[1] - (x2 - x)]
    c_rim = np.array(R.get("rim_colour", [0.93, 0.27, 0.35]))
    c_core = np.array(R["colour"]) * 0.97
    col = c_rim[None, None, :] * (1 - core[..., None]) + c_core[None, None, :] * core[..., None]
    out = np.concatenate([col, a_all[..., None]], -1).astype(np.float32)
    return out, x, y


# ----------------------------------------------------------------------------------------------- numerals
def numeral_layers(look):
    N = lib.read_json(lib.os.path.join(lib.PARAMS, "numerals.json"))
    out = []
    for it in N["items"]:
        g = N["fit"]["unit" if it["text"] == "km/h" else "digits"]
        a, ax, ay, size = nm.place(it["text"], g["wght"], g["wdth"], it["ink_box"], blur=SIGMA_CAM)
        out.append((it, rgba(it["colour" if look == "night" else "colour_day"], a), ax, ay))
    return out, N
