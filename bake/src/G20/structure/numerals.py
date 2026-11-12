"""Dial numerals: measured ink boxes on the rects, the stock-cluster font chosen by package C (FONT.json; Arimo if
absent), weight/width/size/position fitted to the photo's ink -> params/numerals.json; rendering helper.

Fit: for each numeral the digit height sets the font size, the ink box centre the position; one weight and one
width for all dial numerals (and one for the small 'km/h') are chosen by maximising the mean IoU of the blurred
ink masks over a grid.
"""
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

import lib

# text, search box (panel px, generous), photo it is measured on
ITEMS = [
    ("speedo", "20", (252, 540, 309, 584), "08"), ("speedo", "40", (170, 430, 235, 488), "08"),
    ("speedo", "60", (120, 312, 186, 370), "08"), ("speedo", "100", (205, 195, 288, 255), "08"),
    ("speedo", "140", (322, 112, 406, 168), "08"), ("speedo", "200", (475, 77, 562, 130), "08"),
    ("speedo", "260", (648, 62, 735, 116), "08"), ("speedo", "0", (362, 565, 402, 620), "08"),
    ("speedo", "km/h", (400, 582, 482, 618), "08"),
    ("tacho", "1", (1641, 544, 1671, 590), "08"), ("tacho", "2", (1712, 436, 1747, 482), "08"),
    ("tacho", "3", (1763, 314, 1804, 368), "08"), ("tacho", "4", (1676, 197, 1717, 248), "08"),
    ("tacho", "5", (1546, 112, 1588, 166), "08"), ("tacho", "6", (1376, 72, 1418, 126), "08"),
    ("tacho", "7", (1196, 62, 1236, 116), "08"), ("tacho", "0", (1513, 569, 1551, 615), "09"),
]


def font_file():
    try:
        j = lib.read_json(lib.FONT_JSON)
        p = lib.os.path.join(lib.WT, "bench", "g20", j["file"])
        if lib.os.path.exists(p):
            return p, j.get("family", "?"), "FONT.json (package C)"
    except Exception:
        pass
    # FONT.json lives in the git-ignored bake/work and may be gone: the font the fit was made with is recorded in
    # params/numerals.json (rendering with another font would change every numeral's shape)
    try:
        j = lib.read_json(lib.os.path.join(lib.PARAMS, "numerals.json"))
        p = lib.os.path.join(lib.WT, j["font_file"])
        if lib.os.path.exists(p):
            return p, j.get("family", "?"), j.get("font_source", "params/numerals.json")
    except Exception:
        pass
    return lib.FONT_FALLBACK, "Arimo", "fallback (FONT.json absent)"


_FONTS = {}


def get_font(size_px, wght, wdth):
    path, _, _ = font_file()
    key = (path, round(size_px * 4) / 4, wght, wdth)
    if key not in _FONTS:
        f = ImageFont.truetype(path, max(4, int(round(size_px))))
        axes = f.get_variation_axes()
        vals = []
        for a in axes:
            n = a["name"].decode() if isinstance(a["name"], bytes) else str(a["name"])
            vals.append(wght if n.lower().startswith("weight") else (wdth if n.lower().startswith("width") else a["default"]))
        f.set_variation_by_axes(vals)
        _FONTS[key] = f
    return _FONTS[key]


def render_text(text, size_px, wght, wdth, ss=4):
    """-> coverage (float, at 1x after ss downsampling), the ink bbox (x0,y0,x1,y1) in that raster, and the
    raster origin offset. The text is drawn at a big ss scale for accuracy."""
    f = get_font(size_px * ss, wght, wdth)
    w = int(size_px * ss * (len(text) + 2))
    h = int(size_px * ss * 2)
    im = Image.new("L", (w, h))
    ImageDraw.Draw(im).text((size_px * ss * 0.5, size_px * ss * 0.3), text, font=f, fill=255)
    a = np.asarray(im, np.float32) / 255.0
    return a, ss


