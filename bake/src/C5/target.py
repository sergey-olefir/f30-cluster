"""C5 redo: each 6WB reference's middle as FINAL PANEL VALUES (the new colour rule, BAKE-P10-levels.md 3/4).

For one reference:
  1. take its raw PANEL crop (the photo's own code values, no P0 step) and stretch x into OUR frame like C5.refs
     (x about 960 by k = our half gap / their half gap; y unchanged);
  2. measure its LOCAL floor at the middle: the median of the unlit sky plateau just above the sky glow
     (panel y 340..392, |X| < 150). In 02 (render) that plateau equals the render's own navy black (the background
     outside the dials); in the photos it is the LCD floor plus the local veiling glare. It is checked against the bar
     body where that is clean (03: 12/13/16 against a plateau of 12/13/17);
     Below the horizon the floor is let grow (linearly in linear light) toward the bar body's dark field (its p20,
     panel y 622..642, |X| 90..210), measured the same way: 04 and 06 carry a grey haze over the lower middle that
     reaches into the bar (03 and the 02 render have the bar black), so their floor bars sit on a pedestal;
  3. convert to linear light above that floor relative to the reference's white numerals (P0's white, raw code):
        L = (lin(raw) - lin(F)) / (lin(W) - lin(F)),  clipped at 0
  4. re-encode as panel code with the numerals at the theme's text white fg (244, 246, 250):
        panel = srgb(L * lin(fg)).
Writes bake/work/C5/ref/<stem>.panel.C5.{png,maskbits.png,mask.png,json} (a qc.py ref base) and returns the arrays.
    cd bake/src && ./P9/py.sh -m C5.target [stems...]
"""
import json, os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import geom  # noqa: E402
from P10 import levels as LV  # noqa: E402
from C5 import refs as C5refs  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RECT = os.path.join(ROOT, "bake", "work", "rect")
OUT = os.path.join(ROOT, "bake", "work", "C5", "ref")
FG = np.array([244.0, 246.0, 250.0])           # shared/hud_themes.js wb_comfort.fg: the theme's text white
BOX = list(geom.crop_box("C5"))                 # [680, 39, 560, 669]
R, CX_L, CX_R = 335.0, 412.0, 1508.0
PLATEAU = (340, 392, 150)                       # y0, y1, |X| max (panel px, our frame)
PLATEAU_BY = {"02_three-modes_clean-render": (150, 250, 200)}   # 02's own floor sits higher (horizon 441): its glow starts at ~375

STEMS = ["02_three-modes_clean-render", "04_comfort_whole-cluster_mph", "03_three-modes_photo_bimmerstop",
         "07_physical-cluster_all-lamps-lit", "06_comfort_wide_with-wheel", "17_physical-cluster_full"]
# bar-text / telltale / scene-content masks per reference (in OUR frame, panel px): x0, y0, x1, y1
EXTRA_MASK = {
    "02_three-modes_clean-render": [(850, 230, 1070, 540), (680, 562, 1240, 708)],     # the car + "Fasten seatbelt"
    "03_three-modes_photo_bimmerstop": [(680, 640, 1240, 708)],                       # bar texts
    "07_physical-cluster_all-lamps-lit": [(680, 616, 1240, 708), (680, 39, 800, 150), (1120, 39, 1240, 150)],
    "17_physical-cluster_full": [(680, 616, 1240, 708), (680, 39, 800, 150), (1120, 39, 1240, 150)],
    "04_comfort_whole-cluster_mph": [],
    "06_comfort_wide_with-wheel": [],
}


# y into OUR frame: (the sky glow's crisp bottom edge, the front line's centre) in the reference -> (458, 608.8).
# 04 / 06 have no front line (no bar content): 03's depth (152 px) is used. 02 (the car scene) has its own, shorter
# floor (horizon 442.5, line 559): it is left unmapped and used for levels / colour only.
H_OURS, F_OURS = 458.0, 608.8
YMAP = {"04_comfort_whole-cluster_mph": (463.3, 615.4), "03_three-modes_photo_bimmerstop": (464.5, 616.6),
        "06_comfort_wide_with-wheel": (466.5, 618.6), "07_physical-cluster_all-lamps-lit": (458.0, 617.3),
        "17_physical-cluster_full": (457.5, 608.6)}


def ymap(stem, Y):
    if stem not in YMAP:
        return Y
    h, f = YMAP[stem]
    return h + (Y - H_OURS) * (f - h) / (F_OURS - H_OURS)


def centres(stem):
    cfg = C5refs.SOURCES.get(stem, {})
    return (cfg.get("dials") or C5refs.dial_centres(stem))


