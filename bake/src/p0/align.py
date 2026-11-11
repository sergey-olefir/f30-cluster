"""P0: fit every reference dial, rectify it into our panel frame, normalise exposure, write masks and refs.json.

    cd bake/src && uv run ... python -m p0.align [--only 17_physical] [--debug]

Inputs : reference/6wb/*.png, reference/g20/*.jpg (+ 10_grid_homography_panel-to-photo.json), reference/ours/*.png,
         bake/src/p0/seeds.json (hand seeds and photo-space masks).
Outputs: bake/work/rect/<stem>.<mode>.<cluster>.{png,raw.png,mask.png,maskbits.png,json}
         bake/work/p0/fit_<stem>.png (fit overlays), bake/manifest/refs.json
"""
import argparse
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom  # noqa: E402
from p0 import fit as F  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
REF = os.path.join(ROOT, "reference")
RECT = os.path.join(ROOT, "bake", "work", "rect")
DBG = os.path.join(ROOT, "bake", "work", "p0")
SEEDS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seeds.json")
OVERRIDES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "overrides.json")

BIT_OUTSIDE, BIT_GLARE, BIT_WATERMARK, BIT_OCCLUSION, BIT_TEXT = 1, 2, 4, 8, 16
WHITE_TARGET = 235.0
DIAL_MARGIN = 1.08


