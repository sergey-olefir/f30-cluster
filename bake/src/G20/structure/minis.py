"""The two stock minis (fuel left, oil temperature right): frame with its coloured zones, the grey level fill with
its dark scale lines, numerals 1 / 1/2 / 0, the pump and the car icons. No needles (package D).

The minis are mirror images about the dials' axis (measured: the oil frame mirrored lands on the fuel frame), so
one centreline in fuel space is snapped to both photos at once; colours and zones are per mini.

The fill (light grey gradient between the frame and the needle) is a LEVEL BAR: it runs from the scale's empty end
up to the needle (fuel 08/09/14: needle near full, fill seen whole; oil: fill below the needle only). It is baked
as the full sweep and must be clipped at the needle (manifest 'clip').
"""
import cv2
import numpy as np

import lib
import numerals as nm
from measure_geom import catmull, snap_sym

FRAME_UP = [(82, 441.5), (60, 441.5), (40, 444), (27, 451), (17, 462), (11, 476), (9, 492), (9.5, 510), (12, 528),
            (17, 545), (25, 560), (35, 572), (42, 578)]
FRAME_LO = [(44, 586), (53, 599), (64, 613), (77, 626), (92, 637), (108, 645), (122, 648.5), (145, 650),
            (168, 648.5), (188, 644.5), (207, 639.5)]
FILL_D = np.r_[np.arange(-2, 10, 0.5), np.arange(10, 30, 1.0), np.arange(30, 130.01, 4.0)]
NEEDLE_CORRIDOR = 7.0
INNER_OFF, INNER_W = 13.0, 3.4     # the fill's inner border line: offset from the outer frame, width (08)
SIGMA = 0.9


def mirror_x(p, axis):
    p = np.array(p, float).copy()
    p[..., 0] = 2 * axis - p[..., 0]
    return p