def ink_box(a, thr=0.5):
    ys, xs = np.nonzero(a > thr)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def measure_ink(im, box):
    """Ink of a white numeral in a search box: threshold at half between the local dark level and the white
    core; returns the soft ink (0..1), bbox (panel, half-max), core colour."""
    x0, y0, x1, y1 = box
    c = im[y0:y1, x0:x1]
    mn = c.min(2)
    lo = np.percentile(mn, 20)
    hi = np.percentile(mn, 99)
    ink = np.clip((mn - lo) / (hi - lo + 1e-6), 0, 1)
    chroma = c.max(2) - mn
    m = (ink > 0.5) & (chroma < 0.2)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if st[i, 4] >= 12:
            keep |= lab == i
    ys, xs = np.nonzero(keep)
    bb = (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)
    core = c[cv2.erode(keep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0]
    return ink * cv2.dilate(keep.astype(np.uint8), np.ones((5, 5), np.uint8)), bb, np.median(core, 0)


def place(text, wght, wdth, bb, blur=0.9, ss=4, stretch=True):
    """Render `text` so that its half-max ink box matches bb (panel px): returns (alpha, x, y) at 1x."""
    H = bb[3] - bb[1]
    # size such that the ink height == H: digit height is ~0.71 of the font size for Roboto/Arimo; refine
    size = H / 0.71
    for _ in range(3):
        a, k = render_text(text, size, wght, wdth, ss)
        ix0, iy0, ix1, iy1 = ink_box(a)
        h_ink = (iy1 - iy0) / k
        size *= H / h_ink
    a, k = render_text(text, size, wght, wdth, ss)
    ix0, iy0, ix1, iy1 = ink_box(a)
    if stretch:
        sx = (bb[2] - bb[0]) / ((ix1 - ix0) / k)
        a = cv2.resize(a, (int(round(a.shape[1] * sx)), a.shape[0]), interpolation=cv2.INTER_AREA if sx < 1 else cv2.INTER_LINEAR)
        ix0, iy0, ix1, iy1 = ink_box(a)
    # panel position of the raster's top-left so that ink centres coincide
    cx_p, cy_p = 0.5 * (bb[0] + bb[2]), 0.5 * (bb[1] + bb[3])
    cx_r, cy_r = 0.5 * (ix0 + ix1) / k, 0.5 * (iy0 + iy1) / k
    ox, oy = cx_p - cx_r, cy_p - cy_r
    # resample to the panel pixel grid: shift by the fractional part at ss resolution
    X0, Y0 = int(np.floor(ox)), int(np.floor(oy))
    fx, fy = ox - X0, oy - Y0
    M = np.float32([[1, 0, fx * k], [0, 1, fy * k]])
    a = cv2.warpAffine(a, M, (a.shape[1] + k, a.shape[0] + k), flags=cv2.INTER_LINEAR)
    h1, w1 = a.shape[0] // k, a.shape[1] // k
    a = cv2.resize(a[:h1 * k, :w1 * k], (w1, h1), interpolation=cv2.INTER_AREA)
    if blur > 0:
        a = cv2.GaussianBlur(a, (0, 0), blur)
    ys, xs = np.nonzero(a > 0.004)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return a, X0 + xs.min(), Y0 + ys.min(), size


def iou_score(ink, bb, alpha, ax, ay, box):
    x0, y0, x1, y1 = box
    canvas = np.zeros((y1 - y0, x1 - x0), np.float32)
    h, w = alpha.shape
    X0, Y0 = ax - x0, ay - y0
    sx0, sy0 = max(0, -X0), max(0, -Y0)
    dx0, dy0 = max(0, X0), max(0, Y0)
    hh, ww = min(h - sy0, canvas.shape[0] - dy0), min(w - sx0, canvas.shape[1] - dx0)
    canvas[dy0:dy0 + hh, dx0:dx0 + ww] = alpha[sy0:sy0 + hh, sx0:sx0 + ww]
    inter = np.minimum(canvas, ink).sum()
    union = np.maximum(canvas, ink).sum()
    return inter / union


def fit():
    ims = {"08": lib.load_rect("08"), "09": lib.load_rect("09")}
    meas = []
    for dial, text, box, ph in ITEMS:
        ink, bb, col = measure_ink(ims[ph], box)
        meas.append((dial, text, box, ph, ink, bb, col))
    best = {}
    for group, sel in (("digits", lambda t: t != "km/h"), ("unit", lambda t: t == "km/h")):
        scores = {}
        for wght in range(400, 801, 50):
            for wdth in (75, 81.25, 87.5, 93.75, 100):
                s = []
                for dial, text, box, ph, ink, bb, col in meas:
                    if not sel(text):
                        continue
                    a, ax, ay, _ = place(text, wght, wdth, bb)
                    s.append(iou_score(ink, bb, a, ax, ay, box))
                scores[(wght, wdth)] = float(np.mean(s))
        k = max(scores, key=scores.get)
        best[group] = {"wght": k[0], "wdth": k[1], "mean_iou": scores[k],
                       "grid": {"%d/%g" % kk: round(v, 4) for kk, v in scores.items()}}
    # 'km/h': the IoU grid prefers the heaviest weight (the photo's blur thickens thin strokes); by eye the unit
    # has the digits' weight, so it takes the digits' weight and its own (stretched) width.
    best["unit"]["wght_iou_best"] = best["unit"]["wght"]
    best["unit"]["wght"] = best["digits"]["wght"]
    items = []
    for dial, text, box, ph, ink, bb, col in meas:
        g = best["unit" if text == "km/h" else "digits"]
        a, ax, ay, size = place(text, g["wght"], g["wdth"], bb)
        _, _, col9 = measure_ink(ims["09"], box)
        items.append({"dial": dial, "text": text, "photo": ph, "ink_box": [int(v) for v in bb],
                      "size_px": round(float(size), 3), "colour": np.round(col, 4).tolist(),
                      "colour_day": np.round(col9, 4).tolist(),
                      "iou": round(float(iou_score(ink, bb, a, ax, ay, box)), 4)})
    path, family, why = font_file()
    out = {"font_file": lib.os.path.relpath(path, lib.WT), "family": family, "font_source": why, "fit": best,
           "items": items}
    lib.write_json(lib.os.path.join(lib.PARAMS, "numerals.json"), out)
    return out


if __name__ == "__main__":
    o = fit()
    print(o["family"], o["font_source"], {k: (v["wght"], v["wdth"], round(v["mean_iou"], 3)) for k, v in o["fit"].items()})
    for it in o["items"]:
        print(it["dial"], it["text"], it["ink_box"], it["size_px"], it["iou"], np.round(np.array(it["colour"]) * 255))
