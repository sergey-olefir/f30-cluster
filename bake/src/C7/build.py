"""C7 (P5) signs and pictograms: fit, raster + SVG, QC, manifest.  Run from bake/src:  $PY -m C7.build

Writes apps/f30_cluster/hud/baked/C7/*.png + svg/*.svg, bake/manifest/C7.json, bake/work/C7/* (fits, QC sheets,
A/B against the current WBSIGN shader). The report bake/report/C7.md is hand-written from the printed numbers.
"""
import json
import math
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
sys.path.insert(0, SRC)
from common import imageio  # noqa: E402
import qc  # noqa: E402
from C7 import icons as I  # noqa: E402

ROOT = os.path.abspath(os.path.join(SRC, "..", ".."))
OUT = os.path.join(ROOT, "apps/f30_cluster/hud/baked/C7")
WORK = os.path.join(ROOT, "bake/work/C7")
RECT = os.path.join(ROOT, "bake/work/rect")
MAN = os.path.join(ROOT, "bake/manifest/C7.json")

DIALS = {"C1": ((412.0, 380.0), 335.0), "C2": ((1508.0, 380.0), 335.0),
         "C3": ((80.0, 628.0), 70.0), "C4": ((1840.0, 628.0), 70.0)}

# --- the signs (12): measured centres (circle fits, panel px) and the proposed level, symmetric layout
SIGN_MEAS = {"limit": (347.96, 504.73), "noov": (470.12, 508.31)}
SIGN_DX = (SIGN_MEAS["noov"][0] - SIGN_MEAS["limit"][0]) / 2.0            # 61.08 px = 0.1823 R
SIGN_DY = (SIGN_MEAS["noov"][1] + SIGN_MEAS["limit"][1]) / 2.0 - 380.0     # 126.52 px = 0.3777 R
SIGN_PROP = {"limit": (412.0 - SIGN_DX, 380.0 + SIGN_DY), "noov": (412.0 + SIGN_DX, 380.0 + SIGN_DY)}


def ref(stem):
    return os.path.join(RECT, stem)


def tile_for(ops, pad=2):
    """Place icon ops (any local frame, already in panel units) into the smallest integer tile; -> (ops', x, y, w, h)."""
    x0, y0, x1, y1 = I.bbox(ops)
    tx, ty = int(math.floor(x0)) - pad, int(math.floor(y0)) - pad
    tw, th = int(math.ceil(x1)) + pad - tx, int(math.ceil(y1)) + pad - ty
    return I.transform(ops, dx=-tx, dy=-ty), tx, ty, tw, th


def place(base_ops, x, y, scale=1.0, rot=0.0, pivot=(0.0, 0.0)):
    """Local ops -> panel ops: scale/rotate about pivot (local), then put the local origin at panel (x, y)."""
    o = I.transform(base_ops, rot_deg=rot, pivot=pivot, scale=scale)
    return I.transform(o, dx=x - pivot[0] * scale, dy=y - pivot[1] * scale)


# ------------------------------------------------------------------------------------------------ fitting
def _ref_luma(stem):
    r = qc.load_ref(ref(stem), ignore_bits=8)
    L = r["rgb"] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    return L, r["valid"], r["box"], r["scale"]


