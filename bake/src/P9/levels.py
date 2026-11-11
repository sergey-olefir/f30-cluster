"""P9 level check: is the centre window (P4, fitted to 17) consistent with the dial faces (P1 / P2, from 05 / 04)?
Compares, inside ONE photo (P0's normalised crops: one black / gain per photo, so ratios are the photo's own with its
black level removed), the window background luma with the face luma,
and the same ratio in our composed panel."""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import geom  # noqa: E402

RECT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "work", "rect")
PHOTOS = ["17_physical-cluster_full.comfort", "04_comfort_whole-cluster_mph.comfort",
          "07_physical-cluster_all-lamps-lit.comfort", "03_three-modes_photo_bimmerstop.comfort",
          "06_comfort_wide_with-wheel.comfort", "02_three-modes_clean-render.comfort"]
# window background (above the sky ramp, below the top rim) and the floor bars, panel px
WIN_BG = (790, 120, 340, 250)            # x, y, w, h
WIN_FLOOR = (800, 470, 320, 110)
# the face: between the inner-disc edge (0.49 R) and the numerals (~0.70 R), upper half, both dials
FACE_RING, FACE_ANG = (0.53, 0.63), (285.0, 150.0)       # cw12 start, span
DISC_RING = (0.36, 0.46)


def luma(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def _load(base, raw=False):
    meta = json.load(open(os.path.join(RECT, base + ".json")))
    p = os.path.join(RECT, base + (".raw.png" if raw and os.path.exists(os.path.join(RECT, base + ".raw.png")) else ".png"))
    img = cv2.imread(p, cv2.IMREAD_COLOR)[..., ::-1].astype(np.float32)
    bp = os.path.join(RECT, base + ".maskbits.png")
    bits = cv2.imread(bp, cv2.IMREAD_GRAYSCALE) if os.path.exists(bp) else np.zeros(img.shape[:2], np.uint8)
    return img, bits, meta["box"], int(meta.get("scale", 1))


def ring_sel(shape, box, k, cl, r, ang=None):
    g = geom.G20[cl]
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    X, Y = box[0] + (xx + 0.5) / k, box[1] + (yy + 0.5) / k
    u, v = (X - g["c"][0]) / g["R"], (Y - g["c"][1]) / g["R"]
    rr = np.hypot(u, v)
    m = (rr >= r[0]) & (rr <= r[1])
    if ang:
        a = np.degrees(np.arctan2(u, -v)) % 360
        m &= ((a - ang[0]) % 360) <= ang[1]
    return m


def box_sel(shape, box, k, b):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    X, Y = box[0] + (xx + 0.5) / k, box[1] + (yy + 0.5) / k
    return (X >= b[0]) & (X < b[0] + b[2]) & (Y >= b[1]) & (Y < b[1] + b[3])


def stat(img, sel):
    v = luma(img)[sel]
    return None if v.size < 50 else round(float(np.median(v)), 2)


def measure_photo(ph):
    out = {}
    for cl in ("C1", "C2"):
        b = f"{ph}.{cl}"
        if not os.path.exists(os.path.join(RECT, b + ".json")):
            continue
        img, bits, box, k = _load(b)
        ok = (bits & 31) == 0
        out[f"face_{cl}"] = stat(img, ok & ring_sel(img.shape[:2], box, k, cl, FACE_RING, FACE_ANG))
        out[f"disc_{cl}"] = stat(img, ok & ring_sel(img.shape[:2], box, k, cl, DISC_RING, FACE_ANG))
    b = f"{ph}.C5"
    if os.path.exists(os.path.join(RECT, b + ".json")):
        img, bits, box, k = _load(b)
        ok = (bits & 31) == 0
        out["window_bg"] = stat(img, ok & box_sel(img.shape[:2], box, k, WIN_BG))
        out["window_floor"] = stat(img, ok & box_sel(img.shape[:2], box, k, WIN_FLOOR))
    f = [v for kk, v in out.items() if kk.startswith("face_") and v is not None]
    if f and out.get("window_bg") is not None:
        out["face_mean"] = round(float(np.mean(f)), 2)
        out["ratio_window_over_face"] = round(out["window_bg"] / max(out["face_mean"], 0.5), 2)
        out["diff_window_minus_face"] = round(out["window_bg"] - out["face_mean"], 2)
    return out


def measure_ours(rgb01):
    """rgb01: our composed panel (720, 1920, 3) 0..1."""
    img = rgb01 * 255.0
    box, k, out = [0, 0, 1920, 720], 1, {}
    for cl in ("C1", "C2"):
        out[f"face_{cl}"] = stat(img, ring_sel(img.shape[:2], box, k, cl, FACE_RING, FACE_ANG))
        out[f"disc_{cl}"] = stat(img, ring_sel(img.shape[:2], box, k, cl, DISC_RING, FACE_ANG))
    out["window_bg"] = stat(img, box_sel(img.shape[:2], box, k, WIN_BG))
    out["window_floor"] = stat(img, box_sel(img.shape[:2], box, k, WIN_FLOOR))
    out["face_mean"] = round(float(np.mean([out["face_C1"], out["face_C2"]])), 2)
    out["ratio_window_over_face"] = round(out["window_bg"] / max(out["face_mean"], 0.5), 2)
    out["diff_window_minus_face"] = round(out["window_bg"] - out["face_mean"], 2)
    return out


def run(ours_rgb):
    res = {"photos": {ph: measure_photo(ph) for ph in PHOTOS}, "ours": measure_ours(ours_rgb),
           "regions": {"window_bg_box": WIN_BG, "window_floor_box": WIN_FLOOR, "face_ring_R": FACE_RING,
                       "face_angles_cw12": FACE_ANG, "disc_ring_R": DISC_RING,
                       "note": "exposure-normalised crops (P0: black -> 0, one exposure per photo, so the ratio is the photo's own), sRGB code-value luma, medians, mask bits 31 out"}}
    # proposed window gain: make our window/face ratio match the photos' median ratio (photos with a window crop)
    rs = [v["ratio_window_over_face"] for v in res["photos"].values() if v.get("ratio_window_over_face")]
    if rs:
        target = float(np.median(rs))
        res["target_ratio_median"] = round(target, 2)
        res["proposed_window_gain"] = round(target / res["ours"]["ratio_window_over_face"], 3)
    return res
