"""P4 / C5: map the 6WB window crops (6WB dial spacing) into OUR window frame for QC.

The 6WB dials sit closer together (17: 3.13 R apart, ours 3.27 R), so the window between them is narrower.
We stretch x about the panel centre (960) by k = our half gap / their half gap (gap = the space between the two
bezels, d/2 - R), keep y (same R, same dial centre height) and write a new rect-style ref base
(bake/work/C5/ref/<stem>.ours.C5.{png,maskbits.png,json}) that qc.py can load.

Mask bits added: 8 = inside our dials (r < 1.04 R) or inside the stretched 6WB dials (r < 1.06 R),
4 = BMW telltales (17), 16 = live text / icons in the bottom bar (top-hat blobs, dilated).
Run: cd bake/src && $PY -m C5.refs
"""
import json, os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import geom  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RECT = os.path.join(ROOT, "bake", "work", "rect")
OUT = os.path.join(ROOT, "bake", "work", "C5", "ref")
R = 335.0
CX_L, CX_R, CY = 412.0, 1508.0, 380.0
BOX = list(geom.crop_box("C5"))          # [680, 39, 560, 669]

# per source: the 6WB dial centres in its PANEL crop (from refs.json, mean affine) and its own masks (6WB frame)
SOURCES = {
    "17_physical-cluster_full": {
        "dials": [(435.3, 377.9), (1484.6, 382.1)],
        "ui_boxes": [(705, 80, 795, 152), (1145, 70, 1222, 150)],      # BMW telltales (steering, airbag)
        "text_band": (612, 692),
    },
    "04_comfort_whole-cluster_mph": {"dials": None, "ui_boxes": [], "text_band": None},
    "07_physical-cluster_all-lamps-lit": {"dials": None, "ui_boxes": [(700, 70, 800, 150), (1140, 70, 1220, 150)], "text_band": (584, 692)},
    "02_three-modes_clean-render": {"dials": None, "ui_boxes": [(860, 240, 1060, 560), (600, 560, 1300, 700)], "text_band": None},
}


def dial_centres(stem):
    refs = json.load(open(os.path.join(ROOT, "bake", "manifest", "refs.json")))
    sec = refs["images"][stem + ".png"]["sections"]["comfort"]
    A = np.array(json.load(open(os.path.join(RECT, stem + ".comfort.PANEL.json")))["A_photo_to_panel"])
    out = []
    for c in ("C1", "C2"):
        p = sec["dials"][c]["photo_centre"]
        out.append(tuple(A @ np.array([p[0], p[1], 1.0])))
    return out


def build(stem):
    cfg = SOURCES[stem]
    dl, dr = cfg["dials"] or dial_centres(stem)
    half = (dr[0] - dl[0]) / 2.0
    mid = (dr[0] + dl[0]) / 2.0
    k = (CX_R - CX_L) / 2.0 - R
    k = k / (half - R)
    img = cv2.imread(os.path.join(RECT, stem + ".comfort.PANEL.png"))
    bits_src = cv2.imread(os.path.join(RECT, stem + ".comfort.PANEL.maskbits.png"), cv2.IMREAD_GRAYSCALE)
    bx, by, bw, bh = BOX
    yy, xx = np.mgrid[0:bh, 0:bw].astype(np.float32)
    X = xx + bx + 0.5; Y = yy + by + 0.5
    xs = (mid + (X - 960.0) / k - 0.5).astype(np.float32)
    ys = (Y - 0.5).astype(np.float32)
    out = cv2.remap(img, xs, ys, cv2.INTER_LINEAR, borderValue=0)
    bits = cv2.remap(bits_src, xs, ys, cv2.INTER_NEAREST, borderValue=1)
    # telltales / UI (6WB frame boxes -> ours)
    six_x = xs + 0.5
    for (x0, y0, x1, y1) in cfg["ui_boxes"]:
        m = (six_x >= x0) & (six_x <= x1) & (Y >= y0) & (Y <= y1)
        bits[m] |= 4
    # live text / icons in the bottom bar: bright top-hat blobs, dilated
    if cfg["text_band"]:
        L = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY).astype(np.float32)
        th = cv2.morphologyEx(L, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (31, 31)))
        y0, y1 = cfg["text_band"]
        band = (Y >= y0) & (Y <= y1)
        red = (out[..., 2].astype(int) - out[..., 1].astype(int)) > 40
        t = ((th > 22) | red) & band
        t = cv2.dilate(t.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
        bits[t] |= 16
    # dials: ours (what our dial layers cover) and the stretched 6WB ones (their bezels / rims)
    for (cx, cy, rr) in [(CX_L, CY, 1.04), (CX_R, CY, 1.04),
                         (960 + (dl[0] - mid) * k, dl[1], 1.06), (960 + (dr[0] - mid) * k, dr[1], 1.06)]:
        bits[np.hypot(X - cx, Y - cy) < rr * R] |= 8
    os.makedirs(OUT, exist_ok=True)
    base = os.path.join(OUT, f"{stem}.ours.C5")
    cv2.imwrite(base + ".png", out)
    cv2.imwrite(base + ".maskbits.png", bits)
    cv2.imwrite(base + ".mask.png", ((bits == 0) * 255).astype(np.uint8))
    meta = {"image": f"reference/6wb/{stem}.png", "from": f"bake/work/rect/{stem}.comfort.PANEL.png",
            "box": BOX, "scale": 1, "x_stretch_k": round(k, 4), "six_wb_mid_x": round(mid, 2),
            "six_wb_dials": [list(map(lambda v: round(v, 1), dl)), list(map(lambda v: round(v, 1), dr))],
            "mapping": "x_ours = 960 + (x_6wb - mid) * k, y unchanged (k = our half gap / their half gap, gap = d/2 - R)",
            "bits": {"8": "inside our dials (r<1.04R) or the stretched 6WB dials (r<1.06R)", "4": "BMW telltales",
                     "16": "bar text / icons", "2": "glare (P0)", "1": "outside photo"}}
    json.dump(meta, open(base + ".json", "w"), indent=1)
    return base, k


if __name__ == "__main__":
    for s in (sys.argv[1:] or ["17_physical-cluster_full", "04_comfort_whole-cluster_mph", "07_physical-cluster_all-lamps-lit"]):
        print(s, build(s))