def lum(img_bgr):
    b, g, r = [img_bgr[..., i].astype(np.float32) for i in range(3)]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def load(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im.ndim == 3 and im.shape[2] == 4:
        a = im[..., 3:4].astype(np.float32) / 255.0
        im = (im[..., :3].astype(np.float32) * a).astype(np.uint8)       # flatten any alpha over black
    return im


def poly_mask(shape, polys):
    m = np.zeros(shape[:2], np.uint8)
    for p in polys or []:
        cv2.fillPoly(m, [np.round(np.array(p, np.float32)).astype(np.int32)], 1)
    return m


def auto_glare(img, r_dial):
    """Large saturated blobs (thicker than any stroke of the display) -> glare."""
    sat = (img.max(axis=2) >= 250).astype(np.uint8)
    if sat.sum() == 0:
        return np.zeros(img.shape[:2], np.uint8)
    n, lab = cv2.connectedComponents(sat)
    dt = cv2.distanceTransform(sat, cv2.DIST_L2, 3)
    thick = max(4.0, 0.025 * r_dial)
    keep = np.zeros(n, bool)
    mx = np.zeros(n)
    np.maximum.at(mx, lab.ravel(), dt.ravel())
    keep[1:] = mx[1:] > thick
    g = keep[lab].astype(np.uint8)
    return cv2.dilate(g, np.ones((5, 5), np.uint8))


def feature_image(img, kind):
    if kind == "red":
        b, g, r = [img[..., i].astype(np.float32) for i in range(3)]
        return np.clip(r - np.maximum(g, b), 0, 255)
    return lum(img)


def warp(img, A, box, interp=cv2.INTER_CUBIC, border=0):
    x0, y0, w, h = box
    M = A.copy()
    M[:, 2] -= [x0, y0]
    return cv2.warpAffine(img, M, (w, h), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=border)


def needle_angle(rect_bgr, cx, cy, R, kind):
    """Angle (cw12) of the needle in a rectified dial crop: the strongest ray of red-ness (comfort) or brightness."""
    angs = np.arange(0, 360, 0.5, dtype=np.float32)
    f = feature_image(rect_bgr, "red") if kind == "red" else lum(rect_bgr)
    radii, prof = F.sample_rays(f, cx, cy, angs, 0.30 * R, 0.62 * R, step=1.0)
    prof = np.where(prof < 0, 0, prof)
    s = np.median(prof, axis=1)
    return float(angs[int(np.argmax(s))]), float(s.max() / max(np.median(s), 1e-3))


def capsule(shape, cx, cy, R, ang, t0=-0.42, t1=1.0, hw=0.06):
    m = np.zeros(shape, np.uint8)
    dx, dy = geom.cw12_to_vec(ang)
    p0 = (cx + dx * t0 * R, cy + dy * t0 * R)
    p1 = (cx + dx * t1 * R, cy + dy * t1 * R)
    cv2.line(m, tuple(int(round(v)) for v in p0), tuple(int(round(v)) for v in p1), 1,
             thickness=max(3, int(round(2 * hw * R))), lineType=cv2.LINE_8)
    return m


def text_mask(rect_bgr, cx, cy, R, valid):
    """Approximate mask of live text (numerals, captions): small bright blobs (white top-hat) whose centre lies
    inside 0.80 R. Long thin rings / arcs are dropped by their size."""
    L = lum(rect_bgr)
    h, w = L.shape
    k = max(5, int(0.06 * R) | 1)
    th = L - cv2.morphologyEx(L, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    hi = np.percentile(L[valid], 99.5) if valid.any() else 255.0
    m = ((th > 0.18 * hi) & (L > 0.35 * hi)).astype(np.uint8)
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    keep = np.zeros(n, bool)
    for i in range(1, n):
        x, y, bw, bh, area = st[i]
        rr = math.hypot(cen[i][0] + 0.5 - cx, cen[i][1] + 0.5 - cy) / R
        keep[i] = max(bw, bh) < 0.18 * R and area >= 4 and 0.18 < rr < 0.80
    out = keep[lab].astype(np.uint8)
    return cv2.dilate(out, np.ones((5, 5), np.uint8))


def exposure_fit(samples_black, samples_white_rgb):
    black = float(np.percentile(samples_black, 5)) if len(samples_black) else 0.0
    Lw = 0.2126 * samples_white_rgb[:, 2] + 0.7152 * samples_white_rgb[:, 1] + 0.0722 * samples_white_rgb[:, 0]
    thr = np.percentile(Lw, 99.5)
    top = samples_white_rgb[Lw >= thr].astype(np.float64)
    white = float(np.mean(Lw[Lw >= thr]))
    mean_bgr = top.mean(axis=0)
    wb = np.clip(white / np.maximum(mean_bgr, 1.0), 0.8, 1.25)
    gain = WHITE_TARGET / max(white - black, 8.0)
    return {"black": round(black, 2), "white": round(white, 2), "white_target": WHITE_TARGET,
            "gain": round(gain, 4), "offset": round(-black * gain, 3),
            "wb_gain_rgb": [round(float(wb[2]), 4), round(float(wb[1]), 4), round(float(wb[0]), 4)],
            "gamma": 1.0, "gamma_note": "not fitted (no shared mid-grey anchor); applied in sRGB code values",
            "formula": "out_c = clip((in_c - black) * gain * wb_gain_c, 0, 255)",
            "anchors": "black: 5th pct of luminance in the ring 1.0-1.08 R outside the bezels; "
                       "white: mean of the top 0.5% luminance inside 0.95 R (numerals, tick cores), needle masked"}


def apply_exposure(img_bgr, e):
    wb = np.array(e["wb_gain_rgb"][::-1], np.float32)
    out = (img_bgr.astype(np.float32) - e["black"]) * e["gain"] * wb
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def quality(res_px, angs_inl, partial):
    """good: rms <= 1.5 panel px and inliers in >= 7 of 8 octants with >= 150 rays; ok: rms <= 2.5 and >= 5 octants
    (>= 40 rays); poor otherwise; partial: a close-up whose fit comes from an arc / an inner feature."""
    if partial:
        return "partial"
    occ = np.bincount((np.asarray(angs_inl) // 45).astype(int) % 8, minlength=8)
    octs = int((occ >= 4).sum())
    n = len(angs_inl)
    if res_px <= 1.5 and octs >= 7 and n >= 150:
        return "good"
    if res_px <= 2.5 and octs >= 5 and n >= 40:
        return "ok"
    return "poor"


def mat_list(A):
    return [[round(float(v), 6) for v in row] for row in A]


def run(only=None, debug=False):
    seeds = json.load(open(SEEDS))["images"]
    overrides = json.load(open(OVERRIDES)) if os.path.exists(OVERRIDES) else {}
    os.makedirs(RECT, exist_ok=True)
    os.makedirs(DBG, exist_ok=True)
    out_images = {}
    for fname, spec in seeds.items():
        if only and only not in fname:
            continue
        path = os.path.join(REF, "6wb", fname)
        img = load(path)
        H, W = img.shape[:2]
        stem = os.path.splitext(fname)[0]
        bits_photo = np.zeros((H, W), np.uint8)
        bits_photo |= poly_mask(img.shape, spec.get("glare")) * BIT_GLARE
        bits_photo |= poly_mask(img.shape, spec.get("watermark")) * BIT_WATERMARK
        bits_photo |= poly_mask(img.shape, spec.get("occlusion")) * BIT_OCCLUSION
        rmin = min(d["seed"][2] for s in spec["sections"].values() for d in s["dials"].values())
        bits_photo |= auto_glare(img, rmin) * BIT_GLARE
        dbg = img.copy()
        rec = {"file": "reference/6wb/" + fname, "size": [W, H], "sections": {}}
        for mode, sec in spec["sections"].items():
            bx0, by0, bx1, by1 = sec["box"]
            inbox = np.zeros((H, W), np.uint8)
            inbox[max(0, by0):by1, max(0, bx0):bx1] = 1
            fits = {}
            for cl, d in sec["dials"].items():
                kind = d.get("feature", "lum")
                feat = feature_image(img, "red" if kind == "red" else "lum") * inbox
                ft = F.fit_dial_ring(feat, d["seed"], d.get("ranges"), ellipse=not d.get("partial", False))
                if ft is None:
                    print(f"{stem} {mode} {cl}: FIT FAILED")
                    continue
                if "tick_pitch_deg" in d:
                    # a short arc fixes the centre direction well but the radius poorly: scale the radius until the
                    # minor-tick pitch matches the one measured on full dials, re-fit the centre at that radius
                    P = ft["pts"][ft["inl"]]
                    r = float(ft["circle"][2])
                    ctr = np.array(ft["circle"][:2])
                    Lg = lum(img)
                    hist = []
                    for _ in range(6):
                        ang0 = np.degrees(np.arctan2(P[:, 0] - ctr[0], -(P[:, 1] - ctr[1])))
                        rng = [float(ang0.min()) - 6, float(ang0.max()) + 6]
                        pa, _ = F.tick_peaks(Lg, ctr, d.get("tick_ring_R", 0.875) / 1.012 * r, rng)
                        dif = np.diff(pa)
                        dif = dif[(dif > 0.6 * d["tick_pitch_deg"]) & (dif < 1.5 * d["tick_pitch_deg"])]
                        if len(dif) < 4:
                            break
                        pm = float(np.median(dif))
                        hist.append(round(pm, 3))
                        if abs(pm / d["tick_pitch_deg"] - 1) < 0.003:
                            break
                        r *= pm / d["tick_pitch_deg"]
                        ctr = F.fit_centre_fixed_r(P, ctr, r)
                    ft["centre"], ft["S"], ft["circle"] = ctr, np.eye(2) * r, (ctr[0], ctr[1], r)
                    q = (ft["pts"] - ctr) / r
                    ft["res_unit"] = np.linalg.norm(q, axis=1) - 1.0
                    ft["pitch_iterations"] = hist
                    # roll so the brightest (major) tick lands where the full dials put it
                    if "major_tick_at_cw12" in d:
                        pa, ps = F.tick_peaks(Lg, ctr, 0.835 / 1.012 * r, rng, pct=90)
                        if len(pa):
                            ft["major_tick_photo_cw12"] = float(pa[int(np.argmax(ps))])
                fits[cl] = (d, ft)
            # roll: the line through both big dials' centres when both were fitted in this section
            roll, roll_src = 0.0, "assumed 0 (single dial: camera assumed level; refine with ECC)"
            if "C1" in fits and "C2" in fits and not fits["C1"][0].get("partial") and not fits["C2"][0].get("partial"):
                c1, c2 = fits["C1"][1]["centre"], fits["C2"][1]["centre"]
                roll = math.degrees(math.atan2(c2[1] - c1[1], c2[0] - c1[0]))
                roll_src = "line through the C1 and C2 centres"
            single = [cl for cl in ("C1", "C2") if cl in fits and not fits[cl][0].get("partial")]
            if len(single) == 1 and roll == 0.0 and mode == "comfort":
                cl = single[0]
                d, ft = fits[cl]
                g = geom.G20[cl]
                A0 = F.affine_photo_to_panel(ft["centre"], ft["S"] * 1.01, 0.0, g["c"], g["R"])
                box = geom.crop_box(cl, DIAL_MARGIN)
                fl = F.floor_line_angle(lum(warp(img, A0, box)), g["c"][0] - box[0], g["c"][1] - box[1], g["R"])
                if fl is not None and abs(fl[0]) < 4.9:
                    roll, roll_src = fl[0], "inner-disc floor edge made horizontal (single dial; edge at %.3f R below centre)" % fl[1]
            for cl, (d, ft) in fits.items():
                if "major_tick_photo_cw12" in ft:
                    roll = ft["major_tick_photo_cw12"] - d["major_tick_at_cw12"]
                    roll_src = ("rotated so the major tick (6000 rpm) lands at %.1f cw12, where 05/17 put it; radius from the "
                                "minor-tick pitch %.2f deg (iterations %s)" % (d["major_tick_at_cw12"], d["tick_pitch_deg"], ft["pitch_iterations"]))
            ov = overrides.get(stem, {}).get(mode, {})
            if "roll" in ov:
                roll, roll_src = ov["roll"], ov.get("roll_src", "override")
            srec = {"roll_deg": round(roll, 3), "roll_source": roll_src, "dials": {}, "box": sec["box"]}
            dial_aff = {}
            for cl, (d, ft) in fits.items():
                ctr, S = ft["centre"], ft["S"]
                r_ridge = float(np.sqrt(np.linalg.det(S)))
                kind = d.get("feature", "lum")
                if kind == "lum":
                    kappa, nk = F.outer_edge_ratio(lum(img), ft)
                    kappa_used = float(np.clip(kappa if np.isfinite(kappa) else 1.01, 1.0, 1.04))
                    S_out = S * kappa_used
                    feature_desc = "bezel ridge (brightest ring); outer half-max edge mapped to R"
                else:
                    kappa, nk, kappa_used = float("nan"), 0, 1.0
                    S_out = S / d["maps_to_R"]
                    feature_desc = f"{'hub ring (red)' if kind == 'red' else 'inner ring'} mapped to {d['maps_to_R']} R"
                g = geom.G20[cl]
                A = F.affine_photo_to_panel(ctr, S_out, roll, g["c"], g["R"])
                dial_aff[cl] = A
                inl = ft["inl"]
                res_unit = ft["res_unit"][inl]
                panel_ridge_R = g["R"] * (1.0 / kappa_used if kind == "lum" else d["maps_to_R"])
                res_px = float(np.sqrt(np.mean(res_unit ** 2)) * panel_ridge_R)
                ax = np.sort(np.linalg.eigvalsh(S))
                light = F.harmonic_light(lum(img), ft) if kind == "lum" else None
                q = quality(res_px, ft["angs"][inl], d.get("partial", False))
                scale = float(np.sqrt(abs(np.linalg.det(A[:, :2]))))
                srec["dials"][cl] = {
                    "feature": feature_desc, "seed": d["seed"],
                    "photo_centre": [round(float(ctr[0]), 2), round(float(ctr[1]), 2)],
                    "photo_ridge_axes": [round(float(ax[0]), 2), round(float(ax[1]), 2)],
                    "ellipse_ratio": round(float(ax[0] / ax[1]), 4),
                    "outer_edge_ratio": None if not np.isfinite(kappa) else round(kappa, 4), "outer_edge_ratio_used": round(kappa_used, 4),
                    "outer_edge_rays": nk,
                    "ridge_radius_in_R": round(1.0 / kappa_used, 4) if kind == "lum" else d["maps_to_R"],
                    "panel_px_per_photo_px": round(scale, 4),
                    "A_photo_to_panel": mat_list(A),
                    "residual_rms_panel_px": round(res_px, 3),
                    "residual_max_panel_px": round(float(np.max(np.abs(res_unit)) * panel_ridge_R), 3) if len(res_unit) else None,
                    "inlier_rays": int(inl.sum()), "rays": int(len(inl)),
                    "light": light, "quality": q, "partial": bool(d.get("partial", False)),
                }
                # debug overlay
                th = np.linspace(0, 2 * np.pi, 361)
                pts = ctr[None, :] + (np.c_[np.cos(th), np.sin(th)] @ S.T)
                cv2.polylines(dbg, [np.round(pts).astype(np.int32)], True, (0, 255, 0), 1)
                pts = ctr[None, :] + (np.c_[np.cos(th), np.sin(th)] @ S_out.T)
                cv2.polylines(dbg, [np.round(pts).astype(np.int32)], True, (255, 0, 255), 1)
                for p in ft["pts"][inl][::3]:
                    cv2.circle(dbg, (int(p[0]), int(p[1])), 1, (0, 255, 255), -1)
                cv2.putText(dbg, f"{cl} {res_px:.2f}px {q}", (int(ctr[0]) - 60, int(ctr[1])), 0, max(0.4, r_ridge / 300), (0, 255, 0), 1)
            # the window / bottom bar and a full-panel layout view: mean of the two dials' linear parts, the midpoint
            # of the two photo dial centres mapped to (960, 380)
            if "C1" in dial_aff and "C2" in dial_aff and not srec["dials"]["C1"]["partial"]:
                Lm = 0.5 * (dial_aff["C1"][:, :2] + dial_aff["C2"][:, :2])
                mid = 0.5 * (fits["C1"][1]["centre"] + fits["C2"][1]["centre"])
                A5 = np.c_[Lm, np.array([960.0, 380.0]) - Lm @ mid]
                p1 = A5 @ np.r_[fits["C1"][1]["centre"], 1]
                p2 = A5 @ np.r_[fits["C2"][1]["centre"], 1]
                srec["window_transform"] = {
                    "A_photo_to_panel": mat_list(A5),
                    "note": "6WB layout scaled by the mean dial scale and centred on the dial-pair midpoint -> panel "
                            "(960, 380). The 6WB dials land at x %.0f / %.0f (ours: 412 / 1508), so the 6WB window is "
                            "NOT our window: use it for shapes/profiles in R units, not for absolute x." % (p1[0], p2[0]),
                    "dial_centres_in_panel": [[round(float(p1[0]), 1), round(float(p1[1]), 1)], [round(float(p2[0]), 1), round(float(p2[1]), 1)]],
                    "dial_spacing_in_R": round(float(np.hypot(*(p2 - p1)) / 335.0), 4)}
                dial_aff["C5"] = A5
                dial_aff["PANEL"] = A5
            # warp each cluster, exposure fit over the section's dials
            crops = {}
            for cl, A in dial_aff.items():
                box = geom.crop_box(cl, DIAL_MARGIN) if cl in geom.G20 else geom.crop_box(cl)
                raw = warp(img, A, box)
                inside = warp(inbox * 255, A, box, cv2.INTER_NEAREST) > 0
                inside &= warp(np.full((H, W), 255, np.uint8), A, box, cv2.INTER_NEAREST) > 0
                bits = warp(bits_photo, A, box, cv2.INTER_NEAREST)
                bits[~inside] |= BIT_OUTSIDE
                crops[cl] = [box, raw, bits, inside]
            blacks, whites = [], []
            for cl in ("C1", "C2", "C3", "C4"):
                if cl not in crops or srec["dials"][cl]["partial"]:
                    continue
                box, raw, bits, inside = crops[cl]
                g = geom.G20[cl]
                cx, cy = g["c"][0] - box[0], g["c"][1] - box[1]
                r, ang = geom.dial_polar_grid(box[2], box[3], cx, cy, g["R"])
                ok = inside & (bits == 0)
                if cl in ("C1", "C2"):
                    na, _ = needle_angle(raw, cx, cy, g["R"], "red" if mode == "comfort" else "lum")
                    na = ov.get("needle_" + cl, na)
                    nm = capsule(bits.shape, cx, cy, g["R"], na)
                    srec["dials"][cl]["needle_cw12_deg"] = round(na, 1)
                    bits |= nm * BIT_OCCLUSION
                    ok &= nm == 0
                    tm = text_mask(raw, cx, cy, g["R"], ok)
                    bits |= tm * BIT_TEXT
                if mode == "comfort":
                    fl = F.floor_line_angle(lum(raw), cx, cy, g["R"])
                    srec["dials"][cl]["floor_check"] = None if fl is None else {
                        "residual_tilt_deg": round(fl[0], 2), "dy_R": round(fl[1], 4)}
                L = lum(raw)
                blacks.append(L[ok & (r > 1.0) & (r < DIAL_MARGIN)])
                whites.append(raw[ok & (r < 0.95)].reshape(-1, 3))
            if not whites and crops:          # partial-only images: use the whole crop
                for cl, (box, raw, bits, inside) in crops.items():
                    ok = inside & (bits == 0)
                    whites.append(raw[ok].reshape(-1, 3))
                    blacks.append(lum(raw)[ok])
            e = exposure_fit(np.concatenate(blacks) if blacks else np.array([]), np.concatenate(whites))
            if not any(not v["partial"] for v in srec["dials"].values()):
                e["wb_gain_rgb"] = [1.0, 1.0, 1.0]
                e["note"] = ("partial close-up: anchors from the whole crop (black = 5th pct, white = top 0.5%), no white "
                             "balance (the brightest pixels are not neutral here). Levels are only roughly comparable with "
                             "the full-dial images: use close-ups for shapes and profiles, take levels from 05 / 03 / 02.")
            srec["exposure"] = e
            srec["outputs"] = {}
            for cl, (box, raw, bits, inside) in crops.items():
                base = f"{stem}.{mode}.{cl}"
                norm = apply_exposure(raw, e)
                norm[~inside] = 0
                raw[~inside] = 0
                cv2.imwrite(os.path.join(RECT, base + ".png"), norm)
                cv2.imwrite(os.path.join(RECT, base + ".raw.png"), raw)
                cv2.imwrite(os.path.join(RECT, base + ".maskbits.png"), bits)
                cv2.imwrite(os.path.join(RECT, base + ".mask.png"), np.where(bits == 0, 255, 0).astype(np.uint8))
                side = {"image": rec["file"], "mode": mode, "cluster": cl, "box": list(box),
                        "A_photo_to_panel": mat_list(dial_aff[cl]), "exposure": e,
                        "quality": srec["dials"].get(cl, {}).get("quality", "derived (window transform)"),
                        "valid_fraction": round(float((bits == 0).mean()), 4)}
                with open(os.path.join(RECT, base + ".json"), "w") as f:
                    json.dump(side, f, indent=1)
                srec["outputs"][cl] = {"base": "bake/work/rect/" + base, "box": list(box), "valid_fraction": side["valid_fraction"]}
                # close-ups: the 1x crop throws most of the photo's detail away, so also write a k x supersampled
                # crop of the photo's footprint (same frame: panel px * k, origin at box_k's panel x, y)
                sc = float(np.sqrt(abs(np.linalg.det(dial_aff[cl][:, :2]))))
                if sc < 0.6:
                    k = int(min(4, max(2, round(1.0 / sc))))
                    ys, xs = np.nonzero(inside)
                    bx = [box[0] + int(xs.min()), box[1] + int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
                    Ak = dial_aff[cl] * k
                    boxk = (bx[0] * k, bx[1] * k, bx[2] * k, bx[3] * k)
                    rk = warp(img, Ak, boxk, cv2.INTER_AREA if k * sc < 1 else cv2.INTER_CUBIC)
                    ik = warp(np.full((H, W), 255, np.uint8), Ak, boxk, cv2.INTER_NEAREST) > 0
                    ik &= warp(inbox * 255, Ak, boxk, cv2.INTER_NEAREST) > 0
                    bk = warp(bits_photo, Ak, boxk, cv2.INTER_NEAREST)
                    bk[~ik] |= BIT_OUTSIDE
                    nk = apply_exposure(rk, e)
                    nk[~ik] = 0
                    bk_name = f"{base}@{k}x"
                    cv2.imwrite(os.path.join(RECT, bk_name + ".png"), nk)
                    cv2.imwrite(os.path.join(RECT, bk_name + ".maskbits.png"), bk)
                    cv2.imwrite(os.path.join(RECT, bk_name + ".mask.png"), np.where(bk == 0, 255, 0).astype(np.uint8))
                    with open(os.path.join(RECT, bk_name + ".json"), "w") as f:
                        json.dump(dict(side, box=bx, scale=k, note="supersampled close-up: pixel (i, j) is panel "
                                       "(box.x + (i+0.5)/k, box.y + (j+0.5)/k)"), f, indent=1)
                    srec["outputs"][cl]["supersampled"] = {"base": "bake/work/rect/" + bk_name, "box": bx, "scale": k}
            rec["sections"][mode] = srec
            print(f"{stem} [{mode}] roll {roll:.2f}  " + "  ".join(
                f"{cl}:{v['residual_rms_panel_px']:.2f}px/{v['inlier_rays']}r/{v['quality']}" for cl, v in srec["dials"].items()))
        cv2.imwrite(os.path.join(DBG, f"fit_{stem}.png"), dbg)
        out_images[fname] = rec
    return out_images


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()
    res = run(a.only, a.debug)
    os.makedirs(DBG, exist_ok=True)
    with open(os.path.join(DBG, "align_6wb.json" if not a.only else f"align_{a.only}.json"), "w") as f:
        json.dump(res, f, indent=1)
