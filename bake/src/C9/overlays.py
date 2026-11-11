"""The map of what BMW draws over our panel on the G20 (photos 08-11, panel px), compared with shared/visible.js.

    cd bake/src && $PY -m C9.overlays          (runs C9.align08 first: P0's 08 rectification is degenerate)

Outputs: bake/work/C9/overlays.json, overlays_annotated.png (over photo 10, dimmed; scratch only),
overlays_schematic.png (no photo pixels).
"""
import json, os, re, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(SRC, "..", ".."))
sys.path.insert(0, SRC)
from common import geom  # noqa: E402
from C9 import align08  # noqa: E402

RECT = os.path.join(ROOT, "bake", "work", "rect")
WORK = os.path.join(ROOT, "bake", "work", "C9")


def visible_js():
    s = open(os.path.join(ROOT, "shared", "visible.js")).read()
    out = {}
    for k in ("BLACK_BOX", "BELT", "GEAR_P"):
        m = re.search(r"const %s = \[([^\]]+)\]" % k, s)
        out[k] = [float(v) for v in m.group(1).split(",")]
    m = re.search(r"const HOOD = \[(.*?)\];", s, re.S)
    out["HOOD"] = [[float(a), float(b)] for a, b in re.findall(r"\[(\d+),\s*(\d+)\]", m.group(1))]
    return out


def lum(a):
    return cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float64)


# ------------------------------------------------------------------------- photo 10: grid lines as local rulers
def line_pos(G, nominal, axis, span, half=10):
    """Sub-pixel position of the grid line near `nominal` (panel px) in the rect of photo 10.
    axis 'x': a vertical line, searched in columns, averaged over rows span=(y0, y1)."""
    if axis == "x":
        prof = G[span[0]:span[1], nominal - half:nominal + half + 1].mean(0)
    else:
        prof = G[nominal - half:nominal + half + 1, span[0]:span[1]].mean(1)
    i = int(np.argmax(prof))
    if 0 < i < len(prof) - 1:
        a, b, c = prof[i - 1], prof[i], prof[i + 1]
        d = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
    else:
        d = 0.0
    return nominal - half + i + d


def half_cross(p, i0, i1):
    """Sub-pixel index between i0 and i1 where profile p crosses half way between p[i0] and p[i1]."""
    h = 0.5 * (p[i0] + p[i1])
    step = 1 if i1 > i0 else -1
    for i in range(i0, i1, step):
        if (p[i] - h) * (p[i + step] - h) <= 0 and p[i] != p[i + step]:
            return i + step * (p[i] - h) / (p[i] - p[i + step])
    return None


def black_box_10(a):
    G = a[..., 1].astype(np.float64)
    # where the grid lines around the box really are (rect of 10 has ~2-3 px local error from Hm)
    xs = {x: line_pos(G, x, "x", (455, 495)) for x in (1450, 1500, 1550, 1600)}
    ys = {y: line_pos(G, y, "y", (1360, 1400)) for y in (350, 400)}
    ys_far = {y: line_pos(G, y, "y", (1640, 1700)) for y in (300, 450)}
    dx = float(np.mean([x - v for x, v in xs.items()]))        # nominal - measured
    dy = float(np.mean([y - v for y, v in list(ys.items()) + list(ys_far.items())]))
    tops, bots = [], []
    for x, xm in xs.items():
        xi = int(round(xm))
        col = G[290:480, xi - 1:xi + 2].max(1)
        t = half_cross(col, 300 - 290 + 12, 345 - 290)       # bright line above -> dark inside
        b = half_cross(col, 470 - 290, 425 - 290)
        if t is not None: tops.append(290 + t + 0.5)
        if b is not None: bots.append(290 + b + 0.5)
    lefts, rights = [], []
    for y, ym in ys.items():
        yi = int(round(ym))
        row = G[yi - 1:yi + 2, 1380:1660].max(0)
        l = half_cross(row, 1405 - 1380, 1440 - 1380)
        r = half_cross(row, 1640 - 1380, 1590 - 1380)
        if l is not None: lefts.append(1380 + l + 0.5)
        if r is not None: rights.append(1380 + r + 0.5)
    raw = [float(np.mean(lefts)), float(np.mean(tops)), float(np.mean(rights)), float(np.mean(bots))]
    cor = [raw[0] + dx, raw[1] + dy, raw[2] + dx, raw[3] + dy]
    return {"raw_rect_px": [round(v, 1) for v in raw], "grid_correction_dx_dy": [round(dx, 2), round(dy, 2)],
            "x0y0x1y1": [round(v, 1) for v in cor],
            "samples": {"left": [round(v, 1) for v in lefts], "top": [round(v, 1) for v in tops],
                        "right": [round(v, 1) for v in rights], "bottom": [round(v, 1) for v in bots]},
            "grid_lines_seen_at": {"x": {k: round(v, 2) for k, v in xs.items()}, "y": {k: round(v, 2) for k, v in {**ys, **ys_far}.items()}},
            "method": "half-max crossings of the green/grey grid lines (drawn by our app) where BMW's box cuts them; corrected by the local offset of the same lines"}


