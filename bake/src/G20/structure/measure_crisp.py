"""Crisp line work of the stock dials, measured on rect 08 / 09 -> params/crisp.json.

  frame_profile[look]   alpha across the frame line vs signed distance (0.25 px bins; + = towards the dial
                        inside), and the line colour (core median)
  frame_hooks           the short downward ends of the frames at the top (speedo right, tacho left)
  ticks[dial]           capsules (centre, direction, length, width) from intensity-weighted moments of each tick
                        on 08 and 09 (union: each photo hides some under a needle); the speedo's 0 tick, hidden
                        under its needle in every photo, is the mirror image of the tacho's 0 tick (09)
  info_lines            runs (x0, x1), centre y, thickness, slant of the cut ends
  curved_ends           centrelines of the bottom lines' curved ends next to the check-control area (09)
  rev_band              red segments: per-column top/bottom edges and the segment x ranges
"""
import cv2
import numpy as np

import lib
import model
from measure_geom import features, trace2


def frame_profile(im, frame, sel):
    F = frame[sel]
    t = np.gradient(F, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    n = np.stack([-t[:, 1], t[:, 0]], 1)
    ds = np.arange(-12, 12.01, 0.25)
    P = F[:, None, :] + ds[None, :, None] * n[:, None, :]
    V = np.stack([lib.sample(im[..., c], P.reshape(-1, 2)).reshape(len(F), len(ds)) for c in range(3)], -1)
    Lm = np.median(V.mean(-1), 0)
    k = int(np.argmax(Lm))
    peak = Lm[k]
    lo_l, lo_r = np.median(Lm[:12]), np.median(Lm[-12:])
    a = np.where(ds < ds[k], (Lm - lo_l) / (peak - lo_l), (Lm - lo_r) / (peak - lo_r))
    a = np.clip(a, 0, 1)
    a[:4] = 0
    a[-4:] = 0
    core = np.abs(ds - ds[k]) < 1.5
    col = np.median(V[:, core].reshape(-1, 3), 0)
    # which side is the dial inside? the frame polyline's left normal: check with the inside polygon later;
    # store the profile against the left normal of the polyline as given
    return {"d": ds.tolist(), "alpha": np.round(a, 4).tolist(), "colour": np.round(col, 4).tolist(),
            "peak_offset": float(ds[k])}


FT_D = np.arange(-12, 12.01, 0.25)
FT_S = 30.0


def frame_table(im, frame, flip):
    """Alpha of the frame line across it (signed distance, + = dial inside) per 30 px of arclength: the photo's
    line is sharp at the top and bottom and has a soft outer halo on the left/right flanks (the camera)."""
    F = np.asarray(frame, float)
    t = np.gradient(F, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    n = np.stack([-t[:, 1], t[:, 0]], 1) * (-1 if flip else 1)
    P = F[:, None, :] + FT_D[None, :, None] * n[:, None, :]
    L = lib.sample(im.mean(2), P.reshape(-1, 2)).reshape(len(F), len(FT_D))
    S = lib.arclen(F)
    edges = np.arange(0, S[-1] + FT_S, FT_S)
    els = lib.overlay_elements()
    bad = np.zeros(len(F), bool)
    for k in ("assist.speed_limit", "assist.cc_panel", "structure.speedo_needle", "structure.tacho_needle"):
        x0, y0, x1, y1 = els[k]["bbox"]
        bad |= (F[:, 0] > x0 - 6) & (F[:, 0] < x1 + 6) & (F[:, 1] > y0 - 6) & (F[:, 1] < y1 + 6)
    core = L[:, np.abs(FT_D) < 1.0].max(1)
    ok = ~bad & (core > 0.6)
    T = np.full((len(edges) - 1, len(FT_D)), np.nan)
    for i in range(len(edges) - 1):
        m = ok & (S >= edges[i]) & (S < edges[i + 1])
        if m.sum() < 5:
            continue
        prof = np.median(L[m], 0)
        k = int(np.argmax(prof))
        lo_l, lo_r = np.min(prof[:k + 1]), np.min(prof[k:])
        a = np.where(FT_D < FT_D[k], (prof - lo_l) / (prof[k] - lo_l), (prof - lo_r) / (prof[k] - lo_r))
        a = np.clip(a, 0, 1)
        # cut at the first minimum on each side (ticks / numerals beyond do not belong to the line)
        il = k - np.argmin(prof[k::-1]) if k > 0 else 0
        ir = k + np.argmin(prof[k:])
        a[:il] = 0
        a[ir + 1:] = 0
        T[i] = a
    good = ~np.isnan(T[:, 0])
    idx = np.arange(len(T))
    for j in range(len(FT_D)):
        T[:, j] = np.interp(idx, idx[good], T[good, j])
    from scipy.ndimage import gaussian_filter1d
    T = gaussian_filter1d(T, 0.7, axis=0, mode="nearest")
    return {"s_edges": edges.tolist(), "d": FT_D.tolist(), "alpha": np.round(T, 4).tolist(),
            "bins_measured": float(good.mean())}


def tick_capsules(im, frame, dial_box):
    mn = im.min(2)
    bgl = cv2.morphologyEx(mn, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    th = mn - bgl
    x0, y0, x1, y1 = dial_box
    sl = (slice(y0, y1), slice(x0, x1))
    Yg, Xg = np.mgrid[y0:y1, x0:x1] + 0.5
    s, d, dist = lib.curve_coords(frame, Xg, Yg)
    m = (th[sl] > 0.22) & (dist > 5.0) & (dist < 34)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    out = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a < 6 or a > 160 or max(w, h) > 24:
            continue
        win = (slice(max(0, y - 2), y + h + 2), slice(max(0, x - 2), x + w + 2))
        mm = cv2.dilate((lab[win] == i).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        sub = np.clip(th[sl][win], 0, None) * mm
        Xw, Yw = Xg[win], Yg[win]
        W = sub.sum()
        cx, cy = (sub * Xw).sum() / W, (sub * Yw).sum() / W
        cxx = (sub * (Xw - cx) ** 2).sum() / W
        cyy = (sub * (Yw - cy) ** 2).sum() / W
        cxy = (sub * (Xw - cx) * (Yw - cy)).sum() / W
        ev, evec = np.linalg.eigh(np.array([[cxx, cxy], [cxy, cyy]]))
        L = float(np.sqrt(12 * ev[1]))
        Wd = float(np.sqrt(12 * max(ev[0], 1e-6)))
        v = evec[:, 1]
        # keep ticks roughly normal to the frame
        _, _, _ = None, None, None
        fs, fd, fdist = lib.curve_coords(frame, np.array([cx]), np.array([cy]))
        k = int(np.argmin(np.linalg.norm(frame - [cx, cy], axis=1)))
        tf = frame[min(k + 1, len(frame) - 1)] - frame[max(k - 1, 0)]
        tf /= np.linalg.norm(tf) + 1e-9
        if abs(v @ tf) > 0.6 or not (5 < L < 24) or not (2.0 < Wd < 6.5):
            continue
        out.append({"c": [float(cx), float(cy)], "v": [float(v[0]), float(v[1])], "len": L, "w": Wd,
                    "s": float(fs[0]), "dist": float(fdist[0]), "peak": float(np.percentile(mn[win][mm], 90))})
    return out


def merge_ticks(a, b, tol=4.0):
    out = list(a)
    for t in b:
        if all(np.hypot(t["c"][0] - u["c"][0], t["c"][1] - u["c"][1]) > tol for u in out):
            t = dict(t)
            t["src"] = "09"
            out.append(t)
    return sorted(out, key=lambda t: t["s"])


def runs_on_line(mn, y0, y1, x0, x1, thr=0.55):
    b = mn[y0:y1, x0:x1]
    on = b.max(0) > thr
    runs, st = [], None
    for i, o in enumerate(on):
        if o and st is None:
            st = i
        if not o and st is not None:
            runs.append([x0 + st, x0 + i - 1])
            st = None
    if st is not None:
        runs.append([x0 + st, x0 + len(on) - 1])
    return runs


def edge_x(L, y, x_from, x_to, level):
    """Sub-pixel x where the row profile crosses `level` scanning from x_from towards x_to."""
    step = 1 if x_to > x_from else -1
    prev = L[y, x_from]
    for x in range(x_from + step, x_to, step):
        v = L[y, x]
        if (prev - level) * (v - level) <= 0 and prev != v:
            return x - step + step * (prev - level) / (prev - v)
        prev = v
    return float(x_to)


def info_lines(im):
    L = im.mean(2)
    mn = im.min(2)
    out = {}
    for name, (x0, x1) in (("speedo", (360, 705)), ("tacho", (1214, 1560))):
        runs = [r for r in runs_on_line(mn, 405, 425, x0, x1) if r[1] - r[0] > 20]
        prof = np.median(L[400:430, runs[0][0] + 10:runs[0][1] - 10], 1)
        k = int(np.argmax(prof))
        half = 0.5 * (prof[k] + np.median(prof[:6]))
        top = 400 + k - 1 + (prof[k - 1] - half) / (prof[k - 1] - prof[k]) if False else None
        ys = np.arange(400, 430)
        above = np.flatnonzero(prof[:k] < half)[-1]
        below = k + np.flatnonzero(prof[k:] < half)[0]
        yt = ys[above] + (half - prof[above]) / (prof[above + 1] - prof[above])
        yb = ys[below - 1] + (prof[below - 1] - half) / (prof[below - 1] - prof[below])
        segs = []
        for r in runs:
            lvl = 0.5 * prof[k]
            # end x at the line's top and bottom rows -> slant of the cut ends
            yt_i, yb_i = int(round(yt + 0.8)), int(round(yb - 0.8))
            xl_t = edge_x(L, yt_i, r[0] + 8, r[0] - 8, lvl)
            xl_b = edge_x(L, yb_i, r[0] + 8, r[0] - 8, lvl)
            xr_t = edge_x(L, yt_i, r[1] - 8, r[1] + 8, lvl)
            xr_b = edge_x(L, yb_i, r[1] - 8, r[1] + 8, lvl)
            segs.append({"x0_top": xl_t, "x0_bot": xl_b, "x1_top": xr_t, "x1_bot": xr_b})
        col = np.median(im[int(round(yt)) + 1:int(round(yb)), runs[0][0] + 10:runs[0][1] - 10].reshape(-1, 3), 0)
        out[name] = {"y_top": float(yt), "y_bot": float(yb), "rows": [yt_i, yb_i], "segments": segs,
                     "colour": np.round(col, 4).tolist(), "runs": runs}
    return out


def curved_end(im, F, p0, t0, stop_a, stop_b):
    pts = trace2(F["white"], F["white"], p0, t0, stop_a, stop_b, win=2.5, min_val=0.45, inertia=0.6, max_miss=2)
    return lib.smooth_poly(lib.resample(pts, 1.0), 1.5)


def rev_band(im, frame_tc):
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    red = R - np.maximum(G, B)
    x0, x1 = 1216, 1400
    cols = []
    for x in range(x0, x1):
        c = red[38:75, x]
        k = int(np.argmax(c))
        if c[k] < 0.25:
            cols.append(None)
            continue
        half = 0.5 * c[k]
        above = np.flatnonzero(c[:k] < half)
        below = np.flatnonzero(c[k:] < half)
        if len(above) == 0 or len(below) == 0:
            cols.append(None)
            continue
        a = above[-1]
        b = k + below[0]
        yt = 38 + a + (half - c[a]) / (c[a + 1] - c[a])
        yb = 38 + b - 1 + (c[b - 1] - half) / (c[b - 1] - c[b])
        cols.append((x + 0.5, yt, yb, float(c[k])))
    xs = np.array([c[0] for c in cols if c is not None])
    yt = np.array([c[1] for c in cols if c is not None])
    yb = np.array([c[2] for c in cols if c is not None])
    pk = np.array([c[3] for c in cols if c is not None])
    # straight-line fits of the edges (the band is straight, slanted like the frame there)
    A = np.stack([np.ones_like(xs), xs], 1)
    ct = np.linalg.lstsq(A, yt, rcond=None)[0]
    cb = np.linalg.lstsq(A, yb, rcond=None)[0]
    # segments: runs of columns with strong red, separated by gaps / white ticks
    strong = np.zeros(x1 - x0, bool)
    for c in cols:
        if c is not None and c[3] > 0.45:
            strong[int(c[0] - 0.5) - x0] = True
    segs, st = [], None
    for i, o in enumerate(strong):
        if o and st is None:
            st = i
        if not o and st is not None:
            if i - st > 6:
                segs.append([x0 + st, x0 + i])
            st = None
    if st is not None and len(strong) - st > 6:
        segs.append([x0 + st, x1])
    inner = np.median(im[[int(round((ct[0] + ct[1] * x + cb[0] + cb[1] * x) / 2)) for x in xs.astype(int)],
                         xs.astype(int)], 0)
    return {"top": ct.tolist(), "bot": cb.tolist(), "segments": segs, "colour": np.round(inner, 4).tolist(),
            "peak_red": float(np.median(pk))}


def measure():
    geo = model.geometry()
    im8, im9 = lib.load_rect("08"), lib.load_rect("09")
    F8, F9 = features(im8), features(im9)
    out = {"about": __doc__.strip().splitlines()[0]}
    spF = np.array(geo["speedo_frame"])
    tcF = np.array(geo["tacho_frame"])
    sel = (spF[:, 1] > 90) & (spF[:, 1] < 600)
    out["frame_profile"] = {"night": frame_profile(im8, spF, sel), "day": frame_profile(im9, spF, sel)}
    out["frame_table"] = {look: {"speedo": frame_table(im, spF, False), "tacho": frame_table(im, tcF, True)}
                          for look, im in (("night", im8), ("day", im9))}
    # which side of the speedo frame polyline is the inside? (left normal of travel): sample the wing side
    D = model.Dial(geo, "speedo")
    out["frame_left_is_inside"] = bool(np.median(D.inside[(D.distF < 15) & (D.dF > 3)]) > 0.5) if False else None
    # hooks: continue the frames downward from their top ends
    hooks = {}
    for name, F, end in (("speedo", F8, spF[-1]), ("tacho", F8, tcF[-1])):
        h, _ = lib.track(F["white"], end, (0, 1), step=1.0, win=2.0, min_val=0.45, max_miss=1, max_steps=40)
        hooks[name] = lib.smooth_poly(h, 1.0).round(2).tolist()
    out["frame_hooks"] = hooks
    boxes = {"speedo": (60, 25, 712, 664), "tacho": (1207, 25, 1860, 664)}
    ticks = {}
    for dial, F in (("speedo", spF), ("tacho", tcF)):
        t8 = tick_capsules(im8, F, boxes[dial])
        t9 = tick_capsules(im9, F, boxes[dial])
        ticks[dial] = merge_ticks(t8, t9)
    # the speedo's 0 tick: mirror of the tacho's 0 tick (the tick nearest the mirrored needle foot)
    a = geo["mirror_axis_x"]
    foot = np.array([2 * a - 373.0, 638.0])
    t0 = min(ticks["tacho"], key=lambda t: np.hypot(t["c"][0] - foot[0], t["c"][1] - foot[1]))
    m0 = dict(t0)
    m0["c"] = [2 * a - t0["c"][0], t0["c"][1]]
    m0["v"] = [-t0["v"][0], t0["v"][1]]
    m0["src"] = "mirror of the tacho 0 tick (09)"
    if all(np.hypot(m0["c"][0] - u["c"][0], m0["c"][1] - u["c"][1]) > 4 for u in ticks["speedo"]):
        ticks["speedo"].append(m0)
    out["ticks"] = ticks
    out["info_lines"] = info_lines(im8)
    out["info_lines_09"] = info_lines(im9)
    sp_end = curved_end(im9, F9, (722.0, 643.5), (1, -0.25), lambda p: p[1] < 612, lambda p: p[0] < 698)
    tc_end = curved_end(im9, F9, (2 * a - 722.0, 643.5), (-1, -0.25), lambda p: p[1] < 612, lambda p: p[0] > 2 * a - 698)
    out["curved_ends"] = {"speedo": sp_end.round(2).tolist(), "tacho": tc_end.round(2).tolist()}
    out["rev_band"] = rev_band(im8, tcF)
    out["rev_band_09"] = rev_band(im9, tcF)
    lib.write_json(lib.os.path.join(lib.PARAMS, "crisp.json"), out)
    return out


if __name__ == "__main__":
    o = measure()
    print("ticks", {k: len(v) for k, v in o["ticks"].items()})
    print("hooks", {k: (v[0], v[-1], len(v)) for k, v in o["frame_hooks"].items()})
    print("info", o["info_lines"])
    print("ends", {k: (v[0], v[-1], len(v)) for k, v in o["curved_ends"].items()})
    print("rev", o["rev_band"])
    print("frame", {k: (v["colour"], v["peak_offset"]) for k, v in o["frame_profile"].items()})