def fit_place(base_ops, stem, x, y, scale=1.0, rot=0.0, pivot=(0.0, 0.0), grid_xy=3.0, step=0.5,
              scales=(1.0,), rots=(0.0,), pad=6):
    """Brute-force dx, dy, scale, rot maximising NCC of our luma (over black) vs the reference luma in the icon box."""
    L, valid, box, k = _ref_luma(stem)
    best = None
    for s in scales:
        for dr in rots:
            ops0 = place(base_ops, x, y, scale * s, rot + dr, pivot)
            for dy in np.arange(-grid_xy, grid_xy + 1e-6, step):
                for dx in np.arange(-grid_xy, grid_xy + 1e-6, step):
                    ops = I.transform(ops0, dx=dx, dy=dy)
                    t, tx, ty, tw, th = tile_for(ops, pad)
                    img = I.raster(t, tw, th, ss=4)
                    ours = img[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32) * img[..., 3]
                    i0, j0 = (tx - box[0]) * k, (ty - box[1]) * k
                    if k != 1:
                        ours = cv2.resize(ours, (tw * k, th * k), interpolation=cv2.INTER_LINEAR)
                    rr = L[j0:j0 + th * k, i0:i0 + tw * k]
                    vv = valid[j0:j0 + th * k, i0:i0 + tw * k]
                    if rr.shape != ours.shape or vv.sum() < 30:
                        continue
                    a, b = ours[vv], rr[vv]
                    a, b = a - a.mean(), b - b.mean()
                    ncc = float((a * b).sum() / math.sqrt((a * a).sum() * (b * b).sum() + 1e-12))
                    if best is None or ncc > best[0]:
                        best = (ncc, dx, dy, s, dr)
    return {"ncc": round(best[0], 4), "dx": float(best[1]), "dy": float(best[2]), "scale": float(scale * best[3]),
            "rot": float(rot + best[4]), "x": float(x + best[1]), "y": float(y + best[2])}


# ------------------------------------------------------------------------------------------------ WBSIGN port (A/B)
def wbsign_current(show=(1, 1)):
    """numpy port of shared/shaders.js WBSIGN at its layout (gen_6wb.py: x SP.x-100, y int(sy)-42, 200 x 84)."""
    W, H = 200, 84
    lx, ly = 412 - 100, int(380 + 0.36 * 335) - 42
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    R = 38.0
    c1, c2 = (W * 0.5 - 48.0, H * 0.5), (W * 0.5 + 48.0, H * 0.5)
    red = np.array([0.84, 0.05, 0.07], np.float32)
    col = np.zeros((H, W, 4), np.float32)

    def disc(c, r):
        return np.clip(r + 0.5 - np.hypot(xx - c[0], yy - c[1]), 0, 1)

    def rbox(qx, qy, c, h, r):
        ax, ay = np.abs(qx - c[0]) - (h[0] - r), np.abs(qy - c[1]) - (h[1] - r)
        d = np.hypot(np.maximum(ax, 0), np.maximum(ay, 0)) + np.minimum(np.maximum(ax, ay), 0) - r
        return np.clip(0.5 - d, 0, 1)

    if show[0]:
        a = disc(c1, R)
        inner = (np.hypot(xx - c1[0], yy - c1[1]) < R * 0.79)[..., None]
        s = np.where(inner, 0.95, red)
        col[..., :3] = np.where(a[..., None] > 0, s, col[..., :3]); col[..., 3] = a
    if show[1]:
        a = disc(c2, R)
        qx, qy = xx - c2[0], yy - c2[1]
        inner = (np.hypot(qx, qy) < R * 0.79)[..., None]
        s = np.where(inner, np.float32(0.95), red).astype(np.float32) * np.ones((H, W, 3), np.float32)
        l = np.maximum(rbox(qx, qy, (-8, 3), (11, 6.5), 3), rbox(qx, qy, (-8, -5), (7, 5), 3))
        r = np.maximum(rbox(qx, qy, (8, 3), (11, 6.5), 3), rbox(qx, qy, (8, -5), (7, 5), 3))
        field = np.clip(R * 0.79 - np.hypot(qx, qy) + 0.5, 0, 1)
        s = s + (np.array([0.80, 0.08, 0.10]) - s) * (l * field)[..., None]
        s = s + (np.array([0.06, 0.06, 0.07]) - s) * (r * field)[..., None]
        s = s + (0.95 - s) * (rbox(qx, qy, (8, -3), (4, 1.4), 0.8) * r * field)[..., None]
        m = a[..., None]
        col[..., :3] = col[..., :3] * (1 - m) + s * m
        col[..., 3] = np.maximum(col[..., 3], a)
    return col, lx, ly


