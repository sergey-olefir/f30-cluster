"""P7 / C8 Eco Pro: measure the Eco Pro parts on the rectified crops and fit the analytic models build.py draws.

    cd bake/src && $PY C8-eco/fit.py          -> bake/src/C8-eco/params.json (+ bake/work/C8-eco/fit_log.json)

Everything is in dial-R units and cw12 degrees. Sources: 03 (photo, best alignment: primary), 01 (small photo:
cross-check), 02 (clean render: proportions differ, used for colour notes only).

The 6WB face sits behind the glass, so in the photos the face features are not concentric with the bezel our
alignment used (parallax): every feature's centre is fitted first (circle through the ridge / peak points) and its
radial profile is sampled about that centre. The fitted offsets go into the log and into the QC re-centred crops.

Radial model per channel c (drawn over black, straight alpha later):
    I_c(r) = P_c * rise(r) * exp(-max(r - rp, 0) / tau_c) * (1 - smoothstep(f0, f1, r)),
    rise = smoothstep(e - w/2, e + w/2, r), rp = e + w/2
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import geom  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RECT = os.path.join(ROOT, "bake", "work", "rect")
WORK = os.path.join(ROOT, "bake", "work", "C8-eco")
S03, S01, S02 = "03_three-modes_photo_bimmerstop.eco", "01_three-modes_small.eco", "02_three-modes_clean-render.eco"


def load(stem):
    base = stem if os.path.isabs(stem) else os.path.join(RECT, stem)
    img = cv2.imread(base + ".png")[..., ::-1].astype(np.float32)   # RGB
    meta = json.load(open(base + ".json"))
    return img, meta["box"]


def centre(stem, cl, dx=0.0, dy=0.0):
    img, box = load(stem)
    g = geom.G20[cl]
    return img, g["c"][0] - box[0] + dx * g["R"], g["c"][1] - box[1] + dy * g["R"], g["R"]


def sample(img, cx, cy, R, rs, angs):
    A, Rr = np.meshgrid(np.radians(angs), rs)
    x = (cx + Rr * R * np.sin(A) - 0.5).astype(np.float32)
    y = (cy - Rr * R * np.cos(A) - 0.5).astype(np.float32)
    return cv2.remap(img, x, y, cv2.INTER_LINEAR)          # (len(rs), len(angs), 3)


def fit_circle(stem, cl, angs, lo, hi):
    """Peak radius per ray -> least-squares circle. Returns (dx_R, dy_R, r_R, rms_px)."""
    img, cx, cy, R = centre(stem, cl)
    L = img @ np.array([0.299, 0.587, 0.114], np.float32)
    rs = np.linspace(lo, hi, 400)
    pts = []
    for a in angs:
        p = sample(L[..., None].repeat(3, 2), cx, cy, R, rs, [a])[:, 0, 0]
        if p.max() < 40:
            continue
        i = int(np.argmax(p))
        if 0 < i < len(p) - 1:
            d = (p[i - 1] - p[i + 1]) / (2 * (p[i - 1] - 2 * p[i] + p[i + 1]) - 1e-9)
            rr = rs[i] + float(np.clip(d, -1, 1)) * (rs[1] - rs[0])
        else:
            rr = rs[i]
        t = np.radians(a)
        pts.append((cx + rr * R * np.sin(t), cy - rr * R * np.cos(t)))
    pts = np.array(pts)
    x, y = pts[:, 0], pts[:, 1]
    c = np.linalg.lstsq(np.c_[2 * x, 2 * y, np.ones_like(x)], x * x + y * y, rcond=None)[0]
    r = np.sqrt(c[2] + c[0] ** 2 + c[1] ** 2)
    res = np.hypot(x - c[0], y - c[1]) - r
    return float((c[0] - cx) / R), float((c[1] - cy) / R), float(r / R), float(res.std()), len(pts)


def peak_points(stem, cl, angs, lo, hi, min_peak=40):
    img, cx, cy, R = centre(stem, cl)
    L = img @ np.array([0.299, 0.587, 0.114], np.float32)
    rs = np.linspace(lo, hi, 400)
    pts = []
    for a in angs:
        p = sample(L[..., None].repeat(3, 2), cx, cy, R, rs, [a])[:, 0, 0]
        if p.max() < min_peak:
            continue
        i = int(np.argmax(p))
        if 0 < i < len(p) - 1:
            d = (p[i - 1] - p[i + 1]) / (2 * (p[i - 1] - 2 * p[i] + p[i + 1]) - 1e-9)
            rr = rs[i] + float(np.clip(d, -1, 1)) * (rs[1] - rs[0])
        else:
            rr = rs[i]
        t = np.radians(a)
        pts.append((cx + rr * R * np.sin(t), cy - rr * R * np.cos(t)))
    return np.array(pts, np.float32), cx, cy, R


def ellipse_affine(stem, cl, angs, lo, hi, check=None):
    """Fit an ellipse to a feature's peak points; return the 2x3 affine (crop px -> crop px) that maps it onto a
    circle of the same mean radius centred on OUR dial centre (undoes the photo's residual perspective / parallax
    locally), its radius in R, and the residual rms (px) before / after. `check`: (angs, lo, hi) of a second feature
    whose circularity after the map is reported."""
    pts, cx, cy, R = peak_points(stem, cl, angs, lo, hi)
    for _ in range(3):                                   # drop outliers (text, marks) and refit
        (ex, ey), (d1, d2), th = cv2.fitEllipse(pts)
        tt, ph = np.radians(th), np.linspace(0, 2 * np.pi, 1440)
        e = np.c_[ex + d1 / 2 * np.cos(ph) * np.cos(tt) - d2 / 2 * np.sin(ph) * np.sin(tt),
                  ey + d1 / 2 * np.cos(ph) * np.sin(tt) + d2 / 2 * np.sin(ph) * np.cos(tt)]
        dist = np.array([np.min(np.hypot(e[:, 0] - x, e[:, 1] - y)) for x, y in pts])
        keep = dist < max(2.0, 2.5 * np.median(dist))
        if keep.all() or keep.sum() < 12:
            break
        pts = pts[keep]
    (ex, ey), (d1, d2), th = cv2.fitEllipse(pts)
    a1, a2 = d1 / 2, d2 / 2
    rm = float(np.sqrt(a1 * a2))
    t = np.radians(th)
    Rot = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
    S = np.diag([rm / a1, rm / a2])
    M = Rot @ S @ Rot.T
    tvec = np.array([cx, cy]) - M @ np.array([ex, ey])
    A = np.c_[M, tvec]
    def circ_rms(P):
        q = P @ A[:, :2].T + A[:, 2]
        d = np.hypot(q[:, 0] - cx, q[:, 1] - cy)
        return float(d.std()), float(d.mean() / R)
    out = {"A": A.round(6).tolist(), "r_R": rm / R, "rms_before_px": float(np.hypot(pts[:, 0] - cx, pts[:, 1] - cy).std()),
           "rms_after_px": circ_rms(pts)[0], "axes_ratio": float(max(a1, a2) / min(a1, a2)), "angle_deg": float(th),
           "centre_off_R": [float((ex - cx) / R), float((ey - cy) / R)], "n": len(pts)}
    if check:
        P2, *_ = peak_points(stem, cl, *check)
        out["check_rms_after_px"], out["check_r_R"] = circ_rms(P2)
        out["check_rms_before_px"] = float(np.hypot(P2[:, 0] - cx, P2[:, 1] - cy).std())
    return out


def rect_crop(stem, A, tag):
    """Warp a rect crop (png, maskbits, mask) by the 2x3 affine A (crop px -> crop px) into bake/work/C8-eco/rect/
    so the fitted feature is a circle on our dial centre. Returns the new base path (absolute)."""
    base = os.path.join(RECT, stem)
    od = os.path.join(WORK, "rect")
    os.makedirs(od, exist_ok=True)
    nb = os.path.join(od, f"{stem}.rc-{tag}")
    A = np.float32(A)
    for suf, interp, border in ((".png", cv2.INTER_LINEAR, 0), (".maskbits.png", cv2.INTER_NEAREST, 1),
                                (".mask.png", cv2.INTER_NEAREST, 0), (".raw.png", cv2.INTER_LINEAR, 0)):
        if os.path.exists(base + suf):
            im = cv2.imread(base + suf, cv2.IMREAD_UNCHANGED)
            out = cv2.warpAffine(im, A, (im.shape[1], im.shape[0]), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=border)
            cv2.imwrite(nb + suf, out)
    meta = json.load(open(base + ".json"))
    meta["C8_eco_rectify"] = {"A_crop_to_crop": np.asarray(A).round(6).tolist(),
                              "note": "ellipse of the fitted feature -> circle on our dial centre (photo perspective / parallax of the recessed face)"}
    json.dump(meta, open(nb + ".json", "w"), indent=1)
    return nb


def radial(stem, cl, off, a0, a1, r0, r1, step=0.0025):
    img, cx, cy, R = centre(stem, cl, *off)
    rs = np.arange(r0, r1 + 1e-9, step)
    v = sample(img, cx, cy, R, rs, np.arange(a0, a1, 0.5))
    return rs, np.median(v, axis=1)                         # (n, 3)


def smoothstep(a, b, x):
    t = np.clip((x - a) / max(b - a, 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def model(r, e, w, P, tau, f0, f1, k=1.0):
    rp = e + w / 2
    return P * smoothstep(e - w / 2, e + w / 2, r) * np.exp(-(np.maximum(r - rp, 0) / tau) ** k) * (1 - smoothstep(f0, f1, r))


def fit_profile(rs, prof, base, e_rng, f0f1, taus=np.geomspace(0.003, 0.08, 60)):
    """prof (n,3) minus baseline (3,) -> best e, w, per channel P, tau. Grid search on e, w; LS for P per tau."""
    y = np.clip(prof - base[None, :], 0, None)
    best = None
    for e in np.arange(*e_rng, 0.0005):
        for w in (0.004, 0.006, 0.008, 0.010, 0.012, 0.015, 0.020, 0.025, 0.030):
            out, sse = [], 0.0
            for c in range(3):
                bc = None
                for k in (1.0, 1.5, 2.0, 2.5, 3.0):
                    for tau in taus:
                        g = model(rs, e, w, 1.0, tau, *f0f1, k)
                        P = float(g @ y[:, c] / max(g @ g, 1e-9))
                        s = float(((P * g - y[:, c]) ** 2).sum())
                        if bc is None or s < bc[0]:
                            bc = (s, P, float(tau), k)
                out.append(bc[1:])
                sse += bc[0]
            if best is None or sse < best[0]:
                best = (sse, float(e), float(w), out)
    sse, e, w, out = best
    rms = float(np.sqrt(sse / (3 * len(rs))))
    return {"edge": round(e, 4), "edge_w": w, "peak_r": round(e + w / 2, 4),
            "P_rgb": [round(o[0] / 255.0, 4) for o in out], "tau_rgb": [round(o[1], 4) for o in out],
            "k_rgb": [o[2] for o in out],
            "fade": list(f0f1), "rms_8bit": round(rms, 2)}


def angular(stem, cl, off, rr, step=0.25, w=0.006):
    img, cx, cy, R = centre(stem, cl, *off)
    angs = np.arange(-180, 180, step)
    v = sample(img, cx, cy, R, np.linspace(rr - w, rr + w, 5), angs).mean(0)
    return angs, v


def main():
    log, P = {}, {}
    # ---- feature centres (parallax) and radii
    circ = {
        "tacho.band.03": fit_circle(S03 + ".C2", "C2", list(range(20, 90, 2)) + list(range(100, 125, 2)), 0.72, 0.90),
        "tacho.band.01": fit_circle(S01 + ".C2", "C2", list(range(20, 90, 2)) + list(range(100, 125, 2)), 0.72, 0.90),
        "tacho.ed.03": fit_circle(S03 + ".C2", "C2", list(range(50, 128, 2)) + list(range(318, 340, 2)), 0.44, 0.58),
        "tacho.ed.01": fit_circle(S01 + ".C2", "C2", list(range(50, 128, 2)) + list(range(318, 340, 2)), 0.44, 0.58),
        "speedo.arc.03": fit_circle(S03 + ".C1", "C1", list(range(236, 356, 2)), 0.44, 0.53),
        "speedo.arc.01": fit_circle(S01 + ".C1", "C1", list(range(236, 356, 2)), 0.44, 0.53),
        "tacho.bezel.03": fit_circle(S03 + ".C2", "C2", list(range(0, 220, 3)), 0.95, 1.02),
        "tacho.band.02": fit_circle(S02 + ".C2", "C2", list(range(20, 90, 2)), 0.72, 0.98),
        "tacho.ed.02": fit_circle(S02 + ".C2", "C2", list(range(50, 128, 2)) + list(range(318, 340, 2)), 0.40, 0.60),
    }
    band_angs = list(range(-38, -34)) + list(range(-28, -4, 2)) + list(range(6, 88, 2)) + list(range(92, 127, 2))
    ed_angs = list(range(-38, -4, 2)) + list(range(6, 128, 2))
    ell = {}
    for src, stem in (("03", S03), ("01", S01)):
        ell["tacho.band." + src] = ellipse_affine(stem + ".C2", "C2", band_angs, 0.797, 0.90, (ed_angs, 0.44, 0.58))
        ell["tacho.ed." + src] = ellipse_affine(stem + ".C2", "C2", ed_angs, 0.485, 0.58, (band_angs, 0.797, 0.90))
        ell["speedo.arc." + src] = ellipse_affine(stem + ".C1", "C1", list(range(236, 356, 2)), 0.44, 0.53)
    log["ellipses"] = ell
    RC = {k: rect_crop({"tacho": "%s.C2", "speedo": "%s.C1"}[k.split(".")[0]] % (S03 if k.endswith("03") else S01),
                       v["A"], k.replace(".", "-")) for k, v in ell.items()}
    log["circles"] = {k: dict(zip(("dx_R", "dy_R", "r_R", "rms_px", "n"), v)) for k, v in circ.items()}
    off = {k: (v[0], v[1]) for k, v in circ.items()}

    # ---- C2 CHARGE / POWER band: blue (fill) and grey (track) zones, 03 primary, 01 cross-check
    for zone, (a0, a1) in {"fill": (20, 80), "track": (100, 126)}.items():
        for src, stem in (("03", S03), ("01", S01)):
            rs, pr = radial(RC["tacho.band." + src], "C2", (0, 0), a0, a1, 0.74, 0.97)
            base = np.minimum(pr[:8].mean(0), pr[-6:].mean(0))
            f = fit_profile(rs, pr, base, (0.79, 0.845), (0.91, 0.945))
            f["baseline_rgb"] = [round(b / 255, 4) for b in base]
            log[f"band.{zone}.{src}"] = f
    # zone boundaries and marks: 03 and 01 at r = 0.875 (marks reach past the band's bright part)
    for src, stem in (("03", S03), ("01", S01)):
        angs, v = angular(RC["tacho.band." + src], "C2", (0, 0), 0.875)
        L = v @ np.array([0.299, 0.587, 0.114])
        sat = v[:, 2] - v[:, 0]
        marks = {}
        for name, (lo, hi) in {"end_lo": (-48, -36), "zone_lo": (-36, -25), "zone_hi": (84, 96), "end_hi": (124, 138),
                               "off": (225, 240)}.items():
            lo2, hi2 = (lo - 360, hi - 360) if lo > 180 else (lo, hi)
            m = (angs >= lo2) & (angs <= hi2)
            k = int(np.argmax(np.where(m, L, -1)))
            marks[name] = {"deg": float(angs[k] % 360 if angs[k] > 0 else angs[k]), "L": round(float(L[k]), 1)}
        blue = (sat > 25) & (L > 40)
        idx = np.nonzero(blue & (angs > -60) & (angs < 140))[0]
        marks["blue_from_to_deg"] = [float(angs[idx.min()]), float(angs[idx.max()])] if len(idx) else None
        log["marks." + src] = marks
    # ---- C2 EfficientDynamics arc (03: 76..124 keeps the text out; 320..340)
    for src, stem in (("03", S03), ("01", S01)):
        rs, pr = radial(RC["tacho.ed." + src], "C2", (0, 0), 76, 124, 0.44, 0.64)
        base = pr[-8:].mean(0)
        f = fit_profile(rs, pr, base, (0.48, 0.525), (0.60, 0.64))
        f["baseline_rgb"] = [round(b / 255, 4) for b in base]
        log["ed.%s" % src] = f
        angs, v = angular(RC["tacho.ed." + src], "C2", (0, 0), f["peak_r"])
        L = v @ np.array([0.299, 0.587, 0.114])
        on = L > 0.5 * np.percentile(L[(angs > 80) & (angs < 120)], 50)
        # the arc runs over the top: from the upper left (negative cw12) to the lower right
        lo = angs[(angs < -10) & (angs > -80)][on[(angs < -10) & (angs > -80)]]
        hi = angs[(angs > 100) & (angs < 160)][on[(angs > 100) & (angs < 160)]]
        log["ed.%s" % src]["span_deg"] = [float(lo.min()) if len(lo) else None, float(hi.max()) if len(hi) else None]
    # ---- C1 Eco speed arc (the inner-disc edge lit blue): 03 sector 250..300 (no text, no needle)
    for src, stem in (("03", S03), ("01", S01)):
        rs, pr = radial(RC["speedo.arc." + src], "C1", (0, 0), 250, 300, 0.42, 0.62)
        base = pr[-8:].mean(0)
        f = fit_profile(rs, pr, base, (0.465, 0.51), (0.58, 0.62))
        f["baseline_rgb"] = [round(b / 255, 4) for b in base]
        angs, v = angular(RC["speedo.arc." + src], "C1", (0, 0), f["peak_r"])
        L = v @ np.array([0.299, 0.587, 0.114])
        a360 = angs % 360
        seg = (a360 > 235) & (a360 < 355)
        f["L_along_235_355"] = [round(float(np.median(L[seg & (a360 >= s) & (a360 < s + 20)])), 1) for s in range(235, 355, 20)]
        top = (angs > -5) & (angs < 40)
        thr = 0.5 * np.median(L[seg])
        ends = angs[top][L[top] > thr]
        f["end_deg"] = float(ends.max()) if len(ends) else None
        log["speedo_arc.%s" % src] = f
    # ---- thin track ring round the bottom (C2, 03, 250..300)
    rs, pr = radial(RC["tacho.band.03"], "C2", (0, 0), 250, 300, 0.82, 0.90)
    base = np.minimum(pr[:4].mean(0), pr[-4:].mean(0))
    k = int(np.argmax(pr.sum(1)))
    half = (pr.sum(1) - base.sum()) > 0.5 * (pr[k].sum() - base.sum())
    log["thin_ring.03"] = {"r": round(float(rs[k]), 4), "fwhm": round(float(half.sum() * 0.0025), 4),
                           "peak_minus_base_rgb": [round(float(x) / 255, 4) for x in pr[k] - base]}
    # ---- window-side bezel glow: C2 ~260 deg, C1 ~90 deg (03 primary, 01 cross-check)
    for cl, (a0, a1) in {"C2": (235, 290), "C1": (65, 115)}.items():
        for src, stem in (("03", S03), ("01", S01)):
            img, cx, cy, R = centre(stem + "." + cl, cl)
            rs = np.arange(0.975, 1.0051, 0.0025)                     # the bezel ridge (P0: 0.99 R)
            angs = np.arange(a0, a1, 0.5)
            v = sample(img, cx, cy, R, rs, angs)                       # (r, a, 3)
            blue = np.clip(v[..., 2] - v[..., 0], 0, None).max(0)
            blue = np.convolve(blue, np.ones(5) / 5, "same")
            w = np.clip(blue - np.percentile(blue, 20), 0, None)
            w = w / max(w.sum(), 1e-9)
            mu_a = float((angs * w).sum())
            sd_a = float(np.sqrt(((angs - mu_a) ** 2 * w).sum()))
            near = np.abs(angs - mu_a) <= 4
            rad = v[:, near].mean((1, 2))
            i = int(np.argmax(rad))
            pk = v[i, near].mean(0)
            entry = {"centre_deg": round(mu_a, 1), "sd_deg": round(sd_a, 1), "r": round(float(rs[i]), 4),
                     "eco_ridge_rgb": [round(float(x) / 255, 4) for x in pk]}
            if src == "03":
                img_c, cxc, cyc, _ = centre(f"03_three-modes_photo_bimmerstop.comfort.{cl}", cl)
                vc = sample(img_c, cxc, cyc, R, rs, angs)
                gc = vc[:, near].mean(1)[int(np.argmax(vc[:, near].mean((1, 2))))]
                C = np.array([0.33, 0.75, 1.0]) * 255
                al = float(np.clip(np.mean((pk[1:] - gc[1:]) / np.maximum(C[1:] - gc[1:], 1)), 0, 1))
                entry.update(comfort_ridge_rgb=[round(float(x) / 255, 4) for x in gc], tint_rgb=[0.33, 0.75, 1.0],
                             tint_alpha=round(al, 3),
                             tint_check_rgb=[round(float(x) / 255, 4) for x in al * C + (1 - al) * gc])
            log[f"glow.{cl}.{src}"] = entry
    # ---- shared-layer tints: Eco vs Comfort in the same photo (03), same rings
    tint = {}
    for name, (cl, a0, a1, r0, r1) in {
        "face_C2": ("C2", 200, 300, 0.60, 0.70), "face_C1": ("C1", 60, 130, 0.60, 0.70),
        "groove_rim_C1": ("C1", 250, 300, 0.80, 0.83), "inner_disc_edge_C1": ("C1", 250, 300, 0.47, 0.50),
        "hub_ring_C2": ("C2", 60, 120, 0.11, 0.15), "hub_ring_C1": ("C1", 150, 200, 0.11, 0.15),
        "bezel_C2": ("C2", 30, 120, 0.975, 1.0), "bezel_C1": ("C1", 200, 300, 0.975, 1.0),
        "ticks_C1": ("C1", 270, 330, 0.84, 0.91),
    }.items():
        row = {}
        for mode in ("eco", "comfort"):
            stem = f"03_three-modes_photo_bimmerstop.{mode}.{cl}"
            img, cx, cy, R = centre(stem, cl)
            v = sample(img, cx, cy, R, np.arange(r0, r1, 0.0025), np.arange(a0, a1, 0.5)).reshape(-1, 3)
            L = v @ np.array([0.299, 0.587, 0.114])
            sel = v[L >= np.percentile(L, 90)] if name.startswith(("groove", "inner", "hub", "bezel", "ticks")) else v
            row[mode] = [round(float(x) / 255, 4) for x in np.median(sel, 0)]
        tint[name] = row
    log["tints_03"] = tint
    # ---- 02 colour notes (clean render; its geometry is not concentric in our frame)
    notes = {}
    for name, (cl, a0, a1, r0, r1) in {"band_fill_C2": ("C2", 20, 50, 0.72, 0.98), "ed_arc_C2": ("C2", 60, 100, 0.40, 0.60),
                                       "speedo_arc_C1": ("C1", 250, 300, 0.38, 0.56)}.items():
        img, cx, cy, R = centre(S02 + "." + cl, cl)
        v = sample(img, cx, cy, R, np.arange(r0, r1, 0.0025), np.arange(a0, a1, 0.5))
        L = v @ np.array([0.299, 0.587, 0.114])
        i = np.unravel_index(np.argmax(np.median(L, 1)[:, None].repeat(L.shape[1], 1)), L.shape)[0]
        notes[name] = {"peak_rgb": [round(float(x) / 255, 4) for x in np.median(v[i], 0)], "peak_r_in_our_frame": round(float(np.arange(r0, r1, 0.0025)[i]), 4)}
    log["02_notes"] = notes
    os.makedirs(WORK, exist_ok=True)
    json.dump(log, open(os.path.join(WORK, "fit_log.json"), "w"), indent=1, default=float)

    # ---- the parameters build.py draws from (03 primary; numbers rounded)
    b3, t3 = log["band.fill.03"], log["band.track.03"]
    m3 = log["marks.03"]
    P = {
        "_about": "Fitted by bake/src/C8-eco/fit.py on 03 (primary) and 01 (cross-check). R units, cw12 degrees.",
        "centre_offsets_R": {k: [round(v[0], 4), round(v[1], 4)] for k, v in off.items()},
        "ref_rectify": {k: {"A": v["A"], "r_R": round(v["r_R"], 4), "rms_after_px": round(v["rms_after_px"], 2)} for k, v in ell.items()},
        "ref_rectified_crops": {k: os.path.relpath(v, ROOT) for k, v in RC.items()},
        "band": {"span_deg": [m3["end_lo"]["deg"], m3["end_hi"]["deg"]],
                 "fill_default_deg": [m3["zone_lo"]["deg"], m3["zone_hi"]["deg"]],
                 "fill": b3, "track": t3},
        "marks": {k: m3[k]["deg"] for k in ("end_lo", "zone_lo", "zone_hi", "end_hi", "off")},
        "ed_arc": log["ed.03"],
        "speedo_arc": log["speedo_arc.03"],
        "thin_ring": log["thin_ring.03"],
        "glow": {"C2": log["glow.C2.03"], "C1": log["glow.C1.03"]},
        "glow01": {"C2": log["glow.C2.01"], "C1": log["glow.C1.01"]},
    }
    json.dump(P, open(os.path.join(HERE, "params.json"), "w"), indent=1, default=float)


if __name__ == "__main__":
    main()