def stretch(stem):
    dl, dr = centres(stem)
    half, mid = (dr[0] - dl[0]) / 2.0, (dr[0] + dl[0]) / 2.0
    k = ((CX_R - CX_L) / 2.0 - R) / (half - R)
    raw = cv2.imread(os.path.join(RECT, stem + ".comfort.PANEL.raw.png"))
    bits = cv2.imread(os.path.join(RECT, stem + ".comfort.PANEL.maskbits.png"), cv2.IMREAD_GRAYSCALE)
    bx, by, bw, bh = BOX
    yy, xx = np.mgrid[0:bh, 0:bw].astype(np.float32)
    X = xx + bx + 0.5; Y = yy + by + 0.5
    xs = (mid + (X - 960.0) / k - 0.5).astype(np.float32)
    ys = (ymap(stem, Y) - 0.5).astype(np.float32)
    img = cv2.remap(raw, xs, ys, cv2.INTER_LINEAR, borderValue=0)[..., ::-1].astype(np.float64)
    b = cv2.remap(bits, xs, ys, cv2.INTER_NEAREST, borderValue=1)
    for (cx, cy, rr) in [(CX_L, 380.0, 1.04), (CX_R, 380.0, 1.04),
                         (960 + (dl[0] - mid) * k, dl[1], 1.06), (960 + (dr[0] - mid) * k, dr[1], 1.06)]:
        b[np.hypot(X - cx, Y - cy) < rr * R] |= 8
    for (x0, y0, x1, y1) in EXTRA_MASK.get(stem, []):
        b[(X >= x0) & (X <= x1) & (Y >= y0) & (Y <= y1)] |= 16
    return img, b, X, Y, k


def white(stem):
    bl, g, wb = LV.p0(stem)
    return np.minimum(LV.WHITE_TARGET / (g * wb) + bl, 255.0)


def local_floor(img, X, Y, bits, stem=""):
    y0, y1, xm = PLATEAU_BY.get(stem, PLATEAU)
    m = (Y >= y0) & (Y <= y1) & (np.abs(X - 960) < xm) & (bits == 0)
    return np.median(img[m], 0)


BAR = (622, 642, 90, 210)                       # y0, y1, |X| from, to: the bar body's dark field (p20: skips text)


def bar_floor(img, X, Y, bits):
    y0, y1, xa, xb = BAR
    ax = np.abs(X - 960)
    m = (Y >= y0) & (Y <= y1) & (ax >= xa) & (ax <= xb) & ((bits & 0x0F) == 0)
    v = img[m]
    lum = v @ np.array([0.2126, 0.7152, 0.0722])
    return np.median(v[lum <= np.percentile(lum, 20)], 0)


def floor_field(Ft, Fb, Y, y_top=392.0, y_bot=632.0):
    """The local floor per row: the sky plateau (Ft) down to y_top, the bar body (Fb) from y_bot, linear in linear
    light between them (the veiling glare / haze grows toward the bright floor and the bottom of the lens)."""
    t = np.clip((Y - y_top) / (y_bot - y_top), 0.0, 1.0)[..., None]
    return LV.l2s(LV.s2l(Ft) * (1 - t) + LV.s2l(Fb) * t)


def to_panel(raw, F, W):
    L = (LV.s2l(raw) - LV.s2l(F)) / np.maximum(LV.s2l(W) - LV.s2l(F), 1e-6)
    return LV.l2s(np.maximum(L, 0.0) * LV.s2l(FG)), L


def build(stem, write=True):
    img, bits, X, Y, k = stretch(stem)
    F = local_floor(img, X, Y, bits, stem)
    Fb = bar_floor(img, X, Y, bits)
    W = white(stem)
    pan, L = to_panel(img, floor_field(F, Fb, Y), W)
    # live text / icons in the bar (below the front line): bright blobs, dilated -> bit 16
    lum = pan @ np.array([0.2126, 0.7152, 0.0722])
    txt = (lum > 45) & (Y > F_OURS + 5)
    txt = cv2.dilate(txt.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
    bits[txt] |= 16
    meta = {"from": f"bake/work/rect/{stem}.comfort.PANEL.raw.png", "box": BOX, "scale": 1, "x_stretch_k": round(k, 4),
            "local_floor_raw_rgb": F.round(1).tolist(), "bar_floor_raw_rgb": Fb.round(1).tolist(), "white_raw_rgb": np.round(W, 1).tolist(),
            "fg_panel": FG.tolist(), "y_map_horizon_front": YMAP.get(stem),
            "method": "panel = srgb(L * lin(fg)), L = (lin(raw) - lin(F)) / (lin(W) - lin(F)), F = median sky plateau "
                      "y 340..392 |X|<150 (our frame)"}
    if write:
        os.makedirs(OUT, exist_ok=True)
        base = os.path.join(OUT, f"{stem}.panel.C5")
        cv2.imwrite(base + ".png", np.clip(np.round(pan[..., ::-1]), 0, 255).astype(np.uint8))
        cv2.imwrite(base + ".maskbits.png", bits)
        cv2.imwrite(base + ".mask.png", ((bits == 0) * 255).astype(np.uint8))
        json.dump(meta, open(base + ".json", "w"), indent=1)
    return {"panel": pan, "L": L, "bits": bits, "X": X, "Y": Y, "F": F, "W": W, "Fb": Fb, "k": k, "raw": img}


if __name__ == "__main__":
    for s in (sys.argv[1:] or STEMS):
        r = build(s)
        print(s[:2], "k", round(r["k"], 3), "F", r["F"].round(1), "Fbar", r["Fb"].round(1), "W", np.round(r["W"], 1))