# ------------------------------------------------------------------------------------------------ main
def write_icon(name, ops_panel, title, kind="albedo", ship=True):
    t, tx, ty, tw, th = tile_for(ops_panel)
    img = I.raster(t, tw, th, ss=8)
    d = OUT if ship else os.path.join(WORK, "unshipped")
    os.makedirs(os.path.join(d, "svg"), exist_ok=True)
    png = os.path.join(d, f"{name}.{kind}.png")
    imageio.write_png(png, img)
    with open(os.path.join(d, "svg", f"{name}.svg"), "w") as f:
        f.write(I.svg(t, tw, th, title))
    return png, img, tx, ty, tw, th


def dial_box(cluster, x, y, w, h):
    (cx, cy), R = DIALS[cluster]
    return {"cluster": cluster, "R_px": R, "u0": round((x - cx) / R, 4), "v0": round((y - cy) / R, 4),
            "u1": round((x + w - cx) / R, 4), "v1": round((y + h - cy) / R, 4)}


def ink_box(ops):
    x0, y0, x1, y1 = I.bbox(ops)
    return [round(x0, 2), round(y0, 2), round(x1 - x0, 2), round(y1 - y0, 2)]


def box_mask(path, boxes_keep, boxes_drop=()):
    m = np.zeros((720, 1920), np.uint8)
    for x, y, w, h in boxes_keep:
        m[int(y):int(math.ceil(y + h)), int(x):int(math.ceil(x + w))] = 255
    for x, y, w, h in boxes_drop:
        m[int(y):int(math.ceil(y + h)), int(x):int(math.ceil(x + w))] = 0
    cv2.imwrite(path, m)
    return path


def face_bg(stem, layers, roi):
    """QC only: a flat background = the reference's median colour in the ROI away from the icon (the face under a
    pictogram belongs to another package; comparing a white icon over pure black to a grey face is meaningless)."""
    r = qc.load_ref(ref(stem), ignore_bits=8)
    bx, by, bw, bh = r["box"]; k = r["scale"]
    m = qc.roi_mask(roi, r["box"], k, None) & r["valid"]
    ours = qc.compose(layers, r["box"], k)
    alpha = qc.compose([(np.dstack([np.ones_like(l[0][..., :3]) if not isinstance(l[0], str) else np.ones_like(imageio.read_png(l[0])[..., :3]),
                                    (l[0] if not isinstance(l[0], str) else imageio.read_png(l[0]))[..., 3:4]]), l[1], l[2], l[3]) for l in layers], r["box"], k)[..., 0]
    far = cv2.dilate((alpha > 0.03).astype(np.uint8), np.ones((5 * k, 5 * k), np.uint8)) == 0
    sel = m & far
    col = np.median(r["rgb"][sel], axis=0) if sel.sum() > 20 else np.zeros(3)
    x, y, w, h = [int(float(v)) for v in roi[4:].split(":")]
    t = np.zeros((h, w, 4), np.float32); t[..., :3] = col; t[..., 3] = 1.0
    return (t, x, y, 1.0), [round(float(c) * 255, 1) for c in col]


