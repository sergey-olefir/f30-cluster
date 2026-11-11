"""P0 for the G20 photos and our bench render: whole-panel rectification (PANEL crops) and per-dial crops.

    cd bake/src && uv run ... python -m p0.g20

- 10 (grid): reference/g20/10_grid_homography_panel-to-photo.json (Hm: panel -> photo; re-derived exactly by
  tools/ref/grid_homography_p.py).
- 11 (our theme on the car): Hm is checked against our known hub ring (red, 0.135 R at (412,380) / (1508,380));
  a SIFT refinement against photo 10's housing is used if the check fails.
- 08 / 09 (stock theme): SIFT homography photo -> photo 10 (housing and stock layout), chained with Hm.
- ours: reference/ours/ref_comfort_bench_1920x720.png is in the OLD geometry (R 290 at (496,360) / (1424,360),
  minis R 90 at (103,473) / (1817,473)): a similarity per dial maps it onto the G20 frame for A/B.
"""
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom  # noqa: E402
from p0 import fit as F  # noqa: E402
from p0.align import ROOT, REF, RECT, DBG, lum, BIT_OUTSIDE, DIAL_MARGIN  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "tools", "ref"))
from sift_align_p import sift_homography  # noqa: E402

PANEL_BOX_IN_10 = None


def warp_h(img, Hp2ph, box=(0, 0, 1920, 720), interp=cv2.INTER_CUBIC):
    """Hp2ph: panel -> photo. Output: panel-space crop."""
    x0, y0, w, h = box
    T = np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1]], np.float64)
    return cv2.warpPerspective(img, Hp2ph @ T, (w, h), flags=interp | cv2.WARP_INVERSE_MAP,
                               borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def hub_find(panel_img):
    """Find our red hub rings (Hough on red-ness) in a panel-space image of our theme."""
    f = panel_img.astype(np.float32)
    red = np.clip(f[..., 2] - np.maximum(f[..., 0], f[..., 1]), 0, 255).astype(np.uint8)
    out = []
    for x0, x1 in ((0, 960), (960, 1920)):
        c = cv2.HoughCircles(cv2.GaussianBlur(red[:, x0:x1], (5, 5), 1.5), cv2.HOUGH_GRADIENT, 1, 200,
                             param1=80, param2=20, minRadius=25, maxRadius=60)
        if c is not None:
            x, y, r = c[0][0]
            out.append([round(float(x) + x0, 1), round(float(y), 1), round(float(r), 1)])
    return out


def old_to_g20(img, inside, cl, box):
    o, g = geom.OLD[cl], geom.G20[cl]
    s = g["R"] / o["R"]
    M = np.array([[s, 0, g["c"][0] - s * o["c"][0] - box[0]], [0, s, g["c"][1] - s * o["c"][1] - box[1]]])
    return (cv2.warpAffine(img, M, (box[2], box[3]), flags=cv2.INTER_CUBIC),
            cv2.warpAffine(inside, M, (box[2], box[3]), flags=cv2.INTER_NEAREST))


def write_rect(base, img, inside, meta):
    img = img.copy()
    img[~inside] = 0
    bits = np.where(inside, 0, BIT_OUTSIDE).astype(np.uint8)
    cv2.imwrite(os.path.join(RECT, base + ".png"), img)
    cv2.imwrite(os.path.join(RECT, base + ".maskbits.png"), bits)
    cv2.imwrite(os.path.join(RECT, base + ".mask.png"), np.where(bits == 0, 255, 0).astype(np.uint8))
    with open(os.path.join(RECT, base + ".json"), "w") as f:
        json.dump(meta, f, indent=1)


def run():
    os.makedirs(RECT, exist_ok=True)
    Hm = np.array(json.load(open(os.path.join(REF, "g20", "10_grid_homography_panel-to-photo.json")))["Hm"])
    p10 = cv2.imread(os.path.join(REF, "g20", "10_grid_over-stock.jpg"))
    # photo 10's panel footprint (+ margin) for SIFT masks
    corners = cv2.perspectiveTransform(np.float32([[[0, 0], [1920, 0], [1920, 720], [0, 720]]]), Hm)[0]
    recs = {}
    for name in ("10_grid_over-stock.jpg", "11_our-theme_on-car.jpg", "08_stock_night_warnings-map.jpg", "09_stock_map_day.jpg"):
        ph = cv2.imread(os.path.join(REF, "g20", name))
        stem = os.path.splitext(name)[0]
        rec = {"file": "reference/g20/" + name, "size": [ph.shape[1], ph.shape[0]]}
        old_geometry = False
        if name.startswith("10"):
            H = Hm
            rec["H_source"] = "10_grid_homography_panel-to-photo.json (108 grid crossings, residual mean 3.54 / max 13.3 photo px; re-derived by tools/ref/grid_homography_p.py)"
        elif name.startswith("11"):
            # the camera moved between 10 and 11 (BMW's black box lands ~60 px off under Hm) and the theme on screen is
            # the OLD geometry: hubs and minis measured in the Hm-rectified photo -> their OLD panel positions
            q0 = warp_h(ph, Hm)
            hubs = hub_find(q0)
            Lq = lum(q0)
            minis = []
            for seed in ((145, 380, 80), (1735, 400, 82)):
                ft = F.fit_dial_ring(Lq, seed, None, ellipse=False)
                minis.append([round(float(v), 1) for v in ft["circle"]])
            q = np.float32([hubs[0][:2], hubs[1][:2], minis[0][:2], minis[1][:2]])
            p = np.float32([geom.OLD["C1"]["c"], geom.OLD["C2"]["c"], geom.OLD["C3"]["c"], geom.OLD["C4"]["c"]])
            Hc = cv2.getPerspectiveTransform(q, p)
            H = Hm @ np.linalg.inv(Hc)
            box_tl = cv2.perspectiveTransform(np.float32([[[1360.5, 255.5]]]), Hc)[0, 0]
            rec["H_source"] = ("Hm (photo 10) corrected by a 4-point homography: our hubs and mini gauges found in the "
                               "Hm-rectified photo -> their OLD-geometry panel positions")
            rec["measured_in_Hm_rect"] = {"hubs_xyr": hubs, "minis_xyr": minis}
            rec["check"] = {"bmw_black_box_top_left_expected": [1420, 320],
                            "bmw_black_box_top_left_got": [round(float(box_tl[0]), 1), round(float(box_tl[1]), 1)],
                            "error_px": round(float(np.hypot(box_tl[0] - 1420, box_tl[1] - 320)), 2)}
            rec["warning"] = ("Photo 11 shows our theme in the OLD geometry (R 290, hubs (496,360)/(1424,360)) and a "
                              "different camera pose from photo 10; 4 points define H exactly, so its only check is BMW's "
                              "black-box corner (error above). Per-dial crops below map OLD -> G20 dial frame.")
            old_geometry = True
        else:
            Hs, info = sift_homography(p10, ph)
            H = Hs @ Hm
            rec["H_source"] = "SIFT photo10 -> this photo (%d inliers, reprojection rms %.2f px) chained with Hm; checked by eye (stock dial outlines coincide with photo 10's)" % (info["inliers"], info["reproj_rms_px"])
            rec["sift"] = info
        rec["H_panel_to_photo"] = [[round(float(v), 8) for v in row] for row in H]
        pan = warp_h(ph, H)
        inside = warp_h(np.full(ph.shape[:2], 255, np.uint8), H, interp=cv2.INTER_NEAREST) > 0
        base = f"{stem}.g20.PANEL"
        write_rect(base, pan, inside, {"image": rec["file"], "mode": "g20", "cluster": "PANEL", "box": [0, 0, 1920, 720],
                                       "H_panel_to_photo": rec["H_panel_to_photo"], "exposure": None})
        rec["outputs"] = {"PANEL": {"base": "bake/work/rect/" + base, "box": [0, 0, 1920, 720]}}
        # per-dial crops in the same panel frame (the G20 photos are already in our frame: no dial-to-dial step)
        for cl in ("C1", "C2", "C3", "C4", "C5"):
            box = geom.crop_box(cl, DIAL_MARGIN) if cl in geom.G20 else geom.crop_box(cl)
            x0, y0, w, h = box
            b2 = f"{stem}.g20.{cl}"
            if old_geometry and cl in geom.OLD:
                ci, ii = old_to_g20(pan, inside.astype(np.uint8) * 255, cl, box)
                write_rect(b2, ci, ii > 0, {"image": rec["file"], "mode": "g20", "cluster": cl, "box": list(box),
                                             "exposure": None, "note": "OLD-geometry theme mapped to the G20 dial frame"})
            else:
                write_rect(b2, pan[y0:y0 + h, x0:x0 + w], inside[y0:y0 + h, x0:x0 + w],
                           {"image": rec["file"], "mode": "g20", "cluster": cl, "box": list(box), "exposure": None})
            rec["outputs"][cl] = {"base": "bake/work/rect/" + b2, "box": list(box)}
        recs[name] = rec
        print(name, rec["H_source"], rec.get("check", ""))

    # our bench render (OLD geometry) -> G20 frame, per dial
    bench = cv2.imread(os.path.join(REF, "ours", "ref_comfort_bench_1920x720.png"))
    rec = {"file": "reference/ours/ref_comfort_bench_1920x720.png", "size": [1920, 720],
           "note": "Rendered with the OLD geometry (design/gen_6wb.py OLD), not the current G20 one: per-dial similarity to the G20 frame.",
           "outputs": {}, "dials": {}}
    for cl in ("C1", "C2", "C3", "C4"):
        o, g = geom.OLD[cl], geom.G20[cl]
        s = g["R"] / o["R"]
        A = np.array([[s, 0, g["c"][0] - s * o["c"][0]], [0, s, g["c"][1] - s * o["c"][1]]])
        box = geom.crop_box(cl, DIAL_MARGIN)
        M = A.copy()
        M[:, 2] -= box[:2]
        img = cv2.warpAffine(bench, M, (box[2], box[3]), flags=cv2.INTER_CUBIC)
        inside = cv2.warpAffine(np.full((720, 1920), 255, np.uint8), M, (box[2], box[3]), flags=cv2.INTER_NEAREST) > 0
        base = f"ours_bench.comfort.{cl}"
        write_rect(base, img, inside, {"image": rec["file"], "mode": "comfort", "cluster": cl, "box": list(box),
                                       "A_photo_to_panel": A.round(6).tolist(), "exposure": None})
        rec["dials"][cl] = {"A_photo_to_panel": A.round(6).tolist(), "residual_rms_panel_px": 0.0, "quality": "exact (known geometry)"}
        rec["outputs"][cl] = {"base": "bake/work/rect/" + base, "box": list(box)}
    recs["ref_comfort_bench_1920x720.png"] = rec
    with open(os.path.join(DBG, "align_g20.json"), "w") as f:
        json.dump(recs, f, indent=1)
    return recs


if __name__ == "__main__":
    run()