def black_box_11(a):
    L = lum(a)
    gx = np.abs(np.diff(cv2.GaussianBlur(L, (0, 0), 1.0), axis=1))
    gy = np.abs(np.diff(cv2.GaussianBlur(L, (0, 0), 1.0), axis=0))
    lefts = [1405 + int(np.argmax(gx[y, 1405:1440])) + 1.0 for y in range(335, 425, 3)]
    tops = [300 + int(np.argmax(gy[300:340, x])) + 1.0 for x in range(1440, 1600, 4)]
    return {"left": round(float(np.median(lefts)), 1), "top": round(float(np.median(tops)), 1),
            "note": "right and bottom edges have no contrast in 11 (our dark face both sides); 11 is a 4-point fix (P0), ~3 px at this corner"}


def blob_bbox(mask, min_area=40):
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
    boxes = [st[i] for i in range(1, n) if st[i][4] >= min_area]
    if not boxes:
        return None
    x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes)
    x1 = max(b[0] + b[2] for b in boxes); y1 = max(b[1] + b[3] for b in boxes)
    return [int(x0), int(y0), int(x1), int(y1)]


def white_in(a, box, thr=150, largest=False):
    x0, y0, x1, y1 = box
    sub = a[y0:y1, x0:x1].astype(np.int32)
    L = lum(a[y0:y1, x0:x1])
    sat = sub.max(2) - sub.min(2)
    greenish = (sub[..., 1] - np.maximum(sub[..., 0], sub[..., 2])) > 35
    m = (L > thr) & (sat < 60) & ~greenish
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    if largest:
        n, lab, st, _ = cv2.connectedComponentsWithStats(m)
        if n < 2:
            return None
        i = 1 + int(np.argmax(st[1:, 4]))
        return [int(st[i][0] + x0), int(st[i][1] + y0), int(st[i][0] + st[i][2] + x0), int(st[i][1] + st[i][3] + y0)]
    b = blob_bbox(m, 30)
    return None if b is None else [b[0] + x0, b[1] + y0, b[2] + x0, b[3] + y0]


def red_in(a, box):
    x0, y0, x1, y1 = box
    hsv = cv2.cvtColor(a[y0:y1, x0:x1], cv2.COLOR_BGR2HSV).astype(np.int32)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = ((H < 12) | (H > 165)) & (S > 100) & (V > 100)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    out = [[int(st[i][0] + x0), int(st[i][1] + y0), int(st[i][0] + st[i][2] + x0), int(st[i][1] + st[i][3] + y0)]
           for i in range(1, n) if st[i][4] >= 150]
    return sorted(out)


def sat_blobs(a, box, min_area=150):
    x0, y0, x1, y1 = box
    hsv = cv2.cvtColor(a[y0:y1, x0:x1], cv2.COLOR_BGR2HSV).astype(np.int32)
    H, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = (S > 110) & (V > 110)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    out = []
    for i in range(1, n):
        if st[i][4] < min_area:
            continue
        h = float(np.median(H[lab == i])) * 2.0
        colour = "red" if (h < 12 or h > 330) else "amber" if h < 50 else "green" if 70 < h < 170 else "blue" if 180 < h < 260 else "other"
        out.append({"x0y0x1y1": [int(st[i][0] + x0), int(st[i][1] + y0), int(st[i][0] + st[i][2] + x0), int(st[i][1] + st[i][3] + y0)],
                    "hue_deg": round(h), "colour": colour, "area_px": int(st[i][4])})
    return sorted(out, key=lambda d: (d["x0y0x1y1"][1], d["x0y0x1y1"][0]))