def run_qc(stem, layers, name, roi, ignore_bits=8, bg=False):
    bgc = None
    if bg:
        t, bgc = face_bg(stem, layers, roi)
        layers = [t] + list(layers)
    r = qc.run(ref(stem), layers, "C7", name + ("+face" if bg else ""), rois=[roi], ignore_bits=ignore_bits, want_edges=True)
    f = dict(r["fit"])
    f = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in f.items()}
    f.update({"ref": r["ref"], "roi": roi if not roi.startswith("mask:") else "mask:" + os.path.relpath(roi[5:], ROOT),
              "sheet": r.get("sheet", "")})
    f["_valid_px"] = r["metrics"].get("valid_px")
    if bgc is not None:
        f["qc_background_rgb"] = bgc
    return f


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    layers, qcs, fits = [], {}, {}

    # ---------------------------------------------------------------- signs (12, C1)
    sign_ops = {"limit": I.sign_base, "noov": I.sign_noov}
    titles = {"limit": "Speed limit sign: red ring, white field (the figure is live text)",
              "noov": "No overtaking sign: two cars, the left one red"}
    for nm in ("limit", "noov"):
        # QC at the photo's measured centre (the shape fit), ship at the proposed level, symmetric layout
        ops_meas = sign_ops[nm](SIGN_MEAS[nm])
        t, tx, ty, tw, th = tile_for(ops_meas)
        img_meas = I.raster(t, tw, th, ss=8)
        cx, cy = SIGN_MEAS[nm]
        keep = [(cx - 46, cy - 46, 92, 92)]
        drop = []
        if nm == "limit":
            bx, by, bw, bh = I.LIMIT_TEXT_BOX_2
            drop = [(cx + bx - 3, cy + by - 3, bw + 6, bh + 6)]
        mpath = box_mask(os.path.join(WORK, f"roi_sign_{nm}.png"), keep, drop)
        qcs[f"sign.{nm}"] = run_qc("12_speedo_signs_overspeed-wedge.comfort.C1", [(img_meas, tx, ty, 1.0)],
                                   f"sign.{nm}", "mask:" + mpath)
        png, img, x, y, w, h = write_icon(f"sign.{'speed-limit' if nm == 'limit' else 'no-overtaking'}",
                                          sign_ops[nm](SIGN_PROP[nm]), titles[nm])
        fits[nm] = {"tile": [x, y, w, h], "centre": [round(SIGN_PROP[nm][0], 2), round(SIGN_PROP[nm][1], 2)],
                    "png": png, "ops": sign_ops[nm](SIGN_PROP[nm])}
    # composed pair (both shown) vs 12, and the current WBSIGN for A/B
    pair_mask = box_mask(os.path.join(WORK, "roi_signs_pair.png"),
                         [(SIGN_MEAS["limit"][0] - 46, 455, SIGN_MEAS["noov"][0] - SIGN_MEAS["limit"][0] + 92, 100)],
                         [(SIGN_MEAS["limit"][0] + I.LIMIT_TEXT_BOX_2[0] - 3, SIGN_MEAS["limit"][1] + I.LIMIT_TEXT_BOX_2[1] - 3,
                           I.LIMIT_TEXT_BOX_2[2] + 6, I.LIMIT_TEXT_BOX_2[3] + 6)])
    pair_meas = []
    for nm in ("limit", "noov"):
        t, tx, ty, tw, th = tile_for(sign_ops[nm](SIGN_MEAS[nm]))
        pair_meas.append((I.raster(t, tw, th, ss=8), tx, ty, 1.0))
    qcs["signs.pair@photo"] = run_qc("12_speedo_signs_overspeed-wedge.comfort.C1", pair_meas, "signs.pair-at-photo-centres",
                                     "mask:" + pair_mask)
    qcs["signs.pair@proposed"] = run_qc("12_speedo_signs_overspeed-wedge.comfort.C1",
                                        [(fits[n]["png"], fits[n]["tile"][0], fits[n]["tile"][1], 1.0) for n in ("limit", "noov")],
                                        "signs.pair-proposed-layout", "mask:" + pair_mask)
    wb, wx, wy = wbsign_current()
    imageio.write_png(os.path.join(WORK, "AB_wbsign_current.png"), wb)
    qcs["signs.pair@WBSIGN-current"] = run_qc("12_speedo_signs_overspeed-wedge.comfort.C1", [(wb, wx, wy, 1.0)],
                                              "signs.pair-WBSIGN-current", "mask:" + pair_mask)

    # ---------------------------------------------------------------- mini-gauge pictograms
    jobs = [
        # name, cluster, base ops, start x, y (panel), rot, scales, fit ref, extra QC refs, ship, title
        ("mini.fuel-pump", "C3", I.icon_fuel(), 80 + 0.129 * 70, 628 - 0.800 * 70, 0.0,
         (0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25), "17_physical-cluster_full.comfort.C3",
         ["04_comfort_whole-cluster_mph.comfort.C3", "17_physical-cluster_full.comfort.C3@2x", "02_three-modes_clean-render.comfort.C3"],
         "Fuel pump with the filler-side triangle (fuel mini gauge)"),
        ("mini.oil-can", "C4", I.icon_oil(), 1840 - 0.343 * 70, 628 - 0.786 * 70, 0.0,
         (0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2), "04_comfort_whole-cluster_mph.comfort.C4",
         ["17_physical-cluster_full.comfort.C4", "07_physical-cluster_all-lamps-lit.comfort.C4"],
         "Oil can (oil temperature mini gauge)"),
        ("mini.coolant", "C4", I.icon_coolant(), 1840 - 0.371 * 70, 628 - 0.829 * 70, 0.0,
         (0.85, 0.9, 0.95, 1.0, 1.05), "02_three-modes_clean-render.comfort.C4", [],
         "Coolant temperature: thermometer over waves"),
        ("edyn.battery", "C2", I.icon_battery(), 1320.5, 608.8, 39.3,
         (0.9, 0.95, 1.0, 1.05), "17_physical-cluster_full.comfort.C2", [],
         "Battery (EfficientDynamics arc under the rev dial), rotated so its top faces the dial centre"),
        ("bar.range", None, I.icon_range(), 896.0, 645.0, 0.0, (0.95, 1.0, 1.05), "17_physical-cluster_full.comfort.PANEL", [],
         "Range: arrow + fuel pump (bottom info bar)"),
        ("bar.warning", None, I.icon_warning(), 681.0, 652.0, 0.0, (0.9, 0.95, 1.0, 1.05), "17_physical-cluster_full.comfort.PANEL",
         [], "Check-control warning triangle (bottom info bar)"),
    ]
    for name, cl, base, x, y, rot, scales, fref, xrefs, title in jobs:
        bx0, by0, bx1, by1 = I.bbox(base)
        pivot = ((bx0 + bx1) / 2, (by0 + by1) / 2) if rot else (0.0, 0.0)
        if rot:      # x, y given as the centre
            x, y = x - pivot[0], y - pivot[1]
            fp = fit_place(base, fref, x + pivot[0], y + pivot[1], 1.0, rot, pivot, grid_xy=3, step=0.5,
                           scales=scales, rots=(-6, -3, 0, 3, 6))
            ops = place(base, fp["x"], fp["y"], fp["scale"], fp["rot"], pivot)
        else:
            fp = fit_place(base, fref, x, y, 1.0, 0.0, (0.0, 0.0), grid_xy=4, step=0.5, scales=scales)
            ops = place(base, fp["x"], fp["y"], fp["scale"])
        png, img, tx, ty, tw, th = write_icon(name, ops, title)
        fits[name] = {"fit": fp, "tile": [tx, ty, tw, th], "png": png, "ops": ops, "ref": fref}
        roi = f"box:{tx - 3}:{ty - 3}:{tw + 6}:{th + 6}"
        qcs[name] = run_qc(fref, [(png, tx, ty, 1.0)], name, roi, bg=True)
        qcs[name + ":over-black"] = run_qc(fref, [(png, tx, ty, 1.0)], name, roi)
        for xr in xrefs:
            qcs[name + "@" + xr.split("_")[0]] = run_qc(xr, [(png, tx, ty, 1.0)], name, roi, bg=True)
        print(name, fp)

    # warning triangle, amber variant (07); same geometry
    w = fits["bar.warning"]
    amber = I.transform(I.icon_warning(I.WARN_AMBER), 0, 0, scale=w["fit"]["scale"])
    amber = I.transform(amber, dx=w["fit"]["x"], dy=w["fit"]["y"])
    write_icon("bar.warning-amber", amber, "Check-control warning triangle, amber")
    fits["bar.warning-amber"] = {"tile": w["tile"], "png": os.path.join(OUT, "bar.warning-amber.albedo.png"), "ops": amber}
    # its shape QC against 07 at 07's own position (the 07 PANEL window transform puts the bar elsewhere)
    s07 = "07_physical-cluster_all-lamps-lit.comfort.PANEL"
    fa = fit_place(I.icon_warning(I.WARN_AMBER), s07, 666.0, 663.0, grid_xy=4, step=0.5, scales=(0.85, 0.9, 0.95, 1.0, 1.05))
    t, tx, ty, tw, th = tile_for(place(I.icon_warning(I.WARN_AMBER), fa["x"], fa["y"], fa["scale"]))
    qcs["bar.warning-amber"] = run_qc(s07, [(I.raster(t, tw, th, ss=8), tx, ty, 1.0)], "bar.warning-amber",
                                      f"box:{tx - 3}:{ty - 3}:{tw + 6}:{th + 6}", bg=True)
    qcs["bar.warning-amber"]["fit_search_07"] = fa
    print("bar.warning-amber@07", fa)

    # seat belt: drawn, NOT shipped (BMW draws its own belt lamp on the G20)
    belt = place(I.icon_belt(), 137.0, 634.0)
    write_icon("unshipped.seat-belt", belt, "Seat belt (not shipped)", ship=False)

    # ---------------------------------------------------------------- contact sheet (ours at 4x)
    tiles = []
    for f in sorted(os.listdir(OUT)):
        if f.endswith(".png"):
            a = imageio.read_png(os.path.join(OUT, f))
            bg = np.zeros(a.shape[:2] + (3,), np.float32) + 0.06
            c = a[..., :3] * a[..., 3:4] + bg * (1 - a[..., 3:4])
            c = cv2.resize((c * 255).astype(np.uint8), None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
            tiles.append(np.pad(c, ((8, 8), (8, 8), (0, 0))))
    Hm = max(t.shape[0] for t in tiles)
    sheet = np.hstack([np.pad(t, ((0, Hm - t.shape[0]), (0, 0), (0, 0))) for t in tiles])
    cv2.imwrite(os.path.join(WORK, "contact_sheet_4x.png"), sheet[..., ::-1])

    # ---------------------------------------------------------------- manifest
    build_manifest(fits, qcs)
    json.dump(qcs, open(os.path.join(WORK, "qc_all.json"), "w"), indent=1)
    for k, v in qcs.items():
        print(f"{k:42s} ssim {v['ssim']}  dE {v['dE2000_mean']}  edge {v['edge_px_err']}  px {v['_valid_px']}")


def build_manifest(fits, qcs):
    def fitq(k):
        f = dict(qcs[k]); f.pop("_valid_px", None); return f

    L = []
    sources12 = ["12_speedo_signs_overspeed-wedge.png"]
    for nm, fid, z in (("limit", "speed-limit", 3.0), ("noov", "no-overtaking", 3.1)):
        x, y, w, h = fits[nm]["tile"]
        cx, cy = fits[nm]["centre"]
        p = {"centre_panel": [cx, cy], "centre_dial_C1_R": [round((cx - 412) / 335, 4), round((cy - 380) / 335, 4)],
             "r_out_R": round(I.SIGN_R_OUT / 335, 4), "r_in_R": round(I.SIGN_R_IN / 335, 4),
             "r_out_px": I.SIGN_R_OUT, "r_in_px": I.SIGN_R_IN, "field_over_out": round(I.SIGN_R_IN / I.SIGN_R_OUT, 3),
             "ring_rgb": I.SIGN_RED, "field_rgb": I.SIGN_WHITE,
             "photo_centre_panel": list(SIGN_MEAS[nm]),
             "ink_bbox_panel": ink_box(fits[nm]["ops"]),
             "ink_bbox_dial_C1_R": dial_box("C1", *ink_box(fits[nm]["ops"])),
             "visibility": "dynamic (data-driven): only the artwork is baked",
             "fit_note": "QC'd at the photo's measured centre; shipped tile is at the proposed level, symmetric centre"}
        if nm == "limit":
            bx, by, bw, bh = I.LIMIT_TEXT_BOX_2
            b3 = I.LIMIT_TEXT_BOX_3
            p["text_box_panel_2digits"] = [round(cx + bx, 2), round(cy + by, 2), bw, bh]
            p["text_box_panel_3digits"] = [round(cx + b3[0], 2), round(cy + b3[1], 2), b3[2], b3[3]]
            p["text_box_dial_C1_R_2digits"] = dial_box("C1", cx + bx, cy + by, bw, bh)
            p["text_box_dial_C1_R_3digits"] = dial_box("C1", cx + b3[0], cy + b3[1], b3[2], b3[3])
            p["text"] = {"cap_height_px": 30.0, "cap_height_R": round(30 / 335, 4), "colour": [0, 0, 0],
                         "centre_offset_px": [0.0, -1.2], "font": "live text (Arimo Bold in the theme), not baked"}
        else:
            p["cars"] = {"size_px": [25.0, 19.5], "centre_dx_px": [-I.CAR_DX, I.CAR_DX], "left_rgb": I.CAR_RED,
                         "right_rgb": I.CAR_DARK, "photo_dx_px": [-16.1, 14.9]}
        L.append({"id": f"sign.{fid}", "cluster": "C7", "z": z, "kind": "albedo", "class": "baked", "frame": "panel",
                  "x": x, "y": y, "w": w, "h": h, "scale": 1.0, "file": f"C7/sign.{fid}.albedo.png",
                  "bytes_by_8wh": imageio.bytes_by_8wh(w, h), "stack_below": [], "stack_above": [],
                  "sources": sources12, "evidence": "strong" if nm == "limit" else "ok", "light": {"dir_deg": 0, "key": 0},
                  "fit": fitq(f"sign.{nm}"), "params": p})
    meta = {
        "mini.fuel-pump": ("C3", 5.6, ["17_physical-cluster_full.png", "04_comfort_whole-cluster_mph.png", "02_three-modes_clean-render.png"], "ok"),
        "mini.oil-can": ("C4", 5.6, ["17_physical-cluster_full.png", "04_comfort_whole-cluster_mph.png", "07_physical-cluster_all-lamps-lit.png"], "ok"),
        "mini.coolant": ("C4", 5.7, ["02_three-modes_clean-render.png"], "weak"),
        "edyn.battery": ("C2", 5.6, ["17_physical-cluster_full.png"], "ok"),
        "bar.range": (None, 5.6, ["17_physical-cluster_full.png", "07_physical-cluster_all-lamps-lit.png"], "ok"),
        "bar.warning": (None, 5.7, ["17_physical-cluster_full.png", "07_physical-cluster_all-lamps-lit.png"], "ok"),
        "bar.warning-amber": (None, 5.71, ["07_physical-cluster_all-lamps-lit.png"], "weak"),
    }
    for name, (cl, z, src, ev) in meta.items():
        x, y, w, h = fits[name]["tile"]
        ib = ink_box(fits[name]["ops"])
        p = {"ink_bbox_panel": ib}
        if cl:
            p["ink_bbox_dial_" + cl + "_R"] = dial_box(cl, *ib)
        else:
            p["ink_bbox_window_frame_px"] = [round(ib[0] - 720, 2), round(ib[1] - 79, 2), ib[2], ib[3]]
            p["placement_note"] = ("measured in the 17 PANEL crop (window transform); the 6WB dial spacing differs from "
                                   "ours, so the x position in the bar is P4's call - the size and shape are the fit")
        if "fit" in fits[name]:
            p["fit_search"] = fits[name]["fit"]
        if name == "edyn.battery":
            (cx, cy) = (ib[0] + ib[2] / 2, ib[1] + ib[3] / 2)
            p["centre_dial_C2"] = {"r_R": round(math.hypot(cx - 1508, cy - 380) / 335, 4),
                                   "cw12_deg": round(math.degrees(math.atan2(cx - 1508, -(cy - 380))) % 360, 2)}
            p["rotation_note"] = "upright artwork rotated cw by fit_search.rot deg: its top faces the dial centre (tangent to the arc)"
        dyn = name.startswith("bar.warning")
        e = {"id": name, "cluster": "C7", "z": z, "kind": "albedo", "class": "dynamic" if dyn else "baked",
             "frame": "panel", "x": x, "y": y, "w": w, "h": h, "scale": 1.0, "file": f"C7/{name}.albedo.png",
             "bytes_by_8wh": imageio.bytes_by_8wh(w, h), "stack_below": [], "stack_above": [],
             "sources": src, "evidence": ev, "light": {"dir_deg": 0, "key": 0}, "params": p}
        if name in qcs:
            e["fit"] = fitq(name)
        if dyn:
            p["visibility"] = "dynamic (check-control state); artwork only"
            e["class"] = "baked"           # the artwork itself is static; its visibility is data-driven
        L.append(e)

    total = sum(e["bytes_by_8wh"] for e in L)
    man = {"cluster": "C7", "package": "P5", "mode": "all", "R": 335,
           "generator": "cd bake/src && $PY -m C7.build",
           "layers": L,
           "composition": {
               "images": [
                   {"file": "C7/sign.speed-limit.albedo.png", "from_ids": ["sign.speed-limit"], "x": L[0]["x"], "y": L[0]["y"],
                    "w": L[0]["w"], "h": L[0]["h"], "scale": 1.0, "bytes_by_8wh": L[0]["bytes_by_8wh"]},
                   {"file": "C7/sign.no-overtaking.albedo.png", "from_ids": ["sign.no-overtaking"], "x": L[1]["x"], "y": L[1]["y"],
                    "w": L[1]["w"], "h": L[1]["h"], "scale": 1.0, "bytes_by_8wh": L[1]["bytes_by_8wh"]}],
               "layer_count": 2,
               "bytes_by_8wh_total": L[0]["bytes_by_8wh"] + L[1]["bytes_by_8wh"],
               "notes": ("Signs: 2 own image layers (independent visibility), or 0 extra layers if WBSIGN stays the one "
                         "procedural effect layer with the new numbers (recommended: same look, one layer, 0 bytes). "
                         "Pictograms: no own layers - merge mini.fuel-pump into the C3 mini albedo (P3), mini.oil-can (or "
                         "mini.coolant) into C4, edyn.battery into the C6 EfficientDynamics arc image, bar.range into the "
                         "bottom-bar image (P4). bar.warning is check-control state: draw it only if the theme shows its own "
                         "check-control (BMW already draws telltales on the G20). All C7 files together: %d bytes." % total)},
           "open_questions": [
               "Signs: ship at the photo's centres (dx -3 px, the pair tilted 1.7 deg, as 12 shows after P0's roll fix) or level and symmetric about the hub (proposed, used for the files)? P0 levelled 12 on the floor edge; the signs then tilt by exactly the applied roll (-1.7 deg), so the roll fix may be wrong for this photo.",
               "Signs: keep WBSIGN procedural with the new numbers (1 layer, 0 bytes) or use the two PNGs (2 layers)? Recommended: WBSIGN with r 41.8 px (0.1248 R), field 0.811, centres +-61.08 px (+-0.1823 R), 0.3777 R below the hub, and the car shape from icons.car().",
               "Speed-limit figure: cap height 30 px (0.0896 R), 2 digits 37 px wide; 3-digit limits (100-130) need a condensed font or ~0.85 size to fit the 54 px box.",
               "Mini pictograms overlap P3's scope (C3/C4 pictograms as vectors): the lead should keep one set. Ours are fitted to 17 (fuel) and 04 (oil); 17 is bloomed, so its pump fits 15% larger than 04's.",
               "C4 shows oil temperature in every photo except the 02 render (coolant). Which does the theme need? Both are delivered.",
               "02 C3 shows a reserve pictogram at the bottom right and 02 C4 a blue 'cold' wave; 17/04 show the text '0' there instead. Not drawn (02 only, weak).",
               "bar.warning: BMW's own check-control/telltales already show on the G20; draw ours only if the theme has its own check-control row.",
               "Seat belt: drawn (bake/work/C7/unshipped/) but not shipped, because BMW draws its belt lamp over our panel (x 587-626, y 665-720)."],
           "notes": "Generic shapes fitted to the photos' proportions; no BMW artwork traced, no fonts. SVG twins in C7/svg/."}
    imageio.write_json(MAN, man) if hasattr(imageio, "write_json") else json.dump(man, open(MAN, "w"), indent=1)


if __name__ == "__main__":
    main()