def needle_line(im, mini, paths=None):
    """The red mini needle in a photo (for masks and for clipping the fill in QC). Red pixels of the frame's own
    zones are excluded by their distance to the frame paths."""
    if paths is None:
        J = lib.read_json(lib.os.path.join(lib.PARAMS, "minis.json"))
        paths = [np.array(J["frame_up"]), np.array(J["frame_lo"])] if mini == "fuel" else \
            [np.array(J["oil_frame_up"]), np.array(J["oil_frame_lo"])]
    box = (5, 440, 215, 652) if mini == "fuel" else (1705, 440, 1915, 652)
    x0, y0, x1, y1 = box
    c = im[y0:y1, x0:x1]
    m = (c[..., 0] > 0.7) & (c[..., 0] - np.maximum(c[..., 1], c[..., 2]) > 0.3)
    Yg, Xg = np.mgrid[y0:y1, x0:x1] + 0.5
    for P in paths:
        _, _, dist = lib.curve_coords(P, Xg, Yg, max_d=12)
        m &= ~(dist < 8)
    # not the big dial next to it (its red band glow)
    geo = lib.read_json(lib.os.path.join(lib.PARAMS, "geometry.json"))
    F = np.array(geo["speedo_frame" if mini == "fuel" else "tacho_frame"])
    inside = lib.poly_cov(m.shape, [F], ox=x0, oy=y0) > 0.01
    _, _, fd = lib.curve_coords(F, Xg, Yg, max_d=14)
    m &= ~inside & ~(fd < 10)
    ys, xs = np.nonzero(m)
    if len(xs) < 25:
        return None
    pts = np.stack([xs + x0 + 0.5, ys + y0 + 0.5], 1).astype(np.float32)
    vx, vy, cx, cy = cv2.fitLine(pts, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    t = (pts - [cx, cy]) @ np.array([vx, vy])
    a = np.array([cx, cy]) + np.percentile(t, 1) * np.array([vx, vy])
    b = np.array([cx, cy]) + np.percentile(t, 99) * np.array([vx, vy])
    return [a.tolist(), b.tolist()]


def measure():
    geo = lib.read_json(lib.os.path.join(lib.PARAMS, "geometry.json"))
    axis = geo["mirror_axis_x"]
    im8, im9 = lib.load_rect("08"), lib.load_rect("09")
    mx = cv2.GaussianBlur(im8.max(2), (0, 0), 1.0)
    # mask: numerals, needles, icons
    M = np.zeros(mx.shape, np.float32)
    up, lo = track_frame(mx, "fuel", axis)
    oup, olo = track_frame(mx, "oil", axis)
    nd = {"fuel": needle_line(im8, "fuel", [up, lo]), "oil": needle_line(im8, "oil", [oup, olo])}
    for k, (a, b) in nd.items():
        cv2.line(M, tuple(int(v) for v in a), tuple(int(v) for v in b), 1.0, 16)
    M = cv2.GaussianBlur(M, (0, 0), 1.0)
    out = {"axis": axis, "frame_up": up.round(2).tolist(), "frame_lo": lo.round(2).tolist(),
           "oil_frame_up": oup.round(2).tolist(), "oil_frame_lo": olo.round(2).tolist(),
           "needles_08": nd, "needles_09": {"fuel": needle_line(im9, "fuel", [up, lo]), "oil": needle_line(im9, "oil", [oup, olo])}}
    # colours along the path per mini, per look -> pieces
    pieces = {}
    for look, im in (("night", im8), ("day", im9)):
        for mini in ("fuel", "oil"):
            res = []
            for name, P in (("up", up), ("lo", lo)):
                Q = P if mini == "fuel" else {"up": oup, "lo": olo}[name]
                col = np.stack([lib.sample(cv2.GaussianBlur(im[..., c], (0, 0), 1.0), Q) for c in range(3)], 1)
                red = col[:, 0] - np.maximum(col[:, 1], col[:, 2]) > 0.25
                blue = col[:, 2] - col[:, 0] > 0.2
                cls = np.where(red, "red", np.where(blue, "blue", "white"))
                # smooth class changes (median of 9)
                k = np.array([{"white": 0, "red": 1, "blue": 2}[c] for c in cls])
                from scipy.ndimage import median_filter
                k = median_filter(k, 9, mode="nearest")
                i = 0
                while i < len(k):
                    j = i
                    while j < len(k) and k[j] == k[i]:
                        j += 1
                    if j - i >= 4:
                        c = np.median(col[i:j][np.abs(np.arange(i, j) - (i + j) / 2) < (j - i) / 2 - 1], 0)
                        res.append({"path": name, "i0": int(i), "i1": int(j), "kind": ["white", "red", "blue"][k[i]],
                                    "colour": np.round(c, 4).tolist()})
                    i = j
            pieces["%s_%s" % (mini, look)] = res
    out["pieces"] = pieces
    # stroke width of the white frame (moments across the path on 08, fuel upper part)
    out["width"] = stroke_width(im8, up[10:-10])
    # dark scale lines across the fill (per mini, on 08)
    out["dark_lines"] = {}
    for mini, ax in (("fuel", None), ("oil", axis)):
        a, b = np.array(nd[mini][0]), np.array(nd[mini][1])
        keep = []
        for ln in dark_lines(im8, up, lo, ax):
            mid = 0.5 * (np.array(ln["a"]) + np.array(ln["b"]))
            ab = b - a
            u = np.clip((mid - a) @ ab / (ab @ ab), 0, 1)
            if np.linalg.norm(mid - a - u * ab) > 12:
                keep.append(ln)
        out["dark_lines"][mini] = keep
    # numerals of the fuel mini
    nums = []
    for text, box in (("1", (58, 432, 80, 466)), ("½", (64, 548, 100, 582)), ("0", (168, 598, 194, 628))):
        ink, bb, col = nm.measure_ink(im8, box)
        _, _, col9 = nm.measure_ink(im9, box)
        nums.append({"text": text, "box": list(box), "ink_box": [int(v) for v in bb], "colour": np.round(col, 4).tolist(),
                     "colour_day": np.round(col9, 4).tolist()})
    out["numerals"] = nums
    # icons: ink boxes and colours (the drawings are ours, scaled to these boxes)
    icons = {}
    for name, box in (("pump", (10, 598, 62, 642)), ("car", (1850, 596, 1910, 636))):
        x0, y0, x1, y1 = box
        c = im8[y0:y1, x0:x1]
        mn = c.min(2)
        m = mn > 0.5 * (np.percentile(mn, 99) + np.percentile(mn, 10))
        ys, xs = np.nonzero(m)
        c9 = im9[y0:y1, x0:x1]
        icons[name] = {"ink_box": [int(x0 + xs.min()), int(y0 + ys.min()), int(x0 + xs.max() + 1), int(y0 + ys.max() + 1)],
                       "colour": np.round(np.median(c[m], 0), 4).tolist(),
                       "colour_day": np.round(np.median(c9[m], 0), 4).tolist()}
    out["icons"] = icons
    # the fill tables (night 08, day 09): RGB(s along the frame, inward distance), both minis
    for look, im in (("night", im8), ("day", im9)):
        T, info = fit_fill(im, up, lo, axis, out["needles_08" if look == "night" else "needles_09"])
        np.save(lib.os.path.join(lib.PARAMS, "minifill_%s.npy" % look), T)
        out["fill_%s" % look] = info
    lib.write_json(lib.os.path.join(lib.PARAMS, "minis.json"), out)
    return out


def track_frame(mx, mini, axis):
    """Ridge-track the mini's outer frame line (max channel: white, red and blue parts alike) in two pieces,
    above and below the notch at 1/2."""
    from measure_geom import trace2
    def X(x):
        return x if mini == "fuel" else 2 * axis - x
    sgn = 1 if mini == "fuel" else -1
    up = trace2(mx, mx, (X(12.5), 490.0), (0, -1), lambda p: (p[0] - X(84)) * sgn > 0 or p[1] < 430,
                lambda p: p[1] > 579, win=2.0, min_val=0.35, inertia=0.6, max_miss=3)
    lo = trace2(mx, mx, (X(59.5), 600.0), (0.6 * sgn, 0.8), lambda p: (p[0] - X(208)) * sgn > 0,
                lambda p: p[1] < 582, win=2.0, min_val=0.35, inertia=0.6, max_miss=3)
    up = lib.smooth_poly(lib.resample(up, 1.0), 1.5)
    lo = lib.smooth_poly(lib.resample(lo, 1.0), 1.5)
    # common orientation: from the top end of the scale towards the bottom end
    if up[0, 1] > up[-1, 1]:
        up = up[::-1]
    if lo[0, 1] > lo[-1, 1]:
        lo = lo[::-1]
    return up, lo


def stroke_width(im, P):
    t = np.gradient(P, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    n = np.stack([-t[:, 1], t[:, 0]], 1)
    ds = np.arange(-8, 8.01, 0.25)
    G = P[:, None, :] + ds[None, :, None] * n[:, None, :]
    v = lib.sample(im.min(2), G.reshape(-1, 2)).reshape(len(P), len(ds))
    prof = np.median(v, 0)
    k = int(np.argmax(prof))
    il = k - int(np.argmin(prof[k::-1]))
    ir = k + int(np.argmin(prof[k:]))
    half_l = 0.5 * (prof[k] + prof[il])
    half_r = 0.5 * (prof[k] + prof[ir])
    xl = np.interp(half_l, prof[il:k + 1], ds[il:k + 1])
    xr = np.interp(-half_r, -prof[k:ir + 1], ds[k:ir + 1])
    return float(xr - xl)          # FWHM ~ the drawn width for a blur sigma well below it


def full_path(up, lo):
    """Reference curve of the fill: the outer frame (upper + lower piece) smoothed over the notch."""
    return lib.smooth_poly(lib.resample(np.vstack([up, lo]), 1.0), 10.0)


def dark_lines(im, up, lo, axis):
    """Thin dark lines across the fill: black-hat of luminance inside the mini, components fitted by lines."""
    L = cv2.GaussianBlur(im.mean(2), (0, 0), 0.7)
    bh = cv2.morphologyEx(L, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) - L
    box = (12, 480, 215, 650)
    if axis is not None:
        x0, x1 = int(2 * axis - box[2]), int(2 * axis - box[0])
        box = (x0, box[1], x1, box[3])
    x0, y0, x1, y1 = box
    m = (bh[y0:y1, x0:x1] > 0.035).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    lines = []
    for i in range(1, n):
        if st[i, 4] < 25 or max(st[i, 2], st[i, 3]) < 25:
            continue
        ys, xs = np.nonzero(lab == i)
        pts = np.stack([xs + x0 + 0.5, ys + y0 + 0.5], 1).astype(np.float32)
        vx, vy, cx, cy = cv2.fitLine(pts, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        if abs(vy) > 0.6:      # the scale lines run across, not along, the mini
            continue
        tt = (pts - [cx, cy]) @ np.array([vx, vy])
        resid = np.abs((pts - [cx, cy]) @ np.array([-vy, vx]))
        if np.median(resid) > 1.2:
            continue
        a = np.array([cx, cy]) + tt.min() * np.array([vx, vy])
        b = np.array([cx, cy]) + tt.max() * np.array([vx, vy])
        depth = float(np.median(bh[(pts[:, 1]).astype(int), (pts[:, 0]).astype(int)]))
        lines.append({"a": a.tolist(), "b": b.tolist(), "depth": depth})
    return lines


def fill_coords(up, lo, X, Y, axis=None, mini="fuel"):
    P = full_path(up, lo)
    Xs = X if mini == "fuel" else 2 * axis - X
    s, d, dist = lib.curve_coords(P, Xs, Y)
    # inward = towards the dial (right of the fuel mini): make d > 0 there
    return s, d, dist, P


def fit_fill(im, up, lo, axis, needles):
    P = full_path(up, lo)
    S = lib.arclen(P)[-1]
    s_edges = np.arange(0, S + 6, 6.0)
    vals, ss, dd, valid = [], [], [], []
    info = {}
    for mini, box in (("fuel", (0, 430, 230, 660)), ("oil", (1690, 430, 1920, 660))):
        x0, y0, x1, y1 = box
        Yg, Xg = np.mgrid[y0:y1, x0:x1] + 0.5
        s, d, dist, _ = fill_coords(up, lo, Xg, Yg, axis, mini)
        # orientation: inward (towards the big dial) positive
        probe = (Xg > (110 if mini == "fuel" else 1810)) & (Xg < (130 if mini == "fuel" else 1830)) & (Yg > 560) & (Yg < 600)
        if np.median(d[probe]) < 0:
            d = -d
        c = im[y0:y1, x0:x1]
        mn = c.min(2)
        crisp = cv2.dilate(((mn - cv2.morphologyEx(mn, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))) > 0.08).astype(np.uint8),
                           np.ones((5, 5), np.uint8)) > 0
        L = c.mean(2)
        bh = cv2.morphologyEx(L, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) - L
        crisp |= cv2.dilate((bh > 0.03).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        a, b = np.array(needles[mini][0]), np.array(needles[mini][1])
        ab = b - a
        u = np.clip(((Xg - a[0]) * ab[0] + (Yg - a[1]) * ab[1]) / (ab @ ab), 0, 1)
        nd = np.hypot(Xg - a[0] - u * ab[0], Yg - a[1] - u * ab[1])
        # the side of the needle line that holds the fill (the empty end = the bottom of the scale)
        side = (Xg - a[0]) * (-ab[1]) + (Yg - a[1]) * ab[0]
        below = np.sign(side) == np.sign(np.median(side[(Yg > 630) & (Yg < 640) & (np.abs(Xg - (100 if mini == "fuel" else 1820)) < 10)]))
        v = (d > -1) & (d < 130) & ~crisp & (nd > 9) & below
        # keep away from the big dial's frame halo
        geo = lib.read_json(lib.os.path.join(lib.PARAMS, "geometry.json"))
        F = np.array(geo["speedo_frame" if mini == "fuel" else "tacho_frame"])
        _, _, fd = lib.curve_coords(F, Xg, Yg, max_d=30)
        v &= ~(fd < 16)
        vals.append(c[v])
        ss.append(s[v])
        dd.append(d[v])
        info[mini] = int(v.sum())
    vals, ss, dd = np.vstack(vals), np.concatenate(ss), np.concatenate(dd)
    T, filled = lib.table_fit(vals, ss, dd, s_edges, FILL_D, np.ones(len(ss), bool), smooth_s=1.5, smooth_d=0.5)
    info["filled"] = float(filled.mean())
    info["s_edges"] = [0.0, float(S), 6.0]
    return T, info


# --------------------------------------------------------------------------------------------- rendering
def _canvas(box):
    x0, y0, x1, y1 = box
    Yg, Xg = np.mgrid[y0:y1, x0:x1] + 0.5
    return Xg, Yg


def box_profile(d, w, s=SIGMA):
    from scipy.special import erf
    k = 1.0 / (np.sqrt(2) * s)
    return 0.5 * (erf((w / 2 - d) * k) + erf((w / 2 + d) * k))


def layers(look):
    """-> list of (manifest entry, rgba, dither) for both minis."""
    from build import entry
    J = lib.read_json(lib.os.path.join(lib.PARAMS, "minis.json"))
    T = np.load(lib.os.path.join(lib.PARAMS, "minifill_%s.npy" % look))
    axis = J["axis"]
    up, lo = np.array(J["frame_up"]), np.array(J["frame_lo"])
    P = full_path(up, lo)
    S = lib.arclen(P)
    s_edges = np.arange(0, J["fill_%s" % look]["s_edges"][1] + 6, 6.0)
    out = []
    for mini, box in (("fuel", (0, 428, 226, 662)), ("oil", (1693, 428, 1920, 662))):
        X, Y = _canvas(box)
        s, d, dist, _ = fill_coords(up, lo, X, Y, axis, mini)
        probe = (X > (110 if mini == "fuel" else 1810)) & (X < (130 if mini == "fuel" else 1830)) & (Y > 560) & (Y < 600)
        if np.median(d[probe]) < 0:
            d = -d
        # ---- fill (full sweep): inside the frame's inner side, out to where the table fades
        col = np.clip(lib.table_eval(T, s_edges, FILL_D, s, np.clip(d, -2, 130)), 0, 1)
        lum = col.mean(-1)
        a = np.clip((d - 2.0) / 1.5, 0, 1) * np.clip((s - 4) / 4, 0, 1) * np.clip((S[-1] - 2 - s) / 4, 0, 1)
        # along the frame only (not past its ends: the path's end segments clamp s)
        a *= (dist < 135)
        # dark scale lines on the fill (multiply-like: darken the fill colour)
        for ln in J["dark_lines"][mini]:
            pa, pb = np.array(ln["a"]), np.array(ln["b"])
            ab = pb - pa
            u = np.clip(((X - pa[0]) * ab[0] + (Y - pa[1]) * ab[1]) / (ab @ ab), 0, 1)
            nd = np.hypot(X - pa[0] - u * ab[0], Y - pa[1] - u * ab[1])
            dk = box_profile(nd, 1.6) * np.clip(ln["depth"] / max(lum.mean(), 0.05) * 1.6, 0, 0.8)
            col = col * (1 - dk[..., None])
        # the fill's inner border line (white, 13 px inside the outer frame, measured on 08); part of the fill
        cen = np.array([110.0, 560.0]) if mini == "fuel" else np.array([2 * axis - 110.0, 560.0])
        paths = (up, lo) if mini == "fuel" else (np.array(J["oil_frame_up"]), np.array(J["oil_frame_lo"]))
        for path in paths:
            t = np.gradient(path, axis=0)
            t /= np.linalg.norm(t, axis=1, keepdims=True)
            nrm = np.stack([-t[:, 1], t[:, 0]], 1)
            mid = len(path) // 2
            sgn = 1.0 if np.linalg.norm(path[mid] + 13 * nrm[mid] - cen) < np.linalg.norm(path[mid] - 13 * nrm[mid] - cen) else -1.0
            inner = lib.smooth_poly(path + sgn * INNER_OFF * nrm, 2.0)
            _, _, di = lib.curve_coords(inner, X, Y, max_d=8)
            al = box_profile(np.where(np.isfinite(di), di, 99), INNER_W)
            whites = [p for p in J["pieces"]["%s_%s" % (mini, look)] if p["kind"] == "white" and max(p["colour"]) > 0.5]
            ic = np.array(max(whites, key=lambda p: p["i1"] - p["i0"])["colour"]) * 0.92
            col = col * (1 - al[..., None]) + ic * al[..., None]
            a = np.maximum(a, al)
        fill = np.concatenate([col, a[..., None]], -1).astype(np.float32)
        img, x, y = _crop(fill, box[0], box[1])
        nd_photo = J["needles_08" if look == "night" else "needles_09"][mini]
        out.append((entry("structure.%s_mini.fill.%s" % (mini, look), "structure.%s_mini" % mini,
                          "%s_mini.fill.%s.png" % (mini, look), x, y, 26, "albedo", look,
                          evidence="medium" if mini == "fuel" else "weak",
                          notes=("Level fill (grey gradient + dark scale lines), FULL SWEEP: clip it to the side of "
                                 "the %s needle towards the scale's empty end (bottom). Fuel: seen whole (needle near "
                                 "full in 08/09/14). Oil: only its part below the needle is seen; the rest is the "
                                 "fuel fill's mirror image (symmetric fit)." % mini),
                          clip={"by": "%s_needle" % mini, "keep": "empty_end_side", "photo_needle": nd_photo}),
                    img, True))
        # ---- frame strokes with zones
        X2, Y2 = _canvas(box)
        acc = np.zeros(X2.shape + (4,), np.float32)
        for pc in J["pieces"]["%s_%s" % (mini, look)]:
            if mini == "fuel":
                path = up if pc["path"] == "up" else lo
            else:
                path = np.array(J["oil_frame_up"] if pc["path"] == "up" else J["oil_frame_lo"])
            seg = path[max(0, pc["i0"] - 1):pc["i1"] + 1]
            if max(pc["colour"]) < 0.3:
                continue
            if len(seg) < 2:
                continue
            _, _, dd = lib.curve_coords(seg, X2, Y2, max_d=10)
            w = J["width"] * (1.25 if pc["kind"] != "white" else 1.0)
            aa = box_profile(np.where(np.isfinite(dd), dd, 99), w)
            m = aa > acc[..., 3]
            acc[m, :3] = pc["colour"]
            acc[..., 3] = np.maximum(acc[..., 3], aa)
        # ---- numerals (fuel) and icons
        if mini == "fuel":
            for it in J["numerals"]:
                al, ax, ay, _ = nm.place(it["text"], 550, 100, it["ink_box"], blur=SIGMA)
                _paste(acc, al, ax - box[0], ay - box[1], it["colour" if look == "night" else "colour_day"])
            ic = J["icons"]["pump"]
            _paste(acc, pump_icon(ic["ink_box"]), ic["ink_box"][0] - 3 - box[0], ic["ink_box"][1] - 3 - box[1],
                   ic["colour" if look == "night" else "colour_day"])
        else:
            ic = J["icons"]["car"]
            _paste(acc, car_icon(ic["ink_box"]), ic["ink_box"][0] - 3 - box[0], ic["ink_box"][1] - 3 - box[1],
                   ic["colour" if look == "night" else "colour_day"])
        img, x, y = _crop(acc, box[0], box[1])
        out.append((entry("structure.%s_mini.%s" % (mini, look), "structure.%s_mini" % mini,
                          "%s_mini.%s.png" % (mini, look), x, y, 34, "albedo", look, evidence="strong",
                          notes=("Frame with its zones (%s), %s. Our own vector icon fitted to the ink box "
                                 "(medium: a simplified drawing)." % (
                                     "white + red reserve" if mini == "fuel" else "red top, white, blue bottom",
                                     "numerals 1 / 1/2 / 0 and the pump icon" if mini == "fuel" else "the car/thermometer icon"))),
                    img, False))
    return out


def _crop(img, x, y, thr=1.5 / 255):
    ys, xs = np.nonzero(img[..., 3] > thr)
    return img[ys.min():ys.max() + 1, xs.min():xs.max() + 1], x + xs.min(), y + ys.min()


def _paste(acc, al, x, y, col):
    h, w = al.shape
    H, W = acc.shape[:2]
    sx0, sy0 = max(0, -x), max(0, -y)
    dx0, dy0 = max(0, x), max(0, y)
    hh, ww = min(h - sy0, H - dy0), min(w - sx0, W - dx0)
    if hh <= 0 or ww <= 0:
        return
    a = al[sy0:sy0 + hh, sx0:sx0 + ww]
    sl = acc[dy0:dy0 + hh, dx0:dx0 + ww]
    m = a > sl[..., 3]
    sl[m, :3] = col
    sl[..., 3] = np.maximum(sl[..., 3], a)


def _icon_canvas(bb, draw, ss=8):
    """Draw a vector icon in a unit box mapped to the ink box bb, at ss supersampling; returns alpha with a 3 px
    margin around bb."""
    x0, y0, x1, y1 = bb
    w, h = x1 - x0, y1 - y0
    W, H = (w + 6) * ss, (h + 6) * ss
    img = np.zeros((H, W), np.uint8)

    def P(u, v):
        return (int(round((3 + u * w) * ss)), int(round((3 + v * h) * ss)))
    draw(img, P, ss, w, h)
    a = cv2.resize(img.astype(np.float32) / 255.0, (w + 6, h + 6), interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(a, (0, 0), SIGMA)


def pump_icon(bb):
    """Fuel pump: body with a dark window, a hose on the right, a base; then the small triangle (filler side).
    Proportions read off rect 08 (ink box ~ 46 x 34 px)."""
    def draw(img, P, ss, w, h):
        cv2.rectangle(img, P(0.06, 0.12), P(0.48, 0.94), 255, -1)                       # body
        cv2.rectangle(img, P(0.14, 0.22), P(0.40, 0.48), 0, -1)                         # window
        cv2.rectangle(img, P(0.00, 0.90), P(0.54, 1.00), 255, -1)                       # base
        pts = np.array([P(0.48, 0.30), P(0.62, 0.42), P(0.62, 0.86), P(0.56, 0.92)], np.int32)
        cv2.polylines(img, [pts], False, 255, max(1, int(0.055 * w * ss)))               # hose
        tri = np.array([P(0.72, 0.52), P(1.00, 0.70), P(0.72, 0.88)], np.int32)
        cv2.fillPoly(img, [tri], 255)                                                   # triangle
    return _icon_canvas(bb, draw)


def car_icon(bb):
    """Car side view with a thermometer (coolant/oil temperature), outline style. Proportions read off rect 08."""
    def draw(img, P, ss, w, h):
        t = max(1, int(0.05 * w * ss))
        body = np.array([P(0.02, 0.86), P(0.02, 0.62), P(0.20, 0.52), P(0.34, 0.30), P(0.70, 0.30), P(0.86, 0.52),
                         P(0.98, 0.60), P(0.98, 0.86)], np.int32)
        cv2.polylines(img, [body], False, 255, t)
        cv2.line(img, P(0.02, 0.86), P(0.14, 0.86), 255, t)
        cv2.line(img, P(0.34, 0.86), P(0.68, 0.86), 255, t)
        cv2.line(img, P(0.88, 0.86), P(0.98, 0.86), 255, t)
        r = int(0.10 * w * ss)
        cv2.circle(img, P(0.24, 0.86), r, 255, t)
        cv2.circle(img, P(0.78, 0.86), r, 255, t)
        cv2.line(img, P(0.48, 0.00), P(0.48, 0.70), 255, t)                             # thermometer stem
        cv2.circle(img, P(0.48, 0.76), int(0.07 * w * ss), 255, -1)                     # bulb
        cv2.line(img, P(0.52, 0.12), P(0.62, 0.12), 255, t)                             # scale marks
        cv2.line(img, P(0.52, 0.30), P(0.62, 0.30), 255, t)
    return _icon_canvas(bb, draw)


if __name__ == "__main__":
    o = measure()
    print({k: o[k] for k in ("width", "needles_08")})
    print({k: [(p["kind"], p["i0"], p["i1"], np.round(np.array(p["colour"]) * 255)) for p in v] for k, v in o["pieces"].items()})
    print(o["dark_lines"])
    print(o["numerals"], o["icons"], o["fill_night"])