def text_groups(a, box, thr=140, join=(23, 9)):
    x0, y0, x1, y1 = box
    sub = a[y0:y1, x0:x1].astype(np.int32)
    L = lum(a[y0:y1, x0:x1])
    m = (L > thr) & ((sub.max(2) - sub.min(2)) < 70)
    m = cv2.dilate(m.astype(np.uint8), np.ones((join[1], join[0]), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    out = []
    for i in range(1, n):
        if st[i][4] < 200 or st[i][3] - join[1] < 15:
            continue
        bx = [int(st[i][0] + x0 + join[0] // 2), int(st[i][1] + y0 + join[1] // 2),
              int(st[i][0] + st[i][2] + x0 - join[0] // 2), int(st[i][1] + st[i][3] + y0 - join[1] // 2)]
        out.append(bx)
    return sorted(out)


def map_hull(imgs):
    pts = []
    excl = [(360, 300, 720, 425), (1200, 300, 1570, 425), (930, 480, 1000, 545), (490, 570, 600, 665)]
    for a in imgs:
        sub = a.astype(np.int32)
        L = lum(a)
        m = (L > 120) & ((sub.max(2) - sub.min(2)) < 45)
        # thin bright lines only: top-hat against a 9 px opening
        th = cv2.morphologyEx(L.astype(np.uint8), cv2.MORPH_TOPHAT, np.ones((9, 9), np.uint8)) > 60
        m &= th
        reg = np.zeros_like(m); reg[140:612, 520:1420] = True
        for x0, y0, x1, y1 in excl:
            reg[y0:y1, x0:x1] = False
        m &= reg
        m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(m)
        for i in range(1, n):
            if st[i][4] >= 60 and max(st[i][2], st[i][3]) >= 30:     # line segments, not specks
                ys, xs = np.nonzero(lab == i)
                pts.append(np.stack([xs, ys], 1))
    P = np.concatenate(pts).astype(np.int32)
    hull = cv2.convexHull(P)[:, 0, :]
    return [[int(x), int(y)] for x, y in hull], [int(P[:, 0].min()), int(P[:, 1].min()), int(P[:, 0].max()), int(P[:, 1].max())]


def to_R(box, cl):
    g = geom.G20[cl]
    x0, y0, x1, y1 = box
    u0, u1 = (x0 - g["c"][0]) / g["R"], (x1 - g["c"][0]) / g["R"]
    v0, v1 = (y0 - g["c"][1]) / g["R"], (y1 - g["c"][1]) / g["R"]
    cxp, cyp = (x0 + x1) / 2 - g["c"][0], (y0 + y1) / 2 - g["c"][1]
    r = float(np.hypot(cxp, cyp) / g["R"])
    ang = float((np.degrees(np.arctan2(cxp, -cyp)) + 360) % 360)
    return {"dial": cl, "u0u1": [round(u0, 3), round(u1, 3)], "v0v1": [round(v0, 3), round(v1, 3)],
            "centre_r_R": round(r, 3), "centre_cw12": round(ang, 1)}


def run():
    H08, a08 = align08.run()
    a09 = cv2.imread(os.path.join(RECT, "09_stock_map_day.g20.PANEL.png"))
    a10 = cv2.imread(os.path.join(RECT, "10_grid_over-stock.g20.PANEL.png"))
    a11 = cv2.imread(os.path.join(RECT, "11_our-theme_on-car.g20.PANEL.png"))
    vis = visible_js()
    res = {"visible_js": vis, "sources": {
        "08": "bake/work/C9/08_rect_panel.png (own SIFT from the 09 rect, see 08_H.json)",
        "09": "bake/work/rect/09_stock_map_day.g20.PANEL (P0: SIFT to 10, 1.08 px, chained with Hm)",
        "10": "bake/work/rect/10_grid_over-stock.g20.PANEL (P0: Hm, 108 crossings, 3.54 photo px mean)",
        "11": "bake/work/rect/11_our-theme_on-car.g20.PANEL (P0: 4-point fix, black-box corner check 2.98 px)"}}
    res["align08"] = json.load(open(os.path.join(WORK, "08_H.json")))
    res["align08"].pop("H_panel_to_photo", None)

    # 1. black area
    bb10 = black_box_10(a10)
    bb11 = black_box_11(a11)
    res["black_box"] = {"photo10": bb10, "photo11": bb11, "adopted": bb10["x0y0x1y1"]}

    # 2. gear letter (drawn by BMW at the foot of the rev dial whenever a custom theme runs)
    g10 = white_in(a10, (1375, 658, 1440, 712), thr=170, largest=True)
    g11 = white_in(a11, (1370, 645, 1440, 712), thr=150, largest=True)
    G = a10[..., 1].astype(np.float64)
    gx = line_pos(G, 1400, "x", (600, 640), half=6); gy = line_pos(G, 600, "y", (1330, 1380), half=6); gy2 = line_pos(G, 700, "y", (1330, 1380), half=6)
    dxg, dyg = 1400 - gx, ((600 - gy) + (700 - gy2)) / 2
    g10c = [round(g10[0] + dxg, 1), round(g10[1] + dyg, 1), round(g10[2] + dxg, 1), round(g10[3] + dyg, 1)]
    res["gear_letter"] = {"photo10_raw": g10, "photo10_grid_correction": [round(dxg, 2), round(dyg, 2)], "photo10": g10c,
                          "photo11": g11, "adopted": g10c, "glyph": "P (drawn white, ~33 px cap height); other gears (R, N, D, S, M) are wider than P: keep the visible.js margin",
                          "stock_position_08_09": white_in(a08, (1480, 320, 1560, 405)), "stock_position_09": white_in(a09, (1480, 320, 1560, 405))}

    # 3. belt lamp
    b08 = red_in(a08, (490, 662, 700, 720))
    b10 = red_in(a10, (570, 640, 660, 720))
    b11 = red_in(a11, (570, 640, 670, 720))
    bx = line_pos(G, 600, "x", (560, 640), half=6); by = line_pos(G, 600, "y", (520, 580), half=6); by2 = line_pos(G, 700, "y", (520, 580), half=6)
    dxb, dyb = 600 - bx, ((600 - by) + (700 - by2)) / 2
    b10c = [[round(b[0] + dxb, 1), round(b[1] + dyb, 1), round(b[2] + dxb, 1), round(b[3] + dyb, 1)] for b in b10]
    res["belt_lamp"] = {"photo08_all_red_lamps_bottom_row": b08, "photo10_raw": b10, "photo10_grid_correction": [round(dxb, 2), round(dyb, 2)],
                        "photo10": b10c, "photo11": b11, "adopted": b10c[0] if b10c else None}

    # 4. telltales (stock 08 night with warnings, 09 day): left column, right column, bottom row
    res["telltales"] = {
        "08_left": sat_blobs(a08, (0, 150, 110, 450)), "08_right": sat_blobs(a08, (1776, 150, 1920, 340)),
        "09_left": sat_blobs(a09, (0, 150, 110, 450)), "09_right": sat_blobs(a09, (1776, 150, 1920, 340)),
        "08_bottom": b08}

    # 5. bottom row of the stock theme (text, under a custom theme: not drawn over us, see the report)
    res["bottom_row"] = {"08": text_groups(a08, (100, 640, 1920, 720)), "09": text_groups(a09, (100, 640, 1920, 720)),
                         "08_check_control_panel": white_in(a08, (690, 590, 1240, 720), thr=120)}

    # 6. map area of the stock theme
    hull, mb = map_hull([a08, a09])
    res["map"] = {"hull_08_09": hull, "bbox_08_09": mb}

    # 7. visible.js discrepancies (measured - visible.js), px, per edge x0, y0, x1, y1
    def diff(meas, ref):
        return [round(m - r, 1) for m, r in zip(meas, ref)]
    res["discrepancy_px"] = {"BLACK_BOX": diff(res["black_box"]["adopted"], vis["BLACK_BOX"]),
                             "GEAR_P": diff(res["gear_letter"]["adopted"], vis["GEAR_P"]),
                             "BELT": diff(res["belt_lamp"]["adopted"], vis["BELT"]) if res["belt_lamp"]["adopted"] else None}
    # in R units of the nearer dial
    res["in_R_units"] = {"black_box": to_R(res["black_box"]["adopted"], "C2"), "gear_letter": to_R(res["gear_letter"]["adopted"], "C2"),
                         "belt_lamp": to_R(res["belt_lamp"]["adopted"], "C1")}
    for side, cl in (("08_left", "C1"), ("08_right", "C2")):
        for t in res["telltales"][side]:
            t["R_units"] = to_R(t["x0y0x1y1"], cl)
            # nearest distance from the lamp box to the dial's outer edge (negative = overlaps the bezel)
            g = geom.G20[cl]; x0, y0, x1, y1 = t["x0y0x1y1"]
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            t["min_gap_to_bezel_px"] = round(float(np.hypot(xs - g["c"][0], ys - g["c"][1]).min() - g["R"]), 1)
    json.dump(res, open(os.path.join(WORK, "overlays.json"), "w"), indent=1)
    draw(res, a10)
    return res


def draw(res, a10):
    vis = res["visible_js"]
    for name, bg in (("overlays_annotated.png", (a10.astype(np.float64) * 0.35).astype(np.uint8)),
                     ("overlays_schematic.png", np.zeros((720, 1920, 3), np.uint8))):
        S = 2
        img = cv2.resize(bg, (1920 * S, 720 * S), interpolation=cv2.INTER_LINEAR)
        def P(x, y): return (int(round(x * S)), int(round(y * S)))
        def rect(b, c, t=2, dash=False):
            x0, y0, x1, y1 = b
            if not dash:
                cv2.rectangle(img, P(x0, y0), P(x1, y1), c, t, cv2.LINE_AA)
            else:
                for (xa, ya, xb, yb) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
                    n = max(2, int(np.hypot(xb - xa, yb - ya) / 6))
                    for i in range(0, n, 2):
                        cv2.line(img, P(xa + (xb - xa) * i / n, ya + (yb - ya) * i / n), P(xa + (xb - xa) * (i + 1) / n, ya + (yb - ya) * (i + 1) / n), c, t, cv2.LINE_AA)
        def label(txt, x, y, c, s=0.9):
            cv2.putText(img, txt, P(x, y), cv2.FONT_HERSHEY_SIMPLEX, s, c, 2, cv2.LINE_AA)
        # our geometry
        for cl in ("C1", "C2", "C3", "C4"):
            g = geom.G20[cl]
            cv2.circle(img, P(*g["c"]), int(g["R"] * S), (120, 120, 120), 1, cv2.LINE_AA)
        W = geom.WINDOW
        rect((W["x0"], W["y0"], W["x1"], W["y1"]), (120, 120, 120), 1)
        # hood
        pts = np.array([P(x, y) for x, y in vis["HOOD"]], np.int32)
        cv2.polylines(img, [pts], False, (200, 120, 255), 2, cv2.LINE_AA)
        label("hood (visible.js)", 870, 30, (200, 120, 255), 0.8)
        # map hull (stock only)
        cv2.polylines(img, [np.array([P(x, y) for x, y in res["map"]["hull_08_09"]], np.int32)], True, (255, 200, 0), 2, cv2.LINE_AA)
        label("stock map (08/09), hidden by a custom theme", 760, 140, (255, 200, 0), 0.8)
        # visible.js boxes dashed yellow, measured solid
        for k, mkey in (("BLACK_BOX", "black_box"), ("GEAR_P", "gear_letter"), ("BELT", "belt_lamp")):
            rect(vis[k], (0, 230, 255), 2, dash=True)
        rect(res["black_box"]["adopted"], (0, 0, 255), 3)
        label("BMW black area (measured)", 1405, 312, (0, 0, 255), 0.8)
        rect(res["gear_letter"]["adopted"], (255, 255, 255), 3)
        label("gear", 1392, 658, (255, 255, 255), 0.7)
        if res["belt_lamp"]["adopted"]:
            rect(res["belt_lamp"]["adopted"], (60, 60, 255), 3)
        # telltales 08
        cols = {"red": (60, 60, 255), "amber": (0, 165, 255), "green": (0, 220, 0), "blue": (255, 120, 0), "other": (200, 200, 200)}
        for side in ("08_left", "08_right"):
            for t in res["telltales"][side]:
                rect(t["x0y0x1y1"], cols[t["colour"]], 2)
        for b in res["telltales"]["08_bottom"]:
            rect(b, cols["red"], 2)
        label("telltales (08, stock)", 4, 205, (0, 165, 255), 0.6)
        # bottom row text (stock)
        for b in res["bottom_row"]["08"]:
            rect(b, (180, 180, 180), 1)
        if res["bottom_row"]["08_check_control_panel"]:
            rect(res["bottom_row"]["08_check_control_panel"], (255, 255, 0), 2, dash=True)
        label("stock bottom row (08): grey; check-control: cyan dashed", 700, 590, (200, 200, 200), 0.6)
        label("dashed yellow = shared/visible.js, solid = measured; grey = our G20 dials / window", 20, 712, (0, 230, 255), 0.7)
        cv2.imwrite(os.path.join(WORK, name), img)


if __name__ == "__main__":
    r = run()
    print(json.dumps({k: r[k] for k in ("black_box", "gear_letter", "belt_lamp", "discrepancy_px", "in_R_units")}, indent=1))
    print(json.dumps(r["telltales"], indent=None)[:3000])
    print(json.dumps(r["bottom_row"]), r["map"]["bbox_08_09"])
